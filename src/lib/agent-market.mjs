/**
 * THE AGENT'S MARKET SNAPSHOT: PRICES, CHANGES, VOLUME, LIQUIDITY, AND A FEW INDICATORS.
 *
 * What the model is shown, and what the protections price positions with. Every figure is
 * read from a keyless public API or computed here, deterministically, from candles read
 * from one; a figure a source did not give is `null` and is listed in `missing`, never
 * filled in, never carried over from another token, never guessed.
 *
 * THE SOURCES, CHECKED LIVE ON 2026-09-24 (the answers are in fixtures/agent/):
 *   · DexScreener, GET https://api.dexscreener.com/tokens/v1/solana/{mint,mint,…}: up to 30
 *     mints in ONE request. For the eight majors it answered one pair each (the pair whose
 *     base is the mint): priceUsd, priceChange {m5,h1,h6,h24} in percent, volume {h24,…} in
 *     USD, liquidity.usd, pairAddress, dexId. Cached 30 s (cache-control: max-age=30); its
 *     API reference allows 300 requests a minute. One call per half-minute tick prices every
 *     token in the universe.
 *   · GeckoTerminal, GET https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/
 *     ohlcv/minute?aggregate=15&limit=100&currency=usd&token={mint}: up to 100 fifteen-minute
 *     candles, NEWEST FIRST, each [unix seconds, open, high, low, close, volume]. The free
 *     tier allows about 30 requests a minute and answers 429 quickly, so candles are read
 *     only when the model is about to be asked, one token at a time, 2.1 s apart, and kept
 *     for fifteen minutes.
 *   · Jupiter, GET https://api.jup.ag/price/v3?ids={mint,…}: usdPrice per mint, through the
 *     SHARED keyless Jupiter client (0.5 requests a second for every Jupiter call this
 *     extension makes). Asked only for a token DexScreener did not price, so a protection
 *     is not left blind by one feed's gap.
 *
 * A 429 rests that host for a minute (or its retry-after, if longer), doubling to fifteen
 * minutes while it keeps answering 429; a success clears the rest. fetch, the clock and
 * sleep are injected, so the tests replay the recorded answers with no network.
 */
import { JupiterError } from "./jupiter-swap.mjs";

export const DEXSCREENER_TOKENS_API = "https://api.dexscreener.com/tokens/v1/solana/";
export const GECKOTERMINAL_POOLS_API = "https://api.geckoterminal.com/api/v2/networks/solana/pools/";
export const CANDLE_MINUTES = 15;
export const CANDLE_LIMIT = 100;
/** Candles are re-read at most this often per token. */
export const CANDLE_TTL_MS = CANDLE_MINUTES * 60_000;
/** The gap kept between two requests to one host. */
export const MARKET_HOST_INTERVAL_MS = Object.freeze({ "api.dexscreener.com": 1_100, "api.geckoterminal.com": 2_100 });
export const MARKET_BACKOFF = Object.freeze({ firstMs: 60_000, maxMs: 15 * 60_000 });
const DEXSCREENER_BATCH = 30;

export class MarketError extends Error {
  constructor(code, message, detail = {}) { super(message); this.name = "MarketError"; this.code = code; this.detail = detail; }
}

const isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
/** A finite number from a number or a numeric string, else null. Never a guess. */
export const finiteOrNull = (v) => {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (n, d = 6) => (n === null ? null : Number(n.toFixed(d)));

/* ── the parsers ──────────────────────────────────────────────────────────────────── */

/**
 * DexScreener's /tokens/v1 answer, for each asked mint: the pair whose BASE is that mint
 * with the most USD liquidity (a pair where the mint is the quote prices the other side).
 * A mint with no such pair is present with every figure null.
 */
export function parseDexScreenerTokens(body, mints) {
  const pairs = Array.isArray(body) ? body : Array.isArray(body?.pairs) ? body.pairs : [];
  const out = {};
  for (const mint of mints) {
    const own = pairs.filter((p) => isPlainObject(p) && p.chainId === "solana" && p?.baseToken?.address === mint);
    own.sort((a, b) => (finiteOrNull(b?.liquidity?.usd) ?? -1) - (finiteOrNull(a?.liquidity?.usd) ?? -1));
    const p = own[0] ?? null;
    const row = {
      priceUsd: p ? finiteOrNull(p.priceUsd) : null,
      change1hPct: p ? finiteOrNull(p.priceChange?.h1) : null,
      change24hPct: p ? finiteOrNull(p.priceChange?.h24) : null,
      volume24hUsd: p ? finiteOrNull(p.volume?.h24) : null,
      liquidityUsd: p ? finiteOrNull(p.liquidity?.usd) : null,
      pair: p && typeof p.pairAddress === "string" ? { address: p.pairAddress, dex: typeof p.dexId === "string" ? p.dexId : null, quoteSymbol: typeof p.quoteToken?.symbol === "string" ? p.quoteToken.symbol : null } : null,
    };
    if (row.priceUsd !== null && row.priceUsd <= 0) row.priceUsd = null;
    out[mint] = row;
  }
  return out;
}

/** GeckoTerminal's OHLCV answer as candles OLDEST FIRST; a malformed row is dropped, never repaired. */
export function parseGeckoOhlcv(body) {
  const list = body?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];
  const candles = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [t, o, h, l, c, v] = row.map(finiteOrNull);
    if ([t, o, h, l, c].some((x) => x === null) || c <= 0 || h < l) continue;
    candles.push({ t: t * 1000, o, h, l, c, v: v ?? 0 });
  }
  candles.sort((a, b) => a.t - b.t);
  return candles.filter((x, i) => i === 0 || x.t !== candles[i - 1].t);
}

/** Jupiter price v3: { mint: { usdPrice } } → { mint: price|null }. */
export function parseJupiterPrices(body, mints) {
  const out = {};
  for (const mint of mints) {
    const p = finiteOrNull(body?.[mint]?.usdPrice);
    out[mint] = p !== null && p > 0 ? p : null;
  }
  return out;
}

/* ── the indicators: pure, deterministic, from closes oldest first ─────────────────── */

/** The exponential moving average of the last value, seeded with the simple mean of the
 *  first `period` values. Null with fewer than `period` values. */
export function ema(values, period) {
  if (!Array.isArray(values) || !(period >= 1) || values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/** Wilder's RSI over `period`. Null with fewer than period + 1 closes; 100 when nothing fell. */
export function rsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) gain += d; else loss -= d; }
  gain /= period; loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period;
    loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

/** The percent change over the last `bars` bars. Null without enough of them. */
export function pctChange(closes, bars) {
  if (!Array.isArray(closes) || closes.length < bars + 1) return null;
  const from = closes[closes.length - 1 - bars], to = closes[closes.length - 1];
  return from > 0 ? (to / from - 1) * 100 : null;
}

/** Everything the model is shown from one token's candles. */
export function indicatorsFrom(candles) {
  const closes = (candles ?? []).map((c) => c.c);
  const perHour = 60 / CANDLE_MINUTES;
  const e20 = ema(closes, 20), e50 = ema(closes, 50);
  const last = closes.length ? closes[closes.length - 1] : null;
  return Object.freeze({
    candleMinutes: CANDLE_MINUTES,
    bars: closes.length,
    lastClose: round(last, 10),
    lastCandleAt: candles?.length ? candles[candles.length - 1].t : null,
    rsi14: round(rsi(closes, 14), 2),
    ema20: round(e20, 10),
    ema50: round(e50, 10),
    trend: e20 === null || e50 === null ? null : e20 > e50 ? "ema20_above_ema50" : e20 < e50 ? "ema20_below_ema50" : "flat",
    return1hPct: round(pctChange(closes, perHour), 3),
    return4hPct: round(pctChange(closes, 4 * perHour), 3),
    return24hPct: round(pctChange(closes, 24 * perHour), 3),
    high24h: closes.length >= 24 * perHour ? round(Math.max(...candles.slice(-24 * perHour).map((c) => c.h)), 10) : null,
    low24h: closes.length >= 24 * perHour ? round(Math.min(...candles.slice(-24 * perHour).map((c) => c.l)), 10) : null,
  });
}

