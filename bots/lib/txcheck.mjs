/**
 * THE CHECK BEFORE CASHCAT SIGNS ANYTHING.
 *
 * CashCat builds its own transactions, and it still reads every one back from its COMPILED
 * message (the bytes the signature will cover; a legacy message for the bot, a v0 message with no
 * lookup table for the extension's CashCat tab), not from the objects that built it, and
 * refuses anything that is not exactly one of the shapes below. Then it simulates, and the
 * simulation must show the wallet spending no more than the stated budget. A refusal names
 * its clause; nothing is signed after one.
 *
 * The shapes, and nothing else:
 *   launch      fee payer = CashCat's wallet; signers = [wallet, the new mint]; up to two
 *               compute-budget instructions (limit ≤ 1,400,000 units, price ≤ the cap); then
 *               exactly one venue instruction whose accounts are, index by index and flag by
 *               flag, the ones the venue module derives, and whose decoded arguments are the
 *               coin CashCat meant (its name, symbol and metadata URI; the wallet as creator;
 *               no mayhem, cashback, holder reward or custom creator fee on pump.fun; the
 *               StonkFun shape, raise and no transfer fee on LaunchLab).
 *   devBuy      fee payer and only signer = the wallet; compute budget; one idempotent create
 *               of the wallet's own Token-2022 account for the new mint; one buy_v2 on that
 *               mint, for the wallet, whose spend ceiling is at most the dev buy.
 *   collectFee  fee payer and only signer = the wallet; compute budget; one
 *               collect_creator_fee for the wallet's own creator vault.
 * No System transfer, no token transfer, no approval, no other program, no other signer.
 */
import { readMessage, decodeComputeBudget } from "./solana.mjs";
import { COMPUTE_BUDGET_PROGRAM, PUMPFUN_PROGRAM, LAUNCHLAB_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, IX } from "./verified.mjs";
import { createV2Accounts, decodeCreateV2, collectCreatorFeeIx, decodeBuyIx } from "../cashcat/pumpfun.mjs";
import { initializeAccounts, decodeInitialize, STONKFUN_SHAPE } from "../cashcat/stonkfun.mjs";
import { ata } from "./solana.mjs";

export const MAX_COMPUTE_UNITS = 1_400_000;
export const MAX_PRIORITY_MICROLAMPORTS = 200_000n;

export class TxRefused extends Error {
  constructor(clause, message) { super(message); this.name = "TxRefused"; this.clause = clause; }
}
const refuse = (clause, message) => { throw new TxRefused(clause, message); };
/** The compiled message, read; a message the reader refuses (a v0 lookup table) is refused here by name. */
function read(message) {
  try { return readMessage(message); } catch (e) { return refuse(e.clause ?? "message", e.message); }
}

const sameAccounts = (actual, expected) => actual.length === expected.length && actual.every((a, i) =>
  a.pubkey === expected[i].pubkey.toBase58() && a.isSigner === expected[i].isSigner && a.isWritable === expected[i].isWritable);

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

function signersMustBe(msg, wallet, others = []) {
  if (msg.feePayer !== wallet) refuse("fee_payer", `the fee payer is ${msg.feePayer}, not CashCat's wallet`);
  const want = [wallet, ...others];
  if (msg.signers.length !== want.length || !want.every((s) => msg.signers.includes(s))) refuse("signers", `the signers are ${msg.signers.join(", ")}`);
}

/** A launch transaction: one of the three venues' create instructions, as planned. */
export function checkLaunchMessage(message, { wallet, mint, venue, coin, plan = null }) {
  const msg = read(message);
  signersMustBe(msg, wallet, [mint]);
  const rest = computeBudgetOnly(msg.instructions);
  if (rest.length !== 1) refuse("instructions", `${rest.length} instructions besides the compute budget; a launch has exactly one`);
  const ix = rest[0];
  if (venue === "pumpfun" || venue === "pumpfun-xstock") {
    if (ix.programId !== PUMPFUN_PROGRAM) refuse("program", `the launch instruction is for ${ix.programId}`);
    const expected = createV2Accounts({ mint, user: wallet });
    if (venue === "pumpfun-xstock") {
      if (!plan?.extraAccounts) refuse("plan", "a stock-paired pump.fun launch needs its quote accounts");
      expected.push(...plan.extraAccounts);
    }
    if (!sameAccounts(ix.accounts, expected)) refuse("accounts", "the create_v2 accounts are not the derived ones");
    let d;
    try { d = decodeCreateV2(ix.data); } catch (e) { refuse("data", e.message); }
    if (d.creator !== wallet) refuse("creator", "the coin's creator is not CashCat's wallet");
    if (d.name !== coin.name || d.symbol !== coin.symbol || d.uri !== coin.uri) refuse("coin", "the name, symbol or metadata URI is not the coin CashCat meant");
    if (d.isMayhemMode || d.isCashbackEnabled || d.isHolderReward || d.creatorFeeBps !== 0n || d.tailBytes !== 11) refuse("options", "a create_v2 option is set");
  } else if (venue === "stonkfun") {
    if (ix.programId !== LAUNCHLAB_PROGRAM) refuse("program", `the launch instruction is for ${ix.programId}`);
    if (!plan) refuse("plan", "a StonkFun launch needs its verified plan");
    const expected = initializeAccounts({ payer: wallet, mint, quoteMint: plan.quote.mint, quoteTokenProgram: plan.quote.tokenProgram, globalConfig: plan.globalConfig, platformConfig: plan.platformConfig, curveRule: plan.curveRule });
    /* Payer and creator are the same wallet, so the compiled message merges their flags. */
    expected[1] = { ...expected[1], isSigner: true, isWritable: true };
    if (!sameAccounts(ix.accounts, expected)) refuse("accounts", "the initialize accounts are not the derived ones");
    let d;
    try { d = decodeInitialize(ix.data); } catch (e) { refuse("data", e.message); }
    if (d.name !== coin.name || d.symbol !== coin.symbol || d.uri !== coin.uri) refuse("coin", "the name, symbol or metadata URI is not the coin CashCat meant");
    if (d.decimals !== STONKFUN_SHAPE.baseDecimals || d.supply !== STONKFUN_SHAPE.supply || d.totalSellA !== STONKFUN_SHAPE.totalSellA || d.migrateType !== STONKFUN_SHAPE.migrateType)
      refuse("shape", "the curve is not StonkFun's launch shape");
    if (d.raiseRaw !== plan.raiseRaw) refuse("raise", "the raise is not the one the plan verified");
    if (d.vesting.some((v) => v !== 0n)) refuse("vesting", "vesting is set");
    if (d.transferFeeTag !== 0) refuse("transfer_fee", "a transfer fee is set");
    if (d.cpmmCreatorFeeOn !== plan.cpmmCreatorFeeOn) refuse("shape", "the creator-fee side is not the plan's");
  } else refuse("venue", `unknown venue ${venue}`);
  return true;
}

