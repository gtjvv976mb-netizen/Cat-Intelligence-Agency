/* THE CASE FILES: what a posted case must look like before the floor will show it.

   The agency's findings live in one file, site/assets/cases.json:

     { "cases": [ {
         "id":       "CRY-001"            the agent's prefix and a number (see AGENTS below)
         "agent":    "crying-cat"         director | crying-cat | grumpy-cat | coinmarketcat | snipurr
         "date":     "YYYY-MM-DD"         the day it was posted, UTC
         "verdict":  "RUGGED"             one of that agent's verdicts (see AGENTS below)
         "title":    "..."                one line, up to 140 characters
         "summary":  "..."                a few sentences, up to 700 characters
         "evidence": [ { "label": "...", "url": "https://..." }      a web page (an archived copy for anything off-chain)
                       { "label": "...", "tx": "<signature>" }       a Solana transaction, linked on Solscan
                       { "label": "...", "address": "<address>" } ]  a wallet or mint, linked on Solscan
         "x":        "https://x.com/<handle>/status/<id>"   optional: the post on X
     } ] }

   Every entry is checked here before anything is drawn. One that breaks a rule is skipped, and
   the reason goes to the console, naming the entry, so a typo can never break the page or put
   HTML on it. Text is only ever drawn as text. A link is only ever http(s), or a Solscan link
   built here from a signature or an address. The house rules ask for evidence ("no link, no
   case"), so every case but the Director's announcements needs at least one evidence link.

   CashCat and Popcat post no cases. They are bots now, and what they post lives in files of
   their own, checked by launches.js and callouts.js: a case filed under either is refused. The
   Director's CORRECTION covers a launch or a callout the agency got wrong.

   This module touches no page and has no side effects: the floor imports it, and
   test-site.mjs runs the same function in Node. */

export const AGENTS = {
  director:      { name: "The Director",  prefix: "DIR", verdicts: ["ANNOUNCEMENT", "CORRECTION"], evidence: false },
  "crying-cat":  { name: "Crying Cat",    prefix: "CRY", verdicts: ["RUGGED", "NO RED FLAGS FOUND", "CORRECTED"], evidence: true },
  "grumpy-cat":  { name: "Grumpy Cat",    prefix: "GRR", verdicts: ["NOT IMPRESSED", "NO RED FLAGS FOUND", "CORRECTED"], evidence: true },
  cashcat:       { name: "CashCat",       prefix: "CSH", verdicts: [], evidence: true, posts: "launches.json" },
  popcat:        { name: "Popcat",        prefix: "POP", verdicts: [], evidence: true, posts: "callouts.json" },
  coinmarketcat: { name: "CoinMarketCat", prefix: "CMC", verdicts: ["FIELD REPORT"], evidence: true },
  snipurr:       { name: "Snipurr",       prefix: "SNP", verdicts: ["FIELD REPORT"], evidence: true },
};

export const EXPLORER = { tx: "https://solscan.io/tx/", address: "https://solscan.io/account/" };

const FIELDS = new Set(["id", "agent", "date", "verdict", "title", "summary", "evidence", "x"]);
const EVIDENCE_FIELDS = new Set(["label", "url", "tx", "address"]);
const LIMIT = { title: 140, summary: 700, label: 80, evidence: 12, url: 600 };
const BASE58 = "[1-9A-HJ-NP-Za-km-z]";
const SIGNATURE = new RegExp(`^${BASE58}{64,90}$`);
const ADDRESS = new RegExp(`^${BASE58}{32,44}$`);
const X_POST = /^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{1,25}\/?$/;
/* Markup, and characters that hide or reorder text (controls, bidi overrides). */
const MARKUP = /<[A-Za-z!/?]/;
const HIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/;

class Bad extends Error {}
const bad = (why) => { throw new Bad(why); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function text(value, field, max) {
  if (typeof value !== "string") bad(`"${field}" must be text`);
  const s = value.replace(/\s+/g, " ").trim();
  if (!s) bad(`"${field}" is empty`);
  if (s.length > max) bad(`"${field}" is longer than ${max} characters`);
  if (MARKUP.test(s)) bad(`"${field}" contains HTML`);
  if (HIDDEN.test(value)) bad(`"${field}" contains a control or direction character`);
  return s;
}

function isoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) bad(`"date" must be YYYY-MM-DD`);
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (y < 2020 || y > 2100 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) bad(`"date" is not a real day`);
  return value;
}

/** An absolute http(s) link, or null. No other scheme, no credentials, no spaces. */
export function httpLink(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s || s.length > LIMIT.url || /\s/.test(s) || HIDDEN.test(s) || !/^https?:\/\//i.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || !u.hostname) return null;
  return u.href;
}

