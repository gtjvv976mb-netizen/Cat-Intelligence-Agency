/* AGENCY HQ: ONE AGENT'S DOSSIER (/hq/agent/?id=N, or /hq/agent/#N).
   Reads GET /v1/agents/:id through hq-client.js (checked against the contract there) and draws
   it as text: who the agent is and how far it is from its next rank, its record with the losses
   as plain as the gains, its portfolio over time, what it is not allowed to do, and every
   position, trade, decision, fee, transfer and promotion, each transaction linked. The live
   stream adds this agent's new trades and decisions, and reloads its figures after each. */
import { hqClient } from "./hq-client.js";
import {
  CATS, STRATEGIES, RANKS, fmtSol, fmtPct, fmtTokens, fmtPrice, fmtUtc, fmtDate, decSub, decSign, rankProgress, winRate, ticker,
} from "./hq-format.js";
import {
  $, el, setState, modeTag, sol, pct, when, keepTime, txLink, tokenLink, walletLink, coinLinks, portrait, rankArt, rankChip,
  strategyChip, statusChip, stat, refusedNote, whyNot, setPill, deskRow, TRIGGER_WORDS, CHECK_WORDS,
} from "./hq-ui.js";
import { drawEquity } from "./hq-chart.js";

const hq = hqClient();
const pill = $("#pill");
let agent = null, stopStream = null, streamedOnce = false, reloadTimer = 0, undraw = () => {};

