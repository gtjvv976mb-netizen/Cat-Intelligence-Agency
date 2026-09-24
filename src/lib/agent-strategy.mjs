/**
 * THE AGENT'S SPEC: WHAT THE OWNER WROTE, AND THE LIMITS NOTHING ELSE MAY MOVE.
 *
 * CoinMarketCat's agent trades Solana spot tokens for its owner from a strategy written in
 * plain English. This file is the shape of that agent, and the fence around it:
 *
 *   · A NAME AND A STRATEGY. The strategy is the owner's own words, length-capped, handed
 *     to the model as the strategy to follow. It is not code and it is not a limit: nothing
 *     it says can widen a number below, because the numbers below are read by agent-risk.mjs
 *     and never by the model (agent-brain.mjs shows them to it, read-only).
 *
 *   · A UNIVERSE of at most ten SPL tokens: the "Solana majors" preset, custom mints, or
 *     both. Every preset mint below was read live on 2026-09-24 (see SOLANA_MAJORS_VERIFIED)
 *     and never typed from memory; a custom mint is read on chain by the worker, over the
 *     owner's RPC, before it can be saved, and its decimals and token program come from
 *     that read. SOL ITSELF IS NOT IN v1. Buying SOL through Jupiter delivers wrapped SOL,
 *     and the check before signing (jupiter-swap.mjs) is a port that dropped the executor's
 *     wrapped-SOL branches: a native-SOL leg would mix the position with the SOL that pays
 *     the network fees, and the fill reader refuses exactly that. So the wrapped-SOL mint is
 *     refused by name (`sol_not_in_v1`). JitoSOL, in the preset, is a liquid-staking token
 *     whose price follows SOL's; it is not SOL.
 *
 *   · A SETTLEMENT TOKEN: USDC by default, or USDT. Every buy spends it and every sell
 *     returns it, so every trade is a token-to-token swap — the one kind the existing check
 *     before signing was built and tested for. Both are counted at face value, $1 a unit.
 *
 *   · A SCHEDULE: the model is asked every 15, 30 or 60 minutes. The protections do not
 *     wait for it: stop loss, take profit and the daily drawdown breaker run on the worker's
 *     half-minute alarm, and they run with the model unreachable.
 *
 *   · LIMITS: the most in one token, the most of the vault in tokens, the stop loss, the
 *     take profit, the daily drawdown and what it does when it trips, trades per day, and
 *     the slippage written into every Jupiter instruction. The minimum trade ($10) and the
 *     minimum vault ($50) are CoinMarketCap's Agentic Trading OS numbers and are not dials.
 *
 *   · A MODE: PAPER (the default) fills at Jupiter's quotes and signs nothing; LIVE trades
 *     from the autopilot wallet and arms only with a typed sentence (agentArmSentence) that
 *     names the wallet, the settlement, every limit and every token. Change any of them and
 *     the sentence changes, so a sentence typed for one agent cannot arm another.
 *
 * Nothing here touches the network, chrome.* or a key. `normalizeAgentSpec` is the only
 * way a spec is made: the options page runs it before sending, the worker runs it again
 * before storing, and the runner reads nothing else. It refuses the malformed by name.
 */
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from "../../vendor/executor/token2022.mjs";
import { WSOL } from "./tx.mjs";

export const AGENT_SPEC_VERSION = 1;

/**
 * THE SETTLEMENT TOKENS, each read live on 2026-09-24T19:27Z at slot 450,123,200: the mint
 * account over https://api.mainnet-beta.solana.com (getMultipleAccounts, base64, confirmed)
 * and Jupiter's token API (https://api.jup.ag/tokens/v2/search?query=<mint>) agree on the
 * decimals and the token program. The reads are in fixtures/agent/mints-verified.json and
 * test-agent-strategy.mjs re-derives every field below from those bytes. Both mints carry a
 * live freeze authority held by their issuer; that is said in the UI, not hidden.
 */
