/**
 * THE MANIFEST IS THE EXTENSION'S CHARTER: WHAT IT MAY TOUCH, AND WHERE.
 *
 * A browser extension that can sign for a wallet is exactly the shape a drainer takes,
 * so the permissions are pinned here and a widening fails the suite by name. The content
 * script runs on the console pages only; the injected script is web-accessible to those
 * origins only; there is no `<all_urls>`, no `tabs`, no `scripting`, no `cookies`, no
 * `webRequest`. The host permission is broad because the RPC is whatever URL the user
 * pastes — that is a fetch permission, not a page permission.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONSOLE_URLS, CONFIG_DEFAULTS } from "./src/lib/config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, "manifest.json"), "utf8"));

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? "  — " + detail : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};

console.log("\nTHE MANIFEST\n────────────");
ok("manifest v3", manifest.manifest_version === 3, `v${manifest.manifest_version}`);
ok("a module service worker, so the engine's ESM imports load", manifest.background?.service_worker === "background.js" && manifest.background?.type === "module", JSON.stringify(manifest.background));
ok("Chrome 116+, where websocket activity keeps a worker alive", Number(manifest.minimum_chrome_version) >= 116, manifest.minimum_chrome_version);

const ALLOWED_PERMISSIONS = new Set(["storage", "alarms", "notifications", "unlimitedStorage"]);
const perms = manifest.permissions ?? [];
ok("permissions are storage, alarms and notifications only", perms.every((p) => ALLOWED_PERMISSIONS.has(p)) && perms.includes("storage"), perms.join(", "));
for (const banned of ["tabs", "scripting", "cookies", "webRequest", "webRequestBlocking", "declarativeNetRequest", "history", "clipboardRead", "debugger", "nativeMessaging", "management", "proxy"])
  ok(`never ${banned}`, !perms.includes(banned) && !(manifest.optional_permissions ?? []).includes(banned));
ok("no optional permissions", !manifest.optional_permissions || manifest.optional_permissions.length === 0);

const hosts = manifest.host_permissions ?? [];
ok("host permissions are https and wss only — the RPC the user pastes", hosts.length === 2 && hosts.includes("https://*/*") && hosts.includes("wss://*/*"), hosts.join(", "));
ok("no http host permission (an RPC key over plain http is a leak)", !hosts.some((h) => h.startsWith("http://")));

const cs = manifest.content_scripts ?? [];
ok("exactly one content script", cs.length === 1, `${cs.length}`);
const matches = cs[0]?.matches ?? [];
ok("it matches the console pages only", matches.length === CONSOLE_URLS.length && CONSOLE_URLS.every((u) => matches.includes(`${u}*`)), matches.join(", "));
ok("never <all_urls> or a wildcard host", !matches.some((m) => m === "<all_urls>" || /\*:\/\/\*/.test(m) || /^https?:\/\/\*/.test(m)));
ok("top frame only", cs[0]?.all_frames !== true);
ok("it loads content.js only", JSON.stringify(cs[0]?.js) === JSON.stringify(["content.js"]), JSON.stringify(cs[0]?.js));
const war = manifest.web_accessible_resources ?? [];
ok("the injected script is the only web-accessible resource", war.length === 1 && JSON.stringify(war[0].resources) === JSON.stringify(["injected.js"]), JSON.stringify(war));
ok("and only to the console origins", (war[0]?.matches ?? []).every((m) => CONSOLE_URLS.some((u) => m.startsWith(new URL(u).origin))), (war[0]?.matches ?? []).join(", "));
ok("the default console URL is one the content script matches", CONSOLE_URLS.includes(CONFIG_DEFAULTS.consoleUrl), CONFIG_DEFAULTS.consoleUrl);
ok("no externally_connectable — no other site or extension may message the worker", manifest.externally_connectable === undefined);
ok("the icons are the agency's own mark (Crying Cat's face from the $CIA coin), at 32, 128 and 512", ["32", "128", "512"].every((s) => manifest.icons?.[s] === `icons/cia-${s}.png`) && ["32", "128"].every((s) => manifest.action?.default_icon?.[s] === `icons/cia-${s}.png`), JSON.stringify(manifest.icons));
/* The description used to say "It never holds a key". With the autopilot wallet that is
   false in one mode, so the charter now says what is true in both, and may not say the
   old sentence again. */
