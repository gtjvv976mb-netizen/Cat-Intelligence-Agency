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
 *   · realized P&L = Σ sells' profit − operations' cost; unrealized = Σ positions' value − their
 *     cost, each position valued by THE STALE RULE (the contract's): with a quote under an hour
 *     old, at that quote (priced); with none for an hour, at the lower of its last price (its
 *     latest quote or fill, whichever is later) and its cost (unpriced); with no price at all for
 *     24 hours, at 0 until a quote returns. A coin that stops trading never keeps its last good
 *     price. The rule is applied at every point in time the ledger values (each event, each
 *     recorded snapshot, now), so the portfolio, the return, the drawdown and the chart agree.
 *   · a token moved out by hand (not sold) leaves as a withdrawal at its value then (by the same
 *     rule, so 0 when stale). A loss below its cost is realized (moving a position out never
 *     hides one); a gain above it never is (a move is not a sale): that part leaves as a
 *     withdrawal of outside value ("other"), never return and never rank. Its network fee is an
 *     operation's cost; value that arrives with it is never profit.
 *   · so, always: cash + rent + positions at cost = net deposits + fees claimed + realized + other
 *     (test-hq-ledger.mjs holds every recorded wallet to it).
 *   · a round trip is a position from empty to empty (dust of at most 0.01% of what was bought,
 *     left by a sell of a rounded amount, counts as empty and its cost as lost); it is a win when
 *     its realized profit is above zero, else a loss.
 *   · the return (roiPct) is realized + unrealized trading P&L over the SOL ever deposited (gross:
 *     a withdrawal or a sweep does not change it); creator fees and other arrivals never count.
 *   · max drawdown is measured on a unit value, like a fund's price per share: each SOL deposited
 *     buys units, so deposits, withdrawals, creator fees and other arrivals change the units and
 *     not the price, and only trading moves it. The value is taken at every event, at every
 *     recorded equity snapshot (with the quotes of that moment), and now (with today's quotes):
 *     a position is always valued at the latest quote known at that point.
 */
export const LEDGER_VERSION = "hq-ledger-v1";

const ZERO = 0n;
const valueAt = (qty, price) => (price && price.tokens > 0n ? (qty * price.lamports) / price.tokens : null);
export const QUOTE_FRESH_MS = 3_600_000;          // a quote under an hour old prices a position
export const PRICE_DEAD_MS = 24 * 3_600_000;       // no price for a day: valued at 0 until a quote returns
export const PERIOD_STARTS_MS = Object.freeze([7 * 86_400_000, 30 * 86_400_000]);   // the leaderboard's 7d and 30d
const ageOf = (x, T) => (T === null || !x?.at ? 0 : Date.parse(T) - Date.parse(x.at));
/** The later of a quote and a fill (a fill with no time, or a quote read now, counts as later). */
const laterOf = (q, f) => (!q ? f : !f ? q : q.at === null || f.at === null ? q : String(q.at) >= String(f.at) ? q : f);
/**
 * A position's value at time T (ISO, or null when the ledger has no clock: then the latest price
 * as it is). Returns { value, priced, stale }: priced when a quote under an hour old values it;
 * stale "hour" (the lower of its last price and its cost) or "day" (0).
 */
export function positionValueAt(p, T) {
  const last = laterOf(p.quote ?? null, p.fill ?? null);
  const lastValue = valueAt(p.qty, last) ?? p.cost;
  if (p.quote && valueAt(p.qty, p.quote) !== null && (T === null || ageOf(p.quote, T) <= QUOTE_FRESH_MS)) return { value: valueAt(p.qty, p.quote), priced: true, stale: null };
  if (T === null) return { value: lastValue, priced: false, stale: null };
  if (!last || ageOf(last, T) > PRICE_DEAD_MS) return { value: ZERO, priced: false, stale: "day" };
  return { value: lastValue < p.cost ? lastValue : p.cost, priced: false, stale: "hour" };
}

/**
 * events: classified events (classify.mjs shapes; paper uses the same), any order.
 * marks:  Map mint → { lamports, tokens } (SOL for so many raw units): today's quotes, read `now`.
 * lastMarks: the last quote each position had (Map mint → { lamports, tokens, at }), read at `at`.
 * snapshots: recorded equity snapshots [{ t, marks: { mint: { lamports, tokens } } }]: each is a
 *         quote of the positions held then, read at t.
 * now:    ISO time of the final point, valued at today's quotes, and the clock of the stale rule
 *         (omitted: the final point still counts in the drawdown but is not on the equity series,
 *         and positions keep their latest price as it is).
 * anchors: ISO times to value the ledger at besides (default, with `now`: 7 and 30 days before it).
 * Returns the ledger (see bottom).
 */
export function buildLedger(events, { marks = new Map(), lastMarks = new Map(), snapshots = [], now = null, anchors = null } = {}) {
  /* Chain order: slot, then the transaction's index in its block; paper: time, then its order. */
  const list = [...events].filter(Boolean).sort((a, b) => ((a.slot ?? 0) - (b.slot ?? 0)) || ((a.index ?? 0) - (b.index ?? 0))
    || String(a.t ?? "").localeCompare(String(b.t ?? "")) || ((a.order ?? 0) - (b.order ?? 0)) || String(a.signature ?? a.id ?? "").localeCompare(String(b.signature ?? b.id ?? "")));
  /* The recorded snapshots, and a point where each leaderboard period starts (7 and 30 days
     before now), so a period's change in unrealized is measured by the stale rule at its start. */
  const starts = (anchors ?? (now ? PERIOD_STARTS_MS.map((ms) => new Date(Date.parse(now) - ms).toISOString()) : [])).map((t) => ({ t, marks: {}, anchor: true }));
  const snaps = [...(snapshots ?? []), ...starts].filter((s) => s && s.t).sort((a, b) => String(a.t).localeCompare(String(b.t)));
  let cash = ZERO, rent = ZERO, deposited = ZERO, withdrawn = ZERO, feesClaimed = ZERO, realized = ZERO, opsCost = ZERO, other = ZERO;
  let wins = 0, losses = 0, fills = 0;
  const positions = new Map();            // mint → { mint, decimals, qty, cost, openedAt, quote, fill, tripPnl, tripCost, buys, sells }
  const trades = [], transfers = [], fees = [], roundTrips = [], equity = [], flows = [];
  /* Every change to realized trading P&L, with its time: a sell's profit, an operation's cost. */
  const realizedEvents = [];
  const realize = (t, amount) => { if (amount !== ZERO) realizedEvents.push({ t: t ?? null, amount }); };
  /* The unit value for the drawdown: units bought and redeemed at the value per unit. */
  let units = 0, peakNav = null, maxDd = 0;

  const positionsAt = (T) => { let v = ZERO, u = ZERO; for (const p of positions.values()) { const x = positionValueAt(p, T).value; v += x; u += x - p.cost; } return { v, u }; };
  const portfolioAt = (T) => cash + rent + positionsAt(T).v;
  const flow = (amount, T) => {
    /* amount > 0 in, < 0 out, applied at the value before it; emptied, the count starts again */
    if (amount === ZERO) return;
    const before = portfolioAt(T);
    const nav = units > 0 && before > 0n ? Number(before) / units : 1;
    units = before + BigInt(amount) <= 0n ? 0 : Math.max(0, units + Number(amount) / nav);
    if (units === 0) peakNav = null;
  };
  /* A point: the value now, into the drawdown, and (with a time) onto the equity series. */
  const point = (t) => {
    const { v, u } = positionsAt(t ?? null);
    const p = cash + rent + v;
    if (t) equity.push({ t, portfolio: p, netDeposits: deposited - withdrawn, unrealized: u, realized: realized - opsCost, feesClaimed });
    if (p <= 0n) { units = 0; peakNav = null; return; }      /* emptied: a later deposit starts a new count */
    if (units > 0) {
      const nav = Number(p) / units;
      if (peakNav === null || nav > peakNav) peakNav = nav;
      else if (peakNav > 0) maxDd = Math.max(maxDd, (peakNav - nav) / peakNav);
    }
  };
  /* A recorded snapshot: the positions held then take the quotes recorded then. */
  let si = 0;
  const snapshotsUpTo = (t) => {
    while (si < snaps.length && (t === null || String(snaps[si].t) <= String(t))) {
      const s = snaps[si++];
      if (s.anchor && !started) continue;          /* a period that starts before the agent's first event: nothing to value */
      const m = s.marks instanceof Map ? s.marks : new Map(Object.entries(s.marks ?? {}));
      for (const p of positions.values()) {
        const q = m.get(p.mint);
        if (q && BigInt(q.tokens) > 0n) p.quote = { lamports: BigInt(q.lamports), tokens: BigInt(q.tokens), at: s.t };
      }
      point(s.t);
    }
  };

  let started = false;
  for (const e of list) {
    if (e.t) snapshotsUpTo(e.t);
    started = true;
    const fee = e.fee ?? ZERO;
    /* The balances move by exactly what the chain (or the paper fill) says; the kinds below
       decide only what each movement counts as. */
    const cashDelta = e.cashDelta ?? impliedCashDelta(e);
    const rentDelta = e.rentDelta ?? ZERO;
    /* Money that is not trading moves the units, not their price, at the value before it. */
    flow(neutralFlowOf(e, positions, e.t ?? null), e.t ?? null);
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
          const p = positions.get(e.mint) ?? { mint: e.mint, decimals: e.decimals, qty: ZERO, cost: ZERO, openedAt: e.t, quote: null, fill: null, tripPnl: ZERO, tripCost: ZERO, bought: ZERO, buys: 0, sells: 0 };
          if (p.qty === ZERO) { p.openedAt = e.t; p.tripPnl = ZERO; p.tripCost = ZERO; p.bought = ZERO; }
          p.qty += e.tokens; p.cost += e.sol; p.tripCost += e.sol; p.bought += e.tokens; p.buys++;
          p.fill = { lamports: e.sol, tokens: e.tokens, at: e.t ?? null };
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
            p.fill = { lamports: e.sol, tokens: e.tokens, at: e.t ?? null };
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
        /* The fee it cost is an operation's; value arriving with it is never profit. */
        const v = e.value ?? ZERO;
        if (v < ZERO) { opsCost += -v; realize(e.t, v); }
        else if (v > ZERO) other += v;
        const p = positions.get(e.mint);
        if (p && p.qty > ZERO) {
          const { moved, basis, atValue } = movedOut(p, e, e.t ?? null);
          /* the tokens leave as a withdrawal at their value then (the stale rule: 0 when stale).
             A loss is realized (the move never hides one); a gain never is — a move is not a
             sale, and a quote is not proceeds — so the part above cost leaves as withdrawn
             outside value ("other"), which keeps the identity and never counts as return or rank */
          withdrawn += atValue;
          const pnl = atValue < basis ? atValue - basis : ZERO;
          const excess = atValue > basis ? atValue - basis : ZERO;
          if (pnl !== ZERO) { realized += pnl; p.tripPnl += pnl; realize(e.t, pnl); }
          other += excess;
          p.qty -= moved; p.cost -= basis;
          if (p.qty === ZERO) positions.delete(e.mint);
          transfers.push({ t: e.t, kind: "withdrawal", lamports: atValue, tx: e.signature ?? null, counterparty: null, memo: null, tokens: { mint: e.mint, raw: moved } });
          flows.push({ t: e.t, kind: "token_out", mint: e.mint, tokens: moved, atValue, atCost: basis, pnl, gainOut: excess, tx: e.signature ?? null });
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
    if (e.t) point(e.t);
  }
  snapshotsUpTo(null);

  /* Today's quotes, else the last one kept (if it is later than what the ledger knows), then the
     stale rule at `now`: the unrealized side, the positions, and the final point — one value. */
  let unrealized = ZERO, positionsValue = ZERO, latestValue = ZERO;
  const open = [];
  const T = now ?? null;
  for (const p of positions.values()) {
    const mark = marks.get(p.mint) ?? null;
    const quotedNow = valueAt(p.qty, mark) !== null;
    if (quotedNow) p.quote = { lamports: mark.lamports, tokens: mark.tokens, at: T };
    else {
      const last = lastMarks.get(p.mint) ?? null;
      if (last?.at && valueAt(p.qty, last) !== null && (!p.quote || (p.quote.at !== null && String(last.at) > String(p.quote.at)))) p.quote = { lamports: last.lamports, tokens: last.tokens, at: last.at };
    }
    const { value, priced, stale } = positionValueAt(p, T);
    positionsValue += value;
    latestValue += positionValueAt(p, null).value;
    unrealized += value - p.cost;
    open.push({ mint: p.mint, decimals: p.decimals, qty: p.qty, cost: p.cost, value, priced, quotedNow, stale, pnl: value - p.cost, pnlPct: pctOf(value - p.cost, p.cost), openedAt: p.openedAt,
      entry: { lamports: p.cost, tokens: p.qty }, mark: priced ? { lamports: p.quote.lamports, tokens: p.quote.tokens } : null, markAt: p.quote?.at ?? null });
  }
  /* the final point, at today's quotes: on the series when its time is given, in the drawdown always */
  point(T);
  const portfolio = cash + rent + positionsValue;
  /* the same at each position's latest price, stale or not: what the risk layer's day measures
     trading by (a price feed down for an hour must not read as a day's loss and sell everything) */
  const portfolioAtLatest = cash + rent + latestValue;
  const netDeposits = deposited - withdrawn;
  realized -= opsCost;
  return Object.freeze({
    version: LEDGER_VERSION,
    cash, rent, deposited, withdrawn, netDeposits, feesClaimed, realized, unrealized, positionsValue, portfolio, portfolioAtLatest, opsCost, other,
    positions: open, trades, transfers, fees, roundTrips, equity, flows, realizedEvents,
    fills, wins, losses, unpricedPositions: open.filter((x) => !x.priced).length,
    maxDrawdownPct: Math.round(maxDd * 10_000) / 100,
    roiPct: deposited === ZERO ? null : pctOf(realized + unrealized, deposited),
  });
}

/** Tokens moved out of a position: how many, their cost, and their value at T (the stale rule). */
function movedOut(p, e, T) {
  const moved = e.tokens <= p.qty ? e.tokens : p.qty;
  const basis = (p.cost * moved) / p.qty;
  const atValue = (positionValueAt(p, T).value * moved) / p.qty;
  return { moved, basis, atValue };
}

/** The part of an event that is not trading (deposits, withdrawals, fees, arrivals, tokens moved
 *  out at their value, proceeds of tokens never bought), from the positions as they stand before it. */
function neutralFlowOf(e, positions, T) {
  switch (e.kind) {
    case "deposit": return e.lamports;
    case "withdrawal": return -e.lamports;
    case "fee": return e.lamports;
    case "airdrop": case "other": return e.value ?? ZERO;
    case "trade": {
      if (e.side !== "sell" || e.tokens === ZERO) return ZERO;
      const held = positions.get(e.mint)?.qty ?? ZERO;
      const traded = e.tokens <= held ? e.tokens : held;
      return e.sol - (e.sol * traded) / e.tokens;
    }
    case "token_out": {
      const v = e.value ?? ZERO;
      const p = positions.get(e.mint);
      const atValue = p && p.qty > ZERO ? movedOut(p, e, T).atValue : ZERO;
      return (v > ZERO ? v : ZERO) - atValue;
    }
    default: return ZERO;
  }
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

/** The unrealized P&L the ledger's points show at `since` (ms): the last point at or before it, or 0. */
export function unrealizedAt(ledger, since) {
  let u = 0n;
  for (const p of ledger.equity ?? []) { if (p.t && Date.parse(p.t) <= since) u = p.unrealized ?? 0n; else if (p.t) break; }
  return u;
}

/**
 * A period's trading P&L (the contract's by=roi and by=pnl over 7d / 30d): the realized trading
 * P&L dated in the period, plus the change in unrealized over it. Creator fees and other arrivals
 * never count.
 */
export function periodTradingPnl(ledger, since) {
  const realizedIn = realizedSince(ledger, since);
  return { realizedIn, pnl: realizedIn + (ledger.unrealized - unrealizedAt(ledger, since)) };
}
