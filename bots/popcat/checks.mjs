/**
 * POPCAT'S CHECKS: WHAT THE CHAIN SAYS ABOUT A NEW CAT COIN, AND THE LINE EACH CHECK MUST CLEAR.
 *
 * A callout is these checks, every one shown, and nothing else — no "buy", no price call, no
 * score. A coin is called out only when every check below passes (or, for the one check whose
 * source may be silent, reads "not available"). The thresholds are named here and nowhere else.
 *
 *   mint_authority     the mint authority is revoked (read from the mint account)
 *   freeze_authority   the freeze authority is revoked
 *   mint_extensions    the executor's own auditMintAccount accepts the mint's Token-2022
 *                      extensions (no transfer fee, hook, delegate, pause…)
 *   creator_share      the creator holds at most MAX_CREATOR_SHARE_PCT of the supply (the creator
 *                      pump.fun lists and the one its bonding curve names on chain, together)
 *   top10_share        the ten largest holders, the bonding curve excluded, hold at most
 *                      MAX_TOP10_SHARE_PCT, across at least MIN_HOLDERS holders (every token
 *                      account of the mint, read with getProgramAccounts)
 *   same_slot_buyers   at most MAX_SAME_SLOT_BUYERS other wallets bought in the slot the coin was
 *                      created in — a bundle heuristic: it cannot prove who controls a wallet.
 *                      A same-slot transaction it did not read (past SAME_SLOT_LIMITS, or one the
 *                      RPC would not return) counts as a buyer it cannot rule out. "not reached"
 *                      (info) when the coin traded so much that its creation lies beyond
 *                      SAME_SLOT_LIMITS pages of signatures
 *   creator_launches   the creator launched at most MAX_CREATOR_PRIOR_LAUNCHES coins before this
 *                      one (pump.fun's own count; "not available" when pump.fun does not say)
 *   socials            its metadata names at least one of twitter, telegram, website (presence
 *                      only: no link is followed, and none is shown on the site)
 *   age                between MIN_AGE_MINUTES and MAX_AGE_HOURS old, by its creation transaction
 *   curve              at least MIN_CURVE_PROGRESS_PCT of the bonding curve's tokens sold (or
 *                      graduated), with its market cap in SOL computed from the curve
 *   copycat            its name and ticker are not an established cat coin's (established.mjs)
 *   not_cashcat        neither its mint nor its creator is CashCat's — the creator as pump.fun
 *                      lists it and as its bonding curve records it on chain
 */
import { auditMintAccount, describeMint } from "../../vendor/executor/token2022.mjs";
import { decodeBondingCurve } from "../../vendor/executor/snipe-venue-pumpfun.mjs";
import { socialsFromMetadata } from "../../vendor/executor/snipe-socials.mjs";
import { PUMPFUN_GLOBAL, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, WSOL_MINT } from "../lib/verified.mjs";
import { decodeGlobalForLaunch } from "../cashcat/pumpfun.mjs";
import { copycatOf, ESTABLISHED_CAT_COINS } from "./established.mjs";
import bs58 from "bs58";

export const THRESHOLDS = Object.freeze({
  MIN_AGE_MINUTES: 15,
  MAX_AGE_HOURS: 24,
  MAX_CREATOR_SHARE_PCT: 5,
  MAX_TOP10_SHARE_PCT: 30,
  MIN_HOLDERS: 25,
  MAX_SAME_SLOT_BUYERS: 2,
  MAX_CREATOR_PRIOR_LAUNCHES: 10,
  MIN_CURVE_PROGRESS_PCT: 10,
});
/** How far back a same-slot search may page, and how many same-slot transactions it reads. */
export const SAME_SLOT_LIMITS = Object.freeze({ maxSignaturePages: 5, maxTransactions: 8 });

const pct = (part, whole) => (whole > 0n ? Number((part * 1_000_000n) / whole) / 10_000 : 0);
const fmtPct = (p) => `${p.toFixed(p < 10 ? 2 : 1)}%`;

/** Every token account of a mint: [{ owner, amount }], from getProgramAccounts with a mint filter. */
export async function holdersOf({ rpc, mint, tokenProgram }) {
  const res = await rpc.call("getProgramAccounts", [tokenProgram, {
    encoding: "base64", commitment: "confirmed",
    dataSlice: { offset: 32, length: 40 },
    filters: [{ memcmp: { offset: 0, bytes: mint } }, ...(tokenProgram === TOKEN_PROGRAM ? [{ dataSize: 165 }] : [])],
  }]);
  if (!Array.isArray(res)) throw new Error("getProgramAccounts did not answer with a list");
  return res.map((a) => {
    const b = Buffer.from(a.account.data[0], "base64");
    return { account: a.pubkey, owner: bs58.encode(b.subarray(0, 32)), amount: b.readBigUInt64LE(32) };
  });
}

