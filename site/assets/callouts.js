/* POPCAT'S FILE: every cat coin it checked, and its picks, as the floor will show them.

   Popcat, the agency's callout bot, reads new pump.fun coins, keeps the cat ones, runs twelve
   on-chain checks on each and writes EVERY coin it checked to site/assets/callouts.json, with
   every check and what it found. A coin in which no check found a red flag is a CALLOUT ("no
   red flags found"). A coin one or more checks flagged is SPOTTED, not called out: its red flags
   are named in plain words. Either way it is a list of checks, never advice. Every six hours
   Popcat also makes at most one PICK: a callout, with a short draft the agency may post BY HAND
   on pump.fun (the README says why a bot may not). The agency never holds, buys or sells a coin
   it calls out, and Popcat never lists a coin CashCat launched.

     { "callouts": [ {                          every coin checked, newest first, at most MAX_CALLOUTS
         "time":    "2026-09-24T21:30:00Z"      when Popcat ran the checks, UTC
         "venue":   "pumpfun"
         "mint":    "<address>"
         "creator": "<address>"
         "name":    "..."                       the coin's own name, up to 40 characters, shown as text
         "symbol":  "..."                       its ticker, up to 16 characters, shown as text
         "cat":     { "field": "name" | "symbol" | "description", "word": "cat" }
         "checks":  [ { "id": "mint_authority", "result": "pass", "value": "revoked" }, ... ]
                    every id in CHECKS below, once each: "pass" or "fail", or "info" for the two
                    whose source may be silent; not_cashcat is always "pass"
         "stats":   { "holders": 312, "top10Pct": 18.2, "curvePct": 42.5, "txs": 1204 }
                    what the pick ranks by: holders besides the bonding curve, the ten largest
                    holders' share, how much of the curve had sold, and the successful transactions
                    on the curve Popcat counted (null when they were not counted)
       } ],
       "picks": [ {                             newest first, at most MAX_PICKS, one per window
         "window":  "2026-09-25T12:00:00Z"      the six-hour window it is the pick for (00, 06, 12, 18 UTC)
         "time":    "2026-09-25T12:07:31Z"      when Popcat chose it, inside that window
         "checked": "2026-09-25T11:37:04Z"      when the checks it was chosen on ran, at most six hours before
         "mint", "creator", "name", "symbol", "stats"     as in its entry above
         "draft":   "..."                       a callout of at most DRAFT_MAX characters, facts only
       } ] }

   The coin's image is never shown and none of its links are followed or printed: the floor
   draws the name and ticker as text and links only to Solscan and pump.fun, built here from
   an address that passed the check below. */

/* Each check: its label on the floor, and (for one that failed) its red flag in plain words.
   The numbers in the words are THRESHOLDS in bots/popcat/checks.mjs; test-bots-popcat.mjs pins
   them to it. "info" marks the two checks whose source may be silent. */
export const CHECKS = {
  not_cashcat:      { label: "Not a CashCat coin", flag: "It is a CashCat coin." },
  mint_authority:   { label: "Mint authority", flag: "Its mint authority is not revoked, so more of it can be minted." },
  freeze_authority: { label: "Freeze authority", flag: "Its freeze authority is not revoked, so holders' tokens can be frozen." },
  mint_extensions:  { label: "Token extensions", flag: "Its token settings fail the audit CoinMarketCat runs before a trade (a transfer fee, a transfer hook, a freeze…)." },
  creator_share:    { label: "Creator holds", flag: "Its creator holds more than 5% of the supply." },
  top10_share:      { label: "Top 10 holders (bonding curve excluded)", flag: "Its ten largest holders hold more than 30% of the supply, or it has fewer than 25 holders." },
  same_slot_buyers: { label: "Other wallets buying in the launch slot", flag: "More than 2 other wallets bought in the slot it was launched in.", info: true },
  creator_launches: { label: "Creator's earlier pump.fun launches", flag: "Its creator launched more than 10 coins on pump.fun before this one.", info: true },
  socials:          { label: "Socials in its metadata", flag: "No social link was found in its metadata, or its metadata could not be read." },
  age:              { label: "Age at the check", flag: "It was younger than 15 minutes or older than 24 hours at the check." },
  curve:            { label: "Bonding curve", flag: "Less than 10% of its bonding curve had sold." },
  copycat:          { label: "Copy of an established cat coin", flag: "Its name or ticker is an established cat coin's." },
};
export const CHECK_IDS = Object.keys(CHECKS);
export const RESULTS = ["pass", "fail", "info"];
export const CAT_FIELDS = ["name", "symbol", "description"];
export const EXPLORER = { address: "https://solscan.io/account/" };
export const PUMP_PAGE = "https://pump.fun/coin/";
/** The newest 200 coins checked stay on the floor (the bot keeps a callout of the last six hours
 *  ahead of older spotted coins); a pick carries its own facts, so it outlives its entry. */
