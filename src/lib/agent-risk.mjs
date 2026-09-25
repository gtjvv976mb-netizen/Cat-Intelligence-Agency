/**
 * THE AGENT'S HARD LIMITS: DETERMINISTIC CODE, NOT THE MODEL.
 *
 * The model proposes; this file disposes. Every function here is pure — no clock of its
 * own, no network, no storage — so what it allows and what it refuses is the same on every
 * run, and test-agent-risk.mjs walks every clause. Two jobs:
 *
 *   · PROTECTIONS (`protections`), on every half-minute tick, whatever the model's
 *     schedule and whether or not it can be reached: a position at or under its entry price
 *     less the stop loss leaves in full (`stop_loss`); at or over its entry price plus the
 *     take profit it leaves in full (`take_profit`); and the vault is judged against its
 *     value at the start of the UTC day — at or past the daily drawdown the BREAKER trips,
 *     and, as the owner chose, either stops every new buy for the rest of the UTC day
 *     (`stop_entries`) or also sells everything back to the settlement token
 *     (`drawdown_liquidate`). It resets at UTC midnight (`rollDay`), never sooner. A
 *     position with no price this tick cannot be judged and says so; the vault is valued
 *     with its last price, and the view names it stale.
 *
 *   · ORDERS (`planOrders`), when the model has answered: each proposed action becomes an
 *     executable order, clamped, or a refusal with a clause. Sells first (they only reduce
 *     risk), then buys. A buy is clamped to the room left under the per-token cap, in the
 *     settlement balance and under the exposure cap, in that order, and refused — naming
 *     the tightest — when what is left is under the $10 minimum trade. Nothing the model sends is a limit: the limits
 *     are read from the spec alone, which this file never writes, and an action carrying
 *     anything but its own fields was refused before it got here (agent-brain.mjs).
 *
 * Money is US dollars as numbers, rounded down to the cent for a buy; token quantities are
 * raw integers carried as digit strings, divided with BigInt. The settlement token is
 * counted at face value. The proceeds of a sell this tick are not spent by a buy this tick:
 * a sell can fail, and a buy sized on money not yet back is a buy the vault may not cover.
 */
import { AGENT_BOUNDS } from "./agent-strategy.mjs";

export const RISK_CLAUSES = Object.freeze([
  "action_unknown", "not_in_universe", "settlement_not_tradable", "duplicate_mint", "size_missing",
  "paused", "drawdown_breaker", "vault_below_minimum", "trades_per_day", "price_missing",
  "below_min_trade", "below_min_confidence", "position_cap", "exposure_cap", "settlement_short", "no_position",
]);
export const EXIT_REASONS = Object.freeze(["stop_loss", "take_profit", "drawdown_liquidate", "liquidate_all"]);

const cents = (usd) => Math.floor(usd * 100 + 1e-9) / 100;
const EDGE = 1e-9;
const pct = (n) => Number(n.toFixed(4));

/** The UTC day a time falls in, as YYYY-MM-DD. The breaker's day. */
export function utcDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

/**
 * The day ledger: the vault's value when the UTC day began, the trades the model has made
 * in it, and whether the breaker has tripped. A new UTC day starts a new ledger at the
 * vault's value now; the same day returns the ledger unchanged.
 */
export function rollDay(day, { now, equityUsd }) {
  const today = utcDay(now);
  if (day && day.day === today) return day;
  return Object.freeze({ day: today, startedAt: now, startEquityUsd: equityUsd, trades: 0, tripped: false, trippedAt: null, drawdownPct: 0 });
}

/** A raw quantity in its token's units, as a number (for valuation only). */
export function unitsOf(qtyRaw, decimals) {
  const raw = BigInt(qtyRaw);
  const scale = 10n ** BigInt(decimals);
  return Number(raw / scale) + Number(raw % scale) / Number(scale);
}

/**
 * The vault as the limits see it: the settlement balance plus each position at this tick's
 * price, or its last price when this tick has none (named in `stale`), or its cost when it
 * has never been priced (named in `unpriced`).
 */
