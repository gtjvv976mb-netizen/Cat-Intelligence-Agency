/* AGENCY HQ: WHAT THE SITE ACCEPTS FROM IT.
   Every response HQ sends is checked here, field by field, against docs/hq/API.md before a page
   draws any of it. The checks are strict on purpose:

     · an unknown field, or a missing one, refuses the object (a changed contract fails loudly
       here instead of drawing something nobody checked);
     · every amount must be a decimal string ("12.5", "-0.03"): a JSON number, an exponent, a
       separator, a leading zero or a blank is refused;
     · every address must be base58 of an address's length, every signature base58 of a
       signature's, every time a real ISO-8601 UTC instant;
     · every word is plain text of a bounded length, with no control, bidi or zero-width
       characters (the pages draw it with textContent, never as markup);
     · a live trade must carry its transaction, and a paper trade must not (paper signs nothing);
     · a mode is paper or live, and one board never mixes them.

   In a list, one bad entry is dropped (and counted, so the page can say so) rather than taking
   the whole list down; a bad top-level object is refused whole. Pure: no page, no network. */
import { ADDRESS, SIGNATURE, isDecimal, isIsoTime, RANK_IDS, STRATEGIES, CATS } from "./hq-format.js";

export class HqInvalid extends Error {
  constructor(problem) { super(problem); this.name = "HqInvalid"; }
}
const bad = (path, what) => { throw new HqInvalid(`${path} ${what}`); };
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/* The object must have exactly these fields: every required one, and optional ones only. */
function exact(o, path, required, optional = []) {
  if (!isObject(o)) bad(path, "must be an object");
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) bad(path, `has an unknown field "${k}"`);
  for (const k of required) if (!own(o, k)) bad(path, `is missing "${k}"`);
  return o;
}
const HIDDEN = /[\u0000-\u001f\u007f-\u009f­؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￻]/u;

const V = {
  dec(o, k, path, { nullable = false, nonNegative = false } = {}) {
    const v = o[k];
    if (v === null && nullable) return;
    if (!isDecimal(v)) bad(`${path}.${k}`, "must be a decimal string");
    if (nonNegative && v.startsWith("-")) bad(`${path}.${k}`, "must not be negative");
  },
  int(o, k, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const v = o[k];
    if (!Number.isSafeInteger(v) || v < min || v > max) bad(`${path}.${k}`, `must be a whole number from ${min}`);
  },
  bool(o, k, path) { if (typeof o[k] !== "boolean") bad(`${path}.${k}`, "must be true or false"); },
  oneOf(o, k, path, values, { nullable = false } = {}) {
    if (o[k] === null && nullable) return;
    if (!values.includes(o[k])) bad(`${path}.${k}`, `must be one of ${values.join(", ")}`);
  },
  time(o, k, path) { if (!isIsoTime(o[k])) bad(`${path}.${k}`, "must be an ISO-8601 UTC time"); },
  address(o, k, path, { nullable = false } = {}) {
    if (o[k] === null && nullable) return;
    if (typeof o[k] !== "string" || !ADDRESS.test(o[k])) bad(`${path}.${k}`, "must be a base58 address");
  },
  signature(o, k, path, { nullable = false } = {}) {
    if (o[k] === null && nullable) return;
    if (typeof o[k] !== "string" || !SIGNATURE.test(o[k])) bad(`${path}.${k}`, "must be a base58 transaction signature");
  },
  text(o, k, path, { max = 120, min = 1, nullable = false } = {}) {
    const v = o[k];
    if (v === null && nullable) return;
    if (typeof v !== "string" || v.length < min || v.length > max || v.trim().length === 0 || HIDDEN.test(v)) bad(`${path}.${k}`, `must be plain text of ${min} to ${max} characters`);
  },
  pattern(o, k, path, re, what, { nullable = false } = {}) {
    if (o[k] === null && nullable) return;
    if (typeof o[k] !== "string" || !re.test(o[k])) bad(`${path}.${k}`, `must be ${what}`);
  },
};

