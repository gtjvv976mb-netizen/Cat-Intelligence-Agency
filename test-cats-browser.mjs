/**
 * THE BUILT EXTENSION IN A REAL BROWSER: EVERY TAB CLICKED, NO ERROR.
 *
 * Loads dist/ (built first when it is missing or older than the sources) into Chromium through
 * Playwright, the way a person loads it unpacked, and:
 *   · opens the popup and clicks through its five tabs — CoinMarketCat, Snipurr, Popcat, CashCat,
 *     Crying Cat — each showing its own cards and its sprite;
 *   · on Crying Cat, pastes a bad input (refused in the page by the worker's strict check);
 *   · on CashCat, types a coin, has the worker judge it, and has the worker draw its logo on an
 *     OffscreenCanvas in the real service worker, from the extension's own files;
 *   · opens Options and the setup page;
 * and fails on any console error or uncaught page error in any of the extension's pages.
 *
 * It needs no network: nothing is configured, so the cats that read the network say they could
 * not, in their own words, and that is not an error. It skips cleanly (and passes) when Playwright
 * or a Chromium build is not installed; CI_BROWSER=1 makes a missing browser a failure. Set
 * CATS_SHOTS_DIR to keep a screenshot of each tab.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? "  — " + detail : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const finish = () => { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(fail ? 1 : 0); };
const skip = (why) => {
  console.log(`  (${why} — the real-browser check is skipped here)`);
  ok("a browser is installed where CI_BROWSER=1 asks for the real-browser check", process.env.CI_BROWSER !== "1");
  finish();
};

/* Playwright and Chromium, where this machine keeps them: PLAYWRIGHT_DIR and CHROMIUM_PATH, or the
   usual places. */
const PW_DIRS = [process.env.PLAYWRIGHT_DIR, "/opt/node22/lib/node_modules/playwright", path.join(here, "node_modules", "playwright")].filter(Boolean);
const CHROMES = [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean);
let chromium = null;
for (const dir of PW_DIRS) {
  try { if (fs.existsSync(dir)) { chromium = createRequire(path.join(dir, "package.json"))(dir).chromium; break; } } catch { chromium = null; }
}
if (!chromium) skip("Playwright is not installed");
const executablePath = CHROMES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!executablePath) skip("no Chromium build was found");

/* The build: made now when dist/ is missing or older than any source it is built from. */
const dist = path.join(here, "dist");
const newest = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((m, e) => Math.max(m, e.isDirectory() ? newest(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).mtimeMs), 0);
if (!fs.existsSync(path.join(dist, "manifest.json")) || newest(path.join(here, "src")) > fs.statSync(path.join(dist, "background.js")).mtimeMs) {
  const { buildOnce } = await import("./build.mjs");
  await buildOnce({ outdir: dist });
}

