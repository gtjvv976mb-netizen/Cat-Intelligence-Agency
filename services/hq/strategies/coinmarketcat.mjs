/**
 * COINMARKETCAT (coinmarketcat): THE OWNER'S PLAIN-ENGLISH STRATEGY, DECIDED BY A MODEL, LIMITS
 * ENFORCED BY CODE.
 *
 * The extension agent's own parts, reused: the snapshot and indicators (src/lib/agent-market.mjs),
 * the model call and the decision format (src/lib/agent-brain.mjs: one tool, submit_decisions,
 * buy / sell / hold and nothing else), and the existing risk engine (src/lib/agent-risk.mjs
 * planOrders: the per-token cap, the exposure cap, trades per day, the minimum trade and the
 * breaker), in US dollars as the extension runs it, with the vault in SOL priced at SOL's
 * DexScreener price. Every order that survives it then goes through HQ's own risk layer and
 * Crying Cat's rug check like any other agent's buy.
 *
 * THE MODEL IS CHOSEN AT RUN TIME: GET /v1/models with ANTHROPIC_API_KEY (an environment secret
 * of the host), HQ_MODEL when set and listed, else the first listed. No model identifier is
 * written anywhere in this repository. Without a key the model is never asked and the agent
 * holds. A model failure (a network error, a refusal, an answer outside the format) means no new
 * entries that turn; the protections run regardless.
 *
 * THE UNIVERSE: the extension's verified Solana majors (src/lib/agent-strategy.mjs SOLANA_MAJORS)
 * unless the owner lists others; every trade is SOL (wrapped) to a listed token or back.
 */
import { SOLANA_MAJORS, AGENT_BOUNDS } from "../../../src/lib/agent-strategy.mjs";
import { planOrders, rollDay as riskRollDay } from "../../../src/lib/agent-risk.mjs";
import { BrainError } from "../../../src/lib/agent-brain.mjs";
import { WSOL_MINT } from "../../../bots/lib/verified.mjs";

