/* AGENCY HQ, LIVE: the /hq/ page.
   With no HQ configured it keeps its "coming online" state and calls nothing. With one, it
   reads the summary, the agents, the desk and the leaderboard through hq-client.js (checked
   against the contract there), draws them as text, and then follows the live stream: new
   trades and decisions go on top of the desk, a new summary replaces the old, a promotion
   reloads the agents and the boards. Paper and live are never added together: when HQ runs
   both, the summary is shown per mode, from each agent's own figures. */
import { hqClient } from "./hq-client.js";
import { CATS, catOf, coinLabel, fmtSol, fmtTokens, decAdd, decSign, modeTotals, pumpFun, solscanToken } from "./hq-format.js";
import {
  $, $$, el, out, setState, modeTag, sol, pct, when, keepTime, agentHref, portrait, rankChip,
  strategyChip, statusChip, stat, refusedNote, whyNot, setPill, deskRow, walletLink,
} from "./hq-ui.js";

const hq = hqClient();
const pill = $("#pill");
const S = {
  summary: null, agents: new Map(), agentsFailed: null, agentsRefused: 0,
  desk: [], deskNext: null, deskRefused: 0, deskFailed: null,
  side: "all", mode: "both", deskShown: 24, by: "roi", period: "30d", allRecruits: false, boardKey: "",
};
let stopStream = null, streamedOnce = false, agentsTimer = 0;


/* ── boot ───────────────────────────────────────────────────────────────── */
async function boot() {
  setState("loading");
  setPill(pill, "connecting");
  const [s, a, d] = await Promise.allSettled([hq.summary(), hq.agents(), hq.desk({ limit: 60 })]);
  if (s.status === "rejected" && a.status === "rejected") { fail(a.reason); return; }
  S.summary = s.status === "fulfilled" ? s.value.value : null;
  S.summaryError = s.status === "rejected" ? s.reason : null;
  takeAgents(a);
  if (d.status === "fulfilled") { S.desk = d.value.value.items; S.deskNext = d.value.value.next; S.deskRefused = d.value.problems.length; S.deskFailed = null; }
  else S.deskFailed = d.reason;
  setState("online");
  drawSummary(); drawTape(); drawRecruits(); drawDesk();
  loadBoards();
  if (!stopStream) stopStream = hq.stream({ onEvent, onState });
}
function takeAgents(r) {
  if (r.status === "fulfilled") {
    S.agents = new Map(r.value.value.agents.map((x) => [x.id, x]));
    S.agentsRefused = r.value.problems.length; S.agentsFailed = null;
  } else S.agentsFailed = r.reason;
}
function fail(e) {
  setState("error");
  setPill(pill, "down");
  $("#hq-error-title").textContent = whyNot(e);
}
async function reloadAgents() {
  const r = await Promise.allSettled([hq.agents()]);
  takeAgents(r[0]);
  drawSummary(); drawTape(); drawRecruits(); drawDesk();
}
function soonReloadAgents() { clearTimeout(agentsTimer); agentsTimer = setTimeout(reloadAgents, 15_000); }

