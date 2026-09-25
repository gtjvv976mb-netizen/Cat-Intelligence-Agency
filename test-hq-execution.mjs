/**
 * EXECUTION: PAPER SIGNS NOTHING; LIVE NEEDS BOTH SWITCHES; THE IN-FLIGHT MARKER SURVIVES A
 * RESTART; EVERY TRANSACTION HQ BUILDS PASSES ITS CHECK BEFORE A SIGNATURE.
 *
 *   · paper: buys, sells and exits run with signer spies that throw if asked — none is asked, and
 *     nothing is simulated or sent;
 *   · live needs HQ_LIVE=1 AND the agent's own mode live AND the owner's RPC; the treasury needs
 *     HQ_BUYBACK_LIVE=1; wallet.mjs checks its switch again before it signs;
 *   · the marker is written before the build, the signature before the send; a restart finds it
 *     open and the wallet stays blocked until the chain says what became of it (landed, failed,
 *     expired); one never signed is abandoned, because nothing was sent;
 *   · HQ's own shapes (wrap, unwrap, the transfer to the treasury, the burn) pass their checks as
 *     built and are refused altered; money leaves only for HQ_TREASURY_ADDRESS;
 *   · a pump.fun buy the executor builds passes the bots' own buy check and the simulation guard,
 *     and a simulation that drains the wallet stops it before the key is asked.
 * No network: the chain is scripted.
 */
