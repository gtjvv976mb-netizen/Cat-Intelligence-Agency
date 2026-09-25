/**
 * LIVE EXECUTION: BUILD, CHECK, SIMULATE, MARK IN FLIGHT, SIGN, SEND, CONFIRM, READ BACK.
 *
 * Nothing here runs in paper mode: paper fills are simulated from live quotes by the runtime
 * and sign nothing (test-hq-execution.mjs pins that the signer is never called). Live needs,
 * every time, HQ_LIVE=1 AND the agent's own mode live AND the owner's RPC (never the public
 * endpoint); the treasury needs HQ_BUYBACK_LIVE=1 and its key. wallet.mjs checks its switch
 * again before it signs.
 *
 * THE ORDER, for every transaction HQ sends:
 *   1. an in-flight marker (an "intent", state prepared) is written BEFORE anything is built
 *      or signed; while one is open for a wallet, that wallet starts nothing else;
 *   2. the transaction is built and passes its pre-sign check (Jupiter: checkSwapTransaction
 *      with a pair allowlist, the custody checks and the simulation guard; pump.fun: the bots'
 *      buy check or HQ's sell check and the simulation guard; HQ's own shapes: txcheck.mjs and a
 *      simulation);
 *   3. the wallet signs exactly the checked message, and the SIGNATURE is written to the marker
 *      (state signed) BEFORE the transaction is sent;
 *   4. it is sent, then confirmed or found expired or failed; the confirmed transaction is read
 *      back and handed to the indexer at once, so the ledger knows the fill before the next
 *      decision.
 * A restart finds the open markers (recover()): one never signed is abandoned (nothing was sent,
 * because sending comes after the signature is written); one signed is looked up on chain by
 * its signature — landed, failed, or, once its blockhash has expired, never to land. Until then
 * the wallet stays blocked. So a restart can never buy or sell twice: the second attempt waits
 * for the chain to say what became of the first. This is the extension agent's reviewed fix
 * (the book written in flight before the key signs), with the chain as the judge instead of a
 * pause for the owner.
 */
import { randomUUID } from "node:crypto";
import { VersionedTransaction } from "@solana/web3.js";
import {
  checkQuote, checkSwapTransaction, loadLookupTables, lookupTableKeysOf, checkWritableCustody, checkSafeAfter, SwapCheckError,
} from "../../../src/lib/jupiter-swap.mjs";
import { simulateTradeGuard } from "../../../src/lib/sim-guard.mjs";
import { buildUnsignedTransaction, createAtaIdempotentIx, toTransactionInstruction, associatedTokenAddress, toBase64, TxError } from "../../../src/lib/tx.mjs";
import { PUMPFUN_VENUE, decodeGlobalFeeRecipients, feeRecipientsForCurve } from "../../../vendor/executor/snipe-venue-pumpfun.mjs";
import { checkDevBuyMessage, checkCollectFeeMessage, checkSimulation, TxRefused } from "../../../bots/lib/txcheck.mjs";
import { collectCreatorFeeIx, creatorVault } from "../../../bots/cashcat/pumpfun.mjs";
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM, WSOL_MINT } from "../../../bots/lib/verified.mjs";
import {
  HQ_TX, checkPumpSellMessage, wrapInstructions, checkWrapMessage, unwrapInstructions, checkUnwrapMessage,
  transferInstructions, checkTransferMessage, burnInstructions, checkBurnMessage,
} from "./txcheck.mjs";
import { classifyTransaction } from "./classify.mjs";

export class ExecutionError extends Error {
  constructor(clause, message, detail = {}) { super(message); this.name = "ExecutionError"; this.clause = clause; this.detail = detail; }
}
const ZERO_KEY = "11111111111111111111111111111111";
export const CONFIRM_TIMEOUT_MS = 90_000;
export const SELL_TOLERANCE_FRAC = 0.10;          // the extension lane's sellToleranceFrac: the floor under the curve's own quote

const messageBase64 = (txBase64) => Buffer.from(VersionedTransaction.deserialize(Buffer.from(txBase64, "base64")).message.serialize()).toString("base64");
const clauseOf = (e) => e?.clause ?? e?.code ?? e?.name ?? "error";

