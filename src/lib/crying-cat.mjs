/**
 * CRYING CAT, IN YOUR BROWSER: A RUG CHECK FOR ANY MINT.
 *
 * Crying Cat is the agency's face for ruggers. Here it is a tool: paste a pump.fun or Solana SPL
 * token's mint address and it reads the chain and reports what Popcat's checks say where they
 * apply, in plain words. It reuses the bots' code and retypes none of it:
 *
 *   · the mint: the executor's describeMint and auditMintAccount (vendor/executor/token2022.mjs),
 *     which the lanes run before any trade: mint and freeze authority, Token-2022 extensions;
 *   · the holders: bots/popcat/checks.mjs holdersOf (every token account of the mint), with the
 *     bonding curve and every program-held account (a pool, a vault: an owner off the ed25519
 *     curve) left out, and Popcat's THRESHOLDS for the top 10's share and the holder count; for a
 *     token too big to list (the RPC refuses, or the answer passes the size cap) the 20 largest
 *     accounts from getTokenLargestAccounts instead, and the count says it was not counted;
 *   · pump.fun: the coin's bonding curve, derived from the mint and decoded with the executor's
 *     decodeBondingCurve: its creator (so the creator's share is known), and whether it has
 *     graduated or how much of it has sold;
 *   · copycats: bots/popcat/established.mjs, when the mint carries its name on chain.
 *
 * THE INPUT is checked strictly before anything is read: a base58 address that decodes to 32
 * bytes, or a pump.fun coin page link of exactly the form https://pump.fun/coin/<address>, and
 * nothing else; whatever the user pasted is never fetched, only the address read out of it.
 *
 * A red flag is what the chain said at that moment, never an accusation; nothing here is
 * advice. Grumpy Cat (fake hype) is not built: it needs social data this extension does not
 * have. Everything is injected; this file touches no chrome.* API and signs nothing.
 */
import { describeMint, auditMintAccount, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from "../../vendor/executor/token2022.mjs";
import { decodeBondingCurve } from "../../vendor/executor/snipe-venue-pumpfun.mjs";
import { holdersOf, THRESHOLDS } from "../../bots/popcat/checks.mjs";
import { copycatOf } from "../../bots/popcat/established.mjs";
import { decodeGlobalForLaunch } from "../../bots/cashcat/pumpfun.mjs";
import { address, pda } from "../../bots/lib/solana.mjs";
import { PUMPFUN_PROGRAM, PUMPFUN_GLOBAL, SYSTEM_PROGRAM, PAGES } from "../../bots/lib/verified.mjs";
import { PublicKey } from "@solana/web3.js";

export const CRYING_NOT_ADVICE = "What the chain said when it was read, not an accusation and not advice. A coin with no red flag can still go to zero; a red flag can have an honest reason.";
export const GRUMPY_NOT_BUILT = "Grumpy Cat (fake hype) is not in the extension: telling real hype from fake needs social data it does not have.";

export class CryingCatError extends Error {
  constructor(clause, message) { super(message); this.name = "CryingCatError"; this.clause = clause; }
}

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PUMP_PAGE = /^https:\/\/pump\.fun\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})\/?$/;

/**
 * The mint in what the user pasted, or { ok: false, why }. Surrounding whitespace is trimmed;
 * anything else — a space inside, a query string, another site, a name — is refused.
 */
