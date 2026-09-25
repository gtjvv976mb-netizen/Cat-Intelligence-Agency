/**
 * THE SERVICE WORKER: THE ENGINE'S HOST, AND NOTHING ELSE.
 *
 * Everything that decides lives in src/lib/engine.mjs and the executor modules it
 * imports. This file gives the engine a chrome.storage store, a fetch-backed RPC, the
 * websocket feed, a bridge to the console tab where Phantom lives, notifications and a
 * badge — and routes the popup's and the options page's messages to it.
 *
 * The bridge is the one piece worth reading twice. Phantom injects its provider into web
 * pages only, never into an extension's own pages, so signing has to happen in a tab
 * showing the console page (site/console/, published under the repository's GitHub Pages URL;
 * /hawk on the Claude Company site and a local serve are matched too). The content script there opens a port to
 * this worker; the injected script there talks to window.phantom.solana. A sign request
 * goes worker → content → injected → Phantom → back the same way, with an id, and the
 * engine checks that what came back is the bytes it asked for before anything is sent.
 * No console tab, no bridge, no Phantom signing — and the lane says so on the checklist.
 *
 * THE AUTOPILOT WALLET is the other signer, and this file is the only one that may import
 * it (test-hawk-no-key.mjs pins that). The keystore is built here over chrome.storage.local
 * (the encrypted blob) and chrome.storage.session (the unlocked key: memory only, trusted
 * contexts only, gone with the browser), the signer is refreshed when the worker starts and
 * after every keystore call, and the engine is handed both signers: config.signerMode
 * picks which one buys; a sell goes to whichever holds the position. On autopilot nothing
 * needs the console tab to trade — the keepalive alarm and the feed's socket keep the
 * worker up. The console tab is needed for one thing then: FUNDING, which is a transfer
 * from Phantom this file builds and Phantom approves in ONE window. SWEEP sends every token
 * and every lamport above the rent floor back to Phantom, signed by the autopilot wallet.
 * Nothing here logs, stores or sends a passphrase or a key; the one message that hands a
 * key back is the recovery export, which needs the passphrase.
 *
 * THE xSTOCK VENUE (off by default) needs nothing new from this file: the engine builds its
 * feed poller on the worker's own fetch (the manifest's https host permission already covers
 * api.jup.ag, api.geckoterminal.com, api.dexscreener.com), and the same interval drives its
 * tick. The popup's venue switch is an ordinary SET_CONFIG. Its Jupiter client is the ONE
 * this file makes and shares with the agent, so the two never ask Jupiter for more than the
 * keyless 0.5 requests a second between them.
 *
 * THE AGENT (src/lib/agent-runner.mjs) is CoinMarketCat's agentic trader; the pump.fun engine
 * above is Snipurr, its sniper lane. This file hosts the agent too: it ticks on the same
 * half-minute keepalive alarm (the protections — stop loss, take profit, the daily drawdown
 * breaker — on every tick; the model on the owner's schedule), it is handed the engine's
 * fences bound to the autopilot wallet (engine.agentFences), and it is driven from the
 * extension's own pages through the AGENT messages. The owner's Anthropic API key is kept in
 * chrome.storage.local under AGENT_KEY_STORAGE, read here and nowhere else, and handed to the
 * brain only as a reader; the brain sends it to https://api.anthropic.com and nowhere else,
 * and no status, log line or page ever carries it (test-agent-no-leak.mjs). WITHDRAW is the
 * owner's: it pauses the agent and runs the existing sweep to the connected Phantom address;
 * the model has no message, no action and no code path that reaches it.
 *
 * THE AGENCY'S OTHER CATS live here too, each reusing the bots' own code (bots/):
 *   · POPCAT (src/lib/popcat-tab.mjs), the cat-coin scanner: a scan step when the popup's Popcat
 *     tab asks, and on the half-minute alarm only if the owner switched background scanning on.
 *     It reads pump.fun's listing and the chain, and signs nothing.
 *   · CRYING CAT (src/lib/crying-cat.mjs), the rug check for one mint the owner pastes. Reads only.
 *   · CASHCAT (src/lib/cashcat-tab.mjs), a cat coin of the owner's own on pump.fun: drafted by the
 *     owner or from a trend through the brain (which alone holds the Anthropic key), its logo drawn
 *     here on an OffscreenCanvas, its metadata pinned through the owner's Pinata JWT — kept in
 *     chrome.storage.local under PINATA_JWT_STORAGE, read by this file alone and sent only to
 *     Pinata's upload API — and its create transaction signed by the new mint's key (made, used once
 *     and dropped in session-wallet.mjs's createMintKeys) and the autopilot wallet, through the
 *     engine's fences. Auto mode ticks on the same alarm, armed by a typed sentence.
 *   · STOCK CATS (CoinMarketCat's tab; src/lib/stockcats.mjs and `stockCats` in CashCat's tab): a cat
 *     coin of the owner's own for one xStock, launched on StonkFun by hand from the autopilot wallet.
 *     This file gives the tab StonkFun's public API through its own client (stonkfunHttp, allowed
 *     www.stonkfun.xyz and the owner's RPC, nothing else) and the planner that proves StonkFun's
 *     numbers on chain, over the owner's own RPC only: the public endpoint answers 403 to the
 *     extension, so with no RPC set the plan is refused (no_rpc) before a request is made.
 * Their network clients are the bots' (bots/lib/http.mjs): an allow-list of hosts per cat, a pace
 * per host and a back-off, over this worker's own fetch.
 */
import { createHawkEngine } from "./lib/engine.mjs";
import { createRpc, createLogsFeed } from "./lib/rpc.mjs";
import { PUMPFUN_PROGRAM_ID } from "../vendor/executor/snipe-venue-pumpfun.mjs";
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM, describeMint, parseMintExtensions, assertTradeableExtensions } from "../vendor/executor/token2022.mjs";
import {
  CONFIG_DEFAULTS, normalizeConfig, websocketUrlFor, ConfigError, quoteEntryFor, STOCK_FOCUS_CHOICES, AUTOPILOT_UNLOCK_MINUTES, STONKFUN_XSTOCKS,
} from "./lib/config.mjs";
import { UI, BRIDGE, SIGN_ERRORS, BridgeError, nextId, AUTOPILOT, AGENT, POPCAT, CRYING, CASHCAT, STOCKCATS } from "./lib/protocol.mjs";
import { fromBase64, toBase64, sameMessage, signatureOf, transactionFeeLamports, unitsToRaw, rawToUnits } from "./lib/tx.mjs";
import {
  createKeystore, createSessionSigner, buildFundTransaction, buildSweepTransaction, buildTokenSweepTransaction,
  buildTokenFundTransaction, buildCloseTokenAccountsTransaction, sweepableLamports, MAX_CLOSES_PER_TRANSACTION,
  SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS, createMintKeys,
} from "./lib/session-wallet.mjs";
import { createJupiterClient } from "./lib/jupiter-swap.mjs";
import { createMarket } from "./lib/agent-market.mjs";
import { createBrain } from "./lib/agent-brain.mjs";
import { createAgentRunner } from "./lib/agent-runner.mjs";
import { SETTLEMENT_TOKENS, SOLANA_CATS, SOLANA_CATS_VERIFIED, AGENT_BOUNDS, settlementByMint, settlementFor } from "./lib/agent-strategy.mjs";
import { createHttp, HTTP_DEFAULTS } from "../bots/lib/http.mjs";
import { createRpc as createCatRpc, PUBLIC_RPC } from "../bots/lib/rpc.mjs";
import { HOSTS, URLS } from "../bots/lib/verified.mjs";
import { pinMetadata } from "../bots/cashcat/metadata.mjs";
import { planStonkfunLaunch } from "../bots/cashcat/stonkfun.mjs";
import { createPopcatTab, POPCAT_TAB_HOSTS } from "./lib/popcat-tab.mjs";
import { parseMintInput, createCryingCat } from "./lib/crying-cat.mjs";
import { createDraftDesk, DRAFT_HOSTS } from "./lib/cashcat-draft.mjs";
import { workerLogoRenderer } from "./lib/cashcat-logo.mjs";
import { createCashcatTab, CASHCAT_TAB_KEYS } from "./lib/cashcat-tab.mjs";

const STATE_KEY = "hawk:state";
const SHADOW_KEY = "hawk:shadow";
const CONFIG_KEY = "hawk:config";
const AUTOPILOT_META_KEY = "coinmarketcat:autopilot";   // { sweepTo, lastFund } — addresses and signatures, nothing secret
const PORT_NAME = "hawk-console";
const ALARM = "hawk-keepalive";
const EXPIRY_ALARM = "coinmarketcat-autopilot-expiry";
const AGENT_KEY_STORAGE = "coinmarketcat:agent:api-key";   // the owner's Anthropic API key: read by this file only
const FUND_PRIORITY_FEE_LAMPORTS = 10_000;   // a transfer is not in a race; this lands it under ordinary load
const SWEEP_COMPUTE_UNIT_LIMIT = 20_000;

