/**
 * THE FLOOR-DATA BRANCH: CHECKOUT, PUSH WITH A RACE, AND THE DEPLOY'S OVERLAY.
 *
 * Run against local bare git repositories (no network): the branch is started as an orphan
 * when it does not exist; a push commits only the files it is told to; nothing to commit is
 * "changed=false"; a dry run, which writes no data file, commits nothing and creates no branch;
 * two bots pushing at once both land, the second by fetching and rebasing (they write different
 * files); a push of Popcat's memory alone is committed but is no change to the site, so it
 * deploys nothing. The overlay reads each file through the GitHub API (scripted here): a file or
 * branch that does not exist keeps main's copy; the entries that pass the site's validators are
 * written over site/assets and the ones that do not are left out and named, so one bad entry
 * never stops main's deploy; Popcat's picks go over with its coins, and a pick of CashCat's coin
 * does not; a transient API error is retried; a file that cannot be read or is
 * not the right shape at all fails the deploy, so the live floor is never blanked.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { harness, fixture, response } from "./bots/test/doubles.mjs";
import { checkout, push, overlay, fetchDataFile, remoteUrl, BRANCH } from "./bots/floor-data.mjs";

const { ok, section, throwsClause, done } = harness("test-bots-floor-data");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "floor-data-"));
const git = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" });
const origin = path.join(tmp, "origin.git");
git(["init", "--quiet", "--bare", "-b", "main", origin]);
{
  const seed = path.join(tmp, "seed");
  git(["init", "--quiet", "-b", "main", seed]);
  fs.writeFileSync(path.join(seed, "README.md"), "main\n");
  git(["add", "."], seed);
  git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "main"], seed);
  git(["push", "--quiet", origin, "main"], seed);
}
const lsRemote = () => git(["ls-remote", "--heads", origin], tmp).stdout;
const filesOn = (ref) => git(["ls-tree", "--name-only", ref], origin).stdout.split("\n").filter(Boolean).sort();

section("CHECKOUT AND PUSH");
{
  const a = path.join(tmp, "a");
  const r = checkout(a, { remote: origin, token: "" });
  ok("a branch that does not exist yet is started as an orphan", r.created && !lsRemote().includes(BRANCH));
  fs.writeFileSync(path.join(a, "callouts.json"), '{"callouts":[]}\n');
  fs.writeFileSync(path.join(a, "stray.txt"), "not listed");
  const p = push(a, { files: ["callouts.json"], message: "Popcat: callouts", token: "", remote: origin });
  ok("the first push creates floor-data with only the listed file (and its README)", p.changed && lsRemote().includes(`refs/heads/${BRANCH}`) && filesOn(BRANCH).join() === "README.md,callouts.json");
  ok("main is untouched", filesOn("main").join() === "README.md");
  ok("nothing new to commit: changed=false", push(a, { files: ["callouts.json"], message: "again", token: "", remote: origin }).changed === false);
  const b = path.join(tmp, "b"), c = path.join(tmp, "c");
  ok("an existing branch is cloned", checkout(b, { remote: origin, token: "" }).created === false && fs.existsSync(path.join(b, "callouts.json")));
  checkout(c, { remote: origin, token: "" });
  fs.writeFileSync(path.join(b, "launches.json"), '{"launches":[]}\n');
  fs.writeFileSync(path.join(c, "callouts.json"), '{"callouts":[] }\n');
  const pb = push(b, { files: ["launches.json"], message: "CashCat: launch", token: "", remote: origin });
  const pc = push(c, { files: ["callouts.json"], message: "Popcat: callouts", token: "", remote: origin });
  ok("two bots pushing at once both land: the second fetches, rebases and pushes again", pb.changed && pc.changed && pc.attempts === 2 && filesOn(BRANCH).join() === "README.md,callouts.json,launches.json");
  const log = git(["log", "--format=%s|%an", BRANCH], origin).stdout.trim().split("\n");
  ok("each commit says which bot made it, as the floor bot", log.length === 3 && log.every((l) => /\|cia-floor-bot$/.test(l)));
  fs.writeFileSync(path.join(c, "popcat-state.json"), '{"seen":{}}\n');
  const ps = push(c, { files: ["callouts.json", "popcat-state.json"], message: "Popcat: memory", token: "", remote: origin });
  ok("Popcat's memory alone is committed, but is no change to the site: no deploy", ps.committed === true && ps.changed === false && filesOn(BRANCH).includes("popcat-state.json"));
}

section("A DRY RUN COMMITS NOTHING");
{
  const fresh = path.join(tmp, "fresh.git");
  git(["init", "--quiet", "--bare", "-b", "main", fresh]);
  const d = path.join(tmp, "dry");
  const r = checkout(d, { remote: fresh, token: "" });
  const p = push(d, { files: ["launches.json"], message: "CashCat: launch", token: "", remote: fresh });
  ok("a run that wrote no data file commits nothing and starts no floor-data branch, even the first time", r.created && !p.committed && !p.changed
    && !git(["ls-remote", "--heads", fresh], tmp).stdout.includes(BRANCH));
}

section("THE REMOTE AND ITS TOKEN");
ok("the remote is the Actions repository, or FLOOR_DATA_REMOTE", remoteUrl({ GITHUB_REPOSITORY: "o/r" }) === "https://github.com/o/r.git" && remoteUrl({ FLOOR_DATA_REMOTE: "/x" }) === "/x");
{
  const src = fs.readFileSync(path.resolve("bots/floor-data.mjs"), "utf8");
  ok("the token travels as a per-command HTTP header, never in a URL or the git config", /http\.https:\/\/github\.com\/\.extraheader=AUTHORIZATION: basic/.test(src) && !/x-access-token:\$\{token\}@/.test(src) && !/config.*extraheader.*--global|git config/.test(src));
}

section("THE DEPLOY'S OVERLAY");
{
  const site = path.join(tmp, "site-assets");
  fs.mkdirSync(site);
  const empty = { launches: '{\n  "launches": []\n}\n', callouts: '{\n  "callouts": []\n}\n' };
  fs.writeFileSync(path.join(site, "launches.json"), empty.launches);
  fs.writeFileSync(path.join(site, "callouts.json"), empty.callouts);
  const calls = [];
  const fetchWith = (answers) => async (url, init) => { calls.push({ url, init }); const f = url.match(/contents\/([a-z]+\.json)/)[1]; const a = answers[f]; return typeof a === "number" ? response(a, "{}") : response(200, a); };
  const quiet = () => {};
  const noWait = async () => {};
  const r = await overlay(site, { fetchImpl: fetchWith({ "launches.json": 404, "callouts.json": 404 }), repo: "o/r", token: "tok123", log: quiet, sleep: noWait });
  ok("no floor-data yet: main's empty copies are kept", r["launches.json"] === "kept" && fs.readFileSync(path.join(site, "callouts.json"), "utf8") === empty.callouts);
  ok("the API is asked for each file on floor-data, with the job token", calls.every((c) => /^https:\/\/api\.github\.com\/repos\/o\/r\/contents\/(launches|callouts)\.json\?ref=floor-data$/.test(c.url) && c.init.headers.authorization === "Bearer tok123"));
  const snap = fixture("popcat/snapshots.json").snapshots[0];
  const callout = { time: "2026-09-24T21:40:00Z", venue: "pumpfun", mint: snap.apiRow.mint, creator: snap.apiRow.creator, name: snap.apiRow.name, symbol: snap.apiRow.symbol, cat: { field: "name", word: "cat" },
    checks: snap.evaluatedThen.checks.map(({ id, value }) => ({ id, result: "pass", value })), stats: { holders: 40, top10Pct: 14.8, curvePct: 100, txs: 5000 } };
  const { DRAFT_DISCLOSURE } = await import("./site/assets/callouts.js");
  const pick = { window: "2026-09-24T18:00:00Z", time: "2026-09-24T21:45:00Z", checked: "2026-09-24T21:40:00Z", mint: callout.mint, creator: callout.creator, name: "Asset Cat", symbol: "ASSCAT", stats: callout.stats,
    draft: `Asset Cat ($ASSCAT): no red flags in 12 on-chain checks at 21:40 UTC. 40 holders. ${DRAFT_DISCLOSURE}` };
  await overlay(site, { fetchImpl: fetchWith({ "launches.json": { launches: [] }, "callouts.json": { callouts: [callout], picks: [pick] } }), repo: "o/r", token: "t", log: quiet, sleep: noWait });
  const over = JSON.parse(fs.readFileSync(path.join(site, "callouts.json"), "utf8"));
  ok("valid data is written over site/assets: Popcat's coins, and its pick with them", over.callouts.length === 1 && over.picks.length === 1 && over.picks[0].draft === pick.draft);
  const launchOf = (over = {}) => ({ time: "2026-09-24T20:00:00Z", venue: "pumpfun", name: "Asset Cat", symbol: "ASSCAT", tagline: "A launch record for the overlay test.", trend: { title: "x", source: "google-trends" },
    mint: snap.apiRow.mint, creator: "FFWtrEQ4B4PKQoVuHYzZq8FabGkVatYzDpEVHsK5rrhF", tx: fixture("pumpfun/create-v2-samples.json").samples[0].signature, quote: { symbol: "SOL", mint: "So11111111111111111111111111111111111111112" }, devBuy: { sol: 0 }, costSol: 0.005, kitten: "black", ...over });
  const said = [];
  const good = launchOf({ mint: fixture("pumpfun/create-v2-samples.json").samples[1].accounts[0].pubkey });
  const r2 = await overlay(site, { fetchImpl: fetchWith({ "launches.json": { launches: [{ time: "x" }, good] }, "callouts.json": 404 }), repo: "o/r", token: "t", log: (l) => said.push(l), sleep: noWait });
  const back = JSON.parse(fs.readFileSync(path.join(site, "launches.json"), "utf8"));
  ok("one entry that does not validate never stops the deploy: it is left out and named, the entries that pass are published", r2["launches.json"] === "overlaid" && back.launches.length === 1 && back.launches[0].mint === good.mint && said.some((l) => /left out/.test(l) && /time/.test(l)), said.join(" | "));
  ok("what is written passes the site's own check with no problem at all (test-bots-data.mjs runs next)", (await import("./site/assets/launches.js")).validateLaunches(back).problems.length === 0);
  await overlay(site, { fetchImpl: fetchWith({ "launches.json": { launches: [launchOf()] }, "callouts.json": { callouts: [callout], picks: [pick] } }), repo: "o/r", token: "t", log: quiet, sleep: noWait });
  const cc = JSON.parse(fs.readFileSync(path.join(site, "callouts.json"), "utf8"));
  ok("a callout or a pick on a CashCat coin is left out, never published", cc.callouts.length === 0 && cc.picks.length === 0);
  ok("a file that is not the right shape at all fails the deploy, rather than publish an empty floor", await throwsClause(() => overlay(site, { fetchImpl: fetchWith({ "launches.json": { entries: [] }, "callouts.json": 404 }), repo: "o/r", token: "t", log: quiet, sleep: noWait }), /not a \{ "launches"/));
  ok("an API that keeps failing fails the deploy instead of publishing an empty floor", await throwsClause(() => overlay(site, { fetchImpl: fetchWith({ "launches.json": 500, "callouts.json": 404 }), repo: "o/r", token: "t", log: quiet, sleep: noWait }), /answered 500/));
  let n = 0;
  const flaky = async (url, init) => (/launches/.test(url) && n++ === 0 ? response(502, "{}") : fetchWith({ "launches.json": { launches: [good] }, "callouts.json": 404 })(url, init));
  ok("a transient API error is retried, and the deploy goes on", (await overlay(site, { fetchImpl: flaky, repo: "o/r", token: "t", log: quiet, sleep: noWait }))["launches.json"] === "overlaid" && n === 2);
  ok("fetchDataFile answers null for a missing file", (await fetchDataFile({ fetchImpl: fetchWith({ "launches.json": 404 }), repo: "o/r", token: "", file: "launches.json" })) === null);
}

fs.rmSync(tmp, { recursive: true, force: true });
done();
