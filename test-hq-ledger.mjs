/**
 * THE LEDGER, FROM RECORDED TRANSACTIONS: EVERY NUMBER HQ PUBLISHES STARTS HERE.
 *
 * Two real wallets' whole histories, read off mainnet on 2026-09-25 (fixtures/hq/ledger/), read
 * as if they were agent wallets:
 *   A  45j71Q8C…: a deposit, a pump.fun round trip (a buy that opened its token account and a
 *      sell that closed it), three creator-fee claims of an empty vault, withdrawals, a deposit
 *      and a withdrawal of everything;
 *   B  3inPGc88…: deposits (dust included), a round trip on another launchpad that left dust, a
 *      token moved out by hand, a pump.fun creator-fee claim and four PumpSwap ones, withdrawals.
 * Each figure is checked against the raw balance arrays the transactions carry, not against the
 * code that computes it; then: fees never in trading P&L, the cash equal to the chain's own final
 * balance, the indexer paging and labelling, a paper ledger by hand, and the contract's stats.
 * And the review's cases, each a regression test: the accounting identity over every recorded
 * wallet; a Jupiter sell that opens the wallet's wSOL account out of its proceeds; a token moved
 * out; the return over what was deposited; the drawdown and the chart from marked values; a
 * period's return without fees; the indexer never skipping a transaction, and retrying.
 */
import { harness, hqFixture, memDb, testConfig, testClock, extRpc, addr, jsonTx } from "./services/hq/test/doubles.mjs";
import { classifyTransaction, accountKeysOf, walletView } from "./services/hq/lib/classify.mjs";
import fs from "node:fs";
import path from "node:path";
import { buildLedger, periodTradingPnl, realizedSince, unrealizedAt } from "./services/hq/lib/ledger.mjs";
import { createIndexer } from "./services/hq/lib/indexer.mjs";
import { createRuntime } from "./services/hq/lib/runtime.mjs";
import { liveTradeId } from "./services/hq/lib/db.mjs";
import { agentObject, equitySeries, leaderboard } from "./services/hq/lib/views.mjs";
import { WSOL_MINT } from "./bots/lib/verified.mjs";
import { ROOT } from "./services/hq/test/doubles.mjs";
import { validate, SCHEMAS } from "./services/hq/contract/schemas.mjs";

const { ok, section, done } = harness("test-hq-ledger");
const SOL_ = 1_000_000_000n;
const A = hqFixture("ledger/45j71Q8CPW14SLD9ZEo9ouQHHgYS9NbLH4bXrw2Yi3ms.json");
const B = hqFixture("ledger/3inPGc88YuabgXVhgZ4DtYjmMW86y5WYW3FVddN7NpLU.json");
const txBy = (f, prefix) => f.transactions.find((t) => t.transaction.signatures[0].startsWith(prefix));
/* The wallet's native lamport change in one transaction, straight from the arrays. */
const native = (tx, w) => { const i = accountKeysOf(tx).indexOf(w); return BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]); };
/* The lamports of the wallet's own token accounts before and after, straight from the arrays. */
const ownRent = (tx, w, when) => { const list = when === "pre" ? tx.meta.preTokenBalances : tx.meta.postTokenBalances; const b = when === "pre" ? tx.meta.preBalances : tx.meta.postBalances;
  return (list ?? []).filter((x) => x.owner === w).reduce((s, x) => s + BigInt(b[x.accountIndex]), 0n); };
const eventsOf = (f) => f.transactions.map((tx) => classifyTransaction(tx, { wallet: f.wallet })).filter(Boolean);

section("WALLET A: A DEPOSIT, A ROUND TRIP, EMPTY CLAIMS, WITHDRAWALS");
{
  const w = A.wallet;
  const ev = eventsOf(A);
  const L = buildLedger(ev);
  const dep1 = txBy(A, "2eGy5tYG"), buy = txBy(A, "26enRGFz"), sell = txBy(A, "7zoCH6ju"), dep2 = txBy(A, "3uCrPT3U");
  const e = (p) => ev.find((x) => x.signature.startsWith(p));
  ok("the first transaction, paid by someone else, is a deposit of exactly the lamports that arrived", e("2eGy5tYG").kind === "deposit" && e("2eGy5tYG").lamports === native(dep1, w) && native(dep1, w) === 112_139_280n);
  const buyCost = -native(buy, w) - (ownRent(buy, w, "post") - ownRent(buy, w, "pre"));
  ok("the buy costs what left the wallet, less the rent of its own new token account (a refundable deposit)", e("26enRGFz").kind === "trade" && e("26enRGFz").side === "buy" && e("26enRGFz").sol === buyCost && buyCost === 20_553_520n, String(buyCost));
  const sellGot = native(sell, w) + (ownRent(sell, w, "post") - ownRent(sell, w, "pre"));
  ok("the sell returns what arrived, less the rent its closed token account gave back", e("7zoCH6ju").side === "sell" && e("7zoCH6ju").sol === sellGot && sellGot === 654_150_881n, String(sellGot));
  ok("…so the round trip made proceeds − cost, and is a win", L.roundTrips.length === 1 && L.roundTrips[0].pnl === sellGot - buyCost && L.wins === 1 && L.losses === 0);
  ok("three claims of an empty creator vault are operations that cost their fee, never a fee earned", ev.filter((x) => x.kind === "ops" && /empty vault/.test(x.note ?? "")).length === 3 && L.feesClaimed === 0n);
  ok("deposits add up to the two deposit transactions", L.deposited === native(dep1, w) + native(dep2, w));
  const withdrawals = ev.filter((x) => x.kind === "withdrawal");
  ok("four withdrawals, each the lamports that left less its own fee", withdrawals.length === 4 && withdrawals.every((x) => x.lamports === -native(txBy(A, x.signature.slice(0, 8)), w) - x.fee) && L.withdrawn === 748_506_041n);
  ok("value that arrived in a transaction it paid for (no trade, no claim) is not trading: 'other'", L.other === 1_839_400n);
  ok("realized trading P&L = the round trip less every operation's fee", L.realized === (sellGot - buyCost) - L.opsCost && L.realized === 633_527_361n, String(L.realized));
  const last = A.transactions[0];
  ok("the ledger's cash and rent end where the chain says the wallet ended", L.cash + L.rent === BigInt(last.meta.postBalances[accountKeysOf(last).indexOf(w)]) && L.cash === 0n);
  ok("a wallet emptied by a withdrawal is not a drawdown", L.maxDrawdownPct < 1, `${L.maxDrawdownPct}%`);
  ok("nothing is left open", L.positions.length === 0);
}

