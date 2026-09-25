/**
 * THE PUBLIC API, OVER HTTP, AGAINST THE CONTRACT'S SCHEMAS.
 *
 * The whole server is built as it runs (server.mjs buildHq) on an in-memory database, with a
 * scripted chain and every other host refusing, and listens on a local port:
 *   · every endpoint's answer is held to services/hq/contract/schemas.mjs — the same file the
 *     site's tests can hold their fixtures to;
 *   · the stream replays from Last-Event-ID, sends new events live, and every event's data is
 *     the endpoint's own shape for its kind;
 *   · CORS answers only the site's two origins and localhost; any other origin gets no CORS
 *     header, and its preflight a 403;
 *   · each client has a budget per minute; over it, 429 with Retry-After; streams are capped per
 *     client network (/24, /64) and in all, end after at most five minutes, and a reader that
 *     falls behind is cut (it resumes where it was);
 *   · a leaderboard period is one of its own three, never a property every object has;
 *   · /health says states, never an upstream's words; a request must arrive whole in 15 s;
 *   · an indexer pass settles the wallets' open in-flight markers from the chain;
 *   · no answer carries the RPC URL, a key, the seed, a file path or an internal error message;
 *   · the admin door is shut without HQ_OWNER_WALLET and refuses an unsigned request with it.
 */
import http from "node:http";
import crypto from "node:crypto";
import bs58 from "bs58";
import { harness } from "./bots/test/doubles.mjs";
import { buildHq } from "./services/hq/server.mjs";
import net from "node:net";
import { createApi, allowedOrigin, networkOf } from "./services/hq/lib/api.mjs";
import { ConfigError } from "./services/hq/lib/config.mjs";
import { executeAdminCommand } from "./services/hq/lib/admin.mjs";
import { SCHEMAS, STREAM_EVENTS, PATTERNS, validate } from "./services/hq/contract/schemas.mjs";
import { numString } from "./services/hq/lib/views.mjs";
import { plainText } from "./services/hq/lib/text.mjs";
import { solString, unitsString } from "./services/hq/lib/amounts.mjs";
import { CIA_MINT } from "./services/hq/lib/config.mjs";
import { hqFixture, addr, TEST_PHRASE, testConfig, jsonTx } from "./services/hq/test/doubles.mjs";
import { parseSol } from "./services/hq/lib/amounts.mjs";
import { memoFor, classifyTransaction } from "./services/hq/lib/classify.mjs";

const { ok, section, done } = harness("test-hq-api");
const SECRET_RPC = "https://rpc.example.invalid/?api-key=SECRETKEY-7f3a";
const DB_PATH = ":memory:";
const B = hqFixture("ledger/3inPGc88YuabgXVhgZ4DtYjmMW86y5WYW3FVddN7NpLU.json");
const treasury = addr(1);
const SITE = "https://catintelligenceagency.com";