/* ── storage ───────────────────────────────────────────────────────────────────────── */
let lastShadowFingerprint = null;
let lastShadowSaveAt = 0;
let saveTimer = null;
let pendingState = null;
const store = {
  async load() {
    const got = await chrome.storage.local.get([STATE_KEY, SHADOW_KEY]);
    const state = got[STATE_KEY] ?? null;
    if (state && got[SHADOW_KEY]) state.shadow = got[SHADOW_KEY];
    return state;
  },
  /** The book and the log go every second at most; the shadow rows, which can be
   *  megabytes, go only when they changed and at most every twenty seconds. */
  async save(state) {
    pendingState = state;
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      const s = pendingState; pendingState = null;
      if (!s) return;
      const { shadow, ...rest } = s;
      const writes = { [STATE_KEY]: rest };
      const rows = Object.values(shadow ?? {});
      const fingerprint = `${rows.length}:${rows.reduce((a, r) => a + (r.forward?.length ?? 0) + (r.outcome ? 1 : 0), 0)}`;
      if (fingerprint !== lastShadowFingerprint && Date.now() - lastShadowSaveAt > 20_000) {
        writes[SHADOW_KEY] = shadow ?? {};
        lastShadowFingerprint = fingerprint;
        lastShadowSaveAt = Date.now();
      }
      try { await chrome.storage.local.set(writes); } catch (error) { console.warn("hawk: storage.set failed", error); }
    }, 1_000);
  },
  /** Write whatever is queued now — before the engine is rebuilt on a changed RPC. */
  async flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const s = pendingState; pendingState = null;
    if (!s) return;
    const { shadow, ...rest } = s;
    lastShadowFingerprint = null;
    try { await chrome.storage.local.set({ [STATE_KEY]: rest, [SHADOW_KEY]: shadow ?? {} }); } catch (error) { console.warn("hawk: storage.set failed", error); }
  },
};
async function loadConfig() {
  const got = await chrome.storage.local.get(CONFIG_KEY);
  try { return normalizeConfig({ ...CONFIG_DEFAULTS, ...(got[CONFIG_KEY] ?? {}) }); }
  catch (error) { console.warn("hawk: stored config was malformed, using defaults:", error.message); return normalizeConfig(CONFIG_DEFAULTS); }
}
async function saveConfig(config) { await chrome.storage.local.set({ [CONFIG_KEY]: config }); }

/* ── the autopilot wallet's keystore ───────────────────────────────────────────────────
   The { get, set, remove } shape session-wallet.mjs asks for, over the two chrome areas.
   The session area is pinned to trusted contexts (this worker and the extension's own
   pages): a content script cannot read it. */
const chromeArea = (area) => ({
  async get(key) { const got = await area.get(key); return got?.[key]; },
  async set(key, value) { await area.set({ [key]: value }); },
  async remove(key) { await area.remove(key); },
});
try { Promise.resolve(chrome.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })).catch(() => {}); } catch { /* older Chrome: trusted-only is the default */ }
const keystore = createKeystore({ storage: chromeArea(chrome.storage.local), session: chromeArea(chrome.storage.session) });
const sessionSigner = createSessionSigner({ keystore });
async function readMeta() { const got = await chrome.storage.local.get(AUTOPILOT_META_KEY); return got[AUTOPILOT_META_KEY] ?? {}; }
async function writeMeta(patch) { await chrome.storage.local.set({ [AUTOPILOT_META_KEY]: { ...(await readMeta()), ...patch } }); }

/* ── the bridge to the console tab ─────────────────────────────────────────────────── */
const bridgeState = { port: null, tabId: null, origin: null, wallet: null, pending: new Map() };
const bridge = {
  isReady: () => bridgeState.port !== null,
  wallet: () => bridgeState.wallet,
  async request(type, payload = {}, { timeoutMs = 30_000 } = {}) {
    if (!bridgeState.port || bridgeState.tabId === null) throw new BridgeError(SIGN_ERRORS.NO_BRIDGE, "no console tab is open — open the console page and connect Phantom there");
    const id = nextId("bridge");
    const message = { type, id, ...payload };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        bridgeState.pending.delete(id);
        reject(new BridgeError(SIGN_ERRORS.TIMEOUT, `no answer from Phantom inside ${timeoutMs}ms`));
      }, timeoutMs);
      bridgeState.pending.set(id, { resolve, reject, timer });
      try { bridgeState.port.postMessage(message); }
      catch (error) {
        clearTimeout(timer); bridgeState.pending.delete(id);
        reject(new BridgeError(SIGN_ERRORS.NO_BRIDGE, `the console tab did not take the request: ${error?.message ?? error}`));
      }
    });
  },
  async connect({ onlyIfTrusted = false } = {}) { return bridge.request(BRIDGE.CONNECT, { onlyIfTrusted }, { timeoutMs: 60_000 }); },
  async disconnect() { return bridge.request(BRIDGE.DISCONNECT, {}, { timeoutMs: 10_000 }); },
  async signTransaction({ txBase64, purpose, mint, summary, timeoutMs, wallet }) {
    if (!bridgeState.wallet) throw new BridgeError(SIGN_ERRORS.NO_WALLET, "Phantom is not connected on the console page");
    if (wallet && wallet !== bridgeState.wallet) throw new BridgeError(SIGN_ERRORS.WALLET_MISMATCH, `Phantom is connected as ${bridgeState.wallet}, not ${wallet}`);
    return bridge.request(BRIDGE.SIGN, { txBase64, purpose, mint, summary, wallet: bridgeState.wallet }, { timeoutMs: Number(timeoutMs) || 25_000 });
  },
};
function settleReply(msg) {
  const p = bridgeState.pending.get(msg.id);
  if (!p) return;
  clearTimeout(p.timer);
  bridgeState.pending.delete(msg.id);
  if (msg.ok) p.resolve(msg.result);
  else p.reject(new BridgeError(msg.error?.code ?? SIGN_ERRORS.PROVIDER, msg.error?.message ?? "Phantom refused", msg.error ?? {}));
}
function dropBridge(reason) {
  for (const [id, p] of bridgeState.pending) { clearTimeout(p.timer); p.reject(new BridgeError(SIGN_ERRORS.NO_BRIDGE, `the console tab went away (${reason})`)); bridgeState.pending.delete(id); }
  bridgeState.port = null; bridgeState.tabId = null; bridgeState.origin = null;
  engine?.status && pushStatus();
}
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  if (bridgeState.port && bridgeState.port !== port) { try { bridgeState.port.disconnect(); } catch { /* gone */ } }
  bridgeState.port = port;
  bridgeState.tabId = port.sender?.tab?.id ?? null;
  bridgeState.origin = port.sender?.origin ?? port.sender?.url ?? null;
  port.onMessage.addListener(async (msg) => {
    if (!msg || typeof msg.type !== "string") return;
    switch (msg.type) {
      case BRIDGE.HELLO: pushStatus(); break;
      case BRIDGE.PING: break;
      case BRIDGE.ACCOUNT:
        bridgeState.wallet = typeof msg.publicKey === "string" && msg.publicKey.length > 30 ? msg.publicKey : null;
        log(bridgeState.wallet ? `Phantom connected as ${bridgeState.wallet}` : "Phantom disconnected");
        pushStatus();
        break;
      case BRIDGE.REPLY: settleReply(msg); break;
      case BRIDGE.PAGE_CONNECT:
        try { await bridge.connect({ onlyIfTrusted: false }); } catch (error) { log(`connect refused: ${error?.message ?? error}`); }
        break;
      case BRIDGE.PAGE_HELLO: pushStatus(); break;
      default: break;
    }
  });
  port.onDisconnect.addListener(() => { if (bridgeState.port === port) dropBridge("port closed"); });
  pushStatus();
});

/* ── the engine ────────────────────────────────────────────────────────────────────── */
/** One keyless Jupiter client for everything this worker asks Jupiter: the xStock venue's
 *  quotes and swaps, and the agent's quotes, swaps and fallback prices, on one rate budget. */
const jupiter = createJupiterClient({});
let engine = null;
let config = null;
let starting = null;
const recentLog = [];
function log(line) { recentLog.unshift(`${new Date().toISOString().slice(11, 19)} ${line}`); if (recentLog.length > 50) recentLog.length = 50; console.log("hawk:", line); }

