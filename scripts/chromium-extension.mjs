/**
 * LOAD THE EXTENSION IN CHROMIUM, THE WAY A PERSON WOULD, FOR THE SCRIPTS THAT NEED A BROWSER.
 *
 * Shared by scripts/verify-download.mjs and scripts/store-screenshots.mjs. Neither runs in
 * `npm test`: Playwright is not a dependency of this repository. It is found, in order, at
 * $PLAYWRIGHT_MODULE, in this repository's node_modules, or at the global install
 * /opt/node22/lib/node_modules/playwright; Chromium at $CHROMIUM_PATH, /opt/pw-browsers/chromium,
 * or wherever Playwright keeps its own. It runs in Chromium's new headless mode, where
 * extensions load; HEADFUL=1 opens a window instead.
 *
 * An extension loaded with --load-extension gets its ID the way "Load unpacked" gives it one:
 * from the folder's path (the manifest has no "key"). So the ID, and with it the settings the
 * browser keeps for it, stay the same as long as the folder does.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadPlaywright() {
  const bases = [process.env.PLAYWRIGHT_MODULE, path.join(ROOT, "package.json"), "/opt/node22/lib/node_modules/playwright"].filter(Boolean);
  for (const base of bases) {
    try { return createRequire(base)("playwright"); } catch { /* next */ }
  }
  throw new Error("Playwright is not installed: `npm i -g playwright && npx playwright install chromium`, or set PLAYWRIGHT_MODULE");
}

export function chromiumPath() {
  for (const p of [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium"]) if (p && fs.existsSync(p)) return p;
  return undefined;   // Playwright's own Chromium
}

/** A fresh profile folder, removed by the caller. */
export const tempProfile = (label = "profile") => fs.mkdtempSync(path.join(os.tmpdir(), `cia-${label}-`));

/**
 * Chromium with only this extension loaded, on a persistent profile (so its storage outlives
 * a restart when the same profile is reused). Returns { context, id, worker }.
 */
export async function launchWithExtension(extensionDir, { profile, viewport = { width: 1280, height: 800 } } = {}) {
  const { chromium } = loadPlaywright();
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chromiumPath(),
    headless: process.env.HEADFUL !== "1",
    viewport,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, "--no-first-run", "--no-default-browser-check"],
  });
  const worker = await serviceWorker(context);
  return { context, worker, id: new URL(worker.url()).host };
}

/** The extension's service worker (not `exclude`, the one a reload replaced), once its chrome.* bindings are there. */
export async function serviceWorker(context, { timeout = 20_000, exclude = null } = {}) {
  const deadline = Date.now() + timeout;
  const fits = (w) => w && w !== exclude && w.url().startsWith("chrome-extension://");
  let worker = context.serviceWorkers().find(fits);
  while (!worker && Date.now() < deadline) {
    const next = await context.waitForEvent("serviceworker", { timeout: Math.max(1, deadline - Date.now()) }).catch(() => null);
    if (fits(next)) worker = next;
  }
  if (!worker) throw new Error("the extension's service worker never started");
  while (Date.now() < deadline) {
    const ready = await worker.evaluate(() => typeof chrome !== "undefined" && !!chrome.runtime?.id).catch(() => false);
    if (ready) return worker;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("the service worker started but its chrome.* APIs never appeared");
}

/** chrome://extensions, with a caller for chrome.developerPrivate (what its buttons use). */
export async function extensionsPage(context) {
  const page = await context.newPage();
  await page.goto("chrome://extensions/");
  await page.waitForFunction(() => typeof chrome !== "undefined" && !!chrome.developerPrivate, null, { timeout: 10_000 });
  const call = (api, fn, ...args) => page.evaluate(([api, fn, args]) => new Promise((resolve, reject) => {
    chrome[api][fn](...args, (result) => (chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(result)));
  }), [api, fn, args]);
  return {
    page,
    developerMode: (on) => call("developerPrivate", "updateProfileConfiguration", { inDeveloperMode: on }),
    info: (id) => call("developerPrivate", "getExtensionInfo", id),
    reload: (id) => call("developerPrivate", "reload", id, { failQuietly: false }),
  };
}

/** Uninstall the extension, as its Remove button does, without the confirmation dialog: the
    page's own management.uninstall waits on that dialog, so the extension removes itself. */
export async function uninstall(context, worker, id) {
  worker.evaluate(() => chrome.management.uninstallSelf({ showConfirmDialog: false })).catch(() => {});   // the worker dies with it
  const ext = await extensionsPage(context);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const gone = await ext.info(id).then(() => false, (e) => /No such extension/i.test(e.message));
    if (gone) { await ext.page.close(); return; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("the extension was still installed ten seconds after it was removed");
}
