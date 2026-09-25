/**
 * NO KEY LEAVES ITS ONE FILE, NO SECRET REACHES A LOG, NO BOT CALLS A HOST IT WAS NOT GIVEN.
 *
 *   · Exactly one file under bots/ may hold a key: bots/cashcat/wallet.mjs (CashCat's wallet
 *     and each launch's mint). Nothing else constructs a Keypair, reads a secret key, or signs;
 *     Popcat holds no key and cannot sign at all.
 *   · The wallet module gives out the public key and signatures, never the secret: not in its
 *     JSON, not in an error, and it signs only a message that was checked.
 *   · The logger replaces the API key, the wallet secret, the RPC URL (and the key parts of
 *     it), the Pinata token and any keypair-shaped byte array.
 *   · http.mjs refuses any host the bots were not given, before a socket opens, and plain http.
 *   · Every URL the bots' code names is on a verified host.
 *   · No model identifier anywhere in the bots, their fixtures, their workflows or their data.
 *   · The test runner blanks every bot secret and switch before a test runs.
 */
import fs from "node:fs";
import path from "node:path";
import { Keypair, Transaction, PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import { harness, ROOT } from "./bots/test/doubles.mjs";
import { walletFromEnv, WalletError } from "./bots/cashcat/wallet.mjs";
import { createLogger, makeRedactor, SECRET_ENV_NAMES } from "./bots/lib/log.mjs";
import { createHttp, HttpError } from "./bots/lib/http.mjs";
import { HOSTS } from "./bots/lib/verified.mjs";

const { ok, section, throwsClause, done } = harness("test-bots-no-leak");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === "node_modules" ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");
const botFiles = walk(path.join(ROOT, "bots")).filter((f) => f.endsWith(".mjs") && !f.includes(`${path.sep}test${path.sep}`));
const src = Object.fromEntries(botFiles.map((f) => [rel(f), fs.readFileSync(f, "utf8")]));
const KEY_FILE = "bots/cashcat/wallet.mjs";

section("ONE FILE MAY HOLD A KEY");
const KEY_WORDS = /\bKeypair\b|secretKey|fromSecretKey|\bnacl\b|tweetnacl|signTransaction|signAllTransactions|mnemonic|derivePath/;
const code = (t) => t.replace(/^\s*(\*|\/\/).*$/gm, "");
const holders = Object.entries(src).filter(([, t]) => KEY_WORDS.test(code(t))).map(([f]) => f);
ok(`only ${KEY_FILE} constructs a Keypair or reads a secret key`, JSON.stringify(holders) === JSON.stringify([KEY_FILE]), holders.join(", "));
const signers = Object.entries(src).filter(([f, t]) => f !== KEY_FILE && /\.sign\(/.test(code(t)));
ok("the only signature made outside wallet.mjs is a call to the wallet's own sign(), in launch.mjs, always with the checked message",
  signers.map(([f]) => f).join() === "bots/cashcat/launch.mjs" && [...code(signers[0][1]).matchAll(/(\w+)\.sign\(([^)]*)\)/g)].every((m) => m[1] === "wallet" && /checkedMessage/.test(m[2])));
ok("the wallet secret's variable is read only by wallet.mjs (the others only ask whether it is set, or name it for redaction)",
  Object.entries(src).filter(([f, t]) => /env\.CASHCAT_WALLET_SECRET(?!\))/.test(t) && f !== KEY_FILE && !/Boolean\(env\.CASHCAT_WALLET_SECRET\)/.test(t)).length === 0);