/* The chain, scripted; every other host refuses. */
const rpcAnswers = {
  getSignaturesForAddress: () => [], getTransaction: () => null, getBalance: () => ({ context: { slot: 1 }, value: 2_500_000_000 }),
  getTokenAccountsByOwner: ([wallet]) => ({ context: { slot: 1 }, value: wallet === holderAddress ? [{ pubkey: addr(90), account: { owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", data: { parsed: { info: { mint: CIA_MINT, owner: wallet, tokenAmount: { amount: "2500000000000", decimals: 6 } } } } } }] : [] }),
  getMultipleAccounts: ([list]) => ({ context: { slot: 1 }, value: list.map(() => null) }),
};
let holderAddress = null;
const outside = [];
async function fakeFetch(url, init = {}) {
  const u = String(url);
  if (u === SECRET_RPC) {
    const body = JSON.parse(init.body);
    const handler = rpcAnswers[body.method];
    const result = handler ? handler(body.params ?? []) : null;
    return new Response(JSON.stringify(handler ? { jsonrpc: "2.0", id: body.id, result } : { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "no" } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  outside.push(u);
  return new Response("refused in the test", { status: 503 });
}

const env = { HQ_DB_PATH: DB_PATH, HQ_RPC_URL: SECRET_RPC, HQ_MASTER_SEED: TEST_PHRASE, HQ_TREASURY_ADDRESS: treasury, HQ_OWNER_WALLET: addr(2), PORT: "18787" };
/* The server's clock runs from noon on the day the record below is dated, so no figure depends on the day the test runs. */
const OFFSET = Date.parse("2026-09-25T12:00:00Z") - Date.now();
const clock = () => Date.now() + OFFSET;
const logged = [];
const hq = await buildHq({ env, clock, fetchImpl: fakeFetch, log: (l) => logged.push(String(l)), retryDelaysMs: [0, 0, 0], WebSocketImpl: class { constructor() { throw new Error("no sockets in tests"); } } });
const { db, runtime, api } = hq;

/* The record: two paper agents made by the owner's command, a live agent on recorded mainnet
   history, a buyback, the treasury's flows. */
const run = (command) => executeAdminCommand(command, { source: "cli", deps: hq.adminDeps });
await run({ op: "agent.create", name: "Agent Whiskers", strategy: "crying-cat-safe" });
await run({ op: "agent.create", name: "Agent Snips", strategy: "snipurr" });
db.createAgent({ id: 7, name: "Agent Ledger", cat: "cashcat", skin: "standard", strategy: "crying-cat-safe", mode: "live", status: "active", wallet: B.wallet,
  limits: { maxPerTradeSol: "0.05", maxOpenPositions: 3, stopLossPct: 8, takeProfitPct: 15, trailingStopPct: null, dailyLossLimitSol: "0.1" }, settings: {}, paperBankroll: 1n });
for (const tx of B.transactions) db.putChainTx({ address: B.wallet, signature: tx.transaction.signatures[0], slot: tx.slot, blockTime: tx.blockTime, err: Boolean(tx.meta.err), tx });
/* As if HQ had made agent 7's buys: each has its decision, with the rug check it was made on, and
   the in-flight marker that names the transaction (how the indexer ties a trade to its decision). */
const RUG = { passed: true, checks: ["mint_authority", "freeze_authority", "holders", "creator_share"].map((id) => ({ id, pass: true, detail: `${id.replace(/_/g, " ")}: passed` })) };
for (const tx of B.transactions) {
  const e = classifyTransaction(tx, { wallet: B.wallet });
  if (e?.kind !== "trade" || e.side !== "buy") continue;
  const d = db.addDecision({ id: crypto.randomUUID(), agentId: 7, t: e.t, action: "buy", mint: e.mint, reason: "recorded buy", mode: "live", rugCheck: RUG });
  const iid = crypto.randomUUID();
  db.createIntent({ id: iid, agentId: 7, wallet: B.wallet, kind: "buy", mint: e.mint, trigger: "strategy", decisionId: d.id });
  db.updateIntent(iid, { state: "confirmed", signature: e.signature });
}
const M = addr(60);
db.upsertToken({ mint: M, symbol: "WHSK", name: "Whisker", decimals: 6 });
const t = (m) => `2026-09-25T11:${String(m).padStart(2, "0")}:00.000Z`;
runtime.decide(db.getAgent(1), { action: "buy", mint: M, reason: "EMA20 above EMA50" });
db.upsertTrade({ id: "paper-t1", agentId: 1, mode: "paper", t: t(1), side: "buy", mint: M, decimals: 6, sol: parseSol("0.05"), tokens: 5_000_000n, fee: 55_000n, trigger: "strategy", rugCheck: RUG });
db.upsertTrade({ id: "paper-t2", agentId: 1, mode: "paper", t: t(2), side: "sell", mint: M, decimals: 6, sol: parseSol("0.35"), tokens: 5_000_000n, fee: 55_000n, trigger: "take_profit" });
db.upsertTrade({ id: "paper-t3", agentId: 1, mode: "paper", t: t(3), side: "buy", mint: addr(61), decimals: 6, sol: parseSol("0.02"), tokens: 1_000_000n, fee: 55_000n, trigger: "strategy", rugCheck: RUG });
for (let i = 0; i < 7; i++) runtime.decide(db.getAgent(2), { action: "hold", reason: `the last ten minutes of launches: nobody_followed ${i}` });
const bid = crypto.randomUUID();
db.createBuyback({ id: bid });
db.updateBuyback(bid, { state: "done", legSigs: [bs58.encode(crypto.randomBytes(64)), bs58.encode(crypto.randomBytes(64))], burnSig: bs58.encode(crypto.randomBytes(64)), solSpent: parseSol("0.05"), ciaBought: 987_654_321n });
const agent1 = db.getAgent(1);
const sweep = jsonTx({ signature: bs58.encode(crypto.randomBytes(64)), slot: 5, keys: [agent1.wallet, treasury, "11111111111111111111111111111111"], balances: { [agent1.wallet]: [SOLn(1), SOLn(1) - parseSol("0.1") - 5_000n], [treasury]: [SOLn(1), SOLn(1) + parseSol("0.1")] },
  instructions: [{ program: "11111111111111111111111111111111", accounts: [agent1.wallet, treasury], data: (() => { const b = Buffer.alloc(12); b.writeUInt32LE(2, 0); b.writeBigUInt64LE(parseSol("0.1"), 4); return b; })() }] });
function parseSolTest(v) { return parseSol(String(v)); }
function SOLn(n) { return BigInt(n) * 1_000_000_000n; }
db.putChainTx({ address: treasury, signature: sweep.transaction.signatures[0], slot: 5, blockTime: sweep.blockTime, err: false, tx: sweep });
await hq.scheduler.indexAll();                  /* every ledger rebuilt, the treasury read, a summary on the stream */
void memoFor;

const server = await api.listen(0, "127.0.0.1");
const base = `http://127.0.0.1:${server.port}`;
const bodies = [];
function request(method, path, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); bodies.push(text); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on("error", reject);
    if (body !== null) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}
const shape = (name, json) => validate(SCHEMAS[name], json);

section("EVERY ENDPOINT, IN THE CONTRACT'S SHAPE");
{
  const s = await request("GET", "/v1/summary");
  ok("/v1/summary", s.status === 200 && shape("Summary", s.json).length === 0, JSON.stringify(shape("Summary", s.json)));
  const v1 = runtime.viewOf(1).ledger, v7 = runtime.viewOf(7).ledger;
  ok("…live: the one live agent's figures from its wallet's transactions (its cash and account rent), and nothing of paper", s.json.live.agents.total === 1 && s.json.live.tradingPnlSol.realized === solString(v7.realized) && v7.realized === -306_228_851n && s.json.live.solInAgentWallets === solString(v7.cash + v7.rent) && s.json.live.losses === 1);
  ok("…paper: the two paper agents' books (two 1-SOL bankrolls, one round trip), and nothing of live", s.json.paper.agents.total === 2 && s.json.paper.tradingPnlSol.realized === "0.3" && s.json.paper.wins === 1 && s.json.paper.losses === 0 && s.json.paper.trades24h.count === 3);
  ok("…each mode's max drawdown is its worst single agent's, never a sum", s.json.live.maxDrawdownPct === String(v7.maxDrawdownPct) && Number(s.json.paper.maxDrawdownPct) === Math.max(v1.maxDrawdownPct, runtime.viewOf(2).ledger.maxDrawdownPct));
  ok("…creator fees are their own line, never in trading P&L", s.json.creatorFeesClaimedSol === "0.160577729");
  ok("…the treasury's address and its SOL as read", s.json.treasury.address === treasury && s.json.treasury.sol === "2.5");
  const a = await request("GET", "/v1/agents");
  ok("/v1/agents", a.status === 200 && shape("Agents", a.json).length === 0 && a.json.agents.length === 3, JSON.stringify(shape("Agents", a.json)));
  ok("…each agent's wallet is its derived address, never anything secret", a.json.agents[0].wallet === db.getAgent(1).wallet && a.json.agents[0].number === "001");
  for (const id of [1, 2, 7]) {
    const d = await request("GET", `/v1/agents/${id}`);
    ok(`/v1/agents/${id}`, d.status === 200 && shape("AgentDetail", d.json).length === 0, JSON.stringify(shape("AgentDetail", d.json)).slice(0, 300));
  }
  const d1 = (await request("GET", "/v1/agents/1")).json;
  ok("…a paper agent: paper trades with no tx, a promotion to field (0.3 SOL realized), marked paper", d1.mode === "paper" && d1.trades.every((x) => x.tx === null && x.mode === "paper") && d1.rank === "field" && d1.promotions[0]?.to === "field");
  ok("…an open paper position valued at cost when unpriced (price null)", d1.positions.length === 1 && d1.positions[0].price === null && d1.positions[0].valueSol === d1.positions[0].costSol);
  const d7 = (await request("GET", "/v1/agents/7")).json;
  ok("…a live agent: every trade carries its signature; fees and transfers listed with theirs", d7.trades.length > 0 && d7.trades.every((x) => /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(x.tx)) && d7.fees.length === 5 && d7.transfers.every((x) => x.tx));
  const desk = await request("GET", "/v1/desk?limit=5");
  ok("/v1/desk: five items, newest first, and a cursor", desk.status === 200 && shape("Desk", desk.json).length === 0 && desk.json.items.length === 5 && typeof desk.json.next === "string", JSON.stringify(shape("Desk", desk.json)).slice(0, 300));
  const seen = new Set(desk.json.items.map((x) => x.id));
  let cursor = desk.json.next, pages = 1, total = desk.json.items.length, sorted = true, last = desk.json.items.at(-1).t;
  while (cursor && pages < 20) {
    const p = await request("GET", `/v1/desk?limit=5&before=${encodeURIComponent(cursor)}`);
    for (const x of p.json.items) { if (seen.has(x.id)) sorted = false; seen.add(x.id); if (x.t > last) sorted = false; last = x.t; }
    total += p.json.items.length; cursor = p.json.next; pages++;
  }
  ok(`…the cursor walks every item once, in order (${total} over ${pages} pages)`, sorted && cursor === null && total === db.raw.prepare("SELECT (SELECT COUNT(*) FROM decisions) + (SELECT COUNT(*) FROM trades) AS n").get().n);
  ok("…a cursor it never issued: 400", (await request("GET", "/v1/desk?before=nonsense")).status === 400);
  for (const q of ["by=pnl&period=all", "by=roi&period=all", "by=pnl&period=7d", "by=roi&period=30d", "by=pnl&period=all&mode=live", "by=pnl&period=all&mode=paper"]) {
    const l = await request("GET", `/v1/leaderboard?${q}`);
    ok(`/v1/leaderboard?${q}`, l.status === 200 && shape("Leaderboard", l.json).length === 0, JSON.stringify(shape("Leaderboard", l.json)));
  }
  const lb = (await request("GET", "/v1/leaderboard?by=pnl&period=all")).json;
  const cmp = (a, b) => (BigInt(parseSolTest(a)) > BigInt(parseSolTest(b)) ? 1 : BigInt(parseSolTest(a)) < BigInt(parseSolTest(b)) ? -1 : 0);
  ok("…rows best first (the site draws one board per mode from them, in this order)", lb.rows.every((r, i) => i === 0 || cmp(r.value, lb.rows[i - 1].value) <= 0) && lb.rows.length === 3, JSON.stringify(lb.rows));
  ok("…by=pnl is realized trading profit in SOL (all time: career realized); rank is the rank id", lb.rows.find((r) => r.agentId === 1)?.value === "0.3" && lb.rows.find((r) => r.agentId === 1)?.rank === "field" && lb.rows.find((r) => r.agentId === 7)?.value === "-0.306228851");
  const roi = (await request("GET", "/v1/leaderboard?by=roi&period=all")).json;
  ok("…by=roi is a percentage in SOL's format", roi.rows.every((r) => /^-?(0|[1-9]\d*)(\.\d{1,9})?$/.test(r.value)) && roi.rows.find((r) => r.agentId === 1)?.value === "30");
  ok("…?mode=paper holds only paper agents", (await request("GET", "/v1/leaderboard?by=pnl&period=all&mode=paper")).json.rows.every((r) => r.mode === "paper"));
  const trades = [...d1.trades, ...d7.trades];
  ok("every buy HQ made carries its rug check; sells carry none", d1.trades.filter((x) => x.side === "buy").every((x) => x.rugCheck?.passed === true && x.rugCheck.checks.length === 4) && trades.filter((x) => x.side === "sell").every((x) => x.rugCheck === null));
  ok("…a live buy carries the check its decision was made on, as it was made", d7.trades.filter((x) => x.side === "buy").every((x) => JSON.stringify(x.rugCheck) === JSON.stringify(RUG)));
  ok("every desk id and cursor has the contract's form", [...d1.trades, ...d7.trades, ...d1.decisions].every((x) => /^[A-Za-z0-9_-]{1,64}$/.test(x.id)));
  ok("a live trade's tx is never null: the schema refuses one without it", validate(SCHEMAS.Trade, { ...d7.trades[0], tx: null }).length > 0 && validate(SCHEMAS.Trade, d7.trades[0]).length === 0 && validate(SCHEMAS.Trade, d1.trades[0]).length === 0);
  const pk = await request("GET", "/v1/perks");
  ok("/v1/perks: the tiers the owner set, lowest first", pk.status === 200 && shape("PerksTiers", pk.json).length === 0 && pk.json.tiers.map((x) => x.id).join() === "holder,agent,director");
  const bb = await request("GET", "/v1/buybacks");
  ok("/v1/buybacks", bb.status === 200 && shape("Buybacks", bb.json).length === 0 && bb.json.items.length === 1 && bb.json.items[0].ciaBought === "987.654321");
  const tr = await request("GET", "/v1/treasury");
  ok("/v1/treasury", tr.status === 200 && shape("Treasury", tr.json).length === 0 && tr.json.flows.some((f) => f.kind === "funding_in"), JSON.stringify(tr.json.flows));
  const h = await request("GET", "/health");
  ok("/health: up, with the switches in words", h.status === 200 && h.json.ok === true && h.json.switches.live === false && h.json.switches.rpc === "own" && h.json.wallets === "ready" && h.json.agents === 3 && h.json.switches.kill === false);
  db.setKv("kill", true);
  ok("…and the kill switch shows on when the owner's console turned it on", (await request("GET", "/health")).json.switches.kill === true);
  db.setKv("kill", false);
}

section("HOUSEKEEPING KEEPS THE RECORD THAT MATTERS");
{
  const before = db.listDecisions(2, 100).length;
  const gone = db.pruneHolds("2999-01-01T00:00:00.000Z");
  const buysLeft = db.raw.prepare("SELECT COUNT(*) AS n FROM decisions WHERE action != 'hold'").get().n;
  ok("old holds are pruned; every buy and sell decision stays", gone >= before && db.listDecisions(2, 100).length === 0 && buysLeft >= 1);
}

section("THE CONTRACT'S NUMBER FORMATS");
{
  const cases = [[-0.001, "0"], [-0, "0"], [1e-9, "0"], [0.1, "0.1"], [-12.5, "-12.5"], [100, "100"], [2.345, "2.35"], [-0.005, "-0.01"], [123456789.12, "123456789.12"]];
  ok("percentages: no exponent, no leading zero, never -0", cases.every(([n, want]) => numString(n) === want), cases.map(([n]) => numString(n)).join(" "));
  ok("SOL and units: exact decimals, no -0", solString(-0n) === "0" && solString(-1n) === "-0.000000001" && solString(1_500_000_000n) === "1.5" && unitsString(5_000_000n, 8) === "0.05");
  const pat = (k, v) => new RegExp(PATTERNS[k]).test(v);
  ok("the patterns refuse a leading zero, an exponent, a plus, -0's leading zero", !pat("sol", "01.5") && !pat("sol", "1e-9") && !pat("sol", "+1") && !pat("units", "007") && pat("sol", "-0.5") && pat("units", "0.000001") && !pat("sol", "0.1234567891"));
  ok("sprite and skin ids are ids", pat("sprite", "crying-cat") && !pat("sprite", "Dog Cat!") && !pat("sprite", "-cat"));
}

section("TEXT IS PLAIN: WHAT HQ DID NOT WRITE IS CLEANED AND CUT BEFORE IT IS STORED");
{
  const evil = "\u202eTACDLOG\u200b\u0007SUPERLONGSYMBOLNAME";
  db.upsertToken({ mint: addr(62), symbol: evil, name: `A${"\u200d".repeat(10)} coin\nwith lines ${"x".repeat(100)}`, decimals: 6 });
  const tok = db.getToken(addr(62));
  ok("a coin's symbol from its metadata: hidden characters gone, cut to 16 with an ellipsis", tok.symbol === "TACDLOGSUPERLON…" && tok.symbol.length === 16, JSON.stringify(tok.symbol));
  ok("…its name: line breaks folded, cut to 64", tok.name.length === 64 && !/[\n\u200d]/.test(tok.name) && tok.name.startsWith("A coin with lines"));
  const d = runtime.decide(db.getAgent(2), { action: "hold", mint: addr(62), reason: `the model says:\n${"\u2066"}buy${"\u2069"} ${"y".repeat(600)}` });
  ok("a model's reason: cleaned and cut to 500 before it is stored", d.reason.length === 500 && d.reason.startsWith("the model says: buy y") && d.reason.endsWith("…") && validate(SCHEMAS.Decision, d).length === 0);
  ok("every text the schema holds refuses a hidden character", validate(SCHEMAS.Decision, { ...d, reason: "ok\u200bnot" }).length > 0 && validate(SCHEMAS.Decision, { ...d, reason: "   " }).length > 0);
  ok("plainText: plain text passes unchanged; nothing left is null", plainText("Agent Whiskers", 48) === "Agent Whiskers" && plainText("\u200b\u200b", 10) === null && plainText("🐱".repeat(30), 16).length <= 16);
}

section("ERRORS ARE THE CONTRACT'S ERROR SHAPE");
{
  for (const [path, status] of [["/v1/agents/99", 404], ["/v1/nothing", 404], ["/v1/desk?limit=0", 400], ["/v1/desk?limit=201", 400], ["/v1/leaderboard?by=fame", 400], ["/v1/leaderboard?period=1y", 400], ["/v1/leaderboard?mode=mixed", 400], ["/v1/buybacks?limit=x", 400], ["/v1/perks/challenge?wallet=nope", 400]]) {
    const r = await request("GET", path);
    ok(`GET ${path}: ${status}`, r.status === status && shape("Error", r.json).length === 0);
  }
  const put = await request("PUT", "/v1/agents");
  ok("PUT: 405", put.status === 405 && shape("Error", put.json).length === 0);
  ok("a body that is not JSON: 400", (await request("POST", "/v1/perks/verify", { body: "{not json" })).status === 400);
  ok("a body over 16 KB: 413", (await request("POST", "/v1/perks/verify", { body: JSON.stringify({ x: "a".repeat(20_000) }) })).status === 413);
}

section("PERKS, OVER HTTP");
{
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  holderAddress = bs58.encode(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
  const c = await request("GET", `/v1/perks/challenge?wallet=${holderAddress}`, { headers: { origin: SITE } });
  ok("GET /v1/perks/challenge", c.status === 200 && shape("PerksChallenge", c.json).length === 0 && c.headers["cache-control"] === "no-store");
  const signature = bs58.encode(crypto.sign(null, Buffer.from(c.json.message, "utf8"), privateKey));
  const v = await request("POST", "/v1/perks/verify", { headers: { origin: SITE }, body: { wallet: holderAddress, message: c.json.message, signature } });
  ok("POST /v1/perks/verify: 2,500,000 $CIA read from the chain is the agent tier", v.status === 200 && shape("PerksVerify", v.json).length === 0 && v.json.tier === "agent" && v.json.balance === "2500000", v.text);
  const again = await request("POST", "/v1/perks/verify", { headers: { origin: SITE }, body: { wallet: holderAddress, message: c.json.message, signature } });
  ok("…the same again: 401 replayed", again.status === 401 && again.json.error === "replayed");
}

section("THE ADMIN DOOR");
{
  const r = await request("POST", "/v1/admin", { body: { command: { op: "agent.create", name: "Agent Public", strategy: "snipurr" }, nonce: "n".repeat(20), issuedAt: new Date(clock()).toISOString(), signature: bs58.encode(crypto.randomBytes(64)) } });
  ok("an unsigned (wrongly signed) request to create an agent: 401, and no agent", r.status === 401 && r.json.error === "bad_signature" && db.listAgents().length === 3);
  const noOwner = createApi({ db, config: testConfig(), views: () => new Map(), walletLedgers: () => new Map(), treasury: () => null, health: () => ({}), perks: hq.perks, adminDeps: hq.adminDeps });
  const s2 = await noOwner.listen(0, "127.0.0.1");
  const r2 = await new Promise((resolve) => { const req = http.request(`http://127.0.0.1:${s2.port}/v1/admin`, { method: "POST", headers: { "content-type": "application/json" } }, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(t) })); }); req.end(JSON.stringify({ command: { op: "kill", on: true }, nonce: "n".repeat(20), issuedAt: new Date().toISOString(), signature: "x" })); });
  await noOwner.close();
  ok("with no HQ_OWNER_WALLET: 403, remote admin off", r2.status === 403 && r2.json.error === "admin_disabled");
}

section("CORS");
{
  for (const origin of [SITE, "https://www.catintelligenceagency.com", "http://localhost:5173", "http://127.0.0.1:8080", "http://localhost"]) {
    const r = await request("GET", "/v1/summary", { headers: { origin } });
    ok(`${origin}: allowed, echoed, Vary: Origin`, r.headers["access-control-allow-origin"] === origin && /Origin/.test(r.headers.vary ?? ""));
  }
  for (const origin of ["https://evil.example", "http://catintelligenceagency.com", "https://catintelligenceagency.com.evil.example", "https://api.catintelligenceagency.com", "null", "https://localhost.evil.example"]) {
    const r = await request("GET", "/v1/summary", { headers: { origin } });
    ok(`${origin}: no CORS header (the browser will not read it)`, r.headers["access-control-allow-origin"] === undefined && !allowedOrigin(origin));
  }
  const pre = await request("OPTIONS", "/v1/perks/verify", { headers: { origin: SITE, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
  ok("a preflight from the site: 204 with the methods and headers", pre.status === 204 && pre.headers["access-control-allow-origin"] === SITE && /POST/.test(pre.headers["access-control-allow-methods"]) && /content-type/.test(pre.headers["access-control-allow-headers"]));
  const bad = await request("OPTIONS", "/v1/perks/verify", { headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
  ok("a preflight from anywhere else: 403, no CORS header", bad.status === 403 && bad.headers["access-control-allow-origin"] === undefined);
  ok("no wildcard anywhere", bodies.length > 0 && !(await request("GET", "/v1/agents", { headers: { origin: SITE } })).headers["access-control-allow-origin"].includes("*"));
}

section("THE STREAM");
{
  const events = [];
  let resHeaders = null;
  const req = http.get(`${base}/v1/stream`, { headers: { "last-event-id": "0", origin: SITE } }, (res) => {
    resHeaders = res.headers;
    let buf = "";
    res.on("data", (c) => {
      buf += c.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const id = /^id: (\d+)$/m.exec(block)?.[1], kind = /^event: (\w+)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
        if (id && kind && data) events.push({ id: Number(id), kind, data: JSON.parse(data) });
      }
    });
  });
  const waitFor = async (pred, ms = 5_000) => { const until = Date.now() + ms; while (Date.now() < until) { if (pred()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
  await waitFor(() => events.length >= db.lastEventId() - 1);
  ok("text/event-stream, no-store, and the site's origin allowed", resHeaders?.["content-type"]?.startsWith("text/event-stream") && resHeaders["cache-control"] === "no-store" && resHeaders["access-control-allow-origin"] === SITE);
  const kinds = new Set(events.map((e) => e.kind));
  ok(`from Last-Event-ID 0 the log is replayed (${events.length} events: ${[...kinds].join(", ")})`, events.length > 10 && ["decision", "trade", "promotion", "fee", "summary"].every((k) => kinds.has(k)));
  ok("…ids strictly increasing", events.every((e, i) => i === 0 || e.id > events[i - 1].id));
  const bad = events.filter((e) => validate(SCHEMAS[STREAM_EVENTS[e.kind]], e.data).length > 0);
  ok("…every event's data is its endpoint's own shape", bad.length === 0, bad.slice(0, 2).map((e) => `${e.kind}: ${JSON.stringify(validate(SCHEMAS[STREAM_EVENTS[e.kind]], e.data))}`).join(" | "));
  const before = events.length;
  runtime.decide(db.getAgent(2), { action: "hold", reason: "a new decision, sent live" });
  ok("a new decision arrives live", await waitFor(() => events.length > before && events.at(-1).data.reason === "a new decision, sent live"));
  req.destroy();
  const lastId = events.at(-3).id;
  const replay = await new Promise((resolve) => {
    const got = [];
    const r = http.get(`${base}/v1/stream`, { headers: { "last-event-id": String(lastId) } }, (res) => { res.on("data", (c) => { for (const m of c.toString().matchAll(/^id: (\d+)$/gm)) got.push(Number(m[1])); if (got.length >= 2) { r.destroy(); resolve(got); } }); });
    setTimeout(() => { r.destroy(); resolve(got); }, 3_000);
  });
  ok("reconnecting with Last-Event-ID resumes right after it", replay[0] === events.at(-2).id && replay[1] === events.at(-1).id, JSON.stringify(replay));
}

section("RATE LIMITS");
{
  const small = createApi({ db, config: testConfig({ HQ_RATE_READ_PER_MIN: "10", HQ_RATE_PERKS_PER_MIN: "2", HQ_STREAMS_PER_NETWORK: "1", HQ_TRUST_PROXY: "1" }), views: () => new Map(), walletLedgers: () => new Map(),
    treasury: () => null, health: () => ({ ok: true }), perks: hq.perks, adminDeps: hq.adminDeps, streamPollMs: 50 });
  const s = await small.listen(0, "127.0.0.1");
  const get = (path, headers = {}) => new Promise((resolve) => { http.get(`http://127.0.0.1:${s.port}${path}`, { headers }, (res) => { res.resume(); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers })); }); });
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await get("/v1/agents", { "x-real-ip": "203.0.113.5" })).status);
  const last = await get("/v1/agents", { "x-real-ip": "203.0.113.5" });
  ok("ten reads a minute pass; the eleventh is 429 with Retry-After", statuses.slice(0, 10).every((x) => x === 200) && statuses[10] === 429 && Number(last.headers["retry-after"]) >= 1);
  ok("another client (behind the proxy, by the X-Real-IP the edge sets) has its own budget", (await get("/v1/agents", { "x-real-ip": "198.51.100.7" })).status === 200);
  const spoof = [];
  for (let i = 0; i < 11; i++) spoof.push((await get("/v1/agents", { "x-forwarded-for": `10.9.9.${i}, 192.0.2.77` })).status);
  ok("with no X-Real-IP, the last X-Forwarded-For entry (the proxy's own) counts: a client writing the first one buys no fresh budget", spoof[10] === 429);
  ok("perks have their own, smaller budget", (await get("/v1/perks/challenge?wallet=x", { "x-real-ip": "203.0.113.5" })).status === 400 && (await get("/v1/perks/challenge?wallet=x", { "x-real-ip": "203.0.113.5" })).status === 400 && (await get("/v1/perks/challenge?wallet=x", { "x-real-ip": "203.0.113.5" })).status === 429);
  const hold = http.get(`http://127.0.0.1:${s.port}/v1/stream`, { headers: { "x-real-ip": "192.0.2.9" } }, (res) => res.resume());
  await new Promise((r) => setTimeout(r, 150));
  ok("one open stream per client network here; a second is 429", (await get("/v1/stream", { "x-real-ip": "192.0.2.9" })).status === 429);
  ok("…and so is one from another address in the same /24 (a fresh X-Real-IP buys no fresh stream)", (await get("/v1/stream", { "x-real-ip": "192.0.2.77" })).status === 429);
  hold.destroy();
  await new Promise((r) => setTimeout(r, 100));
  await small.close();
  const noTrust = createApi({ db, config: testConfig({ HQ_RATE_READ_PER_MIN: "10" }), views: () => new Map(), walletLedgers: () => new Map(), treasury: () => null, health: () => ({}), perks: hq.perks, adminDeps: hq.adminDeps });
  const s3 = await noTrust.listen(0, "127.0.0.1");
  const get3 = (ip) => new Promise((resolve) => { http.get(`http://127.0.0.1:${s3.port}/v1/agents`, { headers: { "x-forwarded-for": ip, "x-real-ip": ip } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); }); });
  const codes = [];
  for (let i = 0; i < 11; i++) codes.push(await get3(`203.0.113.${i}`));
  await noTrust.close();
  ok("without HQ_TRUST_PROXY a client cannot buy a fresh budget by writing X-Forwarded-For or X-Real-IP", codes[10] === 429);
}


section("STREAMS: PER CLIENT NETWORK, AT MOST FIVE MINUTES");
{
  ok("a client's network: an IPv4 address's /24, an IPv6 address's /48 (however it is written)",
    networkOf("192.0.2.9") === "192.0.2.0/24" && networkOf("::ffff:192.0.2.200") === "192.0.2.0/24" && networkOf("2001:db8:1:2::1") === "2001:db8:1::/48"
    && networkOf("2001:0db8:0001:00ff:ffff:0:0:5") === "2001:db8:1::/48" && networkOf("2001:db8:2::1") !== networkOf("2001:db8:1:2::1") && networkOf("fe80::1%eth0") === "fe80:0:0::/48");
  ok("the defaults: 8 streams per network, 300 in all, each at most 300 s; a longer one is refused at start",
    testConfig().rateLimit.streamsPerNetwork === 8 && testConfig().rateLimit.streamsTotal === 300 && testConfig().rateLimit.streamMaxMs === 300_000
    && (() => { try { testConfig({ HQ_STREAM_MAX_SECONDS: "3600" }); return false; } catch (e) { return e instanceof ConfigError; } })());
  const cfg = testConfig({ HQ_STREAMS_PER_NETWORK: "2", HQ_STREAMS_TOTAL: "5", HQ_TRUST_PROXY: "1" });
  const quick = createApi({ db, config: { ...cfg, rateLimit: { ...cfg.rateLimit, streamMaxMs: 400 } }, views: () => new Map(), walletLedgers: () => new Map(), treasury: () => null, health: () => ({}), perks: hq.perks, adminDeps: hq.adminDeps, streamPollMs: 20 });
  const qs = await quick.listen(0, "127.0.0.1");
  const agent = new http.Agent({ keepAlive: false, maxSockets: Infinity });
  const open = (ip, headers = {}) => new Promise((resolve) => {
    const req = http.get({ agent, host: "127.0.0.1", port: qs.port, path: "/v1/stream", headers: { "x-real-ip": ip, ...headers } }, (res) => {
      let text = ""; res.on("data", (c) => { text += c; }); res.on("end", () => { r.ended = true; });
      const r = { status: res.statusCode, req, res, ended: false, text: () => text };
      resolve(r);
    });
    req.on("error", () => resolve({ status: "error", req, ended: true, text: () => "" }));
  });
  const a1 = await open("198.51.100.1"), a2 = await open("198.51.100.2"), a3 = await open("198.51.100.3");
  ok("two streams from one /24; the third from it: 429", a1.status === 200 && a2.status === 200 && a3.status === 429);
  const v1 = await open("2001:db8:1:2::1"), v2 = await open("2001:db8:1:ff::5"), v3 = await open("2001:db8:1:3::9"), v4 = await open("2001:db8:2::1");
  ok("the same for a /48 (a /56 or /64 inside it counts as the same client): two, then 429; the next /48 is its own", v1.status === 200 && v2.status === 200 && v3.status === 429 && v4.status === 200);
  const t1 = await open("203.0.113.50");
  ok("and never more than HQ_STREAMS_TOTAL in all (5 here): the sixth, from a fresh network, is 429", t1.status === 429 && quick.openStreams() === 5);
  await new Promise((r) => setTimeout(r, 700));
  ok("each stream ends by itself after at most HQ_STREAM_MAX_SECONDS (0.4 s here), and its place is free", [a1, a2, v1, v2, v4].every((x) => x.ended) && quick.openStreams() === 0);
  const lastSeen = db.lastEventId();
  runtime.decide(db.getAgent(2), { action: "hold", reason: "while the client was reconnecting" });
  const back = await open("198.51.100.1", { "last-event-id": String(lastSeen) });
  await new Promise((r) => setTimeout(r, 100));
  ok("…the client reconnects with Last-Event-ID and misses nothing", back.status === 200 && back.text().includes("while the client was reconnecting"));
  back.req.destroy();
  await new Promise((r) => setTimeout(r, 450));
  await quick.close();
}

section("STREAMS LOSE NOTHING: A BURST, A SLOW READER, A RESUME FROM FAR BACK, AND A RESET WHEN THE ID IS GONE");
{
  const cfg = testConfig({ HQ_STREAMS_PER_NETWORK: "50", HQ_STREAMS_TOTAL: "50", HQ_TRUST_PROXY: "1" });
  const mk = ({ maxMs = 60_000, stallMs = 60_000 } = {}) => createApi({ db, config: { ...cfg, rateLimit: { ...cfg.rateLimit, streamMaxMs: maxMs } }, views: () => new Map(), walletLedgers: () => new Map(),
    treasury: () => null, health: () => ({}), perks: hq.perks, adminDeps: hq.adminDeps, streamPollMs: 25, streamStallMs: stallMs });
  const agent = new http.Agent({ keepAlive: false, maxSockets: Infinity });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reason = "r".repeat(400);
  let seq = 0;
  const emit = (n) => db.tx(() => { for (let i = 0; i < n; i++) db.addEvent("decision", { kind: "decision", id: `burst-${seq++}`, reason }); });
  /* an SSE client that resumes with Last-Event-ID after every end, as EventSource does */
  function sse(port, { ip, lastId = null, pauseMs = 0, retryMs = 30 } = {}) {
    const got = [], resets = [];
    let last = lastId, stopped = false, ends = 0, cur = null;
    const connect = () => {
      if (stopped) return;
      cur = http.get({ agent, host: "127.0.0.1", port, path: "/v1/stream", headers: { "x-real-ip": ip, ...(last !== null ? { "last-event-id": String(last) } : {}) } }, (res) => {
        if (pauseMs) { res.pause(); const p = pauseMs; pauseMs = 0; setTimeout(() => res.resume(), p); }
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (d) => {
          buf += d;
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const id = /(?:^|\n)id: (\d+)/.exec(block)?.[1], ev = /(?:^|\n)event: (\w+)/.exec(block)?.[1];
            if (ev === "reset") resets.push({ id: Number(id), data: /(?:^|\n)data: (.*)/.exec(block)?.[1], afterEvents: got.length });
            else if (id) got.push(Number(id));
            if (id) last = Number(id);
          }
        });
        res.on("end", () => { ends++; if (!stopped) setTimeout(connect, retryMs); });
        res.on("error", () => {});
      });
      cur.on("error", () => { if (!stopped) setTimeout(connect, retryMs); });
    };
    connect();
    return { got, resets, ends: () => ends, stop: () => { stopped = true; cur?.destroy(); } };
  }
  const exactly = (c, from) => {
    const want = db.eventsAfter(from, 100_000).filter((e) => STREAM_EVENTS[e.kind]).map((e) => e.id);
    const set = new Set(c.got);
    return { all: want.every((id) => set.has(id)), dup: c.got.length - set.size, ordered: c.got.every((x, i) => i === 0 || x > c.got[i - 1]), missing: want.filter((id) => !set.has(id)).length, want: want.length };
  };

  /* the verifier's run: three clients, a burst of 1,500 events in one poll, streams ending every second */
  const api1 = mk({ maxMs: 1_000 });
  const s1 = await api1.listen(0, "127.0.0.1");
  emit(50);
  const aFrom = db.lastEventId() - 50;
  const A = sse(s1.port, { ip: "198.51.100.10", lastId: aFrom });
  await sleep(200);
  emit(100);
  const B = sse(s1.port, { ip: "198.51.100.11" });
  await sleep(200);
  const bFrom = db.lastEventId();
  emit(100);
  const cFrom = db.lastEventId();
  const C = sse(s1.port, { ip: "198.51.100.12", lastId: cFrom, pauseMs: 1_500 });
  await sleep(100);
  emit(1_500);                                       /* one burst: 1,500 events of ~0.5 KB before the next poll */
  await sleep(3_000);                                /* past the 1 s end: every client has reconnected at least twice */
  emit(20);
  await sleep(1_500);
  for (const c of [A, B, C]) c.stop();
  await api1.close();
  for (const [name, c, from] of [["A (from an id before the test)", A, aFrom], ["B (joined with no Last-Event-ID)", B, bFrom], ["C (did not read for 1.5 s during the burst)", C, cFrom]]) {
    const r = exactly(c, from);
    ok(`${name}: every event after its point exactly once, in order, across its reconnects (${c.got.length} of ${r.want}, ${c.ends()} ends)`, r.all && r.dup === 0 && r.ordered && c.resets.length === 0, JSON.stringify(r));
  }

  /* a client away while 1,200 events pass: all of them on its return, not the newest 500 */
  const api2 = mk();
  const s2 = await api2.listen(0, "127.0.0.1");
  const away = db.lastEventId();
  emit(1_200);
  const D = sse(s2.port, { ip: "198.51.100.20", lastId: away });
  await sleep(1_200);
  D.stop();
  const rd = exactly(D, away);
  ok("a client back after 1,200 events, its Last-Event-ID still in the log: all 1,200, no reset", rd.all && rd.dup === 0 && rd.want >= 1_200 && D.resets.length === 0, JSON.stringify(rd));

  /* its id pruned from the log (HQ keeps the newest 5,000 events): a reset first, then on from now */
  emit(30);
  db.pruneEvents(10);
  const gone = away;
  const E = sse(s2.port, { ip: "198.51.100.21", lastId: gone });
  await sleep(300);
  emit(5);
  await sleep(300);
  E.stop();
  ok("a Last-Event-ID older than the log keeps: the first event is reset, data {}, with the newest id; then every new event", E.resets.length === 1 && E.resets[0].afterEvents === 0 && E.resets[0].data === "{}"
    && E.got.length === 5 && E.got.every((id) => id > E.resets[0].id), JSON.stringify({ resets: E.resets, got: E.got.length }));
  const F = sse(s2.port, { ip: "198.51.100.22", lastId: db.lastEventId() + 1_000 });
  await sleep(200);
  F.stop();
  ok("…and one the log never had (ahead of it): reset too", F.resets.length === 1 && F.resets[0].data === "{}");
  const G = sse(s2.port, { ip: "198.51.100.23", lastId: db.lastEventId() });
  await sleep(200);
  G.stop();
  ok("…while one that is simply up to date gets no reset", G.resets.length === 0);
  await api2.close();

  /* a client that opens a stream and never reads: cut after the stall time, never holding memory without end */
  const api3 = mk({ stallMs: 300 });
  const s3 = await api3.listen(0, "127.0.0.1");
  const sock = net.connect(s3.port, "127.0.0.1", () => sock.write(`GET /v1/stream HTTP/1.1\r\nHost: x\r\nX-Real-IP: 192.0.2.150\r\nLast-Event-ID: ${db.lastEventId()}\r\n\r\n`));
  sock.pause();
  sock.on("error", () => {});
  await sleep(150);
  const reader = sse(s3.port, { ip: "192.0.2.151", lastId: db.lastEventId() });
  await sleep(100);
  const from3 = db.lastEventId();
  const openBefore = api3.openStreams();
  for (let i = 0; i < 60 && api3.openStreams() > 1; i++) { emit(400); await sleep(50); }
  await sleep(500);
  const r3 = exactly(reader, from3);
  ok("a stream whose client reads nothing is ended once it has drained nothing for the stall time", openBefore === 2 && api3.openStreams() === 1, `open ${api3.openStreams()}`);
  ok("…while a client that reads, on the same server, got every event of the same bursts", r3.all && r3.dup === 0 && r3.ordered && r3.want > 400, JSON.stringify(r3));
  reader.stop();
  sock.destroy();
  await api3.close();
}

section("A LEADERBOARD PERIOD IS ONE OF ITS OWN THREE");
{
  for (const period of ["toString", "__proto__", "constructor", "hasOwnProperty", "valueOf"]) {
    for (const by of ["pnl", "roi"]) {
      const r = await request("GET", `/v1/leaderboard?by=${by}&period=${period}`);
      ok(`period=${period} (by=${by}): 400 bad_period, never a 500 or a board`, r.status === 400 && r.json?.error === "bad_period" && shape("Error", r.json).length === 0);
    }
  }
}

section("REQUESTS MUST ARRIVE WHOLE");
{
  ok("headers within 10 s, the whole request within 15 s (a stream's GET is whole at its headers), and a bounded number of connections",
    api.server.headersTimeout === 10_000 && api.server.requestTimeout === 15_000 && Number.isInteger(api.server.maxConnections) && api.server.maxConnections === hq.config.rateLimit.streamsTotal + 500);
}

section("/health SAYS STATES; THE UPSTREAM'S WORDS GO TO THE LOG");
{
  const keep = { list: rpcAnswers.getSignaturesForAddress, owner: rpcAnswers.getTokenAccountsByOwner };
  const upstream = `provider says: ${SECRET_RPC} rate limited`;
  rpcAnswers.getSignaturesForAddress = () => { throw new Error(upstream); };
  const before = logged.length;
  await hq.scheduler.indexAll();
  const h = await request("GET", "/health");
  ok("an indexer pass whose RPC fails: /health is not ok, and says the indexer's state is error", h.json.ok === false && h.json.indexer.state === "error" && typeof h.json.indexer.at === "string");
  ok("…and how many addresses still have older history to read (none here)", h.json.indexer.backfilling === 0);
  ok("…with no upstream text in it: no URL, no key, no message", !h.text.includes("SECRETKEY") && !h.text.includes("rpc.example.invalid") && !/rate limited|provider/.test(h.text));
  ok("…the detail is in the log instead", logged.slice(before).some((l) => /index /.test(l)));
  hq.scheduler.status().jobs.buyback = { minute: 1, at: "2026-09-25T12:00:00.000Z", state: "error", result: `{"why":"${upstream}"}` };
  const h2 = await request("GET", "/health");
  ok("a job's entry is its time and its state, nothing else", JSON.stringify(h2.json.jobs.buyback) === JSON.stringify({ at: "2026-09-25T12:00:00.000Z", state: "error" }) && !h2.text.includes("SECRETKEY"));
  delete hq.scheduler.status().jobs.buyback;
  const feedWas = hq.scheduler.status().feed;
  hq.scheduler.status().feed = { state: "dead", detail: `dial failed: wss://rpc.example.invalid/?api-key=SECRETKEY-7f3a` };
  const h3 = await request("GET", "/health");
  ok("the launch feed: ok or error, its detail left out", JSON.stringify(h3.json.feed) === JSON.stringify({ state: "error" }) && !h3.text.includes("SECRETKEY"));
  hq.scheduler.status().feed = feedWas;
  rpcAnswers.getSignaturesForAddress = keep.list;
  await hq.scheduler.indexAll();
  ok("the RPC back: the next pass is ok again", (await request("GET", "/health")).json.indexer.state === "ok");

  /* the perks balance read failing with the RPC's own words */
  rpcAnswers.getTokenAccountsByOwner = () => { throw new Error(upstream); };
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const w = bs58.encode(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
  const c = await request("GET", `/v1/perks/challenge?wallet=${w}`);
  const v = await request("POST", "/v1/perks/verify", { body: { wallet: w, message: c.json.message, signature: bs58.encode(crypto.sign(null, Buffer.from(c.json.message, "utf8"), privateKey)) } });
  ok("a perks verify whose balance read fails: 503 in HQ's own words, the RPC's nowhere in it", v.status === 503 && v.json.error === "balance_unreadable" && v.json.message === "the $CIA balance could not be read from the chain; try again shortly" && !v.text.includes("SECRETKEY") && !/provider|rate limited/.test(v.text));
  rpcAnswers.getTokenAccountsByOwner = keep.owner;
}

section("AN INDEXER PASS SETTLES THE WALLETS' OPEN IN-FLIGHT MARKERS");
{
  const wallet = db.getAgent(1).wallet;
  const sig = bs58.encode(crypto.randomBytes(64));
  db.createIntent({ id: "stuck-api", agentId: 1, wallet, kind: "buy", detail: { blockhash: bs58.encode(Buffer.alloc(32, 7)) } });
  db.updateIntent("stuck-api", { state: "sent", signature: sig, lastValidBlockHeight: 100 });
  rpcAnswers.getSignatureStatuses = () => ({ context: { slot: 1 }, value: [null] });
  rpcAnswers.isBlockhashValid = () => ({ context: { slot: 1 }, value: true });
  await hq.scheduler.indexAll();
  ok("still inside its blockhash's life and unseen: left open", db.getIntent("stuck-api").state === "sent");
  rpcAnswers.isBlockhashValid = () => ({ context: { slot: 1 }, value: false });
  await hq.scheduler.indexAll();
  ok("the next pass, its blockhash expired and it never seen: settled (expired), the wallet free, no restart", db.getIntent("stuck-api").state === "expired" && db.openIntents(wallet).length === 0);
  delete rpcAnswers.getSignatureStatuses; delete rpcAnswers.isBlockhashValid;
}

section("A BUY HQ NEVER MADE");
{
  /* The same recorded wallet, as agent 8, with no decisions or markers: its buys were made outside HQ. */
  const A = hqFixture("ledger/45j71Q8CPW14SLD9ZEo9ouQHHgYS9NbLH4bXrw2Yi3ms.json");
  db.createAgent({ id: 8, name: "Agent Outside", cat: "grumpy-cat", skin: "standard", strategy: "crying-cat-safe", mode: "live", status: "paused", wallet: A.wallet,
    limits: { maxPerTradeSol: "0.05", maxOpenPositions: 3, stopLossPct: 8, takeProfitPct: 15, trailingStopPct: null, dailyLossLimitSol: "0.1" }, settings: {}, paperBankroll: 1n });
  for (const tx of A.transactions) db.putChainTx({ address: A.wallet, signature: tx.transaction.signatures[0], slot: tx.slot, blockTime: tx.blockTime, err: Boolean(tx.meta.err), tx });
  await runtime.refresh(8);
  const d8 = (await request("GET", "/v1/agents/8")).json;
  const outside = d8.trades.filter((x) => x.side === "buy");
  ok("its buy says it was not checked (passed: false, in words), never an invented check", outside.length > 0 && outside.every((x) => x.rugCheck.passed === false && /not checked/.test(x.rugCheck.checks[0].detail)));
  ok("…which the contract, and so the site, refuse: a buy that went through without a passed check is flagged, never shown as checked", outside.every((x) => validate(SCHEMAS.Trade, x).length > 0) && d8.trades.filter((x) => x.side === "sell").every((x) => validate(SCHEMAS.Trade, x).length === 0));
  db.raw.prepare("DELETE FROM trades WHERE agent_id = 8").run();
  db.raw.prepare("DELETE FROM agents WHERE id = 8").run();
}

section("NOTHING SECRET, NOTHING INTERNAL, IN ANY ANSWER");
{
  const boom = createApi({ db, config: testConfig(), views: () => { throw new Error(`cannot open ${"/data/hq.sqlite"} with ${SECRET_RPC}`); }, walletLedgers: () => new Map(), treasury: () => null, health: () => ({}), perks: hq.perks, adminDeps: hq.adminDeps, onError: () => {} });
  const s = await boom.listen(0, "127.0.0.1");
  const r = await new Promise((resolve) => http.get(`http://127.0.0.1:${s.port}/v1/summary`, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode, text: t })); }));
  await boom.close();
  bodies.push(r.text);
  ok("a failure inside a handler: 500 'internal', without its message", r.status === 500 && JSON.parse(r.text).error === "internal" && !r.text.includes("sqlite") && !r.text.includes("SECRETKEY"));
  const all = bodies.join("\n");
  const words = TEST_PHRASE.split(" ");
  ok(`${bodies.length} answers scanned: no RPC URL or API key`, !all.includes("SECRETKEY") && !all.includes("rpc.example.invalid") && !/api-key/i.test(all));
  ok("…no recovery phrase", !all.includes(words.slice(0, 4).join(" ")) && !all.includes("sausage"));
  ok("…no file path or database file", !/hq\.sqlite|\/data\/|\/home\/|\/app\/|services\/hq|node_modules|\.mjs/.test(all));
  ok("…no stack trace", !/\bat \S+ \(|Error: /.test(all));
  ok("the server never reached a host outside the scripted RPC", outside.every((u) => !u.includes("SECRETKEY")) && outside.length >= 0);
}

await api.close();
db.close();
done();