export function parseMintInput(raw) {
  if (typeof raw !== "string") return { ok: false, why: "paste a mint address" };
  const s = raw.trim();
  if (!s) return { ok: false, why: "paste a mint address" };
  if (s.length > 120) return { ok: false, why: "that is longer than a mint address or a pump.fun coin link" };
  if (/\s/.test(s)) return { ok: false, why: "a mint address has no spaces in it" };
  const page = s.match(PUMP_PAGE);
  const candidate = page ? page[1] : s;
  if (!BASE58_ADDRESS.test(candidate)) {
    return { ok: false, why: /^https?:\/\//i.test(s) ? "only a pump.fun coin link (https://pump.fun/coin/<address>) or the address itself is read" : "that is not a Solana address: 32 to 44 base58 characters (no 0, O, I or l)" };
  }
  const a = address(candidate);
  if (!a) return { ok: false, why: "that is not a Solana address: it does not decode to 32 bytes" };
  return { ok: true, mint: a, from: page ? "pump.fun link" : "address" };
}

const pct = (part, whole) => (whole > 0n ? Number((part * 1_000_000n) / whole) / 10_000 : 0);
const fmtPct = (p) => `${p.toFixed(p < 10 ? 2 : 1)}%`;
const programAddress = (a) => { try { return !PublicKey.isOnCurve(new PublicKey(a).toBytes()); } catch { return false; } };
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const byAmount = (a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0);

/** The holders: every account when the RPC lists them, else the 20 largest. */
async function readHolders({ rpc, mint, tokenProgram, preferAll }) {
  const all = async () => ({ list: await holdersOf({ rpc, mint, tokenProgram }), counted: true, source: "every token account of the mint" });
  const largest = async () => {
    const top = await rpc.getTokenLargestAccounts(mint);
    if (!Array.isArray(top)) throw new Error("getTokenLargestAccounts did not answer with a list");
    const accs = top.length ? await rpc.getMultipleAccounts(top.map((t) => t.address)) : [];
    const list = top.map((t, i) => {
      const a = accs[i];
      const owner = a?.data?.length >= 64 ? new PublicKey(a.data.subarray(32, 64)).toBase58() : null;
      return { account: t.address, owner, amount: BigInt(t.amount) };
    }).filter((h) => h.owner);
    return { list, counted: false, source: `the ${list.length} largest token accounts` };
  };
  if (preferAll) { try { return await all(); } catch { return await largest(); } }
  try { return await largest(); } catch { return await all(); }
}

/**
 * The report for one mint. `rpc` is the bots' JSON-RPC client (accounts with Buffer data).
 * Returns { mint, name, symbol, program, decimals, supply, verdict, flags, checks[], notes[],
 * pumpfun, holders, links[], readAt }.
 */
export async function cryingCatReport({ rpc, mint, now = Date.now() }) {
  if (!rpc) throw new CryingCatError("no_rpc", "set your RPC in Options: the report is read from the chain");
  const curveAddr = pda([{ utf8: "bonding-curve" }, { key: mint }], PUMPFUN_PROGRAM);
  const [mintAcc, curveAcc, globalAcc] = await rpc.getMultipleAccounts([mint, curveAddr, PUMPFUN_GLOBAL]);
  if (!mintAcc) throw new CryingCatError("not_found", "no account lives at that address: nothing to check");
  if (mintAcc.owner === SYSTEM_PROGRAM) throw new CryingCatError("not_a_mint", "that address is a wallet, not a token mint");
  if (mintAcc.owner !== TOKEN_PROGRAM && mintAcc.owner !== TOKEN_2022_PROGRAM) throw new CryingCatError("not_a_mint", "that account is not a token mint (it belongs to another program)");
  /* A token account (someone's balance of a token) is 165 bytes under SPL Token, and carries the
     account type 2 at byte 165 under Token-2022 (a mint carries 1). */
  const tokenAccount = mintAcc.owner === TOKEN_PROGRAM ? mintAcc.data.length === 165 : mintAcc.data.length > 165 && mintAcc.data[165] === 2;
  if (tokenAccount) throw new CryingCatError("not_a_mint", "that is a token account (someone's balance of a token), not the token's mint");
  let d;
  try { d = describeMint({ owner: mintAcc.owner, data: mintAcc.data }, mint); }
  catch (e) { throw new CryingCatError("not_a_mint", `that account does not read as a token mint: ${e.message}`); }
  if (!d.initialized) throw new CryingCatError("not_a_mint", "that mint is not initialized");
  const supply = mintAcc.data.readBigUInt64LE(36);

  const checks = [], notes = [];
  const add = (id, label, result, value) => checks.push({ id, label, result, value: String(value).slice(0, 140) });

  /* the mint */
  add("mint_authority", "Mint authority", d.mintAuthority === null ? "pass" : "fail", d.mintAuthority === null ? "revoked" : `held by ${d.mintAuthority}`);
  notes.push(d.mintAuthority === null ? "Nobody can mint more of it: its mint authority is revoked."
    : `The wallet ${short(d.mintAuthority)} can mint more of it at any time, diluting every holder.`);
  add("freeze_authority", "Freeze authority", d.freezeAuthority === null ? "pass" : "fail", d.freezeAuthority === null ? "revoked" : `held by ${d.freezeAuthority}`);
  notes.push(d.freezeAuthority === null ? "Nobody can freeze holders' tokens: its freeze authority is revoked."
    : `The wallet ${short(d.freezeAuthority)} can freeze any holder's tokens so they cannot be sold or moved. Stablecoins and tokenised stocks keep one on purpose; a new memecoin has no reason to.`);
  let extOk = true, extValue;
  try {
    const a = auditMintAccount({ owner: mintAcc.owner, data: mintAcc.data }, mint);
    extValue = a.extensionNames.length ? `Token-2022: ${a.extensionNames.join(", ")}` : mintAcc.owner === TOKEN_2022_PROGRAM ? "Token-2022, no extension that matters" : "SPL Token (no extensions)";
  } catch (e) { extOk = false; extValue = e.message.replace(`mint ${mint} `, ""); }
  add("mint_extensions", "Token extensions", extOk ? "pass" : "fail", extValue);
  if (!extOk) notes.push(`Its token settings fail the audit the trading lanes run before a trade: ${extValue}. A transfer fee, a transfer hook, a permanent delegate or a pause switch lets someone other than the holder take a cut, block a sale or move the tokens.`);

  /* pump.fun */
  let pumpfun = null;
  if (curveAcc && curveAcc.owner === PUMPFUN_PROGRAM) {
    try {
      const c = decodeBondingCurve({ owner: curveAcc.owner, data: curveAcc.data }, { mint });
      let progressPct = 100;
      if (!c.complete) {
        const g = globalAcc ? decodeGlobalForLaunch(globalAcc.data) : null;
        const initialReal = g?.initialRealTokenReserves ?? 793_100_000_000_000n;
        progressPct = Math.max(0, Math.min(100, pct(initialReal - c.realBaseRaw, initialReal)));
      }
      pumpfun = { curve: curveAddr, creator: c.creator ?? null, complete: c.complete === true, progressPct: Math.round(progressPct * 100) / 100, quoteIsSol: c.quoteIsSol };
    } catch { pumpfun = null; }
  }
  if (pumpfun) {
    add("curve", "pump.fun bonding curve", "info", pumpfun.complete ? "graduated" : `${fmtPct(pumpfun.progressPct)} of the curve sold`);
    notes.push(pumpfun.complete ? "It graduated from its pump.fun bonding curve: it now trades in a pool, and the curve holds nothing."
      : `It is still on its pump.fun bonding curve, ${fmtPct(pumpfun.progressPct)} of it sold. Most pump.fun coins never finish their curve.`);
  } else add("curve", "pump.fun bonding curve", "info", "not a pump.fun coin (no bonding curve for this mint)");

  /* the holders */
  let holders = null;
  try {
    const got = await readHolders({ rpc, mint, tokenProgram: mintAcc.owner, preferAll: Boolean(pumpfun) });
    const curveOwned = (h) => (pumpfun && h.owner === pumpfun.curve) || programAddress(h.owner);
    const people = got.list.filter((h) => !curveOwned(h) && h.amount > 0n).sort(byAmount);
    const top10Pct = pct(people.slice(0, 10).reduce((s, h) => s + h.amount, 0n), supply);
    const pools = got.list.filter((h) => curveOwned(h) && h.amount > 0n).length;
    holders = { counted: got.counted, holders: got.counted ? people.length : null, top10Pct: Math.round(Math.min(100, top10Pct) * 100) / 100, source: got.source, programHeld: pools, list: people };
    const tooFew = got.counted && people.length < THRESHOLDS.MIN_HOLDERS;
    add("top10_share", "Top 10 holders (pools and the curve excluded)", top10Pct <= THRESHOLDS.MAX_TOP10_SHARE_PCT && !tooFew ? "pass" : "fail",
      `${fmtPct(top10Pct)} of the supply; ${got.counted ? `${people.length} holders besides the curve and pools` : `holders not counted (${got.source})`}`);
    notes.push(`The ten largest holders that are people, not pools or the curve, hold ${fmtPct(top10Pct)} of the supply${got.counted ? `, across ${people.length} holders` : ""}. Popcat flags more than ${THRESHOLDS.MAX_TOP10_SHARE_PCT}%${got.counted ? `, or fewer than ${THRESHOLDS.MIN_HOLDERS} holders` : ""}: a few wallets can then sell most of the market at once.`);
  } catch (e) {
    add("top10_share", "Top 10 holders (pools and the curve excluded)", "info", `not read: ${String(e?.message ?? e).slice(0, 100)}`);
    notes.push("Its holders could not be read from this RPC, so the top 10's share is unknown.");
  }

  /* the creator, when pump.fun's curve names one */
  if (pumpfun?.creator && holders) {
    const held = holders.list.filter((h) => h.owner === pumpfun.creator).reduce((s, h) => s + h.amount, 0n);
    const p = pct(held, supply);
    add("creator_share", "Creator holds", p <= THRESHOLDS.MAX_CREATOR_SHARE_PCT ? "pass" : "fail", `${fmtPct(p)} of the supply (creator ${short(pumpfun.creator)})`);
    notes.push(p > THRESHOLDS.MAX_CREATOR_SHARE_PCT ? `Its creator still holds ${fmtPct(p)} of the supply and can sell it into the curve or pool at any time.` : `Its creator holds ${fmtPct(p)} of the supply.`);
  } else add("creator_share", "Creator holds", "info", pumpfun ? "the holders could not be read" : "creator not known (not a pump.fun coin)");

  /* copycats, when the mint carries its name */
  if (d.metadataName || d.metadataSymbol) {
    const copy = copycatOf({ name: d.metadataName ?? "", symbol: d.metadataSymbol ?? "", mint });
    add("copycat", "Copy of an established cat coin", copy ? "fail" : "pass", copy ? `copies ${copy.name} ($${copy.symbol.replace(/^\$/, "")})` : "no match among the established cat coins");
    if (copy) notes.push(`Its name or ticker is that of ${copy.name}, an established cat coin with another mint (${short(copy.mint)}): a copy trades on the original's name.`);
  } else add("copycat", "Copy of an established cat coin", "info", "no name on chain in the mint");

  const flags = checks.filter((c) => c.result === "fail");
  const links = [
    { label: "Mint on Solscan", href: PAGES.solscanAccount(mint) },
    ...(pumpfun ? [{ label: "The coin on pump.fun", href: PAGES.pumpCoin(mint) }] : []),
    ...(pumpfun?.creator ? [{ label: "Creator on Solscan", href: PAGES.solscanAccount(pumpfun.creator) }] : []),
  ];
  return {
    mint, name: d.metadataName, symbol: d.metadataSymbol, program: mintAcc.owner === TOKEN_2022_PROGRAM ? "Token-2022" : "SPL Token", decimals: d.decimals,
    supplyRaw: supply.toString(), verdict: flags.length ? `RED FLAGS (${flags.length})` : "NO RED FLAGS FOUND", flags: flags.map((f) => f.id),
    checks, notes, pumpfun: pumpfun ? { complete: pumpfun.complete, progressPct: pumpfun.progressPct, creator: pumpfun.creator } : null,
    holders: holders ? { counted: holders.counted, holders: holders.holders, top10Pct: holders.top10Pct, source: holders.source, programHeld: holders.programHeld } : null,
    links, readAt: new Date(now).toISOString(), notAdvice: CRYING_NOT_ADVICE,
  };
}