function notify({ kind, title, body, mint }) {
  try {
    chrome.notifications.create(`hawk-${kind}-${mint ?? ""}-${Date.now()}`, {
      type: "basic", iconUrl: chrome.runtime.getURL("icons/cia-128.png"), title, message: body,
      priority: kind === "sell" || kind === "attention" ? 2 : 1, requireInteraction: kind === "sell",
    });
  } catch (error) { console.warn("hawk: notification failed", error); }
}
function rpcFor(cfg) {
  if (!cfg.rpcUrl) return { primary: null, secondary: null };
  return { primary: createRpc({ url: cfg.rpcUrl }), secondary: cfg.secondaryRpcUrl ? createRpc({ url: cfg.secondaryRpcUrl }) : null };
}
function feedFactoryFor(cfg) {
  const wsUrl = websocketUrlFor(cfg);
  if (!wsUrl) return null;
  return ({ onLogs, onState }) => createLogsFeed({ wsUrl, programId: PUMPFUN_PROGRAM_ID, onLogs, onState });
}
async function ensureEngine() {
  if (engine) return engine;
  if (starting) return starting;
  starting = (async () => {
    config = await loadConfig();
    const { primary, secondary } = rpcFor(config);
    engine = createHawkEngine({
      rpc: primary, secondaryRpc: secondary, bridge, sessionSigner, store, feedFactory: feedFactoryFor(config),
      log, notify, config, jupiter,
    });
    engine.onStatus(() => scheduleStatusPush());
    await engine.start();                      // start() refreshes the signer: the keystore is read before anything arms
    scheduleExpiryAlarm();
    log(`engine up — lane ${config.lane}, signer ${config.signerMode}${config.rpcUrl ? "" : ", no RPC configured"}`);
    updateBadge();
    return engine;
  })();
  try { return await starting; } finally { starting = null; }
}
async function applyConfig(next) {
  const e = await ensureEngine();
  const merged = normalizeConfig({ ...config, ...next });
  const endpointsChanged = merged.rpcUrl !== config.rpcUrl || merged.rpcWsUrl !== config.rpcWsUrl || merged.secondaryRpcUrl !== config.secondaryRpcUrl;
  await saveConfig(merged);
  if (endpointsChanged) {
    /* The feed factory is bound at construction; a changed endpoint needs a fresh engine,
       started on the state the old one has written. */
    e.stop();
    await store.save(e.state);
    await store.flush();
    engine = null;
    config = merged;
    await ensureEngine();
  } else {
    config = await e.setConfig(merged);
  }
  updateBadge();
  return config;
}

/* ── status fan-out: popup, console page, badge ────────────────────────────────────── */
let statusTimer = null;
function scheduleStatusPush() { if (statusTimer) return; statusTimer = setTimeout(() => { statusTimer = null; pushStatus(); }, 250); }
function publicStatus() {
  if (!engine) return { lane: config?.lane ?? "off", signerMode: config?.signerMode ?? "phantom", bridgeReady: bridge.isReady(), wallet: bridge.wallet(), phantomWallet: bridge.wallet(), open: [], closes: [], log: recentLog.map((l) => ({ at: Date.now(), line: l })), booting: true };
  const s = engine.status();
  return { ...s, hostLog: recentLog.slice(0, 10), consoleOrigin: bridgeState.origin, consoleUrl: config?.consoleUrl ?? CONFIG_DEFAULTS.consoleUrl, setupCompletedAt: config?.setupCompletedAt ?? 0 };
}
function pushStatus() {
  const status = publicStatus();
  updateBadge(status);
  try { chrome.runtime.sendMessage({ type: UI.STATUS_CHANGED, status }).catch(() => {}); } catch { /* no popup open */ }
  if (bridgeState.port) { try { bridgeState.port.postMessage({ type: BRIDGE.STATUS, status: consoleStatus(status) }); } catch { /* gone */ } }
}
/** What the page may see: no RPC URL, no config beyond the dials it needs to explain itself.
 *  `wallet` is PHANTOM's here, whatever the mode — the page is where Phantom lives, and its
 *  Connect button reads it; on autopilot the lane's own wallet travels as `laneWallet`. */
function consoleStatus(s) {
  return {
    lane: s.lane, executing: s.executing, armable: s.armable, wallet: s.phantomWallet ?? null, bridgeReady: s.bridgeReady,
    signerMode: s.signerMode ?? "phantom", laneWallet: s.wallet ?? null,
    feed: s.feed, control: s.control, entryInFlight: s.entryInFlight, deployedTodaySol: s.deployedTodaySol, dailySolCap: s.dailySolCap,
    maxSolPerTrade: s.maxSolPerTrade, entryWaitMs: s.entryWaitMs, entryFollowThroughX: s.entryFollowThroughX,
    /* The listed stocks, today's spend in each, and the canary rule in its own words: a
       page that shows a stock-quoted position must be able to name what it was paid in. */
    quoteMints: (s.quoteMints ?? []).map((q) => ({ mint: q.mint, symbol: q.symbol, maxPerTrade: q.maxPerTrade, minPerTrade: q.minPerTrade, dailyCap: q.dailyCap, deployedToday: q.deployedToday, canary: q.canary, nextLiveTicket: q.nextLiveTicket, paused: q.paused })),
    deployedTodayQuote: s.deployedTodayQuote ?? {}, stockCanaryRule: s.stockCanaryRule ?? null,
    open: (s.open ?? []).map((p) => ({ mint: p.mint, symbol: p.symbol, live: p.live, openedAt: p.openedAt, lastMarkX: p.lastMarkX, pendingSell: p.pendingSell ?? null, graduated: p.graduated ?? null, waitedOut: p.waitedOut ?? null, sizeSol: p.sizeSol,
      quoteMint: p.quoteMint ?? null, quoteSymbol: p.quoteSymbol ?? null, quoteDecimals: p.quoteDecimals ?? null, quotePaused: p.quotePaused ?? null, canary: p.canary ?? null,
      venue: p.venue ?? null, pool: p.pool ?? null, dex: p.dex ?? null })),
    closes: (s.closes ?? []).slice(0, 20), refusals: (s.refusals ?? []).slice(0, 10), log: (s.log ?? []).slice(0, 15),
    counters: s.counters, book: s.book, shadow: s.shadow, policy: s.policy, record: s.record, version: s.version,
    armability: s.armability ? { armable: s.armability.armable, blocking: s.armability.blocking, warnings: s.armability.warnings, items: s.armability.items } : null,
  };
}
function updateBadge(status = null) {
  const s = status ?? (engine ? engine.status() : null);
  let text = "", color = "#7a6d9c";
  const a = agent ? agent.status() : null;
  if (s?.executing) { text = s.signerMode === "autopilot" ? "AUTO" : "LIVE"; color = "#ff6b5a"; }
  else if (a && a.status === "running") { text = a.mode === "live" ? "AGNT" : "PAPR"; color = a.mode === "live" ? "#ff6b5a" : "#14f195"; }
  else if (s?.lane === "observe") { text = "OBS"; color = "#9945ff"; }
  else if (s?.lane === "execute") { text = "ARM?"; color = "#e0ad3d"; }
  if ((s?.open ?? []).some((p) => p.live && p.pendingSell)) { text = "SELL"; color = "#ff6b5a"; }
  try { chrome.action.setBadgeText({ text }); chrome.action.setBadgeBackgroundColor({ color }); } catch { /* no action */ }
}

/* ── the autopilot wallet: fund, sweep, lock, and the rest ──────────────────────────── */
const lamportsToSol = (v) => Number(BigInt(v)) / 1e9;
const shortKey = (k) => (typeof k === "string" && k.length > 12 ? `${k.slice(0, 4)}…${k.slice(-4)}` : String(k));
function hostRpc() {
  if (!config?.rpcUrl) throw new Error("set an RPC URL in Options first: funding, sweeping and the balance all read the chain");
  return createRpc({ url: config.rpcUrl });
}
/** The name to show for a mint the autopilot wallet holds: a listed or known stock's
 *  symbol, a position's symbol, else the short address. */
