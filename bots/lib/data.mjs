/**
 * THE BOTS' DATA FILES: launches.json (CashCat) and callouts.json (Popcat: every cat coin it
 * checked, and its picks), read and written through the same validators the website runs
 * (site/assets/launches.js, callouts.js).
 *
 * In GitHub Actions the data directory is a checkout of the floor-data branch; the deploy
 * copies these files into site/assets/ (bots/floor-data.mjs overlay). Run locally, it
 * defaults to site/assets/ itself. A bot never writes an entry the site would refuse: the
 * new list is validated as a whole before the file is replaced, entries are kept newest
 * first and capped, and a file that does not validate is an error, not something to paper
 * over.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateLaunches, MAX_LAUNCHES } from "../../site/assets/launches.js";
import { validateCallouts, MAX_CALLOUTS, MAX_PICKS, PICK_LOOKBACK_HOURS } from "../../site/assets/callouts.js";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_DATA_DIR = path.join(REPO_ROOT, "site", "assets");
export const FILES = Object.freeze({ launches: "launches.json", callouts: "callouts.json", popcatState: "popcat-state.json" });

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** The launches on file, validated. A problem in the file is thrown: the bots do not guess. */
export function loadLaunches(dir = DEFAULT_DATA_DIR) {
  const raw = readJson(path.join(dir, FILES.launches), { launches: [] });
  const v = validateLaunches(raw);
  if (v.problems.length) throw new Error(`launches.json does not validate: ${v.problems.join(" | ")}`);
  return v.launches;
}

/** Popcat's file, validated: { callouts, picks }. "callouts" is every coin it checked. */
export function loadCalloutsFile(dir = DEFAULT_DATA_DIR, { exclude = [] } = {}) {
  const raw = readJson(path.join(dir, FILES.callouts), { callouts: [], picks: [] });
  const v = validateCallouts(raw, { exclude });
  if (v.problems.length) throw new Error(`callouts.json does not validate: ${v.problems.join(" | ")}`);
  return { callouts: v.callouts, picks: v.picks };
}
export const loadCallouts = (dir = DEFAULT_DATA_DIR, opts = {}) => loadCalloutsFile(dir, opts).callouts;

/** The raw on-disk form of a validated launch (the validator adds nothing the file lacks, but
 *  normalises empty optionals away). */
const launchToFile = (l) => {
  const out = { time: l.time, venue: l.venue, name: l.name, symbol: l.symbol, tagline: l.tagline, trend: l.trend, mint: l.mint, creator: l.creator, tx: l.tx, quote: l.quote };
  if (l.pool) out.pool = l.pool;
  out.devBuy = l.devBuy.tx ? { sol: l.devBuy.sol, tx: l.devBuy.tx } : { sol: l.devBuy.sol };
  out.costSol = l.costSol;
  out.kitten = l.kitten;
  return out;
};
const statsToFile = (s) => ({ holders: s.holders, top10Pct: s.top10Pct, curvePct: s.curvePct, txs: s.txs });
const calloutToFile = (c) => ({ time: c.time, venue: c.venue, mint: c.mint, creator: c.creator, name: c.name, symbol: c.symbol, cat: c.cat,
  checks: c.checks.map(({ id, result, value }) => ({ id, result, value })), stats: statsToFile(c.stats) });
const pickToFile = (p) => ({ window: p.window, time: p.time, checked: p.checked, mint: p.mint, creator: p.creator, name: p.name, symbol: p.symbol, stats: statsToFile(p.stats), draft: p.draft });

/** Add one launch (newest first), validate the whole list, then replace the file. */
export function appendLaunch(dir, entry) {
  const current = loadLaunches(dir).map(launchToFile);
  const next = { launches: [entry, ...current].slice(0, MAX_LAUNCHES) };
  const v = validateLaunches(next);
  if (v.problems.length) throw new Error(`the new launch would not validate: ${v.problems.join(" | ")}`);
  writeJson(path.join(dir, FILES.launches), { launches: v.launches.map(launchToFile) });
  return v.launches;
}

/**
 * The newest MAX_CALLOUTS coins, newest first — except that a callout checked in the
 * PICK_LOOKBACK_HOURS before the newest entry (a coin the next pick may still choose) is kept
 * ahead of older spotted coins. At the rate cat coins were launched on 2026-09-25 (about sixty an
 * hour) 200 entries hold about three hours, and spotted coins far outnumber callouts.
 */
const byTime = (a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0);
export function capCallouts(list) {
  const sorted = [...list].sort(byTime);
  if (sorted.length <= MAX_CALLOUTS) return sorted;
  const since = Date.parse(sorted[0].time) - PICK_LOOKBACK_HOURS * 3_600_000;
  const keep = new Set(sorted.filter((c) => c.checks.every((k) => k.result !== "fail") && Date.parse(c.time) > since).slice(0, MAX_CALLOUTS).map((c) => c.mint));
  for (const c of sorted) { if (keep.size >= MAX_CALLOUTS) break; keep.add(c.mint); }
  return sorted.filter((c) => keep.has(c.mint));
}

