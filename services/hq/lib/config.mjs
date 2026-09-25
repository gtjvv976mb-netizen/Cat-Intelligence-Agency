/**
 * HQ'S SETTINGS, FROM THE ENVIRONMENT, WITH SAFE DEFAULTS.
 *
 * Everything that moves money is OFF unless the owner turns it on by name:
 *   · HQ_LIVE=1            agents whose own mode is "live" may trade real SOL (both are needed)
 *   · HQ_SWEEP=1           live agents' claimed fees and realized profit are swept to the treasury
 *   · HQ_BUYBACK_LIVE=1    with HQ_TREASURY_SECRET set, the treasury buys back $CIA by the policy
 *   · HQ_KILL=1            the kill switch: no buy, no sweep, no buyback, no fee claim anywhere;
 *                          the protective sells (stop loss, take profit, trailing, daily limit)
 *                          still run, so nothing held is left unwatched
 * The secrets themselves (HQ_MASTER_SEED, HQ_TREASURY_SECRET) are read only in wallet.mjs; this
 * file sees neither. The policy numbers below are the owner's choices, not measurements; each
 * default is documented in docs/hq/DEPLOY.md.
 */
import { parseSol, parseUnits } from "./amounts.mjs";

export const CIA_MINT = "EDVtiBjPVeHTeKuvv1TMSC3vdsMUabZSaaoLRpiTpump";
/** What $CIA's mint account said on mainnet on 2026-09-25 (slot 450,446,442): Token-2022, 6
 *  decimals, 1,000,000,000 supply, mint and freeze authority revoked. Verified live again before
 *  every buyback and at start; a mismatch stops the buyback. */
