/**
 * STONKFUN: A LAUNCH ON RAYDIUM LAUNCHLAB, ATTRIBUTED TO STONKFUN, PAIRED WITH A TOKENISED STOCK.
 *
 * StonkFun documents this exact path on https://www.stonkfun.xyz/developers ("Building it
 * yourself", read live 2026-09-24): read GET /api/public/v1/pairs for the quote, read GET
 * /api/public/v1/launchlab/pricing for the numbers, and send your own
 * initialize_with_token_2022 with StonkFun's standard platform id and its curve-rule
 * account appended last. StonkFun then "adopts" the pool within a minute or two. There is no
 * launch fee on this path; the wallet pays rent and network fees only.
 *
 * NOTHING FROM THE API IS SIGNED ON TRUST. Every number the pricing endpoint returns is
 * checked before it goes into the instruction:
 *   · programId must be LaunchLab and platform.standard must be the pinned StonkFun platform
 *     (whose on-chain PlatformConfig must still read name "StonkFun");
 *   · configId must be a LaunchLab GlobalConfig ON CHAIN whose quote_mint is the chosen quote
 *     and whose curve_type is 0 (constant product);
 *   · curveRule.standard must equal PDA(["platform_curve_rule", platform, configId]) and exist
 *     on chain as a PlatformCurveRule for that platform and that config;
 *   · the quote must be an xStock on the official product list (src/lib/config.mjs
 *     XSTOCK_BUILTIN for the bot; STONKFUN_XSTOCKS, passed as `quoteList`, for the extension's
 *     stock cats), listed by /pairs as launchable and LaunchLab-ready, and its mint's
 *     owner is read on chain (Token-2022 for every xStock) and used as the quote token program;
 *   · supply, totalSellA and baseDecimals must be the values every sampled StonkFun launch
 *     used (1e15, 793.1e12, 6), and the raise must be a positive integer.
 * Then the transaction is simulated, and checked, before anything is signed.
 *
 * CREATOR FEES: none to claim. StonkFun's platform configs carry creator_fee_rate 0 on
 * chain; StonkFun says on its developer page that it forwards the creator's share of its 1%
 * platform fee to the pool creator off chain. That is StonkFun's promise, not something this
 * bot can verify or claim, and the README says so. No dev buy is ever made here: a dev buy
 * would be paid in the stock.
 *
 * initialize_with_token_2022, fifteen IDL accounts plus the curve rule (flags as in every
 * real StonkFun launch sampled; payer and creator are the same wallet, so they merge):
 *   0 payer (signer, writable)  1 creator  2 global_config  3 platform_config
 *   4 authority = PDA ["vault_auth_seed"]  5 pool_state = PDA ["pool", base_mint, quote_mint] (w)
 *   6 base_mint (signer, writable)  7 quote_mint  8 base_vault = PDA ["pool_vault", pool, base] (w)
 *   9 quote_vault = PDA ["pool_vault", pool, quote] (w)  10 Token-2022  11 the quote's token program
 *  12 system  13 event_authority = PDA ["__event_authority"]  14 program  15 platform curve rule
 */
import {
  LAUNCHLAB_PROGRAM, STONKFUN_PLATFORM_STANDARD, STONKFUN_PLATFORM_NAME, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM,
  IX, ACCOUNT_DISC, URLS,
} from "../lib/verified.mjs";
import { pda, meta, instruction, u8, u64, str, reader, address } from "../lib/solana.mjs";
import { XSTOCK_BUILTIN } from "../../src/lib/config.mjs";

/** The launch shape every sampled StonkFun launch used, and the pricing endpoint returned. */
export const STONKFUN_SHAPE = Object.freeze({ baseDecimals: 6, supply: 1_000_000_000_000_000n, totalSellA: 793_100_000_000_000n, migrateType: 1 /* cpmm */, curveVariant: 0 /* constant */ });

export class StonkfunError extends Error {
  constructor(clause, message) { super(message); this.name = "StonkfunError"; this.clause = clause; }
}
const refuse = (clause, message) => { throw new StonkfunError(clause, message); };

