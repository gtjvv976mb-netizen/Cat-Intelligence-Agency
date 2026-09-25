/**
 * STOCK CATS: ONE CAT COIN OF YOUR OWN PER xSTOCK, LAUNCHED ON STONKFUN FROM COINMARKETCAT'S TAB.
 *
 * Offline, against what was read live on 2026-09-25 (fixtures/bots/stonkfun/2026-09-25/): StonkFun's
 * stats, its launchable pairs, the LaunchLab pricing of each of the 24 xStocks, the official product
 * list's rows for them, one base64 read of StonkFun's platform and every pair's config, curve rule
 * and mint, the six sampled launched mints, a recorded adopted launch and a "not found", and the
 * extension's own v0 initialize for SPYx simulated on mainnet. Jupiter's verified list and the
 * trends are the bots' recorded answers; the Anthropic API is scripted with invented model ids;
 * Pinata is scripted; the chain is a double that verifies every ed25519 signature it is sent and
 * answers a LaunchLab launch with the recorded v0 simulation. The signer is the real autopilot
 * wallet (a keystore over Maps) through the real engine's fences, and the new mint's key is the
 * real one from session-wallet.mjs.
 *
 *   1. the 24 pairs, matched by mint against the recordings; the fifteen built-ins untouched;
 *   2. the research gate: shipped empty, every pair refused at pair_terms_missing; a row's shape;
 *   3. the rules, clause by clause, the brand fix included; each pair's terms, suggestions and
 *      exact disclosure;
 *   4. the stock's own mint: every quote check produced;
 *   5. the launch in a LaunchLab chain double: a v0 message signed by exactly the payer and the
 *      new mint, the bot's pre-sign check with venue "stonkfun", the recorded simulation's log and
 *      spend, the journal's fields and links, one signature request and no dev buy though
 *      CashCat's is set; no research text in the coin;
 *   6. arming by the check: every clause the launch refuses, and the record used once;
 *   7. the caps: one cat per stock, the day's cap, a mint that read back unclean;
 *   8. the plan again at the launch, the planner's refusals, the owner's RPC, and hostile v0 edits
 *      refused before the mint's key signs;
 *   9. adoption, read when the owner asks, against the recorded answers;
 *  10. never in auto mode, and never a dev buy on StonkFun; the journal keeps every stock cat.
 */
import { VersionedTransaction, PublicKey, Keypair, TransactionMessage, AddressLookupTableAccount, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import { harness, fixture, scriptedFetch, scriptedRpc, response } from "./bots/test/doubles.mjs";
import { createHttp } from "./bots/lib/http.mjs";
import { URLS, HOSTS, PUMPFUN_PROGRAM, PUMPFUN_GLOBAL, LAUNCHLAB_PROGRAM, STONKFUN_PLATFORM_STANDARD, STONKFUN_PLATFORM_REWARD, IX, stonkfunMetadataUri } from "./bots/lib/verified.mjs";
import { readMessage, pda, instruction } from "./bots/lib/solana.mjs";
import { checkLaunchMessage } from "./bots/lib/txcheck.mjs";
import { planStonkfunLaunch, initializeIx, initializeAccounts, encodeInitialize, poolState } from "./bots/cashcat/stonkfun.mjs";
import { pinMetadata } from "./bots/cashcat/metadata.mjs";
import { readTrends } from "./bots/cashcat/trends.mjs";
import { checkFields } from "./bots/lib/content-rules.mjs";
import { verifiedIndex } from "./bots/cashcat/tickers.mjs";
import { KITTENS, BACKGROUNDS } from "./bots/cashcat/logo-layout.mjs";
import { BONDING_CURVE_LAYOUT } from "./vendor/executor/snipe-venue-pumpfun.mjs";
import { describeMint } from "./vendor/executor/token2022.mjs";
import { XSTOCK_BUILTIN, STONKFUN_XSTOCKS, XSTOCK_AUTHORITIES } from "./src/lib/config.mjs";
import {
  STOCK_PAIRS, STOCKCAT_HOSTS, STOCKCAT_LIMITS, STOCKCAT_TEXT, LAUNCH_CLAIMS, noteRow, pairTerms, stockCatRefusals, suggestNames, suggestionFor, pairDisclosure, quoteRefusals, otherQuotes, stockDraftKey, stockDraft,
} from "./src/lib/stockcats.mjs";
import { STOCK_CAT_NOTES } from "./src/lib/stock-cat-notes.mjs";
import { createBrain } from "./src/lib/agent-brain.mjs";
import { createDraftDesk, STOCK_CAT_RULES_TEXT } from "./src/lib/cashcat-draft.mjs";
import { createCashcatTab, CASHCAT_TAB_KEYS, VENUE_RUN, venueRun, assertDevBuyVenue, trimJournal, autoArmSentence, CASHCAT_TAB_DEFAULTS, FIRST_AUTO_DELAY_MS, PRIORITY_FEE_LAMPORTS } from "./src/lib/cashcat-tab.mjs";
import { buildUnsignedTransaction } from "./src/lib/tx.mjs";
import { createKeystore, createSessionSigner, createMintKeys } from "./src/lib/session-wallet.mjs";
import { createHawkEngine, memoryStore } from "./src/lib/engine.mjs";
import { MAX_LAUNCH_SPEND_LAMPORTS, COMPUTE_LIMITS, FENCES } from "./bots/cashcat/config.mjs";

const { ok, section, done } = harness("test-cats-stockcats");
const HOUR = 3_600_000;
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const day = (rel) => fixture(`stonkfun/2026-09-25/${rel}`);
const PAIRS_ANSWER = day("api-pairs-ready.json");
const OFFICIAL = day("xstocks-official-24.json");
const ACC = Object.fromEntries(day("accounts-xstocks.json").accounts.map((a) => [a.address, a]));
const SIM = day("simulate-initialize-v0-SPYx.json");
const SIM_SPEND = SIM.result.payerBefore - SIM.result.payerAfter;                  // 8,673,900 lamports, recorded on mainnet
const LAUNCHED = day("launched-mints.json").accounts;
const ADOPTED = day("api-token-adopted.json");
const NOT_FOUND = day("api-token-not-found.json");
const PUMP_SIM = fixture("pumpfun/simulate-create-v2.json").result;
const pair = (symbol) => STOCK_PAIRS.find((p) => p.symbol === symbol);
const SPY = pair("SPYx"), PLTR = pair("PLTRx"), GLD = pair("GLDx");
const accOf = (address) => { const a = ACC[address]; return a ? { owner: a.owner, lamports: a.lamports, data: [a.dataBase64, "base64"] } : null; };
const mapStore = () => { const m = new Map(); return { m, async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; }, async set(k, v) { m.set(k, structuredClone(v)); }, async remove(k) { m.delete(k); } }; };
const throwsClause = async (fn, clause) => { try { await fn(); return null; } catch (e) { const c = e?.clause ?? e?.code; return c === clause ? Object.assign(e, { clause: c }) : { wrong: c ?? e?.message }; } };
const syncClause = (fn) => { try { fn(); return "passed"; } catch (e) { return e?.clause ?? e?.message; } };
const JUP = verifiedIndex(fixture("jupiter/verified-sample.json").tokens);
/* Research rows made up for these tests only: no fact here is about any company. The facts'
   words are chosen so a leak into a coin or the model's prompt is found by a plain search. */
const TEST_ROW = (p, over = {}) => ({ mint: p.mint, people: [], mascots: [], brands: [], catFacts: [{ text: `TESTFACT-${p.symbol} a sentence no coin may carry`, source: "a test, not a source", readAt: "2026-09-25" }],
  searchedAt: "2026-09-25", method: "made up for test-cats-stockcats.mjs; not research", ...over });
const TEST_NOTES = [TEST_ROW(SPY), TEST_ROW(PLTR), TEST_ROW(GLD)];

