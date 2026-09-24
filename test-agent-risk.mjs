/**
 * THE AGENT'S HARD LIMITS, CLAUSE BY CLAUSE.
 *
 * src/lib/agent-risk.mjs is pure, so every limit is walked here with numbers chosen by hand:
 * every refusal clause in RISK_CLAUSES is produced at least once and named; every clamp is
 * shown to bind in its order (the per-token cap, then the settlement balance, then the
 * exposure cap) and to refuse when what is left is under the $10 minimum; the stop loss and the
 * take profit fire at their edges and not a cent before; the daily drawdown breaker trips at
 * its limit, stops buys (or liquidates, as the owner chose), stays tripped all UTC day and
 * resets at UTC midnight and not before; and nothing the model sends can move a limit —
 * a proposal carrying a limit, or the spec itself, is read for its action and nothing else,
 * and the spec comes back unchanged and frozen.
 */
import { PublicKey } from "@solana/web3.js";
import { normalizeAgentSpec, SOLANA_MAJORS, DEFAULT_SETTLEMENT_MINT, AGENT_BOUNDS } from "./src/lib/agent-strategy.mjs";
import { RISK_CLAUSES, EXIT_REASONS, utcDay, rollDay, unitsOf, vaultView, protections, planOrders } from "./src/lib/agent-risk.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? "  — " + detail : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const section = (title) => console.log(`\n${title}\n${"─".repeat(title.length)}`);

