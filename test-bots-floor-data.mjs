/**
 * THE FLOOR-DATA BRANCH: CHECKOUT, PUSH WITH A RACE, AND THE DEPLOY'S OVERLAY.
 *
 * Run against local bare git repositories (no network): the branch is started as an orphan
 * when it does not exist; a push commits only the files it is told to; nothing to commit is
 * "changed=false"; two bots pushing at once both land, the second by fetching and rebasing (they
 * write different files); a push of Popcat's memory alone is committed but is no change to the
 * site, so it deploys nothing. The overlay reads each file through the GitHub API (scripted here):
 * a file or branch that does not exist keeps main's copy, anything that does not validate or any
 * other error fails the deploy, and valid data is written over site/assets.
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
  const r = await overlay(site, { fetchImpl: fetchWith({ "launches.json": 404, "callouts.json": 404 }), repo: "o/r", token: "tok123", log: quiet });
  ok("no floor-data yet: main's empty copies are kept", r["launches.json"] === "kept" && fs.readFileSync(path.join(site, "callouts.json"), "utf8") === empty.callouts);
  ok("the API is asked for each file on floor-data, with the job token", calls.every((c) => /^https:\/\/api\.github\.com\/repos\/o\/r\/contents\/(launches|callouts)\.json\?ref=floor-data$/.test(c.url) && c.init.headers.authorization === "Bearer tok123"));
  const snap = fixture("popcat/snapshots.json").snapshots[0];
  const callout = { time: "2026-09-24T21:40:00Z", venue: "pumpfun", mint: snap.apiRow.mint, creator: snap.apiRow.creator, name: snap.apiRow.name, symbol: snap.apiRow.symbol, cat: { field: "name", word: "cat" }, checks: snap.evaluatedThen.checks.map(({ id, value }) => ({ id, result: "pass", value })) };
  await overlay(site, { fetchImpl: fetchWith({ "launches.json": { launches: [] }, "callouts.json": { callouts: [callout] } }), repo: "o/r", token: "t", log: quiet });
  ok("valid data is written over site/assets", JSON.parse(fs.readFileSync(path.join(site, "callouts.json"), "utf8")).callouts.length === 1);
  ok("data that does not validate fails the deploy", await throwsClause(() => overlay(site, { fetchImpl: fetchWith({ "launches.json": { launches: [{ time: "x" }] }, "callouts.json": 404 }), repo: "o/r", token: "t", log: quiet }), /does not validate/));
  ok("any other failure fails the deploy instead of publishing an empty floor", await throwsClause(() => overlay(site, { fetchImpl: fetchWith({ "launches.json": 500, "callouts.json": 404 }), repo: "o/r", token: "t", log: quiet }), /answered 500/));
  ok("a callout on a CashCat coin fails the deploy", await throwsClause(() => overlay(site, { fetchImpl: fetchWith({ "launches.json": { launches: [{ time: "2026-09-24T20:00:00Z", venue: "pumpfun", name: "Asset Cat", symbol: "ASSCAT", tagline: "A launch record for the overlay test.", trend: { title: "x", source: "google-trends" }, mint: snap.apiRow.mint, creator: "FFWtrEQ4B4PKQoVuHYzZq8FabGkVatYzDpEVHsK5rrhF", tx: fixture("pumpfun/create-v2-samples.json").samples[0].signature, quote: { symbol: "SOL", mint: "So11111111111111111111111111111111111111112" }, devBuy: { sol: 0 }, costSol: 0.005, kitten: "black" }] }, "callouts.json": { callouts: [callout] } }), repo: "o/r", token: "t", log: quiet }), /CashCat/));
  ok("fetchDataFile answers null for a missing file", (await fetchDataFile({ fetchImpl: fetchWith({ "launches.json": 404 }), repo: "o/r", token: "", file: "launches.json" })) === null);
}

fs.rmSync(tmp, { recursive: true, force: true });
done();
