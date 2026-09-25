/**
 * OPTIONS FOR THE AGENCY'S OTHER CATS: CashCat's Pinata key and its settings, and Popcat's
 * background scan.
 *
 * THE PINATA JWT is typed into a password field, sent once with CASHCAT.SET_PINATA_JWT and cleared
 * from the field at once; the page never gets it back — only whether one is saved. The worker
 * keeps it in chrome.storage.local, reads it there alone, and sends it only to Pinata's upload
 * API. The settings go to the worker as CASHCAT.SAVE_SETTINGS, where the same fences the tab
 * reads (normalizeCashcatSettings) refuse anything outside them by name. Nothing here stores or
 * logs anything, and a coin's words never reach this page.
 */
import { CASHCAT, POPCAT, AGENT } from "../lib/protocol.mjs";

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload });

let models = [];
function modelOptions(chosen) {
  const list = [...models];
  if (chosen && !list.some((m) => m.id === chosen)) list.push({ id: chosen, displayName: `${chosen} (saved)` });
  return `<option value="">The first your key lists (default)</option>` + list.map((m) => `<option value="${esc(m.id)}" ${m.id === chosen ? "selected" : ""}>${esc(m.displayName === m.id ? m.id : `${m.displayName} — ${m.id}`)}</option>`).join("");
}

