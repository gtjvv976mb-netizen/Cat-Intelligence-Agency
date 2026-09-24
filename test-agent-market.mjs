/**
 * THE AGENT'S MARKET SNAPSHOT, REPLAYED FROM THE LIVE ANSWERS, WITH NO NETWORK.
 *
 * `fetch` here is a router over the answers recorded on 2026-09-24 in fixtures/agent/
 * (DexScreener's batch tokens endpoint for the eight majors, GeckoTerminal's fifteen-minute
 * candles for JUP's pool, Jupiter's price API) and it throws on any host but those. What is
 * proved:
 *   1. the parsers read the recorded answers: the price, the 1 h and 24 h change, the volume,
 *      the liquidity and the pair of every major; the candles oldest first, deduplicated,
 *      a malformed row dropped rather than repaired;
 *   2. a figure a source did not give is null and named in `missing`, never filled in;
 *   3. the indicators are deterministic and right on sequences worked by hand (EMA, Wilder's
 *      RSI, returns), and on the live candles they agree with the raw rows read directly;
 *   4. one DexScreener request prices the whole universe; candles are read only when asked
 *      for, one pool at a time, 2.1 s apart, and kept fifteen minutes;
 *   5. a 429 rests the host a minute (its retry-after of 0 is not a promise), doubles while it
 *      repeats, asks nothing while resting, and a success clears it;
 *   6. a token DexScreener did not price is priced by Jupiter's price API, through the shared
 *      client, and only that token is asked for.
 */
import fs from "node:fs";
import {
  parseDexScreenerTokens, parseGeckoOhlcv, parseJupiterPrices, ema, rsi, pctChange, indicatorsFrom, createMarket, finiteOrNull,
  DEXSCREENER_TOKENS_API, GECKOTERMINAL_POOLS_API, MARKET_HOST_INTERVAL_MS, CANDLE_TTL_MS, MARKET_BACKOFF,
} from "./src/lib/agent-market.mjs";
import { SOLANA_MAJORS } from "./src/lib/agent-strategy.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? "  — " + detail : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const section = (title) => console.log(`\n${title}\n${"─".repeat(title.length)}`);
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), "utf8"));
const DS = read("./fixtures/agent/dexscreener-tokens-majors.json");
const GT = read("./fixtures/agent/geckoterminal-ohlcv-jup-15m.json");
const JP = read("./fixtures/agent/jupiter-price-majors.json");
const GT429 = read("./fixtures/xstock-pools/geckoterminal-429.json");
const MAJORS = SOLANA_MAJORS.map((m) => ({ mint: m.mint, symbol: m.symbol }));
const JUP = SOLANA_MAJORS.find((m) => m.symbol === "JUP").mint;
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const response = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (n) => headers[String(n).toLowerCase()] ?? null }, async text() { return JSON.stringify(body); } });
function world() {
  let now = 1_790_277_600_000;
  const w = { asked: [], slept: [], dex: DS.body, gecko: [], jupiterAsked: [] };
  w.clock = () => now;
  w.sleep = async (ms) => { w.slept.push(ms); now += ms; };
  w.advance = (ms) => { now += ms; };
  w.fetchImpl = async (url) => {
    const u = new URL(url);
    w.asked.push({ at: now, host: u.host, url });
    if (u.host === "api.dexscreener.com") return response(200, w.dex);
    if (u.host === "api.geckoterminal.com") return w.gecko.length ? w.gecko.shift() : response(200, GT.body);
    throw new Error(`the test network refuses ${u.host}`);
  };
  w.jupiter = { async prices({ mints }) { w.jupiterAsked.push([...mints]); return JP.body; } };
  w.market = createMarket({ fetchImpl: w.fetchImpl, clock: w.clock, sleep: w.sleep, jupiter: w.jupiter, timers: { setTimeout: () => null, clearTimeout: () => {} } });
  return w;
}

