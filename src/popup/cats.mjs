/**
 * THE POPUP'S THREE NEW TABS: POPCAT, CASHCAT AND CRYING CAT.
 *
 * Every word a stranger wrote — a coin's name, its ticker, what a check read — is put on the page
 * with textContent, never as HTML: this file builds its elements with createElement and never
 * assigns innerHTML. No coin's picture is ever shown. The only links are the ones the worker
 * built from an address its validator accepted — pump.fun's coin page and Solscan — and each is
 * checked again here against those two sites before it is drawn. The one picture this file shows
 * is the logo CashCat drew in this browser for the user's own draft.
 *
 * The page builds no transaction and holds no key: every button is one message to the worker
 * (POPCAT, CRYING, CASHCAT in protocol.mjs), which answers the extension's own pages only. It
 * stores nothing and logs nothing.
 */
import { POPCAT, CRYING, CASHCAT } from "../lib/protocol.mjs";
import { KITTENS, BACKGROUNDS } from "../../bots/cashcat/logo-layout.mjs";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") e.textContent = String(v ?? "");
    else if (k === "cls") e.className = v;
    else if (k === "title") e.title = String(v);
    else e.setAttribute(k, String(v));
  }
  for (const c of children) if (c) e.append(c);
  return e;
};
const clear = (node) => { while (node.firstChild) node.firstChild.remove(); };
const empty = (node, text) => { clear(node); node.append(el("div", { cls: "empty", text })); };
const clock = (ms) => (Number.isFinite(ms) ? new Date(ms).toTimeString().slice(0, 5) : "—");
const short = (a) => (typeof a === "string" && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : String(a ?? "—"));

/** The only pages a link may open: a coin on pump.fun, an account or transaction on Solscan. */
const SAFE_LINK = /^https:\/\/(pump\.fun\/coin|solscan\.io\/(account|tx))\/[1-9A-HJ-NP-Za-km-z]{32,90}$/;
function linkList(links) {
  const box = el("div", { cls: "links" });
  for (const l of links ?? []) {
    if (!l || typeof l.href !== "string" || !SAFE_LINK.test(l.href)) continue;
    box.append(el("a", { href: l.href, target: "_blank", rel: "noopener noreferrer", text: l.label }));
  }
  return box;
}
function checksTable(checks) {
  const t = el("table", { cls: "checks" });
  for (const c of checks ?? []) t.append(el("tr", {}, el("td", { text: c.label }), el("td", { cls: `res ${c.result}`, text: c.result }), el("td", { text: c.value })));
  return t;
}

