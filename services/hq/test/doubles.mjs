/**
 * TEST DOUBLES FOR HQ'S TESTS (test-hq-*.mjs at the repository root). No test reaches the
 * network: the chain, Jupiter and the model are scripted here or replayed from fixtures/, and
 * each double records every call so a test can say what was — and was not — asked.
 */
import fs from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import bs58lib from "bs58";
import { harness, ROOT } from "../../../bots/test/doubles.mjs";
import { readConfig } from "../lib/config.mjs";
import { openDb } from "../lib/db.mjs";

export { harness, ROOT };
/** A published BIP-39 test-vector phrase (trezor/python-mnemonic vectors.json): never a real wallet. */
export const TEST_PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";
export const hqFixture = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "hq", rel), "utf8"));
export const botsFixture = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "bots", rel), "utf8"));

/** HQ's config for a test: paper, no switches, every secret blank unless the test sets it. */
export function testConfig(env = {}) {
  return readConfig({ HQ_DATA_DIR: "/nonexistent-test-dir", PORT: "18787", ...env });
}
export const memDb = (clock) => openDb(":memory:", clock ? { clock } : {});

/** A clock the test moves. */
export function testClock(start = Date.parse("2026-09-25T12:00:00Z")) {
  let t = start;
  const clock = () => t;
  clock.advance = (ms) => { t += ms; return t; };
  clock.set = (ms) => { t = ms; };
  return clock;
}

/** A token account's 165 bytes (SPL Token layout): mint, owner, amount, initialized. */
export function tokenAccountData({ mint, owner, amount, state = 1 }) {
  const b = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(b, 0);
  new PublicKey(owner).toBuffer().copy(b, 32);
  b.writeBigUInt64LE(BigInt(amount), 64);
  b[108] = state;
  return b;
}

/**
 * The extension's RPC surface (src/lib/rpc.mjs), scripted. `h` maps a method to a function of
 * its params. Unscripted methods throw, so nothing is answered by accident.
 */
export function extRpc(h = {}) {
  const calls = [];
  const call = async (method, params = []) => {
    calls.push({ method, params });
    if (!h[method]) throw Object.assign(new Error(`extRpc: no handler for ${method}`), { clause: "rpc_error" });
    return h[method](params);
  };
  return {
    calls, call, url: "https://rpc.test.invalid",
    async getMultipleAccounts(addresses) { const r = await call("getMultipleAccounts", [addresses.map(String)]); return { slot: r?.slot ?? 1_000, accounts: r?.accounts ?? r }; },
    async getBalance(address) { return BigInt(await call("getBalance", [address])); },
    async getTokenAccountBalance(ata) { return BigInt(await call("getTokenAccountBalance", [ata])); },
    async getTokenAccountsByOwner(owner, opts) { return call("getTokenAccountsByOwner", [owner, opts]); },
    async getLatestBlockhash() { return call("getLatestBlockhash", []); },
    async getBlockHeight() { return Number(await call("getBlockHeight", [])); },
    async simulateTransaction(tx, opts) { return call("simulateTransaction", [tx, opts]); },
    async sendTransaction(tx, opts) { return call("sendTransaction", [tx, opts]); },
    async getSignatureStatus(sig) { return call("getSignatureStatus", [sig]); },
    async getTransaction(sig) { return call("getTransaction", [sig]); },
  };
}

/** Signer spies: every call recorded; by default they refuse (a test that expects none fails loudly). */
export function signerSpies({ agent = null, treasury = null } = {}) {
  const calls = { agent: [], treasury: [] };
  return {
    calls,
    agent: (n, args) => { calls.agent.push({ n, ...args }); if (!agent) throw new Error("signer spy: an agent key was asked to sign"); return agent(n, args); },
    treasury: (args) => { calls.treasury.push(args); if (!treasury) throw new Error("signer spy: the treasury key was asked to sign"); return treasury(args); },
  };
}

/**
 * A Jupiter double: quote() answers a quote checkQuote accepts, at `rate` output units per input
 * unit (a BigInt pair { out, in }) or what `outFor({ inputMint, outputMint, amountRaw })` says,
 * `impact` as Jupiter's fraction. Every call is recorded.
 */
export function jupiterDouble({ rate = { out: 1n, in: 1n }, outFor = null, impact = "0.001", swap = null } = {}) {
  const calls = [];
  return {
    calls,
    async quote({ inputMint, outputMint, amountRaw, slippageBps }) {
      calls.push({ kind: "quote", inputMint, outputMint, amountRaw: String(amountRaw) });
      const out = outFor ? BigInt(outFor({ inputMint, outputMint, amountRaw: BigInt(amountRaw) })) : (BigInt(amountRaw) * rate.out) / rate.in;
      const min = (out * BigInt(10_000 - Number(slippageBps))) / 10_000n;
      return { inputMint, inAmount: String(amountRaw), outputMint, outAmount: String(out), otherAmountThreshold: String(min), swapMode: "ExactIn", slippageBps: Number(slippageBps),
        platformFee: null, priceImpactPct: impact, routePlan: [{ swapInfo: { ammKey: "11111111111111111111111111111111", label: "Test", inputMint, outputMint }, bps: 10000 }] };
    },
    async swapTransaction(args) { calls.push({ kind: "swap" }); if (!swap) throw new Error("jupiterDouble: no swap scripted"); return swap(args); },
    async prices() { calls.push({ kind: "prices" }); return {}; },
  };
}