export const MAX_CALLOUTS = 200;
/** Four windows a day: a week of picks. */
export const MAX_PICKS = 28;
export const PICK_WINDOW_HOURS = 6;
export const PICK_LOOKBACK_HOURS = 6;

/* A pick's draft: the words the agency may post by hand on pump.fun. Facts from the checks only:
   no call to trade, no price and no promise. It must say the poster holds none of the coin and
   may be paid by pump.fun for the callout, as pump.fun's terms require. */
export const DRAFT_MAX = 200;
export const DRAFT_DISCLOSURE = "No position held; may earn callout rewards. Not financial advice.";
export const DRAFT_BANNED = /\b(buy|buys|buying|bought|sell|sells|selling|sold|ape|aping|moon|mooning|gem|gems|pump|pumping|pumped|dump|dumping|profit|profits|gain|gains|guarantee|guaranteed|safe|safest|price|prices|mcap|market ?cap|lfg|send it|\d+x|x\d+)\b/i;
/** The disclosure the site shows with every pick, and the README and the house rules repeat. */
export const PICK_DISCLOSURE = "The agency may post Popcat's pick as a callout on pump.fun, which pays callers from trading their callouts bring. The agency never holds, buys or sells a coin it calls out, and never calls out a coin CashCat launched. Not financial advice.";

const FIELDS = new Set(["time", "venue", "mint", "creator", "name", "symbol", "cat", "checks", "stats"]);
const PICK_FIELDS = new Set(["window", "time", "checked", "mint", "creator", "name", "symbol", "stats", "draft"]);
const STAT_FIELDS = ["holders", "top10Pct", "curvePct", "txs"];
const BASE58 = "[1-9A-HJ-NP-Za-km-z]";
const ADDRESS = new RegExp(`^${BASE58}{32,44}$`);
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MARKUP = /<[A-Za-z!/?]|&#|&[a-z]+;/;
const SCHEME = /\b(javascript|data|vbscript|file)\s*:/i;
/* Controls, and every character that draws nothing: zero-width spaces and joiners, the soft
   hyphen, word joiners, direction marks and overrides, the byte-order mark, the Hangul fillers. */
const HIDDEN = /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/;
const HOUR = 3_600_000;

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
function timeOf(v, field = "time") {
  if (typeof v !== "string" || !TIME.test(v)) bad(`"${field}" must be YYYY-MM-DDThh:mm:ssZ`);
  const t = Date.parse(v);
  if (!Number.isFinite(t) || new Date(t).toISOString().replace(".000", "") !== v) bad(`"${field}" is not a real moment`);
  if (t < Date.UTC(2026, 0, 1)) bad(`"${field}" is before Popcat existed`);
  return v;
}

export const shorten = (s) => (s.length > 14 ? `${s.slice(0, 5)}…${s.slice(-4)}` : s);
/** A ticker as the floor and the draft print it: one "$", whether or not the coin wrote its own. */
export const ticker = (symbol) => `$${String(symbol).replace(/^\$+/, "")}`;