const shots = process.env.CATS_SHOTS_DIR || null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cats-browser-"));
const extraArgs = (process.env.CHROMIUM_EXTRA_ARGS ?? "").split(" ").filter(Boolean);
let ctx;
try {
  ctx = await chromium.launchPersistentContext(profile, {
    executablePath, headless: true, viewport: { width: 400, height: 900 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--headless=new", "--no-first-run", ...extraArgs],
  });
} catch (e) { skip(`Chromium could not start: ${String(e?.message ?? e).split("\n")[0]}`); }

const problems = [];
const watch = (page) => {
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${page.url()}: console.error ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`${page.url()}: ${e.message}`));
};
ctx.on("page", watch);
for (const p of ctx.pages()) watch(p);

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 30_000 });
  const id = new URL(sw.url()).host;
  ok("the extension loads, and its service worker starts", /^[a-p]{32}$/.test(id), id);
  const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true }); };

  const popup = await ctx.newPage();
  watch(popup);
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForSelector("#tabs button");
  ok("the popup's header is the agency's", (await popup.textContent(".brand")).replace(/\s+/g, " ").startsWith("Cat Intelligence Agency"));
  const tabs = await popup.$$eval("#tabs button", (bs) => bs.map((b) => ({ tab: b.dataset.tab, label: b.textContent.trim(), sprite: b.querySelector("img")?.getAttribute("src") })));
  ok("five tabs, each with its cat's sprite: CoinMarketCat, Snipurr, Popcat, CashCat, Crying Cat",
    tabs.map((t) => t.label).join() === "CoinMarketCat,Snipurr,Popcat,CashCat,Crying Cat" && tabs.every((t) => /^sprites\/[a-z-]+\.png$/.test(t.sprite)), JSON.stringify(tabs.map((t) => t.label)));
  const spritesLoaded = await popup.$$eval("#tabs img", (imgs) => imgs.every((i) => i.complete && i.naturalWidth > 100));
  ok("every sprite loads from the extension's own files", spritesLoaded);
  const visibleCards = () => popup.$$eval(".card", (cs) => cs.filter((c) => c.offsetParent !== null).map((c) => c.id || c.dataset.tabs));
  for (const t of tabs) {
    await popup.click(`#tabs button[data-tab="${t.tab}"]`);
    await popup.waitForTimeout(t.tab === "popcat" || t.tab === "cashcat" ? 1_500 : 400);
    const cards = await visibleCards();
    const own = { agent: "agentCard", snipurr: "venueCard", popcat: "popcatCard", cashcat: "cashcatDraftCard", crying: "cryingCard" }[t.tab];
    ok(`the ${t.label} tab shows its own cards`, cards.includes(own) && (t.tab === "popcat" || !cards.includes("popcatCard")), cards.join(", "));
    await shot(popup, `popup-${t.tab}`);
  }

  /* Crying Cat: a bad input is refused, in words, by the worker's strict check. */
  await popup.click('#tabs button[data-tab="crying"]');
  await popup.fill("#cryInput", "https://evil.example/coin/not-a-mint");
  await popup.click("#btnCry");
  await popup.waitForSelector("#cryError:not(.hidden)", { timeout: 10_000 });
  ok("Crying Cat refuses a pasted input that is not an address or a pump.fun coin link", /pump\.fun coin link|address/.test(await popup.textContent("#cryError")));
  await shot(popup, "popup-crying-refused");

  /* CashCat: a coin typed and judged in the worker, its logo drawn by the worker's OffscreenCanvas. */
  await popup.click('#tabs button[data-tab="cashcat"]');
  await popup.fill("#ccName", "Rainy Day Cat");
  await popup.fill("#ccSymbol", "RAINCAT");
  await popup.fill("#ccTagline", "A cat watching the rain from a warm windowsill.");
  await popup.fill("#ccTopic", "rainy weather");
  await popup.selectOption("#ccKitten", "ginger");
  await popup.selectOption("#ccBackground", "sky");
  await popup.click("#btnCcCheck");
  await popup.waitForFunction(() => document.getElementById("ccReviewLine").textContent.length > 0 && !/^Checking/.test(document.getElementById("ccReviewLine").textContent) || document.getElementById("ccRefusals").children.length > 0, null, { timeout: 60_000 });
  const judged = await popup.evaluate(() => ({ line: document.getElementById("ccReviewLine").textContent, refusals: [...document.getElementById("ccRefusals").children].map((li) => li.textContent) }));
  ok("the worker judged the typed coin by the rules and said so (offline, the verified-ticker check cannot pass, and says why)",
    /^It passes the rules/.test(judged.line) || (judged.line === "Refused, for the reasons above." && judged.refusals.length > 0 && judged.refusals.every((r) => r.length > 20 && r !== "the check failed")), JSON.stringify(judged).slice(0, 200));
  await popup.waitForFunction(() => !document.getElementById("btnCcPreview").disabled, null, { timeout: 15_000 });
  await popup.click("#btnCcPreview");
  await popup.waitForSelector("#ccLogo:not(.hidden)", { timeout: 60_000 });
  const logo = await popup.$eval("#ccLogo", (img) => ({ w: img.naturalWidth, h: img.naturalHeight, src: img.src.slice(0, 22) }));
  ok("the worker drew the coin's logo on an OffscreenCanvas, 1024 × 1024, from the extension's own art and font", logo.w === 1024 && logo.h === 1024 && logo.src === "data:image/png;base64,", JSON.stringify(logo));
  await shot(popup, "popup-cashcat-logo");

  const options = await ctx.newPage();
  watch(options);
  await options.setViewportSize({ width: 900, height: 1200 });
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForSelector("#ccPinataJwt", { timeout: 20_000 });
  ok("Options opens with the agency's header, the agent, CashCat's Pinata key and settings, Popcat, and Snipurr",
    /Cat Intelligence Agency/.test(await options.textContent("h1")) && (await options.$("#agApiKey")) !== null && (await options.getAttribute("#ccPinataJwt", "type")) === "password" && (await options.$("#popBackground")) !== null && (await options.$("#form fieldset")) !== null);
  await shot(options, "options");

  const welcome = await ctx.newPage();
  watch(welcome);
  await welcome.setViewportSize({ width: 900, height: 1200 });
  await welcome.goto(`chrome-extension://${id}/welcome.html`);
  await welcome.waitForSelector(".cats .cat");
  ok("the setup page names the five cats, each with its sprite", (await welcome.$$eval(".cats .cat img", (imgs) => imgs.filter((i) => i.complete && i.naturalWidth > 100).length)) === 5);
  await shot(welcome, "welcome");

  await popup.waitForTimeout(500);
  ok("no console error and no uncaught error in any of the extension's pages", problems.length === 0, problems.slice(0, 5).join(" | "));
} catch (e) {
  ok("the walk through the extension finished", false, String(e?.message ?? e).split("\n")[0]);
} finally {
  await ctx.close().catch(() => {});
  fs.rmSync(profile, { recursive: true, force: true });
}
finish();
