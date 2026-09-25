/**
 * CASHCAT END TO END, WITH NO NETWORK: A DRY RUN NEVER SENDS, LIVE REFUSES WITHOUT EVERY GUARD,
 * AND A GREEN LIVE RUN SIGNS EXACTLY THE CHECKED TRANSACTION.
 *
 * The world is scripted: the trend sources and Jupiter answer with their recorded live answers
 * (fixtures/bots/), the Anthropic API with invented model ids and tool calls, Pinata with an
 * invented CID, and the chain with a scripted RPC. The wallet is a keypair made in memory for
 * this test. What is proved:
 *   · the model is picked from GET /v1/models: the first listed, or the one the owner named;
 *     a named model that is not listed is an error; the key goes in one header to one host;
 *   · the caps and fences (config.mjs) and every live guard, each refusing by name;
 *   · a dry run renders, builds, checks and simulates — and uploads nothing, signs nothing,
 *     sends nothing and writes nothing;
 *   · a live run missing any one guard sends nothing;
 *   · a green live run pins and reads back the metadata, sends ONE transaction whose message
 *     passed the check and whose signatures (wallet and mint) verify, reads it back, and
 *     records a launch the site validates — with the disclosure in its metadata;
 *   · a coin whose record the site would refuse is refused before anything is uploaded or sent;
 *   · the creator-fee claim, which signs too, waits for the switch, the wallet, its address and
 *     the RPC, and never runs in a test environment;
 *   · the wallet's launches on chain are counted to the end of the window or not at all: an
 *     unrecorded launch behind dust sent to the wallet, or from yesterday's last run, stops the
 *     next launch, and a window it cannot read in full refuses;
 *   · no secret (API key, wallet secret, RPC URL key, Pinata token) reaches a log line;
 *   · the ticker check against Jupiter's verified list and the established cat coins;
 *   · the invention loop: a proposal held to its format, the rules and the review, and a review
 *     held to its own format (an approval naming any rule, or no list of rules, is no approval).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { harness, fixture, scriptedFetch, scriptedRpc, response, captureSink } from "./bots/test/doubles.mjs";
import { createHttp } from "./bots/lib/http.mjs";
import { createModel, ModelError } from "./bots/lib/model.mjs";
import { createLogger } from "./bots/lib/log.mjs";
import { HOSTS, URLS, IX, PUMPFUN_PROGRAM, SYSTEM_PROGRAM } from "./bots/lib/verified.mjs";
import { readConfig, liveRefusals, CASHCAT_DEFAULTS, ConfigError } from "./bots/cashcat/config.mjs";
import { runCashCat, pickVenue } from "./bots/cashcat/launch.mjs";
import { walletFromEnv } from "./bots/cashcat/wallet.mjs";
import { verifiedIndex, tickerFree } from "./bots/cashcat/tickers.mjs";
import { inventCoin, validateProposal, validateReview } from "./bots/cashcat/invent.mjs";
import { disclosure, buildDocument, pinMetadata, dryRunMetadata } from "./bots/cashcat/metadata.mjs";
import { parseGoogleTrends, parseCoingeckoTrending } from "./bots/cashcat/trends.mjs";
import { checkTrend } from "./bots/lib/content-rules.mjs";
import { checkLaunchMessage } from "./bots/lib/txcheck.mjs";
import { creatorVault } from "./bots/cashcat/pumpfun.mjs";
import { validateLaunches } from "./site/assets/launches.js";

const { ok, section, throwsClause, done } = harness("test-bots-cashcat");

/* ── the scripted world ──────────────────────────────────────────────────────────────── */
const MODELS = ["test-model-a", "test-model-b"]; // invented ids
const usableTrend = (() => {
  const all = [...parseGoogleTrends(fixture("trends/google-trends-us.xml")), ...parseCoingeckoTrending(fixture("trends/coingecko-trending.json").body)];
  return all.find((t) => checkTrend(t).ok).title;
})();
const PROPOSAL = { skip: false, trend: usableTrend, name: "Match Day Cat", symbol: "MDCAT", tagline: "A cat who watches every match from the top of the telly.", kitten: "tuxedo", background: "mint" };
const FAKE_CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
const snap = fixture("popcat/snapshots.json").snapshots[0];

