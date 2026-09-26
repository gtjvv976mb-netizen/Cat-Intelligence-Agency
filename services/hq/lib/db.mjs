/**
 * HQ'S RECORD: ONE SQLITE FILE ON THE PERSISTENT VOLUME, THROUGH node:sqlite.
 *
 * WHY node:sqlite (built into Node 22) RATHER THAN better-sqlite3. Both are synchronous SQLite
 * bindings with the same shape (prepare / run / get / all). node:sqlite ships inside Node, so
 * HQ adds no native module: nothing to compile or download in the Docker build, no prebuilt
 * binary to trust, nothing to rebuild when the Node minor moves. HQ's load is small — tens of
 * agents, thousands of rows a day, one process — which is well inside what either handles.
 * The price: node:sqlite is still marked experimental in Node 22 (it prints one warning at start),
 * so the Docker image pins the Node 22 line, and test-hq-*.mjs exercise every statement HQ runs.
 * If a future Node changes the API, the change is in this one file.
 *
 * WHAT IS IN IT, and what is not. Agents and their limits; the agency's coins; every decision;
 * paper fills (there is no chain to read them back from); the chain transactions of every agent
 * wallet and the treasury, cached as the RPC returned them (the ledger is rebuilt from these);
 * the in-flight markers ("intents") written before anything is signed; equity points; ranks and
 * promotions; buybacks; single-use nonces; the event log the stream replays. Never a key, a
 * seed, an API key or an RPC URL: wallet.mjs holds the only secrets, and never hands them here.
 * Amounts are TEXT (decimal integers of lamports or raw token units), never REAL.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { plainText, TEXT_MAX } from "./text.mjs";

export const SCHEMA_VERSION = 1;

/** A live trade's id on the desk (the contract's ^[A-Za-z0-9_-]{1,64}$; a signature is longer):
 *  "live-" and 32 characters of its signature's SHA-256, stable for the same transaction. The
 *  trade's own signature is its `tx`. */
export const liveTradeId = (signature) => `live-${crypto.createHash("sha256").update(String(signature)).digest("base64url").slice(0, 32)}`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 999),
  name TEXT NOT NULL, cat TEXT NOT NULL, skin TEXT NOT NULL,
  strategy TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('paper','live')),
  status TEXT NOT NULL CHECK (status IN ('active','paused','retired')),
  wallet TEXT NOT NULL UNIQUE, coin_mint TEXT, hired_at TEXT NOT NULL,
  limits_json TEXT NOT NULL, settings_json TEXT NOT NULL,
  paper_bankroll TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agency_coins (
  mint TEXT PRIMARY KEY, symbol TEXT, name TEXT, program TEXT, decimals INTEGER, creator TEXT,
  source TEXT NOT NULL, registered_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY, symbol TEXT, name TEXT, decimals INTEGER, program TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY, agent_id INTEGER NOT NULL, t TEXT NOT NULL, action TEXT NOT NULL,
  mint TEXT, symbol TEXT, reason TEXT NOT NULL, mode TEXT NOT NULL, detail_json TEXT, rug_json TEXT);
CREATE INDEX IF NOT EXISTS decisions_t ON decisions (t DESC, id DESC);
CREATE INDEX IF NOT EXISTS decisions_agent ON decisions (agent_id, t DESC);
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY, agent_id INTEGER NOT NULL, mode TEXT NOT NULL, t TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')), mint TEXT NOT NULL, decimals INTEGER NOT NULL,
  sol TEXT NOT NULL, tokens TEXT NOT NULL, fee TEXT NOT NULL DEFAULT '0',
  pnl TEXT, pnl_pct TEXT, trigger TEXT NOT NULL, tx TEXT, decision_id TEXT, slot INTEGER, rug_json TEXT);