import crypto from "node:crypto";
import bs58 from "bs58";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { harness } from "./bots/test/doubles.mjs";
import { createExecutor, ExecutionError } from "./services/hq/lib/execution.mjs";
import {
  HQ_TX, wrapInstructions, checkWrapMessage, unwrapInstructions, checkUnwrapMessage, transferInstructions, checkTransferMessage, burnInstructions, checkBurnMessage,
} from "./services/hq/lib/txcheck.mjs";
import { memoFor } from "./services/hq/lib/classify.mjs";
import { withdrawToTreasury } from "./services/hq/lib/revenue.mjs";
import { CIA_MINT } from "./services/hq/lib/config.mjs";
import { buildUnsignedTransaction, associatedTokenAddress, computeUnitPriceFor } from "./src/lib/tx.mjs";
import { checkDevBuyMessage, MAX_PRIORITY_MICROLAMPORTS } from "./bots/lib/txcheck.mjs";
import { readMessage } from "./bots/lib/solana.mjs";
import { SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { PUMPFUN_VENUE, bondingCurveAddress, globalAddress, BONDING_CURVE_DISCRIMINATOR, GLOBAL_DISCRIMINATOR, decodeBuyIx } from "./vendor/executor/snipe-venue-pumpfun.mjs";
import { planSnipeCeiling } from "./vendor/executor/snipe-entry.mjs";
import { snipeCurveState } from "./vendor/executor/snipe-curve.mjs";
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "./vendor/executor/token2022.mjs";
import { signAsAgent, signAsTreasury, WalletError } from "./services/hq/wallet.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { paperRig, extRpc, signerSpies, memDb, testConfig, testClock, addr, tokenAccountData, TEST_PHRASE, jupiterDouble, jsonTx } from "./services/hq/test/doubles.mjs";
import { openDb } from "./services/hq/lib/db.mjs";
import { checkSimulation } from "./bots/lib/txcheck.mjs";
import { parseSol } from "./services/hq/lib/amounts.mjs";

const { ok, section, done } = harness("test-hq-execution");
const SOL = 1_000_000_000n;
const BLOCKHASH = bs58.encode(Buffer.alloc(32, 7));
const fakeSig = () => bs58.encode(crypto.randomBytes(64));
const refusedWith = async (fn, clause) => { try { await fn(); return false; } catch (e) { return (e.clause ?? e.code) === clause; } };
const signingSpies = () => signerSpies({ agent: (n, { txBase64 }) => ({ signature: fakeSig(), signedBase64: txBase64 }), treasury: ({ txBase64 }) => ({ signature: fakeSig(), signedBase64: txBase64 }) });
const liveEnv = { HQ_LIVE: "1", HQ_RPC_URL: "https://rpc.test.invalid/owner" };
const liveOwner = (n, wallet) => ({ kind: "agent", number: n, wallet, mode: "live" });

section("PAPER SIGNS NOTHING");
{
  const spies = signerSpies();
  const rpc = extRpc({});
  const M = addr(40), P = addr(41);
  const markMap = new Map();
  const jupiter = jupiterDouble({ outFor: ({ inputMint, amountRaw }) => { const m = markMap.get(inputMint); return m ? (amountRaw * m.lamports) / m.tokens : amountRaw * 1_000n; } });
  let executor = null;
  const rig = await paperRig({ jupiter, marks: markMap, rpc, executor: () => executor });
  executor = createExecutor({ config: rig.config, db: rig.db, rpc, jupiter, signers: spies });
  const agent = rig.db.getAgent(1);
  const b = await rig.runtime.buy(agent, { mint: M, symbol: "M", decimals: 6, venue: "jupiter", askedLamports: parseSol("0.05"), reason: "paper test" });
  const plan = { deliverable: true, baseOutRaw: 1_000_000_000n, maxQuoteInRaw: parseSol("0.01") };
  const p = await rig.runtime.buy(agent, { mint: P, symbol: "P", decimals: 6, venue: "pumpfun", askedLamports: parseSol("0.01"), plan: async () => plan, reason: "paper test" });
  markMap.set(M, { lamports: 60_000_000n, tokens: 50_000_000_000n, source: "test" });
  const exits = await rig.runtime.runExits(agent);
  const s = await rig.runtime.sell(agent, P, { trigger: "manual", reason: "paper test" });
  ok("a paper Jupiter buy, a paper curve buy, a take profit and a manual sell all filled", b.ok && p.ok && exits[0]?.trigger === "take_profit" && exits[0].result.ok && s.ok, JSON.stringify({ b: b.clause ?? null, p: p.clause ?? null, exits: exits.map((x) => [x.trigger, x.result.ok, x.result.clause ?? null]), s: s.clause ?? null }));
  ok("…and neither signer was asked once", spies.calls.agent.length === 0 && spies.calls.treasury.length === 0);
  ok("…nothing was simulated or sent, and no in-flight marker was written", !rpc.calls.some((c) => ["simulateTransaction", "sendTransaction"].includes(c.method)) && rig.db.listIntents().length === 0);
  const trades = rig.db.listTrades(1, "paper");
  ok("every paper fill is marked paper and carries no transaction signature", trades.length === 4 && trades.every((t) => t.mode === "paper" && t.tx === null));
  ok("each paper fill is charged the network fee a live one would pay", trades.every((t) => BigInt(t.fee) === 5_000n + BigInt(HQ_TX.priorityFeeLamports)));
}

section("LIVE NEEDS BOTH SWITCHES, THE OWNER'S RPC, AND THE AGENT'S OWN MODE");
{
  const wallet = addr(20);
  const make = (env) => { const rpc = extRpc({}); const spies = signingSpies(); const db = memDb(); const config = testConfig(env);
    return { rpc, spies, db, ex: createExecutor({ config, db, rpc, jupiter: jupiterDouble(), signers: spies, sleep: async () => {} }) }; };
  const wrapFor = (x, owner) => x.ex.wrap({ owner, lamports: 10_000_000n });
  let x = make({ HQ_RPC_URL: liveEnv.HQ_RPC_URL });
  ok("HQ_LIVE off: a live agent's transaction is refused (live_not_enabled)", await refusedWith(() => wrapFor(x, liveOwner(1, wallet)), "live_not_enabled"));
  ok("…before any RPC call, any marker or any signature", x.rpc.calls.length === 0 && x.db.listIntents().length === 0 && x.spies.calls.agent.length === 0);
  x = make(liveEnv);
  ok("HQ_LIVE on but the agent in paper mode: refused (agent_not_live)", await refusedWith(() => wrapFor(x, { ...liveOwner(1, wallet), mode: "paper" }), "agent_not_live") && x.rpc.calls.length === 0);
  x = make({ HQ_LIVE: "1" });
  ok("HQ_LIVE on, the agent live, but no HQ_RPC_URL: refused (no_rpc) — nothing goes through the public endpoint", await refusedWith(() => wrapFor(x, liveOwner(1, wallet)), "no_rpc"));
  x = make(liveEnv);
  ok("the treasury without HQ_BUYBACK_LIVE=1: refused (buyback_not_live)", await refusedWith(() => x.ex.wrap({ owner: { kind: "treasury", wallet }, lamports: 1n }), "buyback_not_live"));
  x = make({ ...liveEnv, HQ_KILL: "1" });
  ok("under the kill switch a buy-side transaction is refused", await refusedWith(() => wrapFor(x, liveOwner(1, wallet)), "kill_switch"));
  ok("…but a protective one (a stop's sell, money home to the treasury) may pass the switch", (() => { try { x.ex.assertMaySend(liveOwner(1, wallet), { protective: true }); return true; } catch { return false; } })());

  const rig = await paperRig({ agents: [{ id: 5, mode: "live" }] });
  const r = await rig.runtime.buy(rig.db.getAgent(5), { mint: addr(42), symbol: "L", decimals: 6, venue: "jupiter", askedLamports: parseSol("0.01"), reason: "test" });
  ok("the runtime: a live agent while HQ_LIVE is off buys nothing (live_not_enabled), and asks no rug check or quote", r.clause === "live_not_enabled" && rig.rug.calls.length === 0 && rig.jupiter.calls.length === 0);
  ok("…and its exits do not run on paper numbers instead", (await rig.runtime.runExits(rig.db.getAgent(5))).length === 0);

  /* wallet.mjs, the last door: it checks its switch itself. */
  const tx = buildUnsignedTransaction({ payer: wallet, blockhash: BLOCKHASH, computeUnitLimit: 60_000, priorityFeeLamports: 50_000, instructions: wrapInstructions({ wallet, lamports: 1n }) });
  const txBase64 = Buffer.from(tx.serialize()).toString("base64"), expectedMessageBase64 = Buffer.from(tx.message.serialize()).toString("base64");
  const wErr = (fn) => { try { fn(); return null; } catch (e) { return e instanceof WalletError ? e.clause ?? e.code : e.message; } };
  ok("signAsAgent without HQ_LIVE=1 signs nothing, even with the seed present", wErr(() => signAsAgent(1, { txBase64, expectedMessageBase64, env: { HQ_MASTER_SEED: TEST_PHRASE } })) === "not_live");
  ok("signAsTreasury without HQ_BUYBACK_LIVE=1 signs nothing", wErr(() => signAsTreasury({ txBase64, expectedMessageBase64, env: {} })) === "not_live");
  ok("signAsTreasury with the switch but no treasury key signs nothing", wErr(() => signAsTreasury({ txBase64, expectedMessageBase64, env: { HQ_BUYBACK_LIVE: "1" } })) === "no_treasury_key");
  ok("signAsAgent refuses a transaction whose fee payer is not the agent's own wallet", wErr(() => signAsAgent(1, { txBase64, expectedMessageBase64, env: { HQ_MASTER_SEED: TEST_PHRASE, HQ_LIVE: "1" } })) === "fee_payer");
}

/* A chain double for HQ's own one-signer transactions and the markers. `valid()` is what
   isBlockhashValid says of the message's own blockhash; `readable(sig)` whether getTransaction
   returns the landed transaction yet. */
function simpleChain({ wallet, lamports = 2n * SOL, status = () => null, height = () => 1_000, valid = () => true, readable = () => true, onSend = null, sim = null } = {}) {
  const h = {
    getLatestBlockhash: () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1_150 }),
    getBalance: () => lamports,
    simulateTransaction: ([txBase64]) => (sim ? sim(txBase64) : { err: null, logs: [], accounts: [{ lamports: Number(lamports - 10_055_000n - 2_039_280n), owner: "11111111111111111111111111111111", data: ["", "base64"] }] }),
    sendTransaction: ([tx]) => { onSend?.(tx); return "sent"; },
    getSignatureStatus: ([sig]) => status(sig),
    getBlockHeight: () => height(),
    isBlockhashValid: () => ({ context: { slot: 1 }, value: valid() }),
    getTransaction: ([sig]) => (readable(sig) ? jsonTx({ signature: sig, slot: 9, keys: [wallet], balances: { [wallet]: [Number(lamports), Number(lamports) - 60_000] } }) : null),
    getSignatureStatuses: ([[sig]]) => ({ value: [status(sig)] }),
    getTokenAccountBalance: () => 0n,
  };
  return extRpc(h);
}

