/* POPCAT'S CALLOUTS: what a callout must look like before the floor will show it.

   Popcat, the agency's callout bot, reads new pump.fun coins, keeps the cat ones, runs its
   on-chain checks and writes a callout to site/assets/callouts.json only when EVERY check
   passed. A callout is a list of checks, never advice: the agency never buys a coin before
   calling it out, and Popcat never calls out a coin CashCat launched.

     { "callouts": [ {
         "time":    "2026-09-24T21:30:00Z"      when Popcat ran the checks, UTC
         "venue":   "pumpfun"
         "mint":    "<address>"
         "creator": "<address>"
         "name":    "..."                       the coin's own name, up to 40 characters, shown as text
         "symbol":  "..."                       its ticker, up to 16 characters, shown as text
         "cat":     { "field": "name" | "symbol" | "description", "word": "cat" }
         "checks":  [ { "id": "mint_authority", "result": "pass", "value": "revoked" }, ... ]
                    every id in CHECKS below, once each; "pass" or "info" only
     } ] }

   The coin's image is never shown and none of its links are followed or printed: the floor
   draws the name and ticker as text and links only to Solscan and pump.fun, built here from
   an address that passed the check below. */

export const CHECKS = {
  not_cashcat:      { label: "Not a CashCat coin", pass: "creator and mint are not CashCat's" },
  mint_authority:   { label: "Mint authority" },
  freeze_authority: { label: "Freeze authority" },
  mint_extensions:  { label: "Token extensions" },
  creator_share:    { label: "Creator holds" },
  top10_share:      { label: "Top 10 holders (bonding curve excluded)" },
  same_slot_buyers: { label: "Other wallets buying in the launch slot" },
  creator_launches: { label: "Creator's earlier pump.fun launches" },
  socials:          { label: "Socials in its metadata" },
  age:              { label: "Age at the check" },
  curve:            { label: "Bonding curve" },
  copycat:          { label: "Copy of an established cat coin" },
};
export const CHECK_IDS = Object.keys(CHECKS);
export const RESULTS = ["pass", "info"];
export const CAT_FIELDS = ["name", "symbol", "description"];
export const EXPLORER = { address: "https://solscan.io/account/" };
export const PUMP_PAGE = "https://pump.fun/coin/";
export const MAX_CALLOUTS = 200;

const FIELDS = new Set(["time", "venue", "mint", "creator", "name", "symbol", "cat", "checks"]);
const BASE58 = "[1-9A-HJ-NP-Za-km-z]";
const ADDRESS = new RegExp(`^${BASE58}{32,44}$`);
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MARKUP = /<[A-Za-z!/?]|&#|&[a-z]+;/;
const SCHEME = /\b(javascript|data|vbscript|file)\s*:/i;
/* Controls, and every character that draws nothing: zero-width spaces and joiners, the soft
   hyphen, word joiners, direction marks and overrides, the byte-order mark, the Hangul fillers. */
const HIDDEN = /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/;