function symbolsByMint() {
  const out = new Map();
  if (engine) { const s = engine.status(); for (const p of [...(s.closes ?? []), ...(s.open ?? [])]) if (p.symbol) out.set(p.mint, p.symbol); }
  for (const k of STOCK_FOCUS_CHOICES) out.set(k.mint, k.symbol);
  for (const q of config?.quoteMints ?? []) out.set(q.mint, q.symbol);
  return out;
}
async function tokenHoldings(rpc, owner) {
  const lists = await Promise.all([TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map((programId) => rpc.getTokenAccountsByOwner(owner, { programId })));
  const names = symbolsByMint();
  return lists.flat().map((h) => ({ ...h, symbol: names.get(h.mint) ?? shortKey(h.mint), ui: Number.isInteger(h.decimals) ? rawToUnits(h.amountRaw, h.decimals) : h.amountRaw }));
}
/** After every keystore call: re-read it, refresh the engine's view, re-arm the expiry alarm. */
async function afterKeystoreChange() {
  const e = await ensureEngine();
  await e.refreshSigner();
  scheduleExpiryAlarm();
  pushStatus();
}
function scheduleExpiryAlarm() {
  const snap = keystore.snapshot();
  try {
    if (snap.unlocked && Number.isFinite(snap.expiresAt)) chrome.alarms.create(EXPIRY_ALARM, { when: snap.expiresAt + 1_000 });
    else chrome.alarms.clear(EXPIRY_ALARM);
  } catch { /* no alarms: the snapshot still judges expiry against the clock */ }
}
/** Only the extension's own pages (popup, options, the setup page) may drive the autopilot
 *  wallet — never a web page, never a content script. */
function fromExtensionPage(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  const base = chrome.runtime.getURL("");
  return typeof sender.url === "string" && sender.url.startsWith(base);
}
/** Check the signed bytes are the message that was built, send them, wait for the chain. */
async function sendSignedAndConfirm(rpc, unsignedBase64, signed, lastValidBlockHeight, { timeoutMs = 90_000 } = {}) {
  const signedBytes = fromBase64(signed?.signedBase64 ?? signed);
  if (!sameMessage(fromBase64(unsignedBase64), signedBytes)) throw new Error("the transaction that came back is not the one that was asked for — refusing to send it");
  const signature = signatureOf(signedBytes);
  await rpc.sendTransaction(toBase64(signedBytes), { skipPreflight: false });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await rpc.getSignatureStatus(signature).catch(() => null);
    if (status?.err) throw new Error(`${signature} failed on chain: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
    const height = await rpc.getBlockHeight().catch(() => null);
    if (Number.isFinite(height) && Number.isFinite(lastValidBlockHeight) && height > lastValidBlockHeight) throw new Error(`${signature} expired unlanded — nothing moved; try again`);
    if (Date.now() > deadline) throw new Error(`${signature} has no status after ${Math.round(timeoutMs / 1000)} s — check an explorer before trying again`);
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
}
const simError = (sim) => `${JSON.stringify(sim.err)}${Array.isArray(sim.logs) && sim.logs.length ? ` — ${sim.logs.slice(-2).join(" | ")}` : ""}`;

async function autopilotStatus() {
  const e = await ensureEngine();
  const agentSettlement = settlementFor((await ensureAgent()).spec());
  const snap = keystore.snapshot();
  const meta = await readMeta();
  const publicKey = snap.publicKey;
  let balanceLamports = null, tokens = [], readError = null;
  if (publicKey && config.rpcUrl) {
    const rpc = hostRpc();
    try { balanceLamports = (await rpc.getBalance(publicKey)).toString(); } catch (error) { readError = String(error?.message ?? error); }
    try { tokens = (await tokenHoldings(rpc, publicKey)).filter((h) => BigInt(h.amountRaw) > 0n); } catch (error) { readError ??= String(error?.message ?? error); }
  }
  const st = e.status();
  return {
    exists: Boolean(publicKey), publicKey, unlocked: snap.unlocked, expiresAt: snap.expiresAt,
    signerMode: config.signerMode, unlockMinutes: config.autopilotUnlockMinutes, unlockMinutesRange: AUTOPILOT_UNLOCK_MINUTES,
    fundAssets: [{ asset: "SOL", symbol: "SOL", defaultAmount: config.dailySolCap },
      ...(agentSettlement ? [{ asset: agentSettlement.mint, symbol: agentSettlement.symbol, defaultAmount: AGENT_BOUNDS.minVaultUsd }] : []),
      ...(config.quoteMints ?? []).filter((q) => q.mint !== agentSettlement?.mint).map((q) => ({ asset: q.mint, symbol: q.symbol, defaultAmount: q.dailyCap }))],
    phantomWallet: bridge.wallet(), phantomReady: bridge.isReady(), sweepTo: bridge.wallet() ?? meta.sweepTo ?? null,
    balanceLamports, balanceSol: balanceLamports === null ? null : lamportsToSol(balanceLamports), rentFloorLamports: SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS,
    tokens: tokens.map((t) => ({ mint: t.mint, symbol: t.symbol, amountRaw: t.amountRaw, decimals: t.decimals, ui: t.ui })),
    liveHeld: st.autopilotHeld ?? 0, lastFund: meta.lastFund ?? null, lastSweep: meta.lastSweep ?? null, readError,
  };
}

async function autopilotCreate(msg) {
  const e = await ensureEngine();
  if (typeof msg.passphrase !== "string" || msg.passphrase !== msg.confirm) throw new Error("the two passphrases do not match — type the same one twice");
  const replace = msg.replace === true;
  if (replace) {
    /* A wallet with money in it is not replaced from here: sweep it back first. */
    const existing = await keystore.publicKey();
    if (existing) {
      if ((e.status().autopilotHeld ?? 0) > 0) throw new Error("the autopilot wallet holds a live position — it must be sold or forgotten before the wallet is replaced");
      const rpc = hostRpc();
      const balance = await rpc.getBalance(existing);
      if (balance > BigInt(SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS) + 10_000n)
        throw new Error(`the autopilot wallet still holds ${lamportsToSol(balance)} SOL — sweep it back to Phantom before replacing it`);
      if ((await tokenHoldings(rpc, existing)).some((h) => BigInt(h.amountRaw) > 0n))
        throw new Error("the autopilot wallet still holds tokens — sweep it back to Phantom before replacing it");
    }
  }
  const made = await keystore.create({ passphrase: msg.passphrase, replace, currentPassphrase: msg.currentPassphrase });
  log(made.replaced ? `autopilot wallet replaced: ${made.replaced} → ${made.publicKey}` : `autopilot wallet created: ${made.publicKey} (locked; fund it from Phantom, then unlock)`);
  await afterKeystoreChange();
  return { ok: true, publicKey: made.publicKey, replaced: made.replaced };
}

async function autopilotUnlock(msg) {
  await ensureEngine();
  const minutes = msg.minutes === undefined || msg.minutes === null || msg.minutes === "" ? config.autopilotUnlockMinutes : Number(msg.minutes);
  if (!(Number.isInteger(minutes) && minutes >= AUTOPILOT_UNLOCK_MINUTES.min && minutes <= AUTOPILOT_UNLOCK_MINUTES.max))
    throw new Error(`unlock for a whole number of minutes from ${AUTOPILOT_UNLOCK_MINUTES.min} to ${AUTOPILOT_UNLOCK_MINUTES.max}`);
  const unlocked = await keystore.unlock({ passphrase: msg.passphrase, ttlMs: minutes * 60_000 });
  log(`autopilot wallet unlocked for ${minutes} min, until ${new Date(unlocked.expiresAt).toISOString().slice(11, 16)} UTC`);
  await afterKeystoreChange();
  return { ok: true, expiresAt: unlocked.expiresAt };
}

async function autopilotLock() {
  const e = await ensureEngine();
  await keystore.lock();
  log("autopilot wallet locked — the unlocked key is cleared from session storage; it signs nothing until unlocked");
  await afterKeystoreChange();
  return { ok: true, liveHeld: e.status().autopilotHeld ?? 0 };
}

async function autopilotExport(msg) {
  await ensureEngine();
  const secretBase58 = await keystore.exportSecret({ passphrase: msg.passphrase });
  log("the autopilot wallet's key was exported for recovery — treat that wallet as exposed: sweep it and replace it");
  return { ok: true, secretBase58 };
}

/** Phantom → the autopilot wallet: SOL (default: the day's budget) or a listed stock. Built
 *  here, simulated, then ONE Phantom approval on the console tab. */
async function autopilotFund(msg) {
  const e = await ensureEngine();
  const to = await keystore.publicKey();
  if (!to) throw new Error("create the autopilot wallet first");
  const from = bridge.wallet();
  if (!from || !bridge.isReady()) throw new Error("open the console page and connect Phantom: funding is one Phantom approval, asked on that tab");
  const rpc = hostRpc();
  const asset = typeof msg.asset === "string" && msg.asset ? msg.asset : "SOL";
  const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
  let built;
  if (asset === "SOL") {
    const amount = msg.amount === undefined || msg.amount === null || msg.amount === "" ? config.dailySolCap : msg.amount;
    let lamports;
    try { lamports = unitsToRaw(String(amount).trim(), 9, "the SOL amount"); } catch (error) { throw new Error(error.message); }
    if (lamports <= 0n) throw new Error("the SOL amount must be more than zero");
    built = buildFundTransaction({ from, to, lamports, blockhash, priorityFeeLamports: FUND_PRIORITY_FEE_LAMPORTS });
  } else {
    /* A listed stock, or the agent's settlement token (USDC or USDT): the vault it trades from. */
    const settlementToken = settlementByMint(asset);
    const entry = quoteEntryFor(config, asset) ?? (settlementToken ? { symbol: settlementToken.symbol, dailyCap: AGENT_BOUNDS.minVaultUsd } : null);
    if (!entry) throw new Error("only SOL, the agent's settlement token (USDC or USDT) or a stock listed in Options → Stock quotes can be funded from here");
    const read = await rpc.getMultipleAccounts([asset]);
    const facts = describeMint(read.accounts[0] ?? null, asset);
    if (facts.metadataSymbol && facts.metadataSymbol !== entry.symbol) throw new Error(`the list names ${shortKey(asset)} ${entry.symbol}, but that mint calls itself ${facts.metadataSymbol}`);
    if (facts.paused) throw new Error(`${entry.symbol} is paused by its issuer: nothing can move it now`);
    if (facts.transferHookProgram) throw new Error(`${entry.symbol}'s transfer hook points at ${facts.transferHookProgram}; this extension does not move a hooked token`);
    const amount = msg.amount === undefined || msg.amount === null || msg.amount === "" ? entry.dailyCap : msg.amount;
    let amountRaw;
    try { amountRaw = unitsToRaw(String(amount).trim(), facts.decimals, `the ${entry.symbol} amount`); } catch (error) { throw new Error(error.message); }
    if (amountRaw <= 0n) throw new Error(`the ${entry.symbol} amount must be more than zero`);
    built = buildTokenFundTransaction({ from, to, mint: asset, amountRaw, tokenProgram: facts.program, decimals: facts.decimals, blockhash, priorityFeeLamports: FUND_PRIORITY_FEE_LAMPORTS, symbol: entry.symbol });
  }
  /* A transfer Phantom's balance cannot cover is refused here, not in a window. */
  const sim = await rpc.simulateTransaction(built.txBase64, { addresses: [from, to] });
  if (sim?.err) throw new Error(`the funding transfer would fail, so Phantom was not asked: ${simError(sim)}`);
  log(`asking Phantom to approve: ${built.summary}`);
  const signed = await bridge.signTransaction({ txBase64: built.txBase64, purpose: built.purpose, mint: built.mint ?? null, summary: built.summary, timeoutMs: 120_000, wallet: from });
  const signature = await sendSignedAndConfirm(rpc, built.txBase64, signed, lastValidBlockHeight);
  await writeMeta({ sweepTo: from, lastFund: { at: Date.now(), signature, asset, summary: built.summary } });
  log(`${built.summary} — landed, sig ${signature}`);
  await e.refreshSigner();
  pushStatus();
  return { ok: true, signature, summary: built.summary };
}

/** The autopilot wallet → Phantom: every token it holds (TransferChecked, the emptied
 *  account closed for its rent), every empty token account closed, then every lamport
 *  above the rent floor. Signed by the autopilot wallet; Phantom is asked nothing. */
async function autopilotSweep(msg) {
  const e = await ensureEngine();
  const from = await keystore.publicKey();
  if (!from) throw new Error("there is no autopilot wallet to sweep");
  if (!sessionSigner.isReady()) throw new Error("unlock the autopilot wallet first: the sweep is signed by it");
  const meta = await readMeta();
  const to = bridge.wallet() ?? meta.sweepTo ?? null;
  if (!to) throw new Error("connect Phantom on the console page first: the sweep goes back to your Phantom wallet");
  if (msg.expectTo !== to) throw new Error(`the sweep would go to ${to}, not to ${msg.expectTo ?? "the address you confirmed"} — reopen the popup and confirm again`);
  const st = e.status();
  if ((st.autopilotHeld ?? 0) > 0)
    throw new Error(`the autopilot wallet holds ${st.autopilotHeld} live position${st.autopilotHeld === 1 ? "" : "s"}: let the lane sell (or press HARD STOP), or Forget a row you sold by hand, before sweeping — a sweep would leave the position no SOL to sell with`);
  if (st.entryInFlight) throw new Error("a buy is being signed right now — sweep after it settles");
  const rpc = hostRpc();
  const done = { to, tokens: [], closed: 0, sol: null, skipped: [] };
  const sign = (built) => sessionSigner.signTransaction({ txBase64: built.txBase64, purpose: built.purpose, summary: built.summary, wallet: from });

  /* 1 — every token with a balance. A Token-2022 mint is read first: a paused one cannot
     move, a live hook needs accounts this builder does not resolve. */
  const holdings = (await tokenHoldings(rpc, from)).filter((h) => BigInt(h.amountRaw) > 0n);
  const t22 = [...new Set(holdings.filter((h) => h.programId === TOKEN_2022_PROGRAM).map((h) => h.mint))];
  const facts = new Map();
  if (t22.length) {
    const read = await rpc.getMultipleAccounts(t22);
    t22.forEach((mint, i) => { try { facts.set(mint, describeMint(read.accounts[i] ?? null, mint)); } catch (error) { facts.set(mint, { error: error.message }); } });
  }
  for (const h of holdings) {
    const f = facts.get(h.mint);
    if (f?.error) { done.skipped.push({ mint: h.mint, symbol: h.symbol, why: `its mint could not be read: ${f.error}` }); continue; }
    if (f?.paused) { done.skipped.push({ mint: h.mint, symbol: h.symbol, why: "paused by its issuer: nothing can move it until it is unpaused" }); continue; }
    if (f?.transferHookProgram) { done.skipped.push({ mint: h.mint, symbol: h.symbol, why: "a live transfer hook: move it by hand from the exported key" }); continue; }
    let moved = false;
    for (const closeSource of [true, false]) {
      const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
      const built = buildTokenSweepTransaction({ from, to, mint: h.mint, amountRaw: h.amountRaw, tokenProgram: h.programId, decimals: h.decimals, blockhash, closeSource, symbol: h.symbol });
      const sim = await rpc.simulateTransaction(built.txBase64, { addresses: [from] });
      if (sim?.err) { if (closeSource) continue; done.skipped.push({ mint: h.mint, symbol: h.symbol, why: `the transfer would fail: ${simError(sim)}` }); break; }
      const signature = await sendSignedAndConfirm(rpc, built.txBase64, await sign(built), lastValidBlockHeight);
      done.tokens.push({ mint: h.mint, symbol: h.symbol, amountRaw: h.amountRaw, decimals: h.decimals, ui: h.ui, signature, closed: closeSource });
      log(`${built.summary} — landed, sig ${signature}`);
      moved = true;
      break;
    }
    if (!moved && !done.skipped.some((s) => s.mint === h.mint)) done.skipped.push({ mint: h.mint, symbol: h.symbol, why: "the transfer could not be built" });
  }

  /* 2 — the empty token accounts every buy leaves behind: closed, their rent back here. */
  const empty = (await tokenHoldings(rpc, from)).filter((h) => BigInt(h.amountRaw) === 0n);
  for (let i = 0; i < empty.length; i += MAX_CLOSES_PER_TRANSACTION) {
    const batch = empty.slice(i, i + MAX_CLOSES_PER_TRANSACTION);
    const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
    const built = buildCloseTokenAccountsTransaction({ owner: from, accounts: batch.map((h) => ({ address: h.address, tokenProgram: h.programId })), blockhash });
    const sim = await rpc.simulateTransaction(built.txBase64, { addresses: [from] });
    if (sim?.err) { done.skipped.push({ accounts: batch.length, why: `closing ${batch.length} empty account(s) would fail: ${simError(sim)}` }); continue; }
    const signature = await sendSignedAndConfirm(rpc, built.txBase64, await sign(built), lastValidBlockHeight);
    done.closed += batch.length;
    log(`${built.summary} — landed, sig ${signature}`);
  }

  /* 3 — the SOL above the rent floor, to the lamport: the fee is computed, not guessed. */
  const balance = await rpc.getBalance(from);
  const fee = transactionFeeLamports({ computeUnitLimit: SWEEP_COMPUTE_UNIT_LIMIT, priorityFeeLamports: 0 });
  const lamports = sweepableLamports({ balanceLamports: balance, feeLamports: fee });
  if (lamports > 0n) {
    const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
    const built = buildSweepTransaction({ from, to, lamports, blockhash, computeUnitLimit: SWEEP_COMPUTE_UNIT_LIMIT, priorityFeeLamports: 0 });
    const signature = await sendSignedAndConfirm(rpc, built.txBase64, await sign(built), lastValidBlockHeight);
    done.sol = { lamports: lamports.toString(), sol: lamportsToSol(lamports), signature };
    log(`${built.summary} — landed, sig ${signature}`);
  } else done.solNote = `the balance is at the ${lamportsToSol(SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS)} SOL rent floor: nothing above it to sweep`;
  await writeMeta({ lastSweep: { at: Date.now(), to, sol: done.sol?.sol ?? 0, tokens: done.tokens.length, closed: done.closed } });
  await e.refreshSigner();
  pushStatus();
  return { ok: true, ...done };
}

/* ── the agent ─────────────────────────────────────────────────────────────────────────
   The runner, its market source and its brain. The brain is handed `readApiKey`, the only
   reader of the owner's key; the runner never sees the key at all. */
async function readApiKey() {
  const got = await chrome.storage.local.get(AGENT_KEY_STORAGE);
  const key = got?.[AGENT_KEY_STORAGE];
  return typeof key === "string" && key.length ? key : null;
}
async function hasApiKey() { return (await readApiKey()) !== null; }
const market = createMarket({ jupiter });
const brain = createBrain({ apiKey: readApiKey });
let agent = null;
let agentStarting = null;
async function ensureAgent() {
  if (agent) return agent;
  if (agentStarting) return agentStarting;
  agentStarting = (async () => {
    const runner = createAgentRunner({
      storage: chromeArea(chrome.storage.local), market, brain, jupiter,
      fences: () => (engine && typeof engine.agentFences === "function" ? engine.agentFences() : null),
      /* The owner's own launches (CashCat's coins and the stock cats, from the shared journal):
         the agent never buys one, and they leave its universe. */
      ownLaunches: () => cashcatTab.exclusions(),
      hasApiKey, log, notify,
    });
    await runner.load();
    agent = runner;
    return runner;
  })();
  try { return await agentStarting; } finally { agentStarting = null; }
}
/** One agent tick, off the message path: the protections every time, the model when due. */
function agentTick() {
  ensureEngine().then(() => ensureAgent()).then((a) => a.tick()).then(() => updateBadge()).catch((e) => log(`agent tick failed: ${e?.message ?? e}`));
}
/** A custom mint, read over the owner's RPC before it can join the universe: its decimals
 *  and token program come from the chain, never from the form. */
async function verifyCustomMints(list) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const known = new Map((agent?.spec().custom ?? []).map((c) => [c.mint, c]));
  const fresh = list.filter((c) => !(known.has(String(c?.mint ?? "").trim())));
  let read = { accounts: [] };
  if (fresh.length) read = await hostRpc().getMultipleAccounts(fresh.map((c) => String(c.mint).trim()));
  const out = list.map((c) => {
    const mint = String(c?.mint ?? "").trim();
    if (known.has(mint)) return { ...known.get(mint), symbol: c.symbol ?? known.get(mint).symbol };
    const account = read.accounts?.[fresh.indexOf(c)] ?? null;
    let facts;
    try { facts = describeMint(account, mint); } catch (error) { throw new Error(`${mint}: ${error.message}`); }
    if (facts.initialized !== true) throw new Error(`${mint} is not an initialized mint`);
    if (facts.program === TOKEN_2022_PROGRAM) {
      try { assertTradeableExtensions(parseMintExtensions(Buffer.from(account.data[0], account.data[1] || "base64")), mint); }
      catch (error) { throw new Error(`${c.symbol ?? mint}: ${error.message}`); }
    }
    if (facts.paused) throw new Error(`${c.symbol ?? mint} is paused by its issuer`);
    return { mint, symbol: String(c.symbol ?? "").trim(), decimals: facts.decimals, program: facts.program, verifiedAt: Date.now(), freezeAuthority: facts.freezeAuthority, mintAuthority: facts.mintAuthority };
  });
  /* Cat coins only: each new mint's own name and ticker, as Jupiter's token list gives them,
     go with it, and normalizeAgentSpec refuses one that is not a cat (not_a_cat_coin). */
  for (const row of out) {
    if (known.has(row.mint)) continue;
    let listed = null;
    try {
      const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(row.mint)}`);
      if (res.ok) listed = (await res.json()).find?.((t) => t?.id === row.mint) ?? null;
    } catch { /* said below */ }
    if (!listed) throw new Error(`${row.symbol || row.mint}: Jupiter's token list does not know this mint, so it cannot be checked as a cat coin`);
    row.name = String(listed.name ?? "");
    row.jupiterSymbol = String(listed.symbol ?? "");
  }
  return out;
}
async function agentStatus() {
  await ensureEngine();
  const a = await ensureAgent();
  if (a.spec().mode === "live") { try { await a.liveArmability(); } catch { /* the checklist says what it could not read */ } }
  const meta = await readMeta();
  return {
    ok: true, agent: a.status(), apiKeySaved: await hasApiKey(), withdrawTo: bridge.wallet() ?? meta.sweepTo ?? null,
    autopilot: { publicKey: keystore.snapshot().publicKey, unlocked: sessionSigner.isReady() },
    settlementTokens: SETTLEMENT_TOKENS, majors: SOLANA_CATS, majorsVerified: SOLANA_CATS_VERIFIED, bounds: AGENT_BOUNDS, rpcConfigured: Boolean(config?.rpcUrl),
  };
}
async function agentSaveSpec(msg) {
  const a = await ensureAgent();
  const input = msg.spec && typeof msg.spec === "object" && !Array.isArray(msg.spec) ? msg.spec : {};
  const custom = await verifyCustomMints(input.custom ?? []);
  const saved = await a.saveSpec({ ...input, custom });
  updateBadge();
  return { ok: true, spec: saved };
}
async function agentSetApiKey(msg) {
  const typed = typeof msg.apiKey === "string" ? msg.apiKey.trim() : "";
  if (!/^[A-Za-z0-9_-]{20,300}$/.test(typed)) throw new Error("that does not look like an API key: paste the whole key (letters, digits, - and _)");
  await chrome.storage.local.set({ [AGENT_KEY_STORAGE]: typed });
  log("agent: an API key was saved in this browser; it is sent only to the Anthropic API");
  return { ok: true, apiKeySaved: true };
}
async function agentClearApiKey() {
  await chrome.storage.local.remove(AGENT_KEY_STORAGE);
  log("agent: the API key was removed from this browser");
  return { ok: true, apiKeySaved: false };
}
async function agentListModels() {
  const list = await brain.listModels({ force: true });
  return { ok: true, models: list.map((m) => ({ id: m.id, displayName: m.displayName })) };
}
/** THE OWNER'S WITHDRAWAL: pause the agent, sweep the autopilot wallet to the Phantom address
 *  the owner confirmed (the existing sweep, signed by the autopilot wallet), then close the
 *  agent's rows for what left. Only an extension page can ask; the model cannot. */