export const ID = "coinmarketcat";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const defaults = Object.freeze({
  limits: Object.freeze({ maxPerTradeSol: "0.1", maxOpenPositions: 3, stopLossPct: 8, takeProfitPct: 15, trailingStopPct: null, dailyLossLimitSol: "0.15" }),
  settings: Object.freeze({ strategy: "", universe: Object.freeze(SOLANA_MAJORS.map((m) => m.mint)), scheduleMinutes: 30, maxTradesPerDay: 6, maxExposurePct: 60 }),
});
export function normalizeSettings(input = {}) {
  const s = { ...defaults.settings, ...(input ?? {}) };
  const unknown = Object.keys(input ?? {}).filter((k) => !Object.hasOwn(defaults.settings, k));
  if (unknown.length) throw new Error(`unknown setting ${unknown.join(", ")} for coinmarketcat`);
  const strategy = String(s.strategy ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (strategy.length > AGENT_BOUNDS.strategyMax) throw new Error(`the strategy is at most ${AGENT_BOUNDS.strategyMax} characters`);
  const universe = [...new Set((Array.isArray(s.universe) ? s.universe : String(s.universe).split(",")).map((m) => String(m).trim()).filter(Boolean))];
  if (!universe.length || universe.length > AGENT_BOUNDS.universeMax) throw new Error(`the universe is 1 to ${AGENT_BOUNDS.universeMax} mints`);
  if (universe.some((m) => !BASE58.test(m) || m === WSOL_MINT)) throw new Error("every universe entry must be a token mint address (not SOL itself)");
  const schedule = Number(s.scheduleMinutes);
  if (!AGENT_BOUNDS.schedules.includes(schedule)) throw new Error(`scheduleMinutes is one of ${AGENT_BOUNDS.schedules.join(", ")}`);
  const trades = Number(s.maxTradesPerDay), exposure = Number(s.maxExposurePct);
  if (!(Number.isInteger(trades) && trades >= AGENT_BOUNDS.maxTradesPerDay.min && trades <= AGENT_BOUNDS.maxTradesPerDay.max)) throw new Error("maxTradesPerDay is 1 to 96");
  if (!(exposure >= AGENT_BOUNDS.maxExposurePct.min && exposure <= AGENT_BOUNDS.maxExposurePct.max)) throw new Error("maxExposurePct is 1 to 100");
  return Object.freeze({ strategy, universe: Object.freeze(universe), scheduleMinutes: schedule, maxTradesPerDay: trades, maxExposurePct: exposure });
}

export const tickMs = 60_000;               // it looks every minute; it asks the model on its schedule
export const exitTickMs = 30_000;
const r = (n, d = 4) => (n === null || n === undefined || !Number.isFinite(n) ? null : Number(n.toFixed(d)));
const MAJOR = new Map(SOLANA_MAJORS.map((m) => [m.mint, m]));

export async function tick(ctx) {
  const { agent, deps } = ctx;
  const settings = normalizeSettings(agent.settings);
  const now = deps.clock();
  const state = ctx.state.get() ?? { nextAt: 0, day: null, recent: [] };
  if (now < state.nextAt) return;
  /* The turn is written down before the call: a restart does not ask again, and buy again, at once. */
  state.nextAt = now + settings.scheduleMinutes * 60_000;
  ctx.state.set(state);
  if (!settings.strategy) { ctx.decide({ action: "hold", reason: "no strategy has been written for this agent: the model is not asked" }); return; }
  if (!deps.brain) { ctx.decide({ action: "hold", reason: "no ANTHROPIC_API_KEY is set on the server: the model is not asked, and nothing is bought" }); return; }
  const view = ctx.view();
  const heldMints = view.ledger.positions.map((p) => p.mint);
  const universe = settings.universe.map((mint) => ({ mint, symbol: MAJOR.get(mint)?.symbol ?? deps.symbolOf(mint) ?? mint.slice(0, 4) }));
  const snap = await deps.market.snapshot([...universe, ...heldMints.filter((m) => !settings.universe.includes(m)).map((mint) => ({ mint, symbol: mint.slice(0, 4) })), { mint: WSOL_MINT, symbol: "SOL" }], { withCandles: true });
  const solUsd = snap.tokens[WSOL_MINT]?.priceUsd ?? null;
  if (!solUsd) { ctx.decide({ action: "hold", reason: "SOL's price could not be read, so dollar sizes cannot be turned into SOL: the model is not asked" }); return; }
  const usdOf = (lamports) => (Number(lamports) / 1e9) * solUsd;
  const prices = Object.fromEntries(Object.entries(snap.tokens).map(([m, t]) => [m, t.priceUsd ?? null]));
  const positions = Object.fromEntries(view.ledger.positions.map((p) => [p.mint, { mint: p.mint, symbol: deps.symbolOf(p.mint) ?? p.mint.slice(0, 4), decimals: p.decimals, qtyRaw: p.qty.toString(),
    costUsd: usdOf(p.cost), lastPriceUsd: prices[p.mint] ?? null }]));
  const spec = { name: agent.name, strategy: settings.strategy, model: deps.model ?? "", universe: settings.universe, settlementMint: WSOL_MINT,
    maxPositionUsd: usdOf(ctx.maxPerTradeLamports()), maxExposurePct: settings.maxExposurePct, stopLossPct: agent.limits.stopLossPct, takeProfitPct: agent.limits.takeProfitPct,
    maxDailyDrawdownPct: 100, maxTradesPerDay: settings.maxTradesPerDay };
  const settlementUsd = usdOf(view.ledger.cash);
  let day = riskRollDay(state.day, { now, equityUsd: usdOf(view.ledger.portfolio) });
  day = Object.freeze({ ...day, tripped: view.day.tripped });
  const context = {
    now: new Date(now).toISOString(),
    agent: { name: agent.name, mode: agent.mode, scheduleMinutes: settings.scheduleMinutes },
    settlement: { symbol: "SOL", mint: WSOL_MINT, balanceUsd: r(settlementUsd, 2), balanceSol: r(Number(view.ledger.cash) / 1e9, 6), solPriceUsd: r(solUsd, 4) },
    vault: { equityUsd: r(usdOf(view.ledger.portfolio), 2), tradesToday: day.trades, tradesLeftToday: Math.max(0, settings.maxTradesPerDay - day.trades), dailyLossLimitReached: view.day.tripped },
    limits: { maxPerTradeUsd: r(spec.maxPositionUsd, 2), maxPerTradeSol: agent.limits.maxPerTradeSol, maxExposurePct: spec.maxExposurePct, stopLossPct: spec.stopLossPct, takeProfitPct: spec.takeProfitPct,
      trailingStopPct: agent.limits.trailingStopPct, maxOpenPositions: agent.limits.maxOpenPositions, maxTradesPerDay: spec.maxTradesPerDay, minTradeUsd: AGENT_BOUNDS.minTradeUsd, minVaultUsd: AGENT_BOUNDS.minVaultUsd },
    positions: view.ledger.positions.map((p) => ({ mint: p.mint, symbol: positions[p.mint].symbol, costUsd: r(usdOf(p.cost), 2), valueUsd: r(usdOf(p.value), 2), pnlPct: p.pnlPct, priced: p.priced })),
    market: universe.map((u) => { const t = snap.tokens[u.mint] ?? {}; return { mint: u.mint, symbol: u.symbol, priceUsd: t.priceUsd ?? null, change1hPct: t.change1hPct ?? null,
      change24hPct: t.change24hPct ?? null, volume24hUsd: t.volume24hUsd ?? null, liquidityUsd: t.liquidityUsd ?? null, indicators: t.indicators ?? null, missing: t.missing ?? ["priceUsd"] }; }),
    recentDecisions: (state.recent ?? []).slice(0, 5),
  };
  let result;
  try { result = await deps.brain.decide({ spec, settlementSymbol: "SOL", context, universeMints: settings.universe }); }
  catch (error) {
    const clause = error instanceof BrainError ? error.clause : "error";
    ctx.decide({ action: "hold", reason: `the model's turn failed (${clause}): no new entries this turn; the protections keep running` });
    return;
  }
  const d = result.decision;
  state.recent = [{ at: new Date(now).toISOString(), rationale: d.rationale.slice(0, 400), actions: d.actions.map((a) => ({ action: a.action, mint: a.mint, ...(a.usd !== undefined ? { usd: a.usd } : {}), ...(a.fraction !== undefined ? { fraction: a.fraction } : {}) })) }, ...(state.recent ?? [])].slice(0, 5);
  const halted = agent.status !== "active" || ctx.killOn();
  const plan = planOrders({ spec, proposals: d.actions, positions, prices, settlementUsd, day, paused: halted });
  for (const x of [...d.rejected, ...plan.refusals]) ctx.decide({ action: "hold", mint: x.mint, reason: `the model's ${x.action ?? "action"} was refused (${x.clause}): ${x.message}` });
  for (const h of plan.holds) ctx.decide({ action: "hold", mint: h.mint, reason: `the model holds: ${h.reason || d.rationale.slice(0, 200)}` });
  if (!d.actions.length) ctx.decide({ action: "hold", reason: `the model holds: ${d.rationale.slice(0, 400)}` });
  for (const o of plan.orders) {
    if (o.side === "sell") {
      await ctx.sell(o.mint, { trigger: "strategy", reason: `the model sells ${o.fraction < 1 ? `${Math.round(o.fraction * 100)}% of ` : ""}it: ${o.reason}`, qtyRaw: o.fraction < 1 ? BigInt(o.qtyRaw) : null });
      day = Object.freeze({ ...day, trades: day.trades + 1 });
    } else {
      const lamports = BigInt(Math.floor((o.usd / solUsd) * 1e9));
      const m = MAJOR.get(o.mint);
      const res = await ctx.buy({ mint: o.mint, symbol: m?.symbol, name: m?.name, decimals: m?.decimals, program: m?.program, venue: "jupiter", askedLamports: lamports,
        reason: `the model buys $${o.usd.toFixed(2)} of it (${(Number(lamports) / 1e9).toFixed(4)} SOL): ${o.reason}` });
      if (res.ok) day = Object.freeze({ ...day, trades: day.trades + 1 });
    }
  }
  state.day = day;
  ctx.state.set(state);
}