/**
 * Write the coins Popcat checked this run, and its pick if it made one. A coin already on file
 * is replaced by its newer check (one entry per coin); the list is kept newest first and capped
 * (capCallouts), the picks at MAX_PICKS; the whole file is validated before it is replaced.
 */
export function appendCallouts(dir, entries, { exclude = [], picks = [] } = {}) {
  const current = loadCalloutsFile(dir, { exclude });
  const fresh = new Set(entries.map((e) => e.mint));
  const callouts = capCallouts([...entries, ...current.callouts.map(calloutToFile).filter((c) => !fresh.has(c.mint))]);
  const next = { callouts, picks: [...picks, ...current.picks.map(pickToFile)].slice(0, MAX_PICKS) };
  const v = validateCallouts(next, { exclude });
  if (v.problems.length) throw new Error(`the new callouts would not validate: ${v.problems.join(" | ")}`);
  writeJson(path.join(dir, FILES.callouts), { callouts: v.callouts.map(calloutToFile), picks: v.picks.map(pickToFile) });
  return v;
}

/* ── Popcat's memory ────────────────────────────────────────────────────────────────────────
   popcat-state.json, on floor-data beside callouts.json and never on the site:
     listedTo    the creation time of the newest coin the last complete listing read (ms), so the
                 next run reads back to it and no further
     pending     the cat coins waiting for a check: first ones (too young, or over a run's budget,
                 or unreadable last time) and re-checks, each with what the check needs
     checked     every coin already dealt with, and how, so no run spends a read on it again
     pickWindow  the start of the last six-hour window a pick was tried for (ISO) */

export const POPCAT_STATE_CAP = 3_000;
export const POPCAT_PENDING_CAP = 2_000;
const MINT_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const isStr = (v, max) => typeof v === "string" && v.length <= max;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isCount = (v) => Number.isInteger(v) && v >= 0 && v <= 100;

function pendingOf(mint, p) {
  if (!p || typeof p !== "object") return null;
  if (!MINT_KEY.test(p.creator ?? "") || !MINT_KEY.test(p.curve ?? "")) return null;
  if (!isStr(p.name, 80) || !isStr(p.symbol, 40) || !isStr(p.description ?? "", 1000) || !isStr(p.metadataUri ?? "", 300)) return null;
  if (!isNum(p.createdMs) || !isNum(p.due) || !isCount(p.n) || !isCount(p.tries)) return null;
  if (!p.cat || !["name", "symbol", "description"].includes(p.cat.field) || !isStr(p.cat.word, 80)) return null;
  return { mint, creator: p.creator, curve: p.curve, name: p.name, symbol: p.symbol, description: p.description ?? "", metadataUri: p.metadataUri ?? "",
    createdMs: p.createdMs, cat: { field: p.cat.field, word: p.cat.word }, due: p.due, n: p.n, tries: p.tries, reviewed: p.reviewed === true };
}

export function loadPopcatState(dir) {
  const raw = readJson(path.join(dir, FILES.popcatState), {});
  const checked = {}, pending = {};
  if (raw && typeof raw.checked === "object" && raw.checked) {
    for (const [mint, v] of Object.entries(raw.checked)) {
      if (MINT_KEY.test(mint) && v && isNum(v.at) && typeof v.verdict === "string" && v.verdict.length <= 60) checked[mint] = { at: v.at, verdict: v.verdict };
    }
  }
  if (raw && typeof raw.pending === "object" && raw.pending) {
    for (const [mint, v] of Object.entries(raw.pending)) {
      const p = MINT_KEY.test(mint) ? pendingOf(mint, v) : null;
      if (p) pending[mint] = p;
    }
  }
  const listedTo = isNum(raw?.listedTo) ? raw.listedTo : null;
  const pickWindow = typeof raw?.pickWindow === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(raw.pickWindow) ? raw.pickWindow : null;
  return { listedTo, pending, checked, pickWindow };
}

export function savePopcatState(dir, state) {
  const checked = Object.entries(state.checked ?? {}).sort((a, b) => b[1].at - a[1].at).slice(0, POPCAT_STATE_CAP);
  const pending = Object.entries(state.pending ?? {}).sort((a, b) => b[1].createdMs - a[1].createdMs).slice(0, POPCAT_PENDING_CAP)
    .map(([mint, p]) => [mint, { creator: p.creator, curve: p.curve, name: p.name, symbol: p.symbol, description: p.description, metadataUri: p.metadataUri,
      createdMs: p.createdMs, cat: p.cat, due: p.due, n: p.n, tries: p.tries, reviewed: p.reviewed === true }]);
  writeJson(path.join(dir, FILES.popcatState), { listedTo: state.listedTo ?? null, pickWindow: state.pickWindow ?? null, pending: Object.fromEntries(pending), checked: Object.fromEntries(checked) });
}

export { launchToFile, calloutToFile, pickToFile };
