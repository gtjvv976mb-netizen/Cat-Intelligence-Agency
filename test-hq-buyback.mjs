/**
 * THE $CIA BUYBACK: THE POLICY'S MATHS, THE PATH AND ITS ALLOWLIST, OFF BY DEFAULT, AND ONE RUN
 * END TO END ON SCRIPTED LEGS.
 *
 *   · $CIA as mainnet returned it (fixtures/hq/cia-accounts.json, read by the live check):
 *     Token-2022, 6 decimals, both authorities revoked, its pump.fun curve quoted in HYPE — so the
 *     path is SOL → HYPE → $CIA, each leg a direct Jupiter route, and the allowlist exactly those;
 *   · the budget: revenue × share − already spent, held to the per-run maximum and to what the
 *     treasury holds above its reserve, nothing under the minimum;
 *   · revenue is only what agent wallets sent the treasury with HQ's fee and profit memos;
 *   · off unless HQ_BUYBACK_LIVE=1, the treasury key, a share above 0, the owner's RPC and no kill;
 *   · a recorded Jupiter swap for another pair is refused by the allowlist (pair_not_allowed);
 *   · a run: wrap, leg one, leg two spending exactly what leg one delivered, the burn; recorded
 *     with every signature, on the stream, and on /v1/buybacks.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bs58 from "bs58";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { harness, ROOT } from "./bots/test/doubles.mjs";
import { buybackBudget, buybackPath, treasuryFlows, readCia, assertCiaFacts, runBuyback, buybackItem, BUYBACK_FEE_ROOM } from "./services/hq/lib/buyback.mjs";
import { readConfig, CIA_MINT, CIA_FACTS, ConfigError } from "./services/hq/lib/config.mjs";
import { memoFor, MEMO_PROGRAMS } from "./services/hq/lib/classify.mjs";
import { buybacksObject, treasuryObject, summaryObject } from "./services/hq/lib/views.mjs";
import { SCHEMAS, validate } from "./services/hq/contract/schemas.mjs";
import { checkSwapTransaction, loadLookupTables, lookupTableKeysOf, SwapCheckError } from "./src/lib/jupiter-swap.mjs";
import { WSOL_MINT } from "./bots/lib/verified.mjs";
import { extRpc, memDb, testConfig, testClock, addr, hqFixture, jsonTx } from "./services/hq/test/doubles.mjs";
import { parseSol } from "./services/hq/lib/amounts.mjs";

const { ok, section, done } = harness("test-hq-buyback");
const SOL = 1_000_000_000n;
const HYPE = "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g";
const CIA = hqFixture("cia-accounts.json");
const fakeSig = () => bs58.encode(crypto.randomBytes(64));
const SYS = "11111111111111111111111111111111";

section("$CIA, AS MAINNET RETURNED IT");
{
  const rpc = extRpc({ getMultipleAccounts: ([list]) => ({ slot: CIA.slot, accounts: list.map((a) => (a === CIA_MINT ? CIA.mintAccount : a === CIA.curve ? CIA.curveAccount : null)) }) });
  const { facts, curve } = await readCia(rpc);
  ok("Token-2022, 6 decimals — the facts the buyback is verified against", facts.program === CIA_FACTS.program && facts.decimals === CIA_FACTS.decimals && facts.program === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  ok("mint and freeze authority revoked; 1,000,000,000 $CIA in all", facts.mintAuthority === null && facts.freezeAuthority === null && facts.supplyRaw === "1000000000000000");
  ok("its pump.fun curve is quoted in HYPE, not SOL, and has not graduated", curve.quoteMint === HYPE && curve.complete === false);
  ok("assertCiaFacts passes these facts", (() => { try { assertCiaFacts(facts); return true; } catch { return false; } })());
  ok("…and stops a run on a mismatch (9 decimals)", (() => { try { assertCiaFacts({ ...facts, decimals: 9 }); return false; } catch (e) { return e.clause === "cia_mismatch"; } })());
  ok("…or on another program", (() => { try { assertCiaFacts({ ...facts, program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }); return false; } catch (e) { return e.clause === "cia_mismatch"; } })());
}

section("THE PATH AND ITS ALLOWLIST");
{
  const p = buybackPath({ curveQuote: HYPE });
  ok("quoted in HYPE: two legs, SOL → HYPE → $CIA", JSON.stringify(p.legs) === JSON.stringify([[WSOL_MINT, HYPE], [HYPE, CIA_MINT]]) && p.intermediate === HYPE);
  ok("the allowlist is exactly those two pairs, and nothing the other way", [...p.allowedPairs].sort().join() === [`${WSOL_MINT}>${HYPE}`, `${HYPE}>${CIA_MINT}`].sort().join() && !p.allowedPairs.has(`${CIA_MINT}>${WSOL_MINT}`) && !p.allowedPairs.has(`${HYPE}>${WSOL_MINT}`));
  const direct = buybackPath({ curveQuote: WSOL_MINT });
  ok("had the curve been SOL-quoted (or after it graduates to a SOL pool): one leg, SOL → $CIA only", direct.legs.length === 1 && [...direct.allowedPairs].join() === `${WSOL_MINT}>${CIA_MINT}`);

  /* A real Jupiter transaction for another pair (10 USDC → JUP), refused by the buyback's list. */
  const J = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "agent", "jupiter-usdc-jup-swap.json"), "utf8"));
  const alts = J.lookupTables.map((t) => ({ owner: t.owner, data: t.data }));
  const tables = await loadLookupTables({ async getMultipleAccounts(a) { return { accounts: a.map((x) => alts[J.lookupTables.findIndex((t) => t.address === x)]) }; } }, lookupTableKeysOf(J.swapBuy.swapTransaction));
  const TK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const args = (allowedPairs) => ({ txBase64: J.swapBuy.swapTransaction, wallet: J.user, inputMint: J.settlementMint, outputMint: J.tokenMint, inputProgram: TK, outputProgram: TK, amountRaw: J.quoteBuy.inAmount,
    quote: J.quoteBuy, slippageCapBps: 100, lookupTables: tables, maxPriorityFeeLamports: 50_000, allowedPairs });
  const clause = (allowedPairs) => { try { checkSwapTransaction(args(allowedPairs)); return "passed"; } catch (e) { return e instanceof SwapCheckError ? e.clause : e.message; } };
  ok("the recorded USDC → JUP swap passes the check when its own pair is allowed (the check is real)", clause(new Set([`${J.settlementMint}>${J.tokenMint}`])) === "passed");
  ok("…and is refused under the buyback's allowlist: pair_not_allowed", clause(p.allowedPairs) === "pair_not_allowed");
}

