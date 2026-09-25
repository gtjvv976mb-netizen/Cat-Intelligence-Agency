/**
 * THE WORKFLOWS: WHO RUNS, WITH WHICH SECRETS, AND HOW THE SITE GETS THE DATA.
 *
 *   · Popcat every half hour, CashCat three times a day, both also by hand; on main only,
 *     never on a pull request; each in its own concurrency group so two runs never overlap.
 *   · Each secret reaches only the step that needs it: the wallet secret and the Pinata token
 *     only CashCat's step; the model key and the RPC only the two bot steps; nothing echoes one.
 *     CashCat's job runs in the "cashcat" environment, where its secrets can be limited to main.
 *   · The data goes to the floor-data branch (never a commit on main), and a bot that published
 *     something deploys the site by calling pages.yml.
 *   · pages.yml is callable, checks out main, overlays floor-data's files, runs the site's tests
 *     on them, deploys — one deploy at a time (the pages-deploy group), never cancelling a
 *     running one. A push to main runs the same overlay, so it never wipes the callouts.
 *   · Every action is pinned to a commit; checkouts keep no credentials.
 */
import fs from "node:fs";
import path from "node:path";
import { harness, ROOT } from "./bots/test/doubles.mjs";

const { ok, section, done } = harness("test-bots-workflows");
const wf = (n) => fs.readFileSync(path.join(ROOT, ".github", "workflows", n), "utf8");
const pages = wf("pages.yml"), popcat = wf("popcat.yml"), cashcat = wf("cashcat.yml"), ci = wf("ci.yml");
const all = { "pages.yml": pages, "popcat.yml": popcat, "cashcat.yml": cashcat, "ci.yml": ci };
/** The block of a named step: from "- name: <name>" (or its id) to the next step. */
const step = (text, name) => { const i = text.indexOf(`- name: ${name}`); if (i < 0) return ""; const j = text.indexOf("\n      - ", i + 5); return text.slice(i, j < 0 ? undefined : j); };
const count = (text, re) => (text.match(re) ?? []).length;

section("WHEN THEY RUN");
ok("Popcat: every half hour (at :07 and :37) and by hand", /cron: "7,37 \* \* \* \*"/.test(popcat) && /workflow_dispatch:/.test(popcat));
ok("CashCat: three times a day and by hand", /cron: "23 2,10,18 \* \* \*"/.test(cashcat) && /workflow_dispatch:/.test(cashcat));
ok("neither runs on a pull request, and each runs on main only", ![popcat, cashcat].some((t) => /pull_request/.test(t)) && [popcat, cashcat].every((t) => /if: github\.ref == 'refs\/heads\/main'/.test(t)));
ok("each in its own concurrency group, never cancelling a run in progress", /group: popcat\n  cancel-in-progress: false/.test(popcat) && /group: cashcat\n  cancel-in-progress: false/.test(cashcat));

section("THE SECRETS REACH ONLY THEIR STEPS");
ok("CashCat's job runs in the \"cashcat\" environment, so its secrets can be kept to main (Settings → Environments), out of reach of any other branch or pull request",
  /  run:\n    if: github\.ref == 'refs\/heads\/main'\n    environment: cashcat\n/.test(cashcat));
ok("CashCat's wallet secret: once, in CashCat's own step", count(cashcat, /CASHCAT_WALLET_SECRET: \$\{\{ secrets\.CASHCAT_WALLET_SECRET \}\}/g) === 1 && step(cashcat, "CashCat").includes("secrets.CASHCAT_WALLET_SECRET") && !/CASHCAT_WALLET_SECRET/.test(popcat + pages + ci));
ok("the Pinata token: only CashCat's step", step(cashcat, "CashCat").includes("secrets.PINATA_JWT") && count(cashcat + popcat + pages + ci, /secrets\.PINATA_JWT/g) === 1);
ok("the model key and the RPC: only the two bot steps", count(cashcat + popcat + pages + ci, /secrets\.ANTHROPIC_API_KEY/g) === 2 && count(cashcat + popcat + pages + ci, /secrets\.SOLANA_RPC_URL/g) === 2
  && step(popcat, "Popcat").includes("secrets.ANTHROPIC_API_KEY") && step(cashcat, "CashCat").includes("secrets.SOLANA_RPC_URL"));