export const CIA_FACTS = Object.freeze({ program: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", decimals: 6, readAt: "2026-09-25", slot: 450_446_442 });
export const SITE_ORIGINS = Object.freeze(["https://catintelligenceagency.com", "https://www.catintelligenceagency.com"]);
export const DEFAULT_LAUNCHES_URL = "https://catintelligenceagency.com/assets/launches.json";

export class ConfigError extends Error {
  constructor(key, message) { super(message); this.name = "ConfigError"; this.key = key; }
}

const on = (v) => String(v ?? "").trim() === "1";
const str = (v, d = "") => (v === undefined || v === null || String(v).trim() === "" ? d : String(v).trim());
function num(env, key, d, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const raw = str(env[key]);
  if (!raw) return d;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new ConfigError(key, `${key} must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}, got ${JSON.stringify(raw)}`);
  return n;
}
function sol(env, key, d, { min = "0", max = "1000" } = {}) {
  const raw = str(env[key], d);
  let v;
  try { v = parseSol(raw, key); } catch (e) { throw new ConfigError(key, e.message); }
  if (v < parseSol(min) || v > parseSol(max)) throw new ConfigError(key, `${key} must be from ${min} to ${max} SOL`);
  return v;
}
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function address(env, key) {
  const v = str(env[key]);
  if (!v) return null;
  if (!BASE58.test(v)) throw new ConfigError(key, `${key} is not a Solana address`);
  return v;
}

/** A 5-field cron string, checked by cron.mjs when the schedule is built. */
const cron = (env, key, d) => str(env[key], d);

/** HQ_PERK_TIERS: "holder:1,agent:1000000,director:10000000" in $CIA (whole or decimal units). */
export function parsePerkTiers(text, decimals = CIA_FACTS.decimals) {
  const tiers = {};
  for (const part of String(text).split(",").map((s) => s.trim()).filter(Boolean)) {
    const [name, amount] = part.split(":").map((s) => s.trim());
    if (!["holder", "agent", "director"].includes(name)) throw new ConfigError("HQ_PERK_TIERS", `unknown tier "${name}": the tiers are holder, agent and director`);
    let raw;
    try { raw = parseUnits(amount, decimals, `the ${name} threshold`); } catch (e) { throw new ConfigError("HQ_PERK_TIERS", e.message); }
    if (raw <= 0n) throw new ConfigError("HQ_PERK_TIERS", `the ${name} threshold must be above 0`);
    tiers[name] = raw;
  }
  if (!tiers.holder) throw new ConfigError("HQ_PERK_TIERS", "the holder tier must be set");
  if (tiers.agent !== undefined && tiers.agent < tiers.holder) throw new ConfigError("HQ_PERK_TIERS", "the agent tier must not be under the holder tier");
  if (tiers.director !== undefined && tiers.director < (tiers.agent ?? tiers.holder)) throw new ConfigError("HQ_PERK_TIERS", "the director tier must not be under the agent tier");
  return Object.freeze(tiers);
}

export function readConfig(env = process.env) {
  const rpcUrl = str(env.HQ_RPC_URL);
  if (rpcUrl && !/^https:\/\/\S+$/.test(rpcUrl)) throw new ConfigError("HQ_RPC_URL", "HQ_RPC_URL must be an https:// URL");
  const wsUrl = str(env.HQ_RPC_WS_URL, rpcUrl ? rpcUrl.replace(/^https:/, "wss:") : "");
  if (wsUrl && !/^wss:\/\/\S+$/.test(wsUrl)) throw new ConfigError("HQ_RPC_WS_URL", "HQ_RPC_WS_URL must be a wss:// URL");
  const destination = str(env.HQ_BUYBACK_DESTINATION, "treasury");
  if (!["burn", "treasury"].includes(destination)) throw new ConfigError("HQ_BUYBACK_DESTINATION", "HQ_BUYBACK_DESTINATION is burn or treasury");
  const dataDir = str(env.HQ_DATA_DIR, str(env.RAILWAY_VOLUME_MOUNT_PATH, "./hq-data"));
  return Object.freeze({
    port: num(env, "PORT", 8787, { min: 1, max: 65535, integer: true }),
    host: str(env.HQ_HOST, "0.0.0.0"),
    dbPath: str(env.HQ_DB_PATH, `${dataDir.replace(/\/+$/, "")}/hq.sqlite`),
    rpcUrl: rpcUrl || null,
    wsUrl: wsUrl || null,
    /** Reads fall back to the public endpoint when no RPC is set (paper only); live refuses. */
    publicRpcUrl: "https://api.mainnet-beta.solana.com",
    publicWsUrl: "wss://api.mainnet-beta.solana.com",
    live: on(env.HQ_LIVE),
    kill: on(env.HQ_KILL),
    sweep: on(env.HQ_SWEEP),
    buybackLive: on(env.HQ_BUYBACK_LIVE),
    treasury: address(env, "HQ_TREASURY_ADDRESS"),
    owner: address(env, "HQ_OWNER_WALLET"),
    cashcatWallet: address(env, "HQ_CASHCAT_WALLET_ADDRESS"),
    launchesUrl: str(env.HQ_AGENCY_LAUNCHES_URL, DEFAULT_LAUNCHES_URL),
    trustProxy: on(env.HQ_TRUST_PROXY),
    /* the model, for CoinMarketCat: chosen at run time from GET /v1/models; never written here */
    model: str(env.HQ_MODEL),
    hasModelKey: Boolean(str(env.ANTHROPIC_API_KEY)),
    /* paper */
    paperBankroll: sol(env, "HQ_PAPER_BANKROLL_SOL", "1", { min: "0.01", max: "100" }),
    /* the indexer */
    indexEveryMs: num(env, "HQ_INDEX_INTERVAL_SECONDS", 60, { min: 15, max: 3600 }) * 1000,
    maxHistoryPages: num(env, "HQ_MAX_HISTORY_PAGES", 20, { min: 1, max: 200, integer: true }),
    /* creator fees */
    feeClaimCron: cron(env, "HQ_FEE_CLAIM_CRON", "37 */6 * * *"),
    feeClaimMin: sol(env, "HQ_FEE_CLAIM_MIN_SOL", "0.01", { min: "0.001", max: "10" }),
    /* sweeps to the treasury */
    sweepCron: cron(env, "HQ_SWEEP_CRON", "7 0 * * *"),
    sweepMin: sol(env, "HQ_SWEEP_MIN_SOL", "0.005", { min: "0.001", max: "10" }),
    agentReserve: sol(env, "HQ_AGENT_RESERVE_SOL", "0.01", { min: "0.002", max: "10" }),
    /* the $CIA buyback */
    buybackSharePct: num(env, "HQ_BUYBACK_SHARE_PCT", 0, { min: 0, max: 100 }),
    buybackCron: cron(env, "HQ_BUYBACK_CRON", "17 */6 * * *"),
    buybackMaxPerRun: sol(env, "HQ_BUYBACK_MAX_SOL", "0.05", { min: "0.001", max: "100" }),
    buybackMin: sol(env, "HQ_BUYBACK_MIN_SOL", "0.002", { min: "0.001", max: "10" }),
    buybackDestination: destination,
    buybackSlippageBps: num(env, "HQ_BUYBACK_SLIPPAGE_BPS", 100, { min: 10, max: 300, integer: true }),
    buybackMaxImpactPct: num(env, "HQ_BUYBACK_MAX_IMPACT_PCT", 3, { min: 0.1, max: 10 }),
    /* how many runs a buyback's second leg (or its burn) may be refused or fail before it is stopped */
    buybackLegTries: num(env, "HQ_BUYBACK_LEG_TRIES", 4, { min: 1, max: 50, integer: true }),
    treasuryReserve: sol(env, "HQ_TREASURY_RESERVE_SOL", "0.05", { min: "0.01", max: "1000" }),
    /* perks */
    perkTiers: parsePerkTiers(str(env.HQ_PERK_TIERS, "holder:1,agent:1000000,director:10000000")),
    perksTtlMs: num(env, "HQ_PERKS_TTL_HOURS", 24, { min: 1, max: 720 }) * 3_600_000,
    challengeTtlMs: num(env, "HQ_CHALLENGE_TTL_SECONDS", 300, { min: 30, max: 3600 }) * 1000,
    /* admin */
    adminSkewMs: num(env, "HQ_ADMIN_MAX_SKEW_SECONDS", 300, { min: 30, max: 3600 }) * 1000,
    /* rate limits, per client address, per minute */
    rateLimit: Object.freeze({
      read: num(env, "HQ_RATE_READ_PER_MIN", 240, { min: 10, max: 100_000, integer: true }),
      perks: num(env, "HQ_RATE_PERKS_PER_MIN", 12, { min: 1, max: 1000, integer: true }),
      admin: num(env, "HQ_RATE_ADMIN_PER_MIN", 12, { min: 1, max: 1000, integer: true }),
      /* open streams per client network (an IPv4 /24, an IPv6 /48), and in all */
      streamsPerNetwork: num(env, "HQ_STREAMS_PER_NETWORK", 8, { min: 1, max: 1000, integer: true }),
      streamsTotal: num(env, "HQ_STREAMS_TOTAL", 300, { min: 1, max: 5_000, integer: true }),
      /* a stream ends after this long; the client resumes with Last-Event-ID and misses nothing */
      streamMaxMs: num(env, "HQ_STREAM_MAX_SECONDS", 300, { min: 10, max: 300, integer: true }) * 1000,
    }),
    /* the server's id in the owner's signed commands: a command signed for one HQ is refused by any other */
    serverId: str(env.HQ_SERVER_ID, "api.catintelligenceagency.com"),
  });
}

/** The switches and the gaps, in words, for the log at start and the health endpoint. */
export function describeSwitches(config, readiness) {
  return Object.freeze({
    live: config.live, kill: config.kill, sweep: config.sweep,
    buyback: config.buybackLive && readiness?.treasurySecret === "ok" ? "on" : "off",
    rpc: config.rpcUrl ? "own" : "public (reads only; nothing live)",
  });
}