const isPct = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
function statsOf(s) {
  if (!isObject(s)) bad(`"stats" must be { ${STAT_FIELDS.join(", ")} }`);
  for (const k of Object.keys(s)) if (!STAT_FIELDS.includes(k)) bad(`stats has an unknown field "${k}"`);
  if (!Number.isInteger(s.holders) || s.holders < 0 || s.holders > 100_000_000) bad(`"stats.holders" must be a whole number`);
  if (!isPct(s.top10Pct)) bad(`"stats.top10Pct" must be a percentage`);
  if (!isPct(s.curvePct)) bad(`"stats.curvePct" must be a percentage`);
  if (s.txs !== null && (!Number.isInteger(s.txs) || s.txs < 0 || s.txs > 100_000_000)) bad(`"stats.txs" must be a whole number, or null`);
  return { holders: s.holders, top10Pct: s.top10Pct, curvePct: s.curvePct, txs: s.txs };
}

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
    if (!RESULTS.includes(c.result)) bad(`the check "${c.id}" must be "pass", "fail" or "info"`);
    if (c.result === "info" && !CHECKS[c.id].info) bad(`the check "${c.id}" cannot be "info": its source is never silent`);
    if (c.id === "not_cashcat" && c.result !== "pass") bad("Popcat never lists a coin CashCat launched");
    checks.push({ id: c.id, label: CHECKS[c.id].label, result: c.result, value: text(c.value, `${c.id} value`, 90) });
  }
  const missing = CHECK_IDS.filter((id) => !seen.has(id));
  if (missing.length) bad(`missing checks: ${missing.join(", ")}`);
  checks.sort((a, b) => CHECK_IDS.indexOf(a.id) - CHECK_IDS.indexOf(b.id));
  const stats = statsOf(e.stats);
  /* What the floor prints: a coin with no failed check is a callout; any other is spotted,
     each failed check a red flag in plain words. The file cannot say otherwise. */
  const flags = checks.filter((c) => c.result === "fail").map((c) => ({ ...c, flag: CHECKS[c.id].flag }));
  const callout = flags.length === 0;
  return { time, venue: e.venue, mint, creator, name, symbol, cat, checks, stats, flags, callout, verdict: callout ? "NO RED FLAGS FOUND" : `RED FLAGS (${flags.length})` };
}

/** Whether a draft keeps the rules. Returns the reason it does not, or null. */
export function draftProblem(draft, { name, symbol }) {
  if (typeof draft !== "string") return `"draft" must be text`;
  if (draft.length > DRAFT_MAX) return `"draft" is longer than ${DRAFT_MAX} characters`;
  if (draft !== draft.replace(/\s+/g, " ").trim()) return `"draft" must be one line with single spaces`;
  if (!draft.startsWith(`${name} (${ticker(symbol)}): `)) return `"draft" must open with the coin's name and ticker`;
  if (!draft.endsWith(DRAFT_DISCLOSURE)) return `"draft" must end with the disclosure: "${DRAFT_DISCLOSURE}"`;
  const banned = draft.match(DRAFT_BANNED);
  if (banned) return `"draft" says "${banned[0]}": no call to trade, no price, no promise`;
  return null;
}

function pickEntry(p) {
  if (!isObject(p)) bad("a pick must be an object");
  for (const k of Object.keys(p)) if (!PICK_FIELDS.has(k)) bad(`unknown field "${k}"`);
  const window = timeOf(p.window, "window"), time = timeOf(p.time), checked = timeOf(p.checked, "checked");
  const w = Date.parse(window), t = Date.parse(time), c = Date.parse(checked);
  if (w % (PICK_WINDOW_HOURS * HOUR) !== 0) bad(`"window" must start at 00, 06, 12 or 18 UTC`);
  if (t < w || t >= w + PICK_WINDOW_HOURS * HOUR) bad(`"time" must fall inside its window`);
  if (c > t || c <= t - PICK_LOOKBACK_HOURS * HOUR) bad(`"checked" must be in the ${PICK_LOOKBACK_HOURS} hours before the pick`);
  const mint = addressOf(p.mint, "mint"), creator = addressOf(p.creator, "creator");
  const name = text(p.name, "name", 40), symbol = text(p.symbol, "symbol", 16);
  const stats = statsOf(p.stats);
  const draft = text(p.draft, "draft", DRAFT_MAX);
  const why = draftProblem(p.draft, { name, symbol });
  if (why) bad(why);
  return { window, end: new Date(w + PICK_WINDOW_HOURS * HOUR).toISOString().replace(".000", ""), time, checked, mint, creator, name, symbol, stats, draft };
}

