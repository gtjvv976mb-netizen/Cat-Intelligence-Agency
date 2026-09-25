/**
 * ONE FILE OF AGENCY HQ MAY HOLD A KEY: services/hq/wallet.mjs. This scan is the proof, on every
 * run, like test-hawk-no-key.mjs for the extension and test-bots-no-leak.mjs for the bots.
 *
 *   · only wallet.mjs reads HQ_MASTER_SEED or HQ_TREASURY_SECRET from an environment, anywhere in
 *     the repository (docs may name them; code may not read them);
 *   · no other file under services/hq/ makes a key, derives one, or signs: no Keypair, no secret
 *     key, no private-key object, no PBKDF2, no SLIP-0010 seed, no crypto.sign;
 *   · wallet.mjs is imported by the four entry points only — the server, the CLI, keygen and the
 *     owner's admin client — never by the runtime, the strategies, the executor or the API, which
 *     receive signers the server hands them; and each entry point takes only what it needs;
 *   · the extension, the bots, the vendored executor and the site never name the secrets;
 *   · the test runner blanks every HQ secret and switch; the Docker image bakes none in.
 */
import fs from "node:fs";
import path from "node:path";
import { harness, ROOT } from "./services/hq/test/doubles.mjs";

const { ok, section, done } = harness("test-hq-no-key");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (["node_modules", ".git", "dist", "hq-data"].includes(e.name) ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const rel = (f) => path.relative(ROOT, f);
const read = (f) => fs.readFileSync(f, "utf8");
const WALLET = path.join("services", "hq", "wallet.mjs");
/* The names, assembled from pieces so this file does not match its own patterns. */
const SEED = "HQ_" + "MASTER_SEED", TSECRET = "HQ_" + "TREASURY_SECRET";
const READS = new RegExp(`(\\.|\\[\\s*["'\`])(${SEED}|${TSECRET})\\b`);

section("ONLY wallet.mjs READS THE SECRETS FROM AN ENVIRONMENT");
{
  const code = walk(ROOT).filter((f) => /\.(mjs|js|cjs|json|yml|yaml|toml|sh)$/.test(f) && !path.basename(f).startsWith("test-"));
  const readers = code.filter((f) => READS.test(read(f))).map(rel);
  ok(`${code.length} code files scanned; the one that reads them is wallet.mjs`, readers.length === 1 && readers[0] === WALLET, readers.join(", "));
  for (const dir of ["src", "bots", "vendor", "site"]) {
    const hits = walk(path.join(ROOT, dir)).filter((f) => /\.(mjs|js|json|html|md)$/.test(f) && (read(f).includes(SEED) || read(f).includes(TSECRET))).map(rel);
    ok(`nothing under ${dir}/ names them`, hits.length === 0, hits.join(", "));
  }
}

section("NOTHING ELSE UNDER services/hq/ MAKES, DERIVES OR USES A KEY");
{
  const files = walk(path.join(ROOT, "services", "hq")).filter((f) => f.endsWith(".mjs") && rel(f) !== WALLET);
  const BANNED = [
    [/\bKeypair\b/, "Keypair"], [/secretKey/, "secretKey"], [/createPrivateKey|generateKeyPair/, "a private-key object"], [/pbkdf2/i, "PBKDF2"],
    [new RegExp("ed25519 " + "seed"), "a SLIP-0010 seed"], [/fromSeed|fromSecretKey|derivePath|mnemonicToSeed/, "key derivation"], [/\bnacl\b|tweetnacl/, "nacl"],
    [/crypto\.sign\(|\.sign\(\s*\[/, "a signing call"], [/privateKey/, "a private key"],
  ];
  ok(`there are HQ files to scan (${files.length})`, files.length >= 20);
  for (const f of files) {
    const text = read(f);
    const hits = BANNED.filter(([re]) => re.test(text)).map(([, what]) => what);
    ok(`${rel(f)}: no key, no derivation, no signature`, hits.length === 0, hits.join(", "));
  }
}

section("WHO IMPORTS wallet.mjs, AND FOR WHAT");
{
  const importers = walk(ROOT).filter((f) => /\.m?js$/.test(f) && !path.basename(f).startsWith("test-") && /from\s+["'][^"']*wallet\.mjs["']/.test(read(f)) && /services[\\/]hq/.test(f));
  const names = importers.map(rel).sort();
  const want = ["services/hq/admin-client.mjs", "services/hq/cli.mjs", "services/hq/keygen.mjs", "services/hq/server.mjs"].map((p) => p.split("/").join(path.sep));
  ok("the four entry points and nothing else", JSON.stringify(names) === JSON.stringify(want), names.join(", "));
  const takes = (file) => { const m = /import\s*\{([^}]*)\}\s*from\s*["']\.\/wallet\.mjs["']/.exec(read(path.join(ROOT, file))); return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean).sort() : []; };
  ok("the server: addresses, readiness and the two signers it hands the executor", JSON.stringify(takes("services/hq/server.mjs")) === JSON.stringify(["agentAddress", "signAsAgent", "signAsTreasury", "walletReadiness"]));
  ok("the CLI: readiness only (it signs through the server's wiring)", JSON.stringify(takes("services/hq/cli.mjs")) === JSON.stringify(["walletReadiness"]));
  ok("keygen: the makers and the address check", JSON.stringify(takes("services/hq/keygen.mjs")) === JSON.stringify(["addressFromPhrase", "derivationPath", "newRecoveryPhrase", "newTreasuryKey"]));
  ok("the admin client: the owner's message signature", JSON.stringify(takes("services/hq/admin-client.mjs")) === JSON.stringify(["signOwnerMessage"]));
  const signerNames = walk(path.join(ROOT, "services", "hq")).filter((f) => f.endsWith(".mjs") && /signAsAgent|signAsTreasury/.test(read(f))).map(rel).sort();
  ok("the signers are named only in wallet.mjs and the server that wires them", JSON.stringify(signerNames) === JSON.stringify([path.join("services", "hq", "server.mjs"), WALLET].sort()), signerNames.join(", "));
  const lib = walk(path.join(ROOT, "services", "hq", "lib")).concat(walk(path.join(ROOT, "services", "hq", "strategies")));
  ok("the runtime, the executor, the API and the strategies never import it (they name it only in comments)", lib.every((f) => !/(from|import)\s*\(?\s*["'][^"']*wallet\.mjs["']/.test(read(f))));
}

section("NOTHING PRINTS THE ENVIRONMENT; THE RUNNER BLANKS IT; THE IMAGE BAKES NOTHING");
{
  const hq = walk(path.join(ROOT, "services", "hq")).filter((f) => f.endsWith(".mjs"));
  ok("no HQ file logs or serialises process.env", hq.every((f) => !/(console\.\w+|JSON\.stringify)\(\s*process\.env/.test(read(f))));
  const runner = read(path.join(ROOT, "scripts", "test-all.mjs"));
  for (const k of [SEED, TSECRET, "HQ_LIVE", "HQ_BUYBACK_LIVE", "HQ_SWEEP", "HQ_RPC_URL", "HQ_OWNER_WALLET"]) ok(`the test runner blanks ${k}`, new RegExp(`${k}:\\s*""`).test(runner));
  const docker = read(path.join(ROOT, "services", "hq", "Dockerfile"));
  ok("the Dockerfile sets no secret (no ENV or ARG for them)", !new RegExp(`(ENV|ARG)\\s+(${SEED}|${TSECRET}|ANTHROPIC_API_KEY|HQ_RPC_URL)`).test(docker));
  const ignore = read(path.join(ROOT, ".gitignore"));
  ok("HQ's local data directory is never committed", /^hq-data\/?$/m.test(ignore));
}

done();