function world({ env, launches = [], balance = 1_000_000_000, proposal = PROPOSAL, review = { verdict: "approve", rules: [], reason: "fine" }, onchainToday = [], onchainTxs = {}, vault = 0, models = MODELS } = {}) {
  const uploads = [];
  const docs = new Map();
  const { fetchImpl, calls } = scriptedFetch([
    [URLS.googleTrendsRss("US"), () => response(200, fixture("trends/google-trends-us.xml"))],
    [URLS.coingeckoTrending, () => fixture("trends/coingecko-trending.json").body],
    [URLS.jupiterVerified, () => fixture("jupiter/verified-sample.json").tokens],
    ["https://api.anthropic.com/v1/models", () => ({ data: models.map((id) => ({ id, type: "model" })) })],
    ["https://api.anthropic.com/v1/messages", (_u, init) => {
      const body = JSON.parse(init.body);
      const name = body.tools[0].name;
      return { id: "msg_test", model: body.model, stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", name, input: name === "propose_coin" ? proposal : review }] };
    }],
    [URLS.pinataUpload, async (_u, init) => {
      const file = init.body.get("file");
      const bytes = Buffer.from(await file.arrayBuffer());
      const cid = `${FAKE_CID.slice(0, -2)}${String(uploads.length).padStart(2, "a").replace(/\d/g, (d) => "abcdefghij"[d])}`;
      uploads.push({ auth: init.headers.authorization, network: init.body.get("network"), name: init.body.get("name"), bytes, cid });
      if (file.type === "application/json") docs.set(cid, JSON.parse(bytes.toString("utf8")));
      return { data: { id: "test", cid } };
    }],
    ["https://gateway.pinata.cloud/ipfs/", (u) => docs.get(u.split("/ipfs/")[1]) ?? response(404, "{}")],
  ]);
  const http = createHttp({ fetchImpl, allowedHosts: Object.values(HOSTS), sleep: async () => {} });
  const sent = [];
  const mintAccount = { owner: snap.mintAccount.owner, lamports: 1, data: [snap.mintAccount.dataBase64, "base64"] };
  const isClaim = (tx) => tx.instructions.some((ix) => ix.data.subarray(0, 8).toString("hex") === IX.pumpCollectCreatorFee);
  const rpc = scriptedRpc({
    /* Newest first, paged by `before` and `limit`, as the RPC pages them. */
    getSignaturesForAddress: ([, o = {}]) => { const i = o.before ? onchainToday.findIndex((s) => s.signature === o.before) + 1 : 0; return onchainToday.slice(i, i + (o.limit ?? 1000)); },
    getTransaction: ([sig]) => {
      if (Object.hasOwn(onchainTxs, sig)) return onchainTxs[sig];
      const s = sent.find((x) => x.signature === sig);
      if (!s) return null;
      return { slot: 1, meta: { err: null, fee: 15_000, preBalances: [balance], postBalances: [balance - 5_549_700], loadedAddresses: { writable: [], readonly: [] } }, transaction: { signatures: [sig], message: { accountKeys: s.tx.compileMessage().accountKeys.map((k) => k.toBase58()), instructions: [] } } };
    },
    getBalance: () => ({ value: balance }),
    getLatestBlockhash: () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 100 } }),
    /* A fee claim pays the vault's lamports above rent to the wallet; anything else is a launch. */
    simulateTransaction: ([b64]) => (isClaim(Transaction.from(Buffer.from(b64, "base64")))
      ? { value: { err: null, logs: [], unitsConsumed: 20_000, accounts: [{ lamports: balance + vault - 890_880 - 5_000 }] } }
      : { value: { err: null, logs: ["Program log: Instruction: CreateV2", "Program log: Instruction: InitializeWithToken2022"], unitsConsumed: 95_000, accounts: [{ lamports: balance - 5_549_700 }] } }),
    sendTransaction: ([b64]) => { const tx = Transaction.from(Buffer.from(b64, "base64")); const signature = bs58.encode(tx.signatures[0].signature); sent.push({ tx, signature, claim: isClaim(tx) }); return signature; },
    getSignatureStatuses: () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }),
    getAccountInfo: ([a]) => ({ value: vault && a === creatorVault(WALLET) ? { owner: PUMPFUN_PROGRAM, lamports: vault, data: ["", "base64"] }
      : sent.some((s) => s.tx.instructions.some((ix) => ix.keys[0]?.pubkey.toBase58() === a)) ? mintAccount : null }),
    getMultipleAccounts: ([list]) => ({ value: list.map(() => null) }),
    getSlot: () => 1,
    getMinimumBalanceForRentExemption: () => 890_880,
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cashcat-"));
  fs.writeFileSync(path.join(dir, "launches.json"), JSON.stringify({ launches }));
  const cap = captureSink();
  const secrets = ["ANTHROPIC_API_KEY", "CASHCAT_WALLET_SECRET", "SOLANA_RPC_URL", "PINATA_JWT"].map((k) => env[k]).filter(Boolean);
  const log = createLogger({ secrets, sink: cap.sink });
  const model = createModel({ http, apiKey: env.ANTHROPIC_API_KEY || "", preferred: env.CASHCAT_MODEL || "", log });
  const wallet = walletFromEnv(env);
  const render = async () => Buffer.from("89504e470d0a1a0a", "hex");
  const run = () => runCashCat({ env, http, rpc, model, wallet, dataDir: dir, log, render, now: () => Date.parse("2026-09-24T22:00:00Z"), sleep: async () => {} });
  return { run, calls, rpc, sent, uploads, dir, cap, http, model };
}