export function vaultView({ settlementUsd, positions, prices }) {
  const rows = [];
  const stale = [], unpriced = [];
  let positionsUsd = 0;
  for (const p of Object.values(positions ?? {})) {
    const qty = unitsOf(p.qtyRaw, p.decimals);
    let price = prices?.[p.mint] ?? null, basis = "price";
    if (price === null) {
      if (Number.isFinite(p.lastPriceUsd) && p.lastPriceUsd > 0) { price = p.lastPriceUsd; basis = "stale"; stale.push(p.mint); }
      else { price = qty > 0 ? p.costUsd / qty : 0; basis = "cost"; unpriced.push(p.mint); }
    }
    const valueUsd = qty * price;
    positionsUsd += valueUsd;
    const entry = qty > 0 ? p.costUsd / qty : null;
    rows.push({ mint: p.mint, symbol: p.symbol, qty, priceUsd: price, basis, valueUsd, costUsd: p.costUsd, entryPriceUsd: entry,
      pnlUsd: valueUsd - p.costUsd, pnlPct: p.costUsd > 0 ? (valueUsd / p.costUsd - 1) * 100 : null });
  }
  const equityUsd = settlementUsd + positionsUsd;
  return Object.freeze({ settlementUsd, positionsUsd, equityUsd, exposurePct: equityUsd > 0 ? pct((positionsUsd / equityUsd) * 100) : 0, rows: Object.freeze(rows), stale: Object.freeze(stale), unpriced: Object.freeze(unpriced) });
}

/**
 * THE PROTECTIONS. Exits for every position whose price crossed its stop loss or take
 * profit, and the breaker's verdict on the day. `day` is the ledger (rollDay first); the
 * returned `day` carries the breaker's state, stamped `now` when it trips. Exits are whole
 * positions (fraction 1).
 */
export function protections({ spec, positions, prices, settlementUsd, day, now }) {
  const view = vaultView({ settlementUsd, positions, prices });
  const exits = [], notes = [];
  const held = new Set();
  for (const p of Object.values(positions ?? {})) {
    const price = prices?.[p.mint] ?? null;
    const qty = unitsOf(p.qtyRaw, p.decimals);
    if (!(qty > 0)) continue;
    if (price === null) { notes.push({ mint: p.mint, clause: "price_missing", message: `${p.symbol}: no price this tick — its stop loss and take profit cannot be judged until one is read` }); continue; }
    const entry = p.costUsd / qty;
    const movePct = (price / entry - 1) * 100;
    /* A billionth of a percent of slack so an exact edge (0.92 on a 1.00 entry at −8%) fires
       as written, not a floating-point hair later. */
    if (movePct <= -spec.stopLossPct + EDGE) { exits.push({ mint: p.mint, symbol: p.symbol, reason: "stop_loss", fraction: 1, priceUsd: price, entryPriceUsd: entry, movePct: pct(movePct) }); held.add(p.mint); }
    else if (movePct >= spec.takeProfitPct - EDGE) { exits.push({ mint: p.mint, symbol: p.symbol, reason: "take_profit", fraction: 1, priceUsd: price, entryPriceUsd: entry, movePct: pct(movePct) }); held.add(p.mint); }
  }
  const start = day.startEquityUsd;
  const drawdownPct = start > 0 ? Math.max(0, pct(((start - view.equityUsd) / start) * 100)) : 0;
  const trips = !day.tripped && start > 0 && drawdownPct >= spec.maxDailyDrawdownPct - EDGE;
  const tripped = day.tripped || trips;
  const nextDay = Object.freeze({ ...day, tripped, trippedAt: trips ? now ?? null : day.trippedAt, drawdownPct: Math.max(day.drawdownPct ?? 0, drawdownPct) });
  if (tripped && spec.drawdownAction === "liquidate") {
    for (const p of Object.values(positions ?? {})) {
      if (held.has(p.mint) || !(unitsOf(p.qtyRaw, p.decimals) > 0)) continue;
      exits.push({ mint: p.mint, symbol: p.symbol, reason: "drawdown_liquidate", fraction: 1, priceUsd: prices?.[p.mint] ?? null, entryPriceUsd: null, movePct: null });
    }
  }
  return Object.freeze({
    exits: Object.freeze(exits), notes: Object.freeze(notes), view, day: nextDay,
    breaker: Object.freeze({ tripped, justTripped: trips, drawdownPct, limitPct: spec.maxDailyDrawdownPct, action: spec.drawdownAction, startEquityUsd: start, equityUsd: view.equityUsd }),
  });
}

