/**
 * THE BROWSER LANE'S DIALS, AND THE CHECKLIST THAT ARMS THEM.
 *
 * Every number the entry contract and the exit determiner read is the executor's own —
 * SNIPE_LANE_DEFAULTS from executor/snipe-lane.mjs, imported, never retyped. What this
 * file adds is the handful of dials a browser lane has that a Node process does not: an
 * RPC the user pastes, how long a Phantom approval window may sit open, and how often to
 * ask again for a sell the user has not yet approved.
 *
 * ARMING IS A SENTENCE, AS IT IS ON WALL-ST-E. `snipeArmSentence(wallet, size, cap)` is
 * imported from the lane and compared byte for byte against what the user typed, for the
 * wallet Phantom actually connected. The numbers were typed by a person beside the wallet
 * they bind; a config that was pasted from somewhere cannot arm itself.
 *
 * STOCK QUOTES. pump.fun "Custom Pairs" let a launch be quoted in a token instead of SOL;
 * the ones this lane can be told to pay in are tokenised stocks (xStocks such as GLDx,
 * TSLAx, SPYx). `quoteMints` is the user's list of them, each with its own ticket, day
 * cap and minimum in THAT token's units. Empty — the default — means SOL only, exactly as
 * before. A listed mint is what the lane hands the executor as `quoteMintAllowlist`, and
 * the arm sentence names every listed mint and number, so a sentence typed for SOL alone
 * can never arm a stock trade.
 */
import { PublicKey } from "@solana/web3.js";
import {
  SNIPE_LANE_DEFAULTS, SNIPE_OPERATOR_MAX, SNIPE_LANE_MODES,
  snipeArmSentence, effectiveLaneConfig, armabilityReport,
} from "../../vendor/executor/snipe-lane.mjs";
import { SNIPE_DEFAULTS as POLICY_DEFAULTS } from "../../vendor/executor/snipe-policy.mjs";
import { PUMPFUN_VENUE } from "../../vendor/executor/snipe-venue-pumpfun.mjs";
import { WSOL, unitsToRaw } from "./tx.mjs";

export const HAWK_BROWSER_VERSION = "coinmarketcat-v1";
export const LANE_MODES = SNIPE_LANE_MODES;
export { SNIPE_OPERATOR_MAX, snipeArmSentence };

/** The canary: the size the lane's defaults were derived for. A ticket above it must
 *  carry a stop the operator chose (armabilityReport's stopExplicit). */
export const CANARY_SOL = 0.005;

/**
 * The user-facing config. Keys that exist in SNIPE_LANE_DEFAULTS carry the lane's own
 * default; the rest are browser-only. `null` on a policy dial means "snipe-policy's own
 * default", exactly as it does in the lane.
 */
