/**
 * THE RUNTIME: EVERY AGENT'S LEDGER, THE GATE EVERY BUY GOES THROUGH, THE EXITS, AND THE BOOKS.
 *
 * Strategies propose; this file disposes. A strategy never signs, never sizes past its limits
 * and never skips the rug check: it calls buy() and sell() here, and every buy passes, in order,
 * the agency-coin exclusion, the risk layer (risk.mjs checkBuy), Crying Cat's rug check, and only
 * then an executor — paper (a fill simulated from a live Jupiter quote or the live pump.fun curve,
 * nothing signed) or live (execution.mjs, only with HQ_LIVE=1 and the agent's own mode live).
 * Every refusal is a decision on the desk with its clause.
 *
 * THE BOOKS. Live, an agent's ledger is rebuilt from its wallet's own transactions (indexer.mjs);
 * paper, from the paper fills and the paper bankroll recorded here. The two are never mixed:
 * the agent's mode decides which ledger its public numbers come from, and a paper number is
 * marked paper everywhere it goes.
 */
import { randomUUID } from "node:crypto";
import { checkQuote } from "../../../src/lib/jupiter-swap.mjs";
import { planSnipeCeiling } from "../../../vendor/executor/snipe-entry.mjs";
import { snipeCurveState } from "../../../vendor/executor/snipe-curve.mjs";
import { PUMPFUN_VENUE } from "../../../vendor/executor/snipe-venue-pumpfun.mjs";
import { TOKEN_PROGRAM, WSOL_MINT } from "../../../bots/lib/verified.mjs";
import { associatedTokenAddress } from "../../../src/lib/tx.mjs";
import { buildLedger } from "./ledger.mjs";
import { checkBuy, checkExits, rollDay, MIN_TRADE_LAMPORTS } from "./risk.mjs";
import { agencyExclusions, agencyCoin } from "./agency.mjs";
import { rugCheckView, NOT_CHECKED } from "./rugcheck.mjs";
import { liveTradeId } from "./db.mjs";
import { promote } from "./ranks.mjs";
import { HQ_TX } from "./txcheck.mjs";
import { WSOL } from "./execution.mjs";
import { solString } from "./amounts.mjs";
import { tradeObject as tradeShape, decisionObject } from "./views.mjs";

/** What a paper fill is charged for its network fee: the signature fee and HQ's priority fee. */
export const PAPER_FEE_LAMPORTS = 5_000n + BigInt(HQ_TX.priorityFeeLamports);
export const PAPER_SLIPPAGE_BPS = 100;
export const MAX_BUY_IMPACT_PCT = 2;             // the extension agent's AGENT_MAX_BUY_IMPACT_PCT
const EQUITY_EVERY_MS = 10 * 60_000;

