/* AGENCY HQ: WHAT THE SITE ACCEPTS FROM IT.
   Every response HQ sends is checked here, field by field, against docs/hq/API.md before a page
   draws any of it. The checks are strict on purpose:

     · an unknown field, or a missing one, refuses the object (a changed contract fails loudly
       here instead of drawing something nobody checked);
     · every amount must be a decimal string in the contract's exact format ("12.5", "-0.03"; SOL
       to nine decimals at most): a JSON number, an exponent, a "+", a separator, a leading zero
       or a blank is refused;
     · every address must be base58 of an address's length, every signature base58 of a
       signature's, every time a real ISO-8601 UTC instant, every sprite or skin id an id;
     · a field is null only where the contract says it may be;
     · text is plain, within the contract's limits: what HQ writes itself (an agent's name, a rug
       check's detail, a perk, the buyback schedule) is refused with any control, bidi or
       zero-width character in it, or over its limit; text HQ passes on from elsewhere (a
       token's symbol, a coin's name, a model's reason), which HQ cleans before it stores it,
       is cleaned and cut again here, as a second line. The pages draw every word with
       textContent, never as markup;
     · a live trade must carry its transaction, and a paper trade must not (paper signs nothing);
       every buy trade, paper or live, carries Crying Cat's passed rug check (its four checks,
       once each, in order), and no sell or hold carries one;
     · a mode is paper or live: the summary has one block for each, and one board never mixes
       them.

   In a list, one bad entry is dropped (and counted, so the page can say so) rather than taking
   the whole list down; a bad top-level object is refused whole. Pure: no page, no network. */
import { ADDRESS, SIGNATURE, SLUG, isDecimal, isSol, isIsoTime, decCmp, RANK_IDS, STRATEGIES, CATS } from "./hq-format.js";

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

/* Text from elsewhere, made safe to show: hidden characters removed (a line break kept where
   asked), spaces folded, cut to max. Empty after that is refused. Written back in place: the
   object is HQ's freshly parsed answer, never anything the page already holds. */
function clean(o, k, path, max, { nullable = false } = {}) {
  const v = o[k];
  if (v === null && nullable) return;
  if (typeof v !== "string") bad(`${path}.${k}`, "must be text");
  let t = [...v.replace(/[\t\n\v\f\r]/g, " ")].filter((ch) => !HIDDEN.test(ch)).join("").replace(/\s+/g, " ").trim();
  if (!t) bad(`${path}.${k}`, "has no visible text");
  if ([...t].length > max) t = [...t].slice(0, max - 1).join("") + "…";
  o[k] = t;
}

