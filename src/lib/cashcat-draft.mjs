/**
 * CASHCAT, IN YOUR BROWSER: DRAFTING A CAT COIN OF YOUR OWN, AND EVERY WAY A DRAFT IS REFUSED.
 *
 * Two ways to a draft, one set of rules:
 *
 *   · YOU TYPE IT: a name, a ticker, one line, the topic it riffs on, and (optionally) the kitten
 *     and the background of its logo.
 *   · CASHCAT DRAFTS IT FROM A TREND: bots/cashcat/trends.mjs reads what is trending (Google
 *     Trends' US feed and CoinGecko's trending categories, each topic through checkTrend first),
 *     and bots/cashcat/invent.mjs asks the model, through YOUR Anthropic key (the agent's brain,
 *     which alone holds it) and the model picked at run time from GET /v1/models, to propose one
 *     coin and then, as a separate reviewer, to refuse anything that breaks the rules.
 *
 * Every draft, either way, passes the bots' own rules before it can be launched:
 *   checkTrend (the topic: people by the long given-name list, brands, tragedy, minors, sex, hate,
 *   politics, links), checkProposal (the name, ticker and line), the Jupiter verified-token and
 *   established-cat-coin ticker check (bots/cashcat/tickers.mjs), the site's own record validator,
 *   and — whenever an API key is saved — the model review (REVIEW_TOOL). A trend draft needs the
 *   key; a draft you type is reviewed by the model when a key is saved and by the rules alone when
 *   none is. Any refusal is named. No model identifier is written here or anywhere in the repository.
 *
 * Everything is injected (the http client, the model adapter, the clock); this file touches no
 * chrome.* API and holds no key.
 */
import { checkTrend } from "../../bots/lib/content-rules.mjs";
import { HOSTS } from "../../bots/lib/verified.mjs";
import { deterministicRefusals, validateReview, inventCoin, REVIEW_TOOL, RULES_TEXT } from "../../bots/cashcat/invent.mjs";
import { readTrends } from "../../bots/cashcat/trends.mjs";
import { loadVerifiedIndex } from "../../bots/cashcat/tickers.mjs";
import { KITTENS, BACKGROUNDS, pickArt, TICKER_RE } from "../../bots/cashcat/logo-layout.mjs";
import { stockCatRefusals, pairTerms, STOCK_PAIRS } from "./stockcats.mjs";
import { STOCK_CAT_NOTES } from "./stock-cat-notes.mjs";

/** The hosts drafting calls: the two trend sources and Jupiter's verified list. */
export const DRAFT_HOSTS = Object.freeze([HOSTS.googleTrends, HOSTS.coingecko, HOSTS.jupiter]);

/** Who is asking, in the model's two system prompts: someone drafting a coin of their own. */
export const USER_PERSONA = Object.freeze({
  propose: "You help one person draft one small, playful memecoin of their own: a cat's take on something trending. "
    + "It is their coin, launched from their own wallet, and its description says it is not affiliated with the topic and not financial advice.",
  review: "You are a strict content reviewer for a memecoin someone is about to launch. Refuse anything that breaks a rule or comes close. When in doubt, refuse.",
});

/** Jupiter's verified list is about 5 MB: it is read once an hour at most. */
export const VERIFIED_TTL_MS = 60 * 60_000;

export class DraftError extends Error {
  constructor(clause, message, detail = {}) { super(message); this.name = "DraftError"; this.clause = clause; this.detail = detail; }
}

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * A draft typed by the user, in the shape the rules read. The ticker is upper-cased and loses a
 * leading "$"; a kitten or background not chosen is picked from the ticker (stable per ticker).
 * Nothing is refused here that the rules would refuse: that is reviewDraft's job, by name.
 */
export function typedDraft(input = {}) {
  const symbol = clean(input.symbol, 12).replace(/^\$+/, "").toUpperCase();
  const art = pickArt(symbol || "CAT");
  const kitten = KITTENS.includes(input.kitten) ? input.kitten : art.kitten;
  const background = Object.hasOwn(BACKGROUNDS, input.background ?? "") ? input.background : art.background;
  return {
    name: clean(input.name, 40), symbol, tagline: clean(input.tagline, 170), topic: clean(input.topic, 80),
    kitten, background, source: "typed", news: [],
  };
}