const [JITO, JUP, JTO, PYTH, RAY, BONK, WIF, CBBTC] = SOLANA_MAJORS.map((m) => m.mint);
const OUTSIDER = new PublicKey(Buffer.alloc(32, 99)).toBase58();     // a synthetic address, not in the universe
const spec = normalizeAgentSpec({
  name: "Test cat", strategy: "Buy strength in majors, cut losers fast, never chase.",
  maxPositionUsd: 30, maxExposurePct: 60, stopLossPct: 8, takeProfitPct: 15, maxDailyDrawdownPct: 5, maxTradesPerDay: 4, slippageBps: 100,
});
const liquidating = normalizeAgentSpec({ ...spec, drawdownAction: "liquidate" });
const spec100 = normalizeAgentSpec({ ...spec, maxExposurePct: 100 });
/** A position of `qty` whole tokens bought for `costUsd`. */
const pos = (mint, qty, costUsd, { decimals = 6, symbol = SOLANA_MAJORS.find((m) => m.mint === mint)?.symbol ?? "X", lastPriceUsd = null } = {}) =>
  ({ mint, symbol, decimals, program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", qtyRaw: (BigInt(Math.round(qty * 1e6)) * 10n ** BigInt(decimals) / 1_000_000n).toString(), costUsd, lastPriceUsd });
const NOON = Date.UTC(2026, 8, 24, 12, 0, 0);
const day0 = rollDay(null, { now: NOON, equityUsd: 100 });
const buy = (mint, usd, extra = {}) => ({ action: "buy", mint, usd, confidence: 0.6, reason: "test", ...extra });
const sell = (mint, fraction, extra = {}) => ({ action: "sell", mint, fraction, confidence: 0.6, reason: "test", ...extra });
const plan = (over) => planOrders({ spec, proposals: [], positions: {}, prices: { [JUP]: 1, [JTO]: 2, [PYTH]: 0.5 }, settlementUsd: 100, day: day0, paused: false, ...over });
const clauses = (p) => p.refusals.map((x) => x.clause);
const seen = new Set();
const saw = (p) => { for (const c of clauses(p)) seen.add(c); return p; };

section("1. THE DAY: UTC, AND ONLY UTC");
{
  ok("utcDay is the UTC calendar day", utcDay(Date.UTC(2026, 8, 24, 23, 59, 59)) === "2026-09-24" && utcDay(Date.UTC(2026, 8, 25, 0, 0, 0)) === "2026-09-25");
  ok("a first ledger starts at the vault's value, no trades, not tripped", day0.day === "2026-09-24" && day0.startEquityUsd === 100 && day0.trades === 0 && day0.tripped === false);
  const later = rollDay({ ...day0, trades: 3, tripped: true }, { now: Date.UTC(2026, 8, 24, 23, 59, 59), equityUsd: 80 });
  ok("the same UTC day returns the same ledger: trades and the breaker carry", later.trades === 3 && later.tripped === true && later.startEquityUsd === 100);
  const next = rollDay({ ...day0, trades: 3, tripped: true }, { now: Date.UTC(2026, 8, 25, 0, 0, 0), equityUsd: 80 });
  ok("UTC midnight starts a new ledger: the breaker resets, the count resets, the day starts at the vault now", next.day === "2026-09-25" && next.trades === 0 && next.tripped === false && next.startEquityUsd === 80);
  const local = rollDay(day0, { now: Date.UTC(2026, 8, 24, 23, 30, 0), equityUsd: 70 });
  ok("…and a local midnight that is not UTC's resets nothing", local === day0);
}

section("2. THE VAULT, VALUED");
{
  ok("unitsOf divides raw by 10^decimals exactly", unitsOf("1500000", 6) === 1.5 && unitsOf("123456789", 9) === 0.123456789 && unitsOf("100000", 5) === 1);
  const v = vaultView({ settlementUsd: 50, positions: { [JUP]: pos(JUP, 10, 10), [JTO]: pos(JTO, 5, 10, { decimals: 9, lastPriceUsd: 1.8 }), [PYTH]: pos(PYTH, 20, 10) }, prices: { [JUP]: 1.2, [JTO]: null, [PYTH]: null } });
  ok("a priced position is valued at this tick's price", v.rows.find((x) => x.mint === JUP).valueUsd === 12);
  ok("an unpriced one with a last price is valued at it, and named stale", Math.abs(v.rows.find((x) => x.mint === JTO).valueUsd - 9) < 1e-9 && v.stale.includes(JTO));
  ok("…one never priced at its cost, and named unpriced — never a guess", v.rows.find((x) => x.mint === PYTH).valueUsd === 10 && v.unpriced.includes(PYTH));
  ok("equity is the settlement plus the positions; exposure is positions over equity", Math.abs(v.equityUsd - 81) < 1e-9 && Math.abs(v.exposurePct - (31 / 81) * 100) < 1e-3);
}

section("3. THE PROTECTIONS: STOP LOSS AND TAKE PROFIT, AT THEIR EDGES");
{
  const positions = { [JUP]: pos(JUP, 10, 10), [JTO]: pos(JTO, 10, 10, { decimals: 9 }), [PYTH]: pos(PYTH, 10, 10) };
  const at = (prices) => protections({ spec, positions, prices, settlementUsd: 70, day: day0, now: NOON });
  const edge = at({ [JUP]: 0.92, [JTO]: 1.15, [PYTH]: 1.0 });
  ok("at exactly −8% the stop loss fires", edge.exits.some((x) => x.mint === JUP && x.reason === "stop_loss" && x.fraction === 1), JSON.stringify(edge.exits.map((x) => [x.symbol, x.reason, x.movePct])));
  ok("at exactly +15% the take profit fires", edge.exits.some((x) => x.mint === JTO && x.reason === "take_profit"));
  ok("…and a flat position is left alone", !edge.exits.some((x) => x.mint === PYTH));
  const inside = at({ [JUP]: 0.9201, [JTO]: 1.1499, [PYTH]: 1.0 });
  ok("a cent inside either edge fires nothing", inside.exits.length === 0, JSON.stringify(inside.exits));
  const missing = at({ [JUP]: null, [JTO]: 1.0, [PYTH]: 1.0 });
  ok("a position with no price this tick is not judged, and says so (price_missing)", missing.exits.length === 0 && missing.notes.some((n) => n.mint === JUP && n.clause === "price_missing"));
  ok("every exit reason is a named one", [...edge.exits].every((x) => EXIT_REASONS.includes(x.reason)));
  const entryWeighted = protections({ spec, positions: { [JUP]: pos(JUP, 20, 30) }, prices: { [JUP]: 1.38 }, settlementUsd: 70, day: day0, now: NOON });
  ok("the entry is the average cost: 20 bought for $30 is $1.50, so $1.38 is −8% and stops", entryWeighted.exits[0]?.reason === "stop_loss" && Math.abs(entryWeighted.exits[0].entryPriceUsd - 1.5) < 1e-12);
}

section("4. THE DAILY DRAWDOWN BREAKER");
{
  /* Down, but no position at its own −8% stop: the breaker is judged on the vault alone. */
  const positions = { [JUP]: pos(JUP, 40, 40), [JTO]: pos(JTO, 10, 10, { decimals: 9 }) };
  const start = rollDay(null, { now: NOON, equityUsd: 100 });
  const under = protections({ spec, positions, prices: { [JUP]: 0.95, [JTO]: 1.0 }, settlementUsd: 48, day: start, now: NOON + 60_000 });      // 38 + 10 + 48 = 96: 4%
  ok("4% down against a 5% limit: not tripped", under.breaker.tripped === false && under.breaker.drawdownPct === 4 && under.day.tripped === false);
  const trips = protections({ spec, positions, prices: { [JUP]: 0.9375, [JTO]: 0.95 }, settlementUsd: 48, day: start, now: NOON + 120_000 });  // 37.5 + 9.5 + 48 = 95: 5%
  ok("at exactly 5% the breaker trips, once, stamped with the time", trips.breaker.tripped && trips.breaker.justTripped && trips.day.tripped && trips.day.trippedAt === NOON + 120_000);
  ok("…'stop entries' sells nothing by itself", trips.exits.length === 0);
  const again = protections({ spec, positions, prices: { [JUP]: 1.0, [JTO]: 1.0 }, settlementUsd: 50, day: trips.day, now: NOON + 180_000 });
  ok("recovering the same UTC day does not untrip it", again.breaker.tripped === true && again.breaker.justTripped === false);
  const p = saw(planOrders({ spec, proposals: [buy(JTO, 20)], positions, prices: { [JUP]: 1, [JTO]: 1 }, settlementUsd: 50, day: again.day }));
  ok("a buy after the trip is refused at drawdown_breaker, naming UTC midnight", clauses(p).includes("drawdown_breaker") && /UTC midnight/.test(p.refusals[0].message));
  const s = planOrders({ spec, proposals: [sell(JUP, 1)], positions, prices: { [JUP]: 1, [JTO]: 1 }, settlementUsd: 50, day: again.day });
  ok("…but a sell is still allowed: it only takes risk off", s.orders.length === 1 && s.orders[0].side === "sell");
  const liq = protections({ spec: liquidating, positions, prices: { [JUP]: 0.9375, [JTO]: 0.95 }, settlementUsd: 48, day: start, now: NOON + 120_000 });
  ok("with 'liquidate' the trip sells every position (drawdown_liquidate)", liq.exits.length === 2 && liq.exits.every((x) => x.reason === "drawdown_liquidate" && x.fraction === 1));
  const liqStop = protections({ spec: liquidating, positions: { [JUP]: pos(JUP, 40, 40) }, prices: { [JUP]: 0.5 }, settlementUsd: 50, day: start, now: NOON });
  ok("…and a position that also hit its stop leaves once, at stop_loss", liqStop.exits.length === 1 && liqStop.exits[0].reason === "stop_loss");
  const midnight = rollDay(again.day, { now: Date.UTC(2026, 8, 25, 0, 0, 1), equityUsd: 95 });
  const fresh = saw(planOrders({ spec, proposals: [buy(JTO, 20)], positions, prices: { [JUP]: 1, [JTO]: 1 }, settlementUsd: 50, day: midnight }));
  ok("after UTC midnight the breaker is reset and the same buy goes through", fresh.orders.length === 1 && !clauses(fresh).includes("drawdown_breaker"));
  const zero = protections({ spec, positions: {}, prices: {}, settlementUsd: 0, day: rollDay(null, { now: NOON, equityUsd: 0 }), now: NOON });
  ok("a day that started at $0 never divides by zero or trips", zero.breaker.tripped === false && zero.breaker.drawdownPct === 0);
}

section("5. WHAT THE MODEL MAY NAME");
{
  const p = saw(plan({ proposals: [
    { action: "withdraw", mint: JUP, usd: 50 }, { action: "set_limit", mint: JUP }, buy(OUTSIDER, 20), buy(DEFAULT_SETTLEMENT_MINT, 20),
    buy(JUP, 20), buy(JUP, 20), null, "sell everything",
  ] }));
  ok("an action that is not buy, sell or hold is refused at action_unknown (withdraw, set_limit, garbage)", p.refusals.filter((x) => x.clause === "action_unknown").length === 4);
  ok("a token outside the universe is refused at not_in_universe", p.refusals.some((x) => x.clause === "not_in_universe" && x.mint === OUTSIDER));
  ok("the settlement token is refused at settlement_not_tradable", p.refusals.some((x) => x.clause === "settlement_not_tradable"));
  ok("a second action for one mint in one tick is refused at duplicate_mint", p.refusals.some((x) => x.clause === "duplicate_mint" && x.mint === JUP));
  ok("…and the first one still goes through", p.orders.length === 1 && p.orders[0].mint === JUP);
  const h = plan({ proposals: [{ action: "hold", mint: JTO, confidence: 0.5, reason: "wait" }] });
  ok("hold is recorded as a hold, and orders nothing", h.orders.length === 0 && h.holds.length === 1 && h.holds[0].mint === JTO);
}

section("6. BUYS: GATES, THEN CLAMPS, IN ORDER");
{
  const paused = saw(plan({ proposals: [buy(JUP, 20)], paused: true }));
  ok("paused: no buys (paused)", clauses(paused).join() === "paused");
  const small = saw(plan({ proposals: [buy(JUP, 20)], settlementUsd: 40 }));
  ok("a vault under $50 buys nothing (vault_below_minimum)", clauses(small).join() === "vault_below_minimum" && /\$50/.test(small.refusals[0].message));
  const count = saw(plan({ proposals: [buy(JUP, 20)], day: { ...day0, trades: 4 } }));
  ok("the fourth trade of a four-a-day agent was the last (trades_per_day)", clauses(count).join() === "trades_per_day");
  const unpriced = saw(plan({ proposals: [buy(RAY, 20)], prices: { [RAY]: null } }));
  ok("a token with no price cannot be sized against its caps (price_missing)", clauses(unpriced).join() === "price_missing");
  const nosize = saw(plan({ proposals: [{ action: "buy", mint: JUP, confidence: 1, reason: "x" }, { action: "buy", mint: JTO, usd: -5, confidence: 1, reason: "x" }] }));
  ok("a buy with no amount, or a negative one, is refused (size_missing)", clauses(nosize).join() === "size_missing,size_missing");
  const tiny = saw(plan({ proposals: [buy(JUP, 9.99)] }));
  ok("a $9.99 buy is under the $10 minimum trade (below_min_trade)", clauses(tiny).join() === "below_min_trade");
  const exact = plan({ proposals: [buy(JUP, 10)] });
  ok("…and exactly $10 goes through", exact.orders.length === 1 && exact.orders[0].usd === 10);

  const capped = plan({ proposals: [buy(JUP, 100)] });
  ok("$100 asked is clamped to the $30 per-token cap", capped.orders[0]?.usd === 30 && capped.orders[0].clampedBy.join() === "position_cap" && capped.orders[0].askedUsd === 100);
  const partly = plan({ proposals: [buy(JUP, 25)], positions: { [JUP]: pos(JUP, 10, 10) }, prices: { [JUP]: 1.5 }, settlementUsd: 100 });     // holds $15 of JUP
  ok("holding $15, the per-token cap leaves $15", partly.orders[0]?.usd === 15 && partly.orders[0].clampedBy.includes("position_cap"));
  const full = saw(plan({ proposals: [buy(JUP, 25)], positions: { [JUP]: pos(JUP, 10, 10) }, prices: { [JUP]: 2.5 }, settlementUsd: 100 }));    // holds $25: $5 left
  ok("holding $25 of a $30 cap, $5 is left: refused at position_cap, not bought", clauses(full).join() === "position_cap" && /\$5\.00/.test(full.refusals[0].message));
  const exposure = saw(plan({ proposals: [buy(PYTH, 30)], positions: { [JUP]: pos(JUP, 25, 25), [JTO]: pos(JTO, 25, 25, { decimals: 9 }) }, prices: { [JUP]: 1, [JTO]: 1, [PYTH]: 0.5 }, settlementUsd: 50 }));
  ok("$50 in tokens of a $100 vault at a 60% cap leaves $10: clamped to exactly $10", exposure.orders[0]?.usd === 10 && exposure.orders[0].clampedBy.join() === "exposure_cap");
  const noRoom = saw(plan({ proposals: [buy(PYTH, 30)], positions: { [JUP]: pos(JUP, 28, 28), [JTO]: pos(JTO, 28, 28, { decimals: 9 }) }, prices: { [JUP]: 1, [JTO]: 1, [PYTH]: 0.5 }, settlementUsd: 44 }));
  ok("$56 of $100 in tokens leaves $4 under the exposure cap: refused at exposure_cap", clauses(noRoom).join() === "exposure_cap");
  /* At a 100% exposure cap the settlement balance is the tighter room, and it is named. */
  const cash = saw(planOrders({ spec: spec100, proposals: [buy(JUP, 20)], positions: { [JTO]: pos(JTO, 45, 45, { decimals: 9 }) }, prices: { [JUP]: 1, [JTO]: 1.2 }, settlementUsd: 8, day: day0 }));
  ok("with $8 of settlement left the buy is refused at settlement_short", clauses(cash).join() === "settlement_short", clauses(cash).join());
  const cashClamp = planOrders({ spec: spec100, proposals: [buy(JUP, 20)], positions: { [JTO]: pos(JTO, 45, 45, { decimals: 9 }) }, prices: { [JUP]: 1, [JTO]: 1.2 }, settlementUsd: 14.5, day: day0 });
  ok("…and with $14.50 left the buy is clamped to $14.50 by it", cashClamp.orders[0]?.usd === 14.5 && cashClamp.orders[0].clampedBy.join() === "settlement_short");
  const two = plan({ proposals: [buy(JUP, 30), buy(JTO, 30), buy(PYTH, 30)], settlementUsd: 100 });
  ok("three $30 buys in a $100 vault at 60%: $30, $30, then refused — the pending buys count against the cap", two.orders.map((o) => o.usd).join() === "30,30" && clauses(two).join() === "exposure_cap");
  const cents = plan({ proposals: [buy(JUP, 12.349)] });
  ok("a buy is rounded down to the cent", cents.orders[0]?.usd === 12.34);
  const count2 = plan({ proposals: [buy(JUP, 10), buy(JTO, 10), buy(PYTH, 10)], day: { ...day0, trades: 2 } });
  ok("with two of four trades made, two buys go and the third is refused at trades_per_day", count2.orders.length === 2 && clauses(count2).join() === "trades_per_day");
}

section("7. SELLS");
{
  const positions = { [JUP]: pos(JUP, 100, 100), [JTO]: pos(JTO, 5, 5, { decimals: 9 }) };
  const none = saw(plan({ proposals: [sell(PYTH, 1)], positions }));
  ok("selling what is not held is refused (no_position)", clauses(none).join() === "no_position");
  const half = plan({ proposals: [sell(JUP, 0.5)], positions, prices: { [JUP]: 1, [JTO]: 1 } });
  ok("half of 100 JUP is exactly 50,000,000 raw", half.orders[0]?.qtyRaw === "50000000" && half.orders[0].fraction === 0.5 && half.orders[0].estUsd === 50);
  const all = plan({ proposals: [sell(JUP, 1)], positions, prices: { [JUP]: 1 } });
  ok("a fraction of 1 sells the whole raw balance", all.orders[0]?.qtyRaw === positions[JUP].qtyRaw);
  const tinySell = saw(plan({ proposals: [sell(JUP, 0.05)], positions, prices: { [JUP]: 1 } }));
  ok("a partial sell worth $5 is under the minimum (below_min_trade)", clauses(tinySell).join() === "below_min_trade");
  const dust = plan({ proposals: [sell(JTO, 1)], positions, prices: { [JTO]: 1 } });
  ok("…but a whole $5 position may always be sold", dust.orders.length === 1 && dust.orders[0].qtyRaw === positions[JTO].qtyRaw);
  const blind = saw(plan({ proposals: [sell(JUP, 0.5)], positions, prices: { [JUP]: null } }));
  ok("a partial sell with no price is refused (price_missing); the whole position is not", clauses(blind).join() === "price_missing" && plan({ proposals: [sell(JUP, 1)], positions, prices: { [JUP]: null } }).orders.length === 1);
  const badFraction = saw(plan({ proposals: [sell(JUP, 0), sell(JTO, 1.5)], positions }));
  ok("a fraction of 0 or above 1 is refused (size_missing)", clauses(badFraction).join() === "size_missing,size_missing");
  const order = plan({ proposals: [buy(PYTH, 10), sell(JUP, 1)], positions, prices: { [JUP]: 1, [PYTH]: 0.5, [JTO]: 1 }, day: { ...day0, trades: 3 } });
  ok("sells are planned before buys: with one trade left, the sell takes it", order.orders.map((o) => o.side).join() === "sell" && clauses(order).join() === "trades_per_day");
  const pausedSell = plan({ proposals: [sell(JUP, 1)], positions, prices: { [JUP]: 1 }, paused: true });
  ok("paused, a sell still plans (a pause stops entries, not exits)", pausedSell.orders.length === 1);
  const proceeds = planOrders({ spec: spec100, proposals: [sell(JUP, 1), buy(PYTH, 20)], positions, prices: { [JUP]: 1, [PYTH]: 0.5, [JTO]: 1 }, settlementUsd: 5, day: day0 });
  ok("a sell's proceeds are not spent by a buy in the same tick (settlement_short)", proceeds.orders.length === 1 && clauses(proceeds).join() === "settlement_short");
}

section("8. NOTHING THE MODEL SENDS IS A LIMIT");
{
  const before = JSON.stringify(spec);
  const sly = plan({ proposals: [
    { ...buy(JUP, 1_000), maxPositionUsd: 1_000_000, stopLossPct: 99, limits: { maxExposurePct: 100 } },
    { ...buy(JTO, 1_000), spec: { maxPositionUsd: 1e9 } },
  ], settlementUsd: 100 });
  ok("a proposal carrying limits is sized by the spec's limits alone: $1,000 asked, $30 per token", sly.orders.every((o) => o.usd <= 30) && sly.orders[0].usd === 30, sly.orders.map((o) => o.usd).join());
  ok("…and the second is still held to the 60% exposure cap", sly.orders[1]?.usd === 30 && sly.orders.reduce((a, o) => a + o.usd, 0) <= 60);
  ok("the spec is unchanged and frozen after planning", JSON.stringify(spec) === before && Object.isFrozen(spec));
  let threw = false; try { spec.maxPositionUsd = 1e9; } catch { threw = true; }
  ok("…a write to it throws in strict mode and changes nothing", threw && spec.maxPositionUsd === 30);
  const prot = protections({ spec, positions: { [JUP]: pos(JUP, 10, 10) }, prices: { [JUP]: 0.5 }, settlementUsd: 90, day: day0, now: NOON });
  ok("the protections read the spec too: a −50% position stops whatever any proposal said", prot.exits[0]?.reason === "stop_loss");
  ok("the minimum trade and the minimum vault are the fixed $10 and $50, not dials", AGENT_BOUNDS.minTradeUsd === 10 && AGENT_BOUNDS.minVaultUsd === 50 && !("minTradeUsd" in spec) && !("minVaultUsd" in spec));
}

section("9. EVERY CLAUSE WAS PRODUCED");
{
  const missing = RISK_CLAUSES.filter((c) => !seen.has(c));
  ok("every refusal clause in RISK_CLAUSES appeared above, by name", missing.length === 0, missing.join(", ") || `${RISK_CLAUSES.length} clauses`);
  ok("no clause appeared that RISK_CLAUSES does not list", [...seen].every((c) => RISK_CLAUSES.includes(c)), [...seen].filter((c) => !RISK_CLAUSES.includes(c)).join(", ") || "none");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
