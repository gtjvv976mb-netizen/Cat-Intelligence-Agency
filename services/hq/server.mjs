#!/usr/bin/env node
/**
 * AGENCY HQ, THE SERVER. `node services/hq/server.mjs` — on Railway, the Docker image's command.
 *
 * Reads its settings from the environment (lib/config.mjs; the owner's guide is
 * docs/hq/DEPLOY.md), opens its SQLite file on the persistent volume, settles any transaction the
 * last process left in flight, and runs the agents, the indexer, the jobs and the public API.
 * Paper by default: nothing is signed unless HQ_LIVE=1 and an agent's own mode is live.
 */
import { readConfig, describeSwitches, CIA_FACTS } from "./lib/config.mjs";
import { openDb } from "./lib/db.mjs";
import { createRpc } from "../../src/lib/rpc.mjs";
import { createRpc as createBotsRpc } from "../../bots/lib/rpc.mjs";
import { createHttp, HTTP_DEFAULTS } from "../../bots/lib/http.mjs";
import { HOSTS } from "../../bots/lib/verified.mjs";
import { createJupiterClient } from "../../src/lib/jupiter-swap.mjs";
import { createBrain } from "../../src/lib/agent-brain.mjs";
import { createMarketView } from "./lib/market.mjs";
import { createRugChecker } from "./lib/rugcheck.mjs";
import { createIndexer } from "./lib/indexer.mjs";
import { createRuntime } from "./lib/runtime.mjs";
import { createExecutor } from "./lib/execution.mjs";
import { createPerks, readCiaBalance } from "./lib/perks.mjs";
import { createScheduler } from "./lib/scheduler.mjs";
import { createApi, HQ_VERSION } from "./lib/api.mjs";
import { withdrawToTreasury } from "./lib/revenue.mjs";
import { readCia } from "./lib/buyback.mjs";
import { laneStatus } from "./strategies/snipurr.mjs";
import { pathToFileURL } from "node:url";
import { agentAddress, walletReadiness, signAsAgent, signAsTreasury } from "./wallet.mjs";

/** Everything wired together; exported so the tests and the local paper run build the same thing. */
const okOrError = (failed) => (failed ? "error" : "ok");