section("WALLET B: A CREATOR-FEE CLAIM, AND FEES NEVER IN TRADING P&L");
{
  const w = B.wallet;
  const ev = eventsOf(B);
  const L = buildLedger(ev);
  const claim = txBy(B, "54HGm9oR");
  const e = ev.find((x) => x.signature.startsWith("54HGm9oR"));
  ok("pump.fun's collect_creator_fee is a fee: the lamports it added, net of its own fee", e.kind === "fee" && e.lamports === native(claim, w) && e.lamports === 85_127_369n);
  const swapClaims = ev.filter((x) => x.kind === "fee" && !x.signature.startsWith("54HGm9oR"));
  ok("PumpSwap's collect_coin_creator_fee (four, after the coin graduated) are fees too, never trading", swapClaims.length === 4 && swapClaims.every((x) => x.lamports === native(txBy(B, x.signature.slice(0, 8)), w)));
  ok("the fees line is the five claims", L.feesClaimed === 160_577_729n && L.fees.length === 5);
  const withoutFees = buildLedger(ev.filter((x) => x.kind !== "fee"));
  ok("TRADING P&L IS THE SAME WITH OR WITHOUT THE FEES: fees are their own line", withoutFees.realized === L.realized && withoutFees.feesClaimed === 0n && L.feesClaimed > 0n);
  ok("…and the portfolio differs by exactly the fees", L.portfolio - withoutFees.portfolio === L.feesClaimed);
  const rt = L.roundTrips[0];
  ok("the round trip that left 64,210 raw tokens of dust is closed, its dust's cost lost: a loss", L.roundTrips.length === 1 && rt.pnl === -30_762_342n && L.losses === 1 && L.wins === 0);
  const out = ev.find((x) => x.kind === "token_out");
  ok("a token moved out by hand leaves the book at its cost, realizing nothing", out && L.flows.some((f) => f.kind === "token_out" && f.atCost === 273_337_229n));
  ok("…as a withdrawal of that cost, listed with the tokens it moved (the dossier's transfers)", L.transfers.some((x) => x.kind === "withdrawal" && x.lamports === 273_337_229n && x.tokens?.mint === out.mint && x.tokens.raw === out.tokens && x.tx === out.signature));
  ok("dust deposits of 1 lamport are deposits, and all deposits add up", ev.filter((x) => x.kind === "deposit" && x.lamports === 1n).length >= 10 && L.deposited === 2_470_975_564n);
  ok("two SOL withdrawals, and the tokens moved out at their cost", L.withdrawn === 53_777_810n + 1_999_991_000n + 273_337_229n && L.transfers.filter((x) => x.kind === "withdrawal" && !x.tokens).length === 2);
  const last = B.transactions[0];
  const endNative = BigInt(last.meta.postBalances[accountKeysOf(last).indexOf(w)]);
  ok("the cash the ledger ends with is the chain's final native balance", L.cash === endNative && endNative === 9_121_835n);
  ok("the rent it holds is its two open token accounts' (2 × 2,039,280)", L.rent === 4_078_560n);
  /* the position's last fill, straight from the fixture: its last buy */
  const lastBuy = ev.filter((x) => x.kind === "trade" && x.mint === L.positions[0]?.mint).sort((a, b) => a.slot - b.slot).at(-1);
  const atLastFill = (L.positions[0].qty * lastBuy.sol) / lastBuy.tokens;
  ok("one position is open; with no quote it is valued at its last fill and said to be unpriced", L.positions.length === 1 && L.positions[0].priced === false && L.positions[0].value === atLastFill && L.unrealized === atLastFill - L.positions[0].cost, `${L.positions[0].value} vs ${atLastFill}`);
  const marked = buildLedger(ev, { marks: new Map([[L.positions[0].mint, { lamports: 1n, tokens: 1_000_000n }]]) });
  ok("with a mark, unrealized is value − cost and the portfolio follows", marked.unrealized === marked.positions[0].value - marked.positions[0].cost && marked.portfolio === marked.cash + marked.rent + marked.positions[0].value);
  ok("ROI is realized + unrealized over everything ever deposited (gross)", L.roiPct === Math.trunc(Number((L.realized + L.unrealized) * 10_000n / L.deposited)) / 100 && L.deposited === 2_470_975_564n);
}

