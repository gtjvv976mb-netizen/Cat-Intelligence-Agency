/**
 * THE LOOPS THAT KEEP HQ RUNNING, AROUND THE CLOCK.
 *
 *   · at start: every in-flight marker left by the last process is settled from the chain
 *     (execution.mjs recover) before any agent may trade;
 *   · the indexer, every HQ_INDEX_INTERVAL_SECONDS: every agent wallet and the treasury, then
 *     every agent's ledger, rank and equity rebuilt, and a summary on the stream;
 *   · the agents, every second: each strategy on its own cadence (a paused or retired agent's
 *     strategy is not asked; a live agent's is not asked while HQ_LIVE is off), and each agent's
 *     exits on theirs — the exits run for paused agents and under the kill switch;
 *   · the launch feed, while any Snipurr agent is active: one websocket for all of them;
 *   · the cron jobs: creator-fee claims, sweeps, the $CIA buyback;
 *   · housekeeping, hourly: spent nonces, the stream's old events, and hold decisions older than
 *     HOLDS_KEPT_DAYS (every buy and sell decision is kept).
 * Every loop catches its own failures and says so in the log; none can stop another.
 */
import { noticesFromLogs, PUMPFUN_VENUE } from "../../../vendor/executor/snipe-venue-pumpfun.mjs";
import { readSocials } from "../../../vendor/executor/snipe-socials.mjs";
import { createLogsFeed } from "../../../src/lib/rpc.mjs";
import { URLS } from "../../../bots/lib/verified.mjs";
import { parseCron, cronMatches } from "./cron.mjs";
import { parseSol } from "./amounts.mjs";
import { strategyOf } from "../strategies/index.mjs";
import { PUMPFUN_MINT_AUTHORITY } from "../strategies/snipurr.mjs";
import { runFeeClaims, runSweeps } from "./revenue.mjs";
import { runBuyback, treasuryBalances } from "./buyback.mjs";
import { summaryObject } from "./views.mjs";
import { fetchLaunches } from "./agency.mjs";

export const HOLDS_KEPT_DAYS = 30;

