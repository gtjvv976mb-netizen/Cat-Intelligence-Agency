/**
 * AGENCY HQ'S DEPLOYMENT, CHECKED AS FILES.
 *
 *   · the Docker image carries every module HQ imports (the import graph of every services/hq
 *     file, followed into src/, bots/ and vendor/) and nothing .dockerignore would drop; every
 *     package HQ imports is in services/hq/package.json, at the root's own versions;
 *   · Railway, the one documented host: the guide's settings build that Dockerfile from the
 *     repository root, check /health, keep the database on a volume, and redeploy when any of
 *     those paths change (Railway's railway.json is deprecated for new services);
 *   · HQ stays out of the extension: the build never reads services/, and HQ's node_modules are
 *     its own and never committed;
 *   · the workflow runs HQ's tests with pinned actions, no credentials and no secrets;
 *   · docs/hq/DEPLOY.md names every variable HQ reads, and the owner's guide says the things the
 *     owner must not get wrong (paper first, the kill switch, the phrase on paper, never in chat).
 */
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { harness, ROOT } from "./bots/test/doubles.mjs";

const { ok, section, done } = harness("test-hq-deploy");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

/* The import graph of every HQ module (its tests' doubles aside). */
const starts = fs.readdirSync(path.join(ROOT, "services", "hq"), { recursive: true })
  .filter((f) => f.endsWith(".mjs") && !String(f).split(path.sep).includes("node_modules") && !String(f).startsWith(`test${path.sep}`))
  .map((f) => path.join(ROOT, "services", "hq", f));
