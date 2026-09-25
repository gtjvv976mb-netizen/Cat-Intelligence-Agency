/* THE WORK FLOOR.
   The office is one picture, and each kitten already sits at its own station in it. This
   script opens a station when its desk (or its name in the list) is clicked, fills every
   station with what that cat has posted, lists the newest from the whole floor, tilts the
   floor a little towards the mouse, and lights the desks in turn while nobody is pointing at
   one. With reduced motion nothing moves on its own.

   The cases come from assets/cases.json, read through cases-data.js and checked entry by
   entry by cases.js, which skips (and names, in the console) anything malformed. The two bots'
   desks show their own files instead: CashCat's launches, and every cat coin Popcat checked (a
   callout when no check found a red flag, "spotted" with its red flags named when one did) with
   Popcat's pick on top, read through bot-posts.js and checked by launches.js and callouts.js the
   same way. The feed shows the callouts and the pick; the spotted coins stay at Popcat's desk.
   Every word is drawn as text and every link has been checked, so nothing in those files can put
   markup or a script on the page, and no coin's own image or link is ever shown. The pick's draft
   is text to select and copy by hand: the page never touches the clipboard. */
import { AGENTS, validateCases } from "./cases.js";
import { loadBotPosts, botTally } from "./bot-posts.js";
import { VENUES, TREND_SOURCES, launchLinks, shorten } from "./launches.js";
import { calloutLinks, ticker, PICK_DISCLOSURE, PICK_LOOKBACK_HOURS } from "./callouts.js";
import { hqClient } from "./hq-client.js";
import { agentPath } from "./hq-format.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const mouse = matchMedia("(hover: hover) and (pointer: fine)");
const CASE_ID = /^(DIR|CRY|GRR|CSH|POP|CMC|SNP)-\d{3,4}$/;
const SPRITE = { director: [150, 211], coinmarketcat: [175, 209], snipurr: [146, 207], "crying-cat": [144, 206], "grumpy-cat": [144, 202], cashcat: [143, 208], popcat: [197, 211] };
const ACCENT = Object.fromEntries($$(".roster li").map((li) => [li.id, { accent: li.style.getPropertyValue("--accent"), text: li.style.getPropertyValue("--accent-text") }]));

/* ── the X link, from the one config; empty until the handle exists ───────── */
const cfg = window.CIA_CONFIG || {};
const xRaw = typeof cfg.xUrl === "string" ? cfg.xUrl.trim() : "";
const xUrl = /^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/?$/.test(xRaw) ? xRaw : "";
function wireX(root) {
  if (!xUrl) return;
  for (const btn of $$("button[data-x-link]", root)) {
    const a = document.createElement("a");
    a.className = btn.className;
    a.href = xUrl;
    a.rel = "noopener";
    a.textContent = btn.dataset.label || "Follow on X";
    btn.replaceWith(a);
  }
}
wireX(document);

