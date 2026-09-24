/**
 * THE WIRE BETWEEN THE FOUR PLACES THIS EXTENSION RUNS.
 *
 *   popup / options / welcome ──runtime.sendMessage──▶ background (the agent, the Snipurr lane's engine, the autopilot wallet)
 *   background ──tabs.sendMessage──▶ content script ──window.postMessage──▶ injected (Phantom)
 *
 * Every message carries `type` from one of the tables below. Nothing else is accepted:
 * the content script relays only HAWK_TO_PAGE types page-ward and only HAWK_FROM_PAGE
 * types extension-ward, and the injected script answers only requests it recognises
 * from `window` itself, stamped with the nonce the content script minted at injection.
 * A page script can therefore ask the bridge for a connection or a status line, and can
 * never ask it for a signature — signatures are requested by the background only.
 */
export const CHANNEL = "claudeco-hawk";

/** popup/options → background */
export const UI = Object.freeze({
  GET_STATUS: "hawk:ui:get-status",
  GET_CONFIG: "hawk:ui:get-config",
  SET_CONFIG: "hawk:ui:set-config",
  ARM: "hawk:ui:arm",            // { lane: "observe" | "execute" }
  DISARM: "hawk:ui:disarm",
  HARD_STOP: "hawk:ui:hard-stop", // { on: boolean }
  PAUSE: "hawk:ui:pause",         // { on: boolean }
  CONNECT: "hawk:ui:connect",     // ask the console tab to connect Phantom
  FORGET_POSITION: "hawk:ui:forget-position", // { mint } — closes a row the user sold by hand
  CLEAR_STOCK_CANARY: "hawk:ui:clear-stock-canary", // { mint } — the user checked a blocked stock buy; its next buy is a canary again
  OPEN_CONSOLE: "hawk:ui:open-console",
  STATUS_CHANGED: "hawk:ui:status-changed",   // background → popup (broadcast)
});

/**
 * popup / options / the setup page → background: THE AUTOPILOT WALLET. A table apart from
 * UI because three of these carry the passphrase the user typed (create, unlock, export)
 * and one hands a secret back (export, once, for recovery) — test-hawk-no-key.mjs pins
 * exactly which. None carries transaction bytes: FUND and SWEEP carry an amount and a
 * destination the background already knows, and the background builds every byte. The
 * worker answers these only from the extension's own pages, never from a web page or a
 * content script.
 */
export const AUTOPILOT = Object.freeze({
  STATUS: "hawk:autopilot:status",                 // → { exists, publicKey, unlocked, expiresAt, balance, tokens, sweepTo, … }
  CREATE: "hawk:autopilot:create",                 // { passphrase, confirm, replace?, currentPassphrase? }
  UNLOCK: "hawk:autopilot:unlock",                 // { passphrase, minutes? }
  LOCK: "hawk:autopilot:lock",
  FUND: "hawk:autopilot:fund",                     // { amount, asset: "SOL" | a listed stock's mint } — ONE Phantom approval
  SWEEP: "hawk:autopilot:sweep",                   // { expectTo } — every token and the SOL above the rent floor, back to Phantom
  EXPORT_SECRET: "hawk:autopilot:export-secret",   // { passphrase } → { secretBase58 }, for recovery
});
/** The AUTOPILOT messages whose payload carries a passphrase, and the one that returns a secret. */
export const AUTOPILOT_CARRIES_PASSPHRASE = Object.freeze([AUTOPILOT.CREATE, AUTOPILOT.UNLOCK, AUTOPILOT.EXPORT_SECRET]);
export const AUTOPILOT_RETURNS_SECRET = Object.freeze([AUTOPILOT.EXPORT_SECRET]);

