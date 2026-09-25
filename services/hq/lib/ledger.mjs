/**
 * THE LEDGER: EVERY NUMBER HQ PUBLISHES ABOUT AN AGENT, FROM ITS EVENTS ALONE.
 *
 * Live, the events are the agent wallet's own transactions read off the chain and classified
 * (classify.mjs); paper, they are the simulated fills and the paper bankroll HQ recorded, since
 * paper has no chain to read. The same function turns either into the same figures, and a paper
 * ledger never sees a live event or the reverse: the two are never mixed.
 *
 * WHAT COUNTS AS WHAT (all BigInt lamports; tokens in raw units):
 *   · deposits and withdrawals move money in and out; they are never profit or loss.
 *   · trades: a buy adds to its position at its full cost (network fee included, the wallet's own
 *     token account rent excluded: that rent is a deposit the chain returns); a sell realizes
 *     proceeds (net of its fee) less the average cost of what it sold.
 *   · creator fees are their own line and NEVER trading P&L (the contract's rule, and the rank's).
 *   · operations (wrapping SOL, closing an account, a transaction that failed, the fee of a
 *     withdrawal) cost network fees, which ARE charged to trading P&L: they exist only to trade.
 *   · a token that arrived without being bought (an airdrop) is never a position, and selling
 *     more of a token than was bought counts only what was bought as a trade: nothing becomes
 *     profit that the agent did not pay for.
 *   · realized P&L = Σ sells' profit − operations' cost; unrealized = Σ positions' value at their
 *     mark − their cost (a position with no mark is valued at cost and said to be unpriced).
 *   · a round trip is a position from empty to empty (dust of at most 0.01% of what was bought,
 *     left by a sell of a rounded amount, counts as empty and its cost as lost); it is a win when
 *     its realized profit is above zero, else a loss.
 *   · max drawdown is measured on a unit value (like a fund's price per share): money in and out
 *     changes the units, not the price, so a withdrawal is not a drawdown.
 */
export const LEDGER_VERSION = "hq-ledger-v1";

const ZERO = 0n;
const valueAt = (qty, price) => (price && price.tokens > 0n ? (qty * price.lamports) / price.tokens : null);

/**
 * events: classified events (classify.mjs shapes; paper uses the same), any order.
 * marks:  Map mint → { lamports, tokens } (SOL for so many raw units), for unrealized value.
 * lastMarks: the last mark each position had, used for its value (never called priced) when
 *         no mark can be had now; a position never marked is valued at its cost.
 * Returns the ledger (see bottom).
 */