const keypair = Keypair.generate(); // in memory, for this test only
const SECRET = bs58.encode(keypair.secretKey);
const WALLET = keypair.publicKey.toBase58();
const LIVE_ENV = Object.freeze({
  CASHCAT_LIVE: "1", CASHCAT_WALLET_SECRET: SECRET, CASHCAT_WALLET_ADDRESS: WALLET, SOLANA_RPC_URL: "https://rpc.example.test/v1/k9Qz7pSecretRpcKey4411",
  ANTHROPIC_API_KEY: "sk-ant-test-0000-not-a-real-key-7f3a", PINATA_JWT: "eyJ.test-pinata-jwt.9x8y7z",
});
const secretsIn = (lines, env) => ["ANTHROPIC_API_KEY", "CASHCAT_WALLET_SECRET", "PINATA_JWT"].map((k) => env[k]).filter(Boolean).concat(env.SOLANA_RPC_URL ? ["k9Qz7pSecretRpcKey4411"] : [])
  .filter((s) => lines.some((l) => l.includes(s)));
const rpcCalls = (w, m) => w.rpc.calls.filter((c) => c.method === m).length;

section("THE MODEL IS CHOSEN AT RUN TIME");
{
  const mk = (preferred, key = "sk-ant-test-key") => {
    const { fetchImpl, calls } = scriptedFetch([["https://api.anthropic.com/v1/models", () => ({ data: MODELS.map((id) => ({ id })) })]]);
    return { m: createModel({ http: createHttp({ fetchImpl, allowedHosts: Object.values(HOSTS), sleep: async () => {} }), apiKey: key, preferred }), calls };
  };
  const a = mk("");
  ok("with none named: the first the API lists", (await a.m.pickModel()) === "test-model-a");
  ok("the key travels in x-api-key, to api.anthropic.com only, with the API version", a.calls.every((c) => new URL(c.url).host === "api.anthropic.com" && c.init.headers["x-api-key"] === "sk-ant-test-key" && c.init.headers["anthropic-version"] === "2023-06-01"));
  ok("the owner's named model when the key lists it", (await mk("test-model-b").m.pickModel()) === "test-model-b");
  ok("a named model the key does not list is an error, never a substitute", await throwsClause(() => mk("test-model-z").m.pickModel(), "model_unavailable"));
  ok("no key: no call at all", await throwsClause(() => mk("", "").m.pickModel(), "no_api_key") && mk("", "").calls.length === 0);
}

