/**
 * THE AGENT RUNNER: SNAPSHOT → PROTECTIONS → (ON SCHEDULE) THE MODEL → THE LIMITS → EXECUTE → JOURNAL.
 *
 * CoinMarketCat's agent, run by the service worker on its half-minute alarm. Each tick:
 *
 *   1. SNAPSHOT. One DexScreener read prices every token in the universe (and every token
 *      still held); when the model is due, fifteen-minute candles too (agent-market.mjs).
 *   2. PROTECTIONS, every tick, whether or not the model is due, reachable or paid for:
 *      the stop loss, the take profit and the daily drawdown breaker (agent-risk.mjs). An
 *      exit they order is executed before anything else. They run while the agent is paused
 *      and after it is stopped, for as long as it holds anything.
 *   3. THE MODEL, only while running and only when its schedule (15, 30 or 60 minutes) comes
 *      round: the owner's strategy, the snapshot, the vault, the positions and the recent
 *      decisions go to agent-brain.mjs; a proposal comes back, or a failure, which means no
 *      new entries this tick and nothing else.
 *   4. THE LIMITS: planOrders turns the proposal into clamped orders and named refusals.
 *   5. EXECUTE, sells first. PAPER — the default — fills at Jupiter's quote (the quote's
 *      expected output; a real fill can come in lower, down to the slippage floor) and
 *      signs nothing. LIVE asks Jupiter for the transaction and runs the same check before
 *      signing the xStock venue runs (xstock-lane.mjs checkBeforeSigning): the pair must be
 *      the settlement token and a listed token (`allowedPairs`, inside checkSwapTransaction),
 *      the lookup tables resolved on the owner's RPC, the wallet's other token accounts
 *      untouched, the engine's simulate guard, the exact input, and both accounts safe after
 *      the simulation; only then the engine's signSendConfirm, fixed to the AUTOPILOT WALLET
 *      (engine.mjs agentFences) — the key signs without a window, as it does for the sniper
 *      lane. The fill is read back from the confirmed transaction.
 *   6. JOURNAL every decision with its rationale, every refusal with its clause, every fill
 *      (with its signature when live), the breaker, the controls and the token usage, capped
 *      at JOURNAL_MAX entries in chrome.storage.local.
 *
 * WHEN THE WORKER DIES MID-TICK (Chrome closed, the machine asleep). The book is written after
 * every fill and the model's turn before it is asked, not only at the end of a tick; a live
 * swap is written down as in flight before the key signs it, and a worker that wakes to find
 * a buy in flight pauses the agent and says so. A live buy that was sent and whose outcome
 * cannot be read pauses it too: it may have landed as tokens this book does not hold.
 *
 * THE OWNER'S MONEY IN AND OUT is not a gain or a loss: a deposit or a withdrawal of the
 * settlement token (a read no fill explains) and a position withdrawn or moved by hand move
 * the UTC day's starting value and the peak with them (`settledAt`, `externalFlow`), so the
 * breaker judges trading only. While the owner's withdrawal sweeps the wallet the ticks stand
 * aside. Pause, stop, liquidate and withdraw stop new buys from the moment they are asked,
 * even by a tick already waiting on the model; Liquidate all keeps selling, tick after tick,
 * what it could not sell at once.
 *
 * WHAT THE MODEL CANNOT REACH. It proposes buy, sell or hold for a listed token; nothing it
 * returns is read as a limit, and nothing here writes the spec but `saveSpec`, which only
 * the owner's pages call. The WITHDRAWAL is not in this file at all: the worker sweeps the
 * autopilot wallet to the connected Phantom address (the autopilot wallet's existing sweep)
 * when the owner asks from the popup, and then tells this runner which
 * positions left (`markWithdrawn`). There is no code path from a decision to a sweep.
 *
 * THE KEY. This file never sees the owner's API key (the worker hands the brain a reader)
 * and never holds a signing key (it reaches a signature only through the engine's fences).
 * Everything else — the clock, storage, the market, the brain, Jupiter, the fences — is
 * injected, so test-agent-runner.mjs runs it end to end with no network.
 */
import { describeMint, parseMintExtensions, assertTradeableExtensions, TOKEN_2022_PROGRAM } from "../../vendor/executor/token2022.mjs";
import {
  AGENT_BOUNDS, AGENT_MAX_BUY_IMPACT_PCT, AGENT_PRIORITY_FEE_LAMPORTS, AGENT_MIN_SOL_LAMPORTS, AGENT_UNMEASURED, AGENT_RUNS_WHERE,
  normalizeAgentSpec, universeEntries, settlementFor, allowedPairsFor, agentStartProblems, agentArmSentence,
} from "./agent-strategy.mjs";
import { rollDay, protections, planOrders, vaultView, unitsOf } from "./agent-risk.mjs";
import { BrainError } from "./agent-brain.mjs";
import {
  checkQuote, checkSwapTransaction, loadLookupTables, lookupTableKeysOf, checkWritableCustody, checkSafeAfter, assertPairAllowed,
  JupiterError, SwapCheckError,
} from "./jupiter-swap.mjs";
import { associatedTokenAddress, fillFromTransaction, unitsToRaw, rawToUnits, RENT_EXEMPT_EMPTY_ACCOUNT_LAMPORTS } from "./tx.mjs";

export const AGENT_SPEC_STORAGE_KEY = "coinmarketcat:agent:spec";
export const AGENT_STATE_STORAGE_KEY = "coinmarketcat:agent:state";
export const AGENT_STATE_VERSION = 1;
export const JOURNAL_MAX = 300;
export const CLOSED_MAX = 200;
/** How often a held position with no price is said out loud, and a locked wallet's sell. */
const NOTE_EVERY_MS = 10 * 60_000;
const ARMABILITY_EVERY_MS = 15_000;
/** The longest the ticks stand aside for the owner's withdrawal (the worker ends it sooner). */
const WITHDRAW_HOLD_MS = 15 * 60_000;
const LAMPORTS = 1_000_000_000;

export class AgentError extends Error {
  constructor(clause, message, detail = {}) { super(message); this.name = "AgentError"; this.clause = clause; this.detail = detail; }
}

