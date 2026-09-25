/* AGENCY HQ: THE SITE'S ONE WAY ONTO THE NETWORK.
   The site is static and calls nothing, with one exception: this module. It is the only file
   in site/ that may call fetch or open an EventSource (test-site.mjs pins that), and it calls
   only Agency HQ, the agency's own server, at the origin set as hqApi in assets/config.js:

     · the origin must be exactly https://api.catintelligenceagency.com, or, for development
       only and only on a page itself served from localhost, http://localhost:<port> or
       http://127.0.0.1:<port>. Anything else, an empty value included, means HQ is not online,
       and every HQ page says so instead of showing numbers. (The pages' own policy lets them
       connect to themselves and HQ's origin and nowhere else; the development server under
       scripts/ adds its mock's origin to it, and to nothing it deploys.)
     · the paths are the contract's (docs/hq/API.md) and nothing else: every query value is
       checked (an id is a whole number, a cursor is a cursor, a wallet is base58) before it
       goes into a URL;
     · no cookies, no referrer, no cache, no redirects; a request gives up after 12 seconds and
       a response over 2 MB is refused;
     · every answer is checked by hq-validate.js before a page sees it. Nothing unchecked
       reaches a page, and a page draws what it gets as text.

   All of it is GET, except the one POST the contract has: /v1/perks/verify, which carries the
   wallet, the challenge message and the message signature, and nothing else. */
import {
  HqInvalid, STREAM_EVENTS, CURSOR, validateStreamEvent, validateSummary, validateAgents, validateAgentDetail, validateDesk,
  validateLeaderboard, validateBuybacks, validateTreasury, validateTiers, validateChallenge, validatePerks,
} from "./hq-validate.js";
import { ADDRESS, SIGNATURE } from "./hq-format.js";

export const HQ_ORIGINS = Object.freeze(["https://api.catintelligenceagency.com"]);
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):([1-9]\d{1,4})$/;
const TIMEOUT_MS = 12_000;
const MAX_BYTES = 2_000_000;

const DEV_HOSTS = ["localhost", "127.0.0.1"];
const pageHostname = () => (typeof location !== "undefined" && typeof location.hostname === "string" ? location.hostname : "");
/* The HQ origin config.js names, if it is one the site may call; "" otherwise. A localhost HQ is
   one only for a page that is itself served from localhost: in development, never on the site. */
export function hqOrigin(raw, pageHost = pageHostname()) {
  if (typeof raw !== "string") return "";
  const s = raw.trim().replace(/\/$/, "");
  if (HQ_ORIGINS.includes(s)) return s;
  const m = s.match(DEV_ORIGIN);
  return m && Number(m[2]) <= 65535 && DEV_HOSTS.includes(pageHost) ? s : "";
}

export class HqError extends Error {
  /* kind: "offline" (no HQ configured), "network" (no answer), "http" (an error status),
     "invalid" (an answer the site could not verify) */
  constructor(kind, message, status = 0) { super(message); this.name = "HqError"; this.kind = kind; this.status = status; }
}

const signalFor = () => {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(TIMEOUT_MS);
  const c = new AbortController(); setTimeout(() => c.abort(), TIMEOUT_MS); return c.signal;
};

