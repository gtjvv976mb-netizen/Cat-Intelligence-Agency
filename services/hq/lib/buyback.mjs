/**
 * THE $CIA BUYBACK: A SHARE OF THE AGENCY'S REVENUE BUYS $CIA, BY A WRITTEN POLICY, ON CHAIN.
 *
 * THE POLICY (environment, docs/hq/DEPLOY.md):
 *   HQ_BUYBACK_SHARE_PCT      the share of new agency revenue spent on $CIA (0 until the owner sets it)
 *   revenue                   SOL the agent wallets sent the treasury as claimed creator fees
 *                             (memo cia-hq:fee_sweep:NNN) and as realized trading profit
 *                             (cia-hq:profit_sweep:NNN) — read from the treasury's own transactions
 *   HQ_BUYBACK_CRON           when it runs (UTC cron)
 *   HQ_BUYBACK_MAX_SOL        the most one run spends
 *   HQ_BUYBACK_DESTINATION    burn (the bought $CIA is burned, a second transaction) or treasury (kept)
 * Owed = revenue × share − everything already spent on buybacks; a run spends the least of what is
 * owed, the per-run maximum and what the treasury holds above its reserve.
 *
 * THE SWAP, FROM THE TREASURY WALLET. $CIA (EDVtiBjP…pump) is a Token-2022 pump.fun coin whose
 * bonding curve is quoted in HYPE (98sMhv…Mh5g), not SOL — read off its curve on 2026-09-25,
 * and read again every run. There is no direct SOL → $CIA pool, so the path is the curve's own:
 * SOL → the curve's quote token (Jupiter, direct route) → $CIA (Jupiter, direct route, on the
 * curve or the pool it graduates to). The allowlist is exactly those legs, built from the
 * curve, and nothing else: each leg is Jupiter's transaction through checkSwapTransaction with
 * that allowlist, the custody checks, the simulation guard, then the treasury's signature. The
 * second leg spends exactly what the first delivered, so the treasury keeps none of the
 * intermediate token. $CIA's program and decimals are verified live first (Token-2022, 6); a
 * mismatch stops the run. Every leg's transaction, and the burn's, is recorded.
 *
 * OFF BY DEFAULT: it runs only with HQ_BUYBACK_LIVE=1 AND HQ_TREASURY_SECRET set for the wallet
 * HQ_TREASURY_ADDRESS names AND a share above 0 AND the owner's RPC, and never under the kill switch.
 */
import { randomUUID } from "node:crypto";
import { describeMint, TOKEN_2022_PROGRAM } from "../../../vendor/executor/token2022.mjs";
import { decodeBondingCurve, bondingCurveAddress, curveQuoteMint } from "../../../vendor/executor/snipe-venue-pumpfun.mjs";
import { PUMPFUN_PROGRAM, WSOL_MINT } from "../../../bots/lib/verified.mjs";
import { CIA_MINT, CIA_FACTS } from "./config.mjs";
import { classifyTransaction, walletView, parseHqMemo } from "./classify.mjs";
import { solString, unitsString, priceString } from "./amounts.mjs";
import { WSOL } from "./execution.mjs";

export const BUYBACK_FEE_ROOM = 10_000_000n;       // kept back for the legs' fees and account rent

/** Pure: how much this run spends. All BigInt lamports; sharePct a number (0–100). */
export function buybackBudget({ revenueLamports, spentLamports, sharePct, maxPerRunLamports, treasuryCashLamports, reserveLamports, minLamports }) {
  const bps = BigInt(Math.round(Number(sharePct) * 100));
  const entitled = (BigInt(revenueLamports) * bps) / 10_000n;
  const owed = entitled - BigInt(spentLamports) > 0n ? entitled - BigInt(spentLamports) : 0n;
  const avail = BigInt(treasuryCashLamports) - BigInt(reserveLamports) - BUYBACK_FEE_ROOM;
  const available = avail > 0n ? avail : 0n;
  let spend = owed;
  let why = "owed";
  if (spend > BigInt(maxPerRunLamports)) { spend = BigInt(maxPerRunLamports); why = "the per-run maximum"; }
  if (spend > available) { spend = available; why = "what the treasury holds above its reserve"; }
  if (spend < BigInt(minLamports)) return Object.freeze({ entitled, owed, available, spend: 0n, why: owed === 0n ? "nothing is owed: revenue × share is already spent" : `under the ${solString(minLamports)} SOL minimum (held to ${why})` });
  return Object.freeze({ entitled, owed, available, spend, why });
}

/** The path from SOL to $CIA, from $CIA's own curve: [[in, out], …] and the allowlist. Pure. */
export function buybackPath({ curveQuote }) {
  const q = curveQuote && curveQuote !== WSOL_MINT ? curveQuote : null;
  const legs = q ? [[WSOL_MINT, q], [q, CIA_MINT]] : [[WSOL_MINT, CIA_MINT]];
  return Object.freeze({ legs: Object.freeze(legs), allowedPairs: new Set(legs.map(([a, b]) => `${a}>${b}`)), intermediate: q });
}