/**
 * The creation transaction (the oldest signature on the bonding curve) and the other wallets
 * that bought in its slot. Returns { createSig, createSlot, createTime, sameSlotBuyers[] }; for a
 * coin traded so much that its creation lies beyond the paging limit, createSig is null and the
 * check reads "not reached" instead of guessing.
 */
export async function creationAndSameSlot({ rpc, curve, creator }) {
  let before, oldest = null, all = [];
  for (let page = 0; page < SAME_SLOT_LIMITS.maxSignaturePages; page++) {
    const sigs = await rpc.getSignaturesForAddress(curve, { limit: 1000, ...(before ? { before } : {}) });
    all = all.concat(sigs);
    /* A short page is the last: the oldest signature is the last one read, on this page or,
       when this page is empty (a multiple of 1,000 in all), on the one before. */
    if (sigs.length < 1000) { oldest = all.length ? all[all.length - 1] : null; break; }
    before = sigs[sigs.length - 1].signature;
  }
  if (!oldest) return { createSig: null, createSlot: null, createTime: null, sameSlotBuyers: [], sameSlotTxs: null, sameSlotUnread: 0, pagesRead: all.length };
  const inSlot = all.filter((s) => s.slot === oldest.slot && s.signature !== oldest.signature && !s.err);
  const buyers = new Set();
  let unread = Math.max(0, inSlot.length - SAME_SLOT_LIMITS.maxTransactions);
  for (const s of inSlot.slice(0, SAME_SLOT_LIMITS.maxTransactions)) {
    const tx = await rpc.getTransaction(s.signature);
    const payer = tx?.transaction?.message?.accountKeys?.[0];
    if (!payer) unread++;
    else if (payer !== creator) buyers.add(payer);
  }
  return { createSig: oldest.signature, createSlot: oldest.slot, createTime: oldest.blockTime ?? null, sameSlotBuyers: [...buyers], sameSlotTxs: inSlot.length, sameSlotUnread: unread };
}

/** Everything the checks need from the chain, in a handful of calls. */
export async function gatherOnchain({ rpc, coin }) {
  const [mintAcc, curveAcc, globalAcc] = await rpc.getMultipleAccounts([coin.mint, coin.curve, PUMPFUN_GLOBAL]);
  if (!mintAcc) throw new Error("the mint does not exist on chain");
  if (!curveAcc) throw new Error("the bonding curve does not exist on chain");
  const holders = await holdersOf({ rpc, mint: coin.mint, tokenProgram: mintAcc.owner });
  const creation = await creationAndSameSlot({ rpc, curve: coin.curve, creator: coin.creator });
  return { mintAcc, curveAcc, globalAcc, holders, ...creation };
}

/**
 * The checks, from what was gathered. Returns { pass, checks: [{ id, result, value }],
 * failed: [ids] }. `result` is pass, fail or info ("not available" from a silent source).
 */
