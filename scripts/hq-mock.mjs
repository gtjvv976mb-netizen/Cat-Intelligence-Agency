#!/usr/bin/env node
/**
 * A MOCK AGENCY HQ, FOR DEVELOPING THE SITE ONLY. NEVER SHIPPED, NEVER DEPLOYED.
 *
 * It answers every endpoint in docs/hq/API.md with contract-shaped, clearly fake data (agents
 * called "Mock Mittens" and "Test Tabby", coins $MOCK and $TEST, every reason starting "Mock:"),
 * and streams trades, decisions, fees, promotions, buybacks and summaries over Server-Sent
 * Events, with Last-Event-ID. Its addresses and signatures are random base58: they point at
 * nothing. Nothing in site/ names it.
 *
 *   node scripts/hq-mock.mjs [--port 8787] [--mode mixed|paper|live] [--empty] [--site 8080] [--stream-seconds 300]
 *
 * --empty answers with no agents at all. Like HQ, the mock ends each stream after at most five
 * minutes (--stream-seconds sets it shorter, to watch the pages reconnect); the browser comes
 * back with Last-Event-ID and the mock replays what it missed. --site also serves site/ at http://127.0.0.1:<port>
 * for development, pointed at the mock: its config.js gets hqApi set to the mock's origin, and
 * each page's Content-Security-Policy lets it connect to the mock too (the committed pages
 * connect only to themselves and https://api.catintelligenceagency.com). test-hq-site.mjs checks
 * every answer this mock gives against the site's own validators.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { RANKS, rankForCareer, decSum, decMax, roundDec, decCmp } from "../site/assets/hq-format.js";
import { challengeMessage } from "../site/assets/hq-validate.js";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const NAMES = ["Mock Mittens", "Test Tabby", "Fixture Felix", "Sample Socks", "Demo Dusty", "Stub Smokey", "Dummy Dot", "Faux Fig", "Placeholder Pip"];
const SYMBOLS = ["MOCK", "TEST", "FIXT", "SMPL", "DEMO", "STUB", "DUMY", "FAUX", "PLHD"];
const TOKENS = ["MOCKBONK", "FAKEWIF", "TESTPEPE", "DEMOCAT", "STUBDOG", "FIXTURE", "SAMPLE"];
const CATS = ["snipurr", "coinmarketcat", "popcat", "crying-cat", "cashcat", "grumpy-cat", "director", "snipurr", "popcat"];
const STRATS = ["snipurr", "coinmarketcat", "popcat-scout", "crying-cat-safe", "snipurr", "coinmarketcat", "popcat-scout", "crying-cat-safe", "snipurr"];
const TRIGGERS = ["strategy", "strategy", "stop_loss", "take_profit", "trailing_stop", "strategy"];
const REASONS = {
  buy: ["Mock: volume held above entry for ten seconds and holders kept rising; buying the ticket.", "Mock: passed every rug check and the curve kept filling; small entry.", "Mock: fixture signal, a pullback to support on rising volume."],
  sell: ["Mock: stop loss hit at the limit; rule-based exit.", "Mock: take profit reached; the rule sells.", "Mock: momentum faded under entry; leaving early."],
  hold: ["Mock: all position slots in use; holding.", "Mock: nothing passed the checks this round; holding cash.", "Mock: waiting for the entry rule to line up."],
  refused: ["Mock: wanted this one, but Crying Cat's check refused it; no buy."],
};
const dec = (n, p = 4) => roundDec(n.toFixed(12), p);
const H = 3_600_000;

export function mockWorld({ seed = 7, mode = "mixed", empty = false, now = Date.now() } = {}) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const b58 = (n) => Array.from({ length: n }, () => B58[Math.floor(r() * 58)]).join("");
  const addr = () => b58(44), sig = () => b58(88);
  const iso = (msAgo) => new Date(now - msAgo).toISOString().replace(/\.\d{3}Z$/, "Z");
  const treasuryAddress = addr();
  /* Crying Cat's check of a coin, before a buy: passed, or refused on one check. */
  const check = (passed = true) => {
    const holders = 40 + Math.floor(r() * 300), top10 = 10 + Math.floor(r() * 12), creator = (r() * 4).toFixed(1);
    const checks = [
      { id: "mint_authority", pass: true, detail: "Mock: revoked" },
      { id: "freeze_authority", pass: passed, detail: passed ? "Mock: revoked" : "Mock: still set; the creator can freeze holders" },
      { id: "holders", pass: true, detail: `Mock: ${holders} holders, top 10 hold ${top10}%` },
      { id: "creator_share", pass: true, detail: `Mock: creator holds ${creator}%` },
    ];
    return { passed, checks };
  };

  const agents = [], details = new Map();
  const count = empty ? 0 : NAMES.length;
  for (let i = 0; i < count; i++) {
    const id = i + 1;
    const agentMode = mode === "mixed" ? (i % 3 === 0 ? "paper" : "live") : mode;
    const career = [0.08, 0.4, 1.7, 6.2, 0.02, 27.5, 0.9, 0.3, 3.1][i];
    const realized = career - (r() * 0.4);
    const unreal = (r() - 0.45) * 0.6;
    const deposited = 2 + Math.floor(r() * 6);
    const withdrawn = r() < 0.3 ? 0.5 : 0;
    const portfolio = Math.max(0.01, deposited - withdrawn + realized + unreal);
    const balance = portfolio * (0.35 + r() * 0.5);
    const wins = 3 + Math.floor(r() * 20), losses = 2 + Math.floor(r() * 18);
    const rank = RANKS[Math.min(RANKS.length - 1, RANKS.findIndex((x) => x.id === rankForCareer(dec(career))) + (i === 7 ? 1 : 0))].id;
    const a = {
      id, number: String(id).padStart(3, "0"), name: NAMES[i], cat: CATS[i], skin: i === 4 ? "nightops" : i === 8 ? "holder" : rank,
      rank, strategy: STRATS[i], mode: agentMode, status: i === 6 ? "paused" : "active",
      coin: i === 5 ? null : i === 2 ? { mint: addr(), symbol: null, name: null } : { mint: addr(), symbol: SYMBOLS[i], name: `${NAMES[i]} Mock Coin` },
      wallet: addr(), hiredAt: iso((count - i) * 26 * H + 3 * H),
      stats: {
        balanceSol: dec(balance), portfolioSol: dec(portfolio), realizedPnlSol: dec(realized), unrealizedPnlSol: dec(unreal),
        careerRealizedSol: dec(career), feesClaimedSol: dec(r() * 1.4), depositedSol: dec(deposited), withdrawnSol: dec(withdrawn),
        trades: (wins + losses) * 2 + Math.floor(r() * 3), wins, losses, maxDrawdownPct: dec(4 + r() * 30, 2),
        roiPct: dec(((realized + unreal) / deposited) * 100, 2),   // over the SOL ever deposited (gross)
      },
    };
    agents.push(a);

    const trades = [], decisions = [];
    let t = 70 * H;
    for (let k = 0; k < 14; k++) {
      t -= (2 + r() * 4) * H;
      const side = k % 2 === 0 ? "buy" : "sell";
      const sym = pick(TOKENS), mint = addr();
      const sol = 0.02 + r() * 0.3, pnlPct = side === "sell" ? (r() - 0.55) * 60 : null;
      const rc = side === "buy" ? check(true) : null;
      trades.push({
        kind: "trade", id: `t-${id}-${k}`, t: iso(Math.max(60_000, t)), agentId: id, side, mint, symbol: sym,
        sol: dec(sol), tokens: dec(sol / (0.0000004 + r() * 0.00002), 2), price: roundDec((0.0000004 + r() * 0.00002).toFixed(12), 12),
        pnlSol: pnlPct === null ? null : dec((sol * pnlPct) / 100), pnlPct: pnlPct === null ? null : dec(pnlPct, 2),
        trigger: side === "buy" ? "strategy" : pick(TRIGGERS), rugCheck: rc, tx: agentMode === "live" ? sig() : null, mode: agentMode,
      });
      const action = k % 3 === 2 ? "hold" : side;
      decisions.push({ kind: "decision", id: `d-${id}-${k}`, t: iso(Math.max(90_000, t + 40_000)), agentId: id, action,
        mint: action === "hold" ? null : mint, symbol: action === "hold" ? null : sym, reason: pick(REASONS[action]), rugCheck: action === "buy" ? rc : null, mode: agentMode });
    }
    /* A buy Crying Cat refused: a decision, and no trade after it. */
    decisions.push({ kind: "decision", id: `d-${id}-refused`, t: iso(5 * H + i * 600_000), agentId: id, action: "buy", mint: addr(), symbol: pick(TOKENS),
      reason: REASONS.refused[0], rugCheck: check(false), mode: agentMode });
    const equity = [];
    let v = deposited;
    for (let k = 96; k >= 0; k--) {
      v = Math.max(0.01, v + (r() - 0.48) * 0.12);
      equity.push({ t: iso(k * H), portfolioSol: dec(k === 0 ? portfolio : v) });
    }
    const fees = Array.from({ length: 3 + Math.floor(r() * 4) }, (_, k) => ({ t: iso((k * 11 + 2) * H), sol: dec(0.02 + r() * 0.3), tx: sig() }));
    /* A paper agent's deposits are book entries, with no transaction. */
    const ptx = () => (agentMode === "paper" ? null : sig());
    const transfers = [{ t: iso((count - i) * 26 * H), kind: "deposit", sol: dec(deposited), tx: ptx() }, ...(withdrawn ? [{ t: iso(20 * H), kind: "withdrawal", sol: dec(withdrawn), tx: ptx() }] : [])];
    const promotions = [];
    const ri = RANKS.findIndex((x) => x.id === rank);
    for (let k = 1; k <= ri; k++) promotions.push({ t: iso((ri - k + 1) * 9 * H), from: RANKS[k - 1].id, to: RANKS[k].id });
    details.set(id, {
      ...a,
      limits: { maxPerTradeSol: "0.25", maxOpenPositions: 3, stopLossPct: "20", takeProfitPct: "50", trailingStopPct: i % 2 ? "12" : null, dailyLossLimitSol: "0.5" },
      positions: Array.from({ length: i % 4 }, (_, k) => {
        const cost = 0.05 + r() * 0.2, pct = (r() - 0.45) * 50;
        const entry = 0.0000009 + r() * 0.00001;
        const quoted = !(i === 3 && k === 1);   // one position with no quote just now
        return { mint: addr(), symbol: pick(TOKENS), costSol: dec(cost), valueSol: dec(cost * (1 + pct / 100)), entryPrice: roundDec(entry.toFixed(12), 12),
          price: quoted ? roundDec((entry * (1 + pct / 100)).toFixed(12), 12) : null, pnlSol: dec((cost * pct) / 100), pnlPct: quoted ? dec(pct, 2) : null, openedAt: iso((k + 1) * 2.5 * H) };
      }),
      decisions, trades, equity, fees, transfers, promotions,
    });
  }

  /* One mode's block of the summary, from that mode's agents only. */
  const modeSummary = (m) => {
    const mine = agents.filter((a) => a.mode === m);
    const recent = mine.flatMap((a) => details.get(a.id).trades).filter((x) => now - Date.parse(x.t) < 24 * H);
    return {
      agents: { active: mine.filter((a) => a.status === "active").length, total: mine.length },
      trades24h: { count: recent.length, volumeSol: decSum(recent.map((x) => x.sol)) },
      solInAgentWallets: decSum(mine.map((a) => a.stats.balanceSol)),
      tradingPnlSol: { realized: decSum(mine.map((a) => a.stats.realizedPnlSol)), unrealized: decSum(mine.map((a) => a.stats.unrealizedPnlSol)) },
      wins: mine.reduce((n, a) => n + a.stats.wins, 0), losses: mine.reduce((n, a) => n + a.stats.losses, 0),
      maxDrawdownPct: decMax(mine.map((a) => a.stats.maxDrawdownPct)),
    };
  };
  const summary = () => ({
    updatedAt: iso(0), live: modeSummary("live"), paper: modeSummary("paper"),
    creatorFeesClaimedSol: decSum(agents.map((a) => a.stats.feesClaimedSol)),
    buybacks: { count: empty ? 0 : 6, solSpent: empty ? "0" : "1.85", ciaBought: empty ? "0" : "1843221.5" },
    treasury: { address: treasuryAddress, sol: empty ? "0" : "12.4031", cia: empty ? "0" : "9120443" },
  });
  const deskAll = () => [...details.values()].flatMap((d) => [...d.trades, ...d.decisions]).sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
  const board = (by, period) => {
    const f = { "7d": 0.3, "30d": 0.7, all: 1 }[period];
    const rows = agents.map((a) => ({ agentId: a.id, value: by === "roi" ? dec(Number(a.stats.roiPct) * f, 2) : dec(Number(a.stats.realizedPnlSol) * f), rank: a.rank, mode: a.mode }));
    return rows.sort((x, y) => decCmp(y.value, x.value));
  };
  const buybackItems = empty ? [] : Array.from({ length: 6 }, (_, k) => ({ t: iso((k * 7 + 1) * 24 * H), solSpent: dec(0.2 + r() * 0.3), ciaBought: dec(200000 + r() * 400000, 1),
    price: roundDec((0.0000008 + r() * 0.0000004).toFixed(12), 12), tx: sig(), burnTx: k === 0 ? null : sig() }));
  const flows = empty ? [] : Array.from({ length: 12 }, (_, k) => {
    const kind = ["fee_in", "profit_in", "buyback", "funding_out", "funding_in", "fee_in"][k % 6];
    return { t: iso((k * 13 + 3) * H), kind, sol: dec(0.05 + r() * 1.5), tx: sig() };
  });

  let seq = 0;
  const nextEvent = () => {
    seq++;
    if (!agents.length) return { type: "summary", data: summary() };
    const a = pick(agents);
    const roll = r();
    const t = iso(0);
    if (seq % 6 === 0) return { type: "summary", data: summary() };
    if (roll < 0.45) {
      const side = r() < 0.55 ? "buy" : "sell";
      const sol = 0.02 + r() * 0.25, pnlPct = side === "sell" ? (r() - 0.5) * 50 : null;
      const trade = { kind: "trade", id: `s-${seq}`, t, agentId: a.id, side, mint: addr(), symbol: pick(TOKENS), sol: dec(sol), tokens: dec(sol / 0.000004, 2),
        price: roundDec((0.0000004 + r() * 0.00002).toFixed(12), 12), pnlSol: pnlPct === null ? null : dec((sol * pnlPct) / 100), pnlPct: pnlPct === null ? null : dec(pnlPct, 2),
        trigger: side === "buy" ? "strategy" : pick(TRIGGERS), rugCheck: side === "buy" ? check(true) : null, tx: a.mode === "live" ? sig() : null, mode: a.mode };
      details.get(a.id).trades.unshift(trade);
      return { type: "trade", data: trade };
    }
    if (roll < 0.88) {
      const action = pick(["buy", "sell", "hold", "hold"]);
      const d = { kind: "decision", id: `s-${seq}`, t, agentId: a.id, action, mint: action === "hold" ? null : addr(), symbol: action === "hold" ? null : pick(TOKENS),
        reason: pick(REASONS[action]), rugCheck: action === "buy" ? (r() < 0.5 ? null : check(r() < 0.8)) : null, mode: a.mode };
      details.get(a.id).decisions.unshift(d);
      return { type: "decision", data: d };
    }
    if (roll < 0.93) return { type: "fee", data: { agentId: a.id, t, sol: dec(0.01 + r() * 0.1), tx: sig() } };
    if (roll < 0.96) {
      const i = RANKS.findIndex((x) => x.id === a.rank);
      if (i < RANKS.length - 1) return { type: "promotion", data: { agentId: a.id, mode: a.mode, t, from: RANKS[i].id, to: RANKS[i + 1].id } };
    }
    if (roll < 0.98 && buybackItems.length) return { type: "buyback", data: { t, solSpent: "0.25", ciaBought: "250000.0", price: "0.000001", tx: sig(), burnTx: sig() } };
    return { type: "summary", data: summary() };
  };

  return {
    summary,
    agents: () => ({ agents }),
    agent: (id) => details.get(id) || null,
    desk: (limit = 50, before = null) => {
      const all = deskAll();
      const start = before && /^c\d+$/.test(before) ? Number(before.slice(1)) : 0;
      const items = all.slice(start, start + limit);
      return { items, next: start + limit < all.length ? `c${start + limit}` : null };
    },
    leaderboard: (by, period) => ({ period, by, rows: board(by, period) }),
    buybacks: (limit = 50) => ({ policy: { sharePct: "50", sources: ["creator_fees", "trading_profit"], schedule: "Mock: once a week, Mondays at 14:00 UTC", destination: "burn" }, items: buybackItems.slice(0, limit) }),
    treasury: () => ({ address: treasuryAddress, sol: summary().treasury.sol, cia: summary().treasury.cia, flows }),
    tiers: () => ({ tiers: [
      { id: "holder", minCia: "100000", perks: ["Mock: the Holder skin", "Mock: a vote on the next agent's name"] },
      { id: "agent", minCia: "1000000", perks: ["Mock: the Night Ops skin", "Mock: a vote on the next agent's name", "Mock: a vote on the next agent's strategy"] },
      { id: "director", minCia: "10000000", perks: ["Mock: every perk skin", "Mock: both votes", "Mock: your wallet named on the Transparency page, if you want it"] },
    ] }),
    challenge: (wallet, nonce = randomBytes(12).toString("hex")) => ({ wallet, nonce, message: challengeMessage({ wallet, nonce, issuedAt: iso(0), expiresAt: iso(-5 * 60_000) }), expiresAt: iso(-5 * 60_000) }),
    verify: () => ({ holder: true, balance: "1250000", tier: "agent", perks: ["Mock: the Night Ops skin", "Mock: a vote on the next agent's name", "Mock: a vote on the next agent's strategy"], expiresAt: iso(-24 * H) }),
    nextEvent,
  };
}

