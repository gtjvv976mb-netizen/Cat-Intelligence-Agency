/**
 * EVERYTHING THE BOTS RELY ON THAT CAME OFF A LIVE SYSTEM, AND WHERE AND WHEN IT WAS READ.
 *
 * Nothing in this file is recalled or guessed. Each constant below was read off mainnet or a
 * live API on 2026-09-24 (UTC) from this repository's build machine, and the answers the
 * tests replay are recorded under fixtures/bots/. A constant that stops being true breaks a
 * launch at the pre-sign check or at the simulation, never after a signature: the bots
 * re-read every account they build against before they sign (see pumpfun.mjs, stonkfun.mjs).
 *
 * ══ WHAT WAS READ OFF THE LIVE CHAIN ON 2026-09-24 ═════════════════════════════════════════
 *
 *  · pump.fun's program 6EF8rre…F6P publishes its Anchor IDL on chain, in the account
 *    AYgC53tU5BbP2NAnv5nConJxAdpQZctvmZK88pu69xRs (= createWithSeed(PDA([], program),
 *    "anchor:idl", program), derived and read at slot ~450,136,000 through
 *    https://api.mainnet-beta.solana.com, 18,938 bytes, zlib). It differs from the copy the
 *    executor vendored on 2026-09-11: create_v2 now takes eight arguments (name, symbol, uri,
 *    creator, is_mayhem_mode, is_cashback_enabled, creator_fee_bps, is_holder_reward) and
 *    still sixteen accounts. The instructions the bots use are kept in
 *    fixtures/bots/pumpfun/idl-subset.json.
 *  · Eleven real create_v2 transactions from the newest coins pump.fun listed that minute
 *    were decoded; every one of their sixteen accounts re-derives from (mint, user) with the
 *    seeds below, 176 of 176 (fixtures/bots/pumpfun/create-v2-samples.json). The
 *    mayhem_token_vault the IDL leaves without seeds is ATA(sol_vault, Token-2022, mint).
 *  · pump.fun's Global account 4wTV1Ymi…jf (1,087 bytes) decodes with the live IDL to:
 *    create_v2_enabled 1, initial virtual reserves 1,073,000,000,000,000 tokens / 30 SOL,
 *    initial real tokens 793,100,000,000,000, creator_fee_configurable 1,
 *    max_configurable_creator_fee_bps 300 (fixtures/bots/pumpfun/global.json).
 *  · A real collect_creator_fee (tx 2fktoQzW…Yficq, slot 449,937,368): five accounts —
 *    creator, creator_vault = PDA(["creator-vault", creator]), system, event authority,
 *    program — signed by the creator alone, and the creator's balance rose by the vault's
 *    lamports (fixtures/bots/pumpfun/collect-creator-fee.json).
 *  · Raydium LaunchLab LanMV9s…3uj publishes its IDL on chain too, in
 *    E6wT2uNeoWUvDrwdch1R8ETsyewR1ZM4WAwsa5hLJK5Z (14,688 bytes; "raydium_launchpad" 0.2.0).
 *  · StonkFun's two LaunchLab platform configs decode (944 bytes each, discriminator
 *    PlatformConfig) with name "StonkFun" and web https://www.stonkfun.xyz, platform fee
 *    rate 10,000 (1%), creator_fee_rate 0, restrict_curve_param 1, and they are the two ids
 *    StonkFun's own pricing endpoint names (fixtures/bots/stonkfun/).
 *  · Real StonkFun launches (initialize_with_token_2022, e.g. 4wACyqyi…R7AU, slot
 *    450,137,208) carry fifteen IDL accounts plus a sixteenth: the platform curve rule
 *    PDA(["platform_curve_rule", platform_config, global_config]), re-derived exactly.
 *
 *  · CashCat's OWN transactions were simulated on mainnet (simulateTransaction, sigVerify off,
 *    a funded third-party address as the payer and an unused mint address; nothing was signed
 *    or sent), each without error: pump.fun create_v2 (94,684 units, 0.0055497 SOL of rent and
 *    fees), pump.fun create_v2 quoted in SPYx through Custom Pairs (131,593 units, 0.00711 SOL),
 *    and StonkFun's initialize_with_token_2022 paired with SPYx (98,816 units, 0.0086739 SOL).
 *    The transactions and results are in fixtures/bots/pumpfun/ and fixtures/bots/stonkfun/.
 *  · The public mainnet endpoint answered getTokenLargestAccounts with 429 ("too many requests
 *    for a specific RPC call") all day, and a second public endpoint asked for a personal
 *    token; getProgramAccounts on the token program with a mint filter and a 40-byte slice
 *    answered, so that is how Popcat reads holders.
 *
 * ══ WHAT WAS READ OFF LIVE APIS ON 2026-09-24 ══════════════════════════════════════════════
 *
 *  · StonkFun documents building a launch yourself on https://www.stonkfun.xyz/developers
 *    (read live): GET /api/public/v1/pairs?launchable=true&launchLabReady=true, then
 *    GET /api/public/v1/launchlab/pricing?quoteMint=… for configId, supply, totalSellA and the
 *    raw raise; initialize_with_token_2022 at 6 decimals, a constant curve migrating to
 *    cpmm, no transfer-fee extension for a standard launch, the standard platform id, and the
 *    curve-rule account appended last, read-only. /api/public/v1/stats answered
 *    launchLabEnabled: true, paidLaunchesEnabled: false.
 *  · pump.fun: frontend-api-v3.pump.fun/coins (sort=created_timestamp and
 *    sort=last_trade_timestamp, 200; about 27 new coins a minute that evening) and
 *    /coins-v2/user-created-coins/{creator} (200) answer without a key.
 *    frontend-api-v3.pump.fun/metas/current answered 404, so pump.fun "metas" are NOT a
 *    trend source here. pump.fun's own metadata JSON shape ({ name, symbol, description,
 *    image, showName, createdOn: "https://pump.fun", twitter?, telegram?, website? }) and
 *    its metadata URI form (https://ipfs.io/ipfs/<cid>) were read from pump.fun's live
 *    frontend code; its old upload endpoint pump.fun/api/ipfs is documented as no longer
 *    supported (PumpPortal's docs, read live), so metadata goes to Pinata (below).
 *  · Pinata: POST https://uploads.pinata.cloud/v3/files answered 401 without a key (the
 *    endpoint is there); its documented form is multipart { file, network: "public",
 *    name } with Authorization: Bearer <JWT>, answering { data: { cid, … } }. A launch
 *    reads the metadata back through https://gateway.pinata.cloud/ipfs/<cid> (it served a
 *    real pump.fun metadata document that minute) before anything is built. pump.fun's own
 *    gateway, pump.mypinata.cloud, served some CIDs and answered 403 for others, so Popcat
 *    tries it first and Pinata's public gateway second.
 *  · Trend sources that answered: https://trends.google.com/trending/rss?geo=US (RSS 2.0,
 *    items with ht:approx_traffic and ht:news_item_title) and
 *    https://api.coingecko.com/api/v3/search/trending ({ coins, nfts, categories }).
 *  · Jupiter: https://lite-api.jup.ag/tokens/v2/tag?query=verified (3,692 tokens) and
 *    /tokens/v2/search?query=… (isVerified, tags) answered without a key.
 */