export function evaluate({ coin, onchain, creatorLaunches, metadata, now, cashcat = { mints: new Set(), wallets: new Set() } }) {
  const checks = [];
  const add = (id, ok, value, info = false) => checks.push({ id, result: info ? "info" : ok ? "pass" : "fail", value: String(value).slice(0, 90) });
  const T = THRESHOLDS;

  /* The creator as pump.fun's listing names it and as the bonding curve records it on chain:
     the listing is an API's word, the curve is the program's. Both are checked and counted. */
  const curve = decodeBondingCurve({ owner: onchain.curveAcc.owner, data: onchain.curveAcc.data }, { mint: coin.mint });
  const creators = new Set([coin.creator, curve.creator].filter(Boolean));
  const isCashcat = cashcat.mints.has(coin.mint) || [...creators].some((c) => cashcat.wallets.has(c));
  add("not_cashcat", !isCashcat, isCashcat ? "a CashCat coin" : "creator and mint are not CashCat's");

  const mint = describeMint({ owner: onchain.mintAcc.owner, data: onchain.mintAcc.data }, coin.mint);
  add("mint_authority", mint.mintAuthority === null, mint.mintAuthority === null ? "revoked" : `held by ${mint.mintAuthority}`);
  add("freeze_authority", mint.freezeAuthority === null, mint.freezeAuthority === null ? "revoked" : `held by ${mint.freezeAuthority}`);
  let extOk = true, extValue;
  try {
    const a = auditMintAccount({ owner: onchain.mintAcc.owner, data: onchain.mintAcc.data }, coin.mint);
    extValue = a.extensionNames.length ? `${a.program === TOKEN_2022_PROGRAM ? "Token-2022" : "SPL Token"}: ${a.extensionNames.join(", ")}` : "none";
  } catch (e) { extOk = false; extValue = e.message.replace(`mint ${coin.mint} `, "").slice(0, 90); }
  add("mint_extensions", extOk, extValue);

  const supply = onchain.mintAcc.data.readBigUInt64LE(36);
  const curveOwned = (h) => h.owner === coin.curve;
  const others = onchain.holders.filter((h) => !curveOwned(h) && h.amount > 0n).sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  const creatorHeld = onchain.holders.filter((h) => creators.has(h.owner)).reduce((s, h) => s + h.amount, 0n);
  const creatorPct = pct(creatorHeld, supply);
  add("creator_share", creatorPct <= T.MAX_CREATOR_SHARE_PCT, `${fmtPct(creatorPct)} of the supply`);
  const top10 = others.slice(0, 10).reduce((s, h) => s + h.amount, 0n);
  const top10Pct = pct(top10, supply);
  add("top10_share", top10Pct <= T.MAX_TOP10_SHARE_PCT && others.length >= T.MIN_HOLDERS, `${fmtPct(top10Pct)} of the supply; ${others.length} holders besides the curve`);

  const unread = onchain.sameSlotUnread ?? 0;
  const n = onchain.sameSlotBuyers.length + unread;
  if (onchain.createSig === null) add("same_slot_buyers", true, `not reached: more than ${SAME_SLOT_LIMITS.maxSignaturePages * 1000} transactions since launch`, true);
  else add("same_slot_buyers", n <= T.MAX_SAME_SLOT_BUYERS, n === 0 ? `none in slot ${onchain.createSlot}` : `${unread ? "up to " : ""}${n} in slot ${onchain.createSlot}${unread ? ` (${unread} not read)` : ""}`);

  if (creatorLaunches === null || creatorLaunches === undefined) add("creator_launches", true, "not available from pump.fun", true);
  else { const prior = Math.max(0, creatorLaunches - 1); add("creator_launches", prior <= T.MAX_CREATOR_PRIOR_LAUNCHES, `${prior} earlier coin${prior === 1 ? "" : "s"} (pump.fun's count)`); }

  const socials = metadata?.ok ? socialsFromMetadata(metadata.doc) : null;
  add("socials", Boolean(socials?.any), socials ? (socials.any ? socials.present.join(", ") : "none in its metadata") : (metadata?.why ?? "metadata not read"));

  const createdMs = onchain.createTime ? onchain.createTime * 1000 : coin.createdMs;
  const ageMin = Math.max(0, (now - createdMs) / 60_000);
  add("age", ageMin >= T.MIN_AGE_MINUTES && ageMin <= T.MAX_AGE_HOURS * 60, ageMin < 120 ? `${Math.floor(ageMin)} minutes` : `${(ageMin / 60).toFixed(1)} hours`);

  let progressPct = 100, capSol = null;
  if (!curve.complete) {
    const g = onchain.globalAcc ? decodeGlobalForLaunch(onchain.globalAcc.data) : null;
    const initialReal = g?.initialRealTokenReserves ?? 793_100_000_000_000n;
    progressPct = Math.max(0, pct(initialReal - curve.realBaseRaw, initialReal));
    if (curve.quoteIsSol && curve.vBaseRaw > 0n) capSol = Number((curve.vQuoteRaw * supply) / curve.vBaseRaw) / 1e9;
  }
  const quoted = curve.quoteIsSol ? "SOL" : `quoted in ${curve.quoteMint.slice(0, 6)}…`;
  add("curve", progressPct >= T.MIN_CURVE_PROGRESS_PCT, curve.complete ? "graduated" : `${fmtPct(progressPct)} sold${capSol !== null ? `, market cap ${capSol.toFixed(1)} SOL` : `, ${quoted}`}`);

  const copy = copycatOf({ name: coin.name, symbol: coin.symbol, mint: coin.mint });
  add("copycat", !copy, copy ? `copies ${copy.name} ($${copy.symbol.replace(/^\$/, "")}, ${copy.mint.slice(0, 5)}…${copy.mint.slice(-4)})` : `no match among ${ESTABLISHED_CAT_COINS.length} established cat coins`);

  const failed = checks.filter((c) => c.result === "fail").map((c) => c.id);
  return { pass: failed.length === 0, checks, failed, ageMin, progressPct };
}

export { WSOL_MINT };
