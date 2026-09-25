/**
 * SNIPURR (snipurr): PUMP.FUN SNIPING BY RULE — WAIT, WATCH, BUY ONLY WHAT OTHERS FOLLOWED, STRICT EXITS.
 *
 * The extension's sniper lane, with the executor's own decision code and nothing retyped:
 *   · the launch feed: one logsSubscribe on the HQ RPC's websocket that mentions pump.fun's
 *     mint authority (TSLvdd…okM, which every create names and no trade does), parsed by the
 *     venue's own noticesFromLogs;
 *   · the entry gates: the executor's snipeContract, all of them in order (the lane switch, the
 *     day cap, stale notices, the curve, the quote, the mint's kill set, the socials, the
 *     impact and round-trip caps, the fees, and — before anything could be signed — our own
 *     buy_v2 bytes decoded back and matched to the plan), with the lane's config
 *     (src/lib/config.mjs laneConfigFor);
 *   · the wait: a launch that clears opens a watch; only after `entryWaitMs` (10 s) and only if
 *     its would-have fill still marks at or above `entryFollowThroughX` (1.0x) of what it cost —
 *     others followed — is it re-read, re-gated with the instruction this agent would sign, and
 *     handed to the runtime (agency coins, the risk layer, Crying Cat's rug check, then paper or
 *     live);
 *   · the exits: the executor's snipe determiner (snipe-policy.mjs through snipe-lane.mjs
 *     bindDeterminer): the 1.5x take, the stall at 90 s, the three-minute time stop, the creator's
 *     exit, the catastrophe stop — beside the risk layer's own stop loss and take profit.
 * HAWK-AI's record, which these rules come from, LOST money (README: 10 up, 48 down over the
 * first 58). The wait keeps the lane out of the one bucket that never won; nothing here is an edge.
 */
import { snipeContract, planSnipeCeiling } from "../../../vendor/executor/snipe-entry.mjs";
import { snipeCurveState, curveExitMarkX } from "../../../vendor/executor/snipe-curve.mjs";
import * as snipePolicyModule from "../../../vendor/executor/snipe-policy.mjs";
import { bindDeterminer } from "../../../vendor/executor/snipe-lane.mjs";
import { PUMPFUN_VENUE, decodeGlobalFeeRecipients, feeRecipientsForCurve } from "../../../vendor/executor/snipe-venue-pumpfun.mjs";
import { readSocials } from "../../../vendor/executor/snipe-socials.mjs";
import { CONFIG_DEFAULTS, normalizeConfig, laneConfigFor, feeModelFor } from "../../../src/lib/config.mjs";
import { associatedTokenAddress } from "../../../src/lib/tx.mjs";
import { TOKEN_PROGRAM } from "../../../bots/lib/verified.mjs";
import { HQ_TX } from "../lib/txcheck.mjs";

export const ID = "snipurr";
export const PUMPFUN_MINT_AUTHORITY = "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM";
const determiner = bindDeterminer(snipePolicyModule);
const ZERO_KEY = "11111111111111111111111111111111";
const LAMPORTS = 1_000_000_000;

/** The lane dials HQ lets the owner set, each validated by the extension's own normalizeConfig. */
const LANE_KEYS = ["entryWaitMs", "entryFollowThroughX", "takeAtEntryX", "stopFrac", "stallMs", "timeStopMs", "requireSocials", "noticeMaxMs",
  "maxPriceImpactPct", "maxEntryRoundTripLossPct", "holdMaxMs", "creatorExitFrac", "dailySolCap"];
