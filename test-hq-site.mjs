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
import { mockWorld } from "./scripts/hq-mock.mjs";

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
  ok("tokens: compact from a thousand, with the next unit when rounding reaches it", F.fmtTokens("123") === "123" && F.fmtTokens("1234.5") === "1.23K" && F.fmtTokens("999999") === "1.00M" && F.fmtTokens("12345678901") === "12.3B" && F.fmtTokens("0.5") === "0.5");
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
  const agents = mockWorld({ mode: "mixed" }).agents().agents;
  const T = F.modeTotals(agents);
  const live = agents.filter((a) => a.mode === "live"), paper = agents.filter((a) => a.mode === "paper");
  ok("the record by mode sums only that mode's agents, exactly", T.live.agents === live.length && T.paper.agents === paper.length && live.length > 0 && paper.length > 0
    && T.live.realizedPnlSol === F.decSum(live.map((a) => a.stats.realizedPnlSol)) && T.paper.realizedPnlSol === F.decSum(paper.map((a) => a.stats.realizedPnlSol)));
  ok("drawdowns are never added: the agency's is the worst single agent's", T.live.worstDrawdownPct === F.decMax(live.map((a) => a.stats.maxDrawdownPct)));
  ok("with no agent in a mode, its record is empty, not zero-filled", F.modeTotals([]).live.agents === 0 && F.modeTotals([]).live.winRatePct === null && F.modeTotals([]).live.worstDrawdownPct === null);
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
const W = mockWorld({ mode: "mixed", rug: true });
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
  ok("an unknown field is refused, at every level of the summary", [[], ["agents"], ["trades24h"], ["tradingPnlSol"], ["buybacks"], ["treasury"]].every((p) => refuses(() => V.validateSummary(withExtra(good.summary, p)))));
  ok("an unknown field in an agent drops that agent and counts it", [[], ["stats"], ["coin"]].every((p) => {
    const o = clone(good.agents); let t = o.agents[1]; for (const k of p) t = t[k]; t.surprise = 1;
    const r = V.validateAgents(o); return r.problems.length === 1 && r.value.agents.length === good.agents.agents.length - 1 && /unknown field "surprise"/.test(r.problems[0]);
  }));
  ok("an unknown field in a dossier's own fields or limits refuses the dossier", refuses(() => V.validateAgentDetail(withExtra(good.detail, []), 2)) && refuses(() => V.validateAgentDetail(withExtra(good.detail, ["limits"]), 2)) && refuses(() => V.validateAgentDetail(withExtra(good.detail, ["stats"]), 2)));
  ok("a missing field is refused", ["mode", "updatedAt", "treasury"].every((k) => { const o = clone(good.summary); delete o[k]; return refuses(() => V.validateSummary(o)); }));
  const BAD_AMOUNTS = [1.5, 0, "1e3", "1E-9", "NaN", "Infinity", "", " 1", "1 ", "1,000", "+1", "01", "00.5", ".5", "5.", "0x10", "1_000", "١", null, true, [], {}];
  ok("an amount that is not a decimal string is refused, a JSON number included", BAD_AMOUNTS.every((x) => { const o = clone(good.summary); o.solInAgentWallets = x; return refuses(() => V.validateSummary(o)); }), `${BAD_AMOUNTS.length} bad amounts`);
  ok("a negative balance, volume or fee total is refused; a negative P&L is not", (() => { const o = clone(good.summary); o.solInAgentWallets = "-1"; return refuses(() => V.validateSummary(o)); })()
    && (() => { const o = clone(good.summary); o.tradingPnlSol.realized = "-12.5"; return !refuses(() => V.validateSummary(o)); })());
  const BAD_ADDR = ["", "short", "0".repeat(44), "O".repeat(44), "I".repeat(44), "l".repeat(44), "a".repeat(31), "a".repeat(45), `${"a".repeat(43)} `, 12345, null];
  ok("a treasury address that is not base58 of an address's length is refused (null means not set yet)", BAD_ADDR.filter((x) => x !== null).every((x) => { const o = clone(good.summary); o.treasury.address = x; return refuses(() => V.validateSummary(o)); }));
  ok("a bad wallet drops the agent", BAD_ADDR.every((x) => { const o = clone(good.agents); o.agents[0].wallet = x; return V.validateAgents(o).problems.length === 1; }));
  const BAD_TIME = ["2026-09-25", "2026-09-25T10:00:00", "2026-09-25T10:00:00+00:00", "2026-13-01T00:00:00Z", 1758794400, "yesterday"];
  ok("a time that is not a real ISO-8601 UTC instant is refused", BAD_TIME.every((x) => { const o = clone(good.summary); o.updatedAt = x; return refuses(() => V.validateSummary(o)); }));
  const BAD_TEXT = ["", "   ", "a‮b", "zero​width", "line\nbreak", "tab\there", "x".repeat(49), 7];
  ok("a name with hidden, bidi or control characters, blank, or too long, drops the agent", BAD_TEXT.every((x) => { const o = clone(good.agents); o.agents[0].name = x; return V.validateAgents(o).problems.length === 1; }));
  ok("enums: a mode, rank, strategy or status not in the contract, or a sprite or skin id that is not an id, drops the agent", [["mode", "mixed"], ["rank", "general"], ["strategy", "yolo"], ["status", "fired"], ["cat", "Dog Cat!"], ["skin", "Bad Skin!"], ["number", "7"]]
    .every(([k, v]) => { const o = clone(good.agents); o.agents[0][k] = v; return V.validateAgents(o).problems.length === 1; }));
  ok("impossible stats drop the agent: more wins and losses than trades, a fractional count", (() => { const o = clone(good.agents); o.agents[0].stats.wins = o.agents[0].stats.trades + 1; return V.validateAgents(o).problems.length === 1; })()
    && (() => { const o = clone(good.agents); o.agents[0].stats.trades = 2.5; return V.validateAgents(o).problems.length === 1; })());
  ok("one id twice refuses the list", (() => { const o = clone(good.agents); o.agents[1].id = o.agents[0].id; return refuses(() => V.validateAgents(o)); })());
  ok("a coin may be null; a roiPct may be null", (() => { const o = clone(good.agents); o.agents[0].coin = null; o.agents[0].stats.roiPct = null; return V.validateAgents(o).problems.length === 0; })());
  ok("where the contract is silent, the server's shapes pass: a coin known by its mint alone, a sprite the site has no art for, no treasury address yet",
    (() => { const o = clone(good.agents); o.agents[1].coin.symbol = null; o.agents[1].coin.name = null; o.agents[2].cat = "agent-cat"; return V.validateAgents(o).problems.length === 0; })()
      && (() => { const o = clone(good.summary); o.treasury.address = null; return !refuses(() => V.validateSummary(o)); })()
      && F.coinLabel({ mint: "EDVtiBjPVeHTeKuvv1TMSC3vdsMUabZSaaoLRpiTpump", symbol: null, name: null }) === "EDVt…pump" && F.catOf({ cat: "agent-cat", strategy: "popcat-scout" }) === "popcat" && F.catOf({ cat: "snipurr", strategy: "popcat-scout" }) === "snipurr");
  ok("a position with no quote has a null price and percent; a paper agent's transfers carry no transaction, a live agent's must",
    (() => { const d = clone(W.agent(2)); d.positions = [{ ...clone(W.agent(4).positions[0]), price: null, pnlPct: null }]; return V.validateAgentDetail(d, 2).problems.length === 0; })()
      && (() => { const d = clone(W.agent(1)); d.transfers[0].tx = null; return d.mode === "paper" && V.validateAgentDetail(d, 1).problems.length === 0; })()
      && (() => { const d = clone(W.agent(2)); d.transfers[0].tx = null; return d.mode === "live" && V.validateAgentDetail(d, 2).problems.length === 1; })());
  ok("a dossier for another id than the one asked for is refused", refuses(() => V.validateAgentDetail(clone(good.detail), 3)));

  const trade = clone(good.detail.trades.find((t) => t.side === "buy"));
  const T = (patch) => ({ ...clone(trade), ...patch });
  const refusesTrade = (t) => refuses(() => V.validateStreamEvent("trade", t));
  ok("a live trade must carry its transaction, and a paper trade must not", refusesTrade(T({ mode: "live", tx: null })) && refusesTrade(T({ mode: "paper", tx: "5".repeat(88) })) && !refusesTrade(T({ mode: "paper", tx: null, rugCheck: trade.rugCheck })));
  ok("a transaction that is not a base58 signature is refused", ["abc", "5".repeat(91), "0".repeat(88), 5].every((tx) => refusesTrade(T({ mode: "live", tx }))));
  ok("a trade's amounts, side and trigger are checked", refusesTrade(T({ sol: 0.1 })) && refusesTrade(T({ price: "-1" })) && refusesTrade(T({ side: "short" })) && refusesTrade(T({ trigger: "vibes" })) && refusesTrade(T({ kind: "decision" })));
  ok("a rug check's result, when HQ sends it, must be whole and honest", !refusesTrade(T({})) && refusesTrade(T({ rugCheck: { ...trade.rugCheck, passed: false } }))
    && refusesTrade(T({ rugCheck: { passed: true, checks: [...trade.rugCheck.checks, trade.rugCheck.checks[0]] } }))
    && refusesTrade(T({ rugCheck: { passed: false, checks: trade.rugCheck.checks.map((c, i) => ({ ...c, pass: i !== 0 })) } }))
    && refusesTrade(T({ side: "sell", pnlSol: "0.1", pnlPct: "2", rugCheck: trade.rugCheck })) && refusesTrade(T({ rugCheck: { passed: true, checks: [{ id: "vibes", pass: true, detail: null }] } })));
  ok("without a rug-check field a trade still passes (the contract does not carry it yet)", (() => { const t = T({}); delete t.rugCheck; return !refusesTrade(t); })());
  const det = clone(good.detail);
  det.trades[0].agentId = 99; det.decisions[0].mode = det.mode === "live" ? "paper" : "live";
  const dr = V.validateAgentDetail(det, 2);
  ok("in a dossier, another agent's trade or the other mode's decision is dropped and counted", dr.problems.length === 2 && dr.value.trades.length === good.detail.trades.length - 1 && dr.value.decisions.length === good.detail.decisions.length - 1);
  ok("a dossier's lists come back newest first, and its equity oldest first", dr.value.trades.every((t, i, a) => !i || Date.parse(a[i - 1].t) >= Date.parse(t.t)) && dr.value.equity.every((e, i, a) => !i || Date.parse(a[i - 1].t) <= Date.parse(e.t)));
  const desk = clone(good.desk); desk.items[0].kind = "rumour"; desk.items[1].surprise = true;
  const dk = V.validateDesk(desk);
  ok("the desk drops what it cannot verify and counts it", dk.problems.length === 2 && dk.value.items.length === good.desk.items.length - 2);
  ok("a desk cursor is a cursor or null", refuses(() => V.validateDesk({ ...clone(good.desk), next: "<script>" })) && !refuses(() => V.validateDesk({ ...clone(good.desk), next: null })));
  const lb = V.validateLeaderboard(clone(good.board), { by: "roi", period: "30d" }).value;
  ok("the leaderboard comes back as two boards, live and paper, never one", lb.boards.live.every((r) => r.mode === "live") && lb.boards.paper.every((r) => r.mode === "paper")
    && lb.boards.live.length + lb.boards.paper.length === good.board.rows.length && lb.boards.live.length > 0 && lb.boards.paper.length > 0);
  ok("a board for a period or measure not asked for is refused", refuses(() => V.validateLeaderboard(clone(good.board), { period: "7d" })) && refuses(() => V.validateLeaderboard(clone(good.board), { by: "pnl" })));
  ok("a promotion must go up: a loss never demotes; on the stream it may name its agent and mode", refuses(() => V.validateStreamEvent("promotion", { t: "2026-09-25T10:00:00Z", from: "special", to: "field" }))
    && !refuses(() => V.validateStreamEvent("promotion", { t: "2026-09-25T10:00:00Z", from: "field", to: "special", agentId: 2, mode: "paper" })) && refuses(() => V.validateStreamEvent("promotion", { t: "2026-09-25T10:00:00Z", from: "field", to: "special", mode: "mixed" })));
  const dec = clone(W.agent(2).decisions[0]);
  ok("a decision's reason may run to a few lines, but never hides a character", !refuses(() => V.validateStreamEvent("decision", { ...dec, reason: "Line one.\nLine two." })) && refuses(() => V.validateStreamEvent("decision", { ...dec, reason: "fine\u202Etext" })) && refuses(() => V.validateStreamEvent("decision", { ...dec, reason: "x".repeat(1001) })));
  ok("buyback sources and destination are the contract's", ["gifts", ["creator_fees", "creator_fees"], [], ["creator_fees", "trading_profit", "creator_fees"]].every((sources) => { const o = clone(good.buybacks); o.policy.sources = sources; return refuses(() => V.validateBuybacks(o)); })
    && (() => { const o = clone(good.buybacks); o.policy.destination = "moon"; return refuses(() => V.validateBuybacks(o)); })());
  ok("a treasury flow of an unknown kind is dropped and counted", (() => { const o = clone(good.treasury); o.flows[0].kind = "airdrop"; return V.validateTreasury(o).problems.length === 1; })());
  const wallet = "EDVtiBjPVeHTeKuvv1TMSC3vdsMUabZSaaoLRpiTpump";
  const ch = W.challenge(wallet);
  ok("a challenge must name the wallet signing it, be plain text, and be for that wallet; a nonce may come with it", !refuses(() => V.validateChallenge(clone(ch), wallet)) && typeof ch.nonce === "string" && ch.message.includes(ch.nonce)
    && !refuses(() => { const c = clone(ch); delete c.nonce; return V.validateChallenge(c, wallet); }) && refuses(() => V.validateChallenge({ ...clone(ch), nonce: "<b>" }, wallet))
    && refuses(() => V.validateChallenge({ ...clone(ch), message: "sign this" }, wallet)) && refuses(() => V.validateChallenge({ ...clone(ch), message: `${ch.message}‮` }, wallet))
    && refuses(() => V.validateChallenge(clone(ch), "11111111111111111111111111111111")) && refuses(() => V.validateChallenge({ ...clone(ch), extra: 1 }, wallet)));
  const pk = W.verify();
  ok("a perks answer: holder and tier must agree, perks are short text", !refuses(() => V.validatePerks(clone(pk))) && refuses(() => V.validatePerks({ ...clone(pk), holder: false }))
    && refuses(() => V.validatePerks({ ...clone(pk), tier: "whale" })) && refuses(() => V.validatePerks({ ...clone(pk), perks: ["x".repeat(81)] })) && refuses(() => V.validatePerks({ ...clone(pk), balance: 5 })));
  ok("stream events: each type is its endpoint's shape; a fee may name its agent; an unknown type is refused",
    !refuses(() => V.validateStreamEvent("summary", clone(good.summary))) && !refuses(() => V.validateStreamEvent("fee", { t: "2026-09-25T10:00:00Z", sol: "0.1", tx: "5".repeat(88), agentId: 3 }))
      && refuses(() => V.validateStreamEvent("fee", { t: "2026-09-25T10:00:00Z", sol: "0.1", tx: "5".repeat(88), agent: 3 })) && refuses(() => V.validateStreamEvent("tip", {}))
      && refuses(() => V.validateStreamEvent("buyback", { ...clone(good.buybacks.items[0]), agentId: 1 })));
  ok("non-objects are refused: arrays, strings, null, objects with a strange prototype", [[], "x", null, 5, Object.create({ mode: "live" })].every((x) => refuses(() => V.validateSummary(x))));
}