/* ── the summary ────────────────────────────────────────────────────────── */
const drawdown = (x) => (x === null ? el("span", "amt flat", "n/a") : pct(decSign(x) > 0 ? `-${x}` : x));
const winCard = (t, mode) => stat({ label: "Win rate", value: t.winRatePct === null ? el("span", "amt flat", "n/a") : el("span", "amt", `${t.winRatePct}%`), sub: `${t.wins} won · ${t.losses} lost, of closed trades`, mode, cls: "key" });
const ddCard = (t, mode) => stat({ label: "Deepest drawdown", value: drawdown(t.worstDrawdownPct), sub: "The furthest any one agent has fallen from its peak.", mode, cls: "key" });
function drawSummary() {
  const box = $("#stats");
  const s = S.summary;
  const agents = [...S.agents.values()];
  const T = modeTotals(agents);
  if (!s) {
    box.replaceChildren(el("p", "fail", `The summary could not be loaded (${whyNot(S.summaryError)}). The agents and the desk below are HQ's own.`));
    return;
  }
  $("#hq-mode").replaceChildren(modeTag(s.mode));
  $("#hq-updated").replaceChildren("Updated ", when(s.updatedAt));
  const buyback = stat({ label: "$CIA bought back", value: sol(s.buybacks.solSpent), sub: `${fmtTokens(s.buybacks.ciaBought)} $CIA in ${s.buybacks.count} ${s.buybacks.count === 1 ? "buyback" : "buybacks"}`, mode: "chain" });
  const treasury = stat({ label: "Agency treasury", value: sol(s.treasury.sol), sub: [`${fmtTokens(s.treasury.cia)} $CIA · `, s.treasury.address ? walletLink(s.treasury.address) : "address not set yet"], mode: "chain" });
  $("#hq-agents").textContent = `${s.agents.active} of ${s.agents.total} agents at work`;
  if (s.mode !== "mixed") {
    const m = s.mode, t = T[m];
    const key = el("div", "stats four"), rest = el("div", "stats five");
    key.append(
      stat({ label: "Trading P&L, realized", value: sol(s.tradingPnlSol.realized, { signed: true }), sub: "From closed trades. Creator fees are not in it.", mode: m, cls: "key" }),
      stat({ label: "Trading P&L, unrealized", value: sol(s.tradingPnlSol.unrealized, { signed: true }), sub: "Open positions, at the latest price.", mode: m, cls: "key" }),
      winCard(t, m), ddCard(t, m));
    rest.append(
      stat({ label: "Trades, last 24 hours", value: el("span", "amt", String(s.trades24h.count)), sub: `${fmtSol(s.trades24h.volumeSol)} SOL traded`, mode: m }),
      stat({ label: "SOL in agent wallets", value: sol(s.solInAgentWallets), sub: "Free SOL the agents hold.", mode: m }),
      stat({ label: "Creator fees claimed", value: sol(s.creatorFeesClaimedSol), sub: "From the agents' own coins. Never trading profit.", mode: m }),
      buyback, treasury);
    box.className = "mode-rows hero-stats";
    box.replaceChildren(key, rest);
    return;
  }
  /* Both modes running: HQ's summary adds them up, so the site shows each mode's own figures,
     summed from each agent's record, and leaves out what HQ reports only for both together. */
  const row = (mode) => {
    const t = T[mode];
    const r = el("div", "mode-row");
    const h = el("h3"); h.append(modeTag(mode), mode === "live" ? "Real SOL" : "Simulated, nothing signed");
    const g = el("div", "stats six");
    g.append(
      stat({ label: "Trading P&L, realized", value: sol(t.realizedPnlSol, { signed: true }), mode, cls: "key" }),
      stat({ label: "Trading P&L, unrealized", value: sol(t.unrealizedPnlSol, { signed: true }), mode, cls: "key" }),
      winCard(t, mode), ddCard(t, mode),
      stat({ label: "SOL in agent wallets", value: sol(t.balanceSol), sub: `${t.active} of ${t.agents} agents at work`, mode }),
      stat({ label: "Creator fees claimed", value: sol(t.feesClaimedSol), sub: "Never counted as trading profit.", mode }),
    );
    r.append(h, g);
    return r;
  };
  box.className = "mode-rows hero-stats";
  const chain = el("div", "stats six"); chain.append(buyback, treasury);
  box.replaceChildren(row("live"), row("paper"), chain,
    el("p", "note-line", `HQ runs paper and live agents. Its trade count for the last 24 hours (${s.trades24h.count}) covers both, so it is not split here; every trade on the desk below is marked.`));
}

/* ── the tape: the agency's coins ──────────────────────────────────────── */
function drawTape() {
  const tape = $("#tape"), track = $("#tape-track");
  const coins = [...S.agents.values()].filter((a) => a.coin && a.status !== "retired");
  if (!coins.length) { tape.hidden = true; return; }
  tape.hidden = false;
  const item = (a) => {
    const i = el("span", "tape-item");
    i.append(out(pumpFun(a.coin.mint), coinLabel(a.coin)), el("span", "", `Agent ${a.number}`), modeTag(a.mode), sol(decAdd(a.stats.realizedPnlSol, a.stats.unrealizedPnlSol), { signed: true }));
    return i;
  };
  const cfg = window.CIA_CONFIG || {};
  const lead = el("span", "tape-item");
  lead.append(out(solscanToken(cfg.contractAddress), "$CIA"), el("span", "", "the agency's coin"));
  const run = [lead, ...coins.map(item)];
  const copy = run.map((n) => n.cloneNode(true));
  const twin = el("span", ""); twin.style.display = "contents"; twin.setAttribute("aria-hidden", "true");
  for (const n of copy) for (const a of n.querySelectorAll("a")) a.tabIndex = -1;
  twin.append(...copy);
  track.replaceChildren(...run, twin);
  track.style.setProperty("--tape-s", `${Math.max(30, run.length * 7)}s`);
}

