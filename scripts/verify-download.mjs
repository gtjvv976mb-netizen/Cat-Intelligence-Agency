#!/usr/bin/env node
/**
 * PROOF THAT THE DOWNLOAD WORKS: THE ZIP, UNZIPPED AND LOADED THE WAY A PERSON LOADS IT.
 *
 *   1. Unzips cat-intelligence-agency-extension.zip into a temporary folder (with the system's
 *      `unzip` when there is one, as a person would; otherwise with scripts/zip.mjs), and finds
 *      manifest.json at the folder's root.
 *   2. Starts Chromium with only that folder loaded (--disable-extensions-except,
 *      --load-extension), finds the extension's service worker and its ID, and checks that the
 *      browser read the zip's own name and version.
 *   3. Turns on Developer mode at chrome://extensions and reloads the extension, so Chrome's own
 *      error list for it (the list its Errors button opens) covers its whole start-up.
 *   4. Opens every page it ships (the popup and the options page its manifest names, and any
 *      other .html, such as the setup page), and fails on any console error, any uncaught error,
 *      any of its own files that does not load, and any entry in that error list.
 *   5. Unless --quick, checks what the Downloads page says about updating and removing it:
 *      the folder replaced in place and reloaded keeps the same ID and the settings; so does a
 *      browser restart; the same zip loaded from a different folder is a different extension,
 *      with none of them; removing it deletes them.
 *
 * Usage: npm run build && node scripts/package.mjs && node scripts/verify-download.mjs
 *        node scripts/verify-download.mjs [path/to/the.zip] [--quick] [--keep]
 * Needs Playwright and a Chromium (see scripts/chromium-extension.mjs). Not part of `npm test`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readZip } from "./zip.mjs";
import { EXTENSION_ZIP, SITE_DOWNLOADS } from "./package.mjs";
import { launchWithExtension, serviceWorker, extensionsPage, tempProfile, uninstall, extensionPages } from "./chromium-extension.mjs";

const argv = process.argv.slice(2);
const zipPath = path.resolve(argv.find((a) => !a.startsWith("--")) ?? path.join(SITE_DOWNLOADS, EXTENSION_ZIP));
const quick = argv.includes("--quick"), keep = argv.includes("--keep");
const MARKER = "cia-verify-download";
const SETTLE_MS = 3_000;

const failures = [], notes = [];
const fail = (what) => { failures.push(what); console.log(`  FAIL ${what}`); };
const pass = (what) => console.log(`  ok   ${what}`);
const check = (cond, what, detail = "") => (cond ? pass(what + (detail ? `  — ${detail}` : "")) : fail(what + (detail ? `  — ${detail}` : "")));
const step = (title) => console.log(`\n${title}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(zipPath)) {
  console.error(`verify-download: ${zipPath} is not there. Run \`npm run build && node scripts/package.mjs\` first.`);
  process.exit(1);
}
const work = fs.mkdtempSync(path.join(os.tmpdir(), "cia-verify-"));
const folderName = path.basename(zipPath).replace(/\.zip$/i, "");

/** Unzip into dir, as a person would: the system's unzip if it is there. Returns which one ran. */
function unzipInto(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const sys = spawnSync("unzip", ["-q", zipPath, "-d", dir], { encoding: "utf8" });
  if (sys.status === 0) return "the system's unzip";
  if (sys.error?.code !== "ENOENT") throw new Error(`unzip failed: ${sys.stderr || sys.status}`);
  for (const e of readZip(fs.readFileSync(zipPath))) {
    const to = path.join(dir, ...e.name.split("/"));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, e.data);
  }
  return "scripts/zip.mjs (no system unzip here)";
}

/** Open an extension page and collect what goes wrong on it. */
async function openPage(context, id, file) {
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
    else if (m.type() === "warning") notes.push(`${file}: console.warn: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
  page.on("requestfailed", (r) => {
    if (r.url().startsWith(`chrome-extension://${id}/`)) problems.push(`its own file did not load: ${r.url()} (${r.failure()?.errorText})`);
    else notes.push(`${file}: a request failed: ${r.url()} (${r.failure()?.errorText})`);
  });
  const response = await page.goto(`chrome-extension://${id}/${file}`, { waitUntil: "load" });
  await sleep(SETTLE_MS);
  const shown = await page.evaluate(() => ({ title: document.title, words: (document.body?.innerText || "").trim().length }));
  return { page, problems, shown, status: response?.status() ?? null };
}

const readMarker = (worker) => worker.evaluate((k) => chrome.storage.local.get(k).then((r) => r[k] ?? null), MARKER);