section("CLASSIFYING: EACH RULE ON ITS OWN");
{
  const w = B.wallet;
  const v = walletView(txBy(B, "2wZfJQqW"), w);
  ok("the wallet view reads cash and rent from the arrays (a buy that opened a token account)", v.rentDelta === 2_039_280n && v.moved.length === 1 && v.paidByWallet);
  ok("a transaction that does not touch the wallet reads nothing", classifyTransaction(txBy(B, "2wZfJQqW"), { wallet: A.wallet }) === null);
  const failed = { ...txBy(B, "2wZfJQqW"), meta: { ...txBy(B, "2wZfJQqW").meta, err: { InstructionError: [0, "Custom"] } } };
  ok("a failed transaction the wallet paid for costs its fee and moves nothing else", classifyTransaction(failed, { wallet: w }).kind === "ops");
}

section("THE INDEXER: PAGES, CACHES, LABELS");
{
  const db = memDb();
  const sigs = [...A.transactions].map((t) => ({ signature: t.transaction.signatures[0], slot: t.slot, blockTime: t.blockTime, err: t.meta.err }));
  const byId = new Map(A.transactions.map((t) => [t.transaction.signatures[0], t]));
  let listed = 0, fetched = 0;
  const rpc = extRpc({
    getSignaturesForAddress: ([, opts]) => { listed++; const start = opts.before ? sigs.findIndex((s) => s.signature === opts.before) + 1 : 0; const end = opts.until ? sigs.findIndex((s) => s.signature === opts.until) : sigs.length; return sigs.slice(start, Math.min(end, start + opts.limit)); },
    getTransaction: ([sig]) => { fetched++; return byId.get(sig); },
  });
  const indexer = createIndexer({ db, rpc, pageSize: 5, maxPages: 10 });
  const first = await indexer.indexAddress(A.wallet);
  ok(`the whole history is read, in pages of 5 (${listed} pages, ${fetched} transactions)`, first.added === A.transactions.length && first.complete === true && listed === 3);
  const again = await indexer.indexAddress(A.wallet);
  ok("a second pass reads only what is new: nothing", again.added === 0);
  const sell = A.transactions.find((t) => t.transaction.signatures[0].startsWith("7zoCH6ju")).transaction.signatures[0];
  db.createIntent({ id: "i1", agentId: 1, wallet: A.wallet, kind: "sell", mint: null, trigger: "take_profit", decisionId: "d1" });
  db.updateIntent("i1", { state: "confirmed", signature: sell });
  const ev = indexer.eventsFor(A.wallet);
  ok("a trade HQ meant carries its intent's trigger and decision; one it never meant is 'manual'",
    ev.find((x) => x.signature === sell)?.trigger === "take_profit" && ev.find((x) => x.kind === "trade" && x.side === "buy")?.trigger === "manual");
  ok("the events rebuilt from the cache give the same ledger as the fixture", buildLedger(ev).realized === 633_527_361n);
}

