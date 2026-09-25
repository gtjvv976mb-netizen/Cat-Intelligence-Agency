/**
 * THE ONE RISK LAYER EVERY AGENT RUNS BEHIND, WHATEVER ITS STRATEGY. Pure: no clock, no network,
 * no storage; the gate (gate.mjs) hands it the facts and does what it says.
 *
 * BEFORE A BUY, in order, cheapest first; the first that fails names the refusal:
 *   kill_switch          HQ_KILL=1 or the owner's kill command: no agent buys anything
 *   agent_retired        a retired agent never buys again
 *   agent_paused         a paused agent does not buy (its protections still sell)
 *   live_not_enabled     the agent is live but HQ_LIVE is not 1: it does nothing rather than
 *                        quietly trade on paper, because its numbers are live numbers
 *   agency_coin          the coin is the agency's own ($CIA, an agent's, a registered one,
 *                        CashCat's, or made by an agency wallet)
 *   in_flight            a transaction of this agent is being signed, sent or confirmed
 *   already_holding      the agent already holds this coin
 *   max_open_positions   it already holds as many coins as its limit allows
 *   daily_loss_limit     today's (UTC) trading loss reached the limit: no buys until midnight
 *   size                 clamped to the max per trade, then to what the wallet can spend (its
 *                        cash less the reserve and the fees of the buy and a sell); refused
 *                        under the minimum trade (insufficient_balance / below_min_trade)
 * then, in the gate, Crying Cat's rug check (rug_check) — last, because it reads the chain.
 *
 * AFTER A BUY, on every exit tick, for every position, whatever the strategy says:
 *   stop_loss       its value at the mark fell to (1 − stop loss) of its cost
 *   take_profit     its value reached (1 + take profit) of its cost
 *   trailing_stop   (when set) its value fell the trailing percentage below the highest value
 *                   it has had since the buy
 *   daily_limit     today's trading loss reached the daily limit: everything is sold, and the
 *                   agent buys nothing until UTC midnight
 * A position with no mark this tick cannot be judged and is said to be unpriced; it is judged
 * the next tick that reads one. Exits run while the agent is paused and under the kill switch:
 * a stop that stops working when the owner pauses is not a stop.
 */
import { parseSol, solString } from "./amounts.mjs";

export const MIN_TRADE_LAMPORTS = 1_000_000n;                  // 0.001 SOL: under it the fees are most of the trade
/** The network fees a buy and its sell may cost, kept out of every size: two transactions at
 *  the executor's measured peak priority fee (92,207 lamports) plus the signature fee each. */
export const FEE_RESERVE_LAMPORTS = 2n * (92_207n + 5_000n);

export const LIMIT_FENCES = Object.freeze({
  maxPerTradeSol: Object.freeze({ min: "0.001", max: "1" }),
  maxOpenPositions: Object.freeze({ min: 1, max: 10 }),
  stopLossPct: Object.freeze({ min: 1, max: 90 }),
  takeProfitPct: Object.freeze({ min: 1, max: 1000 }),
  trailingStopPct: Object.freeze({ min: 1, max: 90 }),
  dailyLossLimitSol: Object.freeze({ min: "0.001", max: "10" }),
});

export class LimitError extends Error {
  constructor(key, message) { super(message); this.name = "LimitError"; this.key = key; }
}

const pctNum = (v, key, { min, max }, nullable = false) => {
  if (nullable && (v === null || v === undefined || v === "" || v === "null" || v === "off")) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new LimitError(key, `${key} must be a percentage from ${min} to ${max}${nullable ? ", or off" : ""}`);
  return Math.round(n * 100) / 100;
};
const solNum = (v, key, { min, max }) => {
  let l;
  try { l = typeof v === "bigint" ? v : parseSol(String(v), key); } catch (e) { throw new LimitError(key, e.message); }
  if (l < parseSol(min) || l > parseSol(max)) throw new LimitError(key, `${key} must be from ${min} to ${max} SOL`);
  return l;
};

