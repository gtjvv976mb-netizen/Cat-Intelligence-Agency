#!/usr/bin/env node
/**
 * node bots/cashcat/run.mjs [--data-dir <dir>]
 *
 * Runs CashCat once. With CASHCAT_LIVE unset (the default) it is a dry run: it invents a coin,
 * renders its logo, builds, checks and (given a funded address) simulates the launch, prints
 * the plan and what a live launch would still need, and changes nothing. See config.mjs for
 * every variable and the README for how the owner turns it on.
 *
 * --data-dir defaults to site/assets (the files the site ships); the workflow points it at its
 * checkout of the floor-data branch. --logo-out <file> writes the rendered logo for a look.
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger, secretsFromEnv } from "../lib/log.mjs";
import { createHttp } from "../lib/http.mjs";
import { createRpc } from "../lib/rpc.mjs";
import { createModel } from "../lib/model.mjs";
import { HOSTS } from "../lib/verified.mjs";
import { DEFAULT_DATA_DIR } from "../lib/data.mjs";
import { walletFromEnv } from "./wallet.mjs";
import { renderLogo } from "./logo.mjs";
import { runCashCat } from "./launch.mjs";

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const dataDir = path.resolve(arg("--data-dir") ?? DEFAULT_DATA_DIR);
const logoOut = arg("--logo-out");

const env = process.env;
const log = createLogger({ secrets: secretsFromEnv(env), prefix: "[cashcat] " });
const http = createHttp({ allowedHosts: Object.values(HOSTS), log });

try {
  const rpc = createRpc({ http, url: env.SOLANA_RPC_URL || undefined });
  const model = createModel({ http, apiKey: env.ANTHROPIC_API_KEY || "", preferred: env.CASHCAT_MODEL || "", log });
  const wallet = walletFromEnv(env);
  if (wallet) log.info(`wallet: ${wallet.publicKey}`);
  const render = async (opts) => {
    const png = await renderLogo(opts);
    if (logoOut) { fs.writeFileSync(logoOut, png); log.info(`logo written to ${logoOut}`); }
    return png;
  };
  const result = await runCashCat({ env, http, rpc, model, wallet, dataDir, log, render });
  log.info(`result: ${JSON.stringify(result)}`);
  if (model.usage.calls) log.info(`model: ${model.usage.calls} calls, ${model.usage.inputTokens} input and ${model.usage.outputTokens} output tokens`);
} catch (error) {
  log.error(`CashCat stopped: ${error?.message ?? error}`);
  process.exitCode = 1;
}