section("1. THE 24 PAIRS, AGAINST WHAT WAS READ ON 2026-09-25");
{
  ok("24 pairs: the fifteen built-in xStocks and nine more; XSTOCK_BUILTIN is still fifteen", STOCK_PAIRS.length === 24 && XSTOCK_BUILTIN.length === 15 && STONKFUN_XSTOCKS.length === 24
    && XSTOCK_BUILTIN.every((b, i) => STOCK_PAIRS[i].mint === b.mint && STOCK_PAIRS[i].symbol === b.symbol && STOCK_PAIRS[i].name === b.name));
  const byMint = new Map(OFFICIAL.products.map((p) => [p.addresses.solana, p]));
  ok("every pair's symbol and name are the official product list's for its mint (xstocks.com, read 2026-09-25)", OFFICIAL.products.length === 24 && STOCK_PAIRS.every((p) => byMint.get(p.mint)?.symbol === p.symbol && byMint.get(p.mint)?.name === p.name),
    STOCK_PAIRS.filter((p) => byMint.get(p.mint)?.symbol !== p.symbol || byMint.get(p.mint)?.name !== p.name).map((p) => p.symbol).join(", ") || "24 of 24");
  const sf = new Map(PAIRS_ANSWER.body.data.pairs.map((p) => [p.mint, p]));
  ok("…and StonkFun's /pairs lists each by that mint as an xStock, launchable and LaunchLab-ready, under the symbol and name the config records", STOCK_PAIRS.every((p) => { const r = sf.get(p.mint); return r && r.category === "xstock" && r.launchable === true && r.launchLabReady === true && r.symbol === p.stonkfun && r.name === p.stonkfunName; }));
  ok("…and every xStock StonkFun listed as ready is one of the 24", PAIRS_ANSWER.body.data.pairs.filter((p) => p.category === "xstock").every((p) => STOCK_PAIRS.some((x) => x.mint === p.mint)));
  let clean = 0;
  for (const p of STOCK_PAIRS) {
    const d = describeMint(accOf(p.mint), p.mint);
    if (d.program === TOKEN_2022 && d.decimals === 8 && quoteRefusals(d, p).length === 0) clean++;
  }
  ok("every pair's mint, read in base64 that day, is Token-2022 at 8 decimals and passes every quote check (the issuer's keys in every seat)", clean === 24, `${clean} of 24`);
  ok("the issuer's keys the checks hold them to", XSTOCK_AUTHORITIES.mint === "7pt9tkctJPK7PPNQJ77GKg8ZffSF6QxoMiCFYHxrtaCj" && XSTOCK_AUTHORITIES.freeze === "JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs" && XSTOCK_AUTHORITIES.permanentDelegate === "5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq");
  ok("stock cats call one host of their own: StonkFun's", JSON.stringify(STOCKCAT_HOSTS) === JSON.stringify([HOSTS.stonkfun]));
  const others = otherQuotes(PAIRS_ANSWER.body);
  const expected = PAIRS_ANSWER.body.data.pairs.length - 24;
  ok("every other quote StonkFun listed is a count with its reason, never a pair", others.reduce((n, o) => n + o.count, 0) === expected && others.every((o) => typeof o.reason === "string" && o.reason.length > 10)
    && /transfer fee/.test(others.find((o) => o.category === "prestock")?.reason ?? "") && /no official issuer list/.test(others.find((o) => o.category === "backpack")?.reason ?? ""), others.map((o) => `${o.count} ${o.category}`).join(", "));
}

section("2. THE RESEARCH GATE");
{
  ok("the notes ship empty", Array.isArray(STOCK_CAT_NOTES) && STOCK_CAT_NOTES.length === 0 && Object.isFrozen(STOCK_CAT_NOTES));
  const g = { name: "Violet Ginger Cat", symbol: "VIOLGIN", tagline: "A ginger cat on a violet sign.", kitten: "ginger", background: "violet" };
  ok("so every one of the 24 pairs is refused at pair_terms_missing, and none gets a suggestion", STOCK_PAIRS.every((p) => stockCatRefusals({ ...g, pairMint: p.mint }, p, { verifiedIndex: JUP }).some((r) => r.clause === "pair_terms_missing"))
    && STOCK_PAIRS.every((p) => suggestNames(p, { verifiedIndex: JUP }).length === 0));
  ok("a row with every list, a real date and its method counts; an empty list is a dated \"none found\"", noteRow(SPY.mint, [TEST_ROW(SPY)]) !== null);
  ok("…a row with no date, a date that is no day, or no method does not", noteRow(SPY.mint, [TEST_ROW(SPY, { searchedAt: undefined })]) === null && noteRow(SPY.mint, [TEST_ROW(SPY, { searchedAt: "2026-02-31x" })]) === null && noteRow(SPY.mint, [TEST_ROW(SPY, { method: "" })]) === null);
  ok("…nor one missing a list, with an empty name, or a fact without its source or date", noteRow(SPY.mint, [TEST_ROW(SPY, { mascots: undefined })]) === null && noteRow(SPY.mint, [TEST_ROW(SPY, { people: [""] })]) === null
    && noteRow(SPY.mint, [TEST_ROW(SPY, { catFacts: [{ text: "x", source: "", readAt: "2026-09-25" }] })]) === null && noteRow(SPY.mint, [TEST_ROW(SPY, { catFacts: [{ text: "x", source: "y" }] })]) === null);
  ok("…nor two rows for one mint", noteRow(SPY.mint, [TEST_ROW(SPY), TEST_ROW(SPY)]) === null);
  ok("a name may carry its source: { name, source }", noteRow(SPY.mint, [TEST_ROW(SPY, { people: [{ name: "Probe Person", source: "test" }] })]) !== null && pairTerms(SPY, [TEST_ROW(SPY, { people: [{ name: "Probe Person", source: "test" }] })]).includes("Probe Person"));
}