export function createCatTabs({ send, toast, onChange = () => {} }) {
  let visible = null;
  let pop = null, cc = null, ccStatus = null;
  const timers = [];

  /* ── Popcat ─────────────────────────────────────────────────────────────────────────── */
  function renderPopcat() {
    if (!pop) return;
    $("popRpc").textContent = pop.rpc === "yours" ? "yours" : pop.rpc === "public" ? "the public endpoint (it refuses browser extensions: set yours in Options)" : "none";
    $("popLast").textContent = pop.lastStepAt ? clock(pop.lastStepAt) : "—";
    $("chkPopBackground").checked = pop.backgroundScan === true;
    $("popBgPill").textContent = pop.backgroundScan ? "on" : "off";
    $("popBgPill").className = `pill ${pop.backgroundScan ? "observe" : ""}`;
    const err = pop.resting ? `Resting until ${clock(pop.resting)}: ${pop.lastError ?? ""}` : pop.lastError;
    $("popError").textContent = err ?? "";
    $("popError").classList.toggle("hidden", !err);
    $("popLine").textContent = `While this tab is open, Popcat reads pump.fun's newest coins every half minute, keeps the cat ones, and checks at most ${pop.limits.checksPerStep} a scan once each is ${pop.limits.minAgeMin} minutes old (and under ${pop.limits.maxAgeHours} hours). It trades nothing and signs nothing.`;
    const list = $("popResults");
    if (!pop.results.length) empty(list, pop.rpc === "none" ? "nothing checked: set your RPC in Options to run the checks" : "nothing checked yet");
    else {
      clear(list);
      for (const r of pop.results) {
        const item = el("div", { cls: "item" });
        item.append(
          el("div", { cls: "t" }, document.createTextNode(`${r.name} ${r.ticker} `), el("span", { cls: `tag ${r.callout ? "clean" : "flagged"}`, text: r.verdict })),
          el("div", { cls: "r", text: r.time.slice(11, 16) }),
          el("div", { cls: "m", text: r.callout ? "No check found a red flag at that moment." : r.flags.map((f) => f.flag).join(" ") }),
          el("div", { cls: "m mono", text: `holders ${r.stats.holders} · top 10 ${r.stats.top10Pct}% · curve ${r.stats.curvePct}%` }),
        );
        const d = el("details", {}, el("summary", { text: "all twelve checks" }), checksTable(r.checks));
        item.append(d, linkList(r.links));
        list.append(item);
      }
    }
    const w = $("popWaiting");
    if (!pop.waiting.length) empty(w, "none");
    else { clear(w); for (const q of pop.waiting) w.append(el("div", { cls: "item" }, el("div", { cls: "t", text: `${q.name} ${q.ticker}` }), el("div", { cls: "r", text: `${q.ageMin} min old` }), el("div", { cls: "m", text: q.dueInMin ? `checked in about ${q.dueInMin} min` : "due at the next scan" }))); }
    $("popRules").textContent = `${pop.notAdvice} ${pop.cashcatRule}`;
    onChange();
  }
  let scanning = false;
  async function scanNow() {
    if (scanning) return;
    scanning = true;
    $("popLast").textContent = "scanning…";
    try { await refreshPopcat({ scan: true }); } finally { scanning = false; if (pop) $("popLast").textContent = pop.lastStepAt ? clock(pop.lastStepAt) : "—"; }
  }
  async function refreshPopcat({ scan = false, force = false } = {}) {
    const res = await send(scan ? POPCAT.SCAN : POPCAT.STATUS, scan ? { force } : {}).catch(() => null);
    if (res?.ok) { pop = res.popcat; renderPopcat(); }
    return res;
  }
  $("btnPopScan").addEventListener("click", async () => {
    $("btnPopScan").disabled = true;
    try { const r = await refreshPopcat({ scan: true, force: true }); if (r?.step && !r.step.ran) toast(`Not scanned: ${r.step.why}`); }
    finally { $("btnPopScan").disabled = false; }
  });
  $("chkPopBackground").addEventListener("change", async (e) => {
    const on = e.target.checked;
    if (on && !confirm("Keep Popcat scanning on the half-minute alarm while Chrome is open, even with the popup closed? Each scan reads pump.fun and your RPC.")) { e.target.checked = false; return; }
    await send(POPCAT.SET_BACKGROUND, { on });
    refreshPopcat();
  });

  /* ── Crying Cat ─────────────────────────────────────────────────────────────────────── */
  function renderReport(r) {
    const box = $("cryReport");
    clear(box);
    box.classList.remove("hidden");
    box.append(
      el("div", { cls: `verdict ${r.flags.length ? "flagged" : "clean"}`, text: r.verdict }),
      el("div", { cls: "v", text: `${r.name ?? "no name on chain"}${r.symbol ? ` ($${r.symbol.replace(/^\$+/, "")})` : ""} · ${r.program} · ${r.decimals} decimals` }),
      el("div", { cls: "mintline", text: r.mint }),
      checksTable(r.checks),
      el("ul", { cls: "notes" }, ...r.notes.map((n) => el("li", { text: n }))),
      el("div", { cls: "hint", text: `Read ${r.readAt.slice(0, 16).replace("T", " ")} UTC${r.holders ? ` · holders from ${r.holders.source}` : ""}.` }),
      linkList(r.links),
    );
  }
  async function cry() {
    if ($("btnCry").disabled) return;              // one check at a time: Enter held down asks once
    const input = $("cryInput").value;
    $("cryError").classList.add("hidden");
    $("btnCry").disabled = true;
    try {
      const res = await send(CRYING.CHECK, { input }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
      if (!res?.ok) { $("cryError").textContent = res?.error ?? "the check failed"; $("cryError").classList.remove("hidden"); $("cryReport").classList.add("hidden"); return; }
      renderReport(res.report);
    } finally { $("btnCry").disabled = false; onChange(); }
  }
  $("btnCry").addEventListener("click", cry);
  $("cryInput").addEventListener("keydown", (e) => { if (e.key === "Enter") cry(); });

  /* ── CashCat ────────────────────────────────────────────────────────────────────────── */
  for (const k of KITTENS) $("ccKitten").append(el("option", { value: k, text: k }));
  for (const b of Object.keys(BACKGROUNDS)) $("ccBackground").append(el("option", { value: b, text: b }));
  const idea = () => ({ name: $("ccName").value, symbol: $("ccSymbol").value, tagline: $("ccTagline").value, topic: $("ccTopic").value, kitten: $("ccKitten").value, background: $("ccBackground").value });
  function fillForm(d) {
    if (!d) return;
    $("ccName").value = d.name ?? ""; $("ccSymbol").value = d.symbol ?? ""; $("ccTagline").value = d.tagline ?? ""; $("ccTopic").value = d.topic ?? "";
    if (d.kitten) $("ccKitten").value = d.kitten; if (d.background) $("ccBackground").value = d.background;
  }
  function showRefusals(list, okText) {
    const ul = $("ccRefusals");
    clear(ul);
    for (const r of list ?? []) ul.append(el("li", { text: r }));
    $("ccReviewLine").textContent = okText ?? "";
  }
  function renderCashcat() {
    if (!cc) return;
    const c = cc.cashcat;
    $("ccSignerNote").textContent = `${c.notes.signer} ${c.notes.venue}`;
    const d = c.draft;
    $("ccCoinLine").textContent = d ? `${d.name} ($${d.symbol}) — a ${d.kitten} kitten on ${d.background}` : "no draft yet: type one above, or draft one from a trend";
    $("ccTaglineLine").textContent = d ? `“${d.tagline}” — on ${d.topic}${d.source && d.source !== "typed" ? ` (trending on ${d.source === "coingecko" ? "CoinGecko" : "Google Trends"})` : ""}` : "";
    $("ccDisclosure").textContent = c.disclosure ? `Its description ends: ${c.disclosure}` : "";
    const ok = c.review?.ok === true;
    $("btnCcPreview").disabled = !d;
    $("btnCcPrepare").disabled = !ok;
    if (c.review) showRefusals(c.review.ok ? [] : c.review.refusals, c.review.ok ? `It passes ${c.review.reviewedBy}.` : "Refused, for the reasons above.");
    const a = c.settings.auto;
    $("ccAutoPill").textContent = a.on ? `auto on · next ${clock(a.nextAt)}` : "auto off";
    $("ccAutoPill").className = `pill ${a.on ? "execute" : ""}`;
    const cl = $("ccChecklist");
    clear(cl);
    for (const i of c.auto.checklist) { const li = el("li", { cls: i.ok ? "ok" : "" }); li.append(el("b", { text: i.name.replace(/_/g, " ") }), document.createTextNode(` — ${i.detail}`)); cl.append(li); }
    $("ccExpected").textContent = c.auto.expected ?? "create the autopilot wallet to see the sentence";
    $("btnCcArm").disabled = a.on || !c.auto.expected;
    $("btnCcDisarm").disabled = !a.on;
    $("ccAutoLine").textContent = a.on
      ? `Armed: at most ${a.maxPerDay} a day, one every ${a.everyHours} hours at most, never below ${a.minBalanceSol} SOL, no dev buy. Next run at ${clock(a.nextAt)}; it runs only while Chrome is open and the autopilot wallet is unlocked.`
      : `Off. Armed, it drafts a coin from a trend, has the model review it, and launches it from the autopilot wallet: at most ${a.maxPerDay} a day, one every ${a.everyHours} hours at most, never below ${a.minBalanceSol} SOL, no dev buy, and it never buys or sells the coins it launched. Change the caps in Options → CashCat.`;
    $("ccToday").textContent = `${c.launchesToday} launched today (UTC)`;
    const j = $("ccJournal");
    if (!c.journal.length) empty(j, "no launch yet");
    else {
      clear(j);
      for (const e of c.journal.slice(0, 20)) {
        const item = el("div", { cls: "item" });
        const what = e.kind === "launched" ? `LAUNCHED ${e.name ?? ""} ($${e.symbol ?? ""})` : e.kind === "sending" ? `SENDING ${e.name ?? ""} ($${e.symbol ?? ""}) — outcome not known yet`
          : e.kind === "unknown" ? `OUTCOME UNKNOWN: ${e.name ?? ""} ($${e.symbol ?? ""})` : e.kind === "failed" ? `FAILED ${e.name ?? ""} ($${e.symbol ?? ""})`
            : e.kind === "refused" ? `REFUSED (${e.clause})` : e.kind.toUpperCase();
        item.append(el("div", { cls: "t", text: what }), el("div", { cls: "r", text: `${e.mode ?? ""} · ${new Date(e.at).toISOString().slice(5, 16).replace("T", " ")}` }));
        const bits = [e.topic ? `on ${e.topic}` : "", e.mint ? `mint ${e.mint}` : "", e.signature ? `tx ${short(e.signature)}` : "", Number.isFinite(e.costSol) ? `cost ${e.costSol} SOL` : "",
          e.devBuy?.signature ? `dev buy ${e.devBuy.sol} SOL` : e.devBuy?.error ? `dev buy not made: ${e.devBuy.error}` : "", e.message ?? "", e.error ?? ""].filter(Boolean);
        if (bits.length) item.append(el("div", { cls: "m", text: bits.join(" · ") }));
        if (e.kind === "launched" && e.mint && e.signature) item.append(linkList([{ label: "On pump.fun", href: `https://pump.fun/coin/${e.mint}` }, { label: "The launch on Solscan", href: `https://solscan.io/tx/${e.signature}` }]));
        if ((e.kind === "sending" || e.kind === "unknown") && e.mint) {
          item.append(linkList([{ label: "Check the mint on Solscan", href: `https://solscan.io/account/${e.mint}` }]));
          const landed = el("button", { cls: "forget", text: "it landed" }), notLanded = el("button", { cls: "forget", text: "it did not land" });
          landed.addEventListener("click", () => markChecked(e.mint, true));
          notLanded.addEventListener("click", () => markChecked(e.mint, false));
          item.append(landed, notLanded);
        }
        j.append(item);
      }
    }
    $("ccNotes").textContent = c.notes.notAdvice;
    onChange();
  }
  async function refreshCashcat() {
    const res = await send(CASHCAT.STATUS).catch(() => null);
    if (res?.ok) { cc = res; ccStatus = res; if (!document.activeElement?.closest?.("#cashcatDraftCard")) fillForm(res.cashcat.draft); renderCashcat(); }
    return res;
  }
  async function markChecked(mint, landed) {
    if (!confirm(landed ? "Mark this launch as landed? Do this after you saw it on Solscan." : "Mark this launch as not landed? Do this after you checked Solscan and the mint does not exist.")) return;
    const res = await send(CASHCAT.MARK_CHECKED, { mint, landed });
    if (!res?.ok) toast(res?.error ?? "not marked");
    refreshCashcat();
  }
  async function busy(button, fn) {
    button.disabled = true;
    try { return await fn(); } finally { button.disabled = false; }
  }
  $("btnCcCheck").addEventListener("click", () => busy($("btnCcCheck"), async () => {
    showRefusals([], "Checking against the rules (and the model, when your key is saved)…");
    const res = await send(CASHCAT.DRAFT, { idea: idea() }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!res?.ok) { showRefusals([res?.error ?? "the check failed"]); return; }
    showRefusals(res.refusals, res.passes ? `It passes ${res.reviewedBy}.` : "Refused, for the reasons above.");
    $("ccLogo").classList.add("hidden"); $("ccPlan").classList.add("hidden"); $("ccLaunchBox").classList.add("hidden");
    await refreshCashcat();
    fillForm(res.draft);
  }));
  $("btnCcTrend").addEventListener("click", () => busy($("btnCcTrend"), async () => {
    if (!confirm("Draft a coin from what is trending? CashCat reads Google Trends and CoinGecko, and asks the model (billed to your API key) to propose a coin and then to review it.")) return;
    showRefusals([], "Reading the trends and asking the model…");
    const res = await send(CASHCAT.DRAFT_FROM_TREND).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!res?.ok) { showRefusals([res?.error ?? "no draft"]); return; }
    if (!res.draft) { showRefusals(res.refusals, "No coin this time."); return; }
    showRefusals(res.refusals, res.passes ? "Drafted from a trend; it passes the rules and the model." : "Refused, for the reasons above.");
    fillForm(res.draft);
    $("ccLogo").classList.add("hidden"); $("ccPlan").classList.add("hidden"); $("ccLaunchBox").classList.add("hidden");
    await refreshCashcat();
  }));
  $("btnCcPreview").addEventListener("click", () => busy($("btnCcPreview"), async () => {
    const res = await send(CASHCAT.PREVIEW).catch(() => null);
    if (!res?.ok || typeof res.dataUrl !== "string" || !res.dataUrl.startsWith("data:image/png;base64,")) { toast(res?.error ?? "the logo could not be drawn"); return; }
    $("ccLogo").src = res.dataUrl;
    $("ccLogo").classList.remove("hidden");
  }));
  $("btnCcPrepare").addEventListener("click", () => busy($("btnCcPrepare"), async () => {
    const plan = $("ccPlan");
    plan.classList.remove("hidden");
    plan.textContent = "Building the launch, checking it and simulating it on your RPC…";
    const res = await send(CASHCAT.PREPARE).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!res?.ok) { plan.textContent = `Not ready: ${res?.error ?? "the check failed"}`; $("ccLaunchBox").classList.add("hidden"); return; }
    const p = res.plan;
    clear(plan);
    plan.append(
      el("div", { text: `The check before signing passed, and the simulation succeeded: the launch would cost the autopilot wallet ${p.simulatedSpendSol} SOL in rent and fees (${p.units ?? "?"} compute units), inside the ${p.budgetSol} SOL budget.` }),
      el("div", { text: `Dev buy: ${p.devBuySol ? `${p.devBuySol} SOL, a separate transaction after the launch lands` : "none (0, the default)"}. The autopilot wallet holds ${p.balanceSol.toFixed(6)} SOL.` }),
      el("div", { text: `Its description will end: ${p.disclosure}` }),
      el("div", { text: `Judged by ${p.reviewedBy}. Nothing was pinned, signed or sent.` }),
    );
    $("ccLaunchHint").textContent = `Launching pins the logo and metadata on IPFS with your Pinata key, builds, checks and simulates again, then the new mint's key and the autopilot wallet sign and it is sent. It cannot be undone. Type ${p.draft.symbol} to confirm.`;
    $("ccLaunchBox").classList.remove("hidden");
  }));
  $("btnCcLaunch").addEventListener("click", () => busy($("btnCcLaunch"), async () => {
    const confirmTicker = $("ccConfirm").value;
    if (!confirm(`Launch this coin on pump.fun now, from the autopilot wallet? It cannot be undone, and it costs SOL whether or not anyone buys.`)) return;
    toast("Launching: pinning, checking, simulating, signing…");
    const res = await send(CASHCAT.LAUNCH, { confirmTicker }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    $("ccConfirm").value = "";
    if (!res?.ok) { toast(`Not launched: ${res?.error ?? "the launch failed"}`); await refreshCashcat(); return; }
    toast(`Launched: mint ${res.launch.mint}.`);
    $("ccLaunchBox").classList.add("hidden");
    await refreshCashcat();
  }));
  $("btnCcCopyAck").addEventListener("click", () => { $("ccAckInput").value = ccStatus?.cashcat?.auto?.expected ?? ""; });
  $("btnCcArm").addEventListener("click", () => busy($("btnCcArm"), async () => {
    if (!confirm("Arm CashCat's auto mode? From the first run (in ten minutes) it launches coins from the autopilot wallet on its schedule WITHOUT asking you, inside the caps the sentence names.")) return;
    const res = await send(CASHCAT.ARM_AUTO, { sentence: $("ccAckInput").value.trim() }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!res?.ok) { toast(res?.error ?? "not armed"); return; }
    $("ccAckInput").value = "";
    toast(`Armed. The first run is at ${clock(res.nextAt)}.`);
    refreshCashcat();
  }));
  $("btnCcDisarm").addEventListener("click", async () => { await send(CASHCAT.DISARM_AUTO); toast("Auto mode is off."); refreshCashcat(); });

  /* ── the tab switch ─────────────────────────────────────────────────────────────────── */
  function show(tab) {
    visible = tab;
    while (timers.length) clearInterval(timers.pop());
    if (tab === "popcat") {
      /* What is known now first; then one scan step, which may take a while when a host is slow. */
      refreshPopcat().then(() => scanNow());
      timers.push(setInterval(scanNow, 30_000));
    }
    if (tab === "cashcat") { refreshCashcat(); timers.push(setInterval(refreshCashcat, 15_000)); }
  }
  const owns = (tab) => tab === "popcat" || tab === "cashcat" || tab === "crying";
  function pill(tab) {
    if (tab === "popcat") return pop ? (pop.resting ? { text: "resting", cls: "armq" } : pop.rpc === "none" ? { text: "no RPC", cls: "armq" } : { text: `${pop.results.length} checked`, cls: "observe" }) : { text: "popcat", cls: "" };
    if (tab === "cashcat") return cc?.cashcat?.settings?.auto?.on ? { text: "auto armed", cls: "execute" } : { text: "manual", cls: "observe" };
    return { text: "rug check", cls: "" };
  }
  return Object.freeze({ show, owns, pill, visible: () => visible });
}