export function createExecutor({
  config, db, rpc, jupiter, signers, clock = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = () => {}, onConfirmed = async () => {}, confirmTimeoutMs = CONFIRM_TIMEOUT_MS, pollMs = 1_000,
} = {}) {
  if (!signers || typeof signers.agent !== "function" || typeof signers.treasury !== "function") throw new Error("createExecutor needs signers.agent and signers.treasury");

  /* ── who may send at all ── */
  function assertMaySend(owner, { protective = false, anyMode = false } = {}) {
    if (!config.rpcUrl) throw new ExecutionError("no_rpc", "live needs the owner's RPC (HQ_RPC_URL): nothing is sent through the public endpoint");
    if (owner.kind === "agent") {
      if (!config.live) throw new ExecutionError("live_not_enabled", "HQ_LIVE is not 1: nothing is signed");
      if (!anyMode && owner.mode !== "live") throw new ExecutionError("agent_not_live", `agent ${owner.number} is in paper mode: nothing is signed`);
    } else if (owner.kind === "treasury") {
      if (!config.buybackLive) throw new ExecutionError("buyback_not_live", "HQ_BUYBACK_LIVE is not 1: the treasury signs nothing");
    } else throw new ExecutionError("owner", "unknown owner");
    if (!protective && (config.kill || db.getKv("kill") === true)) throw new ExecutionError("kill_switch", "the kill switch is on");
  }
  function sign(owner, txBase64, expectedMessageBase64) {
    return owner.kind === "agent"
      ? signers.agent(owner.number, { txBase64, expectedMessageBase64 })
      : signers.treasury({ txBase64, expectedMessageBase64 });
  }

  /* ── one transaction, start to finish ── */
  async function getTx(signature) {
    for (let i = 0; i < 10; i++) {
      let tx = null;
      try { tx = await rpc.call("getTransaction", [signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]); } catch { tx = null; }
      if (tx) return tx;
      await sleep(pollMs);
    }
    return null;
  }
  async function awaitConfirmed({ signature, lastValidBlockHeight }) {
    const deadline = clock() + confirmTimeoutMs;
    for (;;) {
      let status = null;
      try { status = await rpc.getSignatureStatus(signature); } catch { status = null; }
      if (status?.err) return { outcome: "failed", err: status.err };
      if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return { outcome: "confirmed" };
      let height = null;
      try { height = await rpc.getBlockHeight(); } catch { height = null; }
      if (Number.isFinite(height) && Number.isFinite(lastValidBlockHeight) && height > lastValidBlockHeight + 8) return { outcome: "expired" };
      if (clock() > deadline) return { outcome: "pending" };
      await sleep(pollMs);
    }
  }

  /**
   * The one path: marker → build (build() returns { txBase64, lastValidBlockHeight }, having run
   * its checks and simulation) → sign → signature on the marker → send → confirm → read back.
   */
  async function submit({ owner, kind, mint = null, trigger = null, decisionId = null, detail = null, build }) {
    const open = db.openIntents(owner.wallet);
    if (open.length) throw new ExecutionError("in_flight", `a ${open[0].kind} of ${owner.wallet} is still in flight (${open[0].signature ?? "not yet signed"})`);
    const id = randomUUID();
    db.createIntent({ id, agentId: owner.kind === "agent" ? owner.number : null, wallet: owner.wallet, kind, mint, trigger, decisionId, detail });
    let signed = null;
    try {
      const built = await build();
      const expected = messageBase64(built.txBase64);
      signed = sign(owner, built.txBase64, expected);
      db.updateIntent(id, { state: "signed", signature: signed.signature, lastValidBlockHeight: built.lastValidBlockHeight, detail: built.detail ?? undefined });
      try { await rpc.sendTransaction(signed.signedBase64, { skipPreflight: true, maxRetries: 2 }); }
      catch (error) { log(`send of ${signed.signature} answered: ${error?.message ?? error} — waiting for the chain to say`); }
      db.updateIntent(id, { state: "sent" });
      const verdict = await awaitConfirmed({ signature: signed.signature, lastValidBlockHeight: built.lastValidBlockHeight });
      if (verdict.outcome === "failed") { db.updateIntent(id, { state: "failed", detail: { err: verdict.err } }); throw new ExecutionError("failed_on_chain", `${kind} ${signed.signature} failed on chain: ${JSON.stringify(verdict.err)}`, { signature: signed.signature }); }
      if (verdict.outcome === "expired") { db.updateIntent(id, { state: "expired" }); throw new ExecutionError("expired", `${kind} ${signed.signature} expired without landing`, { signature: signed.signature }); }
      if (verdict.outcome === "pending") throw new ExecutionError("ambiguous", `${kind} ${signed.signature} has no status after ${confirmTimeoutMs / 1000}s: it stays in flight until the chain says`, { signature: signed.signature });
      const tx = await getTx(signed.signature);
      db.updateIntent(id, { state: "confirmed" });
      if (tx) await onConfirmed({ wallet: owner.wallet, signature: signed.signature, tx });
      return { intentId: id, signature: signed.signature, tx, event: tx ? classifyTransaction(tx, { wallet: owner.wallet }) : null };
    } catch (error) {
      const cur = db.getIntent(id);
      if (cur?.state === "prepared") db.updateIntent(id, { state: "abandoned", detail: { clause: clauseOf(error), error: String(error?.message ?? error).slice(0, 300) } });
      throw error;
    }
  }

  /** After a restart: settle every marker left open, from the chain alone. */
  async function recover() {
    const settled = [];
    for (const it of db.openIntents()) {
      if (!it.signature) { db.updateIntent(it.id, { state: "abandoned", detail: { recovered: "never signed: nothing was sent" } }); settled.push({ id: it.id, state: "abandoned" }); continue; }
      let status = null;
      try { status = (await rpc.call("getSignatureStatuses", [[it.signature], { searchTransactionHistory: true }]))?.value?.[0] ?? null; } catch { status = null; }
      if (status?.err) { db.updateIntent(it.id, { state: "failed", detail: { err: status.err, recovered: true } }); settled.push({ id: it.id, state: "failed" }); continue; }
      if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) {
        const tx = await getTx(it.signature);
        if (tx) await onConfirmed({ wallet: it.wallet, signature: it.signature, tx });
        db.updateIntent(it.id, { state: "confirmed", detail: { recovered: true } });
        settled.push({ id: it.id, state: "confirmed" });
        continue;
      }
      let height = null;
      try { height = await rpc.getBlockHeight(); } catch { height = null; }
      if (Number.isFinite(height) && Number.isFinite(it.last_valid_block_height) && height > it.last_valid_block_height + 8) {
        db.updateIntent(it.id, { state: "expired", detail: { recovered: true } });
        settled.push({ id: it.id, state: "expired" });
      } else settled.push({ id: it.id, state: it.state, waiting: true });
    }
    return settled;
  }

  /* ── Jupiter: pay one token, get another, only on an allowed pair ── */
  async function jupiterSwap({ owner, pay, get, amountRaw, slippageBps, maxImpactPct, allowedPairs, kind, mint = null, trigger = null, decisionId = null, protective = false }) {
    assertMaySend(owner, { protective });
    return submit({ owner, kind, mint, trigger, decisionId, detail: { pay: pay.mint, get: get.mint, amountRaw: String(amountRaw) }, build: async () => {
      const wallet = owner.wallet;
      const payAta = associatedTokenAddress(wallet, pay.mint, pay.program);
      const getAta = associatedTokenAddress(wallet, get.mint, get.program);
      const held = await rpc.getTokenAccountBalance(payAta);
      if (held < BigInt(amountRaw)) throw new ExecutionError("balance_short", `the wallet holds ${held} raw ${pay.symbol}, under the ${amountRaw} this swap pays`);
      const quoteArgs = { inputMint: pay.mint, outputMint: get.mint, amountRaw: String(amountRaw), slippageBps, slippageCapBps: slippageBps, maxPriceImpactPct: maxImpactPct };
      const raw = await jupiter.quote({ inputMint: pay.mint, outputMint: get.mint, amountRaw: String(amountRaw), slippageBps, priority: "live" });
      const q = checkQuote(raw, quoteArgs);
      const built = await jupiter.swapTransaction({ quote: raw, wallet, priorityFeeLamports: HQ_TX.priorityFeeLamports, priority: "live" });
      if (typeof built?.swapTransaction !== "string" || !built.swapTransaction) throw new SwapCheckError("malformed", "Jupiter returned no transaction");
      const txBase64 = built.swapTransaction;
      const tables = await loadLookupTables(rpc, lookupTableKeysOf(txBase64));
      const checked = checkSwapTransaction({ txBase64, wallet, inputMint: pay.mint, outputMint: get.mint, inputProgram: pay.program, outputProgram: get.program,
        amountRaw: String(amountRaw), quote: raw, slippageCapBps: slippageBps, lookupTables: tables, maxPriorityFeeLamports: HQ_TX.priorityFeeLamports, allowedPairs });
      const writable = await rpc.getMultipleAccounts(checked.writableAddresses);
      checkWritableCustody({ wallet, writableAddresses: checked.writableAddresses, accounts: writable.accounts ?? [], allowed: [payAta, getAta] });
      /* The guard reads the paid token as the "quote" and the bought token as the "base": exactly
         the amount paid, at least the quote's floor delivered, SOL moving by fee and rent only. */
      const guard = await simulateTradeGuard({ rpc, txBase64, wallet, ata: getAta, mint: get.mint, side: "buy",
        expected: { baseOutRaw: q.minOutRaw, maxQuoteInRaw: BigInt(amountRaw) }, quote: { mint: pay.mint, ata: payAta, decimals: pay.decimals, symbol: pay.symbol } });
      if (-BigInt(guard.quoteDeltaRaw) !== BigInt(amountRaw)) throw new SwapCheckError("exact_input", `the simulation pays ${-BigInt(guard.quoteDeltaRaw)}, not exactly the ${amountRaw} asked`);
      checkSafeAfter(guard.post?.[1] ?? null, { wallet, mint: get.mint, label: get.symbol });
      checkSafeAfter(guard.post?.[2] ?? null, { wallet, mint: pay.mint, label: pay.symbol });
      return { txBase64, lastValidBlockHeight: Number(built.lastValidBlockHeight), detail: { quotedOut: String(q.outRaw), minOut: String(q.minOutRaw), impactPct: q.impactPct } };
    } });
  }

  /* ── pump.fun, on the bonding curve ── */
  function pickRecipient(list, label) {
    const hit = (list ?? []).find((k) => typeof k === "string" && k !== ZERO_KEY);
    if (!hit) throw new TxError("prepare_failed", `the Global account names no ${label}`);
    return hit;
  }
  async function readCurve(mint) {
    const read = await rpc.getMultipleAccounts(PUMPFUN_VENUE.accountsFor(mint).map(String), { commitment: "confirmed" });
    const [curveAcc, globalAcc, mintAcc] = read.accounts ?? [];
    if (!curveAcc?.data || !globalAcc?.data || !mintAcc?.owner) throw new ExecutionError("curve_unreadable", "the curve, Global or mint account could not be read");
    const curve = PUMPFUN_VENUE.curveFromAccount(curveAcc, { feeBps: Number(PUMPFUN_VENUE.feeObservation?.totalFeeBps), mint });
    return { read, curve, global: globalAcc, tokenProgram: String(mintAcc.owner) };
  }

  /** A buy on the curve at a ceiling the caller planned (planSnipeCeiling): baseOutRaw for at
   *  most maxQuoteInRaw lamports, checked by the bots' own buy check and simulated. */
  async function pumpBuy({ owner, mint, baseOutRaw, maxQuoteInRaw, trigger = "strategy", decisionId = null }) {
    assertMaySend(owner);
    return submit({ owner, kind: "buy", mint, trigger, decisionId, detail: { baseOutRaw: String(baseOutRaw), maxQuoteInRaw: String(maxQuoteInRaw) }, build: async () => {
      const wallet = owner.wallet;
      const { read, curve, global, tokenProgram } = await readCurve(mint);
      if (curve.complete) throw new ExecutionError("graduated", "the curve has graduated: buy through Jupiter or not at all");
      if (curve.quoteIsSol !== true) throw new ExecutionError("quote_not_sol", "the curve is not quoted in SOL");
      if (tokenProgram !== TOKEN_2022_PROGRAM) throw new ExecutionError("token_program", "only Token-2022 pump.fun coins pass the buy check");
      const sets = decodeGlobalFeeRecipients(global.data);
      const ata = associatedTokenAddress(wallet, mint, tokenProgram);
      const ix = PUMPFUN_VENUE.buyIx({ mint, user: wallet, curve, curveReadSlot: read.slot, buildingForSlot: read.slot,
        feeRecipient: pickRecipient(feeRecipientsForCurve(curve, sets), "fee recipient"), buybackFeeRecipient: pickRecipient(sets.buybackFeeRecipients, "buyback fee recipient"),
        baseTokenProgram: tokenProgram, quoteTokenProgram: TOKEN_PROGRAM, associatedBaseUser: ata, associatedBaseUserOwner: wallet, globalFeeRecipients: sets,
        amountRaw: BigInt(baseOutRaw), maxQuoteInRaw: BigInt(maxQuoteInRaw) });
      const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
      const tx = buildUnsignedTransaction({ payer: wallet, blockhash, computeUnitLimit: HQ_TX.pumpComputeUnits, priorityFeeLamports: HQ_TX.priorityFeeLamports,
        instructions: [createAtaIdempotentIx({ payer: wallet, ata, owner: wallet, mint, tokenProgram }), toTransactionInstruction(ix)] });
      checkDevBuyMessage(tx.message, { wallet, mint, maxSpendLamports: BigInt(maxQuoteInRaw) });
      const txBase64 = toBase64(tx.serialize());
      await simulateTradeGuard({ rpc, txBase64, wallet, ata, mint, side: "buy", expected: { baseOutRaw: BigInt(baseOutRaw), maxQuoteInRaw: BigInt(maxQuoteInRaw) } });
      return { txBase64, lastValidBlockHeight };
    } });
  }

  /** A sell on the curve of what the wallet holds (at most `qtyRaw`), at a floor under the
   *  curve's own quote. A graduated coin is refused here; the caller sells it through Jupiter. */
  async function pumpSell({ owner, mint, qtyRaw, trigger, decisionId = null }) {
    assertMaySend(owner, { protective: true });
    return submit({ owner, kind: "sell", mint, trigger, decisionId, build: async () => {
      const wallet = owner.wallet;
      const { read, curve, global, tokenProgram } = await readCurve(mint);
      if (curve.complete) throw new ExecutionError("graduated", "the curve has graduated: sell through Jupiter");
      const ata = associatedTokenAddress(wallet, mint, tokenProgram);
      const held = await rpc.getTokenAccountBalance(ata);
      if (held <= 0n) throw new ExecutionError("nothing_held", "the wallet holds none of it");
      const amountRaw = held < BigInt(qtyRaw) ? held : BigInt(qtyRaw);
      const quoted = BigInt(PUMPFUN_VENUE.sellExactIn(curve, amountRaw)?.quoteOutRaw ?? 0n);
      const minQuoteOutRaw = quoted - (quoted * BigInt(Math.round(SELL_TOLERANCE_FRAC * 10_000))) / 10_000n;
      const sets = decodeGlobalFeeRecipients(global.data);
      const ix = PUMPFUN_VENUE.sellIx({ mint, user: wallet, curve, curveReadSlot: read.slot, buildingForSlot: read.slot,
        feeRecipient: pickRecipient(feeRecipientsForCurve(curve, sets), "fee recipient"), buybackFeeRecipient: pickRecipient(sets.buybackFeeRecipients, "buyback fee recipient"),
        baseTokenProgram: tokenProgram, quoteTokenProgram: TOKEN_PROGRAM, associatedBaseUser: ata, associatedBaseUserOwner: wallet, globalFeeRecipients: sets, amountRaw, minQuoteOutRaw });
      const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
      const tx = buildUnsignedTransaction({ payer: wallet, blockhash, computeUnitLimit: HQ_TX.pumpComputeUnits, priorityFeeLamports: HQ_TX.priorityFeeLamports, instructions: [toTransactionInstruction(ix)] });
      checkPumpSellMessage(tx.message, { wallet, mint, maxAmountRaw: held, minQuoteOutRaw, tokenProgram });
      const txBase64 = toBase64(tx.serialize());
      await simulateTradeGuard({ rpc, txBase64, wallet, ata, mint, side: "sell", expected: { qtyRaw: amountRaw, minQuoteOutRaw } });
      return { txBase64, lastValidBlockHeight, detail: { amountRaw: String(amountRaw), minQuoteOutRaw: String(minQuoteOutRaw) } };
    } });
  }

  /* ── HQ's own shapes: build, check, simulate on the wallet's lamports ── */
  async function simple({ owner, kind, instructions, check, maxSpend, mayGain = false, protective = false, anyMode = false, detail = null }) {
    assertMaySend(owner, { protective, anyMode });
    return submit({ owner, kind, detail, build: async () => {
      const wallet = owner.wallet;
      const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
      const tx = buildUnsignedTransaction({ payer: wallet, blockhash, computeUnitLimit: HQ_TX.simpleComputeUnits, priorityFeeLamports: HQ_TX.simplePriorityFeeLamports, instructions });
      check(tx.message);
      const txBase64 = toBase64(tx.serialize());
      const before = await rpc.getBalance(wallet);
      const sim = await rpc.simulateTransaction(txBase64, { addresses: [wallet] });
      checkSimulation(sim, { walletBefore: Number(before), walletAfter: Number(sim?.accounts?.[0]?.lamports), maxSpendLamports: Number(maxSpend), mayGain });
      return { txBase64, lastValidBlockHeight };
    } });
  }
  const FEE_ROOM = 200_000n;   // the most a one-signature transaction of HQ's own may cost in fees
  const RENT_ROOM = 2_100_000n;

  function wrap({ owner, lamports }) {
    return simple({ owner, kind: "wrap", instructions: wrapInstructions({ wallet: owner.wallet, lamports }), detail: { lamports: String(lamports) },
      check: (m) => checkWrapMessage(m, { wallet: owner.wallet, lamports }), maxSpend: BigInt(lamports) + FEE_ROOM + RENT_ROOM });
  }
  function unwrap({ owner, protective = false, anyMode = false }) {
    return simple({ owner, kind: "unwrap", instructions: unwrapInstructions({ wallet: owner.wallet }), protective, anyMode,
      check: (m) => checkUnwrapMessage(m, { wallet: owner.wallet }), maxSpend: FEE_ROOM, mayGain: true });
  }
  /** SOL to the agency treasury, and only there, with the memo that says what it is. */
  function transferToTreasury({ owner, lamports, memo }) {
    const treasury = config.treasury;
    /* Money going home to the treasury is never blocked by the kill switch or the agent's mode; it
       still needs HQ_LIVE=1, because wallet.mjs signs nothing without it. */
    return simple({ owner, kind: "transfer", instructions: transferInstructions({ wallet: owner.wallet, treasury, lamports, memo }), protective: true, anyMode: true, detail: { lamports: String(lamports), memo },
      check: (m) => checkTransferMessage(m, { wallet: owner.wallet, treasury, lamports, memo }), maxSpend: BigInt(lamports) + FEE_ROOM });
  }
  function burn({ owner, mint, amountRaw, decimals }) {
    return simple({ owner, kind: "burn", instructions: burnInstructions({ owner: owner.wallet, mint, amountRaw, decimals }), detail: { amountRaw: String(amountRaw) },
      check: (m) => checkBurnMessage(m, { owner: owner.wallet, mint, amountRaw, decimals }), maxSpend: FEE_ROOM });
  }
  /** Claim the agent wallet's pump.fun creator fees: CashCat's verified claim, the bots' check. */
  async function claimCreatorFees({ owner, minLamports }) {
    assertMaySend(owner);
    const vault = creatorVault(owner.wallet);
    const acc = await rpc.getMultipleAccounts([vault]);
    const lamports = BigInt(acc.accounts?.[0]?.lamports ?? 0);
    const dataLen = acc.accounts?.[0]?.data ? Buffer.from(acc.accounts[0].data[0], "base64").length : 0;
    if (!acc.accounts?.[0]) return { claimed: false, why: "the creator vault does not exist (no trade of a coin this wallet created)" };
    const rent = BigInt(await rpc.call("getMinimumBalanceForRentExemption", [dataLen]));
    const claimable = lamports - rent;
    if (claimable < BigInt(minLamports)) return { claimed: false, why: `${claimable > 0n ? claimable : 0n} lamports waiting, under the ${minLamports} threshold`, claimable };
    const result = await simple({ owner, kind: "fee_claim", instructions: [collectCreatorFeeIx({ creator: owner.wallet })], detail: { claimable: String(claimable) },
      check: (m) => checkCollectFeeMessage(m, { wallet: owner.wallet }), maxSpend: 0n, mayGain: true });
    return { claimed: true, claimable, ...result };
  }

  const inFlight = (wallet) => db.openIntents(wallet).length > 0;
  return Object.freeze({ submit, recover, inFlight, jupiterSwap, pumpBuy, pumpSell, readCurve, wrap, unwrap, transferToTreasury, burn, claimCreatorFees, assertMaySend });
}

export { TxRefused, SwapCheckError };
export const WSOL = Object.freeze({ mint: WSOL_MINT, program: TOKEN_PROGRAM, decimals: 9, symbol: "SOL" });
