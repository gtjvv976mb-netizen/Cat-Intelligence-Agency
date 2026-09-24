/**
 * ONE HTTP CLIENT FOR BOTH BOTS: A HOST ALLOW-LIST, A PACE PER HOST, AND A BACK-OFF.
 *
 * · Only the hosts in verified.mjs HOSTS (plus the RPC host the owner configured) may be
 *   called. A URL on any other host is refused before a socket opens, so a coin's metadata
 *   cannot make a bot call an arbitrary server (Popcat reads metadata only through pump.fun's
 *   own gateway, by CID).
 * · Each host has a minimum gap between requests. A 429 or a 5xx rests that host: the
 *   Retry-After it sends (seconds, at least 1 s — a "0" is not trusted) or an exponential
 *   back-off from 2 s, doubling to at most 2 minutes, whichever is longer. A host resting for
 *   more than 30 s answers the next caller at once with an HttpError("rate_limited") rather
 *   than a hammered request.
 * · Every request has a deadline and a byte cap enforced while the body is read.
 * · fetch, the clock and sleep are injected: the tests run with no network at all.
 */

export class HttpError extends Error {
  constructor(clause, message, detail = {}) { super(message); this.name = "HttpError"; this.clause = clause; this.detail = detail; }
}

export const HTTP_DEFAULTS = Object.freeze({
  timeoutMs: 20_000,
  maxBytes: 8 * 1024 * 1024,
  minGapMs: 1_100,
  backoffStartMs: 2_000,
  backoffMaxMs: 120_000,
  retries: 3,
});

/** Per-host pacing, from each host's published or observed limits. */
export const HOST_GAP_MS = Object.freeze({
  "api.coingecko.com": 6_500,        // the keyless tier allows a handful of calls a minute
  "trends.google.com": 2_000,
  "lite-api.jup.ag": 1_100,          // keyless: about one request a second
  "frontend-api-v3.pump.fun": 1_500,    // x-ratelimit-limit 60 a minute; answered 429 at 600 ms on 2026-09-24
  "www.stonkfun.xyz": 400,           // 300 a minute per IP, documented
  "pump.mypinata.cloud": 400,
  "gateway.pinata.cloud": 400,
});

export function createHttp({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  allowedHosts = [],
  log = null,
  defaults = HTTP_DEFAULTS,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("createHttp needs a fetch implementation");
  const allowed = new Set(allowedHosts);
  const hosts = new Map(); // host → { nextAt, failures, restUntil }
  const stats = { requests: 0, refused: 0, rested: 0 };

  const state = (host) => {
    if (!hosts.has(host)) hosts.set(host, { nextAt: 0, failures: 0, restUntil: 0 });
    return hosts.get(host);
  };

  function hostOf(url) {
    let u;
    try { u = new URL(url); } catch { throw new HttpError("bad_url", `not a URL: ${String(url).slice(0, 80)}`); }
    if (u.protocol !== "https:") throw new HttpError("bad_url", `only https is allowed: ${u.protocol}`);
    if (!allowed.has(u.host)) { stats.refused++; throw new HttpError("host_not_allowed", `the bots may not call ${u.host}`); }
    return u.host;
  }

  function rest(host, s, retryAfter) {
    s.failures++;
    const fromHeader = Number(retryAfter);
    const backoff = Math.min(defaults.backoffMaxMs, defaults.backoffStartMs * 2 ** (s.failures - 1));
    /* The longer of what the host asked for and our own doubling back-off: a "retry-after: 1"
       from a host that keeps answering 429 is not a reason to knock every second. */
    const ms = Math.min(defaults.backoffMaxMs, Math.max(Number.isFinite(fromHeader) && fromHeader >= 1 ? fromHeader * 1000 : 0, backoff));
    s.restUntil = now() + ms;
    stats.rested++;
    log?.warn(`${host} is resting for ${Math.round(ms / 1000)} s (failure ${s.failures})`);
    return ms;
  }

  async function readCapped(res, maxBytes) {
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      const chunks = []; let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value?.length ?? 0;
        if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new HttpError("too_large", `the answer passed ${maxBytes} bytes`); }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks);
    }
    if (typeof res.arrayBuffer === "function") {
      const b = Buffer.from(await res.arrayBuffer());
      if (b.length > maxBytes) throw new HttpError("too_large", `the answer is ${b.length} bytes, over ${maxBytes}`);
      return b;
    }
    const t = Buffer.from(String(await res.text()));
    if (t.length > maxBytes) throw new HttpError("too_large", `the answer is ${t.length} bytes, over ${maxBytes}`);
    return t;
  }

  /**
   * One request. Returns { status, headers, body: Buffer }. Throws HttpError on a refused
   * host, a resting host, a timeout, a network failure, or (after its retries) a 429/5xx.
   * A 4xx other than 429 is returned, not thrown: the caller decides what a 404 means.
   */
  async function request(url, { method = "GET", headers = {}, body = undefined, timeoutMs = defaults.timeoutMs, maxBytes = defaults.maxBytes, retries = defaults.retries } = {}) {
    const host = hostOf(url);
    const s = state(host);
    for (let attempt = 0; ; attempt++) {
      if (s.restUntil > now()) {
        const wait = s.restUntil - now();
        if (wait > 30_000) throw new HttpError("rate_limited", `${host} is resting for ${Math.ceil(wait / 1000)} more seconds`);
        await sleep(wait);
      }
      const gap = HOST_GAP_MS[host] ?? defaults.minGapMs;
      if (s.nextAt > now()) await sleep(s.nextAt - now());
      s.nextAt = now() + gap;
      stats.requests++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(url, { method, headers, body, signal: controller.signal, redirect: "error" });
      } catch (error) {
        clearTimeout(timer);
        const clause = error?.name === "AbortError" ? "timeout" : "network";
        if (attempt < retries) { rest(host, s); continue; }
        throw new HttpError(clause, clause === "timeout" ? `${host} did not answer inside ${Math.round(timeoutMs / 1000)} s` : `${host} could not be reached`);
      }
      try {
        if (res.status === 429 || res.status >= 500) {
          const ra = typeof res.headers?.get === "function" ? res.headers.get("retry-after") : null;
          rest(host, s, ra);
          if (attempt < retries) continue;
          throw new HttpError(res.status === 429 ? "rate_limited" : "server", `${host} answered ${res.status}`, { status: res.status });
        }
        const buf = await readCapped(res, maxBytes);
        s.failures = 0;
        return { status: res.status, ok: res.status >= 200 && res.status < 300, headers: res.headers, body: buf };
      } finally {
        clearTimeout(timer);
      }
    }
  }

  async function json(url, opts = {}) {
    const r = await request(url, { ...opts, headers: { accept: "application/json", ...(opts.headers ?? {}) } });
    let parsed;
    try { parsed = JSON.parse(r.body.toString("utf8")); } catch { parsed = undefined; }
    if (!r.ok) throw new HttpError(r.status === 404 ? "not_found" : "http", `${new URL(url).host} answered ${r.status}`, { status: r.status, body: parsed });
    if (parsed === undefined) throw new HttpError("not_json", `${new URL(url).host} did not answer with JSON`);
    return parsed;
  }

  async function text(url, opts = {}) {
    const r = await request(url, opts);
    if (!r.ok) throw new HttpError(r.status === 404 ? "not_found" : "http", `${new URL(url).host} answered ${r.status}`, { status: r.status });
    return r.body.toString("utf8");
  }

  return Object.freeze({ request, json, text, stats, allow: (h) => allowed.add(h) });
}
