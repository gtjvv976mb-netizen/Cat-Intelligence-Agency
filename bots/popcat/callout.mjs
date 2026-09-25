/**
 * ONE POPCAT RUN: new pump.fun coins → the cat ones → the checks → callouts for those that pass.
 *
 * Dry run (POPCAT_LIVE unset, the default): everything is read and checked, and the callouts it
 * WOULD publish are printed; no file is written. Live (POPCAT_LIVE=1): the passing coins are
 * appended to callouts.json (newest first, capped), and the coins it checked are remembered in
 * popcat-state.json so the next run spends its RPC budget on new ones.
 *
 * Never: a coin CashCat launched (by its mint in launches.json, or its creator being CashCat's
 * wallet — every creator in launches.json and CASHCAT_WALLET_ADDRESS); a coin pump.fun marks
 * banned or NSFW; a coin whose name or ticker the content rules refuse to print; a coin's image
 * or links on the site. The agency never buys a coin before calling it out: Popcat has no key
 * and no way to buy.
 */
import { detectCat } from "../lib/catdetect.mjs";
import { displaySafe } from "../lib/content-rules.mjs";
import { loadLaunches, loadCallouts, appendCallouts, loadPopcatState, savePopcatState } from "../lib/data.mjs";
import { newestCoins, activeCoins, creatorLaunchCount, readMetadata } from "./sources.mjs";
import { gatherOnchain, evaluate, THRESHOLDS } from "./checks.mjs";
import { validateCallouts } from "../../site/assets/callouts.js";
import { verifyEstablished } from "./established.mjs";

export const RUN_LIMITS = Object.freeze({ lookbackMinutes: 60, maxPages: 20, activePages: 4, maxCandidates: 8, maxCalloutsPerRun: 3, recheckAfterMinutes: 60 });

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

