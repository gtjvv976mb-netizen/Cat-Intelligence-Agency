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
 * THE MARKERS ARE SETTLED FROM THE CHAIN ALONE, on every indexer pass, at start, and before a
 * wallet's next transaction is refused for one (settle()): one never signed is abandoned after a
 * grace (nothing was sent, because sending comes after the signature is written); one signed is
 * looked up by its signature — landed, failed, or never to land: its own blockhash invalid (after
 * it was seen valid, or two minutes after signing, since a node answers false for a blockhash it
 * has not seen yet), the chain past the last valid height it was built with, and a last status
 * read with history still empty. One that landed stays open until the transaction is read back
 * into chain_txs, so nothing decided on the ledger goes before it has it; a protective
 * transaction (a stop's sell, money home) still goes, as it acts on what the chain says the
 * wallet holds. Only one marker can be in flight per wallet, in any process (a unique index; the
 * insert is the check). So a restart, a slow RPC or the owner's console can never buy or sell
 * twice: a second attempt waits for the chain to say what became of the first. The owner can ask
 * the chain about a stuck one at once (resolveIntent, the console's intent resolve). This is the extension agent's reviewed
 * fix (the book written in flight before the key signs), with the chain as the judge instead of
 * a pause for the owner.
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
/** A blockhash the node calls invalid is taken as expired without having been seen valid only this long after signing. */
export const EXPIRY_AFTER_SIGN_MS = 120_000;
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

  /* ── the chain's answers ── */
  const active = new Set();                 // markers this process is working on right now
  const blockhashOf = (txBase64) => VersionedTransaction.deserialize(Buffer.from(txBase64, "base64")).message.recentBlockhash;
  async function getTxOnce(signature) {
    try { return (await rpc.call("getTransaction", [signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 }])) ?? null; } catch { return null; }
  }
  async function getTx(signature) {
    for (let i = 0; i < 10; i++) {
      const tx = await getTxOnce(signature);
      if (tx) return tx;
      await sleep(pollMs);
    }
    return null;
  }
  /**
   * Whether a transaction can no longer land (true), may still land (false), or the chain cannot
   * say (null). isBlockhashValid answers false for a blockhash the answering node has not seen
   * yet (a node a slot behind, or a Jupiter blockhash newer than its confirmed bank), so a false
   * counts only once the same blockhash was seen valid, or once EXPIRY_AFTER_SIGN_MS have passed
   * since the signature (a blockhash lives about 60 to 90 seconds); and never while the chain's
   * block height is still at or under the last valid height the transaction was built with.
   * A marker from before blockhashes were kept goes by the block height alone.
   */
  async function expiredFor(it) {
    const blockhash = it.detail?.blockhash ?? null;
    const lastValid = Number.isFinite(Number(it.last_valid_block_height)) && it.last_valid_block_height !== null ? Number(it.last_valid_block_height) : null;
    let height = null;
    try { const h = await rpc.getBlockHeight(); if (Number.isFinite(h)) height = h; } catch { /* unknown */ }
    if (height !== null && lastValid !== null && height <= lastValid) return false;      /* the second guard */
    if (!blockhash) return height !== null && lastValid !== null ? height > lastValid + 8 : null;
    let valid = null;
    try { const r = await rpc.call("isBlockhashValid", [blockhash, { commitment: "confirmed" }]); const v = r?.value ?? r; if (v === true || v === false) valid = v; } catch { /* unknown */ }
    if (valid === null) return null;
    if (valid === true) {
      if (!it.detail?.seenValidAt) db.updateIntent(it.id, { detail: { seenValidAt: new Date(clock()).toISOString() } });
      return false;
    }
    const signedAt = Date.parse(it.detail?.signedAt ?? it.created_at);
    const seenValid = Boolean(db.getIntent(it.id)?.detail?.seenValidAt);
    return seenValid || (Number.isFinite(signedAt) && clock() - signedAt > EXPIRY_AFTER_SIGN_MS);
  }
  /** A signature's status with history (undefined when the RPC cannot say). */
  async function statusOf(signature) {
    try { return (await rpc.call("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]))?.value?.[0] ?? null; } catch { return undefined; }
  }
  const landedStatus = (s) => s && !s.err && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized");
  /**
   * The chain's last word before a marker is closed as expired: one more status read, with
   * history. "confirmed" or "failed" if it shows up after all, "expired" only if it is still
   * unseen, null when the RPC cannot say (the marker then stays open).
   */
  async function finalWord(signature) {
    const s = await statusOf(signature);
    if (s === undefined) return { outcome: null };
    if (s?.err) return { outcome: "failed", err: s.err };
    if (landedStatus(s)) return { outcome: "confirmed" };
    if (s === null) return { outcome: "expired" };
    return { outcome: null };                                   /* seen, but only processed: not yet */
  }
  /** A landed transaction into chain_txs, and the owner's ledger told. */
  async function readBack({ wallet, signature, tx }) {
    db.putChainTx({ address: wallet, signature, slot: tx.slot ?? 0, blockTime: tx.blockTime ?? null, err: Boolean(tx.meta?.err), tx });
    await onConfirmed({ wallet, signature, tx });
  }

  async function awaitConfirmed(id) {
    const deadline = clock() + confirmTimeoutMs;
    for (;;) {
      const it = db.getIntent(id);
      const expired = await expiredFor(it);
      let status = null;
      try { status = await rpc.getSignatureStatus(it.signature); } catch { status = undefined; }
      if (status?.err) return { outcome: "failed", err: status.err };
      if (landedStatus(status)) return { outcome: "confirmed" };
      if (status === null && expired === true) {
        const last = await finalWord(it.signature);
        if (last.outcome) return last;
      }
      if (clock() > deadline) return { outcome: "pending" };
      await sleep(pollMs);
    }
  }

  /** How long a marker never signed may stay open (another process may be building it). */
  const PREPARED_GRACE_MS = 120_000;

  /** Settle one open marker from the chain. Returns what became of it. */
  async function settleOne(it) {
    if (active.has(it.id)) return { id: it.id, state: it.state, waiting: true, why: "in progress here" };
    if (!it.signature) {
      if (clock() - Date.parse(it.updated_at ?? it.created_at) < PREPARED_GRACE_MS) return { id: it.id, state: it.state, waiting: true, why: "being built" };
      db.updateIntent(it.id, { state: "abandoned", detail: { settled: "never signed: nothing was sent" } });
      return { id: it.id, state: "abandoned" };
    }
    if (it.state !== "landed") {
      const expired = await expiredFor(it);
      const status = await statusOf(it.signature);
      if (status === undefined) return { id: it.id, state: it.state, waiting: true, why: "the RPC could not say" };
      if (status?.err) { db.updateIntent(it.id, { state: "failed", detail: { err: status.err, settled: true } }); return { id: it.id, state: "failed" }; }
      if (!landedStatus(status)) {
        if (status === null && expired === true) {
          const last = await finalWord(it.signature);
          if (last.outcome === "expired") { db.updateIntent(it.id, { state: "expired", detail: { settled: true } }); return { id: it.id, state: "expired" }; }
          if (last.outcome === "failed") { db.updateIntent(it.id, { state: "failed", detail: { err: last.err, settled: true } }); return { id: it.id, state: "failed" }; }
          if (last.outcome !== "confirmed") return { id: it.id, state: it.state, waiting: true, why: "the RPC could not say" };
        } else return { id: it.id, state: it.state, waiting: true, why: "not landed, and it may still land" };
      }
    }
    const tx = await getTxOnce(it.signature);
    if (!tx) {
      if (it.state !== "landed") db.updateIntent(it.id, { state: "landed", detail: { landedAt: new Date(clock()).toISOString() } });
      return { id: it.id, state: "landed", waiting: true, why: "landed; not yet read back" };
    }
    await readBack({ wallet: it.wallet, signature: it.signature, tx });
    db.updateIntent(it.id, { state: "confirmed", detail: { settled: true } });
    return { id: it.id, state: "confirmed" };
  }
  /** Settle every open marker (of one wallet, when named). Run on every indexer pass and at start. */
  async function settle({ wallet = null } = {}) {
    const out = [];
    for (const it of db.openIntents(wallet)) out.push(await settleOne(it));
    return out;
  }

  /**
   * The one path: marker → build (build() returns { txBase64, lastValidBlockHeight }, having run
   * its checks and simulation) → sign → signature on the marker (and `onSigned`, for a caller that
   * must record it too) → send → confirm → read back into chain_txs → close the marker.
   */
  async function submit({ owner, kind, mint = null, trigger = null, decisionId = null, detail = null, build, onSigned = null, protective = false }) {
    /* A marker already open for this wallet may have settled since: ask the chain first. */
    if (db.openIntents(owner.wallet).length) await settle({ wallet: owner.wallet });
    /* One that landed but is not read back yet holds everything that decides on the ledger (a
       buy, a sweep), never a protective transaction: a stop loss or money home sells or sends
       what the chain says the wallet holds, so it goes. */
    const landed = db.openIntents(owner.wallet).find((x) => x.state === "landed");
    if (landed && !protective) throw new ExecutionError("in_flight", `a ${landed.kind} of ${owner.wallet} landed (${landed.signature}) but is not read back yet: nothing that decides on the ledger goes until it is`);
    const id = randomUUID();
    if (!db.createIntent({ id, agentId: owner.kind === "agent" ? owner.number : null, wallet: owner.wallet, kind, mint, trigger, decisionId, detail })) {
      const open = db.openIntents(owner.wallet)[0];
      throw new ExecutionError("in_flight", `a ${open?.kind ?? "transaction"} of ${owner.wallet} is still in flight (${open?.signature ?? "not yet signed"})`);
    }
    active.add(id);
    let signed = null;
    try {
      const built = await build();
      const expected = messageBase64(built.txBase64);
      const blockhash = blockhashOf(built.txBase64);
      signed = sign(owner, built.txBase64, expected);
      db.updateIntent(id, { state: "signed", signature: signed.signature, lastValidBlockHeight: built.lastValidBlockHeight, detail: { ...(built.detail ?? {}), blockhash, signedAt: new Date(clock()).toISOString() } });
      if (onSigned) await onSigned(signed.signature);
      try { await rpc.sendTransaction(signed.signedBase64, { skipPreflight: true, maxRetries: 2 }); }
      catch (error) { log(`send of ${signed.signature} answered: ${error?.message ?? error} — waiting for the chain to say`); }
      db.updateIntent(id, { state: "sent" });
      const verdict = await awaitConfirmed(id);
      if (verdict.outcome === "failed") { db.updateIntent(id, { state: "failed", detail: { err: verdict.err } }); throw new ExecutionError("failed_on_chain", `${kind} ${signed.signature} failed on chain: ${JSON.stringify(verdict.err)}`, { signature: signed.signature }); }
      if (verdict.outcome === "expired") { db.updateIntent(id, { state: "expired" }); throw new ExecutionError("expired", `${kind} ${signed.signature} expired without landing`, { signature: signed.signature }); }
      if (verdict.outcome === "pending") throw new ExecutionError("ambiguous", `${kind} ${signed.signature} has no status after ${confirmTimeoutMs / 1000}s: it stays in flight until the chain says`, { signature: signed.signature });
      const tx = await getTx(signed.signature);
      if (!tx) {
        /* Landed, but not readable yet: the marker stays open (the wallet starts nothing else)
           until a settle pass reads it back into chain_txs. */
        db.updateIntent(id, { state: "landed" });
        log(`${kind} ${signed.signature} landed but could not be read back yet; the wallet waits for it`);
        return { intentId: id, signature: signed.signature, tx: null, event: null, landed: true };
      }
      await readBack({ wallet: owner.wallet, signature: signed.signature, tx });
      db.updateIntent(id, { state: "confirmed" });
      return { intentId: id, signature: signed.signature, tx, event: classifyTransaction(tx, { wallet: owner.wallet }) };
    } catch (error) {
      const cur = db.getIntent(id);
      if (cur?.state === "prepared") db.updateIntent(id, { state: "abandoned", detail: { clause: clauseOf(error), error: String(error?.message ?? error).slice(0, 300) } });
      throw error;
    } finally { active.delete(id); }
  }

  /** After a restart: the same settlement, for every open marker. */
  const recover = () => settle();

  /**
   * The owner's resolve of one stuck marker (intent.resolve): settled from the chain as any pass
   * would, never just deleted. A marker never signed is abandoned (nothing was sent: sending
   * comes after the signature is written). One the chain says landed but whose transaction
   * cannot be read back is closed only when the owner says so (acceptLanded), after the chain
   * says again that it landed; the indexer reads it when the RPC returns it. Anything the chain
   * has not decided stays open.
   */
  async function resolveIntent(id, { acceptLanded = false } = {}) {
    const it = db.getIntent(id);
    if (!it) return { resolved: false, why: `no marker ${id}` };
    if (!["prepared", "signed", "sent", "landed"].includes(it.state)) return { resolved: false, state: it.state, why: `already settled: ${it.state}` };
    if (active.has(it.id)) return { resolved: false, state: it.state, why: "this process is sending it right now" };
    if (!it.signature) {
      db.updateIntent(it.id, { state: "abandoned", detail: { settled: "never signed: nothing was sent", resolvedBy: "owner" } });
      return { resolved: true, state: "abandoned" };
    }
    const r = await settleOne(it);
    if (!r.waiting) return { resolved: true, state: r.state };
    if (r.state === "landed" && acceptLanded) {
      const s = await statusOf(it.signature);
      if (!landedStatus(s)) return { resolved: false, state: "landed", why: "the chain does not say it landed right now; it stays open" };
      db.updateIntent(it.id, { state: "confirmed", detail: { settled: true, unread: true, resolvedBy: "owner" } });
      return { resolved: true, state: "confirmed", unread: true, why: "closed as landed on the chain's word; the indexer reads it back when the RPC returns it" };
    }
    return { resolved: false, state: r.state, why: r.state === "landed" ? "it landed but cannot be read back yet: resolve it with acceptLanded to close it on the chain's word" : r.why };
  }

  /* ── Jupiter: pay one token, get another, only on an allowed pair ── */
  async function jupiterSwap({ owner, pay, get, amountRaw, slippageBps, maxImpactPct, allowedPairs, kind, mint = null, trigger = null, decisionId = null, protective = false, onSigned = null }) {
    assertMaySend(owner, { protective });
    return submit({ owner, kind, mint, trigger, decisionId, onSigned, protective, detail: { pay: pay.mint, get: get.mint, amountRaw: String(amountRaw) }, build: async () => {
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
    return submit({ owner, kind: "sell", mint, trigger, decisionId, protective: true, build: async () => {
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
  async function simple({ owner, kind, instructions, check, maxSpend, mayGain = false, protective = false, anyMode = false, detail = null, onSigned = null }) {
    assertMaySend(owner, { protective, anyMode });
    return submit({ owner, kind, detail, onSigned, protective, build: async () => {
      const wallet = owner.wallet;
      const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
      const tx = buildUnsignedTransaction({ payer: wallet, blockhash, computeUnitLimit: HQ_TX.simpleComputeUnits, priorityFeeLamports: HQ_TX.simplePriorityFeeLamports, instructions });
      check(tx.message);
      const txBase64 = toBase64(tx.serialize());
      const before = await rpc.getBalance(wallet);
      const sim = await rpc.simulateTransaction(txBase64, { addresses: [wallet] });
      /* An answer without the wallet's balance after is no answer: refused, never read as 0 or NaN. */
      const after = sim?.accounts?.[0]?.lamports;
      if (after === undefined || after === null || !Number.isFinite(Number(after)) || !Number.isFinite(Number(before)))
        throw new ExecutionError("simulation_unreadable", "the simulation did not return the wallet's balance: nothing is signed");
      checkSimulation(sim, { walletBefore: Number(before), walletAfter: Number(after), maxSpendLamports: Number(maxSpend), mayGain });
      return { txBase64, lastValidBlockHeight };
    } });
  }
  const FEE_ROOM = 200_000n;   // the most a one-signature transaction of HQ's own may cost in fees
  const RENT_ROOM = 2_100_000n;

  function wrap({ owner, lamports, onSigned = null }) {
    return simple({ owner, kind: "wrap", onSigned, instructions: wrapInstructions({ wallet: owner.wallet, lamports }), detail: { lamports: String(lamports) },
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
  function burn({ owner, mint, amountRaw, decimals, onSigned = null }) {
    return simple({ owner, kind: "burn", onSigned, instructions: burnInstructions({ owner: owner.wallet, mint, amountRaw, decimals }), detail: { amountRaw: String(amountRaw) },
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
  return Object.freeze({ submit, settle, recover, resolveIntent, inFlight, jupiterSwap, pumpBuy, pumpSell, readCurve, wrap, unwrap, transferToTreasury, burn, claimCreatorFees, assertMaySend });
}

export { TxRefused, SwapCheckError };
export const WSOL = Object.freeze({ mint: WSOL_MINT, program: TOKEN_PROGRAM, decimals: 9, symbol: "SOL" });