ok("the description does not claim the extension never holds a key (on autopilot it holds one)", !/never holds a key|holds no key/i.test(manifest.description), manifest.description);
/* The extension is the agency's: one download with its five software cats inside. The charter
   says so in both places a person reads it — the extension's name and its store description —
   and CoinMarketCat is one of the cats, not the extension's name. Who signs is said on the
   checklists and in the popup, where there is room to say it fully. */
ok("the name is Cat Intelligence Agency, the short name and the toolbar title agree", manifest.name === "Cat Intelligence Agency" && manifest.name.length <= 45
  && manifest.short_name === "Cat Intel" && manifest.short_name.length <= 12 && manifest.action?.default_title === "Cat Intelligence Agency", `${manifest.name} / ${manifest.short_name}`);
ok("the description names all five cats and what each does: CoinMarketCat, Snipurr, Popcat, CashCat, Crying Cat",
  ["CoinMarketCat (AI trading)", "Snipurr (sniper)", "Popcat (cat-coin scanner)", "CashCat (coin launcher)", "Crying Cat (rug check)"].every((c) => manifest.description.includes(c)), manifest.description);
ok("…and never uses the agency's initials for itself (only $CIA, the coin, uses them)", !/\bCIA\b/.test(`${manifest.name} ${manifest.short_name} ${manifest.description} ${manifest.action?.default_title}`));
ok("…and claims nothing it cannot keep: no returns, no 24/7, no leverage", !/profit|return|24\/7|always on|leverage|guarantee/i.test(manifest.description));
ok("the description fits Chrome's 132-character limit", manifest.description.length <= 132, `${manifest.description.length} characters`);
/* The store kit says the store takes its short description from the manifest's description: the
   kit's sentence and the manifest's must be the same, character for character. */
{
  const listing = fs.readFileSync(path.join(here, "docs", "chrome-web-store", "listing.md"), "utf8");
  const short = listing.match(/## Short description[^\n]*\n\n```\n([^\n]*)\n```/)?.[1] ?? null;
  ok("the store kit's short description is the manifest's description, character for character, and its count is right",
    short === manifest.description && new RegExp(`\\b${manifest.description.length} characters\\b`).test(listing), JSON.stringify(short));
}

console.log("\nTHE FIRST-RUN SETUP PAGE\n────────────────────────");
{
  const { ENTRIES, STATIC } = await import("./build.mjs");
  ok("the build bundles the setup page's script", ENTRIES["welcome.js"] === "welcome/welcome.mjs", JSON.stringify(ENTRIES["welcome.js"]));
  const statics = STATIC.map(([from, to]) => `${from} → ${to}`);
  ok("the build copies welcome.html and welcome.css", STATIC.some(([f, t]) => f === "src/welcome/welcome.html" && t === "welcome.html") && STATIC.some(([f, t]) => f === "src/welcome/welcome.css" && t === "welcome.css"), statics.filter((x) => /welcome/.test(x)).join(", "));
  const html = fs.readFileSync(path.join(here, "src", "welcome", "welcome.html"), "utf8");
  ok("welcome.html loads welcome.js and welcome.css by their built names", /<script type="module" src="welcome\.js"><\/script>/.test(html) && /href="welcome\.css"/.test(html));
  ok("welcome.html shows the agency's icon and names the five cats, each with its sprite", /src="icons\/cia-128\.png"/.test(html) && /Cat Intelligence Agency/.test(html) && /sniper cat/.test(html)
    && ["coinmarketcat", "snipurr", "popcat", "cashcat", "crying-cat"].every((c) => html.includes(`src="sprites/${c}.png"`)) && /CoinMarketCat is not affiliated with CoinMarketCap\./.test(html));
  ok("welcome.html loads nothing from the network (an extension page: its own files only)", !/(src|href)="(https?:)?\/\//.test(html));
  ok("the setup page is not web-accessible: no web page can frame or open it", !(manifest.web_accessible_resources ?? []).some((w) => (w.resources ?? []).some((r) => /welcome/.test(r))));
  ok("no permission was added for it (tabs.create of an extension page needs none)", perms.every((p) => ALLOWED_PERMISSIONS.has(p)));
  const bg = fs.readFileSync(path.join(here, "src", "background.mjs"), "utf8");
  const installed = bg.match(/onInstalled\.addListener\(\(details\) => \{([\s\S]*?)\n\}\);/)?.[1] ?? "";
  ok("the worker opens the setup page from onInstalled, and only when the reason is \"install\"", /details\?\.reason === "install"/.test(installed) && /chrome\.tabs\.create\(\{ url: chrome\.runtime\.getURL\(WELCOME_PAGE\) \}\)/.test(installed) && /WELCOME_PAGE = "welcome\.html"/.test(bg), installed.trim().split("\n").filter((l) => /reason|tabs\.create/.test(l)).map((l) => l.trim()).join(" | "));
  ok("…and never from onStartup", !/onStartup\.addListener\([^\n]*WELCOME/.test(bg));
}

console.log("\nEVERY HOST PERMISSION, JUSTIFIED\n────────────────────────────────");
{
  /* The Chrome Web Store asks why each host permission is needed. manifest.json cannot carry a
     comment, so the reasons are in build.mjs (HOST_PERMISSION_REASONS), and the README repeats them. */
  const { HOST_PERMISSION_REASONS, HOSTS_CALLED } = await import("./build.mjs");
  ok("every host permission the manifest asks for has a reason, and no reason is for one it does not ask for",
    JSON.stringify([...hosts].sort()) === JSON.stringify(Object.keys(HOST_PERMISSION_REASONS).sort()) && Object.values(HOST_PERMISSION_REASONS).every((r) => r.length > 60), Object.keys(HOST_PERMISSION_REASONS).join(", "));
  const readme = fs.readFileSync(path.join(here, "README.md"), "utf8").replace(/\s+/g, " ");
  ok("the README gives each reason, word for word", Object.values(HOST_PERMISSION_REASONS).every((r) => readme.includes(r)));
  /* Every fixed host a cat's code names is on the list the README shows, with who calls it and why. */
  const listed = new Set(HOSTS_CALLED.map(([h]) => h));
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  const catFiles = ["src/lib/agent-market.mjs", "src/lib/agent-brain.mjs", "src/lib/jupiter-swap.mjs", "src/lib/xstock-discovery.mjs", "bots/lib/verified.mjs"];
  const named = new Set(catFiles.flatMap((f) => [...strip(fs.readFileSync(path.join(here, f), "utf8")).matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)].map((m) => m[1])));
  const { POPCAT_TAB_HOSTS } = await import("./src/lib/popcat-tab.mjs");
  const { DRAFT_HOSTS } = await import("./src/lib/cashcat-draft.mjs");
  const { STOCKCAT_HOSTS } = await import("./src/lib/stockcats.mjs");
  const called = new Set([...POPCAT_TAB_HOSTS, ...DRAFT_HOSTS, ...STOCKCAT_HOSTS, "uploads.pinata.cloud", "gateway.pinata.cloud", ...[...named].filter((h) => ["api.anthropic.com", "api.dexscreener.com", "api.geckoterminal.com", "api.jup.ag", "datapi.jup.ag"].includes(h))]);
  ok("every fixed host the cats call is listed with who calls it and why", [...called].every((h) => listed.has(h)), [...called].filter((h) => !listed.has(h)).join(", ") || `${called.size} hosts`);
  ok("…and the README's table of hosts lists each", HOSTS_CALLED.every(([h]) => readme.includes(`\`${h}\``)));
  ok("…word for word: the host, who calls it and why, as one row of that table", HOSTS_CALLED.every(([h, who, why]) => readme.includes(`| \`${h}\` | ${who} | ${why} |`)),
    HOSTS_CALLED.filter(([h, who, why]) => !readme.includes(`| \`${h}\` | ${who} | ${why} |`)).map(([h]) => h).join(", "));
  ok("the stock cats call StonkFun's API, listed as CoinMarketCat's", STOCKCAT_HOSTS.length === 1 && HOSTS_CALLED.some(([h, who]) => h === STOCKCAT_HOSTS[0] && who === "CoinMarketCat"));
  ok("no permission was added for the three new cats: still storage, alarms and notifications", perms.every((p) => ALLOWED_PERMISSIONS.has(p)) && perms.length === 3, perms.join(", "));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
