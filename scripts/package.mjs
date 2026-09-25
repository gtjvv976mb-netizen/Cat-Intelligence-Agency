#!/usr/bin/env node
/**
 * PACKAGE THE DOWNLOADS: THE EXTENSION AND THE SEVEN CATS, AS ZIPS THE SITE SERVES.
 *
 *   cat-intelligence-agency-extension.zip   dist/ as `npm run build` wrote it, with manifest.json
 *                                           at the zip's root (so the unzipped folder is the one
 *                                           "Load unpacked" takes) and INSTALL.txt beside it. No
 *                                           source maps, nothing that is not in dist/.
 *   cia-cats.zip                            each cat's sprite, 400 avatar and 1024 art from brand/,
 *                                           the banners, the $CIA logo and a README naming the cats.
 *   site/assets/downloads-data.js           window.CIA_DOWNLOADS: each zip's name, size and
 *                                           SHA-256, the versions, the commit. The page reads it
 *                                           as a script (no fetch). The committed copy is a
 *                                           placeholder that says "built at deploy".
 *
 * The zips are deterministic (scripts/zip.mjs): the same dist/ and brand/ give the same bytes.
 * The deploy (.github/workflows/pages.yml) runs this after `npm run build`, into site/; the
 * zips are never committed. A tagged release (.github/workflows/release.yml) runs it with
 * --release into a folder of its own and attaches the zips to the GitHub Release.
 *
 * Usage (after `npm ci && npm run build`):
 *   node scripts/package.mjs                     the deploy's run: site/downloads/*.zip and the data file
 *   node scripts/package.mjs --placeholder       put the committed placeholder back and delete the zips
 *   node scripts/package.mjs --out <dir> [--no-data | --data <file>] [--dist <dir>]
 *                            [--release] [--expect-version <x.y.z>]
 *     --release          also write SHA256SUMS.txt and RELEASE-NOTES.md into --out
 *     --expect-version   fail unless manifest.json and package.json both carry this version
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeZip } from "./zip.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "https://github.com/gtjvv976mb-netizen/Cat-Intelligence-Agency";
const SITE_URL = "https://catintelligenceagency.com/";

export const EXTENSION_ZIP = "cat-intelligence-agency-extension.zip";
export const CATS_ZIP = "cia-cats.zip";
export const PLACEHOLDER = "built at deploy";
export const SITE_DOWNLOADS = path.join(ROOT, "site", "downloads");
export const DATA_FILE = path.join(ROOT, "site", "assets", "downloads-data.js");

/** The seven cats, in the order the pack's README lists them, with what each one does. */
export const CATS = Object.freeze([
  { id: "director", name: "The Director", does: "Runs the agency and signs every correction. The mascot." },
  { id: "crying-cat", name: "Crying Cat", does: "The rug check: it goes after ruggers. The face of $CIA." },
  { id: "grumpy-cat", name: "Grumpy Cat", does: "Fake hype. Nothing impresses it." },
  { id: "cashcat", name: "CashCat", does: "The coin launcher: launches cat-themed coins from what is trending, on pump.fun and StonkFun." },
  { id: "popcat", name: "Popcat", does: "The cat-coin scanner: checks every new cat coin on pump.fun and names its red flags." },
  { id: "snipurr", name: "Snipurr", does: "The sniper: new pump.fun launches, sniped by rule." },
  { id: "coinmarketcat", name: "CoinMarketCat", does: "AI trading: agentic trading for Solana, in plain English, inside limits the model cannot change." },
]);

/** What goes in the cats pack besides the cats: [path in the zip, path under the repository]. */
export const CATS_EXTRAS = Object.freeze([
  ["banners/x-header-1500x500.jpg", "brand/banner/x-header-1500x500.jpg"],
  ["banners/og-1200x630.jpg", "brand/banner/og-1200x630.jpg"],
  ["banners/site-hero-2400x1029.jpg", "brand/banner/site-hero-2400x1029.jpg"],
  ["logo/cia-token-1000.png", "brand/logo/cia-token-1000.png"],
]);

