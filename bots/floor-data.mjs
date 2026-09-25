#!/usr/bin/env node
/**
 * THE BOTS' DATA LIVES ON ITS OWN BRANCH, floor-data, NOT ON main.
 *
 *   node bots/floor-data.mjs checkout <dir>
 *       Clone the floor-data branch into <dir> (depth 1), or start it as an empty orphan
 *       branch when it does not exist yet.
 *   node bots/floor-data.mjs push <dir> --message "<msg>" --files a.json,b.json
 *       Commit exactly those files if they changed, and push; when none of them changed (a dry
 *       run writes none), commit nothing at all, so a dry run never starts or touches the
 *       branch. A push that loses a race (another
 *       bot pushed first) fetches, rebases and tries again, up to five times: each bot writes only
 *       its own files, so a rebase never conflicts. Prints changed=true|false — true only when a
 *       file the site shows (launches.json, callouts.json) changed, so Popcat's memory alone
 *       never triggers a deploy — and writes it to $GITHUB_OUTPUT when that is set.
 *   node bots/floor-data.mjs overlay <site-assets-dir>
 *       For the deploy: read launches.json and callouts.json (every coin Popcat checked, and its
 *       picks) from floor-data through the GitHub API and write over <site-assets-dir>'s copies
 *       the entries that pass the site's own validators; an entry that does not (or a coin or a
 *       pick of CashCat's) is left out and named in the log, so one bad entry never stops main's deploy. A branch or file that does
 *       not exist yet leaves main's (empty) copy. A 429 or 5xx is retried; an API that keeps
 *       failing, or a file that is not JSON of the right shape at all, fails the deploy, so the
 *       live floor stays as it was and is never replaced by an empty one.
 *
 * Authentication in Actions is the job's GITHUB_TOKEN (GH_TOKEN), sent as an HTTP header for
 * each git command (never written into .git/config or a URL) and as a bearer token to the API.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateLaunches } from "../site/assets/launches.js";
import { validateCallouts } from "../site/assets/callouts.js";
import { launchToFile, calloutToFile, pickToFile } from "./lib/data.mjs";

export const BRANCH = "floor-data";
export const DATA_FILES = Object.freeze(["launches.json", "callouts.json"]);
const BOT_IDENTITY = ["-c", "user.name=cia-floor-bot", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"];

function authArgs(remote, token) {
  if (!token || !/^https:\/\/github\.com\//.test(remote)) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
}

function git(args, { cwd, remote, token, allowFail = false } = {}) {
  const r = spawnSync("git", [...authArgs(remote ?? "", token), ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.filter((a) => !a.startsWith("http.")).slice(0, 3).join(" ")} failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ")}`);
  return r;
}

export function remoteUrl(env = process.env) {
  if (env.FLOOR_DATA_REMOTE) return env.FLOOR_DATA_REMOTE;
  if (!env.GITHUB_REPOSITORY) throw new Error("GITHUB_REPOSITORY is not set (or set FLOOR_DATA_REMOTE)");
  return `https://github.com/${env.GITHUB_REPOSITORY}.git`;
}

export function checkout(dir, { remote, token }) {
  fs.rmSync(dir, { recursive: true, force: true });
  const probe = git(["ls-remote", "--exit-code", "--heads", remote, BRANCH], { remote, token, allowFail: true });
  if (probe.status === 0) {
    git(["clone", "--quiet", "--depth", "1", "--branch", BRANCH, "--single-branch", remote, dir], { remote, token });
    return { created: false };
  }
  if (probe.status !== 2) throw new Error(`could not ask ${remote} for ${BRANCH}: ${probe.stderr.trim()}`);
  fs.mkdirSync(dir, { recursive: true });
  git(["init", "--quiet", "-b", BRANCH], { cwd: dir });
  git(["remote", "add", "origin", remote], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "# floor-data\n\nThe Cat Intelligence Agency's bots write their data here (launches.json, callouts.json), so main is not committed to on every run. The site's deploy bakes these files into the published floor. Nothing here is code.\n");
  return { created: true };
}

export function push(dir, { files, message, token, remote = null, attempts = 5 }) {
  remote = remote ?? git(["remote", "get-url", "origin"], { cwd: dir }).stdout.trim();
  const list = files.filter((f) => fs.existsSync(path.join(dir, f)));
  if (fs.existsSync(path.join(dir, "README.md"))) list.push("README.md");
  git(["add", "--", ...list], { cwd: dir });
  const staged = git(["diff", "--cached", "--name-only"], { cwd: dir }).stdout.split("\n").filter(Boolean);
  /* Only a change to a file the bot was told to push is worth a commit: the README of a branch
     started this run is not, so a dry run never creates floor-data. */
  if (!staged.some((f) => files.includes(f))) return { changed: false, committed: false };
  const changed = staged.some((f) => DATA_FILES.includes(f));
  git([...BOT_IDENTITY, "commit", "--quiet", "-m", message], { cwd: dir });
  for (let i = 1; i <= attempts; i++) {
    const r = git(["push", "--quiet", "origin", `HEAD:refs/heads/${BRANCH}`], { cwd: dir, remote, token, allowFail: true });
    if (r.status === 0) return { changed, committed: true, attempts: i };
    /* Someone pushed first: take their commits and put ours on top. The bots touch disjoint files. */
    const f = git(["fetch", "--quiet", "origin", BRANCH], { cwd: dir, remote, token, allowFail: true });
    if (f.status !== 0) continue;
    git([...BOT_IDENTITY, "rebase", "--quiet", "FETCH_HEAD"], { cwd: dir });
  }
  throw new Error(`could not push to ${BRANCH} after ${attempts} attempts`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read one file from floor-data through the GitHub contents API; null when it does not exist.
 *  A network failure, a 429 or a 5xx is tried again (three tries in all); anything else throws. */
export async function fetchDataFile({ fetchImpl = globalThis.fetch, repo, token, file, attempts = 3, sleep = wait }) {
  const url = `https://api.github.com/repos/${repo}/contents/${file}?ref=${BRANCH}`;
  for (let i = 1; ; i++) {
    let r = null, why = "";
    try { r = await fetchImpl(url, { headers: { accept: "application/vnd.github.raw+json", "x-github-api-version": "2022-11-28", ...(token ? { authorization: `Bearer ${token}` } : {}) } }); }
    catch (e) { why = `the GitHub API could not be reached for ${file} on ${BRANCH} (${e.message})`; }
    if (r?.status === 404) return null;
    if (r?.ok) {
      const data = JSON.parse(await r.text());
      if (data === null) throw new Error(`${file} on ${BRANCH} is null, not a data file`);
      return data;
    }
    if (r) why = `the GitHub API answered ${r.status} for ${file} on ${BRANCH}`;
    if ((r && r.status !== 429 && r.status < 500) || i >= attempts) throw new Error(why);
    await sleep(2_000 * i);
  }
}

export async function overlay(siteAssets, { fetchImpl, repo, token, log = console.log, sleep = wait }) {
  const results = {};
  for (const file of DATA_FILES) {
    const data = await fetchDataFile({ fetchImpl, repo, token, file, sleep });
    if (data === null) { log(`${file}: not on ${BRANCH} yet; keeping main's copy`); results[file] = "kept"; continue; }
    const key = file === "launches.json" ? "launches" : "callouts";
    if (typeof data !== "object" || Array.isArray(data) || !Array.isArray(data[key])) throw new Error(`${file} on ${BRANCH} is not a { "${key}": [...] } file`);
    const v = key === "launches" ? validateLaunches(data) : validateCallouts(data, { exclude: results.launches ?? [] });
    /* The site would skip these same entries; they are left out here and named, so one bad
       entry never stops the deploy of main and the site's tests run on what is published. */
    for (const p of v.problems) log(`WARNING ${file}: left out — ${p}`);
    if (key === "launches") results.launches = v.launches;
    const out = key === "launches" ? { launches: v.launches.map(launchToFile) } : { callouts: v.callouts.map(calloutToFile), picks: v.picks.map(pickToFile) };
    fs.writeFileSync(path.join(siteAssets, file), JSON.stringify(out, null, 2) + "\n");
    log(`${file}: ${v[key].length} entries${key === "callouts" ? ` and ${v.picks.length} pick(s)` : ""} overlaid from ${BRANCH}${v.problems.length ? `; ${v.problems.length} left out` : ""}`);
    results[file] = "overlaid";
  }
  return results;
}

/* ── the command line ─────────────────────────────────────────────────────────────────── */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, target, ...rest] = process.argv.slice(2);
  const opt = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : null; };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  try {
    if (cmd === "checkout") {
      const r = checkout(path.resolve(target), { remote: remoteUrl(), token });
      console.log(r.created ? `${BRANCH} does not exist yet: started it empty in ${target}` : `${BRANCH} checked out in ${target}`);
    } else if (cmd === "push") {
      const r = push(path.resolve(target), { files: (opt("--files") ?? "").split(",").filter(Boolean), message: opt("--message") ?? "floor-data: update", token, remote: remoteUrl() });
      console.log(`committed=${r.committed} changed=${r.changed}`);
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${r.changed}\n`);
    } else if (cmd === "overlay") {
      if (!process.env.GITHUB_REPOSITORY) throw new Error("GITHUB_REPOSITORY is not set");
      await overlay(path.resolve(target), { repo: process.env.GITHUB_REPOSITORY, token });
    } else {
      console.error("usage: floor-data.mjs checkout <dir> | push <dir> --files a,b --message m | overlay <site/assets>");
      process.exitCode = 2;
    }
  } catch (e) {
    console.error(`floor-data: ${e.message.replaceAll(token || "\u0000", "[redacted]")}`);
    process.exitCode = 1;
  }
}