section("1. THE PARSERS, ON THE RECORDED ANSWERS");
{
  const parsed = parseDexScreenerTokens(DS.body, MAJORS.map((m) => m.mint));
  ok("the recorded DexScreener answer is the live one: HTTP 200, cached 30 s, one pair per major", DS.status === 200 && DS.cacheControl === "public, max-age=30" && DS.body.length === 8);
  for (const m of MAJORS) {
    const p = parsed[m.mint], raw = DS.body.find((x) => x.baseToken.address === m.mint);
    ok(`${m.symbol}: price, 1 h and 24 h change, volume and liquidity read as the answer gave them`,
      p.priceUsd === Number(raw.priceUsd) && p.change1hPct === raw.priceChange.h1 && p.change24hPct === raw.priceChange.h24 && p.volume24hUsd === raw.volume.h24 && p.liquidityUsd === raw.liquidity.usd && p.pair.address === raw.pairAddress,
      `$${p.priceUsd} · ${p.change24hPct}% 24 h · ${p.pair.dex}/${p.pair.quoteSymbol}`);
  }
  const deeper = [{ ...DS.body[1], liquidity: { usd: 1 }, pairAddress: "shallow" }, { ...DS.body[1], liquidity: { usd: 9e9 }, pairAddress: "deep" }];
  ok("of two pairs for one mint, the deeper one is used", parseDexScreenerTokens(deeper, [JUP])[JUP].pair.address === "deep");
  const flipped = [{ ...DS.body[1], baseToken: DS.body[1].quoteToken, quoteToken: DS.body[1].baseToken }];
  ok("a pair where the mint is the QUOTE side does not price it (it prices the other token)", parseDexScreenerTokens(flipped, [JUP])[JUP].priceUsd === null);
  const candles = parseGeckoOhlcv(GT.body);
  const list = GT.body.data.attributes.ohlcv_list;
  ok("the recorded GeckoTerminal answer: 100 fifteen-minute candles, newest first as sent", GT.status === 200 && list.length === 100 && list[0][0] > list[99][0] && list[0][0] - list[1][0] === 900);
  ok("parsed oldest first, in milliseconds, every one kept", candles.length === 100 && candles[0].t === list[99][0] * 1000 && candles[99].c === list[0][4] && candles.every((c, i) => i === 0 || c.t > candles[i - 1].t));
  const junk = { data: { attributes: { ohlcv_list: [[1, 1, 1, 1, 1, 1], [2, "x", 1, 1, 1, 1], [3, 1, 0.5, 1, 1, 1], [1, 2, 2, 2, 2, 2], "row", [4, 1, 1, 1, -1, 1]] } } };
  const cleaned = parseGeckoOhlcv(junk);
  ok("a malformed row (a non-number, high under low, a negative close, a non-array) is dropped; a repeated time is kept once", cleaned.length === 1 && cleaned[0].t === 1000, JSON.stringify(cleaned));
  ok("an answer without a candle list is no candles, not an error", parseGeckoOhlcv({}).length === 0 && parseGeckoOhlcv(null).length === 0);
  const jp = parseJupiterPrices(JP.body, [...MAJORS.map((m) => m.mint), "missing"]);
  ok("Jupiter's price answer: every major priced, an absent mint null", MAJORS.every((m) => jp[m.mint] === JP.body[m.mint].usdPrice) && jp.missing === null);
}

section("2. MISSING IS MISSING");
{
  const odd = [{ ...DS.body[1], priceUsd: "not a price", priceChange: { h24: 3 }, volume: {}, liquidity: null }];
  const p = parseDexScreenerTokens(odd, [JUP, SOLANA_MAJORS[0].mint])[JUP];
  ok("an unparseable price, an absent 1 h change, volume and liquidity are null — not zero, not carried", p.priceUsd === null && p.change1hPct === null && p.change24hPct === 3 && p.volume24hUsd === null && p.liquidityUsd === null);
  const none = parseDexScreenerTokens(odd, [SOLANA_MAJORS[0].mint])[SOLANA_MAJORS[0].mint];
  ok("a mint the answer did not mention is present with every figure null", none.priceUsd === null && none.pair === null);
  ok("a zero or negative price is not a price", parseDexScreenerTokens([{ ...DS.body[1], priceUsd: "0" }], [JUP])[JUP].priceUsd === null);
  ok("finiteOrNull: numbers and numeric strings pass; '', null, true, NaN do not", finiteOrNull("1.5") === 1.5 && finiteOrNull(0) === 0 && [null, undefined, "", true, NaN, "abc", Infinity].every((v) => finiteOrNull(v) === null));
}

