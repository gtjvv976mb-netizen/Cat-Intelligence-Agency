/**
 * THE TRANSACTIONS HQ BUILDS ITSELF, AND THE CHECK EACH MUST PASS BEFORE A SIGNATURE.
 *
 * The trades reuse the checks that already exist: a Jupiter swap goes through
 * src/lib/jupiter-swap.mjs checkSwapTransaction (with HQ's pair allowlist), a pump.fun buy
 * through bots/lib/txcheck.mjs checkDevBuyMessage (exactly one idempotent account create and one
 * buy_v2 of this mint, for this wallet, under its spend ceiling), a creator-fee claim through
 * checkCollectFeeMessage. This file adds the shapes nothing else builds — each read back from the
 * COMPILED message the signature will cover, never from the objects that built it, and refused
 * by clause (TxRefused) unless it is exactly:
 *
 *   pumpSell   fee payer and only signer = the wallet; at most two compute-budget instructions;
 *              one pump.fun sell_v2 of this mint, by this wallet, out of its own account, for at
 *              most the tokens it holds and at least the floor planned
 *   wrap       …; one idempotent create of the wallet's own wrapped-SOL account; one System
 *              transfer of exactly the planned lamports from the wallet into it; one SyncNative
 *   unwrap     …; one CloseAccount of the wallet's own wrapped-SOL account, back to the wallet
 *   transfer   …; one System transfer of exactly the planned lamports from the wallet to the
 *              agency TREASURY (HQ_TREASURY_ADDRESS) and nowhere else; one memo saying what it is
 *   burn       …; one Token-2022 BurnChecked of exactly the planned $CIA from the treasury's own
 *              $CIA account
 * No other program, no other signer, no lookup table.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { readMessage, decodeComputeBudget } from "../../../bots/lib/solana.mjs";
import { TxRefused, MAX_COMPUTE_UNITS, MAX_PRIORITY_MICROLAMPORTS } from "../../../bots/lib/txcheck.mjs";
import { COMPUTE_BUDGET_PROGRAM, PUMPFUN_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, ATA_PROGRAM, WSOL_MINT } from "../../../bots/lib/verified.mjs";
import { decodeBuyIx } from "../../../vendor/executor/snipe-venue-pumpfun.mjs";
import { associatedTokenAddress, createAtaIdempotentIx } from "../../../src/lib/tx.mjs";
import { MEMO_PROGRAMS, parseHqMemo } from "./classify.mjs";

export const MEMO_PROGRAM = MEMO_PROGRAMS[0];
/** HQ's transactions: a compute limit and a priority fee. Trades pay the extension agent's
 *  AGENT_PRIORITY_FEE_LAMPORTS (50,000 lamports), which over a pump.fun trade's 260,000 units is
 *  192,308 micro-lamports a unit; HQ's own small transactions (wrap, unwrap, transfer, burn, fee
 *  claim) pay 10,000 over 60,000 units, 166,667 a unit. Both stay under the bots' 200,000
 *  micro-lamport-per-unit fence, which is not widened (test-hq-execution.mjs pins it). */
export const HQ_TX = Object.freeze({
  priorityFeeLamports: 50_000,
  pumpComputeUnits: 260_000,
  simplePriorityFeeLamports: 10_000,
  simpleComputeUnits: 60_000,
});

const refuse = (clause, message) => { throw new TxRefused(clause, message); };
function read(message) {
  try { return readMessage(message); } catch (e) { return refuse(e.clause ?? "message", e.message); }
}
function onlySigner(msg, wallet) {
  if (msg.feePayer !== wallet) refuse("fee_payer", `the fee payer is ${msg.feePayer}, not ${wallet}`);
  if (msg.signers.length !== 1 || msg.signers[0] !== wallet) refuse("signers", `the signers are ${msg.signers.join(", ")}`);
}
function computeBudgetOnly(ixs) {
  const cb = ixs.filter((ix) => ix.programId === COMPUTE_BUDGET_PROGRAM);
  if (cb.length > 2) refuse("compute_budget", "more than two compute-budget instructions");
  for (const ix of cb) {
    const d = decodeComputeBudget(ix.data);
    if (d.kind === "limit" && d.value > MAX_COMPUTE_UNITS) refuse("compute_budget", `a compute limit of ${d.value}`);
    else if (d.kind === "price" && d.value > MAX_PRIORITY_MICROLAMPORTS) refuse("compute_budget", `a priority price of ${d.value} micro-lamports`);
    else if (d.kind === "other") refuse("compute_budget", "a compute-budget instruction that is not a limit or a price");
    if (ix.accounts.length) refuse("compute_budget", "a compute-budget instruction with accounts");
  }
  return ixs.filter((ix) => ix.programId !== COMPUTE_BUDGET_PROGRAM);
}
const keysAre = (ix, want) => ix.accounts.length === want.length && ix.accounts.every((a, i) => a.pubkey === want[i]);
const u64 = (data, offset) => data.readBigUInt64LE(offset);