async function agentWithdraw(msg) {
  const a = await ensureAgent();
  await a.pauseForWithdraw();
  /* The runner's ticks stand aside until markWithdrawn, which runs whether or not the sweep
     finished: a stop loss or the breaker must not sell what the sweep is moving. */
  let result = null;
  try { result = await autopilotSweep({ expectTo: msg.expectTo }); }
  finally { await a.markWithdrawn(result); }
  updateBadge();
  return result;
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("hawk:agent:")) return false;
  (async () => {
    if (!fromExtensionPage(sender)) return { ok: false, error: "the agent answers the extension's own pages only" };
    try {
      switch (msg.type) {
        case AGENT.STATUS: return await agentStatus();
        case AGENT.SAVE_SPEC: return await agentSaveSpec(msg);
        case AGENT.SET_API_KEY: return await agentSetApiKey(msg);
        case AGENT.CLEAR_API_KEY: return await agentClearApiKey();
        case AGENT.LIST_MODELS: return await agentListModels();
        case AGENT.START: { await ensureEngine(); const a = await ensureAgent(); const st = await a.start({ liveAck: typeof msg.liveAck === "string" ? msg.liveAck : undefined }); agentTick(); return { ok: true, agent: st }; }
        case AGENT.PAUSE: { const a = await ensureAgent(); const st = msg.on === false ? await a.resume() : await a.pause(); updateBadge(); return { ok: true, agent: st }; }
        case AGENT.STOP: { const a = await ensureAgent(); const st = await a.stop(); updateBadge(); return { ok: true, agent: st }; }
        case AGENT.RUN_NOW: { const a = await ensureAgent(); const st = await a.runNow(); agentTick(); return { ok: true, agent: st }; }
        case AGENT.LIQUIDATE: { await ensureEngine(); const a = await ensureAgent(); const out = await a.liquidateAll(); updateBadge(); return { ok: true, ...out }; }
        case AGENT.WITHDRAW: { await ensureEngine(); return { ok: true, ...(await agentWithdraw(msg)) }; }
        default: return { ok: false, error: `unknown message ${msg.type}` };
      }
    } catch (error) {
      /* The message only: AgentError, AgentSpecError, BrainError and RpcError never carry the
         API key, and nothing here is logged. */
      return { ok: false, error: error?.message ?? String(error), code: error?.clause ?? error?.code, key: error?.key };
    }
  })().then(sendResponse);
  return true;
});

