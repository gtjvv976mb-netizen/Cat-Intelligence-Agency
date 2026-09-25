/**
 * POPCAT, IN YOUR BROWSER: THE CAT-COIN SCANNER TAB.
 *
 * The agency's Popcat (bots/popcat/) reads every new pump.fun coin, keeps the cat ones and runs
 * twelve on-chain checks on each. This is the same scanner, run by the service worker for one
 * person, reusing the bot's own code and nothing retyped:
 *
 *   · the listing: bots/popcat/sources.mjs newestCoins (pump.fun's newest coins, 50 a page);
 *   · the cat test: bots/lib/catdetect.mjs detectCat, then bots/lib/content-rules.mjs
 *     displaySafe (a name or ticker the rules would not print is never shown);
 *   · the checks: bots/popcat/checks.mjs gatherOnchain + evaluate, with THRESHOLDS as they are;
 *   · what may be shown: site/assets/callouts.js validateCallouts, the floor's own validator,
 *     which refuses HTML, hidden characters, links in text, and any coin of the user's CashCat.
 *
 * WHAT IT NEVER DOES. It trades nothing and signs nothing: this file has no wallet, no signer and
 * no path to one. It never shows a coin's picture and never follows or prints a link the coin
 * supplied: the only links are pump.fun's page and Solscan's, built by calloutLinks from an
 * address the validator accepted. A coin the user launched with CashCat (its mint in the CashCat
 * journal, or its creator the user's autopilot wallet, as pump.fun lists it or as its bonding
 * curve records it) is never listed, as the agency's Popcat never calls out CashCat's coins.
 *
 * WHEN IT RUNS. One scan step at a time, never two at once: while the popup is open on the
 * Popcat tab (the popup asks every half minute), and on the worker's half-minute alarm only if
 * the user switched background scanning on (off by default). A step reads at most
 * LIMITS.listingPages pages of the listing and checks at most LIMITS.checksPerStep coins (about a
 * dozen RPC reads and two pump.fun reads each, paced per host by bots/lib/http.mjs, which also
 * rests a host that answers 429 or 5xx). A step that fails rests the whole scanner, from a minute
 * doubling to fifteen. A coin younger than Popcat's minimum age waits in the queue.
 *
 * THE RPC. The user's, from Options. With none set it tries the public mainnet endpoint, which
 * answered 403 "Access forbidden" to this extension's requests on 2026-09-25 (it refuses browser
 * extensions); on that answer the scanner rests for half an hour and says to set an RPC.
 *
 * Everything is injected (http, the RPC, storage, the clock), so this file runs in Node for its
 * tests on recorded answers. It touches no chrome.* API.
 */
import { newestCoins, creatorLaunchCount, readMetadata } from "../../bots/popcat/sources.mjs";
import { gatherOnchain, evaluate, THRESHOLDS } from "../../bots/popcat/checks.mjs";
import { detectCat } from "../../bots/lib/catdetect.mjs";
import { displaySafe } from "../../bots/lib/content-rules.mjs";
import { HOSTS } from "../../bots/lib/verified.mjs";
import { validateCallouts, calloutLinks, ticker } from "../../site/assets/callouts.js";

export const POPCAT_TAB_STATE_KEY = "cia:popcat:tab";

/** The hosts this tab calls, besides the user's RPC: pump.fun's API and the two IPFS gateways
 *  the bot reads metadata through, by CID only. */
export const POPCAT_TAB_HOSTS = Object.freeze([HOSTS.pumpApi, HOSTS.pumpGateway, HOSTS.pinataGateway]);

export const POPCAT_TAB_LIMITS = Object.freeze({
  /** Newest-listing pages a step reads (50 coins a page). */
  listingPages: 2,
  /** Coins checked in one step. */
  checksPerStep: 2,
  /** No two steps closer than this, whoever asks. */
  minStepGapMs: 20_000,
  /** How far each listing reaches past the newest coin the last one read. */
  overlapMs: 5 * 60_000,
  /** Results kept, newest first, and coins kept waiting. */
  keepResults: 60,
  keepQueue: 200,
  /** A coin whose accounts could not be read is tried this many times. */
  maxTries: 3,
  /** A failed step rests the scanner: from this, doubling, to the most. */
  restStartMs: 60_000,
  restMaxMs: 15 * 60_000,
  /** The public endpoint refusing this browser rests it this long. */
  publicRefusedRestMs: 30 * 60_000,
});

export const POPCAT_NOT_ADVICE = "A list of checks, never advice: a red flag is what a check read on chain at that moment, not an accusation, and a coin with none can still go to zero. Not financial advice.";
export const POPCAT_CASHCAT_RULE = "Popcat never calls out a coin you launched with CashCat: your CashCat coins, and any coin whose creator is your autopilot wallet, are left out of this list.";
export const PUBLIC_RPC_REFUSED = "The public mainnet RPC refuses requests from browser extensions (it answered 403 \"Access forbidden\" to this one on 2026-09-25). Set your own RPC in Options.";