section("THE BUDGET");
{
  const base = { revenueLamports: parseSol("1"), spentLamports: 0n, sharePct: 25, maxPerRunLamports: parseSol("0.05"), treasuryCashLamports: 2n * SOL, reserveLamports: parseSol("0.05"), minLamports: parseSol("0.002") };
  const b = buybackBudget(base);
  ok("25% of 1 SOL of revenue is 0.25 SOL owed; this run spends the 0.05 SOL maximum", b.entitled === parseSol("0.25") && b.owed === parseSol("0.25") && b.spend === parseSol("0.05") && b.why === "the per-run maximum");
  ok("what was spent already is not owed again", buybackBudget({ ...base, spentLamports: parseSol("0.24") }).spend === parseSol("0.01"));
  ok("nothing is owed once revenue × share is spent", buybackBudget({ ...base, spentLamports: parseSol("0.25") }).spend === 0n && /nothing is owed/.test(buybackBudget({ ...base, spentLamports: parseSol("0.3") }).why));
  ok("never more than the treasury holds above its reserve and the legs' fee room", buybackBudget({ ...base, treasuryCashLamports: parseSol("0.08") }).spend === parseSol("0.08") - parseSol("0.05") - BUYBACK_FEE_ROOM);
  ok("under the minimum, nothing (said why)", buybackBudget({ ...base, spentLamports: parseSol("0.249") }).spend === 0n && /minimum/.test(buybackBudget({ ...base, spentLamports: parseSol("0.249") }).why));
  ok("a share of 0 buys nothing", buybackBudget({ ...base, sharePct: 0 }).spend === 0n);
  ok("a share with a fraction (12.5%) is exact in basis points", buybackBudget({ ...base, sharePct: 12.5, maxPerRunLamports: 10n * SOL }).spend === parseSol("0.125"));
}

