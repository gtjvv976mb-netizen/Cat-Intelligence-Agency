#!/usr/bin/env node
/**
 * node bots/popcat/run.mjs [--data-dir <dir>]
 *
 * Runs Popcat once: reads new pump.fun coins, keeps the cat ones, checks them on chain and,
 * with POPCAT_LIVE=1, publishes the ones that pass every check to callouts.json. Without it
 * (the default) it prints what it would publish and writes nothing.
 *
 * Variables: POPCAT_LIVE, POPCAT_MODEL, CASHCAT_WALLET_ADDRESS. Secrets: SOLANA_RPC_URL
 * (recommended: the public endpoint refuses some reads), ANTHROPIC_API_KEY (optional: a model
 * then confirms each coin is a cat and fit to print).
 */
import path from "node:path";
import { createLogger, secretsFromEnv } from "../lib/log.mjs";
import { createHttp } from "../lib/http.mjs";
import { createRpc } from "../lib/rpc.mjs";
import { createModel } from "../lib/model.mjs";
import { HOSTS } from "../lib/verified.mjs";
import { DEFAULT_DATA_DIR } from "../lib/data.mjs";
import { runPopcat } from "./callout.mjs";

const args = process.argv.slice(2);
const i = args.indexOf("--data-dir");
const dataDir = path.resolve(i >= 0 ? args[i + 1] : DEFAULT_DATA_DIR);
const env = process.env;
const log = createLogger({ secrets: secretsFromEnv(env), prefix: "[popcat] " });
const http = createHttp({ allowedHosts: Object.values(HOSTS), log });

try {
  const rpc = createRpc({ http, url: env.SOLANA_RPC_URL || undefined });
  const model = createModel({ http, apiKey: env.ANTHROPIC_API_KEY || "", preferred: env.POPCAT_MODEL || "", log, maxTokens: 600 });
  const result = await runPopcat({ env, http, rpc, model, dataDir, log });
  log.info(`result: ${result.mode}, ${result.callouts.length} callout(s), ${result.candidates} candidate(s)`);
} catch (error) {
  log.error(`Popcat stopped: ${error?.message ?? error}`);
  process.exitCode = 1;
}
