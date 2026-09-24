#!/usr/bin/env node
/**
 * THE BOTS' DATA LIVES ON ITS OWN BRANCH, floor-data, NOT ON main.
 *
 *   node bots/floor-data.mjs checkout <dir>
 *       Clone the floor-data branch into <dir> (depth 1), or start it as an empty orphan
 *       branch when it does not exist yet.
 *   node bots/floor-data.mjs push <dir> --message "<msg>" --files a.json,b.json
 *       Commit exactly those files if they changed, and push. A push that loses a race (another
 *       bot pushed first) fetches, rebases and tries again, up to five times: each bot writes only
 *       its own files, so a rebase never conflicts. Prints changed=true|false, and writes it to
 *       $GITHUB_OUTPUT when that is set.
 *   node bots/floor-data.mjs overlay <site-assets-dir>
 *       For the deploy: read launches.json and callouts.json from floor-data through the GitHub
 *       API and write them over <site-assets-dir>'s copies, after validating them with the
 *       site's own validators. A branch or file that does not exist yet leaves main's (empty)
 *       copy; any other failure fails the deploy, so a network hiccup can never publish an empty
 *       floor over real data.
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
  const staged = git(["diff", "--cached", "--quiet"], { cwd: dir, allowFail: true });
  if (staged.status === 0) return { changed: false };
  git([...BOT_IDENTITY, "commit", "--quiet", "-m", message], { cwd: dir });
  for (let i = 1; i <= attempts; i++) {
    const r = git(["push", "--quiet", "origin", `HEAD:refs/heads/${BRANCH}`], { cwd: dir, remote, token, allowFail: true });
    if (r.status === 0) return { changed: true, attempts: i };
    /* Someone pushed first: take their commits and put ours on top. The bots touch disjoint files. */
    const f = git(["fetch", "--quiet", "origin", BRANCH], { cwd: dir, remote, token, allowFail: true });
    if (f.status !== 0) continue;
    git([...BOT_IDENTITY, "rebase", "--quiet", "FETCH_HEAD"], { cwd: dir });
  }
  throw new Error(`could not push to ${BRANCH} after ${attempts} attempts`);
}

/** Read one file from floor-data through the GitHub contents API; null when it does not exist. */
export async function fetchDataFile({ fetchImpl = globalThis.fetch, repo, token, file }) {
  const url = `https://api.github.com/repos/${repo}/contents/${file}?ref=${BRANCH}`;
  const r = await fetchImpl(url, { headers: { accept: "application/vnd.github.raw+json", "x-github-api-version": "2022-11-28", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`the GitHub API answered ${r.status} for ${file} on ${BRANCH}`);
  return JSON.parse(await r.text());
}

export async function overlay(siteAssets, { fetchImpl, repo, token, log = console.log }) {
  const results = {};
  for (const file of DATA_FILES) {
    const data = await fetchDataFile({ fetchImpl, repo, token, file });
    if (data === null) { log(`${file}: not on ${BRANCH} yet; keeping main's copy`); results[file] = "kept"; continue; }
    const v = file === "launches.json" ? validateLaunches(data) : validateCallouts(data, { exclude: results.launches ?? [] });
    if (v.problems.length) throw new Error(`${file} on ${BRANCH} does not validate: ${v.problems.join(" | ")}`);
    if (file === "launches.json") results.launches = v.launches;
    fs.writeFileSync(path.join(siteAssets, file), JSON.stringify(data, null, 2) + "\n");
    log(`${file}: ${(v.launches ?? v.callouts).length} entries overlaid from ${BRANCH}`);
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
      console.log(`changed=${r.changed}`);
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
