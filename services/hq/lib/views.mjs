/**
 * THE CONTRACT'S SHAPES (docs/hq/API.md), BUILT FROM THE LEDGERS AND THE RECORD.
 *
 * Every amount is a string of decimal SOL or token units; every time ISO-8601 UTC; every number
 * computed from the agent wallets' own transactions (live) or HQ's recorded paper fills (paper),
 * and never both in one figure. An unknown is null, never a guess. services/hq/contract/schemas.mjs
 * holds the same shapes as JSON Schema, and test-hq-api.mjs holds every response to them.
 */
import { solString, unitsString, priceString } from "./amounts.mjs";
import { limitsView } from "./risk.mjs";
import { realizedSince, periodTradingPnl } from "./ledger.mjs";
import { plainText, TEXT_MAX } from "./text.mjs";
import { treasuryFlows, buybackItem } from "./buyback.mjs";
import { CIA_FACTS } from "./config.mjs";

const pad3 = (n) => String(n).padStart(3, "0");
/** A display number (a percentage) as the contract's decimal: at most `digits` places, no
 *  exponent, no leading zero, never "-0". */
export function numString(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  let t = Math.abs(n).toFixed(digits);
  if (t.includes(".")) t = t.replace(/0+$/, "").replace(/\.$/, "");
  return n < 0 && /[1-9]/.test(t) ? `-${t}` : t;
}
const pctStr = numString;
const pctStrKeep = numString;

export function agentObject({ agent, view, db }) {
  const L = view?.ledger ?? null;
  const coin = agent.coinMint ? (db.getCoin(agent.coinMint) ?? { mint: agent.coinMint }) : null;
  return {
    id: agent.id, number: pad3(agent.id), name: plainText(agent.name, TEXT_MAX.agentName) ?? pad3(agent.id), cat: agent.cat, skin: agent.skin,
    rank: view?.rank ?? db.getRank(agent.id, agent.mode) ?? "recruit", strategy: agent.strategy, mode: agent.mode, status: agent.status,
    coin: coin ? { mint: coin.mint, symbol: plainText(coin.symbol, TEXT_MAX.symbol), name: plainText(coin.name, TEXT_MAX.coinName) } : null,
    wallet: agent.wallet, hiredAt: agent.hiredAt,
    stats: {
      balanceSol: solString(L?.cash ?? 0n), portfolioSol: solString(L?.portfolio ?? 0n),
      /* careerRealizedSol is the profit the rank counts: realized trading P&L, fees excluded, a
         net loss counting as none (the rank never falls; realizedPnlSol shows the loss itself) */
      realizedPnlSol: solString(L?.realized ?? 0n), unrealizedPnlSol: solString(L?.unrealized ?? 0n), careerRealizedSol: solString((L?.realized ?? 0n) > 0n ? L.realized : 0n),
      feesClaimedSol: solString(L?.feesClaimed ?? 0n), depositedSol: solString(L?.deposited ?? 0n), withdrawnSol: solString(L?.withdrawn ?? 0n),
      trades: L?.fills ?? 0, wins: L?.wins ?? 0, losses: L?.losses ?? 0, maxDrawdownPct: pctStrKeep(L?.maxDrawdownPct ?? 0) ?? "0",
      roiPct: pctStrKeep(L?.roiPct ?? null),
    },
  };
}

const rugOf = (text) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };

/** A trade as the contract prints it. `sol` is what the trade paid (a buy, fees included) or
 *  received (a sell, net of its fee), never below zero: a sell that returned less than its own
 *  network fee received nothing, and its loss is in its P&L. */
export function tradeObject(r, symbolOf) {
  const tokens = BigInt(r.tokens), raw = BigInt(r.sol), sol = raw < 0n ? 0n : raw;
  return {
    kind: "trade", id: r.id, t: r.t, agentId: r.agent_id, side: r.side, mint: r.mint, symbol: plainText(symbolOf(r.mint), TEXT_MAX.symbol) ?? r.mint.slice(0, 4),
    sol: solString(sol), tokens: unitsString(tokens, r.decimals), price: priceString(sol, tokens, r.decimals) ?? "0",
    pnlSol: r.pnl === null || r.pnl === undefined ? null : solString(BigInt(r.pnl)), pnlPct: r.pnl_pct === null || r.pnl_pct === undefined ? null : numString(Number(r.pnl_pct)),
    trigger: r.trigger, rugCheck: r.side === "buy" ? rugOf(r.rug_json) : null, tx: r.tx ?? null, mode: r.mode,
  };
}
export function decisionObject(d) {
  return { kind: "decision", id: d.id, t: d.t, agentId: d.agent_id, action: d.action, mint: d.mint ?? null, symbol: plainText(d.symbol, TEXT_MAX.symbol),
    reason: plainText(d.reason, TEXT_MAX.reason) ?? "(no reason given)", rugCheck: d.action === "buy" ? rugOf(d.rug_json) : null, mode: d.mode };
}