const freshStats = () => ({ realizedUsd: 0, wins: 0, losses: 0, fills: 0, peakEquityUsd: null, maxDrawdownPct: 0, feesLamports: 0 });
export function freshAgentState() {
  return {
    v: AGENT_STATE_VERSION,
    status: "stopped",           // stopped | running | paused
    mode: "paper",               // the book's mode: what it was last started in
    paper: { settlementUsd: null, startedWithUsd: null },
    positions: {},               // mint → { mint, symbol, decimals, program, qtyRaw, costUsd, boughtUsd, soldUsd, openedAt, live, lastPriceUsd, lastPriceAt }
    day: null,                   // agent-risk.mjs rollDay's ledger
    closed: [],                  // newest first
    journal: [],                 // newest first
    stats: { paper: freshStats(), live: freshStats() },
    usage: { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    nextBrainAt: 0, lastBrainAt: null, lastTickAt: null, startedAt: null,
    lastView: null, lastSettlementUsd: null, notes: {},
    liquidating: null,           // { at } while Liquidate all still has something to sell
    inflight: null,              // { side, mint, symbol, at } while a live swap is being signed and sent
  };
}

const isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const short = (m) => (typeof m === "string" && m.length > 12 ? `${m.slice(0, 4)}…${m.slice(-4)}` : String(m));
const usd = (n) => (n === null || n === undefined || !Number.isFinite(n) ? "not read" : `$${n.toFixed(2)}`);
const r = (n, d = 4) => (n === null || n === undefined || !Number.isFinite(n) ? null : Number(n.toFixed(d)));
const clip = (s, n) => { const t = String(s ?? ""); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function createAgentRunner({
  clock = () => Date.now(),
  storage,                    // { get(key), set(key, value) } — the worker wraps chrome.storage.local
  market,                     // agent-market.mjs createMarket()
  brain,                      // agent-brain.mjs createBrain()
  jupiter,                    // the one keyless Jupiter client the worker shares with the xStock venue
  fences = () => null,        // () => engine.agentFences(): { rpc(), wallet(), ready(), simulateGuard, signSendConfirm } | null
  hasApiKey = async () => false,
  log = () => {},
  notify = () => {},
} = {}) {
  if (!storage || typeof storage.get !== "function" || typeof storage.set !== "function") throw new Error("createAgentRunner needs a storage with get() and set()");
  let spec = normalizeAgentSpec({});
  let S = freshAgentState();
  let loaded = false;
  let busy = false;
  let chain = Promise.resolve();
  let armability = null;              // the last live checklist, and when it was read
  const exclusive = (fn) => { const p = chain.then(() => fn()); chain = p.catch(() => {}); return p; };
  /* The owner's pause, stop, liquidate and withdraw wait their turn behind a tick that may be
     waiting on the model; from the moment one is asked, that tick makes no new buy. */
  let haltsAsked = 0;
  const halting = (fn) => { haltsAsked++; return fn().finally(() => { haltsAsked--; }); };
  let withdrawingSince = 0;           // the owner's withdrawal is sweeping the wallet: no tick until it ends

  /* ── persistence and the journal ──────────────────────────────────────────────────── */
  async function load() {
    if (loaded) return;
    loaded = true;
    try { spec = normalizeAgentSpec((await storage.get(AGENT_SPEC_STORAGE_KEY)) ?? {}); }
    catch (error) { spec = normalizeAgentSpec({}); say(`the stored agent spec was not valid (${error.message}); the defaults are shown — save it again in Options`); }
    const saved = await storage.get(AGENT_STATE_STORAGE_KEY);
    if (isPlainObject(saved) && saved.v === AGENT_STATE_VERSION) {
      const fresh = freshAgentState();
      S = { ...fresh, ...saved, stats: { paper: { ...freshStats(), ...(saved.stats?.paper ?? {}) }, live: { ...freshStats(), ...(saved.stats?.live ?? {}) } },
        usage: { ...fresh.usage, ...(saved.usage ?? {}) }, notes: isPlainObject(saved.notes) ? saved.notes : {} };
    }
    /* THE WORKER STOPPED MID-SWAP (Chrome closed, the machine slept, the worker was ended)
       between signing a live swap and booking it. A sell is found by the next sell, which
       reads the wallet first. A buy may have landed as tokens this book does not know, with
       no stop loss watching them: the agent is paused and the owner told. */
    if (isPlainObject(S.inflight)) {
      const f = S.inflight;
      S.inflight = null;
      if (f.side === "buy") {
        if (S.status === "running") S.status = "paused";
        journal("control", { action: "paused", message: `PAUSED: the extension stopped while a live buy of ${f.symbol} was being signed and sent (${new Date(f.at).toISOString()}). If it landed, the autopilot wallet holds ${f.symbol} this book does not know, and no stop loss or take profit watches it. Check the wallet on an explorer and sell it by hand if it is there, then resume.` });
        notify({ kind: "attention", mint: f.mint, title: "CoinMarketCat agent paused: a live buy may have landed unbooked", body: `The extension stopped while buying ${f.symbol}. Check the autopilot wallet before resuming.` });
      } else journal("note", { mint: f.mint, symbol: f.symbol, message: `the extension stopped while a live sell of ${f.symbol} was being sent; the next sell reads the wallet first, and closes the position if it landed` });
      await persist();
    }
  }
  async function persist() {
    try { await storage.set(AGENT_STATE_STORAGE_KEY, S); } catch (error) { try { log(`agent: the state could not be stored: ${error?.message ?? error}`); } catch { /* the host's problem */ } }
  }
  function journal(kind, fields = {}) {
    const entry = { at: clock(), kind, ...fields };
    S.journal.unshift(entry);
    if (S.journal.length > JOURNAL_MAX) S.journal.length = JOURNAL_MAX;
    return entry;
  }
  function say(line) { try { log(`agent: ${line}`); } catch { /* the host's problem */ } }
  /** Say something once per NOTE_EVERY_MS per key, so a half-minute tick does not flood the journal. */
  function noteOnce(key, kind, fields) {
    const now = clock();
    if (S.notes[key] && now - S.notes[key] < NOTE_EVERY_MS) return null;
    S.notes[key] = now;
    return journal(kind, fields);
  }
  const stats = () => S.stats[S.mode] ?? (S.stats[S.mode] = freshStats());

  /* ── who may trade live ───────────────────────────────────────────────────────────── */
  const settlement = () => settlementFor(spec);
  const liveMode = () => S.mode === "live";
  function armedNow() {
    if (spec.mode !== "live") return false;          // paper never reaches for the wallet
    const f = fences();
    if (!f) return false;
    const wallet = f.wallet();
    return Boolean(wallet) && f.ready() === true && spec.liveAck === agentArmSentence(spec, wallet);
  }
  /** The live checklist: every item must be green to start live. Reads the chain, so it is
   *  cached for ARMABILITY_EVERY_MS unless forced. */
  async function liveArmability({ force = false } = {}) {
    if (!force && armability && clock() - armability.at < ARMABILITY_EVERY_MS) return armability;
    const items = [];
    const add = (name, ok, detail) => items.push({ name, ok: ok === true, detail });
    const f = fences();
    const rpc = f?.rpc?.() ?? null;
    const wallet = f?.wallet?.() ?? null;
    add("rpc_configured", Boolean(rpc), rpc ? "reads, simulates and sends through the RPC set in Options" : "set an RPC URL in Options: live trades read and simulate on it");
    add("autopilot_wallet_created", Boolean(wallet), wallet ? `the autopilot wallet is ${wallet}` : "create the autopilot wallet in the popup");
    add("autopilot_unlocked", Boolean(wallet) && f.ready() === true, wallet && f.ready() ? "unlocked; locking stops the agent signing" : "unlock the autopilot wallet in the popup");
    let settlementUsd = null, lamports = null;
    if (rpc && wallet) {
      try { settlementUsd = await readSettlementUsd(rpc, wallet); } catch { settlementUsd = null; }
      try { lamports = BigInt(await rpc.getBalance(wallet)); } catch { lamports = null; }
    }
    const s = settlement();
    add("vault_funded", settlementUsd !== null && settlementUsd >= AGENT_BOUNDS.minVaultUsd, settlementUsd === null
      ? `the autopilot wallet's ${s.symbol} balance has not been read`
      : `it holds ${settlementUsd.toFixed(2)} ${s.symbol}; the vault minimum is $${AGENT_BOUNDS.minVaultUsd}${settlementUsd >= AGENT_BOUNDS.minVaultUsd ? "" : ` — fund it with ${s.symbol} from Phantom in the popup`}`);
    add("sol_for_fees", lamports !== null && lamports >= AGENT_MIN_SOL_LAMPORTS, lamports === null
      ? "the autopilot wallet's SOL balance has not been read"
      : `it holds ${Number(lamports) / LAMPORTS} SOL; network fees and each token's account rent need at least ${Number(AGENT_MIN_SOL_LAMPORTS) / LAMPORTS} SOL`);
    const keySaved = await hasApiKey();
    add("api_key_saved", keySaved, keySaved ? "your API key is saved in this browser" : "save your API key in Options → Agent");
    const problems = agentStartProblems(spec);
    add("spec_complete", problems.length === 0, problems.length ? problems.map((p) => p.detail).join("; ") : "named, described, with a universe");
    const expected = wallet ? agentArmSentence(spec, wallet) : null;
    add("live_ack_typed", Boolean(expected) && spec.liveAck === expected, !expected ? "no autopilot wallet to write the sentence for" : spec.liveAck === expected ? "the arm sentence matches, byte for byte" : `type exactly: ${expected}`);
    const blocking = items.filter((i) => !i.ok).map((i) => i.name);
    armability = { at: clock(), armable: blocking.length === 0, items, blocking, expectedAck: expected, settlementUsd, lamports: lamports === null ? null : lamports.toString() };
    return armability;
  }

  /* ── balances ─────────────────────────────────────────────────────────────────────── */
  async function readSettlementUsd(rpc, wallet) {
    const s = settlement();
    const raw = BigInt(await rpc.getTokenAccountBalance(associatedTokenAddress(wallet, s.mint, s.program)));
    return Number(rawToUnits(raw, s.decimals));       // a dollar stablecoin, at face value
  }
  async function settlementUsdNow() {
    if (!liveMode()) return S.paper.settlementUsd ?? 0;
    const f = fences();
    const rpc = f?.rpc?.(), wallet = f?.wallet?.();
    if (rpc && wallet) {
      try { return settledAt(await readSettlementUsd(rpc, wallet)); }
      catch (error) { noteOnce("settlement_read", "note", { message: `the ${settlement().symbol} balance could not be read (${error?.message ?? error}); the vault is valued with the last read, less what this agent spent since` }); }
    }
    return S.lastSettlementUsd ?? 0;
  }
  /**
   * THE OWNER'S MONEY IN AND OUT. S.lastSettlementUsd follows every live fill as it books,
   * so what a fresh read differs by is what no trade of this agent explains: a deposit from
   * Phantom, a withdrawal, a balance moved by hand. That is not a gain or a loss, so the
   * UTC day's starting value — the drawdown breaker's base — and the peak move with it: a
   * withdrawal does not trip the breaker, and a deposit does not blunt it.
   */
  function settledAt(v) {
    const was = S.lastSettlementUsd;
    S.lastSettlementUsd = v;
    if (Number.isFinite(was) && Math.abs(v - was) >= 0.01) externalFlow(v - was, `of ${settlement().symbol} ${v > was ? "arrived in" : "left"} the autopilot wallet`);
    return v;
  }
  function externalFlow(usdAmount, why) {
    if (!Number.isFinite(usdAmount) || usdAmount === 0) return;
    if (S.day && Number.isFinite(S.day.startEquityUsd)) S.day = Object.freeze({ ...S.day, startEquityUsd: Math.max(0, S.day.startEquityUsd + usdAmount) });
    const st = stats();
    if (Number.isFinite(st.peakEquityUsd)) st.peakEquityUsd = Math.max(0, st.peakEquityUsd + usdAmount);
    journal("flow", { usd: r(usdAmount, 2), message: `${usdAmount > 0 ? "+" : "−"}$${Math.abs(usdAmount).toFixed(2)} ${why} — not a trade: the day's starting value (the drawdown breaker's base) and the peak move with it` });
  }
  /** A held position's value at its last price (or its cost, never priced): what vaultView counts. */
  function heldValueUsd(p) {
    const qty = unitsOf(p.qtyRaw, p.decimals);
    return qty * (Number.isFinite(p.lastPriceUsd) && p.lastPriceUsd > 0 ? p.lastPriceUsd : qty > 0 ? p.costUsd / qty : 0);
  }

  /* ── one swap: paper or live, between the settlement token and one listed token ──── */
  function pairsNow() {
    const pairs = new Set(allowedPairsFor(spec));
    /* A position held in a token since dropped from the universe may still be SOLD back. */
    for (const mint of Object.keys(S.positions)) pairs.add(`${mint}>${spec.settlementMint}`);
    return pairs;
  }
  const mintFacts = new Map();
  async function readFacts(rpc, entry) {
    if (mintFacts.has(entry.mint)) return mintFacts.get(entry.mint);
    const s = settlement();
    const read = await rpc.getMultipleAccounts([entry.mint, s.mint]);
    const facts = [entry, s].map((e, i) => {
      const account = read.accounts?.[i] ?? null;
      let d;
      try { d = describeMint(account, e.mint); } catch (error) { throw new AgentError("mint_unreadable", `${e.symbol}: ${error.message}`); }
      if (d.decimals !== e.decimals || d.program !== e.program) throw new AgentError("mint_mismatch", `${e.symbol} reads ${d.decimals} decimals under ${d.program} on chain, not the ${e.decimals} under ${e.program} it was verified with`);
      if (d.program === TOKEN_2022_PROGRAM) {
        try { assertTradeableExtensions(parseMintExtensions(Buffer.from(account.data[0], account.data[1] || "base64")), e.mint); }
        catch (error) { throw new AgentError("mint_unsupported", `${e.symbol}: ${error.message}`); }
      }
      if (d.paused) throw new AgentError("mint_unsupported", `${e.symbol} is paused by its issuer`);
      return d;
    });
    mintFacts.set(entry.mint, facts);
    return facts;
  }

  /**
   * The swap. `side` buy spends `amountRaw` of the settlement token on `entry`; sell spends
   * `amountRaw` of `entry` for the settlement token. Returns the fill, or throws a clause.
   */
  async function swap({ side, entry, amountRaw, priority }) {
    const s = settlement();
    const inputMint = side === "buy" ? s.mint : entry.mint, outputMint = side === "buy" ? entry.mint : s.mint;
    assertPairAllowed({ inputMint, outputMint, allowedPairs: pairsNow() });
    const quoteArgs = { inputMint, outputMint, amountRaw, slippageBps: spec.slippageBps, slippageCapBps: spec.slippageBps, maxPriceImpactPct: side === "buy" ? AGENT_MAX_BUY_IMPACT_PCT : 100 };
    if (!liveMode()) {
      const raw = await jupiter.quote({ inputMint, outputMint, amountRaw, slippageBps: spec.slippageBps, priority });
      const q = checkQuote(raw, quoteArgs);
      return { paper: true, signature: null, qtyRaw: (side === "buy" ? q.outRaw : BigInt(amountRaw)).toString(), settlementRaw: (side === "buy" ? BigInt(amountRaw) : q.outRaw).toString(), impactPct: q.impactPct, feeLamports: 0 };
    }
    /* LIVE. The autopilot wallet, unlocked, on the owner's RPC. */
    const f = fences();
    if (!f) throw new AgentError("no_autopilot", "no autopilot wallet is wired into this extension");
    const rpc = f.rpc(), wallet = f.wallet();
    if (!rpc) throw new AgentError("no_rpc", "no RPC is set: a live trade reads and simulates on it");
    if (!wallet) throw new AgentError("no_autopilot", "create the autopilot wallet first");
    if (!f.ready()) throw new AgentError("autopilot_locked", "the autopilot wallet is locked: unlock it in the popup and the agent trades again");
    const [tokenFacts, settlementFacts] = await readFacts(rpc, entry);
    const tokenAta = associatedTokenAddress(wallet, entry.mint, tokenFacts.program);
    const settlementAta = associatedTokenAddress(wallet, s.mint, settlementFacts.program);
    if (side === "buy") {
      const held = BigInt(await rpc.getTokenAccountBalance(settlementAta));
      if (held < BigInt(amountRaw)) throw new AgentError("settlement_short", `the autopilot wallet holds ${rawToUnits(held, s.decimals)} ${s.symbol}, under the ${rawToUnits(amountRaw, s.decimals)} this buy spends`);
    }
    /* SOL for the fee, the priority fee and the rent floor; a buy also the new token's
       account rent. A sell asks only what a sell needs: a stop is not held up by rent. */
    const lamports = BigInt(await rpc.getBalance(wallet));
    const need = BigInt(RENT_EXEMPT_EMPTY_ACCOUNT_LAMPORTS) + 10_000n + BigInt(AGENT_PRIORITY_FEE_LAMPORTS) + (side === "buy" ? 2_039_280n : 0n);
    if (lamports < need) throw new AgentError("sol_short", `the autopilot wallet holds ${Number(lamports) / LAMPORTS} SOL; a swap needs up to ${Number(need) / LAMPORTS} SOL of fee, account rent and the rent floor`);
    const raw = await jupiter.quote({ inputMint, outputMint, amountRaw, slippageBps: spec.slippageBps, priority: "live" });
    const q = checkQuote(raw, quoteArgs);
    const built = await jupiter.swapTransaction({ quote: raw, wallet, priorityFeeLamports: AGENT_PRIORITY_FEE_LAMPORTS, priority: "live" });
    if (typeof built?.swapTransaction !== "string" || !built.swapTransaction) throw new SwapCheckError("malformed", "Jupiter returned no transaction");
    const txBase64 = built.swapTransaction;
    /* THE CHECK BEFORE SIGNING, on these bytes: the pair, the decode, the custody, the simulation. */
    const tables = await loadLookupTables(rpc, lookupTableKeysOf(txBase64));
    const checked = checkSwapTransaction({
      txBase64, wallet, inputMint, outputMint, inputProgram: side === "buy" ? settlementFacts.program : tokenFacts.program,
      outputProgram: side === "buy" ? tokenFacts.program : settlementFacts.program, amountRaw, quote: raw, slippageCapBps: spec.slippageBps,
      lookupTables: tables, maxPriorityFeeLamports: AGENT_PRIORITY_FEE_LAMPORTS, allowedPairs: pairsNow(),
    });
    const writable = await rpc.getMultipleAccounts(checked.writableAddresses);
    checkWritableCustody({ wallet, writableAddresses: checked.writableAddresses, accounts: writable.accounts ?? [], allowed: [settlementAta, tokenAta] });
    const guard = await f.simulateGuard({
      txBase64, wallet, ata: tokenAta, mint: entry.mint, side,
      expected: side === "buy" ? { baseOutRaw: q.minOutRaw, maxQuoteInRaw: BigInt(amountRaw) } : { qtyRaw: BigInt(amountRaw), minQuoteOutRaw: q.minOutRaw },
      quote: { mint: s.mint, ata: settlementAta, decimals: s.decimals, symbol: s.symbol },
    });
    if (side === "buy" && -BigInt(guard.quoteDeltaRaw) !== BigInt(amountRaw))
      throw new SwapCheckError("exact_input", `the simulation takes ${-BigInt(guard.quoteDeltaRaw)} raw ${s.symbol}, not exactly the ${amountRaw} asked`);
    checkSafeAfter(guard.post?.[1] ?? null, { wallet, mint: entry.mint, label: entry.symbol });
    checkSafeAfter(guard.post?.[2] ?? null, { wallet, mint: s.mint, label: s.symbol });
    const summary = `${side === "buy" ? "BUY" : "SELL"} ${entry.symbol} through Jupiter for the CoinMarketCat agent "${spec.name}" — ${side === "buy" ? `${rawToUnits(amountRaw, s.decimals)} ${s.symbol} in` : `at least ${rawToUnits(q.minOutRaw, s.decimals)} ${s.symbol} out`}`;
    /* Written down before the key signs: a worker that dies from here until the fill is
       booked leaves this behind, and load() says so (buy() and sell() clear it). */
    S.inflight = { side, mint: entry.mint, symbol: entry.symbol, at: clock() };
    await persist();
    const signed = await f.signSendConfirm({ txBase64, purpose: `agent-${side}`, mint: entry.mint, summary, lastValidBlockHeight: Number(built.lastValidBlockHeight), timeoutMs: 60_000, wallet });
    let fill;
    try { fill = fillFromTransaction(signed.tx, { wallet, mint: entry.mint, side, quoteMint: s.mint, quoteDecimals: s.decimals }); }
    catch (error) { throw new AgentError("fill_unreadable", `the ${side} landed (${signed.signature}) but its fill could not be read: ${error?.message ?? error}`, { signature: signed.signature }); }
    return { paper: false, signature: signed.signature, qtyRaw: fill.qtyRaw, settlementRaw: side === "buy" ? fill.quoteInRaw : fill.quoteOutRaw, impactPct: q.impactPct, feeLamports: Number(fill.feeLamports) + Number(fill.rentLamports) };
  }

  const clauseOf = (error) => (error instanceof SwapCheckError ? error.clause : error instanceof JupiterError ? `jupiter_${error.code}` : error instanceof AgentError ? error.clause : error?.clause ?? error?.code ?? "error");
  const entryFor = (mint) => universeEntries(spec).find((e) => e.mint === mint) ?? (S.positions[mint] ? { mint, symbol: S.positions[mint].symbol, decimals: S.positions[mint].decimals, program: S.positions[mint].program, source: "held" } : null);

  /** A buy of `usdAmount` of the settlement token into `mint`. */
  async function buy({ mint, usdAmount, reason, now }) {
    const entry = entryFor(mint);
    const s = settlement();
    const amountRaw = unitsToRaw(usdAmount.toFixed(2), s.decimals, `the ${s.symbol} amount`);
    let fill;
    try { fill = await swap({ side: "buy", entry, amountRaw, priority: "entry" }); }
    catch (error) { S.inflight = null; throw error; }
    const spent = Number(rawToUnits(fill.settlementRaw, s.decimals));
    const p = S.positions[mint] ?? { mint, symbol: entry.symbol, decimals: entry.decimals, program: entry.program, qtyRaw: "0", costUsd: 0, boughtUsd: 0, soldUsd: 0, openedAt: now, live: !fill.paper, lastPriceUsd: null, lastPriceAt: null };
    p.qtyRaw = (BigInt(p.qtyRaw) + BigInt(fill.qtyRaw)).toString();
    p.costUsd += spent; p.boughtUsd += spent;
    S.positions[mint] = p;
    if (fill.paper) S.paper.settlementUsd = (S.paper.settlementUsd ?? 0) - spent;
    else if (Number.isFinite(S.lastSettlementUsd)) S.lastSettlementUsd -= spent;
    const st = stats(); st.fills++; st.feesLamports += fill.feeLamports;
    const e = journal("fill", { side: "buy", mint, symbol: entry.symbol, usd: r(spent, 2), qtyRaw: fill.qtyRaw, decimals: entry.decimals, qty: r(unitsOf(fill.qtyRaw, entry.decimals), 8), priceUsd: r(spent / unitsOf(fill.qtyRaw, entry.decimals), 10), paper: fill.paper, signature: fill.signature, impactPct: r(fill.impactPct, 4), reason: clip(reason, 300) });
    /* Booked, so written now: not at the end of a tick the worker may not live to finish. */
    S.inflight = null;
    await persist();
    say(`${fill.paper ? "paper " : ""}BUY ${entry.symbol} for ${usd(spent)}${fill.signature ? `, sig ${fill.signature}` : ""}`);
    if (!fill.paper) notify({ kind: "agent", mint, title: `CoinMarketCat agent: bought ${entry.symbol}`, body: `${usd(spent)} of ${s.symbol}, signed by the autopilot wallet. ${clip(reason, 120)}` });
    return e;
  }

  /** A sell of `qtyRaw` of `mint` (the whole position when qtyRaw is null). */
  async function sell({ mint, qtyRaw = null, reason, protection = null, now }) {
    const p = S.positions[mint];
    if (!p) throw new AgentError("no_position", `nothing of ${short(mint)} is held`);
    const entry = entryFor(mint);
    const s = settlement();
    let amount = qtyRaw === null ? BigInt(p.qtyRaw) : BigInt(qtyRaw);
    if (liveMode() && p.live) {
      const f = fences();
      const rpc = f?.rpc?.(), wallet = f?.wallet?.();
      if (rpc && wallet) {
        const held = BigInt(await rpc.getTokenAccountBalance(associatedTokenAddress(wallet, mint, p.program)));
        if (held <= 0n) {
          const gone = heldValueUsd(p);
          closePosition(p, { reason: "gone: the wallet holds none of it — sold or moved by hand", now, unread: true });
          journal("note", { mint, symbol: p.symbol, message: `${p.symbol}: the autopilot wallet holds none of it — closed as sold by hand; its result reads "not read"` });
          externalFlow(-gone, `of ${p.symbol} (at its last price) left the autopilot wallet other than by this agent's sell`);
          await persist();
          return null;
        }
        if (held < amount) amount = held;
      }
    }
    let fill;
    try { fill = await swap({ side: "sell", entry, amountRaw: amount, priority: "live" }); }
    catch (error) { S.inflight = null; throw error; }
    const got = Number(rawToUnits(fill.settlementRaw, s.decimals));
    const sold = BigInt(fill.qtyRaw);
    const before = BigInt(p.qtyRaw);
    const part = before > 0n ? Number((sold * 1_000_000n) / before) / 1_000_000 : 1;
    const costPart = p.costUsd * Math.min(1, part);
    const realized = got - costPart;
    p.qtyRaw = (before - sold > 0n ? before - sold : 0n).toString();
    p.costUsd -= costPart; p.soldUsd += got;
    if (fill.paper) S.paper.settlementUsd = (S.paper.settlementUsd ?? 0) + got;
    else if (Number.isFinite(S.lastSettlementUsd)) S.lastSettlementUsd += got;
    const st = stats(); st.fills++; st.realizedUsd += realized; st.feesLamports += fill.feeLamports;
    const e = journal("fill", { side: "sell", mint, symbol: p.symbol, usd: r(got, 2), qtyRaw: fill.qtyRaw, decimals: p.decimals, qty: r(unitsOf(fill.qtyRaw, p.decimals), 8), priceUsd: r(got / unitsOf(fill.qtyRaw, p.decimals), 10), realizedUsd: r(realized, 2), paper: fill.paper, signature: fill.signature, protection, reason: clip(reason, 300) });
    if (BigInt(p.qtyRaw) === 0n) closePosition(p, { reason: protection ?? "the model sold it", now });
    S.inflight = null;
    await persist();
    say(`${fill.paper ? "paper " : ""}SELL ${p.symbol} for ${usd(got)} (${protection ?? "the model"})${fill.signature ? `, sig ${fill.signature}` : ""}`);
    if (!fill.paper) notify({ kind: "agent", mint, title: `CoinMarketCat agent: sold ${p.symbol}`, body: `${usd(got)} of ${s.symbol} back${protection ? ` — ${protection.replace(/_/g, " ")}` : ""}, signed by the autopilot wallet.` });
    return e;
  }

  function closePosition(p, { reason, now, unread = false }) {
    delete S.positions[p.mint];
    const pnlUsd = unread ? null : p.soldUsd - p.boughtUsd;
    const closed = { mint: p.mint, symbol: p.symbol, openedAt: p.openedAt, closedAt: now, boughtUsd: r(p.boughtUsd, 2), soldUsd: r(p.soldUsd, 2), pnlUsd: r(pnlUsd, 2),
      pnlPct: pnlUsd === null || !(p.boughtUsd > 0) ? null : r((pnlUsd / p.boughtUsd) * 100, 2), reason, live: p.live === true };
    S.closed.unshift(closed);
    if (S.closed.length > CLOSED_MAX) S.closed.length = CLOSED_MAX;
    const st = S.stats[p.live ? "live" : "paper"];
    if (pnlUsd !== null) { if (pnlUsd > 0) st.wins++; else st.losses++; }
  }

  /** Run one exit, journaling a failure by its clause. */
  async function exit(x, now) {
    try { return await sell({ mint: x.mint, reason: x.reason === "stop_loss" ? `stop loss: ${x.movePct}% from entry` : x.reason === "take_profit" ? `take profit: +${x.movePct}% from entry` : x.reason.replace(/_/g, " "), protection: x.reason, now }); }
    catch (error) {
      const clause = clauseOf(error);
      const e = noteOnce(`exit:${x.mint}:${clause}`, "refusal", { mint: x.mint, symbol: x.symbol, action: "sell", protection: x.reason, clause, message: `${x.reason.replace(/_/g, " ")} says sell ${x.symbol}, and the sell did not happen: ${error?.message ?? error} — tried again next tick` });
      if (e && clause === "autopilot_locked") notify({ kind: "attention", mint: x.mint, title: "CoinMarketCat agent: unlock the autopilot wallet to sell", body: `${x.symbol} should be sold (${x.reason.replace(/_/g, " ")}), and the autopilot wallet is locked.` });
      if (clause === "fill_unreadable") await haltOnUnreadable(error, { side: "sell", symbol: x.symbol });
      return null;
    }
  }
  /** A live swap that was SENT and whose outcome this book could not read: it may have
   *  landed. The agent is paused, and the owner told what that means for each side. */
  async function haltOnUnreadable(error, { side, symbol }) {
    if (S.status === "running") S.status = "paused";
    const what = side === "buy"
      ? `If that buy landed, the autopilot wallet holds ${symbol} this book does not know, and no stop loss or take profit watches it: check the signature on an explorer and sell it by hand if it landed, then resume`
      : `The position stays in the book, and the next sell reads the wallet first and closes it if this one landed: check the signature on an explorer before resuming`;
    journal("control", { action: "paused", message: `PAUSED: ${error.message}. ${what}. The protections keep running for what the book holds.` });
    notify({ kind: "attention", title: "CoinMarketCat agent paused", body: clip(`${error.message}. ${side === "buy" ? `If it landed, sell ${symbol} by hand: the book does not hold it.` : ""}`, 240) });
    await persist();
  }

  /* ── the model's turn ─────────────────────────────────────────────────────────────── */
  function contextFor({ now, snap, view, prices }) {
    const s = settlement();
    const day = S.day;
    const positions = view.rows.map((row) => {
      const p = S.positions[row.mint];
      return { mint: row.mint, symbol: row.symbol, qty: r(row.qty, 8), costUsd: r(row.costUsd, 2), entryPriceUsd: r(row.entryPriceUsd, 10), priceUsd: prices[row.mint] === null ? null : r(prices[row.mint], 10),
        valueUsd: r(row.valueUsd, 2), pnlPct: r(row.pnlPct, 2), heldMinutes: p ? Math.round((now - p.openedAt) / 60_000) : null,
        stopLossAtUsd: row.entryPriceUsd ? r(row.entryPriceUsd * (1 - spec.stopLossPct / 100), 10) : null, takeProfitAtUsd: row.entryPriceUsd ? r(row.entryPriceUsd * (1 + spec.takeProfitPct / 100), 10) : null };
    });
    const unrealized = view.rows.reduce((a, x) => a + x.pnlUsd, 0);
    const recent = S.journal.filter((j) => j.kind === "decision").slice(0, 5).map((j) => ({ at: new Date(j.at).toISOString(), rationale: clip(j.rationale, 400),
      actions: (j.actions ?? []).map((a) => ({ action: a.action, symbol: a.symbol, ...(a.usd !== undefined ? { usd: a.usd } : {}), ...(a.fraction !== undefined ? { fraction: a.fraction } : {}) })),
      outcomes: (j.outcomes ?? []).map((o) => `${o.symbol ?? short(o.mint)} ${o.action}: ${o.outcome}${o.clause ? ` (${o.clause})` : ""}`) }));
    return {
      now: new Date(now).toISOString(),
      agent: { name: spec.name, mode: S.mode, scheduleMinutes: spec.scheduleMinutes },
      settlement: { symbol: s.symbol, mint: s.mint, balanceUsd: r(view.settlementUsd, 2) },
      vault: { equityUsd: r(view.equityUsd, 2), positionsUsd: r(view.positionsUsd, 2), exposurePct: view.exposurePct, dayStartEquityUsd: r(day.startEquityUsd, 2),
        drawdownTodayPct: day.drawdownPct, tradesToday: day.trades, tradesLeftToday: Math.max(0, spec.maxTradesPerDay - day.trades), breakerTripped: day.tripped },
      limits: { maxPositionUsd: spec.maxPositionUsd, maxExposurePct: spec.maxExposurePct, stopLossPct: spec.stopLossPct, takeProfitPct: spec.takeProfitPct,
        maxDailyDrawdownPct: spec.maxDailyDrawdownPct, drawdownAction: spec.drawdownAction, maxTradesPerDay: spec.maxTradesPerDay, slippageBps: spec.slippageBps,
        minTradeUsd: AGENT_BOUNDS.minTradeUsd, minVaultUsd: AGENT_BOUNDS.minVaultUsd },
      positions,
      pnl: { realizedUsd: r(stats().realizedUsd, 2), unrealizedUsd: r(unrealized, 2), wins: stats().wins, losses: stats().losses },
      market: universeEntries(spec).map((u) => {
        const t = snap.tokens?.[u.mint] ?? {};
        return { mint: u.mint, symbol: u.symbol, priceUsd: t.priceUsd ?? null, change1hPct: t.change1hPct ?? null, change24hPct: t.change24hPct ?? null,
          volume24hUsd: t.volume24hUsd ?? null, liquidityUsd: t.liquidityUsd ?? null, indicators: t.indicators ?? null, missing: t.missing ?? ["priceUsd"] };
      }),
      recentDecisions: recent,
    };
  }

  async function think({ now, snap, prices }) {
    S.lastBrainAt = now;
    S.nextBrainAt = now + spec.scheduleMinutes * 60_000;
    const settlementUsd = await settlementUsdNow();
    const view = vaultView({ settlementUsd, positions: S.positions, prices });
    if (S.day.tripped && spec.drawdownAction === "liquidate") { journal("skipped", { message: "the daily drawdown breaker tripped and liquidates: the model is not asked again until UTC midnight" }); return; }
    if (view.equityUsd < AGENT_BOUNDS.minVaultUsd && Object.keys(S.positions).length === 0) {
      journal("skipped", { message: `the vault is worth ${usd(view.equityUsd)}, under the $${AGENT_BOUNDS.minVaultUsd} minimum: the model was not asked (no call, no cost)` });
      return;
    }
    if (liveMode() && !armedNow()) {
      journal("skipped", { message: "live, but not armed now (the autopilot wallet locked, or a limit changed since the sentence was typed): the model was not asked" });
      return;
    }
    const s = settlement();
    /* The turn is written down before the call: a worker that dies waiting on the model
       does not ask it again, and buy again, the moment it wakes. */
    await persist();
    let result;
    try { result = await brain.decide({ spec, settlementSymbol: s.symbol, context: contextFor({ now, snap, view, prices }), universeMints: spec.universe }); }
    catch (error) {
      const u = error?.detail?.usage;
      S.usage.calls++; S.usage.failures++;
      if (u) addUsage(u);
      const clause = error instanceof BrainError ? error.clause : "error";
      journal("brain_failure", { clause, message: clip(error?.message ?? error, 400), usage: u ?? null });
      say(`the model's turn failed (${clause}): no new entries this tick; the protections keep running`);
      return;
    }
    S.usage.calls++;
    addUsage(result.usage);
    const d = result.decision;
    const symbolOf = (mint) => entryFor(mint)?.symbol ?? short(mint);
    const entry = journal("decision", {
      model: result.model, toolChoice: result.toolChoice, rationale: d.rationale, usage: result.usage,
      actions: d.actions.map((a) => ({ action: a.action, mint: a.mint, symbol: symbolOf(a.mint), ...(a.usd !== undefined ? { usd: r(a.usd, 2) } : {}), ...(a.fraction !== undefined ? { fraction: r(a.fraction, 4) } : {}), confidence: a.confidence, reason: a.reason })),
      outcomes: [],
    });
    for (const x of d.rejected) {
      entry.outcomes.push({ mint: x.mint, symbol: x.mint ? symbolOf(x.mint) : null, action: x.action, outcome: "refused", clause: x.clause });
      journal("refusal", { mint: x.mint, symbol: x.mint ? symbolOf(x.mint) : null, action: x.action, clause: x.clause, message: x.message, from: "format" });
    }
    const halted = () => S.status !== "running" || haltsAsked > 0;
    const plan = planOrders({ spec, proposals: d.actions, positions: S.positions, prices, settlementUsd: view.settlementUsd, day: S.day, paused: halted() });
    for (const x of plan.refusals) {
      entry.outcomes.push({ mint: x.mint, symbol: x.mint ? symbolOf(x.mint) : null, action: x.action, outcome: "refused", clause: x.clause });
      journal("refusal", { mint: x.mint, symbol: x.mint ? symbolOf(x.mint) : null, action: x.action, clause: x.clause, message: x.message, from: "limits" });
    }
    for (const h of plan.holds) entry.outcomes.push({ mint: h.mint, symbol: symbolOf(h.mint), action: "hold", outcome: "held" });
    for (const o of plan.orders) {
      if (o.side === "buy" && halted()) {
        /* Paused, stopped, liquidating or withdrawing since the plan was made. */
        entry.outcomes.push({ mint: o.mint, symbol: symbolOf(o.mint), action: "buy", outcome: "refused", clause: "paused" });
        journal("refusal", { mint: o.mint, symbol: symbolOf(o.mint), action: "buy", clause: "paused", message: "the owner paused, stopped, liquidated or withdrew while this decision was being carried out: no new buys", from: "limits" });
        continue;
      }
      try {
        const fill = o.side === "buy" ? await buy({ mint: o.mint, usdAmount: o.usd, reason: o.reason, now }) : await sell({ mint: o.mint, qtyRaw: o.qtyRaw, reason: o.reason, now });
        S.day = Object.freeze({ ...S.day, trades: S.day.trades + 1 });
        entry.outcomes.push({ mint: o.mint, symbol: symbolOf(o.mint), action: o.side, outcome: fill ? "filled" : "closed", usd: fill?.usd ?? null, signature: fill?.signature ?? null, clampedBy: o.clampedBy?.length ? [...o.clampedBy] : undefined });
      } catch (error) {
        const clause = clauseOf(error);
        entry.outcomes.push({ mint: o.mint, symbol: symbolOf(o.mint), action: o.side, outcome: "failed", clause });
        journal("refusal", { mint: o.mint, symbol: symbolOf(o.mint), action: o.side, clause, message: clip(error?.message ?? error, 400), from: "execution" });
        /* SENT, OUTCOME UNKNOWN. A buy with no status inside the confirm window may still
           land, as tokens this book does not hold: paused, like a fill that cannot be read. */
        if (clause === "fill_unreadable" || (o.side === "buy" && clause === "ambiguous")) await haltOnUnreadable(error, { side: o.side, symbol: symbolOf(o.mint) });
      }
    }
  }
  function addUsage(u) {
    S.usage.inputTokens += u.inputTokens ?? 0; S.usage.outputTokens += u.outputTokens ?? 0;
    S.usage.cacheReadTokens += u.cacheReadTokens ?? 0; S.usage.cacheWriteTokens += u.cacheWriteTokens ?? 0;
  }

  /* ── the tick ─────────────────────────────────────────────────────────────────────── */
  function tokensToPrice() {
    const list = [...universeEntries(spec)];
    for (const p of Object.values(S.positions)) if (!list.some((u) => u.mint === p.mint)) list.push({ mint: p.mint, symbol: p.symbol, decimals: p.decimals, program: p.program, source: "held" });
    return list;
  }
  function trackEquity(equityUsd) {
    const st = stats();
    if (st.peakEquityUsd === null || equityUsd > st.peakEquityUsd) st.peakEquityUsd = equityUsd;
    if (st.peakEquityUsd > 0) st.maxDrawdownPct = Math.max(st.maxDrawdownPct, r(((st.peakEquityUsd - equityUsd) / st.peakEquityUsd) * 100, 4));
  }

  async function tick({ force = false } = {}) {
    if (busy) return { skipped: "busy" };
    return exclusive(async () => {
      busy = true;
      try {
        await load();
        const now = clock();
        /* The owner's withdrawal is moving the wallet's tokens: a stop loss or the breaker
           selling them mid-sweep would fight it, and the balances read now are half-moved. */
        if (withdrawingSince && now - withdrawingSince < WITHDRAW_HOLD_MS) return { skipped: "withdrawing" };
        for (const [k, at] of Object.entries(S.notes)) if (now - at >= NOTE_EVERY_MS) delete S.notes[k];
        const held = Object.keys(S.positions).length > 0;
        if (S.liquidating && !held) S.liquidating = null;
        if (S.status === "stopped" && !held) return { skipped: "stopped" };
        const due = S.status === "running" && (force || now >= Number(S.nextBrainAt ?? 0));
        const tokens = tokensToPrice();
        let snap;
        try { snap = await market.snapshot(tokens, { withCandles: due }); }
        catch (error) { snap = { at: now, tokens: {}, errors: [{ source: "market", code: "error", message: String(error?.message ?? error) }] }; }
        if (snap.errors?.length) noteOnce(`market:${snap.errors.map((e) => `${e.source}:${e.code}`).join(",")}`, "note", { message: `market data: ${snap.errors.map((e) => `${e.source} ${e.code}${e.message ? ` (${clip(e.message, 120)})` : ""}`).join("; ")} — a missing figure stays missing` });
        const prices = Object.fromEntries(tokens.map((t) => [t.mint, snap.tokens?.[t.mint]?.priceUsd ?? null]));
        for (const p of Object.values(S.positions)) if (prices[p.mint] !== null) { p.lastPriceUsd = prices[p.mint]; p.lastPriceAt = now; }

        /* the day, then the protections — before the model, and whatever it would say */
        let settlementUsd = await settlementUsdNow();
        const before = vaultView({ settlementUsd, positions: S.positions, prices });
        const rolled = rollDay(S.day, { now, equityUsd: before.equityUsd });
        if (rolled !== S.day) {
          if (S.day) journal("day", { message: `a new UTC day (${rolled.day}): the breaker resets; the day starts at ${usd(before.equityUsd)}` });
          S.day = rolled;
        }
        const prot = protections({ spec, positions: S.positions, prices, settlementUsd, day: S.day, now });
        S.day = prot.day;
        if (prot.breaker.justTripped) {
          journal("breaker", { drawdownPct: prot.breaker.drawdownPct, limitPct: prot.breaker.limitPct, action: spec.drawdownAction,
            message: `the daily drawdown breaker TRIPPED: the vault is ${prot.breaker.drawdownPct}% under its UTC-day start (${usd(prot.breaker.startEquityUsd)} → ${usd(prot.breaker.equityUsd)}), limit ${prot.breaker.limitPct}% — ${spec.drawdownAction === "liquidate" ? "selling everything back to the settlement token" : "no new buys"} until UTC midnight` });
          notify({ kind: "attention", title: "CoinMarketCat agent: the daily drawdown breaker tripped", body: `${prot.breaker.drawdownPct}% down today, limit ${prot.breaker.limitPct}%. ${spec.drawdownAction === "liquidate" ? "Selling everything." : "No new buys until UTC midnight."}` });
        }
        for (const n of prot.notes) if (S.positions[n.mint]) noteOnce(`price:${n.mint}`, "note", { mint: n.mint, message: n.message });
        for (const x of prot.exits) await exit(x, now);
        /* LIQUIDATE ALL, UNFINISHED: what it could not sell is tried again every tick, priced
           or not, until nothing is held or the owner resumes. */
        if (S.liquidating) {
          const tried = new Set(prot.exits.map((x) => x.mint));
          for (const p of Object.values({ ...S.positions })) if (!tried.has(p.mint)) await exit({ mint: p.mint, symbol: p.symbol, reason: "liquidate_all" }, now);
          if (Object.keys(S.positions).length === 0) {
            S.liquidating = null;
            journal("control", { action: "liquidated", message: `liquidate all: finished — everything is back in ${settlement().symbol}` });
          }
        }

        if (due) await think({ now, snap, prices });
        settlementUsd = await settlementUsdNow();
        const after = vaultView({ settlementUsd, positions: S.positions, prices });
        trackEquity(after.equityUsd);
        S.lastView = { at: now, settlementUsd: r(after.settlementUsd, 2), positionsUsd: r(after.positionsUsd, 2), equityUsd: r(after.equityUsd, 2), exposurePct: after.exposurePct,
          stale: [...after.stale], unpriced: [...after.unpriced], rows: after.rows.map((x) => ({ ...x, qty: r(x.qty, 8), valueUsd: r(x.valueUsd, 2), pnlUsd: r(x.pnlUsd, 2), pnlPct: r(x.pnlPct, 2), priceUsd: r(x.priceUsd, 10), entryPriceUsd: r(x.entryPriceUsd, 10) })) };
        S.lastTickAt = now;
        return { ticked: true, exits: prot.exits.length, asked: due };
      } finally {
        await persist();
        busy = false;
      }
    });
  }

  /* ── the owner's controls ─────────────────────────────────────────────────────────── */
  async function saveSpec(input) {
    return exclusive(async () => {
      await load();
      const next = normalizeAgentSpec({ ...input, liveAck: typeof input?.liveAck === "string" ? input.liveAck : spec.liveAck });
      if (S.status !== "stopped" && next.mode !== spec.mode) throw new AgentError("running", "stop the agent before switching between paper and live");
      if (Object.keys(S.positions).length && next.settlementMint !== spec.settlementMint) throw new AgentError("positions_held", `positions are held against ${settlement().symbol}: sell them before changing the settlement token`);
      spec = next;
      armability = null;
      await storage.set(AGENT_SPEC_STORAGE_KEY, spec);
      journal("control", { action: "spec_saved", message: `the spec was saved: ${spec.universe.length} tokens, ${spec.mode}, every ${spec.scheduleMinutes} min` });
      await persist();
      return spec;
    });
  }

  async function start({ liveAck } = {}) {
    return exclusive(async () => {
      await load();
      const now = clock();
      const problems = agentStartProblems(spec);
      if (problems.length) throw new AgentError("not_ready", `not ready: ${problems.map((p) => p.detail).join("; ")}`);
      if (!(await hasApiKey())) throw new AgentError("no_api_key", "save your API key in Options → Agent first: the model is called with your own key");
      if (spec.mode === "live") {
        if (typeof liveAck === "string") { spec = normalizeAgentSpec({ ...spec, liveAck }); await storage.set(AGENT_SPEC_STORAGE_KEY, spec); }
        const arm = await liveArmability({ force: true });
        if (!arm.armable) throw new AgentError("not_armed", `not armed: ${arm.blocking.join(", ")}`, { armability: arm });
        if (S.mode !== "live") {
          for (const p of Object.values(S.positions)) closePosition(p, { reason: "paper book closed: the agent went live", now, unread: true });
          S.mode = "live";
          S.day = null;
          S.lastSettlementUsd = null;
        }
        /* A restart on the same UTC day: what was deposited or withdrawn while it was
           stopped moves the day's base, as it would have while running. */
        if (arm.settlementUsd !== null) settledAt(arm.settlementUsd);
      } else {
        if (S.mode === "live" && Object.values(S.positions).some((p) => p.live)) throw new AgentError("positions_held", "the agent holds live positions: liquidate them before going back to paper");
        /* A paper start with nothing held is a fresh paper vault at the spec's amount, and a
           fresh paper scorecard: a paper figure never spans two vaults. */
        if (S.mode !== "paper" || S.paper.settlementUsd === null || Object.keys(S.positions).length === 0) {
          S.paper = { settlementUsd: spec.paperVaultUsd, startedWithUsd: spec.paperVaultUsd };
          S.stats.paper = freshStats();
          S.day = null;
        }
        S.mode = "paper";
      }
      S.status = "running";
      S.liquidating = null;
      S.startedAt = now;
      S.nextBrainAt = now;
      journal("control", { action: "started", message: `started in ${S.mode.toUpperCase()}: ${universeEntries(spec).map((u) => u.symbol).join(", ")}, settled in ${settlement().symbol}, the model asked every ${spec.scheduleMinutes} min${S.mode === "paper" ? `, a ${usd(S.paper.settlementUsd)} paper vault` : ""}` });
      say(`started in ${S.mode}`);
      await persist();
      return status();
    });
  }
  async function control(action) {
    const run = () => exclusive(async () => {
      await load();
      if (action === "pause" && S.status === "running") S.status = "paused";
      else if (action === "resume" && S.status === "paused") { S.status = "running"; S.liquidating = null; if (Number(S.nextBrainAt) < clock()) S.nextBrainAt = clock(); }
      else if (action === "stop") S.status = "stopped";
      else if (action === "run_now" && S.status === "running") S.nextBrainAt = 0;
      else return status();
      journal("control", { action, message: action === "pause" ? "paused: the model is not asked; the stop loss, take profit and breaker keep running"
        : action === "resume" ? "resumed" : action === "stop" ? "stopped: the model is not asked; anything still held keeps its protections until it is sold"
          : "the model is asked at the next tick" });
      await persist();
      return status();
    });
    return action === "pause" || action === "stop" ? halting(run) : run();
  }

  /** LIQUIDATE ALL: every position back to the settlement token, through the same checks,
   *  then paused, so the model does not buy straight back in. What does not sell now is
   *  tried again on every tick until nothing is held, or until the owner resumes. */
  async function liquidateAll() {
    return halting(() => exclusive(async () => {
      await load();
      const now = clock();
      S.liquidating = { at: now };
      const done = [];
      for (const p of Object.values({ ...S.positions })) {
        const x = { mint: p.mint, symbol: p.symbol, reason: "liquidate_all" };
        const fill = await exit(x, now);
        done.push({ mint: p.mint, symbol: p.symbol, sold: Boolean(fill), signature: fill?.signature ?? null });
      }
      const left = Object.keys(S.positions).length;
      if (!left) S.liquidating = null;
      if (S.status === "running") S.status = "paused";
      journal("control", { action: "liquidate_all", message: `liquidate all: ${done.filter((d) => d.sold).length} of ${done.length} position(s) sold back to ${settlement().symbol}${left ? `; ${left} still held, tried again every tick until sold (resuming stops that)` : ""}; the agent is paused` });
      await persist();
      return { done, status: status() };
    }));
  }

  /** Before the owner's withdrawal: pause, wait for anything in flight to settle, and hold
   *  the ticks off the wallet until markWithdrawn says the sweep is over. */
  async function pauseForWithdraw() {
    return halting(() => exclusive(async () => {
      await load();
      withdrawingSince = clock();
      if (S.status === "running") S.status = "paused";
      journal("control", { action: "withdraw_started", message: "withdrawal asked by the owner: the agent is paused while the autopilot wallet is swept to Phantom" });
      await persist();
    }));
  }
  /** After the owner's withdrawal (the worker's sweep; `result` null when it failed): every
   *  live position whose token left the wallet is closed as withdrawn, its result "not read"
   *  — it was moved, not sold — and its value leaves the day's base with it, as the swept
   *  settlement token does at the next read. The ticks resume. */
  async function markWithdrawn(result) {
    return exclusive(async () => {
      await load();
      withdrawingSince = 0;
      const now = clock();
      if (!result) {
        journal("control", { action: "withdraw_failed", message: `the withdrawal did not finish: the agent stays paused. ${settlement().symbol} that left is found at the next balance read; a position whose tokens left is closed at its next sell, which reads the wallet first` });
        await persist();
        return status();
      }
      const moved = new Set((result.tokens ?? []).map((t) => t.mint));
      for (const p of Object.values({ ...S.positions })) {
        if (!(p.live && moved.has(p.mint))) continue;
        const value = heldValueUsd(p);
        closePosition(p, { reason: `withdrawn to ${short(result.to)} as tokens (not sold)`, now, unread: true });
        externalFlow(-value, `of ${p.symbol} (at its last price) withdrawn to ${short(result.to)}`);
      }
      journal("withdraw", { to: result.to ?? null, tokens: (result.tokens ?? []).map((t) => ({ mint: t.mint, symbol: t.symbol, ui: t.ui, signature: t.signature })), sol: result.sol ?? null,
        message: `withdrawn to ${result.to ?? "?"}: ${(result.tokens ?? []).length} token(s)${result.sol ? ` and ${result.sol.sol} SOL` : ""}` });
      await persist();
      return status();
    });
  }

  /* ── what the popup and options page see ──────────────────────────────────────────── */
  function status() {
    const now = clock();
    const view = S.lastView;
    const st = stats();
    const decided = st.wins + st.losses;
    const unrealized = view?.rows?.reduce((a, x) => a + (x.pnlUsd ?? 0), 0) ?? 0;
    const s = settlement();
    return {
      spec: { ...spec, liveAck: undefined, liveAckTyped: Boolean(spec.liveAck), settlementSymbol: s.symbol, universeEntries: universeEntries(spec).map((u) => ({ mint: u.mint, symbol: u.symbol, source: u.source })) },
      status: S.status, mode: S.mode, specMode: spec.mode, armed: armedNow(), problems: agentStartProblems(spec), liquidating: Boolean(S.liquidating),
      armability: armability ? { armable: armability.armable, items: armability.items, blocking: armability.blocking, expectedAck: armability.expectedAck, at: armability.at } : null,
      vault: view ? { settlementUsd: view.settlementUsd, positionsUsd: view.positionsUsd, equityUsd: view.equityUsd, exposurePct: view.exposurePct, stale: view.stale, unpriced: view.unpriced, at: view.at }
        : { settlementUsd: S.mode === "paper" ? S.paper.settlementUsd : S.lastSettlementUsd, positionsUsd: null, equityUsd: null, exposurePct: null, stale: [], unpriced: [], at: null },
      positions: Object.values(S.positions).map((p) => {
        const row = view?.rows?.find((x) => x.mint === p.mint) ?? null;
        const qty = unitsOf(p.qtyRaw, p.decimals);
        const entry = qty > 0 ? p.costUsd / qty : null;
        return { mint: p.mint, symbol: p.symbol, qty: r(qty, 8), live: p.live, costUsd: r(p.costUsd, 2), entryPriceUsd: r(entry, 10), priceUsd: row?.priceUsd ?? p.lastPriceUsd ?? null, basis: row?.basis ?? null,
          valueUsd: row?.valueUsd ?? null, pnlUsd: row?.pnlUsd ?? null, pnlPct: row?.pnlPct ?? null, openedAt: p.openedAt,
          stopLossAtUsd: entry ? r(entry * (1 - spec.stopLossPct / 100), 10) : null, takeProfitAtUsd: entry ? r(entry * (1 + spec.takeProfitPct / 100), 10) : null };
      }),
      pnl: { realizedUsd: r(st.realizedUsd, 2), unrealizedUsd: r(unrealized, 2), wins: st.wins, losses: st.losses, winRatePct: decided ? r((st.wins / decided) * 100, 1) : null,
        maxDrawdownPct: r(st.maxDrawdownPct, 2), fills: st.fills, feesSol: r(st.feesLamports / LAMPORTS, 6), closed: S.closed.filter((c) => c.live === liveMode()).slice(0, 10) },
      day: S.day ? { day: S.day.day, trades: S.day.trades, maxTrades: spec.maxTradesPerDay, drawdownPct: S.day.drawdownPct, limitPct: spec.maxDailyDrawdownPct, tripped: S.day.tripped, action: spec.drawdownAction, startEquityUsd: r(S.day.startEquityUsd, 2) } : null,
      decisions: S.journal.filter((j) => j.kind === "decision" || j.kind === "brain_failure" || j.kind === "skipped").slice(0, 6),
      journal: S.journal.slice(0, 60),
      usage: { ...S.usage },
      nextBrainAt: S.status === "running" ? S.nextBrainAt : null, nextBrainInMs: S.status === "running" ? Math.max(0, Number(S.nextBrainAt) - now) : null,
      lastBrainAt: S.lastBrainAt, lastTickAt: S.lastTickAt, startedAt: S.startedAt,
      unmeasured: AGENT_UNMEASURED, runsWhere: AGENT_RUNS_WHERE, minTradeUsd: AGENT_BOUNDS.minTradeUsd, minVaultUsd: AGENT_BOUNDS.minVaultUsd,
      market: market?.status?.() ?? null, brain: brain?.status?.() ?? null,
      liveHeld: Object.values(S.positions).filter((p) => p.live).length,
    };
  }

  return Object.freeze({
    load, tick, saveSpec, start, pause: () => control("pause"), resume: () => control("resume"), stop: () => control("stop"), runNow: () => control("run_now"),
    liquidateAll, pauseForWithdraw, markWithdrawn, status, liveArmability,
    spec: () => spec, state: () => S, liveHeld: () => Object.values(S.positions).filter((p) => p.live).length,
  });
}
