/**
 * CASHCAT'S SWITCHES AND CAPS, READ FROM THE ENVIRONMENT (repository variables and secrets in
 * the workflow). Every number is parsed strictly and fenced: a value outside its fence is an
 * error that stops the run, never a silently clamped surprise.
 *
 *   CASHCAT_LIVE=1                  the only way to launch for real (anything else: dry run)
 *   CASHCAT_WALLET_SECRET           secret: CashCat's own wallet (never the owner's main wallet)
 *   CASHCAT_WALLET_ADDRESS          variable: that wallet's public address — required live, and
 *                                   Popcat reads it to never call out CashCat's coins
 *   SOLANA_RPC_URL                  secret: the owner's RPC; required live (the public endpoint
 *                                   is used for dry-run reads and simulations only)
 *   ANTHROPIC_API_KEY               secret: required live (the model proposes and reviews)
 *   PINATA_JWT                      secret: required live (the metadata is pinned on IPFS)
 *   CASHCAT_MAX_LAUNCHES_PER_DAY    default 2, 1 to 6 (UTC days)
 *   CASHCAT_MIN_BALANCE_SOL         default 0.05, at least 0.02: never launch below it
 *   CASHCAT_DEV_BUY_SOL             default 0, at most 0.05 (pump.fun only; disclosed on the site)
 *   CASHCAT_VENUES                  default "pumpfun,stonkfun"; also "pumpfun-xstock"
 *   CASHCAT_STONKFUN_QUOTE          default "SPYx": the xStock a StonkFun coin is paired with
 *   CASHCAT_PUMP_XSTOCK_QUOTE       default "SPYx": the xStock a pump.fun Custom Pairs coin is quoted in
 *   CASHCAT_PRIORITY_MICROLAMPORTS  default 10000, at most 200000
 *   CASHCAT_COLLECT_FEES_MIN_SOL    default 0.01: claim pump.fun creator fees once the vault holds this
 *   CASHCAT_MODEL                   variable: a model id the key lists (else the first listed)
 */
import { PUBLIC_RPC } from "../lib/rpc.mjs";

export const VENUES = Object.freeze(["pumpfun", "stonkfun", "pumpfun-xstock"]);

export const CASHCAT_DEFAULTS = Object.freeze({
  maxLaunchesPerDay: 2,
  maxLaunchesPerRun: 1,
  minBalanceSol: 0.05,
  devBuySol: 0,
  venues: Object.freeze(["pumpfun", "stonkfun"]),
  stonkfunQuote: "SPYx",
  pumpXstockQuote: "SPYx",
  priorityMicroLamports: 10_000,
  collectFeesMinSol: 0.01,
});

export const FENCES = Object.freeze({
  maxLaunchesPerDay: [1, 6],
  minBalanceSol: [0.02, 100],
  devBuySol: [0, 0.05],
  priorityMicroLamports: [0, 200_000],
  collectFeesMinSol: [0.002, 10],
});

/** What one launch transaction may cost the wallet at most (rent + fees), per venue. Measured
 *  by simulating CashCat's own transactions on mainnet on 2026-09-24: pump.fun 0.00555 SOL,
 *  pump.fun paired with SPYx 0.00711 SOL, StonkFun/SPYx 0.00868 SOL. The cap leaves room for
 *  rent and fee changes and still stops anything unexpected. */
export const MAX_LAUNCH_SPEND_LAMPORTS = Object.freeze({ pumpfun: 15_000_000, "pumpfun-xstock": 15_000_000, stonkfun: 15_000_000 });
/** Compute limits: measured use (99,184 / 137,593 / 101,883 units) with room to spare. */
export const COMPUTE_LIMITS = Object.freeze({ pumpfun: 250_000, "pumpfun-xstock": 300_000, stonkfun: 250_000 });

export class ConfigError extends Error {
  constructor(message) { super(message); this.name = "ConfigError"; }
}

function number(env, name, key) {
  const raw = env[name];
  if (raw === undefined || raw === "") return CASHCAT_DEFAULTS[key];
  if (!/^\d+(\.\d+)?$/.test(String(raw).trim())) throw new ConfigError(`${name} must be a plain number`);
  const n = Number(raw);
  const [lo, hi] = FENCES[key];
  if (!(n >= lo && n <= hi)) throw new ConfigError(`${name} must be from ${lo} to ${hi}`);
  if (key === "maxLaunchesPerDay" && !Number.isInteger(n)) throw new ConfigError(`${name} must be a whole number`);
  return n;
}