section("THE CLIENT CALLS ONLY HQ");
{
  ok("the one production origin is api.catintelligenceagency.com", JSON.stringify(HQ_ORIGINS) === '["https://api.catintelligenceagency.com"]');
  const yes = ["https://api.catintelligenceagency.com", "https://api.catintelligenceagency.com/", " https://api.catintelligenceagency.com ", "http://localhost:8787", "http://127.0.0.1:8787"];
  const no = ["", "http://api.catintelligenceagency.com", "https://api.catintelligenceagency.com.evil.com", "https://evil.com", "https://catintelligenceagency.com", "https://api.catintelligenceagency.com/v1",
    "https://user@api.catintelligenceagency.com", "https://api.catintelligenceagency.com:8443", "http://localhost", "http://localhost:0", "https://localhost:8787", "http://192.168.1.2:8787", "http://localhost:8787/x",
    "javascript:alert(1)", "//api.catintelligenceagency.com", null, 42, ["https://api.catintelligenceagency.com"]];
  ok("an origin is HQ's only if it is on the allowlist, exactly", yes.every((x) => hqOrigin(x) !== "") && no.every((x) => hqOrigin(x) === ""), no.filter((x) => hqOrigin(x) !== "").join(", "));

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
      && c0.opts.cache === "no-store" && c0.opts.redirect === "error" && c0.opts.mode === "cors" && c0.opts.body === undefined && s.value.mode === good.summary.mode);
  reply = () => new Response(JSON.stringify(good.desk), { status: 200, headers: { "content-type": "application/json" } });
  await hq.desk({ limit: 999, before: "c50" });
  ok("query values are checked and capped: the desk's limit at 100, its cursor a cursor", calls.at(-1).url === "https://api.catintelligenceagency.com/v1/desk?limit=100&before=c50");
  let thrown = 0;
  for (const bad of [() => hq.desk({ before: "a b<c" }), () => hq.agent(0), () => hq.agent("1"), () => hq.agent(1.5), () => hq.leaderboard({ by: "hype" }), () => hq.challenge("not-a-wallet"), () => hq.verify({ wallet: "x", message: "m", signature: "s" })]) {
    try { await bad(); } catch (e) { if (e instanceof HqError && e.kind === "invalid") thrown++; }
  }
  ok("a bad id, cursor, board, wallet or signature is refused before anything is sent", thrown === 7 && calls.length === 2);
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
}