export const launchlabAuthority = () => pda([{ utf8: "vault_auth_seed" }], LAUNCHLAB_PROGRAM);
export const launchlabEventAuthority = () => pda([{ utf8: "__event_authority" }], LAUNCHLAB_PROGRAM);
export const poolState = (baseMint, quoteMint) => pda([{ utf8: "pool" }, { key: baseMint }, { key: quoteMint }], LAUNCHLAB_PROGRAM);
export const poolVault = (pool, mint) => pda([{ utf8: "pool_vault" }, { key: pool }, { key: mint }], LAUNCHLAB_PROGRAM);
export const curveRuleAddress = (platform, globalConfig) => pda([{ utf8: "platform_curve_rule" }, { key: platform }, { key: globalConfig }], LAUNCHLAB_PROGRAM);

/* ── on-chain account decoders (layouts from the live LaunchLab IDL) ──────────────────── */

export function decodePlatformConfig(data) {
  const b = Buffer.from(data);
  if (b.subarray(0, 8).toString("hex") !== ACCOUNT_DISC.launchlabPlatformConfig) refuse("platform_config", "not a LaunchLab PlatformConfig");
  const r = reader(b, 8);
  const cleanStr = (n) => r.bytes(n).toString("utf8").replace(/\0+$/, "");
  const out = { epoch: r.u64(), platformFeeWallet: r.key(), platformNftWallet: r.key(), platformScale: r.u64(), creatorScale: r.u64(), burnScale: r.u64(), feeRate: r.u64(),
    name: cleanStr(64), web: cleanStr(256), img: cleanStr(256), cpswapConfig: r.key(), creatorFeeRate: r.u64(), transferFeeExtensionAuth: r.key(),
    platformVestingWallet: r.key(), platformVestingScale: r.u64(), platformCpCreator: r.key(), restrictGlobalConfig: r.u8(), restrictCurveParam: r.u8(), curveRuleManager: r.key() };
  return out;
}

export function decodeGlobalConfig(data) {
  const b = Buffer.from(data);
  if (b.subarray(0, 8).toString("hex") !== ACCOUNT_DISC.launchlabGlobalConfig) refuse("global_config", "not a LaunchLab GlobalConfig");
  const r = reader(b, 8);
  return { epoch: r.u64(), curveType: r.u8(), index: r.u16(), migrateFee: r.u64(), tradeFeeRate: r.u64(), maxShareFeeRate: r.u64(), minBaseSupply: r.u64(),
    maxLockRate: r.u64(), minBaseSellRate: r.u64(), minBaseMigrateRate: r.u64(), minQuoteFundRaising: r.u64(), quoteMint: r.key(),
    protocolFeeOwner: r.key(), migrateFeeOwner: r.key(), migrateToAmmWallet: r.key(), migrateToCpswapWallet: r.key() };
}

export function decodeCurveRule(data) {
  const b = Buffer.from(data);
  if (b.subarray(0, 8).toString("hex") !== ACCOUNT_DISC.launchlabPlatformCurveRule) refuse("curve_rule", "not a LaunchLab PlatformCurveRule");
  const r = reader(b, 8);
  const bump = r.u8(), version = r.u8(), platformConfig = r.key(), globalConfig = r.key(), epoch = r.u64();
  r.bytes(64);
  const n = r.u32(); const groups = [];
  for (let i = 0; i < n; i++) {
    const groupId = r.u16(), gEpoch = r.u64(), nc = r.u32(), constraints = [];
    for (let c = 0; c < nc; c++) constraints.push({ field: r.u8(), op: r.u8(), value: r.u128() });
    groups.push({ groupId, epoch: gEpoch, constraints });
  }
  return { bump, version, platformConfig, globalConfig, epoch, groups };
}

/* ── the instruction ──────────────────────────────────────────────────────────────────── */

export function encodeInitialize({ name, symbol, uri, raiseRaw, shape = STONKFUN_SHAPE, cpmmCreatorFeeOn = 0 }) {
  if (Buffer.byteLength(name) > 32 || Buffer.byteLength(symbol) > 10 || Buffer.byteLength(uri) > 200) refuse("too_long", "name, symbol or uri is too long");
  const raise = BigInt(raiseRaw);
  if (raise <= 0n) refuse("raise", "the raise must be positive");
  return Buffer.concat([
    Buffer.from(IX.launchlabInitializeWithToken2022, "hex"),
    u8(shape.baseDecimals), str(name), str(symbol), str(uri),                       // MintParams
    u8(shape.curveVariant), u64(shape.supply), u64(shape.totalSellA), u64(raise), u8(shape.migrateType), // CurveParams::Constant
    u64(0), u64(0), u64(0),                                                          // VestingParams: none
    u8(cpmmCreatorFeeOn),                                                            // AmmCreatorFeeOn
    /* transfer_fee_extension_param: None — the tag 0 and then ten zero bytes, the fixed-size
       form a real StonkFun launch sent (4Q6JhGwz…mPc); the program reads the tag and ignores
       the rest, and the test re-encodes that launch byte for byte. */
    u8(0), Buffer.alloc(10),
  ]);
}

