/**
 * $CIA HOLDER PERKS: PROVE A WALLET, READ ITS $CIA ON CHAIN, NAME ITS TIER.
 *
 *   GET  /v1/perks                      the tiers and their perks, lowest first (HQ_PERK_TIERS)
 *   GET  /v1/perks/challenge?wallet=W   a message with a fresh nonce and an expiry (HQ_CHALLENGE_TTL_SECONDS)
 *   POST /v1/perks/verify               { wallet, message, signature (base58) }
 * The nonce is single use: the first verify that names it spends it, whatever the outcome, so a
 * signature can never be replayed. The signature must be the wallet's ed25519 signature over
 * exactly the message's UTF-8 bytes (what Phantom's signMessage produces). The balance is the
 * wallet's $CIA, summed over its token accounts of the $CIA mint, read from the chain at that
 * moment; the tier is the highest HQ_PERK_TIERS threshold it reaches.
 *
 * PERKS ARE COSMETIC OR A SAY, NEVER MONEY OR TIMING: skins for the agents' pages, votes on the
 * next agent's name and strategy. Never early access to a pick, a decision or a trade — that
 * would let holders trade ahead of the public. The API never publishes a trade before it is on
 * chain, for anyone.
 */
import crypto from "node:crypto";
import bs58 from "bs58";
import { CIA_MINT, CIA_FACTS } from "./config.mjs";
import { unitsString } from "./amounts.mjs";

export class PerksError extends Error {
  constructor(clause, message, status = 400) { super(message); this.name = "PerksError"; this.clause = clause; this.status = status; }
}

export const TIERS = Object.freeze(["none", "holder", "agent", "director"]);
export const PERKS = Object.freeze({
  none: Object.freeze([]),
  holder: Object.freeze(["skins:holder", "vote:next-agent-name"]),
  agent: Object.freeze(["skins:holder", "skins:agent", "vote:next-agent-name", "vote:next-agent-strategy"]),
  director: Object.freeze(["skins:holder", "skins:agent", "skins:director", "vote:next-agent-name", "vote:next-agent-strategy", "propose:next-agent-name"]),
});

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** An ed25519 signature check with a Solana address as the public key. Never throws. */
export function verifyEd25519({ address, message, signature }) {
  try {
    const pub = Buffer.from(bs58.decode(String(address)));
    const sig = Buffer.from(bs58.decode(String(signature)));
    if (pub.length !== 32 || sig.length !== 64) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, pub]), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.isBuffer(message) ? message : Buffer.from(String(message), "utf8"), key, sig);
  } catch { return false; }
}
export const isAddress = (a) => { try { return typeof a === "string" && BASE58.test(a) && bs58.decode(a).length === 32; } catch { return false; } };

/** The plain text a holder signs (docs/hq/API.md): the site, the wallet, the nonce, the expiry,
 *  and that signing moves nothing. */
export function challengeMessage({ wallet, nonce, issuedAt, expiresAt }) {
  return [
    "catintelligenceagency.com asks you to prove you hold this wallet, to show your $CIA holder perks.",
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
    `Expires: ${expiresAt}`,
    "Signing this message moves nothing: no SOL, no tokens, no approval, and it costs nothing.",
  ].join("\n");
}

/** GET /v1/perks: the tiers the owner set (HQ_PERK_TIERS), lowest first, with their perks. The
 *  verify below uses the same thresholds. */
export function perksTiers(config) {
  return { tiers: ["holder", "agent", "director"].filter((id) => config.perkTiers[id] !== undefined)
    .map((id) => ({ id, minCia: unitsString(config.perkTiers[id], CIA_FACTS.decimals), perks: [...PERKS[id]] })) };
}

export function tierFor(balanceRaw, tiers) {
  const b = BigInt(balanceRaw);
  if (tiers.director !== undefined && b >= tiers.director) return "director";
  if (tiers.agent !== undefined && b >= tiers.agent) return "agent";
  if (b >= tiers.holder) return "holder";
  return "none";
}

/** The wallet's $CIA, raw, from every token account it has of the $CIA mint. */
export async function readCiaBalance(rpc, wallet) {
  const r = await rpc.call("getTokenAccountsByOwner", [wallet, { mint: CIA_MINT }, { encoding: "jsonParsed", commitment: "confirmed" }]);
  let total = 0n;
  for (const row of Array.isArray(r?.value) ? r.value : []) {
    const info = row?.account?.data?.parsed?.info;
    if (info?.mint === CIA_MINT && info?.owner === wallet) total += BigInt(info.tokenAmount?.amount ?? "0");
  }
  return total;
}

export function createPerks({ db, config, clock = () => Date.now(), randomBytes = crypto.randomBytes, balanceOf }) {
  function challenge(wallet) {
    if (!isAddress(wallet)) throw new PerksError("bad_wallet", "wallet must be a Solana address");
    const now = clock();
    const nonce = bs58.encode(randomBytes(16));
    const issuedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + config.challengeTtlMs).toISOString();
    const message = challengeMessage({ wallet, nonce, issuedAt, expiresAt });
    db.createNonce({ nonce, purpose: "perks", wallet, message, expiresAt: now + config.challengeTtlMs });
    return { wallet, nonce, message, expiresAt };
  }

  async function verify(body) {
    const wallet = body?.wallet, message = body?.message, signature = body?.signature;
    if (!isAddress(wallet)) throw new PerksError("bad_wallet", "wallet must be a Solana address");
    if (typeof message !== "string" || message.length > 1_000) throw new PerksError("bad_message", "message must be the challenge's text");
    if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) throw new PerksError("bad_signature", "signature must be base58");
    const nonce = /^Nonce: ([1-9A-HJ-NP-Za-km-z]{8,40})$/m.exec(message)?.[1] ?? null;
    const row = nonce ? db.getNonce(nonce) : null;
    if (!row || row.purpose !== "perks") throw new PerksError("unknown_challenge", "that message is not a challenge this server issued", 401);
    const now = clock();
    /* Spent first, whatever follows: one verify per challenge. */
    if (!db.useNonce(nonce, now)) throw new PerksError("replayed", "that challenge was already used: ask for a new one", 401);
    if (row.expires_at < now) throw new PerksError("expired", "that challenge has expired: ask for a new one", 401);
    if (row.wallet !== wallet || row.message !== message) throw new PerksError("mismatch", "the wallet or the message is not the challenge's", 401);
    if (!verifyEd25519({ address: wallet, message, signature })) throw new PerksError("bad_signature", "the signature is not this wallet's over this message", 401);
    let balance;
    try { balance = await balanceOf(wallet); } catch (e) { throw new PerksError("balance_unreadable", `the $CIA balance could not be read from the chain (${e.message})`, 503); }
    const tier = tierFor(balance, config.perkTiers);
    return { holder: balance > 0n, balance: unitsString(balance, CIA_FACTS.decimals), tier, perks: [...PERKS[tier]], expiresAt: new Date(now + config.perksTtlMs).toISOString() };
  }
  return Object.freeze({ challenge, verify });
}