export const MODES = Object.freeze(["paper", "live"]);
export const STRATEGY_IDS = Object.freeze(Object.keys(STRATEGIES));
export const CAT_IDS = Object.freeze(Object.keys(CATS));
export const TRIGGERS = Object.freeze(["strategy", "stop_loss", "take_profit", "trailing_stop", "daily_limit", "manual"]);
export const FLOW_KINDS = Object.freeze(["fee_in", "profit_in", "buyback", "funding_out", "funding_in"]);
export const TIERS = Object.freeze(["none", "holder", "agent", "director"]);
export const BUYBACK_SOURCES = Object.freeze(["creator_fees", "trading_profit"]);
/* The rug check each buy passes (API.md "Strategies": mint and freeze authority, holders,
   creator share). The contract does not yet carry the result on a trade; the site accepts it,
   optionally, in this shape (see rugCheck below) and says so where it is missing. */
export const RUG_CHECKS = Object.freeze(["mint_authority", "freeze_authority", "holders", "creator_share"]);
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,63}$/;
const CURSOR = /^[A-Za-z0-9_:.=-]{1,128}$/;
const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const NUMBER = /^\d{3,4}$/;

/* A list: each entry checked on its own; the bad ones are dropped and counted. */
function list(v, path, one, { max = 1000 } = {}) {
  if (!Array.isArray(v)) bad(path, "must be a list");
  if (v.length > max) bad(path, `has more than ${max} entries`);
  const items = [], problems = [];
  v.forEach((x, i) => {
    try { items.push(one(x, `${path}[${i}]`)); } catch (e) { if (e instanceof HqInvalid) problems.push(e.message); else throw e; }
  });
  return { items, problems };
}

/* ── the shapes ─────────────────────────────────────────────────────────── */
function summary(o, path = "summary") {
  exact(o, path, ["mode", "updatedAt", "agents", "trades24h", "solInAgentWallets", "tradingPnlSol", "creatorFeesClaimedSol", "buybacks", "treasury"]);
  V.oneOf(o, "mode", path, ["paper", "live", "mixed"]);
  V.time(o, "updatedAt", path);
  exact(o.agents, `${path}.agents`, ["active", "total"]);
  V.int(o.agents, "active", `${path}.agents`); V.int(o.agents, "total", `${path}.agents`);
  if (o.agents.active > o.agents.total) bad(`${path}.agents`, "has more active agents than agents");
  exact(o.trades24h, `${path}.trades24h`, ["count", "volumeSol"]);
  V.int(o.trades24h, "count", `${path}.trades24h`); V.dec(o.trades24h, "volumeSol", `${path}.trades24h`, { nonNegative: true });
  V.dec(o, "solInAgentWallets", path, { nonNegative: true });
  exact(o.tradingPnlSol, `${path}.tradingPnlSol`, ["realized", "unrealized"]);
  V.dec(o.tradingPnlSol, "realized", `${path}.tradingPnlSol`); V.dec(o.tradingPnlSol, "unrealized", `${path}.tradingPnlSol`);
  V.dec(o, "creatorFeesClaimedSol", path, { nonNegative: true });
  exact(o.buybacks, `${path}.buybacks`, ["count", "solSpent", "ciaBought"]);
  V.int(o.buybacks, "count", `${path}.buybacks`);
  V.dec(o.buybacks, "solSpent", `${path}.buybacks`, { nonNegative: true }); V.dec(o.buybacks, "ciaBought", `${path}.buybacks`, { nonNegative: true });
  treasuryHead(o.treasury, `${path}.treasury`, ["address", "sol", "cia"]);
  return o;
}
function treasuryHead(o, path, fields) {
  exact(o, path, fields);
  V.address(o, "address", path);
  V.dec(o, "sol", path, { nonNegative: true }); V.dec(o, "cia", path, { nonNegative: true });
}

