/**
 * POPCAT'S PICK: AT MOST ONE COIN EVERY SIX HOURS, FOR THE AGENCY TO POST BY HAND ON PUMP.FUN.
 *
 * pump.fun pays the callers of its Callouts from the trading their callouts bring, and its terms
 * forbid "bots, scripts, or other automation to create Callouts". So Popcat never posts one: it
 * chooses, and the agency's owner decides whether to post it, by hand, from their own account.
 *
 * WHEN. The windows start at 00, 06, 12 and 18 UTC. The first run at or after a window's start
 * tries once for that window, and records that it tried; if no coin qualifies, the window has no
 * pick. A window never has two.
 *
 * WHICH. Only a callout, a coin in which no check found a red flag, checked in the six hours
 * before the run (this run's checks included), never picked before, and whose draft keeps the
 * rules below. Of those, the one ranked first by PICK_RANKING: each measure higher first, and a
 * tie on all three goes to the mint address that sorts first, so the same data always gives the
 * same pick. The measures are counts from the chain, read at the coin's check; none is a price.
 *
 * WHAT IT CARRIES. The coin, the facts it was chosen on, and a draft of at most DRAFT_MAX
 * characters: its name and ticker, that twelve checks found no red flag and when, as many of its
 * facts as fit, and the disclosure pump.fun's terms ask for. No price, no promise, no "buy": a
 * coin whose own name or ticker carries such a word is never picked, since the draft must print it.
 */
import { DRAFT_MAX, DRAFT_DISCLOSURE, PICK_WINDOW_HOURS, PICK_LOOKBACK_HOURS, CHECK_IDS, draftProblem, ticker } from "../../site/assets/callouts.js";

const HOUR = 3_600_000;
export const PICK = Object.freeze({ WINDOW_HOURS: PICK_WINDOW_HOURS, LOOKBACK_HOURS: PICK_LOOKBACK_HOURS, DRAFT_MAX });

/** The ranking, first measure first; each is in a checked entry's `stats`. */
export const PICK_RANKING = Object.freeze([
  Object.freeze({ key: "holders", says: "distinct holders besides the bonding curve" }),
  Object.freeze({ key: "txs", says: "successful transactions on its bonding curve (Popcat counts up to 5,000)" }),
  Object.freeze({ key: "curvePct", says: "how much of its bonding curve had sold" }),
]);

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
/** The six-hour window a moment falls in: { start, end } in ms, starting at 00, 06, 12 or 18 UTC. */
export function windowOf(ms) {
  const start = Math.floor(ms / (PICK_WINDOW_HOURS * HOUR)) * PICK_WINDOW_HOURS * HOUR;
  return { start, end: start + PICK_WINDOW_HOURS * HOUR, iso: iso(start) };
}
/** Whether this run is the first at or after its window's start: no pick was tried for it yet. */
export function pickDue(state, ms) {
  const w = windowOf(ms);
  return !state.pickWindow || Date.parse(state.pickWindow) < w.start;
}

/** Higher first on each measure (a count not taken ranks below any count), then the mint. */
export function rankCompare(a, b) {
  for (const { key } of PICK_RANKING) {
    const x = a.stats[key] ?? -1, y = b.stats[key] ?? -1;
    if (x !== y) return y - x;
  }
  return a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0;
}

const count = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pctText = (p) => `${Number(p.toFixed(p < 10 ? 2 : 1))}%`;

/**
 * The draft for a checked entry (as the site's validator returns it), or null when its own name
 * or ticker would break the rules. Facts are added in this order while they fit.
 */
export function buildDraft(c) {
  const hhmm = c.time.slice(11, 16);
  const head = `${c.name} (${ticker(c.symbol)}): no red flags in ${CHECK_IDS.length} on-chain checks at ${hhmm} UTC.`;
  const facts = [
    `${count(c.stats.holders)} holders`,
    `top 10 hold ${pctText(c.stats.top10Pct)}`,
    "mint and freeze revoked",
    c.stats.curvePct >= 100 ? "bonding curve complete" : `bonding curve ${pctText(c.stats.curvePct)} complete`,
  ];
  const build = (list) => (list.length ? `${head} ${list.join(", ")}. ${DRAFT_DISCLOSURE}` : `${head} ${DRAFT_DISCLOSURE}`);
  const kept = [];
  for (const f of facts) if (build([...kept, f]).length <= DRAFT_MAX) kept.push(f);
  const draft = build(kept);
  return draftProblem(draft, c) ? null : draft;
}

/**
 * Choose the pick from checked entries (validated: { mint, creator, name, symbol, time, stats,
 * callout }). `picked` is the mints already picked. Returns { pick, pool, passedOver } where
 * `pick` is the record to publish (or null), `pool` how many qualified, and `passedOver` the
 * ranked coins left out because their draft would break the rules.
 */
export function choosePick({ entries, picked = new Set(), now }) {
  const w = windowOf(now);
  const since = now - PICK_LOOKBACK_HOURS * HOUR;
  const pool = entries.filter((c) => c.callout && !picked.has(c.mint) && Date.parse(c.time) > since && Date.parse(c.time) <= now).sort(rankCompare);
  const passedOver = [];
  for (const c of pool) {
    const draft = buildDraft(c);
    if (!draft) { passedOver.push(c); continue; }
    return {
      pool: pool.length, passedOver,
      pick: { window: w.iso, time: iso(now), checked: c.time, mint: c.mint, creator: c.creator, name: c.name, symbol: c.symbol,
        stats: { holders: c.stats.holders, top10Pct: c.stats.top10Pct, curvePct: c.stats.curvePct, txs: c.stats.txs }, draft },
    };
  }
  return { pick: null, pool: pool.length, passedOver };
}
