/**
 * STOCK CATS: ONE CAT COIN OF THE OWNER'S OWN FOR EACH xSTOCK, PAIRED ON STONKFUN — THE RULES.
 *
 * CoinMarketCat's tab offers one thing beside the agent: name a cat coin for a tokenised stock
 * StonkFun lists, check it, and launch it on StonkFun (Raydium LaunchLab, StonkFun's platform)
 * from the autopilot wallet, one at a time, by hand, with no dev buy. The stock is only the PAIR:
 * the coin's pool trades against it. A stock cat is not the stock, holds none of it, and is not
 * the company's; everything here exists to keep it from looking otherwise.
 *
 * This file is the pure half: which stocks, what a stock cat may be called, what its coin says,
 * and what the stock's own mint must look like. It names no host (STOCKCAT_HOSTS comes from the
 * bots' verified list), touches no chrome.* API, logs nothing, holds no key and signs nothing. The
 * launch itself — the plan read from StonkFun and proved on chain, the build, the pre-sign check,
 * the simulation, the pin, the two signatures — is CashCat's tab's (src/lib/cashcat-tab.mjs), the
 * one file besides the key file that reaches a mint's signature, and it runs every rule below
 * again at the launch.
 *
 * WHICH STOCKS. The 24 of src/lib/config.mjs STONKFUN_XSTOCKS: the fifteen built-in xStocks and
 * nine more, each on the official product list and listed by StonkFun as launchable and
 * LaunchLab-ready when this was built (every one passed every planner check on 2026-09-25,
 * fixtures/bots/stonkfun/2026-09-25/). Every other quote StonkFun lists is shown as a count with
 * its reason (otherQuotes), never offered.
 *
 * WHAT A STOCK CAT MAY NOT BE CALLED, each a named clause (stockCatRefusals):
 *   pair_unknown        the pair is not one of the 24
 *   pair_terms_missing  its research row is not in src/lib/stock-cat-notes.mjs yet: no rule knows
 *                       its people, mascots or brands, so nothing may be launched against it
 *   pair_term           a term of this pair: its xStock symbol, its root ticker, StonkFun's symbol
 *                       and name for it, every word of three or more letters in its official
 *                       name but "xStock", and the people, mascots and brands its row sources
 *   other_pair          a term of any of the other 23 pairs
 *   pair_ticker         a ticker that starts or ends with this pair's root or symbol, compared as
 *                       letters and digits (BRK.Bx is BRKB), or that holds any pair's root of three
 *                       or more characters
 *   launch_claim        stock, xstock, shares, equity, backed, dividend, collateral, dev buy, no
 *                       dev, fair launch, stealth, renounced, lp burned, locked: a claim about the
 *                       launch or the stock that a stock cat does not make
 *   name_taken          the name or ticker of an earlier stock cat
 * and every rule CashCat's own coins meet: checkProposal (people, brands — with the fix for a
 * capital inside a brand, "SpaceX" — endorsement, tragedy, minors, sex, hate, identity, politics,
 * promises, links, the formats, and "it must be a cat"), Jupiter's verified tickers and the
 * established cat coins (tickerFree), and the site's own record validator, with "cat" as the
 * topic. Then the model's review when a key is saved (cashcat-draft.mjs stockCatReview).
 *
 * WHAT THE COIN SAYS. Its description is its tagline, " — ", and pairDisclosure word for word,
 * which names only the xStock symbol, never the company or fund behind it. "Made with CashCat" is
 * off. The research row's cat facts are for the owner's eyes, labelled "Sourced fact, not an
 * endorsement"; nothing from the row is ever written into a coin.
 */
import { HOSTS } from "../../bots/lib/verified.mjs";
import { FENCES } from "../../bots/cashcat/config.mjs";
import { checkProposal, checkTerms, normalize } from "../../bots/lib/content-rules.mjs";
import { tickerFree } from "../../bots/cashcat/tickers.mjs";
import { siteRefusals } from "../../bots/cashcat/invent.mjs";
import { KITTENS, BACKGROUNDS, TICKER_RE, pickArt } from "../../bots/cashcat/logo-layout.mjs";
import { STONKFUN_XSTOCKS, XSTOCK_AUTHORITIES } from "./config.mjs";
import { STOCK_CAT_NOTES } from "./stock-cat-notes.mjs";

/** The one host stock cats add: StonkFun's public API (its pairs, a pair's pricing, a launch's record). */
export const STOCKCAT_HOSTS = Object.freeze([HOSTS.stonkfun]);

/** The 24 pairs, each with the root ticker the rules read ("BRK.Bx" → "BRK.B"). */
export const STOCK_PAIRS = Object.freeze(STONKFUN_XSTOCKS.map((x) => Object.freeze({ ...x, root: x.symbol.replace(/x$/, "") })));