/* ── development: site/, pointed at the mock ────────────────────────────── */
const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const COMMITTED_CONNECT = "connect-src 'self' https://api.catintelligenceagency.com;";
/* A page or config.js as the development server gives it: config.js names the mock as HQ, and a
   page's policy lets it connect to the mock as well. Nothing else changes. */
export function devRewrite(rel, text, mockOrigin) {
  if (rel === "assets/config.js") return `${text}\nwindow.CIA_CONFIG.hqApi = ${JSON.stringify(mockOrigin)};   // development only: the mock\n`;
  if (rel.endsWith(".html")) return text.replace(COMMITTED_CONNECT, `connect-src 'self' https://api.catintelligenceagency.com ${mockOrigin};`);
  return text;
}
function serveSite(port, mockOrigin) {
  const TYPES = { html: "text/html; charset=utf-8", css: "text/css", js: "text/javascript", json: "application/json", png: "image/png", jpg: "image/jpeg", webp: "image/webp", glb: "model/gltf-binary", zip: "application/zip" };
  http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
    let f = path.join(SITE, rel);
    if (!f.startsWith(SITE)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) {
      if (rel && !rel.endsWith("/")) { res.writeHead(301, { location: `/${rel}/` }); return res.end(); }
      f = path.join(f, "index.html"); rel = path.relative(SITE, f).split(path.sep).join("/");
    }
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end("not found"); }
    const ext = f.split(".").pop();
    const body = ["html", "js"].includes(ext) ? devRewrite(rel, fs.readFileSync(f, "utf8"), mockOrigin) : fs.readFileSync(f);
    res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  }).listen(port, "127.0.0.1", () => console.log(`site/ for development, pointed at the mock, on http://127.0.0.1:${port}/`));
}

