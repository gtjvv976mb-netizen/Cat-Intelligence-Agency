/**
 * THE WEBSITE SAYS WHAT THE CODE DOES, AND THE CONSOLE STAYS A BRIDGE.
 *
 * site/ is published to GitHub Pages at catintelligenceagency.com as three pages: the
 * agency (site/index.html), the cat's own page (site/coinmarketcat/index.html) and the
 * console the extension's content script attaches to (site/console/index.html). This file
 * pins what those pages may and may not be:
 *
 *   · THE NUMBERS ARE THE CODE'S. Every dial the pages quote — the ten-second crouch, the
 *     1.0x follow-through, the 1.5x take, the 90 s stall, the 180 s clock, the 20% stop,
 *     the 0.005 SOL ticket, the 0.01 SOL day, the 1 SOL ceiling, eight stocks, the 12-
 *     character passphrase, the eight-hour unlock, the Phantom windows — is read from the
 *     module that decides it and must appear on the page. Every figure from the desk's
 *     record is read from RECORD. A dial that moves in code and not on the site fails here.
 *   · THE CONSOLE IS STILL THE BRIDGE. Its channel and message types are protocol.mjs's,
 *     the sender it trusts is the one content.mjs stamps, it posts to its own origin only,
 *     every element its script draws into exists, and it asks the extension for nothing
 *     but "are you there?" and "connect".
 *   · NO PAGE CAN SIGN, COLLECT OR SEND. No signing call, no wallet provider, no key word,
 *     no form or input, no network call, no external script, and localStorage holds the
 *     theme and nothing else. The one library the site ships, three.js for the 3D agency,
 *     is served from site/ itself and is byte for byte three@0.169.0.
 *   · THE 3D AGENCY IS SELF-HOSTED AND LIGHT. The import map points at site/, every file
 *     the scene loads exists, the pixel roster picture stands in when WebGL does not, and
 *     the home page weighs under 3.5 MB with everything it can load.
 *   · HONEST AND CLEAN. The risk notice and "unmeasured" are there; hype words, invented
 *     counts and returns are not; every page carries the owner's two-line disclaimer; the
 *     ticker $CIA is the only way the initials appear, and nothing describes government
 *     imagery; the six agents are the six cats, and every placeholder (the X link, the
 *     contract address, the buy link) comes from one config and renders as empty.
 *   · IT HANGS TOGETHER. Each page has a title, a description, a viewport, og tags and the
 *     kit's favicons; the three link to each other and to the repository, never to a
 *     github.io address; every local link, asset and #fragment resolves.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  CONFIG_DEFAULTS, RECORD, MAX_QUOTE_MINTS, STOCK_FOCUS_CHOICES, AUTOPILOT_UNLOCK_MINUTES,
  SNIPE_OPERATOR_MAX, snipeArmSentence, CONSOLE_URLS,
} from "./src/lib/config.mjs";
import { SNIPE_DEFAULTS as POLICY_DEFAULTS } from "./vendor/executor/snipe-policy.mjs";
import { CHANNEL, BRIDGE } from "./src/lib/protocol.mjs";
import { MIN_PASSPHRASE_LENGTH, DEFAULT_UNLOCK_TTL_MS } from "./src/lib/session-wallet.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(here, "site");
let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? "  — " + detail : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const section = (title) => console.log(`\n${title}\n${"─".repeat(title.length)}`);
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

const REPO = "https://github.com/gtjvv976mb-netizen/Cat-Intelligence-Agency";
const PAGES_ORIGIN = "https://catintelligenceagency.com/";
const PAGES = {
  agency: "index.html",
  cat: path.join("coinmarketcat", "index.html"),
  console: path.join("console", "index.html"),
};
const html = Object.fromEntries(Object.entries(PAGES).map(([k, rel]) => [k, fs.readFileSync(path.join(SITE, rel), "utf8")]));

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ", "&#9790;": "☾" };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp|#9790);/g, (m) => ENTITIES[m]);
/** The words a visitor reads: scripts, styles and tags removed, entities decoded, spaces folded. */
const textOf = (page) => decode(page
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
  .replace(/<[^>]+>/g, " "))
  .replace(/\s+/g, " ");
const text = Object.fromEntries(Object.entries(html).map(([k, v]) => [k, textOf(v)]));
const meta = (page, attr, name) => {
  const m = page.match(new RegExp(`<meta\\s+${attr}="${name.replace(/[:.]/g, "\\$&")}"\\s+content="([^"]*)"`, "i"));
  return m ? decode(m[1]) : null;
};
const has = (key, phrase) => text[key].includes(phrase);