/**
 * THE ORDERS. `proposals` are the model's validated actions; `positions` the book;
 * `prices` this tick's; `settlementUsd` what the vault can spend; `day` the ledger (with
 * the breaker's state); `paused` whether the owner paused the agent. Returns
 * { orders, refusals, holds }: an order is { side, mint, symbol, usd (buy) | qtyRaw and
 * fraction (sell), reason, confidence, clampedBy[] }; a refusal is { mint, action, clause,
 * message }. Nothing in `proposals` is read but action, mint, usd, fraction, confidence and reason.
 */
export function planOrders({ spec, proposals, positions, prices, settlementUsd, day, paused = false }) {
  const minTrade = AGENT_BOUNDS.minTradeUsd;
  const universe = new Set(spec.universe);
  const orders = [], refusals = [], holds = [];
  const refuse = (a, clause, message) => refusals.push(Object.freeze({ mint: typeof a?.mint === "string" ? a.mint : null, action: typeof a?.action === "string" ? a.action : null, clause, message }));
  const view = vaultView({ settlementUsd, positions, prices });
  const valueOf = (mint) => view.rows.find((r) => r.mint === mint)?.valueUsd ?? 0;
  let trades = day.trades;
  const seen = new Set();
  const list = Array.isArray(proposals) ? proposals : [];
  const valid = [];
  for (const a of list) {
    if (!a || !["buy", "sell", "hold"].includes(a.action)) { refuse(a, "action_unknown", `"${String(a?.action)}" is not buy, sell or hold`); continue; }
    if (a.mint === spec.settlementMint) { refuse(a, "settlement_not_tradable", "the settlement token is what the agent trades with, not into"); continue; }
    if (!universe.has(a.mint)) { refuse(a, "not_in_universe", `${String(a.mint)} is not in the agent's universe`); continue; }
    if (seen.has(a.mint)) { refuse(a, "duplicate_mint", `a second action for ${a.mint} in one tick`); continue; }
    seen.add(a.mint);
    valid.push(a);
  }
  const symbolOf = (mint) => positions?.[mint]?.symbol ?? mint;

  /* Sells first: they only take risk off. */
  for (const a of valid.filter((x) => x.action === "sell")) {
    const p = positions?.[a.mint];
    if (!p || BigInt(p.qtyRaw) <= 0n) { refuse(a, "no_position", `nothing of ${symbolOf(a.mint)} is held to sell`); continue; }
    const fraction = Number(a.fraction);
    if (!(Number.isFinite(fraction) && fraction > 0 && fraction <= 1)) { refuse(a, "size_missing", "a sell needs a fraction above 0 and at most 1"); continue; }
    if (trades >= spec.maxTradesPerDay) { refuse(a, "trades_per_day", `${trades} of ${spec.maxTradesPerDay} trades already made today (UTC)`); continue; }
    const price = prices?.[a.mint] ?? null;
    if (price === null && fraction < 1) { refuse(a, "price_missing", `${symbolOf(a.mint)} has no price this tick; only a sale of the whole position is allowed unpriced`); continue; }
    const whole = fraction >= 1;
    const qtyRaw = whole ? BigInt(p.qtyRaw) : (BigInt(p.qtyRaw) * BigInt(Math.round(fraction * 1_000_000))) / 1_000_000n;
    const usd = price === null ? null : unitsOf(qtyRaw, p.decimals) * price;
    if (!whole && usd !== null && usd < minTrade) { refuse(a, "below_min_trade", `selling ${(fraction * 100).toFixed(1)}% is about $${usd.toFixed(2)}, under the $${minTrade} minimum trade (a whole position may always be sold)`); continue; }
    if (qtyRaw <= 0n) { refuse(a, "below_min_trade", "that fraction of the position rounds to nothing"); continue; }
    trades++;
    orders.push(Object.freeze({ side: "sell", mint: a.mint, symbol: p.symbol, qtyRaw: qtyRaw.toString(), fraction: whole ? 1 : fraction, estUsd: usd, reason: a.reason ?? "", confidence: a.confidence ?? null, clampedBy: Object.freeze([]) }));
  }

  /* Then buys, each clamped to what is left. */
  let pendingUsd = 0;
  for (const a of valid.filter((x) => x.action === "buy")) {
    if (paused) { refuse(a, "paused", "the agent is paused: no new buys"); continue; }
    if (day.tripped) { refuse(a, "drawdown_breaker", `the daily drawdown breaker tripped at ${day.drawdownPct}% (limit ${spec.maxDailyDrawdownPct}%): no new buys until UTC midnight`); continue; }
    if (view.equityUsd < AGENT_BOUNDS.minVaultUsd) { refuse(a, "vault_below_minimum", `the vault is worth $${view.equityUsd.toFixed(2)}, under the $${AGENT_BOUNDS.minVaultUsd} minimum`); continue; }
    if (trades >= spec.maxTradesPerDay) { refuse(a, "trades_per_day", `${trades} of ${spec.maxTradesPerDay} trades already made today (UTC)`); continue; }
    if ((prices?.[a.mint] ?? null) === null) { refuse(a, "price_missing", `${String(a.mint)} has no price this tick, so its caps cannot be judged`); continue; }
    const asked = Number(a.usd);
    if (!(Number.isFinite(asked) && asked > 0)) { refuse(a, "size_missing", "a buy needs a positive usd amount"); continue; }
    if (asked < minTrade) { refuse(a, "below_min_trade", `$${asked.toFixed(2)} is under the $${minTrade} minimum trade`); continue; }
    const floor = spec.minBuyConfidence ?? 0;
    if (!(Number(a.confidence) >= floor)) { refuse(a, "below_min_confidence", `the model rated this buy ${a.confidence}, under the ${floor} confidence floor`); continue; }
    const rooms = [
      ["position_cap", spec.maxPositionUsd - valueOf(a.mint), `the $${spec.maxPositionUsd} per-token cap`],
      ["settlement_short", settlementUsd - pendingUsd, "the settlement balance"],
      ["exposure_cap", (spec.maxExposurePct / 100) * view.equityUsd - view.positionsUsd - pendingUsd, `the ${spec.maxExposurePct}% exposure cap`],
    ];
    let usd = asked;
    const clampedBy = [];
    let binding = null;
    for (const [clause, room, words] of rooms) {
      if (usd > room) { usd = room; clampedBy.push(clause); binding = [clause, words, room]; }
    }
    usd = cents(Math.max(0, usd));
    if (usd < minTrade) {
      const [clause, words, room] = binding ?? ["below_min_trade", "the minimum", 0];
      refuse(a, clause, `$${asked.toFixed(2)} asked; ${words} leaves $${Math.max(0, room).toFixed(2)}, under the $${minTrade} minimum trade`);
      continue;
    }
    pendingUsd += usd;
    trades++;
    orders.push(Object.freeze({ side: "buy", mint: a.mint, usd, askedUsd: asked, reason: a.reason ?? "", confidence: a.confidence ?? null, clampedBy: Object.freeze(clampedBy) }));
  }
  for (const a of valid.filter((x) => x.action === "hold")) holds.push(Object.freeze({ mint: a.mint, reason: a.reason ?? "" }));
  return Object.freeze({ orders: Object.freeze(orders), refusals: Object.freeze(refusals), holds: Object.freeze(holds), view });
}