section("THE CAPS, THE FENCES AND THE LIVE GUARDS");
{
  const c = readConfig({});
  ok("defaults: dry, 2 launches a day, one a run, 0.05 SOL minimum, no dev buy, pump.fun and StonkFun, SPYx", !c.live && c.maxLaunchesPerDay === 2 && c.maxLaunchesPerRun === 1 && c.minBalanceSol === 0.05 && c.devBuySol === 0 && c.venues.join() === "pumpfun,stonkfun" && c.stonkfunQuote === "SPYx");
  const bad = (env) => { try { readConfig(env); return false; } catch (e) { return e instanceof ConfigError; } };
  ok("a dev buy over 0.05 SOL is refused", bad({ CASHCAT_DEV_BUY_SOL: "0.06" }) && !bad({ CASHCAT_DEV_BUY_SOL: "0.05" }));
  ok("more than 6 launches a day, or a fraction, is refused", bad({ CASHCAT_MAX_LAUNCHES_PER_DAY: "7" }) && bad({ CASHCAT_MAX_LAUNCHES_PER_DAY: "1.5" }));
  ok("a minimum balance under 0.02 SOL is refused", bad({ CASHCAT_MIN_BALANCE_SOL: "0.01" }));
  ok("anything but a plain number is refused", bad({ CASHCAT_MIN_BALANCE_SOL: "1e3" }) && bad({ CASHCAT_DEV_BUY_SOL: "-0.01" }) && bad({ CASHCAT_PRIORITY_MICROLAMPORTS: "0x10" }));
  ok("an unknown venue is refused", bad({ CASHCAT_VENUES: "pumpfun,raydium" }));
  ok("live only with CASHCAT_LIVE exactly 1", readConfig({ CASHCAT_LIVE: "1" }).live && !readConfig({ CASHCAT_LIVE: "true" }).live && !readConfig({ CASHCAT_LIVE: "yes" }).live);
  const env = { ...LIVE_ENV };
  const wallet = walletFromEnv(env);
  const green = { wallet, balanceLamports: 1_000_000_000, launchesToday: 0, venue: "pumpfun", simulated: true, reviewed: true };
  ok("every guard green: no refusal", liveRefusals(readConfig(env), green).length === 0);
  const named = (over, cfgEnv, re) => liveRefusals(readConfig({ ...env, ...cfgEnv }), { ...green, ...over }).some((r) => re.test(r));
  ok("each guard refuses by name", named({}, { CASHCAT_LIVE: "" }, /CASHCAT_LIVE/) && named({}, { NODE_ENV: "test" }, /test environment/) && named({ wallet: null }, { CASHCAT_WALLET_SECRET: "" }, /WALLET_SECRET/)
    && named({}, { CASHCAT_WALLET_ADDRESS: "" }, /WALLET_ADDRESS is not set/) && named({}, { CASHCAT_WALLET_ADDRESS: "FFWtrEQ4B4PKQoVuHYzZq8FabGkVatYzDpEVHsK5rrhF" }, /not the address/)
    && named({}, { SOLANA_RPC_URL: "" }, /SOLANA_RPC_URL/) && named({}, { ANTHROPIC_API_KEY: "" }, /ANTHROPIC_API_KEY/) && named({}, { PINATA_JWT: "" }, /PINATA_JWT/)
    && named({ launchesToday: 2 }, {}, /cap is reached/) && named({ unrecorded: 1 }, {}, /not in launches\.json/) && named({ balanceLamports: 60_000_000 }, {}, /under the minimum/)
    && named({ balanceLamports: null }, {}, /balance is unknown/) && named({ simulated: false }, {}, /simulated/) && named({ reviewed: false }, {}, /model review/));
  ok("venues take turns by the launches on file", pickVenue(["pumpfun", "stonkfun"], []) === "pumpfun" && pickVenue(["pumpfun", "stonkfun"], [{}]) === "stonkfun");
}

section("A DRY RUN NEVER SENDS");
{
  const env = { ...LIVE_ENV, CASHCAT_LIVE: "" };
  const w = world({ env });
  const r = await w.run();
  ok("the outcome is a dry run, with the coin the model proposed", r.mode === "dry" && r.outcome === "dry_run" && r.coin?.symbol === "MDCAT", JSON.stringify(r).slice(0, 200));
  ok("it checked and simulated the launch", r.simulated === true && rpcCalls(w, "simulateTransaction") === 1);
  ok("it sent nothing, uploaded nothing, wrote nothing", rpcCalls(w, "sendTransaction") === 0 && w.uploads.length === 0 && JSON.parse(fs.readFileSync(path.join(w.dir, "launches.json"))).launches.length === 0);
  ok("it says what a live launch would still need", w.cap.lines.some((l) => /dry run complete/.test(l)));
  ok("no secret reached the log", secretsIn(w.cap.lines, env).length === 0, secretsIn(w.cap.lines, env).join(", "));
  const noWallet = world({ env: {} });
  const r2 = await noWallet.run();
  ok("with nothing set at all it still runs safely, as a dry run on a template coin, and says why it did not simulate", r2.outcome === "dry_run" && rpcCalls(noWallet, "sendTransaction") === 0 && noWallet.cap.lines.some((l) => /template: no model/.test(l)));
}