const IMPORT = /(?:import|export)\s[^"'`;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|^import\s+["']([^"']+)["']/gm;
const graph = new Set(), bare = new Set(), missing = [];
for (const q = [...starts]; q.length;) {
  const f = q.pop();
  if (graph.has(f)) continue;
  if (!fs.existsSync(f)) { missing.push(rel(f)); continue; }
  graph.add(f);
  for (const m of fs.readFileSync(f, "utf8").matchAll(IMPORT)) {
    const s = m[1] ?? m[2] ?? m[3];
    if (s.startsWith(".")) q.push(path.resolve(path.dirname(f), s)); else bare.add(s);
  }
}
const files = [...graph].map(rel).sort();

section("THE IMAGE CARRIES WHAT HQ IMPORTS");
{
  const docker = read("services/hq/Dockerfile");
  ok(`${files.length} modules in HQ's import graph, every one on disk`, missing.length === 0 && files.length > 50, missing.join(", "));
  const copies = [...docker.matchAll(/^COPY (?!--)(\S+)(?: \S+)* (\S+)$/gm)].map((m) => m[1]).filter((s) => !s.includes("package"));
  const covered = (f) => copies.some((c) => (c.endsWith("/") ? f.startsWith(c) : c.includes("*") ? new RegExp(`^${c.replace(/\./g, "\\.").replace(/\*/g, "[^/]+")}$`).test(f) : f === c));
  const uncovered = files.filter((f) => !covered(f));
  ok(`every module is COPY'd into the image (${copies.join(", ")})`, uncovered.length === 0, uncovered.join(", "));
  const ignore = read(".dockerignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const dropped = files.filter((f) => ignore.some((p) => p === "**/node_modules" ? f.includes("node_modules/") : p.includes("*") ? false : f === p || f.startsWith(`${p}/`)));
  ok(".dockerignore drops none of them", dropped.length === 0, dropped.join(", "));
  const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
  const pkg = JSON.parse(read("services/hq/package.json"));
  const root = JSON.parse(read("package.json"));
  const packages = [...bare].filter((b) => !builtins.has(b) && !b.startsWith("node:"));
  ok(`the packages HQ imports (${packages.join(", ")}) are services/hq/package.json's dependencies`, packages.every((p) => pkg.dependencies?.[p]), packages.filter((p) => !pkg.dependencies?.[p]).join(", "));
  ok("…at exactly the versions the root (and the extension's tests) use", Object.entries(pkg.dependencies).every(([k, v]) => root.dependencies?.[k] === v));
  ok("…installed from services/hq's own lockfile, production only", fs.existsSync(path.join(ROOT, "services", "hq", "package-lock.json")) && /npm ci --omit=dev/.test(docker));
  ok("only wallet.mjs in the graph reads a file (the owner's keypair, in the admin client on the owner's machine)", [...graph].filter((f) => /readFileSync|createReadStream/.test(fs.readFileSync(f, "utf8"))).map(rel).join() === "services/hq/wallet.mjs");
  ok("the image is Node 22, pinned to a patch release (node:sqlite is built in and still experimental there)", /^FROM node:22\.\d+\.\d+-bookworm-slim$/m.test(docker));
  ok("it starts the server and exposes the port HQ listens on by default", /CMD \["node", "services\/hq\/server\.mjs"\]/.test(docker) && /EXPOSE 8787/.test(docker) && /port: num\(env, "PORT", 8787/.test(read("services/hq/lib/config.mjs")));
  ok("it bakes in no variable of HQ's but NODE_ENV", [...docker.matchAll(/^(?:ENV|ARG)\s+(\S+)/gm)].every((m) => m[1].startsWith("NODE_ENV")));
}

section("RAILWAY");
{
  /* Railway's Config as Code (railway.json) is deprecated and new services cannot opt into it
     (docs.railway.com, read 2026-09-25), so the settings live in the owner's guide, checked here. */
  const guide = read("docs/hq/DEPLOY.md");
  const docker = read("services/hq/Dockerfile");
  ok("the guide sets RAILWAY_DOCKERFILE_PATH to the image's Dockerfile, built from the repository root", /RAILWAY_DOCKERFILE_PATH`?\s*(=|\|)\s*`?services\/hq\/Dockerfile/.test(guide) && /Root Directory[^\n]*empty/i.test(guide));
  ok("…the healthcheck path /health, a restart policy, and a volume at /data", /Healthcheck Path[^\n]*\/health/.test(guide) && /Restart Policy/.test(guide) && /Mount path[^\n]*\/data/i.test(guide));
  const block = /```text\n\s*(# Watch Paths[\s\S]*?)```/.exec(guide)?.[1] ?? "";
  const watch = block.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const copied = [...docker.matchAll(/^COPY (?!--)(\S+)/gm)].map((m) => m[1].replace(/\*\.mjs$/, "").replace(/\/$/, "").replace(/\/[^/]*\.json$/, "")).filter(Boolean);
  const under = (c) => watch.some((w) => { const base = w.replace(/^\//, "").replace(/\/\*\*$/, ""); return c === base || c.startsWith(`${base}/`); });
  ok(`…watch paths that cover everything the image copies (${watch.join(" ")})`, watch.length > 0 && copied.every(under), copied.filter((c) => !under(c)).join(", "));
  ok("…and nothing a site or extension-only change touches", !watch.some((w) => /^\/?(site|brand|icons)\b|^\/?src\/(?!lib|shims)/.test(w)));
  ok("no railway.json or railway.toml pretends to configure the service", !fs.existsSync(path.join(ROOT, "services", "hq", "railway.json")) && !fs.existsSync(path.join(ROOT, "railway.json")) && !fs.existsSync(path.join(ROOT, "railway.toml")));
  ok("one documented host: Railway (no second deploy path to keep in step)", !fs.existsSync(path.join(ROOT, "services", "hq", "fly.toml")) && !fs.existsSync(path.join(ROOT, "fly.toml")));
  const cfg = read("services/hq/lib/config.mjs");
  ok("HQ keeps its database on Railway's volume when HQ_DATA_DIR is not set (RAILWAY_VOLUME_MOUNT_PATH)", /RAILWAY_VOLUME_MOUNT_PATH/.test(cfg));
  ok("it listens on the PORT Railway injects (also what Railway's healthcheck uses)", /num\(env, "PORT"/.test(cfg));
}

section("HQ STAYS OUT OF THE EXTENSION");
{
  const build = read("build.mjs");
  ok("the extension build never reads services/", !/services\//.test(build));
  const gi = read(".gitignore");
  ok("node_modules anywhere, and HQ's local data, are never committed", /^node_modules\/$/m.test(gi) && /^hq-data\/$/m.test(gi));
  const root = JSON.parse(read("package.json"));
  ok("the root package gained no dependency for HQ", Object.keys(root.dependencies).sort().join() === "@solana/web3.js,bs58");
  ok("services/hq/package.json's test script is the HQ suite", JSON.parse(read("services/hq/package.json")).scripts.test.includes("test-all.mjs test-hq-"));
  ok("the root runner blanks HQ's secrets and switches for every test", ["HQ_MASTER_SEED", "HQ_TREASURY_SECRET", "HQ_LIVE", "HQ_BUYBACK_LIVE", "HQ_SWEEP", "HQ_KILL", "HQ_RPC_URL", "HQ_OWNER_WALLET", "HQ_TREASURY_ADDRESS", "HQ_DB_PATH"].every((k) => new RegExp(`${k}: ""`).test(read("scripts/test-all.mjs"))));
}

section("THE WORKFLOW");
{
  const wf = read(".github/workflows/hq.yml");
  ok("it runs HQ's tests", /node scripts\/test-all\.mjs test-hq-/.test(wf) && /npm ci --prefix services\/hq/.test(wf));
  ok("every action pinned to a commit", [...wf.matchAll(/uses: (\S+)/g)].every((m) => /@[0-9a-f]{40}$/.test(m[1])));
  ok("the checkout keeps no credentials; the token reads only", /persist-credentials: false/.test(wf) && /permissions:\n  contents: read/.test(wf));
  ok("no secret reaches it", !/secrets\./.test(wf));
  ok("it builds the image and starts it in paper mode, and /health must say live off and buyback off", /docker build -f services\/hq\/Dockerfile/.test(wf) && /switches\.live !== false/.test(wf));
  ok("it runs when the shared modules HQ runs change, not only services/hq", ["src/lib/**", "vendor/executor/**", "bots/lib/**", "bots/popcat/**", "bots/cashcat/**"].every((p) => wf.includes(`"${p}"`)));
}

section("THE OWNER'S GUIDE");
{
  const guide = read("docs/hq/DEPLOY.md");
  const vars = new Set();
  /* What the code reads from an environment: env.NAME, or a reader called as (env, "NAME"). */
  for (const f of ["services/hq/lib/config.mjs", "services/hq/wallet.mjs", "services/hq/server.mjs"]) for (const m of read(f).matchAll(/env\.([A-Z][A-Z0-9_]+)|\(env, "([A-Z][A-Z0-9_]+)"/g)) vars.add(m[1] ?? m[2]);
  const absent = [...vars].filter((v) => !guide.includes(v));
  ok(`every variable HQ reads (${vars.size}) is in docs/hq/DEPLOY.md`, absent.length === 0, absent.join(", "));
  for (const [what, re] of [
    ["Railway, deployed from the GitHub repository", /Deploy from GitHub repo/],
    ["a volume mounted at /data", /\/data/],
    ["Helius for HQ_RPC_URL", /Helius[\s\S]*HQ_RPC_URL|HQ_RPC_URL[\s\S]*Helius/],
    ["keygen on the owner's own computer", /node services\/hq\/keygen\.mjs/],
    ["the phrase on paper, never in a chat or a screenshot", /paper/i],
    ["Namecheap's CNAME for api", /CNAME/],
    ["paper first", /paper/],
    ["how to fund an agent and switch it live", /confirm/],
    ["how to stop everything", /HQ_KILL/],
    ["the monthly cost, with its sources", /railway\.com\/pricing[\s\S]*helius\.dev/],
  ]) ok(`it covers ${what}`, re.test(guide));
  ok("it never shows a real-looking secret: no 24-word phrase, no 64-byte base58 key", !/\b(?:[a-z]{3,8} ){23}[a-z]{3,8}\b/.test(guide) && !/[1-9A-HJ-NP-Za-km-z]{86,90}/.test(guide));

  /* the review's three: each step says what the owner will actually see and do */
  const step = (n) => { const m = new RegExp(`\\n## ${n}\\. [\\s\\S]*?(?=\\n## )`).exec(guide); return m ? m[0] : ""; };
  const domain = step(5), fund = step(7), live = step(8), signed = step(10);
  ok("the custom domain's port is the one Railway detects (its PORT, which HQ listens on), never a guessed 8787", /port Railway detects|keep the one Railway detects/.test(domain) && /PORT/.test(domain) && !/8787 if asked/.test(guide));
  ok("funding a paper agent says its page is still the paper book, where to see the deposit now, and that it shows once live", /paper book/.test(fund) && /Solscan|Phantom/.test(fund) && /once you switch the agent live/.test(fund));
  ok("back to paper only after liquidating: the guide never says 'any time', and says why HQ refuses", !/Back to paper any time/i.test(guide) && /agent\s+liquidate 1/.test(live) && /refuses/.test(live));
  ok("signed commands name the server they are for (HQ_SERVER_ID, --server or the --url's host)", /HQ_SERVER_ID/.test(signed) && /--server/.test(signed) && /--url/.test(signed));
  const { readConfig } = await import("./services/hq/lib/config.mjs");
  const c = readConfig({});
  const row = (v) => guide.split("\n").find((l) => l.startsWith("|") && l.includes(`\`${v}\``)) ?? "";
  ok("the stream limits and the server id are listed with the defaults the code has", row("HQ_STREAMS_PER_NETWORK").includes(`\`${c.rateLimit.streamsPerNetwork}\`, \`${c.rateLimit.streamsTotal}\``)
    && row("HQ_STREAM_MAX_SECONDS").includes(`\`${c.rateLimit.streamMaxMs / 1000}\``) && row("HQ_SERVER_ID").includes(`\`${c.serverId}\``), [row("HQ_STREAMS_PER_NETWORK"), row("HQ_STREAM_MAX_SECONDS")].join(" / "));
}

done();