export const CONFIG_DEFAULTS = Object.freeze({
  /* ── the connection ─────────────────────────────────────────────────────────────── */
  rpcUrl: "",                 // https://… — Helius, Triton, QuickNode; the public RPC 403s browsers
  rpcWsUrl: "",               // wss://… — derived from rpcUrl when blank
  secondaryRpcUrl: "",        // optional second reader; when set, both must agree on the curve
  consoleUrl: "https://gtjvv976mb-netizen.github.io/coinmarketcat/console/",   // the page Phantom lives on; a manifest match, not free text
  /* ── the lane ───────────────────────────────────────────────────────────────────── */
  lane: "off",                // off | observe | execute
  maxSolPerTrade: SNIPE_LANE_DEFAULTS.maxSolPerTrade,
  dailySolCap: SNIPE_LANE_DEFAULTS.dailySolCap,
  maxOpenPositions: 1,        // one Phantom window at a time is the whole point
  /* ── stock quotes (pump.fun Custom Pairs) ──────────────────────────────────────────
     [{ mint, symbol, maxPerTrade, dailyCap, minPerTrade }] in the STOCK's units. Empty =
     SOL only. Decimals are read from the mint account on chain, never typed here. The
     first live buy in each listed stock is sized at its minPerTrade (a canary) until one
     buy in that stock has been read back off the chain — see STOCK_CANARY_RULE. */
  quoteMints: Object.freeze([]),
  requireSocials: SNIPE_LANE_DEFAULTS.requireSocials,
  socialsTimeoutMs: SNIPE_LANE_DEFAULTS.socialsTimeoutMs,
  noticeMaxMs: SNIPE_LANE_DEFAULTS.noticeMaxMs,
  maxPriceImpactPct: SNIPE_LANE_DEFAULTS.maxPriceImpactPct,
  maxEntryRoundTripLossPct: SNIPE_LANE_DEFAULTS.maxEntryRoundTripLossPct,
  holdMaxMs: SNIPE_LANE_DEFAULTS.holdMaxMs,
  creatorExitFrac: SNIPE_LANE_DEFAULTS.creatorExitFrac,
  /* ── what the record changed ────────────────────────────────────────────────────────
     Three dials below carry a value the executor's 58- and 64-trade record justifies,
     and this file is where that is said. See README.md, "What HAWK-AI's trades taught
     it", for the tables; RECORD below carries the numbers. */
  entryWaitMs: 10_000,        // do not buy a launch younger than this: entries under 3s won 0 of 9
  entryFollowThroughX: 1.0,   // and only if the would-have-fill still marks at least this after the wait
  /* ── the exits (null = snipe-policy's own default) ──────────────────────────────── */
  stopFrac: null,
  takeAtEntryX: 1.5,          // the policy's own default is 2x; 44% of the 64 reached 1.5x, 25% reached 2x
  timeStopMs: null,
  stallMs: null,
  stallAtX: null,
  /* ── the two rulers, undefined until the shadow book grades them ────────────────── */
  maxCreatorSharePct: null,   // creator_profile: kills above this % of supply held by the deployer
  maxLaunchSharePct: null,    // launch_share: kills above this % of the opening quote already bought
  /* ── the shadow book ────────────────────────────────────────────────────────────── */
  forwardSamples: SNIPE_LANE_DEFAULTS.forwardSamples,
  forwardIntervalMs: SNIPE_LANE_DEFAULTS.forwardIntervalMs,
  shadowMaxOpen: 12,          // would-have positions sampled at once; beyond it rows are recorded unsampled
  shadowCapacity: 3_000,      // rows kept for the scorecard and the export
  /* ── the transaction ────────────────────────────────────────────────────────────── */
  computeUnitLimit: 260_000,
  priorityFeeLamports: SNIPE_LANE_DEFAULTS.priorityFeeLamports,
  sellToleranceFrac: 0.10,    // the sell floor sits this far under the curve's own quote
  /* ── the human in the loop ──────────────────────────────────────────────────────── */
  approvalTimeoutMs: 25_000,  // a buy whose Phantom window sits longer than this is abandoned
  sellReaskMs: 8_000,         // a declined or unanswered sell is asked again after this
  tickMs: 1_000,
  liveAck: "",                // the arm sentence, typed
});

const NUMBER_KEYS = new Set([
  "maxSolPerTrade", "dailySolCap", "maxOpenPositions", "socialsTimeoutMs", "noticeMaxMs",
  "maxPriceImpactPct", "maxEntryRoundTripLossPct", "holdMaxMs", "creatorExitFrac",
  "entryWaitMs", "entryFollowThroughX",
  "stopFrac", "takeAtEntryX", "timeStopMs", "stallMs", "stallAtX",
  "maxCreatorSharePct", "maxLaunchSharePct",
  "forwardSamples", "forwardIntervalMs", "shadowMaxOpen", "shadowCapacity",
  "computeUnitLimit", "priorityFeeLamports", "sellToleranceFrac",
  "approvalTimeoutMs", "sellReaskMs", "tickMs",
]);
const NULLABLE = new Set(["stopFrac", "takeAtEntryX", "timeStopMs", "stallMs", "stallAtX", "maxCreatorSharePct", "maxLaunchSharePct"]);

/**
 * THE RECORD, AS NUMBERS THE UI CAN SHOW. Every figure is copied from Claude-Company's
 * executor/README.md ("What 58 real trades changed", "The first six trades after those
 * changes", "What the coins actually did"), read back off mainnet by the owner on
 * 2026-09-17, nothing sampled. It is here so the arming screen can put the expected
 * value in front of the person about to type the sentence, in the record's own words.
 */
