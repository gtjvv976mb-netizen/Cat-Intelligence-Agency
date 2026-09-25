/**
 * THE OWNER'S API KEY GOES TO ONE PLACE, AND NO MODEL IDENTIFIER IS WRITTEN ANYWHERE.
 *
 * test-hawk-no-key.mjs pins that one file may hold a wallet key. This pins the other secret
 * the extension now keeps — the owner's Anthropic API key — the same way, in the source, in
 * the built bundles, and through the RUNNING service worker:
 *
 *   1. the AGENT message table: exactly eleven messages; one carries a secret (the key, from
 *      Options, once); none hands one back; none names a signature or transaction bytes; no
 *      web page can send one, and the content and injected scripts never name them;
 *   2. the source: the key's storage key appears in the service worker and nowhere else under
 *      src/; the worker reads the key in its reader, its save and its clear, and nowhere else;
 *      the reader goes to the brain and nowhere else; no log line names it; x-api-key is
 *      written in the brain alone, whose only host is api.anthropic.com; the pages take the key
 *      in a password field, clear it, and store and log nothing;
 *   3. the running worker, under a chrome double, with fetch recorded: a web page is refused;
 *      the key lands in chrome.storage.local under its one storage key; STATUS says only that
 *      one is saved; a paper run lists the models, asks the model, fills at Jupiter's quote —
 *      and every request that carries the key is to https://api.anthropic.com, and nothing
 *      stored, logged or answered carries it; CLEAR removes it;
 *   4. the bundles built from this checkout: only background.js carries the key's storage key
 *      and the Anthropic origin; the content, injected, popup, options and setup scripts carry
 *      neither the origin nor the header;
 *   5. the site never names the API, the header or the storage key;
 *   6. NO MODEL IDENTIFIER in any file of the repository or in any commit message: the model
 *      is chosen at run time from the list the owner's key returns.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const realLog = console.log;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; realLog(`  ok   ${name}${detail ? "  — " + detail : ""}`); }
  else { fail++; realLog(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const section = (title) => realLog(`\n${title}\n${"─".repeat(title.length)}`);
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const src = (rel) => fs.readFileSync(path.join(here, rel), "utf8");
const KEY_STORAGE = "coinmarketcat:agent:api-key";
const HOST = path.join("src", "background.mjs");
const BRAIN = path.join("src", "lib", "agent-brain.mjs");

section("1. THE AGENT MESSAGES");
const P = await import("./src/lib/protocol.mjs");
{
  const types = Object.values(P.AGENT ?? {});
  ok("the AGENT table is exactly status, save-spec, set-api-key, clear-api-key, list-models, start, pause, stop, run-now, liquidate and withdraw",
    JSON.stringify([...types].sort()) === JSON.stringify(["hawk:agent:clear-api-key", "hawk:agent:list-models", "hawk:agent:liquidate", "hawk:agent:pause", "hawk:agent:run-now",
      "hawk:agent:save-spec", "hawk:agent:set-api-key", "hawk:agent:start", "hawk:agent:status", "hawk:agent:stop", "hawk:agent:withdraw"].sort()), types.join(", "));
  ok("exactly one carries a secret: the API key, from Options", JSON.stringify(P.AGENT_CARRIES_SECRET) === JSON.stringify([P.AGENT.SET_API_KEY]));
  ok("none hands a secret back", Array.isArray(P.AGENT_RETURNS_SECRET) && P.AGENT_RETURNS_SECRET.length === 0);
  ok("no agent message names a signature or transaction bytes", types.every((t) => !/sign|tx|transaction|secret|keypair|sweep/i.test(t.replace("hawk:agent:", ""))));
  ok("no web page can send one: the page relay carries none", [...P.HAWK_FROM_PAGE, ...P.HAWK_TO_PAGE].every((t) => !t.startsWith("hawk:agent:")));
  for (const rel of [path.join("src", "content.mjs"), path.join("src", "injected.mjs")]) {
    const t = src(rel);
    ok(`${rel}: never names an agent message, the key's storage or the Anthropic API`, !/hawk:agent|AGENT|agent:api-key|anthropic|x-api-key/i.test(t));
  }
  ok("the UI table (Snipurr's lane) gained no message", Object.values(P.UI).every((t) => t.startsWith("hawk:ui:")) && Object.values(P.UI).length === 12);
}

section("2. THE SOURCE");
const files = walk(path.join(here, "src")).filter((f) => /\.(mjs|js|html|css)$/.test(f)).map((f) => path.relative(here, f));
{
  const holders = files.filter((rel) => src(rel).includes(KEY_STORAGE));
  ok("the key's storage key is written in the service worker and nowhere else under src/", JSON.stringify(holders) === JSON.stringify([HOST]), holders.join(", "));
  const bg = strip(src(HOST));          // the code: the header may SAY where the key is kept
  const fn = (name) => { const m = bg.match(new RegExp(`async function ${name}\\((?:msg)?\\) \\{[\\s\\S]*?\\n\\}\\n`)); return m ? { start: m.index, end: m.index + m[0].length, text: m[0] } : null; };
  const handlers = Object.fromEntries(["readApiKey", "agentSetApiKey", "agentClearApiKey", "agentStatus", "agentWithdraw"].map((n) => [n, fn(n)]));
  ok("the worker has its reader, its save, its clear, its status and its withdrawal", Object.values(handlers).every(Boolean), Object.entries(handlers).filter(([, v]) => !v).map(([k]) => k).join(", ") || "all five");
  const within = (i, names) => names.some((n) => handlers[n] && i >= handlers[n].start && i < handlers[n].end);
  const storageUses = [...bg.matchAll(/AGENT_KEY_STORAGE/g)].map((m) => m.index).filter((i) => bg.slice(i - 6, i) !== "const ");
  ok("the worker touches the stored key only in its reader, its save and its clear", storageUses.length === 4 && storageUses.every((i) => within(i, ["readApiKey", "agentSetApiKey", "agentClearApiKey"])), `${storageUses.length} uses`);
  const msgReads = [...bg.matchAll(/msg\.apiKey\b/g)];
  ok("the key is read from a message in the save handler, and nowhere else", msgReads.length >= 1 && msgReads.every((m) => within(m.index, ["agentSetApiKey"])), `${msgReads.length} reads`);
  const readerUses = [...bg.matchAll(/readApiKey/g)].length;
  ok("the reader is handed to the brain and to hasApiKey, and nothing else", readerUses === 3 && /createBrain\(\{ apiKey: readApiKey \}\)/.test(bg) && /async function hasApiKey\(\) \{ return \(await readApiKey\(\)\) !== null; \}/.test(bg));
  ok("the status says whether a key is saved, never what it is", /apiKeySaved: await hasApiKey\(\)/.test(handlers.agentStatus?.text ?? "") && !/readApiKey|AGENT_KEY_STORAGE/.test(handlers.agentStatus?.text ?? ""));
  const logLines = bg.split("\n").filter((l) => /\blog\(|console\.\w+\(/.test(l));
  const leaky = logLines.filter((l) => /apiKey|readApiKey|typed\b|AGENT_KEY_STORAGE|x-api-key/.test(l));
  ok("no log or console line in the worker names the key", leaky.length === 0, leaky.join(" | ") || `${logLines.length} log lines`);
  ok("the agent messages are answered for the extension's own pages only",
    /startsWith\("hawk:agent:"\)[\s\S]{0,200}if \(!fromExtensionPage\(sender\)\) return \{ ok: false, error: "the agent answers the extension's own pages only" \}/.test(bg));
  const headerFiles = files.filter((rel) => /x-api-key/.test(strip(src(rel))));
  ok("the x-api-key header is written in the brain and nowhere else", JSON.stringify(headerFiles) === JSON.stringify([BRAIN]), headerFiles.join(", "));
  const brain = strip(src(BRAIN));
  const hosts = [...new Set([...brain.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()))];
  ok("the brain's only host is api.anthropic.com", JSON.stringify(hosts) === JSON.stringify(["api.anthropic.com"]), hosts.join(", "));
  ok("the brain refuses to build a request anywhere else", /if \(!url\.startsWith\(`\$\{ANTHROPIC_API\}\/v1\/`\)\) throw/.test(brain));
  ok("the brain touches no storage, no chrome API and logs nothing", !/chrome\.|localStorage|sessionStorage|indexedDB|console\./.test(brain));
  const origin = files.filter((rel) => /api\.anthropic\.com/.test(strip(src(rel))));
  ok("the Anthropic origin is in the brain's code, and otherwise only in the options page's words to the owner", JSON.stringify(origin.sort()) === JSON.stringify([BRAIN, path.join("src", "options", "options.mjs")].sort())
    && !/fetch\(/.test(src(path.join("src", "options", "options.mjs"))), origin.join(", "));
  for (const rel of ["agent-runner.mjs", "agent-risk.mjs", "agent-market.mjs", "agent-strategy.mjs"].map((f) => path.join("src", "lib", f))) {
    const t = strip(src(rel));
    ok(`${rel}: never names the key, its header or its storage`, !/apiKey\(\)|x-api-key|agent:api-key|readApiKey/.test(t) && !/chrome\.|localStorage|sessionStorage/.test(t));
  }
  const opts = src(path.join("src", "options", "options.mjs"));
  ok("options: the key is typed into a password field", /<input type="password" id="agApiKey"/.test(opts));
  ok("options: the field is cleared the moment it is read, before anything is sent", /const apiKey = \$\("agApiKey"\)\.value\.trim\(\);\s*\$\("agApiKey"\)\.value = "";/.test(opts));
  ok("options: the key is sent once, as SET_API_KEY, and never shown again", (strip(opts).match(/AGENT\.SET_API_KEY/g) ?? []).length === 1 && !/apiKey\s*=\s*res|res\.apiKey\b|\.value = res/.test(opts));
  for (const rel of [path.join("src", "options", "options.mjs"), path.join("src", "popup", "popup.mjs")]) {
    const t = src(rel);
    ok(`${rel}: logs nothing and stores nothing itself`, !/console\./.test(t) && !/chrome\.storage|localStorage|sessionStorage/.test(t));
  }
  ok("the popup never handles the key at all", !/apiKey\b|agApiKey|SET_API_KEY/.test(src(path.join("src", "popup", "popup.mjs"))));
}

section("3. THE RUNNING WORKER");
{
  const KEY = "sk-test-WORKER-must-not-leak-9f8e7d6c5b4a";
  const EXT = "coinmarketcatagentextid";
  const PAGE = { id: EXT, url: `chrome-extension://${EXT}/options.html` };
  const WEB = { id: EXT, url: "https://catintelligenceagency.com/console/", tab: { id: 3 } };
  const DS = JSON.parse(src(path.join("fixtures", "agent", "dexscreener-tokens-cats.json")));
  const GT = JSON.parse(src(path.join("fixtures", "agent", "geckoterminal-ohlcv-jup-15m.json")));
  const POPCAT = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const wire = [];
  const response = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, async text() { return JSON.stringify(body); }, async json() { return body; } });
  let decided = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    wire.push({ url, host: u.host, headers: { ...(init.headers ?? {}) }, body: init.body ?? "" });
    if (u.host === "api.anthropic.com" && u.pathname === "/v1/models") return response(200, { data: [{ type: "model", id: "model-a", display_name: "Model A" }], has_more: false });
    if (u.host === "api.anthropic.com" && u.pathname === "/v1/messages") {
      decided++;
      return response(200, { id: "msg_w", type: "message", role: "assistant", model: "model-a", stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: "tool_use", id: "t", name: "submit_decisions", input: { rationale: "A small paper buy of POPCAT.", actions: [{ action: "buy", mint: POPCAT, usd: 20, confidence: 0.6, reason: "trend" }] } }] });
    }
    if (u.host === "api.dexscreener.com") return response(200, DS.body);
    if (u.host === "api.geckoterminal.com") return response(200, GT.body);
    if (u.host === "api.jup.ag" && u.pathname === "/swap/v1/quote") {
      const q = Object.fromEntries(u.searchParams);
      const out = BigInt(Math.floor(Number(q.amount) / 0.0574 * 1_000 * 0.999));   // USDC (6 decimals) into POPCAT (9) at about $0.0574
      return response(200, { inputMint: q.inputMint, inAmount: q.amount, outputMint: q.outputMint, outAmount: out.toString(), otherAmountThreshold: ((out * 9_900n + 9_999n) / 10_000n).toString(),
        swapMode: "ExactIn", slippageBps: Number(q.slippageBps), platformFee: null, priceImpactPct: "0.0004", routePlan: [{ swapInfo: { ammKey: "x", label: "X", inputMint: q.inputMint, outputMint: q.outputMint, inAmount: q.amount, outAmount: out.toString() }, bps: 10_000 }] });
    }
    throw new Error(`the test network refuses ${u.host}`);
  };
  globalThis.WebSocket = class { constructor() { throw new Error("no sockets here"); } };
  const logged = [];
  for (const level of ["log", "warn", "error", "info", "debug"]) console[level] = (...args) => { logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); };
  const local = new Map(), session = new Map();
  const listeners = { message: [], connect: [], installed: [], startup: [], alarm: [] };
  const area = (m) => ({
    async get(keys) { const list = keys == null ? [...m.keys()] : Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys); const out = {}; for (const k of list) if (m.has(k)) out[k] = structuredClone(m.get(k)); return out; },
    async set(obj) { for (const [k, v] of Object.entries(obj)) m.set(k, structuredClone(v)); },
    async remove(keys) { for (const k of [].concat(keys)) m.delete(k); },
    async setAccessLevel() {},
  });
  const notes = [];
  globalThis.chrome = {
    runtime: { id: EXT, getURL: (p) => `chrome-extension://${EXT}/${p}`, onMessage: { addListener: (f) => listeners.message.push(f) }, onConnect: { addListener: (f) => listeners.connect.push(f) },
      onInstalled: { addListener: (f) => listeners.installed.push(f) }, onStartup: { addListener: (f) => listeners.startup.push(f) }, sendMessage: async () => undefined, openOptionsPage() {} },
    storage: { local: area(local), session: area(session) },
    alarms: { create() {}, clear: async () => true, onAlarm: { addListener: (f) => listeners.alarm.push(f) } },
    notifications: { create: (id, o) => notes.push(o), clear() {}, onClicked: { addListener() {} } },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    tabs: { create: async () => ({}), query: async () => [], update: async () => ({}) }, windows: { update: async () => ({}) },
  };
  const send = (msg, sender = PAGE) => new Promise((resolve) => { for (const f of listeners.message) { if (f(msg, sender, resolve) === true) return; } resolve(undefined); });
  await import("./src/background.mjs");
  const refused = await send({ type: P.AGENT.SET_API_KEY, apiKey: KEY }, WEB);
  ok("a web page (the console tab) is refused, and nothing is stored", refused?.ok === false && /extension's own pages only/.test(refused.error) && !local.has(KEY_STORAGE));
  const bad = await send({ type: P.AGENT.SET_API_KEY, apiKey: "not a key" });
  ok("something that is not a key is refused", bad?.ok === false && !local.has(KEY_STORAGE));
  const saved = await send({ type: P.AGENT.SET_API_KEY, apiKey: KEY });
  ok("from the extension's own page the key is saved, under its one storage key", saved?.ok === true && local.get(KEY_STORAGE) === KEY && !JSON.stringify(saved).includes(KEY));
  const st = await send({ type: P.AGENT.STATUS });
  ok("STATUS says a key is saved, and does not carry it", st?.ok === true && st.apiKeySaved === true && !JSON.stringify(st).includes(KEY));
  const models = await send({ type: P.AGENT.LIST_MODELS });
  ok("the model list comes from the API with the key", models?.ok === true && models.models[0].id === "model-a" && wire.some((w) => w.url === "https://api.anthropic.com/v1/models?limit=100" && w.headers["x-api-key"] === KEY));
  const spec = await send({ type: P.AGENT.SAVE_SPEC, spec: { name: "Worker cat", strategy: "Buy POPCAT on strength; keep it small; cut losers.", universe: [POPCAT], mode: "paper" } });
  ok("the spec is saved", spec?.ok === true && spec.spec.universe.length === 1);
  const started = await send({ type: P.AGENT.START });
  ok("the agent starts on paper through the worker", started?.ok === true && started.agent.status === "running" && started.agent.mode === "paper");
  for (let i = 0; i < 200 && !(await send({ type: P.AGENT.STATUS })).agent.journal.some((j) => j.kind === "fill"); i++) await new Promise((r) => setTimeout(r, 25));
  const after = await send({ type: P.AGENT.STATUS });
  ok("its first tick asked the model and filled a paper buy at Jupiter's quote", decided === 1 && after.agent.journal.some((j) => j.kind === "fill" && j.paper === true && j.symbol === "POPCAT"), `${decided} decisions`);
  const carrying = wire.filter((w) => JSON.stringify(w).includes(KEY));
  ok("every request that carried the key went to https://api.anthropic.com, in the x-api-key header", carrying.length >= 2 && carrying.every((w) => w.url.startsWith("https://api.anthropic.com/v1/") && w.headers["x-api-key"] === KEY && !w.url.includes(KEY) && !w.body.includes(KEY)), `${carrying.length} of ${wire.length} requests`);
  ok("…and DexScreener, GeckoTerminal and Jupiter were asked without it", wire.filter((w) => w.host !== "api.anthropic.com").length >= 3 && wire.filter((w) => w.host !== "api.anthropic.com").every((w) => !JSON.stringify(w).includes(KEY)));
  const stored = [...local.entries()].filter(([k]) => k !== KEY_STORAGE);
  ok("nothing else stored carries the key: the agent's spec and state, the lane's config and book", !JSON.stringify(stored).includes(KEY) && stored.some(([k]) => k === "coinmarketcat:agent:state"), stored.map(([k]) => k).join(", "));
  ok("no log line and no notification carries it", !logged.join("\n").includes(KEY) && !JSON.stringify(notes).includes(KEY) && logged.some((l) => /agent: an API key was saved/.test(l)));
  const cleared = await send({ type: P.AGENT.CLEAR_API_KEY });
  const st2 = await send({ type: P.AGENT.STATUS });
  ok("CLEAR removes it from storage, and STATUS says so", cleared?.ok === true && !local.has(KEY_STORAGE) && st2.apiKeySaved === false);
  await send({ type: P.AGENT.STOP });
}

section("4. THE BUNDLES");
{
  let esbuildPresent = true;
  try { require.resolve("esbuild"); } catch { esbuildPresent = false; }
  if (!esbuildPresent) realLog("  (esbuild is not installed here — `npm ci` to scan the bundles; CI runs it)");
  else {
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-dist-"));
    const { buildOnce } = await import("./build.mjs");
    await buildOnce({ outdir });
    const read = (name) => fs.readFileSync(path.join(outdir, name), "utf8");
    ok("background.js carries the key's storage key and the Anthropic origin (the worker and its brain)", read("background.js").includes(KEY_STORAGE) && read("background.js").includes("https://api.anthropic.com"));
    for (const name of ["content.js", "injected.js", "popup.js", "welcome.js"]) {
      const t = read(name);
      ok(`${name}: no storage key for the API key, no Anthropic origin, no x-api-key header`, !t.includes(KEY_STORAGE) && !t.includes("api.anthropic.com") && !/["']x-api-key["']/.test(t));
    }
    const o = read("options.js");
    ok("options.js: no storage key for the API key and no x-api-key header (it names the API only in its words to the owner)", !o.includes(KEY_STORAGE) && !/["']x-api-key["']/.test(o) && !o.includes("anthropic-version"));
    fs.rmSync(outdir, { recursive: true, force: true });
  }
}

section("5. THE SITE");
{
  const siteFiles = walk(path.join(here, "site")).filter((f) => /\.(html|css|js|json)$/.test(f) && !f.includes(`${path.sep}vendor${path.sep}`));
  const hits = siteFiles.filter((f) => /api\.anthropic\.com|x-api-key|agent:api-key|hawk:agent/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(here, f));
  ok("no page of the site names the Anthropic API, the header, the key's storage or an agent message", hits.length === 0, hits.join(", "));
}

section("6. NO MODEL IDENTIFIER, ANYWHERE");
{
  /* The patterns are assembled from pieces so this file does not match itself. */
  const family = ["op" + "us", "son" + "net", "hai" + "ku", "fab" + "le", "myth" + "os", "inst" + "ant"].join("|");
  const ID = new RegExp(`\\bcl${"aude"}-(?:${family}|\\d)|\\b(?:${family})-\\d`, "i");
  const skip = new Set(["node_modules", ".git", "dist"]);
  const tree = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (skip.has(e.name) ? [] : e.isDirectory() ? tree(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const text = tree(here).filter((f) => /\.(mjs|js|json|html|css|md|txt|yml|yaml|svg)$/.test(f));
  const hits = text.filter((f) => ID.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(here, f));
  ok(`no file of the repository names a model identifier (${text.length} text files scanned)`, hits.length === 0, hits.join(", "));
  const git = spawnSync("git", ["log", "--format=%B"], { cwd: here, encoding: "utf8" });
  if (git.status === 0) ok("no commit message names one either", !ID.test(git.stdout), `${git.stdout.split("\n").filter(Boolean).length} lines of history`);
  else realLog("  (no git history here to scan)");
  const agentDefaults = (await import("./src/lib/agent-strategy.mjs")).AGENT_SPEC_DEFAULTS;
  ok("the agent's default model is chosen at run time: an empty string", agentDefaults.model === "");
}

realLog(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
