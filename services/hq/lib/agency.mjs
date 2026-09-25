/**
 * THE AGENCY'S OWN COINS, WHICH NO AGENT EVER BUYS.
 *
 * An agent never buys its own coin, another agent's coin, $CIA, a coin the owner registered as
 * the agency's, a coin CashCat launched, or any coin whose creator is one of the agency's own
 * wallets (the treasury, any agent wallet, CashCat's wallet): buying them would be the agency
 * trading its own coins with its own money. The mint set and the creator set are rebuilt from
 * the database, the environment and the site's launches.json every time they are asked for;
 * for a pump.fun coin the creator is read from its bonding curve on chain at the buy.
 */
import { CIA_MINT } from "./config.mjs";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The site's launches.json → [{ mint, creator }] (only well-formed addresses). */
export function parseLaunches(body) {
  const list = Array.isArray(body?.launches) ? body.launches : [];
  return list.filter((l) => l && BASE58.test(String(l.mint ?? ""))).map((l) => ({ mint: l.mint, creator: BASE58.test(String(l.creator ?? "")) ? l.creator : null, symbol: typeof l.symbol === "string" ? l.symbol.slice(0, 16) : null }));
}

export async function fetchLaunches({ fetchImpl = globalThis.fetch, url, timeoutMs = 15_000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: controller.signal, redirect: "error" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseLaunches(await res.json());
  } finally { clearTimeout(timer); }
}

/** { mints: Set, creators: Set } of everything the agency owns or made. */
export function agencyExclusions({ agents = [], coins = [], launches = [], treasury = null, cashcatWallet = null }) {
  const mints = new Set([CIA_MINT]);
  const creators = new Set();
  for (const a of agents) { if (a.coinMint) mints.add(a.coinMint); if (a.wallet) creators.add(a.wallet); }
  for (const c of coins) { mints.add(c.mint); if (c.creator) creators.add(c.creator); }
  for (const l of launches) { mints.add(l.mint); if (l.creator) creators.add(l.creator); }
  if (treasury) creators.add(treasury);
  if (cashcatWallet) creators.add(cashcatWallet);
  return Object.freeze({ mints, creators });
}

/** Whether a coin is the agency's: { agency, why }. `creator` as the chain names it, when known. */
export function agencyCoin({ mint, creator = null }, ex) {
  if (mint === CIA_MINT) return { agency: true, why: "it is $CIA, the agency's own coin" };
  if (ex.mints.has(mint)) return { agency: true, why: "it is one of the agency's own coins (an agent's, a registered one, or CashCat's)" };
  if (creator && ex.creators.has(creator)) return { agency: true, why: `its creator ${creator} is one of the agency's own wallets` };
  return { agency: false, why: null };
}
