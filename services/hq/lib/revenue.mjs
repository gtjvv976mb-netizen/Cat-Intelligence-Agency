/**
 * THE AGENCY'S REVENUE: CREATOR FEES CLAIMED, AND WHAT GOES BACK TO THE TREASURY.
 *
 * CREATOR FEES. pump.fun pays a coin's creator fee into a vault per CREATOR,
 * PDA(["creator-vault", creator]), and only that creator can claim it (collect_creator_fee,
 * signed by the creator). So HQ claims, on HQ_FEE_CLAIM_CRON, for every LIVE agent whose own
 * wallet is a coin's creator: the vault is read, and when it holds at least HQ_FEE_CLAIM_MIN_SOL
 * above its rent the claim is built with CashCat's verified builder, passes the bots' own
 * pre-sign check (checkCollectFeeMessage) and a simulation that must show the wallet gaining,
 * and is signed by the agent's key. A coin CashCat launched was created by CashCat's wallet: its
 * fees are CashCat's to claim, and the bot claims them (bots/cashcat/launch.mjs collectFees).
 * Fees are their own line in the ledger and are never trading P&L.
 *
 * SWEEPS (HQ_SWEEP=1, off by default). On HQ_SWEEP_CRON each live agent sends the treasury what
 * it has claimed in fees and not yet swept (memo cia-hq:fee_sweep:NNN), then its realized trading
 * profit not yet swept (cia-hq:profit_sweep:NNN), keeping HQ_AGENT_RESERVE_SOL. Those two memos
 * are the "new agency revenue" the $CIA buyback policy takes its share of.
 *
 * WITHDRAWALS (the owner's command only): SOL from an agent wallet to the treasury, memo
 * cia-hq:withdraw:NNN. Every transfer HQ builds goes to HQ_TREASURY_ADDRESS and nowhere else:
 * txcheck.mjs refuses any other destination before a signature.
 */
import { memoFor } from "./classify.mjs";
import { buildLedger } from "./ledger.mjs";
import { associatedTokenAddress } from "../../../src/lib/tx.mjs";
import { TOKEN_PROGRAM, WSOL_MINT } from "../../../bots/lib/verified.mjs";
import { solString } from "./amounts.mjs";

const ownerOf = (agent) => ({ kind: "agent", number: agent.id, wallet: agent.wallet, mode: agent.mode });
const liveAgents = (db) => db.listAgents().filter((a) => a.mode === "live" && a.status !== "retired");

export async function runFeeClaims({ config, db, executor, log = () => {} }) {
  if (!config.live) return [{ why: "HQ_LIVE is not 1: nothing is claimed" }];
  if (config.kill || db.getKv("kill") === true) return [{ why: "the kill switch is on" }];
  const out = [];
  for (const agent of liveAgents(db)) {
    try {
      const r = await executor.claimCreatorFees({ owner: ownerOf(agent), minLamports: config.feeClaimMin });
      out.push({ agentId: agent.id, claimed: r.claimed, why: r.why ?? null, signature: r.signature ?? null });
      if (r.claimed) log(`agent ${agent.id}: claimed creator fees in ${r.signature}`);
    } catch (e) { out.push({ agentId: agent.id, claimed: false, why: e.message }); }
  }
  return out;
}

/** What an agent owes the treasury from its ledger: fees and profit not yet swept. Pure. */
export function sweepDue(ledger) {
  let feeSwept = 0n, profitSwept = 0n;
  for (const t of ledger.transfers) {
    if (t.kind !== "withdrawal" || !t.memo) continue;
    if (t.memo.kind === "fee_sweep") feeSwept += t.lamports;
    if (t.memo.kind === "profit_sweep") profitSwept += t.lamports;
  }
  const fee = ledger.feesClaimed - feeSwept;
  const profit = ledger.realized - profitSwept;
  return { fee: fee > 0n ? fee : 0n, profit: profit > 0n ? profit : 0n, feeSwept, profitSwept };
}

/** Move native SOL out: unwrap first when the native balance cannot cover it. */
async function ensureNative({ executor, rpc, agent, lamports }) {
  const native = BigInt(await rpc.getBalance(agent.wallet));
  if (native >= lamports + 1_000_000n) return;
  const wrapped = await rpc.getTokenAccountBalance(associatedTokenAddress(agent.wallet, WSOL_MINT, TOKEN_PROGRAM));
  if (wrapped > 0n) await executor.unwrap({ owner: ownerOf(agent), protective: true, anyMode: true });
}

export async function runSweeps({ config, db, rpc, executor, eventsFor, log = () => {} }) {
  if (!config.sweep) return [{ why: "HQ_SWEEP is not 1" }];
  if (!config.live) return [{ why: "HQ_LIVE is not 1" }];
  if (!config.treasury) return [{ why: "HQ_TREASURY_ADDRESS is not set" }];
  if (config.kill || db.getKv("kill") === true) return [{ why: "the kill switch is on" }];
  const out = [];
  for (const agent of liveAgents(db)) {
    try {
      /* a sweep is sized from the ledger: none while a transaction of the wallet is in flight or
         landed but not yet read back into it */
      if (executor.inFlight?.(agent.wallet)) { out.push({ agentId: agent.id, why: "a transaction of its wallet is in flight or not yet read back" }); continue; }
      const ledger = buildLedger(eventsFor(agent, "live"));
      const due = sweepDue(ledger);
      const spendable = ledger.cash - config.agentReserve - 200_000n;
      for (const [kind, amount] of [["fee_sweep", due.fee], ["profit_sweep", due.profit]]) {
        const send = amount < spendable ? amount : spendable;
        if (send < config.sweepMin) continue;
        await ensureNative({ executor, rpc, agent, lamports: send });
        const r = await executor.transferToTreasury({ owner: ownerOf(agent), lamports: send, memo: memoFor(kind, agent.id) });
        out.push({ agentId: agent.id, kind, lamports: String(send), signature: r.signature });
        log(`agent ${agent.id}: swept ${solString(send)} SOL (${kind}) to the treasury in ${r.signature}`);
        break;          /* one transfer a run: the next run reads the ledger again */
      }
    } catch (e) { out.push({ agentId: agent.id, why: e.message }); }
  }
  return out;
}

/** The owner's withdrawal of an agent's SOL to the treasury ("all" leaves the rent floor). */
export async function withdrawToTreasury({ config, db, rpc, executor, agent, lamports = null }) {
  if (!config.treasury) throw new Error("HQ_TREASURY_ADDRESS is not set: HQ sends SOL nowhere else");
  const native = BigInt(await rpc.getBalance(agent.wallet));
  const wrapped = await rpc.getTokenAccountBalance(associatedTokenAddress(agent.wallet, WSOL_MINT, TOKEN_PROGRAM));
  const available = native + wrapped - 2_000_000n;
  const amount = lamports === null ? available : BigInt(lamports);
  if (amount <= 0n || amount > available) throw new Error(`${solString(amount)} SOL asked; ${solString(available > 0n ? available : 0n)} SOL can leave (the wallet keeps its fee room)`);
  await ensureNative({ executor, rpc, agent, lamports: amount });
  return executor.transferToTreasury({ owner: ownerOf(agent), lamports: amount, memo: memoFor("withdraw", agent.id) });
}
