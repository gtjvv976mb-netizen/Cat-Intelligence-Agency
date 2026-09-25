/**
 * WHERE POPCAT LOOKS: pump.fun's own listing of new coins, the coin's metadata through
 * pump.fun's own IPFS gateway, and pump.fun's count of what a creator launched before.
 * All three answered without a key on 2026-09-24 (bots/lib/verified.mjs). Every row is
 * checked field by field; the chain is then asked about the few that look like cats.
 */
import { URLS } from "../lib/verified.mjs";
import { address } from "../lib/solana.mjs";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : "");

/** One listing row, or null when it is not a well-formed pump.fun coin. */
export function coinRow(r) {
  if (!isObject(r)) return null;
  const mint = address(r.mint), creator = address(r.creator), curve = address(r.bonding_curve);
  const created = Number(r.created_timestamp);
  if (!mint || !creator || !curve || !Number.isFinite(created)) return null;
  return {
    mint, creator, curve,
    name: text(r.name, 80), symbol: text(r.symbol, 40), description: text(r.description, 1000),
    createdMs: created, complete: r.complete === true,
    metadataUri: typeof r.metadata_uri === "string" ? r.metadata_uri.slice(0, 300) : "",
    banned: r.is_banned === true, nsfw: r.nsfw === true,
    quoteMint: typeof r.quote_mint === "string" ? r.quote_mint : null,
    program: typeof r.program === "string" ? r.program : null,
  };
}

/**
 * pump.fun's newest coins, page by page (50 a page), back to `untilMs` (a creation time) or as
 * far as the listing goes. On 2026-09-25 it served offsets 0 to 1,000 and answered an empty list
 * past that: 1,050 coins, about forty minutes of launches at the rate seen that night. So a run
 * cannot reach back further than that, and says when it could not reach `untilMs`:
 *   reached    a page reached a coin created before untilMs: nothing between was left out
 *   exhausted  the listing ran out first: coins between untilMs and oldestMs were not listed
 *   stoppedBy  a page failed, or the page cap was hit, before either: the next run tries again
 * A failed first page throws; a later one keeps the pages already read.
 */
export async function newestCoins({ http, untilMs = null, maxPages = 25 }) {
  const out = new Map();
  let pages = 0, reached = false, exhausted = false, stoppedBy = null, newestMs = null, oldestMs = null;
  for (let page = 0; page < maxPages; page++) {
    const url = URLS.pumpNewestCoins(50).replace("offset=0", `offset=${page * 50}`);
    let body;
    try { body = await http.json(url, { headers: { origin: "https://pump.fun" } }); }
    catch (e) { if (page === 0) throw e; stoppedBy = `page ${page + 1} failed (${e.message})`; break; }
    if (!Array.isArray(body)) throw new Error("pump.fun's coin listing is not a list");
    if (!body.length) { exhausted = true; break; }
    pages++;
    const rows = body.map(coinRow).filter(Boolean);
    for (const r of rows) {
      if (!out.has(r.mint)) out.set(r.mint, r);
      if (newestMs === null || r.createdMs > newestMs) newestMs = r.createdMs;
      if (oldestMs === null || r.createdMs < oldestMs) oldestMs = r.createdMs;
    }
    if (untilMs !== null && oldestMs !== null && oldestMs < untilMs) { reached = true; break; }
    if (body.length < 50) { exhausted = true; break; }
  }
  if (!reached && !exhausted && !stoppedBy) stoppedBy = `the page cap (${maxPages} pages)`;
  return { coins: [...out.values()], pages, reached, exhausted, stoppedBy, newestMs, oldestMs };
}

/** Coins traded most recently (any age; the caller keeps those under a day old). */
export async function activeCoins({ http, pages = 4 }) {
  const out = new Map();
  for (let page = 0; page < pages; page++) {
    const body = await http.json(URLS.pumpActiveCoins(50).replace("offset=0", `offset=${page * 50}`), { headers: { origin: "https://pump.fun" } });
    if (!Array.isArray(body)) throw new Error("pump.fun's coin listing is not a list");
    for (const r of body.map(coinRow).filter(Boolean)) if (!out.has(r.mint)) out.set(r.mint, r);
    if (body.length < 50) break;
  }
  return [...out.values()];
}

/** How many coins pump.fun says this creator launched (this one included), or null. */
export async function creatorLaunchCount({ http, creator }) {
  try {
    const body = await http.json(URLS.pumpCreatedCoins(creator), { headers: { origin: "https://pump.fun" } });
    const n = Number(body?.count);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch { return null; }
}

/** The CID in a pump.fun metadata URI (https://ipfs.io/ipfs/<cid>), or null. */
export function cidOf(uri) {
  const m = String(uri ?? "").match(/^https:\/\/(?:ipfs\.io|gateway\.pinata\.cloud|pump\.mypinata\.cloud|cf-ipfs\.com)\/ipfs\/([A-Za-z0-9]{46,70})$/);
  return m ? m[1] : null;
}

/**
 * The metadata document, read BY CID ONLY (never from the host a coin named), capped at 64 KB:
 * through pump.fun's own gateway first, then Pinata's public one — pump.fun's answered 403 for
 * some CIDs on 2026-09-24 that Pinata's served.
 */
export async function readMetadata({ http, uri }) {
  const cid = cidOf(uri);
  if (!cid) return { ok: false, why: "the metadata URI is not a plain IPFS link" };
  let last = "error";
  for (const url of [URLS.pumpGateway(cid), URLS.pinataGateway(cid)]) {
    try {
      const doc = await http.json(url, { maxBytes: 64 * 1024, timeoutMs: 15_000, retries: 1 });
      return isObject(doc) ? { ok: true, doc } : { ok: false, why: "the metadata is not an object" };
    } catch (e) { last = e.clause ?? "error"; }
  }
  return { ok: false, why: `the metadata could not be read (${last})` };
}
