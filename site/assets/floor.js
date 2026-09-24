/* THE WORK FLOOR.
   The office is one picture, and each kitten already sits at its own station in it. This
   script opens a station when its desk (or its name in the list) is clicked, fills every
   station with the cases that cat has posted, lists the newest from the whole floor, tilts
   the floor a little towards the mouse, and lights the desks in turn while nobody is
   pointing at one. With reduced motion nothing moves on its own.

   The cases come from assets/cases.json, read through cases-data.js and checked entry by
   entry by cases.js, which skips (and names, in the console) anything malformed. Every word
   of a case is drawn as text and every link it carries has been checked, so nothing in that
   file can put markup or a script on the page. */
import { AGENTS, validateCases } from "./cases.js";

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
   two bots being built, launches and callouts; the investigators, cases. */
const NOUNS = {
  director: ["announcement", "announcements"], coinmarketcat: ["field report", "field reports"], snipurr: ["field report", "field reports"],
  cashcat: ["launch", "launches"], popcat: ["callout", "callouts"],
};
const noun = (cat) => NOUNS[cat] || ["case", "cases"];

/* ── the cases ─────────────────────────────────────────────────────────── */
let cases = [];
let state = "loading";   // loading → ready | failed

function caseCard(c, { heading = "h4", withAgent = false } = {}) {
  const art = el("article", "case");
  art.dataset.case = c.id;
  const tone = ACCENT[c.agent] || {};
  if (tone.accent) art.style.setProperty("--accent", tone.accent);
  if (tone.text) art.style.setProperty("--accent-text", tone.text);

  const icon = el("img", "case-icon");
  icon.src = "../assets/floor/case-file-112.png";
  icon.width = 44; icon.height = 44; icon.alt = ""; icon.loading = "lazy";

  const meta = el("p", "case-meta");
  if (withAgent) {
    const who = el("span", "case-who");
    const face = el("img");
    face.src = `../assets/sprites/${c.agent}.png`;
    face.alt = ""; face.loading = "lazy";
    const [w, h] = SPRITE[c.agent];
    face.width = Math.round(w * 26 / h); face.height = 26;
    who.append(face, AGENTS[c.agent].name);
    meta.append(who);
  }
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
  if (withAgent) {
    const open = el("button", "case-open", "Open the station");
    open.type = "button";
    open.setAttribute("aria-haspopup", "dialog");
    open.addEventListener("click", () => openStation(c.agent, c.id));
    foot.append(open);
  }
  if (foot.childNodes.length) body.append(foot);
  art.append(icon, body);
  return art;
}

function renderCounts() {
  const total = cases.length;
  const tally = $("#tally");
  if (tally) tally.textContent = state === "failed" ? "Case files unavailable here" : state === "loading" ? "Opening the case files…"
    : total ? `${plural(total, "case", "cases")} posted` : "No cases posted yet";
  for (const cat of Object.keys(AGENTS)) {
    const n = cases.filter((c) => c.agent === cat).length;
    const [one, many] = noun(cat);
    const label = state !== "ready" ? many : n ? plural(n, one, many) : `No ${many} yet`;
    for (const span of $$(`[data-count="${cat}"]`)) {
      span.textContent = label;
      span.classList.toggle("has", n > 0);
    }
    const name = AGENTS[cat].name;
    for (const b of $$(`.spot[data-cat="${cat}"], .roster-btn[data-cat="${cat}"]`)) {
      const beat = b.querySelector(".tag-beat, .r-no")?.textContent || "";
      b.setAttribute("aria-label", `${name}'s station. ${beat}. ${state === "ready" ? label : "Open it"}.`);
    }
  }
}

function renderFeed() {
  const list = $("#feed-list"), empty = $("#feed-empty"), fail = $("#feed-fail"), msg = $("#feed-state");
  if (!list) return;
  msg.hidden = true;
  fail.hidden = state !== "failed";
  empty.hidden = state !== "ready" || cases.length > 0;
  list.hidden = state !== "ready" || cases.length === 0;
  list.replaceChildren(...cases.map((c) => { const li = el("li"); li.append(caseCard(c, { heading: "h3", withAgent: true })); return li; }));
}

/* ── a station ─────────────────────────────────────────────────────────── */
const dialog = $("#station");
const slot = dialog.querySelector(".st-slot");
let opener = null;
let current = null;

function fillStation(cat) {
  const mine = cases.filter((c) => c.agent === cat);
  const list = slot.querySelector('[data-slot="cases"]');
  const none = slot.querySelector('[data-slot="none"]');
  const tpl = slot.querySelector('[data-slot="tpl"]');
  const count = slot.querySelector('[data-slot="count"]');
  list.replaceChildren(...mine.map((c) => caseCard(c)));
  count.textContent = state === "ready" && mine.length ? String(mine.length) : "";
  none.hidden = !(state === "ready" && mine.length === 0);
  if (state === "failed" && !slot.querySelector(".feed-fail")) {
    list.before(el("p", "feed-fail", "The case files could not be opened here just now. Every case is also posted on the agency's X account."));
  }
  // With nothing posted, the template shows how a case will read; once cases exist it folds away.
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

/* A link to a station (#crying-cat) or to a case (#CRY-001) opens it. */
function route() {
  let h = "";
  try { h = decodeURIComponent(location.hash.slice(1)); } catch { return false; }   // a malformed #%E0 is no station
  if (!h) return false;
  if (Object.prototype.hasOwnProperty.call(AGENTS, h)) { openStation(h); return true; }
  if (CASE_ID.test(h)) {
    const c = cases.find((x) => x.id === h);
    if (c) { openStation(c.agent, c.id); return true; }
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

/* ── load the case file ────────────────────────────────────────────────── */
renderCounts();
const deepLinked = route();
if (deepLinked) requestAnimationFrame(() => scrollTo(0, 0));
import("./cases-data.js")
  .then((mod) => {
    const { cases: ok, problems } = validateCases(mod.default);
    for (const p of problems) console.warn("cases.json:", p);
    cases = ok;
    state = "ready";
  })
  .catch((e) => {
    state = "failed";
    console.warn("cases.json could not be read:", e && e.message ? e.message : e);
  })
  .finally(() => {
    renderCounts();
    renderFeed();
    if (current) fillStation(current);
    else if (!deepLinked && route()) requestAnimationFrame(() => scrollTo(0, 0));
  });