/** Each cat's three pictures: [path in the zip, path under the repository]. */
export const catFiles = (id) => [
  [`${id}/${id}-sprite.png`, `brand/sprites/${id}.png`],
  [`${id}/${id}-avatar-400.png`, `brand/agents/${id}-avatar-400.png`],
  [`${id}/${id}-1024.png`, `brand/agents/${id}-1024.png`],
];

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

/** The words in INSTALL.txt, at the root of the extension zip. */
export function installText(manifest) {
  return `THE CAT INTELLIGENCE AGENCY EXTENSION
Version ${manifest.version}. Your browser lists it as "${manifest.name}".
${SITE_URL}downloads/

It runs in Chrome, Brave or Edge on a computer (version 116 or later), not on a
phone. It is not in the Chrome Web Store yet, so you load it yourself, in Developer
mode. It takes a minute.

INSTALL
1. Unzip the download. You get a folder with manifest.json in it: this folder.
   Keep it somewhere it can stay, such as your Documents folder. The browser loads
   the extension from this folder every time it starts, so do not delete it.
2. Open chrome://extensions (in Brave: brave://extensions, in Edge: edge://extensions).
3. Turn on Developer mode.
4. Click Load unpacked and choose this folder.
5. Pin the extension: click the puzzle-piece icon in the toolbar, then the pin
   beside it (in Edge, the eye icon).

UPDATE
1. Download the new version and unzip it.
2. Replace this folder with the new one: same place, same name.
3. On the extensions page, click the reload arrow on the extension's card.
Your settings stay. The browser keeps them under the extension's ID, and an
extension loaded this way takes its ID from its folder's path. Loaded from a
different folder, it is a new extension, with none of your settings.

REMOVE
Removing the extension deletes everything it stored in this browser: its settings,
your API key and the encrypted key of any wallet it made. If such a wallet holds
anything, withdraw it first. Then click Remove on the extension's card and delete
this folder.

CHECK THE DOWNLOAD
The zip's SHA-256 is on ${SITE_URL}downloads/
Compute yours and compare:
  Windows:  certutil -hashfile ${EXTENSION_ZIP} SHA256
  macOS:    shasum -a 256 ${EXTENSION_ZIP}
  Linux:    sha256sum ${EXTENSION_ZIP}

Source: ${REPO}
Nothing here is financial advice.
`;
}

/** The words in README.txt, at the root of the cats pack. */
export function catsReadme() {
  const width = Math.max(...CATS.map((c) => c.name.length));
  return `CAT INTELLIGENCE AGENCY: THE SEVEN CATS
${SITE_URL}

The agency's art: every cat, the banners and the $CIA logo.

THE CATS
${CATS.map((c) => `  ${c.name.padEnd(width)}  ${c.does}`).join("\n")}

EACH CAT'S FOLDER
  <cat>-sprite.png       the pixel sprite: transparent, on a 4 px grid. Scale it by
                         whole numbers, with pixelated (nearest-neighbour) scaling.
  <cat>-avatar-400.png   400 x 400: the cat standing on the pixel floor, for a
                         profile picture.
  <cat>-1024.png         1024 x 1024, transparent: for posts and reaction images.

banners/
  x-header-1500x500.jpg     the X header: the seven in a row
  og-1200x630.jpg           the link preview
  site-hero-2400x1029.jpg   the roster scene: the seven on a neon pixel floor at night

logo/
  cia-token-1000.png        the $CIA logo: Crying Cat over a case file stamped RUGGED

Cat Intelligence Agency is a meme and software project. It is not affiliated with
any government agency, CoinMarketCap, or the owners of any real cat. Popcat is not
affiliated with the $POPCAT memecoin.
$CIA is a memecoin with no intrinsic value. Nothing here is financial advice.
`;
}

/** Every file of the built extension, and INSTALL.txt. Refuses a dist/ without a manifest. */
export function extensionEntries(distDir) {
  const manifestFile = path.join(distDir, "manifest.json");
  if (!fs.existsSync(manifestFile)) throw new Error(`${path.relative(ROOT, distDir) || distDir}/manifest.json is missing: run \`npm run build\` first`);
  const manifest = readJson(manifestFile);
  const files = walk(distDir)
    .map((f) => path.relative(distDir, f).split(path.sep).join("/"))
    .filter((rel) => !/\.map$/i.test(rel) && !rel.split("/").some((part) => part.startsWith(".")));
  if (files.includes("INSTALL.txt")) throw new Error("dist/ already holds an INSTALL.txt");
  return {
    manifest,
    entries: [
      ...files.map((rel) => ({ name: rel, data: fs.readFileSync(path.join(distDir, rel)) })),
      { name: "INSTALL.txt", data: installText(manifest) },
    ],
  };
}