/** Limits from the owner's input over the strategy's defaults, fenced. Stored as strings. */
export function normalizeLimits(input = {}, defaults = {}) {
  const src = { ...defaults, ...Object.fromEntries(Object.entries(input ?? {}).filter(([, v]) => v !== undefined)) };
  const unknown = Object.keys(input ?? {}).filter((k) => !(k in LIMIT_FENCES));
  if (unknown.length) throw new LimitError(unknown[0], `unknown limit ${unknown.join(", ")}: the limits are ${Object.keys(LIMIT_FENCES).join(", ")}`);
  const F = LIMIT_FENCES;
  const maxPerTrade = solNum(src.maxPerTradeSol, "maxPerTradeSol", F.maxPerTradeSol);
  const maxOpen = Number(src.maxOpenPositions);
  if (!(Number.isInteger(maxOpen) && maxOpen >= F.maxOpenPositions.min && maxOpen <= F.maxOpenPositions.max)) throw new LimitError("maxOpenPositions", `maxOpenPositions must be a whole number from ${F.maxOpenPositions.min} to ${F.maxOpenPositions.max}`);
  const dailyLoss = solNum(src.dailyLossLimitSol, "dailyLossLimitSol", F.dailyLossLimitSol);
  if (dailyLoss < maxPerTrade / 2n) throw new LimitError("dailyLossLimitSol", "dailyLossLimitSol is under half the max per trade: the first stop loss would trip it");
  return Object.freeze({
    maxPerTradeSol: solString(maxPerTrade),
    maxOpenPositions: maxOpen,
    stopLossPct: pctNum(src.stopLossPct, "stopLossPct", F.stopLossPct),
    takeProfitPct: pctNum(src.takeProfitPct, "takeProfitPct", F.takeProfitPct),
    trailingStopPct: pctNum(src.trailingStopPct ?? null, "trailingStopPct", F.trailingStopPct, true),
    dailyLossLimitSol: solString(dailyLoss),
  });
}
const lam = (limits) => ({ maxPerTrade: parseSol(limits.maxPerTradeSol), dailyLoss: parseSol(limits.dailyLossLimitSol) });

export const BUY_CLAUSES = Object.freeze(["kill_switch", "agent_retired", "agent_paused", "live_not_enabled", "agency_coin", "in_flight",
  "already_holding", "max_open_positions", "daily_loss_limit", "insufficient_balance", "below_min_trade", "rug_check"]);

/**
 * May this agent buy, and for how much? Returns { ok: true, sizeLamports, clampedBy[] } or
 * { ok: false, clause, message }.
 */
export function checkBuy({ killSwitch, agent, liveAllowed, agencyVerdict = null, inflight, holding, openPositions, dayTripped, limits, cashLamports, reserveLamports, askedLamports }) {
  const no = (clause, message) => Object.freeze({ ok: false, clause, message });
  if (killSwitch) return no("kill_switch", "the kill switch is on: no agent buys anything");
  if (agent.status === "retired") return no("agent_retired", "this agent is retired");
  if (agent.status !== "active") return no("agent_paused", "this agent is paused: no new buys (its protections keep selling)");
  if (agent.mode === "live" && !liveAllowed) return no("live_not_enabled", "this agent is live, but HQ_LIVE is not 1: it trades nothing");
  if (agencyVerdict?.agency) return no("agency_coin", `never buys an agency coin: ${agencyVerdict.why}`);
  if (inflight) return no("in_flight", "a transaction of this agent is still being signed, sent or confirmed");
  if (holding) return no("already_holding", "it already holds this coin");
  if (openPositions >= limits.maxOpenPositions) return no("max_open_positions", `it holds ${openPositions} coin(s), its limit is ${limits.maxOpenPositions}`);
  if (dayTripped) return no("daily_loss_limit", "today's trading loss reached the daily limit: no buys until UTC midnight");
  const { maxPerTrade } = lam(limits);
  const clampedBy = [];
  let size = BigInt(askedLamports);
  if (size > maxPerTrade) { size = maxPerTrade; clampedBy.push("max_per_trade"); }
  const spendable = BigInt(cashLamports) - BigInt(reserveLamports) - FEE_RESERVE_LAMPORTS;
  if (size > spendable) { size = spendable > 0n ? spendable : 0n; clampedBy.push("balance"); }
  if (size < MIN_TRADE_LAMPORTS) {
    return clampedBy.includes("balance")
      ? no("insufficient_balance", `the wallet can spend ${solString(spendable > 0n ? spendable : 0n)} SOL after its reserve and fees, under the ${solString(MIN_TRADE_LAMPORTS)} SOL minimum trade`)
      : no("below_min_trade", `${solString(size)} SOL is under the ${solString(MIN_TRADE_LAMPORTS)} SOL minimum trade`);
  }
  return Object.freeze({ ok: true, sizeLamports: size, clampedBy: Object.freeze(clampedBy) });
}