/* ── the agency's other cats: Popcat, Crying Cat, CashCat ─────────────────────────────────
   Each cat's requests go through the bots' http client with its own allow-list of hosts, over
   this worker's fetch (bound: a detached fetch is an illegal invocation in a worker). The RPC
   host is added to a client when its JSON-RPC client is made: the owner's RPC, or with none set
   the public mainnet endpoint, which refuses browser extensions (Popcat and Crying Cat say so). */
const workerFetch = (url, init) => fetch(url, init);
/* One retry, not three: a person is waiting on the popup, and the scanner rests on its own. */
const catHttp = (hosts) => createHttp({ fetchImpl: workerFetch, allowedHosts: hosts, defaults: { ...HTTP_DEFAULTS, retries: 1 } });
const popcatHttp = catHttp(POPCAT_TAB_HOSTS);
const cryingHttp = catHttp([]);
const cryingCat = createCryingCat();
const draftHttp = catHttp(DRAFT_HOSTS);
const pinataHttp = catHttp([HOSTS.pinataUpload, HOSTS.pinataGateway]);
const stonkfunHttp = catHttp([HOSTS.stonkfun]);   // stockcats.mjs STOCKCAT_HOSTS; the owner's RPC is added when the planner makes its client
const catRpcs = new Map();      // http client → { url, rpc, isPublic }
function catRpcFor(http) {
  const url = config?.rpcUrl || PUBLIC_RPC;
  const have = catRpcs.get(http);
  if (have && have.url === url) return have;
  let made;
  try { const rpc = createCatRpc({ http, url }); made = { url, rpc, isPublic: rpc.isPublic }; }
  catch { made = { url, rpc: null, isPublic: false }; }
  catRpcs.set(http, made);
  return made;
}