section("THE RUNTIME'S BOOKS AND THE CONTRACT'S STATS, FOR A LIVE AGENT ON WALLET B");
{
  const clock = testClock(Date.parse("2026-09-25T12:00:00Z"));
  const db = memDb(clock);
  const config = testConfig();
  db.createAgent({ id: 7, name: "Agent Ledger", cat: "crying-cat", skin: "standard", strategy: "crying-cat-safe", mode: "live", status: "active", wallet: B.wallet, limits: { maxPerTradeSol: "0.05", maxOpenPositions: 3, stopLossPct: 8, takeProfitPct: 15, trailingStopPct: null, dailyLossLimitSol: "0.1" }, settings: {}, paperBankroll: 1_000_000_000n });
  for (const tx of B.transactions) db.putChainTx({ address: B.wallet, signature: tx.transaction.signatures[0], slot: tx.slot, blockTime: tx.blockTime, err: Boolean(tx.meta.err), tx });
  const indexer = createIndexer({ db, rpc: extRpc({}) });
  const runtime = createRuntime({ config, db, clock, indexer, market: { marks: async () => new Map(), curves: async () => new Map() }, rug: null, jupiter: null });
  const view = await runtime.refresh(7);
  const trades = db.listTrades(7, "live");
  ok("every trade from the chain is in the book with its signature as its tx, and a desk id made from it", trades.length === 11 && trades.every((t) => t.id === liveTradeId(t.tx) && /^[A-Za-z0-9_-]{1,64}$/.test(t.id) && t.mode === "live"));
  ok("…realized P&L is exactly the sum of its dated changes (what a period's P&L adds up)", view.ledger.realizedEvents.reduce((a, x) => a + x.amount, 0n) === view.ledger.realized);
  ok("the sell carries its P&L", trades.find((t) => t.side === "sell")?.pnl === "-30762342");
  ok("each new trade and each fee went to the stream once", db.eventsAfter(0, 1000).filter((e) => e.kind === "trade").length === 11 && db.eventsAfter(0, 1000).filter((e) => e.kind === "fee").length === 5);
  await runtime.refresh(7);
  ok("…and not again on the next rebuild", db.eventsAfter(0, 1000).filter((e) => e.kind === "trade").length === 11 && db.eventsAfter(0, 1000).filter((e) => e.kind === "fee").length === 5);
  const again = createRuntime({ config, db, clock, indexer, market: { marks: async () => new Map(), curves: async () => new Map() }, rug: null, jupiter: null });
  await again.refresh(7);
  ok("…nor after a restart", db.eventsAfter(0, 1000).filter((e) => e.kind === "fee").length === 5);
  /* an agent with more fee claims than any window of "seen" ones would hold */
  db.createAgent({ id: 9, name: "Agent Fees", cat: "cashcat", skin: "standard", strategy: "crying-cat-safe", mode: "live", status: "active", wallet: addr(180), limits: { maxPerTradeSol: "0.05", maxOpenPositions: 3, stopLossPct: 8, takeProfitPct: 15, trailingStopPct: null, dailyLossLimitSol: "0.1" }, settings: {}, paperBankroll: 1n });
  const many = Array.from({ length: 520 }, (_, i) => ({ kind: "fee", t: new Date(Date.parse("2026-01-01T00:00:00Z") + i * 60_000).toISOString(), slot: 10 + i, signature: `FeeSig${String(i).padStart(4, "0")}`, lamports: 1_000n, cashDelta: 1_000n, rentDelta: 0n }));
  const feeRuntime = () => createRuntime({ config, db, clock, indexer: { eventsFor: (w) => (w === addr(180) ? many : indexer.eventsFor(w)) }, market: { marks: async () => new Map(), curves: async () => new Map() }, rug: null, jupiter: null });
  await feeRuntime().refresh(9);
  await feeRuntime().refresh(9);
  const agent9 = db.eventsAfter(0, 5000).filter((e) => e.kind === "fee" && e.data.agentId === 9);
  ok("520 fee claims: each went to the stream once, and not again on a rebuild or a restart", agent9.length === 520 && new Set(agent9.map((e) => e.data.tx)).size === 520, String(agent9.length));
  const a = agentObject({ agent: db.getAgent(7), view, db });
  ok("the contract's stats: amounts as decimal strings of SOL", a.stats.feesClaimedSol === "0.160577729" && a.stats.realizedPnlSol === "-0.032891622" && a.stats.balanceSol === "0.009121835" && a.stats.depositedSol === "2.470975564");
  ok("…the rank's measure is realized trading P&L, fees excluded, a net loss counting as none", a.stats.careerRealizedSol === "0" && a.stats.realizedPnlSol === "-0.032891622");
  ok("…and the Agent object is exactly the contract's shape", validate(SCHEMAS.Agent, a).length === 0, JSON.stringify(validate(SCHEMAS.Agent, a)));
}

section("A PAPER AGENT'S REAL DEPOSIT: IN ITS WALLET'S LEDGER, NOT ITS PAPER DOSSIER (docs/hq/DEPLOY.md says where to look)");
{
  const clock = testClock(Date.parse("2026-09-25T12:00:00Z"));
  const db = memDb(clock);
  const W = addr(170);
  db.createAgent({ id: 3, name: "Agent Paper", cat: "snipurr", skin: "standard", strategy: "snipurr", mode: "paper", status: "active", wallet: W, limits: { maxPerTradeSol: "0.01", maxOpenPositions: 1, stopLossPct: 35, takeProfitPct: 50, trailingStopPct: null, dailyLossLimitSol: "0.03" }, settings: {}, paperBankroll: SOL_ });
  db.addPaperTransfer({ id: "bankroll:3", agentId: 3, kind: "deposit", lamports: SOL_ });
  const dep = jsonTx({ signature: "RealDeposit111111111111111111111111111111111", slot: 5, keys: [addr(171), W, "11111111111111111111111111111111"], balances: { [addr(171)]: [SOL_, SOL_ - 100_005_000n], [W]: [0, 100_000_000] },
    instructions: [{ program: "11111111111111111111111111111111", accounts: [addr(171), W], data: (() => { const b = Buffer.alloc(12); b.writeUInt32LE(2, 0); b.writeBigUInt64LE(100_000_000n, 4); return b; })() }] });
  db.putChainTx({ address: W, signature: dep.transaction.signatures[0], slot: 5, blockTime: dep.blockTime, err: false, tx: dep });
  const runtime = createRuntime({ config: testConfig(), db, clock, indexer: createIndexer({ db, rpc: extRpc({}) }), market: { marks: async () => new Map(), curves: async () => new Map() }, rug: null, jupiter: null });
  const view = await runtime.refresh(3);
  ok("the paper dossier shows the paper book: its bankroll, not the real 0.1 SOL", view.ledger.transfers.length === 1 && view.ledger.transfers[0].tx === null && view.ledger.deposited === SOL_);
  ok("…the real deposit is in the wallet's own ledger (the live book once the agent goes live)", runtime.walletLedger(db.getAgent(3)).deposited === 100_000_000n);
}

