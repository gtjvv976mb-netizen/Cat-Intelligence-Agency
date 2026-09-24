/**
 * CASHCAT'S STONKFUN LAUNCH AGREES WITH THE CHAIN AND REFUSES WHAT STONKFUN'S API CANNOT PROVE.
 *
 * Against what was read on 2026-09-24 (fixtures/bots/stonkfun/):
 *   · LaunchLab's on-chain IDL: initialize_with_token_2022's discriminator and its fifteen
 *     accounts and five arguments;
 *   · six real StonkFun launches (two paired with xStocks): every account re-derived, flags
 *     included, sixteen of sixteen, and the data re-encoded byte for byte where the launch used
 *     the zero-filled "no transfer fee" tail;
 *   · StonkFun's platform configs on chain (name "StonkFun", creator fee rate 0, launch params
 *     restricted), the SPYx GlobalConfig (quote mint SPYx, constant curve) and the curve rule;
 *   · planStonkfunLaunch against the recorded API answers and accounts, and every tampered
 *     answer refused by name: another platform, another program, a config for another quote, a
 *     curve rule that is not the PDA, a raise that is not a positive integer, vesting, a
 *     different supply, LaunchLab switched off, a pair that is not ready, a quote that is not an
 *     xStock;
 *   · CashCat's own initialize, as simulated on mainnet, rebuilt to the same bytes.
 */
import { createHash } from "node:crypto";
import { Transaction, PublicKey } from "@solana/web3.js";
import { harness, fixture, scriptedFetch, scriptedRpc, response } from "./bots/test/doubles.mjs";
import {
  initializeAccounts, encodeInitialize, decodeInitialize, initializeIx, decodePlatformConfig, decodeGlobalConfig, decodeCurveRule, curveRuleAddress,
  planStonkfunLaunch, resolveQuote, STONKFUN_SHAPE, launchlabAuthority, launchlabEventAuthority,
} from "./bots/cashcat/stonkfun.mjs";
import { IX, LAUNCHLAB_PROGRAM, LAUNCHLAB_AUTHORITY, LAUNCHLAB_EVENT_AUTHORITY, STONKFUN_PLATFORM_STANDARD, STONKFUN_PLATFORM_REWARD, HOSTS, URLS } from "./bots/lib/verified.mjs";
import { createHttp } from "./bots/lib/http.mjs";
import { MAX_LAUNCH_SPEND_LAMPORTS } from "./bots/cashcat/config.mjs";

const { ok, section, throwsClause, done } = harness("test-bots-stonkfun");
const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";

section("LAUNCHLAB'S ON-CHAIN IDL");
const idl = fixture("stonkfun/launchlab-idl-subset.json");
const init = idl.instructions.find((i) => i.name === "initialize_with_token_2022");
ok("initialize_with_token_2022's discriminator is sha256(\"global:initialize_with_token_2022\")[0..8]",
  createHash("sha256").update("global:initialize_with_token_2022").digest().subarray(0, 8).toString("hex") === IX.launchlabInitializeWithToken2022 && Buffer.from(init.discriminator).toString("hex") === IX.launchlabInitializeWithToken2022);
ok("fifteen accounts and five arguments", init.accounts.length === 15 && JSON.stringify(init.args.map((a) => a.name)) === '["base_mint_param","curve_param","vesting_param","amm_fee_on","transfer_fee_extension_param"]');
ok("the authority and event-authority PDAs are verified.mjs's", launchlabAuthority() === LAUNCHLAB_AUTHORITY && launchlabEventAuthority() === LAUNCHLAB_EVENT_AUTHORITY);
ok("the account discriminators verified.mjs pins are the IDL's", idl.accounts.find((a) => a.name === "PlatformConfig").discriminator.join() === "160,78,128,0,248,83,230,160" && idl.accounts.find((a) => a.name === "GlobalConfig").discriminator.join() === "149,8,156,202,160,252,176,217");