/* ── the source ───────────────────────────────────────────────────────────────────── */

export function createMarket({
  fetchImpl = globalThis.fetch, clock = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  timers = { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) },
  jupiter = null, timeoutMs = 10_000, maxWaitMs = 20_000,
} = {}) {
  const hosts = new Map();          // host → { nextAt, restUntil, restMs, ok, errors, rateLimited, lastError }
  const candles = new Map();        // mint → { at, pool, list }
  const hostOf = (url) => new URL(url).host;
  const hostState = (host) => { if (!hosts.has(host)) hosts.set(host, { nextAt: 0, restUntil: 0, restMs: 0, ok: 0, errors: 0, rateLimited: 0, lastError: null }); return hosts.get(host); };

  async function getJson(url) {
    const host = hostOf(url);
    const h = hostState(host);
    const now = clock();
    if (h.restUntil > now) throw new MarketError("resting", `${host} answered 429; resting until ${new Date(h.restUntil).toISOString()}`);
    if (h.nextAt > now) {
      if (h.nextAt - now > maxWaitMs) throw new MarketError("rate_budget", `${host} has no request slot free now`);
      await sleep(h.nextAt - now);
    }
    h.nextAt = Math.max(clock(), h.nextAt) + (MARKET_HOST_INTERVAL_MS[host] ?? 1_000);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? timers.setTimeout(() => controller.abort(), timeoutMs) : null;
    let res, text;
    try {
      res = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" }, signal: controller?.signal });
      text = typeof res.text === "function" ? await res.text() : JSON.stringify(await res.json());
    } catch (error) {
      h.errors++; h.lastError = String(error?.message ?? error);
      throw new MarketError("network", error?.name === "AbortError" ? `${host} did not answer inside ${timeoutMs}ms` : `${host} unreachable: ${h.lastError}`);
    } finally { if (timer !== null) timers.clearTimeout(timer); }
    if (res.status === 429) {
      h.rateLimited++;
      const after = finiteOrNull(typeof res.headers?.get === "function" ? res.headers.get("retry-after") : null);
      h.restMs = h.restMs ? Math.min(MARKET_BACKOFF.maxMs, h.restMs * 2) : MARKET_BACKOFF.firstMs;
      h.restUntil = clock() + Math.max(h.restMs, (after ?? 0) * 1000);
      h.lastError = "HTTP 429";
      throw new MarketError("rate_limited", `${host} answered 429: resting ${Math.round((h.restUntil - clock()) / 1000)} s`);
    }
    if (!res.ok) { h.errors++; h.lastError = `HTTP ${res.status}`; throw new MarketError("http", `${host} answered HTTP ${res.status}`, { status: res.status }); }
    let body;
    try { body = JSON.parse(text); } catch { h.errors++; h.lastError = "not JSON"; throw new MarketError("malformed", `${host} answered with something that is not JSON`); }
    h.ok++; h.restMs = 0; h.lastError = null;
    return body;
  }

  /**
   * One price read for the universe: DexScreener for everything, then Jupiter for any
   * mint DexScreener did not price. `universe` is [{ mint, symbol }].
   */
  async function prices(universe) {
    const mints = universe.map((u) => u.mint);
    const errors = [];
    const tokens = {};
    for (const mint of mints) tokens[mint] = { priceUsd: null, change1hPct: null, change24hPct: null, volume24hUsd: null, liquidityUsd: null, pair: null, priceSource: null };
    for (let i = 0; i < mints.length; i += DEXSCREENER_BATCH) {
      const batch = mints.slice(i, i + DEXSCREENER_BATCH);
      try {
        const parsed = parseDexScreenerTokens(await getJson(`${DEXSCREENER_TOKENS_API}${batch.join(",")}`), batch);
        for (const mint of batch) tokens[mint] = { ...parsed[mint], priceSource: parsed[mint].priceUsd === null ? null : "dexscreener" };
      } catch (error) { errors.push({ source: "dexscreener", code: error.code ?? "error", message: error.message }); }
    }
    const unpriced = mints.filter((m) => tokens[m].priceUsd === null);
    if (unpriced.length && jupiter && typeof jupiter.prices === "function") {
      try {
        const got = parseJupiterPrices(await jupiter.prices({ mints: unpriced, priority: "live" }), unpriced);
        for (const mint of unpriced) if (got[mint] !== null) tokens[mint] = { ...tokens[mint], priceUsd: got[mint], priceSource: "jupiter" };
      } catch (error) { errors.push({ source: "jupiter-price", code: error instanceof JupiterError ? error.code : error.code ?? "error", message: error.message }); }
    }
    return { at: clock(), tokens, errors };
  }

  /** Candles for each token with a known pool, re-read only when older than CANDLE_TTL_MS. */
  async function readCandles(universe, pairs) {
    const errors = [];
    for (const u of universe) {
      const pool = pairs[u.mint]?.address ?? null;
      if (!pool) continue;
      const have = candles.get(u.mint);
      if (have && have.pool === pool && clock() - have.at < CANDLE_TTL_MS) continue;
      const url = `${GECKOTERMINAL_POOLS_API}${pool}/ohlcv/minute?aggregate=${CANDLE_MINUTES}&limit=${CANDLE_LIMIT}&currency=usd&token=${u.mint}`;
      try { candles.set(u.mint, { at: clock(), pool, list: parseGeckoOhlcv(await getJson(url)) }); }
      catch (error) {
        errors.push({ source: "geckoterminal", mint: u.mint, code: error.code ?? "error", message: error.message });
        if (error.code === "resting" || error.code === "rate_limited") break;    // the host is resting: ask it nothing more this tick
      }
    }
    return errors;
  }

  /**
   * The snapshot the model sees: prices always; indicators when `withCandles` (only when it
   * is about to be asked). Every token lists the figures that are missing, by name.
   */
  async function snapshot(universe, { withCandles = false } = {}) {
    const p = await prices(universe);
    const errors = [...p.errors];
    if (withCandles) errors.push(...await readCandles(universe, Object.fromEntries(universe.map((u) => [u.mint, p.tokens[u.mint].pair]))));
    const tokens = {};
    for (const u of universe) {
      const t = p.tokens[u.mint];
      const c = candles.get(u.mint);
      const ind = c && c.list.length ? indicatorsFrom(c.list) : null;
      const row = { mint: u.mint, symbol: u.symbol, ...t, indicators: ind, candlesAt: c?.at ?? null };
      row.missing = ["priceUsd", "change1hPct", "change24hPct", "volume24hUsd", "liquidityUsd"].filter((k) => row[k] === null);
      if (withCandles && !ind) row.missing.push("indicators");
      if (ind) for (const k of ["rsi14", "ema20", "ema50", "return1hPct", "return4hPct", "return24hPct"]) if (ind[k] === null) row.missing.push(k);
      tokens[u.mint] = row;
    }
    return { at: p.at, tokens, errors };
  }

  function status() {
    const now = clock();
    return {
      hosts: [...hosts.entries()].map(([host, h]) => ({ host, ok: h.ok, errors: h.errors, rateLimited: h.rateLimited, restingForMs: Math.max(0, h.restUntil - now), lastError: h.lastError })),
      candles: [...candles.entries()].map(([mint, c]) => ({ mint, bars: c.list.length, ageMs: now - c.at })),
    };
  }
  return Object.freeze({ prices, snapshot, status });
}
