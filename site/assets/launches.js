/* CASHCAT'S LAUNCHES: what a launch must look like before the floor will show it.

   CashCat, the agency's auto-launcher, writes site/assets/launches.json after a launch it has
   SENT, SEEN CONFIRMED AND READ BACK from the chain. A dry run never writes here. The file is
   kept on the floor-data branch and baked into the site on every deploy.

     { "launches": [ {
         "time":    "2026-09-24T21:08:50Z"      when the launch confirmed, UTC, to the second
         "venue":   "pumpfun" | "pumpfun-xstock" | "stonkfun"
         "name":    "Pickle Cat"                 the coin's name, up to 32 characters
         "symbol":  "PKLCAT"                     2 to 10 of A-Z and 0-9
         "tagline": "..."                        CashCat's one line, up to 160 characters
         "trend":   { "title": "...", "source": "google-trends" | "coingecko" }
         "mint":    "<address>"                  the coin
         "creator": "<address>"                  CashCat's wallet
         "tx":      "<signature>"                the launch transaction
         "quote":   { "symbol": "SOL" | "SPYx" | ..., "mint": "<address>" }
         "pool":    "<address>"                  optional: the LaunchLab pool (StonkFun)
         "devBuy":  { "sol": 0, "tx": "<signature>" }   sol is 0 to 0.05; tx only when sol > 0
         "costSol": 0.0056                        what the launch transaction cost the wallet, read from the chain
         "kitten":  "ginger"                     which of the eight kittens holds the sign
     } ] }

   Every entry is checked here before anything is drawn. One that breaks a rule is skipped and
   the reason goes to the console. Text is only ever drawn as text; the only links the floor
   builds are Solscan, pump.fun and StonkFun pages, from an address or a signature that passed
   the checks below. This module touches no page: the floor imports it and the tests run it. */

export const VENUES = {
  pumpfun: { name: "pump.fun", page: "https://pump.fun/coin/" },
  "pumpfun-xstock": { name: "pump.fun (paired with a tokenised stock)", page: "https://pump.fun/coin/" },
  stonkfun: { name: "StonkFun", page: "https://www.stonkfun.xyz/token/" },
};
export const KITTENS = ["black", "calico", "ginger", "greytabby", "siamese", "sphynx", "tuxedo", "white"];
export const TREND_SOURCES = { "google-trends": "Google Trends", coingecko: "CoinGecko trending" };
export const EXPLORER = { tx: "https://solscan.io/tx/", address: "https://solscan.io/account/" };
export const MAX_LAUNCHES = 200;
export const MAX_DEV_BUY_SOL = 0.05;

