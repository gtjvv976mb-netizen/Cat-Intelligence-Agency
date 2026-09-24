/**
 * WHAT IS TRENDING: the topics CashCat may riff on, from keyless sources verified live on
 * 2026-09-24 (bots/lib/verified.mjs):
 *
 *   Google Trends daily RSS   https://trends.google.com/trending/rss?geo=US — each item is a
 *                             search term with its approximate traffic and the news headlines
 *                             that explain it. The headlines matter: "hawker hunter" reads
 *                             harmless until they say a jet went into the sea.
 *   CoinGecko trending        https://api.coingecko.com/api/v3/search/trending — the trending
 *                             categories only (e.g. "Meme", "AI"). Trending COINS are not
 *                             offered as topics: a cat coin named after a live coin is a
 *                             copycat, which is exactly what Popcat flags.
 *
 * pump.fun's "metas" endpoint answered 404 when this was built, so it is not a source.
 * Every topic then goes through checkTrend (content-rules.mjs) before the model sees it.
 * Both hosts are paced and backed off by http.mjs.
 */
import { URLS } from "../lib/verified.mjs";
import { checkTrend } from "../lib/content-rules.mjs";

const decodeXml = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
  .replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? decodeXml(m[1]) : ""; };
const tags = (block, name) => [...block.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))].map((m) => decodeXml(m[1]));

/** Google Trends RSS → [{ title, source, traffic, news[] }]. */
export function parseGoogleTrends(xml) {
  const items = [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return items.map((it) => ({
    title: tag(it, "title").slice(0, 80),
    source: "google-trends",
    traffic: tag(it, "ht:approx_traffic") || null,
    news: tags(it, "ht:news_item_title").slice(0, 6).map((t) => t.slice(0, 200)),
  })).filter((t) => t.title);
}

/** CoinGecko trending → its categories as topics (never its coins). */
export function parseCoingeckoTrending(body) {
  const cats = Array.isArray(body?.categories) ? body.categories : [];
  return cats.map((c) => ({ title: String(c?.name ?? "").slice(0, 80), source: "coingecko", traffic: null, news: [] })).filter((t) => t.title);
}

/**
 * Read both sources (a source that fails is skipped and named), drop what the rules refuse,
 * and return { usable, dropped, failed }.
 */
export async function readTrends({ http, geo = "US", log = null }) {
  const all = [], failed = [];
  try { all.push(...parseGoogleTrends(await http.text(URLS.googleTrendsRss(geo)))); }
  catch (e) { failed.push({ source: "google-trends", why: e.message }); }
  try { all.push(...parseCoingeckoTrending(await http.json(URLS.coingeckoTrending))); }
  catch (e) { failed.push({ source: "coingecko", why: e.message }); }
  const usable = [], dropped = [];
  const seen = new Set();
  for (const t of all) {
    const k = t.title.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const v = checkTrend(t);
    if (v.ok) usable.push(t); else dropped.push({ title: t.title, source: t.source, why: v.violations.map((x) => `${x.rule} (${x.term})`).join(", ") });
  }
  log?.info(`trends: ${usable.length} usable, ${dropped.length} dropped by the rules, ${failed.length} source(s) failed`);
  return { usable, dropped, failed };
}