const MIN = 60_000, HOUR = 3_600_000;
const isoSecond = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
/* The characters the floor's validator refuses are dropped from a stranger's text before it is
   judged (the same list the bot's callout.mjs strips); what is left is shown as text. */
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/g;
const clip = (s, n) => { const t = String(s).replace(INVISIBLE, "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** The failures that are the network's or the RPC's, not the coin's: they rest the scanner. */
const transportFailure = (e) => e?.name === "RpcError" || e?.name === "HttpError";

/* Would the floor's validator print this coin's name and ticker? Asked BEFORE a coin is queued
   (so a name carrying HTML, a link scheme or a hidden character is never shown, not even in the
   waiting list, and never costs a read), with placeholder checks that stand for nothing. */
const PLACEHOLDER_CHECKS = ["not_cashcat", "mint_authority", "freeze_authority", "mint_extensions", "creator_share", "top10_share", "same_slot_buyers",
  "creator_launches", "socials", "age", "curve", "copycat"].map((id) => ({ id, result: "pass", value: "-" }));
function printable(c, cat) {
  const probe = { time: "2026-09-25T00:00:00Z", venue: "pumpfun", mint: c.mint, creator: c.creator, name: clip(c.name, 40), symbol: clip(c.symbol, 16),
    cat: { field: cat.field, word: clip(cat.word, 40) }, checks: PLACEHOLDER_CHECKS, stats: { holders: 0, top10Pct: 0, curvePct: 0, txs: null } };
  return validateCallouts({ callouts: [probe] }).problems.length === 0;
}

function freshState() {
  return { v: 1, listedTo: null, queue: {}, results: [], seen: {}, lastStepAt: 0, restUntil: 0, failures: 0, lastError: null, backgroundScan: false, counts: { listed: 0, cats: 0, checked: 0, skipped: 0 } };
}

/** The stored state, read defensively: anything malformed is dropped, never trusted. */
export function readState(raw) {
  const s = freshState();
  if (!isObject(raw) || raw.v !== 1) return s;
  if (Number.isFinite(raw.listedTo)) s.listedTo = raw.listedTo;
  if (isObject(raw.queue)) for (const [mint, q] of Object.entries(raw.queue)) if (isObject(q) && typeof q.name === "string" && Number.isFinite(q.createdMs)) s.queue[mint] = q;
  if (Array.isArray(raw.results)) s.results = raw.results.filter(isObject).slice(0, POPCAT_TAB_LIMITS.keepResults);
  if (isObject(raw.seen)) for (const [mint, at] of Object.entries(raw.seen)) if (Number.isFinite(at)) s.seen[mint] = at;
  for (const k of ["lastStepAt", "restUntil", "failures"]) if (Number.isFinite(raw[k])) s[k] = raw[k];
  if (typeof raw.lastError === "string") s.lastError = raw.lastError.slice(0, 300);
  s.backgroundScan = raw.backgroundScan === true;
  if (isObject(raw.counts)) for (const k of Object.keys(s.counts)) if (Number.isInteger(raw.counts[k])) s.counts[k] = raw.counts[k];
  return s;
}

/**
 * The scanner. `rpc()` returns { rpc, isPublic } (the bots' JSON-RPC client over the same
 * http) or null; `exclusions()` returns { launches: [{ mint, creator }], wallets: [addresses] }
 * — the user's CashCat launches and autopilot wallet.
 */
export function createPopcatTab({ http, rpc: rpcOf, storage, clock = () => Date.now(), exclusions = async () => ({ launches: [], wallets: [] }), limits = POPCAT_TAB_LIMITS } = {}) {
  if (!http || typeof http.json !== "function") throw new Error("createPopcatTab needs the bots' http client");
  if (!storage || typeof storage.get !== "function") throw new Error("createPopcatTab needs a storage");
  let running = null;

  const load = async () => readState(await storage.get(POPCAT_TAB_STATE_KEY));
  const save = (s) => storage.set(POPCAT_TAB_STATE_KEY, s);

  function rest(s, why, ms = null) {
    s.failures++;
    const wait = ms ?? Math.min(limits.restMaxMs, limits.restStartMs * 2 ** (s.failures - 1));
    s.restUntil = clock() + wait;
    s.lastError = String(why).slice(0, 300);
  }

  async function exclusionSets() {
    const ex = await exclusions();
    const launches = (ex?.launches ?? []).filter((l) => isObject(l) && typeof l.mint === "string" && typeof l.creator === "string");
    const wallets = new Set([...(ex?.wallets ?? []).filter((w) => typeof w === "string"), ...launches.map((l) => l.creator)]);
    return { launches, mints: new Set(launches.map((l) => l.mint)), wallets };
  }

  /** Queue the cat coins of a listing. */
  function queueFrom(s, coins, ex, t) {
    for (const c of coins) {
      s.counts.listed++;
      if (s.queue[c.mint] || s.seen[c.mint] || s.results.some((r) => r.mint === c.mint)) continue;
      if (ex.mints.has(c.mint) || ex.wallets.has(c.creator)) { s.seen[c.mint] = t; s.counts.skipped++; continue; }
      if (c.banned || c.nsfw || t - c.createdMs > THRESHOLDS.MAX_AGE_HOURS * HOUR) { s.seen[c.mint] = t; continue; }
      const cat = detectCat(c);
      if (!cat.isCat) { s.seen[c.mint] = t; continue; }
      /* No model in the tab: a coin that is a cat only by its description is left out, as the bot
         leaves it out without a key. A name or ticker the rules would not print is never shown. */
      if (cat.field === "description" || !displaySafe({ name: c.name, symbol: c.symbol }).ok || !printable(c, cat)) { s.seen[c.mint] = t; s.counts.skipped++; continue; }
      s.counts.cats++;
      s.queue[c.mint] = { mint: c.mint, creator: c.creator, curve: c.curve, name: c.name, symbol: c.symbol, metadataUri: c.metadataUri, createdMs: c.createdMs,
        cat: { field: cat.field, word: clip(cat.word, 40) }, due: c.createdMs + THRESHOLDS.MIN_AGE_MINUTES * MIN, tries: 0 };
    }
  }

  function trim(s, t) {
    for (const [mint, q] of Object.entries(s.queue)) if (t - q.createdMs > THRESHOLDS.MAX_AGE_HOURS * HOUR) { delete s.queue[mint]; s.seen[mint] = t; }
    const queued = Object.values(s.queue).sort((a, b) => b.createdMs - a.createdMs);
    for (const q of queued.slice(limits.keepQueue)) delete s.queue[q.mint];
    for (const [mint, at] of Object.entries(s.seen)) if (t - at > (THRESHOLDS.MAX_AGE_HOURS + 2) * HOUR) delete s.seen[mint];
    s.results = s.results.slice(0, limits.keepResults);
  }

  /** Check one queued coin. Returns "checked", "waiting", "dropped" or throws on an RPC failure. */
  async function checkOne(s, q, rpc, ex) {
    const coin = { mint: q.mint, creator: q.creator, curve: q.curve, name: q.name, symbol: q.symbol, createdMs: q.createdMs, metadataUri: q.metadataUri };
    const onchain = await gatherOnchain({ rpc, coin });
    const born = onchain.createTime ? onchain.createTime * 1000 : q.createdMs;
    if (clock() - born < THRESHOLDS.MIN_AGE_MINUTES * MIN) { q.due = born + THRESHOLDS.MIN_AGE_MINUTES * MIN; return "waiting"; }
    const creatorLaunches = await creatorLaunchCount({ http, creator: coin.creator });
    const metadata = await readMetadata({ http, uri: coin.metadataUri });
    const at = clock();
    let v;
    try { v = evaluate({ coin, onchain, creatorLaunches, metadata, now: at, cashcat: { mints: ex.mints, wallets: ex.wallets } }); }
    catch { delete s.queue[q.mint]; s.seen[q.mint] = at; return "dropped"; }
    delete s.queue[q.mint];
    s.seen[q.mint] = at;
    /* The user's own CashCat coin, found by the creator its bonding curve records: never listed. */
    if (v.failed.includes("not_cashcat")) { s.counts.skipped++; return "dropped"; }
    const entry = { time: isoSecond(at), venue: "pumpfun", mint: coin.mint, creator: coin.creator, name: clip(coin.name, 40), symbol: clip(coin.symbol, 16),
      cat: q.cat, checks: v.checks.map(({ id, result, value }) => ({ id, result, value })), stats: v.stats };
    const check = validateCallouts({ callouts: [entry] }, { exclude: ex.launches });
    if (check.problems.length || !check.callouts.length) return "dropped";
    s.results = [entry, ...s.results.filter((r) => r.mint !== entry.mint)].slice(0, limits.keepResults);
    s.counts.checked++;
    return "checked";
  }

  /**
   * One scan step. `force` skips the minimum gap (the popup's "scan now"), never the rest a
   * failure earned. Returns { ran, why?, listed, checked }.
   */
  async function step({ force = false } = {}) {
    if (running) return { ran: false, why: "a scan is already running" };
    running = (async () => {
      const s = await load();
      const t = clock();
      if (s.restUntil > t) return { ran: false, why: `resting until ${new Date(s.restUntil).toISOString().slice(11, 16)} UTC after: ${s.lastError}` };
      if (!force && t - s.lastStepAt < limits.minStepGapMs) return { ran: false, why: "the last scan was moments ago" };
      s.lastStepAt = t;
      const ex = await exclusionSets();
      let listing;
      try {
        listing = await newestCoins({ http, untilMs: s.listedTo === null ? null : s.listedTo - limits.overlapMs, maxPages: limits.listingPages });
      } catch (e) {
        rest(s, `pump.fun's listing could not be read (${e?.clause ?? "error"}): ${e?.message ?? e}`);
        await save(s);
        return { ran: false, why: s.lastError };
      }
      if (listing.newestMs !== null) s.listedTo = Math.max(s.listedTo ?? 0, listing.newestMs);
      queueFrom(s, listing.coins, ex, t);
      trim(s, t);
      const r = rpcOf ? rpcOf() : null;
      let checked = 0;
      if (!r?.rpc) s.lastError = "no RPC: set yours in Options to run the checks";
      else {
        const due = Object.values(s.queue).filter((q) => q.due <= clock()).sort((a, b) => a.createdMs - b.createdMs || (a.mint < b.mint ? -1 : 1));
        for (const q of due.slice(0, limits.checksPerStep)) {
          try {
            const out = await checkOne(s, q, r.rpc, ex);
            if (out === "checked") checked++;
          } catch (e) {
            if (r.isPublic && (e?.detail?.code === 403 || /forbidden/i.test(String(e?.message)))) { rest(s, PUBLIC_RPC_REFUSED, limits.publicRefusedRestMs); break; }
            q.tries = (q.tries ?? 0) + 1;
            if (q.tries >= limits.maxTries) { delete s.queue[q.mint]; s.seen[q.mint] = clock(); }
            /* The RPC or the network failing rests the whole scanner; a coin whose accounts do not
               read as a pump.fun coin is only that coin's problem: it is tried again, three times in all. */
            if (transportFailure(e)) { rest(s, `the chain could not be read for ${clip(q.name, 24)} (${e?.clause ?? "error"}): ${e?.message ?? e}`); break; }
          }
        }
        if (s.restUntil <= clock()) { s.failures = 0; s.lastError = null; }
      }
      await save(s);
      return { ran: true, listed: listing.coins.length, checked };
    })();
    try { return await running; } finally { running = null; }
  }

  /** What the popup shows: validated entries only, with their only links. */
  async function status() {
    const s = await load();
    const ex = await exclusionSets();
    const v = validateCallouts({ callouts: s.results }, { exclude: ex.launches });
    const t = clock();
    const results = v.callouts.map((c) => ({
      mint: c.mint, creator: c.creator, name: c.name, ticker: ticker(c.symbol), time: c.time, verdict: c.verdict, callout: c.callout,
      checks: c.checks.map((k) => ({ id: k.id, label: k.label, result: k.result, value: k.value })),
      flags: c.flags.map((f) => ({ id: f.id, flag: f.flag })), stats: c.stats, links: calloutLinks(c),
    }));
    const waiting = Object.values(s.queue).sort((a, b) => b.createdMs - a.createdMs).slice(0, 20)
      .filter((q) => displaySafe({ name: q.name, symbol: q.symbol }).ok)
      .map((q) => ({ name: clip(q.name, 40), ticker: ticker(clip(q.symbol, 16)), ageMin: Math.max(0, Math.floor((t - q.createdMs) / MIN)), dueInMin: Math.max(0, Math.ceil((q.due - t) / MIN)) }));
    const r = rpcOf ? rpcOf() : null;
    return {
      results, waiting, queued: Object.keys(s.queue).length, counts: s.counts, lastStepAt: s.lastStepAt || null,
      resting: s.restUntil > t ? s.restUntil : null, lastError: s.lastError, backgroundScan: s.backgroundScan,
      rpc: !r?.rpc ? "none" : r.isPublic ? "public" : "yours",
      limits: { checksPerStep: limits.checksPerStep, minStepGapSec: Math.round(limits.minStepGapMs / 1000), minAgeMin: THRESHOLDS.MIN_AGE_MINUTES, maxAgeHours: THRESHOLDS.MAX_AGE_HOURS },
      notAdvice: POPCAT_NOT_ADVICE, cashcatRule: POPCAT_CASHCAT_RULE,
    };
  }

  async function setBackgroundScan(on) { const s = await load(); s.backgroundScan = on === true; await save(s); return s.backgroundScan; }
  async function backgroundScanOn() { return (await load()).backgroundScan; }
  async function clear() { const s = freshState(); s.backgroundScan = (await load()).backgroundScan; await save(s); }

  return Object.freeze({ step, status, setBackgroundScan, backgroundScanOn, clear });
}