export function createRuntime({
  config, db, clock = () => Date.now(), log = () => {},
  executor = null, indexer, market, rug, jupiter, rpc = null, launches = () => [],
} = {}) {
  /* The executor may be handed in later (it calls back into onConfirmed here). */
  const ex = () => (typeof executor === "function" ? executor() : executor);
  const views = new Map();              // agentId → the last view built
  const lastEquityAt = new Map();

  const killOn = () => config.kill || db.getKv("kill") === true;
  const exclusions = () => agencyExclusions({ agents: db.listAgents(), coins: db.listCoins(), launches: launches(), treasury: config.treasury, cashcatWallet: config.cashcatWallet });
  const symbolOf = (mint) => db.getToken(mint)?.symbol ?? null;

  /* ── the events a ledger is built from ── */
  function paperEvents(agent) {
    const out = [];
    let order = 0;
    for (const t of db.listPaperTransfers(agent.id)) out.push({ kind: t.kind, t: t.t, lamports: BigInt(t.lamports), id: t.id, order: order++ });
    for (const r of db.listTrades(agent.id, "paper")) {
      out.push({ kind: "trade", side: r.side, t: r.t, id: r.id, mint: r.mint, decimals: r.decimals, tokens: BigInt(r.tokens), sol: BigInt(r.sol),
        fee: BigInt(r.fee), trigger: r.trigger, decisionId: r.decision_id, order: order++ });
    }
    return out;
  }
  const liveEvents = (agent) => indexer.eventsFor(agent.wallet);
  const eventsFor = (agent, mode = agent.mode) => (mode === "paper" ? paperEvents(agent) : liveEvents(agent));

  /**
   * Rebuild an agent's view: its ledger in its mode with fresh marks, its day, its rank. Writes
   * the live trades (from the chain) into the trades table, sets every sell's P&L, promotes,
   * records an equity point, and emits the stream's events for what is new.
   */
  async function refresh(agentOrId, { withMarks = true } = {}) {
    const agent = typeof agentOrId === "object" ? db.getAgent(agentOrId.id) : db.getAgent(agentOrId);
    if (!agent) return null;
    const mode = agent.mode;
    const events = eventsFor(agent, mode);
    const pre = buildLedger(events);
    let marks = new Map();
    if (withMarks && pre.positions.length) {
      try { marks = await market.marks(pre.positions.map((p) => ({ mint: p.mint, decimals: p.decimals, qty: p.qty }))); } catch { marks = new Map(); }
    }
    /* The last mark each held position had, for its value when none can be had now. */
    const lastMarks = new Map();
    for (const ps of db.listPositionStates(agent.id, mode)) {
      const lm = ps.state?.lastMark;
      if (lm && /^\d+$/.test(String(lm.lamports)) && /^[1-9]\d*$/.test(String(lm.tokens))) lastMarks.set(ps.mint, { lamports: BigInt(lm.lamports), tokens: BigInt(lm.tokens), at: typeof lm.at === "string" ? lm.at : null });
    }
    const now = clock();
    /* Every recorded snapshot, with the quotes of its moment, and now, with today's: the
       drawdown and the chart value each position at the latest quote known at each point. */
    const snapshots = db.listEquity(agent.id, mode).map((x) => ({ t: x.t, marks: x.marks ?? {} }));
    const ledger = buildLedger(events, { marks, lastMarks, snapshots, now: new Date(now).toISOString() });
    db.tx(() => {
      for (const [mint, m] of marks) {
        if (!ledger.positions.some((x) => x.mint === mint)) continue;
        const st = db.getPositionState(agent.id, mode, mint) ?? {};
        db.setPositionState(agent.id, mode, mint, { ...st, lastMark: { lamports: String(m.lamports), tokens: String(m.tokens), at: new Date(now).toISOString() } });
      }
      if (mode === "live") {
        const seen = new Set(db.listTrades(agent.id, "live").map((r) => r.id));
        for (const t of ledger.trades) {
          const id = liveTradeId(t.tx);
          /* A buy carries the rug check its decision was made on, as it was made; a buy HQ never
             made (the wallet used outside HQ) says it was not checked. */
          const rug = t.side !== "buy" ? null : t.decisionId && db.getDecision(t.decisionId)?.rug_json ? JSON.parse(db.getDecision(t.decisionId).rug_json) : NOT_CHECKED;
          db.upsertTrade({ id, agentId: agent.id, mode: "live", t: t.t, side: t.side, mint: t.mint, decimals: t.decimals, sol: t.sol, tokens: t.tokens, fee: t.fee, trigger: t.trigger ?? "manual", tx: t.tx, decisionId: t.decisionId, slot: t.slot, rugCheck: rug });
          db.setTradePnl(id, t.pnl, t.pnlPct === null ? null : String(t.pnlPct));
          if (!seen.has(id)) db.addEvent("trade", tradeObject(db.listTrades(agent.id, "live").find((r) => r.id === id)));
        }
        /* each fee claim goes to the stream once, ever */
        for (const f of ledger.fees) if (f.tx && db.emitOnce(`fee:${agent.id}:${f.tx}`)) db.addEvent("fee", { agentId: agent.id, t: f.t, sol: solString(f.lamports), tx: f.tx });
      } else {
        for (const t of ledger.trades) db.setTradePnl(t.id, t.pnl, t.pnlPct === null ? null : String(t.pnlPct));
      }
      /* The rank follows career realized trading P&L in this mode, and never falls. */
      const held = db.getRank(agent.id, mode) ?? "recruit";
      const { rank, promotion } = promote({ held, careerRealizedLamports: ledger.realized });
      if (promotion) {
        db.setRank(agent.id, mode, rank);
        db.addPromotion({ agentId: agent.id, mode, from: promotion.from, to: promotion.to });
        db.addEvent("promotion", { agentId: agent.id, t: db.iso(), from: promotion.from, to: promotion.to, mode });
      } else if (!db.getRank(agent.id, mode)) db.setRank(agent.id, mode, rank);
      if (now - (lastEquityAt.get(`${agent.id}:${mode}`) ?? 0) >= EQUITY_EVERY_MS) {
        lastEquityAt.set(`${agent.id}:${mode}`, now);
        db.addEquity({ agentId: agent.id, mode, t: new Date(now).toISOString(), portfolio: ledger.portfolio, netDeposits: ledger.netDeposits, unrealized: ledger.unrealized,
          marks: new Map([...marks].filter(([mint]) => ledger.positions.some((x) => x.mint === mint))) });
      }
    });
    /* the day's trading measure values positions at their latest price, never by the stale rule */
    const tradingEquity = ledger.portfolioAtLatest - ledger.netDeposits - ledger.feesClaimed - ledger.other;
    const dayKey = `day:${agent.id}:${mode}`;
    const day = rollDay({ prev: db.getKv(dayKey), nowMs: now, tradingEquity, limits: agent.limits });
    db.setKv(dayKey, day);
    const view = Object.freeze({ agent, mode, ledger, marks, day, rank: db.getRank(agent.id, mode) ?? "recruit", at: now });
    views.set(agent.id, view);
    return view;
  }
  const viewOf = (id) => views.get(Number(id)) ?? null;

  /** The chain's own balance of an agent wallet (cash and rent), whatever the agent's mode. */
  function walletLedger(agent) { return buildLedger(liveEvents(agent)); }

  /* ── decisions ── */
  function decide(agent, { action, mint = null, symbol = null, reason, detail = null, rugCheck = null }) {
    const d = db.addDecision({ id: randomUUID(), agentId: agent.id, action, mint, symbol: symbol ?? (mint ? symbolOf(mint) : null), reason, mode: agent.mode, detail, rugCheck });
    const obj = decisionObject(d);
    db.addEvent("decision", obj);
    return obj;
  }

  /* ── paper fills, from live quotes ── */
  async function paperJupiter({ pay, get, amountRaw, maxImpactPct }) {
    const raw = await jupiter.quote({ inputMint: pay, outputMint: get, amountRaw: String(amountRaw), slippageBps: PAPER_SLIPPAGE_BPS, priority: "live" });
    const q = checkQuote(raw, { inputMint: pay, outputMint: get, amountRaw: String(amountRaw), slippageBps: PAPER_SLIPPAGE_BPS, slippageCapBps: PAPER_SLIPPAGE_BPS, maxPriceImpactPct: maxImpactPct });
    return { outRaw: q.outRaw, impactPct: q.impactPct };
  }
  async function readCurveForPaper(mint) {
    const read = await rpc.getMultipleAccounts(PUMPFUN_VENUE.accountsFor(mint).map(String), { commitment: "confirmed" });
    const acc = read.accounts?.[0];
    if (!acc?.data) throw Object.assign(new Error("the bonding curve could not be read"), { clause: "curve_unreadable" });
    return PUMPFUN_VENUE.curveFromAccount(acc, { feeBps: Number(PUMPFUN_VENUE.feeObservation?.totalFeeBps), mint });
  }
  function recordPaperTrade(agent, { side, mint, decimals, sol, tokens, trigger, decisionId, rugCheck = null }) {
    const id = `paper-${randomUUID()}`;
    db.upsertTrade({ id, agentId: agent.id, mode: "paper", t: db.iso(), side, mint, decimals, sol, tokens, fee: PAPER_FEE_LAMPORTS, trigger, tx: null, decisionId, rugCheck });
    return id;
  }

  /** A curve plan is bought only if it delivers, and never above the size the risk layer allowed. */
  function checkPlan(plan, size) {
    if (!plan || plan.deliverable !== true || !(BigInt(plan.baseOutRaw ?? 0) > 0n)) throw Object.assign(new Error("the curve plan delivers nothing at this size"), { clause: "no_plan" });
    if (BigInt(plan.maxQuoteInRaw) > BigInt(size)) throw Object.assign(new Error(`the curve plan may spend ${plan.maxQuoteInRaw} lamports, over the ${size} the limits allow`), { clause: "plan_over_size" });
  }

  /* ── THE GATE ── */
  /**
   * A buy, proposed by a strategy: { mint, symbol, name, decimals, program, venue: "jupiter" |
   * "pumpfun", askedLamports, reason, creator?, plan?(sizeLamports) → { baseOutRaw, maxQuoteInRaw } }.
   * Returns { ok, clause?, message?, tradeId?, signature? }.
   */
  async function buy(agentIn, p) {
    const agent = db.getAgent(agentIn.id);
    const view = viewOf(agent.id) ?? await refresh(agent);
    const refuse = (clause, message) => { decide(agent, { action: "hold", mint: p.mint, symbol: p.symbol, reason: `refused (${clause}): ${message}`, detail: { clause } }); return { ok: false, clause, message }; };
    if (p.symbol || p.name || p.decimals !== undefined) db.upsertToken({ mint: p.mint, symbol: p.symbol ?? null, name: p.name ?? null, decimals: p.decimals ?? null, program: p.program ?? null });
    const excluded = exclusions();
    const verdict = checkBuy({
      killSwitch: killOn(), agent, liveAllowed: config.live, agencyVerdict: agencyCoin({ mint: p.mint, creator: p.creator ?? null }, excluded),
      inflight: agent.mode === "live" && Boolean(ex()?.inFlight(agent.wallet)),
      holding: view.ledger.positions.some((x) => x.mint === p.mint), openPositions: view.ledger.positions.length,
      dayTripped: view.day.tripped, limits: agent.limits,
      cashLamports: view.ledger.cash, reserveLamports: config.agentReserve, askedLamports: p.askedLamports,
    });
    if (!verdict.ok) return refuse(verdict.clause, verdict.message);
    const rugResult = await rug.check(p.mint);
    const rugCheck = rugCheckView(rugResult);
    if (!rugResult.ok) {
      /* The contract's shape for it: a buy decision carrying the check that refused it; no trade follows. */
      const message = `Crying Cat: ${rugResult.failed.map((f) => f.why).join("; ")}`;
      decide(agent, { action: "buy", mint: p.mint, symbol: p.symbol ?? rugResult.symbol ?? null, reason: `refused (rug_check): ${message}`, detail: { clause: "rug_check" }, rugCheck });
      return { ok: false, clause: "rug_check", message };
    }
    if (!p.decimals && rugResult.decimals !== undefined) p = { ...p, decimals: rugResult.decimals };
    if (!p.program && rugResult.program) p = { ...p, program: rugResult.program };
    const size = verdict.sizeLamports;
    const decision = decide(agent, { action: "buy", mint: p.mint, symbol: p.symbol ?? rugResult.symbol, reason: `${p.reason}${verdict.clampedBy.length ? ` (size held to ${solString(size)} SOL by ${verdict.clampedBy.join(", ")})` : ""}`,
      detail: { askedSol: solString(p.askedLamports), sizeSol: solString(size), venue: p.venue }, rugCheck });
    try {
      if (agent.mode === "paper") {
        let tokens, sol, entryInput;
        if (p.venue === "pumpfun") {
          const plan = p.plan ? await p.plan(size) : planSnipeCeiling({ curve: snipeCurveState(await readCurveForPaper(p.mint)), adapter: PUMPFUN_VENUE, solLamports: size, cfg: {} });
          checkPlan(plan, size);
          tokens = BigInt(plan.baseOutRaw); entryInput = BigInt(plan.maxQuoteInRaw); sol = entryInput + PAPER_FEE_LAMPORTS;
        } else {
          const q = await paperJupiter({ pay: WSOL_MINT, get: p.mint, amountRaw: size, maxImpactPct: MAX_BUY_IMPACT_PCT });
          tokens = q.outRaw; entryInput = size; sol = size + PAPER_FEE_LAMPORTS;
        }
        const tradeId = recordPaperTrade(agent, { side: "buy", mint: p.mint, decimals: p.decimals, sol, tokens, trigger: "strategy", decisionId: decision.id, rugCheck });
        db.setPositionState(agent.id, "paper", p.mint, { venue: p.venue, openedAt: clock(), entryInputLamports: String(entryInput), peak: String(entryInput), ...(p.state ?? {}) });
        const v = await refresh(agent);
        db.addEvent("trade", tradeObject(db.listTrades(agent.id, "paper").find((r) => r.id === tradeId)));
        return { ok: true, tradeId, view: v };
      }
      /* LIVE — the executor re-checks the switches, and wallet.mjs checks HQ_LIVE again. */
      const owner = { kind: "agent", number: agent.id, wallet: agent.wallet, mode: agent.mode };
      let result;
      if (p.venue === "pumpfun") {
        const plan = p.plan ? await p.plan(size) : planSnipeCeiling({ curve: snipeCurveState((await ex().readCurve(p.mint)).curve), adapter: PUMPFUN_VENUE, solLamports: size, cfg: {} });
        checkPlan(plan, size);
        result = await ex().pumpBuy({ owner, mint: p.mint, baseOutRaw: plan.baseOutRaw, maxQuoteInRaw: plan.maxQuoteInRaw, decisionId: decision.id });
        db.setPositionState(agent.id, "live", p.mint, { venue: "pumpfun", openedAt: clock(), entryInputLamports: String(plan.maxQuoteInRaw), peak: String(plan.maxQuoteInRaw), ...(p.state ?? {}) });
      } else {
        const wsolAta = associatedTokenAddress(agent.wallet, WSOL_MINT, TOKEN_PROGRAM);
        const wrapped = await rpc.getTokenAccountBalance(wsolAta);
        if (wrapped < size) await ex().wrap({ owner, lamports: size - wrapped });
        result = await ex().jupiterSwap({ owner, pay: WSOL, get: { mint: p.mint, program: p.program, decimals: p.decimals, symbol: p.symbol ?? p.mint.slice(0, 4) },
          amountRaw: size, slippageBps: PAPER_SLIPPAGE_BPS, maxImpactPct: MAX_BUY_IMPACT_PCT, allowedPairs: new Set([`${WSOL_MINT}>${p.mint}`]), kind: "buy", mint: p.mint, trigger: "strategy", decisionId: decision.id });
        db.setPositionState(agent.id, "live", p.mint, { venue: "jupiter", openedAt: clock(), entryInputLamports: String(size), peak: String(size), ...(p.state ?? {}) });
      }
      const v = await refresh(agent);
      return { ok: true, signature: result.signature, view: v };
    } catch (error) {
      const clause = error?.clause ?? error?.code ?? "error";
      decide(agent, { action: "hold", mint: p.mint, symbol: p.symbol, reason: `the buy did not happen (${clause}): ${String(error?.message ?? error).slice(0, 300)}`, detail: { clause } });
      return { ok: false, clause, message: String(error?.message ?? error) };
    }
  }

  /** Sell the whole position in `mint`, for `trigger` (strategy | stop_loss | take_profit |
   *  trailing_stop | daily_limit | manual). Protective sells run under the kill switch. */
  async function sell(agentIn, mint, { trigger, reason, qtyRaw = null }) {
    const agent = db.getAgent(agentIn.id);
    const view = viewOf(agent.id) ?? await refresh(agent);
    const pos = view.ledger.positions.find((x) => x.mint === mint);
    if (!pos) return { ok: false, clause: "no_position", message: "nothing of it is held" };
    /* The whole position, or the part a strategy named (never more than is held). */
    const qty = qtyRaw !== null && BigInt(qtyRaw) > 0n && BigInt(qtyRaw) < pos.qty ? BigInt(qtyRaw) : pos.qty;
    const whole = qty === pos.qty;
    const state = db.getPositionState(agent.id, agent.mode, mint) ?? {};
    const decision = decide(agent, { action: "sell", mint, reason: `${trigger.replace(/_/g, " ")}: ${reason}`, detail: { trigger } });
    try {
      if (agent.mode === "paper") {
        let proceeds;
        const curve = await market.curves([mint]).then((m) => m.get(mint)).catch(() => null);
        if (curve && curve.complete !== true && curve.quoteIsSol === true) proceeds = BigInt(PUMPFUN_VENUE.sellExactIn(curve, qty)?.quoteOutRaw ?? 0n);
        else proceeds = (await paperJupiter({ pay: mint, get: WSOL_MINT, amountRaw: qty, maxImpactPct: 100 })).outRaw;
        const sol = proceeds - PAPER_FEE_LAMPORTS;
        const tradeId = recordPaperTrade(agent, { side: "sell", mint, decimals: pos.decimals, sol, tokens: qty, trigger, decisionId: decision.id });
        if (whole) db.deletePositionState(agent.id, "paper", mint);
        const v = await refresh(agent);
        db.addEvent("trade", tradeObject(db.listTrades(agent.id, "paper").find((r) => r.id === tradeId)));
        return { ok: true, tradeId, view: v };
      }
      const owner = { kind: "agent", number: agent.id, wallet: agent.wallet, mode: agent.mode };
      let result;
      const curve = await market.curves([mint]).then((m) => m.get(mint)).catch(() => null);
      if (curve && curve.complete !== true && curve.quoteIsSol === true && state.venue !== "jupiter") {
        result = await ex().pumpSell({ owner, mint, qtyRaw: qty, trigger, decisionId: decision.id });
      } else {
        const token = db.getToken(mint);
        result = await ex().jupiterSwap({ owner, pay: { mint, program: token?.program ?? state.program ?? TOKEN_PROGRAM, decimals: pos.decimals, symbol: token?.symbol ?? mint.slice(0, 4) }, get: WSOL,
          amountRaw: qty, slippageBps: 300, maxImpactPct: 100, allowedPairs: new Set([`${mint}>${WSOL_MINT}`]), kind: "sell", mint, trigger, decisionId: decision.id, protective: true });
      }
      if (whole) db.deletePositionState(agent.id, "live", mint);
      const v = await refresh(agent);
      return { ok: true, signature: result.signature, view: v };
    } catch (error) {
      const clause = error?.clause ?? error?.code ?? "error";
      decide(agent, { action: "hold", mint, reason: `the ${trigger.replace(/_/g, " ")} sell did not happen (${clause}): ${String(error?.message ?? error).slice(0, 300)}; tried again next tick`, detail: { clause, trigger } });
      return { ok: false, clause, message: String(error?.message ?? error) };
    }
  }

  /**
   * THE PROTECTIONS, every exit tick, whatever the strategy: stop loss, take profit, trailing
   * stop, the daily limit — then the strategy's own exits. They run while paused and under the
   * kill switch. A position with no mark this tick waits for one.
   */
  async function runExits(agentIn, { strategyExits = null } = {}) {
    const agent = db.getAgent(agentIn.id);
    if (agent.mode === "live" && !config.live) return [];
    const view = await refresh(agent);
    const out = [];
    const positions = view.ledger.positions.map((p) => {
      const st = db.getPositionState(agent.id, agent.mode, p.mint) ?? {};
      /* the protections act on this tick's quote only, never on a kept or a stale one */
      const value = p.quotedNow ? p.value : null;
      const peak = value !== null ? (BigInt(st.peak ?? 0) > value ? BigInt(st.peak ?? 0) : value) : (st.peak ? BigInt(st.peak) : null);
      if (value !== null && peak !== null && String(peak) !== st.peak) db.setPositionState(agent.id, agent.mode, p.mint, { ...st, peak: String(peak) });
      return { mint: p.mint, cost: p.cost, value, peak };
    });
    const exits = view.day.tripped ? positions.map((p) => ({ mint: p.mint, trigger: "daily_limit", movePct: null })) : checkExits({ positions, limits: agent.limits });
    const done = new Set();
    for (const x of exits) {
      if (done.has(x.mint)) continue;
      done.add(x.mint);
      const why = x.trigger === "daily_limit" ? `today's trading loss reached the ${agent.limits.dailyLossLimitSol} SOL limit` : `${x.movePct}% from its cost`;
      out.push({ mint: x.mint, trigger: x.trigger, result: await sell(agent, x.mint, { trigger: x.trigger, reason: why }) });
    }
    if (strategyExits) {
      for (const x of await strategyExits(view)) {
        if (done.has(x.mint)) continue;
        done.add(x.mint);
        out.push({ mint: x.mint, trigger: "strategy", result: await sell(agent, x.mint, { trigger: "strategy", reason: x.reason }) });
      }
    }
    return out;
  }

  /** A confirmed transaction of an agent wallet: into the chain cache, and its ledger rebuilt. */
  async function onConfirmed({ wallet, signature, tx }) {
    indexer.ingest({ wallet, signature, tx });
    const agent = db.listAgents().find((a) => a.wallet === wallet);
    if (agent) await refresh(agent, { withMarks: false });
  }

  const tradeObject = (r) => (r ? tradeShape(r, symbolOf) : null);

  return Object.freeze({ refresh, viewOf, walletLedger, decide, buy, sell, runExits, onConfirmed, exclusions, killOn, tradeObject, decisionObject, eventsFor, MIN_TRADE_LAMPORTS });
}