section("A PAPER LEDGER, BY HAND");
{
  const t = (m) => `2026-09-25T10:${String(m).padStart(2, "0")}:00.000Z`;
  const M = "B4KX2V8MX8yJ7E4VuL55dDM6tsSwygb3rP1dgEsXpump";
  const ev = [
    { kind: "deposit", t: t(0), lamports: 1_000_000_000n, order: 0 },
    { kind: "trade", side: "buy", t: t(1), mint: M, decimals: 6, tokens: 1_000_000n, sol: 100_055_000n, fee: 55_000n, order: 1 },
    { kind: "trade", side: "sell", t: t(2), mint: M, decimals: 6, tokens: 400_000n, sol: 60_000_000n, fee: 55_000n, order: 2 },
    { kind: "trade", side: "sell", t: t(3), mint: M, decimals: 6, tokens: 700_000n, sol: 70_000_000n, fee: 55_000n, order: 3 },
  ];
  const L = buildLedger(ev);
  ok("a partial sell realizes proceeds less the average cost of what it sold", L.trades[1].pnl === 60_000_000n - (100_055_000n * 400_000n) / 1_000_000n);
  ok("selling more than was bought: only what was bought is a trade; the rest is outside value", L.other === 70_000_000n - (70_000_000n * 600_000n) / 700_000n && L.positions.length === 0);
  ok("the paper cash is the bankroll less buys plus sells", L.cash === 1_000_000_000n - 100_055_000n + 60_000_000n + 70_000_000n);
  const p = periodTradingPnl(L, Date.parse(t(2)));
  ok("a period's trading P&L is the realized P&L dated in it, plus the change in unrealized over it", p.realizedIn === L.trades[1].pnl + L.trades[2].pnl && p.pnl === p.realizedIn + (L.unrealized - unrealizedAt(L, Date.parse(t(2)))) && realizedSince(L, Date.parse(t(4))) === 0n);
}

/* ── the review's cases, each held as a regression test ── */
const SOL = 1_000_000_000n;
const identity = (L) => L.cash + L.rent + L.positions.reduce((a, x) => a + x.cost, 0n) === L.netDeposits + L.feesClaimed + L.realized + L.other;
const day = (d, h = 0) => new Date(Date.UTC(2026, 8, d, h)).toISOString();
const MA = "M1ntM1ntM1ntM1ntM1ntM1ntM1ntM1ntM1ntM1nt11", MB = "M2ntM2ntM2ntM2ntM2ntM2ntM2ntM2ntM2ntM2nt22";

section("THE IDENTITY, OVER EVERY RECORDED WALLET: CASH + RENT + POSITIONS AT COST = NET DEPOSITS + FEES + REALIZED + OTHER");
{
  const files = fs.readdirSync(path.join(ROOT, "fixtures", "hq", "ledger")).filter((f) => f.endsWith(".json")).sort();
  ok(`every recorded wallet is held to it (${files.length})`, files.length >= 2);
  for (const f of files) {
    const fx = hqFixture(`ledger/${f}`);
    const L = buildLedger(eventsOf(fx));
    const lhs = L.cash + L.rent + L.positions.reduce((a, x) => a + x.cost, 0n), rhs = L.netDeposits + L.feesClaimed + L.realized + L.other;
    ok(`${f.slice(0, 8)}: it holds to the lamport`, identity(L), `${lhs} vs ${rhs}`);
    const marked = buildLedger(eventsOf(fx), { now: "2026-09-25T12:00:00.000Z" });
    ok(`${f.slice(0, 8)}: …and the final point, the portfolio and the chart's last point are one value`, marked.equity.at(-1).portfolio === marked.portfolio);
  }
  ok("3inPGc88: nothing arrived outside a trade, a deposit or a fee (other = 0)", buildLedger(eventsOf(B)).other === 0n);
  const LA = buildLedger(eventsOf(A));
  const refund = eventsOf(A).find((x) => x.kind === "other");
  ok("45j71Q8C: its one 'other' is the rent pump.fun's close of the wallet's volume accumulator gave back (1,839,400), read off the arrays, and it is no return",
    refund && LA.other === refund.value && refund.value === native(txBy(A, refund.signature.slice(0, 8)), A.wallet) && refund.value === 1_839_400n
    && LA.roiPct === Math.trunc(Number((LA.realized + LA.unrealized) * 10_000n / LA.deposited)) / 100);
}