/* The treasury's own history, hand-made: what agent wallets sent it and what it sent them. */
const treasury = addr(1), agentW = addr(2), stranger = addr(3), treasuryHypeAcc = addr(4);
const memo = (text) => ({ program: MEMO_PROGRAMS[0], accounts: [], data: Buffer.from(text, "utf8") });
const transfer = (from, to, lamports) => ({ program: SYS, accounts: [from, to], data: Buffer.from(SystemProgram.transfer({ fromPubkey: new PublicKey(from), toPubkey: new PublicKey(to), lamports }).data) });
const send = ({ signature, slot, from, to, lamports, note = null }) => jsonTx({ signature, slot, keys: note ? [from, to, SYS, MEMO_PROGRAMS[0]] : [from, to, SYS],
  balances: { [from]: [10n * SOL, 10n * SOL - lamports - 5_000n], [to]: [5n * SOL, 5n * SOL + lamports] }, instructions: [transfer(from, to, lamports), ...(note ? [memo(note)] : [])] });
const leg1Sig = fakeSig();
const HISTORY = [
  send({ signature: fakeSig(), slot: 10, from: treasury, to: agentW, lamports: SOL }),
  send({ signature: fakeSig(), slot: 11, from: agentW, to: treasury, lamports: parseSol("0.2"), note: memoFor("fee_sweep", 2) }),
  send({ signature: fakeSig(), slot: 12, from: agentW, to: treasury, lamports: parseSol("0.1"), note: memoFor("profit_sweep", 2) }),
  send({ signature: fakeSig(), slot: 13, from: agentW, to: treasury, lamports: parseSol("0.5"), note: memoFor("withdraw", 2) }),
  send({ signature: fakeSig(), slot: 14, from: stranger, to: treasury, lamports: parseSol("3") }),
  send({ signature: fakeSig(), slot: 15, from: stranger, to: treasury, lamports: parseSol("7"), note: memoFor("profit_sweep", 2) }),
  jsonTx({ signature: leg1Sig, slot: 16, keys: [treasury, treasuryHypeAcc], balances: { [treasury]: [5n * SOL, 5n * SOL - parseSol("0.05") - 5_000n] }, tokens: [{ index: 1, owner: treasury, mint: HYPE, pre: 0, post: 1_000_000 }] }),
];

section("REVENUE: ONLY WHAT AGENTS SENT HOME WITH HQ'S MEMOS");
{
  const f = treasuryFlows({ rows: HISTORY.map((tx) => ({ tx })), treasury, agentWallets: new Map([[agentW, 2]]), buybacks: [{ legSigs: [leg1Sig] }] });
  ok("fee_in 0.2 SOL (cia-hq:fee_sweep) and profit_in 0.1 SOL (cia-hq:profit_sweep): 0.3 SOL of revenue", f.feeIn === parseSol("0.2") && f.profitIn === parseSol("0.1") && f.revenue === parseSol("0.3"));
  ok("an agent's withdrawal back home is funding_in, not revenue", f.fundingIn === parseSol("0.5"));
  ok("funding an agent is funding_out", f.fundingOut === SOL);
  ok("SOL from anyone else is not revenue and not listed — even with an HQ memo on it", f.flows.every((x) => x.kind !== "fee_in" || x.lamports === parseSol("0.2")) && f.flows.length === 5 && !f.flows.some((x) => x.lamports === parseSol("3") || x.lamports === parseSol("7")));
  ok("a recorded buyback's first leg is listed as buyback", f.flows.some((x) => x.kind === "buyback" && x.tx === leg1Sig) && f.buybackSpent > parseSol("0.05"));
  const db = memDb();
  for (const tx of HISTORY) db.putChainTx({ address: treasury, signature: tx.transaction.signatures[0], slot: tx.slot, blockTime: tx.blockTime, err: false, tx });
  db.createAgent({ id: 2, name: "Agent Two", cat: "popcat", skin: "standard", strategy: "popcat-scout", mode: "live", status: "active", wallet: agentW, limits: {}, settings: {}, paperBankroll: 1n });
  const t = treasuryObject({ db, config: testConfig({ HQ_TREASURY_ADDRESS: treasury }), balances: { sol: 3n * SOL, cia: 0n } });
  ok("/v1/treasury lists the flows in the contract's shape", validate(SCHEMAS.Treasury, t).length === 0 && t.flows.length === 4, JSON.stringify(validate(SCHEMAS.Treasury, t)));
}