section("THE IN-FLIGHT MARKER: WRITTEN FIRST, SIGNATURE BEFORE SEND");
{
  const wallet = addr(21);
  const db = memDb();
  const config = testConfig(liveEnv);
  const seen = {};
  const spies = signerSpies({ agent: (n, { txBase64 }) => { seen.atSign = db.openIntents(wallet).map((i) => i.state); const signature = fakeSig(); seen.signature = signature; return { signature, signedBase64: txBase64 }; } });
  const rpc = simpleChain({ wallet, status: () => ({ confirmationStatus: "confirmed", err: null }),
    onSend: () => { seen.atSend = db.openIntents(wallet).map((i) => ({ state: i.state, signature: i.signature })); } });
  const origBalance = rpc.getBalance;
  rpc.getBalance = async (a) => { seen.atBuild = db.openIntents(wallet).map((i) => i.state); return origBalance(a); };
  const ex = createExecutor({ config, db, rpc, jupiter: null, signers: spies, sleep: async () => {} });
  const r = await ex.wrap({ owner: liveOwner(1, wallet), lamports: 10_000_000n });
  ok("the marker exists, prepared, while the transaction is being built", JSON.stringify(seen.atBuild) === '["prepared"]');
  ok("…and still unsigned when the key is asked", JSON.stringify(seen.atSign) === '["prepared"]');
  ok("the signature is on the marker (state signed) before anything is sent", seen.atSend?.[0]?.state === "signed" && seen.atSend[0].signature === seen.signature);
  ok("confirmed, the marker is closed and the wallet free", r.signature === seen.signature && db.openIntents(wallet).length === 0 && db.intentBySignature(seen.signature).state === "confirmed");
  ok("the key signed exactly the message the check ran on", spies.calls.agent.length === 1 && spies.calls.agent[0].expectedMessageBase64 === Buffer.from(VersionedTransaction.deserialize(Buffer.from(spies.calls.agent[0].txBase64, "base64")).message.serialize()).toString("base64"));
  const badBuild = await refusedWith(() => ex.submit({ owner: liveOwner(1, wallet), kind: "wrap", build: async () => { throw new ExecutionError("prepare_failed", "no"); } }), "prepare_failed");
  ok("a build that fails abandons its marker at once: nothing was signed, the wallet is not blocked", badBuild && db.openIntents(wallet).length === 0 && db.listIntents().some((i) => i.state === "abandoned"));
}

section("A RESTART NEVER TRADES TWICE");
{
  const wallet = addr(22);
  const db = memDb();
  const config = testConfig(liveEnv);
  /* The first process signs and sends; the chain has not answered when it dies. */
  let chainStatus = null, height = 1_000, valid = true;
  const rpc1 = simpleChain({ wallet, status: () => chainStatus, height: () => height, valid: () => valid });
  const ex1 = createExecutor({ config, db, rpc: rpc1, jupiter: null, signers: signingSpies(), sleep: async () => {}, confirmTimeoutMs: 0 });
  const first = await refusedWith(() => ex1.wrap({ owner: liveOwner(1, wallet), lamports: 10_000_000n }), "ambiguous");
  const open = db.openIntents(wallet);
  ok("a transaction with no answer from the chain stays in flight, its signature and its own blockhash recorded", first && open.length === 1 && open[0].signature && open[0].state === "sent" && open[0].detail?.blockhash === BLOCKHASH);

  /* The second process starts on the same database. */
  const spies2 = signingSpies();
  let built = 0;
  const rpc2 = simpleChain({ wallet, status: () => chainStatus, height: () => height, valid: () => valid });
  const ex2 = createExecutor({ config, db, rpc: rpc2, jupiter: null, signers: spies2, sleep: async () => {} });
  const again = await refusedWith(() => ex2.submit({ owner: liveOwner(1, wallet), kind: "buy", build: async () => { built++; return {}; } }), "in_flight");
  ok("after the restart the same wallet starts nothing: refused in_flight, nothing built, nothing signed", again && built === 0 && spies2.calls.agent.length === 0);
  let rec = await ex2.recover();
  ok("recover(): still inside its blockhash's life and unseen — it waits, and the wallet stays blocked", rec[0]?.waiting === true && db.openIntents(wallet).length === 1);

  /* The runtime sees a marker the same way: a live agent with one open buys nothing. */
  const holder = {};
  const rig = await paperRig({ env: liveEnv, agents: [{ id: 9, mode: "live", wallet: addr(31) }], executor: () => holder.ex });
  holder.ex = createExecutor({ config: rig.config, db: rig.db, rpc: rpc2, jupiter: null, signers: spies2 });
  rig.db.createIntent({ id: "open-one", agentId: 9, wallet: addr(31), kind: "buy", mint: addr(43) });
  const blocked = await rig.runtime.buy(rig.db.getAgent(9), { mint: addr(44), symbol: "B", decimals: 6, venue: "jupiter", askedLamports: parseSol("0.01"), reason: "test" });
  ok("the runtime refuses a live agent's buy while its wallet has a marker open (in_flight), before the rug check", blocked.clause === "in_flight" && rig.rug.calls.length === 0);

  height = 2_000;
  rec = await ex2.recover();
  ok("the block height past the last valid height Jupiter or the RPC named is not the judge: its own blockhash still valid, it waits", rec[0]?.waiting === true && db.openIntents(wallet).length === 1);
  valid = false;
  rec = await ex2.recover();
  ok("…once its own blockhash is no longer valid (isBlockhashValid on the message's blockhash) and it is still unseen, it can never land: expired, the wallet free", rec[0]?.state === "expired" && db.openIntents(wallet).length === 0);
  const asked = rpc2.calls.map((c) => c.method);
  ok("…asked in that order: the blockhash first, then the status with history (so a landing just before the expiry is seen)", asked.lastIndexOf("isBlockhashValid") < asked.lastIndexOf("getSignatureStatuses") && rpc2.calls.filter((c) => c.method === "getSignatureStatuses").every((c) => c.params[1]?.searchTransactionHistory === true));

  /* The other endings. */
  const clock2 = testClock();
  const db2 = memDb(clock2);
  let st = { confirmationStatus: "finalized", err: null };
  const landed = [];
  const exC = createExecutor({ config, db: db2, clock: clock2, rpc: extRpc({ getSignatureStatuses: () => ({ value: [st] }), getTransaction: () => ({ slot: 5, meta: { err: null }, transaction: {} }), getBlockHeight: () => 1 }), jupiter: null, signers: signingSpies(), sleep: async () => {},
    onConfirmed: async (x) => { landed.push(x.signature); } });
  const sigA = fakeSig();
  db2.createIntent({ id: "a", agentId: 1, wallet, kind: "sell" }); db2.updateIntent("a", { state: "signed", signature: sigA, lastValidBlockHeight: 100 });
  rec = await exC.recover();
  ok("signed, and the chain shows it landed: confirmed, and its transaction read into the ledger (chain_txs) first", rec[0].state === "confirmed" && landed[0] === sigA && db2.getIntent("a").state === "confirmed" && db2.hasChainTx(wallet, sigA));
  st = { confirmationStatus: "confirmed", err: { InstructionError: [2, { Custom: 6003 }] } };
  db2.createIntent({ id: "b", agentId: 1, wallet, kind: "buy" }); db2.updateIntent("b", { state: "sent", signature: fakeSig(), lastValidBlockHeight: 100 });
  rec = await exC.recover();
  ok("…and it failed on chain: failed, the wallet free", rec[0].state === "failed" && db2.getIntent("b").state === "failed");
  db2.createIntent({ id: "c", agentId: 1, wallet, kind: "buy" });
  rec = await exC.recover();
  ok("a marker prepared a moment ago (another process may be building it) is left alone", rec[0].waiting === true && db2.openIntents().length === 1);
  clock2.advance(121_000);
  rec = await exC.recover();
  ok("a marker left prepared (the process died before the signature): abandoned after two minutes — nothing was sent, since sending comes after the signature is written", rec[0].state === "abandoned" && db2.openIntents().length === 0);
  db2.createIntent({ id: "d", agentId: 1, wallet, kind: "sell" }); db2.updateIntent("d", { state: "sent", signature: fakeSig(), lastValidBlockHeight: 100 });
  st = null;
  const exOld = createExecutor({ config, db: db2, clock: clock2, rpc: extRpc({ getSignatureStatuses: () => ({ value: [null] }), getBlockHeight: () => 200 }), jupiter: null, signers: signingSpies(), sleep: async () => {} });
  rec = await exOld.recover();
  ok("a marker written before blockhashes were kept falls back to the block height: past its last valid height and unseen, expired", rec[0].state === "expired");
}