/**
 * Equity points: the ledger's own, time ordered, at most `max`. The ledger values each point at
 * the latest quote known then — at every event, every recorded snapshot (with its quotes) and
 * now (with today's) — so the chart never jumps back to a trade price after a quote.
 */
export function equitySeries({ ledger, max = 300 }) {
  const pts = new Map();
  for (const p of ledger?.equity ?? []) if (p.t) pts.set(p.t, BigInt(p.portfolio));
  const list = [...pts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, v]) => ({ t, portfolioSol: solString(v) }));
  if (list.length <= max) return list;
  const step = list.length / max;
  const out = [];
  for (let i = 0; i < max - 1; i++) out.push(list[Math.floor(i * step)]);
  out.push(list[list.length - 1]);
  return out;
}

export function agentDetail({ agent, view, db, symbolOf }) {
  const L = view?.ledger ?? null;
  const base = agentObject({ agent, view, db });
  return {
    ...base,
    limits: limitsView(agent.limits),
    positions: (L?.positions ?? []).map((p) => ({
      mint: p.mint, symbol: plainText(symbolOf(p.mint), TEXT_MAX.symbol) ?? p.mint.slice(0, 4), costSol: solString(p.cost), valueSol: solString(p.value < 0n ? 0n : p.value),
      entryPrice: priceString(p.cost, p.qty, p.decimals) ?? "0",
      /* No quote this time: no price and no percentage; the value is the last quoted one. */
      price: p.priced && p.mark ? priceString(p.mark.lamports, p.mark.tokens, p.decimals) : null,
      pnlSol: solString(p.pnl), pnlPct: p.priced ? pctStrKeep(p.pnlPct) : null, openedAt: p.openedAt,
    })),
    decisions: db.listDecisions(agent.id, 50).map(decisionObject),
    trades: db.listTrades(agent.id, agent.mode).slice(-100).reverse().map((r) => tradeObject(r, symbolOf)),
    equity: equitySeries({ ledger: L }),
    fees: (L?.fees ?? []).map((f) => ({ t: f.t, sol: solString(f.lamports), tx: f.tx })),
    transfers: (L?.transfers ?? []).map((x) => ({ t: x.t, kind: x.kind, sol: solString(x.lamports), tx: x.tx })),
    promotions: db.listPromotions(agent.id, agent.mode).map((p) => ({ t: p.t, from: p.from_rank, to: p.to_rank })),
  };
}

/**
 * One mode's figures over that mode's agents only (docs/hq/API.md ModeSummary). Paper and live
 * are never added together: each agent's figures come from its own mode's ledger (live: its
 * wallet's transactions; paper: its paper fills and bankroll), and an agent counts in the mode
 * it is in. maxDrawdownPct is the worst single agent's, null with no agents in the mode.
 */
export function modeSummary({ db, views, mode, now }) {
  const agents = db.listAgents().filter((a) => a.mode === mode);
  let realized = 0n, unrealized = 0n, inWallets = 0n, wins = 0, losses = 0, worst = null;
  for (const a of agents) {
    const view = views.get(a.id);
    const L = view && view.mode === mode ? view.ledger : null;
    if (!L) continue;
    realized += L.realized; unrealized += L.unrealized; inWallets += L.cash + L.rent;
    wins += L.wins; losses += L.losses;
    if (worst === null || L.maxDrawdownPct > worst) worst = L.maxDrawdownPct;
  }
  if (worst === null && agents.length) worst = 0;
  const since = new Date(now - 86_400_000).toISOString();
  const ids = new Set(agents.map((a) => a.id));
  const recent = db.tradesSince(since).filter((r) => r.mode === mode && ids.has(r.agent_id));
  let volume = 0n;
  for (const r of recent) volume += BigInt(r.sol) < 0n ? -BigInt(r.sol) : BigInt(r.sol);
  return {
    agents: { active: agents.filter((a) => a.status === "active").length, total: agents.length },
    trades24h: { count: recent.length, volumeSol: solString(volume) },
    solInAgentWallets: solString(inWallets),
    tradingPnlSol: { realized: solString(realized), unrealized: solString(unrealized) },
    wins, losses, maxDrawdownPct: worst === null ? null : numString(worst),
  };
}

export function summaryObject({ db, config, views, walletLedgers, treasury, now }) {
  /* Creator fees are real SOL claimed on chain, whatever mode an agent trades in: read from the
     wallets' own transactions, never from a paper book. */
  let fees = 0n;
  for (const a of db.listAgents()) { const W = walletLedgers.get(a.id); if (W) fees += W.feesClaimed; }
  /* every buyback whose $CIA was bought, burned yet or not, each once */
  const done = db.completedBuybacks();
  let bSol = 0n, bCia = 0n;
  for (const b of done) { bSol += BigInt(b.sol_spent ?? 0); bCia += BigInt(b.cia_bought ?? 0); }
  return {
    updatedAt: new Date(now).toISOString(),
    live: modeSummary({ db, views, mode: "live", now }),
    paper: modeSummary({ db, views, mode: "paper", now }),
    creatorFeesClaimedSol: solString(fees),
    buybacks: { count: done.length, solSpent: solString(bSol), ciaBought: unitsString(bCia, CIA_FACTS.decimals) },
    treasury: { address: config.treasury ?? null, sol: solString(treasury?.sol ?? 0n), cia: unitsString(treasury?.cia ?? 0n, CIA_FACTS.decimals) },
  };
}