export function buildLedger(events, { marks = new Map(), lastMarks = new Map() } = {}) {
  /* Chain order: slot, then the transaction's index in its block; paper: time, then its order. */
  const list = [...events].filter(Boolean).sort((a, b) => ((a.slot ?? 0) - (b.slot ?? 0)) || ((a.index ?? 0) - (b.index ?? 0))
    || String(a.t ?? "").localeCompare(String(b.t ?? "")) || ((a.order ?? 0) - (b.order ?? 0)) || String(a.signature ?? a.id ?? "").localeCompare(String(b.signature ?? b.id ?? "")));
  let cash = ZERO, rent = ZERO, deposited = ZERO, withdrawn = ZERO, feesClaimed = ZERO, realized = ZERO, opsCost = ZERO, other = ZERO;
  let wins = 0, losses = 0, fills = 0;
  const positions = new Map();            // mint → { mint, decimals, qty, cost, openedAt, lastPrice, tripPnl, tripCost, buys, sells }
  const trades = [], transfers = [], fees = [], roundTrips = [], equity = [], flows = [];
  /* Every change to realized trading P&L, with its time: a sell's profit, an operation's cost. */
  const realizedEvents = [];
  const realize = (t, amount) => { if (amount !== ZERO) realizedEvents.push({ t: t ?? null, amount }); };
  /* The unit value for the drawdown: units bought and redeemed at the value per unit. */
  let units = 0, peakNav = null, maxDd = 0;

  const portfolioNow = () => {
    let v = cash + rent;
    for (const p of positions.values()) v += valueAt(p.qty, p.lastPrice) ?? p.cost;
    return v;
  };
  const flow = (amount) => {
    /* amount > 0 in, < 0 out, applied at the value before it; emptied, the count starts again */
    const before = portfolioNow();
    const nav = units > 0 && before > 0n ? Number(before) / units : 1;
    units = before + BigInt(amount) <= 0n ? 0 : Math.max(0, units + Number(amount) / nav);
    if (units === 0) peakNav = null;
  };
  const point = (e) => {
    const p = portfolioNow();
    equity.push({ t: e.t, portfolio: p, netDeposits: deposited - withdrawn });
    if (p <= 0n) { units = 0; peakNav = null; return; }      /* emptied: a later deposit starts a new count */
    if (units > 0) {
      const nav = Number(p) / units;
      if (peakNav === null || nav > peakNav) peakNav = nav;
      else if (peakNav > 0) maxDd = Math.max(maxDd, (peakNav - nav) / peakNav);
    }
  };

  for (const e of list) {
    const fee = e.fee ?? ZERO;
    /* The balances move by exactly what the chain (or the paper fill) says; the kinds below
       decide only what each movement counts as. */
    const cashDelta = e.cashDelta ?? impliedCashDelta(e);
    const rentDelta = e.rentDelta ?? ZERO;
    const external = e.kind === "deposit" ? e.lamports : e.kind === "withdrawal" ? -e.lamports
      : (e.kind === "airdrop" || e.kind === "other") ? (e.value ?? ZERO) : ZERO;
    if (external !== ZERO) flow(external);
    cash += cashDelta; rent += rentDelta;
    switch (e.kind) {
      case "deposit": {
        deposited += e.lamports;
        transfers.push({ t: e.t, kind: "deposit", lamports: e.lamports, tx: e.signature ?? null, counterparty: e.from ?? null });
        break;
      }
      case "withdrawal": {
        withdrawn += e.lamports; opsCost += fee; realize(e.t, -fee);
        transfers.push({ t: e.t, kind: "withdrawal", lamports: e.lamports, tx: e.signature ?? null, counterparty: e.to ?? null, memo: e.hq ?? null });
        break;
      }
      case "fee": {
        feesClaimed += e.lamports;
        fees.push({ t: e.t, lamports: e.lamports, tx: e.signature ?? null });
        break;
      }
      case "ops": {
        opsCost += e.cost; realize(e.t, -e.cost);
        break;
      }
      case "trade": {
        fills++;
        if (e.side === "buy") {
          const p = positions.get(e.mint) ?? { mint: e.mint, decimals: e.decimals, qty: ZERO, cost: ZERO, openedAt: e.t, lastPrice: null, tripPnl: ZERO, tripCost: ZERO, bought: ZERO, buys: 0, sells: 0 };
          if (p.qty === ZERO) { p.openedAt = e.t; p.tripPnl = ZERO; p.tripCost = ZERO; p.bought = ZERO; }
          p.qty += e.tokens; p.cost += e.sol; p.tripCost += e.sol; p.bought += e.tokens; p.buys++;
          p.lastPrice = { lamports: e.sol, tokens: e.tokens };
          positions.set(e.mint, p);
          trades.push({ id: e.id ?? e.signature, t: e.t, side: "buy", mint: e.mint, decimals: e.decimals, sol: e.sol, tokens: e.tokens, fee, pnl: null, pnlPct: null, tx: e.signature ?? null, trigger: e.trigger ?? null, decisionId: e.decisionId ?? null, slot: e.slot ?? null });
        } else {
          const p = positions.get(e.mint);
          const held = p?.qty ?? ZERO;
          const traded = e.tokens <= held ? e.tokens : held;
          /* Proceeds for what was bought; anything sold beyond it is not a trade's profit. */
          const proceeds = e.tokens === ZERO ? ZERO : (e.sol * traded) / e.tokens;
          const beyond = e.sol - proceeds;
          if (beyond !== ZERO) other += beyond;
          let pnl = null, basis = ZERO;
          if (p && traded > ZERO) {
            basis = (p.cost * traded) / p.qty;
            pnl = proceeds - basis;
            realized += pnl;
            p.qty -= traded; p.cost -= basis; p.tripPnl += pnl; p.sells++;
            p.lastPrice = { lamports: e.sol, tokens: e.tokens };
            /* Dust left by a sell of a rounded amount (at most 0.01% of what was bought) closes the
               round trip: its remaining cost is realized as a loss and the dust is not a position. */
            if (p.qty > ZERO && p.qty * 10_000n <= p.bought) { realized -= p.cost; p.tripPnl -= p.cost; pnl -= p.cost; p.qty = ZERO; p.cost = ZERO; }
            realize(e.t, pnl);
            if (p.qty === ZERO) {
              roundTrips.push({ mint: e.mint, openedAt: p.openedAt, closedAt: e.t, cost: p.tripCost, pnl: p.tripPnl });
              if (p.tripPnl > ZERO) wins++; else losses++;
              positions.delete(e.mint);
            }
          }
          trades.push({ id: e.id ?? e.signature, t: e.t, side: "sell", mint: e.mint, decimals: e.decimals, sol: e.sol, tokens: e.tokens, fee, pnl, pnlPct: pnl === null || basis === ZERO ? null : pctOf(pnl, basis), basis, tx: e.signature ?? null, trigger: e.trigger ?? null, decisionId: e.decisionId ?? null, slot: e.slot ?? null });
        }
        break;
      }
      case "token_out": {
        const p = positions.get(e.mint);
        opsCost += -e.value;                      /* the fee it cost */
        realize(e.t, e.value);
        if (p && p.qty > ZERO) {
          const moved = e.tokens <= p.qty ? e.tokens : p.qty;
          const basis = (p.cost * moved) / p.qty;
          flow(-basis);
          p.qty -= moved; p.cost -= basis;
          if (p.qty === ZERO) positions.delete(e.mint);
          flows.push({ t: e.t, kind: "token_out", mint: e.mint, tokens: moved, atCost: basis, tx: e.signature ?? null });
        }
        break;
      }
      case "airdrop":
      case "other": {
        const v = e.value ?? ZERO;
        other += v;
        flows.push({ t: e.t, kind: e.kind, value: v, tx: e.signature ?? null, note: e.note ?? null });
        break;
      }
      default: break;
    }
    if (e.t) point(e);
  }

  /* Marks: the unrealized side. */
  let unrealized = ZERO, positionsValue = ZERO;
  const open = [];
  for (const p of positions.values()) {
    const mark = marks.get(p.mint) ?? null;
    const markValue = valueAt(p.qty, mark);
    const lastValue = markValue === null ? valueAt(p.qty, lastMarks.get(p.mint) ?? null) : null;
    const value = markValue ?? lastValue ?? p.cost;
    positionsValue += value;
    unrealized += value - p.cost;
    open.push({ mint: p.mint, decimals: p.decimals, qty: p.qty, cost: p.cost, value, priced: markValue !== null, pnl: value - p.cost, pnlPct: pctOf(value - p.cost, p.cost), openedAt: p.openedAt, entry: { lamports: p.cost, tokens: p.qty }, mark });
  }
  const portfolio = cash + rent + positionsValue;
  const netDeposits = deposited - withdrawn;
  realized -= opsCost;
  return Object.freeze({
    version: LEDGER_VERSION,
    cash, rent, deposited, withdrawn, netDeposits, feesClaimed, realized, unrealized, positionsValue, portfolio, opsCost, other,
    positions: open, trades, transfers, fees, roundTrips, equity, flows, realizedEvents,
    fills, wins, losses,
    maxDrawdownPct: Math.round(maxDd * 10_000) / 100,
    roiPct: deposited === ZERO || netDeposits <= ZERO ? null : pctOf(realized + unrealized, netDeposits),
  });
}

