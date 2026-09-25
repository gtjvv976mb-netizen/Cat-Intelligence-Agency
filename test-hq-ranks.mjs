/**
 * RANKS AND PROMOTIONS, AS docs/hq/API.md SAYS.
 *
 *   · the thresholds at their exact edges, from the contract's own table;
 *   · a loss never demotes; skipping ranks is one promotion; fees never count;
 *   · the runtime promotes from the ledger, records it, puts it on the stream with its mode, and
 *     keeps paper and live apart;
 *   · a rank is cosmetic: it unlocks a skin and nothing else — no file that sizes, gates or
 *     signs a trade reads it.
 */
import fs from "node:fs";
import path from "node:path";
import { harness, ROOT } from "./bots/test/doubles.mjs";
import { RANKS, RANK_IDS, rankFor, promote, skinsUnlocked, SKINS } from "./services/hq/lib/ranks.mjs";
import { parseSol } from "./services/hq/lib/amounts.mjs";
import { SCHEMAS, validate, ENUMS } from "./services/hq/contract/schemas.mjs";
import { agentDetail } from "./services/hq/lib/views.mjs";
import { paperRig, addr, hqFixture, memDb, testConfig, testClock, extRpc } from "./services/hq/test/doubles.mjs";
import { createIndexer } from "./services/hq/lib/indexer.mjs";
import { createRuntime } from "./services/hq/lib/runtime.mjs";
import { buildLedger } from "./services/hq/lib/ledger.mjs";

const { ok, section, done } = harness("test-hq-ranks");

section("THE THRESHOLDS, FROM THE CONTRACT'S TABLE");
{
  const doc = fs.readFileSync(path.join(ROOT, "docs", "hq", "API.md"), "utf8");
  const rows = [...doc.matchAll(/^\| ([^|]+?) \| `(\w+)` \| (<|≥) ([\d.]+) SOL \|$/gm)].map((m) => ({ name: m[1], id: m[2], op: m[3], sol: m[4] }));
  ok("the contract's table has the five ranks, in order", rows.map((r) => r.id).join() === RANK_IDS.join(), rows.map((r) => r.id).join());
  for (const r of rows.slice(1)) {
    const code = RANKS.find((x) => x.id === r.id);
    ok(`${r.name}: ≥ ${r.sol} SOL in the contract and in the code`, code && code.minLamports === parseSol(r.sol) && code.name === r.name);
  }
  ok("the contract's rank ids are the schema's", JSON.stringify(ENUMS.rank) === JSON.stringify(RANK_IDS));
  const edges = [["0", "recruit"], ["-5", "recruit"], ["0.249999999", "recruit"], ["0.25", "field"], ["0.999999999", "field"], ["1", "special"], ["4.999999999", "special"], ["5", "senior"], ["24.999999999", "senior"], ["25", "director"], ["1000", "director"]];
  for (const [sol, want] of edges) ok(`${sol} SOL of career realized profit is ${want}`, rankFor(parseSol(sol.replace("-", ""), "x") * (sol.startsWith("-") ? -1n : 1n)) === want);
}

section("PROMOTIONS: NEVER DOWN, ONE STEP OR MANY");
{
  ok("from recruit at 0.3 SOL: promoted to field", JSON.stringify(promote({ held: "recruit", careerRealizedLamports: parseSol("0.3") })) === JSON.stringify({ rank: "field", promotion: { from: "recruit", to: "field" } }));
  ok("a field agent that falls back to a loss stays field, with no event", JSON.stringify(promote({ held: "field", careerRealizedLamports: -parseSol("2") })) === JSON.stringify({ rank: "field", promotion: null }));
  ok("from recruit straight to senior is one promotion", promote({ held: "recruit", careerRealizedLamports: parseSol("6") }).promotion.to === "senior");
  ok("a held rank the code does not know is read as recruit, never higher", promote({ held: "general", careerRealizedLamports: 0n }).rank === "recruit");
  ok("skins: standard for all, then one per rank reached", skinsUnlocked("recruit").join() === "standard" && skinsUnlocked("special").join() === "standard,field,special" && SKINS.length === 5);
}