/** A pump.fun sell_v2 for `wallet`, of `mint`, from its own account. */
export function checkPumpSellMessage(message, { wallet, mint, maxAmountRaw, minQuoteOutRaw, tokenProgram }) {
  const msg = read(message);
  onlySigner(msg, wallet);
  const rest = computeBudgetOnly(msg.instructions);
  if (rest.length !== 1) refuse("instructions", `${rest.length} instructions besides the compute budget; a sell is exactly one`);
  const ix = rest[0];
  if (ix.programId !== PUMPFUN_PROGRAM) refuse("program", `the sell instruction is for ${ix.programId}`);
  let d;
  try { d = decodeBuyIx(ix.data); } catch (e) { refuse("data", e.message); }
  if (d.instruction !== "sell_v2") refuse("data", "not a sell_v2");
  const own = associatedTokenAddress(wallet, mint, tokenProgram);
  if (ix.accounts[1]?.pubkey !== mint || ix.accounts[13]?.pubkey !== wallet || ix.accounts[14]?.pubkey !== own) refuse("accounts", "the sell is not this mint, by this wallet, out of its own account");
  if (d.amountRaw > BigInt(maxAmountRaw)) refuse("amount", `the sell would move ${d.amountRaw}, more than the ${maxAmountRaw} held`);
  if (d.minQuoteOutRaw < BigInt(minQuoteOutRaw)) refuse("floor", `the sell's floor ${d.minQuoteOutRaw} is under the planned ${minQuoteOutRaw}`);
  return true;
}

/* ── wrapped SOL ── */

export function wrapInstructions({ wallet, lamports }) {
  const ata = associatedTokenAddress(wallet, WSOL_MINT, TOKEN_PROGRAM);
  return [
    createAtaIdempotentIx({ payer: wallet, ata, owner: wallet, mint: WSOL_MINT, tokenProgram: TOKEN_PROGRAM }),
    SystemProgram.transfer({ fromPubkey: new PublicKey(wallet), toPubkey: new PublicKey(ata), lamports: BigInt(lamports) }),
    new TransactionInstruction({ programId: new PublicKey(TOKEN_PROGRAM), keys: [{ pubkey: new PublicKey(ata), isSigner: false, isWritable: true }], data: Buffer.from([17]) }),
  ];
}
export function checkWrapMessage(message, { wallet, lamports }) {
  const msg = read(message);
  onlySigner(msg, wallet);
  const rest = computeBudgetOnly(msg.instructions);
  if (rest.length !== 3) refuse("instructions", "a wrap is one account create, one transfer and one sync");
  const [create, transfer, sync] = rest;
  const ata = associatedTokenAddress(wallet, WSOL_MINT, TOKEN_PROGRAM);
  if (create.programId !== ATA_PROGRAM || create.data.length !== 1 || create.data[0] !== 1 || !keysAre(create, [wallet, ata, wallet, WSOL_MINT, SYSTEM_PROGRAM, TOKEN_PROGRAM]))
    refuse("account_create", "the first instruction is not an idempotent create of the wallet's own wrapped-SOL account");
  if (transfer.programId !== SYSTEM_PROGRAM || transfer.data.length !== 12 || transfer.data.readUInt32LE(0) !== 2 || !keysAre(transfer, [wallet, ata]))
    refuse("transfer", "the second instruction is not a transfer from the wallet into its wrapped-SOL account");
  if (u64(transfer.data, 4) !== BigInt(lamports)) refuse("amount", `the wrap moves ${u64(transfer.data, 4)} lamports, not the ${lamports} planned`);
  if (sync.programId !== TOKEN_PROGRAM || sync.data.length !== 1 || sync.data[0] !== 17 || !keysAre(sync, [ata])) refuse("sync", "the third instruction is not SyncNative on that account");
  return true;
}

