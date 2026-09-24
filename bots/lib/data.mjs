/**
 * THE BOTS' DATA FILES: launches.json (CashCat) and callouts.json (Popcat), read and written
 * through the same validators the website runs (site/assets/launches.js, callouts.js).
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
import { validateCallouts, MAX_CALLOUTS } from "../../site/assets/callouts.js";

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

export function loadCallouts(dir = DEFAULT_DATA_DIR, { exclude = [] } = {}) {
  const raw = readJson(path.join(dir, FILES.callouts), { callouts: [] });
  const v = validateCallouts(raw, { exclude });
  if (v.problems.length) throw new Error(`callouts.json does not validate: ${v.problems.join(" | ")}`);
  return v.callouts;
}

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
const calloutToFile = (c) => ({ time: c.time, venue: c.venue, mint: c.mint, creator: c.creator, name: c.name, symbol: c.symbol, cat: c.cat, checks: c.checks.map(({ id, result, value }) => ({ id, result, value })) });

/** Add one launch (newest first), validate the whole list, then replace the file. */
export function appendLaunch(dir, entry) {
  const current = loadLaunches(dir).map(launchToFile);
  const next = { launches: [entry, ...current].slice(0, MAX_LAUNCHES) };
  const v = validateLaunches(next);
  if (v.problems.length) throw new Error(`the new launch would not validate: ${v.problems.join(" | ")}`);
  writeJson(path.join(dir, FILES.launches), { launches: v.launches.map(launchToFile) });
  return v.launches;
}

export function appendCallouts(dir, entries, { exclude = [] } = {}) {
  const current = loadCallouts(dir, { exclude }).map(calloutToFile);
  const next = { callouts: [...entries, ...current].slice(0, MAX_CALLOUTS) };
  const v = validateCallouts(next, { exclude });
  if (v.problems.length) throw new Error(`the new callouts would not validate: ${v.problems.join(" | ")}`);
  writeJson(path.join(dir, FILES.callouts), { callouts: v.callouts.map(calloutToFile) });
  return v.callouts;
}

/* ── Popcat's memory: coins already checked, so a run does not re-spend its RPC budget on them ── */

export const POPCAT_STATE_CAP = 1_000;

export function loadPopcatState(dir) {
  const raw = readJson(path.join(dir, FILES.popcatState), { checked: {} });
  const checked = {};
  if (raw && typeof raw.checked === "object" && raw.checked) {
    for (const [mint, v] of Object.entries(raw.checked)) {
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) && v && typeof v.at === "number" && typeof v.verdict === "string" && v.verdict.length <= 60) checked[mint] = { at: v.at, verdict: v.verdict };
    }
  }
  return { checked };
}

export function savePopcatState(dir, state) {
  const entries = Object.entries(state.checked).sort((a, b) => b[1].at - a[1].at).slice(0, POPCAT_STATE_CAP);
  writeJson(path.join(dir, FILES.popcatState), { checked: Object.fromEntries(entries) });
}

export { launchToFile, calloutToFile };
