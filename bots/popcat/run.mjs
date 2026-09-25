#!/usr/bin/env node
/**
 * node bots/popcat/run.mjs [--data-dir <dir>]
 *
 * Runs Popcat once: reads new pump.fun coins, queues the cat ones, checks them on chain and,
 * with POPCAT_LIVE=1, publishes every coin it checked to callouts.json (a callout when no check
 * found a red flag, spotted when one did), with at most one pick per six-hour window. Without it
 * (the default) it prints what it would publish and writes nothing.
 *
 * In GitHub Actions it also appends what it did to the job's summary ($GITHUB_STEP_SUMMARY), the
 * pick and its draft included, so the owner can read them in the Actions tab. That file is the
 * only one this script writes; bots/popcat/summary.mjs escapes every stranger's word in it.
 *
 * Variables: POPCAT_LIVE, POPCAT_MODEL, CASHCAT_WALLET_ADDRESS. Secrets: SOLANA_RPC_URL
 * (recommended: the public endpoint refuses some reads), ANTHROPIC_API_KEY (optional: a model
 * then confirms each coin is a cat and fit to print).
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger, secretsFromEnv } from "../lib/log.mjs";
import { createHttp } from "../lib/http.mjs";
import { createRpc } from "../lib/rpc.mjs";
import { createModel } from "../lib/model.mjs";
import { HOSTS } from "../lib/verified.mjs";
import { DEFAULT_DATA_DIR } from "../lib/data.mjs";
import { runPopcat } from "./callout.mjs";
import { summaryMarkdown, summaryOfError } from "./summary.mjs";

const args = process.argv.slice(2);
const i = args.indexOf("--data-dir");
const dataDir = path.resolve(i >= 0 ? args[i + 1] : DEFAULT_DATA_DIR);
const env = process.env;
const log = createLogger({ secrets: secretsFromEnv(env), prefix: "[popcat] " });
const http = createHttp({ allowedHosts: Object.values(HOSTS), log });
const summarize = (text) => {
  if (!env.GITHUB_STEP_SUMMARY) return;
  try { fs.appendFileSync(env.GITHUB_STEP_SUMMARY, text); } catch (e) { log.warn(`could not write the job summary: ${e.message}`); }
};

try {
  const rpc = createRpc({ http, url: env.SOLANA_RPC_URL || undefined });
  const model = createModel({ http, apiKey: env.ANTHROPIC_API_KEY || "", preferred: env.POPCAT_MODEL || "", log, maxTokens: 600 });
  const result = await runPopcat({ env, http, rpc, model, dataDir, log });
  const c = result.counts;
  log.info(`result: ${result.mode}, ${c.checked} coin(s) checked (${c.callouts} callout(s), ${c.spotted} spotted), ${result.pick.pick ? "a pick" : "no pick"}, ${c.waiting} waiting, ${c.dropped} dropped`);
  summarize(summaryMarkdown(result));
} catch (error) {
  log.error(`Popcat stopped: ${error?.message ?? error}`);
  summarize(summaryOfError(log.redact(`Popcat stopped: ${error?.message ?? error}`)));
  process.exitCode = 1;
}