export const defaults = Object.freeze({
  limits: Object.freeze({ maxPerTradeSol: "0.01", maxOpenPositions: 1, stopLossPct: 35, takeProfitPct: 50, trailingStopPct: null, dailyLossLimitSol: "0.03" }),
  settings: Object.freeze({ entryWaitMs: CONFIG_DEFAULTS.entryWaitMs, entryFollowThroughX: CONFIG_DEFAULTS.entryFollowThroughX, takeAtEntryX: CONFIG_DEFAULTS.takeAtEntryX,
    stopFrac: null, stallMs: null, timeStopMs: null, requireSocials: true, noticeMaxMs: CONFIG_DEFAULTS.noticeMaxMs, maxPriceImpactPct: CONFIG_DEFAULTS.maxPriceImpactPct,
    maxEntryRoundTripLossPct: CONFIG_DEFAULTS.maxEntryRoundTripLossPct, holdMaxMs: CONFIG_DEFAULTS.holdMaxMs, creatorExitFrac: CONFIG_DEFAULTS.creatorExitFrac,
    dailySolCap: 0.1, maxWatches: 12 }),
});
export function normalizeSettings(input = {}, limits = defaults.limits) {
  const s = { ...defaults.settings, ...(input ?? {}) };
  const unknown = Object.keys(input ?? {}).filter((k) => !Object.hasOwn(defaults.settings, k));
  if (unknown.length) throw new Error(`unknown setting ${unknown.join(", ")} for snipurr`);
  const w = Number(s.maxWatches);
  if (!(Number.isInteger(w) && w >= 1 && w <= 50)) throw new Error("maxWatches must be 1 to 50");
  laneConfig({ settings: s, limits, lane: "observe" });           // throws the lane's own ConfigError on a bad dial
  return Object.freeze({ ...Object.fromEntries(LANE_KEYS.map((k) => [k, s[k]])), maxWatches: w });
}
/** The executor lane's config for this agent: its ticket is the risk layer's max per trade. */
export function laneConfig({ settings, limits, lane }) {
  const cfg = normalizeConfig({ ...CONFIG_DEFAULTS, ...Object.fromEntries(LANE_KEYS.map((k) => [k, settings[k]])), lane, maxSolPerTrade: Number(limits.maxPerTradeSol),
    priorityFeeLamports: HQ_TX.priorityFeeLamports });
  return { config: cfg, lane: laneConfigFor(cfg, { lane }) };
}

export const tickMs = 1_000;          // the watches
export const exitTickMs = 2_000;      // a launch moves in seconds

/* ── per-agent memory of the lane (watches, attempts, the day's spend, counts) ── */
const lanes = new Map();
function laneOf(agentId) {
  if (!lanes.has(agentId)) lanes.set(agentId, { watches: new Map(), attempts: new Map(), spend: [], counts: {}, since: Date.now() });
  return lanes.get(agentId);
}
const bump = (L, key) => { L.counts[key] = (L.counts[key] ?? 0) + 1; };

function prepareInstruction({ mint, wallet, curve, read, baseOutRaw, maxQuoteInRaw }) {
  const global = read.accounts[1], mintAccount = read.accounts[2];
  const baseTokenProgram = String(mintAccount.owner);
  const sets = decodeGlobalFeeRecipients(global.data);
  const pick = (list) => (list ?? []).find((k) => typeof k === "string" && k !== ZERO_KEY);
  return PUMPFUN_VENUE.buyIx({ mint, user: wallet, curve, curveReadSlot: read.slot, buildingForSlot: read.slot,
    feeRecipient: pick(feeRecipientsForCurve(curve, sets)), buybackFeeRecipient: pick(sets.buybackFeeRecipients), baseTokenProgram, quoteTokenProgram: TOKEN_PROGRAM,
    associatedBaseUser: associatedTokenAddress(wallet, mint, baseTokenProgram), associatedBaseUserOwner: wallet, globalFeeRecipients: sets,
    amountRaw: BigInt(baseOutRaw), maxQuoteInRaw: BigInt(maxQuoteInRaw) });
}
function bookView(L, view, now) {
  const DAY = 86_400_000;
  L.spend = L.spend.filter((e) => now - e.at < DAY);
  for (const [m, a] of L.attempts) if (now - a > 10 * 60_000) L.attempts.delete(m);
  const snipes = Object.fromEntries([...L.watches.keys()].map((m) => [m, { mint: m }]));
  const positions = Object.fromEntries((view?.ledger.positions ?? []).map((p) => [p.mint, { mint: p.mint }]));
  return { snipes, positions, attempts: Object.fromEntries([...L.attempts.keys()].map((m) => [m, { mint: m }])), deployedTodaySol: L.spend.reduce((a, e) => a + e.sol, 0) };
}