/** The seven cats' pictures, the banners, the logo and README.txt, from brand/. */
export function catsEntries(root = ROOT) {
  const pairs = [...CATS.flatMap((c) => catFiles(c.id)), ...CATS_EXTRAS];
  const missing = pairs.filter(([, from]) => !fs.existsSync(path.join(root, from))).map(([, from]) => from);
  if (missing.length) throw new Error(`brand/ is missing ${missing.join(", ")}`);
  return [...pairs.map(([name, from]) => ({ name, data: fs.readFileSync(path.join(root, from)) })), { name: "README.txt", data: catsReadme() }];
}

/** The commit checked out (a deploy a bot calls checks out main, which may be newer than the
    commit GITHUB_SHA names), else GITHUB_SHA, else "unknown". */
function currentCommit() {
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  if (git.status === 0 && /^[0-9a-f]{40}$/.test(git.stdout.trim())) return git.stdout.trim();
  return /^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || "") ? process.env.GITHUB_SHA : "unknown";
}

const HEADER = `/* THE DOWNLOADS PAGE'S NUMBERS: each zip's name, size in bytes and SHA-256, the versions and
   the commit they were built from. scripts/package.mjs writes this file when the deploy packages
   the downloads; the page reads it as a script, never with fetch. The committed copy is the
   placeholder, and says "${PLACEHOLDER}" wherever a number goes: put it back with
   \`node scripts/package.mjs --placeholder\` before a commit. test-site.mjs checks either form. */
`;
/** JSON with every non-ASCII character escaped, so the file reads the same in any charset. */
const asciiJson = (value) => JSON.stringify(value, null, 2).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** The data file's source, for a build's numbers or, with no numbers, the placeholder. */
export function dataFileText(info = null) {
  const value = info ? {
    built: true,
    commit: info.commit,
    version: { package: info.version.package, manifest: info.version.manifest },
    extensionName: info.extensionName,
    files: {
      extension: { name: EXTENSION_ZIP, bytes: info.extension.bytes, sha256: info.extension.sha256 },
      cats: { name: CATS_ZIP, bytes: info.cats.bytes, sha256: info.cats.sha256 },
    },
  } : {
    built: false,
    commit: PLACEHOLDER,
    version: { package: PLACEHOLDER, manifest: PLACEHOLDER },
    extensionName: PLACEHOLDER,
    files: {
      extension: { name: EXTENSION_ZIP, bytes: PLACEHOLDER, sha256: PLACEHOLDER },
      cats: { name: CATS_ZIP, bytes: PLACEHOLDER, sha256: PLACEHOLDER },
    },
  };
  return `${HEADER}window.CIA_DOWNLOADS = ${asciiJson(value)};\n`;
}

/**
 * Build both zips into outDir and, unless dataFile is null, write the data file.
 * Returns what the data file says.
 */
export function packageDownloads({ distDir = path.join(ROOT, "dist"), outDir = SITE_DOWNLOADS, root = ROOT, dataFile = DATA_FILE, commit = currentCommit(), expectVersion = null } = {}) {
  const pkg = readJson(path.join(root, "package.json"));
  const { manifest, entries } = extensionEntries(distDir);
  const repoManifest = readJson(path.join(root, "manifest.json"));
  if (manifest.name !== repoManifest.name || manifest.version !== repoManifest.version)
    throw new Error("dist/manifest.json is not this checkout's manifest.json: run `npm run build` again");
  if (expectVersion !== null && (manifest.version !== expectVersion || pkg.version !== expectVersion))
    throw new Error(`the version asked for is ${expectVersion}; manifest.json says ${manifest.version} and package.json says ${pkg.version}`);
  fs.mkdirSync(outDir, { recursive: true });
  const extensionZip = writeZip(entries);
  const catsZip = writeZip(catsEntries(root));
  fs.writeFileSync(path.join(outDir, EXTENSION_ZIP), extensionZip);
  fs.writeFileSync(path.join(outDir, CATS_ZIP), catsZip);
  const info = {
    commit,
    version: { package: pkg.version, manifest: manifest.version },
    extensionName: manifest.name,
    extension: { bytes: extensionZip.length, sha256: sha256(extensionZip) },
    cats: { bytes: catsZip.length, sha256: sha256(catsZip) },
  };
  if (dataFile) fs.writeFileSync(dataFile, dataFileText(info));
  return info;
}

