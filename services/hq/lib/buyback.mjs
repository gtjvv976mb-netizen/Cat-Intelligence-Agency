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
import { associatedTokenAddress } from "../../../src/lib/tx.mjs";
import { TOKEN_PROGRAM } from "../../../bots/lib/verified.mjs";

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
 *   buyback      one per buyback whose $CIA was bought: the SOL it cost (read from the chain),
 *                at its $CIA leg — a buyback that stopped between its legs is listed once it is
 *                finished, not before
 * Money from anywhere else is the owner's own business and is not listed.
 */
export function treasuryFlows({ rows, treasury, agentWallets, buybacks = [] }) {
  const flows = [];
  let feeIn = 0n, profitIn = 0n, fundingOut = 0n, fundingIn = 0n, buybackSpent = 0n;
  const timeOf = new Map();
  for (const row of rows) {
    if (!row.tx) continue;
    if (row.block_time) timeOf.set(row.signature, new Date(row.block_time * 1000).toISOString());
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
    }
  }
  for (const b of buybacks) {
    if (!["bought", "done"].includes(b.state) || !(b.legSigs?.length)) continue;
    const tx = b.legSigs[b.legSigs.length - 1];
    const lamports = BigInt(b.sol_spent ?? 0);
    buybackSpent += lamports;
    flows.push({ t: b.detail?.boughtAt ?? timeOf.get(tx) ?? b.t, kind: "buyback", lamports, tx });
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

/** The SOL a set of the treasury's own transactions cost it (network fees included; its own
 *  token accounts' rent is not spent, it is kept), read from the chain: −Σ(cash + rent). */
export function solSpentOn({ db, treasury, signatures }) {
  const want = new Set(signatures.filter(Boolean));
  let spent = 0n, found = 0;
  for (const row of db.listChainTxs(treasury)) {
    if (!want.has(row.signature) || !row.tx) continue;
    const v = walletView(row.tx, treasury);
    if (!v) continue;
    spent += -(v.cashDelta + v.rentDelta);
    found++;
  }
  return { spent, complete: found === want.size };
}

/**
 * What became of a buyback transaction HQ signed: "landed" (read back into chain_txs, and it
 * succeeded), "failed" (the chain recorded it as failed, or its marker says it failed or expired
 * unseen), or "pending" (not known yet — it counts as spent until the chain says otherwise). The
 * indexer stores failed transactions too (their fee was paid), so a stored row is "landed" only
 * without an error.
 */
export function outcomeOf({ db, treasury, signature }) {
  if (!signature) return "failed";
  const row = db.getChainTx(treasury, signature);
  if (row) return row.err || row.tx?.meta?.err ? "failed" : "landed";
  const it = db.intentBySignature(signature);
  if (it && ["failed", "expired", "abandoned"].includes(it.state)) return "failed";
  return "pending";
}
const txOf = (db, treasury, signature) => db.getChainTx(treasury, signature)?.tx ?? null;
/** The signatures a buyback's SOL left the treasury in: its wrap, its legs, its burn, and every
 *  attempt that failed on chain (a failed transaction still pays its fee). */
const paidIn = (row, extra = []) => [row.detail?.wrapSig, ...(row.detail?.failedSigs ?? []), ...row.legSigs, ...extra];

/**
 * One scheduled run. Returns { ran, why, buyback? }. Everything is injected; nothing here reads
 * the environment or holds a key (the executor's treasury signer is wallet.mjs).
 *
 * A run does one of two things. If a buyback stopped before its $CIA was bought (or before its
 * burn), it is finished first, from what the chain says about each leg — never started over.
 * Otherwise a new one: revenue × share − what every earlier buyback spent (over all of them), held
 * to the per-run maximum and the treasury's cash above its reserve. A leg's signature is recorded
 * on the buyback the moment it is signed, and its SOL counts as spent until the chain says it
 * failed (a transaction the chain recorded with an error is failed, never landed). Each leg and
 * the burn are sent at most once a run. A second leg refused, or a burn failing, for
 * HQ_BUYBACK_LEG_TRIES runs stops that buyback (what it bought stays in the treasury, recorded)
 * so the ones after it can run; the owner's buyback.retry and buyback.abandon act on it.
 */
export async function runBuyback({ config, db, rpc, executor, treasuryReady, clock = () => Date.now(), log = () => {} }) {
  if (!config.buybackLive) return { ran: false, why: "HQ_BUYBACK_LIVE is not 1" };
  if (treasuryReady !== "ok") return { ran: false, why: `the treasury key is ${treasuryReady}` };
  if (!config.treasury) return { ran: false, why: "HQ_TREASURY_ADDRESS is not set" };
  if (!config.rpcUrl) return { ran: false, why: "no RPC of the owner's is set" };
  if (config.kill || db.getKv("kill") === true) return { ran: false, why: "the kill switch is on" };
  const treasury = config.treasury;
  const owner = { kind: "treasury", wallet: treasury };
  /* what the chain now says about anything the treasury has in flight */
  if (executor.settle) { try { await executor.settle({ wallet: treasury }); } catch (e) { log(`buyback settle: ${e?.message ?? e}`); } }
  const unfinished = db.unfinishedBuyback();
  if (!unfinished && !(config.buybackSharePct > 0)) return { ran: false, why: "HQ_BUYBACK_SHARE_PCT is 0" };
  const { facts, curve } = await readCia(rpc);
  assertCiaFacts(facts);
  const tokenFacts = async (mint) => {
    const read = await rpc.getMultipleAccounts([mint]);
    const d = describeMint(read.accounts[0], mint);
    return { mint, program: d.program, decimals: d.decimals, symbol: mint === CIA_MINT ? "CIA" : (d.metadataSymbol ?? mint.slice(0, 4)) };
  };
  if (unfinished) return finish({ config, db, executor, row: unfinished, tokenFacts, owner, log });

  const path = buybackPath({ curveQuote: curve?.quoteMint ?? null });
  const agentWallets = new Map(db.listAgents().map((a) => [a.wallet, a.id]));
  const flows = treasuryFlows({ rows: db.listChainTxs(treasury), treasury, agentWallets, buybacks: db.completedBuybacks() });
  const spent = db.buybackSpentTotal();
  const bal = await treasuryBalances({ rpc, treasury });
  const budget = buybackBudget({ revenueLamports: flows.revenue, spentLamports: spent, sharePct: config.buybackSharePct, maxPerRunLamports: config.buybackMaxPerRun,
    treasuryCashLamports: bal.sol, reserveLamports: config.treasuryReserve, minLamports: config.buybackMin });
  if (budget.spend === 0n) return { ran: false, why: budget.why, budget };
  const id = randomUUID();
  db.createBuyback({ id, state: "wrapping", detail: { path: path.legs, budget: { owed: String(budget.owed), spend: String(budget.spend) } } });
  try {
    /* only what is not wrapped already (a stopped run may have left wrapped SOL) */
    const wsolAta = associatedTokenAddress(treasury, WSOL_MINT, TOKEN_PROGRAM);
    const wrapped = rpc.getTokenAccountBalance ? await rpc.getTokenAccountBalance(wsolAta).catch(() => 0n) : 0n;
    if (wrapped < budget.spend) {
      const w = await executor.wrap({ owner, lamports: budget.spend - wrapped });
      db.updateBuyback(id, { detail: { wrapSig: w.signature } });
    }
  } catch (error) {
    db.updateBuyback(id, { state: "failed", detail: { clause: error?.clause ?? "error", error: String(error?.message ?? error).slice(0, 300) } });
    return { ran: false, why: `stopped before its first leg: ${error?.message ?? error}` };
  }
  const row = db.updateBuyback(id, { state: "started", detail: { legs: path.legs.map(([a, b]) => [a, b]), payRaw: String(budget.spend) } });
  return finish({ config, db, executor, row, tokenFacts, owner, log, budget });
}

/** Carry a buyback forward from where it stands, one leg at a time, from what the chain says. */
async function finish({ config, db, executor, row, tokenFacts, owner, log, budget = null }) {
  const treasury = config.treasury;
  const id = row.id;
  const tried = new Set();                  // what this run already sent: a leg, the burn
  let cur = db.getBuyback(id);
  const legs = cur.detail?.legs ?? cur.detail?.path ?? [];
  for (;;) {
    cur = db.getBuyback(id);
    const n = cur.legSigs.length;
    const lastSig = cur.legSigs[n - 1] ?? null;
    /* a signed leg: what became of it */
    if (n > 0 && ["leg1_sent", "leg2_sent"].includes(cur.state)) {
      const outcome = outcomeOf({ db, treasury, signature: lastSig });
      if (outcome === "pending") return { ran: false, why: `waiting for the chain on leg ${n} (${lastSig}); it counts as spent until the chain says it failed`, stopped: true };
      if (outcome === "failed") {
        const failedSigs = [...(cur.detail?.failedSigs ?? []), lastSig];
        if (n === 1) { db.updateBuyback(id, { state: "failed", legSigs: [], solSpent: 0n, detail: { failedLeg: lastSig, failedSigs } }); return { ran: false, why: `leg one (${lastSig}) failed or never landed: nothing was spent on it but its fee` }; }
        db.updateBuyback(id, { state: "leg1_done", legSigs: cur.legSigs.slice(0, n - 1), detail: { failedLeg: lastSig, failedSigs } });
        continue;
      }
      const tx = txOf(db, treasury, lastSig);
      const [, out] = legs[n - 1];
      const got = tokenDelta(tx, treasury, out);
      if (!(got > 0n)) { db.updateBuyback(id, { state: "stopped", detail: { clause: "no_output" } }); return { ran: false, why: `leg ${n} into ${out} delivered nothing the chain shows: stopped for the owner to look at` }; }
      if (out === CIA_MINT) {
        const boughtAt = tx?.blockTime ? new Date(tx.blockTime * 1000).toISOString() : db.iso();
        const { spent } = solSpentOn({ db, treasury, signatures: paidIn(cur) });
        db.updateBuyback(id, { state: "bought", ciaBought: got, solSpent: spent > 0n ? spent : cur.sol_spent, detail: { boughtAt, [`leg${n}Out`]: String(got) } });
        const item = buybackItem(db.getBuyback(id));
        log(`buyback ${id}: ${item.solSpent} SOL → ${item.ciaBought} $CIA`);
      } else db.updateBuyback(id, { state: "leg1_done", detail: { [`leg${n}Out`]: String(got) } });
      continue;
    }
    /* the next leg to send: each leg at most once a run (one that fails on chain waits for the next) */
    if (["started", "leg1_done"].includes(cur.state)) {
      const i = cur.state === "started" ? 0 : 1;
      if (i >= legs.length) return { ran: false, why: "nothing left to do" };
      if (tried.has(`leg${i}`)) return { ran: false, why: `leg ${i + 1} failed on chain this run; the next run tries it again`, stopped: true };
      tried.add(`leg${i}`);
      const [inMint, out] = legs[i];
      const pay = inMint === WSOL_MINT ? WSOL : await tokenFacts(inMint);
      const amountRaw = i === 0 ? BigInt(cur.detail?.payRaw ?? budget?.spend ?? 0) : BigInt(cur.detail?.[`leg${i}Out`] ?? 0);
      if (!(amountRaw > 0n)) return { ran: false, why: `leg ${i + 1} has nothing to pay with` };
      const get = await tokenFacts(out);
      const nextState = i === 0 ? "leg1_sent" : "leg2_sent";
      const record = (sig) => { const r = db.getBuyback(id); if (!r.legSigs.includes(sig)) db.updateBuyback(id, { state: nextState, legSigs: [...r.legSigs, sig], ...(i === 0 ? { solSpent: amountRaw } : {}) }); };
      try {
        const sent = await executor.jupiterSwap({ owner, pay, get, amountRaw, slippageBps: config.buybackSlippageBps, maxImpactPct: config.buybackMaxImpactPct,
          allowedPairs: buybackPath({ curveQuote: legs.length === 2 ? legs[0][1] : null }).allowedPairs, kind: "buyback_leg", mint: out, onSigned: record });
        if (sent?.signature) record(sent.signature);
        if (db.getBuyback(id).state !== nextState) { db.updateBuyback(id, { state: "stopped", detail: { clause: "no_signature" } }); return { ran: false, why: `leg ${i + 1} returned no signature: stopped for the owner to look at` }; }
      } catch (error) {
        /* signed: the signature is on the buyback, and the chain decides (at once when the
           executor already knows it failed or expired) */
        if (error?.detail?.signature) record(error.detail.signature);
        const now = db.getBuyback(id);
        if (now.state === nextState) {
          if (["failed_on_chain", "expired"].includes(error?.clause)) continue;
          return { ran: false, why: `leg ${i + 1} is in the chain's hands (${error?.clause ?? "error"}); the next run finishes it`, stopped: true };
        }
        if (i === 0) { db.updateBuyback(id, { state: "failed", detail: { clause: error?.clause ?? "error", error: String(error?.message ?? error).slice(0, 300) } }); return { ran: false, why: `leg 1 stopped before it was signed (${error?.clause ?? "error"})` }; }
        /* leg two refused before a signature (no route, too much impact): tried again on the next
           runs, and after HQ_BUYBACK_LEG_TRIES of them the buyback is stopped with what leg one
           bought left in the treasury, recorded, so the buybacks after it can run */
        const refusals = Number(now.detail?.leg2Refusals ?? 0) + 1;
        if (refusals >= config.buybackLegTries) {
          db.updateBuyback(id, { state: "stopped", detail: { lastError: error?.clause ?? "error", leg2Refusals: refusals, clause: "leg2_refused", held: { mint: inMint, raw: String(amountRaw) } } });
          log(`buyback ${id}: leg two refused ${refusals} times (${error?.clause ?? "error"}); stopped, ${amountRaw} raw ${inMint} left in the treasury`);
          return { ran: false, why: `leg 2 was refused ${refusals} times (${error?.clause ?? "error"}): the buyback is stopped, its ${inMint} kept in the treasury (buyback.retry takes it up again)` };
        }
        db.updateBuyback(id, { detail: { lastError: error?.clause ?? "error", leg2Refusals: refusals } });
        return { ran: false, why: `leg 2 stopped before it was signed (${error?.clause ?? "error"}); the next run tries it again (${refusals} of ${config.buybackLegTries})` };
      }
      continue;
    }
    /* bought: burn, if the policy says so, then done */
    if (cur.state === "bought") {
      if (config.buybackDestination !== "burn") { db.updateBuyback(id, { state: "done" }); continue; }
      const pending = cur.detail?.burnPending ?? null;
      if (pending) {
        const outcome = outcomeOf({ db, treasury, signature: pending });
        if (outcome === "pending") return { ran: false, why: `waiting for the chain on the burn (${pending})`, stopped: true };
        if (outcome === "landed") {
          const { spent } = solSpentOn({ db, treasury, signatures: paidIn(cur, [pending]) });
          db.updateBuyback(id, { state: "done", burnSig: pending, solSpent: spent > 0n ? spent : cur.sol_spent });
          continue;
        }
        /* the burn failed on chain: never published as the burn; its fee counts, and it is tried again */
        const failedSigs = [...(cur.detail?.failedSigs ?? []), pending];
        const burnFailures = Number(cur.detail?.burnFailures ?? 0) + 1;
        const { spent } = solSpentOn({ db, treasury, signatures: paidIn({ ...cur, detail: { ...cur.detail, failedSigs } }) });
        db.updateBuyback(id, { solSpent: spent > 0n ? spent : cur.sol_spent, detail: { burnPending: null, failedSigs, burnFailures } });
        if (burnFailures >= config.buybackLegTries) {
          db.updateBuyback(id, { state: "done", detail: { burnStopped: `the burn failed ${burnFailures} times on chain: the bought $CIA stays in the treasury` } });
          log(`buyback ${id}: the burn failed ${burnFailures} times; done without it, the $CIA kept in the treasury`);
          continue;
        }
        continue;
      }
      if (tried.has("burn")) return { ran: false, why: "the burn failed on chain this run; the next run tries it again", stopped: true };
      tried.add("burn");
      try {
        const burned = await executor.burn({ owner, mint: CIA_MINT, amountRaw: BigInt(cur.cia_bought), decimals: CIA_FACTS.decimals, onSigned: (sig) => db.updateBuyback(id, { detail: { burnPending: sig } }) });
        if (burned?.signature && !db.getBuyback(id).detail?.burnPending) db.updateBuyback(id, { detail: { burnPending: burned.signature } });
        if (!db.getBuyback(id).detail?.burnPending) return { ran: false, why: "the burn returned no signature: the next run looks again", stopped: true };
      } catch (error) {
        if (error?.detail?.signature) {
          db.updateBuyback(id, { detail: { burnPending: error.detail.signature } });
          if (["failed_on_chain", "expired"].includes(error?.clause)) continue;
        }
        return { ran: false, why: `the burn stopped (${error?.clause ?? "error"}); the next run finishes it`, stopped: true };
      }
      continue;
    }
    if (cur.state === "done") {
      /* on the stream once, finished (its burn's transaction on it, when the policy burns) */
      const item = buybackItem(cur);
      if (db.emitOnce(`buyback:${id}`)) db.addEvent("buyback", item);
      return { ran: true, buyback: item };
    }
    return { ran: false, why: `buyback ${id} is ${cur.state}` };
  }
}

/** The contract's buyback item from a run whose $CIA was bought: t when its $CIA leg landed, its
 *  tx that leg, solSpent the SOL that left the treasury for it (read from the chain, fees
 *  included), price SOL per $CIA; burnTx once the burn landed. */
export function buybackItem(row) {
  if (!["bought", "done"].includes(row.state) || !(row.legSigs?.length) || !row.cia_bought || BigInt(row.cia_bought) <= 0n) throw new Error("only a buyback whose $CIA was bought is an item");
  const sol = BigInt(row.sol_spent ?? 0), cia = BigInt(row.cia_bought);
  return { t: row.detail?.boughtAt ?? row.t, solSpent: solString(sol), ciaBought: unitsString(cia, CIA_FACTS.decimals), price: priceString(sol, cia, CIA_FACTS.decimals),
    tx: row.legSigs[row.legSigs.length - 1], burnTx: row.burn_sig ?? null };
}