export const RECORD = Object.freeze({
  readAt: "2026-09-17",
  first58: Object.freeze({ trades: 58, won: 10, lost: 48, netSol: -1.5793, avgWinnerPct: 75, avgLoserPct: -22 }),
  after: Object.freeze({ trades: 6, won: 1, lost: 5, netSol: -0.0693, perTradeSol: -0.0116 }),
  all64: Object.freeze({ trades: 64, netSol: -0.361, bestModelledLadderSol: -0.122 }),
  tenMinuteClock: Object.freeze({ ran: 18, won: 0 }),
  bySecondsLate: Object.freeze([
    Object.freeze({ bucket: "under 3s", n: 9, wonPct: 0, meanPct: -18.5 }),
    Object.freeze({ bucket: "3–6s", n: 25, wonPct: 20, meanPct: -2.6 }),
    Object.freeze({ bucket: "6–10s", n: 20, wonPct: 10, meanPct: -23.4 }),
    Object.freeze({ bucket: "10s+", n: 10, wonPct: 40, meanPct: 34.0 }),
  ]),
  bySize: Object.freeze([
    Object.freeze({ bucket: "0.05–0.15 SOL", n: 1, wonPct: 100, netSol: 0.22 }),
    Object.freeze({ bucket: "0.15–0.25 SOL", n: 8, wonPct: 25, netSol: 0.12 }),
    Object.freeze({ bucket: "0.25–0.35 SOL", n: 19, wonPct: 21, netSol: -0.33 }),
    Object.freeze({ bucket: "0.35 SOL+", n: 30, wonPct: 10, netSol: -1.58 }),
  ]),
  reached: Object.freeze([
    Object.freeze({ x: 1.05, of64: 48 }), Object.freeze({ x: 1.2, of64: 35 }), Object.freeze({ x: 1.5, of64: 28 }),
    Object.freeze({ x: 2, of64: 16 }), Object.freeze({ x: 3, of64: 4 }),
  ]),
  takeAt15xWorthSol: 0.24,      // modelled, at a 0.1 SOL ticket, over the 64
  socialsFilterMovedWinRate: false,
  entrySignalsOrderOutcome: false,   // Spearman |ρ| < 0.13 on every signal measured at entry
  sizeBucketWarnAboveSol: 0.15,
});
const BOOL_KEYS = new Set(["requireSocials"]);
const STRING_KEYS = new Set(["rpcUrl", "rpcWsUrl", "secondaryRpcUrl", "consoleUrl", "lane", "liveAck"]);

/** How many stocks one lane may list. A list is typed by a person; eight is plenty. */
export const MAX_QUOTE_MINTS = 8;

/**
 * THE CANARY RULE FOR STOCK QUOTES, IN WORDS THE UI PRINTS VERBATIM.
 * When this lane was built, no buy on a stock-quoted pump.fun curve had been observed on
 * chain — only one sell. The buy's account order rests on the venue's IDL and on the SOL
 * buys it was proved against. So the first live buy in each listed stock is sized at
 * that stock's minPerTrade, and the full ticket is used only after one buy in that stock
 * has landed and its fill has been read back from the chain's own balances.
 */
export const STOCK_CANARY_RULE = "the first live buy in each listed stock is sized at its minPerTrade (a canary); " +
  "the full ticket is used only after one buy in that stock has landed and its fill was read back off the chain. " +
  "No buy on a stock-quoted pump.fun curve had been observed on chain when this lane was built. " +
  "A buy that lands but cannot be read back or booked blocks that stock until you clear it in the popup.";

/**
 * Tokenised stocks whose mint accounts were read off mainnet (the vendored fixture
 * vendor/executor/fixtures/pumpfun-xstock-quote.json, slot 449,986,225): the address and
 * the symbol in each mint's own TokenMetadata. Offered as a shortcut in the options page;
 * nothing is listed until the user adds it and types its numbers.
 */
