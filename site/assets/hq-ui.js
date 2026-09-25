/* AGENCY HQ: THE PIECES EVERY HQ PAGE DRAWS WITH.
   Text only: every word from HQ goes in with textContent, never as markup, and every outside
   link is built by hq-format.js from an address or a signature the validator already checked
   (Solscan, pump.fun, GMGN), so nothing HQ sends can put a script, a tag or a strange link on a
   page. Each number wears its mode (PAPER or LIVE; ON CHAIN for the treasury's and the
   buybacks' own transactions), and each gain or loss its sign as a character as well as a
   colour. */
import {
  fmtSol, fmtPct, fmtPrice, fmtAgo, fmtUtc, signClass, solscanTx, solscanAccount, solscanToken, pumpFun, shortAddr, agentPath,
  RANKS, rankOf, SKINS, RANK_ART, CATS, STRATEGIES, skinOf, ticker,
} from "./hq-format.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
/* Where the site's root is from this page ("../" on /hq/, "../../" on /hq/agent/). */
export const ROOT = (typeof document !== "undefined" && document.documentElement.dataset.root) || "./";

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}
/* An outside link, only for an href hq-format.js built; with none, the text stays plain. */
export function out(href, text, cls = "") {
  if (!href) return el("span", cls, text);
  const a = el("a", cls, text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}
export const setState = (state) => { document.documentElement.dataset.hq = state; };

/* ── mode, sign, amount ─────────────────────────────────────────────────── */
const MODE_WORDS = { live: "Live", paper: "Paper", chain: "On chain" };
export function modeTag(mode) {
  const t = el("span", `mode mode-${mode}`, MODE_WORDS[mode] || mode);
  t.title = mode === "paper" ? "Paper: simulated from live quotes. Nothing signed, no money." : mode === "live" ? "Live: real SOL, every trade on chain." : mode === "chain" ? "A transaction on Solana, linked." : "";
  return t;
}
export function sol(value, { signed = false, unit = "SOL", cls = "" } = {}) {
  const s = el("span", `amt ${signed ? signClass(value) : ""} ${cls}`.trim());
  s.append(fmtSol(value, { signed }));
  if (unit) s.append(" ", el("small", "unit", unit));
  return s;
}
export function pct(value, { signed = true, cls = "" } = {}) {
  if (value === null || value === undefined) return el("span", `amt flat ${cls}`.trim(), "n/a");
  return el("span", `amt ${signed ? signClass(value) : ""} ${cls}`.trim(), fmtPct(value, { signed }));
}
/* A time, as "5m ago", with its UTC stamp on hover and in datetime; tick() keeps it fresh. */
export function when(iso) {
  const t = el("time", "ago", fmtAgo(iso));
  t.dateTime = iso;
  t.title = fmtUtc(iso);
  return t;
}
export function tick() { for (const t of $$("time.ago")) t.textContent = fmtAgo(t.dateTime); }
export function keepTime() { setInterval(tick, 30_000); }

/* ── links ──────────────────────────────────────────────────────────────── */
export function txLink(tx, mode) {
  if (tx) { const a = out(solscanTx(tx), "tx ↗", "tx"); a.title = `Solscan: ${shortAddr(tx)}`; return a; }
  return el("span", "tx none", mode === "paper" ? "paper · no tx" : "no tx");
}
export function walletLink(address, text = shortAddr(address)) { return out(solscanAccount(address), text, "addr"); }
export function tokenLink(mint, symbol) { return out(solscanToken(mint), ticker(symbol), "sym"); }
export function coinLinks(coin) {
  const w = el("span", "coin-links");
  w.append(out(pumpFun(coin.mint), "pump.fun ↗"), out(solscanToken(coin.mint), "Solscan ↗"));
  return w;
}
export function agentHref(id) { const p = agentPath(id); return p ? ROOT + p : ""; }
export function agentLink(agent, text) {
  const a = el("a", "agent-link", text ?? agent.name);
  a.href = agentHref(agent.id);
  return a;
}

/* ── art: the skins, the ranks and the brand cats, drawn pixelated ──────── */
/* An agent's portrait: its skin, or its rank's when HQ names a skin the site has no art for. */
export function portrait(agent, scale = 0.5, { alt = "" } = {}) {
  const skin = skinOf(agent);
  const [w, h] = SKINS[skin].size;
  const img = el("img", "px portrait");
  img.src = `${ROOT}assets/hq/skins/${skin}.png`;
  img.width = Math.round(w * scale); img.height = Math.round(h * scale);
  img.alt = alt; img.loading = "lazy"; img.decoding = "async";
  return img;
}
export function rankArt(rank, scale = 0.25) {
  const art = RANK_ART[rank];
  const img = el("img", "px rank-art");
  img.src = `${ROOT}assets/hq/ranks/${rank}.png`;
  img.width = Math.round(art.size[0] * scale); img.height = Math.round(art.size[1] * scale);
  img.alt = ""; img.loading = "lazy"; img.decoding = "async";
  return img;
}
/* A rank chip: its art, its name, and "paper" when the rank was earned on paper. */
export function rankChip(rank, mode, { art = true } = {}) {
  const r = rankOf(rank);
  const c = el("span", `rank-chip r-${rank}`);
  if (art) c.append(rankArt(rank, 0.125));
  c.append(el("span", "", r ? r.name : rank));
  if (mode === "paper") c.append(el("span", "rank-paper", "paper"));
  c.title = `${r ? r.name : rank}: cosmetic, from career realized trading profit${mode === "paper" ? ", earned on paper" : ""}`;
  return c;
}
export function catFace(cat, height = 26) {
  const [w, h] = CATS[cat].size;
  const img = el("img", "px cat-face");
  img.src = `${ROOT}assets/sprites/${cat}.png`;
  img.height = height; img.width = Math.round((w * height) / h);
  img.alt = ""; img.loading = "lazy";
  return img;
}
export function strategyChip(strategy) {
  const s = STRATEGIES[strategy];
  const c = el("span", "strat-chip");
  c.append(catFace(s.sprite, 20), el("span", "", s.cat));
  c.title = `${s.cat}: ${s.does}`;
  return c;
}
export function statusChip(status) { return el("span", `status-chip st-${status}`, status); }

/* ── cards and notes ────────────────────────────────────────────────────── */
/* A stat card: its label, its value (built by the caller), a line under it, and its mode. */
export function stat({ label, value, sub = "", mode = null, cls = "" }) {
  const c = el("div", `stat ${cls}`.trim());
  const head = el("div", "stat-head");
  head.append(el("span", "stat-label", label));
  if (mode) head.append(modeTag(mode));
  const v = el("div", "stat-value");
  v.append(value);
  c.append(head, v);
  if (sub) {
    const d = el("div", "stat-sub");
    d.append(...(Array.isArray(sub) ? sub : [sub]));
    c.append(d);
  }
  return c;
}
/* When a list had entries the validator refused, the page says how many. */
export function refusedNote(n) {
  if (!n) return null;
  return el("p", "refused", `HQ sent ${n} ${n === 1 ? "entry" : "entries"} this page could not verify against the contract, so ${n === 1 ? "it is" : "they are"} not shown.`);
}
/* What a failed load says, by why it failed. */
export function whyNot(e) {
  const kind = e && e.kind;
  if (kind === "offline") return "Agency HQ is not online yet.";
  if (kind === "invalid") return "HQ sent an answer this page could not verify against the contract, so none of it is shown.";
  if (kind === "http") return "HQ answered with an error just now.";
  return "HQ is not answering just now.";
}
/* The live pill: offline, connecting, live, reconnecting or down. */
const PILL = { offline: "HQ offline", online: "HQ online", connecting: "Connecting", live: "Live stream", reconnecting: "Reconnecting", down: "Stream down, retrying" };
export function setPill(node, state) {
  if (!node) return;
  node.dataset.state = state;
  const label = node.querySelector(".pill-text");
  if (label) label.textContent = PILL[state] || state;
}
export const RANK_LIST = RANKS;

/* ── one line of the trading desk: a trade or a decision ───────────────── */
export const TRIGGER_WORDS = { strategy: "Strategy", stop_loss: "Stop loss", take_profit: "Take profit", trailing_stop: "Trailing stop", daily_limit: "Daily loss limit", manual: "Manual" };
export const CHECK_WORDS = { mint_authority: "Mint authority", freeze_authority: "Freeze authority", holders: "Holders", creator_share: "Creator's share" };
/* Crying Cat's rug check, as HQ sends it: every buy trade carries a passed one; a buy decision
   carries it once the check ran, and a refused one means no trade followed. A buy decision made
   before the check says so. */
export function rugLine(item) {
  const d = el("div", "rug");
  const rc = item.rugCheck;
  if (!rc) { d.append(el("b", "no", "Rug check"), el("i", "", "Not run yet: no buy is made before it passes.")); return d; }
  d.append(el("b", rc.passed ? "" : "fail", rc.passed ? "Rug check passed" : "Rug check refused this buy"));
  for (const c of rc.checks) d.append(el("span", c.pass ? "" : "f", `${CHECK_WORDS[c.id]}: ${c.detail}`));
  return d;
}
export function deskRow(item, agents, { fresh = false, withAgent = true } = {}) {
  const a = agents.get(item.agentId);
  const li = el("li", `desk-row ${item.kind === "trade" ? item.side : "decision"}${fresh ? " fresh" : ""}${withAgent ? "" : " solo"}`);
  const main = el("div", "desk-main");
  if (withAgent) {
    const face = el("div", "face");
    if (a) face.append(portrait(a, 0.25));
    li.append(face);
    const who = el("div", "desk-who");
    who.append(a ? `Agent ${a.number}` : `Agent #${item.agentId}`);
    if (a) who.append(agentLink(a));
    who.append(modeTag(item.mode));
    main.append(who);
  }
  const what = el("div", "desk-what");
  if (item.kind === "trade") {
    what.append(el("span", `side ${item.side}`, item.side), tokenLink(item.mint, item.symbol), sol(item.sol), el("span", "price", `at ${fmtPrice(item.price)} SOL`));
    if (item.pnlSol !== null) what.append(sol(item.pnlSol, { signed: true }));
    if (item.pnlPct !== null) what.append(pct(item.pnlPct));
    if (item.trigger !== "strategy") what.append(el("span", `trigger t-${item.trigger}`, TRIGGER_WORDS[item.trigger]));
  } else {
    what.append(el("span", "side decided", `Decided: ${item.action}`));
    if (item.mint && item.symbol) what.append(tokenLink(item.mint, item.symbol));
  }
  if (!withAgent) what.append(modeTag(item.mode));
  main.append(what);
  const side = el("div", "desk-side");
  side.append(when(item.t));
  if (item.kind === "trade") side.append(txLink(item.tx, item.mode));
  li.append(main, side);
  if (item.kind === "decision") li.append(el("p", "desk-reason", item.reason));
  if ((item.kind === "trade" && item.side === "buy") || (item.kind === "decision" && item.action === "buy")) li.append(rugLine(item));
  return li;
}