function build(res, popcat) {
  const c = res.cashcat, s = c.settings;
  const field = (label, sub, input, help) => `<div class="field"><label>${label}<small>${sub}</small></label><div>${input}</div><div class="help">${help}</div></div>`;
  $("catsForm").innerHTML = `<fieldset class="cashcat"><legend>CashCat — launch a cat coin of your own</legend>
    <p class="help">CashCat drafts or checks a cat coin, draws its logo, pins its logo and metadata on IPFS through <b>your own Pinata account</b>, and launches it on pump.fun from the autopilot wallet (the popup's CashCat tab). ${esc(c.notes.venue)} ${esc(c.notes.signer)}</p>
    ${field("Pinata JWT", "stored in this browser", `<div class="keyrow"><input type="password" id="ccPinataJwt" autocomplete="off" spellcheck="false" placeholder="${res.pinataSaved ? "saved — paste a new one to replace it" : "paste your Pinata API JWT"}"><button type="button" class="btn" id="btnCcJwtSave">Save key</button><button type="button" class="btn ghost" id="btnCcJwtClear">Clear</button><span class="saved ${res.pinataSaved ? "yes" : ""}" id="ccJwtState">${res.pinataSaved ? "saved" : "not saved"}</span></div>`,
      "Make an API key in your Pinata account with permission to upload files, and paste its JWT. It is kept in this browser's extension storage, read only by the extension's service worker, and sent only to Pinata's upload API (https://uploads.pinata.cloud). It is never shown again, not even here. Each launch pins two files: the logo (a PNG of about 400 to 900 KB) and a small JSON document.")}
    ${field("Dev buy (SOL)", "devBuySol", `<input type="number" id="ccDevBuy" step="any" min="0" max="${c.devBuyFence[1]}" value="${esc(String(s.devBuySol))}">`,
      `0 by default, at most ${c.devBuyFence[1]} SOL. A buy of your own coin from the autopilot wallet, in a separate transaction after the launch lands, shown in the journal. Manual launches only: auto mode never buys.`)}
    ${field("Made with CashCat", "madeWithCashCat", `<label><input type="checkbox" id="ccMadeWith" ${s.madeWithCashCat ? "checked" : ""}> add "Made with CashCat." to the coin's description</label>`,
      "Off by default. Every coin's description ends \"Not financial advice. Not affiliated with [the topic].\" It never says the coin is from the Cat Intelligence Agency: your coin is yours.")}
    ${field("Model", "model", `<div class="keyrow"><select id="ccModel">${modelOptions(s.model)}</select><button type="button" class="btn ghost" id="btnCcModels">Load the list</button></div>`,
      "For drafting from a trend and for the review of every draft, with your Anthropic key (Options → Agent). The list is what your key may use; with none picked, the first one listed.")}
    <p class="help"><b>Auto mode</b> (off until you arm it in the popup with the sentence it prints): drafts from a trend, has the model review the draft, and launches from the autopilot wallet while Chrome is open. Changing any of these three disarms it.</p>
    ${field("Launches a day, at most", "auto.maxPerDay", `<select id="ccMaxPerDay">${[1, c.maxPerDay].filter((v, i, a) => a.indexOf(v) === i).map((n) => `<option value="${n}" ${n === s.auto.maxPerDay ? "selected" : ""}>${n}</option>`).join("")}</select>`,
      `At most ${c.maxPerDay} a UTC day, counting every launch from this extension, manual or automatic.`)}
    ${field("Minimum balance (SOL)", "auto.minBalanceSol", `<input type="number" id="ccMinBalance" step="any" min="0.02" value="${esc(String(s.auto.minBalanceSol))}">`,
      `Auto mode never launches when the autopilot wallet would hold less than this plus one launch's budget (${c.budgetSol} SOL) and the rent floor. At least 0.02.`)}
    ${field("At most one launch every", "auto.everyHours", `<select id="ccEvery">${c.everyHoursChoices.map((h) => `<option value="${h}" ${h === s.auto.everyHours ? "selected" : ""}>${h} hours</option>`).join("")}</select>`,
      "The first run comes ten minutes after you arm it; each run schedules the next before it starts, so a refusal never retries every half minute.")}
    <div class="agentbar"><button type="button" id="btnCcSave" class="btn">Save CashCat's settings</button><span id="ccMsg" class="msg"></span></div>
  </fieldset>
  <fieldset class="popcat"><legend>Popcat — the cat-coin scanner</legend>
    <p class="help">Popcat scans while the popup shows its tab. With this on, it also scans on the half-minute alarm while Chrome is open: each scan reads pump.fun's newest coins and, for the cat coins old enough, your RPC (about a dozen reads a coin, at most two coins a scan).</p>
    ${field("Scan in the background", "popcat.backgroundScan", `<label><input type="checkbox" id="popBackground" ${popcat?.backgroundScan ? "checked" : ""}> on the half-minute alarm</label>`, "Off by default.")}
  </fieldset>`;
  $("btnCcJwtSave").addEventListener("click", saveJwt);
  $("btnCcJwtClear").addEventListener("click", clearJwt);
  $("btnCcModels").addEventListener("click", loadModels);
  $("btnCcSave").addEventListener("click", saveSettings);
  $("popBackground").addEventListener("change", async (e) => { await send(POPCAT.SET_BACKGROUND, { on: e.target.checked }); });
}
const note = (text, cls = "") => { const m = $("ccMsg"); m.className = `msg ${cls}`; m.textContent = text; };
async function saveJwt() {
  const jwt = $("ccPinataJwt").value.trim();
  $("ccPinataJwt").value = "";
  if (!jwt) { note("paste a JWT first", "bad"); return; }
  const res = await send(CASHCAT.SET_PINATA_JWT, { jwt });
  if (!res?.ok) { note(res?.error ?? "the key was not saved", "bad"); return; }
  note("the Pinata key is saved in this browser", "good");
  $("ccJwtState").textContent = "saved"; $("ccJwtState").className = "saved yes";
}
async function clearJwt() {
  if (!confirm("Remove the Pinata key from this browser? CashCat cannot launch without it.")) return;
  const res = await send(CASHCAT.CLEAR_PINATA_JWT);
  if (res?.ok) { $("ccJwtState").textContent = "not saved"; $("ccJwtState").className = "saved"; note("the Pinata key was removed", "good"); }
}
async function loadModels() {
  note("asking the API which models your key may use…");
  const res = await send(AGENT.LIST_MODELS);
  if (!res?.ok) { note(res?.error ?? "the list could not be read", "bad"); return; }
  models = res.models;
  const chosen = $("ccModel").value;
  $("ccModel").innerHTML = modelOptions(chosen);
  note(`${res.models.length} models listed`, "good");
}
async function saveSettings() {
  const settings = {
    devBuySol: $("ccDevBuy").value.trim() || "0", madeWithCashCat: $("ccMadeWith").checked, model: $("ccModel").value,
    auto: { maxPerDay: Number($("ccMaxPerDay").value), minBalanceSol: $("ccMinBalance").value.trim(), everyHours: Number($("ccEvery").value) },
  };
  const res = await send(CASHCAT.SAVE_SETTINGS, { settings });
  if (!res?.ok) { note(res?.error ?? "not saved", "bad"); return; }
  note(res.settings.auto.on ? "saved" : "saved — auto mode is off until you arm it in the popup", "good");
}

export async function loadCatsOptions() {
  const [res, pop] = await Promise.all([send(CASHCAT.STATUS).catch(() => null), send(POPCAT.STATUS).catch(() => null)]);
  if (res?.ok) build(res, pop?.popcat);
  else $("catsForm").innerHTML = `<fieldset><legend>CashCat and Popcat</legend><p class="help">Their settings could not be read: ${esc(res?.error ?? "the worker did not answer")}</p></fieldset>`;
}
