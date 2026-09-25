/* $CIA HOLDER PERKS: the /perks/ page, and the only file in site/ that talks to a wallet.
   It asks Phantom (window.phantom.solana, or window.solana when that is Phantom) for two things
   and nothing else:

     · connect: the wallet's public address, the permission connecting always asks for;
     · signMessage: one signature on one message, the challenge HQ wrote for this wallet,
       shown on the page before Phantom shows it again. A message signature costs nothing and
       moves nothing.

   It never asks Phantom to sign or send a transaction of any kind (test-site.mjs pins the
   calls this file makes), never stores anything, and sends HQ exactly
   the wallet, the message and the signature, through hq-client.js, the site's one way onto
   the network. HQ answers with the tier and the perks, checked against the contract. */
import { hqClient } from "./hq-client.js";
import { ADDRESS, fmtTokens, fmtUtc, base58 } from "./hq-format.js";
import { $, el, setState, walletLink, whyNot } from "./hq-ui.js";

const hq = hqClient();
const TIERS = { none: "Not a holder", holder: "Holder", agent: "Agent", director: "Director" };
const status = (text) => { $("#perk-status").textContent = text; };
let wallet = "", challenge = null, provider = null;

function phantom() {
  const p = window.phantom && window.phantom.solana;
  if (p && p.isPhantom) return p;
  const s = window.solana;
  return s && s.isPhantom ? s : null;
}
function reset(text = "") {
  wallet = ""; challenge = null;
  $("#wallet-line").replaceChildren();
  $("#tier-line").replaceChildren();
  $("#challenge").hidden = true;
  $("#sign").disabled = true;
  $("#result").hidden = true;
  $("#connect").textContent = "Connect Phantom";
  for (const id of ["step-connect", "step-sign", "step-tier"]) $("#" + id).dataset.on = "false";
  status(text);
}

async function connect() {
  provider = phantom();
  if (!provider) {
    status("Phantom was not found in this browser. Open this page in a browser with the Phantom extension, or in the browser inside the Phantom app on a phone.");
    return;
  }
  if (wallet) { try { await provider.disconnect(); } catch {} reset("Disconnected."); return; }
  status("Asking Phantom to connect…");
  let key = "";
  try { key = String((await provider.connect()).publicKey); } catch { status("Phantom did not connect. Nothing was shared."); return; }
  if (!ADDRESS.test(key)) { status("Phantom answered with something that is not a wallet address."); return; }
  wallet = key;
  $("#step-connect").dataset.on = "true";
  $("#connect").textContent = "Disconnect";
  $("#wallet-line").replaceChildren("Connected: ", walletLink(wallet));
  if (typeof provider.on === "function") provider.on("accountChanged", () => reset("The wallet changed in Phantom; connect again."));
  status("Asking HQ for a message to sign…");
  try {
    challenge = (await hq.challenge(wallet)).value;
  } catch (e) { status(`HQ could not give a message to sign: ${whyNot(e)}`); return; }
  const pre = $("#challenge");
  pre.textContent = challenge.message;
  pre.hidden = false;
  $("#sign").disabled = false;
  $("#step-sign").dataset.on = "true";
  status(`Read the message above: Phantom will show you the same words. It is good until ${fmtUtc(challenge.expiresAt)}.`);
}

async function sign() {
  if (!wallet || !challenge || !provider) return;
  if (Date.parse(challenge.expiresAt) <= Date.now()) { status("That message has expired. Connect again for a new one."); return; }
  $("#sign").disabled = true;
  status("Waiting for your signature in Phantom…");
  let signature = "";
  try {
    const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), "utf8");
    const bytes = signed && signed.signature;
    if (!(bytes instanceof Uint8Array) || bytes.length !== 64) throw new Error("not a signature");
    signature = base58(bytes);
  } catch {
    $("#sign").disabled = false;
    status("No signature was made. Nothing was sent.");
    return;
  }
  status("Checking with HQ…");
  let perks;
  try {
    perks = (await hq.verify({ wallet, message: challenge.message, signature })).value;
  } catch (e) {
    status(`HQ could not check the signature: ${whyNot(e)} Each message is single use; connect again for a new one.`);
    return;
  }
  challenge = null;
  $("#step-tier").dataset.on = "true";
  $("#tier-line").replaceChildren(el("b", "", TIERS[perks.tier]), ` · ${fmtTokens(perks.balance)} $CIA`);
  $("#tier-name").textContent = TIERS[perks.tier];
  $("#tier-balance").replaceChildren(`${fmtTokens(perks.balance)} $CIA in `, walletLink(wallet), `, read on chain by HQ.`);
  $("#result-note").textContent = `Good until ${fmtUtc(perks.expiresAt)}; after that, sign again.`;
  $("#perk-list").replaceChildren(...(perks.perks.length ? perks.perks.map((p) => el("li", "", p)) : [el("li", "", perks.holder ? "HQ lists no perks for this tier yet." : "No perks: this wallet holds no $CIA, or less than the holder tier needs.")]));
  $("#result").hidden = false;
  status("Checked. Nothing was sent from your wallet, and nothing is stored on this page.");
}

$("#connect").addEventListener("click", connect);
$("#sign").addEventListener("click", sign);
if (hq.online) {
  setState("online");
  $("#connect").disabled = false;
  status(phantom() ? "" : "Phantom is not in this browser. Open this page in a browser with the Phantom extension, or in the browser inside the Phantom app on a phone.");
} else {
  setState("offline");
}