export function decodeInitialize(data) {
  const d = Buffer.from(data);
  if (d.subarray(0, 8).toString("hex") !== IX.launchlabInitializeWithToken2022) refuse("decode", "not initialize_with_token_2022");
  const r = reader(d, 8);
  const out = { decimals: r.u8(), name: r.str(), symbol: r.str(), uri: r.str(), curveVariant: r.u8() };
  out.supply = r.u64(); out.totalSellA = r.u64();
  if (out.curveVariant === 0) out.raiseRaw = r.u64();
  else refuse("decode", `curve variant ${out.curveVariant} is not the constant curve`);
  out.migrateType = r.u8();
  out.vesting = [r.u64(), r.u64(), r.u64()];
  out.cpmmCreatorFeeOn = r.u8();
  out.transferFeeTag = r.rest().length ? r.u8() : 0;
  return out;
}

export function initializeAccounts({ payer, mint, quoteMint, quoteTokenProgram, globalConfig, platformConfig = STONKFUN_PLATFORM_STANDARD, curveRule }) {
  const pool = poolState(mint, quoteMint);
  return [
    meta(payer, true, true),
    meta(payer),
    meta(globalConfig),
    meta(platformConfig),
    meta(launchlabAuthority()),
    meta(pool, true),
    meta(mint, true, true),
    meta(quoteMint),
    meta(poolVault(pool, mint), true),
    meta(poolVault(pool, quoteMint), true),
    meta(TOKEN_2022_PROGRAM),
    meta(quoteTokenProgram),
    meta(SYSTEM_PROGRAM),
    meta(launchlabEventAuthority()),
    meta(LAUNCHLAB_PROGRAM),
    meta(curveRule),
  ];
}

export function initializeIx(args) {
  return instruction(LAUNCHLAB_PROGRAM, initializeAccounts(args), encodeInitialize(args));
}

/* ── choosing and verifying the quote and the numbers ─────────────────────────────────── */

/**
 * The xStock a launch pairs with: named by symbol or mint, and on the official list. `list` is
 * the bot's XSTOCK_BUILTIN by default (its behaviour is unchanged); the extension's stock cats
 * pass STONKFUN_XSTOCKS, the fifteen plus the nine more StonkFun lists as ready (config.mjs).
 */
export function resolveQuote(choice = "SPYx", list = XSTOCK_BUILTIN) {
  const c = String(choice).trim();
  const hit = list.find((x) => x.mint === c || x.symbol.toLowerCase() === c.toLowerCase());
  if (!hit) refuse("quote_not_xstock", list === XSTOCK_BUILTIN
    ? `CASHCAT_STONKFUN_QUOTE "${c}" is not an xStock on the official product list (src/lib/config.mjs)`
    : `"${c}" is not one of the xStocks a stock cat may pair with (src/lib/config.mjs STONKFUN_XSTOCKS)`);
  return hit;
}

/**
 * Read StonkFun's pairs and pricing, then prove every number against the chain. Returns the
 * plan the instruction is built from, or throws StonkfunError naming the first check that failed.
 * The plan carries the stock's mint account as it was read (`quoteMintAccount`), so a caller can
 * hold the stock itself to more checks (the extension's stock cats: quoteRefusals in
 * src/lib/stockcats.mjs) on the very bytes the plan was proved against, with no second read.
 */