section("A JUPITER SELL THAT OPENS THE WALLET'S wSOL ACCOUNT OUT OF ITS PROCEEDS IS A SELL, AND A LOSS");
{
  /* buy 0.01 SOL of a token; sell it all for 0.0015 wSOL through Jupiter (wrapAndUnwrapSol off),
     the wallet's wSOL account created in the sell out of its 2,039,280-lamport rent */
  const W = addr(150), TOK = addr(151), WS = addr(152), JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
  const RENT = 2_039_280, FEE = 55_000, OUT = 1_500_000;
  const tx = jsonTx({ signature: "SellSig1111111111111111111111111111111111111", slot: 3, keys: [W, TOK, WS, JUP], fee: FEE,
    balances: { [W]: [100_000_000, 100_000_000 - FEE - RENT], [TOK]: [RENT, RENT], [WS]: [0, RENT + OUT], [JUP]: [1, 1] },
    tokens: [{ index: 1, owner: W, mint: MA, decimals: 6, pre: 1_000_000, post: 0 }, { index: 2, owner: W, mint: WSOL_MINT, decimals: 9, pre: null, post: OUT }] });
  const e = classifyTransaction(tx, { wallet: W });
  /* what the wallet got back, from the arrays: native change + its own accounts' lamports change */
  const back = native(tx, W) + (ownRent(tx, W, "post") - ownRent(tx, W, "pre"));
  ok("it is read as a sell, of what came back: the 0.0015 wSOL less the fee (the new account's rent is the wallet's own)", e.kind === "trade" && e.side === "sell" && e.sol === back && back === 1_445_000n, `${e.kind} ${e.side ?? ""} ${e.sol ?? e.value}`);
  const L = buildLedger([
    { kind: "deposit", t: day(1), slot: 1, lamports: SOL, cashDelta: SOL, rentDelta: 0n },
    { kind: "trade", side: "buy", t: day(2), slot: 2, mint: MA, decimals: 6, tokens: 1_000_000n, sol: 10_000_000n, fee: 55_000n, cashDelta: -12_039_280n, rentDelta: 2_039_280n },
    { ...e, t: day(3), slot: 3 },
  ]);
  ok("…so the round trip realizes 0.001445 − 0.01 = −0.008555 SOL: a loss, never a profit", L.realized === 1_445_000n - 10_000_000n && L.losses === 1 && L.wins === 0 && L.positions.length === 0, String(L.realized));
  ok("…and the identity holds", identity(L));
}

section("A TOKEN MOVED OUT: AT ITS COST, AS A WITHDRAWAL; VALUE ARRIVING WITH IT IS NEVER PROFIT");
{
  const ev = [
    { kind: "deposit", t: day(1), slot: 1, lamports: SOL },
    { kind: "trade", side: "buy", t: day(2), slot: 2, mint: MA, decimals: 6, tokens: 1_000n, sol: 100_000_000n, fee: 0n },
    { kind: "token_out", t: day(3), slot: 3, mint: MA, decimals: 6, tokens: 400n, value: 5_000_000n, fee: 5_000n, signature: "Out1" },
    { kind: "token_out", t: day(4), slot: 4, mint: MA, decimals: 6, tokens: 600n, value: -2_044_280n, fee: 5_000n, signature: "Out2" },
  ];
  const L = buildLedger(ev);
  ok("the tokens leave at their cost, as withdrawals (0.04 then 0.06), and no position is left", L.withdrawn === 100_000_000n && L.positions.length === 0
    && L.transfers.filter((x) => x.kind === "withdrawal").map((x) => `${x.lamports}:${x.tokens.raw}`).join() === "40000000:400,60000000:600");
  ok("value that came back with a move is 'other', never realized profit", L.other === 5_000_000n && L.realized === -2_044_280n && L.opsCost === 2_044_280n, `${L.other} ${L.realized}`);
  ok("…the identity holds", identity(L));
  /* after the first move 0.905 SOL of value is left, all of it cash after the second; the only fall
     is the second move's 2,044,280 lamports of fee and rent */
  ok("…and the drawdown reads the tokens leaving as no fall: only the move's own cost is one (0.23%)", L.maxDrawdownPct === Math.round((2_044_280 / 905_000_000) * 10_000) / 100, `${L.maxDrawdownPct}`);
}

section("THE RETURN IS OVER WHAT WAS DEPOSITED: A WITHDRAWAL OR A SWEEP NEVER CHANGES IT");
{
  const base = [
    { kind: "deposit", t: day(1), slot: 1, lamports: SOL },
    { kind: "trade", side: "buy", t: day(2), slot: 2, mint: MA, decimals: 6, tokens: 1_000n, sol: 500_000_000n, fee: 0n },
    { kind: "trade", side: "sell", t: day(3), slot: 3, mint: MA, decimals: 6, tokens: 1_000n, sol: 300_000_000n, fee: 0n },
  ];
  const before = buildLedger(base);
  const after = buildLedger([...base, { kind: "withdrawal", t: day(4), slot: 4, lamports: 790_000_000n, fee: 0n }]);
  ok("a 0.2 loss on 1 deposited is −20%, before and after the owner withdraws 0.79", before.roiPct === -20 && after.roiPct === -20, `${before.roiPct} ${after.roiPct}`);
  const win = [base[0], base[1], { ...base[2], sol: 1_500_000_000n }];
  const w1 = buildLedger(win);
  const w2 = buildLedger([...win, { kind: "withdrawal", t: day(4), slot: 4, lamports: SOL, fee: 0n, hq: { kind: "profit_sweep", agent: 1 } }]);
  const w3 = buildLedger([...win, { kind: "withdrawal", t: day(4), slot: 4, lamports: 500_000_000n, fee: 0n }]);
  ok("a 1 SOL profit on 1 deposited is 100%, before and after a sweep of all of it or half of it", w1.roiPct === 100 && w2.roiPct === 100 && w3.roiPct === 100, `${w1.roiPct} ${w2.roiPct} ${w3.roiPct}`);
  ok("null only when nothing was ever deposited", buildLedger([]).roiPct === null && buildLedger([{ kind: "fee", t: day(1), slot: 1, lamports: SOL }]).roiPct === null && after.roiPct !== null);
  ok("recorded wallet A: 45j71Q8C withdrew more than it deposited, and still has a return (559.95%)", buildLedger(eventsOf(A)).roiPct === 559.95);
}

