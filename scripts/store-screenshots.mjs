#!/usr/bin/env node
/**
 * THE CHROME WEB STORE'S SCREENSHOTS: 1280 × 800, OF THE EXTENSION AS BUILT.
 *
 * Loads dist/ in Chromium (as scripts/verify-download.mjs does), and captures, as JPEG (the store
 * takes JPEG or 24-bit PNG, and a JPEG has no alpha channel to refuse):
 *   popup-1280x800.jpg       the popup the manifest names, drawn at its own width on the agency's
 *                            ink, at 1.5×
 *   options-1280x800.jpg     the options page the manifest names, as the browser opens it
 *   <page>-1280x800.jpg      every other page it ships (today, welcome.html: the setup page)
 * The popup and the options page are the two the listing needs; the others are spare.
 *
 * Run it after the extension branch is merged, so the pictures are the renamed extension's:
 *   npm run build && node scripts/store-screenshots.mjs [--out docs/chrome-web-store/screenshots]
 * Needs Playwright and a Chromium (see scripts/chromium-extension.mjs). The pictures show a
 * fresh install with nothing set up: no key, no wallet, no strategy.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchWithExtension, tempProfile, extensionPages } from "./chromium-extension.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
const OUT = path.resolve(outIdx >= 0 ? argv[outIdx + 1] : path.join(ROOT, "docs", "chrome-web-store", "screenshots"));
const DIST = path.join(ROOT, "dist");
const SIZE = { width: 1280, height: 800 };

if (!fs.existsSync(path.join(DIST, "manifest.json"))) {
  console.error("store-screenshots: dist/ has no manifest.json. Run `npm run build` first.");
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const pages = extensionPages(DIST);
const SHOTS = [
  /* The popup is narrow (400 px today): it is centred on the agency's ink and drawn at 1.5×. */
  ...(pages.popup ? [{ file: "popup-1280x800.jpg", page: pages.popup,
    css: "html{width:auto!important;min-height:100%;background:#0b0716!important}body{margin:24px auto!important;zoom:1.5;box-shadow:0 0 0 2px #14f195,10px 10px 0 2px rgba(0,0,0,.55)}" }] : []),
  ...(pages.options ? [{ file: "options-1280x800.jpg", page: pages.options }] : []),
  ...pages.all.filter((p) => p !== pages.popup && p !== pages.options).map((p) => ({ file: `${p.replace(/\.html$/i, "").replace(/\//g, "-")}-1280x800.jpg`, page: p })),
];

const profile = tempProfile("store");
const problems = [];
const { context, id } = await launchWithExtension(DIST, { profile, viewport: SIZE });
try {
  for (const shot of SHOTS) {
    const page = await context.newPage();
    page.on("pageerror", (e) => problems.push(`${shot.page}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${shot.page}: ${m.text()}`); });
    await page.setViewportSize(SIZE);
    await page.goto(`chrome-extension://${id}/${shot.page}`, { waitUntil: "load" });
    if (shot.css) await page.addStyleTag({ content: shot.css });
    await page.waitForTimeout(2_000);
    const file = path.join(OUT, shot.file);
    await page.screenshot({ path: file, type: "jpeg", quality: 92, clip: { x: 0, y: 0, ...SIZE } });
    console.log(`wrote ${path.relative(ROOT, file)}`);
    await page.close();
  }
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
if (problems.length) {
  console.error(`the pages reported errors:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