section("THE MOCK IS THE CONTRACT'S SHAPE, AND STAYS OUT OF THE SITE");
{
  let all = true, n = 0;
  const wallet = "EDVtiBjPVeHTeKuvv1TMSC3vdsMUabZSaaoLRpiTpump";
  for (const mode of ["mixed", "paper", "live"]) for (const empty of [false, true]) {
    const w = mockWorld({ mode, empty });
    const r = [V.validateSummary(clone(w.summary())), V.validateAgents(clone(w.agents())), V.validateDesk(clone(w.desk(50))), V.validateBuybacks(clone(w.buybacks())), V.validateTreasury(clone(w.treasury())),
      V.validateChallenge(clone(w.challenge(wallet)), wallet), V.validatePerks(clone(w.verify())),
      ...w.agents().agents.map((a) => V.validateAgentDetail(clone(w.agent(a.id)), a.id)),
      ...["roi", "pnl"].flatMap((by) => ["7d", "30d", "all"].map((p) => V.validateLeaderboard(clone(w.leaderboard(by, p)), { by, period: p })))];
    all &&= r.every((x) => x.problems.length === 0);
    for (let i = 0; i < 120; i++) { const e = w.nextEvent(); V.validateStreamEvent(e.type, clone(e.data)); n++; }
  }
  ok("every answer and every streamed event the mock gives passes the site's validators, in every mode", all, `${n} events`);
  const plain = mockWorld({ mode: "live" }).agent(1), withRug = mockWorld({ mode: "live", rug: true }).agent(1);
  ok("by default the mock's buys carry no rug-check field, as the contract has them today; --rug adds the proposed one", plain.trades.filter((t) => t.side === "buy").every((t) => !("rugCheck" in t)) && withRug.trades.filter((t) => t.side === "buy").every((t) => t.rugCheck && t.rugCheck.passed));
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const siteText = walk(path.join(here, "site")).filter((f) => /\.(html|js|css|json)$/.test(f)).map((f) => [f, fs.readFileSync(f, "utf8")]);
  const leaks = siteText.filter(([, t]) => /hq-mock|Mock Mittens|Test Tabby|\bMock:|127\.0\.0\.1:8787/.test(t)).map(([f]) => path.relative(here, f));
  ok("nothing in site/ names the mock or ships its fake data", leaks.length === 0, leaks.join(", "));
  const mockSrc = fs.readFileSync(path.join(here, "scripts", "hq-mock.mjs"), "utf8");
  ok("the mock says what it is: development only, fake data, never shipped", /FOR DEVELOPING THE SITE ONLY\. NEVER SHIPPED, NEVER DEPLOYED\./.test(mockSrc) && /clearly fake data/.test(mockSrc) && /listen\(port, "127\.0\.0\.1"/.test(mockSrc));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
