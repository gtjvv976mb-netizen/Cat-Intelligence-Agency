/**
 * CASHCAT IN THE EXTENSION: THE DRAFTS, THE LOGO, THE LAUNCH, THE MINT'S KEY AND AUTO MODE.
 *
 * Offline: the trends, Jupiter's verified list and the Anthropic API are the recorded or scripted
 * answers the bots' own tests use (fixtures/bots/, invented model ids); Pinata is scripted; the
 * chain is a double that verifies every ed25519 signature of what it is sent and answers a
 * create_v2 simulation with the one recorded on mainnet (fixtures/bots/pumpfun/simulate-create-v2.json).
 * The signer is the real autopilot wallet (a keystore over Maps) through the real engine's fences,
 * and the new mint's key is the real one from session-wallet.mjs.
 *
 *   1. the settings and their fences: no dev buy by default, at most 0.05 SOL, at most 2 a day;
 *   2. drafts refused by the content rules, each by name, and the model's review;
 *   3. drafting from a trend: the model picked at run time from GET /v1/models;
 *   4. the logo: the layout maths, and (with @napi-rs/canvas) the extension's renderer drawing the
 *      bot's logo pixel for pixel, with each sign measured as the bot measures it;
 *   5. the launch: checked, simulated, pinned, signed by the mint and the autopilot wallet, sent once;
 *      the create passes the bot's pre-sign check; hostile answers refused before any signature;
 *   6. the mint's key: made, used once and dropped in session-wallet.mjs; nothing left in storage;
 *   7. auto mode: the arm sentence, the checklist, the schedule, the day cap, the minimum balance,
 *      no dev buy, and never a buy or a sell of its coins.
 */
import fs from "node:fs";
import path from "node:path";
import { VersionedTransaction, PublicKey, Keypair, TransactionMessage, AddressLookupTableAccount } from "@solana/web3.js";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import { harness, fixture, scriptedFetch, response, ROOT } from "./bots/test/doubles.mjs";
import { createHttp } from "./bots/lib/http.mjs";
import { URLS, HOSTS, PUMPFUN_PROGRAM, PUMPFUN_GLOBAL, IX } from "./bots/lib/verified.mjs";
import { readMessage, pda } from "./bots/lib/solana.mjs";
import { checkLaunchMessage, checkDevBuyMessage } from "./bots/lib/txcheck.mjs";
import { createV2Ix, decodeCreateV2, decodeBuyIx } from "./bots/cashcat/pumpfun.mjs";
import { pinMetadata } from "./bots/cashcat/metadata.mjs";
import { readTrends } from "./bots/cashcat/trends.mjs";
import { KITTENS, BACKGROUNDS, placeText, LOGO_SIZE, FONT_FAMILY } from "./bots/cashcat/logo-layout.mjs";
import { BONDING_CURVE_LAYOUT } from "./vendor/executor/snipe-venue-pumpfun.mjs";
import { createBrain } from "./src/lib/agent-brain.mjs";
import { createDraftDesk, typedDraft, USER_PERSONA } from "./src/lib/cashcat-draft.mjs";
import { createLogoRenderer } from "./src/lib/cashcat-logo.mjs";
import {
  createCashcatTab, normalizeCashcatSettings, autoArmSentence, CASHCAT_TAB_DEFAULTS, CASHCAT_TAB_KEYS, LAUNCH_BUDGET_LAMPORTS, FIRST_AUTO_DELAY_MS, CASHCAT_VENUE_NOTE,
} from "./src/lib/cashcat-tab.mjs";
import { createKeystore, createSessionSigner, createMintKeys, MINT_KEY_TTL_MS } from "./src/lib/session-wallet.mjs";
import { createHawkEngine, memoryStore } from "./src/lib/engine.mjs";
import { STATIC } from "./build.mjs";

const { ok, section, done } = harness("test-cats-cashcat");
const HOUR = 3_600_000;
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SIM = fixture("pumpfun/simulate-create-v2.json").result;
const CREATE_SPEND = BigInt(SIM.payerBefore - SIM.payerAfter);          // 5,549,700 lamports, recorded on mainnet
const GOOD = { name: "Rainy Day Cat", symbol: "RAINCAT", tagline: "A cat watching the rain from a warm windowsill.", topic: "rainy weather", kitten: "ginger", background: "sky" };
const mapStore = () => { const m = new Map(); return { m, async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; }, async set(k, v) { m.set(k, structuredClone(v)); }, async remove(k) { m.delete(k); } }; };
/* A refusal's name: `clause` on the cats' errors, `code` on the session wallet's. */
const throwsClause = async (fn, clause) => { try { await fn(); return null; } catch (e) { const c = e?.clause ?? e?.code; return c === clause ? Object.assign(e, { clause: c }) : { wrong: c ?? e?.message }; } };