CREATE INDEX IF NOT EXISTS trades_t ON trades (t DESC, id DESC);
CREATE INDEX IF NOT EXISTS trades_agent ON trades (agent_id, mode, t);
CREATE TABLE IF NOT EXISTS paper_transfers (
  id TEXT PRIMARY KEY, agent_id INTEGER NOT NULL, t TEXT NOT NULL, kind TEXT NOT NULL, lamports TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY, agent_id INTEGER, wallet TEXT NOT NULL, kind TEXT NOT NULL, mint TEXT,
  trigger TEXT, decision_id TEXT, state TEXT NOT NULL, signature TEXT, last_valid_block_height INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, detail_json TEXT);
CREATE INDEX IF NOT EXISTS intents_open ON intents (state, wallet);
CREATE UNIQUE INDEX IF NOT EXISTS intents_sig ON intents (signature) WHERE signature IS NOT NULL;
-- one marker in flight per wallet, across every process that opens this file (the server, the
-- CLI): the insert is the check. A marker that landed (confirmed, not yet read back) is not in
-- flight: it holds the wallet's ledger-driven transactions in the executor, not its protections.
DROP INDEX IF EXISTS intents_one_open;
CREATE UNIQUE INDEX IF NOT EXISTS intents_one_inflight ON intents (wallet) WHERE state IN ('prepared','signed','sent');
CREATE TABLE IF NOT EXISTS chain_txs (
  address TEXT NOT NULL, signature TEXT NOT NULL, slot INTEGER NOT NULL, block_time INTEGER,
  err INTEGER NOT NULL, tx_json TEXT, PRIMARY KEY (address, signature));
CREATE INDEX IF NOT EXISTS chain_txs_order ON chain_txs (address, slot);
-- signatures the RPC listed (or the chain says landed) whose transaction it would not return
-- yet: read again on every pass until it does; the rest of the wallet's history goes on meanwhile
CREATE TABLE IF NOT EXISTS pending_reads (
  address TEXT NOT NULL, signature TEXT NOT NULL, slot INTEGER, block_time INTEGER, first_at TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (address, signature));