const AGENT_FIELDS = ["id", "number", "name", "cat", "skin", "rank", "strategy", "mode", "status", "coin", "wallet", "hiredAt", "stats"];
const STAT_DECIMALS = ["balanceSol", "portfolioSol", "realizedPnlSol", "unrealizedPnlSol", "careerRealizedSol", "feesClaimedSol", "depositedSol", "withdrawnSol", "maxDrawdownPct"];
function agentFields(o, path) {
  V.int(o, "id", path, { min: 1 });
  V.pattern(o, "number", path, NUMBER, "a three- or four-digit agent number");
  V.text(o, "name", path, { max: 48 });
  V.oneOf(o, "cat", path, CAT_IDS);
  V.pattern(o, "skin", path, SKIN_ID, "a skin id");
  V.oneOf(o, "rank", path, RANK_IDS);
  V.oneOf(o, "strategy", path, STRATEGY_IDS);
  V.oneOf(o, "mode", path, MODES);
  V.oneOf(o, "status", path, ["active", "paused", "retired"]);
  if (o.coin !== null) {
    exact(o.coin, `${path}.coin`, ["mint", "symbol", "name"]);
    V.address(o.coin, "mint", `${path}.coin`); V.text(o.coin, "symbol", `${path}.coin`, { max: 16 }); V.text(o.coin, "name", `${path}.coin`, { max: 48 });
  }
  V.address(o, "wallet", path);
  V.time(o, "hiredAt", path);
  const s = exact(o.stats, `${path}.stats`, [...STAT_DECIMALS, "trades", "wins", "losses", "roiPct"]);
  for (const k of STAT_DECIMALS) V.dec(s, k, `${path}.stats`, { nonNegative: ["balanceSol", "portfolioSol", "careerRealizedSol", "feesClaimedSol", "depositedSol", "withdrawnSol", "maxDrawdownPct"].includes(k) });
  V.dec(s, "roiPct", `${path}.stats`, { nullable: true });
  for (const k of ["trades", "wins", "losses"]) V.int(s, k, `${path}.stats`);
  if (s.wins + s.losses > s.trades) bad(`${path}.stats`, "has more wins and losses than trades");
  return o;
}
function agent(o, path = "agent") { exact(o, path, AGENT_FIELDS); return agentFields(o, path); }

function rugCheck(o, path) {
  exact(o, path, ["passed", "checks"]);
  V.bool(o, "passed", path);
  const { items, problems } = list(o.checks, `${path}.checks`, (c, p) => {
    exact(c, p, ["id", "pass", "detail"]);
    V.oneOf(c, "id", p, RUG_CHECKS); V.bool(c, "pass", p); V.text(c, "detail", p, { max: 120, nullable: true });
    return c;
  }, { max: 12 });
  if (problems.length) bad(path, `has a check that is not well formed (${problems[0]})`);
  if (new Set(items.map((c) => c.id)).size !== items.length) bad(path, "names a check twice");
  if (o.passed !== items.every((c) => c.pass)) bad(path, "says passed when a check failed, or failed when all passed");
}