export function unwrapInstructions({ wallet }) {
  const ata = associatedTokenAddress(wallet, WSOL_MINT, TOKEN_PROGRAM);
  return [new TransactionInstruction({ programId: new PublicKey(TOKEN_PROGRAM), data: Buffer.from([9]), keys: [
    { pubkey: new PublicKey(ata), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(wallet), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(wallet), isSigner: true, isWritable: false },
  ] })];
}
export function checkUnwrapMessage(message, { wallet }) {
  const msg = read(message);
  onlySigner(msg, wallet);
  const rest = computeBudgetOnly(msg.instructions);
  const ata = associatedTokenAddress(wallet, WSOL_MINT, TOKEN_PROGRAM);
  if (rest.length !== 1 || rest[0].programId !== TOKEN_PROGRAM || rest[0].data.length !== 1 || rest[0].data[0] !== 9 || !keysAre(rest[0], [ata, wallet, wallet]))
    refuse("instructions", "an unwrap is exactly one CloseAccount of the wallet's own wrapped-SOL account, back to the wallet");
  return true;
}

/* ── SOL to the treasury, with the memo that says what it is ── */

export function transferInstructions({ wallet, treasury, lamports, memo }) {
  return [
    SystemProgram.transfer({ fromPubkey: new PublicKey(wallet), toPubkey: new PublicKey(treasury), lamports: BigInt(lamports) }),
    new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [], data: Buffer.from(memo, "utf8") }),
  ];
}
export function checkTransferMessage(message, { wallet, treasury, lamports, memo }) {
  if (!treasury) refuse("no_treasury", "HQ_TREASURY_ADDRESS is not set: HQ sends SOL nowhere else, so it sends none");
  if (!parseHqMemo(memo)) refuse("memo", "not one of HQ's transfer memos");
  const msg = read(message);
  onlySigner(msg, wallet);
  const rest = computeBudgetOnly(msg.instructions);
  if (rest.length !== 2) refuse("instructions", "a transfer is one System transfer and one memo");
  const [transfer, note] = rest;
  if (transfer.programId !== SYSTEM_PROGRAM || transfer.data.length !== 12 || transfer.data.readUInt32LE(0) !== 2) refuse("transfer", "the first instruction is not a System transfer");
  if (!keysAre(transfer, [wallet, treasury])) refuse("destination", `the transfer goes to ${transfer.accounts[1]?.pubkey}, not the agency treasury ${treasury}`);
  if (u64(transfer.data, 4) !== BigInt(lamports)) refuse("amount", `the transfer moves ${u64(transfer.data, 4)} lamports, not the ${lamports} planned`);
  if (note.programId !== MEMO_PROGRAM || note.accounts.length !== 0 || note.data.toString("utf8") !== memo) refuse("memo", "the second instruction is not the planned memo");
  return true;
}

/* ── burning bought-back $CIA ── */

export function burnInstructions({ owner, mint, amountRaw, decimals, tokenProgram = TOKEN_2022_PROGRAM }) {
  const ata = associatedTokenAddress(owner, mint, tokenProgram);
  const data = Buffer.alloc(10);
  data[0] = 15; data.writeBigUInt64LE(BigInt(amountRaw), 1); data[9] = decimals;
  return [new TransactionInstruction({ programId: new PublicKey(tokenProgram), data, keys: [
    { pubkey: new PublicKey(ata), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(mint), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(owner), isSigner: true, isWritable: false },
  ] })];
}
export function checkBurnMessage(message, { owner, mint, amountRaw, decimals, tokenProgram = TOKEN_2022_PROGRAM }) {
  const msg = read(message);
  onlySigner(msg, owner);
  const rest = computeBudgetOnly(msg.instructions);
  const ata = associatedTokenAddress(owner, mint, tokenProgram);
  if (rest.length !== 1) refuse("instructions", "a burn is exactly one BurnChecked");
  const ix = rest[0];
  if (ix.programId !== tokenProgram || ix.data.length !== 10 || ix.data[0] !== 15 || !keysAre(ix, [ata, mint, owner])) refuse("burn", "not a BurnChecked of the owner's own account of this mint");
  if (u64(ix.data, 1) !== BigInt(amountRaw) || ix.data[9] !== decimals) refuse("amount", `the burn is ${u64(ix.data, 1)} at ${ix.data[9]} decimals, not ${amountRaw} at ${decimals}`);
  return true;
}
