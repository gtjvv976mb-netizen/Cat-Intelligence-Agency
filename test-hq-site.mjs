/**
 * AGENCY HQ ON THE SITE: WHAT IT ACCEPTS, HOW IT WRITES A NUMBER, AND WHERE IT MAY CALL.
 *
 * The HQ pages (site/hq/, site/hq/agent/, site/investors/, site/perks/, and the home page's HQ
 * band) read Agency HQ through one module, site/assets/hq-client.js, and check every answer
 * with site/assets/hq-validate.js against docs/hq/API.md. This file runs those modules in Node:
 *
 *   · THE NUMBERS ARE WRITTEN FROM THE DIGITS. SOL, percents, token amounts and prices are
 *     formatted from HQ's decimal strings without floating point; a sign is + or the minus
 *     sign; a gain is "up" and a loss "down"; times read "5m ago" and "2026-09-24 21:08 UTC".
 *   · THE VALIDATORS ARE STRICT. An unknown or missing field, a JSON number where an amount
 *     should be a decimal string, a bad address, signature or time, hidden characters, a live
 *     trade with no transaction or a paper trade with one: each is refused. A bad entry in a
 *     list is dropped and counted; a bad object is refused whole.
 *   · THE CLIENT CALLS ONLY HQ. Only https://api.catintelligenceagency.com (or localhost in
 *     development) is an HQ origin; with none, nothing is fetched. Requests carry no cookies,
 *     no referrer and follow no redirect; the one POST carries the wallet, the message and the
 *     signature and nothing else; an answer that is not JSON, or does not match, is refused.
 *   · THE MOCK IS THE CONTRACT'S SHAPE. Every answer scripts/hq-mock.mjs gives passes the
 *     same validators, in every mode, so the pages were built against the contract, not
 *     against the mock.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as F from "./site/assets/hq-format.js";
import * as V from "./site/assets/hq-validate.js";
import { hqClient, hqOrigin, HqError, HQ_ORIGINS } from "./site/assets/hq-client.js";
import { mockWorld, resumeFrom } from "./scripts/hq-mock.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const bs58 = require("bs58");
let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? "  — " + detail : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const section = (t) => console.log(`\n${t}\n${"─".repeat(t.length)}`);
const refuses = (fn) => { try { fn(); return false; } catch (e) { return e instanceof V.HqInvalid; } };
const clone = (x) => JSON.parse(JSON.stringify(x));
const M = "−";

section("THE NUMBERS ARE WRITTEN FROM THE DIGITS");
{
  const sol = (s, o) => F.fmtSol(s, o);
  ok("SOL: 4 decimals under 1, 3 from 1, 2 from 100, grouped", sol("0.0412") === "0.0412" && sol("1.23456") === "1.235" && sol("123.456") === "123.46" && sol("1234567.891") === "1,234,567.89");
  ok("SOL: a tiny amount keeps three significant digits and is never shown as 0", sol("0.0000123") === "0.0000123" && sol("0.000000001") === "0.000000001");
  ok("SOL: signed gains carry +, losses the minus sign (U+2212), zero neither", sol("1.5", { signed: true }) === "+1.500" && sol("-1.58", { signed: true }) === `${M}1.580` && sol("0", { signed: true }) === "0" && sol("-0", { signed: true }) === "0");
  ok("SOL: unsigned, a loss still shows its minus sign", sol("-0.5") === `${M}0.5000`);
  ok("SOL: rounds half away from zero on the digits, never through a float", sol("0.000012355") === "0.0000124" && sol("-0.00005", { signed: true }) === `${M}0.00005` && sol("2.0005") === "2.001" && sol("1.0045") === "1.005" && sol("0.30000000000000004") === "0.3000");
  ok("percent: signed by default, one decimal, two under 1%, none from 1,000%", F.fmtPct("12.345") === "+12.3%" && F.fmtPct("-3.25") === `${M}3.3%` && F.fmtPct("0.04") === "+0.04%" && F.fmtPct("1234.5") === "+1,235%" && F.fmtPct("0") === "0%" && F.fmtPct("50", { signed: false }) === "50.0%");
  ok("tokens: compact from a thousand, with the next unit when rounding reaches it", F.fmtTokens("123") === "123" && F.fmtTokens("1234.5") === "1.23K" && F.fmtTokens("999999") === "1M" && F.fmtTokens("10000000") === "10M" && F.fmtTokens("1840000") === "1.84M" && F.fmtTokens("12345678901") === "12.3B" && F.fmtTokens("0.5") === "0.5");
  ok("price: tiny prices keep their zeros countable (0.0₆31)", F.fmtPrice("0.00000031") === "0.0₆31" && F.fmtPrice("0.0123") === "0.0123" && F.fmtPrice("2.5") === "2.5" && F.fmtPrice("0") === "0" && F.fmtPrice("0.000004567891") === "0.0₅4568");
  ok("counts: grouped whole numbers, a dash for anything else", F.fmtCount(1234567) === "1,234,567" && F.fmtCount(0) === "0" && F.fmtCount(1.5) === "—");
  ok("sign colours: up for a gain, down for a loss, flat for zero or none", F.signClass("0.1") === "up" && F.signClass("-0.1") === "down" && F.signClass("0") === "flat" && F.signClass("-0.000") === "flat" && F.signClass(null) === "flat");
  const now = Date.parse("2026-09-25T12:00:00Z");
  ok("time: just now, seconds, minutes, hours, days, then the date", F.fmtAgo("2026-09-25T11:59:55Z", now) === "just now" && F.fmtAgo("2026-09-25T11:59:18Z", now) === "42s ago"
    && F.fmtAgo("2026-09-25T11:55:00Z", now) === "5m ago" && F.fmtAgo("2026-09-25T09:00:00Z", now) === "3h ago" && F.fmtAgo("2026-09-23T12:00:00Z", now) === "2d ago" && F.fmtAgo("2026-08-01T00:00:00Z", now) === "2026-08-01");
  ok("time: a time in the future is shown as its UTC stamp, not as \"ago\"", F.fmtAgo("2026-09-25T13:00:00Z", now) === "2026-09-25 13:00 UTC");
  ok("time: UTC stamps and dates", F.fmtUtc("2026-09-24T21:08:50Z") === "2026-09-24 21:08 UTC" && F.fmtDate("2026-09-24T21:08:50Z") === "2026-09-24");
  ok("ISO times: real UTC instants only", F.isIsoTime("2026-09-25T10:00:00Z") && F.isIsoTime("2026-09-25T10:00:00.123Z") && !F.isIsoTime("2026-02-30T00:00:00Z")
    && !F.isIsoTime("2026-09-25T10:00:00+02:00") && !F.isIsoTime("2026-09-25 10:00:00Z") && !F.isIsoTime("2026-09-25T24:00:00Z") && !F.isIsoTime(1758794400000) && !F.isIsoTime("1999-01-01T00:00:00Z"));
}

section("DECIMALS: SUMS AND COMPARISONS ON THE DIGITS");
{
  ok("0.1 + 0.2 is 0.3, exactly", F.decAdd("0.1", "0.2") === "0.3");
  ok("sums, differences and comparisons keep every digit", F.decSub("1", "1.25") === "-0.25" && F.decSum(["1", "-2.5", "0.000000001"]) === "-1.499999999" && F.decCmp("1.10", "1.1") === 0 && F.decCmp("-0.1", "0") === -1);
  ok("rounding for display: half away from zero, to exactly the places asked", F.roundDec("2.5", 0) === "3" && F.roundDec("-2.5", 0) === "-3" && F.roundDec("-0.00004", 4) === "0.0000" && F.roundDec("1.999", 2) === "2.00");
  ok("a ratio is a number only for a bar's length", F.decRatio("1", "4") === 0.25 && F.decRatio("1", "0") === null);
  ok("anything that is not a decimal string is refused by the maths", ["1e3", "NaN", "", " 1", "0x10", "1,000", "+1", "01", ".5", "5."].every((s) => { try { F.decAdd(s, "0"); return false; } catch { return true; } }));
}

section("RANKS, WIN RATE AND THE AGENCY'S RECORD BY MODE");
{
  ok("the rank for a career follows the contract's thresholds", F.rankForCareer("0.2499") === "recruit" && F.rankForCareer("0.25") === "field" && F.rankForCareer("1") === "special" && F.rankForCareer("4.99") === "special" && F.rankForCareer("5") === "senior" && F.rankForCareer("25") === "director" && F.rankForCareer("-3") === "recruit");
  const p = F.rankProgress("field", "0.5");
  ok("progress: the SOL still to make, and how much of the step is made", p.next.id === "special" && p.remaining === "0.5" && Math.abs(p.pct - 33.3333) < 0.01);
  const q = F.rankProgress("special", "0.5");
  ok("a loss never demotes: a rank above its career figure keeps its rank, at 0% of the next step", q.rank.id === "special" && q.pct === 0 && q.remaining === "4.5");
  ok("the top rank has no next", F.rankProgress("director", "30").next === null && F.rankProgress("director", "30").pct === 100 && F.rankProgress("nope", "1") === null);
  ok("win rate: wins over closed trades, one decimal; none closed is null", F.winRate(1, 2) === "33.3" && F.winRate(10, 48) === "17.2" && F.winRate(3, 0) === "100.0" && F.winRate(0, 0) === null);
  const sum = mockWorld({ mode: "mixed" }).summary(), none = mockWorld({ mode: "live", empty: true }).summary();
  const L = F.modeRecord(sum.live), P = F.modeRecord(sum.paper), E = F.modeRecord(none.paper);
  ok("one mode's record is the summary's block for it, as HQ sends it, with its win rate from its own wins and losses",
    L.hasAgents && P.hasAgents && L.winRatePct === F.winRate(sum.live.wins, sum.live.losses) && P.tradingPnlSol.realized === sum.paper.tradingPnlSol.realized && L.maxDrawdownPct === sum.live.maxDrawdownPct);
  ok("with no agent in a mode, its record says so: no win rate and no drawdown, not zeros", !E.hasAgents && E.winRatePct === null && E.maxDrawdownPct === null);
  ok("hq-format has nothing that adds paper and live together", !("modeTotals" in F));
}

section("LINKS ARE BUILT ONLY FROM CHECKED ADDRESSES AND SIGNATURES");
{
  const addr = "EDVtiBjPVeHTeKuvv1TMSC3vdsMUabZSaaoLRpiTpump", sig = "5".repeat(88);
  ok("Solscan, pump.fun and GMGN links for a real-looking address or signature", F.solscanTx(sig) === `https://solscan.io/tx/${sig}` && F.solscanAccount(addr) === `https://solscan.io/account/${addr}`
    && F.solscanToken(addr) === `https://solscan.io/token/${addr}` && F.pumpFun(addr) === `https://pump.fun/coin/${addr}` && F.gmgn(addr) === `https://gmgn.ai/sol/token/${addr}`);
  const BAD = ["", "javascript:alert(1)", `${addr}/../x`, `${addr}?a=1`, "0OIl".repeat(10), "a".repeat(31), "a".repeat(45), null, 42, `https://evil.example/${addr}`, `${addr} `];
  ok("anything else builds no link at all", BAD.every((b) => F.solscanTx(b) === "" && F.solscanAccount(b) === "" && F.solscanToken(b) === "" && F.pumpFun(b) === "" && F.gmgn(b) === ""));
  ok("an agent's dossier path only for a positive whole id", F.agentPath(3) === "hq/agent/?id=3" && [0, -1, 1.5, "3", NaN, 2 ** 60].every((x) => F.agentPath(x) === ""));
  ok("the only hosts a link can go to", JSON.stringify(F.LINK_HOSTS) === '["solscan.io","pump.fun","gmgn.ai"]');
  ok("short addresses and tickers", F.shortAddr(addr) === "EDVt…pump" && F.ticker("MOCK") === "$MOCK" && F.ticker("$$MOCK") === "$MOCK");
  let same = true;
  for (let i = 0; i < 300 && same; i++) { const b = randomBytes(i % 70); if (i % 5 === 0 && b.length > 2) b.fill(0, 0, 2); same = F.base58(b) === bs58.encode(b); }
  ok("a signature's bytes become the same base58 as the bs58 package's", same && F.base58(new Uint8Array(64)) === "1".repeat(64));
}

section("THE VALIDATORS ARE STRICT");
const W = mockWorld({ mode: "mixed" });
const good = {
  summary: W.summary(), agents: W.agents(), detail: W.agent(2), desk: W.desk(50), board: W.leaderboard("roi", "30d"),
  buybacks: W.buybacks(), treasury: W.treasury(),
};
{
  ok("well-formed answers pass: summary, agents, a dossier, the desk, a board, buybacks, the treasury",
    V.validateSummary(clone(good.summary)).problems.length === 0 && V.validateAgents(clone(good.agents)).problems.length === 0
      && V.validateAgentDetail(clone(good.detail), 2).problems.length === 0 && V.validateDesk(clone(good.desk)).problems.length === 0
      && V.validateLeaderboard(clone(good.board)).problems.length === 0 && V.validateBuybacks(clone(good.buybacks)).problems.length === 0
      && V.validateTreasury(clone(good.treasury)).problems.length === 0);
  /* An extra field anywhere in an object is refused: at the top, and in each nested object. */
  const withExtra = (obj, pathKeys) => { const o = clone(obj); let t = o; for (const k of pathKeys) t = t[k]; t.surprise = 1; return o; };
  ok("an unknown field is refused, at every level of the summary", [[], ["live"], ["paper"], ["live", "agents"], ["paper", "trades24h"], ["live", "tradingPnlSol"], ["buybacks"], ["treasury"]].every((p) => refuses(() => V.validateSummary(withExtra(good.summary, p)))));
  ok("the summary has a live block and a paper block, and no mode of its own (\"mixed\" is gone)", refuses(() => V.validateSummary({ ...clone(good.summary), mode: "mixed" }))
    && ["live", "paper"].every((m) => { const o = clone(good.summary); delete o[m]; return refuses(() => V.validateSummary(o)); }));
  ok("a mode's worst drawdown is null exactly when it has no agents", (() => { const o = clone(good.summary); o.live.maxDrawdownPct = null; return refuses(() => V.validateSummary(o)); })()
    && (() => { const o = clone(mockWorld({ mode: "live", empty: true }).summary()); o.paper.maxDrawdownPct = "0"; return refuses(() => V.validateSummary(o)); })()
    && !refuses(() => V.validateSummary(clone(mockWorld({ mode: "live", empty: true }).summary()))));
  ok("an unknown field in an agent drops that agent and counts it", [[], ["stats"], ["coin"]].every((p) => {
    const o = clone(good.agents); let t = o.agents[1]; for (const k of p) t = t[k]; t.surprise = 1;
    const r = V.validateAgents(o); return r.problems.length === 1 && r.value.agents.length === good.agents.agents.length - 1 && /unknown field "surprise"/.test(r.problems[0]);
  }));
  ok("an unknown field in a dossier's own fields or limits refuses the dossier", refuses(() => V.validateAgentDetail(withExtra(good.detail, []), 2)) && refuses(() => V.validateAgentDetail(withExtra(good.detail, ["limits"]), 2)) && refuses(() => V.validateAgentDetail(withExtra(good.detail, ["stats"]), 2)));
  ok("a missing field is refused", ["updatedAt", "creatorFeesClaimedSol", "treasury"].every((k) => { const o = clone(good.summary); delete o[k]; return refuses(() => V.validateSummary(o)); })
    && (() => { const o = clone(good.summary); delete o.paper.wins; return refuses(() => V.validateSummary(o)); })());
  const BAD_AMOUNTS = [1.5, 0, "1e3", "1E-9", "NaN", "Infinity", "", " 1", "1 ", "1,000", "+1", "01", "00.5", ".5", "5.", "0x10", "1_000", "١", null, true, [], {}];
  ok("an amount that is not a decimal string is refused, a JSON number included", BAD_AMOUNTS.every((x) => { const o = clone(good.summary); o.live.solInAgentWallets = x; return refuses(() => V.validateSummary(o)); }), `${BAD_AMOUNTS.length} bad amounts`);
  ok("SOL has at most nine decimals (a lamport); token units, prices and percentages any number", (() => { const o = clone(good.summary); o.live.solInAgentWallets = "1.1234567891"; return refuses(() => V.validateSummary(o)); })()
    && (() => { const o = clone(good.summary); o.live.solInAgentWallets = "1.123456789"; o.buybacks.ciaBought = "1.123456789012"; return !refuses(() => V.validateSummary(o)); })()
    && !refuses(() => V.validateStreamEvent("trade", { ...clone(good.detail.trades.find((t) => t.side === "buy")), price: "0.000000000012345678" })));
  ok("a negative balance, volume or fee total is refused; a negative P&L is not", (() => { const o = clone(good.summary); o.live.solInAgentWallets = "-1"; return refuses(() => V.validateSummary(o)); })()
    && (() => { const o = clone(good.summary); o.creatorFeesClaimedSol = "-0.1"; return refuses(() => V.validateSummary(o)); })()
    && (() => { const o = clone(good.summary); o.paper.tradingPnlSol.realized = "-12.5"; return !refuses(() => V.validateSummary(o)); })());
  const BAD_ADDR = ["", "short", "0".repeat(44), "O".repeat(44), "I".repeat(44), "l".repeat(44), "a".repeat(31), "a".repeat(45), `${"a".repeat(43)} `, 12345, null];
  ok("a treasury address that is not base58 of an address's length is refused (null means none is configured)", BAD_ADDR.filter((x) => x !== null).every((x) => { const o = clone(good.summary); o.treasury.address = x; return refuses(() => V.validateSummary(o)); }));
  ok("a bad wallet drops the agent", BAD_ADDR.every((x) => { const o = clone(good.agents); o.agents[0].wallet = x; return V.validateAgents(o).problems.length === 1; }));
  const BAD_TIME = ["2026-09-25", "2026-09-25T10:00:00", "2026-09-25T10:00:00+00:00", "2026-13-01T00:00:00Z", 1758794400, "yesterday"];
  ok("a time that is not a real ISO-8601 UTC instant is refused", BAD_TIME.every((x) => { const o = clone(good.summary); o.updatedAt = x; return refuses(() => V.validateSummary(o)); }));
  const BAD_TEXT = ["", "   ", "a‮b", "zero​width", "line\nbreak", "tab\there", "x".repeat(49), 7];
  ok("a name with hidden, bidi or control characters, blank, or too long, drops the agent", BAD_TEXT.every((x) => { const o = clone(good.agents); o.agents[0].name = x; return V.validateAgents(o).problems.length === 1; }));
  ok("enums: a mode, rank, strategy or status not in the contract, or a sprite or skin id that is not an id, drops the agent", [["mode", "mixed"], ["rank", "general"], ["strategy", "yolo"], ["status", "fired"], ["cat", "Dog Cat!"], ["skin", "Bad Skin!"], ["number", "7"]]
    .every(([k, v]) => { const o = clone(good.agents); o.agents[0][k] = v; return V.validateAgents(o).problems.length === 1; }));
  ok("impossible stats drop the agent: more wins and losses than trades, a fractional count", (() => { const o = clone(good.agents); o.agents[0].stats.wins = o.agents[0].stats.trades + 1; return V.validateAgents(o).problems.length === 1; })()
    && (() => { const o = clone(good.agents); o.agents[0].stats.trades = 2.5; return V.validateAgents(o).problems.length === 1; })());
  ok("one id twice refuses the list", (() => { const o = clone(good.agents); o.agents[1].id = o.agents[0].id; o.agents[1].number = o.agents[0].number; return refuses(() => V.validateAgents(o)); })());
  ok("a coin may be null; a roiPct may be null", (() => { const o = clone(good.agents); o.agents[0].coin = null; o.agents[0].stats.roiPct = null; return V.validateAgents(o).problems.length === 0; })());
  ok("the contract's nulls and ids pass: a coin whose metadata cannot be read, a sprite the site has no art for, no treasury configured",
    (() => { const o = clone(good.agents); o.agents[1].coin.symbol = null; o.agents[1].coin.name = null; o.agents[2].cat = "agent-cat"; return V.validateAgents(o).problems.length === 0; })()
      && (() => { const o = clone(good.summary); o.treasury.address = null; return !refuses(() => V.validateSummary(o)); })()
      && F.coinLabel({ mint: "EDVtiBjPVeHTeKuvv1TMSC3vdsMUabZSaaoLRpiTpump", symbol: null, name: null }) === "EDVt…pump" && F.catOf({ cat: "agent-cat", strategy: "popcat-scout" }) === "popcat" && F.catOf({ cat: "snipurr", strategy: "popcat-scout" }) === "snipurr");
  ok("a position with no recent quote has a null price and percent; a paper agent's transfers carry no transaction, a live agent's must",
    (() => { const d = clone(W.agent(2)); d.positions = [clone(W.agent(4).positions[1])]; return d.positions[0].price === null && d.positions[0].pnlPct === null && V.validateAgentDetail(d, 2).problems.length === 0; })()
      && (() => { const d = clone(W.agent(1)); d.transfers[0].tx = null; return d.mode === "paper" && V.validateAgentDetail(d, 1).problems.length === 0; })()
      && (() => { const d = clone(W.agent(2)); d.transfers[0].tx = null; return d.mode === "live" && V.validateAgentDetail(d, 2).problems.length === 1; })());
  ok("a dossier for another id than the one asked for is refused", refuses(() => V.validateAgentDetail(clone(good.detail), 3)));
  /* Agent 4 holds three positions: quoted, then one with no quote for three hours, then quoted.
     Agent 8's third has had none for thirty hours, and is valued at 0. */
  const posProblems = (patch, i = 0, id = 4) => { const d = clone(W.agent(id)); Object.assign(d.positions[i], patch); for (const k of Object.keys(patch)) if (patch[k] === undefined) delete d.positions[i][k]; return V.validateAgentDetail(d, id).problems.length; };
  const P0 = W.agent(4).positions[0], P1 = W.agent(4).positions[1];
  ok("a position says when it was last quoted: markAt, an ISO time, or null if it never was; missing, or not a time, drops it",
    P0.price !== null && F.isIsoTime(P0.markAt) && posProblems({}) === 0 && posProblems({ markAt: undefined }) === 1 && ["yesterday", 1758794400, "2026-09-25", ""].every((markAt) => posProblems({ markAt }) === 1)
      && posProblems({ markAt: null, price: null, pnlPct: null, valueSol: P0.costSol }) === 0);
  ok("with no quote for an hour a position has no price and no percent, and is never worth more than it cost; one never quoted has no price",
    P1.price === null && P1.pnlPct === null && F.decCmp(P1.valueSol, P1.costSol) <= 0 && posProblems({}, 1) === 0
      && posProblems({ markAt: null }) === 1 && posProblems({ price: null }) === (P0.pnlPct === null ? 0 : 1) && posProblems({ pnlPct: "12.5" }, 1) === 1
      && posProblems({ valueSol: F.decAdd(P1.costSol, "0.0001") }, 1) === 1 && posProblems({ valueSol: P1.costSol }, 1) === 0 && posProblems({ valueSol: "0" }, 1) === 0
      && W.agent(8).positions[2].valueSol === "0" && V.validateAgentDetail(clone(W.agent(8)), 8).problems.length === 0);
  const unpriced = (x) => { const o = clone(good.agents); if (x === undefined) delete o.agents[0].stats.unpricedPositions; else o.agents[0].stats.unpricedPositions = x; return V.validateAgents(o).problems.length; };
  ok("an agent says how many of its positions have no recent price: unpricedPositions, a whole number from 0, required",
    unpriced(0) === 0 && unpriced(3) === 0 && [undefined, -1, 1.5, "1", null, true].every((x) => unpriced(x) === 1)
      && (() => { const d = clone(W.agent(4)); delete d.stats.unpricedPositions; return refuses(() => V.validateAgentDetail(d, 4)); })());
  const at = (h) => new Date(Date.parse("2026-09-25T12:00:00Z") - h * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const now = Date.parse("2026-09-25T12:00:00Z");
  const pos = (patch) => ({ costSol: "0.2", valueSol: "0.15", price: null, pnlPct: null, markAt: at(3), openedAt: at(5), ...patch });
  ok("a page reads how HQ valued a position with no recent price: at the lower of its last price and its cost, or at 0 after 24 hours",
    F.staleMark(pos({ price: "0.000001", pnlPct: "-25" }), now) === null && F.staleMark(pos({}), now) === "down" && F.staleMark(pos({ valueSol: "0", markAt: at(30), openedAt: at(40) }), now) === "zero"
      && F.staleMark(pos({ valueSol: "0" }), now) === "down" && F.staleMark(pos({ valueSol: "0", markAt: null, openedAt: at(26) }), now) === "zero" && F.staleMark(pos({ valueSol: "0.1", markAt: at(30), openedAt: at(40) }), now) === "down"
      && F.unpricedLine(1) === "1 position without a recent price, valued down" && F.unpricedLine(2) === "2 positions without a recent price, valued down"
      && JSON.stringify(F.STALE_WORDS) === '{"down":"lower of last price and cost","zero":"0 after 24 h without a quote"}');

  const trade = clone(good.detail.trades.find((t) => t.side === "buy"));
  const T = (patch) => ({ ...clone(trade), ...patch });
  const refusesTrade = (t) => refuses(() => V.validateStreamEvent("trade", t));
  ok("a live trade must carry its transaction, and a paper trade must not", refusesTrade(T({ mode: "live", tx: null })) && refusesTrade(T({ mode: "paper", tx: "5".repeat(88) })) && !refusesTrade(T({ mode: "paper", tx: null })));
  ok("a transaction that is not a base58 signature is refused", ["abc", "5".repeat(91), "0".repeat(88), 5].every((tx) => refusesTrade(T({ mode: "live", tx }))));
  ok("a trade's amounts, side and trigger are checked", refusesTrade(T({ sol: 0.1 })) && refusesTrade(T({ price: "-1" })) && refusesTrade(T({ side: "short" })) && refusesTrade(T({ trigger: "vibes" })) && refusesTrade(T({ kind: "decision" })));
  ok("every buy trade carries Crying Cat's passed rug check, live or paper: null, missing or failed is refused", !refusesTrade(T({}))
    && refusesTrade(T({ rugCheck: null })) && refusesTrade(T({ mode: "paper", tx: null, rugCheck: null })) && (() => { const t = T({}); delete t.rugCheck; return refusesTrade(t); })()
    && refusesTrade(T({ rugCheck: { passed: false, checks: trade.rugCheck.checks.map((c, i) => ({ ...c, pass: i !== 0 })) } })));
  ok("a rug check must be whole and honest: no check twice, no unknown check, no null detail, passed only if every check passed",
    refusesTrade(T({ rugCheck: { ...trade.rugCheck, passed: false } })) && refusesTrade(T({ rugCheck: { passed: true, checks: [...trade.rugCheck.checks, trade.rugCheck.checks[0]] } }))
      && refusesTrade(T({ rugCheck: { passed: true, checks: [{ id: "vibes", pass: true, detail: "x" }] } })) && refusesTrade(T({ rugCheck: { passed: true, checks: [{ id: "holders", pass: true, detail: null }] } })));
  const RC = trade.rugCheck, withCheck = (i, patch) => ({ ...RC, checks: RC.checks.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  ok("a rug check lists exactly its four checks, once each, in the contract's order", JSON.stringify(RC.checks.map((c) => c.id)) === JSON.stringify(V.RUG_CHECKS)
    && JSON.stringify(V.RUG_CHECKS) === '["mint_authority","freeze_authority","holders","creator_share"]'
    && refusesTrade(T({ rugCheck: { ...RC, checks: RC.checks.slice(0, 3) } })) && refusesTrade(T({ rugCheck: { ...RC, checks: [RC.checks[1], RC.checks[0], RC.checks[2], RC.checks[3]] } }))
    && refusesTrade(T({ rugCheck: { ...RC, checks: [RC.checks[0], RC.checks[1], RC.checks[2], RC.checks[2]] } })) && refusesTrade(T({ rugCheck: { ...RC, checks: [] } })));
  ok("a check's detail is HQ's own plain text, at most 500 characters: a hidden character or more is refused, not cleaned",
    !refusesTrade(T({ rugCheck: withCheck(2, { detail: "x".repeat(500) }) })) && refusesTrade(T({ rugCheck: withCheck(2, { detail: "x".repeat(501) }) }))
      && refusesTrade(T({ rugCheck: withCheck(2, { detail: "revoked\u202E" }) })) && refusesTrade(T({ rugCheck: withCheck(2, { detail: "a\nb" }) })));
  ok("a sell carries no rug check", !refusesTrade(T({ side: "sell", pnlSol: "0.1", pnlPct: "2", rugCheck: null })) && refusesTrade(T({ side: "sell", pnlSol: "0.1", pnlPct: "2", rugCheck: trade.rugCheck })));
  const buyDecision = clone(W.agent(2).decisions.find((d) => d.action === "buy" && d.rugCheck && d.rugCheck.passed)), refused = clone(W.agent(2).decisions.find((d) => d.rugCheck && !d.rugCheck.passed));
  const D = (patch) => ({ ...clone(buyDecision), ...patch });
  ok("a buy decision carries the check once it ran, passed or refused, or null before it; a sell or a hold never",
    !refuses(() => V.validateStreamEvent("decision", D({})) ) && !refuses(() => V.validateStreamEvent("decision", refused)) && !refuses(() => V.validateStreamEvent("decision", D({ rugCheck: null })))
      && refuses(() => V.validateStreamEvent("decision", D({ action: "hold", mint: null, symbol: null }))) && !refuses(() => V.validateStreamEvent("decision", D({ action: "sell", rugCheck: null })))
      && (() => { const d = D({}); delete d.rugCheck; return refuses(() => V.validateStreamEvent("decision", d)); })());
  const det = clone(good.detail);
  det.trades[0].agentId = 99; det.decisions[0].mode = det.mode === "live" ? "paper" : "live";
  const dr = V.validateAgentDetail(det, 2);
  ok("in a dossier, another agent's trade or the other mode's decision is dropped and counted", dr.problems.length === 2 && dr.value.trades.length === good.detail.trades.length - 1 && dr.value.decisions.length === good.detail.decisions.length - 1);
  ok("a dossier's lists come back newest first, and its equity oldest first", dr.value.trades.every((t, i, a) => !i || Date.parse(a[i - 1].t) >= Date.parse(t.t)) && dr.value.equity.every((e, i, a) => !i || Date.parse(a[i - 1].t) <= Date.parse(e.t)));
  const desk = clone(good.desk); desk.items[0].kind = "rumour"; desk.items[1].surprise = true;
  const dk = V.validateDesk(desk);
  ok("the desk drops what it cannot verify and counts it", dk.problems.length === 2 && dk.value.items.length === good.desk.items.length - 2);
  ok("a desk cursor is the contract's opaque cursor or null, and a desk id the contract's id", refuses(() => V.validateDesk({ ...clone(good.desk), next: "<script>" })) && !refuses(() => V.validateDesk({ ...clone(good.desk), next: null }))
    && ["a.b", "a:b", "a/b", "a=", "x".repeat(129), ""].every((next) => refuses(() => V.validateDesk({ ...clone(good.desk), next }))) && !refuses(() => V.validateDesk({ ...clone(good.desk), next: "x".repeat(128) }))
    && ["t:1", "t.1", "x".repeat(65), ""].every((id) => refusesTrade(T({ id }))) && !refusesTrade(T({ id: "A_b-9" })));
  ok("an agent's id is 1 to 999, and its number is that id as three digits", [0, 1000].every((id) => { const o = clone(good.agents); o.agents[0].id = id; return V.validateAgents(o).problems.length === 1; })
    && ["7", "0001", "002"].every((number) => { const o = clone(good.agents); o.agents[0].number = number; return V.validateAgents(o).problems.length === 1; })
    && refusesTrade(T({ agentId: 1000 })) && refuses(() => V.validateStreamEvent("fee", { agentId: 1000, t: "2026-09-25T10:00:00Z", sol: "0.1", tx: "5".repeat(88) })));
  const lb = V.validateLeaderboard(clone(good.board), { by: "roi", period: "30d" }).value;
  ok("the leaderboard comes back as two boards, live and paper, never one", lb.boards.live.every((r) => r.mode === "live") && lb.boards.paper.every((r) => r.mode === "paper")
    && lb.boards.live.length + lb.boards.paper.length === good.board.rows.length && lb.boards.live.length > 0 && lb.boards.paper.length > 0);
  ok("a board for a period or measure not asked for is refused", refuses(() => V.validateLeaderboard(clone(good.board), { period: "7d" })) && refuses(() => V.validateLeaderboard(clone(good.board), { by: "pnl" })));
  ok("the rows come best first, each agent once, and a board keeps HQ's order", (() => { const o = clone(good.board); [o.rows[0], o.rows[1]] = [o.rows[1], o.rows[0]]; return o.rows[0].value !== o.rows[1].value && refuses(() => V.validateLeaderboard(o)); })()
    && (() => { const o = clone(good.board); o.rows[1] = { ...o.rows[1], agentId: o.rows[0].agentId }; return refuses(() => V.validateLeaderboard(o)); })()
    && JSON.stringify(lb.boards.live.map((r) => r.agentId)) === JSON.stringify(good.board.rows.filter((r) => r.mode === "live").map((r) => r.agentId)));
  ok("a row's value is in SOL's format (a percentage for return, SOL for profit), and its rank a rank id", (() => { const o = clone(good.board); o.rows.at(-1).value = "-99.1234567891"; return V.validateLeaderboard(o).problems.length === 1; })()
    && (() => { const o = clone(good.board); o.rows.at(-1).rank = 3; return V.validateLeaderboard(o).problems.length === 1; })());
  const promo = { agentId: 2, mode: "paper", t: "2026-09-25T10:00:00Z", from: "field", to: "special" };
  ok("a promotion must go up (a loss never demotes), and on the stream it names its agent and mode", !refuses(() => V.validateStreamEvent("promotion", promo))
    && refuses(() => V.validateStreamEvent("promotion", { ...promo, from: "special", to: "field" })) && refuses(() => V.validateStreamEvent("promotion", { ...promo, mode: "mixed" }))
    && ["agentId", "mode"].every((k) => { const x = { ...promo }; delete x[k]; return refuses(() => V.validateStreamEvent("promotion", x)); }));
  const dec = clone(W.agent(2).decisions.find((d) => d.action === "hold"));
  const shown = (reason) => V.validateStreamEvent("decision", { ...clone(dec), reason }).reason;
  ok("text passed on from elsewhere (a reason, a symbol, a coin's name) is cleaned again, as a second line: no control, bidi or zero-width character, cut to the contract's limit",
    shown("Line one.\nLine two.") === "Line one. Line two." && shown("fine\u202Etext\u200B") === "finetext" && shown("x".repeat(501)).length === 500 && shown("x".repeat(501)).endsWith("…") && shown("x".repeat(500)) === "x".repeat(500)
      && V.validateAgents({ agents: [{ ...clone(good.agents.agents[0]), coin: { ...clone(good.agents.agents[0].coin), name: "n".repeat(70), symbol: "S".repeat(20) } }] }).value.agents[0].coin.name.length === 64
      && V.validateAgents({ agents: [{ ...clone(good.agents.agents[0]), coin: { ...clone(good.agents.agents[0].coin), name: "n".repeat(70), symbol: "S".repeat(20) } }] }).value.agents[0].coin.symbol.length === 16
      && refuses(() => V.validateStreamEvent("decision", { ...clone(dec), reason: "\u200B\u202E " })) && V.validateStreamEvent("trade", T({ symbol: "MO\u202ECK" })).symbol === "MOCK");
  ok("buyback sources and destination are the contract's", ["gifts", ["creator_fees", "creator_fees"], [], ["creator_fees", "trading_profit", "creator_fees"]].every((sources) => { const o = clone(good.buybacks); o.policy.sources = sources; return refuses(() => V.validateBuybacks(o)); })
    && (() => { const o = clone(good.buybacks); o.policy.destination = "moon"; return refuses(() => V.validateBuybacks(o)); })());
  ok("the buyback schedule is HQ's own plain text, at most 120 characters", ["x".repeat(121), "weekly\u202E", "a\nb"].every((schedule) => { const o = clone(good.buybacks); o.policy.schedule = schedule; return refuses(() => V.validateBuybacks(o)); })
    && (() => { const o = clone(good.buybacks); o.policy.schedule = "x".repeat(120); return !refuses(() => V.validateBuybacks(o)); })());
  ok("a treasury flow of an unknown kind, or with a negative amount (its kind is its direction), is dropped and counted",
    (() => { const o = clone(good.treasury); o.flows[0].kind = "airdrop"; return V.validateTreasury(o).problems.length === 1; })() && (() => { const o = clone(good.treasury); o.flows[0].sol = "-0.5"; return V.validateTreasury(o).problems.length === 1; })());
  ok("a buyback is always a real transaction: a null tx or price drops it, and only burnTx may be null",
    ["tx", "price"].every((k) => { const o = clone(good.buybacks); o.items[1][k] = null; return V.validateBuybacks(o).problems.length === 1; }) && (() => { const o = clone(good.buybacks); o.items[1].burnTx = null; return V.validateBuybacks(o).problems.length === 0; })());
  const tiers = W.tiers();
  ok("the tiers: lowest first, each once, each needing at least the $CIA of the one below", V.validateTiers(clone(tiers)).value.tiers.length === 3
    && refuses(() => V.validateTiers({ tiers: [...clone(tiers).tiers].reverse() })) && refuses(() => V.validateTiers({ tiers: [clone(tiers).tiers[0], clone(tiers).tiers[0]] }))
    && refuses(() => V.validateTiers({ tiers: [clone(tiers).tiers[0], { ...clone(tiers).tiers[1], minCia: "10" }] })) && refuses(() => V.validateTiers({ tiers: [{ ...clone(tiers).tiers[0], id: "none" }] }))
    && refuses(() => V.validateTiers({ tiers: [{ ...clone(tiers).tiers[0], minCia: 100000 }] })) && refuses(() => V.validateTiers({ ...clone(tiers), extra: 1 })) && !refuses(() => V.validateTiers({ tiers: [] })));
  const wallet = "EDVtiBjPVeHTeKuvv1TMSC3vdsMUabZSaaoLRpiTpump";
  const ch = W.challenge(wallet);
  ok("a challenge is { wallet, nonce, message, expiresAt }, and its message, untouched plain text, names the site, the wallet and the nonce", !refuses(() => V.validateChallenge(clone(ch), wallet))
    && refuses(() => { const c = clone(ch); delete c.nonce; return V.validateChallenge(c, wallet); }) && refuses(() => V.validateChallenge({ ...clone(ch), nonce: "<b>" }, wallet))
    && ["short", "x".repeat(129), "a.b.c.d.e.f.g.h.i"].every((nonce) => refuses(() => V.validateChallenge({ ...clone(ch), nonce, message: ch.message.replace(ch.nonce, nonce) }, wallet)))
    && refuses(() => V.validateChallenge({ ...clone(ch), nonce: "a-different-nonce" }, wallet)) && refuses(() => V.validateChallenge({ ...clone(ch), message: ch.message.replace("catintelligenceagency.com", "evil.example") }, wallet))
    && refuses(() => V.validateChallenge({ ...clone(ch), message: "sign this" }, wallet)) && refuses(() => V.validateChallenge({ ...clone(ch), message: `${ch.message}‮` }, wallet))
    && refuses(() => V.validateChallenge(clone(ch), "11111111111111111111111111111111")) && refuses(() => V.validateChallenge({ ...clone(ch), extra: 1 }, wallet)));
  const lines = ch.message.split("\n");
  const withLines = (ls) => ({ ...clone(ch), message: ls.join("\n") });
  const later = new Date(Date.parse(ch.expiresAt) + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  ok("the challenge is refused unless it is exactly the contract's six lines: only the wallet, the nonce and the two times vary",
    lines.length === 6 && JSON.stringify([lines[0], lines[5]]) === JSON.stringify([V.CHALLENGE_LINES[0], V.CHALLENGE_LINES[5]]) && lines[1] === `Wallet: ${wallet}` && lines[4] === `Expires: ${ch.expiresAt}`
      && refuses(() => V.validateChallenge({ ...clone(ch), message: `${ch.message}\n` }, wallet)) && refuses(() => V.validateChallenge(withLines([...lines, "Also approve this."]), wallet))
      && refuses(() => V.validateChallenge(withLines(lines.slice(0, 5)), wallet)) && refuses(() => V.validateChallenge(withLines(lines.map((l, i) => (i === 1 ? "Wallet: 11111111111111111111111111111111" : l))), wallet))
      && refuses(() => V.validateChallenge(withLines(lines.map((l, i) => (i === 4 ? `Expires: ${later}` : l))), wallet)) && refuses(() => V.validateChallenge({ ...withLines(lines.map((l, i) => (i === 3 ? `Issued: ${later}` : l))), expiresAt: ch.expiresAt }, wallet))
      && refuses(() => V.validateChallenge(withLines(lines.map((l, i) => (i === 5 ? "Signing this message moves nothing." : l))), wallet)) && refuses(() => V.validateChallenge(withLines(lines.map((l, i) => (i === 3 ? "Issued: yesterday" : l))), wallet))
      && refuses(() => V.validateChallenge({ ...clone(ch), message: ch.message.replace(/\n/g, "\r\n") }, wallet))
      && !refuses(() => V.validateChallenge({ ...clone(ch), message: V.challengeMessage({ wallet, nonce: ch.nonce, issuedAt: "2026-09-25T10:00:00.123Z", expiresAt: ch.expiresAt }) }, wallet)));
  const pk = W.verify();
  ok("a perks answer: holder and tier must agree, perks are short text", !refuses(() => V.validatePerks(clone(pk))) && refuses(() => V.validatePerks({ ...clone(pk), holder: false }))
    && refuses(() => V.validatePerks({ ...clone(pk), tier: "whale" })) && !refuses(() => V.validatePerks({ ...clone(pk), perks: ["x".repeat(120)] })) && refuses(() => V.validatePerks({ ...clone(pk), perks: ["x".repeat(121)] })) && refuses(() => V.validatePerks({ ...clone(pk), perks: ["a\u200Bb"] })) && refuses(() => V.validatePerks({ ...clone(pk), perks: [5] })) && refuses(() => V.validatePerks({ ...clone(pk), balance: 5 })));
  ok("stream events: each type is its endpoint's shape; a fee names its agent; an unknown type is refused",
    !refuses(() => V.validateStreamEvent("summary", clone(good.summary))) && !refuses(() => V.validateStreamEvent("fee", { agentId: 3, t: "2026-09-25T10:00:00Z", sol: "0.1", tx: "5".repeat(88) }))
      && refuses(() => V.validateStreamEvent("fee", { t: "2026-09-25T10:00:00Z", sol: "0.1", tx: "5".repeat(88) })) && refuses(() => V.validateStreamEvent("fee", { t: "2026-09-25T10:00:00Z", sol: "0.1", tx: "5".repeat(88), agent: 3 })) && refuses(() => V.validateStreamEvent("tip", {}))
      && refuses(() => V.validateStreamEvent("buyback", { ...clone(good.buybacks.items[0]), agentId: 1 })));
  ok("a reset is the stream's own: its data is {} and nothing else, and it is not one of the events the endpoints return",
    V.STREAM_RESET === "reset" && !V.STREAM_EVENTS.includes("reset") && !refuses(() => V.validateStreamEvent("reset", {}))
      && [{ from: 3 }, { id: null }, [], null, "", 0, "{}", Object.create(null)].every((x) => refuses(() => V.validateStreamEvent("reset", x))));
  ok("non-objects are refused: arrays, strings, null, objects with a strange prototype", [[], "x", null, 5, Object.create({ mode: "live" })].every((x) => refuses(() => V.validateSummary(x))));
}

section("THE CLIENT CALLS ONLY HQ");
{
  ok("the one production origin is api.catintelligenceagency.com", JSON.stringify(HQ_ORIGINS) === '["https://api.catintelligenceagency.com"]');
  const yes = ["https://api.catintelligenceagency.com", "https://api.catintelligenceagency.com/", " https://api.catintelligenceagency.com "];
  const dev = ["http://localhost:8787", "http://127.0.0.1:8787"];
  const no = ["", "http://api.catintelligenceagency.com", "https://api.catintelligenceagency.com.evil.com", "https://evil.com", "https://catintelligenceagency.com", "https://api.catintelligenceagency.com/v1",
    "https://user@api.catintelligenceagency.com", "https://api.catintelligenceagency.com:8443", "http://localhost", "http://localhost:0", "https://localhost:8787", "http://192.168.1.2:8787", "http://localhost:8787/x",
    "javascript:alert(1)", "//api.catintelligenceagency.com", null, 42, ["https://api.catintelligenceagency.com"]];
  ok("an origin is HQ's only if it is on the allowlist, exactly", ["catintelligenceagency.com", "localhost"].every((host) => yes.every((x) => hqOrigin(x, host) !== "") && no.every((x) => hqOrigin(x, host) === "")),
    no.filter((x) => hqOrigin(x, "localhost") !== "").join(", "));
  ok("a localhost HQ is one only for a page itself served from localhost: in development, never on the site",
    dev.every((x) => hqOrigin(x, "localhost") === x && hqOrigin(x, "127.0.0.1") === x) && dev.every((x) => ["catintelligenceagency.com", "www.catintelligenceagency.com", "", "evil.example", "localhost.evil.example"].every((host) => hqOrigin(x, host) === ""))
      && hqClient({ hqApi: "http://127.0.0.1:8787" }, "catintelligenceagency.com").online === false && hqClient({ hqApi: "http://127.0.0.1:8787" }, "127.0.0.1").online === true);

  const calls = [];
  let reply = () => new Response(JSON.stringify(good.summary), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return reply(); };
  const offline = hqClient({ hqApi: "" });
  let offErr = null;
  try { await offline.summary(); } catch (e) { offErr = e; }
  ok("with no HQ configured the client is offline, and fetches nothing", offline.online === false && offErr instanceof HqError && offErr.kind === "offline" && calls.length === 0);
  const evil = hqClient({ hqApi: "https://evil.example" });
  ok("an origin off the allowlist is offline too", evil.online === false && evil.origin === "");

  const hq = hqClient({ hqApi: "https://api.catintelligenceagency.com" });
  const s = await hq.summary();
  const c0 = calls[0];
  ok("a GET goes to the origin and the contract's path, with no cookies, no referrer, no cache, no redirect",
    c0.url === "https://api.catintelligenceagency.com/v1/summary" && c0.opts.method === "GET" && c0.opts.credentials === "omit" && c0.opts.referrerPolicy === "no-referrer"
      && c0.opts.cache === "no-store" && c0.opts.redirect === "error" && c0.opts.mode === "cors" && c0.opts.body === undefined && s.value.live.agents.total === good.summary.live.agents.total);
  reply = () => new Response(JSON.stringify(W.tiers()), { status: 200, headers: { "content-type": "application/json" } });
  const tl = await hq.tiers();
  ok("the tiers come from GET /v1/perks, checked", calls.at(-1).url === "https://api.catintelligenceagency.com/v1/perks" && tl.value.tiers.map((t) => t.id).join() === "holder,agent,director");
  reply = () => new Response(JSON.stringify(good.desk), { status: 200, headers: { "content-type": "application/json" } });
  await hq.desk({ limit: 999, before: "c50" });
  ok("query values are checked and capped: the desk's limit at 100, its cursor a cursor", calls.at(-1).url === "https://api.catintelligenceagency.com/v1/desk?limit=100&before=c50");
  let thrown = 0;
  for (const bad of [() => hq.desk({ before: "a b<c" }), () => hq.agent(0), () => hq.agent("1"), () => hq.agent(1.5), () => hq.leaderboard({ by: "hype" }), () => hq.challenge("not-a-wallet"), () => hq.verify({ wallet: "x", message: "m", signature: "s" })]) {
    try { await bad(); } catch (e) { if (e instanceof HqError && e.kind === "invalid") thrown++; }
  }
  ok("a bad id, cursor, board, wallet or signature is refused before anything is sent", thrown === 7 && calls.length === 3);
  reply = () => new Response(JSON.stringify(W.verify()), { status: 200, headers: { "content-type": "application/json" } });
  const wallet = "EDVtiBjPVeHTeKuvv1TMSC3vdsMUabZSaaoLRpiTpump", signature = "5".repeat(88);
  await hq.verify({ wallet, message: "a message", signature });
  const post = calls.at(-1);
  ok("the one POST: /v1/perks/verify, carrying the wallet, the message and the signature, and nothing else",
    post.url === "https://api.catintelligenceagency.com/v1/perks/verify" && post.opts.method === "POST" && post.opts.credentials === "omit"
      && JSON.stringify(Object.keys(JSON.parse(post.opts.body))) === '["wallet","message","signature"]');
  const kinds = [];
  for (const r of [
    () => new Response("{}", { status: 500, headers: { "content-type": "application/json" } }),
    () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
    () => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }),
    () => new Response(JSON.stringify({ ...good.summary, extra: 1 }), { status: 200, headers: { "content-type": "application/json" } }),
    () => new Response("x".repeat(2_000_001), { status: 200, headers: { "content-type": "application/json" } }),
  ]) { reply = r; try { await hq.summary(); kinds.push("accepted"); } catch (e) { kinds.push(e.kind); } }
  ok("an error status, a non-JSON answer, broken JSON, an off-contract answer and an oversized one are all refused", JSON.stringify(kinds) === '["http","invalid","invalid","invalid","invalid"]', kinds.join(", "));
  globalThis.fetch = async () => { throw new TypeError("network down"); };
  let net = null; try { await hq.summary(); } catch (e) { net = e; }
  ok("no answer at all is \"network\", and says so", net instanceof HqError && net.kind === "network");
  delete globalThis.fetch;
  const noStream = hqClient({ hqApi: "" }); const states = [];
  noStream.stream({ onEvent: () => {}, onState: (st) => states.push(st) });
  ok("offline, the stream opens nothing and says it is down", JSON.stringify(states) === '["down"]');

  /* The stream, with a stand-in EventSource and clock: HQ ends each stream within five minutes. */
  class FakeES {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 2; static all = [];
    constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; FakeES.all.push(this); }
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
    close() { this.readyState = 2; }
    open() { this.readyState = 1; this.onopen && this.onopen(); }
    drop(closed = false) { this.readyState = closed ? 2 : 0; this.onerror && this.onerror(); }
    emit(type, data) { this.emitRaw(type, JSON.stringify(data)); }
    emitRaw(type, data, origin = "https://api.catintelligenceagency.com") { for (const fn of this.listeners[type] || []) fn({ origin, data }); }
  }
  globalThis.EventSource = FakeES;
  let clock = 0; const timers = [];
  const tick = (fn, ms) => { const t = { at: clock + ms, fn }; timers.push(t); return t; };
  const untick = (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); };
  const advance = (ms) => { const end = clock + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); clock = t.at; t.fn(); } clock = end; };
  const live = hqClient({ hqApi: "https://api.catintelligenceagency.com" });
  const seen = [], got = [];
  const stop = live.stream({ onEvent: (type, d) => got.push(type), onState: (st, info) => seen.push(info ? `${st}:${info.fresh}${info.reset ? ":reset" : ""}` : st) }, { tick, untick, now: () => clock });
  const es1 = FakeES.all[0];
  es1.open();
  ok("the stream opens on the contract's path and says live", es1.url === "https://api.catintelligenceagency.com/v1/stream" && JSON.stringify(seen) === '["connecting","live:false"]');
  es1.emit("trade", clone(W.agent(2).trades[0])); es1.emit("trade", { kind: "trade", id: "x" });
  ok("each event is checked: a good one reaches the page, a bad one is dropped", JSON.stringify(got) === '["trade"]');
  for (let i = 0; i < 3; i++) { es1.drop(); advance(3_000); es1.open(); advance(300_000); }
  ok("HQ ending the stream every five minutes changes nothing on the page: no \"reconnecting\", no \"down\", no refetch", JSON.stringify(seen) === '["connecting","live:false"]' && FakeES.all.length === 1);
  es1.drop(); advance(9_000);
  ok("away past the grace, it says \"reconnecting\"", seen.at(-1) === "reconnecting");
  es1.open();
  ok("back with Last-Event-ID, it is live again with nothing to refetch", seen.at(-1) === "live:false");
  es1.drop(true); advance(9_000);
  const before = seen.length; advance(22_000);
  ok("only a failure that lasts says \"down\"", seen.at(before - 1) === "reconnecting" && seen.at(-1) === "down" && FakeES.all.length > 1);
  const esN = FakeES.all.at(-1); esN.open();
  ok("a new stream after the browser gave up comes back live and tells the page to refetch, since it could not resume", seen.at(-1) === "live:true" && es1.readyState === 2);
  esN.drop(); advance(3_000); esN.open();   // a quiet reconnection, with Last-Event-ID
  const n0 = seen.length, g0 = got.length;
  esN.emit("reset", {});
  esN.emit("trade", clone(W.agent(2).trades[1]));
  ok("a reset (HQ could not resume from Last-Event-ID) tells the page to reload everything it shows, and the stream reads on",
    seen.length === n0 + 1 && seen.at(-1) === "live:true:reset" && esN.readyState === 1 && FakeES.all.at(-1) === esN && got.length === g0 + 1 && got.at(-1) === "trade");
  esN.emit("reset", { from: 3 }); esN.emit("reset", []); esN.emitRaw("reset", ""); esN.emitRaw("reset", "{}", "https://evil.example");
  ok("a reset with any data but {}, or from anywhere but HQ, is refused: no reload", seen.length === n0 + 1);
  esN.drop(true); advance(40_000);
  const esR = FakeES.all.at(-1); esR.open();
  const n2 = seen.length;
  esR.emit("reset", {});
  ok("after an outage the reopened stream asks for one reload, and a reset that follows at once asks for no second one; after other events, it does",
    seen.at(-1) === "live:true" && seen.at(-2) === "down" && seen.length === n2 && (esR.emit("fee", { agentId: 3, t: "2026-09-25T10:00:00Z", sol: "0.1", tx: "5".repeat(88) }), esR.emit("reset", {}), seen.length === n2 + 1 && seen.at(-1) === "live:true:reset"));
  stop(); delete globalThis.EventSource;
}

