/* TRANSPARENCY: the /investors/ page.
   The $CIA mint comes from the one config (and is shown whether or not HQ is online); the rest
   comes from HQ through hq-client.js: the summary (whose live and paper blocks are the agency's
   trading record, shown apart and never added together), the buyback policy and log, and the
   treasury and its flows. Text only; every link from a checked address or signature. */
import { hqClient } from "./hq-client.js";
import { ADDRESS, fmtSol, fmtTokens, fmtPrice, fmtPct, decSign, modeRecord, solscanToken, gmgn } from "./hq-format.js";
import { $, el, out, setState, sol, pct, when, keepTime, txLink, walletLink, stat, refusedNote, whyNot, setPill } from "./hq-ui.js";

const hq = hqClient();
const pill = $("#pill");
let stopStream = null, streamedOnce = false;

/* ── $CIA, from the config: the mint, and its Solscan and GMGN pages ──── */
(function ciaCard() {
  const cfg = window.CIA_CONFIG || {};
  const mint = typeof cfg.contractAddress === "string" ? cfg.contractAddress.trim() : "";
  if (!ADDRESS.test(mint)) return;
  const code = $("#cia-mint");
  code.textContent = mint;
  code.dataset.empty = "false";
  const links = $("#cia-links");
  links.append(out(solscanToken(mint), "Solscan ↗"));
  /* The buy link is used only if it is the GMGN page of that same mint, as home.js requires. */
  const buy = typeof cfg.buyUrl === "string" ? cfg.buyUrl.trim() : "";
  if (buy === gmgn(mint)) links.append(out(gmgn(mint), "GMGN ↗"));
})();

/* ── HQ's figures ──────────────────────────────────────────────────────── */
async function boot() {
  setState("loading");
  setPill(pill, "connecting");
  const [s, b, t] = await Promise.allSettled([hq.summary(), hq.buybacks({ limit: 100 }), hq.treasury()]);
  if ([s, b, t].every((r) => r.status === "rejected")) {
    setState("error"); setPill(pill, "down");
    $("#hq-error-title").textContent = whyNot(s.reason);
    return;
  }
  setState("online");
  drawSummary(s);
  drawBuybacks(b);
  drawTreasury(t);
  drawRecord(s);
  if (!stopStream) stopStream = hq.stream({ onEvent, onState });
}

function drawSummary(r) {
  const box = $("#inv-stats");
  if (r.status === "rejected") { box.replaceChildren(el("p", "fail", `The summary could not be loaded: ${whyNot(r.reason)}`)); return; }
  const s = r.value.value;
  $("#inv-updated").replaceChildren("Updated ", when(s.updatedAt));
  box.replaceChildren(
    stat({ label: "Treasury, SOL", value: sol(s.treasury.sol), sub: s.treasury.address ? walletLink(s.treasury.address) : "Its address is not set yet.", mode: "chain" }),
    stat({ label: "Treasury, $CIA", value: el("span", "amt", fmtTokens(s.treasury.cia)), sub: "$CIA the treasury holds.", mode: "chain" }),
    stat({ label: "$CIA bought back", value: sol(s.buybacks.solSpent), sub: `${fmtTokens(s.buybacks.ciaBought)} $CIA in ${s.buybacks.count} ${s.buybacks.count === 1 ? "buyback" : "buybacks"}`, mode: "chain" }),
    stat({ label: "Creator fees claimed", value: sol(s.creatorFeesClaimedSol), sub: "The agents' coins' fees. Not trading profit.", mode: "chain" }),
  );
}

const SOURCES = { creator_fees: "creator fees", trading_profit: "trading profit" };
function table(cols, rows) {
  const wrap = el("div", "tbl-wrap");
  const t = el("table", "tbl stack");
  const hr = el("tr");
  for (const c of cols) hr.append(el("th", c.num ? "num" : "", c.label));
  const thead = el("thead"); thead.append(hr);
  const body = el("tbody");
  for (const r of rows) {
    const tr = el("tr");
    cols.forEach((c, i) => { const td = el("td", c.num ? "num" : ""); td.dataset.label = c.label; td.append(...[r[i]].flat()); tr.append(td); });
    body.append(tr);
  }
  t.append(thead, body);
  wrap.append(t);
  return wrap;
}
let buybacks = [];
function drawBuybacks(r) {
  if (r.status === "rejected") { $("#policy").replaceChildren(el("p", "fail", `The buybacks could not be loaded: ${whyNot(r.reason)}`)); return; }
  const { policy, items } = r.value.value;
  buybacks = items;
  $("#policy").replaceChildren(
    stat({ label: "Share", value: el("span", "amt", fmtPct(policy.sharePct, { signed: false })), sub: "of what the sources below earn." }),
    stat({ label: "From", value: el("span", "amt small", policy.sources.map((x) => SOURCES[x]).join(" and ")), sub: "Creator fees are the agents' coins' fees." }),
    stat({ label: "When", value: el("span", "amt small", policy.schedule), sub: "HQ's published schedule." }),
    stat({ label: "Then", value: el("span", "amt small", policy.destination === "burn" ? "Burned" : "Kept in the treasury"), sub: policy.destination === "burn" ? "Each burn is its own transaction." : "It stays at the treasury address." }),
  );
  drawBuybackLog(r.value.problems.length);
}
function drawBuybackLog(refused = 0) {
  const box = $("#buyback-log");
  if (!buybacks.length) { box.replaceChildren(el("p", "board-empty", "No buyback has been made yet. Each one will appear here with its transaction.")); return; }
  box.replaceChildren(table(
    [{ label: "When" }, { label: "SOL spent", num: true }, { label: "$CIA bought", num: true }, { label: "Price, SOL", num: true }, { label: "Swap" }, { label: "Burn" }],
    buybacks.map((b) => [when(b.t), sol(b.solSpent, { unit: "" }), fmtTokens(b.ciaBought), b.price === null ? "—" : fmtPrice(b.price), txLink(b.tx, "live"), b.burnTx ? txLink(b.burnTx, "live") : el("span", "tx none", "not burned")]),
  ));
  const note = refusedNote(refused);
  if (note) box.append(note);
}