/* ── the network: trends, Jupiter, the Anthropic API, Pinata ─────────────────────────────── */
const MODELS = ["test-model-a", "test-model-b"];
function network({ proposal = null, review = { verdict: "approve", rules: [], reason: "fine" }, models = MODELS } = {}) {
  const uploads = [], docs = new Map(), asked = [];
  const { fetchImpl, calls } = scriptedFetch([
    [URLS.googleTrendsRss("US"), () => response(200, fixture("trends/google-trends-us.xml"))],
    [URLS.coingeckoTrending, () => fixture("trends/coingecko-trending.json").body],
    [URLS.jupiterVerified, () => fixture("jupiter/verified-sample.json").tokens],
    ["https://api.anthropic.com/v1/models", () => ({ data: models.map((id) => ({ id, type: "model", display_name: id })) })],
    ["https://api.anthropic.com/v1/messages", (_u, init) => {
      const body = JSON.parse(init.body);
      const name = body.tools[0].name;
      asked.push({ model: body.model, tool: name, system: body.system, headers: init.headers });
      const input = name === "propose_coin" ? (typeof proposal === "function" ? proposal() : proposal) : (typeof review === "function" ? review() : review);
      return { id: "msg_test", model: body.model, stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", id: "t", name, input }] };
    }],
    [URLS.pinataUpload, async (_u, init) => {
      const file = init.body.get("file");
      const bytes = Buffer.from(await file.arrayBuffer());
      const cid = `bafkrei${"x".repeat(51)}${"abcdefghijklmnopqrstuvwxyz"[uploads.length % 26]}`;
      uploads.push({ auth: init.headers.authorization, name: init.body.get("name"), type: file.type, bytes, cid });
      if (file.type === "application/json") docs.set(cid, JSON.parse(bytes.toString("utf8")));
      return { data: { id: "test", cid } };
    }],
    ["https://gateway.pinata.cloud/ipfs/", (u) => docs.get(u.split("/ipfs/")[1]) ?? response(404, "{}")],
  ]);
  const http = createHttp({ fetchImpl, allowedHosts: Object.values(HOSTS), sleep: async () => {} });
  return { http, fetchImpl, calls, uploads, docs, asked };
}

/* ── the chain: signatures verified, the recorded create_v2 simulation, a dev buy ─────────── */
function makeChain({ wallet, lamports = 1_000_000_000n }) {
  const st = { lamports: new Map([[wallet, BigInt(lamports)]]), accounts: new Map(), sent: [], sims: 0, slot: 450_000_000, blockHeight: 400_000_000, mode: {} };
  st.accounts.set(PUMPFUN_GLOBAL, { owner: PUMPFUN_PROGRAM, lamports: 1, data: Buffer.from(fixture("pumpfun/global.json").dataBase64, "base64") });
  const curveTemplate = Buffer.from(fixture("popcat/snapshots.json").snapshots[1].curveAccount.dataBase64, "base64");
  const parse = (tx) => {
    const m = readMessage(tx.message);
    const pump = m.instructions.filter((ix) => ix.programId === PUMPFUN_PROGRAM);
    const kinds = pump.map((ix) => (ix.data.subarray(0, 8).toString("hex") === IX.pumpCreateV2 ? "create" : ix.data.subarray(0, 8).toString("hex") === IX.pumpBuyV2 ? "buy" : "other"));
    return { m, pump, kind: kinds.length === 1 ? kinds[0] : "other" };
  };
  const spendOf = ({ pump, kind }) => (kind === "create" ? CREATE_SPEND : kind === "buy" ? decodeBuyIx(pump[0].data).maxQuoteInRaw + 2_074_080n + 7_500n : 5_000n) + BigInt(st.mode.extraSpend ?? 0);
  const mintAccount = () => { const d = Buffer.alloc(82); d.writeBigUInt64LE(1_000_000_000_000_000n, 36); d[44] = 6; d[45] = 1; return { owner: TOKEN_2022, lamports: 1_461_600, data: d }; };
  const rpc = {
    url: "https://chain.double",
    async getLatestBlockhash() { return st.mode.noBlockhash ? { blockhash: undefined } : { blockhash: bs58.encode(Buffer.alloc(32, 7)), lastValidBlockHeight: st.blockHeight + 150 }; },
    async getBalance(a) { return st.lamports.get(String(a)) ?? 0n; },
    async simulateTransaction(b64, { addresses = [] } = {}) {
      st.sims++;
      const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
      if (st.mode.simErr) return { err: { InstructionError: [2, { Custom: 6000 }] }, logs: ["Program log: AnchorError"], accounts: null };
      const p = parse(tx);
      const payer = p.m.feePayer;
      return { err: null, logs: p.kind === "create" ? SIM.logs : ["Program log: Instruction: BuyV2"], unitsConsumed: SIM.unitsConsumed,
        accounts: addresses.map((a) => (a === payer ? { lamports: Number((st.lamports.get(payer) ?? 0n) - spendOf(p)), owner: "11111111111111111111111111111111", data: ["", "base64"] } : null)) };
    },
    async sendTransaction(b64) {
      const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
      const msg = tx.message.serialize();
      const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
      signers.forEach((k, i) => { if (!ed25519.verify(tx.signatures[i], msg, k.toBytes())) throw new Error(`signature ${i} (${k.toBase58()}) does not verify`); });
      const p = parse(tx);
      const payer = p.m.feePayer;
      const pre = st.lamports.get(payer) ?? 0n, post = pre - spendOf(p);
      const signature = bs58.encode(tx.signatures[0]);
      st.lamports.set(payer, post);
      if (p.kind === "create") {
        const mint = p.pump[0].accounts[0].pubkey;
        st.accounts.set(mint, mintAccount());
        const curve = Buffer.from(curveTemplate);
        new PublicKey(payer).toBuffer().copy(curve, BONDING_CURVE_LAYOUT.creator);
        st.accounts.set(pda([{ utf8: "bonding-curve" }, { key: mint }], PUMPFUN_PROGRAM), { owner: PUMPFUN_PROGRAM, lamports: 1, data: curve });
      }
      st.sent.push({ signature, tx, kind: p.kind, payer, pre, post, m: p.m });
      return signature;
    },
    async getSignatureStatus(sig) {
      if (st.mode.pending) return null;
      const s = st.sent.find((x) => x.signature === sig);
      return s ? { err: st.mode.failOnChain ? { InstructionError: [2, { Custom: 1 }] } : null, confirmationStatus: "confirmed" } : null;
    },
    async getBlockHeight() { return st.blockHeight + (st.mode.expired ? 1_000 : 0); },
    async getTransaction(sig) {
      const s = st.sent.find((x) => x.signature === sig);
      return s ? { slot: st.slot, meta: { err: null, fee: 7_500, preBalances: [Number(s.pre)], postBalances: [Number(s.post)] }, transaction: { message: { accountKeys: s.m.accountKeys } } } : null;
    },
    async getMultipleAccounts(addresses) {
      return { slot: st.slot, accounts: addresses.map((a) => { const acc = st.accounts.get(String(a)); return acc ? { owner: acc.owner, lamports: acc.lamports, data: [acc.data.toString("base64"), "base64"] } : null; }) };
    },
  };
  return { st, rpc };
}

/* ── the logo renderer: the extension's, over @napi-rs/canvas when bots/ has it installed ───── */
let napi = null;
try { napi = await (await import("./bots/cashcat/logo.mjs")).canvasModule(); } catch { napi = null; }
const builtFrom = new Map(STATIC.map(([from, to]) => [to, from]));
function nodeRenderer({ signsOverride = null } = {}) {
  return createLogoRenderer({
    urlFor: (p) => p,
    fetchImpl: async (p) => {
      const src = builtFrom.get(p);
      if (!src) return { ok: false };
      const bytes = fs.readFileSync(path.join(ROOT, src));
      return { ok: true, json: async () => (p === "art/signs.json" && signsOverride ? signsOverride : JSON.parse(bytes.toString("utf8"))), arrayBuffer: async () => bytes };
    },
    decode: (bytes) => napi.loadImage(Buffer.from(bytes)),
    makeCanvas: (w, h) => napi.createCanvas(w, h),
    toPng: async (c) => new Uint8Array(c.toBuffer("image/png")),
    loadFont: async (family) => { if (!napi.GlobalFonts.has(family)) napi.GlobalFonts.registerFromPath(path.join(ROOT, builtFrom.get("art/font/PressStart2P-Regular.ttf")), family); },
  });
}
const stubRenderer = { render: async () => ({ png: new Uint8Array(Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")) }) };

/* ── a world: the autopilot wallet, the engine's fences, the tab ─────────────────────────── */
const PASS = "the cat that launches its own coin";
async function world({ lamports = 1_000_000_000n, net = network(), locked = false, jwt = true, apiKey = true, rpcUp = true, start = Date.parse("2026-09-25T09:00:00Z"), renderer = napi ? nodeRenderer() : stubRenderer } = {}) {
  const T = { now: start, step: 0 };
  const clock = () => { T.now += T.step; return T.now; };
  const keystore = createKeystore({ storage: mapStore(), session: mapStore(), clock });
  const { publicKey: WALLET } = await keystore.create({ passphrase: PASS });
  if (!locked) await keystore.unlock({ passphrase: PASS, ttlMs: 48 * HOUR });
  const signer = createSessionSigner({ keystore, clock });
  await signer.refresh();
  const chain = makeChain({ wallet: WALLET, lamports });
  const phantomAsked = [];
  const phantom = { isReady: () => true, wallet: () => null, async signTransaction(req) { phantomAsked.push(req); throw new Error("Phantom must not be asked by CashCat"); } };
  const timers = { setTimeout: (f) => setImmediate(f), clearTimeout() {}, setInterval: () => 0, clearInterval() {} };
  const engine = createHawkEngine({ rpc: chain.rpc, bridge: phantom, sessionSigner: signer, store: memoryStore(), clock, timers, config: { rpcUrl: "https://chain.double" } });
  const brain = createBrain({ fetchImpl: net.fetchImpl, apiKey: async () => (apiKey ? "sk-ant-test-cashcat-0000" : null), clock });
  const storage = mapStore();
  const model = async () => {
    const s = await storage.get(CASHCAT_TAB_KEYS.settings);
    return { hasKey: apiKey, callTool: async ({ tool, system, user }) => (await brain.callTool({ chosen: s?.model ?? "", tool, system, user })).input };
  };
  const desk = createDraftDesk({ http: net.http, model, clock });
  const mintKeys = createMintKeys({ clock });
  const pinata = { hasJwt: async () => jwt, pin: ({ logoPng, coin, buildDoc }) => pinMetadata({ http: net.http, jwt: "eyJ.test-pinata.jwt", logoPng, coin, venue: "pumpfun", buildDoc }) };
  const notes = [];
  const fences = () => { const f = engine.agentFences(); return rpcUp ? f : { ...f, rpc: () => null }; };
  const tab = createCashcatTab({ storage, desk, renderLogo: (spec) => renderer.render(spec), pinata, fences, mintKeys, hasApiKey: async () => apiKey, clock, notify: (n) => notes.push(n) });
  return { T, clock, keystore, signer, WALLET, chain, engine, tab, storage, mintKeys, net, phantomAsked, notes };
}

section("1. THE SETTINGS AND THEIR FENCES");
{
  const d = CASHCAT_TAB_DEFAULTS;
  ok("defaults: no dev buy, no \"made with CashCat\" line, the first model the key lists, auto mode off at 2 a day, 0.05 SOL minimum, every 12 hours",
    d.devBuySol === 0 && d.madeWithCashCat === false && d.model === "" && d.auto.on === false && d.auto.maxPerDay === 2 && d.auto.minBalanceSol === 0.05 && d.auto.everyHours === 12);
  const refuses = (input, clause) => { try { normalizeCashcatSettings(input, structuredClone(d)); return false; } catch (e) { return e.clause === clause; } };
  ok("a dev buy up to 0.05 SOL is taken; above it, below zero or not a number is refused by name, never clamped",
    normalizeCashcatSettings({ devBuySol: 0.05 }, structuredClone(d)).devBuySol === 0.05 && refuses({ devBuySol: 0.0500001 }, "dev_buy") && refuses({ devBuySol: -0.01 }, "dev_buy") && refuses({ devBuySol: "a lot" }, "dev_buy"));
  ok("auto mode: 1 or 2 a day, never 3; a minimum balance of at least 0.02 SOL; a schedule from the listed hours",
    refuses({ auto: { maxPerDay: 3 } }, "max_per_day") && refuses({ auto: { maxPerDay: 0 } }, "max_per_day") && refuses({ auto: { minBalanceSol: 0.01 } }, "min_balance") && refuses({ auto: { everyHours: 1 } }, "every_hours"));
  ok("a model is an id the key lists, or empty: no identifier is written into the code", refuses({ model: "<script>" }, "model") && normalizeCashcatSettings({ model: "test-model-b" }, structuredClone(d)).model === "test-model-b");
  const armed = { ...structuredClone(d), auto: { ...d.auto, on: true, armed: { sentence: "x", at: 1, wallet: "w" }, nextAt: 5 } };
  ok("changing a cap the arm sentence names disarms auto mode; changing the dev buy does not touch it (auto never buys)",
    normalizeCashcatSettings({ auto: { everyHours: 24 } }, armed).auto.on === false && normalizeCashcatSettings({ devBuySol: 0.01 }, armed).auto.on === true);
}

section("2. DRAFTS REFUSED BY THE CONTENT RULES, EACH BY NAME");
{
  const w = await world({ apiKey: false });
  const judge = async (idea) => (await w.tab.draftTyped(idea));
  const good = await judge(GOOD);
  ok("a cat coin of your own passes the rules (no key saved: the rules alone judge it)", good.ok === true && good.refusals.length === 0 && good.reviewedBy === "the rules", good.refusals.join("; "));
  const cases = [
    ["a real person's name", { ...GOOD, name: "Elon Cat" }, /real_person/],
    ["a brand", { ...GOOD, name: "Nike Cat" }, /brand/],
    ["a topic that is a tragedy", { ...GOOD, topic: "earthquake relief" }, /topic, tragedy/],
    ["a topic that is a person on the long given-name list only (checkTrend)", { ...GOOD, topic: "kirk herbstreit" }, /topic, real_person: "kirk herbstreit"/],
    ["a financial promise", { ...GOOD, tagline: "A cat that brings guaranteed profit to every holder." }, /financial_promise/],
    ["a verified token's ticker (Jupiter's list)", { ...GOOD, symbol: "JUP" }, /is the ticker of the verified token/],
    ["an established cat coin's name", { ...GOOD, name: "Shark Cat", symbol: "SHARKY" }, /established cat coin Shark Cat/],
    ["a web address in the name", { ...GOOD, name: "Cat at catcoin.xyz" }, /link/],
    ["letters of another alphabet in the name", { ...GOOD, name: "Кот Cat" }, /name_format/],
    ["a name with no cat in it", { ...GOOD, name: "Rainy Day Dog" }, /not_cat/],
    ["a ticker that is not 2 to 10 of A–Z and 0–9", { ...GOOD, symbol: "rain$" }, /ticker_format/],
    ["no topic (it is written into the disclosure)", { ...GOOD, topic: "" }, /topic: name the topic/],
    ["something about minors", { ...GOOD, tagline: "A cat for the kids at school to share." }, /minors/],
  ];
  for (const [what, idea, re] of cases) {
    const r = await judge(idea);
    ok(`refused: ${what}`, r.ok === false && r.refusals.some((x) => re.test(x)), r.refusals.join(" | ").slice(0, 160));
  }
  const typed = typedDraft({ name: "  Rainy   Day Cat ", symbol: "$raincat", tagline: GOOD.tagline, topic: GOOD.topic });
  ok("a typed draft is cleaned: spaces collapsed, the ticker upper-cased without its $, a kitten and background picked from the ticker", typed.name === "Rainy Day Cat" && typed.symbol === "RAINCAT" && KITTENS.includes(typed.kitten) && Object.hasOwn(BACKGROUNDS, typed.background));

  const refusing = await world({ net: network({ review: { verdict: "refuse", rules: ["brand_or_trademark"], reason: "It reads as a brand." } }) });
  const r = await refusing.tab.draftTyped(GOOD);
  ok("with a key saved, the model reviews every draft too, and its refusal is named", r.ok === false && r.refusals.some((x) => /^model review: It reads as a brand\. \(brand_or_trademark\)/.test(x)), r.refusals.join(" | "));
  const approving = await world({});
  const a = await approving.tab.draftTyped(GOOD);
  ok("…and its approval is recorded: judged by the rules and the model", a.ok === true && a.reviewedBy === "the rules and the model" && approving.net.asked.length === 1 && approving.net.asked[0].tool === "review_coin");
  ok("…with the user's persona: it is their coin, not the agency's", approving.net.asked[0].system.startsWith(USER_PERSONA.review) && !/Cat Intelligence Agency/.test(approving.net.asked[0].system));
  const sneaky = await world({ net: network({ review: { verdict: "approve", rules: ["other"], reason: "fine, mostly" } }) });
  ok("an \"approve\" that names a rule is not an approval", (await sneaky.tab.draftTyped(GOOD)).ok === false);
}

section("3. DRAFTING FROM A TREND: THE MODEL PICKED AT RUN TIME");
{
  const probe = network();
  const trends = await readTrends({ http: probe.http });
  const usable = trends.usable[0];
  const proposal = { skip: false, trend: usable.title, name: "Trendy Cat", symbol: "TRNDCAT", tagline: "A cat's calm take on what everyone is searching for today.", kitten: "calico", background: "violet" };
  const w = await world({ net: network({ proposal }) });
  const r = await w.tab.draftFromTrend();
  ok("a trend draft: the trends read and filtered by checkTrend, a proposal and a separate review, both through the key", r.ok === true && r.draft.topic === usable.title && r.draft.source === usable.source && w.net.asked.map((x) => x.tool).join() === "propose_coin,review_coin", JSON.stringify(r.refusals));
  ok("the model is the first GET /v1/models lists (no identifier in the code)", w.net.asked.every((x) => x.model === MODELS[0]) && w.net.calls.some((c) => c.url === "https://api.anthropic.com/v1/models?limit=100"));
  ok("…and the key travels in one header to the Anthropic API only", w.net.asked.every((x) => x.headers["x-api-key"] === "sk-ant-test-cashcat-0000") && w.net.calls.filter((c) => JSON.stringify(c.init?.headers ?? {}).includes("sk-ant-test")).every((c) => c.url.startsWith("https://api.anthropic.com/")));
  ok("the proposal was asked with the user's persona", w.net.asked[0].system.startsWith(USER_PERSONA.propose));
  await w.tab.saveSettings({ model: "test-model-b" });
  await w.tab.draftFromTrend();
  ok("a model the owner chose is used when the key lists it", w.net.asked.slice(-2).every((x) => x.model === "test-model-b"));
  await w.tab.saveSettings({ model: "test-model-z" });
  const gone = await w.tab.draftFromTrend();
  ok("a chosen model the key does not list is no draft, never a silent substitute", !gone.draft && gone.ok === false);
  const noKey = await world({ apiKey: false, net: network({ proposal }) });
  ok("without a key there is no trend draft", (await throwsClause(() => noKey.tab.draftFromTrend(), "no_api_key")) !== null && !(await throwsClause(() => noKey.tab.draftFromTrend(), "no_api_key"))?.wrong);
  const bad = await world({ net: network({ proposal: { ...proposal, name: "Elon Cat" } }) });
  const b = await bad.tab.draftFromTrend();
  ok("a proposal the rules refuse is not drafted, and the refusal is named", !b.draft && b.ok === false && /refused/.test(b.refusals.join(" ")));
}

section("4. THE LOGO: THE LAYOUT, AND THE BOT'S PICTURE DRAWN BY THE EXTENSION");
{
  const signs = JSON.parse(fs.readFileSync(path.join(ROOT, "bots", "cashcat", "art", "signs.json"), "utf8"));
  let inside = true, grid = true;
  for (const k of KITTENS) for (let n = 2; n <= 10; n++) {
    const text = `$${"W".repeat(n)}`;
    const p = placeText({ text, sign: signs[k], measure: (px) => text.length * px });
    inside &&= p.x >= signs[k].x && p.x + p.width <= signs[k].x + signs[k].w && p.y >= signs[k].y && p.y + p.fontPx <= signs[k].y + signs[k].h;
    grid &&= p.fontPx % 8 === 0 && p.fontPx >= 16;
  }
  ok("every ticker from 2 to 10 characters fits inside every kitten's sign (Press Start 2P is 8·s pixels a character)", inside);
  ok("…at a whole multiple of the font's 8-pixel grid", grid);
  ok("the build copies the eight kittens, their signs and the font byte for byte from bots/cashcat/art", KITTENS.every((k) => builtFrom.get(`art/${k}.png`) === `bots/cashcat/art/${k}.png`)
    && builtFrom.get("art/signs.json") === "bots/cashcat/art/signs.json" && builtFrom.get("art/font/PressStart2P-Regular.ttf") === "bots/cashcat/art/font/PressStart2P-Regular.ttf" && builtFrom.get("art/font/OFL.txt") === "bots/cashcat/art/font/OFL.txt");
  if (!napi) {
    console.log("  (the canvas renderer is not installed: `npm ci --prefix bots` to draw the logo here; CI does)");
    ok("the renderer is installed where CI runs the suite", !process.env.CI);
  } else {
    const { renderLogo } = await import("./bots/cashcat/logo.mjs");
    const ext = nodeRenderer();
    for (const [ticker, kitten, background] of [["RAINCAT", "ginger", "sky"], ["MEOW", "tuxedo", "violet"], ["ABCDEFGHIJ", "sphynx", "gold"]]) {
      const mine = await ext.render({ ticker, kitten, background });
      const theirs = await renderLogo({ ticker, kitten, background });
      const [a, b] = await Promise.all([napi.loadImage(Buffer.from(mine.png)), napi.loadImage(theirs)]);
      const px = (img) => { const c = napi.createCanvas(LOGO_SIZE, LOGO_SIZE); const g = c.getContext("2d"); g.drawImage(img, 0, 0); return Buffer.from(g.getImageData(0, 0, LOGO_SIZE, LOGO_SIZE).data); };
      ok(`$${ticker} on the ${kitten} kitten: the extension's logo is the bot's, pixel for pixel, 1024 × 1024`, a.width === LOGO_SIZE && a.height === LOGO_SIZE && px(a).equals(px(b)));
      ok(`…its sign measured from the pixels exactly as recorded in signs.json`, JSON.stringify(mine.sign) === JSON.stringify(signs[kitten]));
    }
    const lying = nodeRenderer({ signsOverride: { ...signs, ginger: { ...signs.ginger, x: signs.ginger.x + 3 } } });
    ok("art whose sign does not measure as recorded is refused, never drawn over", (await throwsClause(() => lying.render({ ticker: "RAINCAT", kitten: "ginger", background: "sky" }), "sign_mismatch"))?.clause === "sign_mismatch");
    ok("an unknown kitten or a ticker outside the format is refused before anything is drawn",
      (await throwsClause(() => ext.render({ ticker: "RAINCAT", kitten: "lion", background: "sky" }), "spec"))?.clause === "spec" && (await throwsClause(() => ext.render({ ticker: "rain", kitten: "ginger", background: "sky" }), "spec"))?.clause === "spec");
    ok("the font drawn is the bundled Press Start 2P, registered under its own family", napi.GlobalFonts.has(FONT_FAMILY));
  }
}

section("5. THE LAUNCH: CHECKED, SIMULATED, PINNED, SIGNED BY THE MINT AND THE AUTOPILOT WALLET, SENT ONCE");
let launched = null;
{
  const w = await world({});
  await w.tab.draftTyped(GOOD);
  const plan = await w.tab.prepare();
  ok("\"Check the launch\" runs every check and the recorded simulation, and pins, signs and sends nothing",
    plan.ok === true && plan.simulatedSpendSol === Number(CREATE_SPEND) / 1e9 && plan.budgetSol === LAUNCH_BUDGET_LAMPORTS / 1e9 && w.chain.st.sent.length === 0 && w.net.uploads.length === 0 && w.mintKeys.count() === 0, JSON.stringify({ spend: plan.simulatedSpendSol }));
  ok("…and shows no dev buy by default, and the disclosure the coin will carry", plan.devBuySol === 0 && plan.disclosure === "Not financial advice. Not affiliated with rainy weather.");
  ok("the tab says where its coins go, and where the stock cats are", CASHCAT_VENUE_NOTE === "SOL-quoted pump.fun coins here. Stock cats, one per xStock on StonkFun, are in CoinMarketCat's tab. pump.fun coins quoted in a stock stay the agency's CashCat's."
    && (await w.tab.status()).notes.venue === CASHCAT_VENUE_NOTE);
  ok("a launch without the ticker typed to confirm it is refused", (await throwsClause(() => w.tab.launch({}), "confirm"))?.clause === "confirm" && (await throwsClause(() => w.tab.launch({ confirmTicker: "RAIN" }), "confirm"))?.clause === "confirm");
  const out = await w.tab.launch({ confirmTicker: "$raincat" });
  launched = { w, out };
  const sent = w.chain.st.sent;
  const tx = sent[0]?.tx;
  const signers = tx ? tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).map((k) => k.toBase58()) : [];
  ok("one transaction was sent, and no dev buy (0 by default)", sent.length === 1 && sent[0].kind === "create" && out.ok === true);
  ok("it is a v0 transaction with no lookup table, signed by exactly the autopilot wallet and the new mint, both signatures verified by the chain",
    tx?.version === 0 && tx.message.addressTableLookups.length === 0 && signers.length === 2 && signers[0] === w.WALLET && signers[1] === out.mint);
  ok("Phantom was never asked", w.phantomAsked.length === 0);
  const pinned = w.net.uploads.find((u) => u.type === "application/json");
  const doc = pinned ? JSON.parse(pinned.bytes.toString("utf8")) : null;
  const uri = `https://ipfs.io/ipfs/${pinned?.cid}`;
  let checked = false;
  try { checked = checkLaunchMessage(tx.message, { wallet: w.WALLET, mint: out.mint, venue: "pumpfun", coin: { name: GOOD.name, symbol: GOOD.symbol, uri } }); } catch (e) { checked = e.message; }
  ok("the bytes sent pass the bot's own pre-sign check: the planned signers, programs, accounts and create_v2 arguments, the pinned URI", checked === true, String(checked));
  const create = decodeCreateV2(readMessage(tx.message).instructions.find((ix) => ix.programId === PUMPFUN_PROGRAM).data);
  ok("…create_v2 names this coin, the autopilot wallet as creator, and no mayhem, cashback, holder reward or creator fee",
    create.name === GOOD.name && create.symbol === GOOD.symbol && create.uri === uri && create.creator === w.WALLET && !create.isMayhemMode && !create.isCashbackEnabled && !create.isHolderReward && create.creatorFeeBps === 0n);
  ok("the logo and the document were pinned through Pinata with the key, the document read back before its URI was used",
    w.net.uploads.length === 2 && w.net.uploads.every((u) => u.auth === "Bearer eyJ.test-pinata.jwt") && w.net.calls.some((c) => c.url === `https://gateway.pinata.cloud/ipfs/${pinned.cid}`) && w.net.uploads[0].type === "image/png");
  ok("the description ends \"Not financial advice. Not affiliated with [topic].\" and never claims the agency", doc?.description === `${GOOD.tagline} — Not financial advice. Not affiliated with rainy weather.`
    && !/Cat Intelligence Agency|catintelligenceagency/i.test(JSON.stringify(doc)) && !("website" in doc) && !("twitter" in doc) && !/Made with CashCat/.test(doc.description), doc?.description);
  const j = await w.storage.get(CASHCAT_TAB_KEYS.journal);
  ok("the journal records the launch: its mint, signature, topic and what it cost, read back from the chain",
    j[0]?.kind === "launched" && j[0].mint === out.mint && j[0].signature === out.signature && j[0].topic === GOOD.topic && j[0].costSol === Number(CREATE_SPEND) / 1e9 && j[0].creator === w.WALLET && j[0].mintClean === true);
  ok("the only links it gives are the coin on pump.fun and the launch on Solscan", out.links.map((l) => l.href).join() === `https://pump.fun/coin/${out.mint},https://solscan.io/tx/${out.signature}`);
  ok("the journal names the venue, pump.fun, and carries no stock cat's fields (pair, pool)", j[0].venue === "pumpfun" && out.venue === "pumpfun" && !("pair" in j[0]) && !("pool" in j[0]));
  ok("…the document says it was created on pump.fun, as before", doc?.createdOn === "https://pump.fun");
  const unresolved = await world({});
  await unresolved.tab.draftTyped(GOOD);
  await unresolved.storage.set(CASHCAT_TAB_KEYS.journal, [{ at: unresolved.T.now, kind: "sending", mode: "manual", mint: out.mint, creator: unresolved.WALLET, symbol: "RAINCAT" }]);
  ok("a launch whose outcome is not known blocks the next one until the user checks it", (await throwsClause(() => unresolved.tab.prepare(), "unresolved"))?.clause === "unresolved");
  await unresolved.tab.markChecked({ mint: out.mint, landed: true });
  ok("…and is released once the user marks it checked", (await unresolved.tab.prepare()).ok === true);

  const made = await world({});
  await made.tab.saveSettings({ madeWithCashCat: true });
  await made.tab.draftTyped(GOOD);
  await made.tab.launch({ confirmTicker: "RAINCAT" });
  const madeDoc = JSON.parse(made.net.uploads.find((u) => u.type === "application/json").bytes.toString("utf8"));
  ok("\"Made with CashCat.\" is added only when the user ticks it", madeDoc.description.endsWith("Not affiliated with rainy weather. Made with CashCat."));
}
{
  const refusedBefore = async (setup, clause, what) => {
    const w = await world(setup.world ?? {});
    await w.tab.draftTyped(GOOD);
    if (setup.mode) Object.assign(w.chain.st.mode, setup.mode);
    const e = await throwsClause(() => w.tab.launch({ confirmTicker: "RAINCAT" }), clause);
    ok(`refused before any signature: ${what} (${clause})`, e?.clause === clause && w.chain.st.sent.length === 0 && w.mintKeys.count() === 0 && (setup.pinned ?? 0) === w.net.uploads.length, JSON.stringify(e?.wrong ?? ""));
  };
  await refusedBefore({ mode: { simErr: true } }, "simulation_refused", "the simulation fails — and nothing is pinned for it");
  await refusedBefore({ mode: { extraSpend: 20_000_000 } }, "simulation_refused", "the simulation spends more than the 0.015 SOL launch budget");
  await refusedBefore({ mode: { noBlockhash: true } }, "rpc", "the RPC gives no blockhash");
  await refusedBefore({ world: { locked: true } }, "autopilot_locked", "the autopilot wallet is locked");
  await refusedBefore({ world: { jwt: false } }, "no_pinata", "no Pinata key is saved");
  await refusedBefore({ world: { rpcUp: false } }, "no_rpc", "no RPC is set");
  await refusedBefore({ world: { lamports: 10_000_000n } }, "balance", "the wallet holds less than the launch budget and the rent floor");
  const w = await world({});
  await w.tab.draftTyped({ ...GOOD, name: "Elon Cat" });
  ok("refused before any signature: a draft the rules refuse, however it reached the launch button", (await throwsClause(() => w.tab.launch({ confirmTicker: "RAINCAT" }), "draft_refused"))?.clause === "draft_refused" && w.chain.st.sent.length === 0);
  const f = await world({});
  await f.tab.draftTyped(GOOD);
  f.chain.st.mode.failOnChain = true;
  let e = null; try { await f.tab.launch({ confirmTicker: "RAINCAT" }); } catch (x) { e = x; }
  const fj = await f.storage.get(CASHCAT_TAB_KEYS.journal);
  ok("a launch that failed on chain is journaled as failed, with its signature, and does not count against the day", e?.clause === "failed_on_chain" && fj.find((x) => x.mint)?.kind === "failed" && fj.find((x) => x.mint)?.signature && f.mintKeys.count() === 0);
}
{
  /* A hostile edit of the create, read back by the same check the tab runs: refused before a signature. */
  const w = launched.w;
  const mint = Keypair.generate().publicKey.toBase58();
  const build = (ixs, lookups = []) => new TransactionMessage({ payerKey: new PublicKey(w.WALLET), recentBlockhash: bs58.encode(Buffer.alloc(32, 7)), instructions: ixs }).compileToV0Message(lookups);
  const coin = { name: GOOD.name, symbol: GOOD.symbol, uri: "https://ipfs.io/ipfs/bafkreixxxx" };
  const ix = createV2Ix({ mint, user: w.WALLET, ...coin });
  const refused = (msg, clause) => { try { checkLaunchMessage(msg, { wallet: w.WALLET, mint, venue: "pumpfun", coin }); return false; } catch (e) { return e.clause === clause; } };
  ok("the check reads a v0 message: the plain create passes", (() => { try { return checkLaunchMessage(build([ix]), { wallet: w.WALLET, mint, venue: "pumpfun", coin }); } catch { return false; } })());
  const table = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: [new PublicKey("11111111111111111111111111111111")] } });
  ok("a v0 message that loads an account from a lookup table is refused (lookup_tables)", refused(build([ix], [table]), "lookup_tables"));
  ok("another coin's name is refused (coin)", refused(build([createV2Ix({ mint, user: w.WALLET, ...coin, name: "Other Cat" })]), "coin"));
  const extra = createV2Ix({ mint, user: w.WALLET, ...coin });
  ok("a second instruction is refused (instructions)", refused(build([ix, extra]), "instructions"));
}

section("6. THE MINT'S KEY: MADE, USED ONCE AND DROPPED IN session-wallet.mjs; NOTHING LEFT IN STORAGE");
{
  const { w, out } = launched;
  ok("after the launch no mint key is held", w.mintKeys.count() === 0 && !w.mintKeys.holds(out.mint));
  const stored = JSON.stringify([...w.storage.m.entries()]);
  const b58 = [...stored.matchAll(/[1-9A-HJ-NP-Za-km-z]{80,90}/g)].map((m) => m[0]).filter((s) => { try { return bs58.decode(s).length === 64; } catch { return false; } });
  ok("nothing in the tab's storage is key-shaped: no 64-number array, and every 64-byte base58 string is a transaction signature",
    !/\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/.test(stored) && b58.every((s) => w.chain.st.sent.some((x) => x.signature === s)), `${b58.length} signature(s)`);
  const keys = createMintKeys({ clock: () => w.T.now });
  const m = keys.newMint();
  ok("newMint gives out an address, and only the address: its JSON is a count", typeof m === "string" && new PublicKey(m).toBase58() === m && JSON.stringify(keys) === '{"held":1}');
  const msg = new TransactionMessage({ payerKey: new PublicKey(w.WALLET), recentBlockhash: bs58.encode(Buffer.alloc(32, 7)), instructions: [createV2Ix({ mint: m, user: w.WALLET, name: GOOD.name, symbol: GOOD.symbol, uri: "https://ipfs.io/ipfs/x" })] }).compileToV0Message();
  const b64 = Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
  const signed = VersionedTransaction.deserialize(Buffer.from(keys.signAsMint({ txBase64: b64, mint: m, payer: w.WALLET }).signedBase64, "base64"));
  ok("signAsMint adds the mint's signature in its own slot and leaves the payer's empty", ed25519.verify(signed.signatures[1], signed.message.serialize(), new PublicKey(m).toBytes()) && signed.signatures[0].every((x) => x === 0));
  ok("…once: the key is dropped, and a second use is refused (no_mint)", keys.count() === 0 && (await throwsClause(() => keys.signAsMint({ txBase64: b64, mint: m, payer: w.WALLET }), "no_mint"))?.clause === "no_mint");
  const m2 = keys.newMint();
  const other = Keypair.generate().publicKey;
  const three = new TransactionMessage({ payerKey: new PublicKey(w.WALLET), recentBlockhash: bs58.encode(Buffer.alloc(32, 7)), instructions: [createV2Ix({ mint: m2, user: other.toBase58(), name: "A Cat", symbol: "ACAT", uri: "u" })] }).compileToV0Message();
  ok("it signs only a transaction whose signers are exactly the payer and this mint (bad_signers), and drops the key anyway",
    (await throwsClause(() => keys.signAsMint({ txBase64: Buffer.from(new VersionedTransaction(three).serialize()).toString("base64"), mint: m2, payer: w.WALLET }), "bad_signers"))?.clause === "bad_signers" && keys.count() === 0);
  const T2 = { now: 0 };
  const aging = createMintKeys({ clock: () => T2.now });
  const m3 = aging.newMint();
  T2.now += MINT_KEY_TTL_MS + 1;
  ok("a key older than ten minutes is dropped unused", aging.count() === 0 && !aging.holds(m3));
  const capped = createMintKeys();
  for (let i = 0; i < 4; i++) capped.newMint();
  ok("at most four launches' keys are held at once", (await throwsClause(() => capped.newMint(), "too_many_mints"))?.clause === "too_many_mints");
  const src = fs.readFileSync(path.join(ROOT, "src", "lib", "cashcat-tab.mjs"), "utf8");
  ok("the tab never constructs a key: it asks the worker's mintKeys for an address and a signature", !/\bKeypair\b|secretKey|fromSecretKey|\.sign\(/.test(src) && /mintKeys\.newMint\(\)/.test(src) && /mintKeys\.signAsMint\(/.test(src));
}

section("7. THE DEV BUY: NONE BY DEFAULT, AT MOST 0.05 SOL, CHECKED, MANUAL ONLY");
{
  const w = await world({});
  await w.tab.saveSettings({ devBuySol: 0.01 });
  await w.tab.draftTyped(GOOD);
  const out = await w.tab.launch({ confirmTicker: "RAINCAT" });
  const [create, buy] = w.chain.st.sent;
  let checked = false;
  try { checked = checkDevBuyMessage(buy.tx.message, { wallet: w.WALLET, mint: out.mint, maxSpendLamports: 10_000_000n }); } catch (e) { checked = e.message; }
  ok("with a dev buy set, it is a second transaction after the launch landed", create?.kind === "create" && buy?.kind === "buy" && w.chain.st.sent.length === 2);
  ok("…that passes the bot's dev-buy check: the wallet's own account for this mint, one buy_v2 spending at most the dev buy", checked === true, String(checked));
  ok("…signed by the autopilot wallet alone", buy.tx.message.header.numRequiredSignatures === 1 && buy.payer === w.WALLET);
  const j = await w.storage.get(CASHCAT_TAB_KEYS.journal);
  ok("…and shown in the journal beside the launch", j[0].devBuy?.sol === 0.01 && j[0].devBuy.signature === buy.signature);
}

section("8. AUTO MODE: ARMED BY A SENTENCE, CAPPED, NO DEV BUY, NEVER A BUY OR A SELL");
{
  const probe = network();
  const usable = (await readTrends({ http: probe.http })).usable;
  let n = 0;
  const proposal = () => { n++; return { skip: false, trend: usable[n % usable.length].title, name: `Auto Cat ${"ABCDEFGH"[n % 8]}`, symbol: `AUTO${"ABCDEFGH"[n % 8]}CAT`, tagline: "A cat's calm look at what everyone is searching for.", kitten: "black", background: "mint" }; };
  const w = await world({ net: network({ proposal }) });
  await w.tab.saveSettings({ devBuySol: 0.02 });
  const st0 = await w.tab.status();
  const expected = autoArmSentence({ wallet: w.WALLET, settings: { auto: { maxPerDay: 2, everyHours: 12, minBalanceSol: 0.05 } } });
  ok("the sentence names the wallet and every cap, in words, and says nothing will ask", st0.auto.expected === expected && expected.includes(w.WALLET) && /at most 2 launches a day/.test(expected) && /never below 0\.05 SOL/.test(expected) && /no dev buy and never buying or selling its coins/.test(expected) && /signed without asking me/.test(expected));
  ok("a sentence that is not byte for byte the one printed does not arm it", (await throwsClause(() => w.tab.armAuto({ sentence: expected.replace("2 launches", "3 launches") }), "sentence"))?.clause === "sentence");
  const noKey = await world({ apiKey: false });
  ok("with the checklist not green (no API key for the trend drafts) it does not arm", (await throwsClause(() => noKey.tab.armAuto({ sentence: autoArmSentence({ wallet: noKey.WALLET, settings: CASHCAT_TAB_DEFAULTS }) }), "checklist"))?.clause === "checklist");
  const armed = await w.tab.armAuto({ sentence: expected });
  ok("the exact sentence with every item green arms it; the first run is ten minutes later", armed.ok === true && armed.nextAt === w.T.now + FIRST_AUTO_DELAY_MS);
  ok("before it is due, a tick does nothing", (await w.tab.autoTick()).why === "not due" && w.chain.st.sent.length === 0);
  w.T.now += FIRST_AUTO_DELAY_MS;
  const r1 = await w.tab.autoTick();
  ok("when due, it drafts from a trend, the model reviews it, and it launches one coin from the autopilot wallet", r1.ran === true && r1.ok === true && w.chain.st.sent.length === 1 && w.chain.st.sent[0].kind === "create");
  ok("…with no dev buy, whatever the manual setting says", w.chain.st.sent.every((s) => s.kind === "create"));
  let j = await w.storage.get(CASHCAT_TAB_KEYS.journal);
  ok("…journaled with its mint, signature and trend", j.find((x) => x.kind === "launched")?.mode === "auto" && j.find((x) => x.kind === "launched").signature === r1.signature && usable.some((u) => u.title === j.find((x) => x.kind === "launched").topic));
  ok("the next tick before its hours are up does nothing", (await w.tab.autoTick()).why === "not due");
  w.T.now += 12 * HOUR;                                        // 21:10 UTC: the same UTC day as the first, at 09:10
  const second = await w.tab.autoTick();
  ok("twelve hours on, a second launch", second.ok === true && w.chain.st.sent.length === 2);
  await w.storage.set(CASHCAT_TAB_KEYS.settings, { ...(await w.storage.get(CASHCAT_TAB_KEYS.settings)), auto: { ...(await w.storage.get(CASHCAT_TAB_KEYS.settings)).auto, nextAt: w.T.now } });
  const third = await w.tab.autoTick();
  ok("a third the same UTC day is refused at the day's cap, journaled, and nothing is sent", third.ok === false && third.clause === "day_cap" && w.chain.st.sent.length === 2);
  j = await w.storage.get(CASHCAT_TAB_KEYS.journal);
  ok("…and the refusal stays in the journal", j[0].kind === "refused" && j[0].clause === "day_cap");
  ok("every transaction auto mode sent is a create: it never bought or sold a coin it launched", w.chain.st.sent.every((s) => s.kind === "create" && s.m.instructions.every((ix) => ix.programId !== PUMPFUN_PROGRAM || ix.data.subarray(0, 8).toString("hex") === IX.pumpCreateV2)));
  w.T.now += 13 * HOUR;
  w.chain.st.lamports.set(w.WALLET, 60_000_000n);           // 0.06 SOL: under 0.05 + the 0.015 budget + the rent floor
  const poor = await w.tab.autoTick();
  ok("the next day, under the minimum balance plus one launch's budget, it is refused (balance) and nothing is sent", poor.ok === false && poor.clause === "balance" && w.chain.st.sent.length === 2);
  await w.tab.saveSettings({ auto: { everyHours: 24 } });
  const s = await w.tab.status();
  ok("changing a cap disarms it", s.settings.auto.on === false && (await w.tab.autoTick()).why === "off");
  const x = await world({ net: network({ proposal }) });
  await x.tab.armAuto({ sentence: autoArmSentence({ wallet: x.WALLET, settings: CASHCAT_TAB_DEFAULTS }) });
  await x.keystore.lock(); await x.signer.refresh();
  x.T.now += FIRST_AUTO_DELAY_MS;
  const locked = await x.tab.autoTick();
  ok("a locked autopilot wallet is refused at the tick (autopilot_locked), and nothing is sent", locked.ok === false && locked.clause === "autopilot_locked" && x.chain.st.sent.length === 0);
  const y = await world({ net: network({ proposal, review: { verdict: "refuse", rules: ["real_person"], reason: "No." } }) });
  await y.tab.armAuto({ sentence: autoArmSentence({ wallet: y.WALLET, settings: CASHCAT_TAB_DEFAULTS }) });
  y.T.now += FIRST_AUTO_DELAY_MS;
  const none = await y.tab.autoTick();
  ok("a draft the model refuses is no coin that run (no_coin), and nothing is sent", none.ok === false && none.clause === "no_coin" && y.chain.st.sent.length === 0);
  const z = await world({ net: network({ proposal }) });
  await z.tab.armAuto({ sentence: autoArmSentence({ wallet: z.WALLET, settings: CASHCAT_TAB_DEFAULTS }) });
  await z.storage.set(CASHCAT_TAB_KEYS.settings, { ...(await z.storage.get(CASHCAT_TAB_KEYS.settings)), auto: { ...(await z.storage.get(CASHCAT_TAB_KEYS.settings)).auto, armed: { sentence: autoArmSentence({ wallet: Keypair.generate().publicKey.toBase58(), settings: CASHCAT_TAB_DEFAULTS }), at: 1, wallet: "x" } } });
  ok("a sentence armed for another wallet disarms at the next tick", (await z.tab.autoTick()).why === "disarmed" && (await z.tab.status()).settings.auto.on === false);
}

section("9. A DISARM WINS: NO TICK OVERWRITES IT, AND A RUN IN FLIGHT SIGNS NOTHING AFTER IT");
{
  const probe = network();
  const usable = (await readTrends({ http: probe.http })).usable;
  let hook = null;
  const proposal = () => { hook?.(); return { skip: false, trend: usable[0].title, name: "Race Cat", symbol: "RACECAT", tagline: "A cat's calm look at what everyone is searching for.", kitten: "black", background: "mint" }; };
  const armedWorld = async () => {
    const w = await world({ net: network({ proposal }) });
    await w.tab.armAuto({ sentence: autoArmSentence({ wallet: w.WALLET, settings: CASHCAT_TAB_DEFAULTS }) });
    w.T.now += FIRST_AUTO_DELAY_MS;
    return w;
  };
  const a = await armedWorld();
  /* The owner presses Disarm at the moment the alarm's tick reads the settings. */
  const [, tick] = await Promise.all([a.tab.disarmAuto(), a.tab.autoTick()]);
  ok("a disarm and a due tick at the same moment: the disarm stands, and nothing is launched",
    (await a.tab.status()).settings.auto.on === false && a.chain.st.sent.length === 0 && a.net.uploads.length === 0, JSON.stringify({ tick: tick?.why ?? tick?.clause, sent: a.chain.st.sent.length }));
  const c = await armedWorld();
  const [, capTick] = await Promise.all([c.tab.saveSettings({ auto: { everyHours: 24 } }), c.tab.autoTick()]);
  const cs = (await c.tab.status()).settings.auto;
  ok("a cap changed at the moment of a due tick: the new cap is kept, auto mode is off, and nothing is launched",
    cs.everyHours === 24 && cs.on === false && c.chain.st.sent.length === 0, JSON.stringify({ tick: capTick?.why ?? capTick?.clause, every: cs.everyHours, on: cs.on }));
  const b = await armedWorld();
  hook = () => { hook = null; b.tab.disarmAuto(); };          // disarmed while the model drafts the coin
  const midway = await b.tab.autoTick();
  ok("disarmed while a run is drafting: the run stops before anything is pinned or signed (disarmed), and it stays off",
    b.chain.st.sent.length === 0 && b.net.uploads.length === 0 && midway.ok === false && midway.clause === "disarmed" && (await b.tab.status()).settings.auto.on === false, JSON.stringify({ clause: midway.clause, sent: b.chain.st.sent.length }));
}

section("10. THE JOURNAL NEVER FORGETS A LAUNCH THAT STILL BLOCKS OR COUNTS");
{
  const w = await world({});
  await w.tab.draftTyped(GOOD);
  const openMint = Keypair.generate().publicKey.toBase58(), landedMint = Keypair.generate().publicKey.toBase58();
  await w.storage.set(CASHCAT_TAB_KEYS.journal, [
    { at: w.T.now, kind: "sending", mode: "manual", mint: openMint, creator: w.WALLET, symbol: "OPENCAT" },
    { at: w.T.now - 60_000, kind: "launched", mode: "manual", mint: landedMint, creator: w.WALLET, symbol: "LANDCAT" },
  ]);
  /* Two hundred launches refused because that one is unresolved, each refusal journaled. */
  for (let i = 0; i < 200; i++) await throwsClause(() => w.tab.launch({ confirmTicker: "RAINCAT" }), "unresolved");
  const j = await w.storage.get(CASHCAT_TAB_KEYS.journal);
  ok("after two hundred refusals the launch with no known outcome is still in the journal, and still blocks the next (unresolved)",
    j.some((e) => e.mint === openMint && e.kind === "sending") && (await throwsClause(() => w.tab.prepare(), "unresolved"))?.clause === "unresolved", `${j.length} entries`);
  ok("…and today's launches still count against the day's cap", (await w.tab.status()).launchesToday === 2 && j.some((e) => e.mint === landedMint));
  ok("…while the refusals themselves are trimmed to the journal's size", j.filter((e) => e.kind === "refused").length <= 200 && j.length <= 202);
}

section("11. SNIPURR NEVER TRADES A COIN YOUR OWN WALLET CREATED");
{
  const { w, out } = launched;
  await w.engine.setConfig({ lane: "observe", requireSocials: false });
  const notice = (creator) => ({ mint: out.mint, creator, slot: w.chain.st.slot, noticeAt: w.T.now, source: "logsSubscribe", raw: { name: GOOD.name, symbol: GOOD.symbol } });
  const r = await w.engine.handleNotice(notice(w.WALLET));
  ok("a new pump.fun coin whose creator is the autopilot wallet (a CashCat launch) is refused at its own gate (own_coin), and no position is opened for it",
    r?.entered === false && r?.refusedAt === "own_coin" && !w.engine.state.snipes?.[out.mint] && w.engine.state.attempts?.[out.mint]?.detail === "own_coin", JSON.stringify({ entered: r?.entered, refusedAt: r?.refusedAt ?? r?.verdict?.gate }));
  const w2 = await world({});
  await w2.tab.draftTyped(GOOD);
  const out2 = await w2.tab.launch({ confirmTicker: "RAINCAT" });
  await w2.engine.setConfig({ lane: "observe", requireSocials: false });
  const r2 = await w2.engine.handleNotice({ mint: out2.mint, creator: null, slot: w2.chain.st.slot, noticeAt: w2.T.now, source: "logsSubscribe", raw: {} });
  ok("…and so is one whose notice names no creator, when its bonding curve records the autopilot wallet as the creator",
    r2?.entered === false && r2?.refusedAt === "own_coin" && !w2.engine.state.snipes?.[out2.mint], JSON.stringify({ entered: r2?.entered, refusedAt: r2?.refusedAt ?? r2?.verdict?.gate }));
}

done();