const V = {
  /* "sol": SOL, to nine decimals at most; "units": token units, prices and percentages. */
  dec(o, k, path, { nullable = false, nonNegative = false, fmt = "sol" } = {}) {
    const v = o[k];
    if (v === null && nullable) return;
    if (!(fmt === "sol" ? isSol(v) : isDecimal(v))) bad(`${path}.${k}`, fmt === "sol" ? "must be a decimal string of SOL" : "must be a decimal string");
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
/* Crying Cat's rug check, made before a buy: mint and freeze authority, holders, the creator's
   share (API.md, RugCheck). */
export const RUG_CHECKS = Object.freeze(["mint_authority", "freeze_authority", "holders", "creator_share"]);
/* The contract's patterns and limits ("Formats, exactly"); test-site.mjs reads them out of
   docs/hq/API.md and compares. */
export const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const CURSOR = /^[A-Za-z0-9_-]{1,128}$/;
export const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
export const NUMBER = /^\d{3}$/;
export const AGENT_ID_MAX = 999;
export const TEXT_MAX = Object.freeze({ agentName: 48, symbol: 16, coinName: 64, reason: 500, detail: 500, perk: 120, schedule: 120 });
const AGENT_ID = { min: 1, max: AGENT_ID_MAX };

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
/* One mode's block of the summary: that mode's agents only. */
function modeSummary(o, path) {
  exact(o, path, ["agents", "trades24h", "solInAgentWallets", "tradingPnlSol", "wins", "losses", "maxDrawdownPct"]);
  exact(o.agents, `${path}.agents`, ["active", "total"]);
  V.int(o.agents, "active", `${path}.agents`); V.int(o.agents, "total", `${path}.agents`);
  if (o.agents.active > o.agents.total) bad(`${path}.agents`, "has more active agents than agents");
  exact(o.trades24h, `${path}.trades24h`, ["count", "volumeSol"]);
  V.int(o.trades24h, "count", `${path}.trades24h`); V.dec(o.trades24h, "volumeSol", `${path}.trades24h`, { nonNegative: true });
  V.dec(o, "solInAgentWallets", path, { nonNegative: true });
  exact(o.tradingPnlSol, `${path}.tradingPnlSol`, ["realized", "unrealized"]);
  V.dec(o.tradingPnlSol, "realized", `${path}.tradingPnlSol`); V.dec(o.tradingPnlSol, "unrealized", `${path}.tradingPnlSol`);
  V.int(o, "wins", path); V.int(o, "losses", path);
  /* The worst single agent's drawdown, never a sum: null with no agents, and only then. */
  V.dec(o, "maxDrawdownPct", path, { nullable: true, nonNegative: true, fmt: "units" });
  if ((o.maxDrawdownPct === null) !== (o.agents.total === 0)) bad(`${path}.maxDrawdownPct`, "is null exactly when the mode has no agents");
  return o;
}
function summary(o, path = "summary") {
  exact(o, path, ["updatedAt", "live", "paper", "creatorFeesClaimedSol", "buybacks", "treasury"]);
  V.time(o, "updatedAt", path);
  modeSummary(o.live, `${path}.live`);
  modeSummary(o.paper, `${path}.paper`);
  V.dec(o, "creatorFeesClaimedSol", path, { nonNegative: true });
  exact(o.buybacks, `${path}.buybacks`, ["count", "solSpent", "ciaBought"]);
  V.int(o.buybacks, "count", `${path}.buybacks`);
  V.dec(o.buybacks, "solSpent", `${path}.buybacks`, { nonNegative: true }); V.dec(o.buybacks, "ciaBought", `${path}.buybacks`, { nonNegative: true, fmt: "units" });
  treasuryHead(o.treasury, `${path}.treasury`, ["address", "sol", "cia"]);
  return o;
}
function treasuryHead(o, path, fields) {
  exact(o, path, fields);
  V.address(o, "address", path, { nullable: true });   // null while no treasury is configured
  V.dec(o, "sol", path, { nonNegative: true }); V.dec(o, "cia", path, { nonNegative: true, fmt: "units" });
}

const AGENT_FIELDS = ["id", "number", "name", "cat", "skin", "rank", "strategy", "mode", "status", "coin", "wallet", "hiredAt", "stats"];
const STAT_SOL = ["balanceSol", "portfolioSol", "realizedPnlSol", "unrealizedPnlSol", "careerRealizedSol", "feesClaimedSol", "depositedSol", "withdrawnSol"];
function agentFields(o, path) {
  V.int(o, "id", path, AGENT_ID);
  V.pattern(o, "number", path, NUMBER, "a three-digit agent number");
  if (o.number !== String(o.id).padStart(3, "0")) bad(`${path}.number`, "is not its id as three digits");
  V.text(o, "name", path, { max: TEXT_MAX.agentName });
  V.pattern(o, "cat", path, SLUG, "a sprite id");
  V.pattern(o, "skin", path, SLUG, "a skin id");
  V.oneOf(o, "rank", path, RANK_IDS);
  V.oneOf(o, "strategy", path, STRATEGY_IDS);
  V.oneOf(o, "mode", path, MODES);
  V.oneOf(o, "status", path, ["active", "paused", "retired"]);
  if (o.coin !== null) {
    exact(o.coin, `${path}.coin`, ["mint", "symbol", "name"]);
    /* Its symbol and name are null while the coin's metadata cannot be read. */
    V.address(o.coin, "mint", `${path}.coin`); clean(o.coin, "symbol", `${path}.coin`, TEXT_MAX.symbol, { nullable: true }); clean(o.coin, "name", `${path}.coin`, TEXT_MAX.coinName, { nullable: true });
  }
  V.address(o, "wallet", path);
  V.time(o, "hiredAt", path);
  const s = exact(o.stats, `${path}.stats`, [...STAT_SOL, "trades", "wins", "losses", "maxDrawdownPct", "roiPct"]);
  for (const k of STAT_SOL) V.dec(s, k, `${path}.stats`, { nonNegative: !["realizedPnlSol", "unrealizedPnlSol"].includes(k) });
  V.dec(s, "maxDrawdownPct", `${path}.stats`, { nonNegative: true, fmt: "units" });
  V.dec(s, "roiPct", `${path}.stats`, { nullable: true, fmt: "units" });
  for (const k of ["trades", "wins", "losses"]) V.int(s, k, `${path}.stats`);
  if (s.wins + s.losses > s.trades) bad(`${path}.stats`, "has more wins and losses than trades");
  return o;
}
function agent(o, path = "agent") { exact(o, path, AGENT_FIELDS); return agentFields(o, path); }

/* Crying Cat's check: exactly its four checks, once each, in the contract's order, and passed
   exactly when all four pass. */
function rugCheck(o, path) {
  exact(o, path, ["passed", "checks"]);
  V.bool(o, "passed", path);
  if (!Array.isArray(o.checks) || o.checks.length !== RUG_CHECKS.length) bad(`${path}.checks`, `must list exactly the ${RUG_CHECKS.length} checks`);
  o.checks.forEach((c, i) => {
    const p = `${path}.checks[${i}]`;
    exact(c, p, ["id", "pass", "detail"]);
    if (c.id !== RUG_CHECKS[i]) bad(`${p}.id`, `must be ${RUG_CHECKS[i]} (the checks come once each, in order: ${RUG_CHECKS.join(", ")})`);
    V.bool(c, "pass", p); V.text(c, "detail", p, { max: TEXT_MAX.detail });
  });
  if (o.passed !== o.checks.every((c) => c.pass)) bad(path, "says passed when a check failed, or failed when all passed");
}

function decision(o, path = "decision") {
  exact(o, path, ["kind", "id", "t", "agentId", "action", "mint", "symbol", "reason", "rugCheck", "mode"]);
  if (o.kind !== "decision") bad(`${path}.kind`, 'must be "decision"');
  V.pattern(o, "id", path, ITEM_ID, "an id");
  V.time(o, "t", path);
  V.int(o, "agentId", path, AGENT_ID);
  V.oneOf(o, "action", path, ["buy", "sell", "hold"]);
  V.address(o, "mint", path, { nullable: true });
  clean(o, "symbol", path, TEXT_MAX.symbol, { nullable: true });
  clean(o, "reason", path, TEXT_MAX.reason);
  V.oneOf(o, "mode", path, MODES);
  /* A buy decision carries the check once it ran (passed or refused); a sell or a hold never. */
  if (o.rugCheck !== null) {
    if (o.action !== "buy") bad(`${path}.rugCheck`, "is only for a buy");
    rugCheck(o.rugCheck, `${path}.rugCheck`);
  }
  return o;
}
function trade(o, path = "trade") {
  exact(o, path, ["kind", "id", "t", "agentId", "side", "mint", "symbol", "sol", "tokens", "price", "pnlSol", "pnlPct", "trigger", "rugCheck", "tx", "mode"]);
  if (o.kind !== "trade") bad(`${path}.kind`, 'must be "trade"');
  V.pattern(o, "id", path, ITEM_ID, "an id");
  V.time(o, "t", path);
  V.int(o, "agentId", path, AGENT_ID);
  V.oneOf(o, "side", path, ["buy", "sell"]);
  V.address(o, "mint", path);
  clean(o, "symbol", path, TEXT_MAX.symbol);
  V.dec(o, "sol", path, { nonNegative: true }); V.dec(o, "tokens", path, { nonNegative: true, fmt: "units" }); V.dec(o, "price", path, { nonNegative: true, fmt: "units" });
  V.dec(o, "pnlSol", path, { nullable: true }); V.dec(o, "pnlPct", path, { nullable: true, fmt: "units" });
  V.oneOf(o, "trigger", path, TRIGGERS);
  V.oneOf(o, "mode", path, MODES);
  V.signature(o, "tx", path, { nullable: true });
  if (o.mode === "live" && o.tx === null) bad(`${path}.tx`, "is missing on a live trade");
  if (o.mode === "paper" && o.tx !== null) bad(`${path}.tx`, "is set on a paper trade, which signs nothing");
  /* Every buy trade carries Crying Cat's check, and it passed (a refused buy is a decision, and
     no trade follows it); a sell never carries one. */
  if (o.side === "buy") {
    if (o.rugCheck === null) bad(`${path}.rugCheck`, "is missing on a buy: every buy is rug-checked first");
    rugCheck(o.rugCheck, `${path}.rugCheck`);
    if (!o.rugCheck.passed) bad(`${path}.rugCheck`, "failed, yet the buy went through");
  } else if (o.rugCheck !== null) bad(`${path}.rugCheck`, "is only for a buy");
  return o;
}
function deskItem(o, path) {
  if (!isObject(o)) bad(path, "must be an object");
  if (o.kind === "trade") return trade(o, path);
  if (o.kind === "decision") return decision(o, path);
  return bad(`${path}.kind`, 'must be "trade" or "decision"');
}
/* In a dossier a promotion and a fee are listed under their agent; on the stream they say whose
   they are (a promotion its agent and mode, a fee its agent). */
function promotion(o, path, { onStream = false } = {}) {
  exact(o, path, onStream ? ["agentId", "mode", "t", "from", "to"] : ["t", "from", "to"]);
  if (onStream) { V.int(o, "agentId", path, AGENT_ID); V.oneOf(o, "mode", path, MODES); }
  V.time(o, "t", path); V.oneOf(o, "from", path, RANK_IDS); V.oneOf(o, "to", path, RANK_IDS);
  if (RANK_IDS.indexOf(o.to) <= RANK_IDS.indexOf(o.from)) bad(path, "is not a promotion (a loss never demotes)");
  return o;
}
function fee(o, path, { onStream = false } = {}) {
  exact(o, path, onStream ? ["agentId", "t", "sol", "tx"] : ["t", "sol", "tx"]);
  if (onStream) V.int(o, "agentId", path, AGENT_ID);
  V.time(o, "t", path); V.dec(o, "sol", path, { nonNegative: true }); V.signature(o, "tx", path);
  return o;
}
function buyback(o, path) {
  exact(o, path, ["t", "solSpent", "ciaBought", "price", "tx", "burnTx"]);
  V.time(o, "t", path);
  /* A buyback is always a real transaction: its tx and price are never null; only burnTx is. */
  V.dec(o, "solSpent", path, { nonNegative: true }); V.dec(o, "ciaBought", path, { nonNegative: true, fmt: "units" }); V.dec(o, "price", path, { nonNegative: true, fmt: "units" });
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
  V.dec(L, "stopLossPct", `${path}.limits`, { nonNegative: true, fmt: "units" }); V.dec(L, "takeProfitPct", `${path}.limits`, { nonNegative: true, fmt: "units" });
  V.dec(L, "trailingStopPct", `${path}.limits`, { nullable: true, nonNegative: true, fmt: "units" }); V.dec(L, "dailyLossLimitSol", `${path}.limits`, { nonNegative: true });
  const problems = [];
  const take = (r) => { problems.push(...r.problems); return r.items; };
  const positions = take(list(raw.positions, `${path}.positions`, (p, pp) => {
    exact(p, pp, ["mint", "symbol", "costSol", "valueSol", "entryPrice", "price", "pnlSol", "pnlPct", "openedAt"]);
    V.address(p, "mint", pp); clean(p, "symbol", pp, TEXT_MAX.symbol);
    V.dec(p, "costSol", pp, { nonNegative: true }); V.dec(p, "valueSol", pp, { nonNegative: true }); V.dec(p, "entryPrice", pp, { nonNegative: true, fmt: "units" });
    /* With no quote for the token just now, the price and its percent are null, never guessed. */
    V.dec(p, "price", pp, { nonNegative: true, nullable: true, fmt: "units" }); V.dec(p, "pnlSol", pp); V.dec(p, "pnlPct", pp, { nullable: true, fmt: "units" }); V.time(p, "openedAt", pp);
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
    /* A paper agent's bankroll is paper too: its transfers carry no transaction; a live one's must. */
    V.dec(x, "sol", p, { nonNegative: true }); V.signature(x, "tx", p, { nullable: raw.mode === "paper" }); return x;
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
  /* value: a percentage (by=roi) or SOL (by=pnl), both in SOL's format; rank: the agent's rank
     id; the rows best first, a row's place being its position. */
  const { items, problems } = list(raw.rows, "leaderboard.rows", (r, p) => {
    exact(r, p, ["agentId", "value", "rank", "mode"]);
    V.int(r, "agentId", p, AGENT_ID); V.dec(r, "value", p); V.oneOf(r, "rank", p, RANK_IDS); V.oneOf(r, "mode", p, MODES);
    return r;
  }, { max: 500 });
  if (new Set(items.map((r) => r.agentId)).size !== items.length) throw new HqInvalid("leaderboard lists one agent twice");
  for (let i = 1; i < items.length; i++) if (decCmp(items[i].value, items[i - 1].value) > 0) throw new HqInvalid(`leaderboard.rows are not best first (row ${i + 1} beats the row above it)`);
  /* Paper and live are ranked separately: two boards, never one. */
  const boards = { live: items.filter((r) => r.mode === "live"), paper: items.filter((r) => r.mode === "paper") };
  return { value: { period: raw.period, by: raw.by, boards }, problems };
}
export function validateBuybacks(raw) {
  exact(raw, "buybacks", ["policy", "items"]);
  const P = exact(raw.policy, "buybacks.policy", ["sharePct", "sources", "schedule", "destination"]);
  V.dec(P, "sharePct", "buybacks.policy", { nonNegative: true, fmt: "units" });
  if (!Array.isArray(P.sources) || P.sources.length === 0 || P.sources.length > BUYBACK_SOURCES.length || new Set(P.sources).size !== P.sources.length || !P.sources.every((s) => BUYBACK_SOURCES.includes(s)))
    throw new HqInvalid(`buybacks.policy.sources must list ${BUYBACK_SOURCES.join(" and/or ")}`);
  V.text(P, "schedule", "buybacks.policy", { max: TEXT_MAX.schedule });
  V.oneOf(P, "destination", "buybacks.policy", ["burn", "treasury"]);
  const { items, problems } = list(raw.items, "buybacks.items", buyback, { max: 500 });
  return { value: { policy: P, items: items.sort(newestFirst) }, problems };
}
export function validateTreasury(raw) {
  exact(raw, "treasury", ["address", "sol", "cia", "flows"]);
  treasuryHead({ address: raw.address, sol: raw.sol, cia: raw.cia }, "treasury", ["address", "sol", "cia"]);
  const { items, problems } = list(raw.flows, "treasury.flows", (f, p) => {
    /* Never negative: a flow's direction is its kind. */
    exact(f, p, ["t", "kind", "sol", "tx"]); V.time(f, "t", p); V.oneOf(f, "kind", p, FLOW_KINDS); V.dec(f, "sol", p, { nonNegative: true }); V.signature(f, "tx", p); return f;
  }, { max: 1000 });
  return { value: { address: raw.address, sol: raw.sol, cia: raw.cia, flows: items.sort(newestFirst) }, problems };
}
/* GET /v1/perks: the tiers, lowest first, each with the $CIA it needs, as the owner set them. */
export const TIER_IDS = Object.freeze(["holder", "agent", "director"]);
export function validateTiers(raw) {
  exact(raw, "perks", ["tiers"]);
  if (!Array.isArray(raw.tiers) || raw.tiers.length > TIER_IDS.length) throw new HqInvalid("perks.tiers must be a list of at most three tiers");
  raw.tiers.forEach((t, i) => {
    const p = `perks.tiers[${i}]`;
    exact(t, p, ["id", "minCia", "perks"]);
    V.oneOf(t, "id", p, TIER_IDS); V.dec(t, "minCia", p, { nonNegative: true, fmt: "units" });
    if (!Array.isArray(t.perks) || t.perks.length > 20) bad(`${p}.perks`, "must be a list of at most 20 perks");
    t.perks.forEach((_, j) => V.text(t.perks, j, `${p}.perks`, { max: TEXT_MAX.perk }));
    if (i > 0) {
      const prev = raw.tiers[i - 1];
      if (TIER_IDS.indexOf(t.id) <= TIER_IDS.indexOf(prev.id)) bad(p, "is out of order, or repeats a tier");
      if (decCmp(t.minCia, prev.minCia) < 0) bad(`${p}.minCia`, "is lower than the tier below it");
    }
  });
  return { value: raw, problems: [] };
}
/* GET /v1/perks/challenge: { wallet, nonce, message, expiresAt }. The site signs the message only
   if it is plain text, untouched, that names the site, the wallet signing it and the nonce. */
export function validateChallenge(raw, wallet) {
  exact(raw, "challenge", ["wallet", "nonce", "message", "expiresAt"]);
  V.address(raw, "wallet", "challenge");
  if (raw.wallet !== wallet) throw new HqInvalid("challenge.wallet is not the connected wallet");
  V.pattern(raw, "nonce", "challenge", NONCE, "a nonce");
  if (typeof raw.message !== "string" || raw.message.length < 16 || raw.message.length > 600 || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(raw.message))
    throw new HqInvalid("challenge.message must be 16 to 600 characters of plain text");
  for (const [what, needle] of [["the site", "catintelligenceagency.com"], ["the wallet signing it", wallet], ["its nonce", raw.nonce]])
    if (!raw.message.includes(needle)) throw new HqInvalid(`challenge.message does not name ${what}`);
  V.time(raw, "expiresAt", "challenge");
  return { value: raw, problems: [] };
}
export function validatePerks(raw) {
  exact(raw, "perks", ["holder", "balance", "tier", "perks", "expiresAt"]);
  V.bool(raw, "holder", "perks"); V.dec(raw, "balance", "perks", { nonNegative: true, fmt: "units" }); V.oneOf(raw, "tier", "perks", TIERS);
  if (raw.holder !== (raw.tier !== "none")) throw new HqInvalid("perks.holder and perks.tier disagree");
  if (!Array.isArray(raw.perks) || raw.perks.length > 20) throw new HqInvalid("perks.perks must be a list of at most 20 perks");
  raw.perks.forEach((_, j) => V.text(raw.perks, j, "perks.perks", { max: TEXT_MAX.perk }));
  V.time(raw, "expiresAt", "perks");
  return { value: raw, problems: [] };
}

/* GET /v1/stream: each event's data is the object its endpoint returns, except that a promotion
   and a fee say whose they are. */
export const STREAM_EVENTS = Object.freeze(["trade", "decision", "promotion", "buyback", "fee", "summary"]);
export function validateStreamEvent(type, raw) {
  switch (type) {
    case "trade": return trade(raw, "stream.trade");
    case "decision": return decision(raw, "stream.decision");
    case "promotion": return promotion(raw, "stream.promotion", { onStream: true });
    case "buyback": return buyback(raw, "stream.buyback");
    case "fee": return fee(raw, "stream.fee", { onStream: true });
    case "summary": return summary(raw, "stream.summary");
    default: throw new HqInvalid(`stream event "${String(type).slice(0, 20)}" is not in the contract`);
  }
}