section("AN UNCONFIRMED SEND NEVER BLOCKS A WALLET UNTIL A RESTART: THE CHAIN SETTLES IT");
{
  const wallet = addr(32), treasury = addr(33);
  const db = memDb();
  const config = testConfig({ ...liveEnv, HQ_TREASURY_ADDRESS: treasury, HQ_KILL: "1" });
  let down = true;
  const stuckSig = fakeSig();
  /* the stuck one never landed and its blockhash is gone; anything sent now lands */
  const up = simpleChain({ wallet, status: (sig) => (sig === stuckSig ? null : { confirmationStatus: "confirmed", err: null }), valid: () => false, sim: () => ({ err: null, accounts: [{ lamports: Number(2n * SOL - 100_000_000n - 55_000n) }] }) });
  const calls = [];
  const rpc = new Proxy(up, { get: (t, k) => (typeof t[k] === "function" ? async (...a) => { calls.push(k === "call" ? a[0] : k); if (down) throw new Error("rpc down"); return t[k](...a); } : t[k]) });
  const spies = signingSpies();
  const ex = createExecutor({ config, db, rpc, jupiter: null, signers: spies, sleep: async () => {} });
  /* a buy whose confirmation had no answer: sent, its signature and blockhash on the marker */
  db.createIntent({ id: "stuck", agentId: 1, wallet, kind: "buy", mint: addr(34), detail: { blockhash: BLOCKHASH, signedAt: new Date(Date.now() - 300_000).toISOString() } });
  db.updateIntent("stuck", { state: "sent", signature: stuckSig, lastValidBlockHeight: 900 });
  const owner = liveOwner(1, wallet);
  const stop = await refusedWith(() => ex.pumpSell({ owner, mint: addr(34), qtyRaw: 1n, trigger: "stop_loss" }), "in_flight");
  ok("the RPC down: a stop loss's sell is refused in_flight, but only after the marker was asked about", stop && calls.includes("isBlockhashValid") && calls.includes("getSignatureStatuses") && spies.calls.agent.length === 0);
  ok("…nothing was settled on a guess: the marker is still open", db.getIntent("stuck").state === "sent");
  down = false;
  const r = await ex.transferToTreasury({ owner, lamports: 100_000_000n, memo: memoFor("withdraw", 1) });
  ok("the chain answers again: the next protective transaction settles the marker first (signed five minutes ago, past its last valid height, its blockhash invalid, and still unseen on a last look) and goes, with no restart", db.getIntent("stuck").state === "expired" && r.signature && spies.calls.agent.length === 1 && db.openIntents(wallet).length === 0);
}

section("LANDED BUT NOT YET READ BACK: THE WALLET WAITS FOR ITS LEDGER");
{
  const wallet = addr(35);
  const db = memDb();
  const config = testConfig(liveEnv);
  let readable = false;
  const told = [];
  const rpc = simpleChain({ wallet, status: () => ({ confirmationStatus: "confirmed", err: null }), readable: () => readable });
  const ex = createExecutor({ config, db, rpc, jupiter: null, signers: signingSpies(), sleep: async () => {}, onConfirmed: async (x) => { told.push(x.signature); } });
  const first = await ex.wrap({ owner: liveOwner(1, wallet), lamports: 10_000_000n });
  ok("confirmed, but getTransaction has nothing yet: it says so, and the marker stays open (landed)", first.landed === true && first.tx === null && db.openIntents(wallet)[0]?.state === "landed" && !db.hasChainTx(wallet, first.signature));
  let built = 0;
  const second = await refusedWith(() => ex.submit({ owner: liveOwner(1, wallet), kind: "buy", build: async () => { built++; return {}; } }), "in_flight");
  ok("…so the next transaction is refused in_flight: no decision on a ledger that lacks the last fill", second && built === 0);
  readable = true;
  const rec = await ex.settle();
  ok("once it can be read: into chain_txs, the ledger told, the marker closed", rec[0]?.state === "confirmed" && db.hasChainTx(wallet, first.signature) && told.includes(first.signature) && db.openIntents(wallet).length === 0);
}