/* ── small builders: text only, never markup ──────────────────────────── */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function outLink(href, cls, text) {
  const a = el("a", cls, text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/* What each desk posts: the Director, announcements; the two software cats, field reports; the
   two bots, launches and callouts; the investigators, cases. */
const NOUNS = {
  director: ["announcement", "announcements"], coinmarketcat: ["field report", "field reports"], snipurr: ["field report", "field reports"],
  cashcat: ["launch", "launches"], popcat: ["callout", "callouts"],
};
const noun = (cat) => NOUNS[cat] || ["case", "cases"];

/* ── what is posted: the cases, and the two bots' own files ─────────────── */
const src = {
  cases: { state: "loading", items: [] },      // loading → ready | failed
  launches: { state: "loading", items: [] },
  callouts: { state: "loading", items: [], picks: [] },
};
/* CashCat's desk shows its launches and Popcat's its callouts; every other desk its cases. */
const DESK = { cashcat: "launches", popcat: "callouts" };
const deskOf = (cat) => DESK[cat] || "cases";
const postsOf = (cat) => (deskOf(cat) === "cases" ? src.cases.items.filter((c) => c.agent === cat) : src[deskOf(cat)].items);
const FAIL = {
  cases: "The case files could not be opened here just now. Every case is also posted on the agency's X account.",
  launches: "CashCat's launches could not be opened here just now.",
  callouts: "Popcat's checked coins and its pick could not be opened here just now.",
};
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const FEED_MAX = 60;

/* The pieces every card shares: the article in its cat's colours, the case-file icon, the
   cat's face and name (in the feed), the time, and the button that opens the station. */
function cardShell(cat, key) {
  const art = el("article", "case");
  art.dataset.case = key;
  const tone = ACCENT[cat] || {};
  if (tone.accent) art.style.setProperty("--accent", tone.accent);
  if (tone.text) art.style.setProperty("--accent-text", tone.text);
  const icon = el("img", "case-icon");
  icon.src = "../assets/floor/case-file-112.png";
  icon.width = 44; icon.height = 44; icon.alt = ""; icon.loading = "lazy";
  return { art, icon };
}
function whoIs(cat) {
  const who = el("span", "case-who");
  const face = el("img");
  face.src = `../assets/sprites/${cat}.png`;
  face.alt = ""; face.loading = "lazy";
  const [w, h] = SPRITE[cat];
  face.width = Math.round(w * 26 / h); face.height = 26;
  who.append(face, AGENTS[cat].name);
  return who;
}
function openButton(cat, key) {
  const open = el("button", "case-open", "Open the station");
  open.type = "button";
  open.setAttribute("aria-haspopup", "dialog");
  open.addEventListener("click", () => openStation(cat, key));
  return open;
}
/* "2026-09-24T21:08:50Z" → "2026-09-24 21:08 UTC", machine-readable in datetime. */
function stamp(iso) {
  const t = el("time", "case-date", `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`);
  t.dateTime = iso;
  return t;
}
/* Where a link goes, as the cases show it: "solscan.io · tx 5Ed5y…dWK8", "pump.fun". */
function whereTo(href) {
  const u = new URL(href), last = u.pathname.split("/").pop();
  return u.host === "solscan.io" ? `solscan.io · ${u.pathname.startsWith("/tx/") ? "tx " : ""}${shorten(last)}` : u.host;
}
function linkList(title, links) {
  const ul = el("ul", "case-ev");
  for (const l of links) {
    const li = el("li");
    li.append(outLink(l.href, "", l.label), el("span", "ev-where", whereTo(l.href)));
    ul.append(li);
  }
  return [el("p", "case-ev-title", title), ul];
}
function facts(rows) {
  const dl = el("dl", "case-facts");
  for (const [k, v] of rows) dl.append(el("dt", "", k), el("dd", "", v));
  return dl;
}
const sol = (n) => `${Number(n.toFixed(6))} SOL`;

function caseCard(c, { heading = "h4", withAgent = false } = {}) {
  const { art, icon } = cardShell(c.agent, c.id);
  const meta = el("p", "case-meta");
  if (withAgent) meta.append(whoIs(c.agent));
  meta.append(el("span", "case-id", c.id));
  const when = el("time", "case-date", c.date);
  when.dateTime = c.date;
  meta.append(when, el("span", `verdict v-${slug(c.verdict)}`, c.verdict));

  const body = el("div", "case-body");
  body.append(meta, el(heading, "case-title", c.title), el("p", "case-sum", c.summary));
  if (c.evidence.length) {
    body.append(el("p", "case-ev-title", "Evidence"));
    const ul = el("ul", "case-ev");
    for (const ev of c.evidence) {
      const li = el("li");
      li.append(outLink(ev.href, "", ev.label), el("span", "ev-where", ev.where));
      ul.append(li);
    }
    body.append(ul);
  }
  const foot = el("div", "case-foot");
  if (c.x) foot.append(outLink(c.x, "case-x", "Read on X"));
  if (withAgent) foot.append(openButton(c.agent, c.id));
  if (foot.childNodes.length) body.append(foot);
  art.append(icon, body);
  return art;
}

/* A CashCat launch: the coin's name and ticker, CashCat's line about it, the trend it
   follows, where and against what it launched, the dev buy (none by default) and what the
   launch cost, all as text; the links are the venue's page and Solscan, built by launches.js. */
function launchCard(l, { heading = "h4", withAgent = false } = {}) {
  const { art, icon } = cardShell("cashcat", l.mint);
  const meta = el("p", "case-meta");
  if (withAgent) meta.append(whoIs("cashcat"));
  const where = l.venue === "pumpfun" ? VENUES.pumpfun.name : `${l.venue === "stonkfun" ? "StonkFun" : "pump.fun"} · ${l.quote.symbol}`;
  meta.append(el("span", "case-id", "Launch"), stamp(l.time), el("span", "verdict v-launch", where));
  const body = el("div", "case-body");
  body.append(meta, el(heading, "case-title", `${l.name} ($${l.symbol})`), el("p", "case-sum", l.tagline));
  body.append(facts([
    ["Trend", `${l.trend.title} (${TREND_SOURCES[l.trend.source]})`],
    ["Venue", VENUES[l.venue].name],
    ["Paired with", l.quote.symbol],
    ["Dev buy", l.devBuy.sol > 0 ? `${sol(l.devBuy.sol)}, from CashCat's own wallet` : "None"],
    ["Launch cost", `${sol(l.costSol)}, read from the chain`],
  ]));
  body.append(el("p", "case-note", "Launched automatically by CashCat, the agency's own bot. Not affiliated with its trend. Not financial advice."));
  body.append(...linkList("Linked", launchLinks(l)));
  if (withAgent) { const foot = el("div", "case-foot"); foot.append(openButton("cashcat", l.mint)); body.append(foot); }
  art.append(icon, body);
  return art;
}

/* A coin Popcat checked: its name and ticker as text (never its image or its links), the word
   that made it a cat coin, and every check Popcat ran with what it found. With no red flag it is
   a callout; with one or more it is spotted, and each red flag is named in plain words first. */
function calloutCard(c, { heading = "h4", withAgent = false } = {}) {
  const { art, icon } = cardShell("popcat", c.mint);
  const meta = el("p", "case-meta");
  if (withAgent) meta.append(whoIs("popcat"));
  meta.append(el("span", "case-id", c.callout ? "Callout" : "Spotted"), stamp(c.time),
    el("span", `verdict ${c.callout ? "v-no-red-flags-found" : "v-red-flags"}`, c.callout ? "No red flags found" : `Red flags (${c.flags.length})`));
  const body = el("div", "case-body");
  const cat = `A new cat coin on pump.fun, a cat by its ${c.cat.field}: “${c.cat.word}”.`;
  body.append(meta, el(heading, "case-title", `${c.name} (${ticker(c.symbol)})`),
    el("p", "case-sum", c.callout ? `${cat} Every check Popcat ran is below, with what it found; none found a red flag.`
      : `${cat} Spotted, not called out: ${plural(c.flags.length, "check", "checks")} found a red flag.`));
  if (!c.callout) {
    const ul = el("ul", "flags");
    for (const f of c.flags) { const li = el("li"); li.append(el("b", "", f.flag), " ", el("span", "flag-found", `Found: ${f.value}.`)); ul.append(li); }
    body.append(ul);
  }
  body.append(el("p", "case-ev-title", "Popcat's checks"));
  body.append(facts(c.checks.map((k) => [k.label, k.result === "info" ? `${k.value} (for information)` : k.result === "fail" ? `${k.value} (red flag)` : k.value])));
  body.append(el("p", "case-note", c.callout
    ? "A list of checks, not advice and not a buy signal. The agency never holds, buys or sells a coin it calls out, and Popcat never lists a coin CashCat launched."
    : "What Popcat's checks read on chain at that moment: not an accusation, and not advice. Popcat never lists a coin CashCat launched."));
  body.append(...linkList("Linked", calloutLinks(c)));
  if (withAgent) { const foot = el("div", "case-foot"); foot.append(openButton("popcat", c.mint)); body.append(foot); }
  art.append(icon, body);
  return art;
}

/* Popcat's pick: at most one coin a six-hour window, with its window, the facts it was chosen
   on, and the draft the agency may post by hand on pump.fun, as text to select and copy. */
const hhmm = (iso) => iso.slice(11, 16);
const count = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (x) => `${Number(x.toFixed(x < 10 ? 2 : 1))}%`;   // as the checks print it
function pickCard(p, { heading = "h4", withAgent = false } = {}) {
  const { art, icon } = cardShell("popcat", `pick-${p.window}`);
  art.classList.add("pick");
  const windowText = `${hhmm(p.window)}–${p.end.slice(11, 13) === "00" ? "24:00" : hhmm(p.end)} UTC on ${p.window.slice(0, 10)}`;
  const meta = el("p", "case-meta");
  if (withAgent) meta.append(whoIs("popcat"));
  const when = el("time", "case-date", windowText);
  when.dateTime = p.window;
  meta.append(el("span", "case-id", "Popcat's pick"), when, el("span", "verdict v-pick", "No red flags found"));
  const body = el("div", "case-body");
  body.append(meta, el(heading, "case-title", `${p.name} (${ticker(p.symbol)})`),
    el("p", "case-sum", `Popcat's pick for ${windowText}, chosen at ${hhmm(p.time)} UTC from the cat coins it checked in the ${PICK_LOOKBACK_HOURS} hours before: of those in which no check found a red flag, the one with the most holders (then the most transactions on its bonding curve, then the most of its curve sold).`));
  body.append(facts([
    ["Checked", `${p.checked.slice(0, 10)} ${hhmm(p.checked)} UTC`],
    ["Holders", `${count(p.stats.holders)} besides the bonding curve`],
    ["Top 10 hold", `${pct(p.stats.top10Pct)} of the supply`],
    ["Transactions on its curve", p.stats.txs === null ? "not counted" : `${count(p.stats.txs)}${p.stats.txs >= 5000 ? " or more" : ""}`],
    ["Bonding curve", p.stats.curvePct >= 100 ? "complete" : `${pct(p.stats.curvePct)} sold`],
  ]));
  body.append(el("p", "case-ev-title", "The draft callout, to post by hand"));
  body.append(el("p", "pick-draft", p.draft));
  body.append(el("p", "case-note", "Select it and copy it yourself: this page never touches your clipboard. The agency posts it, when it does, by hand from its own account on pump.fun, at most one callout every six hours. The checks were true when they ran, not necessarily now."));
  if (Date.now() >= Date.parse(p.end)) body.append(el("p", "case-note", "This window has ended."));
  body.append(el("p", "case-note pick-disclosure", PICK_DISCLOSURE));
  body.append(...linkList("Linked", calloutLinks(p)));
  if (withAgent) { const foot = el("div", "case-foot"); foot.append(openButton("popcat", src.callouts.items.some((x) => x.mint === p.mint) ? p.mint : "")); body.append(foot); }
  art.append(icon, body);
  return art;
}

const CARD = { cases: caseCard, launches: launchCard, callouts: calloutCard };

function renderCounts() {
  const tally = $("#tally");
  if (tally) {
    const called = src.callouts.items.filter((c) => c.callout).length, spotted = src.callouts.items.length - called;
    const parts = [[src.cases.items.length, "case", "cases"], [src.launches.items.length, "launch", "launches"], [called, "callout", "callouts"], [spotted, "spotted cat coin", "spotted cat coins"]]
      .filter(([n]) => n).map(([n, one, many]) => plural(n, one, many));
    tally.textContent = Object.values(src).some((s) => s.state === "loading") ? "Opening the case files…"
      : parts.length ? `${parts.join(" · ")} posted` : src.cases.state === "failed" ? "Case files unavailable here" : "Nothing posted yet";
  }
  for (const cat of Object.keys(AGENTS)) {
    const ready = src[deskOf(cat)].state === "ready";
    const n = postsOf(cat).length;
    const [one, many] = noun(cat);
    const tally = cat === "popcat" ? botTally(cat, postsOf(cat)) : "";
    const label = !ready ? many : tally ? tally[0].toUpperCase() + tally.slice(1) : n ? plural(n, one, many) : `No ${many} yet`;
    for (const span of $$(`[data-count="${cat}"]`)) {
      span.textContent = label;
      span.classList.toggle("has", n > 0);
    }
    const name = AGENTS[cat].name;
    for (const b of $$(`.spot[data-cat="${cat}"], .roster-btn[data-cat="${cat}"]`)) {
      const beat = b.querySelector(".tag-beat, .r-no")?.textContent || "";
      b.setAttribute("aria-label", `${name}'s station. ${beat}. ${ready ? label : "Open it"}.`);
    }
  }
}

/* The feed: Popcat's latest pick on top, then every case, launch and callout, newest first. A
   case carries only its day, so it sits below the launches and callouts of that same day. The
   coins Popcat spotted (with red flags) stay at its desk. The newest FEED_MAX are listed; every
   post is also at its cat's desk. */
function renderFeed() {
  const list = $("#feed-list"), empty = $("#feed-empty"), fail = $("#feed-fail"), msg = $("#feed-state"), more = $("#feed-more");
  if (!list) return;
  const settled = Object.values(src).every((s) => s.state !== "loading");
  const failed = Object.keys(src).filter((k) => src[k].state === "failed");
  const items = [
    ...src.cases.items.map((x) => ({ kind: "cases", cat: x.agent, at: x.date, x })),
    ...src.launches.items.map((x) => ({ kind: "launches", cat: "cashcat", at: x.time, x })),
    ...src.callouts.items.filter((x) => x.callout).map((x) => ({ kind: "callouts", cat: "popcat", at: x.time, x })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  msg.hidden = settled;
  fail.hidden = !settled || failed.length === 0;
  fail.textContent = failed.map((k) => FAIL[k]).join(" ");
  const pick = src.callouts.picks[0];
  empty.hidden = !settled || failed.length > 0 || items.length > 0 || Boolean(pick);
  list.hidden = !settled || (items.length === 0 && !pick);
  const top = settled && pick ? [(() => { const li = el("li", "feed-pick"); li.append(pickCard(pick, { heading: "h3", withAgent: true })); return li; })()] : [];
  list.replaceChildren(...top, ...(settled ? items.slice(0, FEED_MAX) : []).map((i) => { const li = el("li"); li.append(CARD[i.kind](i.x, { heading: "h3", withAgent: true })); return li; }));
  if (more) {
    more.hidden = !settled || items.length <= FEED_MAX;
    more.textContent = `The newest ${FEED_MAX} of ${items.length} posts. Every one of them is at its cat's desk.`;
  }
}

/* ── a station ─────────────────────────────────────────────────────────── */
const dialog = $("#station");
const slot = dialog.querySelector(".st-slot");
let opener = null;
let current = null;

function fillStation(cat) {
  const kind = deskOf(cat), { state } = src[kind];
  const mine = postsOf(cat);
  const list = slot.querySelector('[data-slot="cases"]');
  const none = slot.querySelector('[data-slot="none"]');
  const tpl = slot.querySelector('[data-slot="tpl"]');
  const count = slot.querySelector('[data-slot="count"]');
  list.replaceChildren(...mine.map((x) => CARD[kind](x)));
  count.textContent = state === "ready" && mine.length ? String(mine.length) : "";
  none.hidden = !(state === "ready" && mine.length === 0);
  if (state === "failed" && !slot.querySelector(".feed-fail")) list.before(el("p", "feed-fail", FAIL[kind]));
  // A bot's status says how much it has posted, once its file is read: "Bot · no launches yet".
  const status = slot.querySelector("[data-bot-status]");
  if (status) status.textContent = state === "ready" ? `Bot · ${botTally(cat, mine)}` : "Bot";
  // Popcat's desk opens on its latest pick, when it has one.
  const pickSlot = slot.querySelector('[data-slot="pick"]');
  if (pickSlot) {
    const p = state === "ready" ? src.callouts.picks[0] : null;
    pickSlot.hidden = !p;
    pickSlot.replaceChildren(...(p ? [pickCard(p)] : []));
  }
  // With nothing posted, the template shows how a post will read; once posts exist it folds away.
  tpl.open = !(state === "ready" && mine.length > 0);
}

function openStation(cat, caseId = "") {
  const tpl = document.getElementById("tpl-" + cat);
  if (!tpl) return;
  slot.replaceChildren(tpl.content.cloneNode(true));
  const st = slot.firstElementChild;
  const name = st.querySelector(".st-name");
  name.id = "station-title";
  dialog.setAttribute("aria-labelledby", "station-title");
  dialog.style.setProperty("--accent", st.style.getPropertyValue("--accent"));
  dialog.style.setProperty("--accent-text", st.style.getPropertyValue("--accent-text"));
  dialog.dataset.cat = cat;
  current = cat;
  wireX(slot);
  fillStation(cat);
  if (!dialog.open) {
    opener = document.activeElement;
    dialog.showModal();
  }
  slot.scrollTop = 0;
  history.replaceState(null, "", "#" + (caseId || cat));
  if (caseId) {
    const card = slot.querySelector(`[data-case="${caseId}"]`);
    if (card) { card.classList.add("lit"); card.scrollIntoView({ block: "start" }); }
  }
  floor.classList.add("asleep");
  hqLinks(cat);
}

/* ── the cat's agents at Agency HQ ────────────────────────────────────────
   When HQ is online, a station links to the agents HQ runs as that cat (its "cat" is the
   station's), each to its dossier, with its mode. Nothing is shown while HQ is offline. */
const hq = hqClient();
let hqAgents = [];
function hqLinks(cat) {
  const box = slot.querySelector(".st-id");
  const old = slot.querySelector(".st-live");
  if (old) old.remove();
  const mine = hqAgents.filter((a) => a.cat === cat);
  if (!box || !mine.length) return;
  const p = el("p", "st-live", mine.length === 1 ? "Live at Agency HQ:" : "At Agency HQ:");
  for (const a of mine.slice(0, 4)) {
    const one = el("span", "st-agent");
    const link = el("a", "", `Agent ${a.number}, ${a.name}`);
    link.href = "../" + agentPath(a.id);
    one.append(link, el("span", "st-mode", a.mode === "paper" ? "paper" : "live"));
    p.append(one);
  }
  box.append(p);
}
if (hq.online) {
  hq.agents()
    .then(({ value }) => { hqAgents = value.agents.filter((a) => a.status !== "retired"); if (current) hqLinks(current); })
    .catch((e) => console.warn("Agency HQ:", e && e.message ? e.message : e));
}

dialog.querySelector(".st-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
dialog.addEventListener("close", () => {
  // The close event arrives a task later. If a station was opened again in between (a link
  // to a case, a quick second click), it is that station's panel now: leave it alone.
  if (dialog.open) return;
  slot.replaceChildren();
  current = null;
  history.replaceState(null, "", location.pathname + location.search);
  floor.classList.toggle("asleep", !onScreen);
  if (opener && typeof opener.focus === "function") opener.focus({ preventScroll: true });
});
for (const b of $$(".spot, .roster-btn")) b.addEventListener("click", () => openStation(b.dataset.cat));

/* A link to a station (#crying-cat), to a case (#CRY-001), or to a launch or a callout by its
   coin's mint (#<mint>) opens it. */
function route() {
  let h = "";
  try { h = decodeURIComponent(location.hash.slice(1)); } catch { return false; }   // a malformed #%E0 is no station
  if (!h) return false;
  if (Object.prototype.hasOwnProperty.call(AGENTS, h)) { openStation(h); return true; }
  if (CASE_ID.test(h)) {
    const c = src.cases.items.find((x) => x.id === h);
    if (c) { openStation(c.agent, c.id); return true; }
  }
  if (MINT.test(h)) {
    for (const [cat, kind] of Object.entries(DESK)) {
      if (src[kind].items.some((x) => x.mint === h)) { openStation(cat, h); return true; }
    }
  }
  return false;
}
addEventListener("hashchange", route);

/* ── the floor comes alive ─────────────────────────────────────────────── */
const frame = $("#floorframe");
const floor = $("#floor");
const spots = $$(".spot");
let onScreen = true;

new IntersectionObserver((entries) => {
  onScreen = entries[0].isIntersecting;
  floor.classList.toggle("asleep", !onScreen || dialog.open);
}, { threshold: 0 }).observe(frame);

// On a phone the floor pans: start it where the middle desks are.
function centrePan() {
  const spare = frame.scrollWidth - frame.clientWidth;
  if (spare > 0) frame.scrollLeft = Math.round(spare * 0.4);
}
centrePan();
$(".floor-art").addEventListener("load", centrePan);

// The tilt: a few degrees towards the mouse, eased, only with a mouse and only with motion.
let aimX = 0, aimY = 0, nowX = 0, nowY = 0, raf = 0;
function tiltStep() {
  raf = 0;
  nowX += (aimX - nowX) * 0.09;
  nowY += (aimY - nowY) * 0.09;
  floor.style.setProperty("--ry", (nowX * 3.2).toFixed(3) + "deg");
  floor.style.setProperty("--rx", (-nowY * 2.2).toFixed(3) + "deg");
  if (Math.abs(aimX - nowX) > 0.002 || Math.abs(aimY - nowY) > 0.002) raf = requestAnimationFrame(tiltStep);
  else if (!aimX && !aimY) { floor.classList.remove("tilting"); floor.style.removeProperty("--zoom"); }
}
frame.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || !mouse.matches || reduce.matches) return;
  const r = frame.getBoundingClientRect();
  aimX = (e.clientX - r.left) / r.width - 0.5;
  aimY = (e.clientY - r.top) / r.height - 0.5;
  floor.classList.add("tilting");
  floor.style.setProperty("--zoom", "1.03");
  if (!raf) raf = requestAnimationFrame(tiltStep);
});
frame.addEventListener("pointerleave", () => { aimX = aimY = 0; if (!raf) raf = requestAnimationFrame(tiltStep); });

// The tour: while nobody points at a desk, the desks light up one after another.
let tourAt = -1, lastUser = 0;
const quiet = () => performance.now() - lastUser > 7000;
function tour() {
  const on = !reduce.matches && onScreen && !document.hidden && !dialog.open && quiet();
  spots.forEach((s) => s.classList.remove("tour"));
  if (!on) return;
  tourAt = (tourAt + 1) % spots.length;
  spots[tourAt].classList.add("tour");
  setTimeout(() => spots[tourAt]?.classList.remove("tour"), 2300);
}
const user = () => { lastUser = performance.now(); spots.forEach((s) => s.classList.remove("tour")); };
frame.addEventListener("pointerover", (e) => { if (e.target.closest(".spot")) user(); });
frame.addEventListener("focusin", user);
setInterval(tour, 3000);
setTimeout(tour, 900);

/* ── load what the cats have posted ─────────────────────────────────────── */
renderCounts();
const deepLinked = route();
if (deepLinked) requestAnimationFrame(() => scrollTo(0, 0));
function refresh() {
  renderCounts();
  renderFeed();
  if (current) fillStation(current);
  else if (!deepLinked && route()) requestAnimationFrame(() => scrollTo(0, 0));
}
import("./cases-data.js")
  .then((mod) => {
    const { cases: ok, problems } = validateCases(mod.default);
    for (const p of problems) console.warn("cases.json:", p);
    src.cases = { state: "ready", items: ok };
  })
  .catch((e) => {
    src.cases = { state: "failed", items: [] };
    console.warn("cases.json could not be read:", e && e.message ? e.message : e);
  })
  .finally(refresh);
loadBotPosts()
  .then((posts) => { src.launches = posts.launches; src.callouts = posts.callouts; })
  .catch((e) => {
    src.launches = { state: "failed", items: [] };
    src.callouts = { state: "failed", items: [] };
    console.warn("the bots' files could not be read:", e && e.message ? e.message : e);
  })
  .finally(refresh);