section("THE MOCK IS THE CONTRACT'S SHAPE, AND STAYS OUT OF THE SITE");
{
  let all = true, n = 0;
  const wallet = "EDVtiBjPVeHTeKuvv1TMSC3vdsMUabZSaaoLRpiTpump";
  for (const mode of ["mixed", "paper", "live"]) for (const empty of [false, true]) {
    const w = mockWorld({ mode, empty });
    const r = [V.validateSummary(clone(w.summary())), V.validateAgents(clone(w.agents())), V.validateDesk(clone(w.desk(50))), V.validateBuybacks(clone(w.buybacks())), V.validateTreasury(clone(w.treasury())),
      V.validateChallenge(clone(w.challenge(wallet)), wallet), V.validatePerks(clone(w.verify())), V.validateTiers(clone(w.tiers())),
      ...w.agents().agents.map((a) => V.validateAgentDetail(clone(w.agent(a.id)), a.id)),
      ...["roi", "pnl"].flatMap((by) => ["7d", "30d", "all"].map((p) => V.validateLeaderboard(clone(w.leaderboard(by, p)), { by, period: p })))];
    all &&= r.every((x) => x.problems.length === 0);
    for (let i = 0; i < 120; i++) { const e = w.nextEvent(); V.validateStreamEvent(e.type, clone(e.data)); n++; }
  }
  ok("every answer and every streamed event the mock gives passes the site's validators, in every mode", all, `${n} events`);
  const all3 = mockWorld({ mode: "mixed" });
  const items = all3.agents().agents.flatMap((a) => [...all3.agent(a.id).trades, ...all3.agent(a.id).decisions]);
  ok("the mock carries every rug-check case: each buy trade passed, a buy decision refused, a buy decision before the check, and no check on a sell or hold",
    items.filter((x) => x.kind === "trade" && x.side === "buy").every((x) => x.rugCheck && x.rugCheck.passed) && items.some((x) => x.kind === "decision" && x.rugCheck && !x.rugCheck.passed)
      && items.filter((x) => (x.kind === "trade" ? x.side : x.action) !== "buy").every((x) => x.rugCheck === null)
      && Array.from({ length: 200 }, () => all3.nextEvent()).some((e) => e.type === "decision" && e.data.action === "buy" && e.data.rugCheck === null));
  const marks = all3.agents().agents.flatMap((a) => all3.agent(a.id).positions.map((p) => F.staleMark(p)));
  ok("the mock holds positions with no recent quote, valued as the contract says (one at the lower of last price and cost, one at 0), and each agent counts its own",
    marks.includes("down") && marks.includes("zero") && marks.filter(Boolean).length === 2
      && all3.agents().agents.every((a) => a.stats.unpricedPositions === all3.agent(a.id).positions.filter((p) => p.price === null).length));
  const kept = [{ id: 5, type: "trade" }, { id: 6, type: "fee" }, { id: 7, type: "summary" }];
  const ids = (xs) => xs.map((e) => (e.type === "reset" ? `reset@${e.id}` : e.id)).join();
  ok("the mock's stream resumes from Last-Event-ID while it keeps what was missed, and otherwise starts with a reset, as HQ does",
    ids(resumeFrom(kept, NaN, 7)) === "" && ids(resumeFrom(kept, 7, 7)) === "" && ids(resumeFrom(kept, 5, 7)) === "6,7" && ids(resumeFrom(kept, 4, 7)) === "5,6,7"
      && ids(resumeFrom(kept, 3, 7)) === "reset@7" && ids(resumeFrom(kept, 9, 7)) === "reset@7" && ids(resumeFrom([], 6, 7)) === "reset@7"
      && resumeFrom(kept, 1, 7).every((e) => !refuses(() => V.validateStreamEvent(e.type, clone(e.data)))));
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const siteText = walk(path.join(here, "site")).filter((f) => /\.(html|js|css|json)$/.test(f)).map((f) => [f, fs.readFileSync(f, "utf8")]);
  const leaks = siteText.filter(([, t]) => /hq-mock|Mock Mittens|Test Tabby|\bMock:|127\.0\.0\.1:8787/.test(t)).map(([f]) => path.relative(here, f));
  const { devRewrite } = await import("./scripts/hq-mock.mjs");
  const pages = ["hq/index.html", "hq/agent/index.html", "investors/index.html", "perks/index.html"];
  const mockOrigin = "http://127.0.0.1:8787";
  ok("development only: the mock's own server points config.js at the mock, and lets each HQ page connect to it too",
    devRewrite("assets/config.js", "window.CIA_CONFIG = {};", mockOrigin).endsWith(`window.CIA_CONFIG.hqApi = "${mockOrigin}";   // development only: the mock\n`)
      && pages.every((pg) => { const t = fs.readFileSync(path.join(here, "site", pg), "utf8"); const d = devRewrite(pg, t, mockOrigin);
        return d !== t && d.includes(`connect-src 'self' https://api.catintelligenceagency.com ${mockOrigin};`) && !t.includes(mockOrigin) && d.replace(` ${mockOrigin}`, "") === t; }));
  ok("nothing in site/ names the mock or ships its fake data", leaks.length === 0, leaks.join(", "));
  const mockSrc = fs.readFileSync(path.join(here, "scripts", "hq-mock.mjs"), "utf8");
  ok("the mock says what it is: development only, fake data, never shipped", /FOR DEVELOPING THE SITE ONLY\. NEVER SHIPPED, NEVER DEPLOYED\./.test(mockSrc) && /clearly fake data/.test(mockSrc) && /listen\(port, "127\.0\.0\.1"/.test(mockSrc));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