export function readConfig(env = process.env) {
  const venues = env.CASHCAT_VENUES ? String(env.CASHCAT_VENUES).split(",").map((s) => s.trim()).filter(Boolean) : [...CASHCAT_DEFAULTS.venues];
  for (const v of venues) if (!VENUES.includes(v)) throw new ConfigError(`CASHCAT_VENUES names "${v}"; the venues are ${VENUES.join(", ")}`);
  if (!venues.length) throw new ConfigError("CASHCAT_VENUES names no venue");
  return Object.freeze({
    live: env.CASHCAT_LIVE === "1",
    liveRequested: env.CASHCAT_LIVE !== undefined && env.CASHCAT_LIVE !== "" && env.CASHCAT_LIVE !== "0",
    maxLaunchesPerDay: number(env, "CASHCAT_MAX_LAUNCHES_PER_DAY", "maxLaunchesPerDay"),
    maxLaunchesPerRun: CASHCAT_DEFAULTS.maxLaunchesPerRun,
    minBalanceSol: number(env, "CASHCAT_MIN_BALANCE_SOL", "minBalanceSol"),
    devBuySol: number(env, "CASHCAT_DEV_BUY_SOL", "devBuySol"),
    priorityMicroLamports: number(env, "CASHCAT_PRIORITY_MICROLAMPORTS", "priorityMicroLamports"),
    collectFeesMinSol: number(env, "CASHCAT_COLLECT_FEES_MIN_SOL", "collectFeesMinSol"),
    venues: Object.freeze(venues),
    stonkfunQuote: env.CASHCAT_STONKFUN_QUOTE || CASHCAT_DEFAULTS.stonkfunQuote,
    pumpXstockQuote: env.CASHCAT_PUMP_XSTOCK_QUOTE || CASHCAT_DEFAULTS.pumpXstockQuote,
    walletAddress: env.CASHCAT_WALLET_ADDRESS || "",
    rpcUrl: env.SOLANA_RPC_URL || PUBLIC_RPC,
    hasOwnRpc: Boolean(env.SOLANA_RPC_URL),
    hasWalletSecret: Boolean(env.CASHCAT_WALLET_SECRET),
    hasApiKey: Boolean(env.ANTHROPIC_API_KEY),
    hasPinata: Boolean(env.PINATA_JWT),
    model: env.CASHCAT_MODEL || "",
    testEnvironment: env.NODE_ENV === "test",
  });
}

/**
 * Every reason a LIVE launch must not happen now. Empty means every guard is green. The dry
 * run prints the same list, so the owner sees what is still missing before turning it on.
 */
export function liveRefusals(config, { wallet = null, balanceLamports = null, launchesToday = 0, unrecorded = 0, venue = null, simulated = false, reviewed = false } = {}) {
  const r = [];
  if (!config.live) r.push("CASHCAT_LIVE is not 1");
  if (config.testEnvironment) r.push("this is a test environment (NODE_ENV=test)");
  if (!config.hasWalletSecret || !wallet) r.push("CASHCAT_WALLET_SECRET is not set");
  if (!config.walletAddress) r.push("CASHCAT_WALLET_ADDRESS is not set");
  else if (wallet && wallet.publicKey !== config.walletAddress) r.push("CASHCAT_WALLET_ADDRESS is not the address of CASHCAT_WALLET_SECRET");
  if (!config.hasOwnRpc) r.push("SOLANA_RPC_URL is not set (the public endpoint is for reads only)");
  if (!config.hasApiKey) r.push("ANTHROPIC_API_KEY is not set (the model proposes and reviews every coin)");
  if (!config.hasPinata) r.push("PINATA_JWT is not set (the metadata must be pinned)");
  if (launchesToday >= config.maxLaunchesPerDay) r.push(`the day's cap is reached (${launchesToday} of ${config.maxLaunchesPerDay})`);
  if (unrecorded > 0) r.push(`${unrecorded} launch(es) on chain since yesterday are not in launches.json — record them before launching again`);
  if (balanceLamports === null) r.push("the wallet's balance is unknown");
  else if (balanceLamports < Math.round((config.minBalanceSol + config.devBuySol) * 1e9) + (venue ? MAX_LAUNCH_SPEND_LAMPORTS[venue] : 0))
    r.push(`the wallet holds ${(balanceLamports / 1e9).toFixed(4)} SOL, under the minimum ${config.minBalanceSol} SOL plus this launch's budget`);
  if (!simulated) r.push("the transaction was not simulated successfully");
  if (!reviewed) r.push("the coin was not approved by the model review");
  return r;
}
