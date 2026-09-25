/**
 * THE FOUR STRATEGIES, EACH ON RECORDED OR SCRIPTED MARKETS.
 *
 *   · crying-cat-safe: Jupiter's verified list as read on 2026-09-25 (the 60 deepest tokens) —
 *     only deep, organic, authority-free tokens that are not stablecoins, liquid staking or
 *     stocks; the entry rule on JUP's recorded fifteen-minute candles; one buy a tick;
 *   · popcat-scout: pump.fun's listing and the chain as Popcat recorded them — the coin that
 *     passes all twelve checks is bought (through Jupiter: it graduated), the one that fails is
 *     not; the agency's own coins and wallets never queue;
 *   · coinmarketcat: the model is asked on its schedule and only then, chosen at run time from
 *     the key's own list (the ids here are invented), its orders go through the extension's
 *     planOrders and then the runtime's gate; no key or no strategy means it holds;
 *   · snipurr: the executor's snipe gates on a scripted launch — watch, wait, buy only if others
 *     followed; an agency creator's launch is never watched; the determiner's 1.5x take sells.
 */
import fs from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { harness, fixture, scriptedRpc, ROOT } from "./bots/test/doubles.mjs";
import { PUMPFUN_PROGRAM, PUMPFUN_GLOBAL, URLS } from "./bots/lib/verified.mjs";
import { parseGeckoOhlcv, indicatorsFrom } from "./src/lib/agent-market.mjs";
import { SOLANA_MAJORS } from "./src/lib/agent-strategy.mjs";
import { createBrain } from "./src/lib/agent-brain.mjs";
import * as safe from "./services/hq/strategies/crying-cat-safe.mjs";
import * as scout from "./services/hq/strategies/popcat-scout.mjs";
import * as cmc from "./services/hq/strategies/coinmarketcat.mjs";
import * as snipurr from "./services/hq/strategies/snipurr.mjs";
import { STRATEGIES, STRATEGY_IDS, normalizeSettingsFor } from "./services/hq/strategies/index.mjs";
import { ENUMS } from "./services/hq/contract/schemas.mjs";
import { PUMPFUN_VENUE, BONDING_CURVE_DISCRIMINATOR, GLOBAL_DISCRIMINATOR } from "./vendor/executor/snipe-venue-pumpfun.mjs";
import { hqFixture, addr, testClock } from "./services/hq/test/doubles.mjs";
import { parseSol } from "./services/hq/lib/amounts.mjs";

const { ok, section, done } = harness("test-hq-strategies");
const WSOL = "So11111111111111111111111111111111111111112";
const noEx = () => ({ mints: new Set(), creators: new Set() });

/** A strategy's context, with spies for what it asks the runtime to do. */
function ctxFor({ agent, deps = {}, positions = [], buyAnswer = () => ({ ok: true }), exclusions = noEx, kill = false, state = null } = {}) {
  const buys = [], sells = [], decisions = [];
  let st = state;
  return {
    buys, sells, decisions,
    ctx: {
      agent, deps: { clock: () => Date.parse("2026-09-25T12:00:00Z"), symbolOf: () => null, ...deps }, db: null,
      view: () => ({ ledger: { positions, cash: parseSol("1"), portfolio: parseSol("1") }, day: { tripped: false } }),
      buy: async (p) => { buys.push(p); return buyAnswer(p, buys.length); },
      sell: async (mint, o) => { sells.push({ mint, ...o }); return { ok: true }; },
      decide: (d) => { decisions.push(d); return d; },
      exclusions, killOn: () => kill, maxPerTradeLamports: () => parseSol(agent.limits.maxPerTradeSol),
      state: { get: () => st, set: (v) => { st = JSON.parse(JSON.stringify(v, (k, x) => (typeof x === "bigint" ? x.toString() : x))); } },
    },
  };
}