section("LIVE REFUSES WITHOUT EVERY GUARD");
for (const [label, over, expect] of [
  ["no wallet secret", { CASHCAT_WALLET_SECRET: "" }, /WALLET_SECRET/],
  ["no wallet address", { CASHCAT_WALLET_ADDRESS: "" }, /WALLET_ADDRESS/],
  ["the address of another wallet", { CASHCAT_WALLET_ADDRESS: "FFWtrEQ4B4PKQoVuHYzZq8FabGkVatYzDpEVHsK5rrhF" }, /not the address/],
  ["no RPC of its own", { SOLANA_RPC_URL: "" }, /SOLANA_RPC_URL/],
  ["no Pinata token", { PINATA_JWT: "" }, /PINATA_JWT/],
  ["a test environment", { NODE_ENV: "test" }, /test environment/],
]) {
  const env = { ...LIVE_ENV, ...over };
  const w = world({ env });
  const r = await w.run();
  ok(`${label}: refused by name, nothing sent or uploaded`, r.outcome === "refused" && r.refusals.some((x) => expect.test(x)) && rpcCalls(w, "sendTransaction") === 0 && w.uploads.length === 0, r.refusals?.join("; "));
}
{
  const w = world({ env: { ...LIVE_ENV, ANTHROPIC_API_KEY: "" } });
  const r = await w.run();
  ok("no API key: no coin (a live launch needs the model's proposal and review), nothing sent", r.outcome === "no_coin" && /model/.test(r.why) && rpcCalls(w, "sendTransaction") === 0);
  const low = world({ env: LIVE_ENV, balance: 60_000_000 });
  const r2 = await low.run();
  ok("a wallet under the minimum plus the launch's budget: refused", r2.outcome === "refused" && r2.refusals.some((x) => /under the minimum/.test(x)) && rpcCalls(low, "sendTransaction") === 0);
  const today = [0, 1].map((i) => ({ time: "2026-09-24T0" + (i + 1) + ":00:00Z", venue: "pumpfun", name: "Old Cat", symbol: "OLD" + i, tagline: "An earlier launch for the day cap test.", trend: { title: "x", source: "google-trends" },
    mint: fixture("pumpfun/create-v2-samples.json").samples[i].accounts[0].pubkey, creator: WALLET, tx: fixture("pumpfun/create-v2-samples.json").samples[i].signature, quote: { symbol: "SOL", mint: "So11111111111111111111111111111111111111112" }, devBuy: { sol: 0 }, costSol: 0.005, kitten: "black" }));
  const capped = world({ env: LIVE_ENV, launches: today });
  const r3 = await capped.run();
  ok("two launches already today: the cap stops the run before a coin is invented", r3.outcome === "cap_reached" && rpcCalls(capped, "sendTransaction") === 0 && !capped.calls.some((c) => c.url.includes("/v1/messages")));
  const refused = world({ env: LIVE_ENV, review: { verdict: "refuse", rules: ["brand_or_trademark"], reason: "it names a brand" } });
  const r4 = await refused.run();
  ok("the model review refuses both proposals: no coin, nothing sent", r4.outcome === "no_coin" && rpcCalls(refused, "sendTransaction") === 0);
}

section("A GREEN LIVE RUN");
{
  const w = world({ env: LIVE_ENV });
  const r = await w.run();
  ok("it launched", r.outcome === "launched", JSON.stringify(r).slice(0, 300));
  ok("exactly one transaction was sent", w.sent.length === 1);
  const tx = w.sent[0]?.tx;
  const mint = tx?.instructions[2]?.keys[0]?.pubkey.toBase58();
  ok("its signatures verify, and they are the wallet's and the new mint's", tx?.verifySignatures() === true && tx.signatures.map((s) => s.publicKey.toBase58()).sort().join() === [WALLET, mint].sort().join());
  let checked = false;
  try { checked = checkLaunchMessage(tx.compileMessage(), { wallet: WALLET, mint, venue: "pumpfun", coin: { name: "Match Day Cat", symbol: "MDCAT", uri: `https://ipfs.io/ipfs/${w.uploads[1]?.cid}` } }); } catch (e) { checked = e.message; }
  ok("the message that was sent passes the pre-sign check, with the pinned metadata URI", checked === true, String(checked));
  ok("Pinata got two public uploads (logo, then document) with the bearer token", w.uploads.length === 2 && w.uploads.every((u) => u.network === "public" && u.auth === `Bearer ${LIVE_ENV.PINATA_JWT}`) && w.calls.some((c) => c.url === URLS.pinataGateway(w.uploads[1].cid)));
  const doc = JSON.parse(w.uploads[1].bytes.toString("utf8"));
  ok("the metadata carries the disclosure: CashCat, the agency, not affiliated, not financial advice",
    /Launched automatically by CashCat, a bot of the Cat Intelligence Agency/.test(doc.description) && /not affiliated with/.test(doc.description) && /Not financial advice/.test(doc.description) && doc.website === "https://catintelligenceagency.com/floor/");
  const file = JSON.parse(fs.readFileSync(path.join(w.dir, "launches.json"), "utf8"));
  const v = validateLaunches(file);
  ok("the launch is recorded, and the site validates it", v.launches.length === 1 && v.problems.length === 0 && v.launches[0].mint === mint && v.launches[0].creator === WALLET && v.launches[0].tx === w.sent[0].signature, v.problems.join(" | "));
  ok("its cost is the wallet's balance change read back from the chain", v.launches[0]?.costSol === 0.0055497 && v.launches[0].devBuy.sol === 0);
  const msgs = w.calls.filter((c) => c.url.includes("/v1/messages")).map((c) => JSON.parse(c.init.body));
  ok("two model calls (propose, review), both on the first model listed, both forced through their tool", msgs.length === 2 && msgs.every((m) => m.model === "test-model-a" && m.tool_choice.type === "tool") && msgs[0].tools[0].name === "propose_coin" && msgs[1].tools[0].name === "review_coin");
  ok("no secret reached the log, the RPC URL's key included", secretsIn(w.cap.lines, LIVE_ENV).length === 0, secretsIn(w.cap.lines, LIVE_ENV).join(", "));
  ok("no request went anywhere but the allowed hosts", w.calls.every((c) => Object.values(HOSTS).includes(new URL(c.url).host)));
  const again = await w.run();
  ok("the next run the same day takes the other venue (StonkFun, unscripted here, so its plan is refused and nothing is sent)", again.venue === "stonkfun" && again.outcome === "venue_refused" && w.sent.length === 1);
}

