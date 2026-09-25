/**
 * THE WEBSITE SAYS WHAT THE CODE DOES, AND THE CONSOLE STAYS A BRIDGE.
 *
 * site/ is published to GitHub Pages at catintelligenceagency.com as four pages: the
 * agency (site/index.html), its work floor (site/floor/index.html), the cat's own page
 * (site/coinmarketcat/index.html) and the console the extension's content script attaches
 * to (site/console/index.html). This file pins what those pages may and may not be:
 *
 *   · THE AGENT'S NUMBERS ARE THE CODE'S. CoinMarketCat is the agentic trader now: its schedule,
 *     its ten-token universe and the majors preset, its settlement, every default limit, the $10 and
 *     $50 minimums, paper by default and the half-minute protections are read from agent-strategy.mjs
 *     and the worker, and its page says plainly that it runs while Chrome is open, spot only, on the
 *     owner's own API credits, unmeasured, and not affiliated with CoinMarketCap.
 *   · SNIPURR'S NUMBERS ARE THE CODE'S. Every dial the pages quote for the sniper lane — the ten-second crouch, the
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
 *     imagery; the six agents and the Director are the seven cats (CashCat and Popcat marked as
 *     bots, whose status is read from their own files), and every placeholder (the X link, the
 *     contract address, the buy link) comes from one config and renders as empty.
 *   · IT HANGS TOGETHER. Each page has a title, a description, a viewport, og tags and the
 *     kit's favicons; the pages link to each other and to the repository, never to a
 *     github.io address; every local link, asset and #fragment resolves.
 *   · THE FLOOR IS HONEST. The 3D building and the hero lead to the work floor; its seven
 *     stations are the seven cats, each hotspot on its own desk; the case file ships empty, and every entry the floor will
 *     ever show passes the validator, which refuses unknown agents, impossible dates, any
 *     link that is not http(s) and any HTML; the floor's pictures are the brand kit's.
 *   · THE BOTS' DESKS SHOW THEIR OWN FILES. CashCat's launches and every cat coin Popcat checked
 *     (callouts, and coins spotted with red flags) are read as JSON modules and checked by the
 *     validators the deploy runs; Popcat's file is shown only against the launches it must not
 *     touch; the feed carries the callouts and Popcat's pick, the spotted coins stay at its desk;
 *     every word is text, every link is Solscan, pump.fun or StonkFun, and no coin's picture is
 *     ever drawn; the pick's draft is text to copy by hand, never the clipboard's; the pick's
 *     disclosure is the same words on the site, in the README and in the kit's copy; the
 *     numbers the cards quote are the bots' own.
 *   · THE KIT IS THE SEVEN-CAT KIT. CoinMarketCat is the hoodie tabby, Snipurr keeps its old art,
 *     the floor has seven desks, and every copy the site ships is the kit's, byte for byte or
 *     pixel for pixel.
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
import { AGENT_SPEC_DEFAULTS, AGENT_BOUNDS, SOLANA_MAJORS, SETTLEMENT_TOKENS } from "./src/lib/agent-strategy.mjs";

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
  floor: path.join("floor", "index.html"),
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
  const preview = key === "floor" ? "og-floor-1200x630.jpg" : "og-1200x630.jpg";
  ok(`${key}: og:image is the link preview, absolute, on the domain`, meta(page, "property", "og:image") === `${PAGES_ORIGIN}assets/${preview}`);
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
ok("agency → the floor, the cat, the console, the repository", ["./floor/", "coinmarketcat/", "console/", REPO].every((h) => hrefs(html.agency).includes(h)));
ok("the floor → back to the agency, $CIA, the cat, the console, the repository", ["../", "../#cia", "../coinmarketcat/", "../console/", REPO].every((h) => hrefs(html.floor).includes(h)));
ok("the cat → the agency, the floor, the console, the repository", ["../", "../floor/", "../console/", REPO].every((h) => hrefs(html.cat).includes(h)));
ok("the console → the agency, the floor, the cat, the repository", ["../", "../floor/", "../coinmarketcat/", REPO].every((h) => hrefs(html.console).includes(h)));
/* "The Floor" sits in the bar itself (not only in a footer) on every page but the console's
   own compact bar, where it is a plain link beside the agency's. */
