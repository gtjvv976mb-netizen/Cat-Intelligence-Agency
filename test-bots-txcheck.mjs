/**
 * NOTHING IS SIGNED THAT IS NOT EXACTLY THE PLANNED TRANSACTION.
 *
 * bots/lib/txcheck.mjs reads a transaction back from its compiled message and refuses anything
 * that is not one of three shapes: the launch (one venue instruction, as planned), the dev buy,
 * the creator-fee claim. Each venue's real launch passes; then every hostile edit is refused by
 * name, before a signature: a System transfer out of the wallet, a token transfer, a memo, an
 * extra signer, another fee payer, a third compute-budget instruction or an outsized price, a
 * swapped account, another creator, a mayhem or custom-fee flag, another coin's name or URI,
 * StonkFun's reward platform, another raise, vesting, a transfer fee. And the simulation must
 * succeed, log the right instruction, and cost the wallet no more than the budget.
 */
import { Transaction, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { harness, fixture } from "./bots/test/doubles.mjs";
import { checkLaunchMessage, checkDevBuyMessage, checkCollectFeeMessage, checkSimulation, TxRefused } from "./bots/lib/txcheck.mjs";
import { createV2Ix, createV2CustomPairIx, customPairAccounts, collectCreatorFeeIx, encodeCreateV2, createV2Accounts } from "./bots/cashcat/pumpfun.mjs";
import { initializeIx, encodeInitialize, initializeAccounts } from "./bots/cashcat/stonkfun.mjs";
import { computeUnitLimit, computeUnitPrice, instruction, meta } from "./bots/lib/solana.mjs";
import { PUMPFUN_PROGRAM, LAUNCHLAB_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, STONKFUN_PLATFORM_REWARD } from "./bots/lib/verified.mjs";

const { ok, section, done } = harness("test-bots-txcheck");
const sample = fixture("pumpfun/create-v2-samples.json").samples;
const WALLET = sample[0].accounts[5].pubkey, MINT = sample[0].accounts[0].pubkey, OTHER = sample[1].accounts[5].pubkey;
const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const coin = { name: "Pickle Cat", symbol: "PKLCAT", uri: "https://ipfs.io/ipfs/bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
const plan = (() => { const p = fixture("stonkfun/simulate-initialize.json").plan; return { ...p, raiseRaw: BigInt(p.raiseRaw) }; })();

function tx(ixs, { payer = WALLET, cb = [computeUnitLimit(250_000), computeUnitPrice(10_000)] } = {}) {
  const t = new Transaction({ feePayer: new PublicKey(payer), recentBlockhash: "11111111111111111111111111111111" });
  t.add(...cb, ...ixs);
  return t.compileMessage();
}
const verdict = (fn) => { try { fn(); return "passed"; } catch (e) { return e instanceof TxRefused ? e.clause : `threw ${e.message}`; } };
const pumpLaunch = (m, extra = {}) => verdict(() => checkLaunchMessage(m, { wallet: WALLET, mint: MINT, venue: "pumpfun", coin, ...extra }));
const stonkLaunch = (m) => verdict(() => checkLaunchMessage(m, { wallet: WALLET, mint: MINT, venue: "stonkfun", coin, plan }));
const good = () => createV2Ix({ mint: MINT, user: WALLET, ...coin });
const stonk = (over = {}) => initializeIx({ payer: WALLET, mint: MINT, quoteMint: plan.quote.mint, quoteTokenProgram: plan.quote.tokenProgram, globalConfig: plan.globalConfig, curveRule: plan.curveRule, ...coin, raiseRaw: plan.raiseRaw, cpmmCreatorFeeOn: 0, ...over });
const transferOut = SystemProgram.transfer({ fromPubkey: new PublicKey(WALLET), toPubkey: new PublicKey(OTHER), lamports: 1_000_000 });

section("THE PLANNED LAUNCHES PASS");
ok("pump.fun", pumpLaunch(tx([good()])) === "passed");
ok("pump.fun paired with SPYx", verdict(() => checkLaunchMessage(tx([createV2CustomPairIx({ mint: MINT, user: WALLET, ...coin, quoteMint: SPYX, quoteTokenProgram: TOKEN_2022_PROGRAM })]),
  { wallet: WALLET, mint: MINT, venue: "pumpfun-xstock", coin, plan: { extraAccounts: customPairAccounts({ mint: MINT, quoteMint: SPYX, quoteTokenProgram: TOKEN_2022_PROGRAM }) } })) === "passed");
ok("StonkFun", stonkLaunch(tx([stonk()])) === "passed");

section("HOSTILE LAUNCHES ARE REFUSED BEFORE SIGNING");
ok("a System transfer out of the wallet added → instructions", pumpLaunch(tx([good(), transferOut])) === "instructions");
ok("a transfer instead of the create → signers (the new mint is not among them)", pumpLaunch(tx([transferOut])) === "signers");
ok("a token transfer (SPL Token instruction) added → instructions", pumpLaunch(tx([good(), new TransactionInstruction({ programId: new PublicKey(TOKEN_PROGRAM), keys: [meta(OTHER, true), meta(OTHER, true), meta(WALLET, false, true)].map((k) => ({ ...k })), data: Buffer.from([3, 1, 0, 0, 0, 0, 0, 0, 0]) })])) === "instructions");
ok("a memo added → instructions", pumpLaunch(tx([good(), new TransactionInstruction({ programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), keys: [], data: Buffer.from("hi") })])) === "instructions");
ok("another fee payer → fee_payer", pumpLaunch(tx([createV2Ix({ mint: MINT, user: WALLET, ...coin })], { payer: OTHER })) === "fee_payer");
ok("a third signer → signers", pumpLaunch(tx([good(), new TransactionInstruction({ programId: new PublicKey(PUMPFUN_PROGRAM), keys: [{ pubkey: new PublicKey(OTHER), isSigner: true, isWritable: false }], data: Buffer.alloc(0) })])) === "signers");
ok("three compute-budget instructions → compute_budget", pumpLaunch(tx([good()], { cb: [computeUnitLimit(1), computeUnitLimit(2), computeUnitPrice(1)] })) === "compute_budget");
ok("a priority price over the cap → compute_budget", pumpLaunch(tx([good()], { cb: [computeUnitPrice(5_000_000)] })) === "compute_budget");
ok("a compute limit over 1.4M → compute_budget", pumpLaunch(tx([good()], { cb: [computeUnitLimit(1_400_001)] })) === "compute_budget");
{
  const accts = createV2Accounts({ mint: MINT, user: WALLET });
  accts[3] = meta(OTHER, true);
  ok("a swapped account (the curve's token account) → accounts", pumpLaunch(tx([instruction(PUMPFUN_PROGRAM, accts, encodeCreateV2({ ...coin, creator: WALLET }))])) === "accounts");
  const data = encodeCreateV2({ ...coin, creator: OTHER });
  ok("another creator in the arguments → creator", pumpLaunch(tx([instruction(PUMPFUN_PROGRAM, createV2Accounts({ mint: MINT, user: WALLET }), data)])) === "creator");
  ok("mayhem mode set → options", pumpLaunch(tx([instruction(PUMPFUN_PROGRAM, createV2Accounts({ mint: MINT, user: WALLET }), encodeCreateV2({ ...coin, creator: WALLET, isMayhemMode: true }))])) === "options");
  ok("a custom creator fee → options", pumpLaunch(tx([instruction(PUMPFUN_PROGRAM, createV2Accounts({ mint: MINT, user: WALLET }), encodeCreateV2({ ...coin, creator: WALLET, creatorFeeBps: 300n }))])) === "options");
  ok("another coin's name or URI → coin", pumpLaunch(tx([createV2Ix({ mint: MINT, user: WALLET, ...coin, name: "Other Cat" })])) === "coin" && pumpLaunch(tx([createV2Ix({ mint: MINT, user: WALLET, ...coin, uri: "https://evil.example/x.json" })])) === "coin");
  ok("the right create for another mint → signers", verdict(() => checkLaunchMessage(tx([good()]), { wallet: WALLET, mint: OTHER, venue: "pumpfun", coin })) === "signers");
  ok("a StonkFun instruction on a pump.fun launch → program", pumpLaunch(tx([stonk()])) === "program");
}
{
  const reward = initializeAccounts({ payer: WALLET, mint: MINT, quoteMint: plan.quote.mint, quoteTokenProgram: plan.quote.tokenProgram, globalConfig: plan.globalConfig, platformConfig: STONKFUN_PLATFORM_REWARD, curveRule: plan.curveRule });
  ok("StonkFun's reward (taxed) platform → accounts", stonkLaunch(tx([instruction(LAUNCHLAB_PROGRAM, reward, encodeInitialize({ ...coin, raiseRaw: plan.raiseRaw }))])) === "accounts");
  ok("another raise → raise", stonkLaunch(tx([stonk({ raiseRaw: plan.raiseRaw + 1n })])) === "raise");
  const withFee = Buffer.from(encodeInitialize({ ...coin, raiseRaw: plan.raiseRaw })); withFee[withFee.length - 11] = 1;
  ok("a transfer fee switched on → transfer_fee", stonkLaunch(tx([instruction(LAUNCHLAB_PROGRAM, initializeAccounts({ payer: WALLET, mint: MINT, quoteMint: plan.quote.mint, quoteTokenProgram: plan.quote.tokenProgram, globalConfig: plan.globalConfig, curveRule: plan.curveRule }), withFee)])) === "transfer_fee");
  const vest = Buffer.from(encodeInitialize({ ...coin, raiseRaw: plan.raiseRaw })); vest.writeBigUInt64LE(1n, vest.length - 11 - 1 - 24);
  ok("vesting → vesting", stonkLaunch(tx([instruction(LAUNCHLAB_PROGRAM, initializeAccounts({ payer: WALLET, mint: MINT, quoteMint: plan.quote.mint, quoteTokenProgram: plan.quote.tokenProgram, globalConfig: plan.globalConfig, curveRule: plan.curveRule }), vest)])) === "vesting");
  ok("the curve rule left off → accounts", stonkLaunch(tx([instruction(LAUNCHLAB_PROGRAM, initializeAccounts({ payer: WALLET, mint: MINT, quoteMint: plan.quote.mint, quoteTokenProgram: plan.quote.tokenProgram, globalConfig: plan.globalConfig, curveRule: plan.curveRule }).slice(0, 15), encodeInitialize({ ...coin, raiseRaw: plan.raiseRaw }))])) === "accounts");
  ok("a System transfer beside it → instructions", stonkLaunch(tx([stonk(), transferOut])) === "instructions");
}

section("THE CREATOR-FEE CLAIM");
ok("the claim for CashCat's own vault passes", verdict(() => checkCollectFeeMessage(tx([collectCreatorFeeIx({ creator: WALLET })]), { wallet: WALLET })) === "passed");
ok("a claim for someone else's vault → accounts", verdict(() => checkCollectFeeMessage(tx([collectCreatorFeeIx({ creator: OTHER })]), { wallet: WALLET })) === "accounts");
ok("a claim with a transfer beside it → instructions", verdict(() => checkCollectFeeMessage(tx([collectCreatorFeeIx({ creator: WALLET }), transferOut]), { wallet: WALLET })) === "instructions");

section("THE SIMULATION");
const sim = (over = {}) => ({ err: null, logs: ["Program log: Instruction: CreateV2"], unitsConsumed: 95_000, ...over });
const simV = (s, o) => verdict(() => checkSimulation(s, { walletBefore: 1_000_000_000, walletAfter: 994_450_300, maxSpendLamports: 15_000_000, mustLog: "Instruction: CreateV2", ...o }));
ok("a successful simulation inside the budget passes", simV(sim()) === "passed");
ok("a failed simulation → simulation", simV(sim({ err: { InstructionError: [2, { Custom: 6000 }] } })) === "simulation");
ok("a spend over the budget → spend", simV(sim(), { walletAfter: 900_000_000 }) === "spend");
ok("a launch that pays the wallet → spend", simV(sim(), { walletAfter: 1_000_000_001 }) === "spend");
ok("the program did not log the create → simulation", simV(sim({ logs: [] })) === "simulation");
ok("an unknown post-state → simulation", simV(sim(), { walletAfter: undefined }) === "simulation");
ok("…read as a number (NaN, from an answer with no accounts) → simulation, never a pass", simV(sim(), { walletAfter: Number(undefined) }) === "simulation" && simV(sim(), { walletBefore: NaN }) === "simulation" && simV(sim(), { walletAfter: Infinity }) === "simulation");

done();