section("THE FOUR, AS THE CONTRACT NAMES THEM");
{
  ok("the four strategy ids are the contract's", JSON.stringify(STRATEGY_IDS) === JSON.stringify(ENUMS.strategy));
  ok("each has a sprite in brand/sprites/", STRATEGY_IDS.every((id) => fs.existsSync(path.join(ROOT, "brand", "sprites", `${STRATEGIES[id].sprite}.png`))));
  ok("each validates its own settings and refuses one it does not know", STRATEGY_IDS.every((id) => { try { normalizeSettingsFor(id, { surprise: 1 }, STRATEGIES[id].module.defaults.limits); return false; } catch { return true; } }));
  const texts = STRATEGY_IDS.map((id) => fs.readFileSync(path.join(ROOT, "services", "hq", "strategies", `${id}.mjs`), "utf8"));
  ok("no strategy imports the executor, the wallet or a signer: they propose, the runtime disposes", texts.every((t) => !/execution\.mjs|wallet\.mjs|signAs|sendTransaction|createExecutor/.test(t)));
}

section("CRYING CAT (crying-cat-safe): THE VERIFIED LIST, RECORDED");
{
  const V = hqFixture("jupiter-verified-deep.json");
  const settings = safe.normalizeSettings({});
  const cands = safe.candidatesFrom(V.tokens, { settings });
  ok(`from the ${V.tokens.length} deepest verified tokens, ${cands.length} pass (${cands.map((c) => c.symbol).join(", ")})`, cands.length >= 3 && cands.length <= settings.candidates);
  const byId = new Map(V.tokens.map((t) => [t.id, t]));
  ok("every candidate: ≥ 5,000,000 USD of liquidity, organic score high, mint and freeze authority disabled", cands.every((c) => { const t = byId.get(c.mint); return Number(t.liquidity) >= 5_000_000 && t.organicScoreLabel === "high" && t.audit?.mintAuthorityDisabled === true && t.audit?.freezeAuthorityDisabled === true; }));
  ok("no stablecoin, liquid-staking SOL, stock or real-world asset; not SOL itself", cands.every((c) => { const t = byId.get(c.mint); return c.mint !== WSOL && !(t.tags ?? []).some((x) => safe.EXCLUDED_TAGS.includes(x)); }));
  const usdc = V.tokens.find((t) => t.symbol === "USDC");
  ok("USDC, the deepest of all, is not a candidate", usdc && !cands.some((c) => c.mint === usdc.id));
  ok("deepest first", cands.every((c, i) => i === 0 || c.liquidityUsd <= cands[i - 1].liquidityUsd));
  ok("an excluded mint (an agency coin) is never a candidate", !safe.candidatesFrom(V.tokens, { settings, exclude: new Set([cands[0].mint]) }).some((c) => c.mint === cands[0].mint));
  ok("the owner may not set 'deep' under 1,000,000 USD", (() => { try { safe.normalizeSettings({ minLiquidityUsd: 999_999 }); return false; } catch { return true; } })());

  const G = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "agent", "geckoterminal-ohlcv-jup-15m.json"), "utf8"));
  const ind = indicatorsFrom(parseGeckoOhlcv(G.body));
  const sig = safe.entrySignal({ indicators: ind });
  ok(`JUP's recorded candles: EMA20 ${ind.ema20.toFixed(4)} over EMA50 ${ind.ema50.toFixed(4)}, RSI ${ind.rsi14}, ${ind.return24hPct}% over 24 h — the rule enters`, sig.enter === true);
  ok("…RSI over 65: it does not", safe.entrySignal({ indicators: { ...ind, rsi14: 71 } }).enter === false);
  ok("…down over the last hour: it does not", safe.entrySignal({ indicators: { ...ind, return1hPct: -0.2 } }).enter === false);
  ok("…EMA20 under EMA50: it does not, and the exit fires", safe.entrySignal({ indicators: { ...ind, ema20: ind.ema50 * 0.99 } }).enter === false && safe.exitSignal({ indicators: { ...ind, ema20: ind.ema50 * 0.99 } }).exit === true);
  ok("…no candles: it does not", safe.entrySignal({ indicators: null }).enter === false);

  const agent = { id: 1, settings: {}, limits: safe.defaults.limits };
  const snapshot = async (u) => ({ tokens: Object.fromEntries(u.map((x) => [x.mint, { indicators: ind }])) });
  let run = ctxFor({ agent, deps: { verifiedList: async () => V.tokens, market: { snapshot } } });
  await safe.tick(run.ctx);
  ok("a tick where every candidate enters: one buy, the deepest, sized at the max per trade, through Jupiter", run.buys.length === 1 && run.buys[0].mint === cands[0].mint && run.buys[0].askedLamports === parseSol("0.05") && run.buys[0].venue === "jupiter");
  run = ctxFor({ agent, deps: { verifiedList: async () => V.tokens, market: { snapshot } }, buyAnswer: (p, n) => (n === 1 ? { ok: false, clause: "rug_check" } : { ok: true }) });
  await safe.tick(run.ctx);
  ok("…the first refused by the rug check: the next candidate is tried, and that is the tick's one buy", run.buys.length === 2 && run.buys[1].mint === cands[1].mint);
  run = ctxFor({ agent, deps: { verifiedList: async () => V.tokens, market: { snapshot: async (u) => ({ tokens: Object.fromEntries(u.map((x) => [x.mint, { indicators: { ...ind, rsi14: 80 } }])) }) } } });
  await safe.tick(run.ctx);
  ok("…none meets the rule: no buy, one hold that says why", run.buys.length === 0 && run.decisions.length === 1 && /RSI 80/.test(run.decisions[0].reason));
  run = ctxFor({ agent, deps: { verifiedList: async () => { throw new Error("HTTP 503"); }, market: { snapshot } } });
  await safe.tick(run.ctx);
  ok("…the verified list unreadable: nothing is bought without it", run.buys.length === 0 && /could not be read/.test(run.decisions[0].reason));
  run = ctxFor({ agent, deps: { verifiedList: async () => V.tokens, market: { snapshot } }, positions: [{ mint: cands[0].mint }] });
  await safe.tick(run.ctx);
  ok("…a coin already held is skipped", run.buys[0].mint === cands[1].mint);
}