export const KNOWN_STOCK_QUOTES = Object.freeze([
  Object.freeze({ mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re", symbol: "GLDx", name: "Gold xStock" }),
  Object.freeze({ mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", symbol: "TSLAx", name: "Tesla xStock" }),
  Object.freeze({ mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", symbol: "SPYx", name: "SP500 xStock" }),
]);

/** One entry of `quoteMints`, validated; a malformed one is refused under the key "quoteMints". */
function normalizeQuoteMint(entry, index) {
  const where = `quoteMints[${index}]`;
  const bad = (message) => { throw new ConfigError("quoteMints", `${where}: ${message}`); };
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) bad("must be an object { mint, symbol, maxPerTrade, dailyCap, minPerTrade }");
  const mint = typeof entry.mint === "string" ? entry.mint.trim() : "";
  let decoded = null;
  try { decoded = new PublicKey(mint); } catch { decoded = null; }
  if (!decoded || decoded.toBase58() !== mint) bad(`mint ${JSON.stringify(entry.mint)} is not a base58 32-byte address`);
  if (mint === WSOL) bad("wrapped SOL is not a stock quote — SOL is always on, sized by maxSolPerTrade");
  const symbol = typeof entry.symbol === "string" ? entry.symbol.trim() : "";
  if (!(symbol.length >= 1 && symbol.length <= 12) || /[\s<>"'&]/.test(symbol)) bad("symbol must be 1 to 12 characters with no spaces");
  const num = (key, { required = true } = {}) => {
    const v = entry[key];
    if (v === undefined || v === null || v === "") { if (required) bad(`${key} is required`); return null; }
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) bad(`${key} must be a positive number of ${symbol}, got ${JSON.stringify(v)}`);
    return n;
  };
  const maxPerTrade = num("maxPerTrade");
  const dailyCap = num("dailyCap");
  const minPerTrade = num("minPerTrade", { required: false }) ?? maxPerTrade;
  if (dailyCap < maxPerTrade) bad(`dailyCap ${dailyCap} ${symbol} is under maxPerTrade ${maxPerTrade} — not one launch could be taken`);
  if (minPerTrade > maxPerTrade) bad(`minPerTrade ${minPerTrade} ${symbol} is above maxPerTrade ${maxPerTrade}`);
  /* Eighteen decimals is the most any mint can carry; a number finer than that is no
     amount at all. The mint's real decimals are checked again when it is read. */
  for (const [key, v] of [["maxPerTrade", maxPerTrade], ["dailyCap", dailyCap], ["minPerTrade", minPerTrade]]) {
    try { unitsToRaw(v, 18, key); } catch (error) { bad(error.message); }
  }
  return Object.freeze({ mint, symbol, maxPerTrade, dailyCap, minPerTrade });
}

/** The whole list, from an array or from the JSON text the options page sends. */
export function normalizeQuoteMints(value) {
  let list = value;
  if (list === null || list === undefined || list === "") return Object.freeze([]);
  if (typeof list === "string") {
    try { list = JSON.parse(list); }
    catch (error) { throw new ConfigError("quoteMints", `quoteMints is not valid JSON: ${error.message}`); }
  }
  if (!Array.isArray(list)) throw new ConfigError("quoteMints", "quoteMints must be a list of { mint, symbol, maxPerTrade, dailyCap, minPerTrade }");
  if (list.length > MAX_QUOTE_MINTS) throw new ConfigError("quoteMints", `at most ${MAX_QUOTE_MINTS} stock quotes may be listed, got ${list.length}`);
  const out = list.map(normalizeQuoteMint);
  const seen = new Set();
  for (const q of out) {
    if (seen.has(q.mint)) throw new ConfigError("quoteMints", `quoteMints lists ${q.mint} twice`);
    seen.add(q.mint);
  }
  return Object.freeze(out);
}

/** The console pages the manifest's content script matches; the bridge exists nowhere else. */
export const CONSOLE_URLS = Object.freeze([
  "https://gtjvv976mb-netizen.github.io/coinmarketcat/console/",
  "https://claudedotcompany.com/hawk",
  "https://www.claudedotcompany.com/hawk",
  "http://localhost:4949/console/",  // the site served locally: python3 -m http.server 4949 --directory site
  "http://127.0.0.1:4949/console/",
]);

export class ConfigError extends Error {
  constructor(key, message) { super(message); this.name = "ConfigError"; this.key = key; }
}

/** Coerce whatever storage or a form handed back into a config, refusing the malformed by
 *  name. Unknown keys are dropped, not carried: a dial nobody reads is a dial nobody sees. */
export function normalizeConfig(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const out = { ...CONFIG_DEFAULTS };
  for (const key of Object.keys(CONFIG_DEFAULTS)) {
    if (!(key in src) || src[key] === undefined) continue;
    const v = src[key];
    if (key === "quoteMints") { out.quoteMints = normalizeQuoteMints(v); continue; }
    if (STRING_KEYS.has(key)) { out[key] = v === null ? "" : String(v).trim(); continue; }
    if (BOOL_KEYS.has(key)) { out[key] = v === true || v === "true" || v === 1 || v === "1"; continue; }
    if (NUMBER_KEYS.has(key)) {
      if (v === null || v === "") { out[key] = NULLABLE.has(key) ? null : CONFIG_DEFAULTS[key]; continue; }
      const n = Number(v);
      if (!Number.isFinite(n)) throw new ConfigError(key, `${key} must be a number, got ${JSON.stringify(v)}`);
      out[key] = n;
    }
  }
  if (!LANE_MODES.includes(out.lane)) throw new ConfigError("lane", `lane must be one of ${LANE_MODES.join(", ")}, got ${JSON.stringify(out.lane)}`);
  if (out.rpcUrl && !/^https:\/\/\S+$/i.test(out.rpcUrl)) throw new ConfigError("rpcUrl", "rpcUrl must be an https:// URL");
  if (out.secondaryRpcUrl && !/^https:\/\/\S+$/i.test(out.secondaryRpcUrl)) throw new ConfigError("secondaryRpcUrl", "secondaryRpcUrl must be an https:// URL");
  if (out.rpcWsUrl && !/^wss:\/\/\S+$/i.test(out.rpcWsUrl)) throw new ConfigError("rpcWsUrl", "rpcWsUrl must be a wss:// URL");
  if (!CONSOLE_URLS.some((u) => out.consoleUrl === u || out.consoleUrl.startsWith(`${u}?`) || out.consoleUrl.startsWith(`${u}#`)))
    throw new ConfigError("consoleUrl", `consoleUrl must be one of the pages the extension is built for: ${CONSOLE_URLS.join(", ")}`);
  if (!(out.maxSolPerTrade > 0)) throw new ConfigError("maxSolPerTrade", "maxSolPerTrade must be positive");
  if (out.maxSolPerTrade > SNIPE_OPERATOR_MAX.maxSolPerTrade)
    throw new ConfigError("maxSolPerTrade", `maxSolPerTrade may not exceed the operator maximum of ${SNIPE_OPERATOR_MAX.maxSolPerTrade} SOL`);
  if (!(out.dailySolCap > 0)) throw new ConfigError("dailySolCap", "dailySolCap must be positive");
  if (out.dailySolCap > SNIPE_OPERATOR_MAX.dailySolCap)
    throw new ConfigError("dailySolCap", `dailySolCap may not exceed the operator maximum of ${SNIPE_OPERATOR_MAX.dailySolCap} SOL`);
  if (out.dailySolCap < out.maxSolPerTrade)
    throw new ConfigError("dailySolCap", "dailySolCap is under maxSolPerTrade — not one launch could be taken");
  if (!(Number.isInteger(out.maxOpenPositions) && out.maxOpenPositions >= 1 && out.maxOpenPositions <= 5))
    throw new ConfigError("maxOpenPositions", "maxOpenPositions must be a whole number from 1 to 5");
  if (!(out.sellToleranceFrac >= 0 && out.sellToleranceFrac < 0.5))
    throw new ConfigError("sellToleranceFrac", "sellToleranceFrac must be between 0 and 0.5");
  if (out.stopFrac !== null && !(out.stopFrac > 0 && out.stopFrac < 1))
    throw new ConfigError("stopFrac", "stopFrac is the fraction of entry at which the whole position leaves: between 0 and 1");
  if (out.takeAtEntryX !== null && !(out.takeAtEntryX > 1))
    throw new ConfigError("takeAtEntryX", "takeAtEntryX must be above 1");
  if (!(out.entryWaitMs >= 0 && out.entryWaitMs <= 120_000)) throw new ConfigError("entryWaitMs", "entryWaitMs must be 0..120000");
  if (!(out.entryFollowThroughX >= 0 && out.entryFollowThroughX <= 3)) throw new ConfigError("entryFollowThroughX", "entryFollowThroughX must be 0..3 (0 turns the check off)");
  if (out.maxCreatorSharePct !== null && !(out.maxCreatorSharePct > 0 && out.maxCreatorSharePct <= 100)) throw new ConfigError("maxCreatorSharePct", "maxCreatorSharePct must be a percentage, or blank to measure only");
  if (out.maxLaunchSharePct !== null && !(out.maxLaunchSharePct > 0)) throw new ConfigError("maxLaunchSharePct", "maxLaunchSharePct must be positive, or blank to measure only");
  if (!(Number.isInteger(out.forwardSamples) && out.forwardSamples >= 1 && out.forwardSamples <= 120)) throw new ConfigError("forwardSamples", "forwardSamples must be 1..120");
  if (!(out.forwardIntervalMs >= 1_000 && out.forwardIntervalMs <= 60_000)) throw new ConfigError("forwardIntervalMs", "forwardIntervalMs must be 1000..60000");
  if (!(Number.isInteger(out.shadowMaxOpen) && out.shadowMaxOpen >= 0 && out.shadowMaxOpen <= 50)) throw new ConfigError("shadowMaxOpen", "shadowMaxOpen must be 0..50");
  if (!(Number.isInteger(out.shadowCapacity) && out.shadowCapacity >= 100 && out.shadowCapacity <= 20_000)) throw new ConfigError("shadowCapacity", "shadowCapacity must be 100..20000");
  if (!(out.tickMs >= 500 && out.tickMs <= 10_000)) throw new ConfigError("tickMs", "tickMs must be 500..10000");
  if (!(out.approvalTimeoutMs >= 5_000)) throw new ConfigError("approvalTimeoutMs", "approvalTimeoutMs must be at least 5000");
  if (!(out.computeUnitLimit >= 50_000 && out.computeUnitLimit <= 1_400_000))
    throw new ConfigError("computeUnitLimit", "computeUnitLimit must be 50000..1400000");
  if (!(out.priorityFeeLamports >= 0)) throw new ConfigError("priorityFeeLamports", "priorityFeeLamports must be >= 0");
  return Object.freeze(out);
}

/** The websocket the feed dials: the pasted one, else the https URL with its scheme turned. */
export function websocketUrlFor(config) {
  if (config.rpcWsUrl) return config.rpcWsUrl;
  if (!config.rpcUrl) return "";
  return config.rpcUrl.replace(/^https:/i, "wss:");
}

/**
 * The config the entry contract reads: the lane's own defaults under the user's dials.
 * `lane` here is what the contract's `lane_off` gate sees, so a browser lane that is
 * armed for execute presents "execute", and one merely watching presents "observe".
 */
export function laneConfigFor(config, { lane = config.lane } = {}) {
  const cfg = {
    ...SNIPE_LANE_DEFAULTS,
    lane,
    maxSolPerTrade: config.maxSolPerTrade,
    dailySolCap: config.dailySolCap,
    requireSocials: config.requireSocials === true,
    socialsTimeoutMs: config.socialsTimeoutMs,
    noticeMaxMs: config.noticeMaxMs,
    maxPriceImpactPct: config.maxPriceImpactPct,
    maxEntryRoundTripLossPct: config.maxEntryRoundTripLossPct,
    holdMaxMs: config.holdMaxMs,
    creatorExitFrac: config.creatorExitFrac,
    priorityFeeLamports: config.priorityFeeLamports,
    forwardSamples: config.forwardSamples,
    forwardIntervalMs: config.forwardIntervalMs,
    shadowCapacity: config.shadowCapacity,
    maxCreatorSharePct: config.maxCreatorSharePct === null ? undefined : config.maxCreatorSharePct,
    maxLaunchSharePct: config.maxLaunchSharePct === null ? undefined : config.maxLaunchSharePct,
    stopFrac: config.stopFrac,
    takeAtEntryX: config.takeAtEntryX,
    timeStopMs: config.timeStopMs,
    stallMs: config.stallMs,
    stallAtX: config.stallAtX,
    liveAck: config.liveAck || null,
    /* The mints the contract's quote_not_sol gate may admit; each still needs its facts
       (describeMint of the mint account) handed in beside it, or it is refused by name. */
    quoteMintAllowlist: Object.freeze((config.quoteMints ?? []).map((q) => q.mint)),
  };
  return effectiveLaneConfig(cfg);
}

/** The listed stock for a mint, or null. */
export function quoteEntryFor(config, mint) {
  return (config.quoteMints ?? []).find((q) => q.mint === mint) ?? null;
}

/** What snipePolicy() reads: its own defaults under the folded policy dials. */
export function policyConfigFor(config) {
  const eff = laneConfigFor(config);
  return Object.freeze({ ...POLICY_DEFAULTS, ...(eff.policy ?? {}) });
}

/** The fee model the contract's fee gates judge, mirroring snipe-lane's feeModel(). A
 *  stock-quoted buy may create TWO token accounts (the launch token's and the stock's),
 *  so its rent is modelled at two creates: 4,078,560 lamports, under the 4,200,000 rent
 *  cap. The measured rent of the two is 1,513,840 + 1,559,560 = 3,073,400. */
export function feeModelFor(config, { quoteAtaCreate = false } = {}) {
  const rent = Number(SNIPE_LANE_DEFAULTS.rentFeeLamports) || 0;
  return Object.freeze({
    signatureFeeLamports: Number(SNIPE_LANE_DEFAULTS.signatureFeeLamports) || 0,
    prioritizationFeeLamports: Number(config.priorityFeeLamports) || 0,
    rentFeeLamports: quoteAtaCreate ? rent * 2 : rent,
  });
}

/**
 * THE ARM SENTENCE FOR THIS BROWSER LANE. With no stock listed it is the executor's own
 * `snipeArmSentence`, byte for byte. With stocks listed, every one is appended with its
 * ticket, its canary, its day cap and its MINT ADDRESS, so the typed acknowledgement binds
 * the exact mint the way the executor's binds the wallet: a SOL sentence cannot arm a
 * GLDx trade, and a sentence typed before a list changed does not arm after it.
 */
export function browserArmSentence(wallet, maxSolPerTrade, dailySolCap, quoteMints = []) {
  const base = snipeArmSentence(wallet, maxSolPerTrade, dailySolCap);
  if (!Array.isArray(quoteMints) || quoteMints.length === 0) return base;
  const parts = quoteMints.map((q) =>
    `${q.maxPerTrade} ${q.symbol} per launch (the first at ${q.minPerTrade} ${q.symbol}), ${q.dailyCap} ${q.symbol} per day (${q.mint})`);
  return `${base} — and in stock quotes: ${parts.join("; ")}`;
}

/**
 * THE ARMING CHECKLIST FOR A BROWSER LANE. The lane's own armabilityReport (size within
 * the operator max, the daily cap charged, the take and stop fundable, exit signals
 * wired, the venue proved) plus the four facts only this host can know: an RPC, a
 * connected Phantom, the typed sentence for THAT wallet, and a stop the operator chose
 * once the ticket is above the canary.
 */
export function browserArmability({ config, wallet = null, hasBridge = false }) {
  const items = [];
  const add = (name, ok, detail) => items.push({ name, ok: ok === true, detail });
  add("rpc_configured", Boolean(config.rpcUrl), config.rpcUrl ? `reads and sends through ${new URL(config.rpcUrl).host}` : "no RPC URL is set — the public RPC refuses browsers");
  add("console_page_open", hasBridge, hasBridge ? "the console tab is open and the bridge answers" : "open the console page in a tab (the popup's Console button opens it); Phantom lives there");
  add("phantom_connected", typeof wallet === "string" && wallet.length > 30, wallet ? `Phantom connected as ${wallet}` : "Phantom is not connected on the console page");
  const stopExplicit = config.stopFrac !== null;
  add("stop_chosen_above_canary", config.maxSolPerTrade <= CANARY_SOL || stopExplicit,
    config.maxSolPerTrade <= CANARY_SOL
      ? `the ${config.maxSolPerTrade} SOL ticket is at or under the ${CANARY_SOL} SOL canary; the lane's own 0.20x stop applies`
      : stopExplicit ? `stop ${config.stopFrac}x of entry, chosen for a ${config.maxSolPerTrade} SOL ticket`
        : `a ${config.maxSolPerTrade} SOL ticket is above the ${CANARY_SOL} SOL canary and the 0.20x default stop was derived for the canary — choose a stop`);
  const stocks = config.quoteMints ?? [];
  if (stocks.length)
    add("stop_chosen_for_stock_quotes", stopExplicit,
      stopExplicit ? `stop ${config.stopFrac}x of entry applies to stock-quoted positions too`
        : "a stock-quoted ticket has no derived stop floor (its network fee is paid in SOL, its size in the stock) — choose a stop");
  const expected = wallet ? browserArmSentence(wallet, config.maxSolPerTrade, config.dailySolCap, stocks) : null;
  add("live_ack_typed", Boolean(expected) && config.liveAck === expected,
    !expected ? "no wallet to write the sentence for"
      : config.liveAck === expected ? `the arm sentence matches, byte for byte, for the connected wallet${stocks.length ? ` and the ${stocks.length} listed stock${stocks.length === 1 ? "" : "s"}` : ""}`
        : `type exactly: ${expected}`);
  const lane = armabilityReport({ cfg: laneConfigFor(config, { lane: "execute" }), venue: PUMPFUN_VENUE, stopExplicit });
  for (const item of lane.items) items.push(item);
  const blocking = items.filter((i) => !i.ok).map((i) => i.name);
  /* Warnings never block: they are the record, said out loud beside the switch. */
  const warnings = [];
  if (config.maxSolPerTrade > RECORD.sizeBucketWarnAboveSol)
    warnings.push({ name: "size_above_the_record", detail: `every SOL of the record's net loss sat in tickets of 0.35 SOL and up; ${config.maxSolPerTrade} SOL is above the ${RECORD.sizeBucketWarnAboveSol} SOL bucket that was net positive (and that bucket was seven trades)` });
  if (config.entryWaitMs < 3_000)
    warnings.push({ name: "entry_wait_under_3s", detail: "entries under three seconds won 0 of 9 on the record; the wait is what keeps this lane out of that bucket" });
  if (config.takeAtEntryX === null || config.takeAtEntryX > 1.5)
    warnings.push({ name: "take_above_1_5x", detail: `44% of the record's coins reached 1.5x and 25% reached 2x; a 1.5x take was worth about +${RECORD.takeAt15xWorthSol} SOL over the 64 at a 0.1 SOL ticket` });
  if (stocks.length) {
    warnings.push({ name: "stock_canary", detail: `Canary rule: ${STOCK_CANARY_RULE} Listed: ${stocks.map((q) => `${q.symbol} first buy ${q.minPerTrade} ${q.symbol}, then ${q.maxPerTrade} ${q.symbol}`).join("; ")}.` });
    const fullCanary = stocks.filter((q) => q.minPerTrade >= q.maxPerTrade);
    if (fullCanary.length)
      warnings.push({ name: "stock_canary_is_full_ticket", detail: `${fullCanary.map((q) => q.symbol).join(", ")}: minPerTrade equals maxPerTrade, so the canary buy is the full ticket. Set a smaller minPerTrade in Options to make the first buy small.` });
    warnings.push({ name: "stock_quote_unmeasured", detail: "HAWK-AI's record is SOL-quoted launches only. Nothing has been measured about stock-quoted launches: no win rate, no follow-through, no fee on a buy. The shadow book grades them on a separate card per stock." });
    warnings.push({ name: "stock_quote_friction_unpriced", detail: "a stock row's frictionX is 1.0: the network fee and rent are paid in SOL beside it and cannot be netted against a size in the stock, so the stop and the take judge the stock amount only." });
    warnings.push({ name: "stock_quote_issuer_controls", detail: "every xStock mint read carries a live freeze authority, a pause switch and a permanent delegate held by its issuer. The lane detects a pause on every read and will not buy or sell through one; it cannot defend against a freeze or a clawback of a held position." });
  }
  warnings.push({ name: "the_record_loses", detail: `the record is ${RECORD.first58.won} up, ${RECORD.first58.lost} down, ${RECORD.first58.netSol} SOL over ${RECORD.first58.trades} trades, and every modelled exit ladder still loses. Nothing here is evidence of an edge. Observe first.` });
  return Object.freeze({ armable: blocking.length === 0, items: Object.freeze(items), blocking: Object.freeze(blocking), warnings: Object.freeze(warnings), expectedAck: expected });
}
