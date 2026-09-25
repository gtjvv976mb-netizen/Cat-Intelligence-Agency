/**
 * THE PUBLIC API, EXACTLY PER docs/hq/API.md.
 *
 * Read-only GETs, the event stream, and two writes: POST /v1/perks/verify (a signed challenge)
 * and POST /v1/admin (a request signed by HQ_OWNER_WALLET). Nothing else changes anything.
 *
 * CORS answers only https://catintelligenceagency.com, https://www.catintelligenceagency.com and
 * http(s)://localhost / 127.0.0.1 on any port; any other origin gets no CORS headers (a browser
 * then refuses to read the answer) and its preflight a 403. Every client address has a budget
 * per minute (reads, perks, admin); streams are capped per client network (an IPv4 /24, an
 * IPv6 /64) and in all, and each ends after at most HQ_STREAM_MAX_SECONDS (the client resumes
 * with Last-Event-ID and misses nothing); over a limit, 429 with Retry-After. A request must
 * arrive whole within 15 s.
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

/** A client's network: an IPv4 address's /24, an IPv6 address's /64 (so one client with many
 *  addresses in its own range counts once). */
export function networkOf(ip) {
  const s = String(ip ?? "").trim().toLowerCase().replace(/%.*$/, "");
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (s.includes(":")) {
    const [head, tail = null] = s.split("::");
    const h = head ? head.split(":") : [], t = tail === null ? [] : tail ? tail.split(":") : [];
    const groups = tail === null ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
    return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(":")}::/64`;
  }
  return s || "unknown";
}

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
  const streams = new Map();                 // client network → open stream count

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
      if (!Object.hasOwn(PERIODS, period)) return fail(res, 400, "bad_period", "period is 7d, 30d or all");
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
  const STREAM_KINDS = new Set(["trade", "decision", "promotion", "buyback", "fee", "summary"]);
  const SLOW_READER_BYTES = 256 * 1024;       // a client this far behind is ended; it resumes where it was
  const live = new Set();                     // open streams: { res, last, end }
  let broadcastAt = null, poller = null, beat = null;
  const write = (st, e) => {
    if (e.id <= st.last) return;
    st.last = e.id;
    if (!STREAM_KINDS.has(e.kind)) return;
    st.res.write(`id: ${e.id}\nevent: ${e.kind}\ndata: ${JSON.stringify(e.data)}\n\n`);
    if (st.res.writableLength > SLOW_READER_BYTES) st.end("slow");
  };
  /* One reader of the event log for every open stream, however many there are. */
  function broadcast() {
    if (!live.size) return;
    if (broadcastAt === null) broadcastAt = db.lastEventId();
    for (;;) {
      const batch = db.eventsAfter(broadcastAt, 200);
      if (!batch.length) break;
      for (const e of batch) { broadcastAt = e.id; for (const st of [...live]) write(st, e); }
      if (batch.length < 200) break;
    }
  }
  function ensureTimers() {
    if (!poller) poller = setInterval(() => { try { broadcast(); } catch { /* the next poll tries again */ } }, deps.streamPollMs ?? 1_000);
    if (!beat) beat = setInterval(() => { for (const st of live) st.res.write(": keep-alive\n\n"); }, 15_000);
  }
  function stopTimersIfIdle() {
    if (live.size) return;
    clearInterval(poller); clearInterval(beat); poller = null; beat = null; broadcastAt = null;
  }
  function stream(req, res) {
    const net = networkOf(clientOf(req));
    const open = streams.get(net) ?? 0;
    if (open >= config.rateLimit.streamsPerNetwork || live.size >= config.rateLimit.streamsTotal) return fail(res, 429, "too_many_streams", "too many open streams", { "retry-after": "30" });
    streams.set(net, open + 1);
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no", "x-content-type-options": "nosniff" });
    res.write("retry: 5000\n\n");
    const lastHeader = req.headers["last-event-id"] ?? new URL(req.url, "http://x").searchParams.get("lastEventId");
    const newest = db.lastEventId();
    let last = /^\d+$/.test(String(lastHeader ?? "")) ? Number(lastHeader) : newest;
    /* A client that was away too long gets the newest 500, not the whole history. */
    if (newest - last > 500) last = newest - 500;
    let ended = false;
    const st = { res, last, end: null };
    const timer = setTimeout(() => st.end("max_age"), config.rateLimit.streamMaxMs);
    st.end = () => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      live.delete(st);
      const n = (streams.get(net) ?? 1) - 1; if (n <= 0) streams.delete(net); else streams.set(net, n);
      try { res.end(); } catch { /* gone */ }
      stopTimersIfIdle();
    };
    req.on("close", () => st.end("closed"));
    /* its own backlog first, then the shared broadcast */
    for (;;) {
      const batch = db.eventsAfter(st.last, 200);
      for (const e of batch) { write(st, e); if (ended) return; }
      if (batch.length < 200) break;
    }
    /* the shared reader starts where this backlog ended (nothing can be added in between: all of
       this runs in one turn), so no event falls between the two */
    if (broadcastAt === null) broadcastAt = db.lastEventId();
    live.add(st);
    ensureTimers();
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
  /* a request must arrive whole, headers within 10 s and the body within 15 s (a stream's GET is
     whole at its headers), and the server holds a bounded number of connections */
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.maxConnections = config.rateLimit.streamsTotal + 500;
  return Object.freeze({ server, handler, openStreams: () => live.size,
    listen: (port, host) => new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))),
    close: () => new Promise((r) => { for (const st of [...live]) st.end("closing"); server.close(() => r()); }) });
}