section("3. THE RULES, CLAUSE BY CLAUSE");
{
  const base = { name: "Violet Ginger Cat", symbol: "VIOLGIN", tagline: "A ginger cat on a violet sign.", kitten: "ginger", background: "violet", pairMint: SPY.mint };
  const clauses = (d, p = SPY, o = {}) => stockCatRefusals({ ...base, ...d }, p, { notes: TEST_NOTES, verifiedIndex: JUP, ...o }).map((r) => r.clause);
  ok("a clean stock cat passes every rule", clauses({}).length === 0, JSON.stringify(stockCatRefusals(base, SPY, { notes: TEST_NOTES, verifiedIndex: JUP })));
  ok("pair_unknown: a pair that is not one of the 24", stockCatRefusals(base, { ...SPY, mint: Keypair.generate().publicKey.toBase58() }, { notes: TEST_NOTES })[0]?.clause === "pair_unknown" && stockCatRefusals(base, null)[0]?.clause === "pair_unknown");
  ok("pair_term: this pair's symbol, root, StonkFun's spelling, a word of its name", clauses({ name: "SPYx Cat" }).includes("pair_term") && clauses({ tagline: "A cat who naps on SPY charts." }).includes("pair_term")
    && clauses({ name: "SP500 Cat" }).includes("pair_term") && clauses({ name: "Palantir Cat" }, PLTR).includes("pair_term"));
  ok("…and a person, mascot or brand its research row names", clauses({ name: "Probo Cat" }, SPY, { notes: [TEST_ROW(SPY, { mascots: ["Probo"] })] }).includes("pair_term"));
  ok("other_pair: any other pair's term (\"Tesla Cat\" beside SPYx; McDonald's beside PLTRx)", clauses({ name: "Tesla Kitty" }).includes("other_pair") && clauses({ name: "Hungry Cat", tagline: "A cat who dreams of McDonald's fries." }, PLTR).includes("other_pair"));
  ok("pair_ticker: this pair's root at either end, as letters and digits (BRK.Bx is BRKB)", clauses({ symbol: "SPYCAT" }).includes("pair_ticker") && clauses({ symbol: "CATSPY" }).includes("pair_ticker")
    && stockCatRefusals({ ...base, symbol: "BRKBCAT" }, pair("BRK.Bx"), { notes: [TEST_ROW(pair("BRK.Bx"))], verifiedIndex: JUP }).some((r) => r.clause === "pair_ticker"));
  ok("…and any pair's root of three or more characters inside it", clauses({ symbol: "MYTSLAC" }).includes("pair_ticker") && clauses({ symbol: "MINTCAL" }).includes("pair_ticker"));
  for (const word of LAUNCH_CLAIMS) ok(`launch_claim: "${word}"`, clauses({ tagline: `A ginger cat, ${word} and all, on a sign.` }).includes("launch_claim"));
  ok("name_taken: an earlier stock cat's name or ticker", clauses({}, SPY, { earlier: [{ name: "Violet Ginger Cat", symbol: "OTHER" }] }).includes("name_taken") && clauses({}, SPY, { earlier: [{ name: "Other Cat", symbol: "VIOLGIN" }] }).includes("name_taken"));
  ok("and CashCat's own rules: a person, a brand, a promise, a ticker a verified token has, no cat", clauses({ name: "Elon Cat" }).includes("real_person") && clauses({ name: "Nike Cat" }).includes("brand")
    && clauses({ tagline: "A cat with guaranteed profit." }).includes("financial_promise") && clauses({ symbol: "JUP" }).includes("ticker_taken") && clauses({ name: "Violet Ginger Dog" }).includes("not_cat"));
  ok("the brand fix holds here too: \"SpaceX Cat\", \"McDonald's Cat\", \"OpenAI Cat\", \"JPMorgan Cat\" are brands",
    ["SpaceX Cat", "McDonald's Cat", "OpenAI Cat", "JPMorgan Cat"].every((name) => clauses({ name }).includes("brand")) && checkFields({ name: "Cat Intelligence" }).ok);
  let allGood = true, seededDiffer = new Set(), shapes = true;
  for (const p of STOCK_PAIRS) {
    const notes = [TEST_ROW(p)];
    const terms = pairTerms(p, notes);
    const words = p.name.split(/\s+/).filter((w) => w !== "xStock" && w.replace(/[^A-Za-z0-9]/g, "").length >= 3);
    allGood &&= [p.symbol, p.root, p.stonkfun, p.stonkfunName, ...words].every((t) => terms.includes(t)) && !terms.includes("xStock");
    const s = suggestNames(p, { notes, verifiedIndex: JUP });
    const again = suggestNames(p, { notes, verifiedIndex: JUP });
    shapes &&= s.length > 0 && JSON.stringify(s) === JSON.stringify(again) && s.every((x) => stockCatRefusals(x, p, { notes, verifiedIndex: JUP }).length === 0
      && x.name === `${x.background[0].toUpperCase()}${x.background.slice(1)} ${{ greytabby: "Grey Tabby" }[x.kitten] ?? x.kitten[0].toUpperCase() + x.kitten.slice(1)} Cat`
      && x.symbol === (x.background.slice(0, 4) + x.kitten.slice(0, 3)).toUpperCase() && /^An? [a-z ]+ cat on an? [a-z]+ sign\.$/.test(x.tagline));
    seededDiffer.add(`${s[0]?.kitten}/${s[0]?.background}`);
    const disc = pairDisclosure(p);
    allGood &&= disc === `Not financial advice. A cat coin paired on StonkFun with ${p.symbol}, a tokenised stock: it is not the stock, and is not affiliated with, endorsed by or connected to the company or fund ${p.symbol} tracks, ${p.symbol}'s issuer, or StonkFun.`
      && !words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\']/g, "\\$&")}\\b`, "i").test(disc));
  }
  ok("each pair's terms: its symbol, root, StonkFun's symbol and name, and every name word of three or more letters but \"xStock\"; its disclosure word for word, naming the symbol and never the company", allGood);
  ok("each pair gets suggestions that pass every rule, \"<Background> <Kitten> Cat\" with four letters and three for a ticker and the fixed line, in the same order every time", shapes);
  ok("…the order seeded by each pair's mint, so the pairs do not all start alike", seededDiffer.size > 1, `${seededDiffer.size} different first suggestions over 24 pairs`);
  ok("a fixed line reads as English: \"an orange sign\", \"an ink sign\"", suggestionFor("ginger", "orange", SPY).tagline === "A ginger cat on an orange sign." && suggestionFor("greytabby", "ink", SPY).tagline === "A grey tabby cat on an ink sign.");
}

section("4. THE STOCK'S OWN MINT");
{
  const acct = accOf(SPY.mint);
  const d = describeMint(acct, SPY.mint);
  const q = (over) => quoteRefusals({ ...d, ...over }, SPY).map((r) => r.clause);
  const pausedBytes = Buffer.from(acct.data[0], "base64");
  /* The Pausable extension's value: its authority (32 bytes), then the paused flag. */
  const tlv = (() => { let o = 166; while (o + 4 <= pausedBytes.length) { const t = pausedBytes.readUInt16LE(o), l = pausedBytes.readUInt16LE(o + 2); if (t === 26) return o + 4; if (t === 0) break; o += 4 + l; } return -1; })();
  pausedBytes[tlv + 32] = 1;
  ok("quote_paused: the mint's own paused flag set, read from its bytes", tlv > 0 && quoteRefusals(describeMint({ ...acct, data: [pausedBytes.toString("base64"), "base64"] }, SPY.mint), SPY).map((r) => r.clause).join() === "quote_paused");
  ok("quote_default_frozen: new accounts opened frozen", q({ defaultAccountState: 2 }).includes("quote_default_frozen"));
  ok("quote_transfer_fee: a transfer fee", q({ extensionNames: [...d.extensionNames, "TransferFeeConfig"] }).includes("quote_transfer_fee"));
  ok("quote_hook: a transfer hook program", q({ transferHookProgram: Keypair.generate().publicKey.toBase58() }).includes("quote_hook"));
  ok("quote_symbol: the mint's own symbol is not the pair's", q({ metadataSymbol: "SPYX" }).includes("quote_symbol"));
  const other = Keypair.generate().publicKey.toBase58();
  ok("quote_issuer: another key in any seat (mint, freeze, pause, permanent delegate)", ["mintAuthority", "freezeAuthority", "pausableAuthority", "permanentDelegate"].every((seat) => q({ [seat]: other }).includes("quote_issuer")));
}