export async function buildHq({ env = process.env, fetchImpl = globalThis.fetch, clock = () => Date.now(), log = (line) => console.log(`[hq] ${line}`), WebSocketImpl = globalThis.WebSocket, signers = null, retryDelaysMs = undefined } = {}) {
  const config = readConfig(env);
  const db = openDb(config.dbPath, { clock });
  const rpcUrl = config.rpcUrl ?? config.publicRpcUrl;
  const rpc = createRpc({ url: rpcUrl, fetchImpl, timeoutMs: 20_000 });
  const http = createHttp({ fetchImpl, allowedHosts: Object.values(HOSTS), defaults: { ...HTTP_DEFAULTS, minGapMs: 150 } });
  const botsRpc = createBotsRpc({ http, url: rpcUrl });
  const jupiter = createJupiterClient({ fetchImpl, clock });
  const market = createMarketView({ rpc, fetchImpl, jupiter, clock });
  const rug = createRugChecker({ rpc: botsRpc, clock });
  const brain = env.ANTHROPIC_API_KEY ? createBrain({ fetchImpl, clock, apiKey: async () => env.ANTHROPIC_API_KEY || null }) : null;
  const indexer = createIndexer({ db, rpc, log, maxPages: config.maxHistoryPages, retryDelaysMs });
  const shared = { launches: [], treasury: null };
  let executor = null;
  const runtime = createRuntime({ config, db, clock, log, executor: () => executor, indexer, market, rug, jupiter, rpc, launches: () => shared.launches });
  executor = createExecutor({ config, db, rpc, jupiter, clock, log, onConfirmed: (x) => runtime.onConfirmed(x),
    signers: signers ?? { agent: (n, args) => signAsAgent(n, { ...args, env }), treasury: (args) => signAsTreasury({ ...args, env }) } });
  const scheduler = createScheduler({ config, db, runtime, indexer, executor, rpc, botsRpc, http, market, jupiter, brain, fetchImpl, clock, log, WebSocketImpl,
    treasuryReady: () => walletReadiness(env).treasurySecret, state: shared });
  const perks = createPerks({ db, config, clock, balanceOf: (w) => readCiaBalance(rpc, w), log });
  const adminDeps = { db, config, runtime, rpc, clock, agentAddress: (n) => agentAddress(n, { env }),
    withdraw: ({ agent, lamports }) => withdrawToTreasury({ config, db, rpc, executor, agent, lamports }) };
  const views = () => new Map(db.listAgents().map((a) => [a.id, runtime.viewOf(a.id)]).filter(([, v]) => v));
  const walletLedgers = () => new Map(db.listAgents().map((a) => [a.id, runtime.walletLedger(a)]));
  const health = () => {
    const s = scheduler.status();
    const ready = walletReadiness(env);
    return {
      ok: s.indexer.state !== "error", service: "cia-hq", version: HQ_VERSION, time: new Date(clock()).toISOString(), uptimeSec: Math.round((clock() - s.startedAt) / 1000),
      /* the kill switch is on when either the variable or the owner's console command says so */
      agents: db.listAgents().length, switches: { ...describeSwitches(config, ready), kill: config.kill || db.getKv("kill") === true }, wallets: ready.masterSeed === "ok" ? "ready" : "not ready",
      /* states and times only: an upstream service's words stay in the log (the contract's /health) */
      indexer: { at: s.indexer.at, state: okOrError(s.indexer.state === "error"), backfilling: s.indexer.backfilling },
      feed: { state: okOrError(["dead", "degraded"].includes(s.feed.state)) },
      jobs: Object.fromEntries(Object.entries(s.jobs).map(([k, j]) => [k, { at: j.at, state: okOrError(j.state === "error") }])),
      lanes: Object.fromEntries(db.listAgents().filter((a) => a.strategy === "snipurr").map((a) => [a.id, laneStatus(a.id)])),
    };
  };
  const api = createApi({ db, config, clock, views, walletLedgers, treasury: () => shared.treasury, health, perks, adminDeps, onError: (e) => log(`api: ${e?.message ?? e}`) });
  return { config, db, rpc, botsRpc, http, jupiter, market, rug, brain, indexer, runtime, executor, scheduler, perks, api, shared, adminDeps };
}

async function main() {
  const hq = await buildHq();
  const { config, db, api, scheduler, rpc } = hq;
  const ready = walletReadiness(process.env);
  console.log(`[hq] Agency HQ ${HQ_VERSION}: ${JSON.stringify(describeSwitches(config, ready))}; wallets ${ready.masterSeed}; treasury ${config.treasury ?? "not set"}`);
  if (config.live && !config.rpcUrl) console.log("[hq] HQ_LIVE is 1 but HQ_RPC_URL is not set: nothing will be sent through the public endpoint");
  try {
    const { facts, curve } = await readCia(rpc);
    console.log(`[hq] $CIA read live: ${facts.program === CIA_FACTS.program ? "Token-2022" : facts.program}, ${facts.decimals} decimals${curve ? `, pump.fun curve quoted in ${curve.quoteMint}${curve.complete ? " (graduated)" : ""}` : ""}`);
  } catch (e) { console.log(`[hq] $CIA could not be read at start: ${e.message}`); }
  const address = await api.listen(config.port, config.host);
  console.log(`[hq] listening on port ${address.port}`);
  await scheduler.start();
  const stop = async (sig) => {
    console.log(`[hq] ${sig}: stopping`);
    scheduler.stop();
    await api.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(`[hq] failed to start: ${e?.message ?? e}`); process.exit(1); });