export function hqClient(cfg = (typeof window !== "undefined" && window.CIA_CONFIG) || {}, pageHost = pageHostname()) {
  const origin = hqOrigin(cfg.hqApi, pageHost);
  const online = origin !== "";

  async function call(path, query, check, { post = null } = {}) {
    if (!online) throw new HqError("offline", "HQ is not online yet");
    const qs = query ? "?" + new URLSearchParams(query).toString() : "";
    let res;
    try {
      res = await fetch(origin + path + qs, {
        method: post ? "POST" : "GET",
        mode: "cors", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        headers: post ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: "application/json" },
        body: post ? JSON.stringify(post) : undefined,
        signal: signalFor(),
      });
    } catch (e) {
      throw new HqError("network", "HQ did not answer");
    }
    if (!res.ok) throw new HqError("http", `HQ answered ${res.status}`, res.status);
    if (!/^application\/json\b/i.test(res.headers.get("content-type") || "")) throw new HqError("invalid", "HQ's answer was not JSON");
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new HqError("invalid", "HQ's answer was too large");
    let raw;
    try { raw = JSON.parse(text); } catch { throw new HqError("invalid", "HQ's answer was not valid JSON"); }
    try { return check(raw); } catch (e) {
      if (e instanceof HqInvalid) { console.warn("HQ: refused an answer that does not match the contract:", e.message); throw new HqError("invalid", e.message); }
      throw e;
    }
  }
  const limitOf = (n, max) => String(Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : max);
  const idOf = (id) => { if (!Number.isSafeInteger(id) || id < 1) throw new HqError("invalid", "an agent id is a positive whole number"); return id; };

  return {
    online,
    origin,
    summary: () => call("/v1/summary", null, validateSummary),
    agents: () => call("/v1/agents", null, validateAgents),
    agent: (id) => call(`/v1/agents/${idOf(id)}`, null, (raw) => validateAgentDetail(raw, id)),
    desk: ({ limit = 50, before = null } = {}) => {
      const q = { limit: limitOf(limit, 100) };
      if (before !== null) { if (typeof before !== "string" || !CURSOR.test(before)) throw new HqError("invalid", "not a desk cursor"); q.before = before; }
      return call("/v1/desk", q, validateDesk);
    },
    leaderboard: ({ by = "roi", period = "30d" } = {}) => {
      if (!["roi", "pnl"].includes(by) || !["7d", "30d", "all"].includes(period)) throw new HqError("invalid", "not a leaderboard");
      return call("/v1/leaderboard", { by, period }, (raw) => validateLeaderboard(raw, { by, period }));
    },
    buybacks: ({ limit = 50 } = {}) => call("/v1/buybacks", { limit: limitOf(limit, 200) }, validateBuybacks),
    treasury: () => call("/v1/treasury", null, validateTreasury),
    tiers: () => call("/v1/perks", null, validateTiers),
    challenge: (wallet) => {
      if (typeof wallet !== "string" || !ADDRESS.test(wallet)) throw new HqError("invalid", "not a wallet address");
      return call("/v1/perks/challenge", { wallet }, (raw) => validateChallenge(raw, wallet));
    },
    verify: ({ wallet, message, signature }) => {
      if (typeof wallet !== "string" || !ADDRESS.test(wallet) || typeof message !== "string" || typeof signature !== "string" || !SIGNATURE.test(signature))
        throw new HqError("invalid", "a verification needs the wallet, the challenge message and its signature");
      return call("/v1/perks/verify", null, validatePerks, { post: { wallet, message, signature } });
    },
    /* The live stream. Each event is checked like any answer; one that fails is dropped (and
       named in the console). onState hears "connecting", "live", "reconnecting" and "down";
       after "down" the stream is opened again, later each time, and a page should refetch when
       it is "live" again, since what happened in between was not streamed to it. */
    stream({ onEvent, onState = () => {} }) {
      if (!online || typeof EventSource === "undefined") { onState("down"); return () => {}; }
      let es = null, stopped = false, tries = 0, timer = 0;
      const open = () => {
        onState("connecting");
        es = new EventSource(origin + "/v1/stream");
        es.onopen = () => { tries = 0; onState("live"); };
        es.onerror = () => {
          if (es.readyState === EventSource.CLOSED) {
            onState("down");
            if (!stopped) timer = setTimeout(open, Math.min(60_000, 3_000 * 2 ** tries++));
          } else onState("reconnecting");
        };
        for (const type of STREAM_EVENTS) {
          es.addEventListener(type, (e) => {
            if (e.origin !== origin || typeof e.data !== "string" || e.data.length > MAX_BYTES) return;
            let data;
            try { data = validateStreamEvent(type, JSON.parse(e.data)); } catch (err) {
              console.warn(`HQ stream: refused a "${type}" event:`, err && err.message);
              return;
            }
            onEvent(type, data);
          });
        }
      };
      open();
      return () => { stopped = true; clearTimeout(timer); if (es) es.close(); };
    },
  };
}