section("EVERY PAGE IS A PAGE");
for (const [key, page] of Object.entries(html)) {
  const title = (page.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
  ok(`${key}: a <title>`, title.trim().length >= 10, title);
  ok(`${key}: lang and doctype`, /^<!doctype html>/i.test(page) && /<html lang="en"/.test(page));
  ok(`${key}: a phone viewport`, /<meta name="viewport" content="width=device-width, initial-scale=1">/.test(page));
  const description = meta(page, "name", "description");
  ok(`${key}: a meta description`, description && description.length >= 80 && description.length <= 400, `${description?.length ?? 0} chars`);
  for (const og of ["og:title", "og:description", "og:type", "og:site_name"])
    ok(`${key}: ${og}`, Boolean(meta(page, "property", og)));
  ok(`${key}: og:image is the link preview, absolute, on the domain`, meta(page, "property", "og:image") === `${PAGES_ORIGIN}assets/og-1200x630.jpg`);
  const ogUrl = meta(page, "property", "og:url");
  ok(`${key}: og:url is this page on the domain`, ogUrl === PAGES_ORIGIN + PAGES[key].replace(/index\.html$/, "").split(path.sep).join("/"), ogUrl);
  ok(`${key}: the canonical link is og:url`, page.includes(`<link rel="canonical" href="${ogUrl}">`));
  ok(`${key}: the kit's favicons`,
    /<link rel="icon" href="(\.\.\/)?assets\/favicon-32\.png" type="image\/png" sizes="32x32">/.test(page)
      && /<link rel="icon" href="(\.\.\/)?assets\/favicon-64\.png" type="image\/png" sizes="64x64">/.test(page)
      && /<link rel="apple-touch-icon" href="(\.\.\/)?assets\/apple-touch-180\.png">/.test(page));
  ok(`${key}: Archivo to read, JetBrains Mono for addresses`, /family=Archivo/.test(page) && /family=JetBrains\+Mono/.test(page));
  ok(`${key}: night first, the day shift stored under cc_theme`,
    /localStorage\.getItem\("cc_theme"\)/.test(page) && /t === "light" \? "light" : "dark"/.test(page)
      && /localStorage\.setItem\("cc_theme", next\)/.test(page) && /id="shiftbtn"/.test(page));
  ok(`${key}: violet and mint`, /#9945ff/i.test(page) && /#14f195/i.test(page) || /agency\.css/.test(page));
}
ok("the agency: Anton titles and Press Start 2P pixel labels", /family=Anton/.test(html.agency) && /family=Press\+Start\+2P/.test(html.agency));
const css = fs.readFileSync(path.join(SITE, "assets", "agency.css"), "utf8");
ok("the cat's stylesheet carries violet #9945ff and mint #14f195, night first", /--violet:#9945ff/.test(css) && /--mint:#14f195/.test(css) && /:root\[data-theme="light"\]/.test(css));
const homeCss = fs.readFileSync(path.join(SITE, "assets", "home.css"), "utf8");
ok("the agency's stylesheet carries the palette, night first, with a day shift",
  ["--ink:#0b0716", "--mint:#14f195", "--violet:#9945ff", "--gold:#f5c542", "--tear:#5ab8ff", "--orange:#e8742c", "--pink:#ff4fd8"].every((t) => homeCss.includes(t))
    && /:root\[data-theme="light"\]/.test(homeCss));

section("THE PAGES LINK TO EACH OTHER, AND EVERY LOCAL LINK RESOLVES");
const hrefs = (page) => [...page.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => decode(m[1]));
ok("agency → the cat, the console, the repository", ["coinmarketcat/", "console/", REPO].every((h) => hrefs(html.agency).includes(h)));
ok("the cat → the agency, the console, the repository", ["../", "../console/", REPO].every((h) => hrefs(html.cat).includes(h)));
ok("the console → the agency, the cat, the repository", ["../", "../coinmarketcat/", REPO].every((h) => hrefs(html.console).includes(h)));
const idsIn = (page) => new Set([...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const missing = [];
for (const [key, rel] of Object.entries(PAGES)) {
  for (const href of hrefs(html[key])) {
    if (/^(https?:|mailto:|data:)/.test(href)) continue;
    const [p, frag] = href.split("#");
    let target = p ? path.normalize(path.join(SITE, path.dirname(rel), p)) : path.join(SITE, rel);
    if (p && (p.endsWith("/") || fs.existsSync(target) && fs.statSync(target).isDirectory())) target = path.join(target, "index.html");
    if (!target.startsWith(SITE + path.sep) || !fs.existsSync(target)) { missing.push(`${key}: ${href}`); continue; }
    if (frag && target.endsWith(".html") && !idsIn(fs.readFileSync(target, "utf8")).has(frag)) missing.push(`${key}: ${href} (no #${frag})`);
  }
}
ok("every local link, asset and #fragment resolves inside site/", missing.length === 0, missing.join(", ") || "all resolve");
const external = Object.values(html).flatMap(hrefs).filter((h) => /^https?:/.test(h));
const allowedHosts = new Set(["github.com", "fonts.googleapis.com", "fonts.gstatic.com", "catintelligenceagency.com"]);
ok("external links only to the repository, the domain and Google Fonts; never a github.io address",
  external.every((h) => allowedHosts.has(new URL(h).host)) && external.filter((h) => new URL(h).host === "github.com").every((h) => h.startsWith(REPO)),
  [...new Set(external.map((h) => new URL(h).host))].join(", "));
ok("the site is served on the domain (CNAME)", fs.readFileSync(path.join(SITE, "CNAME"), "utf8").trim() === new URL(PAGES_ORIGIN).host);
ok("the kit's icons and the pixel CoinMarketCat are there",
  ["favicon-32.png", "favicon-64.png", "apple-touch-180.png", "og-1200x630.jpg"].every((f) => fs.existsSync(path.join(SITE, "assets", f)))
    && fs.existsSync(path.join(SITE, "icons", "coinmarketcat-128.png")));
ok("the cat's page and the console show the pixel CoinMarketCat and link back to the agency",
  [html.cat, html.console].every((p) => /(assets\/sprites\/coinmarketcat\.png|icons\/coinmarketcat-128\.png)/.test(p) && hrefs(p).includes("../"))
    && !/coinmarketcat\.svg/.test(html.cat + html.console));

section("THE CONSOLE IS STILL THE BRIDGE");
const script = (html.console.match(/<script>\s*\/\* The console panel[\s\S]*?<\/script>/) || [""])[0];
ok("the console's panel script is there", script.length > 1000);
ok(`it speaks on protocol.mjs's channel (${CHANNEL})`, script.includes(`const CHANNEL = "${CHANNEL}";`));
ok("it says hello and connect with protocol.mjs's page types", script.includes(`type: "${BRIDGE.PAGE_HELLO}"`) && script.includes(`type: "${BRIDGE.PAGE_CONNECT}"`));
ok("it renders only the status type, from the sender content.mjs stamps",
  script.includes(`d.type !== "${BRIDGE.STATUS}"`) && script.includes('d.from !== "hawk-extension"')
    && fs.readFileSync(path.join(here, "src", "content.mjs"), "utf8").includes('from: "hawk-extension"'));
ok("it listens to its own window only, and posts to its own origin only",
  script.includes("if (event.source !== window) return;")
    && [...script.matchAll(/postMessage\(/g)].length === 2
    && [...script.matchAll(/postMessage\(\{[^}]*\},\s*([^)]*)\)/g)].map((m) => m[1].trim()).join() === "location.origin,location.origin");
const posted = [...script.matchAll(/type: "([^"]+)"/g)].map((m) => m[1]);
ok("it asks the extension for nothing but hello and connect", posted.every((t) => t === BRIDGE.PAGE_HELLO || t === BRIDGE.PAGE_CONNECT), posted.join(", "));
const drawn = [...new Set([...script.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]))];
const consoleIds = idsIn(html.console);
ok("every element the panel draws into exists", drawn.length >= 12 && drawn.every((id) => consoleIds.has(id)), drawn.filter((id) => !consoleIds.has(id)).join(", ") || `${drawn.length} ids`);
ok("the console lives where the extension looks for it",
  CONFIG_DEFAULTS.consoleUrl === `${PAGES_ORIGIN}console/` && CONSOLE_URLS.includes(CONFIG_DEFAULTS.consoleUrl) && fs.existsSync(path.join(SITE, "console", "index.html")));

section("NO PAGE CAN SIGN, COLLECT OR SEND");
/* three.js is the one library the site ships. It is served from site/ (no CDN) and pinned
   here byte for byte to the three@0.169.0 package, so the scans below read only our code. */
const THREE_DIR = path.join(SITE, "assets", "vendor", "three");
const THREE_FILES = {
  "three.module.min.js": "f7cee3c7533449a1505cc12cb5128b89e3d4fd3d7ea62b05f9f5464a217472ee",
  "addons/loaders/GLTFLoader.js": "6f1719dcc6a179d30273dfb0de07a8c898a7981f7b08e600b446387f5967371f",
  "addons/controls/OrbitControls.js": "80efaadea4f8a636a65fb0bd08bfef62f3d93a0bb94e2e7500f23176c5c07f4e",
  "addons/utils/BufferGeometryUtils.js": "c25b7930e570e9ec56173cd3b866ec8d2e10016630db3937efb439daf1cedbf6",
  "LICENSE": "4c40a1ef62450b857c3b2aaf294936304cd552d965fbcd9d32d4c5bcf4ba4454",
};
const sha256 = (f) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const vendored = walk(THREE_DIR).map((f) => path.relative(THREE_DIR, f).split(path.sep).join("/")).sort();
ok("vendor/three holds three@0.169.0's module build, three addons and its licence, unedited",
  JSON.stringify(vendored) === JSON.stringify(Object.keys(THREE_FILES).sort())
    && Object.entries(THREE_FILES).every(([f, h]) => sha256(path.join(THREE_DIR, f)) === h),
  vendored.join(", "));
ok("the licence is three.js's MIT licence", /The MIT License/.test(fs.readFileSync(path.join(THREE_DIR, "LICENSE"), "utf8")));
const siteFiles = walk(SITE).filter((f) => /\.(html|css|svg|js|mjs)$/.test(f) && !f.startsWith(THREE_DIR + path.sep));
const BANNED = [
  [/signAndSendTransaction|signAllTransactions|signMessage|signTransaction/, "a signing call"],
  [/window\.phantom|window\.solana|\.solana\.connect/, "the wallet provider"],
  [/secretKey|privateKey|Keypair|mnemonic|seed phrase/i, "a key word"],
  [/<form|<input|<textarea|<select/i, "a form field"],
  [/\bfetch\(|XMLHttpRequest|new WebSocket|sendBeacon|navigator\.clipboard/, "a network or clipboard call"],
  [/sessionStorage|indexedDB|document\.cookie/, "storage beyond the theme"],
  [/<script[^>]+src="(https?:)?\/\//i, "an external script"],
  [/"(https?:)?\/\/[^"]*\.m?js"/i, "a script imported from another host"],
  [/<iframe/i, "a frame"],
];
for (const [re, what] of BANNED) {
  const hits = siteFiles.filter((f) => re.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(here, f));
  ok(`no ${what} anywhere in site/`, hits.length === 0, hits.join(", "));
}
const storageKeys = siteFiles.flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/localStorage\.(\w+)\(([^,)]*)/g)].map((m) => `${m[1]}(${m[2]})`));
ok("localStorage holds the theme and nothing else", storageKeys.length >= 6 && storageKeys.every((k) => /^(getItem|setItem)\("cc_theme"\)$/.test(k)), [...new Set(storageKeys)].join(", "));

section("THE NUMBERS ARE THE CODE'S");
const pinned = (name, codeOk, pagesOk, detail) => ok(name, codeOk && pagesOk, detail);
pinned("the crouch: ten seconds", CONFIG_DEFAULTS.entryWaitMs === 10_000, has("cat", "crouches ten seconds") && has("cat", "Crouch 10 s") && has("agency", "Crouches ten seconds"));
pinned("the pounce: still at or above its entry price", CONFIG_DEFAULTS.entryFollowThroughX === 1, has("cat", "at or above its entry price") && has("agency", "at or above its entry price"));
pinned("the take: 1.5x by default", CONFIG_DEFAULTS.takeAtEntryX === 1.5, has("cat", "1.5× by default") && has("cat", "Take 1.5×") && has("agency", "1.5× by default"));
pinned("the stall: under entry at 90 seconds", POLICY_DEFAULTS.stallMs === 90_000 && POLICY_DEFAULTS.stallAtX === 1, has("cat", "still under its entry price at ninety seconds") && has("agency", "after 90 s"));
pinned("the clock: 180 seconds", POLICY_DEFAULTS.timeStopMs === 180_000, has("cat", "after 180") && has("cat", "Out by 180 s") && has("agency", "after 180 s"));
pinned("the default stop: 20% of entry", POLICY_DEFAULTS.stopFrac === 0.2, has("cat", "20% of entry"));
pinned("the break-even at the canary: about 22%", Math.round((POLICY_DEFAULTS.fallbackFrictionX - 1) * 100) === 22, has("cat", "about 22% just to break even"));
pinned("the ticket: 0.005 SOL by default, never above 1 SOL",
  CONFIG_DEFAULTS.maxSolPerTrade === 0.005 && SNIPE_OPERATOR_MAX.maxSolPerTrade === 1, has("cat", "0.005 SOL default") && has("cat", "never above 1 SOL"));
pinned("the day: 0.01 SOL by default", CONFIG_DEFAULTS.dailySolCap === 0.01, has("cat", "0.01 SOL default"));
pinned("the arm sentence shown is the lane's own, for the default numbers",
  true, has("cat", snipeArmSentence("<your wallet>", CONFIG_DEFAULTS.maxSolPerTrade, CONFIG_DEFAULTS.dailySolCap)));
pinned("stocks: up to eight, and the five the setup page offers",
  MAX_QUOTE_MINTS === 8 && STOCK_FOCUS_CHOICES.map((c) => c.symbol).join() === "GLDx,TSLAx,SPYx,AAPLx,NVDAx",
  has("cat", "up to eight tokenised stocks") && has("cat", "GLDx, TSLAx, SPYx, AAPLx and NVDAx"));
pinned("stocks: with none listed, SOL only", CONFIG_DEFAULTS.quoteMints.length === 0, has("cat", "none SOL only") && has("cat", "With none listed, it refuses them all"));
pinned("the pool venue: off until you switch it on", CONFIG_DEFAULTS.xstockVenue === false, has("cat", "Off until you switch it on") && has("agency", "Once you switch it on") && has("agency", "off by default"));
pinned("who signs: Phantom by default", CONFIG_DEFAULTS.signerMode === "phantom", has("cat", "Approving in Phantom is the default") && has("agency", "The default is Phantom"));
pinned("the setup page saves into Observe",
  fs.readFileSync(path.join(here, "src", "welcome", "welcome.mjs"), "utf8").includes('lane: "observe"') && CONFIG_DEFAULTS.lane !== "execute",
  has("cat", "Saving puts the cat in Observe"));
pinned("the passphrase: at least 12 characters", MIN_PASSPHRASE_LENGTH === 12, has("cat", "at least 12 characters"));
pinned("the unlock: eight hours by default", DEFAULT_UNLOCK_TTL_MS === 8 * 3_600_000 && AUTOPILOT_UNLOCK_MINUTES.default === 480, has("cat", "eight hours by default"));
pinned("Phantom windows: a buy abandoned at 25 s, a sell re-asked at 8 s, dropped at 32 s",
  CONFIG_DEFAULTS.approvalTimeoutMs === 25_000 && CONFIG_DEFAULTS.sellReaskMs === 8_000 && CONFIG_DEFAULTS.sellReaskMs * 4 === 32_000,
  has("cat", "past 25 seconds") && has("cat", "asked again 8 seconds later") && has("cat", "dropped after 32 seconds"));
const manifest = JSON.parse(fs.readFileSync(path.join(here, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));
pinned("Chrome and Node versions", manifest.minimum_chrome_version === "116" && pkg.engines.node === ">=22.13 <25", has("cat", "Chrome 116 or later") && has("cat", "Node.js 22.13 to 24"));
pinned("the repository", pkg.repository.url === REPO, has("cat", `git clone ${REPO}`));

section("THE RECORD IS RECORD'S");
const under3 = RECORD.bySecondsLate.find((b) => b.bucket === "under 3s");
const late = RECORD.bySecondsLate.find((b) => b.bucket === "10s+");
const reached15 = RECORD.reached.find((r) => r.x === 1.5);
pinned("10 up, 48 down, −1.58 SOL over the first 58", RECORD.first58.won === 10 && RECORD.first58.lost === 48 && RECORD.first58.trades === 58 && RECORD.first58.netSol.toFixed(2) === "-1.58",
  has("cat", "10 up · 48 down") && has("cat", "first 58 round trips") && has("cat", "−1.58 SOL"));
pinned("entries under three seconds: 0 of 9", under3.n === 9 && under3.wonPct === 0, has("cat", "0 of 9"));
pinned("the ten-minute clock: 0 of 18", RECORD.tenMinuteClock.ran === 18 && RECORD.tenMinuteClock.won === 0, has("cat", "0 of 18"));
pinned("reached 1.5x: 28 of 64", reached15.of64 === 28 && RECORD.all64.trades === 64, has("cat", "28 of 64"));
pinned("ten seconds and later: 4 of 10, called not a sample", late.n === 10 && late.wonPct === 40, has("cat", "4 of 10 won") && has("cat", "ten trades is not a sample"));
pinned("read off mainnet on the record's date", RECORD.readAt === "2026-09-17", has("cat", RECORD.readAt) && has("console", RECORD.readAt));
const table = html.console.match(/<table>[\s\S]*?<\/table>/)?.[0] ?? "";
const fmt = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(1) + "%";
ok("the console's seconds-late table is RECORD.bySecondsLate, row for row",
  RECORD.bySecondsLate.every((b) => table.includes(`<td class="n">${b.n}</td><td class="n">${b.wonPct}%</td><td class="n">${fmt(b.meanPct)}</td>`)));

section("HONEST, AND CLEAN");
for (const phrase of [
  "Launch sniping loses money more often than not.",
  "The lane this cat learned from has been unprofitable.",
  "This cat's own live record is unmeasured.",
  "Use observe mode first. Only fund what you can afford to lose.",
  "None of this is evidence of an edge.",
  "no Autopilot trade, fund or sweep has yet been made on mainnet",
  "Nothing has been measured yet about stock-paired launches or pools",
])
  ok(`the cat's page says: "${phrase.slice(0, 60)}"`, has("cat", phrase));
ok("the agency calls the track record unmeasured", has("agency", "Unmeasured in this lane"));
ok("the console keeps its fine print", has("console", "Not advice, not a signal service"));
const HYPE = [
  [/guarantee/i, "guarantee"], [/risk[- ]free/i, "risk-free"], [/passive income/i, "passive income"],
  [/\b(moon|lambo|100x|to the moon)\b/i, "moon talk"], [/\bAPY\b|\bAPR\b/, "a yield"],
  [/testimonial|\bfive stars?\b|as seen on|trusted by/i, "social proof"],
  [/\b\d[\d,.]*\s*\+?\s*(users|traders|downloads|installs|members|customers)\b/i, "a user count"],
  [/\b(earn|made|returns?|profit)\s+(of\s+|up to\s+)?[+]?\d+(\.\d+)?\s*%/i, "a quoted return"],
];
for (const [re, what] of HYPE) {
  const hits = Object.entries(text).filter(([, t]) => re.test(t)).map(([k]) => k);
  ok(`no ${what} on any page`, hits.length === 0, hits.join(", "));
}
/* The owner's disclaimer: one or two plain lines, the same on every page. No legal essays. */
for (const key of Object.keys(html)) {
  ok(`${key}: a meme and software project, affiliated with no government agency, CoinMarketCap or any real cat's owners`,
    has(key, "Cat Intelligence Agency is a meme and software project. It is not affiliated with any government agency, CoinMarketCap, or the owners of any real cat."));
  ok(`${key}: $CIA has no intrinsic value, and nothing is financial advice`, has(key, "$CIA is a memecoin with no intrinsic value. Nothing here is financial advice."));
}
const officialHits = siteFiles.filter((f) => /\.gov\b|coinmarketcap\.com/i.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(here, f));
ok("no .gov address and no CoinMarketCap domain anywhere in site/", officialHits.length === 0, officialHits.join(", "));
const initials = Object.entries(text).flatMap(([k, t]) => [...t.matchAll(/(.)?\bCIA\b/g)].filter((m) => m[1] !== "$").map((m) => `${k}: …${t.slice(Math.max(0, m.index - 20), m.index + 24)}…`));
ok("the initials appear only as the ticker, $CIA", initials.length === 0, initials.slice(0, 3).join(" | "));
/* Government imagery is banned where words describe imagery: alt text, labels, titles and
   the names of the files the pages show. */
const IMAGERY = /\b(seal|eagle|badge|shield|emblem|crest|insignia)s?\b/i;
const described = Object.entries(html).flatMap(([k, p]) => [
  ...[...p.matchAll(/\s(?:alt|aria-label|title)="([^"]*)"/g)].map((m) => [k, m[1]]),
  ...[...p.matchAll(/<meta property="og:image:alt" content="([^"]*)"/g)].map((m) => [k, m[1]]),
]);
const assetNames = walk(SITE).map((f) => path.relative(SITE, f)).filter((f) => /\.(png|jpe?g|webp|svg|glb|gif)$/i.test(f));
const imageryHits = [...described.filter(([, v]) => IMAGERY.test(v)).map(([k, v]) => `${k}: ${v}`), ...assetNames.filter((f) => IMAGERY.test(f))];
ok("no seal, eagle, badge, shield or emblem in any image description or image file name", described.length >= 10 && imageryHits.length === 0, imageryHits.join(", ") || `${described.length} descriptions`);
const cmcMentions = Object.values(text).join(" ").match(/[^.]*CoinMarketCap[^.]*/g) ?? [];
ok("CoinMarketCap is named only to say there is no affiliation", cmcMentions.length >= 3 && cmcMentions.every((s) => /not affiliated|Is it CoinMarketCap\?/.test(s)), `${cmcMentions.length} mentions`);
ok("Agent 001 is CoinMarketCat, field status active", has("agency", "Agent 001") && has("agency", "CoinMarketCat") && has("cat", "Agent 001 · field status: active"));

section("THE SIX CATS, AND THE PLACEHOLDERS");
/* The Director and the five agents: each card has its pixel kitten, codename, beat,
   catchphrase, bio, status and accent. CoinMarketCat is the one you can download. */
const CATS = {
  director: { name: "The Director", accent: "#9945ff", status: "On X" },
  coinmarketcat: { name: "CoinMarketCat", accent: "#14f195", status: "Software · download it" },
  "crying-cat": { name: "Crying Cat", accent: "#5ab8ff", status: "On X" },
  "grumpy-cat": { name: "Grumpy Cat", accent: "#e8742c", status: "On X" },
  cashcat: { name: "CashCat", accent: "#f5c542", status: "On X" },
  popcat: { name: "Popcat", accent: "#ff4fd8", status: "On X" },
};
const cards = Object.fromEntries([...html.agency.matchAll(/<article class="agent[^"]*" id="agent-([a-z-]+)" data-cat="([a-z-]+)"[^>]*style="--accent:(#[0-9a-f]{6})">([\s\S]*?)<\/article>/g)]
  .map((m) => [m[1], { cat: m[2], accent: m[3], body: m[4] }]));
ok("six agent cards, one per cat", JSON.stringify(Object.keys(cards).sort()) === JSON.stringify(Object.keys(CATS).sort()), Object.keys(cards).join(", "));
for (const [cat, want] of Object.entries(CATS)) {
  const c = cards[cat];
  if (!c) { ok(`${want.name}: has a card`, false); continue; }
  const t = textOf(c.body);
  ok(`${want.name}: its pixel kitten, codename, beat, catchphrase, bio, status and accent`,
    c.cat === cat && c.accent === want.accent
      && c.body.includes(`src="assets/sprites/${cat}.png"`) && fs.existsSync(path.join(SITE, "assets", "sprites", `${cat}.png`))
      && t.includes(want.name) && /class="beat"/.test(c.body) && /class="catch"/.test(c.body) && /class="bio"/.test(c.body)
      && textOf((c.body.match(/<span class="status[^"]*">([^<]*)<\/span>/) || ["", ""])[1]).trim() === want.status);
}
ok("Popcat's card says the character is not the $POPCAT memecoin, and $CIA is not related to it",
  cards.popcat && textOf(cards.popcat.body).includes("not affiliated with the $POPCAT memecoin, and $CIA is not related to it"));
ok("the sample case file is marked a template, with placeholder fields", /class="casefile"/.test(html.agency) && has("agency", "A template with placeholder fields, not a real case") && (html.agency.match(/class="slot"/g) || []).length >= 10);

/* One config holds every value the site cannot know yet. Empty means empty on the page. */
const configSrc = fs.readFileSync(path.join(SITE, "assets", "config.js"), "utf8");
const cfg = new Function("window", `${configSrc}; return window.CIA_CONFIG;`)({});
ok("one config: the X link, the contract address and the buy link, and nothing else",
  JSON.stringify(Object.keys(cfg).sort()) === JSON.stringify(["buyUrl", "contractAddress", "xUrl"]));
ok("each config value is empty until it exists, or looks exactly like what it is",
  (cfg.xUrl === "" || /^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/?$/.test(cfg.xUrl))
    && (cfg.contractAddress === "" || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cfg.contractAddress))
    && (cfg.buyUrl === "" || (cfg.contractAddress && /^https:\/\/(pump\.fun|gmgn\.ai)\//.test(cfg.buyUrl) && cfg.buyUrl.includes(cfg.contractAddress))));
ok("the home page reads the config before its script, and ships every placeholder empty",
  html.agency.indexOf('src="assets/config.js"') > 0 && html.agency.indexOf('src="assets/config.js"') < html.agency.indexOf('src="assets/home.js"')
    && /<code class="ca" id="ca" data-empty="true">Not launched\. No address yet\.<\/code>/.test(html.agency)
    && /<button class="btn gold" type="button" id="buybtn" disabled>/.test(html.agency)
    && (html.agency.match(/<button[^>]*disabled data-x-link/g) || []).length >= 3
    && !/href="https:\/\/(x\.com|twitter\.com|pump\.fun)/.test(html.agency));
ok("the contract-address slot says where the real one will be", has("agency", "Posted on X at launch — only trust that one."));
const addressLike = Object.entries(text).filter(([, t]) => /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/.test(t)).map(([k]) => k);
ok("no page shows anything shaped like a contract address", addressLike.length === 0, addressLike.join(", "));

section("THE 3D AGENCY IS SELF-HOSTED AND LIGHT");
const importmap = JSON.parse((html.agency.match(/<script type="importmap">([\s\S]*?)<\/script>/) || ["", "{}"])[1]);
ok("the import map points three and its addons at site/, not at a CDN",
  importmap.imports?.three === "./assets/vendor/three/three.module.min.js" && importmap.imports?.["three/addons/"] === "./assets/vendor/three/addons/");
const scene = fs.readFileSync(path.join(SITE, "assets", "hq3d.js"), "utf8");
const specifiers = [...scene.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
const resolveSpec = (sp) => sp === "three" ? importmap.imports.three : sp.startsWith("three/addons/") ? importmap.imports["three/addons/"] + sp.slice("three/addons/".length) : null;
ok("every module the scene imports is in site/",
  specifiers.length >= 3 && specifiers.every((sp) => { const r = resolveSpec(sp); return r && fs.existsSync(path.join(SITE, r)); }), specifiers.join(", "));
const addonImports = ["loaders/GLTFLoader.js", "controls/OrbitControls.js"].flatMap((f) => {
  const src = fs.readFileSync(path.join(THREE_DIR, "addons", f), "utf8");
  return [...src.matchAll(/^(?:import\b[^;\n]*|\}\s*)from\s+'([^']+)';/gm)].map((m) => [f, m[1]]);
});
ok("every module the addons import is in site/",
  addonImports.every(([f, sp]) => sp === "three" || fs.existsSync(path.join(THREE_DIR, "addons", path.dirname(f), sp))), addonImports.map(([, sp]) => sp).join(", "));
const sceneAssets = [...new Set([...scene.matchAll(/"(assets\/[^"$]+)"/g)].map((m) => m[1]))];
ok("every file the scene loads exists: the model, the floor tile and the six sprites",
  sceneAssets.includes("assets/agency-hq.glb") && sceneAssets.includes("assets/floor-tile-256.png")
    && sceneAssets.every((a) => fs.existsSync(path.join(SITE, a)))
    && /`assets\/sprites\/\$\{k\.cat\}\.png`/.test(scene) && Object.keys(CATS).every((c) => scene.includes(`"${c}"`)),
  sceneAssets.join(", "));
const glb = fs.readFileSync(path.join(SITE, "assets", "agency-hq.glb"));
const glbJson = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8");
ok("the model is one self-contained binary glTF 2.0, with no tool names inside",
  glb.toString("latin1", 0, 4) === "glTF" && glb.readUInt32LE(4) === 2 && glb.readUInt32LE(8) === glb.length
    && !/"uri"/.test(glbJson) && !/tripo|hunyuan|meshy|rodin|trellis/i.test(glb.toString("latin1")));
ok("the model is loaded after first paint, and the pixel roster picture stands in if the 3D cannot run",
  /addEventListener\("load"/.test(html.agency) && /import\("\.\/assets\/hq3d\.js"\)\.catch/.test(html.agency)
    && /dataset\.scene = "fallback"/.test(html.agency) && /class="hero-poster" src="assets\/site-hero-1200x514\.jpg"/.test(html.agency));
ok("the scene caps the pixel ratio at 2, sleeps off screen and in a hidden tab, and keeps still for reduced motion",
  /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/.test(scene) && /IntersectionObserver/.test(scene) && /visibilitychange/.test(scene)
    && /prefers-reduced-motion: reduce/.test(scene) && /NearestFilter/.test(scene));
/* Everything the home page can load, counting the larger of each image pair. */
const homeLoads = new Set(["index.html", "assets/home.css", "assets/config.js", "assets/home.js", "assets/hq3d.js",
  ...Object.keys(THREE_FILES).filter((f) => f.endsWith(".js")).map((f) => "assets/vendor/three/" + f), ...sceneAssets,
  ...Object.keys(CATS).map((c) => `assets/sprites/${c}.png`),
  ...hrefs(html.agency).filter((h) => !/^(https?:|#)/.test(h) && !h.endsWith("/")).map((h) => h.split("#")[0])]);
for (const srcset of html.agency.matchAll(/srcset="([^"]+)"/g)) for (const part of srcset[1].split(",")) homeLoads.add(part.trim().split(/\s+/)[0]);
const homeBytes = [...homeLoads].reduce((n, f) => n + fs.statSync(path.join(SITE, f)).size, 0);
ok("the home page weighs under 3.5 MB with everything it can load", homeBytes < 3.5 * 1024 * 1024, `${(homeBytes / 1024 / 1024).toFixed(2)} MB over ${homeLoads.size} files`);
const noToolNames = walk(SITE).filter((f) => !f.startsWith(THREE_DIR + path.sep) && /\.(html|css|js|txt|json)$/.test(f))
  .filter((f) => /gpt[- ]?image|tripo|claude-(opus|sonnet|haiku)|\bdall-?e\b|midjourney|stable diffusion/i.test(fs.readFileSync(f, "utf8")));
ok("no model names or model identifiers in site/", noToolNames.length === 0, noToolNames.map((f) => path.relative(here, f)).join(", "));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