section("3. THE INDICATORS");
{
  ok("EMA(3) of 1..5 seeded with the mean of the first three: 4", ema([1, 2, 3, 4, 5], 3) === 4);
  ok("EMA with fewer values than its period is null", ema([1, 2], 3) === null);
  ok("RSI of a series that only rises is 100; only falls, 0", rsi(Array.from({ length: 20 }, (_, i) => i + 1)) === 100 && rsi(Array.from({ length: 20 }, (_, i) => 20 - i)) === 0);
  const zigzag = Array.from({ length: 15 }, (_, i) => (i % 2 ? 11 : 10));
  ok("RSI of an even zigzag over exactly 15 closes is 50", rsi(zigzag) === 50);
  ok("RSI with 14 closes is null (it needs period + 1)", rsi(zigzag.slice(0, 14)) === null);
  ok("RSI of a flat series is 50, not a division by zero", rsi(Array(20).fill(3)) === 50);
  /* Wilder's smoothing, worked by hand: 14 alternating ±1 moves (the zigzag ends at 10), then
     one +3 move to 13: gain (0.5 × 13 + 3) / 14, loss (0.5 × 13) / 14, RSI 59.375. */
  const worked = [...zigzag, 13];
  const g = (7 / 14 * 13 + 3) / 14, l = (7 / 14 * 13 + 0) / 14;
  ok("RSI carries Wilder's smoothing past the seed: 59.375", close(rsi(worked), 100 - 100 / (1 + g / l)) && close(rsi(worked), 59.375), `${rsi(worked).toFixed(6)}`);
  ok("pctChange over 1 bar: 100 → 110 is +10%", close(pctChange([100, 110], 1), 10) && pctChange([100], 1) === null);
  const candles = parseGeckoOhlcv(GT.body);
  const ind = indicatorsFrom(candles);
  const raw = GT.body.data.attributes.ohlcv_list;          // newest first, as sent
  ok("on the live JUP candles: 100 bars, the last close is the newest row's", ind.bars === 100 && ind.lastClose === Number(raw[0][4].toFixed(10)) && ind.candleMinutes === 15);
  ok("…the 1 h return is the newest close over the one four rows back", close(ind.return1hPct, Number(((raw[0][4] / raw[4][4] - 1) * 100).toFixed(3)), 1e-9), `${ind.return1hPct}%`);
  ok("…the 24 h return is the newest close over the one 96 rows back", close(ind.return24hPct, Number(((raw[0][4] / raw[96][4] - 1) * 100).toFixed(3)), 1e-9), `${ind.return24hPct}%`);
  ok("…RSI in range, both EMAs, a trend named", ind.rsi14 >= 0 && ind.rsi14 <= 100 && ind.ema20 > 0 && ind.ema50 > 0 && /ema20_(above|below)_ema50/.test(ind.trend), `RSI ${ind.rsi14}, ${ind.trend}`);
  ok("…and the same candles give the same numbers twice", JSON.stringify(indicatorsFrom(candles)) === JSON.stringify(ind));
  const short = indicatorsFrom(candles.slice(-30));
  ok("30 bars: no EMA(50), no 24 h return — null, not a shorter-window stand-in", short.ema50 === null && short.return24hPct === null && short.ema20 !== null && short.rsi14 !== null);
}

section("4. ONE REQUEST PRICES THE UNIVERSE; CANDLES ONLY WHEN ASKED");
{
  const w = world();
  const p = await w.market.prices(MAJORS);
  ok("one DexScreener request, every mint in it, comma-separated", w.asked.length === 1 && w.asked[0].url === `${DEXSCREENER_TOKENS_API}${MAJORS.map((m) => m.mint).join(",")}`);
  ok("every major priced from it", MAJORS.every((m) => p.tokens[m.mint].priceUsd > 0 && p.tokens[m.mint].priceSource === "dexscreener") && p.errors.length === 0);
  const s1 = await w.market.snapshot(MAJORS.slice(1, 2), { withCandles: false });
  ok("a snapshot without candles asks GeckoTerminal nothing", !w.asked.some((a) => a.host === "api.geckoterminal.com") && s1.tokens[JUP].indicators === null);
  const before = w.asked.length;
  const s2 = await w.market.snapshot(MAJORS.slice(1, 2), { withCandles: true });
  const g = w.asked.slice(before).filter((a) => a.host === "api.geckoterminal.com");
  ok("with candles: one GeckoTerminal request for JUP's pool — 15-minute bars, 100 of them, in USD, for the JUP side", g.length === 1
    && g[0].url === `${GECKOTERMINAL_POOLS_API}${DS.body[1].pairAddress}/ohlcv/minute?aggregate=15&limit=100&currency=usd&token=${JUP}`, g[0]?.url);
  ok("…and the snapshot carries the indicators, nothing missing", s2.tokens[JUP].indicators?.bars === 100 && s2.tokens[JUP].missing.length === 0, JSON.stringify(s2.tokens[JUP].missing));
  const n = w.asked.length;
  await w.market.snapshot(MAJORS.slice(1, 2), { withCandles: true });
  ok("candles are kept: a second snapshot inside fifteen minutes does not ask again", w.asked.slice(n).every((a) => a.host !== "api.geckoterminal.com"));
  w.advance(CANDLE_TTL_MS);
  const m = w.asked.length;
  await w.market.snapshot(MAJORS.slice(1, 2), { withCandles: true });
  ok("…and after fifteen minutes it does", w.asked.slice(m).some((a) => a.host === "api.geckoterminal.com"));
  const w2 = world();
  await w2.market.snapshot(MAJORS, { withCandles: true });
  const gecko = w2.asked.filter((a) => a.host === "api.geckoterminal.com");
  const gaps = gecko.slice(1).map((a, i) => a.at - gecko[i].at);
  ok("eight pools' candles are asked one at a time, at least 2.1 s apart", gecko.length === 8 && gaps.every((x) => x >= MARKET_HOST_INTERVAL_MS["api.geckoterminal.com"]), gaps.join(", "));
  const dex = w2.asked.filter((a) => a.host === "api.dexscreener.com");
  await w2.market.prices(MAJORS);
  const dex2 = w2.asked.filter((a) => a.host === "api.dexscreener.com");
  ok("two DexScreener reads are at least 1.1 s apart", dex2.length === dex.length + 1 && dex2[dex2.length - 1].at - dex2[dex2.length - 2].at >= MARKET_HOST_INTERVAL_MS["api.dexscreener.com"]);
}