export const LIVE_READ_DATE = "2026-09-24";

/* ── programs ─────────────────────────────────────────────────────────────────────────── */
export const PUMPFUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMPFUN_IDL_ACCOUNT = "AYgC53tU5BbP2NAnv5nConJxAdpQZctvmZK88pu69xRs";
export const PUMPFUN_GLOBAL = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf";
export const PUMPFUN_MINT_AUTHORITY = "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM";
export const PUMPFUN_EVENT_AUTHORITY = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
/** The mayhem program create_v2 names as a fixed account (writable, per the IDL and the tape). */
export const PUMPFUN_MAYHEM_PROGRAM = "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e";
export const PUMPFUN_MAYHEM_GLOBAL_PARAMS = "13ec7XdrjF3h3YcqBTFDSReRcUFwbCnJaAQspM4j6DDJ";
export const PUMPFUN_MAYHEM_SOL_VAULT = "BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s";

export const LAUNCHLAB_PROGRAM = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
export const LAUNCHLAB_IDL_ACCOUNT = "E6wT2uNeoWUvDrwdch1R8ETsyewR1ZM4WAwsa5hLJK5Z";
/** PDA(["vault_auth_seed"], LaunchLab): the pool and mint authority. Re-derived in tests. */
export const LAUNCHLAB_AUTHORITY = "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh";
export const LAUNCHLAB_EVENT_AUTHORITY = "2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr";

