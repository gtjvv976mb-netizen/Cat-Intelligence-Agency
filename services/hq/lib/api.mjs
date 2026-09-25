/**
 * THE PUBLIC API, EXACTLY PER docs/hq/API.md.
 *
 * Read-only GETs, the event stream, and two writes: POST /v1/perks/verify (a signed challenge)
 * and POST /v1/admin (a request signed by HQ_OWNER_WALLET). Nothing else changes anything.
 *
 * CORS answers only https://catintelligenceagency.com, https://www.catintelligenceagency.com and
 * http(s)://localhost / 127.0.0.1 on any port; any other origin gets no CORS headers (a browser
 * then refuses to read the answer) and its preflight a 403. Every client address has a budget
 * per minute (reads, perks, admin) and a cap on open streams; over it, 429 with Retry-After.
 * The client address is the socket's, or with HQ_TRUST_PROXY=1 (behind the host's edge proxy)
 * the X-Real-IP header Railway's edge sets to the client's address (docs.railway.com, Public
 * networking, specs and limits, read 2026-09-25), else the LAST X-Forwarded-For entry, the one the
 * proxy itself appended — never the first, which the client can write.
 *
 * No response carries a key, the seed, an API key, the RPC URL or a file path: answers are built
 * from views.mjs's shapes, errors are { error, message } with fixed words, and a failure inside a
 * handler answers 500 "internal" without its message (test-hq-api.mjs scans every response).
 */
import http from "node:http";
import { SITE_ORIGINS } from "./config.mjs";
import { agentObject, agentDetail, summaryObject, deskPage, leaderboard, buybacksObject, treasuryObject, PERIODS } from "./views.mjs";
import { PerksError, perksTiers } from "./perks.mjs";
import { AdminError, verifyAdminRequest, executeAdminCommand } from "./admin.mjs";

export const HQ_VERSION = "0.1.0";
const NO_STORE = Object.freeze({ "cache-control": "no-store" });
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;
export const allowedOrigin = (origin) => typeof origin === "string" && (SITE_ORIGINS.includes(origin) || LOCAL.test(origin));

export function createRateLimiter({ clock = () => Date.now(), windowMs = 60_000 } = {}) {
  const buckets = new Map();
  return {
    take(key, limit) {
      const now = clock();
      let b = buckets.get(key);
      if (!b || now - b.start >= windowMs) { b = { start: now, count: 0 }; buckets.set(key, b); }
      b.count++;
      if (buckets.size > 50_000) for (const [k, v] of buckets) if (now - v.start >= windowMs) buckets.delete(k);
      return b.count <= limit ? { ok: true } : { ok: false, retryAfter: Math.max(1, Math.ceil((b.start + windowMs - now) / 1000)) };
    },
  };
}

/**
 * deps: { db, config, clock, views(): Map, walletLedgers(): Map, treasury(): balances, health(): object,
 *         perks, symbolOf, adminDeps, streamPollMs }
 */