section("5. A 429 RESTS THE HOST");
{
  const w = world();
  w.gecko.push(response(429, GT429.body, GT429.headers));
  const s = await w.market.snapshot(MAJORS.slice(1, 3), { withCandles: true });
  const gecko = () => w.asked.filter((a) => a.host === "api.geckoterminal.com").length;
  ok("the recorded 429 (retry-after: 0) is a rate limit, named, and the other token is not asked this tick", s.errors.some((e) => e.source === "geckoterminal" && e.code === "rate_limited") && gecko() === 1);
  ok("…the tokens say their indicators are missing", s.tokens[JUP].indicators === null && s.tokens[JUP].missing.includes("indicators"));
  const st = w.market.status().hosts.find((h) => h.host === "api.geckoterminal.com");
  ok("a retry-after of 0 is not a promise: the host rests a full minute", st.restingForMs === MARKET_BACKOFF.firstMs, `${st.restingForMs} ms`);
  const again = await w.market.snapshot(MAJORS.slice(1, 2), { withCandles: true });
  ok("while resting it is asked nothing, and the reason is said", gecko() === 1 && again.errors.some((e) => e.code === "resting"));
  w.advance(MARKET_BACKOFF.firstMs);
  w.gecko.push(response(429, GT429.body, GT429.headers));
  await w.market.snapshot(MAJORS.slice(1, 2), { withCandles: true });
  ok("a second 429 doubles the rest to two minutes", w.market.status().hosts.find((h) => h.host === "api.geckoterminal.com").restingForMs === 2 * MARKET_BACKOFF.firstMs);
  w.advance(2 * MARKET_BACKOFF.firstMs);
  const good = await w.market.snapshot(MAJORS.slice(1, 2), { withCandles: true });
  const h = w.market.status().hosts.find((x) => x.host === "api.geckoterminal.com");
  ok("a success clears the rest and the candles arrive", good.tokens[JUP].indicators?.bars === 100 && h.restingForMs === 0 && h.rateLimited === 2);
  const w3 = world();
  w3.fetchImpl = async () => { throw new Error("offline"); };
  const m3 = createMarket({ fetchImpl: w3.fetchImpl, clock: w3.clock, sleep: w3.sleep, timers: { setTimeout: () => null, clearTimeout: () => {} } });
  const off = await m3.snapshot(MAJORS, { withCandles: true });
  ok("with no network the snapshot still answers: every price null, every token saying so", MAJORS.every((m) => off.tokens[m.mint].priceUsd === null && off.tokens[m.mint].missing.includes("priceUsd")) && off.errors[0].code === "network");
}

section("6. JUPITER PRICES WHAT DEXSCREENER DID NOT");
{
  const w = world();
  const jito = SOLANA_MAJORS[0].mint;
  w.dex = DS.body.filter((p) => p.baseToken.address !== jito);
  const p = await w.market.prices(MAJORS);
  ok("the one mint DexScreener left out is asked of Jupiter, alone", w.jupiterAsked.length === 1 && JSON.stringify(w.jupiterAsked[0]) === JSON.stringify([jito]));
  ok("…and priced from Jupiter's answer, marked as such; the rest stay DexScreener's", p.tokens[jito].priceUsd === JP.body[jito].usdPrice && p.tokens[jito].priceSource === "jupiter" && p.tokens[JUP].priceSource === "dexscreener");
  ok("…its 24 h change and liquidity stay null: only the price is taken from the fallback", p.tokens[jito].change24hPct === null && p.tokens[jito].liquidityUsd === null);
  const w2 = world();
  await w2.market.prices(MAJORS);
  ok("when DexScreener prices everything, Jupiter is not asked", w2.jupiterAsked.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