ok("the switches are repository variables: CASHCAT_LIVE and POPCAT_LIVE", /CASHCAT_LIVE: \$\{\{ vars\.CASHCAT_LIVE \}\}/.test(cashcat) && /POPCAT_LIVE: \$\{\{ vars\.POPCAT_LIVE \}\}/.test(popcat));
ok("Popcat is told CashCat's wallet address, so it never calls out a CashCat coin", /CASHCAT_WALLET_ADDRESS: \$\{\{ vars\.CASHCAT_WALLET_ADDRESS \}\}/.test(step(popcat, "Popcat")));
ok("no workflow echoes a secret", !Object.values(all).some((t) => /echo[^\n]*secrets\./.test(t)));
ok("the job token reaches only the floor-data steps", Object.values(all).every((t) => [...t.matchAll(/GH_TOKEN: \$\{\{ github\.token \}\}/g)].length === [...t.matchAll(/node bots\/floor-data\.mjs/g)].length));

section("THE DATA: FLOOR-DATA, THEN A DEPLOY");
for (const [name, t, files] of [["Popcat", popcat, "callouts.json,popcat-state.json"], ["CashCat", cashcat, "launches.json"]]) {
  ok(`${name}: checks out floor-data, runs on it, pushes only ${files}`, /node bots\/floor-data\.mjs checkout \.floor-data/.test(t) && /--data-dir \.floor-data/.test(t) && t.includes(`node bots/floor-data.mjs push .floor-data --files ${files}`));
  ok(`${name}: the job may write contents (the floor-data push) and nothing else`, /permissions:\n      contents: write\n/.test(t) && !/pages: write[\s\S]*runs-on/.test(t.split("deploy:")[0]));
  ok(`${name}: deploys through pages.yml only when it pushed something`, /deploy:\n    needs: run\n    if: needs\.run\.outputs\.changed == 'true'/.test(t) && /uses: \.\/\.github\/workflows\/pages\.yml/.test(t) && /pages: write\n      id-token: write\n    uses:/.test(t));
}
ok("CashCat installs the logo renderer", /npm ci --prefix bots/.test(cashcat));

section("THE DEPLOY");
ok("pages.yml runs on a push to main, by hand, and when a bot calls it", /push:\n    branches: \[main\]/.test(pages) && /workflow_dispatch:/.test(pages) && /workflow_call:/.test(pages));
ok("one deploy at a time: the pages-deploy group, never cancelling a running deploy", /concurrency:\n      group: pages-deploy\n      cancel-in-progress: false/.test(pages) && !/cancel-in-progress: true/.test(pages));
ok("it checks out main, whoever called it", /ref: main/.test(pages));
const o = pages.indexOf("floor-data.mjs overlay site/assets"), tIdx = pages.indexOf("node test-site.mjs && node test-bots-data.mjs"), u = pages.indexOf("upload-pages-artifact");
ok("it overlays floor-data, then runs the site's tests on the overlaid data, then uploads", o > 0 && tIdx > o && u > tIdx);
ok("its job may read contents and deploy Pages, nothing more", /permissions:\n      contents: read\n      pages: write\n      id-token: write/.test(pages));
ok("CI installs the renderer too, so the logo tests run there", /npm ci --prefix bots/.test(ci));

section("PINNED AND CREDENTIAL-FREE");
const uses = Object.values(all).flatMap((t) => [...t.matchAll(/uses: ([^\s]+)/g)].map((m) => m[1]));
ok("every third-party action is pinned to a commit", uses.filter((u) => !u.startsWith("./")).every((u) => /@[0-9a-f]{40}$/.test(u)), uses.join(", "));
ok("every checkout keeps no credentials", Object.values(all).every((t) => count(t, /actions\/checkout@/g) === count(t, /persist-credentials: false/g)));
ok("no workflow grants itself write-all", !Object.values(all).some((t) => /write-all/.test(t)));

done();
