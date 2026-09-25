/**
 * INVENTING A COIN: A CAT-THEMED TAKE ON SOMETHING TRENDING, AND EVERY WAY IT CAN BE REFUSED.
 *
 * 1. The model (the owner's key, chosen at run time) is shown the usable trends, each with its
 *    news headlines, and proposes one coin through the tool `propose_coin`: the trend it riffs
 *    on (exactly as listed), a name, a ticker, a one-line tagline, a kitten and a background.
 *    It may answer skip: true when nothing listed can be riffed on safely.
 * 2. The proposal is held to the tool's format exactly (a field the format lacks refuses it).
 * 3. The deterministic rules (content-rules.mjs checkProposal): people, brands, endorsement,
 *    tragedy, minors, sex, hate, financial promises, the ticker format, and "is it a cat".
 * 4. The ticker and the name against Jupiter's verified tokens and the established cat coins,
 *    and the name, ticker, tagline and trend against the site's own validator
 *    (site/assets/launches.js): a coin whose record the floor would refuse is never launched.
 * 5. A SECOND, separate model call reviews the proposal as a strict content reviewer, through
 *    the tool `review_coin`, and must answer approve.
 * Any refusal is named. CashCat then asks once more with the refusal in hand and that trend
 * struck off; a second refusal ends the run with no launch.
 *
 * With no API key there is no model: a dry run then makes a plain, template coin from the
 * first usable trend so the rest of the pipeline can be exercised, and says that a live
 * launch would refuse it (the model review is required, rule 5).
 */
import bs58 from "bs58";
import { checkProposal } from "../lib/content-rules.mjs";
import { tickerFree } from "./tickers.mjs";
import { KITTENS, BACKGROUNDS } from "./logo-layout.mjs";
import { ModelError } from "../lib/model.mjs";
import { WSOL_MINT } from "../lib/verified.mjs";
import { validateLaunches } from "../../site/assets/launches.js";

export const MAX_ATTEMPTS = 2;

export const PROPOSE_TOOL = Object.freeze({
  name: "propose_coin",
  description: "Propose one cat-themed memecoin riffing on ONE of the listed trends, or skip when none can be riffed on safely.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["skip", "trend", "name", "symbol", "tagline", "kitten", "background"],
    properties: {
      skip: { type: "boolean", description: "true when no listed trend can be turned into a safe, cat-themed coin. Then the other fields may be empty strings." },
      trend: { type: "string", description: "The trend's title, copied exactly as listed." },
      name: { type: "string", description: "The coin's name, 3 to 32 characters. It must contain a cat word (cat, kitty, kitten, meow, neko, purr…)." },
      symbol: { type: "string", description: "The ticker: 2 to 10 characters, A-Z and 0-9 only, no $." },
      tagline: { type: "string", description: "One playful line, 10 to 160 characters, about the cat and the topic. No promises, no prices." },
      kitten: { type: "string", enum: [...KITTENS] },
      background: { type: "string", enum: Object.keys(BACKGROUNDS) },
    },
  },
});

export const REVIEW_RULES = Object.freeze(["real_person", "brand_or_trademark", "endorsement_or_official_claim", "tragedy_or_violence", "minors", "sexual", "hate", "copies_existing_token", "financial_promise", "not_cat_themed", "other"]);

export const REVIEW_TOOL = Object.freeze({
  name: "review_coin",
  description: "Approve or refuse a proposed memecoin under the content rules.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "rules", "reason"],
    properties: {
      verdict: { type: "string", enum: ["approve", "refuse"] },
      rules: { type: "array", items: { type: "string", enum: [...REVIEW_RULES] }, description: "Every rule the coin breaks; empty when approved." },
      reason: { type: "string", description: "One or two sentences." },
    },
  },
});