section("SIX REAL STONKFUN LAUNCHES");
const launches = fixture("stonkfun/launch-samples.json").launches;
let acc = 0, bytes = 0, zeroTail = 0;
for (const l of launches) {
  const a = l.accounts.map((x) => x.pubkey);
  const mine = initializeAccounts({ payer: a[0], mint: a[6], quoteMint: a[7], quoteTokenProgram: a[11], globalConfig: a[2], platformConfig: a[3], curveRule: a[15] });
  mine[1] = { ...mine[1], isSigner: true, isWritable: true }; // payer and creator are the same wallet, merged in the compiled message
  if (mine.every((m, i) => m.pubkey.toBase58() === l.accounts[i].pubkey && m.isSigner === l.accounts[i].isSigner && m.isWritable === l.accounts[i].isWritable)) acc++;
  const data = Buffer.from(l.dataHex, "hex");
  const d = decodeInitialize(data);
  if (data.subarray(-10).equals(Buffer.alloc(10))) { zeroTail++; if (encodeInitialize({ name: d.name, symbol: d.symbol, uri: d.uri, raiseRaw: d.raiseRaw, cpmmCreatorFeeOn: d.cpmmCreatorFeeOn }).equals(data)) bytes++; }
}
ok(`all ${launches.length} launches' sixteen accounts re-derive, flags included`, acc === launches.length);
ok(`every launch with the zero-filled tail re-encodes byte for byte (${bytes} of ${zeroTail})`, bytes === zeroTail && zeroTail >= 4);
ok("the sixteenth account is the curve rule PDA in every one", launches.every((l) => curveRuleAddress(l.accounts[3].pubkey, l.accounts[2].pubkey) === l.accounts[15].pubkey));
ok("every one used StonkFun's launch shape: 6 decimals, 1e15 supply, 793.1e12 for sale, cpmm, no vesting, no transfer fee",
  launches.every((l) => { const d = decodeInitialize(Buffer.from(l.dataHex, "hex")); return d.decimals === 6 && d.supply === STONKFUN_SHAPE.supply && d.totalSellA === STONKFUN_SHAPE.totalSellA && d.migrateType === 1 && d.vesting.every((v) => v === 0n) && d.transferFeeTag === 0; }));
ok("two of them are paired with xStocks", launches.filter((l) => l.accounts[7].pubkey.startsWith("Xs")).length === 2);

section("THE ACCOUNTS ON CHAIN");
const accounts = fixture("stonkfun/accounts.json").accounts;
const byLabel = (re) => accounts.find((a) => re.test(a.label));
const pStd = decodePlatformConfig(Buffer.from(byLabel(/standard platform/).dataBase64, "base64"));
const pRew = decodePlatformConfig(Buffer.from(byLabel(/reward platform/).dataBase64, "base64"));
ok("both platform configs read name \"StonkFun\", web https://www.stonkfun.xyz", pStd.name === "StonkFun" && pRew.name === "StonkFun" && pStd.web === "https://www.stonkfun.xyz");
ok("creator fee rate 0, platform fee rate 10,000 (1%), launch params restricted", pStd.creatorFeeRate === 0n && pStd.feeRate === 10_000n && pStd.restrictCurveParam === 1);
const cfg = decodeGlobalConfig(Buffer.from(byLabel(/GlobalConfig/).dataBase64, "base64"));
ok("the SPYx GlobalConfig: quote mint SPYx, constant curve", cfg.quoteMint === SPYX && cfg.curveType === 0);
const rule = decodeCurveRule(Buffer.from(byLabel(/curve rule/).dataBase64, "base64"));
ok("the curve rule belongs to StonkFun's standard platform and that config", rule.platformConfig === STONKFUN_PLATFORM_STANDARD && rule.globalConfig === byLabel(/GlobalConfig/).address && rule.groups.length >= 1);