const FIELDS = new Set(["time", "venue", "name", "symbol", "tagline", "trend", "mint", "creator", "tx", "quote", "pool", "devBuy", "costSol", "kitten"]);
const BASE58 = "[1-9A-HJ-NP-Za-km-z]";
const SIGNATURE = new RegExp(`^${BASE58}{64,90}$`);
const ADDRESS = new RegExp(`^${BASE58}{32,44}$`);
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MARKUP = /<[A-Za-z!/?]|&#|&[a-z]+;/;
const SCHEME = /\b(javascript|data|vbscript|file)\s*:/i;
const HIDDEN = /[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/;

class Bad extends Error {}
const bad = (why) => { throw new Bad(why); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function text(value, field, max) {
  if (typeof value !== "string") bad(`"${field}" must be text`);
  if (HIDDEN.test(value)) bad(`"${field}" contains a control or direction character`);
  const s = value.replace(/\s+/g, " ").trim();
  if (!s) bad(`"${field}" is empty`);
  if (s.length > max) bad(`"${field}" is longer than ${max} characters`);
  if (MARKUP.test(s)) bad(`"${field}" contains HTML`);
  if (SCHEME.test(s)) bad(`"${field}" contains a link scheme`);
  return s;
}
const addressOf = (v, field) => { if (typeof v !== "string" || !ADDRESS.test(v)) bad(`"${field}" is not a Solana address`); return v; };
const signatureOf = (v, field) => { if (typeof v !== "string" || !SIGNATURE.test(v)) bad(`"${field}" is not a transaction signature`); return v; };
function timeOf(v) {
  if (typeof v !== "string" || !TIME.test(v)) bad(`"time" must be YYYY-MM-DDThh:mm:ssZ`);
  const t = Date.parse(v);
  if (!Number.isFinite(t) || new Date(t).toISOString().replace(".000", "") !== v) bad(`"time" is not a real moment`);
  if (t < Date.UTC(2026, 0, 1)) bad(`"time" is before CashCat existed`);
  return v;
}
function onlyKeys(o, keys, where) { for (const k of Object.keys(o)) if (!keys.includes(k)) bad(`${where} has an unknown field "${k}"`); }
function num(v, field, min, max) { if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) bad(`"${field}" must be a number from ${min} to ${max}`); return v; }

export const shorten = (s) => (s.length > 14 ? `${s.slice(0, 5)}…${s.slice(-4)}` : s);

function launchEntry(e) {
  if (!isObject(e)) bad("an entry must be an object");
  for (const k of Object.keys(e)) if (!FIELDS.has(k)) bad(`unknown field "${k}"`);
  const time = timeOf(e.time);
  if (typeof e.venue !== "string" || !own(VENUES, e.venue)) bad(`"venue" must be one of ${Object.keys(VENUES).join(", ")}`);
  const name = text(e.name, "name", 32);
  if (typeof e.symbol !== "string" || !/^[A-Z0-9]{2,10}$/.test(e.symbol)) bad(`"symbol" must be 2 to 10 of A-Z and 0-9`);
  const tagline = text(e.tagline, "tagline", 160);
  if (!isObject(e.trend)) bad(`"trend" must be { "title", "source" }`);
  onlyKeys(e.trend, ["title", "source"], "trend");
  const trend = { title: text(e.trend.title, "trend title", 80), source: e.trend.source };
  if (!own(TREND_SOURCES, trend.source)) bad(`"trend.source" must be one of ${Object.keys(TREND_SOURCES).join(", ")}`);
  const mint = addressOf(e.mint, "mint"), creator = addressOf(e.creator, "creator"), tx = signatureOf(e.tx, "tx");
  if (!isObject(e.quote)) bad(`"quote" must be { "symbol", "mint" }`);
  onlyKeys(e.quote, ["symbol", "mint"], "quote");
  if (typeof e.quote.symbol !== "string" || !/^[A-Za-z0-9]{2,10}$/.test(e.quote.symbol)) bad(`"quote.symbol" must be a short ticker`);
  const quote = { symbol: e.quote.symbol, mint: addressOf(e.quote.mint, "quote.mint") };
  if ((e.venue === "pumpfun") !== (quote.symbol === "SOL")) bad(`a pump.fun launch is quoted in SOL, and only it`);
  let pool = "";
  if (own(e, "pool")) pool = addressOf(e.pool, "pool");
  if (!isObject(e.devBuy)) bad(`"devBuy" must be { "sol" } (0 when there was none)`);
  onlyKeys(e.devBuy, ["sol", "tx"], "devBuy");
  const devBuy = { sol: num(e.devBuy.sol, "devBuy.sol", 0, MAX_DEV_BUY_SOL), tx: "" };
  if (devBuy.sol > 0) devBuy.tx = signatureOf(e.devBuy.tx, "devBuy.tx");
  else if (own(e.devBuy, "tx")) bad(`"devBuy.tx" is only for a dev buy that happened`);
  if (e.venue === "stonkfun" && devBuy.sol > 0) bad(`CashCat makes no dev buy on StonkFun`);
  const costSol = num(e.costSol, "costSol", 0, 1);
  if (typeof e.kitten !== "string" || !KITTENS.includes(e.kitten)) bad(`"kitten" must be one of ${KITTENS.join(", ")}`);
  return { time, venue: e.venue, name, symbol: e.symbol, tagline, trend, mint, creator, tx, quote, pool, devBuy, costSol, kitten: e.kitten };
}

/** Links the floor may draw for a launch, all built here from checked strings. */
export function launchLinks(l) {
  const links = [
    { label: VENUES[l.venue].name, href: VENUES[l.venue].page + l.mint },
    { label: "Launch transaction", href: EXPLORER.tx + l.tx },
    { label: "Mint", href: EXPLORER.address + l.mint },
    { label: "CashCat's wallet", href: EXPLORER.address + l.creator },
  ];
  if (l.devBuy.tx) links.push({ label: "Dev buy", href: EXPLORER.tx + l.devBuy.tx });
  return links;
}

/** Check the whole file: the entries that pass, newest first, and one line per problem. */
export function validateLaunches(data) {
  const problems = [];
  if (!isObject(data) || !Array.isArray(data.launches)) return { launches: [], problems: ['the file must be { "launches": [ ... ] }'] };
  for (const k of Object.keys(data)) if (k !== "launches") problems.push(`unknown top-level field "${k}" ignored`);
  if (data.launches.length > MAX_LAUNCHES) problems.push(`more than ${MAX_LAUNCHES} launches; the oldest are not shown`);
  const seen = new Set(), ok = [];
  data.launches.forEach((entry, i) => {
    const name = isObject(entry) && typeof entry.symbol === "string" ? `${entry.symbol.slice(0, 12)} (entry ${i + 1})` : `entry ${i + 1}`;
    try {
      const l = launchEntry(entry);
      if (seen.has(l.mint)) bad(`the mint ${shorten(l.mint)} is listed twice; the first is kept`);
      seen.add(l.mint);
      ok.push(l);
    } catch (e) {
      if (!(e instanceof Bad)) throw e;
      problems.push(`${name} skipped: ${e.message}`);
    }
  });
  ok.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
  return { launches: ok.slice(0, MAX_LAUNCHES), problems };
}