/* ── the world: the network, the planner, the chain, the autopilot wallet, the tab ──────────── */
const MODELS = ["test-model-a"];
function network({ review = { verdict: "approve", rules: [], reason: "fine" }, pricing = null, tokens = {}, proposal = null } = {}) {
  const uploads = [], docs = new Map(), asked = [];
  const bySymbol = new Map(STOCK_PAIRS.map((p) => [p.mint, p.symbol]));
  const { fetchImpl, calls } = scriptedFetch([
    [URLS.stonkfunStats, () => day("api-stats.json").body],
    [URLS.stonkfunPairs, () => PAIRS_ANSWER.body],
    ["https://www.stonkfun.xyz/api/public/v1/launchlab/pricing", (u) => { const mint = new URL(u).searchParams.get("quoteMint"); const b = structuredClone(day(`pricing/${bySymbol.get(mint)}.json`).body); if (pricing) pricing(b.data, mint); return b; }],
    ["https://www.stonkfun.xyz/api/public/v1/tokens/", (u) => { const mint = u.split("/tokens/")[1]; return tokens[mint] ? tokens[mint]() : response(NOT_FOUND.status, NOT_FOUND.body); }],
    [URLS.googleTrendsRss("US"), () => response(200, fixture("trends/google-trends-us.xml"))],
    [URLS.coingeckoTrending, () => fixture("trends/coingecko-trending.json").body],
    [URLS.jupiterVerified, () => fixture("jupiter/verified-sample.json").tokens],
    ["https://api.anthropic.com/v1/models", () => ({ data: MODELS.map((id) => ({ id, type: "model", display_name: id })) })],
    ["https://api.anthropic.com/v1/messages", (_u, init) => {
      const body = JSON.parse(init.body);
      const name = body.tools[0].name;
      asked.push({ tool: name, system: body.system, user: JSON.stringify(body.messages) });
      const input = name === "propose_coin" ? (typeof proposal === "function" ? proposal() : proposal) : review;
      return { id: "msg_test", model: body.model, stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", id: "t", name, input }] };
    }],
    [URLS.pinataUpload, async (_u, init) => {
      const file = init.body.get("file");
      const bytes = Buffer.from(await file.arrayBuffer());
      const cid = `bafkrei${"s".repeat(51)}${"abcdefghijklmnopqrstuvwxyz"[uploads.length % 26]}`;
      uploads.push({ type: file.type, bytes, cid });
      if (file.type === "application/json") docs.set(cid, JSON.parse(bytes.toString("utf8")));
      return { data: { id: "test", cid } };
    }],
    ["https://gateway.pinata.cloud/ipfs/", (u) => docs.get(u.split("/ipfs/")[1]) ?? response(404, "{}")],
  ]);
  const http = createHttp({ fetchImpl, allowedHosts: Object.values(HOSTS), sleep: async () => {} });
  return { http, fetchImpl, calls, uploads, docs, asked };
}

function makeChain({ wallet, lamports = 1_000_000_000n }) {
  const st = { lamports: new Map([[wallet, BigInt(lamports)]]), accounts: new Map(), sent: [], sims: 0, slot: 450_371_000, blockHeight: 428_400_000, mode: {} };
  st.accounts.set(PUMPFUN_GLOBAL, { owner: PUMPFUN_PROGRAM, lamports: 1, data: Buffer.from(fixture("pumpfun/global.json").dataBase64, "base64") });
  const curveTemplate = Buffer.from(fixture("popcat/snapshots.json").snapshots[1].curveAccount.dataBase64, "base64");
  const parse = (tx) => {
    const m = readMessage(tx.message);
    const ll = m.instructions.filter((ix) => ix.programId === LAUNCHLAB_PROGRAM);
    const pump = m.instructions.filter((ix) => ix.programId === PUMPFUN_PROGRAM);
    const kind = ll.length === 1 && ll[0].data.subarray(0, 8).toString("hex") === IX.launchlabInitializeWithToken2022 ? "initialize"
      : pump.length === 1 && pump[0].data.subarray(0, 8).toString("hex") === IX.pumpCreateV2 ? "create" : "other";
    return { m, ll, pump, kind };
  };
  const spendOf = (p) => BigInt(p.kind === "initialize" ? SIM_SPEND : p.kind === "create" ? PUMP_SIM.payerBefore - PUMP_SIM.payerAfter : 5_000) + BigInt(st.mode.extraSpend ?? 0);
  const rpc = {
    url: "https://chain.double",
    async getLatestBlockhash() { return { blockhash: bs58.encode(Buffer.alloc(32, 9)), lastValidBlockHeight: st.blockHeight + 150 }; },
    async getBalance(a) { return st.lamports.get(String(a)) ?? 0n; },
    async simulateTransaction(b64, { addresses = [] } = {}) {
      st.sims++;
      const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
      const p = parse(tx);
      const payer = p.m.feePayer;
      const logs = p.kind === "initialize" ? SIM.result.logs.filter((l) => !(st.mode.noLog && l.includes("InitializeWithToken2022"))) : p.kind === "create" ? PUMP_SIM.logs : [];
      return { err: null, logs, unitsConsumed: p.kind === "initialize" ? SIM.result.unitsConsumed : PUMP_SIM.unitsConsumed,
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
      if (p.kind === "initialize") {
        /* The new mint reads as a real StonkFun launch's did that day: Token-2022, no authorities. */
        const data = Buffer.from(LAUNCHED[0].dataBase64, "base64");
        if (st.mode.dirtyMint) { data.writeUInt32LE(1, 0); new PublicKey(payer).toBuffer().copy(data, 4); }
        st.accounts.set(p.ll[0].accounts[6].pubkey, { owner: TOKEN_2022, lamports: 1, data });
      } else if (p.kind === "create") {
        const mint = p.pump[0].accounts[0].pubkey;
        const d = Buffer.alloc(82); d.writeBigUInt64LE(1_000_000_000_000_000n, 36); d[44] = 6; d[45] = 1;
        st.accounts.set(mint, { owner: TOKEN_2022, lamports: 1, data: d });
        const curve = Buffer.from(curveTemplate);
        new PublicKey(payer).toBuffer().copy(curve, BONDING_CURVE_LAYOUT.creator);
        st.accounts.set(pda([{ utf8: "bonding-curve" }, { key: mint }], PUMPFUN_PROGRAM), { owner: PUMPFUN_PROGRAM, lamports: 1, data: curve });
      }
      st.sent.push({ signature, tx, kind: p.kind, payer, pre, post, m: p.m });
      return signature;
    },
    async getSignatureStatus(sig) { const s = st.sent.find((x) => x.signature === sig); return s ? { err: null, confirmationStatus: "confirmed" } : null; },
    async getBlockHeight() { return st.blockHeight; },
    async getTransaction(sig) {
      const s = st.sent.find((x) => x.signature === sig);
      return s ? { slot: st.slot, meta: { err: null, fee: 10_000, preBalances: [Number(s.pre)], postBalances: [Number(s.post)] }, transaction: { message: { accountKeys: s.m.accountKeys } } } : null;
    },
    async getMultipleAccounts(addresses) {
      return { slot: st.slot, accounts: addresses.map((a) => { const acc = st.accounts.get(String(a)); return acc ? { owner: acc.owner, lamports: acc.lamports, data: [acc.data.toString("base64"), "base64"] } : null; }) };
    },
  };
  return { st, rpc };
}

const stubRenderer = { render: async () => ({ png: new Uint8Array(Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")) }) };
const PASS = "the cat that pairs its coin with a stock";
async function world({ lamports = 1_000_000_000n, net = network(), notes = TEST_NOTES, apiKey = true, rpcUp = true, start = Date.parse("2026-09-25T15:00:00Z"), hooks = {} } = {}) {
  const T = { now: start };
  const clock = () => T.now;
  const keystore = createKeystore({ storage: mapStore(), session: mapStore(), clock });
  const { publicKey: WALLET } = await keystore.create({ passphrase: PASS });
  await keystore.unlock({ passphrase: PASS, ttlMs: 48 * HOUR });
  const signer = createSessionSigner({ keystore, clock });
  await signer.refresh();
  const chain = makeChain({ wallet: WALLET, lamports });
  const phantomAsked = [];
  const phantom = { isReady: () => true, wallet: () => null, async signTransaction(req) { phantomAsked.push(req); throw new Error("Phantom must not be asked for a stock cat"); } };
  const timers = { setTimeout: (f) => setImmediate(f), clearTimeout() {}, setInterval: () => 0, clearInterval() {} };
  const engine = createHawkEngine({ rpc: chain.rpc, bridge: phantom, sessionSigner: signer, store: memoryStore(), clock, timers, config: { rpcUrl: "https://chain.double" } });
  const signed = [];
  const fenceWrap = () => {
    const f = engine.agentFences();
    const g = { ...f, signSendConfirm: async (args) => { signed.push(args); return f.signSendConfirm(args); } };
    if (!rpcUp) g.rpc = () => null;
    if (hooks.wallet) g.wallet = () => hooks.wallet;
    return g;
  };
  const storage = mapStore();
  const brain = createBrain({ fetchImpl: net.fetchImpl, apiKey: async () => (apiKey ? "sk-ant-test-stockcats-0000" : null), clock });
  const model = async () => ({ hasKey: apiKey, callTool: async ({ tool, system, user }) => (await brain.callTool({ chosen: "", tool, system, user })).input });
  const desk = createDraftDesk({ http: net.http, model, clock });
  const mintKeys = createMintKeys({ clock });
  const pinVenues = [];
  const pinata = { hasJwt: async () => true, pin: ({ logoPng, coin, buildDoc, venue }) => { pinVenues.push(venue); return pinMetadata({ http: net.http, jwt: "eyJ.test-pinata.jwt", logoPng, coin, venue, buildDoc }); } };
  const planRpc = scriptedRpc({ getMultipleAccounts: ([list]) => ({ value: list.map(accOf) }) });
  const planCalls = [];
  const stonkfun = {
    pairs: () => net.http.json(URLS.stonkfunPairs),
    plan: async ({ pairMint }) => {
      planCalls.push(pairMint);
      if (hooks.planThrow) throw hooks.planThrow;
      const p = await planStonkfunLaunch({ http: net.http, rpc: planRpc, quoteChoice: pairMint, quoteList: STONKFUN_XSTOCKS });
      return hooks.plan ? hooks.plan(p, planCalls.length) : p;
    },
    token: (mint) => net.http.json(URLS.stonkfunToken(mint)),
  };
  const notes2 = [];
  const tab = createCashcatTab({ storage, desk, renderLogo: (spec) => stubRenderer.render(spec), pinata, fences: fenceWrap, stonkfun, stockNotes: notes, mintKeys, hasApiKey: async () => apiKey, clock, notify: (n) => notes2.push(n) });
  return { T, clock, keystore, signer, WALLET, chain, engine, tab, storage, mintKeys, net, phantomAsked, signed, planCalls, pinVenues, hooks, notices: notes2 };
}
const SC = (w) => w.tab.stockCats;
const PICK = async (w, p = SPY) => { const s = await SC(w).suggest({ pairMint: p.mint }); return s.suggestions[0]; };
async function prepared(w, p = SPY, idea = null) {
  const d = idea ?? (await PICK(w, p));
  const r = await SC(w).draft({ pairMint: p.mint, idea: d });
  if (!r.ok) throw new Error(`draft refused: ${r.refusals.join("; ")}`);
  return { draft: r.draft, plan: await SC(w).prepare({ pairMint: p.mint }) };
}

section("5. THE LAUNCH, IN A LAUNCHLAB CHAIN DOUBLE");
let launched = null;
{
  const shipped = await world({ notes: STOCK_CAT_NOTES });
  const sug = await SC(shipped).suggest({ pairMint: SPY.mint });
  await SC(shipped).draft({ pairMint: SPY.mint, idea: { name: "Violet Ginger Cat", symbol: "VIOLGIN", tagline: "A ginger cat on a violet sign." } });
  ok("as shipped (no research rows), no name is suggested, and \"Check the launch\" is refused at pair_terms_missing before anything is read or built",
    sug.ok === false && sug.clauses[0] === "pair_terms_missing" && (await throwsClause(() => SC(shipped).prepare({ pairMint: SPY.mint }), "pair_terms_missing"))?.clause === "pair_terms_missing"
      && shipped.planCalls.length === 0 && shipped.chain.st.sims === 0);

  const w = await world({});
  const list0 = await SC(w).list();
  ok("the list: 24 pairs, the researched ones marked, their facts for the owner labelled as sourced facts, not endorsements", list0.pairs.length === 24 && list0.pairs.filter((p) => p.researched).length === 3
    && list0.pairs.find((p) => p.mint === SPY.mint).catFacts[0].label === STOCKCAT_TEXT.catFact && list0.pairs.find((p) => p.mint === SPY.mint).catFacts[0].source === "a test, not a source");
  const refreshed = await SC(w).refresh();
  ok("reading StonkFun marks all 24 ready and counts the rest", refreshed.pairs.every((p) => p.ready === true) && refreshed.others.reduce((n, o) => n + o.count, 0) === PAIRS_ANSWER.body.data.pairs.length - 24);
  await w.tab.saveSettings({ devBuySol: 0.05 });                   // CashCat's own dev buy, set to its most: a stock cat makes none
  const { draft, plan } = await prepared(w);
  ok("\"Check the launch\": a v0 message with two signers, the recorded simulation's spend inside the StonkFun budget, and nothing pinned, signed or sent",
    plan.ok === true && plan.message.version === 0 && plan.message.signers === 2 && plan.simulatedSpendSol === SIM_SPEND / 1e9 && plan.budgetSol === MAX_LAUNCH_SPEND_LAMPORTS.stonkfun / 1e9
      && w.chain.st.sent.length === 0 && w.net.uploads.length === 0 && w.mintKeys.count() === 0, JSON.stringify({ spend: plan.simulatedSpendSol, units: plan.units }));
  ok("…showing the accounts (StonkFun's platform, the pair's config and curve rule), the raise, StonkFun's market caps as its pricing figure, the multiplier and the three notes",
    plan.accounts[0].address === STONKFUN_PLATFORM_STANDARD && plan.accounts.some((a) => a.address === day("pricing/SPYx.json").body.data.curve.configId) && plan.raise.raw === day("pricing/SPYx.json").body.data.raise.raw
      && plan.marketCap.label === "StonkFun's pricing figure, not a forecast" && plan.scaledUiMultiplier === describeMint(accOf(SPY.mint), SPY.mint).scaledUiMultiplier
      && JSON.stringify(plan.notes) === JSON.stringify([STOCKCAT_TEXT.issuer, "No dev buy", "StonkFun says it forwards a creator share off chain. Not verified; nothing is claimed."]));
  ok("…and the disclosure its coin will carry", plan.disclosure === pairDisclosure(SPY));
  const out = await SC(w).launch({ pairMint: SPY.mint, preparedId: plan.preparedId, confirmTicker: `$${draft.symbol.toLowerCase()}` });
  launched = { w, out, draft };
  const sent = w.chain.st.sent;
  const tx = sent[0]?.tx;
  const signers = tx ? tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).map((k) => k.toBase58()) : [];
  ok("one transaction was sent, and the engine's signSendConfirm was asked once, though CashCat's dev buy is set to 0.05 SOL", sent.length === 1 && sent[0].kind === "initialize" && w.signed.length === 1 && out.ok === true && out.devBuySignature === null);
  ok("it is a v0 transaction with no lookup table, signed by exactly [the autopilot wallet, the new mint], both verified by the chain; Phantom never asked",
    tx?.version === 0 && tx.message.addressTableLookups.length === 0 && JSON.stringify(signers) === JSON.stringify([w.WALLET, out.mint]) && w.phantomAsked.length === 0);
  const pinned = w.net.uploads.find((u) => u.type === "application/json");
  const doc = pinned ? JSON.parse(pinned.bytes.toString("utf8")) : null;
  const uri = stonkfunMetadataUri(pinned?.cid);
  const replan = await planStonkfunLaunch({ http: w.net.http, rpc: scriptedRpc({ getMultipleAccounts: ([list]) => ({ value: list.map(accOf) }) }), quoteChoice: SPY.mint, quoteList: STONKFUN_XSTOCKS });
  let checked;
  try { checked = checkLaunchMessage(tx.message, { wallet: w.WALLET, mint: out.mint, venue: "stonkfun", coin: { name: draft.name, symbol: draft.symbol, uri }, plan: replan }); } catch (e) { checked = `${e.clause}: ${e.message}`; }
  ok("the bytes sent pass the bot's own pre-sign check with venue \"stonkfun\": the planned signers, program, sixteen accounts, the shape, the raise and the pinned URI (Pinata's gateway form)", checked === true, String(checked));
  ok("the simulation it passed logged InitializeWithToken2022 and spent the recorded 8,673,900 lamports", w.chain.st.sims === 3 && SIM_SPEND === 8_673_900 && SIM.result.logs.some((l) => l.includes("Instruction: InitializeWithToken2022")) && out.costSol === SIM_SPEND / 1e9);
  ok("the metadata was pinned for StonkFun, its description the tagline and the disclosure, created on StonkFun, with no \"Made with CashCat\"",
    w.pinVenues.join() === "stonkfun" && doc?.description === `${draft.tagline} — ${pairDisclosure(SPY)}` && doc.createdOn === "https://www.stonkfun.xyz" && !/Made with/.test(doc.description) && doc.image.startsWith("https://gateway.pinata.cloud/ipfs/"));
  const everything = JSON.stringify([doc, ...w.net.uploads.map((u) => u.bytes.toString("latin1")), w.net.asked]);
  ok("no research text reaches the coin or the model: not a cat fact, not its source, not the row's method", !/TESTFACT|a test, not a source|made up for test-cats-stockcats/.test(everything));
  ok("…and the document names the xStock's symbol, never the company", doc.description.includes("SPYx") && !/SP500|S&P/i.test(doc.description));
  const j = await w.storage.get(CASHCAT_TAB_KEYS.journal);
  const e = j.find((x) => x.mint === out.mint);
  ok("the journal: venue, pair, pool, mint, signature, cost, a clean mint, and the links to StonkFun and Solscan",
    e?.kind === "launched" && e.venue === "stonkfun" && JSON.stringify(e.pair) === JSON.stringify({ official: "SPYx", stonkfun: "SPYX", mint: SPY.mint }) && e.pool === poolState(out.mint, SPY.mint)
      && e.signature === out.signature && e.creator === w.WALLET && e.mintClean === true && e.links.join() === `https://www.stonkfun.xyz/token/${out.mint},https://solscan.io/tx/${out.signature}`
      && out.links.map((l) => l.href).join() === e.links.join(), JSON.stringify(e));
  ok("the new mint's key was used once and dropped", w.mintKeys.count() === 0);
  ok("the model reviewed it as a stock cat: the pair's symbol and every term it must not reference, and the stock cat's own rules", w.net.asked.some((a) => a.tool === "review_coin" && a.system.includes(STOCK_CAT_RULES_TEXT) && a.user.includes("paired_with") && a.user.includes("must_not_reference") && a.user.includes("SP500")));
  const ex = await w.tab.exclusions();
  ok("Popcat, Snipurr and the agent are told it is the owner's own (CashCat's exclusions)", ex.launches.some((l) => l.mint === out.mint && l.creator === w.WALLET));
}

section("6. ARMED BY THE CHECK ALONE: EVERY WAY A LAUNCH IS REFUSED BEFORE IT RUNS");
{
  const noPrep = await world({});
  const d = await PICK(noPrep);
  await SC(noPrep).draft({ pairMint: SPY.mint, idea: d });
  ok("prepare_first: nothing was checked", (await throwsClause(() => SC(noPrep).launch({ pairMint: SPY.mint, preparedId: "stockcat-x", confirmTicker: d.symbol }), "prepare_first"))?.clause === "prepare_first");
  const cases = [
    ["prepare_stale", "the check is over ten minutes old", async (w, p) => { w.T.now += STOCKCAT_LIMITS.prepareTtlMs + 1; return { pairMint: SPY.mint, preparedId: p.preparedId, confirmTicker: p.draft.symbol }; }],
    ["pair_changed", "another pair than the one checked", async (w, p) => ({ pairMint: PLTR.mint, preparedId: p.preparedId, confirmTicker: p.draft.symbol })],
    ["draft_changed", "the draft changed after the check", async (w, p) => { const s = (await SC(w).suggest({ pairMint: SPY.mint })).suggestions[1]; await SC(w).draft({ pairMint: SPY.mint, idea: s }); return { pairMint: SPY.mint, preparedId: p.preparedId, confirmTicker: s.symbol }; }],
    ["wallet_changed", "the autopilot wallet changed after the check", async (w, p) => { w.hooks.wallet = Keypair.generate().publicKey.toBase58(); return { pairMint: SPY.mint, preparedId: p.preparedId, confirmTicker: p.draft.symbol }; }],
    ["confirm", "the wrong ticker typed", async (w, p) => ({ pairMint: SPY.mint, preparedId: p.preparedId, confirmTicker: "NOPE" })],
    ["prepare_first", "another check's id", async (w, p) => ({ pairMint: SPY.mint, preparedId: `${p.preparedId}x`, confirmTicker: p.draft.symbol })],
  ];
  for (const [clause, what, setup] of cases) {
    const w = await world({});
    const { plan } = await prepared(w);
    const args = await setup(w, plan);
    const e = await throwsClause(() => SC(w).launch(args), clause);
    ok(`${clause}: ${what} — refused, nothing pinned, signed or sent`, e?.clause === clause && w.chain.st.sent.length === 0 && w.net.uploads.length === 0 && w.signed.length === 0, JSON.stringify(e?.wrong ?? ""));
  }
  const once = await world({});
  const { plan } = await prepared(once);
  await throwsClause(() => SC(once).launch({ pairMint: SPY.mint, preparedId: plan.preparedId, confirmTicker: "NOPE" }), "confirm");
  ok("a check is used once: after a refused launch, the same id is refused at prepare_first", (await throwsClause(() => SC(once).launch({ pairMint: SPY.mint, preparedId: plan.preparedId, confirmTicker: plan.draft.symbol }), "prepare_first"))?.clause === "prepare_first");
  const j = await once.storage.get(CASHCAT_TAB_KEYS.journal);
  ok("…and each refusal is journaled as a stock cat's", j.filter((x) => x.kind === "refused" && x.venue === "stonkfun").map((x) => x.clause).join() === "prepare_first,confirm");
}

section("7. THE CAPS: ONE CAT PER STOCK, THE DAY'S CAP, A MINT THAT READ BACK UNCLEAN");
{
  const { w, draft } = launched;
  const again = (await SC(w).suggest({ pairMint: SPY.mint })).suggestions.find((s) => s.symbol !== draft.symbol);
  await SC(w).draft({ pairMint: SPY.mint, idea: again });
  ok("stock_has_cat: SPYx has its cat; another is refused, ever", (await throwsClause(() => SC(w).prepare({ pairMint: SPY.mint }), "stock_has_cat"))?.clause === "stock_has_cat");
  const taken = await SC(w).draft({ pairMint: PLTR.mint, idea: { ...draft, pairMint: PLTR.mint } });
  ok("name_taken: PLTRx may not take SPYx's cat's name or ticker", taken.ok === false && taken.clauses.includes("name_taken"));
  ok("the day's cap is 2 by default and fenced 1 to 6, the bot's own fence; outside it, refused by name", STOCKCAT_LIMITS.maxPerDay === 2 && JSON.stringify(STOCKCAT_LIMITS.fence) === JSON.stringify(FENCES.maxLaunchesPerDay)
    && (await throwsClause(() => SC(w).saveSettings({ maxPerDay: 7 }), "max_per_day"))?.clause === "max_per_day" && (await throwsClause(() => SC(w).saveSettings({ maxPerDay: 0 }), "max_per_day"))?.clause === "max_per_day");
  await SC(w).saveSettings({ maxPerDay: 1 });
  const pl = (await SC(w).suggest({ pairMint: PLTR.mint })).suggestions[0];
  await SC(w).draft({ pairMint: PLTR.mint, idea: pl });
  ok("stock_day_cap: at 1 a day, the second launch the same UTC day is refused", (await throwsClause(() => SC(w).prepare({ pairMint: PLTR.mint }), "stock_day_cap"))?.clause === "stock_day_cap");
  const cash = await world({});
  await cash.storage.set(CASHCAT_TAB_KEYS.journal, [{ at: cash.T.now - 60_000, kind: "launched", venue: "pumpfun", mode: "manual", mint: Keypair.generate().publicKey.toBase58(), creator: cash.WALLET, symbol: "RAINCAT" },
    { at: cash.T.now - 120_000, kind: "launched", venue: "pumpfun", mode: "auto", mint: Keypair.generate().publicKey.toBase58(), creator: cash.WALLET, symbol: "AUTOCAT" }]);
  await SC(cash).draft({ pairMint: SPY.mint, idea: await PICK(cash) });
  ok("…counting every launch from the extension: two CashCat coins today fill the default cap", (await throwsClause(() => SC(cash).prepare({ pairMint: SPY.mint }), "stock_day_cap"))?.clause === "stock_day_cap");

  const dirty = await world({});
  dirty.chain.st.mode.dirtyMint = true;
  const { plan } = await prepared(dirty);
  const out = await SC(dirty).launch({ pairMint: SPY.mint, preparedId: plan.preparedId, confirmTicker: plan.draft.symbol });
  ok("a launch whose mint reads back with a mint authority still set is journaled mintClean:false, and the owner told", out.mintClean === false && (await dirty.storage.get(CASHCAT_TAB_KEYS.journal)).find((x) => x.mint === out.mint).mintClean === false && dirty.notices.some((n) => n.kind === "attention"));
  await SC(dirty).draft({ pairMint: PLTR.mint, idea: (await SC(dirty).suggest({ pairMint: PLTR.mint })).suggestions[0] });
  ok("unclean_mint: every further stock cat is refused until the owner marks it checked", (await throwsClause(() => SC(dirty).prepare({ pairMint: PLTR.mint }), "unclean_mint"))?.clause === "unclean_mint");
  await dirty.tab.markChecked({ mint: out.mint, landed: true });
  ok("…after CashCat's own MARK_CHECKED, the next is checked again", (await SC(dirty).prepare({ pairMint: PLTR.mint })).ok === true);
}

section("8. THE PLAN AGAIN AT THE LAUNCH, THE PLANNER'S REFUSALS, THE OWNER'S RPC, HOSTILE BYTES");
{
  const other = Keypair.generate().publicKey.toBase58();
  const changed = await world({ hooks: {} });
  changed.hooks.plan = (p, n) => (n >= 2 ? { ...p, curveRule: other } : p);
  const c = await prepared(changed);
  ok("plan_changed: StonkFun's curve rule (or config, platform, token program) differs at the launch — refused before a pin", (await throwsClause(() => SC(changed).launch({ pairMint: SPY.mint, preparedId: c.plan.preparedId, confirmTicker: c.draft.symbol }), "plan_changed"))?.clause === "plan_changed"
    && changed.net.uploads.length === 0 && changed.chain.st.sent.length === 0);
  const raised = await world({ hooks: {} });
  raised.hooks.plan = (p, n) => (n >= 2 ? { ...p, raiseRaw: p.raiseRaw + 1_000n } : p);
  const r = await prepared(raised);
  const rout = await SC(raised).launch({ pairMint: SPY.mint, preparedId: r.plan.preparedId, confirmTicker: r.draft.symbol });
  const rj = (await raised.storage.get(CASHCAT_TAB_KEYS.journal)).find((x) => x.mint === rout.mint);
  ok("a changed raise is only written down: launched at the new raise, the one checked beside it", rout.ok === true && rj.raiseRaw === String(BigInt(r.plan.raise.raw) + 1_000n) && rj.checkedRaiseRaw === r.plan.raise.raw);
  const tampered = await world({ net: network({ pricing: (d) => { d.platform.standard = STONKFUN_PLATFORM_REWARD; } }) });
  await SC(tampered).draft({ pairMint: SPY.mint, idea: await PICK(tampered) });
  const pr = await throwsClause(() => SC(tampered).prepare({ pairMint: SPY.mint }), "plan_refused");
  ok("plan_refused: the planner's own refusal (a reward platform in the pricing) is reported with its inner clause", pr?.clause === "plan_refused" && pr.detail.inner === "platform" && /^plan_refused:platform/.test(pr.message) && tampered.chain.st.sims === 0);
  const sneaky = await world({ hooks: {} });
  sneaky.hooks.plan = (p) => ({ ...p, platformConfig: STONKFUN_PLATFORM_REWARD });
  await SC(sneaky).draft({ pairMint: SPY.mint, idea: await PICK(sneaky) });
  const sp = await throwsClause(() => SC(sneaky).prepare({ pairMint: SPY.mint }), "transaction_refused");
  ok("a plan that itself names the reward platform is refused by the pre-sign check before any simulation", sp?.clause === "transaction_refused" && /platform/.test(sp.message) && sneaky.chain.st.sims === 0 && sneaky.mintKeys.count() === 0);
  const paused = await world({ hooks: {} });
  paused.hooks.plan = (p) => { const b = Buffer.from(p.quoteMintAccount.data); let o = 166; while (b.readUInt16LE(o) !== 26) o += 4 + b.readUInt16LE(o + 2); b[o + 4 + 32] = 1; return { ...p, quoteMintAccount: { ...p.quoteMintAccount, data: b } }; };
  await SC(paused).draft({ pairMint: SPY.mint, idea: await PICK(paused) });
  ok("a quote check at the tab: the stock's own mint read paused with the plan → quote_paused, before any build", (await throwsClause(() => SC(paused).prepare({ pairMint: SPY.mint }), "quote_paused"))?.clause === "quote_paused" && paused.chain.st.sims === 0);
  const pub = await world({ hooks: { planThrow: Object.assign(new Error("public RPC"), { clause: "no_rpc" }) } });
  await SC(pub).draft({ pairMint: SPY.mint, idea: await PICK(pub) });
  ok("no_rpc: with only the public RPC (which answers 403 to the extension) the plan is refused as no_rpc, not as a StonkFun refusal", (await throwsClause(() => SC(pub).prepare({ pairMint: SPY.mint }), "no_rpc"))?.clause === "no_rpc");
  const none = await world({ rpcUp: false });
  await SC(none).draft({ pairMint: SPY.mint, idea: await PICK(none) });
  ok("…and with no RPC set at all, refused the same way before anything is read", (await throwsClause(() => SC(none).prepare({ pairMint: SPY.mint }), "no_rpc"))?.clause === "no_rpc" && none.planCalls.length === 0);
  for (const [what, mode] of [["the simulation spends more than the 0.015 SOL budget", { extraSpend: 7_000_000 }], ["the simulation does not log InitializeWithToken2022", { noLog: true }]]) {
    const w = await world({});
    const p = await prepared(w).catch(() => null);
    ok(`the check itself passes on honest bytes (${what}: set after it)`, p?.plan?.ok === true);
    Object.assign(w.chain.st.mode, mode);
    ok(`simulation_refused: ${what} — before a pin, the mint's key or a signature`, (await throwsClause(() => SC(w).launch({ pairMint: SPY.mint, preparedId: p.plan.preparedId, confirmTicker: p.draft.symbol }), "simulation_refused"))?.clause === "simulation_refused"
      && w.chain.st.sent.length === 0 && w.net.uploads.length === 0 && w.signed.length === 0 && w.mintKeys.count() === 0);
  }

  /* Hostile v0 edits of the stock cat's own launch, read by the check the tab runs before the
     mint's key signs: each refused by name. */
  const plan = { ...SIM.plan, raiseRaw: BigInt(SIM.plan.raiseRaw) };
  const WALLET = Keypair.generate().publicKey.toBase58(), MINT = Keypair.generate().publicKey.toBase58();
  const coin = { name: "Violet Ginger Cat", symbol: "VIOLGIN", uri: stonkfunMetadataUri(`bafkrei${"a".repeat(52)}`) };
  const v0 = (ixs, lookups = []) => new TransactionMessage({ payerKey: new PublicKey(WALLET), recentBlockhash: bs58.encode(Buffer.alloc(32, 9)), instructions: ixs }).compileToV0Message(lookups);
  const honest = VENUE_RUN.stonkfun.ix({ mint: MINT, wallet: WALLET, draft: coin, uri: coin.uri, plan });
  const verdict = (m) => syncClause(() => checkLaunchMessage(m, { wallet: WALLET, mint: MINT, venue: "stonkfun", coin, plan }));
  const accts = initializeAccounts({ payer: WALLET, mint: MINT, quoteMint: plan.quote.mint, quoteTokenProgram: plan.quote.tokenProgram, globalConfig: plan.globalConfig, curveRule: plan.curveRule });
  const data = () => Buffer.from(encodeInitialize({ ...coin, raiseRaw: plan.raiseRaw }));
  const built = buildUnsignedTransaction({ payer: WALLET, blockhash: bs58.encode(Buffer.alloc(32, 9)), instructions: [honest], computeUnitLimit: COMPUTE_LIMITS.stonkfun, priorityFeeLamports: PRIORITY_FEE_LAMPORTS });
  ok("the honest v0 launch, as the tab builds it, passes", verdict(built.message) === "passed" && built.version === 0);
  const reward = initializeAccounts({ payer: WALLET, mint: MINT, quoteMint: plan.quote.mint, quoteTokenProgram: plan.quote.tokenProgram, globalConfig: plan.globalConfig, platformConfig: STONKFUN_PLATFORM_REWARD, curveRule: plan.curveRule });
  ok("StonkFun's reward (taxed) platform → accounts", verdict(v0([instruction(LAUNCHLAB_PROGRAM, reward, data())])) === "accounts");
  ok("another raise → raise", verdict(v0([initializeIx({ payer: WALLET, mint: MINT, quoteMint: plan.quote.mint, quoteTokenProgram: plan.quote.tokenProgram, globalConfig: plan.globalConfig, curveRule: plan.curveRule, ...coin, raiseRaw: plan.raiseRaw + 1n })])) === "raise");
  const vest = data(); vest.writeBigUInt64LE(1n, vest.length - 11 - 1 - 24);
  ok("vesting → vesting", verdict(v0([instruction(LAUNCHLAB_PROGRAM, accts, vest)])) === "vesting");
  const fee = data(); fee[fee.length - 11] = 1;
  ok("a transfer fee → transfer_fee", verdict(v0([instruction(LAUNCHLAB_PROGRAM, accts, fee)])) === "transfer_fee");
  ok("the curve rule left off → accounts", verdict(v0([instruction(LAUNCHLAB_PROGRAM, accts.slice(0, 15), data())])) === "accounts");
  ok("an extra transfer → instructions", verdict(v0([honest, SystemProgram.transfer({ fromPubkey: new PublicKey(WALLET), toPubkey: new PublicKey(other), lamports: 1 })])) === "instructions");
  const table = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: [new PublicKey(TOKEN_2022)] } });
  ok("a lookup table → lookup_tables", verdict(v0([honest], [table])) === "lookup_tables");
}

section("9. ADOPTION, WHEN THE OWNER ASKS");
{
  const rec = ADOPTED.body.data;
  const mint = rec.launch.mint;
  const seed = async (w) => w.storage.set(CASHCAT_TAB_KEYS.journal, [{ at: w.T.now, kind: "launched", venue: "stonkfun", mode: "manual", mint, creator: rec.launch.creator, name: rec.launch.name, symbol: rec.launch.symbol,
    pair: { official: "GLDx", stonkfun: "GLDX", mint: GLD.mint }, pool: poolState(mint, GLD.mint) }]);
  const tokens = (mut = null) => ({ [mint]: () => { const b = structuredClone(ADOPTED.body); if (mut) mut(b.data); return b; } });
  const w = await world({ net: network({ tokens: tokens() }) });
  await seed(w);
  const a = await SC(w).checkAdoption({ mint });
  ok("the recorded xStock-paired launch reads adopted: mint, pool (PDA of the mint and the stock), creator, LaunchLab, standard mode, the stock as the quote", a.adopted === true && a.mismatches.length === 0
    && ADOPTED.body.data.launch.pool === poolState(mint, GLD.mint), JSON.stringify(a.mismatches));
  ok("…and the journal says so", (await w.storage.get(CASHCAT_TAB_KEYS.journal))[0].adoption?.adopted === true);
  for (const [what, field, mut] of [["another mint", "launch.mint", (d) => { d.launch.mint = SPY.mint; }], ["another pool", "launch.pool", (d) => { d.launch.pool = SPY.mint; }], ["another creator", "launch.creator", (d) => { d.launch.creator = SPY.mint; }],
    ["another launchpad", "launch.launchpad", (d) => { d.launch.launchpad = "pumpfun"; }], ["the reward mode", "launch.mode", (d) => { d.launch.mode = "reward"; }], ["another quote", "token.quote.mint", (d) => { d.token.quote.mint = SPY.mint; }]]) {
    const x = await world({ net: network({ tokens: tokens(mut) }) });
    await seed(x);
    const r = await SC(x).checkAdoption({ mint });
    ok(`not adopted when StonkFun's record names ${what} (${field})`, r.adopted === false && r.mismatches.map((m) => m.what).join() === field);
  }
  const nf = await world({});
  await seed(nf);
  const n = await SC(nf).checkAdoption({ mint });
  ok("StonkFun's recorded 404 (\"No platform pool exists for this mint.\") is \"not adopted yet\", never a failure", NOT_FOUND.status === 404 && n.ok === true && n.adopted === false && n.notFound === true && /not adopted yet/.test(n.why));
  ok("a mint that is not a launched stock cat is refused (not_found)", (await throwsClause(() => SC(nf).checkAdoption({ mint: SPY.mint }), "not_found"))?.clause === "not_found");
}

section("10. NEVER IN AUTO MODE, NEVER A DEV BUY ON STONKFUN, AND THE JOURNAL KEEPS EVERY STOCK CAT");
{
  ok("venue: a venue the tab does not launch on (pump.fun paired with a stock) is refused by name", syncClause(() => venueRun("pumpfun-xstock")) === "venue" && syncClause(() => venueRun("raydium")) === "venue");
  ok("manual_only: StonkFun in auto mode is refused by name; pump.fun's auto mode is not", syncClause(() => venueRun("stonkfun", "auto")) === "manual_only" && syncClause(() => venueRun("pumpfun", "auto")) === "passed");
  ok("no_dev_buy_on_stonkfun: the dev buy refuses every venue but pump.fun", syncClause(() => assertDevBuyVenue("stonkfun")) === "no_dev_buy_on_stonkfun" && syncClause(() => assertDevBuyVenue("pumpfun")) === "passed");
  const probe = network();
  const usable = (await readTrends({ http: probe.http })).usable;
  const proposal = () => ({ skip: false, trend: usable[0].title, name: "Auto Tick Cat", symbol: "AUTOTCAT", tagline: "A cat's calm look at what everyone is searching for.", kitten: "black", background: "mint" });
  const w = await world({ net: network({ proposal }) });
  const d = await PICK(w);
  await SC(w).draft({ pairMint: SPY.mint, idea: d });
  await SC(w).prepare({ pairMint: SPY.mint });
  await w.tab.armAuto({ sentence: autoArmSentence({ wallet: w.WALLET, settings: CASHCAT_TAB_DEFAULTS }) });
  w.T.now += FIRST_AUTO_DELAY_MS;
  const t = await w.tab.autoTick();
  ok("with a stock cat drafted and checked, auto mode's tick launches a pump.fun coin and never a LaunchLab launch", t.ran === true && w.chain.st.sent.length === 1 && w.chain.st.sent.every((s) => s.kind === "create" && s.m.instructions.every((ix) => ix.programId !== LAUNCHLAB_PROGRAM)));
  const old = Date.parse("2026-09-01T00:00:00Z");
  const journal = [...Array.from({ length: 260 }, (_, i) => ({ at: old + i, kind: "refused", clause: "x" })),
    { at: old, kind: "launched", venue: "stonkfun", mint: "A", symbol: "A" }, { at: old, kind: "launched", venue: "pumpfun", mint: "B", symbol: "B" }];
  const kept = trimJournal(journal, Date.parse("2026-09-25T00:00:00Z"));
  ok("a stock cat's launch is never trimmed from the journal (one cat per stock, ever); an old pump.fun launch is", kept.some((e) => e.mint === "A") && !kept.some((e) => e.mint === "B"));
  ok("a stock cat's draft key binds its words, its art, the venue and the pair", stockDraftKey(stockDraft({ name: "A Cat", symbol: "ACAT", tagline: "t", kitten: "black", background: "mint" }, SPY)) !== stockDraftKey(stockDraft({ name: "A Cat", symbol: "ACAT", tagline: "t", kitten: "black", background: "mint" }, PLTR))
    && KITTENS.length * Object.keys(BACKGROUNDS).length === 64);
}

done();
