/**
 * ONE POPCAT RUN: new pump.fun coins → the cat ones, queued → the checks → every checked coin
 * listed, as a callout or as spotted → at most one pick per six-hour window.
 *
 * Dry run (POPCAT_LIVE unset, the default): everything is read and checked, and what it WOULD
 * publish and pick is printed; no file is written. Live (POPCAT_LIVE=1): every coin it checked
 * goes to callouts.json (newest first, one entry per coin, capped), the pick with it, and its
 * queue and memory to popcat-state.json.
 *
 * NO CAT COIN MISSED, AS FAR AS PUMP.FUN'S LISTING ALLOWS. pump.fun lists only its newest 1,050
 * coins (about forty minutes of launches on 2026-09-25), and GitHub runs a schedule late, or not
 * at all, when it is busy. So a run does not check "the last hour": it reads the listing back to
 * where the last complete listing began (listedTo in the state), queues every cat coin it has not
 * dealt with, at any age under a day (a coin too young for its holders to mean anything waits in
 * the queue), and checks the queue within its budget, oldest coin first. A coin waits until it is
 * checked or a day old; one whose accounts could not be read is tried again on the next run. What
 * a run cannot do is said in its log, never skipped quietly: a stretch of launches the listing no
 * longer reached, the coins left for the next run, and every coin dropped, by name.
 *
 * Never: a coin CashCat launched (by its mint in launches.json, or its creator being CashCat's
 * wallet — every creator in launches.json and CASHCAT_WALLET_ADDRESS — as pump.fun lists it and as
 * its bonding curve records it); a coin pump.fun marks banned or NSFW; a coin whose name or ticker
 * the content rules refuse to print; a coin's image or links on the site. Popcat holds no key and
 * cannot buy, and it never posts a callout on pump.fun: its pick is for the owner to post by hand.
 */
import { detectCat } from "../lib/catdetect.mjs";
import { displaySafe } from "../lib/content-rules.mjs";
import { loadLaunches, loadCalloutsFile, appendCallouts, loadPopcatState, savePopcatState } from "../lib/data.mjs";
import { newestCoins, activeCoins, creatorLaunchCount, readMetadata } from "./sources.mjs";
import { gatherOnchain, evaluate, THRESHOLDS } from "./checks.mjs";
import { validateCallouts, ticker } from "../../site/assets/callouts.js";
import { verifyEstablished } from "./established.mjs";
import { choosePick, pickDue, windowOf } from "./pick.mjs";

export const RUN_LIMITS = Object.freeze({
  /** Newest-listing pages a run may read (50 a page). pump.fun served 21 on 2026-09-25, then an empty list. */
  maxPages: 25,
  /** Each listing reaches this far past the newest coin the last complete one read. */
  overlapMinutes: 5,
  /** Pages of the recently traded listing (any age; a coin over a day old is left out). */
  activePages: 4,
  /** Coins checked per run: about a dozen RPC reads and two pump.fun reads each, paced by http.mjs. */
  maxChecksPerRun: 30,
  /** A spotted coin whose only red flags can clear with time is checked again after this long… */
  recheckAfterMinutes: 60,
  /** …and checked at most this many times in all. */
  maxChecksPerCoin: 3,
  /** A coin whose accounts (or model review) could not be read is tried this many times in all. */
  maxReadTries: 3,
});
/** The red flags that can clear with time: holders arrive, the curve sells, a creator sells down. */
export const RECHECKABLE = Object.freeze(["creator_share", "top10_share", "age", "curve"]);

export const CALLOUT_REVIEW_TOOL = Object.freeze({
  name: "review_callout",
  description: "Say whether this new coin is cat-themed and whether its name and ticker are fit to print on a public website.",
  input_schema: {
    type: "object", additionalProperties: false, required: ["cat_themed", "fit_to_print", "reason"],
    properties: {
      cat_themed: { type: "boolean", description: "true only if the coin is about a cat (not a coin that merely mentions one)." },
      fit_to_print: { type: "boolean", description: "false for hate, slurs, sexual content, minors, violence, tragedy, or a real person's name." },
      reason: { type: "string" },
    },
  },
});

