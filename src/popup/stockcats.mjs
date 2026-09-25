/**
 * STOCK CATS, IN COINMARKETCAT'S TAB: ONE CAT COIN OF YOUR OWN FOR EACH xSTOCK STONKFUN LISTS.
 *
 * The card lists the 24 xStocks a stock cat may be paired with, says which have their research
 * row (src/lib/stock-cat-notes.mjs) and which already have their cat, and shows the other quotes
 * StonkFun lists as counts with the reason each is not offered. For one pair it suggests names
 * (no model), checks a name typed or picked, runs "Check the launch" and, within ten minutes of
 * that check, launches it with the ticker typed. Every word is put on the page with textContent;
 * the page builds no transaction, holds no key, stores nothing and logs nothing: every button is
 * one STOCKCATS message to the worker, which answers the extension's own pages only.
 *
 * A pair's cat facts are the owner's to read, labelled "Sourced fact, not an endorsement", with
 * where and when each was read. They are never written into a coin, and this page never sends
 * one back to the worker.
 */
import { STOCKCATS, CASHCAT } from "../lib/protocol.mjs";
import { KITTENS, BACKGROUNDS } from "../../bots/cashcat/logo-layout.mjs";
import { linkList } from "./cats.mjs";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") e.textContent = String(v ?? "");
    else if (k === "cls") e.className = v;
    else e.setAttribute(k, String(v));
  }
  for (const c of children) if (c) e.append(c);
  return e;
};
const clear = (node) => { while (node.firstChild) node.firstChild.remove(); };
const short = (a) => (typeof a === "string" && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : String(a ?? "—"));
const usd = (n) => (Number.isFinite(n) ? `$${Math.round(n).toLocaleString("en-US")}` : "not given");