export function createApi(deps) {
  const { db, config, clock = () => Date.now() } = deps;
  const limiter = deps.limiter ?? createRateLimiter({ clock });
  const streams = new Map();                 // client → open stream count
  let streamsTotal = 0;

  const clientOf = (req) => {
    if (config.trustProxy) {
      const real = String(req.headers["x-real-ip"] ?? "").trim();
      if (real) return real;
      const xff = String(req.headers["x-forwarded-for"] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket?.remoteAddress ?? "unknown";
  };
  function send(res, status, body, headers = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": status === 200 ? "public, max-age=5" : "no-store",
      "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...headers });
    res.end(text);
  }
  const fail = (res, status, error, message, headers) => send(res, status, { error, message }, headers);
  function cors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (!allowedOrigin(origin)) return false;
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    return true;
  }
  async function body(req, max = 16_384) {
    let size = 0;
    const chunks = [];
    for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error("too large"), { status: 413 }); chunks.push(c); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw Object.assign(new Error("not JSON"), { status: 400 }); }
  }
  const symbolOf = deps.symbolOf ?? ((mint) => db.getToken(mint)?.symbol ?? null);

  async function route(req, res, url) {
    const p = url.pathname.replace(/\/+$/, "") || "/";
    if (p === "/health" || p === "/v1/health") return send(res, 200, deps.health(), NO_STORE);
    if (req.method === "GET" && p === "/v1/summary") return send(res, 200, summaryObject({ db, config, views: deps.views(), walletLedgers: deps.walletLedgers(), treasury: deps.treasury(), now: clock() }));
    if (req.method === "GET" && p === "/v1/agents") return send(res, 200, { agents: db.listAgents().map((agent) => agentObject({ agent, view: deps.views().get(agent.id), db })) });
    const m = /^\/v1\/agents\/(\d{1,3})$/.exec(p);
    if (req.method === "GET" && m) {
      const agent = db.getAgent(Number(m[1]));
      if (!agent) return fail(res, 404, "not_found", "no such agent");
      return send(res, 200, agentDetail({ agent, view: deps.views().get(agent.id), db, symbolOf }));
    }
    if (req.method === "GET" && p === "/v1/desk") {
      const limit = Number(url.searchParams.get("limit") ?? 50);
      if (!(Number.isInteger(limit) && limit >= 1 && limit <= 200)) return fail(res, 400, "bad_limit", "limit is 1 to 200");
      const page = deskPage({ db, limit, before: url.searchParams.get("before"), symbolOf });
      if (!page) return fail(res, 400, "bad_cursor", "before is not a cursor this server issued");
      return send(res, 200, page);
    }
    if (req.method === "GET" && p === "/v1/leaderboard") {
      const by = url.searchParams.get("by") ?? "pnl", period = url.searchParams.get("period") ?? "all", mode = url.searchParams.get("mode");
      if (!["roi", "pnl"].includes(by)) return fail(res, 400, "bad_by", "by is roi or pnl");
      if (!(period in PERIODS)) return fail(res, 400, "bad_period", "period is 7d, 30d or all");
      if (mode !== null && !["paper", "live"].includes(mode)) return fail(res, 400, "bad_mode", "mode is paper or live");
      return send(res, 200, leaderboard({ db, views: deps.views(), by, period, now: clock(), mode }));
    }
    if (req.method === "GET" && p === "/v1/buybacks") {
      const limit = Number(url.searchParams.get("limit") ?? 50);
      if (!(Number.isInteger(limit) && limit >= 1 && limit <= 200)) return fail(res, 400, "bad_limit", "limit is 1 to 200");
      return send(res, 200, buybacksObject({ db, config, limit }));
    }
    if (req.method === "GET" && p === "/v1/treasury") return send(res, 200, treasuryObject({ db, config, balances: deps.treasury() }));
    if (req.method === "GET" && p === "/v1/perks") return send(res, 200, perksTiers(config));
    if (req.method === "GET" && p === "/v1/perks/challenge") {
      try { return send(res, 200, deps.perks.challenge(url.searchParams.get("wallet")), NO_STORE); }
      catch (e) { if (e instanceof PerksError) return fail(res, e.status, e.clause, e.message); throw e; }
    }
    if (req.method === "POST" && p === "/v1/perks/verify") {
      const b = await body(req);
      try { return send(res, 200, await deps.perks.verify(b), NO_STORE); }
      catch (e) { if (e instanceof PerksError) return fail(res, e.status, e.clause, e.message); throw e; }
    }
    if (req.method === "POST" && p === "/v1/admin") {
      const b = await body(req);
      try {
        const command = verifyAdminRequest({ body: b, config, db, clock });
        return send(res, 200, { ok: true, result: await executeAdminCommand(command, { source: "signed", deps: deps.adminDeps }) }, NO_STORE);
      } catch (e) { if (e instanceof AdminError) return fail(res, e.status, e.clause, e.message); throw e; }
    }
    if (req.method === "GET" && p === "/v1/stream") return stream(req, res);
    return fail(res, 404, "not_found", "no such endpoint");
  }

  /* ── the stream: the event log, replayed from Last-Event-ID, then live ── */
  function stream(req, res) {
    const client = clientOf(req);
    const open = streams.get(client) ?? 0;
    if (open >= config.rateLimit.streamsPerClient || streamsTotal >= config.rateLimit.streamsTotal) return fail(res, 429, "too_many_streams", "too many open streams", { "retry-after": "30" });
    streams.set(client, open + 1); streamsTotal++;
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no", "x-content-type-options": "nosniff" });
    res.write("retry: 5000\n\n");
    const lastHeader = req.headers["last-event-id"] ?? new URL(req.url, "http://x").searchParams.get("lastEventId");
    let last = /^\d+$/.test(String(lastHeader ?? "")) ? Number(lastHeader) : db.lastEventId();
    /* A client that was away too long gets the newest 500, not the whole history. */
    const newest = db.lastEventId();
    if (newest - last > 500) last = newest - 500;
    const flush = () => {
      for (const e of db.eventsAfter(last, 200)) {
        if (!["trade", "decision", "promotion", "buyback", "fee", "summary"].includes(e.kind)) { last = e.id; continue; }
        res.write(`id: ${e.id}\nevent: ${e.kind}\ndata: ${JSON.stringify(e.data)}\n\n`);
        last = e.id;
      }
    };
    flush();
    const poll = setInterval(() => { try { flush(); } catch { /* the next poll tries again */ } }, deps.streamPollMs ?? 1_000);
    const beat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
    const close = () => { clearInterval(poll); clearInterval(beat); streamsTotal--; const n = (streams.get(client) ?? 1) - 1; if (n <= 0) streams.delete(client); else streams.set(client, n); };
    req.on("close", close);
  }

  async function handler(req, res) {
    let url;
    try { url = new URL(req.url, "http://hq.local"); } catch { return fail(res, 400, "bad_url", "bad request"); }
    const okOrigin = cors(req, res);
    if (req.method === "OPTIONS") {
      if (!okOrigin || !req.headers.origin) { res.writeHead(403, { "content-type": "text/plain" }); return res.end("origin not allowed"); }
      res.writeHead(204, { "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, last-event-id", "access-control-max-age": "600" });
      return res.end();
    }
    if (!["GET", "POST"].includes(req.method)) return fail(res, 405, "method_not_allowed", "GET and POST only");
    const kind = url.pathname.startsWith("/v1/perks/") ? "perks" : url.pathname.startsWith("/v1/admin") ? "admin" : "read";
    const take = limiter.take(`${kind}:${clientOf(req)}`, config.rateLimit[kind]);
    if (!take.ok) return fail(res, 429, "rate_limited", "too many requests", { "retry-after": String(take.retryAfter) });
    try { await route(req, res, url); }
    catch (error) {
      if (res.headersSent) { try { res.end(); } catch { /* gone */ } return; }
      if (error?.status === 413) return fail(res, 413, "too_large", "the body is too large");
      if (error?.status === 400) return fail(res, 400, "bad_json", "the body is not JSON");
      deps.onError?.(error);
      return fail(res, 500, "internal", "something went wrong inside HQ");
    }
  }
  const server = http.createServer((req, res) => { handler(req, res); });
  server.keepAliveTimeout = 65_000;
  return Object.freeze({ server, handler, listen: (port, host) => new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))), close: () => new Promise((r) => server.close(() => r())) });
}
