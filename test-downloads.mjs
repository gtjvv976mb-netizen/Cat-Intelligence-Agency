/**
 * THE DOWNLOADS HOLD WHAT THE PAGE SAYS, AND COME OUT THE SAME EVERY TIME.
 *
 * Builds the extension twice, each time into a temporary folder (build.mjs's own options),
 * packages each build into a temporary folder (scripts/package.mjs), and checks, with no browser:
 *
 *   · the extension zip: manifest.json at its root, with this manifest's name and version; every
 *     file of the build and nothing else; no source map; INSTALL.txt with the six steps, the
 *     update, the removal and the SHA-256 commands;
 *   · every entry dated 1980-01-01 00:00, mode 0644, names sorted; the second build, packaged
 *     again, gives the same bytes, so the SHA-256 the page shows is stable for a commit;
 *   · the system's unzip, when there is one, tests both zips: a second reader agrees with ours;
 *   · the cats pack: all seven cats, each with its sprite, 400 avatar and 1024 art byte for byte
 *     from brand/, the banners and the $CIA logo, and a README naming each cat and what it
 *     does, claiming no licence;
 *   · the data file written for a build evaluates, and its numbers are the zips';
 *   · the zip writer refuses an unsafe name and a name twice, and packaging refuses a build
 *     without a manifest and a version it was not asked for;
 *   · the deploy packages after the overlay and before the site's tests; a tagged release
 *     attaches both zips, with contents: write only, pinned actions and no stored credentials.
 *
 * Loading the zip in a browser is scripts/verify-download.mjs's job (it needs Chromium).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? "  — " + detail : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const section = (title) => console.log(`\n${title}\n${"─".repeat(title.length)}`);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

let esbuildPresent = true;
try { require.resolve("esbuild"); } catch { esbuildPresent = false; }
if (!esbuildPresent) {
  if (process.env.GITHUB_ACTIONS === "true" || process.env.CI) {
    console.log("  FAIL esbuild is not installed on CI — run `npm ci` in the workflow");
    process.exit(1);
  }
  console.log("  (esbuild is not installed here — `npm ci` at the repository root to run the packaging test; CI runs it)");
  process.exit(0);
}

const { buildOptions, copyStatic } = await import("./build.mjs");
const esbuild = require("esbuild");
/** build.mjs's own build (its entries, plugin and static files), quietly, into outdir. */
async function buildInto(outdir) {
  fs.mkdirSync(outdir, { recursive: true });
  await esbuild.build({ ...buildOptions({ outdir }), logLevel: "silent" });
  copyStatic(outdir);
}
const pkgMod = await import("./scripts/package.mjs");
const { packageDownloads, dataFileText, extensionEntries, EXTENSION_ZIP, CATS_ZIP, CATS, catFiles, CATS_EXTRAS, PLACEHOLDER } = pkgMod;
const { writeZip, readZip, safeEntryName } = await import("./scripts/zip.mjs");
const manifest = JSON.parse(fs.readFileSync(path.join(here, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cia-downloads-test-"));
const runs = [];
try {
  for (const n of [1, 2]) {
    const dist = path.join(tmp, `dist-${n}`), out = path.join(tmp, `out-${n}`);
    await buildInto(dist);
    const info = packageDownloads({ distDir: dist, outDir: out, dataFile: path.join(out, "downloads-data.js"), commit: "0".repeat(40) });
    runs.push({ dist, out, info, ext: fs.readFileSync(path.join(out, EXTENSION_ZIP)), cats: fs.readFileSync(path.join(out, CATS_ZIP)) });
  }
  const [a, b] = runs;

  section("THE EXTENSION ZIP");
  const entries = readZip(a.ext);
  const names = entries.map((e) => e.name);
  const zm = JSON.parse(entries.find((e) => e.name === "manifest.json")?.data.toString("utf8") ?? "{}");
  ok("manifest.json is at the zip's root, so the unzipped folder is the one Load unpacked takes", names.includes("manifest.json"));
  ok("its name and version are this manifest's", zm.name === manifest.name && zm.version === manifest.version, `"${zm.name}" ${zm.version}`);
  const built = walk(a.dist).map((f) => path.relative(a.dist, f).split(path.sep).join("/")).sort();
  ok("it holds every file of the build and nothing else, plus INSTALL.txt",
    JSON.stringify(names.filter((n) => n !== "INSTALL.txt").sort()) === JSON.stringify(built.filter((f) => !/\.map$/.test(f)))
      && entries.every((e) => e.name === "INSTALL.txt" || e.data.equals(fs.readFileSync(path.join(a.dist, e.name)))), `${names.length} entries`);
  ok("every file the manifest names is in it: the worker, the popup, the options page, the content and injected scripts, the icons",
    [zm.background?.service_worker, zm.action?.default_popup, zm.options_page, ...(zm.content_scripts ?? []).flatMap((c) => c.js), ...(zm.web_accessible_resources ?? []).flatMap((w) => w.resources),
      ...Object.values(zm.icons ?? {}), ...Object.values(zm.action?.default_icon ?? {})].every((f) => f && names.includes(f)));
  ok("no source map, no hidden file, no name the browser reserves (a leading underscore), every path safe",
    !names.some((n) => /\.map$/i.test(n) || n.split("/").some((p) => p.startsWith(".") || p.startsWith("_"))) && names.every(safeEntryName));
  {
    fs.writeFileSync(path.join(a.dist, "background.js.map"), "{}");
    const withMap = extensionEntries(a.dist).entries.map((e) => e.name);
    fs.rmSync(path.join(a.dist, "background.js.map"));
    ok("a source map in dist/ is left out", !withMap.includes("background.js.map") && withMap.includes("background.js"));
  }
  const install = entries.find((e) => e.name === "INSTALL.txt")?.data.toString("utf8") ?? "";
  ok("INSTALL.txt: the version, the six steps for Chrome, Brave and Edge, the update, the removal, the SHA-256 commands, and not in the Chrome Web Store",
    install.includes(`Version ${manifest.version}.`) && install.includes(`"${manifest.name}"`)
      && ["chrome://extensions", "brave://extensions", "edge://extensions", "Turn on Developer mode.", "Click Load unpacked and choose this folder.", "Pin the extension",
        "Replace this folder with the new one: same place, same name.", "click the reload arrow", "takes its ID from its folder's path",
        "Removing the extension deletes everything it stored in this browser", "withdraw it first", `certutil -hashfile ${EXTENSION_ZIP} SHA256`,
        `shasum -a 256 ${EXTENSION_ZIP}`, `sha256sum ${EXTENSION_ZIP}`, "It is not in the Chrome Web Store yet"].every((p) => install.includes(p)));

  section("THE SAME BYTES EVERY TIME");
  ok("every entry is dated 1980-01-01 00:00, with mode 0644", [...entries, ...readZip(a.cats)].every((e) => e.date === 33 && e.time === 0 && e.mode === 0o100644));
  ok("entries are in sorted order", JSON.stringify(names) === JSON.stringify([...names].sort()));
  ok("text is deflated and pictures are stored", entries.every((e) => (/\.(js|html|css|json|txt)$/.test(e.name) ? e.method === 8 : e.method === 0)));
  ok("a second build, packaged again, gives the same extension zip, byte for byte", a.ext.equals(b.ext), sha256(a.ext).slice(0, 16));
  ok("and the same cats pack", a.cats.equals(b.cats), sha256(a.cats).slice(0, 16));
  ok("the same entries in another order give the same zip", writeZip([...readZip(a.ext)].reverse().map((e) => ({ name: e.name, data: e.data }))).equals(a.ext));
  const unzip = spawnSync("unzip", ["-tq", path.join(a.out, EXTENSION_ZIP)], { encoding: "utf8" });
  if (unzip.error?.code === "ENOENT") console.log("  (no system unzip here to test the zips with a second reader)");
  else {
    const cats = spawnSync("unzip", ["-tq", path.join(a.out, CATS_ZIP)], { encoding: "utf8" });
    const listed = spawnSync("unzip", ["-Z1", path.join(a.out, EXTENSION_ZIP)], { encoding: "utf8" }).stdout.trim().split("\n");
    ok("the system's unzip tests both zips and lists the same entries", unzip.status === 0 && cats.status === 0 && JSON.stringify(listed) === JSON.stringify(names), (unzip.stdout + cats.stdout).trim().replace(/\n/g, " | "));
  }

  section("THE CATS PACK");
  const cats = readZip(a.cats);
  const catNames = cats.map((e) => e.name);
  ok("all seven cats, in the order the kit lists them", JSON.stringify(CATS.map((c) => c.id)) === JSON.stringify(["director", "crying-cat", "grumpy-cat", "cashcat", "popcat", "snipurr", "coinmarketcat"]));
  for (const c of CATS)
    ok(`${c.name}: its sprite, 400 avatar and 1024 art, byte for byte the kit's`,
      catFiles(c.id).every(([name, from]) => cats.find((e) => e.name === name)?.data.equals(fs.readFileSync(path.join(here, from)))));
  ok("the X header, the link preview, the roster scene and the $CIA logo, byte for byte the kit's",
    CATS_EXTRAS.every(([name, from]) => cats.find((e) => e.name === name)?.data.equals(fs.readFileSync(path.join(here, from))))
      && JSON.stringify(CATS_EXTRAS.map(([n]) => n)) === JSON.stringify(["banners/x-header-1500x500.jpg", "banners/og-1200x630.jpg", "banners/site-hero-2400x1029.jpg", "logo/cia-token-1000.png"]));
  ok("and nothing else but README.txt", catNames.length === CATS.length * 3 + CATS_EXTRAS.length + 1 && catNames.includes("README.txt"), `${catNames.length} entries`);
  const readme = cats.find((e) => e.name === "README.txt")?.data.toString("utf8") ?? "";
  ok("README.txt names each cat and what it does", CATS.every((c) => readme.includes(`${c.name.padEnd(13)}  ${c.does}`)) && CATS.every((c) => c.does.length > 20));
  ok("README.txt calls it the agency's art, and claims no licence", readme.includes("The agency's art") && !/licen[cs]e|copyright|©|creative commons|\bCC[- ]BY|public domain|free to use|royalty/i.test(readme));
  ok("README.txt carries the owner's disclaimer", readme.includes("It is not affiliated with\nany government agency, CoinMarketCap, or the owners of any real cat.") && readme.includes("$CIA is a memecoin with no intrinsic value. Nothing here is financial advice."));

  section("THE DATA FILE");
  const src = fs.readFileSync(path.join(a.out, "downloads-data.js"), "utf8");
  const data = new Function("window", `${src}; return window.CIA_DOWNLOADS;`)({});
  ok("it evaluates as a plain script to window.CIA_DOWNLOADS, marked built", data?.built === true);
  ok("its sizes and SHA-256s are the zips'", data.files.extension.bytes === a.ext.length && data.files.extension.sha256 === sha256(a.ext) && data.files.cats.bytes === a.cats.length && data.files.cats.sha256 === sha256(a.cats)
    && data.files.extension.name === EXTENSION_ZIP && data.files.cats.name === CATS_ZIP);
  ok("its versions are package.json's and the manifest's, its name the manifest's, its commit the one given", data.version.package === pkg.version && data.version.manifest === manifest.version
    && data.extensionName === manifest.name && data.commit === "0".repeat(40));
  ok("it is ASCII, whatever the name holds", /^[\x09\x0a\x20-\x7e]*$/.test(src));
  const placeholder = new Function("window", `${dataFileText()}; return window.CIA_DOWNLOADS;`)({});
  ok("the committed placeholder is the script's own, and every number in it says \"built at deploy\"", fs.readFileSync(path.join(here, "site", "assets", "downloads-data.js"), "utf8") === dataFileText()
    && placeholder.built === false && [placeholder.commit, placeholder.version.package, placeholder.version.manifest, placeholder.extensionName,
      placeholder.files.extension.bytes, placeholder.files.extension.sha256, placeholder.files.cats.bytes, placeholder.files.cats.sha256].every((v) => v === PLACEHOLDER));

  section("REFUSALS");
  const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
  ok("the zip writer refuses an unsafe name", ["../x", "/abs", "a//b", "a\\b", "./x", "", "café.txt"].every((n) => throws(() => writeZip([{ name: n, data: "x" }]), /unsafe entry name/)));
  ok("and a name twice", throws(() => writeZip([{ name: "a", data: "1" }, { name: "a", data: "2" }]), /twice/));
  ok("packaging refuses a build with no manifest", throws(() => packageDownloads({ distDir: path.join(tmp, "nothing"), outDir: path.join(tmp, "o"), dataFile: null }), /manifest\.json is missing/));
  ok("and a version it was not asked for (a tag that is not the manifest's)", throws(() => packageDownloads({ distDir: a.dist, outDir: path.join(tmp, "o2"), dataFile: null, expectVersion: "999.0.0" }), /the version asked for is 999\.0\.0/)
    && !fs.existsSync(path.join(tmp, "o2", EXTENSION_ZIP)));
  {
    const stale = path.join(tmp, "stale");
    fs.cpSync(a.dist, stale, { recursive: true });
    fs.writeFileSync(path.join(stale, "manifest.json"), JSON.stringify({ ...manifest, version: "0.0.0-stale" }));
    ok("and a dist/ built from another manifest", throws(() => packageDownloads({ distDir: stale, outDir: path.join(tmp, "o3"), dataFile: null }), /not this checkout's manifest/));
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

section("THE DEPLOY AND THE RELEASE");
{
  const pages = fs.readFileSync(path.join(here, ".github", "workflows", "pages.yml"), "utf8");
  const release = fs.readFileSync(path.join(here, ".github", "workflows", "release.yml"), "utf8");
  const o = pages.indexOf("floor-data.mjs overlay site/assets"), p = pages.indexOf("run: npm run build && node scripts/package.mjs\n"),
    t = pages.indexOf("node test-site.mjs && node test-bots-data.mjs"), u = pages.indexOf("upload-pages-artifact");
  ok("pages.yml: npm ci, the overlay, then the build and the packaging, then the site's tests on what was packaged, then the upload",
    pages.indexOf("- run: npm ci") > 0 && pages.indexOf("- run: npm ci") < o && o < p && p < t && t < u);
  ok("a failed build or packaging fails the deploy: no continue-on-error, no `|| true`", !/continue-on-error|\|\| true/.test(pages));
  ok("a push that changes the extension or the art redeploys, so the zips follow main",
    ["src/**", "manifest.json", "icons/**", "vendor/**", "build.mjs", "package.json", "package-lock.json", "brand/**", "scripts/package.mjs", "scripts/zip.mjs"].every((x) => pages.includes(`"${x}"`)));
  ok("release.yml: on a pushed tag v*, and nothing else", /on:\n  push:\n    tags: \["v\*"\]\n\npermissions: \{\}\n/.test(release) && !/pull_request|workflow_dispatch|branches:/.test(release));
  ok("its job may write contents (the release) and nothing more", /permissions:\n      contents: write\n    concurrency:/.test(release) && (release.match(/: write/g) || []).length === 1);
  ok("it runs the suite, builds, and packages for the tag's version only", ["run: npm test", "run: npm run build", 'node scripts/package.mjs --out .release --no-data --release --expect-version "${TAG#v}"'].every((x) => release.includes(x))
    && release.indexOf("run: npm test") < release.indexOf("run: npm run build") && release.indexOf("run: npm run build") < release.indexOf("run: node scripts/package.mjs"));
  ok("it attaches both zips and SHA256SUMS.txt to the tag's release", ["cat-intelligence-agency-extension.zip", "cia-cats.zip", "SHA256SUMS.txt"].every((f) => release.includes(`.release/${f}`))
    && /gh release create "\$TAG" "\$\{files\[@\]\}"/.test(release) && /--verify-tag/.test(release) && /--notes-file \.release\/RELEASE-NOTES\.md/.test(release));
  ok("its actions are pinned to a commit, and its checkout keeps no credentials",
    [...release.matchAll(/uses: ([^\s]+)/g)].every((m) => /@[0-9a-f]{40}$/.test(m[1])) && /persist-credentials: false/.test(release) && !/secrets\./.test(release));
  ok("the release's packaging output is ignored by git", fs.readFileSync(path.join(here, ".gitignore"), "utf8").split("\n").includes(".release/"));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