/** SHA256SUMS.txt, in the format `sha256sum -c` reads. */
export const sumsText = (info) => `${info.extension.sha256}  ${EXTENSION_ZIP}\n${info.cats.sha256}  ${CATS_ZIP}\n`;

export function releaseNotes(info) {
  return `The Cat Intelligence Agency extension, version ${info.version.manifest}, built from ${info.commit}.

- **${EXTENSION_ZIP}**: the extension for Chrome, Brave or Edge (116 or later). Unzip it, open \`chrome://extensions\`, turn on Developer mode, click **Load unpacked** and choose the unzipped folder. The steps, and how to update and remove it, are in INSTALL.txt inside the zip and on ${SITE_URL}downloads/. It is not in the Chrome Web Store.
- **${CATS_ZIP}**: all seven cats (sprite, 400 avatar, 1024 art), the banners and the $CIA logo.

| File | Bytes | SHA-256 |
|---|---:|---|
| ${EXTENSION_ZIP} | ${info.extension.bytes} | \`${info.extension.sha256}\` |
| ${CATS_ZIP} | ${info.cats.bytes} | \`${info.cats.sha256}\` |

The same sums are in SHA256SUMS.txt (\`sha256sum -c SHA256SUMS.txt\`). Nothing here is financial advice.
`;
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const known = new Set(["--out", "--data", "--no-data", "--dist", "--release", "--expect-version", "--placeholder"]);
  const unknown = argv.filter((a, i) => a.startsWith("--") && !known.has(a) && !["--out", "--data", "--dist", "--expect-version"].includes(argv[i - 1]));
  if (unknown.length) throw new Error(`unknown option ${unknown.join(" ")}`);
  if (argv.includes("--placeholder")) {
    fs.writeFileSync(DATA_FILE, dataFileText());
    for (const f of [EXTENSION_ZIP, CATS_ZIP]) fs.rmSync(path.join(SITE_DOWNLOADS, f), { force: true });
    console.log(`${path.relative(ROOT, DATA_FILE)} is the placeholder again, and site/downloads/ holds no zip`);
    return;
  }
  const outDir = path.resolve(arg("--out") ?? SITE_DOWNLOADS);
  const toSite = outDir === SITE_DOWNLOADS;
  const dataFile = argv.includes("--no-data") ? null : path.resolve(arg("--data") ?? (toSite ? DATA_FILE : path.join(outDir, "downloads-data.js")));
  const distDir = path.resolve(arg("--dist") ?? path.join(ROOT, "dist"));
  const info = packageDownloads({ distDir, outDir, dataFile, expectVersion: arg("--expect-version") ?? null });
  if (argv.includes("--release")) {
    fs.writeFileSync(path.join(outDir, "SHA256SUMS.txt"), sumsText(info));
    fs.writeFileSync(path.join(outDir, "RELEASE-NOTES.md"), releaseNotes(info));
  }
  for (const [label, f] of [[EXTENSION_ZIP, info.extension], [CATS_ZIP, info.cats]])
    console.log(`  ${label.padEnd(40)} ${String(f.bytes).padStart(9)} bytes  sha256 ${f.sha256}`);
  console.log(`packaged "${info.extensionName}" ${info.version.manifest} (package.json ${info.version.package}) from ${info.commit} into ${path.relative(ROOT, outDir) || "."}`);
  if (dataFile) console.log(`wrote ${path.relative(ROOT, dataFile)}`);
  if (toSite && dataFile === DATA_FILE)
    console.log("site/ now holds this build's zips and numbers. Before a commit: node scripts/package.mjs --placeholder");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error(`package: ${e.message}`); process.exit(1); }
}