/**
 * popup / options → background: THE AGENT (src/lib/agent-runner.mjs). A table apart from UI
 * and AUTOPILOT because one of these carries a secret the owner typed — the API key, sent
 * once from Options to be kept in chrome.storage.local, read by the worker alone and sent
 * only to the Anthropic API — and none hands one back: STATUS says whether a key is saved,
 * never what it is. None carries transaction bytes or a limit the model could have written:
 * SAVE_SPEC carries the owner's form, normalized by normalizeAgentSpec; WITHDRAW carries the
 * destination the owner confirmed, and the worker sweeps to Phantom with the existing sweep.
 * test-agent-no-leak.mjs pins exactly which. The worker answers these only from the
 * extension's own pages, never from a web page or a content script.
 */
export const AGENT = Object.freeze({
  STATUS: "hawk:agent:status",             // → { agent: runner.status(), apiKeySaved, withdrawTo, … }
  SAVE_SPEC: "hawk:agent:save-spec",       // { spec } — name, strategy, universe, settlement, schedule, limits, mode, model
  SET_API_KEY: "hawk:agent:set-api-key",   // { apiKey } — the one message that carries a secret; never returned
  CLEAR_API_KEY: "hawk:agent:clear-api-key",
  LIST_MODELS: "hawk:agent:list-models",   // → [{ id, displayName }], as the API lists them for the saved key
  START: "hawk:agent:start",               // { liveAck? } — live starts only with the typed sentence
  PAUSE: "hawk:agent:pause",               // { on } — no model calls; the protections keep running
  STOP: "hawk:agent:stop",
  RUN_NOW: "hawk:agent:run-now",           // ask the model at the next tick instead of waiting for the schedule
  LIQUIDATE: "hawk:agent:liquidate",       // every position back to the settlement token, then paused
  WITHDRAW: "hawk:agent:withdraw",         // { expectTo } — the owner's sweep of the autopilot wallet to Phantom
});
export const AGENT_CARRIES_SECRET = Object.freeze([AGENT.SET_API_KEY]);
export const AGENT_RETURNS_SECRET = Object.freeze([]);

/** background → content → injected (requests), and back (replies with the same id) */
export const BRIDGE = Object.freeze({
  HELLO: "hawk:bridge:hello",              // content → background on load: { origin, nonce }
  PING: "hawk:bridge:ping",                // content → background keepalive
  CONNECT: "hawk:bridge:connect",          // background → injected: { onlyIfTrusted }
  DISCONNECT: "hawk:bridge:disconnect",
  SIGN: "hawk:bridge:sign",                // background → injected: { txBase64, purpose, mint, summary }
  ACCOUNT: "hawk:bridge:account",          // injected → background: { publicKey|null } on connect/change
  REPLY: "hawk:bridge:reply",              // injected → background: { id, ok, result|error }
  STATUS: "hawk:bridge:status",            // background → page: the status the console renders
  PAGE_CONNECT: "hawk:page:connect",       // page → content: the user pressed Connect on the page
  PAGE_HELLO: "hawk:page:hello",           // page → content: "is the extension here?"
});

export const HAWK_TO_PAGE = Object.freeze(new Set([BRIDGE.CONNECT, BRIDGE.DISCONNECT, BRIDGE.SIGN, BRIDGE.STATUS]));
export const HAWK_FROM_PAGE = Object.freeze(new Set([BRIDGE.ACCOUNT, BRIDGE.REPLY, BRIDGE.PAGE_CONNECT, BRIDGE.PAGE_HELLO]));

export const SIGN_ERRORS = Object.freeze({
  REJECTED: "rejected",        // the user pressed Reject in Phantom
  TIMEOUT: "timeout",          // the window sat past approvalTimeoutMs
  NO_BRIDGE: "no_bridge",      // no console tab is open
  NO_WALLET: "no_wallet",      // Phantom is not connected
  WALLET_MISMATCH: "wallet_mismatch", // Phantom switched accounts under the lane
  PROVIDER: "provider",        // Phantom threw something else
});

export class BridgeError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.detail = detail;
  }
}

let counter = 0;
export function nextId(prefix = "req") {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