section("A LAUNCH THE SITE COULD NOT SHOW IS NEVER SENT");
{
  /* "Case file:" reads as a link scheme to the site's validator, which would refuse the record
     of a launch already on chain. The coin must be refused before anything is uploaded or signed. */
  const w = world({ env: LIVE_ENV, proposal: { ...PROPOSAL, tagline: "Case file: a cat who watches every match from the top of the telly." } });
  let r;
  try { r = await w.run(); } catch (e) { r = { threw: e.message }; }
  ok("a line the site would refuse: no coin, nothing uploaded, nothing signed or sent, and the run ends cleanly", !r.threw && r.outcome === "no_coin" && w.sent.length === 0 && w.uploads.length === 0, JSON.stringify(r).slice(0, 240));
  ok("the refusal names the site's rule, so the model is told why", r.attempts?.[0]?.refusals?.some((x) => /the site would refuse it/.test(x) && /link scheme/.test(x)), JSON.stringify(r.attempts?.[0]));
}

section("THE FEE CLAIM WAITS FOR EVERY GUARD");
{
  const VAULT = 50_000_000; // 0.05 SOL in the creator vault, built for the test
  const other = world({ env: { ...LIVE_ENV, CASHCAT_WALLET_ADDRESS: "FFWtrEQ4B4PKQoVuHYzZq8FabGkVatYzDpEVHsK5rrhF" }, vault: VAULT });
  await other.run();
  ok("CASHCAT_WALLET_ADDRESS naming another wallet: nothing is signed or sent, not even a fee claim", other.sent.length === 0, `${other.sent.length} sent`);
  const test = world({ env: { ...LIVE_ENV, NODE_ENV: "test" }, vault: VAULT });
  await test.run();
  ok("a test environment: no fee claim either", test.sent.length === 0, `${test.sent.length} sent`);
  const green = world({ env: LIVE_ENV, vault: VAULT });
  const r = await green.run();
  ok("every guard green: the claim goes first, checked and simulated, then the launch", r.outcome === "launched" && green.sent.length === 2 && green.sent[0].claim && !green.sent[1].claim);
}