/** A proposal from invent.mjs, in the draft's shape. */
function fromInvention(coin) {
  return { name: coin.name, symbol: coin.symbol, tagline: coin.tagline, topic: coin.trend.title, kitten: coin.kitten, background: coin.background,
    source: coin.trend.source, news: (coin.trend.news ?? []).slice(0, 3) };
}

/** The draft as invent.mjs's rules read a coin: its topic is the "trend" it riffs on. The
 *  record validator needs a trend source; for a typed topic the words are what it judges. */
const asCoin = (d) => ({ name: d.name, symbol: d.symbol, tagline: d.tagline, kitten: d.kitten, background: d.background,
  trend: { title: d.topic, source: d.source === "coingecko" ? "coingecko" : "google-trends", news: d.news ?? [] } });

/** A stable fingerprint of what the rules and the reviewer judged, so a changed draft is judged again. */
export const draftKey = (d) => JSON.stringify([d.name, d.symbol, d.tagline, d.topic, d.kitten, d.background]);

/**
 * Every refusal a draft meets that needs no model: the topic's trend check, the proposal rules,
 * the verified tickers and established cat coins, the site's record validator, the formats.
 */
export function ruleRefusals(draft, verifiedIndex) {
  const out = [];
  if (!draft.topic || draft.topic.length < 3) out.push("topic: name the topic the coin riffs on (it is written into its disclosure)");
  else {
    const t = checkTrend({ title: draft.topic, news: draft.news ?? [] });
    for (const v of t.violations) out.push(`topic, ${v.rule}: "${v.term}"${v.field !== "trend" ? ` (in ${v.field})` : ""}`);
  }
  if (!TICKER_RE.test(draft.symbol)) out.push("ticker_format: 2 to 10 of A-Z and 0-9");
  if (!KITTENS.includes(draft.kitten)) out.push("kitten: unknown kitten");
  if (!Object.hasOwn(BACKGROUNDS, draft.background)) out.push("background: unknown background");
  out.push(...deterministicRefusals(asCoin(draft), verifiedIndex));
  return [...new Set(out)];
}

/** The model's review of one draft, held to REVIEW_TOOL's format. */
export async function modelReview(draft, model) {
  const r = await model.callTool({
    tool: REVIEW_TOOL,
    system: USER_PERSONA.review + "\n\n" + RULES_TEXT,
    user: `Proposed coin:\n${JSON.stringify({ name: draft.name, ticker: draft.symbol, tagline: draft.tagline, riffs_on: draft.topic, headlines_about_that_topic: (draft.news ?? []).slice(0, 3) }, null, 1)}\n\nReview it with ${REVIEW_TOOL.name}.`,
  });
  return validateReview(r);
}

/** What the reviewer is told a stock cat must not do, on top of RULES_TEXT. */
export const STOCK_CAT_RULES_TEXT = [
  "This coin is a STOCK CAT: a cat coin paired on a launchpad with one tokenised stock, named in paired_with. The stock is only its trading pair.",
  "It must NOT reference the company or fund behind that stock, or any other listed stock's: not their names, tickers, people, mascots, products or brands (must_not_reference lists them);",
  "- claim or suggest it is the stock, holds it, is backed by it, pays dividends, or is endorsed by the company, the stock's issuer or the launchpad;",
  "- say anything about how it is launched (a dev buy, a fair or stealth launch, burned or locked liquidity, renounced authorities).",
].join("\n");

/**
 * The model's review of a stock cat, held to REVIEW_TOOL's format. The model is shown the coin's
 * words, the xStock symbol it is paired with and every term it must not reference — never the
 * research row's cat facts, which are for the owner's eyes only.
 */
export async function stockCatReview(draft, pair, model, { notes = STOCK_CAT_NOTES } = {}) {
  const mustNot = [...new Set(STOCK_PAIRS.flatMap((p) => pairTerms(p, notes)))];
  const r = await model.callTool({
    tool: REVIEW_TOOL,
    system: USER_PERSONA.review + "\n\n" + RULES_TEXT + "\n\n" + STOCK_CAT_RULES_TEXT,
    user: `Proposed coin:\n${JSON.stringify({ name: draft.name, ticker: draft.symbol, tagline: draft.tagline, paired_with: pair.symbol, must_not_reference: mustNot }, null, 1)}\n\nReview it with ${REVIEW_TOOL.name}.`,
  });
  return validateReview(r);
}

/**
 * The drafting desk. `http` is the bots' client allowed the DRAFT_HOSTS; `model()` returns the
 * adapter { hasKey, callTool } for this call (the brain's callTool with CashCat's model choice).
 */
