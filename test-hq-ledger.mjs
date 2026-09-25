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
 */
import { harness, hqFixture, memDb, testConfig, testClock, extRpc } from "./services/hq/test/doubles.mjs";
import { classifyTransaction, accountKeysOf, walletView } from "./services/hq/lib/classify.mjs";
import { buildLedger, periodPnl } from "./services/hq/lib/ledger.mjs";
import { createIndexer } from "./services/hq/lib/indexer.mjs";
import { createRuntime } from "./services/hq/lib/runtime.mjs";
import { liveTradeId } from "./services/hq/lib/db.mjs";
import { agentObject } from "./services/hq/lib/views.mjs";
import { validate, SCHEMAS } from "./services/hq/contract/schemas.mjs";

const { ok, section, done } = harness("test-hq-ledger");
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
  ok("dust deposits of 1 lamport are deposits, and all deposits add up", ev.filter((x) => x.kind === "deposit" && x.lamports === 1n).length >= 10 && L.deposited === 2_470_975_564n);
  ok("two withdrawals", L.withdrawn === 53_777_810n + 1_999_991_000n);
  const last = B.transactions[0];
  const endNative = BigInt(last.meta.postBalances[accountKeysOf(last).indexOf(w)]);
  ok("the cash the ledger ends with is the chain's final native balance", L.cash === endNative && endNative === 9_121_835n);
  ok("the rent it holds is its two open token accounts' (2 × 2,039,280)", L.rent === 4_078_560n);
  ok("one position is open, at its cost (no mark given)", L.positions.length === 1 && L.positions[0].priced === false && L.unrealized === 0n);
  const marked = buildLedger(ev, { marks: new Map([[L.positions[0].mint, { lamports: 1n, tokens: 1_000_000n }]]) });
  ok("with a mark, unrealized is value − cost and the portfolio follows", marked.unrealized === marked.positions[0].value - marked.positions[0].cost && marked.portfolio === marked.cash + marked.rent + marked.positions[0].value);
  ok("ROI is realized + unrealized over net deposits", L.roiPct === Math.trunc(Number((L.realized + L.unrealized) * 10_000n / L.netDeposits)) / 100);
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
  const a = agentObject({ agent: db.getAgent(7), view, db });
  ok("the contract's stats: amounts as decimal strings of SOL", a.stats.feesClaimedSol === "0.160577729" && a.stats.realizedPnlSol === "-0.032891622" && a.stats.balanceSol === "0.009121835" && a.stats.depositedSol === "2.470975564");
  ok("…the rank's measure is realized trading P&L, fees excluded, a net loss counting as none", a.stats.careerRealizedSol === "0" && a.stats.realizedPnlSol === "-0.032891622");
  ok("…and the Agent object is exactly the contract's shape", validate(SCHEMAS.Agent, a).length === 0, JSON.stringify(validate(SCHEMAS.Agent, a)));
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
  const pts = [{ t: t(0), portfolio: 1_000_000_000n, netDeposits: 1_000_000_000n }, { t: t(30), portfolio: 1_100_000_000n, netDeposits: 1_000_000_000n }];
  const p = periodPnl(pts, { since: Date.parse(t(10)), nowPortfolio: 1_200_000_000n, nowNetDeposits: 1_050_000_000n });
  ok("a period's P&L is the change in portfolio less deposits since its start", p.pnl === (1_200_000_000n - 1_050_000_000n) - (1_000_000_000n - 1_000_000_000n));
}

done();