export const SETTLEMENT_TOKENS = Object.freeze([
  Object.freeze({ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6, program: TOKEN_PROGRAM }),
  Object.freeze({ mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "USDT", decimals: 6, program: TOKEN_PROGRAM }),
]);
export const DEFAULT_SETTLEMENT_MINT = SETTLEMENT_TOKENS[0].mint;

/**
 * THE "SOLANA MAJORS" PRESET. Each mint was found by symbol on Jupiter's token API, taken
 * only where Jupiter marks it verified with the strict tag, then read back as a mint
 * account on mainnet: owner, decimals and authorities. Read 2026-09-24T19:27Z, slot
 * 450,123,200, recorded in fixtures/agent/mints-verified.json. All eight are classic SPL
 * Token mints (no Token-2022 extensions). JitoSOL keeps a mint authority (its stake pool
 * mints it) and cbBTC keeps a mint and a freeze authority (its issuer's); the rest have
 * neither. The order is the order the popup lists them.
 */
export const SOLANA_MAJORS = Object.freeze([
  ["J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", "JitoSOL", "Jito Staked SOL", 9],
  ["JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", "JUP", "Jupiter", 6],
  ["jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", "JTO", "JITO", 9],
  ["HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", "PYTH", "Pyth Network", 6],
  ["4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", "RAY", "Raydium", 6],
  ["DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "BONK", "Bonk", 5],
  ["EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", "WIF", "dogwifhat", 6],
  ["cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", "cbBTC", "Coinbase Wrapped BTC", 8],
].map(([mint, symbol, name, decimals]) => Object.freeze({ mint, symbol, name, decimals, program: TOKEN_PROGRAM, source: "majors" })));
export const SOLANA_MAJORS_VERIFIED = Object.freeze({
  at: "2026-09-24T19:27Z",
  slot: 450_123_200,
  how: "each mint account read over https://api.mainnet-beta.solana.com (owner, decimals, authorities) and matched to https://api.jup.ag/tokens/v2/search (verified, strict)",
  fixture: "fixtures/agent/mints-verified.json",
});

/** The fences every dial is held inside, and the two numbers that are not dials. */
export const AGENT_BOUNDS = Object.freeze({
  nameMax: 40,
  strategyMax: 4_000,
  universeMax: 10,
  customSymbolMax: 12,
  schedules: Object.freeze([15, 30, 60]),
  minTradeUsd: 10,            // CoinMarketCap's minimum trade; not a dial
  minVaultUsd: 50,            // CoinMarketCap's minimum vault; not a dial
  maxPositionUsd: Object.freeze({ min: 10, max: 1_000_000 }),
  maxExposurePct: Object.freeze({ min: 1, max: 100 }),
  stopLossPct: Object.freeze({ min: 0.5, max: 50 }),
  takeProfitPct: Object.freeze({ min: 0.5, max: 1_000 }),
  maxDailyDrawdownPct: Object.freeze({ min: 0.5, max: 50 }),
  maxTradesPerDay: Object.freeze({ min: 1, max: 96 }),
  slippageBps: Object.freeze({ min: 10, max: 300 }),
  paperVaultUsd: Object.freeze({ min: 50, max: 10_000_000 }),
});
/** A buy whose Jupiter quote moves the price more than this is refused. A sell is never
 *  refused for its impact: an exit that cannot fire for an impact figure is not an exit. */
export const AGENT_MAX_BUY_IMPACT_PCT = 2;
/** The priority fee a swap between the settlement token and a major may carry, in
 *  lamports: written into Jupiter's request as the cap, and the check before signing
 *  refuses a transaction whose compute budget implies more. A swap between majors is not a
 *  race with a launch's insiders; this lands it under ordinary load. */
export const AGENT_PRIORITY_FEE_LAMPORTS = 50_000;
/** SOL the autopilot wallet must hold for network fees and token-account rent before the
 *  live agent arms: a first buy of each token creates its account (2,039,280 lamports of
 *  rent, returned when the sweep closes it), and every swap pays a fee. */
export const AGENT_MIN_SOL_LAMPORTS = 20_000_000n;

export const AGENT_MODES = Object.freeze(["paper", "live"]);
export const DRAWDOWN_ACTIONS = Object.freeze(["stop_entries", "liquidate"]);

export const AGENT_SPEC_DEFAULTS = Object.freeze({
  v: AGENT_SPEC_VERSION,
  name: "",
  strategy: "",
  universe: Object.freeze(SOLANA_MAJORS.map((m) => m.mint)),   // mints; a preset mint by address, a custom one also in `custom`
  custom: Object.freeze([]),                                    // [{ mint, symbol, decimals, program, verifiedAt }] — read on chain by the worker
  settlementMint: DEFAULT_SETTLEMENT_MINT,
  scheduleMinutes: 30,
  maxPositionUsd: 25,
  maxExposurePct: 60,
  stopLossPct: 8,
  takeProfitPct: 15,
  maxDailyDrawdownPct: 5,
  drawdownAction: "stop_entries",
  maxTradesPerDay: 6,
  slippageBps: 100,
  mode: "paper",
  paperVaultUsd: 100,
  model: "",                  // "" = the first model the API lists (it lists newest first), chosen at run time
  liveAck: "",                // the arm sentence, typed
});

export class AgentSpecError extends Error {
  constructor(key, clause, message) { super(message); this.name = "AgentSpecError"; this.key = key; this.clause = clause; }
}

const isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const refuse = (key, clause, message) => { throw new AgentSpecError(key, clause, message); };
const MAJOR_BY_MINT = new Map(SOLANA_MAJORS.map((m) => [m.mint, m]));
const SETTLEMENT_BY_MINT = new Map(SETTLEMENT_TOKENS.map((s) => [s.mint, s]));
/** Control characters, except tab and newline, are stripped from free text. */
const cleanText = (v) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();

function isPublicKey(value) {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  try { return new PublicKey(value).toBase58() === value; } catch { return false; }
}
function numberIn(src, key, bounds, { integer = false } = {}) {
  const raw = src[key];
  if (raw === undefined || raw === null || raw === "") return AGENT_SPEC_DEFAULTS[key];
  const n = Number(raw);
  if (!Number.isFinite(n)) refuse(key, "not_a_number", `${key} must be a number, got ${JSON.stringify(raw)}`);
  if (integer && !Number.isInteger(n)) refuse(key, "not_whole", `${key} must be a whole number, got ${n}`);
  if (n < bounds.min || n > bounds.max) refuse(key, "out_of_range", `${key} must be from ${bounds.min} to ${bounds.max}, got ${n}`);
  return n;
}

/** A custom universe entry as the worker verified it on chain. */
function normalizeCustom(entry, i) {
  const at = `custom[${i}]`;
  if (!isPlainObject(entry)) refuse("custom", "custom_malformed", `${at} is not an object`);
  const mint = String(entry.mint ?? "").trim();
  if (!isPublicKey(mint)) refuse("custom", "mint_malformed", `${at}: "${mint}" is not a mint address`);
  if (mint === WSOL) refuse("custom", "sol_not_in_v1", "SOL (the wrapped-SOL mint) is not in v1: the check before signing handles token-to-token swaps only. JitoSOL, in the preset, follows SOL's price");
  if (SETTLEMENT_BY_MINT.has(mint)) refuse("custom", "settlement_in_universe", `${at}: ${SETTLEMENT_BY_MINT.get(mint).symbol} is a settlement token, not something to trade into`);
  if (MAJOR_BY_MINT.has(mint)) refuse("custom", "custom_is_a_major", `${at}: ${MAJOR_BY_MINT.get(mint).symbol} is in the majors preset; tick it there`);
  const symbol = cleanText(entry.symbol);
  if (!/^[A-Za-z0-9$._-]{1,12}$/.test(symbol)) refuse("custom", "symbol_malformed", `${at}: a symbol is 1 to ${AGENT_BOUNDS.customSymbolMax} letters, digits or $._- (got ${JSON.stringify(symbol)})`);
  const decimals = Number(entry.decimals);
  if (!(Number.isInteger(decimals) && decimals >= 0 && decimals <= 18)) refuse("custom", "custom_unverified", `${at} (${symbol}): its decimals were not read on chain — save it from Options with an RPC set`);
  if (entry.program !== TOKEN_PROGRAM && entry.program !== TOKEN_2022_PROGRAM) refuse("custom", "custom_unverified", `${at} (${symbol}): its token program was not read on chain`);
  const verifiedAt = Number(entry.verifiedAt);
  if (!(Number.isFinite(verifiedAt) && verifiedAt > 0)) refuse("custom", "custom_unverified", `${at} (${symbol}): no record of when it was read on chain`);
  return Object.freeze({ mint, symbol, name: symbol, decimals, program: entry.program, source: "custom", verifiedAt,
    ...(entry.freezeAuthority ? { freezeAuthority: String(entry.freezeAuthority) } : {}), ...(entry.mintAuthority ? { mintAuthority: String(entry.mintAuthority) } : {}) });
}

/**
 * Coerce whatever a form or storage handed over into a spec, refusing the malformed by
 * name (AgentSpecError: key, clause). Unknown keys are dropped. An empty name or strategy
 * is a draft, allowed here and refused at start (agentStartProblems).
 */
export function normalizeAgentSpec(input = {}) {
  const src = isPlainObject(input) ? input : {};
  const out = { ...AGENT_SPEC_DEFAULTS };
  const name = cleanText(src.name ?? "").replace(/\s+/g, " ");
  if (name.length > AGENT_BOUNDS.nameMax) refuse("name", "name_too_long", `the agent's name is at most ${AGENT_BOUNDS.nameMax} characters`);
  if (/["\n]/.test(name)) refuse("name", "name_malformed", "the agent's name may not contain a double quote or a line break");
  out.name = name;
  const strategy = cleanText(src.strategy ?? "");
  if (strategy.length > AGENT_BOUNDS.strategyMax) refuse("strategy", "strategy_too_long", `the strategy is at most ${AGENT_BOUNDS.strategyMax} characters (it is ${strategy.length})`);
  out.strategy = strategy;

  const settlementMint = src.settlementMint === undefined || src.settlementMint === null || src.settlementMint === "" ? DEFAULT_SETTLEMENT_MINT : String(src.settlementMint);
  if (!SETTLEMENT_BY_MINT.has(settlementMint)) refuse("settlementMint", "settlement_unknown", `the settlement token must be one of ${SETTLEMENT_TOKENS.map((s) => s.symbol).join(", ")}`);
  out.settlementMint = settlementMint;

  const custom = src.custom === undefined || src.custom === null ? [] : src.custom;
  if (!Array.isArray(custom)) refuse("custom", "custom_malformed", "custom mints must be a list");
  const customEntries = custom.map(normalizeCustom);
  const customByMint = new Map(customEntries.map((c) => [c.mint, c]));
  if (customByMint.size !== customEntries.length) refuse("custom", "duplicate_mint", "a custom mint is listed twice");

  const universe = src.universe === undefined || src.universe === null ? [...AGENT_SPEC_DEFAULTS.universe] : src.universe;
  if (!Array.isArray(universe)) refuse("universe", "universe_malformed", "the universe must be a list of mint addresses");
  const seen = new Set();
  for (const raw of universe) {
    const mint = String(raw ?? "").trim();
    if (mint === WSOL) refuse("universe", "sol_not_in_v1", "SOL (the wrapped-SOL mint) is not in v1: the check before signing handles token-to-token swaps only. JitoSOL, in the preset, follows SOL's price");
    if (!isPublicKey(mint)) refuse("universe", "mint_malformed", `"${mint}" is not a mint address`);
    if (SETTLEMENT_BY_MINT.has(mint)) refuse("universe", "settlement_in_universe", `${SETTLEMENT_BY_MINT.get(mint).symbol} is a settlement token, not something to trade into`);
    if (!MAJOR_BY_MINT.has(mint) && !customByMint.has(mint)) refuse("universe", "mint_unverified", `${mint} is neither in the majors preset nor a custom mint read on chain`);
    if (seen.has(mint)) refuse("universe", "duplicate_mint", `${mint} is listed twice`);
    seen.add(mint);
  }
  /* Every custom mint the owner kept is in the universe; a custom row not ticked is dropped. */
  for (const c of customEntries) if (!seen.has(c.mint)) seen.add(c.mint);
  if (seen.size > AGENT_BOUNDS.universeMax) refuse("universe", "universe_too_big", `the universe is at most ${AGENT_BOUNDS.universeMax} tokens (it has ${seen.size})`);
  out.universe = Object.freeze([...seen]);
  out.custom = Object.freeze(customEntries);

  const schedule = src.scheduleMinutes === undefined || src.scheduleMinutes === null || src.scheduleMinutes === "" ? AGENT_SPEC_DEFAULTS.scheduleMinutes : Number(src.scheduleMinutes);
  if (!AGENT_BOUNDS.schedules.includes(schedule)) refuse("scheduleMinutes", "schedule_unknown", `the agent runs every ${AGENT_BOUNDS.schedules.join(", ")} minutes; got ${JSON.stringify(src.scheduleMinutes)}`);
  out.scheduleMinutes = schedule;

  out.maxPositionUsd = numberIn(src, "maxPositionUsd", AGENT_BOUNDS.maxPositionUsd);
  out.maxExposurePct = numberIn(src, "maxExposurePct", AGENT_BOUNDS.maxExposurePct);
  out.stopLossPct = numberIn(src, "stopLossPct", AGENT_BOUNDS.stopLossPct);
  out.takeProfitPct = numberIn(src, "takeProfitPct", AGENT_BOUNDS.takeProfitPct);
  out.maxDailyDrawdownPct = numberIn(src, "maxDailyDrawdownPct", AGENT_BOUNDS.maxDailyDrawdownPct);
  out.maxTradesPerDay = numberIn(src, "maxTradesPerDay", AGENT_BOUNDS.maxTradesPerDay, { integer: true });
  out.slippageBps = numberIn(src, "slippageBps", AGENT_BOUNDS.slippageBps, { integer: true });
  out.paperVaultUsd = numberIn(src, "paperVaultUsd", AGENT_BOUNDS.paperVaultUsd);

  const drawdownAction = src.drawdownAction === undefined || src.drawdownAction === null || src.drawdownAction === "" ? AGENT_SPEC_DEFAULTS.drawdownAction : String(src.drawdownAction);
  if (!DRAWDOWN_ACTIONS.includes(drawdownAction)) refuse("drawdownAction", "drawdown_action_unknown", `when the daily drawdown trips the agent must ${DRAWDOWN_ACTIONS.join(" or ")}`);
  out.drawdownAction = drawdownAction;
  const mode = src.mode === undefined || src.mode === null || src.mode === "" ? "paper" : String(src.mode);
  if (!AGENT_MODES.includes(mode)) refuse("mode", "mode_unknown", `the mode is ${AGENT_MODES.join(" or ")}`);
  out.mode = mode;

  const model = cleanText(src.model ?? "");
  if (model && !/^[A-Za-z0-9._:@/-]{1,120}$/.test(model)) refuse("model", "model_malformed", "a model id is letters, digits and ._:@/- only");
  out.model = model;
  out.liveAck = typeof src.liveAck === "string" ? src.liveAck.trim() : "";
  return Object.freeze(out);
}

/** The universe as entries — symbol, decimals, program — in the spec's order. */
export function universeEntries(spec) {
  const custom = new Map((spec.custom ?? []).map((c) => [c.mint, c]));
  return Object.freeze((spec.universe ?? []).map((mint) => MAJOR_BY_MINT.get(mint) ?? custom.get(mint)).filter(Boolean));
}
export function settlementFor(spec) { return SETTLEMENT_BY_MINT.get(spec.settlementMint) ?? SETTLEMENT_TOKENS[0]; }
export const majorFor = (mint) => MAJOR_BY_MINT.get(mint) ?? null;
export const settlementByMint = (mint) => SETTLEMENT_BY_MINT.get(mint) ?? null;

/**
 * THE PAIRS A SWAP MAY BE: the settlement token into a universe token (a buy) and back (a
 * sell), and nothing else. jupiter-swap.mjs's checkSwapTransaction refuses any other pair
 * at `pair_not_allowed`, so neither the model nor Jupiter can route the vault anywhere the
 * owner did not list.
 */
export function allowedPairsFor(spec) {
  const s = spec.settlementMint;
  return Object.freeze((spec.universe ?? []).flatMap((m) => [`${s}>${m}`, `${m}>${s}`]));
}

/** What keeps a spec from starting, in words. Empty means it may start (in paper). */
export function agentStartProblems(spec) {
  const out = [];
  if (!spec.name) out.push({ name: "name", detail: "name the agent" });
  if (spec.strategy.length < 20) out.push({ name: "strategy", detail: "describe the strategy in plain English (at least 20 characters)" });
  if (!spec.universe.length) out.push({ name: "universe", detail: "choose at least one token for its universe" });
  if (spec.maxPositionUsd < AGENT_BOUNDS.minTradeUsd) out.push({ name: "maxPositionUsd", detail: `the per-token cap is under the $${AGENT_BOUNDS.minTradeUsd} minimum trade` });
  return out;
}

const money = (n) => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
/**
 * THE ARM SENTENCE FOR A LIVE AGENT. It names the agent, the autopilot wallet that signs,
 * the settlement token, every limit, and every token in the universe (a custom one with its
 * mint address), and ends in the words the autopilot clause uses for the sniper lane: nothing
 * asks before it signs. The worker compares what was typed byte for byte.
 */
export function agentArmSentence(spec, wallet) {
  const settlement = settlementFor(spec);
  const tokens = universeEntries(spec).map((t) => (t.source === "custom" ? `${t.symbol} (${t.mint})` : t.symbol)).join(", ");
  const trip = spec.drawdownAction === "liquidate" ? "sells everything" : "stops new buys";
  return `I arm the CoinMarketCat agent "${spec.name}" for ${wallet}: settled in ${settlement.symbol}, ` +
    `at most ${money(spec.maxPositionUsd)} in one token and ${spec.maxExposurePct}% of the vault in tokens, ` +
    `a ${spec.stopLossPct}% stop loss, a ${spec.takeProfitPct}% take profit, a ${spec.maxDailyDrawdownPct}% daily drawdown that ${trip}, ` +
    `${spec.maxTradesPerDay} trades a day at ${spec.slippageBps} bps slippage, in ${tokens}` +
    " — signed without asking me, by the autopilot key this browser holds";
}

/**
 * WHAT IS NOT MEASURED, IN WORDS THE UI PRINTS. The agent is new: nothing about what it
 * returns has been measured, on paper or live, and nothing here claims otherwise.
 */
export const AGENT_UNMEASURED = "Nothing about this agent's returns has been measured: no win rate, no return, no drawdown " +
  "from a real run. Paper fills are Jupiter's quotes, not trades. The model decides from a snapshot of prices and a few " +
  "indicators; nothing shows that it decides well. Run it on paper first, and fund live only what you can lose.";
export const AGENT_RUNS_WHERE = "It runs while Chrome is open on this computer: the protections check every half minute and the " +
  "model is asked on your schedule, from this browser. Close Chrome, or put the computer to sleep, and nothing runs — not the " +
  "model, not the stop loss. It is spot only, with no leverage. Every model call is billed to your own API key.";