export function createScheduler({
  config, db, runtime, indexer, executor = null, rpc, botsRpc, http, market, jupiter, brain = null, fetchImpl = globalThis.fetch,
  clock = () => Date.now(), log = () => {}, WebSocketImpl = globalThis.WebSocket, treasuryReady = () => "missing",
  state = { launches: [], treasury: null },
} = {}) {
  const timers = [];
  const busy = new Set();
  const last = new Map();                   // key → ms of the last run
  /* What /health may show: states and times only, never an upstream service's words (those go to the log). */
  const status = { startedAt: clock(), indexer: { at: null, state: "starting", backfilling: 0 }, feed: { state: "stopped", detail: null }, jobs: {}, recovered: null };
  let feed = null, stopped = false, lastSummary = null;
  let verified = { at: 0, list: null };

  const symbolOf = (mint) => db.getToken(mint)?.symbol ?? null;
  async function verifiedList() {
    if (verified.list && clock() - verified.at < 6 * 3_600_000) return verified.list;
    const list = await http.json(URLS.jupiterVerified, { timeoutMs: 45_000, maxBytes: 32 * 1024 * 1024 });
    if (!Array.isArray(list) || list.length < 100) throw new Error("Jupiter's verified list is missing or implausibly short");
    verified = { at: clock(), list };
    return list;
  }
  const deps = { clock, market, jupiter, rpc, botsRpc, http, brain, model: config.model, symbolOf, verifiedList, log };
  function ctxFor(agent) {
    return {
      agent, db, deps,
      view: () => runtime.viewOf(agent.id),
      buy: (p) => runtime.buy(agent, p),
      sell: (mint, o) => runtime.sell(agent, mint, o),
      decide: (d) => runtime.decide(agent, d),
      exclusions: () => runtime.exclusions(),
      killOn: () => runtime.killOn(),
      maxPerTradeLamports: () => parseSol(agent.limits.maxPerTradeSol),
      state: { get: () => db.getKv(`strategy:${agent.id}`), set: (v) => db.setKv(`strategy:${agent.id}`, v) },
    };
  }
  async function once(key, fn) {
    if (busy.has(key)) return null;
    busy.add(key);
    try { return await fn(); }
    catch (error) { log(`${key}: ${error?.message ?? error}`); return null; }
    finally { busy.delete(key); last.set(key, clock()); }
  }
  const due = (key, everyMs) => clock() - (last.get(key) ?? 0) >= everyMs;

  /* ── the indexer ── */
  /**
   * One pass: every open in-flight marker settled from the chain, then every agent wallet and
   * the treasury read, then every ledger rebuilt. One address that fails (after the indexer's own
   * retries) is logged and left for the next pass; it never stops the others.
   */
  let lastBackfilling = 0;
  async function indexAll() {
    return once("index", async () => {
      const failed = [];
      if (executor && db.openIntents().length) {
        try { await executor.settle(); } catch (error) { failed.push("settle"); log(`settle: ${error?.message ?? error}`); }
      }
      const agents = db.listAgents();
      for (const address of [...agents.map((a) => a.wallet), ...(config.treasury ? [config.treasury] : [])]) {
        try { await indexer.indexAddress(address); } catch (error) { failed.push(address); log(`index ${address}: ${error?.message ?? error}`); }
      }
      for (const a of agents) {
        try { await runtime.refresh(a); } catch (error) { failed.push(`agent ${a.id}`); log(`refresh agent ${a.id}: ${error?.message ?? error}`); }
      }
      if (config.treasury) { try { state.treasury = await treasuryBalances({ rpc, treasury: config.treasury }); } catch (error) { log(`treasury balances: ${error?.message ?? error}`); } }
      const backfilling = indexer.incomplete?.() ?? 0;
      if (backfilling !== lastBackfilling) { log(`indexer: ${backfilling} address(es) still have older history to read`); lastBackfilling = backfilling; }
      status.indexer = { at: new Date(clock()).toISOString(), state: failed.length ? "error" : "ok", backfilling };
      const views = new Map(agents.map((a) => [a.id, runtime.viewOf(a.id)]).filter(([, v]) => v));
      const walletLedgers = new Map(agents.map((a) => [a.id, runtime.walletLedger(a)]));
      const summary = summaryObject({ db, config, views, walletLedgers, treasury: state.treasury, now: clock() });
      const { updatedAt: _u, ...comparable } = summary;
      if (JSON.stringify(comparable) !== lastSummary) { lastSummary = JSON.stringify(comparable); db.addEvent("summary", summary); }
    });
  }

  /* ── the agents ── */
  async function agentsTick() {
    for (const agent of db.listAgents()) {
      const mod = strategyOf(agent.strategy);
      const liveOff = agent.mode === "live" && !config.live;
      const ctx = ctxFor(agent);
      if (agent.status === "active" && !liveOff && due(`tick:${agent.id}`, mod.tickMs)) once(`tick:${agent.id}`, () => mod.tick(ctx));
      if (!liveOff && due(`exits:${agent.id}`, mod.exitTickMs) && runtime.viewOf(agent.id)?.ledger.positions.length) {
        once(`exits:${agent.id}`, () => runtime.runExits(agent, { strategyExits: mod.exits ? (view) => mod.exits(ctx, view) : null }));
      }
      if (liveOff && due(`liveoff:${agent.id}`, 3_600_000)) { last.set(`liveoff:${agent.id}`, clock()); runtime.decide(agent, { action: "hold", reason: "this agent is live but HQ_LIVE is not 1: it does nothing until the owner turns live on, or sets it back to paper" }); }
    }
  }

  /* ── the launch feed, shared by every Snipurr ── */
  function snipers() { return db.listAgents().filter((a) => a.strategy === "snipurr" && a.status === "active" && (a.mode === "paper" || config.live)); }
  function onLogs({ logs, signature, slot, err, receivedAt }) {
    if (err) return;
    let notices = [];
    try { notices = noticesFromLogs({ logs, signature, slot, receivedAt: receivedAt ?? clock(), source: "logsSubscribe" }); } catch { return; }
    for (const notice of notices) dispatch(notice).catch((e) => log(`notice ${notice.mint}: ${e?.message ?? e}`));
  }
  async function dispatch(notice) {
    const agents = snipers();
    if (!agents.length) return;
    let readP = null, socialsP = null;
    const shared = {
      read: () => (readP ??= rpc.getMultipleAccounts(PUMPFUN_VENUE.accountsFor(notice.mint).map(String), { commitment: "processed" })),
      curve: (read) => { try { return PUMPFUN_VENUE.curveFromAccount(read.accounts[0], { feeBps: Number(PUMPFUN_VENUE.feeObservation?.totalFeeBps), mint: notice.mint }) ?? null; } catch { return null; } },
      socials: (lane) => (socialsP ??= Promise.resolve(readSocials({ uri: notice.raw?.uri ?? null, timeoutMs: Number(lane.socialsTimeoutMs) || undefined, fetchImpl }))
        .catch((e) => Object.freeze({ ok: false, clause: "fetch_failed", message: String(e?.message ?? e).slice(0, 160) })).then((r) => { shared.socialsResult = r; return r; })),
      socialsResult: null,
    };
    for (const agent of agents) await strategyOf("snipurr").onNotice(ctxFor(agent), notice, shared);
  }
  function feedCheck() {
    const want = snipers().length > 0;
    if (want && !feed) {
      const wsUrl = config.wsUrl ?? config.publicWsUrl;
      try {
        feed = createLogsFeed({ wsUrl, programId: PUMPFUN_MINT_AUTHORITY, onLogs, WebSocketImpl, onState: (s, d) => { status.feed = { state: s, detail: d ? String(d).replace(wsUrl, "the RPC websocket") : null }; } });
        feed.start();
      } catch (e) { status.feed = { state: "dead", detail: String(e?.message ?? e).slice(0, 120) }; feed = null; }
    } else if (!want && feed) { feed.stop(); feed = null; status.feed = { state: "stopped", detail: "no active Snipurr agent" }; }
  }

  /* ── the cron jobs ── */
  const jobs = [
    { key: "fee_claims", cron: config.feeClaimCron, run: () => runFeeClaims({ config, db, executor, log }) },
    { key: "sweeps", cron: config.sweepCron, run: () => runSweeps({ config, db, rpc, executor, eventsFor: runtime.eventsFor, log }) },
    { key: "buyback", cron: config.buybackCron, run: () => runBuyback({ config, db, rpc, executor, treasuryReady: treasuryReady(), clock, log }) },
  ].map((j) => ({ ...j, parsed: parseCron(j.cron) }));
  async function cronTick() {
    const minute = Math.floor(clock() / 60_000);
    for (const j of jobs) {
      if (!cronMatches(j.parsed, minute * 60_000) || status.jobs[j.key]?.minute === minute) continue;
      status.jobs[j.key] = { minute, at: new Date(clock()).toISOString(), state: "running" };
      once(`job:${j.key}`, async () => {
        if (!executor) { status.jobs[j.key].state = "error"; log(`job ${j.key}: no executor`); return; }
        try {
          const r = await j.run();
          status.jobs[j.key].state = "ok";
          log(`job ${j.key}: ${JSON.stringify(r, (k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 500)}`);
        } catch (error) { status.jobs[j.key].state = "error"; throw error; }
      });
    }
  }

  async function refreshLaunches() {
    return once("launches", async () => { state.launches = await fetchLaunches({ fetchImpl, url: config.launchesUrl }); });
  }

  function every(ms, fn) { const t = setInterval(() => { if (!stopped) fn(); }, ms); timers.push(t); return t; }
  async function start() {
    if (executor && config.rpcUrl) status.recovered = await executor.recover().catch((e) => [{ error: e.message }]);
    await refreshLaunches();
    await indexAll();
    every(config.indexEveryMs, indexAll);
    every(1_000, () => { agentsTick().catch((e) => log(`agents: ${e?.message ?? e}`)); });
    every(15_000, feedCheck);
    feedCheck();
    every(20_000, () => { cronTick().catch((e) => log(`cron: ${e?.message ?? e}`)); });
    every(10 * 60_000, refreshLaunches);
    /* Housekeeping: expired nonces every minute (a challenge lives five minutes); the stream's old
       events and holds past HOLDS_KEPT_DAYS hourly (a Snipurr watching every launch holds a dozen
       times a minute; buys, sells and their reasons stay). */
    every(60_000, () => { db.pruneNonces(clock()); });
    every(3_600_000, () => { db.pruneEvents(5_000); db.pruneHolds(new Date(clock() - HOLDS_KEPT_DAYS * 86_400_000).toISOString()); });
  }
  function stop() { stopped = true; for (const t of timers) clearInterval(t); if (feed) feed.stop(); feed = null; }

  return Object.freeze({ start, stop, status: () => status, indexAll, agentsTick, cronTick, dispatch, ctxFor, feedCheck, verifiedList });
}