/* The Pinata JWT: kept in chrome.storage.local under its one key, read here and nowhere else,
   handed only to pinMetadata, which sends it in one header to Pinata's upload API. */
const PINATA_JWT_STORAGE = "cia:cashcat:pinata-jwt";
async function readPinataJwt() {
  const got = await chrome.storage.local.get(PINATA_JWT_STORAGE);
  const jwt = got?.[PINATA_JWT_STORAGE];
  return typeof jwt === "string" && jwt.length ? jwt : null;
}
async function hasPinataJwt() { return (await readPinataJwt()) !== null; }
async function cashcatSetPinataJwt(msg) {
  const typed = typeof msg.jwt === "string" ? msg.jwt.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(typed) || typed.length > 4_000) throw new Error("that does not look like a Pinata JWT: paste the whole token (three parts separated by dots)");
  await chrome.storage.local.set({ [PINATA_JWT_STORAGE]: typed });
  log("cashcat: a Pinata key was saved in this browser; it is sent only to Pinata's upload API");
  return { ok: true, pinataSaved: true };
}
async function cashcatClearPinataJwt() {
  await chrome.storage.local.remove(PINATA_JWT_STORAGE);
  log("cashcat: the Pinata key was removed from this browser");
  return { ok: true, pinataSaved: false };
}
/* A pin names its venue, which decides the URI written on chain (pump.fun's ipfs.io form, or the
   Pinata gateway form StonkFun's indexer resolved); anything else is refused before the JWT is read. */
const PIN_VENUES = Object.freeze(["pumpfun", "stonkfun"]);
const pinata = {
  hasJwt: hasPinataJwt,
  async pin({ logoPng, coin, buildDoc, venue = "pumpfun" }) {
    if (!PIN_VENUES.includes(venue)) throw new Error(`a pin is for pump.fun or StonkFun, not "${venue}"`);
    const jwt = await readPinataJwt();
    if (!jwt) throw new Error("no Pinata JWT is saved");
    return pinMetadata({ http: pinataHttp, jwt, logoPng, coin, venue, buildDoc });
  },
};

/* StonkFun, for the stock cats: its pairs, a pair's plan proved on the owner's RPC, a launch's
   record. The planner may pair only with the 24 xStocks of STONKFUN_XSTOCKS. */
const stonkfun = {
  pairs: () => stonkfunHttp.json(URLS.stonkfunPairs, { maxBytes: 4 * 1024 * 1024 }),
  async plan({ pairMint }) {
    const r = catRpcFor(stonkfunHttp);
    if (!r.rpc || r.isPublic) throw Object.assign(new Error("set your own RPC in Options: the public mainnet RPC answers 403 to the extension"), { clause: "no_rpc" });
    return planStonkfunLaunch({ http: stonkfunHttp, rpc: r.rpc, quoteChoice: pairMint, quoteList: STONKFUN_XSTOCKS });
  },
  token: (mint) => stonkfunHttp.json(URLS.stonkfunToken(mint)),
};

/* CashCat's model: the brain's callTool, so the Anthropic key never leaves the brain. */
async function cashcatModel() {
  const got = await chrome.storage.local.get(CASHCAT_TAB_KEYS.settings);
  const chosen = typeof got?.[CASHCAT_TAB_KEYS.settings]?.model === "string" ? got[CASHCAT_TAB_KEYS.settings].model : "";
  return { hasKey: await hasApiKey(), callTool: async ({ tool, system, user }) => (await brain.callTool({ chosen, tool, system, user })).input };
}
const mintKeys = createMintKeys();
const logoRenderer = workerLogoRenderer({ urlFor: (p) => chrome.runtime.getURL(p) });
const draftDesk = createDraftDesk({ http: draftHttp, model: cashcatModel });
const cashcatTab = createCashcatTab({
  storage: chromeArea(chrome.storage.local), desk: draftDesk, renderLogo: (spec) => logoRenderer.render(spec), pinata,
  fences: () => (engine && typeof engine.agentFences === "function" ? engine.agentFences() : null),
  stonkfun,
  mintKeys, hasApiKey, log, notify,
});
const popcatTab = createPopcatTab({ http: popcatHttp, rpc: () => catRpcFor(popcatHttp), storage: chromeArea(chrome.storage.local), exclusions: () => cashcatTab.exclusions() });

async function cashcatStatus() {
  await ensureEngine();
  const st = await cashcatTab.status();
  return { ok: true, cashcat: st, pinataSaved: await hasPinataJwt(), apiKeySaved: await hasApiKey(), rpcConfigured: Boolean(config?.rpcUrl),
    autopilot: { publicKey: keystore.snapshot().publicKey, unlocked: sessionSigner.isReady() } };
}
async function cashcatPreview() {
  const stored = await cashcatTab.loadDraft();
  if (!stored?.draft) throw new Error("type a coin or draft one from a trend first");
  const { png, sign } = await logoRenderer.render({ ticker: stored.draft.symbol, kitten: stored.draft.kitten, background: stored.draft.background });
  return { ok: true, dataUrl: `data:image/png;base64,${toBase64(png)}`, bytes: png.length, sign };
}
/** The cats' own work on the alarm: Popcat only when the owner switched background scanning on;
 *  CashCat's auto mode only when armed and due. */
function catsTick() {
  popcatTab.backgroundScanOn().then((on) => (on ? popcatTab.step() : null)).catch((e) => log(`popcat scan failed: ${e?.message ?? e}`));
  ensureEngine().then(() => cashcatTab.autoTick()).then((r) => { if (r?.ran) log(`cashcat auto mode: ${r.ok === false ? `refused (${r.clause})` : `launched ${r.mint}`}`); }).catch((e) => log(`cashcat auto tick failed: ${e?.message ?? e}`));
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("cia:")) return false;
  (async () => {
    if (!fromExtensionPage(sender)) return { ok: false, error: "the cats answer the extension's own pages only" };
    try {
      switch (msg.type) {
        case POPCAT.STATUS: { await ensureEngine(); return { ok: true, popcat: await popcatTab.status() }; }
        case POPCAT.SCAN: { await ensureEngine(); const r = await popcatTab.step({ force: msg.force === true }); return { ok: true, step: r, popcat: await popcatTab.status() }; }
        case POPCAT.SET_BACKGROUND: return { ok: true, backgroundScan: await popcatTab.setBackgroundScan(msg.on === true) };
        case POPCAT.CLEAR: { await popcatTab.clear(); return { ok: true }; }
        case CRYING.CHECK: {
          const parsed = parseMintInput(msg.input);
          if (!parsed.ok) return { ok: false, error: parsed.why, code: "bad_input" };
          await ensureEngine();
          const r = catRpcFor(cryingHttp);
          try { return { ok: true, report: await cryingCat.check({ rpc: r.rpc, mint: parsed.mint }) }; }
          catch (error) {
            if (r.isPublic && (error?.detail?.code === 403 || /forbidden/i.test(String(error?.message)))) return { ok: false, error: "The public mainnet RPC refuses requests from browser extensions (it answered 403 \"Access forbidden\"). Set your own RPC in Options.", code: "public_rpc_refused" };
            throw error;
          }
        }
        case CASHCAT.STATUS: return await cashcatStatus();
        case CASHCAT.SAVE_SETTINGS: return { ok: true, settings: await cashcatTab.saveSettings(msg.settings) };
        case CASHCAT.SET_PINATA_JWT: return await cashcatSetPinataJwt(msg);
        case CASHCAT.CLEAR_PINATA_JWT: return await cashcatClearPinataJwt();
        /* `ok` says the message was answered; `passes` says whether the draft passed its rules. */
        case CASHCAT.DRAFT: { const r = await cashcatTab.draftTyped(msg.idea && typeof msg.idea === "object" ? msg.idea : {}); return { ...r, ok: true, passes: r.ok === true }; }
        case CASHCAT.DRAFT_FROM_TREND: { const r = await cashcatTab.draftFromTrend(); return { ...r, ok: true, passes: r.ok === true }; }
        case CASHCAT.CLEAR_DRAFT: { await cashcatTab.clearDraft(); return { ok: true }; }
        case CASHCAT.PREVIEW: return await cashcatPreview();
        case CASHCAT.PREPARE: { await ensureEngine(); return { ok: true, plan: await cashcatTab.prepare() }; }
        case CASHCAT.LAUNCH: { await ensureEngine(); return { ok: true, launch: await cashcatTab.launch({ confirmTicker: msg.confirmTicker }) }; }
        case CASHCAT.MARK_CHECKED: return await cashcatTab.markChecked({ mint: msg.mint, landed: msg.landed === true });
        case CASHCAT.ARM_AUTO: { await ensureEngine(); return await cashcatTab.armAuto({ sentence: msg.sentence }); }
        case CASHCAT.DISARM_AUTO: return await cashcatTab.disarmAuto();
        /* Stock cats, in CoinMarketCat's tab: every byte is built in CashCat's tab, here. */
        case STOCKCATS.LIST: { await ensureEngine(); return { ok: true, stockcats: await cashcatTab.stockCats.list(), rpcConfigured: Boolean(config?.rpcUrl), pinataSaved: await hasPinataJwt(), apiKeySaved: await hasApiKey() }; }
        case STOCKCATS.REFRESH: { await ensureEngine(); return { ok: true, stockcats: await cashcatTab.stockCats.refresh() }; }
        case STOCKCATS.SUGGEST: { const r = await cashcatTab.stockCats.suggest({ pairMint: msg.pairMint }); return { ...r, ok: true, passes: r.ok === true }; }
        case STOCKCATS.DRAFT: { const r = await cashcatTab.stockCats.draft({ pairMint: msg.pairMint, idea: msg.idea && typeof msg.idea === "object" ? msg.idea : {} }); return { ...r, ok: true, passes: r.ok === true }; }
        case STOCKCATS.PREPARE: { await ensureEngine(); return { ok: true, plan: await cashcatTab.stockCats.prepare({ pairMint: msg.pairMint }) }; }
        case STOCKCATS.LAUNCH: { await ensureEngine(); return { ok: true, launch: await cashcatTab.stockCats.launch({ pairMint: msg.pairMint, preparedId: msg.preparedId, confirmTicker: msg.confirmTicker }) }; }
        case STOCKCATS.ADOPTION: return { ok: true, ...(await cashcatTab.stockCats.checkAdoption({ mint: msg.mint })) };
        case STOCKCATS.SETTINGS: return { ok: true, settings: await cashcatTab.stockCats.saveSettings({ maxPerDay: msg.maxPerDay }) };
        default: return { ok: false, error: `unknown message ${msg.type}` };
      }
    } catch (error) {
      /* The message only: no cat's error carries the Pinata JWT or the API key, and nothing here is logged. */
      return { ok: false, error: error?.message ?? String(error), code: error?.clause ?? error?.code };
    }
  })().then(sendResponse);
  return true;
});

