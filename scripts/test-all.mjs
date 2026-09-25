/**
 * Every test-*.mjs at the repository root and under vendor/executor/, discovered so a new regression joins CI
 * without a second list to remember. Each runs in its own process with a timeout, with
 * no model or execution keys in its environment, and with EXECUTE=0 — the same shape as
 * the Claude Company root runner this repository grew out of.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* An optional prefix runs a subset: `node scripts/test-all.mjs test-hq-` is Agency HQ's suite
   (services/hq/package.json's `npm test`, and .github/workflows/hq.yml). */
const only = process.argv[2] ?? "";
const tests = fs.readdirSync(root).filter((name) => /^test-.*\.mjs$/.test(name) && name.startsWith(only)).sort();
const vendoredTests = only ? [] : fs.readdirSync(path.join(root, "vendor", "executor"))
  .filter((name) => /^test-.*\.mjs$/.test(name)).sort()
  .map((name) => path.join("vendor", "executor", name));
const all = [...tests, ...vendoredTests];
const TIMEOUT_MS = 300_000;

let failed = 0;
const started = Date.now();
for (const test of all) {
  process.stdout.write(`\n━━ ${test} ━━\n`);
  const run = spawnSync(process.execPath, [test], {
    cwd: root,
    stdio: ["inherit", "inherit", "pipe"],
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: TIMEOUT_MS,
    env: { ...process.env, NODE_ENV: "test", ANTHROPIC_API_KEY: "", EXECUTE: "0",
      /* The bots' secrets and switches, blanked: no test may launch, publish or call out. */
      CASHCAT_WALLET_SECRET: "", SOLANA_RPC_URL: "", PINATA_JWT: "", CASHCAT_LIVE: "", POPCAT_LIVE: "",
      /* Agency HQ's secrets and switches, blanked: no test may derive a real wallet, sign or send. */
      HQ_MASTER_SEED: "", HQ_TREASURY_SECRET: "", HQ_LIVE: "", HQ_BUYBACK_LIVE: "", HQ_SWEEP: "", HQ_KILL: "",
      HQ_RPC_URL: "", HQ_RPC_WS_URL: "", HQ_OWNER_WALLET: "", HQ_TREASURY_ADDRESS: "", HQ_DATA_DIR: "", HQ_DB_PATH: "", HQ_MODEL: "" },
  });
  if (run.stderr) process.stderr.write(run.stderr.replace(/\(node:\d+\) (ExperimentalWarning|\[DEP0040\] DeprecationWarning)[^\n]*\n(\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n)?/g, ""));
  if (run.status !== 0) {
    failed++;
    const why = run.error?.message || run.signal || `exit ${run.status}`;
    console.error(`FAIL ${test} (${why})`);
    if (process.env.GITHUB_ACTIONS === "true") {
      const detail = String(run.stderr || why).slice(-4_000).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
      console.error(`::error file=${test},title=Regression failed::${detail}`);
    }
  }
}
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${all.length - failed}/${all.length} test files passed in ${elapsed}s.`);
if (failed) console.error(`${failed} test file${failed === 1 ? "" : "s"} failed.`);
process.exit(failed ? 1 : 0);
