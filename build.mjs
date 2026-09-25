#!/usr/bin/env node
/**
 * BUILD THE EXTENSION: the Cat Intelligence Agency extension, with CoinMarketCat, Snipurr,
 * Popcat, CashCat and Crying Cat inside.
 *
 * Six bundles (the worker, the console relay, the injected Phantom bridge, the popup,
 * the options page and the first-run setup page), one manifest, three icons, the five cats'
 * sprites and CashCat's logo art and font, into ./dist — the folder Chrome loads unpacked.
 * The point of this file is the plugin, not the entry list:
 *
 *   · the engine imports the executor's snipe modules from vendor/executor/, copied
 *     verbatim from a named commit of Claude-Company by scripts/sync-executor.mjs and
 *     hashed in PROVENANCE.json, so the browser runs THE SAME entry contract, curve
 *     arithmetic, buy_v2/sell_v2 encoders and exit determiner WALL-ST-E runs. What
 *     this bot refuses is decided upstream and synced, never edited here.
 *   · two imports in that closure are Node-only. `node:crypto` (token2022's digest)
 *     is redirected to src/shims/node-crypto.mjs; `./jupiter.mjs` (which pulls the
 *     SQLite journal) is redirected to src/shims/jupiter.mjs. Any OTHER `node:` import
 *     that ever creeps into the closure fails the build by name, rather than shipping
 *     a bundle that throws at first use.
 *   · @solana/web3.js, bs58, buffer and @noble/hashes resolve from this repository's
 *     node_modules, pinned to the executor's exact versions, so one copy of web3.js
 *     exists in every bundle and a PublicKey made in one module is a PublicKey in another.
 *
 * Usage: node build.mjs [--watch]   (after `npm ci`)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = here;
const SRC = path.join(here, "src");
const DIST = path.join(here, "dist");
const EXECUTOR_MODULES = path.join(ROOT, "node_modules");
const watch = process.argv.includes("--watch");

const require = createRequire(import.meta.url);
let esbuild;
try { esbuild = require("esbuild"); }
catch {
  console.error("esbuild is not installed: run `npm ci` here first");
  process.exit(1);
}
if (!fs.existsSync(path.join(EXECUTOR_MODULES, "@solana", "web3.js"))) {
  console.error("the dependencies are not installed: run `npm ci` here first");
  process.exit(1);
}

export const SHIMS = Object.freeze({
  "node:crypto": path.join(SRC, "shims", "node-crypto.mjs"),
  "jupiter.mjs": path.join(SRC, "shims", "jupiter.mjs"),
});

/** The packages the bundle may take from the executor's tree, by name. */
const EXECUTOR_PACKAGES = /^(@solana\/web3\.js|bs58|buffer|@noble\/hashes)(\/.*)?$/;

export const shimPlugin = {
  name: "coinmarketcat-shims",
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => {
      const hit = SHIMS[args.path];
      if (hit) return { path: hit };
      return { errors: [{ text: `${args.path} reached the browser bundle from ${args.importer} — ` +
        "a Node built-in with no shim; add one to build.mjs or cut the import" }] };
    });
    build.onResolve({ filter: /(^|\/)jupiter\.mjs$/ }, (args) => {
      if (args.importer.startsWith(SRC)) return null;   // our own files may not import it at all
      return { path: SHIMS["jupiter.mjs"] };
    });
    build.onResolve({ filter: EXECUTOR_PACKAGES }, (args) => {
      /* Let esbuild do the package-exports and "browser"-field walk, but anchored at the
         executor's node_modules so both trees resolve to the same files. build.resolve
         re-enters every onResolve hook, this one included; the pluginData marker is what
         stops that being an infinite loop. */
      if (args.pluginData?.hawkAnchored) return null;
      return build.resolve(args.path, {
        kind: args.kind, resolveDir: ROOT, importer: args.importer,
        pluginData: { hawkAnchored: true },
      });
    });
  },
};

export const ENTRIES = Object.freeze({
  "background.js": "background.mjs",
  "content.js": "content.mjs",
  "injected.js": "injected.mjs",
  "popup.js": "popup/popup.mjs",
  "options.js": "options/options.mjs",
  "welcome.js": "welcome/welcome.mjs",     // the first-run setup page the worker opens on install
});

/* The five cats in the extension, each with its pixel sprite from the brand kit (brand/sprites/),
   copied byte for byte for the popup's tabs and the setup page. */
export const CAT_SPRITES = Object.freeze(["coinmarketcat", "snipurr", "popcat", "cashcat", "crying-cat"]);
/* CashCat's logo art, copied byte for byte from bots/cashcat/art/: the eight kittens (1024 × 1024),
   their measured signs, and Press Start 2P with its licence (SIL OFL 1.1: bundled unmodified). */
export const CASHCAT_KITTENS = Object.freeze(["black", "calico", "ginger", "greytabby", "siamese", "sphynx", "tuxedo", "white"]);

