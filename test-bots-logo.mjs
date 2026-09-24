/**
 * CASHCAT'S LOGOS: THE KITTENS, THE SIGN EACH HOLDS, THE FONT AND ITS LICENCE, AND THE RENDER.
 *
 * The eight Higgsfield kittens are 1024 × 1024 transparent PNGs; each sign's rectangle in
 * art/signs.json is re-measured here from the pixels and must match; the font is Press Start 2P,
 * shipped unmodified with its SIL Open Font License; a rendered logo is 1024 × 1024, the chosen
 * background fills the corners, and the ticker's ink sits inside the sign.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { harness, ROOT } from "./bots/test/doubles.mjs";

const { ok, section, done } = harness("test-bots-logo");
let canvas = null;
try { canvas = await (await import("./bots/cashcat/logo.mjs")).canvasModule(); } catch { canvas = null; }
if (!canvas) {
  console.log("  (the logo renderer is not installed: run `npm ci --prefix bots`; CI does)");
  ok("the renderer is installed where CI runs the suite", !process.env.CI);
  done();
}
const { KITTENS, BACKGROUNDS, ART_DIR, measureKitten, renderLogo, loadSigns, fitScale, pickArt, LOGO_SIZE } = await import("./bots/cashcat/logo.mjs");
const sha = (f) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");

section("THE KITTENS");
ok("eight kittens, as the art folder holds them", JSON.stringify(fs.readdirSync(ART_DIR).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)).sort()) === JSON.stringify([...KITTENS].sort()));
for (const k of KITTENS) {
  const b = fs.readFileSync(path.join(ART_DIR, `${k}.png`));
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), colorType = b[25];
  ok(`${k}: a 1024 × 1024 PNG with an alpha channel`, b.subarray(1, 4).toString() === "PNG" && w === 1024 && h === 1024 && colorType === 6);
}

section("THE SIGNS, MEASURED AGAIN");
const signs = loadSigns();
for (const k of KITTENS) {
  const m = await measureKitten(k);
  ok(`${k}: ${JSON.stringify(m)}`, JSON.stringify(m) === JSON.stringify(signs[k]) && m.w > 400 && m.h > 200 && m.y < 150);
}

section("THE FONT AND ITS LICENCE");
const fontDir = path.join(ART_DIR, "font");
const ofl = fs.readFileSync(path.join(fontDir, "OFL.txt"), "utf8");
ok("Press Start 2P, shipped as downloaded from Google Fonts (41,660 bytes, pinned by hash)", sha(path.join(fontDir, "PressStart2P-Regular.ttf")) === "e224371fadc3bb5268dbdd23bce33b812b6c0287969a0b7018645c0a07081e73");
ok("beside it the SIL Open Font License 1.1, with the font's copyright and reserved name", /SIL OPEN FONT LICENSE Version 1\.1/.test(ofl) && /Copyright 2012 The Press Start 2P Project Authors/.test(ofl) && /Reserved Font Name "Press Start 2P"/.test(ofl));
{
  /* The name table's Windows records are UTF-16 big-endian. */
  const b = Buffer.from(fs.readFileSync(path.join(fontDir, "PressStart2P-Regular.ttf")));
  const text = [0, 1].map((shift) => Buffer.from(b.subarray(shift, shift + ((b.length - shift) & ~1))).swap16().toString("utf16le")).join(" ");
  ok("the font file's own name table carries the same copyright and the OFL", /The Press Start 2P Project Authors/.test(text) && /scripts\.sil\.org\/OFL/.test(text));
}

section("A RENDERED LOGO");
{
  const png = await renderLogo({ ticker: "MDCAT", kitten: "ginger", background: "violet" });
  const img = await canvas.loadImage(png);
  const c = canvas.createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
  ok("1024 × 1024", img.width === LOGO_SIZE && img.height === LOGO_SIZE);
  const hex = BACKGROUNDS.violet;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  ok("the background fills the corners", [[2, 2], [1021, 2], [2, 1021]].every(([x, y]) => { const p = px(x, y); return Math.abs(p[0] - r) < 3 && Math.abs(p[1] - g) < 3 && Math.abs(p[2] - b) < 3; }));
  const s = signs.ginger;
  const { data } = ctx.getImageData(s.x, s.y, s.w, s.h);
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] < 80 && data[i + 1] < 60 && data[i + 2] < 40) ink++;
  ok("the ticker's dark ink is on the sign", ink > 2000, `${ink} ink pixels inside the sign`);
  const other = await renderLogo({ ticker: "WHSKR", kitten: "ginger", background: "violet" });
  ok("another ticker is another image", !other.equals(png));
  ok("a bad ticker, kitten or background is refused", await (async () => { for (const a of [{ ticker: "lower", kitten: "ginger", background: "violet" }, { ticker: "OK", kitten: "lion", background: "violet" }, { ticker: "OK", kitten: "ginger", background: "plaid" }]) { try { await renderLogo(a); return false; } catch {} } return true; })());
  ok("ten characters still fit the narrowest sign, on the font's 8-pixel grid", fitScale("$CATNIP2025", signs.siamese) >= 4 && fitScale("$CATNIP2025", signs.siamese) * 8 * 11 <= signs.siamese.w);
  ok("without the model's choice, the art is picked the same way for the same ticker", JSON.stringify(pickArt("MDCAT")) === JSON.stringify(pickArt("MDCAT")) && KITTENS.includes(pickArt("MDCAT").kitten));
}

done();
