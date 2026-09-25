/**
 * THE PINATA KEY GOES TO ONE PLACE, AND THE CATS ANSWER THE EXTENSION'S OWN PAGES ONLY.
 *
 * CashCat keeps a second secret the owner typed — a Pinata JWT, to pin a coin's logo and
 * metadata on IPFS — the way the agent keeps the Anthropic key (test-agent-no-leak.mjs). This pins
 * it in the source, in the built bundles and through the RUNNING service worker:
 *
 *   1. the cats' message tables: POPCAT, CRYING and CASHCAT; exactly one message carries a secret
 *      (the JWT, from Options, once); none hands one back; none carries transaction bytes; no web
 *      page can send one, and the content and injected scripts never name them;
 *   2. the source: the JWT's storage key is in the service worker and nowhere else under src/; the
 *      worker reads it in its reader, its save and its clear, and hands it to pinMetadata alone,
 *      which sends it in one header to Pinata's upload API; no log line names it; Options takes it
 *      in a password field, clears it and sends it once; the popup never touches it;
 *   3. the running worker, under a chrome double, with fetch recorded: a web page is refused; the
 *      JWT is saved under its one key; STATUS says only that one is saved; a whole launch — the
 *      draft, the logo drawn in the worker, the pin and read-back, the check, the simulation, the
 *      new mint's signature and the autopilot wallet's, the send — and every request that carried
 *      the JWT went to https://uploads.pinata.cloud/v3/files, in the Authorization header, and
 *      nothing stored, logged, notified or answered carries it; CLEAR removes it;
 *   4. the bundles: only background.js carries the JWT's storage key and Pinata's upload host.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";

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
const JWT_STORAGE = "cia:cashcat:pinata-jwt";
const HOST = path.join("src", "background.mjs");

section("1. THE CATS' MESSAGES");
const P = await import("./src/lib/protocol.mjs");
{
  const all = [...Object.values(P.POPCAT), ...Object.values(P.CRYING), ...Object.values(P.CASHCAT)];
  ok("POPCAT is status, scan, set-background and clear", JSON.stringify(Object.values(P.POPCAT).sort()) === JSON.stringify(["cia:popcat:clear", "cia:popcat:scan", "cia:popcat:set-background", "cia:popcat:status"]));
  ok("CRYING is one message: check", JSON.stringify(Object.values(P.CRYING)) === JSON.stringify(["cia:crying:check"]));
  ok("CASHCAT is status, settings, the JWT's save and clear, drafts, the preview, prepare, launch, mark-checked and auto mode's arm and disarm",
    JSON.stringify(Object.values(P.CASHCAT).sort()) === JSON.stringify(["cia:cashcat:arm-auto", "cia:cashcat:clear-draft", "cia:cashcat:clear-pinata-jwt", "cia:cashcat:disarm-auto", "cia:cashcat:draft",
      "cia:cashcat:draft-from-trend", "cia:cashcat:launch", "cia:cashcat:mark-checked", "cia:cashcat:prepare", "cia:cashcat:preview", "cia:cashcat:save-settings", "cia:cashcat:set-pinata-jwt", "cia:cashcat:status"]));
  ok("exactly one carries a secret: the Pinata JWT, from Options", JSON.stringify(P.CATS_CARRIES_SECRET) === JSON.stringify([P.CASHCAT.SET_PINATA_JWT]));
  ok("none hands a secret back", Array.isArray(P.CATS_RETURNS_SECRET) && P.CATS_RETURNS_SECRET.length === 0);
  ok("every one is under cia:, apart from the lanes', the autopilot's and the agent's tables", all.every((t) => t.startsWith("cia:")) && [...Object.values(P.UI), ...Object.values(P.AUTOPILOT), ...Object.values(P.AGENT)].every((t) => !t.startsWith("cia:")));
  ok("no web page can send one: the page relay carries none", [...P.HAWK_FROM_PAGE, ...P.HAWK_TO_PAGE].every((t) => !t.startsWith("cia:")));
  for (const rel of [path.join("src", "content.mjs"), path.join("src", "injected.mjs")]) ok(`${rel}: never names a cat's message, the JWT or Pinata`, !/cia:|POPCAT|CRYING|CASHCAT|pinata/i.test(src(rel)));
  const bg = strip(src(HOST));
  ok("the cats answer the extension's own pages only", /startsWith\("cia:"\)\) return false;[\s\S]{0,120}if \(!fromExtensionPage\(sender\)\) return \{ ok: false, error: "the cats answer the extension's own pages only" \}/.test(bg));
  ok("no cat handler reads transaction bytes from a message: the worker builds every byte", !/msg\.(txBase64|tx|transaction|signed|signedBase64|instructions?|secretKey|keypair)\b/.test(bg));
}

section("2. THE SOURCE");
const files = walk(path.join(here, "src")).filter((f) => /\.(mjs|js|html|css)$/.test(f)).map((f) => path.relative(here, f));
{
  const holders = files.filter((rel) => src(rel).includes(JWT_STORAGE));
  ok("the JWT's storage key is written in the service worker and nowhere else under src/", JSON.stringify(holders) === JSON.stringify([HOST]), holders.join(", "));
  const bg = strip(src(HOST));
  const fn = (name) => { const m = bg.match(new RegExp(`async function ${name}\\((?:msg)?\\) \\{[\\s\\S]*?\\n\\}\\n`)); return m ? { start: m.index, end: m.index + m[0].length, text: m[0] } : null; };
  const handlers = Object.fromEntries(["readPinataJwt", "cashcatSetPinataJwt", "cashcatClearPinataJwt"].map((n) => [n, fn(n)]));
  ok("the worker has the JWT's reader, its save and its clear", Object.values(handlers).every(Boolean), Object.entries(handlers).filter(([, v]) => !v).map(([k]) => k).join(", ") || "all three");
  const within = (i, names) => names.some((n) => handlers[n] && i >= handlers[n].start && i < handlers[n].end);
  const uses = [...bg.matchAll(/PINATA_JWT_STORAGE/g)].map((m) => m.index).filter((i) => bg.slice(i - 6, i) !== "const ");
  ok("the worker touches the stored JWT only in its reader, its save and its clear", uses.length === 4 && uses.every((i) => within(i, ["readPinataJwt", "cashcatSetPinataJwt", "cashcatClearPinataJwt"])), `${uses.length} uses`);
  const reads = [...bg.matchAll(/msg\.jwt\b/g)];
  ok("the JWT is read from a message in the save handler, and nowhere else", reads.length >= 1 && reads.every((m) => within(m.index, ["cashcatSetPinataJwt"])), `${reads.length} reads`);
  ok("the reader is used by hasPinataJwt and by the pin, which hands it to pinMetadata alone", (bg.match(/(?<!function )readPinataJwt\(\)/g) ?? []).length === 2 && /const jwt = await readPinataJwt\(\);[\s\S]{0,120}return pinMetadata\(\{ http: pinataHttp, jwt, logoPng, coin, venue: "pumpfun", buildDoc \}\);/.test(bg));
  ok("…over a client allowed Pinata's upload API and its gateway only", /const pinataHttp = catHttp\(\[HOSTS\.pinataUpload, HOSTS\.pinataGateway\]\);/.test(bg));
  const meta = strip(src(path.join("bots", "cashcat", "metadata.mjs")));
  ok("pinMetadata puts the JWT in one header, of the one request to Pinata's upload API; the read-back carries none", (meta.match(/jwt/g) ?? []).length >= 3 && /http\.request\(URLS\.pinataUpload, \{ method: "POST", headers: \{ authorization: `Bearer \$\{jwt\}` \}/.test(meta) && /http\.json\(URLS\.pinataGateway\(documentCid\), \{ timeoutMs: 60_000 \}\)/.test(meta));
  const logLines = bg.split("\n").filter((l) => /\blog\(|console\.\w+\(|notify\(/.test(l));
  ok("no log, console or notification line in the worker names the JWT", !logLines.some((l) => /jwt\b|readPinataJwt|PINATA_JWT_STORAGE|typed\b/.test(l)), `${logLines.length} lines`);
  const status = fn("cashcatStatus")?.text ?? "";
  ok("the status says whether a JWT is saved, never what it is", /pinataSaved: await hasPinataJwt\(\)/.test(status) && !/readPinataJwt/.test(status));
  const opts = src(path.join("src", "options", "cats.mjs"));
  ok("options: the JWT is typed into a password field", /<input type="password" id="ccPinataJwt"/.test(opts));
  ok("options: the field is cleared the moment it is read, before anything is sent", /const jwt = \$\("ccPinataJwt"\)\.value\.trim\(\);\s*\$\("ccPinataJwt"\)\.value = "";/.test(opts));
  ok("options: the JWT is sent once, as SET_PINATA_JWT, and never shown again", (strip(opts).match(/CASHCAT\.SET_PINATA_JWT/g) ?? []).length === 1 && !/res\.jwt\b|\.value = res/.test(opts));
  for (const rel of [path.join("src", "options", "cats.mjs"), path.join("src", "popup", "cats.mjs")]) {
    const t = strip(src(rel));
    ok(`${rel}: logs nothing and stores nothing itself`, !/console\./.test(t) && !/chrome\.storage|localStorage|sessionStorage/.test(t));
  }
  ok("the popup never handles the JWT at all (it only says, in words, that Pinata is used)", [path.join("src", "popup", "cats.mjs"), path.join("src", "popup", "popup.mjs")].every((rel) => !/jwt|SET_PINATA|ccPinata/i.test(strip(src(rel)))));
  ok("the only files that name Pinata's upload host are the worker's map of hosts' reasons and the options page's words", files.filter((rel) => /uploads\.pinata\.cloud/.test(strip(src(rel)))).sort().join() === [path.join("src", "options", "cats.mjs")].join());
}

section("3. THE RUNNING WORKER");
let canvas = null;
try { canvas = await (await import("./bots/cashcat/logo.mjs")).canvasModule(); } catch { canvas = null; }
if (!canvas) {
  realLog("  (the canvas renderer is not installed: `npm ci --prefix bots` to run a whole launch through the worker; CI does)");
  ok("the renderer is installed where CI runs the suite", !process.env.CI);
} else {
  const { STATIC } = await import("./build.mjs");
  const fromBuild = new Map(STATIC.map(([from, to]) => [to, from]));
  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LXBpbmF0YS1uby1sZWFrIn0.c2lnbmF0dXJlLW11c3Qtbm90LWxlYWs";
  const EXT = "catsnoleakextensionid";
  const PAGE = { id: EXT, url: `chrome-extension://${EXT}/popup.html` };
  const WEB = { id: EXT, url: "https://catintelligenceagency.com/console/", tab: { id: 3 } };
  const RPC = "https://rpc.cats.example/v1/secret-rpc-key-0000";
  const SIM = JSON.parse(src(path.join("fixtures", "bots", "pumpfun", "simulate-create-v2.json"))).result;
  const SPEND = SIM.payerBefore - SIM.payerAfter;
  const wire = [];
  const lamports = new Map();
  const sent = [];
  const accounts = new Map();
  const uploads = [], docs = new Map();
  const res = (status, body, extra = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => extra[k.toLowerCase()] ?? null },
    async text() { return typeof body === "string" ? body : Buffer.isBuffer(body) ? body.toString("utf8") : JSON.stringify(body); },
    async json() { return typeof body === "string" ? JSON.parse(body) : Buffer.isBuffer(body) ? JSON.parse(body.toString("utf8")) : body; },
    async arrayBuffer() { const b = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
    async blob() { return new Blob([Buffer.isBuffer(body) ? body : Buffer.from(String(body))]); } });
  const headersOf = (h) => (h && typeof h.forEach === "function" ? Object.fromEntries([...h.entries()]) : { ...(h ?? {}) });
  const rpcAnswer = (method, params) => {
    const slot = 450_000_000;
    switch (method) {
      case "getLatestBlockhash": return { context: { slot }, value: { blockhash: bs58.encode(Buffer.alloc(32, 7)), lastValidBlockHeight: 400_000_150 } };
      case "getBalance": return { context: { slot }, value: Number(lamports.get(params[0]) ?? 0n) };
      case "getBlockHeight": return 400_000_000;
      case "getTokenAccountsByOwner": return { context: { slot }, value: [] };
      case "simulateTransaction": {
        const tx = VersionedTransaction.deserialize(Buffer.from(params[0], "base64"));
        const payer = tx.message.staticAccountKeys[0].toBase58();
        return { context: { slot }, value: { err: null, logs: SIM.logs, unitsConsumed: SIM.unitsConsumed, accounts: (params[1]?.accounts?.addresses ?? []).map((a) => (a === payer ? { lamports: Number(lamports.get(payer) ?? 0n) - SPEND, owner: "11111111111111111111111111111111", data: ["", "base64"], executable: false, rentEpoch: 0 } : null)) } };
      }
      case "sendTransaction": {
        const tx = VersionedTransaction.deserialize(Buffer.from(params[0], "base64"));
        const msg = tx.message.serialize();
        const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
        signers.forEach((k, i) => { if (!ed25519.verify(tx.signatures[i], msg, k.toBytes())) throw new Error(`signature ${i} does not verify`); });
        const payer = signers[0].toBase58(), signature = bs58.encode(tx.signatures[0]);
        const pre = Number(lamports.get(payer) ?? 0n);
        lamports.set(payer, BigInt(pre - SPEND));
        const mint = signers[1]?.toBase58();
        if (mint) { const d = Buffer.alloc(82); d.writeBigUInt64LE(10n ** 15n, 36); d[44] = 6; d[45] = 1; accounts.set(mint, { owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", lamports: 1, data: [d.toString("base64"), "base64"] }); }
        sent.push({ signature, payer, mint, pre, post: pre - SPEND, keys: tx.message.staticAccountKeys.map((k) => k.toBase58()), signers: signers.length });
        return signature;
      }
      case "getSignatureStatuses": return { context: { slot }, value: params[0].map((s) => (sent.some((x) => x.signature === s) ? { confirmationStatus: "confirmed", err: null } : null)) };
      case "getTransaction": { const s = sent.find((x) => x.signature === params[0]); return s ? { slot, meta: { err: null, fee: 7_500, preBalances: [s.pre], postBalances: [s.post] }, transaction: { message: { accountKeys: s.keys } } } : null; }
      case "getMultipleAccounts": return { context: { slot }, value: params[0].map((a) => accounts.get(a) ?? null) };
      default: throw new Error(`the RPC double has no ${method}`);
    }
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const body = typeof init.body === "string" ? init.body : init.body instanceof FormData ? `[form: ${[...init.body.keys()].join(",")}]` : "";
    wire.push({ url: String(url), host: u.host, headers: headersOf(init.headers), body });
    if (u.protocol === "chrome-extension:") {
      const from = fromBuild.get(u.pathname.slice(1));
      return from ? res(200, fs.readFileSync(path.join(here, from))) : res(404, "missing");
    }
    if (String(url) === RPC) {
      const req = JSON.parse(init.body);
      try { return res(200, { jsonrpc: "2.0", id: req.id, result: rpcAnswer(req.method, req.params) }); }
      catch (e) { return res(200, { jsonrpc: "2.0", id: req.id, error: { code: -32000, message: e.message } }); }
    }
    if (String(url) === "https://uploads.pinata.cloud/v3/files") {
      const file = init.body.get("file");
      const bytes = Buffer.from(await file.arrayBuffer());
      const cid = `bafkrei${"q".repeat(51)}${"abcdef"[uploads.length]}`;
      uploads.push({ auth: headersOf(init.headers).authorization, type: file.type, cid });
      if (file.type === "application/json") docs.set(cid, JSON.parse(bytes.toString("utf8")));
      return res(200, { data: { cid } });
    }
    if (u.host === "gateway.pinata.cloud") return docs.has(u.pathname.split("/ipfs/")[1]) ? res(200, docs.get(u.pathname.split("/ipfs/")[1])) : res(404, "{}");
    if (u.host === "lite-api.jup.ag") return res(200, JSON.parse(src(path.join("fixtures", "bots", "jupiter", "verified-sample.json"))).tokens);
    throw new Error(`the test network refuses ${u.host}`);
  };
  /* The worker's canvas, image decoder and font loader, over the bot's own renderer. */
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.c = canvas.createCanvas(w, h); } getContext(t) { return this.c.getContext(t); } async convertToBlob() { return new Blob([this.c.toBuffer("image/png")], { type: "image/png" }); } };
  globalThis.createImageBitmap = async (blob) => canvas.loadImage(Buffer.from(await blob.arrayBuffer()));
  globalThis.FontFace = class { constructor(family, source) { this.family = family; this.url = source.match(/url\((.*)\)/)[1]; } async load() { if (!canvas.GlobalFonts.has(this.family)) canvas.GlobalFonts.registerFromPath(path.join(here, fromBuild.get(new URL(this.url).pathname.slice(1))), this.family); } };
  globalThis.fonts = { add() {} };
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
  const answers = [];
  const ask = async (msg, sender) => { const r = await send(msg, sender); answers.push(r); return r; };

  ok("a web page (the console tab) is refused by every cat, and nothing is stored",
    (await ask({ type: P.CASHCAT.SET_PINATA_JWT, jwt: JWT }, WEB))?.ok === false && (await ask({ type: P.POPCAT.SCAN }, WEB))?.ok === false && (await ask({ type: P.CRYING.CHECK, input: "x" }, WEB))?.ok === false
      && (await ask({ type: P.CASHCAT.LAUNCH, confirmTicker: "X" }, WEB))?.ok === false && !local.has(JWT_STORAGE));
  ok("something that is not a JWT is refused", (await ask({ type: P.CASHCAT.SET_PINATA_JWT, jwt: "not a token" }))?.ok === false && !local.has(JWT_STORAGE));
  const saved = await ask({ type: P.CASHCAT.SET_PINATA_JWT, jwt: JWT });
  ok("from the extension's own page the JWT is saved, under its one storage key", saved?.ok === true && local.get(JWT_STORAGE) === JWT);
  const st = await ask({ type: P.CASHCAT.STATUS });
  ok("STATUS says a JWT is saved, and does not carry it", st?.ok === true && st.pinataSaved === true && !JSON.stringify(st).includes(JWT));

  /* A funded, unlocked autopilot wallet and the user's RPC, through the worker's own messages. */
  await send({ type: "hawk:ui:set-config", config: { rpcUrl: RPC } });     // the lane's own config answer names its RPC, as it always has
  const PASS = "a passphrase for the cats test";
  const made = await ask({ type: P.AUTOPILOT.CREATE, passphrase: PASS, confirm: PASS });
  lamports.set(made.publicKey, 1_000_000_000n);
  await ask({ type: P.AUTOPILOT.UNLOCK, passphrase: PASS, minutes: 60 });
  const draft = await ask({ type: P.CASHCAT.DRAFT, idea: { name: "Rainy Day Cat", symbol: "RAINCAT", tagline: "A cat watching the rain from a warm windowsill.", topic: "rainy weather", kitten: "ginger", background: "sky" } });
  ok("a draft is judged by the rules in the worker", draft?.ok === true && draft.refusals.length === 0, JSON.stringify(draft?.refusals ?? draft?.error));
  const preview = await ask({ type: P.CASHCAT.PREVIEW });
  ok("the logo is drawn in the worker, from the extension's own files, as a PNG", preview?.ok === true && preview.dataUrl.startsWith("data:image/png;base64,") && preview.bytes > 100_000);
  const launch = await ask({ type: P.CASHCAT.LAUNCH, confirmTicker: "RAINCAT" });
  ok("a whole launch runs through the worker: pinned, checked, simulated, signed by the new mint and the autopilot wallet, sent once", launch?.ok === true && sent.length === 1 && sent[0].signers === 2 && sent[0].payer === made.publicKey && uploads.length === 2, JSON.stringify(launch?.error ?? ""));
  const carrying = wire.filter((w) => JSON.stringify(w).includes(JWT));
  ok("every request that carried the JWT went to https://uploads.pinata.cloud/v3/files, in the Authorization header, and nowhere else",
    carrying.length === 2 && carrying.every((w) => w.url === "https://uploads.pinata.cloud/v3/files" && w.headers.authorization === `Bearer ${JWT}` && !w.url.includes(JWT) && !w.body.includes(JWT)), `${carrying.length} of ${wire.length} requests`);
  ok("…the read-back from the public gateway, the RPC and Jupiter were asked without it", wire.filter((w) => w.host !== "uploads.pinata.cloud").every((w) => !JSON.stringify(w).includes(JWT)) && wire.some((w) => w.host === "gateway.pinata.cloud"));
  const stored = [...local.entries(), ...session.entries()].filter(([k]) => k !== JWT_STORAGE);
  ok("nothing else stored carries it: the journal, the draft, the settings, the lanes' state", !JSON.stringify(stored).includes(JWT) && stored.some(([k]) => k === "cia:cashcat:journal"), stored.map(([k]) => k).join(", "));
  ok("no log line, no notification and no answer carries it", !logged.join("\n").includes(JWT) && !JSON.stringify(notes).includes(JWT) && !JSON.stringify(answers).includes(JWT) && logged.some((l) => /a Pinata key was saved/.test(l)));
  ok("…nor the RPC's key", !logged.join("\n").includes("secret-rpc-key-0000") && !JSON.stringify(answers).includes("secret-rpc-key-0000"));
  const cleared = await ask({ type: P.CASHCAT.CLEAR_PINATA_JWT });
  const st2 = await ask({ type: P.CASHCAT.STATUS });
  ok("CLEAR removes it from storage, and STATUS says so", cleared?.ok === true && !local.has(JWT_STORAGE) && st2.pinataSaved === false);
  const again = await ask({ type: P.CASHCAT.PREPARE });
  ok("…and without it CashCat refuses to launch, by name", again?.ok === false && again.code === "no_pinata");
  const cry = await ask({ type: P.CRYING.CHECK, input: "not an address" });
  ok("Crying Cat refuses a bad input in the worker too, before any read", cry?.ok === false && cry.code === "bad_input" && !wire.slice(-1)[0]?.body?.includes("not an address"));
}

section("4. THE BUNDLES");
{
  let esbuildPresent = true;
  try { require.resolve("esbuild"); } catch { esbuildPresent = false; }
  if (!esbuildPresent) realLog("  (esbuild is not installed here — `npm ci` to scan the bundles; CI runs it)");
  else {
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "cats-dist-"));
    const { buildOnce } = await import("./build.mjs");
    await buildOnce({ outdir });
    const read = (name) => fs.readFileSync(path.join(outdir, name), "utf8");
    ok("background.js carries the JWT's storage key and Pinata's upload API (the worker and pinMetadata)", read("background.js").includes(JWT_STORAGE) && read("background.js").includes("https://uploads.pinata.cloud/v3/files"));
    for (const name of ["content.js", "injected.js", "popup.js", "welcome.js", "options.js"]) {
      const t = read(name);
      ok(`${name}: no storage key for the JWT, and no request to Pinata's upload API`, !t.includes(JWT_STORAGE) && !t.includes("https://uploads.pinata.cloud/v3/files"));
    }
    fs.rmSync(outdir, { recursive: true, force: true });
  }
}

realLog(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