/* ── the mock HQ ────────────────────────────────────────────────────────── */
function serve({ port, site, streamSeconds = 300, ...opts }) {
  const world = mockWorld(opts);
  const clients = new Set();
  const log = [];
  let eventId = 0;
  const cors = (req) => {
    const o = req.headers.origin || "";
    return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)
      ? { "access-control-allow-origin": o, vary: "origin", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, accept, last-event-id" } : {};
  };
  const json = (req, res, status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors(req) }); res.end(JSON.stringify(body)); };
  const fail = (req, res, status, error, message) => json(req, res, status, { error, message });
  const send = (res, e) => res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);
  setInterval(() => {
    const e = { id: ++eventId, ...world.nextEvent() };
    log.push(e); if (log.length > 200) log.shift();
    for (const c of clients) send(c, e);
  }, 2500).unref();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const q = (k) => u.searchParams.get(k);
    if (req.method === "OPTIONS") { res.writeHead(204, cors(req)); return res.end(); }
    if (req.method === "POST" && u.pathname === "/v1/perks/verify") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 10_000) req.destroy(); });
      req.on("end", () => {
        let b; try { b = JSON.parse(body); } catch { return fail(req, res, 400, "bad_json", "The body is not JSON."); }
        if (!b || Object.keys(b).sort().join() !== "message,signature,wallet") return fail(req, res, 400, "bad_body", "Send the wallet, the message and the signature, and nothing else.");
        return json(req, res, 200, world.verify());
      });
      return;
    }
    if (req.method !== "GET") return fail(req, res, 405, "method", "GET only.");
    const m = u.pathname.match(/^\/v1\/agents\/(\d+)$/);
    if (m) { const d = world.agent(Number(m[1])); return d ? json(req, res, 200, d) : fail(req, res, 404, "no_agent", "No such agent."); }
    switch (u.pathname) {
      case "/v1/summary": return json(req, res, 200, world.summary());
      case "/v1/agents": return json(req, res, 200, world.agents());
      case "/v1/desk": return json(req, res, 200, world.desk(Math.min(100, Number(q("limit")) || 50), q("before")));
      case "/v1/leaderboard": return json(req, res, 200, world.leaderboard(q("by") === "pnl" ? "pnl" : "roi", ["7d", "30d", "all"].includes(q("period")) ? q("period") : "30d"));
      case "/v1/buybacks": return json(req, res, 200, world.buybacks(Math.min(200, Number(q("limit")) || 50)));
      case "/v1/treasury": return json(req, res, 200, world.treasury());
      case "/v1/perks": return json(req, res, 200, world.tiers());
      case "/v1/perks/challenge": return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q("wallet") || "") ? json(req, res, 200, world.challenge(q("wallet"))) : fail(req, res, 400, "bad_wallet", "Not a wallet address.");
      case "/v1/stream": {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", ...cors(req) });
        res.write("retry: 3000\n\n");
        const last = Number(req.headers["last-event-id"]);
        if (Number.isSafeInteger(last)) for (const e of log) if (e.id > last) send(res, e);
        clients.add(res);
        /* HQ ends a stream after at most five minutes; the client reconnects with Last-Event-ID. */
        const end = setTimeout(() => { clients.delete(res); res.end(); }, Math.min(300, streamSeconds) * 1000);
        req.on("close", () => { clearTimeout(end); clients.delete(res); });
        return;
      }
      default: return fail(req, res, 404, "not_found", "Not in the contract.");
    }
  });
  server.listen(port, "127.0.0.1", () => console.log(`mock HQ (fake data, development only) on http://127.0.0.1:${port}  mode=${opts.mode}${opts.empty ? " empty" : ""}`));
  if (site) serveSite(site, `http://127.0.0.1:${port}`);
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  serve({ port: Number(arg("--port", "8787")), mode: arg("--mode", "mixed"), empty: process.argv.includes("--empty"), seed: Number(arg("--seed", "7")), site: arg("--site", "") ? Number(arg("--site", "")) : 0, streamSeconds: Number(arg("--stream-seconds", "300")) });
}