export const STATIC = Object.freeze([
  ["manifest.json", "manifest.json"],
  ["src/popup/popup.html", "popup.html"],
  ["src/popup/popup.css", "popup.css"],
  ["src/options/options.html", "options.html"],
  ["src/welcome/welcome.html", "welcome.html"],
  ["src/welcome/welcome.css", "welcome.css"],
  ...CAT_SPRITES.map((c) => [`brand/sprites/${c}.png`, `sprites/${c}.png`]),
  ...CASHCAT_KITTENS.map((k) => [`bots/cashcat/art/${k}.png`, `art/${k}.png`]),
  ["bots/cashcat/art/signs.json", "art/signs.json"],
  ["bots/cashcat/art/font/PressStart2P-Regular.ttf", "art/font/PressStart2P-Regular.ttf"],
  ["bots/cashcat/art/font/OFL.txt", "art/font/OFL.txt"],
]);

/* The icons are the agency's own mark: Crying Cat's face from the $CIA coin (brand/logo/). */
const ICONS = Object.freeze([
  ["icons/cia-32.png", "icons/cia-32.png"],
  ["icons/cia-128.png", "icons/cia-128.png"],
  ["icons/cia-512.png", "icons/cia-512.png"],
]);

/**
 * WHY EACH HOST PERMISSION. manifest.json cannot carry a comment, so the reasons live here;
 * test-hawk-manifest.mjs requires one for every host permission the manifest asks for, and the
 * README repeats them for the Chrome Web Store's review.
 */
export const HOST_PERMISSION_REASONS = Object.freeze({
  "https://*/*": "The Solana RPC is whatever https URL the user pastes in Options (Helius, Triton, QuickNode or their own node), so no fixed host list can name it; every other request goes to one of the fixed hosts listed with its reason (the agent's model, prices and swaps; Popcat's pump.fun listing and IPFS metadata; CashCat's trends, verified-token list and Pinata uploads). A fetch permission only: the extension injects nothing into any page but the agency's console page.",
  "wss://*/*": "Snipurr's live feed is one logsSubscribe websocket to the same user-chosen RPC (its wss URL, or the one derived from the https URL).",
});

/** Every fixed host the extension's code calls, which cat calls it, and why. The RPC is the user's. */
export const HOSTS_CALLED = Object.freeze([
  ["api.anthropic.com", "CoinMarketCat, CashCat", "the model, with the user's own API key (list the models; the agent's decisions; CashCat's drafts and reviews)"],
  ["api.dexscreener.com", "CoinMarketCat, Snipurr", "prices for the agent's tokens; new pools paired with a stock (off by default)"],
  ["api.geckoterminal.com", "CoinMarketCat, Snipurr", "15-minute candles for the agent; new pools (off by default)"],
  ["api.jup.ag", "CoinMarketCat, Snipurr", "quotes, swaps and fallback prices, keyless"],
  ["datapi.jup.ag", "Snipurr", "Jupiter's newest launchpad pools, only if the user chooses that feed"],
  ["frontend-api-v3.pump.fun", "Popcat", "pump.fun's newest coins and a creator's launch count"],
  ["pump.mypinata.cloud", "Popcat", "a coin's metadata by its IPFS CID, to see whether it names a social link (none is shown or followed)"],
  ["gateway.pinata.cloud", "Popcat, CashCat", "the same metadata by CID; CashCat reads back what it pinned"],
  ["uploads.pinata.cloud", "CashCat", "pins the logo and metadata of the user's coin, with the user's own Pinata JWT"],
  ["trends.google.com", "CashCat", "Google Trends' US trending-searches feed, for drafting from a trend"],
  ["api.coingecko.com", "CashCat", "CoinGecko's trending categories, for drafting from a trend"],
  ["lite-api.jup.ag", "CashCat", "Jupiter's verified-token list: no draft may take a verified token's ticker or name"],
]);

export function buildOptions({ outdir = DIST } = {}) {
  return {
    entryPoints: Object.fromEntries(Object.entries(ENTRIES).map(([out, src]) => [out.replace(/\.js$/, ""), path.join(SRC, src)])),
    outdir,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome116"],
    sourcemap: false,
    minify: false,
    legalComments: "none",
    logLevel: "info",
    inject: [path.join(SRC, "shims", "buffer-inject.mjs")],
    define: {
      "process.env.NODE_ENV": '"production"',
      global: "globalThis",
    },
    nodePaths: [EXECUTOR_MODULES],
    plugins: [shimPlugin],
  };
}

export function copyStatic(outdir = DIST) {
  for (const [from, to] of STATIC) {
    const dest = path.join(outdir, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(here, from), dest);
  }
  for (const [from, to] of ICONS) {
    const dest = path.join(outdir, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, from), dest);
  }
}

export async function buildOnce({ outdir = DIST } = {}) {
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });
  const result = await esbuild.build(buildOptions({ outdir }));
  copyStatic(outdir);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (watch) {
    fs.mkdirSync(DIST, { recursive: true });
    copyStatic(DIST);
    const ctx = await esbuild.context(buildOptions());
    await ctx.watch();
    console.log(`watching ${SRC} → ${DIST}`);
  } else {
    await buildOnce();
    const files = fs.readdirSync(DIST).filter((f) => f.endsWith(".js"));
    for (const f of files) {
      const kb = (fs.statSync(path.join(DIST, f)).size / 1024).toFixed(0);
      console.log(`  ${f.padEnd(16)} ${kb} KB`);
    }
    console.log(`built into ${DIST} — load it unpacked at chrome://extensions`);
  }
}