section("THE DRAWDOWN AND THE CHART: MARKED VALUE, WITH DEPOSITS, WITHDRAWALS AND FEES NEUTRAL");
{
  const tenth = (lamports) => ({ lamports, tokens: 1_000n });
  const ev = [
    { kind: "deposit", t: day(1), slot: 1, lamports: SOL },
    { kind: "trade", side: "buy", t: day(2), slot: 2, mint: MA, decimals: 6, tokens: 1_000n, sol: 900_000_000n, fee: 0n },
  ];
  const down = new Map([[MA, tenth(90_000_000n)]]);
  const L = buildLedger(ev, { marks: down });
  ok("deposit 1, buy 0.9, the position quoted 90% down: the portfolio is 0.19 and the drawdown 81%", L.portfolio === 190_000_000n && L.maxDrawdownPct === 81, `${L.portfolio} ${L.maxDrawdownPct}`);
  const withSnap = buildLedger([...ev, { kind: "trade", side: "buy", t: day(4), slot: 4, mint: MB, decimals: 6, tokens: 10n, sol: 10_000_000n, fee: 0n }],
    { marks: down, snapshots: [{ t: day(3), marks: { [MA]: { lamports: "90000000", tokens: "1000" } } }], now: day(5) });
  const chart = equitySeries({ ledger: withSnap }).map((x) => x.portfolioSol);
  ok("the chart takes the recorded quote at the snapshot and keeps it: 1, 1, 0.19, 0.19, 0.19 — never back to 1 at the next trade", chart.join() === "1,1,0.19,0.19,0.19", chart.join());
  ok("…and its last point is the portfolio now", chart.at(-1) === "0.19" && withSnap.portfolio === 190_000_000n);
  const feeAfter = buildLedger([...ev, { kind: "fee", t: day(4), slot: 4, lamports: 500_000_000n }], { marks: down, snapshots: [{ t: day(3), marks: { [MA]: tenth(90_000_000n) } }], now: day(5) });
  ok("a creator-fee claim after the fall does not hide it: still 81%", feeAfter.maxDrawdownPct === 81, `${feeAfter.maxDrawdownPct}`);
  ok("a fee claim alone is no gain and no drawdown", buildLedger([{ kind: "deposit", t: day(1), slot: 1, lamports: SOL }, { kind: "fee", t: day(2), slot: 2, lamports: 500_000_000n }], { now: day(3) }).maxDrawdownPct === 0);
  const half = new Map([[MA, { lamports: 250_000_000n, tokens: 1_000n }]]);
  const dep = buildLedger([
    { kind: "deposit", t: day(1), slot: 1, lamports: SOL },
    { kind: "trade", side: "buy", t: day(2), slot: 2, mint: MA, decimals: 6, tokens: 1_000n, sol: 500_000_000n, fee: 0n },
    { kind: "deposit", t: day(4), slot: 4, lamports: 10n * SOL },
  ], { marks: half, snapshots: [{ t: day(3), marks: { [MA]: { lamports: 250_000_000n, tokens: 1_000n } } }], now: day(5) });
  ok("a deposit after a fall does not make a recovery: 1 → 0.75, then 10 more deposited, still a 25% drawdown", dep.maxDrawdownPct === 25, `${dep.maxDrawdownPct}`);
  ok("a withdrawal is no fall: deposit 1, withdraw 0.9", buildLedger([{ kind: "deposit", t: day(1), slot: 1, lamports: SOL }, { kind: "withdrawal", t: day(2), slot: 2, lamports: 900_000_000n, fee: 0n }], { now: day(3) }).maxDrawdownPct === 0);
  ok("with no time for the final point, the marked value still counts in the drawdown", buildLedger(ev, { marks: down }).maxDrawdownPct === 81 && buildLedger(ev, { marks: down }).equity.length === 2);
}