const bps = (pct) => BigInt(Math.round(Number(pct) * 100));

/**
 * The exits the limits order for the positions held. Each position is
 * { mint, cost (lamports), value (lamports at this tick's mark, or null), peak (lamports, the
 * highest value seen since the buy) }. Returns [{ mint, trigger, movePct }].
 */
export function checkExits({ positions, limits }) {
  const out = [];
  for (const p of positions) {
    if (p.value === null || p.value === undefined || !(p.cost > 0n)) continue;
    const value = BigInt(p.value), cost = BigInt(p.cost);
    const movePct = Number(((value - cost) * 10_000n) / cost) / 100;
    if (value * 10_000n <= cost * (10_000n - bps(limits.stopLossPct))) { out.push({ mint: p.mint, trigger: "stop_loss", movePct }); continue; }
    if (value * 10_000n >= cost * (10_000n + bps(limits.takeProfitPct))) { out.push({ mint: p.mint, trigger: "take_profit", movePct }); continue; }
    if (limits.trailingStopPct !== null && limits.trailingStopPct !== undefined && p.peak !== null && p.peak !== undefined) {
      const peak = BigInt(p.peak);
      if (peak > 0n && value * 10_000n <= peak * (10_000n - bps(limits.trailingStopPct))) out.push({ mint: p.mint, trigger: "trailing_stop", movePct });
    }
  }
  return out;
}

/**
 * THE DAILY LOSS LIMIT. `tradingEquity` is the portfolio less net deposits, claimed fees and other
 * outside value: what trading alone has made or lost, all time. The UTC day starts at the value
 * it had when the day was first seen; the limit trips when today's change reaches −limit, and
 * stays tripped until the next UTC day. Returns the day state to store.
 */
export function rollDay({ prev = null, nowMs, tradingEquity, limits }) {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const start = prev && prev.day === day ? BigInt(prev.start) : BigInt(tradingEquity);
  const change = BigInt(tradingEquity) - start;
  const tripped = Boolean(prev && prev.day === day && prev.tripped) || change <= -lam(limits).dailyLoss;
  return Object.freeze({ day, start: start.toString(), change: change.toString(), tripped, trippedAt: prev?.day === day && prev.trippedAt ? prev.trippedAt : tripped ? new Date(nowMs).toISOString() : null });
}

/** The limits as the contract prints them. */
export function limitsView(limits) {
  return Object.freeze({
    maxPerTradeSol: limits.maxPerTradeSol, maxOpenPositions: limits.maxOpenPositions,
    stopLossPct: String(limits.stopLossPct), takeProfitPct: String(limits.takeProfitPct),
    trailingStopPct: limits.trailingStopPct === null ? null : String(limits.trailingStopPct),
    dailyLossLimitSol: limits.dailyLossLimitSol,
  });
}