const isoSecond = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
/** Characters the site's validator refuses (controls, zero-width joiners, direction marks) are
 *  dropped from a stranger's text before it is shown; an emoji may lose its joiner, nothing more. */
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/g;
const clip = (s, n) => { const t = String(s).replace(INVISIBLE, "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export async function runPopcat({ env, http, rpc, model, dataDir, now = () => Date.now(), log }) {
  const live = env.POPCAT_LIVE === "1" && env.NODE_ENV !== "test";
  log.section(`Popcat — ${live ? "LIVE: passing coins are published to the floor" : "dry run: nothing is written"}`);
  const t = now();
  const launches = loadLaunches(dataDir);
  const existing = loadCallouts(dataDir, { exclude: launches });
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

  /* Two listings: the newest coins (about 27 a minute were being created, so twenty pages reach
     back roughly forty minutes) and the coins traded most recently, whatever their age. */
  const merged = new Map();
  for (const c of await newestCoins({ http, sinceMs: t - RUN_LIMITS.lookbackMinutes * 60_000, maxPages: RUN_LIMITS.maxPages })) merged.set(c.mint, c);
  try { for (const c of await activeCoins({ http, pages: RUN_LIMITS.activePages })) if (!merged.has(c.mint)) merged.set(c.mint, c); }
  catch (e) { log.warn(`pump.fun's active listing failed: ${e.message}`); }
  const coins = [...merged.values()];
  const called = new Set(existing.map((c) => c.mint));
  const candidates = [];
  const skipped = { notCat: 0, young: 0, old: 0, calledOut: 0, cashcat: 0, recent: 0, flagged: 0, unprintable: 0 };
  for (const c of coins) {
    const ageMin = (t - c.createdMs) / 60_000;
    if (cashcat.mints.has(c.mint) || cashcat.wallets.has(c.creator)) { skipped.cashcat++; continue; }
    if (called.has(c.mint)) { skipped.calledOut++; continue; }
    if (c.banned || c.nsfw) { skipped.flagged++; continue; }
    if (ageMin < THRESHOLDS.MIN_AGE_MINUTES) { skipped.young++; continue; }
    if (ageMin > THRESHOLDS.MAX_AGE_HOURS * 60) { skipped.old++; continue; }
    const seen = state.checked[c.mint];
    if (seen && t - seen.at < RUN_LIMITS.recheckAfterMinutes * 60_000) { skipped.recent++; continue; }
    const cat = detectCat(c);
    if (!cat.isCat) { skipped.notCat++; continue; }
    if (!displaySafe({ name: c.name, symbol: c.symbol }).ok) { skipped.unprintable++; state.checked[c.mint] = { at: t, verdict: "unprintable" }; continue; }
    candidates.push({ coin: c, cat });
  }
  log.info(`coins read: ${coins.length}; cat candidates: ${candidates.length}; skipped: ${JSON.stringify(skipped)}`);

  const out = [];
  for (const { coin, cat } of candidates.slice(0, RUN_LIMITS.maxCandidates)) {
    if (out.length >= RUN_LIMITS.maxCalloutsPerRun) break;
    const label = `${clip(coin.name, 40)} ($${clip(coin.symbol, 16)}) ${coin.mint}`;
    if (model?.hasKey || cat.field === "description") {
      if (!model?.hasKey) { log.info(`${label}: cat only by its description, and no model to confirm it — skipped`); state.checked[coin.mint] = { at: t, verdict: "unconfirmed" }; continue; }
      try {
        const r = await model.callTool({ tool: CALLOUT_REVIEW_TOOL, system: "You screen new memecoins for a cat-themed newsroom that prints only a coin's name and ticker, never advice.",
          user: JSON.stringify({ name: coin.name, ticker: coin.symbol, description: coin.description.slice(0, 500) }) });
        if (r?.cat_themed !== true || r?.fit_to_print !== true) { log.info(`${label}: the model review declined (${String(r?.reason ?? "").slice(0, 120)})`); state.checked[coin.mint] = { at: t, verdict: "model declined" }; continue; }
      } catch (e) { log.warn(`${label}: the model review failed (${e.message}); skipped this run`); continue; }
    }
    let onchain;
    try { onchain = await gatherOnchain({ rpc, coin }); }
    catch (e) { log.info(`${label}: could not be read on chain (${e.message}); skipped`); state.checked[coin.mint] = { at: t, verdict: "unreadable" }; continue; }
    const creatorLaunches = await creatorLaunchCount({ http, creator: coin.creator });
    const metadata = await readMetadata({ http, uri: coin.metadataUri });
    let v;
    try { v = evaluate({ coin, onchain, creatorLaunches, metadata, now: t, cashcat }); }
    catch (e) { log.info(`${label}: its accounts do not decode as a pump.fun coin (${e.message}); skipped`); state.checked[coin.mint] = { at: t, verdict: "undecodable" }; continue; }
    log.info(`${label}: ${v.pass ? "PASSES" : `fails ${v.failed.join(", ")}`}`);
    for (const c of v.checks) log.info(`    ${c.result.padEnd(4)} ${c.id}: ${c.value}`);
    state.checked[coin.mint] = { at: t, verdict: v.pass ? "passed" : `failed ${v.failed[0]}` };
    if (!v.pass) continue;
    const entry = { time: isoSecond(t), venue: "pumpfun", mint: coin.mint, creator: coin.creator, name: clip(coin.name, 40), symbol: clip(coin.symbol, 16),
      cat: { field: cat.field, word: clip(cat.word, 40) }, checks: v.checks.map(({ id, result, value }) => ({ id, result, value })) };
    /* The site's own validator decides what is publishable; an entry it refuses is logged and left out. */
    const check = validateCallouts({ callouts: [entry] }, { exclude: launches });
    if (check.problems.length) { log.info(`${label}: passed the checks but the site would refuse the entry (${check.problems[0]}); not published`); state.checked[coin.mint] = { at: t, verdict: "unpublishable" }; continue; }
    out.push(entry);
  }

  if (!live) {
    for (const c of out) log.info(`WOULD CALL OUT (dry run): ${c.name} ($${c.symbol}) ${c.mint}`);
    log.info(`dry run complete: ${out.length} callout(s) would be published; nothing written`);
    return { mode: "dry", callouts: out, candidates: candidates.length };
  }
  if (out.length) appendCallouts(dataDir, out, { exclude: launches });
  savePopcatState(dataDir, state);
  log.info(`published ${out.length} callout(s)`);
  return { mode: "live", callouts: out, candidates: candidates.length };
}