/* ── messages from the popup, the options page and the setup page ──────────────────── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("hawk:autopilot:")) return false;
  (async () => {
    if (!fromExtensionPage(sender)) return { ok: false, error: "the autopilot wallet answers the extension's own pages only" };
    try {
      switch (msg.type) {
        case AUTOPILOT.STATUS: return { ok: true, autopilot: await autopilotStatus() };
        case AUTOPILOT.CREATE: return await autopilotCreate(msg);
        case AUTOPILOT.UNLOCK: return await autopilotUnlock(msg);
        case AUTOPILOT.LOCK: return await autopilotLock();
        case AUTOPILOT.FUND: return await autopilotFund(msg);
        case AUTOPILOT.SWEEP: {
          /* The agent's live positions are tokens in this wallet: a plain sweep would move
             them out from under its book. Its own Withdraw pauses it and closes those rows. */
          const held = (await ensureAgent()).liveHeld();
          if (held > 0) throw new Error(`the agent holds ${held} live position${held === 1 ? "" : "s"} in this wallet: Liquidate all first, or use the agent's Withdraw, which pauses it and closes those rows as withdrawn`);
          return await autopilotSweep(msg);
        }
        case AUTOPILOT.EXPORT_SECRET: return await autopilotExport(msg);
        default: return { ok: false, error: `unknown message ${msg.type}` };
      }
    } catch (error) {
      /* The message only: SessionWalletError, BridgeError and RpcError never carry a
         passphrase or a key, and nothing here is logged. */
      return { ok: false, error: error?.message ?? String(error), code: error?.code ?? error?.clause };
    }
  })().then(sendResponse);
  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("hawk:ui:")) return false;
  (async () => {
    try {
      switch (msg.type) {
        case UI.GET_STATUS: await ensureEngine(); return { ok: true, status: publicStatus() };
        case UI.GET_CONFIG: await ensureEngine(); return { ok: true, config };
        case UI.SET_CONFIG: { const saved = await applyConfig(msg.config ?? {}); pushStatus(); return { ok: true, config: saved }; }
        case UI.ARM: {
          const lane = msg.lane === "execute" ? "execute" : msg.lane === "observe" ? "observe" : "off";
          const saved = await applyConfig({ lane, ...(typeof msg.liveAck === "string" ? { liveAck: msg.liveAck } : {}) });
          pushStatus();
          return { ok: true, config: saved, status: publicStatus() };
        }
        case UI.DISARM: { const saved = await applyConfig({ lane: "off" }); pushStatus(); return { ok: true, config: saved }; }
        case UI.HARD_STOP: { const e = await ensureEngine(); e.setControl({ hardStop: msg.on === true }); pushStatus(); return { ok: true }; }
        case UI.PAUSE: { const e = await ensureEngine(); e.setControl({ pauseEntries: msg.on === true }); pushStatus(); return { ok: true }; }
        case UI.CONNECT: { await ensureEngine(); await bridge.connect({ onlyIfTrusted: false }); return { ok: true, wallet: bridge.wallet() }; }
        case UI.FORGET_POSITION: { const e = await ensureEngine(); const done = await e.forgetPosition(msg.mint); pushStatus(); return { ok: done }; }
        case UI.CLEAR_STOCK_CANARY: { const e = await ensureEngine(); const done = await e.clearStockCanary(msg.mint, { venue: msg.venue === "jupiter-xstock" ? "jupiter-xstock" : null }); pushStatus(); return { ok: done }; }
        case UI.OPEN_CONSOLE: {
          await ensureEngine();
          const url = config.consoleUrl;
          /* tabs.query sees only tabs under a host permission (the https wildcard): a console
             served from http://localhost is not found and a second tab opens. Accepted for the
             local dev case rather than asking for the `tabs` permission the manifest lacks on purpose. */
          const tabs = await chrome.tabs.query({ url: `${url.split("#")[0].split("?")[0]}*` }).catch(() => []);
          if (tabs.length) { await chrome.tabs.update(tabs[0].id, { active: true }); try { await chrome.windows.update(tabs[0].windowId, { focused: true }); } catch { /* fine */ } }
          else await chrome.tabs.create({ url });
          return { ok: true };
        }
        case "hawk:ui:export-shadow": { const e = await ensureEngine(); return { ok: true, jsonl: e.exportShadow(), rows: e.status().shadow.rows }; }
        case "hawk:ui:report": { const e = await ensureEngine(); return { ok: true, report: e.report() }; }
        default: return { ok: false, error: `unknown message ${msg.type}` };
      }
    } catch (error) {
      return { ok: false, error: error?.message ?? String(error), key: error instanceof ConfigError ? error.key : undefined, code: error?.code };
    }
  })().then(sendResponse);
  return true;
});

/* ── lifecycle ─────────────────────────────────────────────────────────────────────── */
/** The first-run setup page, opened once when the extension is installed — not on an
 *  update, not on a browser start. Everything it sets stays editable in Options. */
const WELCOME_PAGE = "welcome.html";
chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  ensureEngine().catch((e) => log(`boot failed: ${e.message}`));
  if (details?.reason === "install") {
    try { Promise.resolve(chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_PAGE) })).catch(() => {}); } catch { /* no tabs API: the popup links it */ }
  }
});
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create(ALARM, { periodInMinutes: 0.5 }); ensureEngine().catch((e) => log(`boot failed: ${e.message}`)); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) { ensureEngine().catch((e) => log(`wake failed: ${e.message}`)); agentTick(); catsTick(); }
  if (alarm.name === EXPIRY_ALARM) {
    /* The unlock ran out: the snapshot already says locked (it judges the clock); this
       re-reads the store, which removes the expired entry, and says so out loud. */
    ensureEngine().then(async (e) => {
      await e.refreshSigner();
      if (!keystore.snapshot().unlocked) {
        log("the autopilot wallet's unlock ran out — it is locked and signs nothing until you unlock it");
        const held = e.status().autopilotHeld ?? 0;
        notify({ kind: "attention", title: "Cat Intelligence Agency: the autopilot wallet locked itself", body: held
          ? `Its unlock ran out while it holds ${held} live position${held === 1 ? "" : "s"}. Unlock it in the popup so the lane can sell.`
          : "Its unlock ran out. The lane buys nothing on autopilot until you unlock it again." });
      }
      pushStatus();
    }).catch((e) => log(`expiry check failed: ${e.message}`));
  }
});
chrome.notifications.onClicked.addListener((id) => {
  try { chrome.notifications.clear(id); } catch { /* fine */ }
  ensureEngine().then(async () => {
    const url = config.consoleUrl;
    const tabs = await chrome.tabs.query({ url: `${url.split("#")[0].split("?")[0]}*` }).catch(() => []);
    if (tabs.length) { await chrome.tabs.update(tabs[0].id, { active: true }); try { await chrome.windows.update(tabs[0].windowId, { focused: true }); } catch { /* fine */ } }
    else await chrome.tabs.create({ url });
  }).catch(() => {});
});
ensureEngine().catch((e) => log(`boot failed: ${e.message}`));