/* ── the desk: decisions and trades of every agent, newest first ── */
/* The cursor is opaque (the contract's ^[A-Za-z0-9_-]{1,128}$): the last item's time and id. */
export const encodeCursor = (t, id) => Buffer.from(`${t}|${id}`).toString("base64url");
export function decodeCursor(c) {
  if (typeof c !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(c)) return null;
  const text = Buffer.from(c, "base64url").toString("utf8");
  const i = text.indexOf("|");
  const t = text.slice(0, i), id = text.slice(i + 1);
  return i > 0 && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(t) && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? { t, id } : null;
}
export function deskPage({ db, limit, before, symbolOf }) {
  const cur = before ? decodeCursor(before) : { t: "9999", id: "~" };
  if (!cur) return null;
  const n = Math.min(Math.max(1, limit), 200);
  const items = [
    ...db.decisionsBefore(cur.t, cur.id, n + 1).map((d) => ({ sortT: d.t, sortId: d.id, obj: decisionObject(d) })),
    ...db.tradesBefore(cur.t, cur.id, n + 1).map((r) => ({ sortT: r.t, sortId: r.id, obj: tradeObject(r, symbolOf) })),
  ].sort((a, b) => b.sortT.localeCompare(a.sortT) || b.sortId.localeCompare(a.sortId));
  const page = items.slice(0, n);
  const next = items.length > n ? encodeCursor(page[page.length - 1].sortT, page[page.length - 1].sortId) : null;
  return { items: page.map((x) => x.obj), next };
}

/* ── the leaderboard: best first; paper and live are told apart by each row's mode ── */
export const PERIODS = Object.freeze({ "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, all: null });
/**
 * by=pnl: realized trading profit over the period, in SOL (all time: career realized). by=roi:
 * the return over the period in percent — realized trading P&L in the period plus the change in
 * unrealized over it, over depositedSol (all time: roiPct). Rows are best first; the site draws
 * one board per mode from them, never mixing the two.
 */
export function leaderboard({ db, views, by, period, now, mode = null }) {
  const rows = [];
  for (const a of db.listAgents()) {
    if (a.status === "retired") continue;
    if (mode && a.mode !== mode) continue;
    const view = views.get(a.id);
    const L = view && view.mode === a.mode ? view.ledger : null;
    if (!L) continue;
    let value, sort;
    if (by === "pnl") {
      const pnl = PERIODS[period] === null ? L.realized : realizedSince(L, now - PERIODS[period]);
      value = solString(pnl); sort = pnl;
    } else {
      /* the return over the period: realized in it plus the change in unrealized over it, over
         the SOL ever deposited; creator fees and other arrivals never count */
      const pnl = PERIODS[period] === null ? L.realized + L.unrealized : periodTradingPnl(L, now - PERIODS[period]).pnl;
      if (!(L.deposited > 0n)) continue;
      const bps = (pnl * 10_000n) / L.deposited;
      value = numString(Number(bps) / 100); sort = bps;
    }
    rows.push({ agentId: a.id, value, rank: view.rank ?? "recruit", mode: a.mode, sort });
  }
  rows.sort((x, y) => (x.sort === y.sort ? x.agentId - y.agentId : x.sort > y.sort ? -1 : 1));
  return { period, by, rows: rows.map(({ sort: _s, ...r }) => r) };
}

export function buybacksObject({ db, config, limit }) {
  return {
    policy: { sharePct: numString(config.buybackSharePct), sources: ["creator_fees", "trading_profit"], schedule: plainText(config.buybackCron, TEXT_MAX.schedule) ?? "not scheduled", destination: config.buybackDestination },
    items: db.completedBuybacks().filter((b) => b.legSigs?.length && BigInt(b.cia_bought ?? 0) > 0n).map(buybackItem)
      .sort((x, y) => String(y.t).localeCompare(String(x.t)) || String(y.tx).localeCompare(String(x.tx))).slice(0, Math.max(0, limit)),
  };
}

export function treasuryObject({ db, config, balances }) {
  if (!config.treasury) return { address: null, sol: "0", cia: "0", flows: [] };
  const agentWallets = new Map(db.listAgents().map((a) => [a.wallet, a.id]));
  const f = treasuryFlows({ rows: db.listChainTxs(config.treasury), treasury: config.treasury, agentWallets, buybacks: db.completedBuybacks() });
  return {
    address: config.treasury, sol: solString(balances?.sol ?? 0n), cia: unitsString(balances?.cia ?? 0n, CIA_FACTS.decimals),
    flows: f.flows.slice(0, 200).map((x) => ({ t: x.t, kind: x.kind, sol: solString(x.lamports), tx: x.tx })),
  };
}
export { pctStr };