function decision(o, path = "decision") {
  exact(o, path, ["kind", "id", "t", "agentId", "action", "mint", "symbol", "reason", "mode"], ["rugCheck"]);
  if (o.kind !== "decision") bad(`${path}.kind`, 'must be "decision"');
  V.pattern(o, "id", path, ITEM_ID, "an id");
  V.time(o, "t", path);
  V.int(o, "agentId", path, { min: 1 });
  V.oneOf(o, "action", path, ["buy", "sell", "hold"]);
  V.address(o, "mint", path, { nullable: true });
  V.text(o, "symbol", path, { max: 16, nullable: true });
  V.text(o, "reason", path, { max: 500 });
  V.oneOf(o, "mode", path, MODES);
  if (own(o, "rugCheck") && o.rugCheck !== null) rugCheck(o.rugCheck, `${path}.rugCheck`);
  return o;
}
function trade(o, path = "trade") {
  exact(o, path, ["kind", "id", "t", "agentId", "side", "mint", "symbol", "sol", "tokens", "price", "pnlSol", "pnlPct", "trigger", "tx", "mode"], ["rugCheck"]);
  if (o.kind !== "trade") bad(`${path}.kind`, 'must be "trade"');
  V.pattern(o, "id", path, ITEM_ID, "an id");
  V.time(o, "t", path);
  V.int(o, "agentId", path, { min: 1 });
  V.oneOf(o, "side", path, ["buy", "sell"]);
  V.address(o, "mint", path);
  V.text(o, "symbol", path, { max: 16 });
  V.dec(o, "sol", path, { nonNegative: true }); V.dec(o, "tokens", path, { nonNegative: true }); V.dec(o, "price", path, { nonNegative: true });
  V.dec(o, "pnlSol", path, { nullable: true }); V.dec(o, "pnlPct", path, { nullable: true });
  V.oneOf(o, "trigger", path, TRIGGERS);
  V.oneOf(o, "mode", path, MODES);
  V.signature(o, "tx", path, { nullable: true });
  if (o.mode === "live" && o.tx === null) bad(`${path}.tx`, "is missing on a live trade");
  if (o.mode === "paper" && o.tx !== null) bad(`${path}.tx`, "is set on a paper trade, which signs nothing");
  if (own(o, "rugCheck") && o.rugCheck !== null) {
    if (o.side !== "buy") bad(`${path}.rugCheck`, "is only for a buy");
    rugCheck(o.rugCheck, `${path}.rugCheck`);
    if (!o.rugCheck.passed) bad(`${path}.rugCheck`, "failed, yet the buy went through");
  }
  return o;
}
function deskItem(o, path) {
  if (!isObject(o)) bad(path, "must be an object");
  if (o.kind === "trade") return trade(o, path);
  if (o.kind === "decision") return decision(o, path);
  return bad(`${path}.kind`, 'must be "trade" or "decision"');
}
function promotion(o, path, { withAgent = false } = {}) {
  exact(o, path, ["t", "from", "to"], withAgent ? ["agentId"] : []);
  V.time(o, "t", path); V.oneOf(o, "from", path, RANK_IDS); V.oneOf(o, "to", path, RANK_IDS);
  if (RANK_IDS.indexOf(o.to) <= RANK_IDS.indexOf(o.from)) bad(path, "is not a promotion (a loss never demotes)");
  if (own(o, "agentId")) V.int(o, "agentId", path, { min: 1 });
  return o;
}
function fee(o, path, { withAgent = false } = {}) {
  exact(o, path, ["t", "sol", "tx"], withAgent ? ["agentId"] : []);
  V.time(o, "t", path); V.dec(o, "sol", path, { nonNegative: true }); V.signature(o, "tx", path);
  if (own(o, "agentId")) V.int(o, "agentId", path, { min: 1 });
  return o;
}
function buyback(o, path) {
  exact(o, path, ["t", "solSpent", "ciaBought", "price", "tx", "burnTx"]);
  V.time(o, "t", path);
  V.dec(o, "solSpent", path, { nonNegative: true }); V.dec(o, "ciaBought", path, { nonNegative: true }); V.dec(o, "price", path, { nonNegative: true });
  V.signature(o, "tx", path); V.signature(o, "burnTx", path, { nullable: true });
  return o;
}
const newestFirst = (a, b) => Date.parse(b.t) - Date.parse(a.t);