function wantedId() {
  const q = new URLSearchParams(location.search).get("id");
  const h = location.hash.replace(/^#/, "");
  const raw = q !== null ? q : h || null;
  if (raw === null) return null;
  return /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : NaN;
}

function fail(tag, title, text) {
  setState("error");
  $("#err-tag").textContent = tag;
  $("#hq-error-title").textContent = title;
  $("#hq-error-text").textContent = text;
}

async function load({ quiet = false } = {}) {
  const id = wantedId();
  if (id === null || Number.isNaN(id)) {
    fail("No agent", id === null ? "Which agent?" : "That is not an agent number.", "A dossier's address ends in its agent's id, such as ?id=1. Every agent is listed at Agency HQ.");
    return;
  }
  if (!quiet) setState("loading");
  try {
    const { value, problems } = await hq.agent(id);
    agent = value;
    setState("online");
    draw(problems.length);
    if (!stopStream) stopStream = hq.stream({ onEvent, onState });
  } catch (e) {
    if (quiet) return;
    setPill(pill, "down");
    if (e.kind === "http" && e.status === 404) fail("No such agent", `HQ has no agent ${id}.`, "It may not be hired yet. Every agent HQ runs is listed at Agency HQ.");
    else fail("Not answering", whyNot(e), "This page shows only what HQ sends and the contract allows. Nothing is filled in while it is away.");
  }
}

/* ── who it is ─────────────────────────────────────────────────────────── */
function drawId(a) {
  document.title = `Agent ${a.number}, ${a.name} — Agency HQ — Cat Intelligence Agency`;
  $("#dossier").style.setProperty("--accent", CATS[a.cat].accent);
  const pad = $("#pad");
  const art = rankArt(a.rank, 0.25);
  art.title = RANKS.find((r) => r.id === a.rank).name;
  pad.replaceChildren(modeTag(a.mode), portrait(a, 1, { alt: `Agent ${a.number}, ${a.name}: the agency's grey tabby agent kitten in its ${a.rank === a.skin ? "rank's" : a.skin} outfit` }), art);
  const no = $("#agent-no");
  no.replaceChildren(`Agent ${a.number} · hired ${fmtDate(a.hiredAt)}`, statusChip(a.status));
  $("#agent-name").textContent = a.name;
  $("#agent-chips").replaceChildren(rankChip(a.rank, a.mode), strategyChip(a.strategy), modeTag(a.mode));

  const p = rankProgress(a.rank, a.stats.careerRealizedSol);
  const box = $("#progress");
  box.hidden = !p;
  if (p) {
    const bar = $("#progress-bar");
    if (p.next) {
      $("#progress-text").replaceChildren(el("b", "", `${fmtSol(p.remaining)} SOL`), ` more realized profit to ${p.next.name}${a.mode === "paper" ? " (on paper)" : ""}`);
      $("#progress-pct").textContent = `${fmtSol(a.stats.careerRealizedSol)} of ${p.next.min} SOL`;
    } else {
      $("#progress-text").replaceChildren(el("b", "", p.rank.name), ": the top rank.");
      $("#progress-pct").textContent = `${fmtSol(a.stats.careerRealizedSol)} SOL career`;
    }
    bar.style.setProperty("--p", String(p.pct / 100));
    bar.setAttribute("aria-valuenow", String(Math.round(p.pct)));
    bar.setAttribute("aria-label", p.next ? `Progress to ${p.next.name}` : "Top rank");
  }

  const facts = $("#agent-facts");
  const row = (k, ...v) => { const dd = el("dd"); dd.append(...v); facts.append(el("dt", "", k), dd); };
  facts.replaceChildren();
  const s = STRATEGIES[a.strategy];
  row("Strategy", `${s.cat}: ${s.does}.`);
  row("Mode", modeTag(a.mode), a.mode === "paper" ? "Simulated from live quotes; nothing signed, no money." : "Real SOL, every trade on chain.");
  const full = el("span", "full", a.wallet);
  row("Wallet", walletLink(a.wallet, "Solscan ↗"), full);
  if (a.coin) row("Its coin", el("b", "", `${ticker(a.coin.symbol)} · ${a.coin.name}`), coinLinks(a.coin));
  else row("Its coin", "None of its own.");
  row("Hired", when(a.hiredAt), el("span", "", fmtUtc(a.hiredAt)));
}

/* ── its record ────────────────────────────────────────────────────────── */
function drawStats(a) {
  const s = a.stats, m = a.mode;
  const wr = winRate(s.wins, s.losses);
  const net = decSub(s.depositedSol, s.withdrawnSol);
  const key = el("div", "stats four"), rest = el("div", "stats six");
  key.append(
    stat({ label: "Trading P&L, realized", value: sol(s.realizedPnlSol, { signed: true }), sub: "From closed trades. Fees are not in it.", mode: m, cls: "key" }),
    stat({ label: "Trading P&L, unrealized", value: sol(s.unrealizedPnlSol, { signed: true }), sub: "Open positions, at the latest price.", mode: m, cls: "key" }),
    stat({ label: "Win rate", value: wr === null ? el("span", "amt flat", "n/a") : el("span", "amt", `${wr}%`), sub: `${s.wins} won · ${s.losses} lost`, mode: m, cls: "key" }),
    stat({ label: "Max drawdown", value: pct(decSign(s.maxDrawdownPct) > 0 ? `-${s.maxDrawdownPct}` : s.maxDrawdownPct), sub: "Its furthest fall from a peak.", mode: m, cls: "key" }),
  );
  rest.append(
    stat({ label: "Portfolio value", value: sol(s.portfolioSol), sub: "Free SOL plus open positions.", mode: m }),
    stat({ label: "Return", value: pct(s.roiPct), sub: s.roiPct === null ? "Nothing deposited yet." : "Trading P&L over net deposits.", mode: m }),
    stat({ label: "SOL balance", value: sol(s.balanceSol), sub: "Free SOL in its wallet.", mode: m }),
    stat({ label: "Trades", value: el("span", "amt", String(s.trades)), sub: "Buys and sells.", mode: m }),
    stat({ label: "Creator fees claimed", value: sol(s.feesClaimedSol), sub: "Its coin's fees. Not trading profit.", mode: m }),
    stat({ label: "Net deposits", value: sol(net, { signed: decSign(net) < 0 }), sub: `${fmtSol(s.depositedSol)} in · ${fmtSol(s.withdrawnSol)} out`, mode: m }),
  );
  $("#agent-stats").replaceChildren(key, rest);
  $("#mode-line").textContent = m === "paper" ? "This agent trades on paper: its figures are simulated from live quotes, and nothing is signed." : "This agent trades real SOL: every trade below is on chain.";
}

function drawLimits(a) {
  const L = a.limits;
  const li = (bold, rest) => { const n = el("li"); const t = el("span"); t.append(el("b", "", bold), rest); n.append(t); return n; };
  $("#limits").replaceChildren(
    li(`Spend more than ${fmtSol(L.maxPerTradeSol)} SOL`, " on one trade."),
    li(`Hold more than ${L.maxOpenPositions} ${L.maxOpenPositions === 1 ? "position" : "positions"}`, " at once."),
    li(`Ride a loss past ${fmtPct(L.stopLossPct, { signed: false })}`, ": the stop loss sells."),
    li(`Hold a gain past ${fmtPct(L.takeProfitPct, { signed: false })}`, ": the take profit sells."),
    L.trailingStopPct === null ? li("No trailing stop", " is set for this agent; the stop loss and take profit still hold.") : li(`Give back more than ${fmtPct(L.trailingStopPct, { signed: false })} from a peak`, ": the trailing stop sells."),
    li(`Keep trading after losing ${fmtSol(L.dailyLossLimitSol)} SOL in a day`, ": its daily loss limit."),
    li("Buy a token that fails the rug check", ": mint or freeze authority, holders, the creator's share."),
    li("Buy its own coin", ", or any other agency coin."),
    li("Send money anywhere but the agency treasury", ": withdrawals go there and only there."),
    li("Trade anyone else's money", ": HQ holds only the agency's own."),
    li("Take more risk for its rank", ": a rank is a look, never more money."),
  );
}

function drawChart(a) {
  undraw();
  const net = decSub(a.stats.depositedSol, a.stats.withdrawnSol);
  undraw = drawEquity($("#equity"), a.equity, decSign(net) > 0 ? { reference: net, referenceLabel: `Net deposits ${fmtSol(net)} SOL` } : {});
  const recent = a.equity.slice(-120).reverse();
  if (!recent.length) { $("#equity-table").replaceChildren(el("p", "fine", "No points yet.")); return; }
  const t = el("table", "tbl");
  const head = el("tr"); head.append(el("th", "", "Time (UTC)"), el("th", "num", "Portfolio, SOL"));
  const thead = el("thead"); thead.append(head);
  const body = el("tbody");
  for (const p of recent) { const r = el("tr"); r.append(el("td", "", fmtUtc(p.t)), el("td", "num", fmtSol(p.portfolioSol))); body.append(r); }
  t.append(thead, body);
  $("#equity-table").replaceChildren(t);
}

/* ── tables and logs ───────────────────────────────────────────────────── */
function table(cols, rows, empty) {
  if (!rows.length) return el("p", "board-empty", empty);
  const wrap = el("div", "tbl-wrap");
  const t = el("table", "tbl stack");
  const thead = el("thead"), hr = el("tr");
  for (const c of cols) hr.append(el("th", c.num ? "num" : "", c.label));
  thead.append(hr);
  const body = el("tbody");
  for (const r of rows) {
    const tr = el("tr");
    cols.forEach((c, i) => { const td = el("td", `${c.num ? "num" : ""}${c.wide ? " wide" : ""}`.trim()); td.dataset.label = c.label; const v = r[i]; td.append(...(Array.isArray(v) ? v : [v])); tr.append(td); });
    body.append(tr);
  }
  t.append(thead, body);
  wrap.append(t);
  return wrap;
}
function drawPositions(a) {
  $("#positions-note").textContent = `${a.positions.length} open, of at most ${a.limits.maxOpenPositions}`;
  $("#positions").replaceChildren(table(
    [{ label: "Token" }, { label: "Cost", num: true }, { label: "Value", num: true }, { label: "Entry", num: true }, { label: "Now", num: true }, { label: "P&L", num: true }, { label: "Opened" }],
    a.positions.map((p) => [tokenLink(p.mint, p.symbol), sol(p.costSol), sol(p.valueSol), `${fmtPrice(p.entryPrice)}`, `${fmtPrice(p.price)}`, [sol(p.pnlSol, { signed: true }), el("span", "sub-line", fmtPct(p.pnlPct))], when(p.openedAt)]),
    "No open positions: every SOL is free in its wallet."));
}
function sideCell(t) {
  const c = [el("span", `side ${t.side}`, t.side)];
  if (t.side === "buy") {
    const r = el("span", "sub-line", t.rugCheck ? "rug check ✓" : "rug-checked by rule");
    r.title = t.rugCheck ? t.rugCheck.checks.map((x) => `${CHECK_WORDS[x.id]}: ${x.pass ? "pass" : "fail"}${x.detail ? ` (${x.detail})` : ""}`).join("; ") : "HQ checks every buy first; this answer did not include the check's result.";
    c.push(r);
  }
  return c;
}
function drawTrades(a) {
  $("#trades").replaceChildren(table(
    [{ label: "Time" }, { label: "Side" }, { label: "Token" }, { label: "SOL", num: true }, { label: "Tokens", num: true }, { label: "Price", num: true }, { label: "P&L", num: true }, { label: "Trigger" }, { label: "Transaction" }],
    a.trades.map((t) => [when(t.t), sideCell(t), tokenLink(t.mint, t.symbol), sol(t.sol, { unit: "" }), fmtTokens(t.tokens), fmtPrice(t.price),
      t.pnlSol === null ? el("span", "amt flat", "—") : [sol(t.pnlSol, { signed: true, unit: "" }), el("span", "sub-line", t.pnlPct === null ? "" : fmtPct(t.pnlPct))],
      el("span", `trigger t-${t.trigger}`, TRIGGER_WORDS[t.trigger]), txLink(t.tx, t.mode)]),
    a.mode === "paper" ? "No trades yet. On paper, each will be marked paper, with no transaction." : "No trades yet. Each will link its transaction on Solscan."));
}
function logItem(left, text, right) {
  const li = el("li");
  const l = el("span"); l.append(...[left].flat());
  const m = el("span", "log-text"); m.append(...[text].flat());
  const r = el("span", "log-side"); r.append(...[right].flat());
  li.append(l, m, r);
  return li;
}
function drawLogs(a, refused) {
  const dec = $("#decisions");
  dec.replaceChildren(...(a.decisions.length ? a.decisions.slice(0, 60).map((d) => deskRow(d, new Map(), { withAgent: false })) : [el("li", "board-empty", "No decisions yet.")]));
  $("#fees").replaceChildren(...(a.fees.length ? a.fees.map((f) => logItem(sol(f.sol), "Claimed from its coin", [when(f.t), txLink(f.tx, "live")])) : [el("li", "board-empty", a.coin ? "No creator fees claimed yet." : "It has no coin of its own, so no creator fees.")]));
  if (a.fees.length) $("#fees").append(logItem(el("b", "", "Total"), "", sol(a.stats.feesClaimedSol)));
  $("#transfers").replaceChildren(...(a.transfers.length ? a.transfers.map((x) => logItem(sol(x.kind === "deposit" ? x.sol : `-${x.sol}`, { signed: true }), x.kind === "deposit" ? "Deposited by the agency" : "Withdrawn to the agency treasury", [when(x.t), txLink(x.tx, "live")])) : [el("li", "board-empty", "No deposits or withdrawals yet.")]));
  $("#promotions").replaceChildren(...(a.promotions.length ? a.promotions.map((p) => logItem(rankChip(p.to, a.mode), `${RANKS.find((r) => r.id === p.from).name} to ${RANKS.find((r) => r.id === p.to).name}`, when(p.t))) : [el("li", "board-empty", "No promotions yet. The first comes at 0.25 SOL of career realized profit.")]));
  const old = document.querySelector("#dossier-refused");
  if (old) old.remove();
  const note = refusedNote(refused);
  if (note) { note.id = "dossier-refused"; $("#agent-stats").after(note); }
}

function draw(refused = 0) {
  drawId(agent); drawStats(agent); drawChart(agent); drawLimits(agent); drawPositions(agent); drawTrades(agent); drawLogs(agent, refused);
}

/* ── the stream ─────────────────────────────────────────────────────────── */
function onEvent(type, data) {
  if (!agent || data.agentId !== agent.id) return;
  if (type === "trade" && !agent.trades.some((x) => x.id === data.id)) { agent.trades.unshift(data); drawTrades(agent); }
  if (type === "decision" && !agent.decisions.some((x) => x.id === data.id)) { agent.decisions.unshift(data); drawLogs(agent, 0); }
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => load({ quiet: true }), 6_000);
}
function onState(st) {
  setPill(pill, st);
  if (st === "live") { if (streamedOnce) load({ quiet: true }); streamedOnce = true; }
}

$("#retry").addEventListener("click", () => load());
addEventListener("hashchange", () => load());
keepTime();
if (hq.online) load();
else { setState("offline"); setPill(pill, "offline"); }