/* ── the recruits ──────────────────────────────────────────────────────── */
const WEEK = 7 * 86400_000;
function recruitCard(a) {
  const card = el("a", "recruit");
  card.href = agentHref(a.id);
  card.style.setProperty("--accent", CATS[catOf(a)].accent);
  const pad = el("div", "recruit-pad");
  pad.append(portrait(a, 0.5), modeTag(a.mode));
  if (Date.now() - Date.parse(a.hiredAt) < WEEK) pad.append(el("span", "new", "New"));
  const body = el("div", "recruit-body");
  const no = el("p", "recruit-no", `Agent ${a.number}`); no.append(statusChip(a.status));
  const chips = el("div", "recruit-chips"); chips.append(rankChip(a.rank, a.mode), strategyChip(a.strategy));
  const nums = el("dl", "recruit-nums");
  const add = (k, v) => { const d = el("div"); const dd = el("dd"); dd.append(v); d.append(el("dt", "", k), dd); nums.append(d); };
  add("Portfolio", sol(a.stats.portfolioSol));
  add("Trading P&L", sol(decAdd(a.stats.realizedPnlSol, a.stats.unrealizedPnlSol), { signed: true }));
  add("Return", pct(a.stats.roiPct));
  add("Won / lost", el("span", "amt", `${a.stats.wins} / ${a.stats.losses}`));
  const foot = el("div", "recruit-foot");
  foot.append(el("span", "", a.coin ? `Coin ${coinLabel(a.coin)}` : "No coin of its own"));
  const hired = el("span", "", "Hired "); hired.append(when(a.hiredAt)); foot.append(hired);
  body.append(no, el("h3", "", a.name), chips, nums, foot);
  card.append(pad, body);
  card.setAttribute("aria-label", `Agent ${a.number}, ${a.name}: open its dossier`);
  return card;
}
function drawRecruits() {
  const box = $("#recruit-list"), more = $("#recruits-more");
  const all = [...S.agents.values()].sort((x, y) => Date.parse(y.hiredAt) - Date.parse(x.hiredAt));
  if (S.agentsFailed) { box.replaceChildren(el("p", "board-empty", `The agents could not be loaded: ${whyNot(S.agentsFailed)}`)); more.hidden = true; return; }
  if (!all.length) { box.replaceChildren(el("p", "board-empty", "HQ has hired no agent yet. The first one appears here the moment it is.")); more.hidden = true; return; }
  const shown = S.allRecruits ? all : all.slice(0, 8);
  box.replaceChildren(...shown.map(recruitCard));
  const note = refusedNote(S.agentsRefused);
  if (note) box.append(note);
  more.hidden = shown.length === all.length;
  more.textContent = `Show all ${all.length} agents`;
  const active = all.filter((a) => a.status === "active").length;
  $("#recruits-count").textContent = `${all.length} hired · ${active} at work`;
}
$("#recruits-more").addEventListener("click", () => { S.allRecruits = true; drawRecruits(); });

/* ── the desk ──────────────────────────────────────────────────────────── */
const sideOf = (x) => (x.kind === "trade" ? x.side : x.action);
function drawDesk(freshId = null) {
  const list = $("#desk-list"), more = $("#desk-more");
  if (S.deskFailed && !S.desk.length) { list.replaceChildren(el("li", "board-empty", `The desk could not be loaded: ${whyNot(S.deskFailed)}`)); more.hidden = true; return; }
  const shown = S.desk.filter((x) => (S.side === "all" || sideOf(x) === S.side) && (S.mode === "both" || x.mode === S.mode));
  if (!shown.length) {
    list.replaceChildren(el("li", "board-empty", S.desk.length ? "Nothing on the desk matches this filter yet." : "The desk is quiet: no agent has decided or traded yet. Every buy and sell appears here the moment HQ makes it."));
  } else list.replaceChildren(...shown.slice(0, S.deskShown).map((x) => deskRow(x, S.agents, { fresh: x.id === freshId })));
  const note = refusedNote(S.deskRefused);
  if (note) { const li = el("li"); li.append(note); list.append(li); }
  more.hidden = !S.deskNext && shown.length <= S.deskShown;
}
async function olderDesk() {
  const more = $("#desk-more");
  S.deskShown += 24;
  const shown = S.desk.filter((x) => (S.side === "all" || sideOf(x) === S.side) && (S.mode === "both" || x.mode === S.mode));
  if (shown.length >= S.deskShown || !S.deskNext) { drawDesk(); return; }
  more.disabled = true;
  try {
    const { value, problems } = await hq.desk({ limit: 60, before: S.deskNext });
    const have = new Set(S.desk.map((x) => x.id));
    S.desk.push(...value.items.filter((x) => !have.has(x.id)));
    S.deskNext = value.next; S.deskRefused += problems.length;
    drawDesk();
  } catch (e) { more.after(el("p", "fail", whyNot(e))); }
  more.disabled = false;
}
$("#desk-more").addEventListener("click", olderDesk);
for (const b of $$("[data-side]")) b.addEventListener("click", () => { S.side = b.dataset.side; press("[data-side]", b); drawDesk(); });
for (const b of $$("button[data-mode]")) b.addEventListener("click", () => { S.mode = b.dataset.mode; press("button[data-mode]", b); drawDesk(); });
function press(sel, on) { for (const b of $$(sel)) b.setAttribute("aria-pressed", String(b === on)); }

