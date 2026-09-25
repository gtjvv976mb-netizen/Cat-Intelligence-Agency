/**
 * CRYING CAT (crying-cat-safe): CONSERVATIVE. ESTABLISHED TOKENS ONLY, EVERY BUY RUG-CHECKED FIRST.
 *
 * WHAT IT MAY BUY. Tokens on Jupiter's verified list (https://lite-api.jup.ag/tokens/v2/tag?query=
 * verified, read at most every six hours) that are not stablecoins, liquid-staking SOL,
 * tokenised stocks or other real-world assets (by Jupiter's own tags), whose liquidity is at
 * least `minLiquidityUsd` ("deep" is the owner's number; the default is 5,000,000 USD), whose
 * organic score Jupiter rates "high", and whose mint and freeze authority Jupiter's audit says
 * are disabled. Of those, the `candidates` deepest. Then, before any buy, the runtime runs
 * Crying Cat's own rug check on the chain, which may still refuse it.
 *
 * WHEN. A rule, not a model, read from fifteen-minute candles (src/lib/agent-market.mjs, the
 * extension agent's indicators): EMA(20) above EMA(50), RSI(14) between 45 and 65, up over the
 * last 24 hours and not down over the last hour. At most one buy a tick. It sells when EMA(20)
 * falls below EMA(50); the risk layer's stop loss, take profit and trailing stop run regardless.
 *
 * WHAT IT IS NOT. The rule is a conservative choice written down, not a measured edge: nothing
 * about its returns has been measured, on paper or live. Most of the time it holds.
 */
import { WSOL_MINT } from "../../../bots/lib/verified.mjs";

export const ID = "crying-cat-safe";
export const EXCLUDED_TAGS = Object.freeze(["stable", "lst", "xstocks", "stocks", "rwa"]);
export const RULE = Object.freeze({ rsiMin: 45, rsiMax: 65 });

export const defaults = Object.freeze({
  limits: Object.freeze({ maxPerTradeSol: "0.05", maxOpenPositions: 3, stopLossPct: 8, takeProfitPct: 15, trailingStopPct: 5, dailyLossLimitSol: "0.1" }),
  settings: Object.freeze({ minLiquidityUsd: 5_000_000, candidates: 8 }),
});

export function normalizeSettings(input = {}) {
  const s = { ...defaults.settings, ...(input ?? {}) };
  const unknown = Object.keys(input ?? {}).filter((k) => !(k in defaults.settings));
  if (unknown.length) throw new Error(`unknown setting ${unknown.join(", ")} for crying-cat-safe`);
  const liq = Number(s.minLiquidityUsd), n = Number(s.candidates);
  if (!(Number.isFinite(liq) && liq >= 1_000_000)) throw new Error("minLiquidityUsd must be at least 1,000,000 (this cat only buys deep markets)");
  if (!(Number.isInteger(n) && n >= 1 && n <= 20)) throw new Error("candidates must be a whole number from 1 to 20");
  return Object.freeze({ minLiquidityUsd: liq, candidates: n });
}

/** The verified tokens this cat may consider, deepest first. Pure. */
export function candidatesFrom(list, { settings, exclude = new Set() }) {
  return (Array.isArray(list) ? list : [])
    .filter((t) => t && typeof t.id === "string" && t.id !== WSOL_MINT && !exclude.has(t.id))
    .filter((t) => t.isVerified === true || (Array.isArray(t.tags) && t.tags.includes("verified")))
    .filter((t) => !(t.tags ?? []).some((tag) => EXCLUDED_TAGS.includes(tag)))
    .filter((t) => Number(t.liquidity) >= settings.minLiquidityUsd)
    .filter((t) => t.organicScoreLabel === "high")
    .filter((t) => t.audit?.mintAuthorityDisabled === true && t.audit?.freezeAuthorityDisabled === true)
    .sort((a, b) => Number(b.liquidity) - Number(a.liquidity))
    .slice(0, settings.candidates)
    .map((t) => ({ mint: t.id, symbol: String(t.symbol ?? "").slice(0, 16), name: String(t.name ?? "").slice(0, 40), decimals: Number(t.decimals), program: t.tokenProgram, liquidityUsd: Number(t.liquidity) }));
}