/**
 * One launch notice, for one agent. `shared` holds what every agent reads once per notice: the
 * account read and the socials.
 */
export async function onNotice(ctx, notice, shared) {
  const { agent, deps } = ctx;
  const L = laneOf(agent.id);
  const now = deps.clock();
  const settings = normalizeSettings(agent.settings, agent.limits);
  if (L.watches.size >= settings.maxWatches) { bump(L, "unsampled"); return; }
  if (L.attempts.has(notice.mint)) return;
  /* The book as it stood before this notice: the gate's own already_attempted clause is for a
     mint seen before, not for the one being judged now. */
  const book = bookView(L, ctx.view(), now);
  L.attempts.set(notice.mint, now);
  const read = await shared.read();
  const curve = shared.curve(read);
  const ex = ctx.exclusions();
  const creator = curve?.creator ?? notice.creator ?? null;
  if (ex.mints.has(notice.mint) || (creator && ex.creators.has(creator)) || (notice.creator && ex.creators.has(notice.creator))) { bump(L, "agency_coin"); return; }
  const { config, lane } = laneConfig({ settings, limits: agent.limits, lane: "observe" });
  const verdict = snipeContract({
    notice: { mint: notice.mint, creator: notice.creator ?? null, slot: notice.slot ?? null, noticeAt: Number(notice.noticeAt) || now, source: notice.source ?? "logsSubscribe", wallet: null },
    curve, adapter: PUMPFUN_VENUE, cfg: { ...lane, dailySolCap: Number(settings.dailySolCap) }, book, nowMs: deps.clock(),
    control: { hardStop: false, pauseEntries: agent.status !== "active" || ctx.killOn() }, mint: read.accounts?.[2] ?? null, creator: { creator },
    fees: feeModelFor(config), instruction: null, socials: settings.requireSocials ? await shared.socials(lane) : null,
  });
  if (!verdict.ok) { bump(L, verdict.gate); return; }
  bump(L, "watched");
  L.watches.set(notice.mint, { mint: notice.mint, symbol: String(notice.raw?.symbol ?? "").slice(0, 16), name: String(notice.raw?.name ?? "").slice(0, 40), creator, openedAt: now,
    noticeAt: Number(notice.noticeAt) || now, openedAtSlot: read.slot ?? null, qtyRaw: BigInt(verdict.detail.baseOutRaw), entryInputLamports: BigInt(verdict.detail.maxQuoteInRaw),
    socials: shared.socialsResult ?? null });
}