/** The optional dev buy, a separate transaction after the launch landed. */
export function checkDevBuyMessage(message, { wallet, mint, maxSpendLamports }) {
  const msg = read(message);
  signersMustBe(msg, wallet);
  const rest = computeBudgetOnly(msg.instructions);
  if (rest.length !== 2) refuse("instructions", "a dev buy is one account create and one buy_v2");
  const [create, buy] = rest;
  const own = ata(wallet, TOKEN_2022_PROGRAM, mint);
  if (create.programId !== ATA_PROGRAM || create.data.length !== 1 || create.data[0] !== 1) refuse("program", "the first instruction is not an idempotent account create");
  const want = [wallet, own, wallet, mint, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM];
  if (create.accounts.length !== 6 || !create.accounts.every((a, i) => a.pubkey === want[i])) refuse("accounts", "the account create is not for the wallet's own account of this mint");
  if (buy.programId !== PUMPFUN_PROGRAM || buy.data.subarray(0, 8).toString("hex") !== IX.pumpBuyV2) refuse("program", "the second instruction is not pump.fun's buy_v2");
  let d;
  try { d = decodeBuyIx(buy.data); } catch (e) { refuse("data", e.message); }
  if (d.instruction !== "buy_v2") refuse("data", "not a buy");
  if (d.maxQuoteInRaw > BigInt(maxSpendLamports)) refuse("spend", `the buy may spend ${d.maxQuoteInRaw} lamports, over the dev-buy cap ${maxSpendLamports}`);
  if (buy.accounts[1]?.pubkey !== mint || buy.accounts[13]?.pubkey !== wallet || buy.accounts[14]?.pubkey !== own) refuse("accounts", "the buy is not this mint, for this wallet, into its own account");
  return true;
}

export function checkCollectFeeMessage(message, { wallet }) {
  const msg = read(message);
  signersMustBe(msg, wallet);
  const rest = computeBudgetOnly(msg.instructions);
  if (rest.length !== 1) refuse("instructions", "a fee claim is exactly one instruction");
  const expected = collectCreatorFeeIx({ creator: wallet });
  const ix = rest[0];
  if (ix.programId !== PUMPFUN_PROGRAM || !ix.data.equals(Buffer.from(expected.data))) refuse("program", "not pump.fun's collect_creator_fee");
  /* The wallet is the fee payer, so it is signer and writable in the message. */
  const want = expected.keys.map((k, i) => ({ pubkey: k.pubkey, isSigner: i === 0, isWritable: i === 0 ? true : k.isWritable }));
  if (!sameAccounts(ix.accounts, want)) refuse("accounts", "the claim is not for CashCat's own creator vault");
  return true;
}

/**
 * The simulation, read. `walletBefore` is the balance read just before; `walletAfter` is the
 * simulated post-state. The wallet may lose at most `maxSpendLamports`.
 */
export function checkSimulation(sim, { walletBefore, walletAfter, maxSpendLamports, mustLog = null, mayGain = false }) {
  if (!sim) refuse("simulation", "no simulation result");
  if (sim.err) refuse("simulation", `the simulation failed: ${JSON.stringify(sim.err).slice(0, 200)}`);
  if (typeof walletBefore !== "number" || typeof walletAfter !== "number") refuse("simulation", "the wallet's balance before or after is unknown");
  const spent = walletBefore - walletAfter;
  if (spent > maxSpendLamports) refuse("spend", `the simulation spends ${spent} lamports, over the ${maxSpendLamports} budget`);
  if (!mayGain && spent < 0) refuse("spend", "the wallet would gain lamports from a launch, which is not a launch");
  if (mustLog && !(sim.logs ?? []).some((l) => l.includes(mustLog))) refuse("simulation", `the program did not log "${mustLog}"`);
  return { spentLamports: spent, units: sim.unitsConsumed ?? null };
}