section("THE WALLET'S LAUNCHES ON CHAIN: COUNTED TO THE END, OR NO LAUNCH");
{
  const t0 = Date.parse("2026-09-24T21:00:00Z") / 1000;
  const OTHER = "FFWtrEQ4B4PKQoVuHYzZq8FabGkVatYzDpEVHsK5rrhF";
  const launchTx = (blockTime) => ({ slot: 5, blockTime, meta: { err: null, loadedAddresses: { writable: [], readonly: [] } },
    transaction: { message: { accountKeys: [WALLET, PUMPFUN_PROGRAM], instructions: [{ programIdIndex: 1, accounts: [], data: bs58.encode(Buffer.from(IX.pumpCreateV2 + "00".repeat(8), "hex")) }] } } });
  const spamTx = (blockTime) => ({ slot: 4, blockTime, meta: { err: null, loadedAddresses: { writable: [], readonly: [] } },
    transaction: { message: { accountKeys: [OTHER, WALLET, SYSTEM_PROGRAM], instructions: [{ programIdIndex: 2, accounts: [0, 1], data: bs58.encode(Buffer.from("0200000001000000", "hex")) }] } } });
  const spam = (n, from) => Array.from({ length: n }, (_, i) => ({ signature: `spam${from + i}`, blockTime: t0 - i, err: null }));
  const txsFor = (sigs, extra = {}) => ({ ...Object.fromEntries(sigs.filter((s) => s.signature.startsWith("spam")).map((s) => [s.signature, spamTx(s.blockTime)])), ...extra });

  const buried = [...spam(40, 0), { signature: "unrecorded1", blockTime: t0 - 100, err: null }];
  const w1 = world({ env: LIVE_ENV, onchainToday: buried, onchainTxs: txsFor(buried, { unrecorded1: launchTx(t0 - 100) }) });
  const r1 = await w1.run();
  ok("an unrecorded launch behind forty dust transfers to the wallet is still found: refused, nothing sent", r1.outcome === "refused" && r1.refusals.some((x) => /not in launches\.json/.test(x)) && w1.sent.length === 0, JSON.stringify(r1).slice(0, 200));

  const yesterday = Date.parse("2026-09-23T18:25:00Z") / 1000;
  const late = [{ signature: "lastnight", blockTime: yesterday, err: null }];
  const w2 = world({ env: LIVE_ENV, onchainToday: late, onchainTxs: { lastnight: launchTx(yesterday) } });
  const r2 = await w2.run();
  ok("a launch from yesterday's last run that never reached launches.json still stops the next day's first run", r2.outcome === "refused" && r2.refusals.some((x) => /not in launches\.json/.test(x)) && w2.sent.length === 0, JSON.stringify(r2).slice(0, 200));

  const unreadable = [{ signature: "gone", blockTime: t0, err: null }];
  const w3 = world({ env: LIVE_ENV, onchainToday: unreadable, onchainTxs: { gone: null } });
  const r3 = await w3.run();
  ok("a transaction of the day the RPC cannot return: live refuses rather than guess", r3.outcome === "refused" && w3.sent.length === 0, JSON.stringify(r3).slice(0, 200));

  const flood = spam(400, 0);
  const w4 = world({ env: LIVE_ENV, onchainToday: flood, onchainTxs: txsFor(flood) });
  const r4 = await w4.run();
  ok("more of the day's transactions than it will read: live refuses (spam can stop CashCat, never make it launch twice)", r4.outcome === "refused" && w4.sent.length === 0, JSON.stringify(r4).slice(0, 200));

  const recorded = [{ signature: fixture("pumpfun/create-v2-samples.json").samples[0].signature, blockTime: t0, err: null }, { signature: "failed", blockTime: t0, err: { InstructionError: [0, "Custom"] } }];
  const w5 = world({ env: { ...LIVE_ENV, CASHCAT_VENUES: "pumpfun" }, launches: [{ time: "2026-09-24T21:00:00Z", venue: "stonkfun", name: "Old Cat", symbol: "OLDC", tagline: "An earlier launch, already on file.", trend: { title: "x", source: "google-trends" },
    mint: fixture("pumpfun/create-v2-samples.json").samples[0].accounts[0].pubkey, creator: WALLET, tx: recorded[0].signature, quote: { symbol: "SPYx", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W" }, devBuy: { sol: 0 }, costSol: 0.005, kitten: "black" }],
    onchainToday: recorded, onchainTxs: {} });
  const r5 = await w5.run();
  ok("a launch already on file and a failed transaction are not read at all, and the run goes on", r5.outcome === "launched" && !w5.rpc.calls.some((c) => c.method === "getTransaction" && ["failed", recorded[0].signature].includes(c.params[0])), JSON.stringify(r5).slice(0, 200));
}

section("TICKERS: NEVER A VERIFIED TOKEN'S, NEVER AN ESTABLISHED CAT COIN'S");
{
  const idx = verifiedIndex(fixture("jupiter/verified-sample.json").tokens);
  ok("BONK, POPCAT, JUP are taken", ["BONK", "POPCAT", "JUP"].every((s) => !tickerFree(idx, { name: "Fresh Cat", symbol: s }).ok));
  ok("a verified token's name is taken too (\"Popcat\")", !tickerFree(idx, { name: "Popcat", symbol: "ZZCAT" }).ok);
  ok("an established cat coin's alias is taken (\"Shark Cat\" / SC)", !tickerFree(idx, { name: "Shark Cat", symbol: "SHRK" }).ok);
  ok("a fresh ticker and name are free", tickerFree(idx, { name: "Match Day Cat", symbol: "MDCAT" }).ok);
  ok("no list, no launch: an unreadable list refuses", !tickerFree(null, { name: "Match Day Cat", symbol: "MDCAT" }).ok);
  let short = false;
  try { verifiedIndex([{ symbol: "A", id: "x" }]); } catch { short = true; }
  ok("an implausibly short list is refused", short);
}

section("THE INVENTION LOOP");
{
  const trends = [{ title: usableTrend, source: "google-trends", traffic: "1000+", news: [] }];
  ok("a proposal with a field the format lacks is refused", !validateProposal({ ...PROPOSAL, price: 1 }, trends).ok);
  ok("a trend that was not listed is refused", !validateProposal({ ...PROPOSAL, trend: "something else" }, trends).ok);
  ok("an unknown kitten is refused", !validateProposal({ ...PROPOSAL, kitten: "lion" }, trends).ok);
  ok("an approval that names a broken rule is not an approval", !validateReview({ verdict: "approve", rules: ["brand_or_trademark"], reason: "" }).approve && validateReview({ verdict: "approve", rules: [], reason: "ok" }).approve);
  ok("nor one that names a rule the format does not have, or whose rules are not a list", !validateReview({ verdict: "approve", rules: ["looks_fine_to_me"], reason: "ok" }).approve
    && !validateReview({ verdict: "approve", rules: "none", reason: "ok" }).approve && !validateReview({ verdict: "approve", reason: "ok" }).approve && !validateReview({ verdict: "approve", rules: [], reason: 7 }).approve);
  const idx = verifiedIndex(fixture("jupiter/verified-sample.json").tokens);
  let n = 0;
  const model = { hasKey: true, callTool: async ({ tool, user }) => { n++; if (tool.name === "review_coin") return { verdict: "approve", rules: [], reason: "ok" }; return n === 1 ? { ...PROPOSAL, name: "Trump Cat" } : { ...PROPOSAL, trend: "autumn leaves" }; } };
  const two = [...trends, { title: "autumn leaves", source: "google-trends", traffic: null, news: [] }];
  const out = await inventCoin({ model, trends: two, verifiedIndex: idx, requireModel: true });
  ok("a proposal the rules refuse is asked for again, with that trend struck off, and the second one stands", out.coin?.trend.title === "autumn leaves" && out.attempts[0].refusals.some((x) => /real_person/.test(x)), JSON.stringify(out.attempts));
  const skip = await inventCoin({ model: { hasKey: true, callTool: async () => ({ skip: true, trend: "", name: "", symbol: "", tagline: "", kitten: "black", background: "mint" }) }, trends, verifiedIndex: idx, requireModel: true });
  ok("the model may decline: no coin", skip.coin === null && /no trend/.test(skip.why));
  const fail = await inventCoin({ model: { hasKey: true, callTool: async () => { throw new ModelError("rate_limited", "429"); } }, trends, verifiedIndex: idx, requireModel: true });
  ok("a model failure is no coin, never a template", fail.coin === null && /model failed/.test(fail.why));
  const tpl = await inventCoin({ model: { hasKey: false }, trends, verifiedIndex: idx, requireModel: false });
  ok("without a key a dry run makes a template coin, and live refuses to", tpl.coin?.template === true && (await inventCoin({ model: { hasKey: false }, trends, verifiedIndex: idx, requireModel: true })).coin === null);
}

section("METADATA");
{
  const d = disclosure({ trendTitle: "autumn leaves" });
  ok("the disclosure: launched automatically by CashCat, a bot of the Cat Intelligence Agency; not affiliated; not financial advice", /Launched automatically by CashCat, a bot of the Cat Intelligence Agency/.test(d) && /not affiliated with, endorsed by or connected to/.test(d) && /Not financial advice/.test(d) && d.includes('"autumn leaves"'));
  const doc = buildDocument({ name: "A Cat", symbol: "ACAT", tagline: "t", trendTitle: "x", imageUri: "https://ipfs.io/ipfs/x", venue: "pumpfun" });
  ok("the document has pump.fun's fields and no twitter or telegram", JSON.stringify(Object.keys(doc)) === '["name","symbol","description","image","showName","createdOn","website"]');
  const dry = dryRunMetadata({ coin: { name: "A Cat", symbol: "ACAT", tagline: "t", trendTitle: "x" }, venue: "stonkfun" });
  ok("a dry run's URI is a placeholder of a real one's length, on StonkFun's gateway form", dry.placeholder && dry.uri.startsWith("https://gateway.pinata.cloud/ipfs/bafkrei") && dry.imageCid === null);
  const { fetchImpl } = scriptedFetch([[URLS.pinataUpload, () => ({ data: { cid: FAKE_CID } })], ["https://gateway.pinata.cloud/ipfs/", () => ({ name: "Someone Else" })]]);
  const http = createHttp({ fetchImpl, allowedHosts: Object.values(HOSTS), sleep: async () => {} });
  ok("a pinned document that does not read back as sent is refused", await throwsClause(() => pinMetadata({ http, jwt: "t", logoPng: Buffer.from("x"), coin: { name: "A Cat", symbol: "ACAT", tagline: "t", trendTitle: "x" }, venue: "pumpfun" }), "read_back"));
  ok("no Pinata token: refused before any upload", await throwsClause(() => pinMetadata({ http, jwt: "", logoPng: Buffer.from("x"), coin: { name: "A Cat", symbol: "ACAT", tagline: "t", trendTitle: "x" }, venue: "pumpfun" }), "no_pinata"));
}

done();