/** The only links the floor draws for a coin Popcat checked, or picked. */
export function calloutLinks(c) {
  return [
    { label: "The coin on pump.fun", href: PUMP_PAGE + c.mint },
    { label: "Mint", href: EXPLORER.address + c.mint },
    { label: "Creator", href: EXPLORER.address + c.creator },
  ];
}

/**
 * Check the whole file. `exclude` is CashCat's launches (a validated launches list): an entry
 * or a pick on one of its coins or from its wallet is refused here too, whatever the bot did.
 * Returns { callouts, picks, problems }: "callouts" is every coin Popcat checked, each marked
 * `callout` (no red flags) or not (spotted).
 */
export function validateCallouts(data, { exclude = [] } = {}) {
  const problems = [];
  if (!isObject(data) || !Array.isArray(data.callouts)) return { callouts: [], picks: [], problems: ['the file must be { "callouts": [ ... ], "picks": [ ... ] }'] };
  for (const k of Object.keys(data)) if (k !== "callouts" && k !== "picks") problems.push(`unknown top-level field "${k}" ignored`);
  if ("picks" in data && !Array.isArray(data.picks)) problems.push('"picks" must be a list; ignored');
  const cashcatMints = new Set(exclude.map((l) => l.mint)), cashcatWallets = new Set(exclude.map((l) => l.creator));
  const isCashcat = (c) => cashcatMints.has(c.mint) || cashcatWallets.has(c.creator);
  const name = (entry, i, what) => `${what}${isObject(entry) && typeof entry.mint === "string" ? `${shorten(entry.mint)} (entry ${i + 1})` : `entry ${i + 1}`}`;

  const seen = new Set(), ok = [];
  data.callouts.forEach((entry, i) => {
    try {
      const c = calloutEntry(entry);
      if (isCashcat(c)) bad("Popcat never lists a coin CashCat launched");
      if (seen.has(c.mint)) bad("this coin is listed twice; the first is kept");
      seen.add(c.mint);
      ok.push(c);
    } catch (e) {
      if (!(e instanceof Bad)) throw e;
      problems.push(`${name(entry, i, "")} skipped: ${e.message}`);
    }
  });
  ok.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
  const callouts = ok.slice(0, MAX_CALLOUTS);
  const byMint = new Map(callouts.map((c) => [c.mint, c]));

  const picks = [], windows = new Set(), picked = new Set();
  (Array.isArray(data.picks) ? data.picks : []).forEach((entry, i) => {
    try {
      const p = pickEntry(entry);
      if (isCashcat(p)) bad("Popcat never picks a coin CashCat launched");
      if (byMint.has(p.mint) && !byMint.get(p.mint).callout) bad("a pick must be a coin in which no check found a red flag");
      if (windows.has(p.window)) bad("this window already has its pick; the first is kept");
      if (picked.has(p.mint)) bad("this coin was already picked; the first is kept");
      windows.add(p.window);
      picked.add(p.mint);
      picks.push(p);
    } catch (e) {
      if (!(e instanceof Bad)) throw e;
      problems.push(`${name(entry, i, "pick ")} skipped: ${e.message}`);
    }
  });
  picks.sort((a, b) => (a.window < b.window ? 1 : a.window > b.window ? -1 : 0));
  return { callouts, picks: picks.slice(0, MAX_PICKS), problems };
}
