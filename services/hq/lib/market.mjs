/**
 * WHAT A HELD POSITION IS WORTH NOW, IN SOL: THE MARKS THE LEDGER'S UNREALIZED SIDE USES.
 *
 *   · a coin still on its pump.fun bonding curve (quoted in SOL): what selling the whole
 *     position into the curve would return right now (the executor's own sellExactIn on the
 *     curve read from the chain) — a liquidation value, not a last price;
 *   · anything else: DexScreener's USD price over SOL's USD price (src/lib/agent-market.mjs,
 *     with Jupiter's price API for what DexScreener does not price), read in one request.
 * A position no source prices has no mark: the ledger values it at the latest price it knows for
 * it (its last mark, or its last fill) and says it is unpriced.
 */
import { createMarket } from "../../../src/lib/agent-market.mjs";
import { PUMPFUN_VENUE, bondingCurveAddress } from "../../../vendor/executor/snipe-venue-pumpfun.mjs";
import { PUMPFUN_PROGRAM, WSOL_MINT } from "../../../bots/lib/verified.mjs";

const SCALE = 1_000_000n;

/** A USD price ratio as a mark: lamports per `tokens` raw units, exact enough for display. */
export function usdMark({ priceUsd, solUsd, decimals }) {
  if (!(priceUsd > 0) || !(solUsd > 0)) return null;
  const lamportsPerWhole = (priceUsd / solUsd) * 1e9;
  if (!Number.isFinite(lamportsPerWhole)) return null;
  return { lamports: BigInt(Math.round(lamportsPerWhole * Number(SCALE))), tokens: 10n ** BigInt(decimals) * SCALE, source: "dexscreener" };
}

export function createMarketView({ rpc, fetchImpl = globalThis.fetch, jupiter = null, clock = () => Date.now(), sleep, market = null } = {}) {
  const m = market ?? createMarket({ fetchImpl, clock, jupiter, ...(sleep ? { sleep } : {}) });

  /** USD prices for mints plus SOL's own: { tokens: { mint: row }, solUsd, errors }. */
  async function prices(mints) {
    const list = [...new Set([...mints, WSOL_MINT])].map((mint) => ({ mint, symbol: mint.slice(0, 4) }));
    const p = await m.prices(list);
    return { tokens: p.tokens, solUsd: p.tokens[WSOL_MINT]?.priceUsd ?? null, errors: p.errors, at: p.at };
  }

  /** The curve of each mint that has one: Map mint → decoded curve (or null). */
  async function curves(mints) {
    const out = new Map();
    if (!mints.length || !rpc) return out;
    const read = await rpc.getMultipleAccounts(mints.map((mint) => bondingCurveAddress(mint)), { commitment: "confirmed" });
    mints.forEach((mint, i) => {
      const acc = read.accounts?.[i];
      if (!acc || acc.owner !== PUMPFUN_PROGRAM) { out.set(mint, null); return; }
      try { out.set(mint, PUMPFUN_VENUE.curveFromAccount(acc, { feeBps: Number(PUMPFUN_VENUE.feeObservation?.totalFeeBps), mint })); } catch { out.set(mint, null); }
    });
    return out;
  }

  /** positions: [{ mint, decimals, qty (raw BigInt) }] → Map mint → { lamports, tokens, source }. */
  async function marks(positions) {
    const out = new Map();
    if (!positions.length) return out;
    let onCurve = new Map();
    try { onCurve = await curves(positions.map((p) => p.mint)); } catch { onCurve = new Map(); }
    const rest = [];
    for (const p of positions) {
      const c = onCurve.get(p.mint);
      if (c && c.complete !== true && c.quoteIsSol === true && p.qty > 0n) {
        try {
          const q = PUMPFUN_VENUE.sellExactIn(c, p.qty);
          const lamports = BigInt(q?.quoteOutRaw ?? 0n);
          out.set(p.mint, { lamports, tokens: p.qty, source: "pump.fun curve" });
          continue;
        } catch { /* priced below, if at all */ }
      }
      rest.push(p);
    }
    if (rest.length) {
      try {
        const px = await prices(rest.map((p) => p.mint));
        for (const p of rest) {
          const mark = usdMark({ priceUsd: px.tokens[p.mint]?.priceUsd ?? null, solUsd: px.solUsd, decimals: p.decimals });
          if (mark) out.set(p.mint, mark);
        }
      } catch { /* unpriced this time */ }
    }
    return out;
  }

  return Object.freeze({ prices, curves, marks, snapshot: (universe, opts) => m.snapshot(universe, opts), status: () => m.status() });
}