section("A BLOCKHASH THE NODE HAS NOT SEEN YET IS NOT AN EXPIRED ONE");
{
  /* isBlockhashValid answers false for a blockhash the answering node has not seen yet (a node a
     slot behind, or Jupiter's blockhash newer than its confirmed bank). */
  let walletN = 40;
  const race = ({ valid, height = () => 2_000, statusNoHistory = null } = {}) => {
    const wallet = addr(walletN++);
    const clock = testClock();
    const db = memDb(clock);
    const sent = [], landed = new Set();
    const lamports = 2_000_000_000n;
    const rpc = extRpc({
      getLatestBlockhash: () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1_150 }),
      getBalance: () => lamports,
      simulateTransaction: () => ({ err: null, logs: [], accounts: [{ lamports: Number(lamports - 10_055_000n - 2_039_280n) }] }),
      sendTransaction: () => "sent",
      isBlockhashValid: () => ({ context: { slot: 1 }, value: valid() }),
      getSignatureStatus: ([sig]) => (statusNoHistory ? statusNoHistory(sig) : landed.has(sig) ? { confirmationStatus: "confirmed", err: null } : null),
      getSignatureStatuses: ([[sig]]) => ({ value: [landed.has(sig) ? { confirmationStatus: "confirmed", err: null } : null] }),
      getBlockHeight: () => height(),
      getTransaction: ([sig]) => (landed.has(sig) ? jsonTx({ signature: sig, slot: 9, keys: [wallet], balances: { [wallet]: [Number(lamports), Number(lamports) - 10_060_000] } }) : null),
      getTokenAccountBalance: () => 0n,
    });
    const spies = signerSpies({ agent: (n, { txBase64 }) => { const sig = fakeSig(); sent.push(sig); return { signature: sig, signedBase64: txBase64 }; } });
    const ex = createExecutor({ config: testConfig(liveEnv), db, rpc, clock, jupiter: null, signers: spies, sleep: async (ms) => { clock.advance(ms); } });
    return { wallet, clock, db, sent, landed, rpc, ex, owner: liveOwner(1, wallet) };
  };

  /* the verifier's case: the node's first answer is false, then true; the transaction lands later */
  let n = 0;
  const a = race({ valid: () => n++ > 0 });
  const first = await refusedWith(() => a.ex.wrap({ owner: a.owner, lamports: 10_000_000n }), "ambiguous");
  ok("the node's first answer is false, its next true: never 'expired' — after the confirm window it is ambiguous, and the marker stays open", first && a.db.intentBySignature(a.sent[0]).state === "sent" && a.db.openIntents(a.wallet).length === 1);
  ok("…the blockhash was seen valid, and that is kept on the marker", Boolean(a.db.intentBySignature(a.sent[0]).detail?.seenValidAt));
  let built = 0;
  ok("…so nothing else goes from the wallet: refused in_flight, nothing built or signed", await refusedWith(() => a.ex.submit({ owner: a.owner, kind: "buy", build: async () => { built++; return {}; } }), "in_flight") && built === 0 && a.sent.length === 1);
  a.landed.add(a.sent[0]);
  const settled = await a.ex.settle();
  ok("it lands: settled confirmed and read back; one transaction was ever sent", settled[0]?.state === "confirmed" && a.db.hasChainTx(a.wallet, a.sent[0]) && a.sent.length === 1);

  /* never seen valid by this node, and the chain past its last valid height */
  const b = race({ valid: () => false });
  await refusedWith(() => b.ex.wrap({ owner: b.owner, lamports: 10_000_000n }), "ambiguous");
  ok("a blockhash this node never saw valid: not expired within two minutes of signing (the confirm window ends first)", b.db.intentBySignature(b.sent[0]).state === "sent");
  b.clock.advance(31_000);
  const late = await b.ex.settle();
  const asked = b.rpc.calls.map((c) => c.method);
  ok("…two minutes after signing, still unseen on a last read of its status with history: expired, the wallet free", late[0]?.state === "expired" && b.db.openIntents(b.wallet).length === 0
    && asked.lastIndexOf("getSignatureStatuses") > asked.lastIndexOf("isBlockhashValid") && b.rpc.calls.filter((c) => c.method === "getSignatureStatuses").at(-1).params[1]?.searchTransactionHistory === true);

  /* the block height guard: the chain has not passed the last valid height it was built with */
  const c = race({ valid: () => false, height: () => 1_000 });
  await refusedWith(() => c.ex.wrap({ owner: c.owner, lamports: 10_000_000n }), "ambiguous");
  c.clock.advance(600_000);
  const guarded = await c.ex.settle();
  ok("the block height still at or under the last valid height: never expired, however long and whatever isBlockhashValid says", guarded[0]?.waiting === true && c.db.openIntents(c.wallet).length === 1);

  /* expired by every sign (seen valid once, invalid since, the height past it), and the status
     read without history empty: only the last read, with history, finds it */
  let m = 0;
  const d = race({ valid: () => m++ === 0, statusNoHistory: () => null });
  const orig = d.rpc.call;
  d.rpc.call = async (method, params) => { if (method === "getSignatureStatuses") d.landed.add(params[0][0]); return orig(method, params); };
  const r = await d.ex.wrap({ owner: d.owner, lamports: 10_000_000n });
  ok("a blockhash seen valid, then invalid, the status without history empty: the last read with history finds it landed — confirmed, not expired", r.signature === d.sent[0] && d.db.intentBySignature(d.sent[0]).state === "confirmed");
}