export function createStockCatsCard({ send, toast }) {
  let st = null;               // the worker's STOCKCATS.LIST answer
  let pairMint = null;         // the pair the form is for
  let prepared = null;         // the last "Check the launch" answer, for this pair
  let timer = null;

  for (const k of KITTENS) $("scKitten").append(el("option", { value: k, text: k }));
  for (const b of Object.keys(BACKGROUNDS)) $("scBackground").append(el("option", { value: b, text: b }));
  const idea = () => ({ name: $("scName").value, symbol: $("scSymbol").value, tagline: $("scTagline").value, kitten: $("scKitten").value, background: $("scBackground").value });
  function fill(d) {
    if (!d) return;
    $("scName").value = d.name ?? ""; $("scSymbol").value = d.symbol ?? ""; $("scTagline").value = d.tagline ?? "";
    if (d.kitten) $("scKitten").value = d.kitten; if (d.background) $("scBackground").value = d.background;
  }
  function refusals(list, line) {
    const ul = $("scRefusals");
    clear(ul);
    for (const r of list ?? []) ul.append(el("li", { text: r }));
    $("scReviewLine").textContent = line ?? "";
  }
  const hidePlan = () => { prepared = null; $("scPlan").classList.add("hidden"); $("scLaunchBox").classList.add("hidden"); };

  function render() {
    if (!st) return;
    const s = st.stockcats;
    $("scWhat").textContent = s.text.whatItIs;
    $("scToday").textContent = `${s.launchesToday} of ${s.settings.maxPerDay} launches today (UTC), every launch from this extension counted`;
    const cap = $("scMaxPerDay");
    if (!cap.options.length) for (let n = s.fence[0]; n <= s.fence[1]; n++) cap.append(el("option", { value: n, text: `${n} a day` }));
    cap.value = String(s.settings.maxPerDay);
    const list = $("scPairs");
    clear(list);
    for (const p of s.pairs) {
      const state = p.cat ? `has its cat: ${p.cat.name} ($${p.cat.symbol})${p.cat.adopted === true ? ", adopted" : ""}` : !p.researched ? "no research row yet: refused (pair_terms_missing)"
        : p.ready === false ? "not listed as ready by StonkFun at the last read" : "can have its cat";
      const item = el("div", { cls: `item${p.mint === pairMint ? " on" : ""}` });
      const pick = el("button", { cls: "forget", text: p.mint === pairMint ? "chosen" : "choose" });
      pick.disabled = p.mint === pairMint;
      pick.addEventListener("click", () => choose(p.mint));
      item.append(el("div", { cls: "t", text: `${p.symbol} · ${p.name}` }), el("div", { cls: "r", text: `StonkFun: ${p.stonkfun}` }), el("div", { cls: "m", text: state }), pick);
      list.append(item);
    }
    $("scOthers").textContent = s.others
      ? `Not offered, as counts only (read ${new Date(s.readAt).toISOString().slice(11, 16)} UTC): ${s.others.map((o) => `${o.count} ${o.category} (${o.reason})`).join("; ")}.`
      : "Read StonkFun to see which of these it lists as ready now, and what else it lists (as counts: none of the others is offered).";
    const pair = s.pairs.find((p) => p.mint === pairMint) ?? null;
    $("scPairBox").classList.toggle("hidden", !pair);
    if (pair) {
      $("scPairTitle").textContent = `A stock cat paired with ${pair.symbol} (${pair.mint})`;
      const facts = $("scFacts");
      clear(facts);
      for (const f of pair.catFacts) facts.append(el("li", { text: `${f.label}: ${f.text} — ${f.source}, read ${f.readAt}` }));
      if (!pair.catFacts.length) facts.append(el("li", { text: pair.researched ? `No cat fact was found (searched ${pair.searchedAt}).` : "No research row yet: nothing can be named or launched for this pair until one is added." }));
      $("scDisclosure").textContent = s.draft && s.draft.pairMint === pair.mint && s.disclosure ? `Its description will end: ${s.disclosure}` : "";
      $("btnScPrepare").disabled = !(s.review?.ok === true && s.draft?.pairMint === pair.mint);
    }
    const j = $("scJournal");
    clear(j);
    if (!s.journal.length) j.append(el("div", { cls: "empty", text: "no stock cat yet" }));
    for (const e of s.journal.slice(0, 12)) {
      const item = el("div", { cls: "item" });
      const what = e.kind === "refused" ? `REFUSED (${e.clause})` : `${e.kind.toUpperCase()} ${e.name ?? ""} ($${e.symbol ?? ""})`;
      item.append(el("div", { cls: "t", text: what }), el("div", { cls: "r", text: new Date(e.at).toISOString().slice(5, 16).replace("T", " ") }));
      const bits = [e.pair?.official ? `paired with ${e.pair.official}` : "", e.mint ? `mint ${e.mint}` : "", e.pool ? `pool ${short(e.pool)}` : "", Number.isFinite(e.costSol) ? `cost ${e.costSol} SOL` : "",
        e.mintClean === false ? `NOT CLEAN: a mint or freeze authority was still set${e.cleanCheckedByUser ? " (you checked it)" : ""}` : "",
        e.adoption ? (e.adoption.adopted ? "adopted by StonkFun" : e.adoption.why === "not_found" ? "not adopted yet" : `not adopted: ${(e.adoption.mismatches ?? []).map((m) => m.what).join(", ")}`) : "", e.message ?? "", e.error ?? ""].filter(Boolean);
      if (bits.length) item.append(el("div", { cls: "m", text: bits.join(" · ") }));
      if (e.kind === "launched" && e.mint && e.signature) {
        item.append(linkList([{ label: "On StonkFun", href: `https://www.stonkfun.xyz/token/${e.mint}` }, { label: "The launch on Solscan", href: `https://solscan.io/tx/${e.signature}` }]));
        const adopt = el("button", { cls: "forget", text: "has StonkFun adopted it?" });
        adopt.addEventListener("click", () => checkAdoption(e.mint));
        item.append(adopt);
        if (e.mintClean === false && !e.cleanCheckedByUser) {
          const mark = el("button", { cls: "forget", text: "I checked it on Solscan" });
          mark.addEventListener("click", () => markClean(e.mint));
          item.append(mark);
        }
      }
      j.append(item);
    }
    $("scNotes").textContent = `${s.text.creatorShare} ${s.text.noDevBuy}. Launched by hand, one at a time, from the autopilot wallet; never in auto mode. Not financial advice.`;
  }

  async function refresh({ read = false } = {}) {
    const res = await send(read ? STOCKCATS.REFRESH : STOCKCATS.LIST).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!res?.ok) { if (read) toast(res?.error ?? "StonkFun could not be read"); return res; }
    st = { ...(st ?? {}), ...res };
    if (!pairMint && st.stockcats.draft?.pairMint) { pairMint = st.stockcats.draft.pairMint; fill(st.stockcats.draft); }
    render();
    return res;
  }
  function choose(mint) {
    pairMint = mint;
    hidePlan();
    refusals([], "");
    clear($("scSuggestions"));
    if (st?.stockcats?.draft?.pairMint === mint) fill(st.stockcats.draft); else fill({ name: "", symbol: "", tagline: "" });
    render();
  }
  async function busy(button, fn) { button.disabled = true; try { return await fn(); } finally { button.disabled = false; } }

  $("btnScRefresh").addEventListener("click", () => busy($("btnScRefresh"), () => refresh({ read: true })));
  $("scMaxPerDay").addEventListener("change", async (e) => {
    const res = await send(STOCKCATS.SETTINGS, { maxPerDay: Number(e.target.value) }).catch(() => null);
    if (!res?.ok) toast(res?.error ?? "not saved");
    refresh();
  });
  $("btnScSuggest").addEventListener("click", () => busy($("btnScSuggest"), async () => {
    const res = await send(STOCKCATS.SUGGEST, { pairMint }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    const box = $("scSuggestions");
    clear(box);
    if (!res?.ok) { refusals([res?.error ?? "no suggestion"]); return; }
    if (!res.suggestions.length) { refusals(res.refusals, "No name to suggest."); return; }
    for (const sgt of res.suggestions) {
      const b = el("button", { cls: "forget", text: `${sgt.name} ($${sgt.symbol})` });
      b.addEventListener("click", () => { fill(sgt); hidePlan(); });
      box.append(b);
    }
    refusals([], "Pick one, or type your own, then check it.");
  }));
  $("btnScCheck").addEventListener("click", () => busy($("btnScCheck"), async () => {
    hidePlan();
    refusals([], "Checking against the rules (and the model, when your key is saved)…");
    const res = await send(STOCKCATS.DRAFT, { pairMint, idea: idea() }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!res?.ok) { refusals([res?.error ?? "the check failed"]); return; }
    refusals(res.refusals, res.passes ? `It passes ${res.reviewedBy}.` : "Refused, for the reasons above.");
    await refresh();
  }));
  $("btnScPrepare").addEventListener("click", () => busy($("btnScPrepare"), async () => {
    const plan = $("scPlan");
    plan.classList.remove("hidden");
    $("scLaunchBox").classList.add("hidden");
    plan.textContent = "Reading StonkFun's plan, proving it on your RPC, building the launch, checking it and simulating it…";
    const res = await send(STOCKCATS.PREPARE, { pairMint }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!res?.ok) { prepared = null; plan.textContent = `Not ready: ${res?.error ?? "the check failed"}`; return; }
    const p = res.plan;
    prepared = p;
    clear(plan);
    plan.append(
      el("div", { text: `${p.draft.name} ($${p.draft.symbol}), paired with ${p.pair.symbol} on StonkFun, from the autopilot wallet ${p.wallet}.` }),
      ...p.accounts.map((a) => el("div", { cls: "mono", text: `${a.label}${a.address ? `: ${a.address}` : ""}` })),
      el("div", { text: `A v${p.message.version} message with ${p.message.signers} signers (the autopilot wallet and the new mint). The check before signing passed, and the simulation succeeded: ${p.simulatedSpendSol} SOL of rent and fees (${p.units ?? "?"} compute units), inside the ${p.budgetSol} SOL budget.` }),
      el("div", { text: `The raise: ${p.raise.units ?? p.raise.raw} ${p.raise.symbol}${p.raise.units === null ? " (raw)" : ""}. Market cap at the start ${usd(p.marketCap.startUsd)}, at graduation ${usd(p.marketCap.graduationUsd)}: ${p.marketCap.label}.` }),
      el("div", { text: `${p.pair.symbol}'s scaled-UI multiplier: ${p.scaledUiMultiplier ?? "none"} (wallets show its amounts multiplied by it).` }),
      ...p.notes.map((n) => el("div", { text: n.endsWith(".") ? n : `${n}.` })),
      el("div", { text: `Its description will end: ${p.disclosure}` }),
      el("div", { text: `Judged by ${p.reviewedBy}. Nothing was pinned, signed or sent. This check is good for ten minutes, once.` }),
    );
    $("scLaunchHint").textContent = `Launching pins the logo and metadata with your Pinata key, reads StonkFun's plan and proves it again, builds, checks and simulates again, then the new mint's key and the autopilot wallet sign and it is sent. It cannot be undone. Type ${p.draft.symbol} to confirm.`;
    $("scLaunchBox").classList.remove("hidden");
  }));
  $("btnScLaunch").addEventListener("click", () => busy($("btnScLaunch"), async () => {
    if (!prepared) { toast("Check the launch first."); return; }
    const confirmTicker = $("scConfirm").value;
    if (!confirm(`Launch $${prepared.draft.symbol} (${prepared.draft.name}) on StonkFun, paired with ${prepared.pair.symbol}, from the autopilot wallet ${prepared.wallet}? It costs about ${prepared.simulatedSpendSol} SOL (at most ${prepared.budgetSol}) whether or not anyone buys, and it cannot be undone.`)) return;
    toast("Launching: pinning, proving, checking, simulating, signing…");
    const res = await send(STOCKCATS.LAUNCH, { pairMint, preparedId: prepared.preparedId, confirmTicker }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    $("scConfirm").value = "";
    hidePlan();
    if (!res?.ok) { toast(`Not launched: ${res?.error ?? "the launch failed"}`); await refresh(); return; }
    toast(`Launched: mint ${res.launch.mint}. Ask whether StonkFun adopted it in a minute or two.`);
    await refresh();
  }));
  async function checkAdoption(mint) {
    const res = await send(STOCKCATS.ADOPTION, { mint }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!res?.ok) toast(res?.error ?? "not read");
    else toast(res.adopted ? "StonkFun adopted it: its record matches the chain." : res.notFound ? "Not adopted yet: StonkFun does not list it." : `Not adopted: ${res.mismatches.map((m) => m.what).join(", ")} differ.`);
    refresh();
  }
  async function markClean(mint) {
    if (!confirm("Mark this stock cat as checked? Do this after you saw its mint on Solscan. Stock cats launch again after it.")) return;
    const res = await send(CASHCAT.MARK_CHECKED, { mint, landed: true });
    if (!res?.ok) toast(res?.error ?? "not marked");
    refresh();
  }

  /** Shown on CoinMarketCat's tab: read now, and every half minute while it is open. */
  function show(on) {
    if (timer) { clearInterval(timer); timer = null; }
    if (!on) return;
    refresh();
    timer = setInterval(() => refresh(), 30_000);
  }
  return Object.freeze({ show });
}