let context;
try {
  step(`1. THE ZIP: ${path.relative(process.cwd(), zipPath) || zipPath}`);
  const zipped = readZip(fs.readFileSync(zipPath));
  const zipManifest = JSON.parse(zipped.find((e) => e.name === "manifest.json")?.data.toString("utf8") ?? "null");
  check(zipManifest !== null, "manifest.json is at the zip's root", zipManifest ? `"${zipManifest.name}" ${zipManifest.version}` : "missing");
  const folder = path.join(work, "unzipped", folderName);
  const how = unzipInto(folder);
  check(fs.existsSync(path.join(folder, "manifest.json")), `unzipped with ${how} into a folder with manifest.json in it`, folder);
  check(!fs.readdirSync(folder).some((f) => f.startsWith("_")), "no file or folder the browser reserves (a leading underscore)");

  step("2. LOADED IN CHROMIUM, AS LOAD UNPACKED LOADS IT");
  const profile = tempProfile("verify");
  let launched = await launchWithExtension(folder, { profile });
  context = launched.context;
  const { id } = launched;
  let worker = launched.worker;
  const ua = await worker.evaluate(() => navigator.userAgent);
  notes.push(`browser: ${(ua.match(/(Headless)?Chrome\/[\d.]+/) || [ua])[0]}`);
  const seen = await worker.evaluate(() => ({ name: chrome.runtime.getManifest().name, version: chrome.runtime.getManifest().version }));
  check(/^[a-p]{32}$/.test(id), "its service worker started, with an extension ID", id);
  check(seen.name === zipManifest?.name && seen.version === zipManifest?.version, "the browser runs the zip's own manifest", `"${seen.name}" ${seen.version}`);
  await sleep(1_000);
  const opened = context.pages().map((p) => p.url()).filter((u) => u.startsWith(`chrome-extension://${id}/`)).map((u) => u.slice(`chrome-extension://${id}/`.length));
  notes.push(`on install it opened ${opened.length ? opened.join(", ") : "no page of its own"}`);

  step("3. DEVELOPER MODE ON, AND A RELOAD, SO CHROME'S ERROR LIST SEES ITS START-UP");
  const ext = await extensionsPage(context);
  await ext.developerMode(true);
  await ext.reload(id);
  worker = await serviceWorker(context, { exclude: worker });
  check(new URL(worker.url()).host === id, "reloaded, with the same ID");
  const info0 = await ext.info(id);
  notes.push(`chrome://extensions lists it as "${info0.name}" ${info0.version}, ${info0.location.toLowerCase()}, from ${info0.prettifiedPath}`);

  step("4. ITS PAGES OPEN WITH NO ERROR");
  const pages = extensionPages(folder);
  check(pages.popup !== null && pages.all.includes(pages.popup), "the manifest names a popup, and it is in the zip", pages.popup ?? "none");
  for (const file of pages.all) {
    const { page, problems, shown, status } = await openPage(context, id, file);
    check(problems.length === 0 && shown.words > 0 && shown.title.trim().length > 0 && (status === null || status === 200),
      `${file} opens, draws "${shown.title}" (${shown.words} characters of text), with no console error or uncaught error`, problems.join(" | "));
    await page.close();
  }
  const info = await ext.info(id);
  const listed = [...info.runtimeErrors.map((e) => `${e.severity}: ${e.message} (${e.source})`), ...info.manifestErrors.map((e) => `manifest: ${e.message}`), ...(info.installWarnings ?? []).map((w) => `install warning: ${w}`)];
  check(listed.length === 0, "Chrome's error list for the extension is empty: no Errors button on its card", listed.join(" | "));

  if (!quick) {
    step("5. UPDATE AND REMOVE, AS THE DOWNLOADS PAGE DESCRIBES THEM");
    const nonce = randomUUID();
    await worker.evaluate(([k, v]) => chrome.storage.local.set({ [k]: v }), [MARKER, nonce]);
    check(await readMarker(worker) === nonce, "a setting is saved (a marker in its storage)");

    unzipInto(folder);   // the folder replaced by a fresh copy, at the same path
    await ext.reload(id);
    worker = await serviceWorker(context, { exclude: worker });
    check(new URL(worker.url()).host === id && await readMarker(worker) === nonce, "folder replaced in place, reload clicked: the same ID, and the setting kept");

    await context.close();
    launched = await launchWithExtension(folder, { profile });
    context = launched.context; worker = launched.worker;
    check(launched.id === id && await readMarker(worker) === nonce, "browser restarted: the same ID, and the setting kept");
    await context.close();

    const elsewhere = path.join(work, "somewhere-else", folderName);
    unzipInto(elsewhere);
    launched = await launchWithExtension(elsewhere, { profile });
    context = launched.context; worker = launched.worker;
    check(launched.id !== id && await readMarker(worker) === null, "the same zip loaded from a different folder: a different ID, with none of the settings", launched.id);
    await context.close();

    launched = await launchWithExtension(folder, { profile });
    context = launched.context; worker = launched.worker;
    check(launched.id === id && await readMarker(worker) === nonce, "back in the first folder: the same ID, and the setting still there");
    await uninstall(context, worker, id);
    await context.close();
    launched = await launchWithExtension(folder, { profile });
    context = launched.context; worker = launched.worker;
    check(launched.id === id && await readMarker(worker) === null, "removed, then loaded again from the same folder: the same ID, and its settings gone");
  }
  if (!keep) fs.rmSync(profile, { recursive: true, force: true });
} catch (e) {
  fail(`the check could not finish: ${e.message}`);
} finally {
  await context?.close().catch(() => {});
  if (!keep) fs.rmSync(work, { recursive: true, force: true });
  else console.log(`\nkept ${work}`);
}

if (notes.length) console.log(`\nnotes\n${notes.map((n) => `  · ${n}`).join("\n")}`);
console.log(failures.length ? `\nFAILED: ${failures.length} check${failures.length === 1 ? "" : "s"}` : "\nThe download works: unzipped, loaded, every page opened with no error.");
process.exit(failures.length ? 1 : 0);