section("PLANNING A LAUNCH FROM STONKFUN'S API, PROVED ON CHAIN");
const api = { stats: fixture("stonkfun/api-stats.json").body, pairs: fixture("stonkfun/api-pairs.json").body, pricing: fixture("stonkfun/api-pricing-spyx.json").body };
function world({ stats = api.stats, pairs = api.pairs, pricing = api.pricing, accountsOverride = null } = {}) {
  const { fetchImpl } = scriptedFetch([
    [URLS.stonkfunStats, () => stats], [URLS.stonkfunPairs, () => pairs], ["https://www.stonkfun.xyz/api/public/v1/launchlab/pricing", () => pricing],
  ]);
  const http = createHttp({ fetchImpl, allowedHosts: Object.values(HOSTS), sleep: async () => {} });
  const all = Object.fromEntries(accounts.map((a) => [a.address, a]));
  const rpc = scriptedRpc({ getMultipleAccounts: ([list]) => ({ value: list.map((k) => { const a = (accountsOverride ?? all)[k]; return a ? { owner: a.owner, lamports: a.lamports ?? 1, data: [a.dataBase64 ?? "", "base64"] } : null; }) }) });
  return { http, rpc };
}
const clone = (o) => JSON.parse(JSON.stringify(o));
{
  const plan = await planStonkfunLaunch({ ...world(), quoteChoice: "SPYx" });
  ok("the plan: SPYx under Token-2022, the SPYx config, the curve rule, the raise the API priced", plan.quote.mint === SPYX && plan.quote.tokenProgram === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
    && plan.globalConfig === api.pricing.data.curve.configId && plan.curveRule === api.pricing.data.curveRule.standard && plan.raiseRaw === BigInt(api.pricing.data.raise.raw) && plan.platformConfig === STONKFUN_PLATFORM_STANDARD);
  const t = (mut) => { const p = clone(api.pricing); mut(p.data); return p; };
  ok("another standard platform id → refused", await throwsClause(() => planStonkfunLaunch({ ...world({ pricing: t((d) => { d.platform.standard = STONKFUN_PLATFORM_REWARD; }) }) }), "platform"));
  ok("another program → refused", await throwsClause(() => planStonkfunLaunch({ ...world({ pricing: t((d) => { d.curve.programId = "11111111111111111111111111111111"; }) }) }), "program"));
  ok("a curve rule that is not the PDA → refused", await throwsClause(() => planStonkfunLaunch({ ...world({ pricing: t((d) => { d.curveRule.standard = STONKFUN_PLATFORM_REWARD; }) }) }), "curve_rule"));
  ok("a raise that is not a positive integer → refused", await throwsClause(() => planStonkfunLaunch({ ...world({ pricing: t((d) => { d.raise.raw = "0"; }) }) }), "raise") && await throwsClause(() => planStonkfunLaunch({ ...world({ pricing: t((d) => { d.raise.raw = "12.5"; }) }) }), "raise"));
  ok("vesting or another supply → refused", await throwsClause(() => planStonkfunLaunch({ ...world({ pricing: t((d) => { d.curve.vesting.totalLockedAmount = "1"; }) }) }), "shape") && await throwsClause(() => planStonkfunLaunch({ ...world({ pricing: t((d) => { d.curve.supply = "2000000000000000"; }) }) }), "shape"));
  const otherConfig = launches.find((l) => l.accounts[7].pubkey !== SPYX).accounts[2].pubkey;
  const bogus = t((d) => { d.curve.configId = otherConfig; d.curveRule.standard = curveRuleAddress(STONKFUN_PLATFORM_STANDARD, otherConfig); });
  const accs = Object.fromEntries(accounts.map((a) => [a.address, a]));
  const cfgBytes = Buffer.from(byLabel(/GlobalConfig/).dataBase64, "base64");
  const wrongQuote = Buffer.from(cfgBytes); wrongQuote.set(new PublicKey(STONKFUN_PLATFORM_REWARD).toBuffer(), 8 + 8 + 1 + 2 + 8 * 8); // quote_mint field
  accs[otherConfig] = { owner: LAUNCHLAB_PROGRAM, dataBase64: wrongQuote.toString("base64") };
  accs[curveRuleAddress(STONKFUN_PLATFORM_STANDARD, otherConfig)] = byLabel(/curve rule/);
  ok("a config whose on-chain quote is not the stock → refused", await throwsClause(() => planStonkfunLaunch({ ...world({ pricing: bogus, accountsOverride: accs }) }), "config"));
  ok("a curve rule on chain for another config → refused", await throwsClause(() => planStonkfunLaunch({ ...world({ pricing: t((d) => { d.curve.configId = otherConfig; d.curveRule.standard = curveRuleAddress(STONKFUN_PLATFORM_STANDARD, otherConfig); }), accountsOverride: { ...accs, [otherConfig]: byLabel(/GlobalConfig/) } }) }), "curve_rule"));
  const off = clone(api.stats); off.data.config.launchLabEnabled = false;
  ok("LaunchLab switched off in StonkFun's stats → refused", await throwsClause(() => planStonkfunLaunch({ ...world({ stats: off }) }), "launchlab_off"));
  const notReady = clone(api.pairs); notReady.data.pairs = notReady.data.pairs.map((p) => (p.mint === SPYX ? { ...p, launchLabReady: false } : p));
  ok("a pair that is not LaunchLab-ready → refused", await throwsClause(() => planStonkfunLaunch({ ...world({ pairs: notReady }) }), "pair_not_ready"));
  ok("a quote that is not on the official xStock list → refused", await throwsClause(() => planStonkfunLaunch({ ...world(), quoteChoice: "BONK" }), "quote_not_xstock"));
  ok("the quote may be named by symbol, any case, or by mint", resolveQuote("spyx").mint === SPYX && resolveQuote(SPYX).symbol === "SPYx");
}

section("CASHCAT'S OWN INITIALIZE, AS SIMULATED ON MAINNET");
{
  const s = fixture("stonkfun/simulate-initialize.json");
  const orig = Transaction.from(Buffer.from(s.transactionBase64, "base64"));
  const tx = new Transaction({ feePayer: new PublicKey(s.payer), recentBlockhash: orig.recentBlockhash });
  tx.add(orig.instructions[0], orig.instructions[1], initializeIx({ payer: s.payer, mint: s.mint, quoteMint: s.plan.quote.mint, quoteTokenProgram: s.plan.quote.tokenProgram, globalConfig: s.plan.globalConfig, curveRule: s.plan.curveRule, ...s.coin, raiseRaw: BigInt(s.plan.raiseRaw), cpmmCreatorFeeOn: s.plan.cpmmCreatorFeeOn }));
  ok("rebuilt from the recorded plan, the message is the simulated one, byte for byte", tx.serializeMessage().equals(orig.serializeMessage()));
  ok("the simulation succeeded, logged InitializeWithToken2022, and spent inside the budget",
    s.result.err === null && s.result.logs.some((l) => l.includes("Instruction: InitializeWithToken2022")) && s.result.payerBefore - s.result.payerAfter <= MAX_LAUNCH_SPEND_LAMPORTS.stonkfun, `${s.result.payerBefore - s.result.payerAfter} lamports, ${s.result.unitsConsumed} units`);
}

done();