/**
 * The caps. At most `maxPerDay` launches a UTC day — 2 unless the owner sets 1 to 6 (the bot's
 * own fence, FENCES.maxLaunchesPerDay) — counting every launch from this extension, CashCat's
 * pump.fun coins included; one stock cat per stock, ever; a prepared launch is good for ten
 * minutes and once.
 */
export const STOCKCAT_LIMITS = Object.freeze({ maxPerDay: 2, fence: FENCES.maxLaunchesPerDay, prepareTtlMs: 600_000 });

/** A claim about the launch or the stock that a stock cat never makes (launch_claim). */
export const LAUNCH_CLAIMS = Object.freeze(["stock", "xstock", "share", "equity", "backed", "dividend", "collateral", "dev buy", "no dev", "fair launch", "stealth", "renounced", "lp burned", "locked"]);

/** Words the tab prints, word for word. */
export const STOCKCAT_TEXT = Object.freeze({
  catFact: "Sourced fact, not an endorsement",
  marketCap: "StonkFun's pricing figure, not a forecast",
  issuer: "The issuer holds a permanent delegate and a freeze authority over this stock: it could move or freeze the pool's stock",
  noDevBuy: "No dev buy",
  creatorShare: "StonkFun says it forwards a creator share off chain. Not verified; nothing is claimed.",
  whatItIs: "A stock cat is a cat coin of your own, paired on StonkFun with one tokenised stock (an xStock). The stock is only the pair: the coin is not the stock, holds none of it, and is not the company's.",
});