CREATE TABLE IF NOT EXISTS index_cursor (
  address TEXT PRIMARY KEY, newest_signature TEXT, complete INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS position_state (
  agent_id INTEGER NOT NULL, mode TEXT NOT NULL, mint TEXT NOT NULL, state_json TEXT NOT NULL,
  PRIMARY KEY (agent_id, mode, mint));
CREATE TABLE IF NOT EXISTS equity (
  agent_id INTEGER NOT NULL, mode TEXT NOT NULL, t TEXT NOT NULL, portfolio TEXT NOT NULL,
  net_deposits TEXT NOT NULL, unrealized TEXT NOT NULL, PRIMARY KEY (agent_id, mode, t));
CREATE TABLE IF NOT EXISTS ranks (
  agent_id INTEGER NOT NULL, mode TEXT NOT NULL, rank TEXT NOT NULL, PRIMARY KEY (agent_id, mode));
CREATE TABLE IF NOT EXISTS promotions (
  agent_id INTEGER NOT NULL, mode TEXT NOT NULL, t TEXT NOT NULL, from_rank TEXT NOT NULL, to_rank TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS buybacks (
  id TEXT PRIMARY KEY, t TEXT NOT NULL, state TEXT NOT NULL, leg_sigs TEXT NOT NULL DEFAULT '[]',
  burn_sig TEXT, sol_spent TEXT, cia_bought TEXT, detail_json TEXT);
CREATE TABLE IF NOT EXISTS nonces (
  nonce TEXT PRIMARY KEY, purpose TEXT NOT NULL, wallet TEXT, message TEXT, expires_at INTEGER NOT NULL, used_at INTEGER);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, t TEXT NOT NULL, kind TEXT NOT NULL, data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS emitted (key TEXT PRIMARY KEY, t TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, t TEXT NOT NULL, source TEXT NOT NULL, command_json TEXT NOT NULL, result TEXT NOT NULL);
`;

const plain = (row) => (row ? { ...row } : null);
const json = (text, fallback = null) => { try { return text === null || text === undefined ? fallback : JSON.parse(text); } catch { return fallback; } };

export function openDb(file, { clock = () => Date.now() } = {}) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  /* Columns added after a table was first made: added in place, never a table rebuilt. */
  const addColumn = (table, column, decl) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  };
  addColumn("decisions", "rug_json", "TEXT");
  addColumn("trades", "rug_json", "TEXT");
  addColumn("equity", "marks_json", "TEXT");
  addColumn("index_cursor", "resume_json", "TEXT");
  const have = db.prepare("SELECT value FROM meta WHERE key = 'schema'").get();
  if (!have) db.prepare("INSERT INTO meta (key, value) VALUES ('schema', ?)").run(String(SCHEMA_VERSION));
  else if (Number(have.value) > SCHEMA_VERSION) throw new Error(`the database was written by a newer HQ (schema ${have.value}); this build knows ${SCHEMA_VERSION}`);

  const iso = () => new Date(clock()).toISOString();
  const cache = new Map();
  const q = (sql) => { if (!cache.has(sql)) cache.set(sql, db.prepare(sql)); return cache.get(sql); };
  let depth = 0;
  /** Run `fn` in one transaction (nested calls join the outer one). */
  function tx(fn) {
    if (depth > 0) return fn();
    db.exec("BEGIN IMMEDIATE");
    depth++;
    try { const out = fn(); db.exec("COMMIT"); return out; }
    catch (error) { try { db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw error; }
    finally { depth--; }
  }

  const agentRow = (r) => (r ? {
    id: r.id, name: r.name, cat: r.cat, skin: r.skin, strategy: r.strategy, mode: r.mode, status: r.status, wallet: r.wallet,
    coinMint: r.coin_mint, hiredAt: r.hired_at, limits: json(r.limits_json, {}), settings: json(r.settings_json, {}),
    paperBankroll: BigInt(r.paper_bankroll), updatedAt: r.updated_at,
  } : null);

  const api = {
    raw: db, tx, iso,
    close() { db.close(); },

    /* ── agents ── */
    createAgent({ id, name, cat, skin, strategy, mode = "paper", status = "active", wallet, coinMint = null, limits, settings, paperBankroll }) {
      const t = iso();
      q(`INSERT INTO agents (id, name, cat, skin, strategy, mode, status, wallet, coin_mint, hired_at, limits_json, settings_json, paper_bankroll, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, name, cat, skin, strategy, mode, status, wallet, coinMint, t, JSON.stringify(limits), JSON.stringify(settings), String(paperBankroll), t);
      return api.getAgent(id);
    },
    getAgent: (id) => agentRow(q("SELECT * FROM agents WHERE id = ?").get(Number(id))),
    listAgents: () => q("SELECT * FROM agents ORDER BY id").all().map(agentRow),
    nextAgentId() { const r = q("SELECT MAX(id) AS m FROM agents").get(); return (r?.m ?? 0) + 1; },
    updateAgent(id, patch) {
      const cols = { name: "name", cat: "cat", skin: "skin", strategy: "strategy", mode: "mode", status: "status", coinMint: "coin_mint" };
      const sets = [], vals = [];
      for (const [k, c] of Object.entries(cols)) if (Object.hasOwn(patch, k)) { sets.push(`${c} = ?`); vals.push(patch[k]); }
      if ("limits" in patch) { sets.push("limits_json = ?"); vals.push(JSON.stringify(patch.limits)); }
      if ("settings" in patch) { sets.push("settings_json = ?"); vals.push(JSON.stringify(patch.settings)); }
      if (!sets.length) return api.getAgent(id);
      sets.push("updated_at = ?"); vals.push(iso());
      q(`UPDATE agents SET ${sets.join(", ")} WHERE id = ?`).run(...vals, Number(id));
      return api.getAgent(id);
    },

    /* ── the agency's coins and the token names HQ has read ── */
    upsertCoin({ mint, symbol = null, name = null, program = null, decimals = null, creator = null, source }) {
      /* a coin's symbol and name come from its metadata: plain and cut before they are kept */
      symbol = plainText(symbol, TEXT_MAX.symbol); name = plainText(name, TEXT_MAX.coinName);
      q(`INSERT INTO agency_coins (mint, symbol, name, program, decimals, creator, source, registered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (mint) DO UPDATE SET symbol = COALESCE(excluded.symbol, symbol), name = COALESCE(excluded.name, name),
         program = COALESCE(excluded.program, program), decimals = COALESCE(excluded.decimals, decimals), creator = COALESCE(excluded.creator, creator)`)
        .run(mint, symbol, name, program, decimals, creator, source, iso());
    },
    listCoins: () => q("SELECT * FROM agency_coins ORDER BY registered_at").all().map(plain),
    getCoin: (mint) => plain(q("SELECT * FROM agency_coins WHERE mint = ?").get(mint)),
    upsertToken({ mint, symbol = null, name = null, decimals = null, program = null }) {
      symbol = plainText(symbol, TEXT_MAX.symbol); name = plainText(name, TEXT_MAX.coinName);
      q(`INSERT INTO tokens (mint, symbol, name, decimals, program, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (mint) DO UPDATE SET symbol = COALESCE(excluded.symbol, symbol), name = COALESCE(excluded.name, name),
         decimals = COALESCE(excluded.decimals, decimals), program = COALESCE(excluded.program, program), updated_at = excluded.updated_at`)
        .run(mint, symbol, name, decimals, program, iso());
    },
    getToken: (mint) => plain(q("SELECT * FROM tokens WHERE mint = ?").get(mint)),

    /* ── decisions and trades ── */
    /** `rugCheck` is the contract's RugCheck of the check this decision was made on, or null. */
    addDecision({ id, agentId, t = iso(), action, mint = null, symbol = null, reason, mode, detail = null, rugCheck = null }) {
      q("INSERT INTO decisions (id, agent_id, t, action, mint, symbol, reason, mode, detail_json, rug_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, agentId, t, action, mint, plainText(symbol, TEXT_MAX.symbol), plainText(reason, TEXT_MAX.reason) ?? "(no reason given)", mode, detail === null ? null : JSON.stringify(detail), rugCheck === null ? null : JSON.stringify(rugCheck));
      return plain(q("SELECT * FROM decisions WHERE id = ?").get(id));
    },
    getDecision: (id) => plain(q("SELECT * FROM decisions WHERE id = ?").get(id)),
    /** Holds older than `beforeIso` go (a watch nobody followed, a model that held); every buy and
     *  sell decision stays, and so does any decision a trade names. Returns how many went. */
    pruneHolds(beforeIso) {
      return Number(q("DELETE FROM decisions WHERE action = 'hold' AND t < ? AND id NOT IN (SELECT decision_id FROM trades WHERE decision_id IS NOT NULL)").run(beforeIso).changes);
    },
    listDecisions: (agentId, limit = 50) => q("SELECT * FROM decisions WHERE agent_id = ? ORDER BY t DESC, id DESC LIMIT ?").all(agentId, limit).map(plain),
    decisionsBefore: (t, id, limit) => q("SELECT * FROM decisions WHERE (t < ? OR (t = ? AND id < ?)) ORDER BY t DESC, id DESC LIMIT ?").all(t, t, id, limit).map(plain),
    /** `rugCheck`: the check made before a buy (the contract's RugCheck), kept as it was; null for a sell. */
    upsertTrade({ id, agentId, mode, t, side, mint, decimals, sol, tokens, fee = 0n, trigger, tx = null, decisionId = null, slot = null, rugCheck = null }) {
      q(`INSERT INTO trades (id, agent_id, mode, t, side, mint, decimals, sol, tokens, fee, trigger, tx, decision_id, slot, rug_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET t = excluded.t, sol = excluded.sol, tokens = excluded.tokens, fee = excluded.fee, slot = excluded.slot,
         trigger = CASE WHEN trigger = 'manual' THEN excluded.trigger ELSE trigger END, decision_id = COALESCE(decision_id, excluded.decision_id),
         rug_json = COALESCE(rug_json, excluded.rug_json)`)
        .run(id, agentId, mode, t, side, mint, decimals, String(sol), String(tokens), String(fee), trigger, tx, decisionId, slot, rugCheck === null ? null : JSON.stringify(rugCheck));
    },
    setTradePnl(id, pnl, pnlPct) { q("UPDATE trades SET pnl = ?, pnl_pct = ? WHERE id = ?").run(pnl === null ? null : String(pnl), pnlPct, id); },
    listTrades: (agentId, mode) => q("SELECT * FROM trades WHERE agent_id = ? AND mode = ? ORDER BY t, id").all(agentId, mode).map(plain),
    tradesBefore: (t, id, limit) => q("SELECT * FROM trades WHERE (t < ? OR (t = ? AND id < ?)) ORDER BY t DESC, id DESC LIMIT ?").all(t, t, id, limit).map(plain),
    tradesSince: (t) => q("SELECT * FROM trades WHERE t >= ? ORDER BY t").all(t).map(plain),
    deleteLiveTradesNotIn(agentId, ids) {
      const rows = q("SELECT id FROM trades WHERE agent_id = ? AND mode = 'live'").all(agentId);
      const keep = new Set(ids);
      for (const r of rows) if (!keep.has(r.id)) q("DELETE FROM trades WHERE id = ?").run(r.id);
    },
    addPaperTransfer({ id, agentId, t = iso(), kind, lamports }) {
      q("INSERT OR IGNORE INTO paper_transfers (id, agent_id, t, kind, lamports) VALUES (?, ?, ?, ?, ?)").run(id, agentId, t, kind, String(lamports));
    },
    listPaperTransfers: (agentId) => q("SELECT * FROM paper_transfers WHERE agent_id = ? ORDER BY t, id").all(agentId).map(plain),

    /* ── in-flight markers ── */
    /** Open a marker. Returns null when the wallet already has one open (in this process or
     *  another): the unique index decides, so two processes can never both start a transaction. */
    createIntent({ id, agentId = null, wallet, kind, mint = null, trigger = null, decisionId = null, detail = null }) {
      const t = iso();
      try {
        q("INSERT INTO intents (id, agent_id, wallet, kind, mint, trigger, decision_id, state, created_at, updated_at, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?)")
          .run(id, agentId, wallet, kind, mint, trigger, decisionId, t, t, detail === null ? null : JSON.stringify(detail));
      } catch (error) {
        if (/UNIQUE constraint failed: intents\.wallet/.test(String(error?.message))) return null;
        throw error;
      }
      return api.getIntent(id);
    },
    getIntent: (id) => { const r = plain(q("SELECT * FROM intents WHERE id = ?").get(id)); if (r) r.detail = json(r.detail_json, null); return r; },
    updateIntent(id, { state, signature, lastValidBlockHeight, detail } = {}) {
      const cur = api.getIntent(id);
      if (!cur) throw new Error(`no intent ${id}`);
      q("UPDATE intents SET state = ?, signature = ?, last_valid_block_height = ?, updated_at = ?, detail_json = ? WHERE id = ?")
        .run(state ?? cur.state, signature ?? cur.signature, lastValidBlockHeight ?? cur.last_valid_block_height, iso(),
          JSON.stringify(detail === undefined ? cur.detail : { ...(cur.detail ?? {}), ...detail }), id);
      return api.getIntent(id);
    },
    /** Every marker not yet settled: prepared (not signed), signed (not known sent), sent (not
     *  confirmed) or landed (confirmed, but not yet read back into chain_txs). */
    openIntents: (wallet = null) => (wallet
      ? q("SELECT * FROM intents WHERE wallet = ? AND state IN ('prepared','signed','sent','landed') ORDER BY created_at").all(wallet)
      : q("SELECT * FROM intents WHERE state IN ('prepared','signed','sent','landed') ORDER BY created_at").all()).map((r) => ({ ...r, detail: json(r.detail_json, null) })),
    intentBySignature: (sig) => { const r = plain(q("SELECT * FROM intents WHERE signature = ?").get(sig)); if (r) r.detail = json(r.detail_json, null); return r; },
    listIntents: (limit = 100) => q("SELECT * FROM intents ORDER BY created_at DESC LIMIT ?").all(limit).map((r) => ({ ...r, detail: json(r.detail_json, null) })),

    /* ── the chain, cached ── */
    putChainTx({ address, signature, slot, blockTime, err, tx }) {
      q("INSERT OR REPLACE INTO chain_txs (address, signature, slot, block_time, err, tx_json) VALUES (?, ?, ?, ?, ?, ?)")
        .run(address, signature, Number(slot), blockTime ?? null, err ? 1 : 0, tx === null ? null : JSON.stringify(tx));
    },
    hasChainTx: (address, signature) => Boolean(q("SELECT 1 AS x FROM chain_txs WHERE address = ? AND signature = ?").get(address, signature)),
    /** One cached transaction ({ signature, slot, err (0/1), tx }), or null. */
    getChainTx: (address, signature) => { const r = q("SELECT * FROM chain_txs WHERE address = ? AND signature = ?").get(address, signature); return r ? { ...r, tx: json(r.tx_json, null) } : null; },
    listChainTxs: (address) => q("SELECT * FROM chain_txs WHERE address = ? ORDER BY slot, signature").all(address).map((r) => ({ ...r, tx: json(r.tx_json, null) })),
    getCursor: (address) => { const r = plain(q("SELECT * FROM index_cursor WHERE address = ?").get(address)); if (r) r.resume = json(r.resume_json, null); return r; },
    /** `resume`: a stretch of history still to read ({ before, until, newest }), or null. */
    setCursor(address, { newest, complete, note = null, resume = null }) {
      q(`INSERT INTO index_cursor (address, newest_signature, complete, updated_at, note, resume_json) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (address) DO UPDATE SET newest_signature = excluded.newest_signature, complete = excluded.complete, updated_at = excluded.updated_at, note = excluded.note, resume_json = excluded.resume_json`)
        .run(address, newest ?? null, complete ? 1 : 0, iso(), note, resume === null ? null : JSON.stringify(resume));
    },
    listCursors: () => q("SELECT * FROM index_cursor").all().map((r) => ({ ...r, resume: json(r.resume_json, null) })),
    /* ── transactions to read again ── */
    addPendingRead({ address, signature, slot = null, blockTime = null }) {
      q("INSERT OR IGNORE INTO pending_reads (address, signature, slot, block_time, first_at) VALUES (?, ?, ?, ?, ?)").run(address, signature, slot === null ? null : Number(slot), blockTime ?? null, iso());
    },
    listPendingReads: (address = null) => (address ? q("SELECT * FROM pending_reads WHERE address = ? ORDER BY slot, signature").all(address) : q("SELECT * FROM pending_reads ORDER BY address, slot").all()).map(plain),
    triedPendingRead(address, signature) { q("UPDATE pending_reads SET tries = tries + 1 WHERE address = ? AND signature = ?").run(address, signature); },
    dropPendingRead(address, signature) { q("DELETE FROM pending_reads WHERE address = ? AND signature = ?").run(address, signature); },
    /** Markers the owner closed on the chain's word (landed, not read back) whose transaction is
     *  still not in chain_txs: until it is, the wallet's ledger lacks it. */
    unreadIntents: (wallet) => q(`SELECT * FROM intents WHERE wallet = ? AND state = 'confirmed' AND json_extract(detail_json, '$.unread') = 1
      AND signature NOT IN (SELECT signature FROM chain_txs WHERE address = ?)`).all(wallet, wallet).map((r) => ({ ...r, detail: json(r.detail_json, null) })),

    /* ── what a strategy keeps about a position (entry time, peak, its own dials) ── */
    getPositionState: (agentId, mode, mint) => json(q("SELECT state_json FROM position_state WHERE agent_id = ? AND mode = ? AND mint = ?").get(agentId, mode, mint)?.state_json, null),
    setPositionState(agentId, mode, mint, state) {
      q("INSERT OR REPLACE INTO position_state (agent_id, mode, mint, state_json) VALUES (?, ?, ?, ?)").run(agentId, mode, mint, JSON.stringify(state));
    },
    deletePositionState(agentId, mode, mint) { q("DELETE FROM position_state WHERE agent_id = ? AND mode = ? AND mint = ?").run(agentId, mode, mint); },
    listPositionStates: (agentId, mode) => q("SELECT mint, state_json FROM position_state WHERE agent_id = ? AND mode = ?").all(agentId, mode).map((r) => ({ mint: r.mint, state: json(r.state_json, {}) })),

    /* ── equity, ranks, promotions ── */
    /** A snapshot of the agent's value, with the quote each position had then (`marks`: mint →
     *  { lamports, tokens }), so the drawdown and the chart can value that moment later. */
    addEquity({ agentId, mode, t = iso(), portfolio, netDeposits, unrealized, marks = null }) {
      const m = marks ? Object.fromEntries([...(marks instanceof Map ? marks : Object.entries(marks))].map(([k, v]) => [k, { lamports: String(v.lamports), tokens: String(v.tokens) }])) : null;
      q("INSERT OR REPLACE INTO equity (agent_id, mode, t, portfolio, net_deposits, unrealized, marks_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(agentId, mode, t, String(portfolio), String(netDeposits), String(unrealized), m ? JSON.stringify(m) : null);
    },
    listEquity: (agentId, mode) => q("SELECT * FROM equity WHERE agent_id = ? AND mode = ? ORDER BY t").all(agentId, mode).map((r) => ({ ...r, marks: json(r.marks_json, {}) })),
    getRank: (agentId, mode) => q("SELECT rank FROM ranks WHERE agent_id = ? AND mode = ?").get(agentId, mode)?.rank ?? null,
    setRank(agentId, mode, rank) { q("INSERT OR REPLACE INTO ranks (agent_id, mode, rank) VALUES (?, ?, ?)").run(agentId, mode, rank); },
    addPromotion({ agentId, mode, t = iso(), from, to }) { q("INSERT INTO promotions (agent_id, mode, t, from_rank, to_rank) VALUES (?, ?, ?, ?, ?)").run(agentId, mode, t, from, to); },
    listPromotions: (agentId, mode) => q("SELECT * FROM promotions WHERE agent_id = ? AND mode = ? ORDER BY t").all(agentId, mode).map(plain),

    /* ── buybacks ── */
    createBuyback({ id, t = iso(), state = "started", detail = null }) {
      q("INSERT INTO buybacks (id, t, state, detail_json) VALUES (?, ?, ?, ?)").run(id, t, state, detail === null ? null : JSON.stringify(detail));
      return api.getBuyback(id);
    },
    getBuyback: (id) => { const r = plain(q("SELECT * FROM buybacks WHERE id = ?").get(id)); if (r) { r.legSigs = json(r.leg_sigs, []); r.detail = json(r.detail_json, null); } return r; },
    updateBuyback(id, { state, legSigs, burnSig, solSpent, ciaBought, detail } = {}) {
      const cur = api.getBuyback(id);
      q("UPDATE buybacks SET state = ?, leg_sigs = ?, burn_sig = ?, sol_spent = ?, cia_bought = ?, detail_json = ? WHERE id = ?")
        .run(state ?? cur.state, JSON.stringify(legSigs ?? cur.legSigs), burnSig ?? cur.burn_sig, solSpent === undefined ? cur.sol_spent : String(solSpent),
          ciaBought === undefined ? cur.cia_bought : String(ciaBought), JSON.stringify(detail === undefined ? cur.detail : { ...(cur.detail ?? {}), ...detail }), id);
      return api.getBuyback(id);
    },
    /** Every buyback whose first leg was signed and not found failed, over ALL rows: what the
     *  policy has spent. `spent` is the recorded spend (the planned amount until the chain's figure
     *  replaces it). */
    buybackSpentTotal() {
      let total = 0n;
      for (const r of q("SELECT sol_spent FROM buybacks WHERE json_array_length(leg_sigs) > 0 AND state != 'failed'").all()) total += BigInt(r.sol_spent ?? 0);
      return total;
    },
    /** The buybacks whose $CIA was bought, oldest first, every one of them. */
    completedBuybacks: () => q("SELECT * FROM buybacks WHERE state IN ('bought','done') ORDER BY t").all().map((r) => ({ ...r, legSigs: json(r.leg_sigs, []), detail: json(r.detail_json, null) })),
    /** A buyback that stopped before its $CIA leg landed, or before its burn: the next run finishes
     *  it. (One still "wrapping" never reached a leg: its wrapped SOL is used by the next run.) */
    unfinishedBuyback: () => { const r = q("SELECT * FROM buybacks WHERE state IN ('started','leg1_sent','leg1_done','leg2_sent','bought') ORDER BY t LIMIT 1").get(); return r ? { ...r, legSigs: json(r.leg_sigs, []), detail: json(r.detail_json, null) } : null; },
    listBuybacks: (limit = 50) => q("SELECT * FROM buybacks ORDER BY t DESC LIMIT ?").all(limit).map((r) => ({ ...r, legSigs: json(r.leg_sigs, []), detail: json(r.detail_json, null) })),

    /* ── single-use nonces (perks challenges, admin requests) ── */
    createNonce({ nonce, purpose, wallet = null, message = null, expiresAt }) {
      q("INSERT INTO nonces (nonce, purpose, wallet, message, expires_at) VALUES (?, ?, ?, ?, ?)").run(nonce, purpose, wallet, message, expiresAt);
    },
    getNonce: (nonce) => plain(q("SELECT * FROM nonces WHERE nonce = ?").get(nonce)),
    /** Mark a nonce used; true only for the one caller that used it first. */
    useNonce(nonce, at) { return q("UPDATE nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL").run(at, nonce).changes === 1; },
    pruneNonces(before) { return Number(q("DELETE FROM nonces WHERE expires_at < ?").run(before).changes); },
    /** A wallet's unused challenges of one purpose, gone (a newer challenge replaces them). */
    dropUnusedNonces({ purpose, wallet }) { q("DELETE FROM nonces WHERE purpose = ? AND wallet = ? AND used_at IS NULL").run(purpose, wallet); },
    countNonces: () => q("SELECT COUNT(*) AS n FROM nonces").get().n,

    /* ── the event log the stream replays ── */
    addEvent(kind, data, t = iso()) {
      const r = q("INSERT INTO events (t, kind, data_json) VALUES (?, ?, ?)").run(t, kind, JSON.stringify(data));
      return Number(r.lastInsertRowid);
    },
    eventsAfter: (id, limit = 500) => q("SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?").all(Number(id), limit).map((r) => ({ id: r.id, t: r.t, kind: r.kind, data: json(r.data_json, null) })),
    lastEventId: () => q("SELECT MAX(id) AS m FROM events").get()?.m ?? 0,
    /** The oldest event the log still keeps (null when it keeps none). */
    firstEventId: () => q("SELECT MIN(id) AS m FROM events").get()?.m ?? null,
    pruneEvents(keep = 5000) { const last = api.lastEventId(); q("DELETE FROM events WHERE id <= ?").run(last - keep); },

    /* ── small state ── */
    /** Mark an event sent; true only the first time for `key` (each stream event is sent once). */
    emitOnce(key) { return q("INSERT OR IGNORE INTO emitted (key, t) VALUES (?, ?)").run(key, iso()).changes === 1; },
    getKv: (key) => json(q("SELECT value FROM kv WHERE key = ?").get(key)?.value, null),
    setKv(key, value) { q("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run(key, JSON.stringify(value)); },
    logAdmin({ source, command, result }) { q("INSERT INTO admin_log (t, source, command_json, result) VALUES (?, ?, ?, ?)").run(iso(), source, JSON.stringify(command), String(result).slice(0, 500)); },
    listAdminLog: (limit = 50) => q("SELECT * FROM admin_log ORDER BY id DESC LIMIT ?").all(limit).map(plain),
  };
  return api;
}