/** The watches: after the wait, buy only what others followed. */
export async function tick(ctx) {
  const { agent, deps } = ctx;
  const L = laneOf(agent.id);
  const now = deps.clock();
  const settings = normalizeSettings(agent.settings, agent.limits);
  for (const w of [...L.watches.values()]) {
    if (now - w.openedAt < settings.entryWaitMs) continue;
    L.watches.delete(w.mint);
    let read, curve, markX = null;
    try {
      read = await deps.rpc.getMultipleAccounts(PUMPFUN_VENUE.accountsFor(w.mint).map(String), { commitment: "confirmed" });
      curve = PUMPFUN_VENUE.curveFromAccount(read.accounts[0], { feeBps: Number(PUMPFUN_VENUE.feeObservation?.totalFeeBps), mint: w.mint });
      markX = curveExitMarkX({ curve, qtyRaw: w.qtyRaw, entryInputLamports: w.entryInputLamports, adapter: PUMPFUN_VENUE });
    } catch { bump(L, "reread_failed"); continue; }
    const secs = Math.round((now - w.openedAt) / 1000);
    if (!(markX !== null && markX >= Number(settings.entryFollowThroughX))) {
      bump(L, "nobody_followed");
      ctx.decide({ action: "hold", mint: w.mint, symbol: w.symbol, reason: `waited ${secs}s: its would-have fill marks ${markX === null ? "unread" : `${markX.toFixed(3)}x`} — nobody followed; not buying` });
      continue;
    }
    /* The re-read, with the instruction this agent's wallet would sign, decoded back by the gate. */
    const liveLane = agent.mode === "live" ? "execute" : "observe";
    const { config, lane } = laneConfig({ settings, limits: agent.limits, lane: liveLane });
    const ticket = BigInt(Math.round(Number(agent.limits.maxPerTradeSol) * LAMPORTS));
    let plan = null, instruction = null;
    try {
      plan = planSnipeCeiling({ curve: snipeCurveState(curve), adapter: PUMPFUN_VENUE, solLamports: ticket, cfg: lane });
      if (plan?.deliverable && plan.baseOutRaw > 0n) instruction = prepareInstruction({ mint: w.mint, wallet: agent.wallet, curve, read, baseOutRaw: plan.baseOutRaw, maxQuoteInRaw: plan.maxQuoteInRaw });
    } catch { instruction = null; }
    const verdict = snipeContract({
      notice: { mint: w.mint, creator: w.creator, slot: w.openedAtSlot, noticeAt: w.noticeAt, source: "watch", wallet: agent.wallet },
      curve, adapter: PUMPFUN_VENUE, cfg: { ...lane, dailySolCap: Number(settings.dailySolCap), noticeMaxMs: Math.max(Number(lane.noticeMaxMs) || 0, Number(settings.entryWaitMs) + 20_000) },
      book: { ...bookView(L, ctx.view(), now), attempts: {} }, nowMs: deps.clock(), control: { hardStop: false, pauseEntries: agent.status !== "active" || ctx.killOn() },
      mint: read.accounts?.[2] ?? null, creator: { creator: w.creator }, fees: feeModelFor(config), instruction, socials: w.socials,
    });
    if (!verdict.ok || !instruction) {
      bump(L, `reread_${verdict.gate ?? "no_instruction"}`);
      ctx.decide({ action: "hold", mint: w.mint, symbol: w.symbol, reason: `followed (${markX.toFixed(3)}x after ${secs}s) but refused at the re-read: ${verdict.gate ?? "no instruction"} — ${verdict.detail?.message ?? "the buy could not be built"}` });
      continue;
    }
    const result = await ctx.buy({ mint: w.mint, symbol: w.symbol, name: w.name, decimals: 6, program: String(read.accounts[2].owner), venue: "pumpfun", creator: w.creator,
      askedLamports: ticket, plan: async (size) => (size === ticket ? plan : planSnipeCeiling({ curve: snipeCurveState(curve), adapter: PUMPFUN_VENUE, solLamports: size, cfg: lane })),
      reason: `${w.name || w.mint.slice(0, 6)} ($${w.symbol}): cleared every snipe gate, then after ${secs}s its would-have fill marks ${markX.toFixed(3)}x — others followed`,
      state: { snipe: determiner.open({ mint: w.mint, entry: 1, openedAt: now, creator: w.creator, sizeSol: Number(plan.maxQuoteInRaw) / LAMPORTS, feeSolPerLeg: Number(config.priorityFeeLamports + 5_000) / LAMPORTS }), creator: w.creator } });
    if (result.ok) L.spend.push({ at: now, sol: Number(plan.maxQuoteInRaw) / LAMPORTS });
    bump(L, result.ok ? "entered" : `refused_${result.clause}`);
  }
  /* Every ten minutes, what the gates did, in one line on the desk. */
  if (now - (L.summaryAt ?? L.since) >= 10 * 60_000) {
    const top = Object.entries(L.counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(", ");
    if (top) ctx.decide({ action: "hold", reason: `the last ten minutes of launches: ${top}` });
    L.counts = {}; L.summaryAt = now;
  }
}

/** The executor's determiner on each held position, beside the risk layer's own exits. */
export async function exits(ctx, view) {
  const { agent, deps, db } = ctx;
  const out = [];
  const settings = normalizeSettings(agent.settings, agent.limits);
  const { lane } = laneConfig({ settings, limits: agent.limits, lane: "observe" });
  for (const p of view.ledger.positions) {
    const st = db.getPositionState(agent.id, agent.mode, p.mint);
    if (!st?.snipe) continue;
    let read;
    try { read = await deps.rpc.getMultipleAccounts(PUMPFUN_VENUE.accountsForHeld(p.mint, { creator: st.creator ?? null }).map(String), { commitment: "confirmed" }); } catch { continue; }
    let markX = null, curve = null;
    try {
      curve = PUMPFUN_VENUE.curveFromAccount(read.accounts[0], { feeBps: Number(PUMPFUN_VENUE.feeObservation?.totalFeeBps), mint: p.mint });
      if (!curve.complete) markX = curveExitMarkX({ curve, qtyRaw: p.qty, entryInputLamports: BigInt(st.entryInputLamports ?? p.cost), adapter: PUMPFUN_VENUE });
    } catch { markX = null; }
    /* The creator's balance against its first reading: a fall of creatorExitFrac is the creator leaving. */
    let creatorSold = false, creatorNote = null;
    if (st.creator) {
      let total = null;
      for (let i = 3; i < read.accounts.length; i++) {
        const amt = PUMPFUN_VENUE.decodeTokenAmount?.(read.accounts[i], { mint: p.mint, owner: st.creator });
        if (amt !== null && amt !== undefined) total = (total ?? 0n) + amt;
      }
      if (total !== null) {
        if (st.creatorBaselineRaw === undefined) st.creatorBaselineRaw = String(total);
        else if (BigInt(st.creatorBaselineRaw) > 0n) {
          const base = BigInt(st.creatorBaselineRaw);
          const frac = Number(((base - total) * 10_000n) / base) / 10_000;
          if (frac >= Number(settings.creatorExitFrac ?? lane.creatorExitFrac)) { creatorSold = true; creatorNote = `the creator's balance fell ${(frac * 100).toFixed(1)}%`; }
        }
      }
    }
    const step = determiner.step({ position: st.snipe, markX, nowMs: deps.clock(), cfg: lane, hardStop: false, creatorSold, creatorSoldDetail: creatorNote, rugFlag: false,
      sample: { markX, nowMs: deps.clock(), slot: read.slot } });
    db.setPositionState(agent.id, agent.mode, p.mint, { ...st, snipe: step.position ?? st.snipe });
    const aged = deps.clock() - Number(st.snipe.openedAt) >= Number(lane.holdMaxMs);
    if (curve?.complete && !st.graduatedNoted) {
      db.setPositionState(agent.id, agent.mode, p.mint, { ...st, snipe: step.position ?? st.snipe, graduatedNoted: true });
      out.push({ mint: p.mint, reason: "the curve graduated to a pool: sold through Jupiter" });
      continue;
    }
    if (step.action === "sell" || aged) out.push({ mint: p.mint, reason: step.action === "sell" ? step.reason : `hold clock: ${Math.round(Number(lane.holdMaxMs) / 1000)}s in the position` });
  }
  return out;
}

/** What the lane saw, for the health view and the paper-run log. */
export function laneStatus(agentId) {
  const L = lanes.get(agentId);
  return L ? { watches: L.watches.size, counts: { ...L.counts } } : null;
}
export function resetLanes() { lanes.clear(); }