ok("Popcat's files name no key, no wallet secret, and never import the wallet", Object.entries(src).filter(([f]) => f.startsWith("bots/popcat/")).every(([, t]) => !KEY_WORDS.test(t) && !/WALLET_SECRET|wallet\.mjs/.test(t)));
ok("only CashCat's run.mjs and launch.mjs import wallet.mjs", Object.entries(src).filter(([, t]) => /from "\.\/wallet\.mjs"|cashcat\/wallet\.mjs"/.test(t)).map(([f]) => f).sort().join() === "bots/cashcat/launch.mjs,bots/cashcat/run.mjs");
ok("no bot file writes to disk anything but the data files, the logo it was asked to, and Popcat's job summary (writeFileSync only in data.mjs, floor-data.mjs and CashCat's run.mjs's --logo-out; appendFileSync in Popcat's run.mjs, to $GITHUB_STEP_SUMMARY only)",
  Object.entries(src).filter(([, t]) => /writeFileSync|appendFileSync|createWriteStream/.test(t)).map(([f]) => f).sort().join() === "bots/cashcat/run.mjs,bots/floor-data.mjs,bots/lib/data.mjs,bots/popcat/run.mjs"
    && [...src["bots/popcat/run.mjs"].matchAll(/(writeFileSync|appendFileSync|createWriteStream)\(([^,]+),/g)].map((m) => `${m[1]}(${m[2]})`).join() === "appendFileSync(env.GITHUB_STEP_SUMMARY)");

section("THE WALLET GIVES OUT ITS ADDRESS AND SIGNATURES, NEVER ITS SECRET");
{
  const kp = Keypair.generate();
  const secret = bs58.encode(kp.secretKey);
  const w = walletFromEnv({ CASHCAT_WALLET_SECRET: secret });
  ok("its public key is the keypair's", w.publicKey === kp.publicKey.toBase58());
  ok("its JSON is the public key and nothing else", JSON.stringify(w) === JSON.stringify({ publicKey: w.publicKey }));
  ok("no property of it holds the secret", !Object.values(w).some((v) => typeof v === "string" && v.includes(secret.slice(0, 20))));
  const arr = JSON.stringify(Array.from(kp.secretKey));
  ok("the 64-number array form is read too, to the same address", walletFromEnv({ CASHCAT_WALLET_SECRET: arr }).publicKey === w.publicKey);
  let msg = "";
  try { walletFromEnv({ CASHCAT_WALLET_SECRET: secret.slice(0, -3) + "000" }); } catch (e) { msg = e.message; }
  ok("a bad secret is refused without repeating it", msg.length > 0 && !msg.includes(secret.slice(0, 12)));
  ok("no secret, no wallet (a dry run)", walletFromEnv({}) === null);
  const tx = new Transaction({ feePayer: kp.publicKey, recentBlockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi" });
  tx.add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 }));
  ok("it refuses to sign a message nobody checked", await throwsClause(() => w.sign(tx, {}), "unchecked"));
  const checked = tx.serializeMessage();
  tx.recentBlockhash = "11111111111111111111111111111111";
  ok("it refuses to sign a message that changed after the check", await throwsClause(() => w.sign(tx, { checkedMessage: checked }), "changed"));
  ok("it refuses to sign for a mint it did not make", await throwsClause(() => w.sign(tx, { checkedMessage: tx.serializeMessage(), mint: kp.publicKey.toBase58() }), "no_mint"));
}

section("THE LOGGER NEVER PRINTS A SECRET");
{
  const secrets = { ANTHROPIC_API_KEY: "sk-ant-test-abcdef123456", CASHCAT_WALLET_SECRET: bs58.encode(Keypair.generate().secretKey), SOLANA_RPC_URL: "https://mainnet.helius-rpc.example/?api-key=ffff1111eeee2222", PINATA_JWT: "eyJhbGciOi.test.jwt" };
  const lines = [];
  const log = createLogger({ secrets: Object.values(secrets), sink: (_l, line) => lines.push(line) });
  log.info("key", secrets.ANTHROPIC_API_KEY, "wallet", secrets.CASHCAT_WALLET_SECRET);
  log.error(new Error(`fetch failed for ${secrets.SOLANA_RPC_URL}`));
  log.info({ nested: { jwt: secrets.PINATA_JWT, rpcKey: "ffff1111eeee2222" } });
  log.info(`keyfile ${JSON.stringify(Array.from(Keypair.generate().secretKey))}`);
  const all = lines.join("\n");
  ok("the API key, the wallet secret, the RPC URL and its key, the Pinata token: all replaced", !Object.values(secrets).some((s) => all.includes(s)) && !all.includes("ffff1111eeee2222") && (all.match(/\[redacted\]/g) ?? []).length >= 5, all.slice(0, 200));
  ok("a keypair-shaped byte array is replaced even when it is not a known secret", /\[redacted key bytes\]/.test(all));
  ok("a signature (88 base58 characters) is not mistaken for a secret", makeRedactor([])("sig 3X3mQJn8Bhe3zBKFjYwvUarL45uzEbjHjXy5Ebh2GJxNUfD4a1TBWdqSJfg8iHLVJbu1rR3Nded1qyhMFV8a3K8d").includes("3X3mQJn8Bhe3"));
  ok("the names it redacts include every bot secret", ["ANTHROPIC_API_KEY", "CASHCAT_WALLET_SECRET", "SOLANA_RPC_URL", "PINATA_JWT"].every((n) => SECRET_ENV_NAMES.includes(n)));
  /* A model's proposed name, a trend or a coin's name with a line break in it must not start an
     Actions workflow command (::add-mask::, ::stop-commands::, ::error::) in the run's log. */
  const printed = [];
  const plog = createLogger({ prefix: "[cashcat] ", sink: (_l, line) => printed.push(...line.split("\n")) });
  plog.info("proposal Fine Cat\n::stop-commands::x\n::add-mask::1 refused");
  plog.section("A SECTION");
  ok("a line break in a logged value never starts a workflow command: every printed line carries the bot's prefix", printed.every((l) => l.startsWith("[cashcat] ")), JSON.stringify(printed));
}

section("ONLY THE HOSTS THE BOTS WERE GIVEN");
{
  let fetched = 0;
  const http = createHttp({ fetchImpl: async () => { fetched++; throw new Error("no"); }, allowedHosts: Object.values(HOSTS), sleep: async () => {} });
  ok("another host is refused before a socket opens", await throwsClause(() => http.json("https://evil.example/steal"), "host_not_allowed") && fetched === 0);
  ok("plain http is refused", await throwsClause(() => http.json("http://api.coingecko.com/api/v3/search/trending"), "bad_url") && fetched === 0);
  const pages = new Set(["pump.fun", "solscan.io", "www.stonkfun.xyz", "ipfs.io", "catintelligenceagency.com", "gateway.pinata.cloud", "api.mainnet-beta.solana.com", "github.com", "api.github.com", "xstocks.com", "gateway.irys.xyz", "fastrg.tools.yachts", "api.dexscreener.com"]);
  const hosts = new Set(Object.entries(src).flatMap(([, t]) => [...t.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)].map((m) => m[1])));
  const unknown = [...hosts].filter((h) => !Object.values(HOSTS).includes(h) && !pages.has(h) && !h.endsWith(".example") && !h.endsWith(".test"));
  ok("every URL in the bots' code is on a verified host or is a page the site links to", unknown.length === 0, unknown.join(", "));
}

section("NO MODEL IDENTIFIER, ANYWHERE THE BOTS REACH");
{
  const family = ["op" + "us", "son" + "net", "hai" + "ku", "fab" + "le", "myth" + "os", "inst" + "ant"].join("|");
  const ID = new RegExp(`\\bcl${"aude"}-(?:${family}|\\d)|\\b(?:${family})-\\d`, "i");
  const scan = [...walk(path.join(ROOT, "bots")), ...walk(path.join(ROOT, "fixtures", "bots")), ...walk(path.join(ROOT, ".github")),
    path.join(ROOT, "site", "assets", "launches.js"), path.join(ROOT, "site", "assets", "callouts.js"), path.join(ROOT, "site", "assets", "launches.json"), path.join(ROOT, "site", "assets", "callouts.json"),
    ...fs.readdirSync(ROOT).filter((f) => /^test-bots-.*\.mjs$/.test(f)).map((f) => path.join(ROOT, f))].filter((f) => /\.(mjs|js|json|yml|xml|md|txt)$/.test(f));
  const hits = scan.filter((f) => ID.test(fs.readFileSync(f, "utf8"))).map(rel);
  ok(`none in ${scan.length} files`, hits.length === 0, hits.join(", "));
  ok("the bots pick the model from GET /v1/models, and the tests use invented ids", /\/v1\/models/.test(src["bots/lib/model.mjs"]) && /test-model-a/.test(fs.readFileSync(path.join(ROOT, "test-bots-cashcat.mjs"), "utf8")));
}

section("THE TEST RUNNER BLANKS EVERY BOT SECRET AND SWITCH");
{
  const runner = fs.readFileSync(path.join(ROOT, "scripts", "test-all.mjs"), "utf8");
  ok("CASHCAT_LIVE, POPCAT_LIVE and every bot secret are emptied for the tests", ["ANTHROPIC_API_KEY", "CASHCAT_WALLET_SECRET", "SOLANA_RPC_URL", "PINATA_JWT", "CASHCAT_LIVE", "POPCAT_LIVE"].every((k) => new RegExp(`${k}: ""`).test(runner)));
  ok("and NODE_ENV is test, which no bot will run live under", /NODE_ENV: "test"/.test(runner));
}

done();