/* How many bytes a base58 string decodes to: an address is 32, a signature 64. The regexes
   above only say the alphabet and a plausible length; "1" × 44 is 44 zero bytes, no address. */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Bytes(s) {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  const bytes = [];
  for (let i = zeros; i < s.length; i++) {
    let carry = ALPHABET.indexOf(s[i]);
    if (carry < 0) return -1;
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  return zeros + bytes.length;
}

class Bad extends Error {}
const bad = (why) => { throw new Bad(why); };
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
const addressOf = (v, field) => { if (typeof v !== "string" || !ADDRESS.test(v) || base58Bytes(v) !== 32) bad(`"${field}" is not a Solana address`); return v; };
function timeOf(v) {
  if (typeof v !== "string" || !TIME.test(v)) bad(`"time" must be YYYY-MM-DDThh:mm:ssZ`);
  const t = Date.parse(v);
  if (!Number.isFinite(t) || new Date(t).toISOString().replace(".000", "") !== v) bad(`"time" is not a real moment`);
  if (t < Date.UTC(2026, 0, 1)) bad(`"time" is before Popcat existed`);
  return v;
}

export const shorten = (s) => (s.length > 14 ? `${s.slice(0, 5)}…${s.slice(-4)}` : s);

function calloutEntry(e) {
  if (!isObject(e)) bad("an entry must be an object");
  for (const k of Object.keys(e)) if (!FIELDS.has(k)) bad(`unknown field "${k}"`);
  const time = timeOf(e.time);
  if (e.venue !== "pumpfun") bad(`"venue" must be "pumpfun"`);
  const mint = addressOf(e.mint, "mint"), creator = addressOf(e.creator, "creator");
  const name = text(e.name, "name", 40), symbol = text(e.symbol, "symbol", 16);
  if (!isObject(e.cat)) bad(`"cat" must be { "field", "word" }`);
  for (const k of Object.keys(e.cat)) if (k !== "field" && k !== "word") bad(`cat has an unknown field "${k}"`);
  if (!CAT_FIELDS.includes(e.cat.field)) bad(`"cat.field" must be one of ${CAT_FIELDS.join(", ")}`);
  const cat = { field: e.cat.field, word: text(e.cat.word, "cat word", 40) };
  if (!Array.isArray(e.checks)) bad(`"checks" must be a list`);
  const checks = [], seen = new Set();
  for (const [i, c] of e.checks.entries()) {
    if (!isObject(c)) bad(`check ${i + 1} must be an object`);
    for (const k of Object.keys(c)) if (!["id", "result", "value"].includes(k)) bad(`check ${i + 1} has an unknown field "${k}"`);
    if (!CHECK_IDS.includes(c.id)) bad(`check ${i + 1} has an unknown id`);
    if (seen.has(c.id)) bad(`the check "${c.id}" is listed twice`);
    seen.add(c.id);
    if (!RESULTS.includes(c.result)) bad(`the check "${c.id}" did not pass: a callout lists only checks that passed`);
    checks.push({ id: c.id, label: CHECKS[c.id].label, result: c.result, value: text(c.value, `${c.id} value`, 90) });
  }
  const missing = CHECK_IDS.filter((id) => !seen.has(id));
  if (missing.length) bad(`missing checks: ${missing.join(", ")}`);
  checks.sort((a, b) => CHECK_IDS.indexOf(a.id) - CHECK_IDS.indexOf(b.id));
  return { time, venue: e.venue, mint, creator, name, symbol, cat, checks };
}

/** The only links the floor draws for a callout. */
export function calloutLinks(c) {
  return [
    { label: "The coin on pump.fun", href: PUMP_PAGE + c.mint },
    { label: "Mint", href: EXPLORER.address + c.mint },
    { label: "Creator", href: EXPLORER.address + c.creator },
  ];
}

/**
 * Check the whole file. `exclude` is CashCat's launches (a validated launches list): a
 * callout on one of its coins or from its wallet is refused here too, whatever the bot did.
 */
export function validateCallouts(data, { exclude = [] } = {}) {
  const problems = [];
  if (!isObject(data) || !Array.isArray(data.callouts)) return { callouts: [], problems: ['the file must be { "callouts": [ ... ] }'] };
  for (const k of Object.keys(data)) if (k !== "callouts") problems.push(`unknown top-level field "${k}" ignored`);
  const cashcatMints = new Set(exclude.map((l) => l.mint)), cashcatWallets = new Set(exclude.map((l) => l.creator));
  const seen = new Set(), ok = [];
  data.callouts.forEach((entry, i) => {
    const name = isObject(entry) && typeof entry.mint === "string" ? `${shorten(entry.mint)} (entry ${i + 1})` : `entry ${i + 1}`;
    try {
      const c = calloutEntry(entry);
      if (cashcatMints.has(c.mint) || cashcatWallets.has(c.creator)) bad("Popcat never calls out a coin CashCat launched");
      if (seen.has(c.mint)) bad("this coin is called out twice; the first is kept");
      seen.add(c.mint);
      ok.push(c);
    } catch (e) {
      if (!(e instanceof Bad)) throw e;
      problems.push(`${name} skipped: ${e.message}`);
    }
  });
  ok.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
  return { callouts: ok.slice(0, MAX_CALLOUTS), problems };
}