section("POPCAT (popcat-scout): THE LISTING AND THE CHAIN, AS POPCAT RECORDED THEM");
{
  const snaps = fixture("popcat/snapshots.json").snapshots;
  const acc = (a) => ({ owner: a.owner, lamports: a.lamports ?? 1, data: [a.dataBase64, "base64"] });
  const encodeHolder = (h) => { const b = Buffer.alloc(40); new PublicKey(h.owner).toBuffer().copy(b); b.writeBigUInt64LE(BigInt(h.amount), 32); return { pubkey: h.account, account: { data: [b.toString("base64"), "base64"] } }; };
  const byMint = Object.fromEntries(snaps.map((s) => [s.apiRow.mint, s]));
  const rpc = scriptedRpc({
    getMultipleAccounts: ([list]) => ({ value: list.map((k) => { if (k === PUMPFUN_GLOBAL) return acc({ owner: PUMPFUN_PROGRAM, dataBase64: fixture("pumpfun/global.json").dataBase64 }); const s = byMint[k] ?? snaps.find((x) => x.apiRow.bonding_curve === k); return !s ? null : byMint[k] ? acc(s.mintAccount) : acc(s.curveAccount); }) }),
    getProgramAccounts: ([, opts]) => (byMint[opts.filters[0].memcmp.bytes]?.holders.list ?? []).map(encodeHolder),
    getSignaturesForAddress: ([a]) => { const s = snaps.find((x) => x.apiRow.bonding_curve === a); return s ? [...s.creation.sameSlotBuyers.map((b, i) => ({ signature: `same${i}`, slot: s.creation.createSlot })), { signature: s.creation.createSig, slot: s.creation.createSlot, blockTime: s.creation.createTime }] : []; },
    getTransaction: ([sig]) => ({ transaction: { message: { accountKeys: [snaps[0].creation.sameSlotBuyers[Number(String(sig).replace("same", ""))]] } } }),
  });
  const notCat = { ...snaps[0].apiRow, mint: WSOL, name: "Wrapped Doge", symbol: "WDOGE", description: "not a cat", bonding_curve: addr(70) };
  const descOnly = { ...snaps[0].apiRow, mint: addr(71), name: "Moon Rocket", symbol: "MOON", description: "a cat coin, really", bonding_curve: addr(72) };
  const http = { json: async (url) => {
    if (url.startsWith("https://frontend-api-v3.pump.fun/coins?")) return url.includes("offset=0") ? [...snaps.map((s) => s.apiRow), notCat, descOnly] : [];
    const created = snaps.find((s) => url === URLS.pumpCreatedCoins(s.apiRow.creator));
    if (created) return { count: created.creatorLaunchCount };
    const meta = snaps.find((s) => s.apiRow.metadata_uri && url.endsWith(s.apiRow.metadata_uri.split("/ipfs/")[1] ?? "~"));
    if (meta && !meta.metadata.unreadable) return meta.metadata;
    throw Object.assign(new Error("HTTP 404"), { clause: "http_404" });
  } };
  const agent = { id: 2, settings: {}, limits: scout.defaults.limits };
  const at = Date.parse(snaps[0].read);
  const run = ctxFor({ agent, deps: { http, botsRpc: rpc, clock: () => at } });
  await scout.tick(run.ctx);
  ok(`${snaps[0].apiRow.name.trim()} passes all twelve checks as recorded: bought, and only it`, run.buys.length === 1 && run.buys[0].mint === snaps[0].apiRow.mint, JSON.stringify(run.decisions));
  ok("…through Jupiter, because its curve graduated; small: the 0.01 SOL default", run.buys[0].venue === "jupiter" && run.buys[0].askedLamports === parseSol("0.01"));
  ok("…with the reason in words: every check passed, its holders and curve", /every one of Popcat's twelve checks passed/.test(run.buys[0].reason));
  ok("a coin that is a cat only in its description is never queued; nor one that is no cat", !rpc.calls.some((c) => c.method === "getProgramAccounts" && [WSOL, addr(71)].includes(c.params[1].filters[0].memcmp.bytes)));
  const q = scout.queueable(snaps.map((s) => ({ ...s.apiRow, mint: s.apiRow.mint, creator: s.apiRow.creator, curve: s.apiRow.bonding_curve, name: s.apiRow.name, symbol: s.apiRow.symbol, description: s.apiRow.description ?? "", createdMs: Number(s.apiRow.created_timestamp), metadataUri: s.apiRow.metadata_uri })),
    { now: at, known: new Set(), exclude: { mints: new Set([snaps[0].apiRow.mint]), creators: new Set([snaps[1].apiRow.creator]) } });
  ok("an agency coin, or a coin by an agency wallet, never joins the queue", q.length === 0);
  const later = ctxFor({ agent, deps: { http, botsRpc: rpc, clock: () => at + 16 * 60_000 }, state: run.ctx.state.get() });
  await later.ctx.state.set(run.ctx.state.get());
  await scout.tick(later.ctx);
  const cosmic = snaps[1];
  const checkedCosmic = rpc.calls.some((c) => c.method === "getProgramAccounts" && c.params[1].filters[0].memcmp.bytes === cosmic.apiRow.mint);
  ok(`${cosmic.apiRow.name.trim()} waits in the queue until it is 15 minutes old, is then checked, fails (top ten, curve), and is not bought — said so on the desk`,
    checkedCosmic && later.buys.length === 0 && later.decisions.some((d) => /none passed every check.*top10_share/.test(d.reason)), JSON.stringify(later.decisions));
}

section("COINMARKETCAT: THE MODEL ON ITS SCHEDULE, THE LIMITS IN CODE");
{
  const JUP = SOLANA_MAJORS.find((m) => m.symbol === "JUP")?.mint ?? SOLANA_MAJORS[0].mint;
  const settings = { strategy: "Buy JUP when it trends up; sell half on strength.", universe: [JUP], scheduleMinutes: 30, maxTradesPerDay: 6, maxExposurePct: 60 };
  const agent = { id: 4, name: "Agent Market", mode: "paper", status: "active", settings, limits: cmc.defaults.limits };
  const snapshot = async (u) => ({ tokens: Object.fromEntries(u.map((x) => [x.mint, { priceUsd: x.mint === WSOL ? 200 : 0.5, indicators: null, missing: [] }])) });
  const asked = [];
  const brain = { decide: async (a) => { asked.push(a); return { decision: { rationale: "trend is up", actions: [{ action: "buy", mint: JUP, usd: 50, confidence: 0.7, reason: "uptrend" }], rejected: [] } }; } };
  let now = Date.parse("2026-09-25T12:00:00Z");
  const run = ctxFor({ agent, deps: { brain, market: { snapshot }, clock: () => now, model: "" } });
  await cmc.tick(run.ctx);
  ok("the model is asked once, with the owner's words and the limits as numbers", asked.length === 1 && asked[0].spec.strategy === settings.strategy && asked[0].context.limits.maxPerTradeSol === "0.1");
  ok("its $50 buy is held by the extension's planOrders to the per-token cap ($20: 0.1 SOL at $200), then handed to the runtime's gate in SOL", run.buys.length === 1 && run.buys[0].askedLamports === parseSol("0.1") && run.buys[0].venue === "jupiter" && run.buys[0].mint === JUP, String(run.buys[0]?.askedLamports));
  now += 60_000;
  await cmc.tick(run.ctx);
  ok("a minute later, inside its 30-minute schedule: not asked again (the turn was written down before the call)", asked.length === 1);
  now += 30 * 60_000;
  await cmc.tick(run.ctx);
  ok("thirty minutes on: asked again", asked.length === 2);

  const huge = { decide: async () => ({ decision: { rationale: "all in", actions: [{ action: "buy", mint: JUP, usd: 1_000_000, confidence: 1, reason: "yolo" }], rejected: [] } }) };
  const r2 = ctxFor({ agent, deps: { brain: huge, market: { snapshot }, clock: () => now, model: "" } });
  await cmc.tick(r2.ctx);
  ok("a model that asks for $1,000,000: the extension's planOrders holds it to the per-token cap first", r2.buys.length === 1 && r2.buys[0].askedLamports <= parseSol("0.1") + 1n, String(r2.buys[0]?.askedLamports));
  const failing = { decide: async () => { throw Object.assign(new Error("overloaded"), { clause: "overloaded" }); } };
  const r3 = ctxFor({ agent, deps: { brain: failing, market: { snapshot }, clock: () => now, model: "" } });
  await cmc.tick(r3.ctx);
  ok("the model failing: no entry, a hold that says so", r3.buys.length === 0 && /the model's turn failed/.test(r3.decisions[0].reason));
  const r4 = ctxFor({ agent, deps: { brain: null, market: { snapshot }, clock: () => now } });
  await cmc.tick(r4.ctx);
  ok("no ANTHROPIC_API_KEY on the server: the model is never asked, it holds", r4.buys.length === 0 && /no ANTHROPIC_API_KEY/.test(r4.decisions[0].reason));
  const r5 = ctxFor({ agent: { ...agent, settings: { ...settings, strategy: "" } }, deps: { brain, market: { snapshot }, clock: () => now } });
  const before = asked.length;
  await cmc.tick(r5.ctx);
  ok("no strategy written: the model is not asked", asked.length === before && /no strategy/.test(r5.decisions[0].reason));
  const r6 = ctxFor({ agent, deps: { brain, market: { snapshot }, clock: () => now, model: "" }, kill: true });
  await cmc.tick(r6.ctx);
  ok("under the kill switch its buys are refused by the extension's own planOrders (paused)", r6.buys.length === 0 && r6.decisions.some((d) => /refused \(paused\)/.test(d.reason)));

  /* The model chosen at run time, from the key's own list: the real brain on a scripted API. */
  const sent = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith("/v1/models?limit=100")) return new Response(JSON.stringify({ data: [{ id: "catbrain-newest", display_name: "Newest" }, { id: "catbrain-older", display_name: "Older" }] }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.endsWith("/v1/messages")) {
      const body = JSON.parse(init.body);
      sent.push({ model: body.model, key: init.headers?.["x-api-key"] });
      return new Response(JSON.stringify({ id: "msg_1", model: body.model, stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 10 },
        content: [{ type: "tool_use", id: "t1", name: body.tools[0].name, input: { rationale: "flat market", actions: [{ action: "hold", mint: JUP, confidence: 0.5, reason: "nothing to do" }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("no", { status: 404 });
  };
  const real = createBrain({ fetchImpl, apiKey: async () => "test-key-not-real" });
  const r7 = ctxFor({ agent, deps: { brain: real, market: { snapshot }, clock: () => now, model: "" } });
  await cmc.tick(r7.ctx);
  ok("with no HQ_MODEL, the first model the key lists is used — found at run time, written nowhere", sent.length === 1 && sent[0].model === "catbrain-newest");
  const r8 = ctxFor({ agent, deps: { brain: real, market: { snapshot }, clock: () => now, model: "catbrain-older" } });
  await cmc.tick(r8.ctx);
  ok("with HQ_MODEL set to a listed model, that one", sent.length === 2 && sent[1].model === "catbrain-older");
  ok("the model's hold is on the desk in its words", r8.decisions.some((d) => /nothing to do|flat market/.test(d.reason)));
}

section("SNIPURR: THE EXECUTOR'S GATES ON A SCRIPTED LAUNCH");
{
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
  const key = (k) => new PublicKey(k).toBuffer();
  const creator = addr(28), fee = addr(29), bb = addr(30);
  const curveAcc = ({ vBase, vQuote, realBase, realQuote, complete = false }) => { const b = Buffer.alloc(115); Buffer.from(BONDING_CURVE_DISCRIMINATOR, "hex").copy(b, 0); u64(vBase).copy(b, 8); u64(vQuote).copy(b, 16); u64(realBase).copy(b, 24); u64(realQuote).copy(b, 32); u64(1_000_000_000_000_000n).copy(b, 40); b[48] = complete ? 1 : 0; key(creator).copy(b, 49); return { data: [b.toString("base64"), "base64"], owner: PUMPFUN_PROGRAM, lamports: 1_500_000 }; };
  const globalAcc = () => { const b = Buffer.alloc(1_000); Buffer.from(GLOBAL_DISCRIMINATOR, "hex").copy(b, 0); b[8] = 1; key(fee).copy(b, 41); for (let i = 0; i < 7; i++) key(fee).copy(b, 162 + i * 32); key(fee).copy(b, 483); for (let i = 0; i < 7; i++) key(fee).copy(b, 516 + i * 32); for (let i = 0; i < 8; i++) key(bb).copy(b, 741 + i * 32); return { data: [b.toString("base64"), "base64"], owner: PUMPFUN_PROGRAM, lamports: 1 }; };
  const mintAcc = () => { const b = Buffer.alloc(82); b[44] = 6; b[45] = 1; u64(1_000_000_000_000_000n).copy(b, 36); return { data: [b.toString("base64"), "base64"], owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", lamports: 1 }; };
  const EARLY = { vQuote: 30_500_000_000n, vBase: 1_055_000_000_000_000n, realBase: 775_100_000_000_000n, realQuote: 500_000_000n };
  const FOLLOWED = { vQuote: 33_000_000_000n, vBase: 975_000_000_000_000n, realBase: 695_100_000_000_000n, realQuote: 3_000_000_000n };
  const DUMPED = { vQuote: 30_050_000_000n, vBase: 1_071_000_000_000_000n, realBase: 791_100_000_000_000n, realQuote: 50_000_000n };
  const PUMPED = { vQuote: 45_000_000_000n, vBase: 715_000_000_000_000n, realBase: 435_100_000_000_000n, realQuote: 15_000_000_000n };
  const world = ({ agentId, mint, settings = { requireSocials: false }, exclusions = noEx }) => {
    let now = Date.parse("2026-09-25T12:00:00Z");
    let curve = EARLY;
    const read = () => ({ slot: 400_000_000, accounts: [curveAcc(curve), globalAcc(), mintAcc()] });
    const agent = { id: agentId, wallet: addr(100 + agentId), mode: "paper", status: "active", limits: snipurr.defaults.limits, settings };
    const run = ctxFor({ agent, deps: { clock: () => now, rpc: { getMultipleAccounts: async () => read() } }, exclusions });
    const shared = { read: async () => read(), curve: (r) => PUMPFUN_VENUE.curveFromAccount(r.accounts[0], { feeBps: Number(PUMPFUN_VENUE.feeObservation?.totalFeeBps), mint }), socials: async () => null, socialsResult: null };
    return { run, shared, agent, set: (c) => { curve = c; }, advance: (ms) => { now += ms; }, now: () => now,
      notice: () => snipurr.onNotice(run.ctx, { mint, creator, slot: 400_000_000, noticeAt: now, source: "logsSubscribe", raw: { name: "Test Cat", symbol: "TCAT" } }, shared) };
  };
  snipurr.resetLanes();
  const w1 = world({ agentId: 31, mint: addr(41) });
  await w1.notice();
  ok("a fresh launch that clears every entry gate is watched, not bought", snipurr.laneStatus(31).watches === 1 && w1.run.buys.length === 0);
  w1.advance(5_000); await snipurr.tick(w1.run.ctx);
  ok("…nothing happens before the 10-second wait", w1.run.buys.length === 0 && snipurr.laneStatus(31).watches === 1);
  w1.set(FOLLOWED); w1.advance(6_000); await snipurr.tick(w1.run.ctx);
  const b = w1.run.buys[0];
  ok("after the wait, others followed (the would-have fill marks above 1.0x): re-gated with the instruction this wallet would sign, then handed to the runtime", w1.run.buys.length === 1 && b.venue === "pumpfun" && b.creator === creator && /others followed/.test(b.reason));
  ok("…at the max per trade, with the curve plan and the determiner's position for the exits", b.askedLamports === parseSol("0.01") && typeof b.plan === "function" && b.state?.snipe && b.state.creator === creator);
  ok("…the notice a second time is not watched again", await (async () => { await w1.notice(); return snipurr.laneStatus(31).watches === 0; })());

  const w2 = world({ agentId: 32, mint: addr(42) });
  await w2.notice();
  w2.set(DUMPED); w2.advance(11_000); await snipurr.tick(w2.run.ctx);
  ok("nobody followed (the fill would mark under 1.0x after the wait): not bought, and the desk says why", w2.run.buys.length === 0 && /nobody followed/.test(w2.run.decisions[0]?.reason ?? ""));

  const w3 = world({ agentId: 33, mint: addr(43), exclusions: () => ({ mints: new Set(), creators: new Set([creator]) }) });
  await w3.notice();
  ok("a launch by an agency wallet is never watched", snipurr.laneStatus(33).watches === 0 && snipurr.laneStatus(33).counts.agency_coin === 1);

  const w4 = world({ agentId: 34, mint: addr(44) });
  w4.run.ctx.killOn = () => true;
  await w4.notice();
  ok("under the kill switch the gates refuse every entry", snipurr.laneStatus(34).watches === 0);

  const w5 = world({ agentId: 35, mint: addr(45), settings: { requireSocials: true } });
  await w5.notice();
  ok("with socials required (the default), a launch without a readable link is refused by the gate", snipurr.laneStatus(35).watches === 0 && Object.keys(snipurr.laneStatus(35).counts).length === 1);

  /* The exits: the executor's determiner on the held position. */
  const held = [{ mint: addr(41), qty: 0n, cost: 0n }];
  const states = new Map([[addr(41), { ...b.state, entryInputLamports: "10000000" }]]);
  const plan = await b.plan(parseSol("0.01"));
  held[0].qty = BigInt(plan.baseOutRaw); held[0].cost = BigInt(plan.maxQuoteInRaw);
  const exitCtx = { ...w1.run.ctx, db: { getPositionState: (id, mode, m) => states.get(m), setPositionState: (id, mode, m, s) => states.set(m, s) } };
  w1.set(FOLLOWED); w1.advance(5_000);
  const quiet = await snipurr.exits(exitCtx, { ledger: { positions: held } });
  ok("held, marking about where it was bought: no exit", quiet.length === 0);
  w1.set(PUMPED); w1.advance(5_000);
  const out = await snipurr.exits(exitCtx, { ledger: { positions: held } });
  ok("the curve runs past 1.5x of the entry: the determiner's take sells it", out.length === 1 && out[0].mint === addr(41), JSON.stringify(out));
  ok("settings are the extension lane's own dials, validated by its normalizeConfig", (() => { try { snipurr.normalizeSettings({ entryWaitMs: -5 }); return false; } catch { return true; } })() && snipurr.laneConfig({ settings: snipurr.normalizeSettings({}), limits: snipurr.defaults.limits, lane: "observe" }).config.maxSolPerTrade === 0.01);
}

done();