section("A PERIOD'S RETURN: REALIZED IN IT PLUS THE CHANGE IN UNREALIZED, OVER WHAT WAS DEPOSITED; FEES NEVER");
{
  const now = Date.UTC(2026, 8, 25);
  const stub = { listAgents: () => [{ id: 1, mode: "live", status: "active" }] };
  const board = (L, by, period) => leaderboard({ db: stub, views: new Map([[1, { mode: "live", ledger: L, rank: "recruit" }]]), by, period, now }).rows[0]?.value ?? null;
  const feeOnly = buildLedger([{ kind: "deposit", t: day(1), slot: 1, lamports: SOL }, { kind: "fee", t: day(24), slot: 24, lamports: 500_000_000n }], { now: day(25) });
  ok("a creator-fee claim inside the week: 0% by=roi over 7d, 30d and all time, and 0 by=pnl", ["7d", "30d", "all"].every((p) => board(feeOnly, "roi", p) === "0") && board(feeOnly, "pnl", "7d") === "0",
    ["7d", "30d", "all"].map((p) => board(feeOnly, "roi", p)).join());
  const ev = [
    { kind: "deposit", t: day(5), slot: 1, lamports: SOL },
    { kind: "trade", side: "buy", t: day(5, 1), slot: 2, mint: MA, decimals: 6, tokens: 1_000n, sol: 900_000_000n, fee: 0n },
  ];
  const L = buildLedger(ev, { marks: new Map([[MA, { lamports: 990_000_000n, tokens: 1_000n }]]), snapshots: [{ t: day(17), marks: { [MA]: { lamports: "945000000", tokens: "1000" } } }], now: day(25) });
  ok("an open position up 5% eight days ago and 10% now: 4.5% over 7d (the change in unrealized), 9% over 30d and all time",
    board(L, "roi", "7d") === "4.5" && board(L, "roi", "30d") === "9" && board(L, "roi", "all") === "9" && L.roiPct === 9, ["7d", "30d", "all"].map((p) => board(L, "roi", p)).join());
  ok("…and nothing realized: 0 by=pnl", board(L, "pnl", "7d") === "0" && board(L, "pnl", "all") === "0");
  const P = periodTradingPnl(L, now - 7 * 86_400_000);
  ok("periodTradingPnl says the same: 0 realized, 0.045 SOL of unrealized change", P.realizedIn === 0n && P.pnl === 45_000_000n);
}

section("THE INDEXER NEVER SKIPS A TRANSACTION, AND RETRIES A FAILED CALL");
{
  const W = addr(160);
  const all = Array.from({ length: 12 }, (_, i) => ({ signature: `sig${String(i).padStart(2, "0")}`, slot: i + 1, blockTime: 1_790_000_000 + i, err: null }));
  const newestFirst = [...all].reverse();
  let listed = newestFirst.slice(10);                 /* the first pass: only sig00 and sig01 exist */
  let failNext = 0;
  const handlers = {
    getSignaturesForAddress: ([, opts]) => {
      if (failNext > 0) { failNext--; throw Object.assign(new Error("HTTP 429"), { clause: "rpc_error" }); }
      let list = listed;
      if (opts.before) list = list.slice(list.findIndex((x) => x.signature === opts.before) + 1);
      if (opts.until) list = list.slice(0, list.findIndex((x) => x.signature === opts.until));
      return list.slice(0, opts.limit);
    },
    getTransaction: ([sig]) => jsonTx({ signature: sig, slot: Number(sig.slice(3)) + 1, keys: [W], balances: { [W]: [1_000_000, 995_000] } }),
  };
  const db = memDb();
  const logs = [];
  const indexer = createIndexer({ db, rpc: extRpc(handlers), maxPages: 2, pageSize: 3, retryDelaysMs: [0, 0, 0], log: (l) => logs.push(l) });
  const r1 = await indexer.indexAddress(W);
  ok("the first pass reads the two there are, complete", r1.added === 2 && r1.complete === true);
  listed = newestFirst;                               /* ten more arrive while HQ is down: more than 2 pages of 3 */
  const r2 = await indexer.indexAddress(W);
  const cur2 = db.getCursor(W);
  ok("the next pass reads what one pass can (6), keeps the old boundary, marks the address incomplete and keeps where to resume",
    r2.added === 6 && r2.complete === false && cur2.newest_signature === "sig01" && cur2.complete === 0 && cur2.resume?.newest === "sig11" && indexer.incomplete() === 1, JSON.stringify(cur2));
  ok("…and says so in the log", logs.some((l) => /more history than one pass reads/.test(l)));
  const r3 = await indexer.indexAddress(W);
  const have = db.listChainTxs(W).map((x) => x.signature);
  ok("the pass after reads the gap: every one of the 12 is stored, none skipped, and the address is complete", r3.added === 4 && r3.complete === true && all.every((x) => have.includes(x.signature)) && have.length === 12 && indexer.incomplete() === 0);
  ok("…its boundary is now the newest", db.getCursor(W).newest_signature === "sig11" && db.getCursor(W).resume === null);
  const more = { signature: "sig12", slot: 13, blockTime: 1_790_000_012, err: null };
  listed = [more, ...newestFirst];
  failNext = 2;
  const r4 = await indexer.indexAddress(W);
  ok("a rate limit (429) twice is retried with backoff, and the pass completes", r4.added === 1 && r4.complete === true);
  failNext = 10;
  let threw = false;
  try { await indexer.indexAddress(W); } catch { threw = true; }
  ok("an RPC that keeps failing: the pass for this address stops, the cursor where it was", threw && db.getCursor(W).newest_signature === "sig12");
}

done();