/**
 * The treasury's flows, from its own transactions (classified for the treasury):
 *   funding_out  SOL the treasury sent an agent wallet
 *   funding_in   SOL an agent wallet sent back (a withdrawal, or a transfer with no HQ memo)
 *   fee_in       an agent's sweep of claimed creator fees (memo cia-hq:fee_sweep:NNN)
 *   profit_in    an agent's sweep of realized trading profit (memo cia-hq:profit_sweep:NNN)
 *   buyback      SOL spent on the first leg of a recorded buyback
 * Money from anywhere else is the owner's own business and is not listed.
 */
export function treasuryFlows({ rows, treasury, agentWallets, buybacks = [] }) {
  const leg1 = new Set(buybacks.map((b) => b.legSigs?.[0]).filter(Boolean));
  const flows = [];
  let feeIn = 0n, profitIn = 0n, fundingOut = 0n, fundingIn = 0n, buybackSpent = 0n;
  for (const row of rows) {
    if (!row.tx) continue;
    const e = classifyTransaction(row.tx, { wallet: treasury });
    if (!e) continue;
    if (e.kind === "deposit" && agentWallets.has(e.from)) {
      const memo = parseHqMemo(e.memo);
      const kind = memo?.kind === "fee_sweep" ? "fee_in" : memo?.kind === "profit_sweep" ? "profit_in" : "funding_in";
      if (kind === "fee_in") feeIn += e.lamports; else if (kind === "profit_in") profitIn += e.lamports; else fundingIn += e.lamports;
      flows.push({ t: e.t, kind, lamports: e.lamports, tx: e.signature, agent: agentWallets.get(e.from) });
    } else if (e.kind === "withdrawal" && e.to && agentWallets.has(e.to)) {
      fundingOut += e.lamports;
      flows.push({ t: e.t, kind: "funding_out", lamports: e.lamports, tx: e.signature, agent: agentWallets.get(e.to) });
    } else if (leg1.has(e.signature) && e.kind === "trade" && e.side === "buy") {
      buybackSpent += e.sol;
      flows.push({ t: e.t, kind: "buyback", lamports: e.sol, tx: e.signature });
    }
  }
  flows.sort((a, b) => String(b.t).localeCompare(String(a.t)));
  return Object.freeze({ flows, feeIn, profitIn, revenue: feeIn + profitIn, fundingOut, fundingIn, buybackSpent });
}

/** The treasury's cash (native SOL plus wrapped) and $CIA, read now. */
export async function treasuryBalances({ rpc, treasury }) {
  const sol = BigInt(await rpc.getBalance(treasury));
  let cia = 0n;
  try {
    const accounts = await rpc.getTokenAccountsByOwner(treasury, { programId: TOKEN_2022_PROGRAM });
    for (const a of accounts) if (a.mint === CIA_MINT) cia += BigInt(a.amountRaw);
  } catch { /* unread: zero shown as unread by the caller */ }
  return { sol, cia };
}

/** $CIA's mint and curve, read live: its program, decimals and the curve's quote token. */
export async function readCia(rpc) {
  const read = await rpc.getMultipleAccounts([CIA_MINT, bondingCurveAddress(CIA_MINT)], { commitment: "confirmed" });
  const [mintAcc, curveAcc] = read.accounts ?? [];
  if (!mintAcc) throw Object.assign(new Error("$CIA's mint account could not be read"), { clause: "cia_unreadable" });
  const d = describeMint(mintAcc, CIA_MINT);
  const facts = { program: d.program, decimals: d.decimals, mintAuthority: d.mintAuthority, freezeAuthority: d.freezeAuthority, supplyRaw: Buffer.from(mintAcc.data[0], "base64").readBigUInt64LE(36).toString() };
  let curve = null;
  if (curveAcc && curveAcc.owner === PUMPFUN_PROGRAM) {
    const c = decodeBondingCurve(curveAcc, { mint: CIA_MINT });
    curve = { complete: c.complete === true, quoteMint: curveQuoteMint(c), creator: c.creator ?? null };
  }
  return { facts, curve, slot: read.slot };
}
export function assertCiaFacts(facts) {
  if (facts.program !== CIA_FACTS.program || facts.decimals !== CIA_FACTS.decimals)
    throw Object.assign(new Error(`$CIA reads ${facts.decimals} decimals under ${facts.program}, not the ${CIA_FACTS.decimals} under Token-2022 it was verified with: no buyback`), { clause: "cia_mismatch" });
}

/** A token's delta for a wallet in one confirmed transaction (raw units). */
export function tokenDelta(tx, wallet, mint) {
  const v = walletView(tx, wallet);
  if (!v) return 0n;
  if (mint === WSOL_MINT) return v.wsolDelta;
  return v.moved.find((m) => m.mint === mint)?.delta ?? 0n;
}

/**
 * One scheduled run. Returns { ran, why, buyback? }. Everything is injected; nothing here reads
 * the environment or holds a key (the executor's treasury signer is wallet.mjs).
 */