/** The entry rule on one token's snapshot row: { enter, why }. Pure. */
export function entrySignal(row) {
  const i = row?.indicators;
  if (!i) return { enter: false, why: "no candles" };
  const missing = ["ema20", "ema50", "rsi14", "return24hPct"].filter((k) => i[k] === null || i[k] === undefined);
  if (missing.length) return { enter: false, why: `missing ${missing.join(", ")}` };
  if (!(i.ema20 > i.ema50)) return { enter: false, why: "EMA20 is not above EMA50" };
  if (!(i.rsi14 >= RULE.rsiMin && i.rsi14 <= RULE.rsiMax)) return { enter: false, why: `RSI ${i.rsi14} is outside ${RULE.rsiMin}–${RULE.rsiMax}` };
  if (!(i.return24hPct > 0)) return { enter: false, why: "not up over 24 hours" };
  if (i.return1hPct !== null && i.return1hPct < 0) return { enter: false, why: "down over the last hour" };
  return { enter: true, why: `EMA20 above EMA50, RSI ${i.rsi14}, ${i.return24hPct}% over 24 h` };
}
export const exitSignal = (row) => (row?.indicators && row.indicators.ema20 !== null && row.indicators.ema50 !== null && row.indicators.ema20 < row.indicators.ema50
  ? { exit: true, why: "the trend turned: EMA20 fell below EMA50" } : { exit: false });

export const tickMs = 15 * 60_000;
export const exitTickMs = 30_000;

export async function tick(ctx) {
  const { agent, deps } = ctx;
  const settings = normalizeSettings(agent.settings);
  const ex = ctx.exclusions();
  let list;
  try { list = await deps.verifiedList(); }
  catch (e) { ctx.decide({ action: "hold", reason: `Jupiter's verified list could not be read (${e.message}); nothing is bought without it` }); return; }
  const held = new Set((ctx.view()?.ledger.positions ?? []).map((p) => p.mint));
  const cands = candidatesFrom(list, { settings, exclude: ex.mints });
  if (!cands.length) { ctx.decide({ action: "hold", reason: "no verified token meets the liquidity, organic-score and authority filters right now" }); return; }
  const snap = await deps.market.snapshot(cands.map((c) => ({ mint: c.mint, symbol: c.symbol })), { withCandles: true });
  const why = [];
  for (const c of cands) {
    if (held.has(c.mint)) continue;
    const sig = entrySignal(snap.tokens[c.mint]);
    if (!sig.enter) { why.push(`${c.symbol}: ${sig.why}`); continue; }
    const r = await ctx.buy({ mint: c.mint, symbol: c.symbol, name: c.name, decimals: c.decimals, program: c.program, venue: "jupiter",
      askedLamports: ctx.maxPerTradeLamports(), reason: `${c.symbol}: ${sig.why}; ${Math.round(c.liquidityUsd / 1e6)}M USD of liquidity on Jupiter's verified list` });
    if (r.ok) return;                         /* at most one buy a tick; a refused one lets the next candidate be read */
    why.push(`${c.symbol}: refused (${r.clause})`);
  }
  ctx.decide({ action: "hold", reason: `${cands.length} deep verified tokens read; none met the entry rule — ${why.slice(0, 4).join("; ")}${why.length > 4 ? "; …" : ""}` });
}

export async function exits(ctx, view) {
  const held = view.ledger.positions;
  if (!held.length) return [];
  const snap = await ctx.deps.market.snapshot(held.map((p) => ({ mint: p.mint, symbol: p.mint.slice(0, 4) })), { withCandles: true });
  return held.map((p) => ({ p, s: exitSignal(snap.tokens[p.mint]) })).filter((x) => x.s.exit).map((x) => ({ mint: x.p.mint, reason: x.s.why }));
}