section("OFF BY DEFAULT");
{
  const never = new Proxy({}, { get: () => () => { throw new Error("the executor was asked"); } });
  const rpcNever = extRpc({});
  const db = memDb();
  const tries = [
    ["nothing set", {}, "ok", /HQ_BUYBACK_LIVE is not 1/],
    ["HQ_BUYBACK_LIVE=1 without the treasury key", { HQ_BUYBACK_LIVE: "1" }, "missing", /treasury key is missing/],
    ["…with a key for another address", { HQ_BUYBACK_LIVE: "1" }, "mismatch", /treasury key is mismatch/],
    ["…with the key but no HQ_TREASURY_ADDRESS", { HQ_BUYBACK_LIVE: "1" }, "ok", /HQ_TREASURY_ADDRESS is not set/],
    ["…with the address but no RPC of the owner's", { HQ_BUYBACK_LIVE: "1", HQ_TREASURY_ADDRESS: treasury }, "ok", /no RPC/],
    ["…under the kill switch", { HQ_BUYBACK_LIVE: "1", HQ_TREASURY_ADDRESS: treasury, HQ_RPC_URL: "https://rpc.test.invalid/x", HQ_KILL: "1" }, "ok", /kill switch/],
    ["…with every switch on but a share of 0 (the default)", { HQ_BUYBACK_LIVE: "1", HQ_TREASURY_ADDRESS: treasury, HQ_RPC_URL: "https://rpc.test.invalid/x" }, "ok", /SHARE_PCT is 0/],
  ];
  for (const [what, env, ready, why] of tries) {
    const r = await runBuyback({ config: testConfig(env), db, rpc: rpcNever, executor: never, treasuryReady: ready });
    ok(`${what}: no run (${r.why})`, r.ran === false && why.test(r.why));
  }
  ok("…and in none of them was the chain read, or anything built", rpcNever.calls.length === 0 && db.listBuybacks().length === 0);
  const c = readConfig({});
  ok("the defaults: share 0, destination treasury, every six hours at :17, at most 0.05 SOL a run", c.buybackSharePct === 0 && c.buybackDestination === "treasury" && c.buybackCron === "17 */6 * * *" && c.buybackMaxPerRun === parseSol("0.05") && c.buybackLive === false);
  ok("a destination other than burn or treasury is refused at start", (() => { try { readConfig({ HQ_BUYBACK_DESTINATION: "moon" }); return false; } catch (e) { return e instanceof ConfigError; } })());
  ok("a share over 100% is refused at start", (() => { try { readConfig({ HQ_BUYBACK_SHARE_PCT: "101" }); return false; } catch (e) { return e instanceof ConfigError; } })());
}