export async function runBuyback({ config, db, rpc, executor, treasuryReady, clock = () => Date.now(), log = () => {} }) {
  if (!config.buybackLive) return { ran: false, why: "HQ_BUYBACK_LIVE is not 1" };
  if (treasuryReady !== "ok") return { ran: false, why: `the treasury key is ${treasuryReady}` };
  if (!config.treasury) return { ran: false, why: "HQ_TREASURY_ADDRESS is not set" };
  if (!config.rpcUrl) return { ran: false, why: "no RPC of the owner's is set" };
  if (config.kill || db.getKv("kill") === true) return { ran: false, why: "the kill switch is on" };
  if (!(config.buybackSharePct > 0)) return { ran: false, why: "HQ_BUYBACK_SHARE_PCT is 0" };
  const { facts, curve } = await readCia(rpc);
  assertCiaFacts(facts);
  const path = buybackPath({ curveQuote: curve?.quoteMint ?? null });
  const owner = { kind: "treasury", wallet: config.treasury };
  const agentWallets = new Map(db.listAgents().map((a) => [a.wallet, a.id]));
  const flows = treasuryFlows({ rows: db.listChainTxs(config.treasury), treasury: config.treasury, agentWallets, buybacks: db.listBuybacks(1000) });
  /* Spent: every recorded run whose first leg landed, whatever became of it after (a run that
     stopped between legs spent its SOL all the same), or what the treasury's own history shows. */
  const recorded = db.listBuybacks(1000).filter((b) => (b.legSigs ?? []).length > 0).reduce((s, b) => s + BigInt(b.sol_spent ?? 0), 0n);
  const spent = recorded > flows.buybackSpent ? recorded : flows.buybackSpent;
  const bal = await treasuryBalances({ rpc, treasury: config.treasury });
  const budget = buybackBudget({ revenueLamports: flows.revenue, spentLamports: spent, sharePct: config.buybackSharePct, maxPerRunLamports: config.buybackMaxPerRun,
    treasuryCashLamports: bal.sol, reserveLamports: config.treasuryReserve, minLamports: config.buybackMin });
  if (budget.spend === 0n) return { ran: false, why: budget.why, budget };
  const id = randomUUID();
  db.createBuyback({ id, detail: { path: path.legs, budget: { owed: String(budget.owed), spend: String(budget.spend) } } });
  const tokenFacts = async (mint) => {
    const read = await rpc.getMultipleAccounts([mint]);
    const d = describeMint(read.accounts[0], mint);
    return { mint, program: d.program, decimals: d.decimals, symbol: mint === CIA_MINT ? "CIA" : (d.metadataSymbol ?? mint.slice(0, 4)) };
  };
  const legSigs = [];
  try {
    await executor.wrap({ owner, lamports: budget.spend });
    let payAmount = budget.spend, pay = WSOL, got = null;
    for (const [, out] of path.legs) {
      const get = await tokenFacts(out);
      const r = await executor.jupiterSwap({ owner, pay, get, amountRaw: payAmount, slippageBps: config.buybackSlippageBps, maxImpactPct: config.buybackMaxImpactPct,
        allowedPairs: path.allowedPairs, kind: "buyback_leg", mint: out });
      legSigs.push(r.signature);
      got = tokenDelta(r.tx, config.treasury, out);
      if (!(got > 0n)) throw Object.assign(new Error(`the leg into ${out} delivered nothing the chain shows`), { clause: "no_output" });
      db.updateBuyback(id, { state: out === CIA_MINT ? "bought" : "leg1_done", legSigs, solSpent: budget.spend });
      pay = get; payAmount = got;
    }
    let burnSig = null;
    if (config.buybackDestination === "burn") burnSig = (await executor.burn({ owner, mint: CIA_MINT, amountRaw: got, decimals: CIA_FACTS.decimals })).signature;
    const row = db.updateBuyback(id, { state: "done", legSigs, burnSig, solSpent: budget.spend, ciaBought: got });
    const item = buybackItem(row);
    db.addEvent("buyback", item);
    log(`buyback: ${solString(budget.spend)} SOL → ${unitsString(got, CIA_FACTS.decimals)} $CIA${burnSig ? `, burned in ${burnSig}` : ""}`);
    return { ran: true, buyback: item };
  } catch (error) {
    db.updateBuyback(id, { state: legSigs.length ? "partial" : "failed", legSigs, detail: { clause: error?.clause ?? "error", error: String(error?.message ?? error).slice(0, 300) } });
    return { ran: false, why: `stopped: ${error?.message ?? error}`, legSigs };
  }
}

/** The contract's buyback item from a recorded run that completed (state done): its tx is the
 *  leg that bought the $CIA, its price SOL per $CIA; only the burn may be missing. */
export function buybackItem(row) {
  if (row.state !== "done" || !(row.legSigs?.length) || !row.cia_bought || BigInt(row.cia_bought) <= 0n) throw new Error("only a completed buyback is an item");
  const sol = BigInt(row.sol_spent ?? 0), cia = BigInt(row.cia_bought);
  return { t: row.t, solSpent: solString(sol), ciaBought: unitsString(cia, CIA_FACTS.decimals), price: priceString(sol, cia, CIA_FACTS.decimals),
    tx: row.legSigs[row.legSigs.length - 1], burnTx: row.burn_sig ?? null };
}