export const STONKFUN_PLATFORM_STANDARD = "4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7";
/** The reward (transfer-taxed) platform. CashCat never uses it: a taxed coin is not what the owner asked for. */
export const STONKFUN_PLATFORM_REWARD = "6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt";
export const STONKFUN_PLATFORM_NAME = "StonkFun";
export const STONKFUN_PLATFORM_WEB = "https://www.stonkfun.xyz";

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/* ── instruction discriminators: sha256("global:<name>")[0..8], equal to the live IDL's ── */
export const IX = Object.freeze({
  pumpCreateV2: "d6904cec5f8b31b4",              // [214,144,76,236,95,139,49,180]
  pumpCollectCreatorFee: "1416567bc61cdb84",     // [20,22,86,123,198,28,219,132]
  pumpBuyV2: "b817ee6167c5d33d",
  launchlabInitializeWithToken2022: "25be7ede2c9aab11", // [37,190,126,222,44,154,171,17]
});

/* ── account discriminators: sha256("account:<Name>")[0..8] ───────────────────────────── */
export const ACCOUNT_DISC = Object.freeze({
  pumpGlobal: "a7e8e8b1c86c727f",
  pumpBondingCurve: "17b7f83760d8ac60",
  launchlabGlobalConfig: "95089ccaa0fcb0d9",      // [149,8,156,202,160,252,176,217]
  launchlabPlatformConfig: "a04e8000f853e6a0",    // [160,78,128,0,248,83,230,160]
  launchlabPlatformCurveRule: "0c147aa9f79b68ea", // [12,20,122,169,247,155,104,234]
});

/* ── hosts the bots may call. A request to any other host is refused in http.mjs. ─────── */
export const HOSTS = Object.freeze({
  anthropic: "api.anthropic.com",
  pumpApi: "frontend-api-v3.pump.fun",
  pumpGateway: "pump.mypinata.cloud",
  pinataUpload: "uploads.pinata.cloud",
  pinataGateway: "gateway.pinata.cloud",
  stonkfun: "www.stonkfun.xyz",
  googleTrends: "trends.google.com",
  coingecko: "api.coingecko.com",
  jupiter: "lite-api.jup.ag",
  githubApi: "api.github.com",
});

export const URLS = Object.freeze({
  googleTrendsRss: (geo = "US") => `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`,
  coingeckoTrending: "https://api.coingecko.com/api/v3/search/trending",
  jupiterVerified: "https://lite-api.jup.ag/tokens/v2/tag?query=verified",
  jupiterSearch: (q) => `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(q)}`,
  pumpNewestCoins: (limit = 50) => `https://frontend-api-v3.pump.fun/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`,
  /** The same listing ordered by the latest trade: coins being traded right now, of any age. */
  pumpActiveCoins: (limit = 50) => `https://frontend-api-v3.pump.fun/coins?offset=0&limit=${limit}&sort=last_trade_timestamp&order=DESC&includeNsfw=false`,
  pumpCreatedCoins: (creator) => `https://frontend-api-v3.pump.fun/coins-v2/user-created-coins/${creator}?limit=50&offset=0`,
  pinataUpload: "https://uploads.pinata.cloud/v3/files",
  pinataGateway: (cid) => `https://gateway.pinata.cloud/ipfs/${cid}`,
  /** pump.fun's own gateway, which served pump.fun metadata on the day this was read. */
  pumpGateway: (cid) => `https://pump.mypinata.cloud/ipfs/${cid}`,
  stonkfunPairs: "https://www.stonkfun.xyz/api/public/v1/pairs?launchable=true&launchLabReady=true",
  stonkfunPricing: (quoteMint) => `https://www.stonkfun.xyz/api/public/v1/launchlab/pricing?quoteMint=${quoteMint}`,
  stonkfunStats: "https://www.stonkfun.xyz/api/public/v1/stats",
  stonkfunToken: (mint) => `https://www.stonkfun.xyz/api/public/v1/tokens/${mint}`,
});

/** The on-chain URI pump.fun's own frontend writes for a pinned CID (read from its live code). */
export const pumpMetadataUri = (cid) => `https://ipfs.io/ipfs/${cid}`;
/** The URI CashCat writes for a StonkFun launch: a gateway StonkFun's indexer resolved that day
 *  (the live VOLTAGENT launch, metadata on gateway.pinata.cloud, was adopted with its image). */
export const stonkfunMetadataUri = (cid) => `https://gateway.pinata.cloud/ipfs/${cid}`;

/** Public pages the site links to, built from a validated address only. */
export const PAGES = Object.freeze({
  pumpCoin: (mint) => `https://pump.fun/coin/${mint}`,
  stonkfunToken: (mint) => `https://www.stonkfun.xyz/token/${mint}`,
  solscanTx: (sig) => `https://solscan.io/tx/${sig}`,
  solscanAccount: (a) => `https://solscan.io/account/${a}`,
});

/** The agency's floor, where every CashCat launch is listed: the website field of its metadata. */
export const AGENCY_FLOOR_URL = "https://catintelligenceagency.com/floor/";