export async function planStonkfunLaunch({ http, rpc, quoteChoice = "SPYx", quoteList = XSTOCK_BUILTIN }) {
  const quote = resolveQuote(quoteChoice, quoteList);
  const stats = (await http.json(URLS.stonkfunStats))?.data?.config;
  if (!stats || stats.launchLabEnabled !== true) refuse("launchlab_off", "StonkFun's stats say LaunchLab launches are not enabled right now");
  const pairs = (await http.json(URLS.stonkfunPairs))?.data?.pairs;
  if (!Array.isArray(pairs)) refuse("pairs", "StonkFun's /pairs answer has no pairs list");
  const pair = pairs.find((p) => p && p.mint === quote.mint);
  if (!pair || pair.launchable !== true || pair.launchLabReady !== true) refuse("pair_not_ready", `${quote.symbol} is not launchable and LaunchLab-ready on StonkFun right now`);
  const pricing = (await http.json(URLS.stonkfunPricing(quote.mint)))?.data;
  if (!pricing?.curve || !pricing?.platform || !pricing?.curveRule || !pricing?.raise) refuse("pricing", "StonkFun's pricing answer is missing a part");
  const c = pricing.curve;
  if (c.programId !== LAUNCHLAB_PROGRAM) refuse("program", "pricing names a program that is not LaunchLab");
  if (pricing.platform.standard !== STONKFUN_PLATFORM_STANDARD) refuse("platform", "pricing names a standard platform that is not the pinned StonkFun platform");
  if (c.curveType !== "ConstantCurve" || c.migrateType !== "cpmm") refuse("shape", "pricing is not a constant curve migrating to cpmm");
  if (Number(c.baseDecimals) !== STONKFUN_SHAPE.baseDecimals || BigInt(c.supply) !== STONKFUN_SHAPE.supply || BigInt(c.totalSellA) !== STONKFUN_SHAPE.totalSellA)
    refuse("shape", "pricing's supply, sell amount or decimals differ from every sampled StonkFun launch");
  const vest = c.vesting ?? {};
  if ([vest.totalLockedAmount, vest.cliffPeriod, vest.unlockPeriod].some((v) => String(v) !== "0")) refuse("shape", "pricing asks for vesting");
  if (!/^\d{1,20}$/.test(String(pricing.raise.raw)) || BigInt(pricing.raise.raw) <= 0n) refuse("raise", "pricing's raise is not a positive integer");
  const configId = address(c.configId);
  if (!configId) refuse("config", "pricing's configId is not an address");
  const expectedRule = curveRuleAddress(STONKFUN_PLATFORM_STANDARD, configId);
  if (pricing.curveRule.standard !== expectedRule) refuse("curve_rule", "pricing's curve rule is not PDA(platform_curve_rule, platform, config)");

  const [platformAcc, configAcc, ruleAcc, quoteMintAcc] = await rpc.getMultipleAccounts([STONKFUN_PLATFORM_STANDARD, configId, expectedRule, quote.mint]);
  for (const [acc, what] of [[platformAcc, "platform config"], [configAcc, "global config"], [ruleAcc, "curve rule"]])
    if (!acc || acc.owner !== LAUNCHLAB_PROGRAM) refuse("chain", `the ${what} is not a LaunchLab account on chain`);
  const platform = decodePlatformConfig(platformAcc.data);
  if (platform.name !== STONKFUN_PLATFORM_NAME) refuse("platform", `the platform config's on-chain name is "${platform.name}"`);
  const config = decodeGlobalConfig(configAcc.data);
  if (config.quoteMint !== quote.mint) refuse("config", "the global config's on-chain quote mint is not the chosen stock");
  if (config.curveType !== 0) refuse("config", "the global config is not a constant-product curve");
  const rule = decodeCurveRule(ruleAcc.data);
  if (rule.platformConfig !== STONKFUN_PLATFORM_STANDARD || rule.globalConfig !== configId) refuse("curve_rule", "the curve rule on chain belongs to another platform or config");
  if (!quoteMintAcc || (quoteMintAcc.owner !== TOKEN_2022_PROGRAM && quoteMintAcc.owner !== TOKEN_PROGRAM)) refuse("quote_mint", "the stock's mint is not a token mint on chain");

  return Object.freeze({
    quote: { symbol: quote.symbol, mint: quote.mint, tokenProgram: quoteMintAcc.owner, name: quote.name },
    globalConfig: configId, platformConfig: STONKFUN_PLATFORM_STANDARD, curveRule: expectedRule,
    raiseRaw: BigInt(pricing.raise.raw), cpmmCreatorFeeOn: Number(c.cpmmCreatorFeeOn) === 1 ? 1 : 0,
    platform: { feeRate: platform.feeRate, creatorFeeRate: platform.creatorFeeRate },
    marketCap: { startUsd: Number(pricing.marketCap?.startUsd) || null, graduationUsd: Number(pricing.marketCap?.graduationUsd) || null },
    pricedAt: String(pricing.prices?.observedAt ?? ""),
    quoteMintAccount: Object.freeze({ owner: quoteMintAcc.owner, lamports: quoteMintAcc.lamports ?? null, data: Buffer.from(quoteMintAcc.data) }),
  });
}