export const RULES_TEXT = [
  "The coin must NOT:",
  "- name, depict or allude to any real person, living or dead (politicians, celebrities, founders, athletes, influencers, their nicknames);",
  "- use a brand, trademark, company, product, franchise, fictional character, sports team, or another crypto token's name, or imply an endorsement or partnership;",
  "- touch disasters, deaths, violence, war, crime, accidents, illness or any tragedy, however indirectly;",
  "- involve minors in any way, be sexual, or carry hate, slurs or extremist references;",
  "- claim or suggest it is official, verified, real, authorised, or the coin of anything;",
  "- copy the name or ticker of an existing token;",
  "- promise returns, profit, prices or anything financial.",
  "It MUST be cat-themed: a cat's take on the topic, and its name must contain a cat word.",
].join("\n");

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The proposal, held to the tool's format exactly. */
export function validateProposal(input, trends) {
  if (!isObject(input)) return { ok: false, why: "the proposal is not an object" };
  const keys = PROPOSE_TOOL.input_schema.required;
  const extra = Object.keys(input).filter((k) => !keys.includes(k));
  if (extra.length) return { ok: false, why: `the proposal carries ${extra.join(", ")}, which the format does not have` };
  if (typeof input.skip !== "boolean") return { ok: false, why: "skip must be true or false" };
  if (input.skip) return { ok: true, skip: true };
  for (const k of ["trend", "name", "symbol", "tagline", "kitten", "background"]) if (typeof input[k] !== "string") return { ok: false, why: `${k} must be text` };
  const trend = trends.find((t) => t.title === input.trend);
  if (!trend) return { ok: false, why: "the trend is not one of those listed" };
  if (!KITTENS.includes(input.kitten)) return { ok: false, why: "unknown kitten" };
  if (!Object.hasOwn(BACKGROUNDS, input.background)) return { ok: false, why: "unknown background" };
  return { ok: true, coin: { trend, name: input.name.trim(), symbol: input.symbol.trim(), tagline: input.tagline.replace(/\s+/g, " ").trim(), kitten: input.kitten, background: input.background } };
}

export function validateReview(input) {
  if (!isObject(input)) return { approve: false, why: "the review is not an object" };
  const extra = Object.keys(input).filter((k) => !["verdict", "rules", "reason"].includes(k));
  if (extra.length) return { approve: false, why: "the review carries fields the format does not have" };
  if (input.verdict !== "approve" && input.verdict !== "refuse") return { approve: false, why: "the review has no verdict" };
  if (!Array.isArray(input.rules) || typeof input.reason !== "string") return { approve: false, why: "the review's rules are not a list or its reason is not text" };
  const rules = input.rules.filter((r) => REVIEW_RULES.includes(r));
  const reason = input.reason.slice(0, 300);
  /* An "approve" that names any rule at all, listed or not, is not an approval. */
  if (input.verdict === "approve" && input.rules.length === 0) return { approve: true, rules, reason };
  return { approve: false, rules, why: reason || "refused" };
}

const trendLines = (trends) => trends.map((t, i) => `${i + 1}. ${JSON.stringify(t.title)} (${t.source}${t.traffic ? `, ~${t.traffic} searches` : ""})`
  + (t.news.length ? `\n   headlines: ${t.news.slice(0, 3).map((n) => JSON.stringify(n)).join("; ")}` : "")).join("\n");

/* A launch record with placeholder addresses, to ask the site's validator about a coin's words
   before there is a launch: a record the floor would refuse must stop the coin, not follow it. */
const SAMPLE_RECORD = Object.freeze({ time: "2026-01-01T00:00:00Z", venue: "pumpfun", mint: WSOL_MINT, creator: WSOL_MINT, tx: bs58.encode(Buffer.alloc(64, 1)),
  quote: { symbol: "SOL", mint: WSOL_MINT }, devBuy: { sol: 0 }, costSol: 0, kitten: KITTENS[0] });
export function siteRefusals(coin) {
  const v = validateLaunches({ launches: [{ ...SAMPLE_RECORD, name: coin.name, symbol: coin.symbol, tagline: coin.tagline, trend: { title: coin.trend.title, source: coin.trend.source } }] });
  return v.problems.map((p) => `the site would refuse it: ${p.replace(/^.*? skipped: /, "")}`);
}

/** Deterministic every step but the model: the refusals a proposal can meet. */
export function deterministicRefusals(coin, verifiedIndex) {
  const out = [];
  const c = checkProposal({ name: coin.name, symbol: coin.symbol, tagline: coin.tagline, trend: coin.trend.title });
  for (const v of c.violations) out.push(`${v.rule}: "${v.term}" in the ${v.field}`);
  const t = tickerFree(verifiedIndex, coin);
  out.push(...t.reasons);
  out.push(...siteRefusals(coin));
  return out;
}

/** Who is asking, in the two system prompts: CashCat itself (the bot), or someone drafting a coin
 *  of their own in the extension. The rules text after it is the same for both. */