const barOf = (page) => (page.match(/<header class="bar">[\s\S]*?<\/header>|<nav><div class="wrap">[\s\S]*?<\/nav>/) || [""])[0];
ok("\"The Floor\" is in the site bar of the agency, the floor, the cat's page and the console",
  /<a class="floorlink" href="\.\/floor\/">/.test(barOf(html.agency)) && /<a class="floorlink" href="\.\/" aria-current="page">/.test(barOf(html.floor))
    && /<a class="floorlink" href="\.\.\/floor\/">/.test(barOf(html.cat)) && /<a class="floor" href="\.\.\/floor\/">The Floor<\/a>/.test(barOf(html.console)));
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
  [/\bfetch\(|XMLHttpRequest|new WebSocket|sendBeacon|navigator\.clipboard|execCommand|ClipboardItem|clipboardData/, "a network or clipboard call"],
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
/* Snipurr's numbers: the sniper lane is Snipurr's now, described on the cat's page (its "Snipurr, the sniper lane"
   section) and in the agency's CoinMarketCat pitch, and still read from the code that decides them. */
pinned("the crouch: ten seconds", CONFIG_DEFAULTS.entryWaitMs === 10_000, has("cat", "crouches ten seconds") && has("cat", "Crouch 10 s") && has("agency", "crouches ten seconds"));
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

section("THE AGENT'S NUMBERS ARE THE CODE'S");
/* CoinMarketCat is the agentic trader: every number its page and the agency's pitch quote is
   read from src/lib/agent-strategy.mjs, and the half-minute protections from the worker's alarm. */
{
  const d = AGENT_SPEC_DEFAULTS;
  pinned("the model is asked every 15, 30 or 60 minutes", JSON.stringify(AGENT_BOUNDS.schedules) === "[15,30,60]" && d.scheduleMinutes === 30,
    has("cat", "every 15, 30 or 60 minutes") && has("agency", "Every 15, 30 or 60 minutes"));
  pinned("up to ten tokens", AGENT_BOUNDS.universeMax === 10, has("cat", "up to ten tokens") && has("agency", "Up to ten Solana spot tokens"));
  pinned("the Solana majors preset, by symbol", SOLANA_MAJORS.map((m) => m.symbol).join(", ") === "JitoSOL, JUP, JTO, PYTH, RAY, BONK, WIF, cbBTC",
    has("cat", "JitoSOL, JUP, JTO, PYTH, RAY, BONK, WIF and cbBTC"));
  pinned("settled in USDC by default, or USDT", SETTLEMENT_TOKENS.map((t) => t.symbol).join() === "USDC,USDT" && d.settlementMint === SETTLEMENT_TOKENS[0].mint,
    has("cat", "settled in USDC by default, or USDT") && has("agency", "settled in USDC or USDT"));
  pinned("the limits' defaults: $25 a token, 60% in tokens, 8% stop loss, 15% take profit, 5% daily drawdown, 6 trades a day, 100 bps",
    d.maxPositionUsd === 25 && d.maxExposurePct === 60 && d.stopLossPct === 8 && d.takeProfitPct === 15 && d.maxDailyDrawdownPct === 5 && d.maxTradesPerDay === 6 && d.slippageBps === 100,
    ["$25 per token", "60% of the vault", "8% stop loss", "15% take profit", "5% daily drawdown", "6 trades a day", "100 bps"].every((p) => has("cat", p)));
  pinned("the $10 minimum trade and the $50 minimum vault, fixed", AGENT_BOUNDS.minTradeUsd === 10 && AGENT_BOUNDS.minVaultUsd === 50,
    has("cat", "$10 minimum trade") && has("cat", "$50 minimum vault") && has("cat", "at least $50 of USDC or USDT"));
  pinned("paper is the default, from a $100 paper vault", d.mode === "paper" && d.paperVaultUsd === 100,
    has("cat", "Paper is the default") && has("cat", "$100 unless you change it") && has("agency", "It starts on paper"));
  pinned("the protections check every half minute: the worker's alarm", /chrome\.alarms\.create\(ALARM, \{ periodInMinutes: 0\.5 \}\)/.test(fs.readFileSync(path.join(here, "src", "background.mjs"), "utf8")),
    has("cat", "every half minute") && has("agency", "every half minute"));
  pinned("the model is chosen at run time: the newest the key lists, unless the owner picks one", d.model === "",
    has("cat", "by default, the newest one the API lists for your key"));
  pinned("SOL itself is not in this version", !SOLANA_MAJORS.some((m) => m.mint === "So11111111111111111111111111111111111111112"), has("cat", "SOL itself is not tradable in this version"));
  for (const phrase of [
    "It runs while Chrome is open on this computer, not in a cloud around the clock.",
    "It is spot only, with no leverage.",
    "Every model call is billed to your own API key.",
    "Nothing about this agent's returns has been measured",
    "The model cannot change a limit, trade outside your list, or withdraw.",
    "Only you can withdraw",
    "Sharing or selling a strategy to other people is not built.",
    "CoinMarketCat is not affiliated with CoinMarketCap.",
  ]) ok(`the cat's page says: "${phrase.slice(0, 60)}"`, has("cat", phrase));
  for (const phrase of ["CoinMarketCat is not affiliated with CoinMarketCap.", "While Chrome is open on your computer, not in a cloud around the clock.", "Spot only, with no leverage.", "Every model call is billed to your own API key."])
    ok(`the agency's pitch says: "${phrase.slice(0, 60)}"`, has("agency", phrase));
  const allText = Object.values(text).join(" ");
  ok("no page promises round-the-clock trading, leverage on offer, or a figure for returns", !/24\/7|\bruns 24|always on\b|up to \d+x leverage|\d+x leverage|win rate of \d|\d+% win rate/i.test(allText));
  ok("CoinMarketCat is the agentic trader on its card, its floor station and its page", /data-beat="The agentic trader · software"/.test(html.agency) && html.floor.includes('<span class="tag-beat">The agentic trader · software</span>') && has("cat", "CoinMarketCat, the agentic trading cat."));
  ok("Snipurr is named as the sniper lane on the cat's page and in the agency's pitch", has("cat", "Snipurr, the sniper lane.") && has("agency", "Snipurr, the sniper cat, is its other lane"));
}

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
  "Run the agent on paper and Snipurr in Observe first. Only fund what you can afford to lose.",
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

section("THE SEVEN CATS, AND THE PLACEHOLDERS");
/* The Director and the six agents: each card has its pixel kitten, codename, beat,
   catchphrase, bio, status and accent. CoinMarketCat is the one you can download, in its
   hoodie purple; Snipurr, in the old mint, ships inside it; CashCat and Popcat are bots, and
   their cards say so. */
const CATS = {
  director: { name: "The Director", accent: "#9945ff", status: "On X" },
  coinmarketcat: { name: "CoinMarketCat", accent: "#8b5cf6", status: "Software · download it" },
  "crying-cat": { name: "Crying Cat", accent: "#5ab8ff", status: "On X" },
  "grumpy-cat": { name: "Grumpy Cat", accent: "#e8742c", status: "On X" },
  cashcat: { name: "CashCat", accent: "#f5c542", status: "Bot" },
  popcat: { name: "Popcat", accent: "#ff4fd8", status: "Bot" },
  snipurr: { name: "Snipurr", accent: "#14f195", status: "Software · inside CoinMarketCat" },
};
const cards = Object.fromEntries([...html.agency.matchAll(/<article class="agent[^"]*" id="agent-([a-z-]+)" data-cat="([a-z-]+)"[^>]*style="--accent:(#[0-9a-f]{6})">([\s\S]*?)<\/article>/g)]
  .map((m) => [m[1], { cat: m[2], accent: m[3], body: m[4] }]));
ok("seven agent cards, one per cat", JSON.stringify(Object.keys(cards).sort()) === JSON.stringify(Object.keys(CATS).sort()), Object.keys(cards).join(", "));
for (const [cat, want] of Object.entries(CATS)) {
  const c = cards[cat];
  if (!c) { ok(`${want.name}: has a card`, false); continue; }
  const t = textOf(c.body);
  ok(`${want.name}: its pixel kitten, codename, beat, catchphrase, bio, status and accent`,
    c.cat === cat && c.accent === want.accent
      && c.body.includes(`src="assets/sprites/${cat}.png"`) && fs.existsSync(path.join(SITE, "assets", "sprites", `${cat}.png`))
      && t.includes(want.name) && /class="beat"/.test(c.body) && /class="catch"/.test(c.body) && /class="bio"/.test(c.body)
      && textOf((c.body.match(/<span class="status[^"]*"[^>]*>([^<]*)<\/span>/) || ["", ""])[1]).trim() === want.status);
}
ok("Popcat's card says the character is not the $POPCAT memecoin, and $CIA is not related to it",
  cards.popcat && textOf(cards.popcat.body).includes("not affiliated with the $POPCAT memecoin, and $CIA is not related to it"));
/* CashCat and Popcat are bots: their cards say what each does, that it posts nothing until the
   agency switches it on, and where everything it posts is listed. No card claims a launch or a
   callout: the status says "Bot", and the page adds how many are on file (none yet). */
{
  const cash = textOf(cards.cashcat?.body || ""), pop = textOf(cards.popcat?.body || "");
  ok("CashCat's card: the auto-launcher, cat coins from what is trending, on pump.fun and StonkFun, listed at its desk, off until switched on",
    /data-beat="Auto-launcher · bot"/.test(html.agency) && cash.includes("launched by itself from what is trending, on pump.fun and on StonkFun")
      && cash.includes("Every coin it launches is listed at its desk on the work floor") && cash.includes("It launches nothing until the agency switches it on.")
      && !/whale|KOL|being built/i.test(cash));
  const { PICK_DISCLOSURE } = await import("./site/assets/callouts.js");
  ok("Popcat's card: every new cat coin on pump.fun it can check, listed with its safety checks at its desk; callouts in the feed; a pick every six hours, posted only by hand; off until switched on",
    /data-beat="Cat-coin callouts · bot"/.test(html.agency) && pop.includes("listed with its safety checks; the ones with no red flags called out. Cat coins only.")
      && pop.includes("lists every one it can check at its desk on the work floor") && pop.includes("A coin in which no check finds a red flag is a callout, in the floor's feed too; a coin with red flags is spotted, and its red flags are named.")
      && pop.includes("Every six hours it picks at most one callout for the agency to post by hand on pump.fun.") && pop.includes("It posts nothing until the agency switches it on.")
      && pop.includes(PICK_DISCLOSURE) && !/radar is a prop|being built/i.test(pop));
  ok("the pick's disclosure is the same words on the card, at Popcat's desk, in the house rules, the README and the kit's copy",
    PICK_DISCLOSURE.startsWith("The agency may post Popcat's pick as a callout on pump.fun, which pays callers from trading their callouts bring.") && /Not financial advice\.$/.test(PICK_DISCLOSURE)
      && (text.agency.split(PICK_DISCLOSURE).length - 1) === 2 && textOf(html.floor.match(/<template id="tpl-popcat">[\s\S]*?<\/template>/)[0]).includes(PICK_DISCLOSURE)
      && ["README.md", path.join("brand", "COPY.md")].every((f) => fs.readFileSync(path.join(here, f), "utf8").replace(/\s+/g, " ").includes(PICK_DISCLOSURE)));
  ok("no page says a bot is being built any more", !Object.values(text).some((t) => /being built/i.test(t)));
  ok("Snipurr's card: the sniper lane inside CoinMarketCat, software, linking to that lane, its desk and the console",
    /data-beat="The sniper lane · software"/.test(html.agency) && textOf(cards.snipurr?.body || "").includes("the sniper lane inside CoinMarketCat")
      && ["coinmarketcat/#snipurr", "./floor/#snipurr", "console/"].every((h) => (cards.snipurr?.body || "").includes(`href="${h}"`)));
  ok("the headline counts six agents, four of them software: two characters, the extension and its lane, the two bots; the Director is the mascot, not one of the six",
    has("agency", "Six agents. Four of them are software.") && !has("agency", "Two of them are software.")
      && has("agency", "Crying Cat and Grumpy Cat are characters") && has("agency", "The other four are software.") && has("agency", "The Director is the agency's mascot, not one of the six."));
  ok("the hero says the two bots are built and not yet switched on, not that they are being built",
    has("agency", "two more are the agency's own bots, built and not yet switched on.") && !/bots the agency is building|bots on the way/i.test(text.agency));
  const rules = "Popcat never calls out a coin CashCat launched.", buyRule = "The agency never buys a coin before calling it out", pickRule = "Popcat's pick, disclosed.";
  ok("the house rules carry the owner's rules, the pick's disclosure among them, on the site and in the kit's copy",
    has("agency", rules) && has("agency", buyRule) && has("agency", pickRule) && [rules, buyRule, pickRule].every((r) => fs.readFileSync(path.join(here, "brand", "COPY.md"), "utf8").includes(r)));
}
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
ok("every file the scene loads exists: the model, the floor tile and the seven sprites",
  sceneAssets.includes("assets/agency-hq.glb") && sceneAssets.includes("assets/floor-tile-256.png")
    && sceneAssets.every((a) => fs.existsSync(path.join(SITE, a)))
    && /`assets\/sprites\/\$\{k\.cat\}\.png`/.test(scene) && Object.keys(CATS).every((c) => scene.includes(`"${c}"`)),
  sceneAssets.join(", "));
const glb = fs.readFileSync(path.join(SITE, "assets", "agency-hq.glb"));
const glbJson = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8");
const rosterOrder = [...scene.matchAll(/\{ cat: "([a-z-]+)",\s+t: (-?[\d.]+) \}/g)].map((m) => m[1]);
ok("seven kittens stand on the plaza, in the roster picture's order, with the Director in the middle",
  JSON.stringify(rosterOrder) === JSON.stringify(["popcat", "crying-cat", "grumpy-cat", "director", "cashcat", "snipurr", "coinmarketcat"]), rosterOrder.join(", "));
ok("the model is one self-contained binary glTF 2.0, with no tool names inside",
  glb.toString("latin1", 0, 4) === "glTF" && glb.readUInt32LE(4) === 2 && glb.readUInt32LE(8) === glb.length
    && !/"uri"/.test(glbJson) && !/tripo|hunyuan|meshy|rodin|trellis/i.test(glb.toString("latin1")));
ok("the model is loaded after first paint, and the pixel roster picture stands in if the 3D cannot run",
  /addEventListener\("load"/.test(html.agency) && /import\("\.\/assets\/hq3d\.js"\)\.catch/.test(html.agency)
    && /dataset\.scene = "fallback"/.test(html.agency) && /class="hero-poster" src="assets\/site-hero-1200x514\.jpg"/.test(html.agency));
ok("the scene caps the pixel ratio at 2, sleeps off screen and in a hidden tab, and keeps still for reduced motion",
  /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/.test(scene) && /IntersectionObserver/.test(scene) && /visibilitychange/.test(scene)
    && /prefers-reduced-motion: reduce/.test(scene) && /NearestFilter/.test(scene));
/* Everything the home page can load, counting the larger of each image pair, and the two bots'
   files it reads for their status (the floor reads them too). */
const BOT_FILES = ["assets/bot-posts.js", "assets/launches.js", "assets/callouts.js", "assets/launches-data.js", "assets/callouts-data.js", "assets/launches.json", "assets/callouts.json"];
const homeLoads = new Set(["index.html", "assets/home.css", "assets/config.js", "assets/home.js", "assets/hq3d.js", ...BOT_FILES,
  ...Object.keys(THREE_FILES).filter((f) => f.endsWith(".js")).map((f) => "assets/vendor/three/" + f), ...sceneAssets,
  ...Object.keys(CATS).map((c) => `assets/sprites/${c}.png`),
  ...hrefs(html.agency).filter((h) => !/^https?:/.test(h)).map((h) => h.split("#")[0]).filter((h) => h && !h.endsWith("/"))]);
for (const srcset of html.agency.matchAll(/srcset="([^"]+)"/g)) for (const part of srcset[1].split(",")) homeLoads.add(part.trim().split(/\s+/)[0]);
const homeBytes = [...homeLoads].reduce((n, f) => n + fs.statSync(path.join(SITE, f)).size, 0);
ok("the home page weighs under 3.5 MB with everything it can load", homeBytes < 3.5 * 1024 * 1024, `${(homeBytes / 1024 / 1024).toFixed(2)} MB over ${homeLoads.size} files`);
const noToolNames = walk(SITE).filter((f) => !f.startsWith(THREE_DIR + path.sep) && /\.(html|css|js|txt|json)$/.test(f))
  .filter((f) => /gpt[- ]?image|tripo|claude-(opus|sonnet|haiku)|\bdall-?e\b|midjourney|stable diffusion/i.test(fs.readFileSync(f, "utf8")));
ok("no model names or model identifiers in site/", noToolNames.length === 0, noToolNames.map((f) => path.relative(here, f)).join(", "));

section("THE WORK FLOOR");
/* The building leads in. The hero has a plain link (for keyboards, phones and no WebGL); the
   3D scene navigates to the same place, and asks the building only after the kittens, so a
   click on a kitten opens its file and never also walks you in. */
ok("the hero links to ./floor/, with a button and the ENTER marker's own link",
  /<a class="btn enter" href="\.\/floor\/">Enter the agency/.test(html.agency) && /<div class="entertag" id="entertag" hidden>[\s\S]*?<a class="et-go" href="\.\/floor\/">/.test(html.agency)
    && /<img class="et-portal" src="assets\/floor\/enter-portal-192\.png"/.test(html.agency));
ok("the 3D building opens ./floor/, after a push the reduced-motion setting skips",
  /const FLOOR_URL = "\.\/floor\/";/.test(scene) && /location\.assign\(FLOOR_URL\)/.test(scene)
    && /if \(reduceMotion\.matches\) \{ location\.assign\(FLOOR_URL\); return; \}/.test(scene) && /intersectObjects\(hqMeshes, false\)/.test(scene));
const upHandler = (scene.match(/canvas\.addEventListener\("pointerup"[\s\S]*?\n\}\);/) || [""])[0];
ok("a kitten wins the click: the building is asked only when no kitten was hit",
  /const i = hitTest\(e\.clientX, e\.clientY\);\s*const onHQ = i < 0 && hitBuilding\(e\.clientX, e\.clientY\);/.test(upHandler)
    && /if \(i >= 0\) openFile\(i\);\s*else if \(onHQ\) enterAgency\(\);/.test(upHandler));
ok("every agent card on the home page has a way to its desk", Object.keys(CATS).every((c) => html.agency.includes(`href="./floor/#${c}"`)));

/* Seven stations: one hotspot button per cat over the office picture, placed in percentages so
   they scale with it, one station panel (a template) per cat, one entry in the list below. */
const floorHtml = html.floor;
const spots = [...floorHtml.matchAll(/<button class="spot" type="button" data-cat="([a-z-]+)" aria-haspopup="dialog" style="([^"]*)">/g)].map((m) => ({ cat: m[1], style: m[2] }));
ok("seven station hotspots, one per cat, in the order the desks read", JSON.stringify(spots.map((x) => x.cat)) === JSON.stringify(["director", "crying-cat", "grumpy-cat", "cashcat", "popcat", "snipurr", "coinmarketcat"]),
  spots.map((x) => x.cat).join(", "));
ok("each hotspot is placed in percentages and carries its cat's accent",
  spots.length === 7 && spots.every((x) => /--x:[\d.]+%;--y:[\d.]+%;--w:[\d.]+%;--h:[\d.]+%/.test(x.style) && x.style.includes(`--accent:${CATS[x.cat].accent}`)));
const floorCss = fs.readFileSync(path.join(SITE, "assets", "floor.css"), "utf8");
/* Where each desk is. The office art is 2688 × 1520; the new desk for CoinMarketCat, where the
   sofa and rug were, runs from about x 120 to 830 and y 1090 to the bottom edge. Snipurr sits at
   the old CoinMarketCat desk, and each software cat's hotspot holds its own monitors' light. */
const box = (style, keys = ["x", "y", "w", "h"]) => Object.fromEntries(keys.map((k) => [k, Number((style.match(new RegExp(`--${k}:([\\d.]+)%`)) || [])[1])]));
const spotBox = Object.fromEntries(spots.map((x) => [x.cat, box(x.style)]));
const crtBox = (cls) => { const m = floorCss.match(new RegExp(`\\.${cls}\\{([^}]*)\\}`)); if (!m) return null; const b = box(m[1], ["l", "t", "w", "h"]); return { x: b.l, y: b.t, w: b.w, h: b.h }; };
const inside = (inner, outer) => inner && outer && inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w + 1e-9 && inner.y + inner.h <= outer.y + outer.h + 1e-9;
ok("every hotspot sits inside the office picture", Object.values(spotBox).every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= 100 && b.y + b.h <= 100));
{
  const c = spotBox.coinmarketcat, px = { x0: c.x * 26.88, x1: (c.x + c.w) * 26.88, y0: c.y * 15.2, y1: (c.y + c.h) * 15.2 };
  ok("CoinMarketCat's hotspot, the 7th, is on the new desk in the bottom-left corner",
    px.x0 >= 100 && px.x1 <= 830 && px.y0 >= 1040 && px.y1 <= 1520 && px.x1 - px.x0 >= 600 && px.y1 - px.y0 >= 380, JSON.stringify(c));
  ok("Snipurr's hotspot is the old CoinMarketCat desk, where the sniper screen is",
    JSON.stringify(spotBox.snipurr) === JSON.stringify({ x: 55, y: 61, w: 24, h: 25 }) && inside(crtBox("crt-snp"), spotBox.snipurr));
  ok("CoinMarketCat's two monitors light inside its hotspot, and light up when its desk is pointed at",
    inside(crtBox("crt-cmc-a"), c) && inside(crtBox("crt-cmc-b"), c)
      && /<span class="crt crt-cmc-a"><\/span>\s*<span class="crt crt-cmc-b"><\/span>/.test(floorHtml) && /<span class="crt crt-snp"><\/span>/.test(floorHtml)
      && floorCss.includes('.floor:has(.spot[data-cat="coinmarketcat"]:is(:hover,:focus-visible,.tour)) :is(.crt-cmc-a,.crt-cmc-b)')
      && floorCss.includes('.floor:has(.spot[data-cat="snipurr"]:is(:hover,:focus-visible,.tour)) .crt-snp'));
  ok("the floor says seven: seven desks, seven cats", has("floor", "Seven desks, seven cats, one case board.") && !/\bsix (desks|cats|kittens|pixel kittens)\b/i.test(Object.values(text).join(" ")));
}
ok("hotspots are at least 44 px to tap, and on a phone the floor pans in its frame",
  /\.spot\{[^}]*min-width:44px;min-height:44px/.test(floorCss) && /@media \(max-width:700px\)\{[\s\S]*?\.floor-frame\{[^}]*overflow-x:auto/.test(floorCss));
ok("the ENTER marker's \"Go in\" (a phone's way in) is at least 44 px to tap", /\.et-go\{[^}]*min-height:44px/.test(homeCss));
/* The title's glyphs overflow its line box (line-height under 1); without the lift, the lower
   half of the back link clicked the heading instead of going back. */
ok("the floor's back link sits above the title, so all of it clicks", /\.crumb\{position:relative;z-index:1;/.test(floorCss) && /<a class="crumb" href="\.\.\/">/.test(floorHtml));
const roster = [...floorHtml.matchAll(/<li id="([a-z-]+)"[^>]*><button class="roster-btn" type="button" data-cat="([a-z-]+)"/g)];
ok("the station list below repeats all seven as buttons, and each is a link target (/floor/#<cat>)",
  roster.length === 7 && roster.every((m) => m[1] === m[2] && CATS[m[1]]) && new Set(roster.map((m) => m[1])).size === 7);
const tpl = Object.fromEntries(Object.keys(CATS).map((c) => [c, (floorHtml.match(new RegExp(`<template id="tpl-${c}">([\\s\\S]*?)</template>`)) || ["", ""])[1]]));
/* Where a station's posts will go. The bots say it of what they will post, and claim no post
   on X nobody has decided on: their launches and callouts go on their desks and in the feed. */
const WHERE = { cashcat: /No launches posted yet\. CashCat has launched nothing yet\. When it launches a coin, the launch goes up here and in the floor's feed/,
  popcat: /Nothing posted yet\. Popcat has listed no coin yet\. When it checks a new cat coin, the coin goes up here with every check it ran and its mint and creator linked: a callout, in the floor's feed too, when no check found a red flag; spotted, with its red flags named, when one did\./ };
for (const [cat, want] of Object.entries(CATS)) {
  const t = tpl[cat], card = cards[cat]?.body || "";
  const same = (cls) => { const a = (t.match(new RegExp(`<p class="${cls}">([\\s\\S]*?)</p>`)) || [])[1], b = (card.match(new RegExp(`<p class="${cls}">([\\s\\S]*?)</p>`)) || [])[1]; return a && b && textOf(a).trim() === textOf(b).trim(); };
  ok(`${want.name}'s station: its sprite, codename, catchphrase and bio (as on its card), its own screen, and an honest empty state with its template`,
    t.includes(`src="../assets/sprites/${cat}.png"`) && textOf(t).includes(want.name) && same("catch") && same("bio")
      && t.includes(`src="../assets/floor/screen-${cat}-800.webp"`) && fs.existsSync(path.join(SITE, "assets", "floor", `screen-${cat}-800.webp`))
      && /data-slot="cases"/.test(t) && /data-slot="none" hidden/.test(t) && /posted yet\./.test(textOf(t)) && (WHERE[cat] || /appears here and on the agency's X account|goes up here and on the agency's X account/).test(textOf(t))
      && /<span class="tpl-stamp">Template<\/span>/.test(t) && (t.match(/class="slot"/g) || []).length >= 4);
}
ok("CoinMarketCat's station links to its page and the console; the Director's holds the announcements",
  /href="\.\.\/coinmarketcat\/"/.test(tpl.coinmarketcat) && /href="\.\.\/console\/"/.test(tpl.coinmarketcat) && /Agency announcements/.test(tpl.director));
ok("Snipurr's station: software inside CoinMarketCat, the old sniper screen, and links to its lane on CoinMarketCat's page and to the console",
  /href="\.\.\/coinmarketcat\/#snipurr"/.test(tpl.snipurr) && /href="\.\.\/console\/"/.test(tpl.snipurr)
    && textOf(tpl.snipurr).includes("Software · inside CoinMarketCat") && /FIELD REPORT \| SNIPURR/.test(tpl.snipurr) && /alt="Snipurr's monitor: a green candle chart under a sniper crosshair/.test(tpl.snipurr));
ok("CoinMarketCat's station shows the agent console, the hoodie tabby, and the disclaimer",
  /alt="CoinMarketCat's monitor: its agent console/.test(tpl.coinmarketcat) && /style="--w:175;--h:209"/.test(tpl.coinmarketcat) && textOf(tpl.coinmarketcat).includes("CoinMarketCat is not affiliated with CoinMarketCap."));
ok("the floor has a \"Latest from the floor\" feed, with the same empty state", /id="latest"/.test(floorHtml) && has("floor", "Latest from the floor.") && /id="feed-empty" hidden/.test(floorHtml) && /id="feed-list" hidden/.test(floorHtml));

/* The case file: one JSON file, a small schema, shipped empty. POSTED_CASES is how many real
   cases the file holds; raise it in the same commit that posts one (see the README). */
const POSTED_CASES = 0;
let caseFile = null;
try { caseFile = JSON.parse(fs.readFileSync(path.join(SITE, "assets", "cases.json"), "utf8")); } catch (e) { caseFile = null; }
ok("cases.json parses and is { \"cases\": [...] } and nothing else", caseFile && JSON.stringify(Object.keys(caseFile)) === '["cases"]' && Array.isArray(caseFile.cases));
ok(`cases.json holds ${POSTED_CASES} cases: nothing invented, nothing posted yet`, caseFile?.cases.length === POSTED_CASES, `${caseFile?.cases.length} in the file`);
const { validateCases, AGENTS, EXPLORER } = await import("./site/assets/cases.js");
const shipped = validateCases(caseFile);
ok("every entry in cases.json passes the validator", shipped.problems.length === 0 && shipped.cases.length === (caseFile?.cases.length ?? -1), shipped.problems.join(" | "));
ok("the validator knows the seven agents, each with the verdicts of its case template, Snipurr's field reports as SNP",
  JSON.stringify(Object.keys(AGENTS).sort()) === JSON.stringify(Object.keys(CATS).sort())
    && AGENTS["crying-cat"].verdicts.includes("RUGGED") && AGENTS["grumpy-cat"].verdicts.includes("NOT IMPRESSED") && AGENTS.coinmarketcat.verdicts.includes("FIELD REPORT")
    && AGENTS.director.verdicts.includes("ANNOUNCEMENT") && JSON.stringify(AGENTS.snipurr) === JSON.stringify({ name: "Snipurr", prefix: "SNP", verdicts: ["FIELD REPORT"], evidence: true })
    && !Object.values(AGENTS).some((a) => a.verdicts.some((v) => /SAFE|BUY|LEGIT/.test(v))));
ok("CashCat and Popcat post no cases: their launches and callouts are their own files, and a case filed under either is refused",
  AGENTS.cashcat.verdicts.length === 0 && AGENTS.cashcat.posts === "launches.json" && AGENTS.popcat.verdicts.length === 0 && AGENTS.popcat.posts === "callouts.json"
    && ["cashcat", "popcat"].every((agent) => validateCases({ cases: [{ id: agent === "cashcat" ? "CSH-001" : "POP-001", agent, date: "2026-10-01", verdict: "NO RED FLAGS FOUND", title: "A fixture", summary: "A test fixture, not a case.", evidence: [{ label: "A wallet", address: "11111111111111111111111111111111" }] }] }).problems.some((p) => /posts no cases/.test(p))));
ok("the floor knows Snipurr: its case prefix, its sprite's size and its field reports",
  /\(DIR\|CRY\|GRR\|CSH\|POP\|CMC\|SNP\)/.test(fs.readFileSync(path.join(SITE, "assets", "floor.js"), "utf8"))
    && /snipurr: \[146, 207\]/.test(fs.readFileSync(path.join(SITE, "assets", "floor.js"), "utf8")) && /coinmarketcat: \[175, 209\]/.test(fs.readFileSync(path.join(SITE, "assets", "floor.js"), "utf8"))
    && /snipurr: \["field report", "field reports"\]/.test(fs.readFileSync(path.join(SITE, "assets", "floor.js"), "utf8")));
/* A fixture, never shipped: one good entry, and one entry per way a typo could go wrong. */
const good = { id: "CRY-001", agent: "crying-cat", date: "2026-10-01", verdict: "RUGGED", title: "Fixture: a well-formed case", summary: "A test fixture, not a case.",
  evidence: [{ label: "A transaction", tx: "1".repeat(88) }, { label: "A wallet", address: "11111111111111111111111111111111" }, { label: "An archived page", url: "https://example.com/archived" }],
  x: "https://x.com/example/status/1" };
const fixture = { cases: [
  good,
  { ...good, id: "CRY-002", agent: "crying-kat" },
  { ...good, id: "CRY-003", date: "2026-02-30" },
  { ...good, id: "CRY-004", date: "10/01/2026" },
  { ...good, id: "CRY-005", evidence: [{ label: "click me", url: "javascript:alert(1)" }] },
  { ...good, id: "CRY-006", evidence: [{ label: "data", url: "data:text/html,<b>x</b>" }] },
  { ...good, id: "CRY-007", title: "<img src=x onerror=alert(1)>" },
  { ...good, id: "CRY-008", summary: "fine words <script>alert(1)</script>" },
  { ...good, id: "CRY-009", verdict: "SAFE" },
  { ...good, id: "CRY-010", evidence: [] },
  { ...good, id: "CRY-011", sumary: "a typo in a field name" },
  { ...good, id: "GRR-012" },
  { ...good, id: "CRY-013", x: "javascript:alert(1)" },
  { ...good, id: "CRY-001", title: "the same id again" },
  { ...good, id: "CRY-014", date: "2026-10-02", title: "Newer, and a < b is not HTML" },
  "not an object",
] };
const checked = validateCases(fixture);
const skipped = (id, why) => checked.problems.some((p) => p.startsWith(id) && why.test(p));
ok("the validator keeps well-formed entries, newest first", JSON.stringify(checked.cases.map((c) => c.id)) === '["CRY-014","CRY-001"]', checked.cases.map((c) => c.id).join(", "));
ok("it rejects an unknown agent", skipped("CRY-002", /"agent" must be one of/));
ok("it rejects a date that is not a real YYYY-MM-DD day", skipped("CRY-003", /not a real day/) && skipped("CRY-004", /YYYY-MM-DD/));
ok("it rejects a javascript: or data: link, in evidence or as the X post", skipped("CRY-005", /http\(s\)/) && skipped("CRY-006", /http\(s\)/) && skipped("CRY-013", /"x" must be a post link/));
ok("it rejects HTML in a title or a summary", skipped("CRY-007", /"title" contains HTML/) && skipped("CRY-008", /"summary" contains HTML/));
ok("it rejects a verdict the agent does not give, a case with no evidence, a misspelt field, a wrong prefix and a repeated id",
  skipped("CRY-009", /"verdict"/) && skipped("CRY-010", /no link, no case/) && skipped("CRY-011", /unknown field "sumary"/) && skipped("GRR-012", /"id" must look like CRY-001/)
    && skipped("CRY-001", /used twice/) && checked.problems.some((p) => /entry 16 skipped/.test(p)));
ok("a bad file is empty, not an error", validateCases(null).cases.length === 0 && validateCases({ cases: "x" }).cases.length === 0 && validateCases([]).problems.length === 1);
const ev = checked.cases.find((c) => c.id === "CRY-001")?.evidence ?? [];
ok("evidence becomes explorer links: a signature on Solscan's tx page, an address on its account page, a URL as given",
  ev[0]?.href === EXPLORER.tx + "1".repeat(88) && ev[1]?.href === EXPLORER.address + "11111111111111111111111111111111" && ev[2]?.href === "https://example.com/archived"
    && EXPLORER.tx === "https://solscan.io/tx/" && EXPLORER.address === "https://solscan.io/account/");

/* The floor draws the cases as text, never as markup, and reads the file as a JSON module
   (no fetch), through a module of its own so a bad file cannot take the stations down. */
const floorJs = fs.readFileSync(path.join(SITE, "assets", "floor.js"), "utf8");
const casesData = fs.readFileSync(path.join(SITE, "assets", "cases-data.js"), "utf8");
ok("the floor page loads config.js, then floor.js as a module", /<script src="\.\.\/assets\/config\.js"><\/script>\s*<script type="module" src="\.\.\/assets\/floor\.js"><\/script>/.test(floorHtml));
ok("floor.js validates with cases.js and reads cases.json only through cases-data.js, catching a failure",
  /import \{ AGENTS, validateCases \} from "\.\/cases\.js";/.test(floorJs) && /import\("\.\/cases-data\.js"\)[\s\S]*?\.catch\(/.test(floorJs)
    && /import cases from "\.\/cases\.json" with \{ type: "json" \};/.test(casesData) && /validateCases\(mod\.default\)/.test(floorJs) && /console\.warn\("cases\.json:", p\)/.test(floorJs));
const botJs = ["bot-posts.js", "launches.js", "callouts.js", "launches-data.js", "callouts-data.js"].map((f) => fs.readFileSync(path.join(SITE, "assets", f), "utf8"));
ok("the floor's scripts write text only: no innerHTML, outerHTML, insertAdjacentHTML, document.write or eval",
  ![floorJs, casesData, fs.readFileSync(path.join(SITE, "assets", "cases.js"), "utf8"), ...botJs].some((src) => /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(src)));
ok("evidence and X links open with noopener", /a\.rel = "noopener noreferrer";/.test(floorJs));
ok("a malformed link (/floor/#%E0) opens nothing instead of throwing, and a late close never empties a reopened station",
  /try \{ h = decodeURIComponent\(location\.hash\.slice\(1\)\); \} catch \{ return false; \}/.test(floorJs)
    && /dialog\.addEventListener\("close", \(\) => \{[^}]*?if \(dialog\.open\) return;/.test(floorJs));
ok("with reduced motion the floor holds still: no tilt, no tour, no tears or sweep",
  /reduce\.matches\) return;/.test(floorJs) && /!reduce\.matches && onScreen/.test(floorJs) && /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?\.floor\{transform:none!important\}[\s\S]*?\.tear,\.sweep\{display:none\}/.test(floorCss));

/* Every picture on the floor comes from the brand kit (brand/, made with Higgsfield): the
   office, the screens, the sprites, the tear, the case file, the ENTER marker. No drawn art. */
const FLOOR_ASSETS = {
  "workfloor-1600.webp": "workfloor.png", "workfloor-2688.webp": "workfloor.png", "case-board-800.webp": "case-board.png",
  "radar-sweep-400.webp": "screen-popcat.png", "tear-strip.png": "tear-sheet.png", "case-file-112.png": "case-file.png", "enter-portal-192.png": "enter-portal.png",
  ...Object.fromEntries(Object.keys(CATS).map((c) => [`screen-${c}-800.webp`, `screen-${c}.png`])),
};
const shippedFloor = fs.readdirSync(path.join(SITE, "assets", "floor")).sort();
ok("site/assets/floor/ holds web-sized copies of brand/floor/ and nothing else",
  JSON.stringify(shippedFloor) === JSON.stringify(Object.keys(FLOOR_ASSETS).sort()) && Object.values(FLOOR_ASSETS).every((f) => fs.existsSync(path.join(here, "brand", "floor", f))),
  shippedFloor.join(", "));
const floorPics = [...new Set([...floorHtml.matchAll(/\s(?:src|srcset|imagesrcset)="([^"]+)"/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(/\s+/)[0]))
  .filter((u) => /\.(png|jpe?g|webp|gif|svg)$/.test(u)))];
const cssPics = [...floorCss.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]);
ok("every picture the floor shows is the kit's: the office and its screens, the seven sprites, the icons, the floor tile",
  floorPics.length >= 12 && floorPics.every((u) => /^\.\.\/assets\/(floor\/[a-z0-9-]+\.(webp|png)|sprites\/[a-z-]+\.png|favicon-64\.png)$/.test(u))
    && cssPics.every((u) => /^(floor\/(radar-sweep-400\.webp|tear-strip\.png)|floor-tile-256\.png)$/.test(u)),
  [...floorPics, ...cssPics].filter((u) => !/assets\/(floor|sprites)\/|favicon|^floor|floor-tile/.test(u)).join(", ") || `${floorPics.length + cssPics.length} pictures`);
ok("no drawn stand-ins: no SVG or canvas on the floor page or in its scripts", !/<svg|<canvas/i.test(floorHtml) && !/createElement\("(canvas|svg)"\)|createElementNS/.test(floorJs));
const jpegSize = (file) => { const b = fs.readFileSync(file); for (let i = 2; i < b.length;) { const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + len; } return null; };
ok("the floor's link preview is 1200 × 630, cropped from the work floor", JSON.stringify(jpegSize(path.join(SITE, "assets", "og-floor-1200x630.jpg"))) === "[1200,630]");
/* Everything the floor page can load, both sizes of the office picture included. */
const floorLoads = new Set(["floor/index.html", "assets/home.css", "assets/floor.css", "assets/config.js", "assets/floor.js", "assets/cases.js", "assets/cases-data.js", "assets/cases.json", ...BOT_FILES,
  ...floorPics.map((u) => u.replace(/^\.\.\//, "")), ...cssPics.map((u) => "assets/" + u), "assets/favicon-32.png", "assets/apple-touch-180.png"]);
const floorBytes = [...floorLoads].reduce((n, f) => n + fs.statSync(path.join(SITE, f)).size, 0);
ok("the floor page weighs under 2.5 MB with everything it can load", floorBytes < 2.5 * 1024 * 1024, `${(floorBytes / 1024 / 1024).toFixed(2)} MB over ${floorLoads.size} files`);

section("THE BOTS' DESKS");
/* CashCat's launches and Popcat's callouts reach the page the way the cases do: as JSON modules,
   each through a loader of its own, and checked by the validators the deploy runs. */
const assetText = (f) => fs.readFileSync(path.join(SITE, "assets", f), "utf8");
const botPostsJs = assetText("bot-posts.js");
ok("the bots' files are read as JSON modules, each through a loader of its own, never fetched",
  /import launches from "\.\/launches\.json" with \{ type: "json" \};/.test(assetText("launches-data.js")) && /import callouts from "\.\/callouts\.json" with \{ type: "json" \};/.test(assetText("callouts-data.js"))
    && /Promise\.allSettled\(\[import\("\.\/launches-data\.js"\), import\("\.\/callouts-data\.js"\)\]\)/.test(botPostsJs));
ok("they are checked by the deploy's own validators; callouts only against CashCat's launches, and not at all without them",
  /validateLaunches\(l\.value\.default\)/.test(botPostsJs) && /validateCallouts\(c\.value\.default, \{ exclude: launches\.items \}\)/.test(botPostsJs)
    && /else if \(launches\.state !== "ready"\) warn\(/.test(botPostsJs));
{
  const { loadBotPosts, botTally } = await import("./site/assets/bot-posts.js");
  const warned = [];
  const posts = await loadBotPosts((...a) => warned.push(a.join(" ")));
  ok("the files on the site load the page's way and pass with no warning", posts.launches.state === "ready" && posts.callouts.state === "ready" && warned.length === 0,
    warned.join(" | ") || `${posts.launches.items.length} launches, ${posts.callouts.items.length} callouts`);
  const called = { callout: true }, spotted = { callout: false };
  ok("a bot's status reads \"Bot · no launches yet\" until one is on file, then counts; Popcat's counts its callouts and its spotted coins apart",
    botTally("cashcat", []) === "no launches yet" && botTally("cashcat", [{}]) === "1 launch" && botTally("popcat", []) === "no callouts yet" && botTally("popcat", Array(12).fill(called)) === "12 callouts"
      && botTally("popcat", [spotted, spotted]) === "no callouts yet · 2 spotted" && botTally("popcat", [called, spotted, spotted]) === "1 callout · 2 spotted");
}
ok("the home page's two bot cards and their stations carry that status, filled from the same files",
  ["cashcat", "popcat"].every((c) => (html.agency.match(new RegExp(`data-bot-status="${c}">Bot<`, "g")) || []).length === 1 && (tpl[c].match(new RegExp(`data-bot-status="${c}">Bot<`, "g")) || []).length === 1)
    && /import \{ loadBotPosts, botTally \} from "\.\/assets\/bot-posts\.js";/.test(html.agency) && /botTally\(cat, posts\[kind\]\.items\)/.test(html.agency)
    && /status\.textContent = state === "ready" \? `Bot · \$\{botTally\(cat, mine\)\}` : "Bot";/.test(floorJs));
ok("CashCat's desk shows its launches and Popcat's every coin it checked, every other desk its cases; the feed the cases, launches and callouts, newest first, never a spotted coin",
  /import \{ loadBotPosts, botTally \} from "\.\/bot-posts\.js";/.test(floorJs) && /const DESK = \{ cashcat: "launches", popcat: "callouts" \};/.test(floorJs)
    && /const CARD = \{ cases: caseCard, launches: launchCard, callouts: calloutCard \};/.test(floorJs)
    && /\.\.\.src\.launches\.items\.map/.test(floorJs) && /\.\.\.src\.callouts\.items\.filter\(\(x\) => x\.callout\)\.map/.test(floorJs) && /id="feed-more" hidden/.test(floorHtml));
ok("Popcat's pick sits on top of the feed and of its desk, which has a slot for it, hidden until there is one",
  /const pick = src\.callouts\.picks\[0\];/.test(floorJs) && /list\.replaceChildren\(\.\.\.top, /.test(floorJs) && /<div class="st-pick" data-slot="pick" hidden><\/div>/.test(tpl.popcat)
    && /pickSlot\.replaceChildren\(\.\.\.\(p \? \[pickCard\(p\)\] : \[\]\)\);/.test(floorJs));
ok("a spotted coin says \"Spotted\", never \"Callout\", and names each red flag; only a coin with none is called a callout",
  /el\("span", "case-id", c\.callout \? "Callout" : "Spotted"\)/.test(floorJs) && /for \(const f of c\.flags\)/.test(floorJs) && /Spotted, not called out/.test(floorJs));
ok("the pick's draft is text to select and copy by hand: one click selects it all, and the page never writes to the clipboard",
  /el\("p", "pick-draft", p\.draft\)/.test(floorJs) && /\.pick-draft\{[^}]*user-select:all/.test(floorCss) && /this page never touches your clipboard/.test(floorJs));
const pictures = [...floorJs.matchAll(/\.src = ([^;]+);/g)].map((m) => m[1]);
ok("no coin's picture is ever drawn: the only pictures the floor's script sets are the case-file icon and the cats' own sprites",
  pictures.length === 2 && pictures.includes('"../assets/floor/case-file-112.png"') && pictures.includes("`../assets/sprites/${cat}.png`"), pictures.join(", "));
{
  const { validateLaunches, launchLinks } = await import("./site/assets/launches.js");
  const { validateCallouts, calloutLinks, CHECK_IDS } = await import("./site/assets/callouts.js");
  const fx = (f) => JSON.parse(fs.readFileSync(path.join(here, "fixtures", "bots", f), "utf8"));
  const snap = fx("popcat/snapshots.json").snapshots[0], sample = fx("pumpfun/create-v2-samples.json").samples[0];
  /* Test entries, never shipped: a launch and a callout shaped from recorded mainnet answers. */
  const spyx = STOCK_FOCUS_CHOICES.find((x) => x.symbol === "SPYx");
  const launch = { time: "2026-09-24T20:00:00Z", venue: "stonkfun", name: "Fixture Cat", symbol: "FIXCAT", tagline: "A test entry, not a launch.", trend: { title: "a test", source: "google-trends" },
    mint: sample.accounts[0].pubkey, creator: sample.accounts.find((a) => a.isSigner && a.pubkey !== sample.accounts[0].pubkey).pubkey, tx: sample.signature,
    quote: { symbol: spyx.symbol, mint: spyx.mint }, devBuy: { sol: 0 }, costSol: 0.0087, kitten: "ginger" };
  const callout = { time: "2026-09-24T21:40:00Z", venue: "pumpfun", mint: snap.apiRow.mint, creator: snap.apiRow.creator, name: snap.apiRow.name, symbol: snap.apiRow.symbol,
    cat: { field: "name", word: "cat" }, checks: CHECK_IDS.map((id) => ({ id, result: "pass", value: "a test value" })), stats: { holders: 40, top10Pct: 14.8, curvePct: 100, txs: 5000 } };
  const l = validateLaunches({ launches: [launch] }), c = validateCallouts({ callouts: [callout] });
  const hosts = [...launchLinks(l.launches[0] ?? launch), ...calloutLinks(c.callouts[0] ?? callout)].map((x) => new URL(x.href).host);
  ok("a launch and a callout link only to Solscan, pump.fun and StonkFun", l.problems.length === 0 && c.problems.length === 0 && hosts.length >= 7
    && hosts.every((h) => ["solscan.io", "pump.fun", "www.stonkfun.xyz"].includes(h)), [...new Set(hosts)].join(", "));
  ok("a callout carrying the coin's picture or its links is refused, and so is one on a coin CashCat launched",
    ["image", "uri", "website", "twitter"].every((k) => validateCallouts({ callouts: [{ ...callout, [k]: "https://example.com/x" }] }).problems.length === 1)
      && validateCallouts({ callouts: [callout] }, { exclude: [{ ...l.launches[0], mint: callout.mint }] }).problems.some((p) => /never lists a coin CashCat launched/.test(p))
      && validateCallouts({ callouts: [callout] }, { exclude: [{ ...l.launches[0], creator: callout.creator }] }).callouts.length === 0);
}
{
  /* The numbers the two cards quote are the bots' own. */
  const { CASHCAT_DEFAULTS, FENCES } = await import("./bots/cashcat/config.mjs");
  const { THRESHOLDS } = await import("./bots/popcat/checks.mjs");
  const { disclosure } = await import("./bots/cashcat/metadata.mjs");
  const { MAX_DEV_BUY_SOL } = await import("./site/assets/launches.js");
  pinned("CashCat: two launches a day by default, never more than six", CASHCAT_DEFAULTS.maxLaunchesPerDay === 2 && FENCES.maxLaunchesPerDay[1] === 6, has("agency", "two a day by default, never more than six"));
  pinned("CashCat: no dev buy by default, never more than 0.05 SOL", CASHCAT_DEFAULTS.devBuySol === 0 && FENCES.devBuySol[1] === 0.05 && MAX_DEV_BUY_SOL === 0.05,
    has("agency", "No dev buy by default, and never more than 0.05 SOL"));
  pinned("CashCat: every coin says a bot of the agency launched it, unaffiliated with its trend, not financial advice",
    /^Launched automatically by CashCat, a bot of the Cat Intelligence Agency/.test(disclosure({ trendTitle: "x" })) && /not affiliated with/.test(disclosure({ trendTitle: "x" })) && /Not financial advice\./.test(disclosure({ trendTitle: "x" })),
    has("agency", "That CashCat, a bot of the agency, launched it automatically, that it is not affiliated with its trend, and that it is not financial advice."));
  pinned("Popcat: coins from 15 minutes to a day old", THRESHOLDS.MIN_AGE_MINUTES === 15 && THRESHOLDS.MAX_AGE_HOURS === 24, has("agency", "from 15 minutes to a day old"));
  pinned("Popcat: about every fifteen minutes", /cron: "7,22,37,52 \* \* \* \*"/.test(fs.readFileSync(path.join(here, ".github", "workflows", "popcat.yml"), "utf8")), has("agency", "about every fifteen minutes"));
  const { PICK_WINDOW_HOURS, PICK_LOOKBACK_HOURS } = await import("./site/assets/callouts.js");
  pinned("Popcat: a pick every six hours, from the callouts checked in the six hours before", PICK_WINDOW_HOURS === 6 && PICK_LOOKBACK_HOURS === 6,
    has("agency", "Every six hours, at most one callout: of the coins with no red flags it checked in the six hours before, the one with the most holders."));
}

section("THE SEVEN-CAT KIT");
/* The art the site is built from, pinned: CoinMarketCat is the hoodie tabby (its own sprite,
   agent pair, console screen and the extension's icons), Snipurr is the old CoinMarketCat art
   under its own name, the floor has seven desks, the roster seven kittens. Change a file here
   on purpose, and its pin with it. */
/* sha256 prefixes. The four snipurr files are CoinMarketCat's old sprite, agent pair and sniper
   screen, byte for byte, under Snipurr's name. */
const KIT = {
  "brand/sprites/coinmarketcat.png": ["1e6342be07c91082", 175, 209], "brand/sprites/snipurr.png": ["4e29deea08dd7594", 146, 207],
  "brand/agents/coinmarketcat-1024.png": ["8b39e84ec94b767f", 1024, 1024], "brand/agents/coinmarketcat-avatar-400.png": ["4fcdf4a023094adf", 400, 400],
  "brand/agents/snipurr-1024.png": ["eeb7486f59b934c3", 1024, 1024], "brand/agents/snipurr-avatar-400.png": ["d91a259f9f1e9ffa", 400, 400],
  "brand/floor/workfloor.png": ["8aef43df0c67716c", 2688, 1520], "brand/floor/screen-cashcat.png": ["f08daff33e2e8f0d", 1168, 880], "brand/floor/screen-coinmarketcat.png": ["7062354d73fe3960", 1168, 880],
  "brand/floor/screen-snipurr.png": ["37b93ddc105e5269", 1168, 880],
  "brand/source/pixel-roster-2688x1152.png": ["8c4058b0518ff8e1", 2688, 1152], "brand/source/pixel-coinmarketcat-alt-1024.png": ["29cf77da23b786e6", 1024, 1024],
  "icons/coinmarketcat-32.png": ["65f329ec4cd372ea", 32, 32], "icons/coinmarketcat-128.png": ["3ed3f3104839059c", 128, 128], "icons/coinmarketcat-512.png": ["d5553c9863b2ed62", 512, 512],
};
const pngSize = (f) => { const b = fs.readFileSync(f); return b.toString("latin1", 1, 4) === "PNG" ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };
for (const [f, [hash, w, h]] of Object.entries(KIT)) {
  const file = path.join(here, f);
  ok(`${f}: the kit's file, ${w} × ${h}`, fs.existsSync(file) && JSON.stringify(pngSize(file)) === JSON.stringify([w, h]) && sha256(file).startsWith(hash), fs.existsSync(file) ? sha256(file).slice(0, 8) : "missing");
}
const same = (a, b) => fs.existsSync(a) && fs.existsSync(b) && sha256(a) === sha256(b);
ok("the site's link preview and hero pictures are the kit's banners, byte for byte",
  ["og-1200x630.jpg", "site-hero-1200x514.jpg", "site-hero-2400x1029.jpg"].every((f) => same(path.join(SITE, "assets", f), path.join(here, "brand", "banner", f))));
ok("the site's CoinMarketCat icons are the extension's, byte for byte", ["32", "128", "512"].every((n) => same(path.join(SITE, "icons", `coinmarketcat-${n}.png`), path.join(here, "icons", `coinmarketcat-${n}.png`))));
ok("every sprite on the site is its kit sprite at the kit's size", Object.keys(CATS).every((c) => JSON.stringify(pngSize(path.join(SITE, "assets", "sprites", `${c}.png`))) === JSON.stringify(pngSize(path.join(here, "brand", "sprites", `${c}.png`)))));
ok("the cards and stations draw each sprite at its own size, and CoinMarketCat in its hoodie", Object.entries({ agency: html.agency, floor: html.floor, cat: html.cat }).every(([, p]) =>
  [...p.matchAll(/src="(?:\.\.\/)?assets\/sprites\/([a-z-]+)\.png" width="(\d+)" height="(\d+)"/g)].every((m) => {
    const [w, h] = pngSize(path.join(here, "brand", "sprites", `${m[1]}.png`)); const sw = Number(m[2]) / w, sh = Number(m[3]) / h;
    return Math.abs(sw - sh) < 0.02 && [0.5, 0.75, 1].some((s) => Math.abs(sw - s) < 0.01);
  })));
const altsFor = (file) => Object.values(html).flatMap((p) => [...p.matchAll(new RegExp(`<img[^>]*src="[^"]*${file}"[^>]*alt="([^"]*)"`, "g"))].map((m) => m[1])).filter(Boolean);
ok("no picture of CoinMarketCat is described with its old look (mint, scope, crosshair, sniper)",
  altsFor("sprites/coinmarketcat\\.png").length >= 2 && altsFor("sprites/coinmarketcat\\.png").every((a) => /orange tabby kitten in a purple hoodie/.test(a) && !/mint|scope|crosshair|sniper/i.test(a))
    && altsFor("screen-coinmarketcat-800\\.webp").every((a) => !/crosshair|sniper/i.test(a)),
  altsFor("sprites/coinmarketcat\\.png").join(" | "));
ok("Snipurr's pictures are described as the mint-green kitten with the scope", altsFor("sprites/snipurr\\.png").length >= 3 && altsFor("sprites/snipurr\\.png").every((a) => /mint-green kitten in a black suit with a crosshair scope/.test(a)));
ok("every link preview says seven kittens, and names CoinMarketCat's hoodie", Object.entries(html).every(([k, p]) => /seven/i.test(meta(p, "property", "og:image:alt") || "") && /purple hoodie/.test(meta(p, "property", "og:image:alt") || "")));
ok("the console is CoinMarketCat's, with Snipurr as its sniper lane: no page calls CoinMarketCat the sniper cat",
  has("console", "Snipurr, its sniper lane") && has("console", "CoinMarketCat is not affiliated with CoinMarketCap.")
    && !/sniper cat's console|CoinMarketCat, the sniper cat|where the sniper cat/i.test(Object.values(html).join(" ")));
ok("the kit's words list seven cats: the README's agents table, the brand index and the copy's dossiers",
  ["| **Snipurr** |", "| **CashCat** |", "| **Popcat** |"].every((r) => fs.readFileSync(path.join(here, "README.md"), "utf8").includes(r))
    && /Hoodie purple \| `#8b5cf6` \| CoinMarketCat/.test(fs.readFileSync(path.join(here, "brand", "README.md"), "utf8"))
    && ["### AGENT 001: COINMARKETCAT", "### AGENT 004: CASHCAT", "### AGENT 005: POPCAT", "### AGENT 006: SNIPURR"].every((h) => fs.readFileSync(path.join(here, "brand", "COPY.md"), "utf8").includes(h)));
ok("the brand index credits Higgsfield and names no image or 3D model", /made with Higgsfield/.test(fs.readFileSync(path.join(here, "brand", "README.md"), "utf8"))
  && !/gpt[- ]?image|tripo|dall-?e|midjourney|stable diffusion|imagen|flux|hunyuan|meshy/i.test(fs.readFileSync(path.join(here, "brand", "README.md"), "utf8")));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