/** What a paper event moves in cash when it names no delta (paper fills carry none). */
function impliedCashDelta(e) {
  switch (e.kind) {
    case "deposit": return e.lamports;
    case "withdrawal": return -(e.lamports + (e.fee ?? ZERO));
    case "fee": return e.lamports;
    case "ops": return -e.cost;
    case "trade": return e.side === "buy" ? -e.sol : e.sol;
    case "token_out": case "airdrop": case "other": return e.value ?? ZERO;
    default: return ZERO;
  }
}

/** part / whole × 100, as a number with two decimals (display only), or null. */
export function pctOf(part, whole) {
  if (!whole) return null;
  return Number((BigInt(part) * 10_000n) / BigInt(whole)) / 100;
}

/** Realized trading P&L since `since` (ms): the sum of the realized changes dated from then on. */
export function realizedSince(ledger, since) {
  let sum = 0n;
  for (const x of ledger.realizedEvents ?? []) if (x.t && Date.parse(x.t) >= since) sum += x.amount;
  return sum;
}

/**
 * Trading P&L inside a period, from the equity points: the change in (portfolio − net deposits)
 * between the last point before `since` (or the first point) and now.
 */
export function periodPnl(points, { since, nowPortfolio, nowNetDeposits }) {
  let start = null;
  for (const p of points) { if (Date.parse(p.t) <= since) start = p; else break; }
  const base = start ?? (points[0] ? { portfolio: 0n, netDeposits: 0n } : null);
  if (!base) return { pnl: 0n, capital: 0n };
  const pnl = (nowPortfolio - nowNetDeposits) - (BigInt(base.portfolio) - BigInt(base.netDeposits));
  const flowsIn = nowNetDeposits - BigInt(base.netDeposits);
  const capital = BigInt(base.portfolio) + (flowsIn > 0n ? flowsIn : 0n);
  return { pnl, capital };
}