export const CASHCAT_PERSONA = Object.freeze({
  propose: "You are CashCat, the Cat Intelligence Agency's auto-launcher. You invent one small, playful memecoin: a cat's take on something trending. "
    + "Every coin is launched automatically with a disclosure that it is a bot's riff, unaffiliated, and not financial advice.",
  review: "You are a strict content reviewer for an automated memecoin launcher. Refuse anything that breaks a rule or comes close. When in doubt, refuse.",
});

/**
 * Invent one coin. Returns { coin, attempts[], reviewed } or { coin: null, attempts[] }.
 * `requireModel` (live) refuses the template fallback. `persona` names who is asking (above).
 */
export async function inventCoin({ model, trends, verifiedIndex, requireModel, log, persona = CASHCAT_PERSONA }) {
  const attempts = [];
  if (!trends.length) return { coin: null, attempts, why: "no usable trend" };
  if (!model?.hasKey) {
    if (requireModel) return { coin: null, attempts, why: "no ANTHROPIC_API_KEY: a live launch needs the model's proposal and review" };
    const t = trends[0];
    const word = (t.title.match(/[A-Za-z]{3,}/g) ?? ["Trend"])[0];
    const cap = word[0].toUpperCase() + word.slice(1).toLowerCase();
    const coin = { trend: t, name: `${cap} Cat`.slice(0, 32), symbol: `${word.slice(0, 5).toUpperCase()}CAT`.replace(/[^A-Z0-9]/g, "").slice(0, 10),
      tagline: `A cat's take on ${t.title}, found trending today.`, kitten: "ginger", background: "violet", template: true };
    const refusals = deterministicRefusals(coin, verifiedIndex);
    attempts.push({ source: "template (no model)", coin: { name: coin.name, symbol: coin.symbol }, refusals });
    return refusals.length ? { coin: null, attempts, why: "the template coin was refused" } : { coin, attempts, reviewed: false };
  }
  let pool = trends.slice(0, 20);
  let feedback = "";
  for (let i = 0; i < MAX_ATTEMPTS && pool.length; i++) {
    let input;
    try {
      input = await model.callTool({
        tool: PROPOSE_TOOL,
        system: persona.propose + "\n\n" + RULES_TEXT,
        user: `Trending now:\n${trendLines(pool)}\n\n${feedback}Propose one coin with ${PROPOSE_TOOL.name}, or skip.`,
      });
    } catch (e) {
      attempts.push({ source: "model", error: e instanceof ModelError ? e.clause : "error" });
      return { coin: null, attempts, why: `the model failed: ${e.message}` };
    }
    const v = validateProposal(input, pool);
    if (!v.ok) { attempts.push({ source: "model", refusals: [v.why] }); feedback = `Your last answer was refused: ${v.why}.\n\n`; continue; }
    if (v.skip) { attempts.push({ source: "model", skip: true }); return { coin: null, attempts, why: "the model found no trend it could riff on safely" }; }
    const coin = v.coin;
    const refusals = deterministicRefusals(coin, verifiedIndex);
    if (!refusals.length) {
      let review;
      try {
        review = validateReview(await model.callTool({
          tool: REVIEW_TOOL,
          system: persona.review + "\n\n" + RULES_TEXT,
          user: `Proposed coin:\n${JSON.stringify({ name: coin.name, ticker: coin.symbol, tagline: coin.tagline, riffs_on: coin.trend.title, headlines_about_that_topic: coin.trend.news.slice(0, 3) }, null, 1)}\n\nReview it with ${REVIEW_TOOL.name}.`,
        }));
      } catch (e) {
        attempts.push({ source: "model review", error: e instanceof ModelError ? e.clause : "error" });
        return { coin: null, attempts, why: `the model review failed: ${e.message}` };
      }
      if (review.approve) { attempts.push({ source: "model", coin: { name: coin.name, symbol: coin.symbol }, review: "approved" }); return { coin, attempts, reviewed: true }; }
      refusals.push(`model review: ${review.why}${review.rules?.length ? ` (${review.rules.join(", ")})` : ""}`);
    }
    attempts.push({ source: "model", coin: { name: coin.name, symbol: coin.symbol, trend: coin.trend.title }, refusals });
    log?.info(`proposal ${coin.name} ($${coin.symbol}) refused: ${refusals.join("; ")}`);
    pool = pool.filter((t) => t.title !== coin.trend.title);
    feedback = `Your last proposal (${coin.name}, $${coin.symbol}, on "${coin.trend.title}") was refused: ${refusals.join("; ")}. That trend is struck off.\n\n`;
  }
  return { coin: null, attempts, why: "every proposal was refused" };
}