/* ── what each endpoint returns: { value, problems } or an HqInvalid thrown ── */
export function validateSummary(raw) { return { value: summary(raw), problems: [] }; }
export function validateAgents(raw) {
  exact(raw, "agents response", ["agents"]);
  const { items, problems } = list(raw.agents, "agents", agent);
  if (new Set(items.map((a) => a.id)).size !== items.length) throw new HqInvalid("agents lists one id twice");
  return { value: { agents: items }, problems };
}
export function validateAgentDetail(raw, wantId = null) {
  const path = "agent";
  exact(raw, path, [...AGENT_FIELDS, "limits", "positions", "decisions", "trades", "equity", "fees", "transfers", "promotions"]);
  agentFields(raw, path);
  if (wantId !== null && raw.id !== wantId) throw new HqInvalid(`agent.id is ${raw.id}, not the ${wantId} asked for`);
  const L = exact(raw.limits, `${path}.limits`, ["maxPerTradeSol", "maxOpenPositions", "stopLossPct", "takeProfitPct", "trailingStopPct", "dailyLossLimitSol"]);
  V.dec(L, "maxPerTradeSol", `${path}.limits`, { nonNegative: true }); V.int(L, "maxOpenPositions", `${path}.limits`);
  V.dec(L, "stopLossPct", `${path}.limits`, { nonNegative: true }); V.dec(L, "takeProfitPct", `${path}.limits`, { nonNegative: true });
  V.dec(L, "trailingStopPct", `${path}.limits`, { nullable: true, nonNegative: true }); V.dec(L, "dailyLossLimitSol", `${path}.limits`, { nonNegative: true });
  const problems = [];
  const take = (r) => { problems.push(...r.problems); return r.items; };
  const positions = take(list(raw.positions, `${path}.positions`, (p, pp) => {
    exact(p, pp, ["mint", "symbol", "costSol", "valueSol", "entryPrice", "price", "pnlSol", "pnlPct", "openedAt"]);
    V.address(p, "mint", pp); V.text(p, "symbol", pp, { max: 16 });
    for (const k of ["costSol", "valueSol", "entryPrice", "price"]) V.dec(p, k, pp, { nonNegative: true });
    V.dec(p, "pnlSol", pp); V.dec(p, "pnlPct", pp); V.time(p, "openedAt", pp);
    return p;
  }, { max: 100 }));
  const mine = (x, p) => { if (x.agentId !== raw.id) bad(`${p}.agentId`, "is another agent's"); if (x.mode !== raw.mode) bad(`${p}.mode`, "is not this agent's mode"); return x; };
  const decisions = take(list(raw.decisions, `${path}.decisions`, (x, p) => mine(decision(x, p), p))).sort(newestFirst);
  const trades = take(list(raw.trades, `${path}.trades`, (x, p) => mine(trade(x, p), p))).sort(newestFirst);
  const equity = take(list(raw.equity, `${path}.equity`, (e, p) => {
    exact(e, p, ["t", "portfolioSol"]); V.time(e, "t", p); V.dec(e, "portfolioSol", p, { nonNegative: true }); return e;
  }, { max: 5000 })).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const fees = take(list(raw.fees, `${path}.fees`, (x, p) => fee(x, p))).sort(newestFirst);
  const transfers = take(list(raw.transfers, `${path}.transfers`, (x, p) => {
    exact(x, p, ["t", "kind", "sol", "tx"]); V.time(x, "t", p); V.oneOf(x, "kind", p, ["deposit", "withdrawal"]);
    V.dec(x, "sol", p, { nonNegative: true }); V.signature(x, "tx", p); return x;
  })).sort(newestFirst);
  const promotions = take(list(raw.promotions, `${path}.promotions`, (x, p) => promotion(x, p))).sort(newestFirst);
  return { value: { ...raw, positions, decisions, trades, equity, fees, transfers, promotions }, problems };
}
export function validateDesk(raw) {
  exact(raw, "desk", ["items", "next"]);
  V.pattern(raw, "next", "desk", CURSOR, "a cursor", { nullable: true });
  const { items, problems } = list(raw.items, "desk.items", deskItem, { max: 200 });
  return { value: { items: items.sort(newestFirst), next: raw.next }, problems };
}
export function validateLeaderboard(raw, want = {}) {
  exact(raw, "leaderboard", ["period", "by", "rows"]);
  V.oneOf(raw, "period", "leaderboard", ["7d", "30d", "all"]); V.oneOf(raw, "by", "leaderboard", ["roi", "pnl"]);
  if (want.by && raw.by !== want.by) throw new HqInvalid(`leaderboard.by is ${raw.by}, not ${want.by}`);
  if (want.period && raw.period !== want.period) throw new HqInvalid(`leaderboard.period is ${raw.period}, not ${want.period}`);
  const { items, problems } = list(raw.rows, "leaderboard.rows", (r, p) => {
    exact(r, p, ["agentId", "value", "rank", "mode"]);
    V.int(r, "agentId", p, { min: 1 }); V.dec(r, "value", p); V.oneOf(r, "rank", p, RANK_IDS); V.oneOf(r, "mode", p, MODES);
    return r;
  }, { max: 500 });
  /* Paper and live are ranked separately: two boards, never one. */
  const boards = { live: items.filter((r) => r.mode === "live"), paper: items.filter((r) => r.mode === "paper") };
  return { value: { period: raw.period, by: raw.by, boards }, problems };
}
export function validateBuybacks(raw) {
  exact(raw, "buybacks", ["policy", "items"]);
  const P = exact(raw.policy, "buybacks.policy", ["sharePct", "sources", "schedule", "destination"]);
  V.dec(P, "sharePct", "buybacks.policy", { nonNegative: true });
  if (!Array.isArray(P.sources) || P.sources.length === 0 || P.sources.length > BUYBACK_SOURCES.length || new Set(P.sources).size !== P.sources.length || !P.sources.every((s) => BUYBACK_SOURCES.includes(s)))
    throw new HqInvalid(`buybacks.policy.sources must list ${BUYBACK_SOURCES.join(" and/or ")}`);
  V.text(P, "schedule", "buybacks.policy", { max: 160 });
  V.oneOf(P, "destination", "buybacks.policy", ["burn", "treasury"]);
  const { items, problems } = list(raw.items, "buybacks.items", buyback, { max: 500 });
  return { value: { policy: P, items: items.sort(newestFirst) }, problems };
}
export function validateTreasury(raw) {
  exact(raw, "treasury", ["address", "sol", "cia", "flows"]);
  treasuryHead({ address: raw.address, sol: raw.sol, cia: raw.cia }, "treasury", ["address", "sol", "cia"]);
  const { items, problems } = list(raw.flows, "treasury.flows", (f, p) => {
    exact(f, p, ["t", "kind", "sol", "tx"]); V.time(f, "t", p); V.oneOf(f, "kind", p, FLOW_KINDS); V.dec(f, "sol", p); V.signature(f, "tx", p); return f;
  }, { max: 1000 });
  return { value: { address: raw.address, sol: raw.sol, cia: raw.cia, flows: items.sort(newestFirst) }, problems };
}
/* GET /v1/perks/challenge: the contract names it, not its shape; the site reads
   { wallet, message, expiresAt } and signs the message only if it is text that names the
   wallet that is signing it. */