const FLOWS = { fee_in: ["Creator fees in", "in"], profit_in: ["Trading profit in", "in"], buyback: ["Buyback", "out"], funding_out: ["Funding sent to an agent", "out"], funding_in: ["Funding back from an agent", "in"] };
function drawTreasury(r) {
  if (r.status === "rejected") { $("#flows").replaceChildren(el("p", "fail", `The treasury could not be loaded: ${whyNot(r.reason)}`)); return; }
  const t = r.value.value;
  const line = $("#treasury-address");
  line.replaceChildren(t.address ? walletLink(t.address, t.address) : "Its address is not set yet", ` · ${fmtSol(t.sol)} SOL · ${fmtTokens(t.cia)} $CIA`);
  if (!t.flows.length) { $("#flows").replaceChildren(el("p", "board-empty", "No flows yet.")); return; }
  $("#flows").replaceChildren(table(
    [{ label: "When" }, { label: "Flow" }, { label: "SOL", num: true }, { label: "Transaction" }],
    t.flows.map((f) => {
      const [name, dir] = FLOWS[f.kind];
      /* Never negative: the sign shown is the flow's direction, from its kind. */
      const amount = el("span", `amt flow-${dir}`, `${dir === "in" ? "+" : "−"}${fmtSol(f.sol)}`);
      return [when(f.t), name, amount, txLink(f.tx, "live")];
    }),
  ));
  const note = refusedNote(r.value.problems.length);
  if (note) $("#flows").append(note);
}

/* The agency's trading record: the summary's live block and paper block, side by side. */
function drawRecord(r) {
  for (const mode of ["live", "paper"]) {
    const slot = $(`[data-mode="${mode}"] [data-slot="record"]`);
    if (r.status === "rejected") { slot.replaceChildren(el("p", "fail", `The record could not be loaded: ${whyNot(r.reason)}`)); continue; }
    const T = modeRecord(r.value.value[mode]);
    if (!T.hasAgents) { slot.replaceChildren(el("p", "board-empty", mode === "live" ? "No agent trades real SOL yet, so there is no live record." : "No agent trades on paper.")); continue; }
    const g = el("div", "stats");
    g.append(
      stat({ label: "Trading P&L, realized", value: sol(T.tradingPnlSol.realized, { signed: true }), mode, cls: "key" }),
      stat({ label: "Trading P&L, unrealized", value: sol(T.tradingPnlSol.unrealized, { signed: true }), mode, cls: "key" }),
      stat({ label: "Win rate", value: T.winRatePct === null ? el("span", "amt flat", "n/a") : el("span", "amt", `${T.winRatePct}%`), sub: `${T.wins} won`, mode, cls: "key" }),
      stat({ label: "Losing trades", value: el("span", `amt ${T.losses ? "down" : ""}`, String(T.losses)), sub: `of ${T.wins + T.losses} closed`, mode, cls: "key" }),
      stat({ label: "Deepest drawdown", value: T.maxDrawdownPct === null ? el("span", "amt flat", "n/a") : pct(decSign(T.maxDrawdownPct) > 0 ? `-${T.maxDrawdownPct}` : T.maxDrawdownPct), sub: "Of any one agent.", mode }),
      stat({ label: "Trades, last 24 hours", value: el("span", "amt", String(T.trades24h.count)), sub: `${fmtSol(T.trades24h.volumeSol)} SOL traded`, mode }),
      stat({ label: "SOL in agent wallets", value: sol(T.solInAgentWallets), sub: "Free SOL the agents hold.", mode }),
      stat({ label: "Agents", value: el("span", "amt", String(T.agents.total)), sub: `${T.agents.active} at work`, mode }),
    );
    slot.replaceChildren(g);
  }
}

function onEvent(type, data) {
  if (type === "buyback") { buybacks.unshift(data); drawBuybackLog(); hq.treasury().then((v) => drawTreasury({ status: "fulfilled", value: v }), () => {}); }
  else if (type === "summary") { const r = { status: "fulfilled", value: { value: data, problems: [] } }; drawSummary(r); drawRecord(r); }
  else if (type === "promotion" || type === "trade") { /* the record moves with every trade; reloaded when the stream comes back, not on each */ }
}
function onState(st) {
  setPill(pill, st);
  if (st === "live") { if (streamedOnce) boot(); streamedOnce = true; }
}

$("#retry").addEventListener("click", boot);
keepTime();
if (hq.online) boot();
else { setState("offline"); setPill(pill, "offline"); }