section("ONE RUN, END TO END, ON SCRIPTED LEGS");
{
  const clock = testClock();
  const db = memDb(clock);
  for (const tx of HISTORY.slice(0, 6)) db.putChainTx({ address: treasury, signature: tx.transaction.signatures[0], slot: tx.slot, blockTime: tx.blockTime, err: false, tx });
  db.createAgent({ id: 2, name: "Agent Two", cat: "popcat", skin: "standard", strategy: "popcat-scout", mode: "live", status: "active", wallet: agentW, limits: {}, settings: {}, paperBankroll: 1n });
  const hypeMint = { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", lamports: 1, data: [(() => { const b = Buffer.alloc(82); b[44] = 6; b[45] = 1; return b.toString("base64"); })(), "base64"] };
  const rpc = extRpc({
    getMultipleAccounts: ([list]) => ({ slot: CIA.slot, accounts: list.map((a) => (a === CIA_MINT ? CIA.mintAccount : a === CIA.curve ? CIA.curveAccount : a === HYPE ? hypeMint : null)) }),
    getBalance: () => SOL, getTokenAccountsByOwner: () => [],
  });
  const calls = [];
  const delivered = { [HYPE]: 4_321_000n, [CIA_MINT]: 987_654_321n };
  const executor = {
    async wrap({ owner, lamports }) { calls.push(["wrap", owner.kind, owner.wallet, lamports]); return { signature: fakeSig() }; },
    async jupiterSwap(a) {
      calls.push(["swap", a.owner.kind, a.pay.mint, a.get.mint, a.amountRaw, [...a.allowedPairs].sort().join()]);
      const signature = fakeSig();
      return { signature, tx: jsonTx({ signature, keys: [treasury, addr(5)], balances: { [treasury]: [SOL, SOL - 5_000n] }, tokens: [{ index: 1, owner: treasury, mint: a.get.mint, pre: 0, post: delivered[a.get.mint] }] }) };
    },
    async burn(a) { calls.push(["burn", a.owner.kind, a.mint, a.amountRaw, a.decimals]); return { signature: fakeSig() }; },
  };
  const config = testConfig({ HQ_BUYBACK_LIVE: "1", HQ_TREASURY_ADDRESS: treasury, HQ_RPC_URL: "https://rpc.test.invalid/x", HQ_BUYBACK_SHARE_PCT: "50", HQ_BUYBACK_DESTINATION: "burn" });
  const r = await runBuyback({ config, db, rpc, executor, treasuryReady: "ok", clock });
  ok("it ran", r.ran === true, r.why);
  ok("from the treasury only: every step is the treasury's", calls.every((c) => c[1] === "treasury"));
  ok("wrap 0.05 SOL (0.3 SOL revenue × 50% = 0.15 owed, held to the 0.05 maximum)", calls[0][0] === "wrap" && calls[0][3] === parseSol("0.05"));
  ok("leg one: SOL → HYPE, 0.05 SOL, under the two-pair allowlist", calls[1][0] === "swap" && calls[1][2] === WSOL_MINT && calls[1][3] === HYPE && calls[1][4] === parseSol("0.05") && calls[1][5] === [`${WSOL_MINT}>${HYPE}`, `${HYPE}>${CIA_MINT}`].sort().join());
  ok("leg two: HYPE → $CIA, spending exactly what leg one delivered", calls[2][2] === HYPE && calls[2][3] === CIA_MINT && calls[2][4] === delivered[HYPE]);
  ok("then the burn: exactly the $CIA bought, at $CIA's 6 decimals", calls[3][0] === "burn" && calls[3][2] === CIA_MINT && calls[3][3] === delivered[CIA_MINT] && calls[3][4] === 6);
  const row = db.listBuybacks()[0];
  ok("recorded: done, both legs' signatures and the burn's, SOL spent and $CIA bought", row.state === "done" && row.legSigs.length === 2 && row.burn_sig && row.sol_spent === String(parseSol("0.05")) && row.cia_bought === String(delivered[CIA_MINT]));
  const ev = db.eventsAfter(0, 10).find((e) => e.kind === "buyback");
  ok("on the stream, in the contract's shape", ev && validate(SCHEMAS.BuybackItem, ev.data).length === 0 && ev.data.solSpent === "0.05" && ev.data.ciaBought === "987.654321" && ev.data.burnTx === row.burn_sig);
  const page = buybacksObject({ db, config, limit: 50 });
  ok("/v1/buybacks: the policy as configured and the item", validate(SCHEMAS.Buybacks, page).length === 0 && page.policy.sharePct === "50" && page.policy.destination === "burn" && page.items.length === 1);
  const s2 = await runBuyback({ config, db, rpc, executor, treasuryReady: "ok", clock });
  const s3 = await runBuyback({ config, db, rpc, executor, treasuryReady: "ok", clock });
  const s4 = await runBuyback({ config, db, rpc, executor, treasuryReady: "ok", clock });
  ok("the next runs spend what is still owed (0.05, 0.05), then nothing: never more than revenue × share", s2.ran && s3.ran && s4.ran === false && /nothing is owed/.test(s4.why), s4.why);

  /* A run that stops between the legs still counts what it spent. */
  const db2 = memDb(clock);
  for (const tx of HISTORY.slice(0, 6)) db2.putChainTx({ address: treasury, signature: tx.transaction.signatures[0], slot: tx.slot, blockTime: tx.blockTime, err: false, tx });
  db2.createAgent({ id: 2, name: "Agent Two", cat: "popcat", skin: "standard", strategy: "popcat-scout", mode: "live", status: "active", wallet: agentW, limits: {}, settings: {}, paperBankroll: 1n });
  let legs = 0;
  const flaky = { ...executor, async jupiterSwap(a) { legs++; if (a.get.mint === CIA_MINT) throw Object.assign(new Error("leg two failed"), { clause: "simulation_failed" }); return executor.jupiterSwap(a); } };
  const p1 = await runBuyback({ config, db: db2, rpc, executor: flaky, treasuryReady: "ok", clock });
  ok("a run that stops after leg one is recorded partial, with leg one's signature", p1.ran === false && db2.listBuybacks()[0].state === "partial" && db2.listBuybacks()[0].legSigs.length === 1);
  ok("…is not shown as a completed buyback", buybacksObject({ db: db2, config, limit: 50 }).items.length === 0);
  await runBuyback({ config, db: db2, rpc, executor: flaky, treasuryReady: "ok", clock });
  await runBuyback({ config, db: db2, rpc, executor: flaky, treasuryReady: "ok", clock });
  const p4 = await runBuyback({ config, db: db2, rpc, executor: flaky, treasuryReady: "ok", clock });
  ok("…and its SOL counts as spent: after three such runs nothing more is owed", p4.ran === false && /nothing is owed/.test(p4.why) && legs === 6, p4.why);
}

done();
