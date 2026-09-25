/**
 * POPCAT (popcat-scout): BUYS ONLY NEW CAT COINS THAT PASS EVERY ONE OF POPCAT'S CHECKS.
 *
 * The same scan the agency's Popcat bot runs, with its code: pump.fun's newest coins
 * (bots/popcat/sources.mjs), the cat-word detector and the content rules (bots/lib/), and the
 * twelve on-chain checks with Popcat's THRESHOLDS (bots/popcat/checks.mjs gatherOnchain and
 * evaluate): mint and freeze authority revoked, accepted Token-2022 extensions, the creator at
 * most 5%, the ten largest holders at most 30% across at least 25 holders, at most 2 other
 * same-slot buyers, the creator's earlier launches, a social link, 15 minutes to 24 hours old,
 * at least 10% of the curve sold, not a copy of an established cat coin, and not the agency's
 * (the agency's coins and wallets stand where Popcat puts CashCat's). A coin with a single red
 * flag is never bought. Coins are named by their name and ticker only; without a model, a coin
 * that is a cat only by its description is skipped, as Popcat does.
 *
 * SMALL AND STRICT. Its defaults are the smallest the risk layer allows to be useful: 0.01 SOL a
 * buy, two coins at most, a 15% stop, a 30% take and a 10% trailing stop, 0.03 SOL a day. A coin
 * still on its bonding curve is bought and sold on the curve (the executor's buy_v2 / sell_v2);
 * one that has graduated, through Jupiter. Popcat's checks say what the chain showed at one
 * moment, and a coin that passed can be sold off minutes later: nothing here is an edge.
 */
import { newestCoins, creatorLaunchCount, readMetadata } from "../../../bots/popcat/sources.mjs";
import { gatherOnchain, evaluate, THRESHOLDS } from "../../../bots/popcat/checks.mjs";
import { detectCat } from "../../../bots/lib/catdetect.mjs";
import { displaySafe } from "../../../bots/lib/content-rules.mjs";

export const ID = "popcat-scout";
export const defaults = Object.freeze({
  limits: Object.freeze({ maxPerTradeSol: "0.01", maxOpenPositions: 2, stopLossPct: 15, takeProfitPct: 30, trailingStopPct: 10, dailyLossLimitSol: "0.03" }),
  settings: Object.freeze({ checksPerTick: 4, listingPages: 2 }),
});
export function normalizeSettings(input = {}) {
  const s = { ...defaults.settings, ...(input ?? {}) };
  const unknown = Object.keys(input ?? {}).filter((k) => !Object.hasOwn(defaults.settings, k));
  if (unknown.length) throw new Error(`unknown setting ${unknown.join(", ")} for popcat-scout`);
  const c = Number(s.checksPerTick), p = Number(s.listingPages);
  if (!(Number.isInteger(c) && c >= 1 && c <= 10)) throw new Error("checksPerTick must be 1 to 10 (each check is about a dozen RPC reads)");
  if (!(Number.isInteger(p) && p >= 1 && p <= 5)) throw new Error("listingPages must be 1 to 5 (50 coins a page)");
  return Object.freeze({ checksPerTick: c, listingPages: p });
}

export const tickMs = 5 * 60_000;
export const exitTickMs = 10_000;
const MIN = 60_000, HOUR = 3_600_000;

/** Which listed coins join the queue: cat coins by name or ticker, printable, not banned, under a
 *  day old (graduated or not: one that graduated is bought through Jupiter). Pure. */
export function queueable(coins, { now, known, exclude }) {
  const out = [];
  for (const c of coins) {
    if (known.has(c.mint) || exclude.mints.has(c.mint) || exclude.creators.has(c.creator)) continue;
    if (c.banned || c.nsfw) continue;
    if (now - c.createdMs > THRESHOLDS.MAX_AGE_HOURS * HOUR) continue;
    const cat = detectCat(c);
    if (!cat.isCat || cat.field === "description") continue;
    if (!displaySafe({ name: c.name, symbol: c.symbol }).ok) continue;
    out.push({ mint: c.mint, creator: c.creator, curve: c.curve, name: c.name.slice(0, 40), symbol: c.symbol.slice(0, 16), description: c.description.slice(0, 300),
      metadataUri: c.metadataUri, createdMs: c.createdMs, due: c.createdMs + THRESHOLDS.MIN_AGE_MINUTES * MIN });
  }
  return out;
}

export async function tick(ctx) {
  const { agent, deps } = ctx;
  const settings = normalizeSettings(agent.settings);
  const now = deps.clock();
  const state = ctx.state.get() ?? { queue: {}, seen: {} };
  const ex = ctx.exclusions();
  try {
    const listing = await newestCoins({ http: deps.http, maxPages: settings.listingPages });
    for (const q of queueable(listing.coins, { now, known: new Set([...Object.keys(state.queue), ...Object.keys(state.seen)]), exclude: ex })) state.queue[q.mint] = q;
  } catch (e) { ctx.decide({ action: "hold", reason: `pump.fun's listing could not be read (${e.message})` }); }
  for (const [mint, q] of Object.entries(state.queue)) if (now - q.createdMs > THRESHOLDS.MAX_AGE_HOURS * HOUR) { delete state.queue[mint]; state.seen[mint] = now; }
  for (const [mint, at] of Object.entries(state.seen)) if (now - at > (THRESHOLDS.MAX_AGE_HOURS + 2) * HOUR) delete state.seen[mint];
  const due = Object.values(state.queue).filter((q) => q.due <= now).sort((a, b) => a.createdMs - b.createdMs).slice(0, settings.checksPerTick);
  const flagged = [];
  let bought = false;
  for (const q of due) {
    delete state.queue[q.mint];
    state.seen[q.mint] = now;
    let onchain;
    try { onchain = await gatherOnchain({ rpc: deps.botsRpc, coin: q }); }
    catch (e) { flagged.push(`${q.symbol}: not readable (${String(e.message).slice(0, 60)})`); continue; }
    const creatorLaunches = await creatorLaunchCount({ http: deps.http, creator: q.creator });
    const metadata = await readMetadata({ http: deps.http, uri: q.metadataUri });
    let v;
    try { v = evaluate({ coin: q, onchain, creatorLaunches, metadata, now: deps.clock(), cashcat: { mints: ex.mints, wallets: ex.creators } }); }
    catch (e) { flagged.push(`${q.symbol}: does not decode as a pump.fun coin`); continue; }
    if (!v.pass) { flagged.push(`${q.symbol}: ${v.failed.join(", ")}`); continue; }
    if (bought) { flagged.push(`${q.symbol}: passed, but one buy a tick`); continue; }
    const r = await ctx.buy({ mint: q.mint, symbol: q.symbol, name: q.name, decimals: 6, program: onchain.mintAcc.owner, venue: v.progressPct >= 100 ? "jupiter" : "pumpfun",
      creator: q.creator, askedLamports: ctx.maxPerTradeLamports(), reason: `${q.name} ($${q.symbol}): every one of Popcat's twelve checks passed (${v.stats.holders} holders, top 10 at ${v.stats.top10Pct}%, ${v.stats.curvePct}% of the curve sold)` });
    bought = r.ok === true;
  }
  ctx.state.set(state);
  if (due.length && !bought) ctx.decide({ action: "hold", reason: `checked ${due.length} cat coin(s); none passed every check — ${flagged.slice(0, 4).join("; ")}${flagged.length > 4 ? "; …" : ""}` });
}