section("A MARKER THAT LANDED BUT CANNOT BE READ BACK: PROTECTIONS STILL GO, AND THE OWNER CAN RESOLVE IT");
{
  const wallet = addr(95), treasury = addr(96);
  const db = memDb();
  const config = testConfig({ ...liveEnv, HQ_TREASURY_ADDRESS: treasury });
  const spies = signingSpies();
  let readable = false;
  const rpc = simpleChain({ wallet, status: () => ({ confirmationStatus: "confirmed", err: null }), readable: (sig) => readable || sig !== stuck, sim: () => ({ err: null, accounts: [{ lamports: Number(2n * SOL - 100_000_000n - 55_000n) }] }) });
  const ex = createExecutor({ config, db, rpc, jupiter: null, signers: spies, sleep: async () => {} });
  const stuck = fakeSig();
  db.createIntent({ id: "landed-1", agentId: 1, wallet, kind: "buy", detail: { blockhash: BLOCKHASH } });
  db.updateIntent("landed-1", { state: "landed", signature: stuck, lastValidBlockHeight: 1_150 });
  const owner = liveOwner(1, wallet);
  let built = 0;
  ok("a buy (decided on the ledger) is refused while it is not read back", await refusedWith(() => ex.submit({ owner, kind: "buy", build: async () => { built++; return {}; } }), "in_flight") && built === 0);
  const home = await ex.transferToTreasury({ owner, lamports: 100_000_000n, memo: memoFor("withdraw", 1) });
  ok("…a protective transaction (money home, a stop's sell) goes: it acts on what the chain says the wallet holds", home.signature && spies.calls.agent.length === 1 && db.getIntent("landed-1").state === "landed");
  const r1 = await ex.resolveIntent("landed-1");
  ok("the owner's resolve without saying so leaves it open, and says why", r1.resolved === false && r1.state === "landed" && /acceptLanded/.test(r1.why));
  const r2 = await ex.resolveIntent("landed-1", { acceptLanded: true });
  ok("…with acceptLanded, on the chain's word that it landed: closed confirmed, marked unread (the indexer reads it when the RPC returns it)", r2.resolved === true && db.getIntent("landed-1").state === "confirmed" && db.getIntent("landed-1").detail.unread === true && db.openIntents(wallet).length === 0);
  db.createIntent({ id: "never", agentId: 1, wallet, kind: "buy" });
  ok("a marker never signed: abandoned by the owner's resolve at once (nothing was sent)", (await ex.resolveIntent("never")).state === "abandoned");
  const pending = fakeSig();
  const rpc2 = simpleChain({ wallet, status: () => null, valid: () => true, height: () => 2_000 });
  const ex2 = createExecutor({ config, db, rpc: rpc2, jupiter: null, signers: spies, sleep: async () => {} });
  db.createIntent({ id: "sent-1", agentId: 1, wallet, kind: "sell", detail: { blockhash: BLOCKHASH, signedAt: new Date().toISOString() } });
  db.updateIntent("sent-1", { state: "sent", signature: pending, lastValidBlockHeight: 1_150 });
  const r3 = await ex2.resolveIntent("sent-1", { acceptLanded: true });
  ok("one the chain has not decided (its blockhash still valid, no status): stays open, whatever the owner says", r3.resolved === false && db.getIntent("sent-1").state === "sent");
  ok("…and one already settled is left as it is", (await ex2.resolveIntent("landed-1")).resolved === false);
}

section("A SIMULATION THAT DOES NOT SAY THE WALLET'S BALANCE IS NO PASS");
{
  const wallet = addr(36);
  const db = memDb();
  const spies = signingSpies();
  const ex = createExecutor({ config: testConfig(liveEnv), db, rpc: simpleChain({ wallet, sim: () => ({ err: null, logs: [], accounts: [null] }) }), jupiter: null, signers: spies, sleep: async () => {} });
  ok("an answer with no post-state: refused (simulation_unreadable), the key never asked, the wallet not blocked",
    await refusedWith(() => ex.wrap({ owner: liveOwner(1, wallet), lamports: 10_000_000n }), "simulation_unreadable") && spies.calls.agent.length === 0 && db.openIntents(wallet).length === 0);
  const refusedSim = (o) => { try { checkSimulation({ err: null, accounts: [null] }, { walletBefore: 1e9, maxSpendLamports: 0, ...o }); return false; } catch (e) { return e.clause === "simulation"; } };
  ok("…and the bots' check refuses a balance that is not a number (Number(undefined) is NaN)", refusedSim({ walletAfter: Number(undefined) }) && refusedSim({ walletAfter: 1e9, walletBefore: NaN }));
}