/** A long base58 string, shortened for display: 5Gh3k…9QpZ */
export const shorten = (s) => (s.length > 14 ? `${s.slice(0, 5)}…${s.slice(-4)}` : s);

function evidenceItem(item, n) {
  const where = `evidence ${n + 1}`;
  if (!isObject(item)) bad(`${where} must be { "label", and one of "url", "tx", "address" }`);
  for (const k of Object.keys(item)) if (!EVIDENCE_FIELDS.has(k)) bad(`${where} has an unknown field "${k}"`);
  const label = text(item.label, `${where} label`, LIMIT.label);
  const kinds = ["url", "tx", "address"].filter((k) => own(item, k));
  if (kinds.length !== 1) bad(`${where} needs exactly one of "url", "tx" or "address"`);
  const kind = kinds[0], raw = typeof item[kind] === "string" ? item[kind].trim() : item[kind];
  if (kind === "url") {
    const href = httpLink(raw);
    if (!href) bad(`${where} url must be an http(s) link`);
    return { label, kind, href, where: new URL(href).hostname.replace(/^www\./, "") };
  }
  if (kind === "tx") {
    if (typeof raw !== "string" || !SIGNATURE.test(raw)) bad(`${where} tx is not a transaction signature`);
    return { label, kind, href: EXPLORER.tx + raw, where: `solscan.io · tx ${shorten(raw)}` };
  }
  if (typeof raw !== "string" || !ADDRESS.test(raw)) bad(`${where} address is not a Solana address`);
  return { label, kind, href: EXPLORER.address + raw, where: `solscan.io · ${shorten(raw)}` };
}

function caseEntry(entry) {
  if (!isObject(entry)) bad("an entry must be an object");
  for (const k of Object.keys(entry)) if (!FIELDS.has(k)) bad(`unknown field "${k}"`);
  if (typeof entry.agent !== "string" || !own(AGENTS, entry.agent)) bad(`"agent" must be one of ${Object.keys(AGENTS).join(", ")}`);
  const agent = AGENTS[entry.agent];
  if (agent.posts) bad(`${agent.name} posts no cases: its posts are in ${agent.posts}`);
  if (typeof entry.id !== "string" || !new RegExp(`^${agent.prefix}-\\d{3,4}$`).test(entry.id)) bad(`"id" must look like ${agent.prefix}-001 for ${agent.name}`);
  const date = isoDate(entry.date);
  if (typeof entry.verdict !== "string" || !agent.verdicts.includes(entry.verdict)) bad(`"verdict" for ${agent.name} must be one of ${agent.verdicts.join(", ")}`);
  const title = text(entry.title, "title", LIMIT.title);
  const summary = text(entry.summary, "summary", LIMIT.summary);
  const list = own(entry, "evidence") ? entry.evidence : [];
  if (!Array.isArray(list)) bad(`"evidence" must be a list`);
  if (list.length > LIMIT.evidence) bad(`"evidence" has more than ${LIMIT.evidence} links`);
  if (agent.evidence && list.length === 0) bad(`"evidence" is empty: no link, no case`);
  const evidence = list.map(evidenceItem);
  let x = "";
  if (own(entry, "x") && entry.x !== "") {
    if (typeof entry.x !== "string" || !X_POST.test(entry.x.trim())) bad(`"x" must be a post link, https://x.com/<handle>/status/<id>`);
    x = entry.x.trim();
  }
  return { id: entry.id, agent: entry.agent, date, verdict: entry.verdict, title, summary, evidence, x };
}

/**
 * Check the whole file. Returns the cases that pass, newest first (by date; on the same day,
 * the one further down the file first), and one line per problem for the console.
 */
export function validateCases(data) {
  const problems = [];
  if (!isObject(data) || !Array.isArray(data.cases)) return { cases: [], problems: ['the file must be { "cases": [ ... ] }'] };
  for (const k of Object.keys(data)) if (k !== "cases") problems.push(`unknown top-level field "${k}" ignored`);
  const seen = new Set(), ok = [];
  data.cases.forEach((entry, i) => {
    const name = isObject(entry) && typeof entry.id === "string" ? `${entry.id.slice(0, 24)} (entry ${i + 1})` : `entry ${i + 1}`;
    try {
      const c = caseEntry(entry);
      if (seen.has(c.id)) bad(`"id" ${c.id} is used twice; the first one is kept`);
      seen.add(c.id);
      ok.push({ c, i });
    } catch (e) {
      if (!(e instanceof Bad)) throw e;
      problems.push(`${name} skipped: ${e.message}`);
    }
  });
  ok.sort((a, b) => (a.c.date === b.c.date ? b.i - a.i : a.c.date < b.c.date ? 1 : -1));
  return { cases: ok.map((o) => o.c), problems };
}