export class StockCatError extends Error {
  constructor(clause, message, detail = {}) { super(message); this.name = "StockCatError"; this.clause = clause; this.detail = detail; }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const alnum = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export const pairByMint = (mint) => STOCK_PAIRS.find((p) => p.mint === mint) ?? null;

/* ── the research gate ──────────────────────────────────────────────────────────────────── */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nameOf = (e) => (typeof e === "string" ? e : isObject(e) && typeof e.name === "string" ? e.name : null);
const okNames = (list) => Array.isArray(list) && list.every((e) => { const n = nameOf(e); return typeof n === "string" && n.trim().length > 0 && n.length <= 80; });
const okFacts = (list) => Array.isArray(list) && list.every((f) => isObject(f) && ["text", "source", "readAt"].every((k) => typeof f[k] === "string" && f[k].trim().length > 0));

/**
 * The research row for a mint, or null. A row counts only when its every list is there (an empty
 * one is a "none found" that `searchedAt` dates), its date is a real day and its method is said;
 * a mint with two rows has none.
 */
export function noteRow(mint, notes = STOCK_CAT_NOTES) {
  const rows = (Array.isArray(notes) ? notes : []).filter((r) => isObject(r) && r.mint === mint);
  if (rows.length !== 1) return null;
  const r = rows[0];
  if (!okNames(r.people) || !okNames(r.mascots) || !okNames(r.brands) || !okFacts(r.catFacts)) return null;
  if (typeof r.searchedAt !== "string" || !DAY.test(r.searchedAt) || Number.isNaN(Date.parse(`${r.searchedAt}T00:00:00Z`))) return null;
  if (typeof r.method !== "string" || !r.method.trim()) return null;
  return r;
}

/** Every term a coin paired with `pair` may not carry. Without a research row, the terms the
 *  stock's own names give (the row's are added once it exists). */
export function pairTerms(pair, notes = STOCK_CAT_NOTES) {
  const words = pair.name.split(/\s+/).filter((w) => w.toLowerCase() !== "xstock" && normalize(w).replace(/ /g, "").length >= 3);
  const row = noteRow(pair.mint, notes);
  const researched = row ? [...row.people, ...row.mascots, ...row.brands].map(nameOf) : [];
  return [...new Set([pair.symbol, pair.root, pair.stonkfun, pair.stonkfunName, ...words, ...researched].filter(Boolean))];
}

/* ── the rules ──────────────────────────────────────────────────────────────────────────── */

/** A draft of a stock cat, in the shape the rules read. */
export function stockDraft(input = {}, pair) {
  const symbol = clean(input.symbol, 12).replace(/^\$+/, "").toUpperCase();
  const art = pickArt(symbol || "CAT");
  return {
    name: clean(input.name, 40), symbol, tagline: clean(input.tagline, 170),
    kitten: KITTENS.includes(input.kitten) ? input.kitten : art.kitten,
    background: Object.hasOwn(BACKGROUNDS, input.background ?? "") ? input.background : art.background,
    pairMint: pair?.mint ?? String(input.pairMint ?? ""), source: input.source === "suggested" ? "suggested" : "typed",
  };
}

/** A stable fingerprint of what was judged and prepared: the draft, the venue and the pair. */
export const stockDraftKey = (d) => JSON.stringify([d.name, d.symbol, d.tagline, d.kitten, d.background, "stonkfun", d.pairMint]);

function tickerRefusals(symbol, pair) {
  const sym = alnum(symbol);
  const own = [...new Set([alnum(pair.root), alnum(pair.symbol), alnum(pair.stonkfun)])].filter(Boolean);
  const hit = own.find((o) => sym.startsWith(o) || sym.endsWith(o));
  if (hit) return [{ clause: "pair_ticker", term: hit, field: "symbol", message: `pair_ticker: $${sym} starts or ends with ${hit}, ${pair.symbol}'s own ticker` }];
  const any = STOCK_PAIRS.map((p) => alnum(p.root)).filter((r) => r.length >= 3).find((r) => sym.includes(r));
  if (any) return [{ clause: "pair_ticker", term: any, field: "symbol", message: `pair_ticker: $${sym} holds ${any}, the ticker of an xStock` }];
  return [];
}

/**
 * Every refusal a stock cat's draft meets without a model: [{ clause, message, term?, field? }].
 * `earlier` is the stock cats already launched or being launched ({ name, symbol }); `verifiedIndex`
 * is Jupiter's verified list (null refuses the ticker as unverifiable, as it does for CashCat).
 */
export function stockCatRefusals(draft, pair, { notes = STOCK_CAT_NOTES, earlier = [], verifiedIndex = null } = {}) {
  if (!pair || !pairByMint(pair.mint)) return [{ clause: "pair_unknown", message: "pair_unknown: that stock is not one a stock cat may be paired with" }];
  const out = [];
  const add = (clause, v, what) => out.push({ clause, term: v.term, field: v.field, message: `${clause}: "${v.term}" in the ${v.field === "symbol" ? "ticker" : v.field}${what ? ` (${what})` : ""}` });
  if (!noteRow(pair.mint, notes)) out.push({ clause: "pair_terms_missing", message: `pair_terms_missing: ${pair.symbol} has no research row yet (its people, mascots and brands, sourced), so no stock cat may be paired with it` });
  const fields = { name: draft.name, symbol: draft.symbol, tagline: draft.tagline };
  const c = checkProposal({ ...fields, trend: "cat" });
  for (const v of c.violations) add(v.rule, v);
  if (!KITTENS.includes(draft.kitten) || !Object.hasOwn(BACKGROUNDS, draft.background)) out.push({ clause: "art", message: "art: an unknown kitten or background" });
  for (const reason of tickerFree(verifiedIndex, { name: draft.name, symbol: draft.symbol }).reasons) out.push({ clause: "ticker_taken", message: `ticker_taken: ${reason}` });
  for (const reason of siteRefusals({ name: draft.name, symbol: draft.symbol, tagline: draft.tagline, trend: { title: "cat", source: "google-trends" } })) out.push({ clause: "site", message: `site: ${reason}` });
  for (const v of checkTerms(fields, { pair_term: pairTerms(pair, notes) }).violations) add("pair_term", v, `it names ${pair.symbol}`);
  const others = STOCK_PAIRS.filter((p) => p.mint !== pair.mint).flatMap((p) => pairTerms(p, notes));
  for (const v of checkTerms(fields, { other_pair: others }).violations) add("other_pair", v, "it names another xStock");
  if (TICKER_RE.test(draft.symbol)) out.push(...tickerRefusals(draft.symbol, pair));
  for (const v of checkTerms(fields, { launch_claim: LAUNCH_CLAIMS }).violations) add("launch_claim", v, "a stock cat claims nothing about the stock or its launch");
  const taken = (earlier ?? []).find((e) => (e?.name && normalize(e.name) === normalize(draft.name)) || (e?.symbol && alnum(e.symbol) === alnum(draft.symbol)));
  if (taken) out.push({ clause: "name_taken", message: `name_taken: ${taken.name} ($${taken.symbol}) is an earlier stock cat's` });
  return out;
}

/* ── suggestions: no model, only names that pass ────────────────────────────────────────── */

const KITTEN_WORDS = Object.freeze({ black: "Black", calico: "Calico", ginger: "Ginger", greytabby: "Grey Tabby", siamese: "Siamese", sphynx: "Sphynx", tuxedo: "Tuxedo", white: "White" });
const cap = (w) => w[0].toUpperCase() + w.slice(1);
const article = (w) => (/^[aeiou]/i.test(w) ? "an" : "a");

/** The suggestion for one kitten on one background: "<Background> <Kitten> Cat", the first four
 *  letters of the background and three of the kitten, and one fixed line. */
export function suggestionFor(kitten, background, pair) {
  const k = KITTEN_WORDS[kitten];
  const tagline = `${cap(article(k))} ${k.toLowerCase()} cat on ${article(background)} ${background} sign.`;
  return { name: `${cap(background)} ${k} Cat`, symbol: `${background.slice(0, 4)}${kitten.slice(0, 3)}`.toUpperCase(), tagline, kitten, background, pairMint: pair.mint, source: "suggested" };
}

/** A seed from the pair's mint, so each pair's suggestions come in their own, repeatable order. */
function seeded(text) {
  let h = 2166136261 >>> 0;
  for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Up to `count` suggestions for a pair, in an order seeded by its mint, each passing every rule. */
export function suggestNames(pair, { notes = STOCK_CAT_NOTES, earlier = [], verifiedIndex = null, count = 6 } = {}) {
  const all = KITTENS.flatMap((k) => Object.keys(BACKGROUNDS).map((b) => [k, b]));
  const rand = seeded(pair.mint);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  const out = [];
  for (const [k, b] of all) {
    const s = suggestionFor(k, b, pair);
    if (!stockCatRefusals(s, pair, { notes, earlier, verifiedIndex }).length) out.push(s);
    if (out.length >= count) break;
  }
  return out;
}

/* ── what the coin says ─────────────────────────────────────────────────────────────────── */

/** The disclosure every stock cat carries, word for word: the xStock's symbol, never its company. */
export function pairDisclosure(pair) {
  const o = pair.symbol;
  return `Not financial advice. A cat coin paired on StonkFun with ${o}, a tokenised stock: it is not the stock, and is not affiliated with, endorsed by or connected to the company or fund ${o} tracks, ${o}'s issuer, or StonkFun.`;
}

/* ── the stock's own mint ───────────────────────────────────────────────────────────────── */

/**
 * The stock's mint, as vendor/executor/token2022.mjs describeMint reads it from the account the
 * plan was proved against, held to what all 24 read on 2026-09-25: not paused, new accounts not
 * frozen, no transfer fee, no transfer hook program, its own symbol the official one, and the
 * issuer's keys in every seat (XSTOCK_AUTHORITIES). Returns [{ clause, message }].
 */
export function quoteRefusals(d, pair) {
  const out = [];
  const add = (clause, message) => out.push({ clause, message: `${clause}: ${message}` });
  if (d.paused) add("quote_paused", `${pair.symbol} is paused by its issuer`);
  if (d.defaultAccountState !== null && d.defaultAccountState !== 1) add("quote_default_frozen", `${pair.symbol} opens new token accounts frozen, the pool's among them`);
  if (d.extensionNames.includes("TransferFeeConfig")) add("quote_transfer_fee", `${pair.symbol} carries a transfer fee`);
  if (d.transferHookProgram !== null) add("quote_hook", `${pair.symbol} calls a transfer hook program (${d.transferHookProgram}) on every transfer`);
  if (d.metadataSymbol !== pair.symbol) add("quote_symbol", `the mint's own symbol is "${d.metadataSymbol}", not ${pair.symbol}`);
  const seats = [["mint authority", d.mintAuthority, XSTOCK_AUTHORITIES.mint], ["freeze authority", d.freezeAuthority, XSTOCK_AUTHORITIES.freeze],
    ["pause authority", d.pausableAuthority, XSTOCK_AUTHORITIES.freeze], ["permanent delegate", d.permanentDelegate, XSTOCK_AUTHORITIES.permanentDelegate]];
  const wrong = seats.filter(([, got, want]) => got !== want);
  if (wrong.length) add("quote_issuer", `${wrong.map(([seat, got]) => `its ${seat} is ${got ?? "none"}`).join("; ")}: not the xStock issuer's key${wrong.length === 1 ? "" : "s"}`);
  return out;
}

/* ── what StonkFun lists besides ────────────────────────────────────────────────────────── */

const OTHER_REASONS = Object.freeze({
  xstock: "an xStock not on the official product list this build checked",
  backpack: "Backpack's tokens, stocks and crypto alike: no official issuer list and no issuer allow-list here",
  prestock: "prestocks carry a transfer fee",
  tessera: "tessera tokens carry a transfer fee",
});
/** The quotes StonkFun's /pairs answer lists that are not one of the 24, counted by kind, each
 *  with why it is not offered. Counts only: none is ever shown as a pair. */
export function otherQuotes(pairsAnswer) {
  const rows = Array.isArray(pairsAnswer?.data?.pairs) ? pairsAnswer.data.pairs : [];
  const counts = new Map();
  for (const p of rows) {
    if (!isObject(p) || pairByMint(p.mint)) continue;
    const k = typeof p.category === "string" && /^[a-z-]{1,20}$/.test(p.category) ? p.category : "other";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count, reason: OTHER_REASONS[category] ?? "not a tokenised stock with an official issuer list" }));
}