const MIN = 60_000, HOUR = 3_600_000;
const isoSecond = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
/** Characters the site's validator refuses (controls, zero-width joiners, direction marks) are
 *  dropped from a stranger's text before it is shown; an emoji may lose its joiner, nothing more. */
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/g;
const clip = (s, n) => { const t = String(s).replace(INVISIBLE, "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** What the queue keeps of a listing row: what the checks and the model review need, no more. */
const queued = (c, cat, due) => ({ mint: c.mint, creator: c.creator, curve: c.curve, name: c.name, symbol: c.symbol, description: c.description.slice(0, 500),
  metadataUri: c.metadataUri, createdMs: c.createdMs, cat: { field: cat.field, word: clip(cat.word, 40) }, due, n: 0, tries: 0, reviewed: false });
/** First checks before re-checks; first checks oldest coin first, re-checks by when they fell due; then by mint. */
const queueOrder = (a, b) => {
  if ((a.n === 0) !== (b.n === 0)) return a.n === 0 ? -1 : 1;
  const d = a.n === 0 ? a.createdMs - b.createdMs : a.due - b.due;
  return d || (a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0);
};

export async function runPopcat({ env, http, rpc, model, dataDir, now = () => Date.now(), log }) {
  const live = env.POPCAT_LIVE === "1" && env.NODE_ENV !== "test";
  log.section(`Popcat — ${live ? "LIVE: every coin it checks is published to the floor" : "dry run: nothing is written"}`);
  const t = now();
  const launches = loadLaunches(dataDir);
  const file = loadCalloutsFile(dataDir, { exclude: launches });
  const state = loadPopcatState(dataDir);
  const cashcat = {
    mints: new Set(launches.map((l) => l.mint)),
    wallets: new Set([...launches.map((l) => l.creator), ...(env.CASHCAT_WALLET_ADDRESS ? [env.CASHCAT_WALLET_ADDRESS] : [])]),
  };
  log.info(`CashCat exclusions: ${cashcat.mints.size} mint(s), ${cashcat.wallets.size} wallet(s)`);
  if (!rpc.isPublic) log.info("RPC: the owner's"); else log.info("RPC: the public mainnet endpoint (reads only; holder reads may be refused)");

  try {
    const stale = await verifyEstablished(rpc);
    if (stale.length) log.warn(`established cat coins that no longer read as live mints: ${stale.map((c) => c.symbol).join(", ")}`);
  } catch (e) { log.warn(`could not re-read the established cat coins: ${e.message}`); }

  /* ── 1. READ: the newest coins, back to where the last complete listing began; the coins traded most recently ── */
  const prev = state.listedTo;
  const untilMs = prev === null ? null : prev - RUN_LIMITS.overlapMinutes * MIN;
  const listing = await newestCoins({ http, untilMs, maxPages: RUN_LIMITS.maxPages });
  /* Covered: it read back to the newest coin the last complete listing read, so nothing between was left out. */
  const covered = prev !== null && (listing.reached || (listing.oldestMs !== null && listing.oldestMs <= prev));
  let gap = null;
  if (prev !== null && !covered && listing.exhausted && listing.oldestMs !== null) {
    gap = { fromMs: prev, toMs: listing.oldestMs };
    log.warn(`MISSED: pump.fun's listing ran out at coins created at ${hhmm(listing.oldestMs)} UTC, but the last complete listing reached ${hhmm(prev)} UTC: coins created in between (${Math.round((listing.oldestMs - prev) / MIN)} minutes) were not listed, and a cat coin among them is checked only if it shows up among the recently traded`);
  }
  if (prev !== null && !covered && listing.stoppedBy) log.warn(`the newest listing stopped at ${listing.stoppedBy}, back to coins created at ${listing.oldestMs ? hhmm(listing.oldestMs) : "?"} UTC; the next run reads that stretch again`);
  else if (listing.newestMs !== null) state.listedTo = listing.newestMs;
  log.info(`newest listing: ${listing.coins.length} coins on ${listing.pages} page(s), created ${listing.oldestMs ? hhmm(listing.oldestMs) : "?"}–${listing.newestMs ? hhmm(listing.newestMs) : "?"} UTC${prev === null ? " (no earlier listing on file: read as far back as pump.fun lists)" : covered ? " (back to the last listing: nothing between was left out)" : ""}`);
  const merged = new Map(listing.coins.map((c) => [c.mint, c]));
  try { for (const c of await activeCoins({ http, pages: RUN_LIMITS.activePages })) if (!merged.has(c.mint)) merged.set(c.mint, c); }
  catch (e) { log.warn(`pump.fun's active listing failed: ${e.message}`); }
  const coins = [...merged.values()];

  /* ── 2. QUEUE every cat coin not dealt with yet, at any age under a day ── */
  const published = new Map(file.callouts.map((c) => [c.mint, c]));
  const skipped = { notCat: 0, known: 0, cashcat: 0, flagged: 0, old: 0, unprintable: 0 };
  let newlyQueued = 0;
  for (const c of coins) {
    if (cashcat.mints.has(c.mint) || cashcat.wallets.has(c.creator)) { skipped.cashcat++; continue; }
    if (published.has(c.mint) || state.pending[c.mint] || state.checked[c.mint]) { skipped.known++; continue; }
    if (c.banned || c.nsfw) { skipped.flagged++; continue; }
    if (t - c.createdMs > THRESHOLDS.MAX_AGE_HOURS * HOUR) { skipped.old++; continue; }
    const cat = detectCat(c);
    if (!cat.isCat) { skipped.notCat++; continue; }
    if (!displaySafe({ name: c.name, symbol: c.symbol }).ok) { skipped.unprintable++; state.checked[c.mint] = { at: t, verdict: "unprintable" }; continue; }
    state.pending[c.mint] = queued(c, cat, c.createdMs + THRESHOLDS.MIN_AGE_MINUTES * MIN);
    newlyQueued++;
  }

  /* A coin a day old is out of the window: it leaves the queue, and is named if it was never checked. */
  const dropped = [];
  const drop = (p, why) => {
    delete state.pending[p.mint];
    if (p.n > 0) return;
    dropped.push({ mint: p.mint, name: clip(p.name, 40), symbol: clip(p.symbol, 16), why });
    state.checked[p.mint] = { at: t, verdict: "dropped" };
  };
  for (const p of Object.values(state.pending)) if (t - p.createdMs > THRESHOLDS.MAX_AGE_HOURS * HOUR) drop(p, `not checked before it was ${THRESHOLDS.MAX_AGE_HOURS} hours old`);
  /* Forget what cannot come back: a coin over a day old is never queued again. */
  for (const [mint, v] of Object.entries(state.checked)) if (t - v.at > (THRESHOLDS.MAX_AGE_HOURS + 2) * HOUR) delete state.checked[mint];

  /* ── 3. CHECK what is due, within the budget ── */
  const pending = Object.values(state.pending);
  const due = pending.filter((p) => p.due <= t).sort(queueOrder);
  const batch = due.slice(0, RUN_LIMITS.maxChecksPerRun);
  const left = due.slice(RUN_LIMITS.maxChecksPerRun);
  log.info(`coins read: ${coins.length}; cat coins new to Popcat: ${newlyQueued}; in the queue: ${pending.length} (${due.length} due now, ${pending.length - due.length} not yet); skipped: ${JSON.stringify(skipped)}`);
  if (left.length) log.warn(`over this run's budget of ${RUN_LIMITS.maxChecksPerRun} checks: ${left.length} due coin(s) left for the next run (${left.filter((p) => p.n === 0).length} never checked yet): ${left.slice(0, 20).map((p) => `${clip(p.name, 24)} ${p.mint}`).join("; ")}${left.length > 20 ? "; …" : ""}`);

  const entries = [];
  const retry = (p, why) => {
    p.tries++;
    if (p.tries >= RUN_LIMITS.maxReadTries) { log.info(`    dropped after ${p.tries} tries: ${why}`); drop(p, `${why}, ${p.tries} tries`); }
    else { p.due = t; log.info(`    tried ${p.tries} of ${RUN_LIMITS.maxReadTries} times: ${why}; again next run`); }
  };
  for (const p of batch) {
    const label = `${clip(p.name, 40)} (${ticker(clip(p.symbol, 16))}) ${p.mint}`;
    const coin = { mint: p.mint, creator: p.creator, curve: p.curve, name: p.name, symbol: p.symbol, description: p.description, createdMs: p.createdMs, metadataUri: p.metadataUri };
    if (!p.reviewed && (model?.hasKey || p.cat.field === "description")) {
      if (!model?.hasKey) { log.info(`${label}: cat only by its description, and no model to confirm it — skipped`); delete state.pending[p.mint]; state.checked[p.mint] = { at: t, verdict: "unconfirmed" }; continue; }
      let r;
      try {
        r = await model.callTool({ tool: CALLOUT_REVIEW_TOOL, system: "You screen new memecoins for a cat-themed newsroom that prints only a coin's name and ticker, never advice.",
          user: JSON.stringify({ name: coin.name, ticker: coin.symbol, description: coin.description.slice(0, 500) }) });
      } catch (e) { log.warn(`${label}: the model review failed (${e.message})`); retry(p, "the model review failed"); continue; }
      if (r?.cat_themed !== true || r?.fit_to_print !== true) { log.info(`${label}: the model review declined (${String(r?.reason ?? "").slice(0, 120)})`); delete state.pending[p.mint]; state.checked[p.mint] = { at: t, verdict: "model declined" }; continue; }
      p.reviewed = true;
    }
    let onchain;
    try { onchain = await gatherOnchain({ rpc, coin }); }
    catch (e) { log.info(`${label}: could not be read on chain (${e.message})`); retry(p, "its accounts could not be read"); continue; }
    /* pump.fun's listing time and the creation on chain can differ by a minute or two: a coin the
       chain says is younger than the minimum age waits for it, rather than being flagged for it. */
    const born = onchain.createTime ? onchain.createTime * 1000 : p.createdMs;
    if (now() - born < THRESHOLDS.MIN_AGE_MINUTES * MIN) { p.due = born + THRESHOLDS.MIN_AGE_MINUTES * MIN; log.info(`${label}: younger than ${THRESHOLDS.MIN_AGE_MINUTES} minutes by its creation on chain; waits until ${hhmm(p.due)} UTC`); continue; }
    const creatorLaunches = await creatorLaunchCount({ http, creator: coin.creator });
    const metadata = await readMetadata({ http, uri: coin.metadataUri });
    const at = now();
    let v;
    try { v = evaluate({ coin, onchain, creatorLaunches, metadata, now: at, cashcat }); }
    catch (e) { log.info(`${label}: its accounts do not decode as a pump.fun coin (${e.message}); dropped`); drop(p, "its accounts do not decode as a pump.fun coin"); continue; }
    if (v.failed.includes("not_cashcat")) { log.info(`${label}: its bonding curve names CashCat's wallet as its creator; never listed`); delete state.pending[p.mint]; state.checked[p.mint] = { at: t, verdict: "cashcat" }; continue; }
    log.info(`${label}: ${v.pass ? "NO RED FLAGS FOUND" : `RED FLAGS (${v.failed.length}): ${v.failed.join(", ")}`}${p.n ? ` (check ${p.n + 1})` : ""}`);
    for (const c of v.checks) log.info(`    ${c.result.padEnd(4)} ${c.id}: ${c.value}`);
    const entry = { time: isoSecond(at), venue: "pumpfun", mint: coin.mint, creator: coin.creator, name: clip(coin.name, 40), symbol: clip(coin.symbol, 16),
      cat: { field: p.cat.field, word: clip(p.cat.word, 40) }, checks: v.checks.map(({ id, result, value }) => ({ id, result, value })), stats: v.stats };
    /* The site's own validator decides what is publishable; an entry it refuses is logged and left out. */
    const check = validateCallouts({ callouts: [entry] }, { exclude: launches });
    if (check.problems.length) { log.info(`${label}: the site would refuse the entry (${check.problems[0]}); not published`); drop(p, "the site would refuse its entry"); continue; }
    entries.push({ entry, shown: check.callouts[0] });
    p.n++;
    p.tries = 0;
    state.checked[p.mint] = { at: t, verdict: (v.pass ? "no red flags" : `red flags: ${v.failed.join(",")}`).slice(0, 60) };
    if (!v.pass && p.n < RUN_LIMITS.maxChecksPerCoin && v.failed.every((id) => RECHECKABLE.includes(id))) p.due = at + RUN_LIMITS.recheckAfterMinutes * MIN;
    else delete state.pending[p.mint];
  }
  const waiting = Object.values(state.pending).filter((p) => p.n === 0);
  if (dropped.length) log.warn(`DROPPED ${dropped.length} cat coin(s) without a check: ${dropped.map((d) => `${d.name} ${d.mint} (${d.why})`).join("; ")}`);

  /* ── 4. PICK: the first run at or after a window's start tries once for that window ── */
  const tp = now();
  const w = windowOf(tp);
  const pickResult = { due: pickDue(state, tp), windowStart: w.start, pick: null, pool: 0, passedOver: 0 };
  if (pickResult.due) {
    const fresh = new Set(entries.map((e) => e.shown.mint));
    const pool = [...entries.map((e) => e.shown), ...file.callouts.filter((c) => !fresh.has(c.mint))];
    const chosen = choosePick({ entries: pool, picked: new Set(file.picks.map((p) => p.mint)), now: tp });
    Object.assign(pickResult, { pick: chosen.pick, pool: chosen.pool, passedOver: chosen.passedOver.length });
    for (const c of chosen.passedOver) log.info(`not picked, though ranked higher: ${c.name} (${ticker(c.symbol)}) ${c.mint} — its own name or ticker carries a word a draft may not print`);
    if (chosen.pick) {
      log.info(`${live ? "POPCAT'S PICK" : "WOULD PICK (dry run)"} for ${hhmm(w.start)}–${hhmm(w.end)} UTC, of ${chosen.pool} coin(s) with no red flags checked in the six hours before: ${chosen.pick.name} (${ticker(chosen.pick.symbol)}) ${chosen.pick.mint}`);
      log.info(`    draft (${chosen.pick.draft.length} characters): ${chosen.pick.draft}`);
    } else log.info(`no pick for ${hhmm(w.start)}–${hhmm(w.end)} UTC: no cat coin checked in the six hours before passed every check${chosen.passedOver.length ? " with a name a draft may print" : ""}`);
    state.pickWindow = w.iso;
  } else log.info(`the pick for ${hhmm(w.start)}–${hhmm(w.end)} UTC was tried by an earlier run`);

  const shown = entries.map((e) => e.shown);
  const result = {
    mode: live ? "live" : "dry", at: t,
    listing: { pages: listing.pages, covered, stoppedBy: prev !== null && !covered ? listing.stoppedBy : null, newestMs: listing.newestMs, oldestMs: listing.oldestMs, gap },
    counts: { read: coins.length, queued: newlyQueued, checked: shown.length, callouts: shown.filter((c) => c.callout).length, spotted: shown.filter((c) => !c.callout).length,
      waiting: waiting.length, left: left.filter((p) => p.n === 0).length, dropped: dropped.length },
    skipped, entries: shown, dropped, pick: pickResult,
  };

  if (!live) {
    for (const c of shown) log.info(`${c.callout ? "WOULD CALL OUT" : "WOULD LIST AS SPOTTED"} (dry run): ${c.name} (${ticker(c.symbol)}) ${c.mint}${c.callout ? "" : ` — ${c.verdict}`}`);
    log.info(`dry run complete: ${result.counts.checked} coin(s) would be listed (${result.counts.callouts} callout(s), ${result.counts.spotted} spotted), ${pickResult.pick ? "with a pick" : "no pick"}; nothing written`);
    return result;
  }
  if (entries.length || pickResult.pick) appendCallouts(dataDir, entries.map((e) => e.entry), { exclude: launches, picks: pickResult.pick ? [pickResult.pick] : [] });
  savePopcatState(dataDir, state);
  log.info(`published ${result.counts.checked} coin(s) (${result.counts.callouts} callout(s), ${result.counts.spotted} spotted)${pickResult.pick ? " and the window's pick" : ""}`);
  return result;
}