section("ONE OPEN MARKER PER WALLET ACROSS PROCESSES: THE INSERT IS THE CHECK");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-intents-"));
  try {
    const file = path.join(dir, "hq.sqlite");
    const server = openDb(file), console_ = openDb(file);       /* the server and the owner's CLI, one file */
    const wallet = addr(37);
    const a = server.createIntent({ id: "srv", agentId: 1, wallet, kind: "sell" });
    const b = console_.createIntent({ id: "cli", agentId: 1, wallet, kind: "transfer" });
    ok("the server's marker is open; the console's for the same wallet is refused by the index (null), not written", a?.state === "prepared" && b === null && console_.getIntent("cli") === null);
    ok("…another wallet is free", console_.createIntent({ id: "cli2", agentId: 2, wallet: addr(38), kind: "transfer" })?.state === "prepared");
    let built = 0;
    const exCli = createExecutor({ config: testConfig(liveEnv), db: console_, rpc: simpleChain({ wallet }), jupiter: null, signers: signingSpies(), sleep: async () => {} });
    ok("the console's executor: refused in_flight, nothing built", await refusedWith(() => exCli.submit({ owner: liveOwner(1, wallet), kind: "transfer", build: async () => { built++; return {}; } }), "in_flight") && built === 0);
    server.updateIntent("srv", { state: "confirmed" });
    ok("closed in one process, the wallet is free in the other", console_.createIntent({ id: "cli3", agentId: 1, wallet, kind: "transfer" })?.state === "prepared");
    server.close(); console_.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

section("HQ'S OWN TRANSACTIONS, CHECKED BEFORE A SIGNATURE");
{
  const wallet = addr(23), treasury = addr(24), attacker = addr(25);
  const msgOf = (instructions, payer = wallet) => buildUnsignedTransaction({ payer, blockhash: BLOCKHASH, computeUnitLimit: HQ_TX.simpleComputeUnits, priorityFeeLamports: HQ_TX.simplePriorityFeeLamports, instructions }).message;
  const refused = (fn, clause) => { try { fn(); return false; } catch (e) { return e.clause === clause; } };
  ok("HQ's fees stay under the bots' 200,000 micro-lamport-per-unit fence (trades and its own small transactions)", computeUnitPriceFor({ priorityFeeLamports: HQ_TX.priorityFeeLamports, computeUnitLimit: HQ_TX.pumpComputeUnits }) <= Number(MAX_PRIORITY_MICROLAMPORTS)
    && computeUnitPriceFor({ priorityFeeLamports: HQ_TX.simplePriorityFeeLamports, computeUnitLimit: HQ_TX.simpleComputeUnits }) <= Number(MAX_PRIORITY_MICROLAMPORTS) && MAX_PRIORITY_MICROLAMPORTS === 200_000n);
  ok("…and a transaction paying the trade fee over the small limit is refused, not waved through", refused(() => checkWrapMessage(buildUnsignedTransaction({ payer: wallet, blockhash: BLOCKHASH, computeUnitLimit: HQ_TX.simpleComputeUnits, priorityFeeLamports: HQ_TX.priorityFeeLamports, instructions: wrapInstructions({ wallet, lamports: 5_000_000n }) }).message, { wallet, lamports: 5_000_000n }), "compute_budget"));
  ok("a wrap as built passes", checkWrapMessage(msgOf(wrapInstructions({ wallet, lamports: 5_000_000n })), { wallet, lamports: 5_000_000n }) === true);
  ok("…a wrap of another amount than planned is refused", refused(() => checkWrapMessage(msgOf(wrapInstructions({ wallet, lamports: 6_000_000n })), { wallet, lamports: 5_000_000n }), "amount"));
  ok("…a wrap paid by someone else is refused", refused(() => checkWrapMessage(msgOf(wrapInstructions({ wallet, lamports: 5_000_000n }), attacker), { wallet, lamports: 5_000_000n }), "fee_payer"));
  ok("an unwrap as built passes; one closing to another wallet is refused", checkUnwrapMessage(msgOf(unwrapInstructions({ wallet })), { wallet }) === true
    && refused(() => checkUnwrapMessage(msgOf([new TransactionInstruction({ programId: new PublicKey(TOKEN_PROGRAM), data: Buffer.from([9]), keys: [
      { pubkey: new PublicKey(associatedTokenAddress(wallet, "So11111111111111111111111111111111111111112", TOKEN_PROGRAM)), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(attacker), isSigner: false, isWritable: true }, { pubkey: new PublicKey(wallet), isSigner: true, isWritable: false }] })]), { wallet }), "instructions"));
  const memo = memoFor("withdraw", 1);
  ok("a transfer to the treasury with HQ's memo passes", checkTransferMessage(msgOf(transferInstructions({ wallet, treasury, lamports: 7n, memo })), { wallet, treasury, lamports: 7n, memo }) === true);
  ok("…the same transfer to any other address is refused (destination)", refused(() => checkTransferMessage(msgOf(transferInstructions({ wallet, treasury: attacker, lamports: 7n, memo })), { wallet, treasury, lamports: 7n, memo }), "destination"));
  ok("…with another amount, refused", refused(() => checkTransferMessage(msgOf(transferInstructions({ wallet, treasury, lamports: 8n, memo })), { wallet, treasury, lamports: 7n, memo }), "amount"));
  ok("…with a memo that is not HQ's, refused", refused(() => checkTransferMessage(msgOf(transferInstructions({ wallet, treasury, lamports: 7n, memo: "gm" })), { wallet, treasury, lamports: 7n, memo: "gm" }), "memo"));
  ok("…with a second transfer slipped in, refused", refused(() => checkTransferMessage(msgOf([...transferInstructions({ wallet, treasury, lamports: 7n, memo }), SystemProgram.transfer({ fromPubkey: new PublicKey(wallet), toPubkey: new PublicKey(attacker), lamports: 1n })]), { wallet, treasury, lamports: 7n, memo }), "instructions"));
  ok("…and with no HQ_TREASURY_ADDRESS at all, nothing is sent anywhere", refused(() => checkTransferMessage(msgOf(transferInstructions({ wallet, treasury, lamports: 7n, memo })), { wallet, treasury: null, lamports: 7n, memo }), "no_treasury"));
  ok("a burn of the bought $CIA as built passes; a burn of more is refused", checkBurnMessage(msgOf(burnInstructions({ owner: wallet, mint: CIA_MINT, amountRaw: 5n, decimals: 6 })), { owner: wallet, mint: CIA_MINT, amountRaw: 5n, decimals: 6 }) === true
    && refused(() => checkBurnMessage(msgOf(burnInstructions({ owner: wallet, mint: CIA_MINT, amountRaw: 6n, decimals: 6 })), { owner: wallet, mint: CIA_MINT, amountRaw: 5n, decimals: 6 }), "amount"));

  /* End to end: the executor's transfer names no destination of its own; it is the treasury. */
  const db = memDb();
  const spies = signingSpies();
  const ex = createExecutor({ config: testConfig({ ...liveEnv, HQ_TREASURY_ADDRESS: treasury }), db, rpc: simpleChain({ wallet, status: () => ({ confirmationStatus: "confirmed" }), sim: () => ({ err: null, accounts: [{ lamports: Number(2n * SOL - 100_000_000n - 55_000n) }] }) }), jupiter: null, signers: spies, sleep: async () => {} });
  await ex.transferToTreasury({ owner: liveOwner(1, wallet), lamports: 100_000_000n, memo, to: attacker });
  const sent = readMessage(VersionedTransaction.deserialize(Buffer.from(spies.calls.agent[0].txBase64, "base64")).message);
  const moved = sent.instructions.find((i) => i.programId === "11111111111111111111111111111111");
  ok("the executor's transfer goes to HQ_TREASURY_ADDRESS whatever else it is handed", moved.accounts[1].pubkey === treasury && !JSON.stringify(sent).includes(attacker));
  ok("the owner's withdrawal refuses outright when no treasury address is set", await (async () => { try { await withdrawToTreasury({ config: testConfig(liveEnv), db, rpc: extRpc({}), executor: ex, agent: { id: 1, wallet, mode: "live" }, lamports: 1n }); return false; } catch (e) { return /HQ_TREASURY_ADDRESS/.test(e.message); } })());
}

section("A PUMP.FUN BUY: THE BOTS' BUY CHECK, THE SIMULATION, THEN THE KEY");
{
  const wallet = addr(26), mint = addr(27), creator = addr(28), feeRecipient = addr(29), buyback = addr(30);
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
  const key = (k) => new PublicKey(k).toBuffer();
  const curve = { vBase: 1_073_000_000_000_000n, vQuote: 30_000_000_000n, realBase: 793_100_000_000_000n, realQuote: 0n };
  const curveAcc = (complete = false) => { const b = Buffer.alloc(115); Buffer.from(BONDING_CURVE_DISCRIMINATOR, "hex").copy(b, 0); u64(curve.vBase).copy(b, 8); u64(curve.vQuote).copy(b, 16); u64(curve.realBase).copy(b, 24); u64(curve.realQuote).copy(b, 32); u64(1_000_000_000_000_000n).copy(b, 40); b[48] = complete ? 1 : 0; key(creator).copy(b, 49); return { data: [b.toString("base64"), "base64"], owner: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", lamports: 1_500_000 }; };
  const globalAcc = () => { const b = Buffer.alloc(1_000); Buffer.from(GLOBAL_DISCRIMINATOR, "hex").copy(b, 0); b[8] = 1; key(feeRecipient).copy(b, 41); for (let i = 0; i < 7; i++) key(feeRecipient).copy(b, 162 + i * 32); key(feeRecipient).copy(b, 483); for (let i = 0; i < 7; i++) key(feeRecipient).copy(b, 516 + i * 32); for (let i = 0; i < 8; i++) key(buyback).copy(b, 741 + i * 32); return { data: [b.toString("base64"), "base64"], owner: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", lamports: 1 }; };
  const mintAcc = (program) => ({ data: [Buffer.alloc(82).toString("base64"), "base64"], owner: program, lamports: 1 });
  const ata = associatedTokenAddress(wallet, mint, TOKEN_2022_PROGRAM);
  const WALLET_LAMPORTS = 1n * SOL;
  const chain = ({ complete = false, program = TOKEN_2022_PROGRAM, drain = 0n } = {}) => extRpc({
    getMultipleAccounts: ([list]) => ({ slot: 400_000_000, accounts: list.map((a) => a === bondingCurveAddress(mint).toBase58() ? curveAcc(complete) : a === globalAddress().toBase58() ? globalAcc() : a === mint ? mintAcc(program)
      : a === wallet ? { lamports: Number(WALLET_LAMPORTS), owner: "11111111111111111111111111111111", data: ["", "base64"] } : null) }),
    getLatestBlockhash: () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1_150 }),
    simulateTransaction: ([txBase64]) => {
      const m = readMessage(VersionedTransaction.deserialize(Buffer.from(txBase64, "base64")).message);
      const d = decodeBuyIx(m.instructions.find((i) => i.programId === "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P").data);
      return { err: null, unitsConsumed: 120_000, accounts: [
        { lamports: Number(WALLET_LAMPORTS - d.maxQuoteInRaw - 55_000n - 2_039_280n - drain), owner: "11111111111111111111111111111111", data: ["", "base64"] },
        { lamports: 2_039_280, owner: TOKEN_2022_PROGRAM, data: [tokenAccountData({ mint, owner: wallet, amount: d.baseOutRaw }).toString("base64"), "base64"] }] };
    },
    sendTransaction: () => "sent", getSignatureStatus: () => ({ confirmationStatus: "confirmed", err: null }), getBlockHeight: () => 1_000, getTransaction: () => null,
  });
  const decoded = PUMPFUN_VENUE.curveFromAccount(curveAcc(), { feeBps: Number(PUMPFUN_VENUE.feeObservation?.totalFeeBps), mint });
  const plan = planSnipeCeiling({ curve: snipeCurveState(decoded), adapter: PUMPFUN_VENUE, solLamports: parseSol("0.01"), cfg: {} });
  const run = async (opts) => {
    const spies = signingSpies();
    const db = memDb();
    const ex = createExecutor({ config: testConfig(liveEnv), db, rpc: chain(opts), jupiter: null, signers: spies, sleep: async () => {} });
    let error = null, result = null;
    try { result = await ex.pumpBuy({ owner: liveOwner(1, wallet), mint, baseOutRaw: plan.baseOutRaw, maxQuoteInRaw: plan.maxQuoteInRaw }); } catch (e) { error = e; }
    return { spies, db, error, result };
  };
  const good = await run();
  ok("the planned buy is built, checked, simulated and signed once", !good.error && good.spies.calls.agent.length === 1 && good.result.signature, good.error?.message);
  const signedMsg = VersionedTransaction.deserialize(Buffer.from(good.spies.calls.agent[0].txBase64, "base64")).message;
  ok("…what the key signed passes the bots' own dev-buy check (one idempotent account create, one buy_v2 of this mint, for this wallet, under its ceiling)", checkDevBuyMessage(signedMsg, { wallet, mint, maxSpendLamports: plan.maxQuoteInRaw }) === true);
  const buyIx = readMessage(signedMsg).instructions.find((i) => i.programId === "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
  ok("…for exactly the planned tokens and ceiling, into the wallet's own Token-2022 account", decodeBuyIx(buyIx.data).baseOutRaw === plan.baseOutRaw && decodeBuyIx(buyIx.data).maxQuoteInRaw === plan.maxQuoteInRaw && buyIx.accounts[14].pubkey === ata);
  const drained = await run({ drain: parseSol("0.5") });
  ok("a simulation that would take more than the ceiling plus fee and rent: refused before the key is asked", drained.error?.clause === "simulation_failed" && drained.spies.calls.agent.length === 0 && drained.db.openIntents().length === 0);
  const grad = await run({ complete: true });
  ok("a graduated curve: refused (graduated), nothing signed", grad.error?.clause === "graduated" && grad.spies.calls.agent.length === 0);
  const classic = await run({ program: TOKEN_PROGRAM });
  ok("a coin that is not Token-2022 (the only kind the buy check passes): refused, nothing signed", classic.error?.clause === "token_program" && classic.spies.calls.agent.length === 0);
}

done();