/** A market double: marks from a map, curves from a map. */
export function marketDouble({ marks = new Map(), curves = new Map(), snapshot = null } = {}) {
  return {
    async marks(positions) { const m = new Map(); for (const p of positions) if (marks.has(p.mint)) m.set(p.mint, marks.get(p.mint)); return m; },
    async curves(mints) { return new Map(mints.map((x) => [x, curves.get(x) ?? null])); },
    async prices() { return { tokens: {}, solUsd: null, errors: [] }; },
    async snapshot(u, o) { if (!snapshot) throw new Error("marketDouble: no snapshot scripted"); return snapshot(u, o); },
  };
}

/** A rug checker double: a verdict per mint (default: passes). */
export function rugDouble(verdicts = {}) {
  const calls = [];
  const pass = { ok: true, failed: [], passed: ["mint_authority", "freeze_authority", "mint_extensions", "holders", "creator_share"], decimals: 6,
    checks: ["mint_authority", "freeze_authority", "holders", "creator_share"].map((id) => ({ id, pass: true, detail: `${id.replace(/_/g, " ")}: passed (test double)` })) };
  return { calls, async check(mint) { calls.push(mint); return verdicts[mint] ?? pass; } };
}

/** A well-formed address that is nobody's wallet: 32 bytes of `n` (1–255). */
export const addr = (n) => new PublicKey(Buffer.alloc(32, n)).toBase58();

/** Limits for a test agent (the crying-cat-safe defaults unless given). */
export const TEST_LIMITS = Object.freeze({ maxPerTradeSol: "0.05", maxOpenPositions: 3, stopLossPct: 8, takeProfitPct: 15, trailingStopPct: 5, dailyLossLimitSol: "0.1" });

/**
 * A paper HQ in memory: the database, the runtime, and doubles for Jupiter, the rug check and the
 * marks. Each agent gets a paper bankroll deposit, as agent.create gives it.
 */
export async function paperRig({ clock = testClock(), env = {}, agents = [{ id: 1 }], jupiter = jupiterDouble({ rate: { out: 1_000n, in: 1n } }), rug = rugDouble(),
  marks = new Map(), executor = null, rpc = extRpc({}), launches = [] } = {}) {
  const { createRuntime } = await import("../lib/runtime.mjs");
  const { createIndexer } = await import("../lib/indexer.mjs");
  const db = memDb(clock);
  const config = testConfig(env);
  for (const a of agents) {
    db.createAgent({ id: a.id, name: a.name ?? `Agent ${a.id}`, cat: a.cat ?? "crying-cat", skin: "standard", strategy: a.strategy ?? "crying-cat-safe", mode: a.mode ?? "paper",
      status: a.status ?? "active", wallet: a.wallet ?? addr(100 + a.id), coinMint: a.coinMint ?? null, limits: a.limits ?? TEST_LIMITS, settings: a.settings ?? {}, paperBankroll: a.bankroll ?? 1_000_000_000n });
    db.addPaperTransfer({ id: `bankroll:${a.id}`, agentId: a.id, kind: "deposit", lamports: a.bankroll ?? 1_000_000_000n });
  }
  const indexer = createIndexer({ db, rpc });
  const market = marketDouble({ marks });
  const runtime = createRuntime({ config, db, clock, indexer, market, rug, jupiter, rpc, executor, launches: () => launches });
  return { db, config, runtime, jupiter, rug, market, clock, indexer, marks };
}

/**
 * A transaction as getTransaction (encoding json) returns it, made by hand for a test: `keys` are
 * the static account keys (the first pays), `balances` maps a key to [pre, post] lamports,
 * `tokens` lists { index, owner, mint, decimals, pre, post } token balances, `instructions` are
 * { program, accounts: [keys], data: Buffer }. Only the fields classify.mjs reads.
 */
export function jsonTx({ signature, slot = 1, blockTime = 1_790_000_000, keys, balances = {}, tokens = [], instructions = [], fee = 5_000, err = null }) {
  const bs58 = (b) => base58(b);
  const pre = keys.map((k) => Number(balances[k]?.[0] ?? 0)), post = keys.map((k) => Number(balances[k]?.[1] ?? balances[k]?.[0] ?? 0));
  const tb = (when) => tokens.filter((t) => t[when] !== null && t[when] !== undefined).map((t) => ({ accountIndex: t.index, mint: t.mint, owner: t.owner, uiTokenAmount: { amount: String(t[when]), decimals: t.decimals ?? 6 } }));
  return {
    slot, blockTime,
    meta: { err, fee, preBalances: pre, postBalances: post, preTokenBalances: tb("pre"), postTokenBalances: tb("post"), loadedAddresses: { writable: [], readonly: [] } },
    transaction: { signatures: [signature], message: { accountKeys: keys, header: { numRequiredSignatures: 1 },
      instructions: instructions.map((ix) => ({ programIdIndex: keys.indexOf(ix.program), accounts: ix.accounts.map((a) => keys.indexOf(a)), data: bs58(ix.data ?? Buffer.alloc(0)) })) } },
  };
}
const base58 = (b) => bs58lib.encode(Buffer.from(b));