export function validateChallenge(raw, wallet) {
  exact(raw, "challenge", ["wallet", "message", "expiresAt"]);
  V.address(raw, "wallet", "challenge");
  if (raw.wallet !== wallet) throw new HqInvalid("challenge.wallet is not the connected wallet");
  if (typeof raw.message !== "string" || raw.message.length < 16 || raw.message.length > 600 || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/.test(raw.message))
    throw new HqInvalid("challenge.message must be 16 to 600 characters of plain text");
  if (!raw.message.includes(wallet)) throw new HqInvalid("challenge.message does not name the wallet signing it");
  V.time(raw, "expiresAt", "challenge");
  return { value: raw, problems: [] };
}
export function validatePerks(raw) {
  exact(raw, "perks", ["holder", "balance", "tier", "perks", "expiresAt"]);
  V.bool(raw, "holder", "perks"); V.dec(raw, "balance", "perks", { nonNegative: true }); V.oneOf(raw, "tier", "perks", TIERS);
  if (raw.holder !== (raw.tier !== "none")) throw new HqInvalid("perks.holder and perks.tier disagree");
  const { items, problems } = list(raw.perks, "perks.perks", (p, path) => { V.text({ p }, "p", path, { max: 80 }); return p; }, { max: 20 });
  if (problems.length) throw new HqInvalid(problems[0]);
  V.time(raw, "expiresAt", "perks");
  return { value: { ...raw, perks: items }, problems: [] };
}

/* GET /v1/stream: each event's data is the object its endpoint returns. A promotion and a fee
   name no agent in their endpoint's shape; on the stream they may carry "agentId". */
export const STREAM_EVENTS = Object.freeze(["trade", "decision", "promotion", "buyback", "fee", "summary"]);
export function validateStreamEvent(type, raw) {
  switch (type) {
    case "trade": return trade(raw, "stream.trade");
    case "decision": return decision(raw, "stream.decision");
    case "promotion": return promotion(raw, "stream.promotion", { withAgent: true });
    case "buyback": return buyback(raw, "stream.buyback");
    case "fee": return fee(raw, "stream.fee", { withAgent: true });
    case "summary": return summary(raw, "stream.summary");
    default: throw new HqInvalid(`stream event "${String(type).slice(0, 20)}" is not in the contract`);
  }
}