section("THE RUNTIME PROMOTES FROM THE LEDGER, AND SAYS SO");
{
  const M = addr(80);
  const rig = await paperRig({ agents: [{ id: 4 }] });
  const { db, runtime } = rig;
  const t = (m) => `2026-09-25T11:${String(m).padStart(2, "0")}:00.000Z`;
  db.upsertTrade({ id: "paper:1", agentId: 4, mode: "paper", t: t(1), side: "buy", mint: M, decimals: 6, sol: parseSol("0.1"), tokens: 1_000_000n, trigger: "strategy" });
  db.upsertTrade({ id: "paper:2", agentId: 4, mode: "paper", t: t(2), side: "sell", mint: M, decimals: 6, sol: parseSol("0.4"), tokens: 1_000_000n, trigger: "take_profit" });
  const v = await runtime.refresh(4);
  ok("0.3 SOL realized on paper: the paper rank is field", v.rank === "field" && db.getRank(4, "paper") === "field");
  const promos = db.eventsAfter(0, 100).filter((e) => e.kind === "promotion");
  ok("…one promotion on the stream, marked paper, in the contract's shape", promos.length === 1 && promos[0].data.mode === "paper" && promos[0].data.to === "field" && validate(SCHEMAS.Promotion, promos[0].data).length === 0, JSON.stringify(promos.map((p) => p.data)));
  ok("…and on the agent's page", (() => { const d = agentDetail({ agent: db.getAgent(4), view: v, db, symbolOf: () => null }); return d.promotions.length === 1 && d.promotions[0].to === "field" && d.rank === "field"; })());
  ok("…and the live rank is untouched: paper never promotes a live record", db.getRank(4, "live") === null);
  db.upsertTrade({ id: "paper:3", agentId: 4, mode: "paper", t: t(3), side: "buy", mint: M, decimals: 6, sol: parseSol("0.5"), tokens: 1_000_000n, trigger: "strategy" });
  db.upsertTrade({ id: "paper:4", agentId: 4, mode: "paper", t: t(4), side: "sell", mint: M, decimals: 6, sol: parseSol("0.05"), tokens: 1_000_000n, trigger: "stop_loss" });
  const v2 = await runtime.refresh(4);
  ok("a later loss (career realized now below zero) does not demote, and adds no event", v2.rank === "field" && db.eventsAfter(0, 100).filter((e) => e.kind === "promotion").length === 1 && v2.ledger.realized < 0n);
}

section("FEES ARE NOT TRADING: A LIVE AGENT ON RECORDED MAINNET HISTORY");
{
  const B = hqFixture("ledger/3inPGc88YuabgXVhgZ4DtYjmMW86y5WYW3FVddN7NpLU.json");
  const clock = testClock();
  const db = memDb(clock);
  db.createAgent({ id: 8, name: "Agent Fees", cat: "cashcat", skin: "standard", strategy: "crying-cat-safe", mode: "live", status: "active", wallet: B.wallet, limits: { maxPerTradeSol: "0.05", maxOpenPositions: 3, stopLossPct: 8, takeProfitPct: 15, trailingStopPct: null, dailyLossLimitSol: "0.1" }, settings: {}, paperBankroll: 1n });
  for (const tx of B.transactions) db.putChainTx({ address: B.wallet, signature: tx.transaction.signatures[0], slot: tx.slot, blockTime: tx.blockTime, err: Boolean(tx.meta.err), tx });
  const runtime = createRuntime({ config: testConfig(), db, clock, indexer: createIndexer({ db, rpc: extRpc({}) }), market: { marks: async () => new Map(), curves: async () => new Map() }, rug: null, jupiter: null });
  const v = await runtime.refresh(8);
  ok("0.16 SOL of creator fees claimed, trading realized below zero: still a recruit", v.ledger.feesClaimed > parseSol("0.15") && v.ledger.realized < 0n && v.rank === "recruit" && db.eventsAfter(0, 1000).every((e) => e.kind !== "promotion"));
  const L = buildLedger([{ kind: "deposit", t: "2026-09-25T10:00:00.000Z", lamports: parseSol("1"), order: 0 }, { kind: "fee", t: "2026-09-25T10:01:00.000Z", lamports: parseSol("30"), order: 1 }]);
  ok("30 SOL of claimed fees and no trade: realized trading P&L is 0, and the rank recruit", L.feesClaimed === parseSol("30") && L.realized === 0n && promote({ held: "recruit", careerRealizedLamports: L.realized }).rank === "recruit");
}

section("A RANK IS COSMETIC: NOTHING THAT TRADES READS IT");
{
  const files = ["services/hq/lib/risk.mjs", "services/hq/lib/execution.mjs", "services/hq/lib/txcheck.mjs", "services/hq/lib/rugcheck.mjs", "services/hq/lib/agency.mjs", "services/hq/lib/buyback.mjs", "services/hq/lib/revenue.mjs",
    ...fs.readdirSync(path.join(ROOT, "services", "hq", "strategies")).map((f) => `services/hq/strategies/${f}`)];
  for (const f of files) {
    const code = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    ok(`${f} reads no rank`, !/\brank\b|getRank|ranks\.mjs|skinsUnlocked/i.test(code));
  }
  const runtime = fs.readFileSync(path.join(ROOT, "services", "hq", "lib", "runtime.mjs"), "utf8");
  const buy = runtime.slice(runtime.indexOf("async function buy("), runtime.indexOf("async function sell("));
  ok("the runtime's buy gate reads no rank", buy.length > 500 && !/rank/i.test(buy));
}

done();