/* ── Agent of the Month ────────────────────────────────────────────────── */
async function loadBoards() {
  const key = `${S.by}:${S.period}`;
  S.boardKey = key;
  for (const b of $$(".board-body")) b.style.opacity = ".55";
  let res = null, err = null;
  try { res = await hq.leaderboard({ by: S.by, period: S.period }); } catch (e) { err = e; }
  if (S.boardKey !== key) return;
  for (const mode of ["live", "paper"]) {
    const body = $(`.board[data-mode="${mode}"] [data-slot="board"]`);
    body.style.opacity = "";
    if (err) { body.replaceChildren(el("p", "board-empty", `The board could not be loaded: ${whyNot(err)}`)); continue; }
    drawBoard(body, mode, res.value.boards[mode], mode === "live" ? res.problems.length : 0);
  }
}
function boardValue(r) { return S.by === "roi" ? pct(r.value) : sol(r.value, { signed: true }); }
function pod(r, place) {
  const a = r ? S.agents.get(r.agentId) : null;
  const p = el(a ? "a" : "div", `pod p${place}${r ? "" : " empty"}`);
  if (a) { p.href = agentHref(a.id); p.append(portrait(a, place === 1 ? 0.75 : 0.5)); }
  if (r) {
    p.append(el("span", "pod-name", a ? a.name : `Agent #${r.agentId}`), el("span", "pod-no", a ? `Agent ${a.number}` : ""));
    const v = el("span", "pod-value"); v.append(boardValue(r)); p.append(v, rankChip(r.rank, r.mode));
  } else p.append(el("span", "pod-no", "Open"));
  p.append(el("span", "pod-block", String(place)));
  return p;
}
function drawBoard(body, mode, rows, refused) {
  if (!rows.length) {
    body.replaceChildren(el("p", "board-empty", mode === "live" ? "No agent trades real SOL on this board yet, so it is empty." : "No paper agent on this board yet."));
    return;
  }
  const podium = el("div", "podium");
  podium.append(pod(rows[1], 2), pod(rows[0], 1), pod(rows[2], 3));
  const list = el("ol", "board-rows");
  for (const r of rows.slice(3, 10)) {
    const a = S.agents.get(r.agentId);
    const li = el("li");
    const link = el("a");
    if (a) link.href = agentHref(a.id);
    const face = el("span", "headshot");
    if (a) face.append(portrait(a, 0.25));
    const who = el("span", "row-who");
    who.append(el("b", "", a ? a.name : `Agent #${r.agentId}`), el("span", "", a ? `Agent ${a.number}` : ""));
    link.append(face, who, boardValue(r));
    li.append(link);
    list.append(li);
  }
  const foot = el("p", "board-foot", S.by === "roi" ? "Return: trading P&L over the SOL put in." : "Profit: realized trading P&L, in SOL.");
  body.replaceChildren(podium, ...(rows.length > 3 ? [list] : []), foot);
  const note = refusedNote(refused);
  if (note) body.append(note);
}
for (const b of $$("[data-by]")) b.addEventListener("click", () => { S.by = b.dataset.by; press("[data-by]", b); loadBoards(); });
for (const b of $$("[data-period]")) b.addEventListener("click", () => { S.period = b.dataset.period; press("[data-period]", b); loadBoards(); });

/* ── the stream ─────────────────────────────────────────────────────────── */
function onEvent(type, data) {
  if (type === "trade" || type === "decision") {
    if (S.desk.some((x) => x.id === data.id)) return;
    S.desk.unshift(data);
    if (S.desk.length > 600) S.desk.length = 600;
    if (!S.agents.has(data.agentId)) reloadAgents(); else drawDesk(data.id);
    if (type === "trade") soonReloadAgents();
  } else if (type === "summary") { S.summary = data; drawSummary(); }
  else if (type === "promotion") { reloadAgents(); loadBoards(); }
}
function onState(st) {
  setPill(pill, st);
  if (st === "live") {
    if (streamedOnce) resync();   // back after a gap: what happened in it was not streamed
    streamedOnce = true;
  }
}
async function resync() {
  const [s, d] = await Promise.allSettled([hq.summary(), hq.desk({ limit: 60 })]);
  if (s.status === "fulfilled") S.summary = s.value.value;
  if (d.status === "fulfilled") {
    const have = new Set(S.desk.map((x) => x.id));
    S.desk = [...d.value.value.items.filter((x) => !have.has(x.id)), ...S.desk].sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
  }
  drawSummary(); drawDesk(); reloadAgents();
}

$("#retry").addEventListener("click", boot);
keepTime();
if (hq.online) boot();
else { setState("offline"); setPill(pill, "offline"); }