export function createDraftDesk({ http, model, clock = () => Date.now() } = {}) {
  let verified = null;   // { at, index }
  async function verifiedIndex() {
    if (verified && clock() - verified.at < VERIFIED_TTL_MS) return verified.index;
    try { verified = { at: clock(), index: await loadVerifiedIndex(http) }; return verified.index; }
    catch { return null; }   // tickerFree then refuses: an unverifiable ticker is not a free one
  }

  /**
   * Judge a draft: the rules always, and the model review when a key is saved (required when
   * `requireModel`; not asked with `skipModel`, when its approval of these exact words is on
   * file). Returns { ok, draft, refusals[], reviewed, reviewedBy }.
   */
  async function review(draft, { requireModel = false, skipModel = false } = {}) {
    const m = skipModel ? null : await model();
    const refusals = ruleRefusals(draft, await verifiedIndex());
    let reviewed = false;
    if (!refusals.length && !skipModel) {
      if (m?.hasKey) {
        let r;
        try { r = await modelReview(draft, m); }
        catch (e) { return { ok: false, draft, refusals: [`model review: the model could not be asked (${e?.clause ?? "error"}): ${e?.message ?? e}`], reviewed: false }; }
        if (!r.approve) refusals.push(`model review: ${r.why ?? "refused"}${r.rules?.length ? ` (${r.rules.join(", ")})` : ""}`);
        else reviewed = true;
      } else if (requireModel) refusals.push("model review: no API key is saved, and this draft needs the model's review");
    }
    return { ok: refusals.length === 0, draft, refusals, reviewed, reviewedBy: reviewed ? "the rules and the model" : "the rules" };
  }

  /**
   * CashCat drafts one coin from what is trending (the key is required). Returns
   * { ok, draft?, refusals[], attempts[], trends: { usable, dropped, failed } }.
   */
  async function fromTrend() {
    const m = await model();
    if (!m?.hasKey) throw new DraftError("no_api_key", "drafting from a trend needs your Anthropic API key: save it in Options → Agent");
    const trends = await readTrends({ http });
    const index = await verifiedIndex();
    const invention = await inventCoin({ model: m, trends: trends.usable, verifiedIndex: index, requireModel: true, persona: USER_PERSONA });
    const summary = { usable: trends.usable.length, dropped: trends.dropped.length, failed: trends.failed.map((f) => f.source) };
    if (!invention.coin) return { ok: false, refusals: [invention.why], attempts: invention.attempts, trends: summary };
    const draft = fromInvention(invention.coin);
    /* invent.mjs already ran the rules and the review; the topic's own trend check runs here too,
       the same one every draft passes. */
    const again = ruleRefusals(draft, index);
    return { ok: again.length === 0 && invention.reviewed === true, draft, refusals: again, reviewed: invention.reviewed === true, attempts: invention.attempts, trends: summary };
  }

  /**
   * Judge a stock cat: its rules (stockcats.mjs stockCatRefusals, with Jupiter's verified list)
   * always, and the model's review (stockCatReview) when a key is saved, as for a typed draft.
   * Returns { ok, draft, refusals[] (strings), clauses[], reviewed, reviewedBy }.
   */
  async function reviewStock(draft, pair, { notes = STOCK_CAT_NOTES, earlier = [], skipModel = false } = {}) {
    const found = stockCatRefusals(draft, pair, { notes, earlier, verifiedIndex: await verifiedIndex() });
    const refusals = found.map((f) => f.message), clauses = found.map((f) => f.clause);
    let reviewed = false;
    if (!refusals.length && !skipModel) {
      const m = await model();
      if (m?.hasKey) {
        let r;
        try { r = await stockCatReview(draft, pair, m, { notes }); }
        catch (e) { return { ok: false, draft, refusals: [`model review: the model could not be asked (${e?.clause ?? "error"}): ${e?.message ?? e}`], clauses: ["model_review"], reviewed: false }; }
        if (!r.approve) { refusals.push(`model review: ${r.why ?? "refused"}${r.rules?.length ? ` (${r.rules.join(", ")})` : ""}`); clauses.push("model_review"); }
        else reviewed = true;
      }
    }
    return { ok: refusals.length === 0, draft, refusals, clauses, reviewed, reviewedBy: reviewed ? "the rules and the model" : "the rules" };
  }

  return Object.freeze({ review, fromTrend, verifiedIndex, reviewStock });
}
