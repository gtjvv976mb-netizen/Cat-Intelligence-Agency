/**
 * CASHCAT'S COIN LOGOS: a coloured background, a pixel kitten holding a blank sign, and the
 * ticker written on the sign in a pixel font.
 *
 * The eight kittens (bots/cashcat/art/*.png, 1024 × 1024, transparent) were made with
 * Higgsfield for the agency. The font is Press Start 2P (bots/cashcat/art/font/), © 2012 The
 * Press Start 2P Project Authors, under the SIL Open Font License 1.1 (OFL.txt beside it): it
 * may be bundled and used freely, not sold by itself, and its Reserved Font Name is not used
 * for anything modified. It is used unmodified.
 *
 * WHERE THE SIGN IS. Each kitten's blank sign was measured from its pixels (measureSign, in logo-layout.mjs:
 * the block of cream, opaque pixels the sign is painted in), and the rectangles are kept in
 * art/signs.json; test-bots-logo.mjs measures the PNGs again and must get the same numbers.
 *
 * Rendering is @napi-rs/canvas (bots/package.json), a prebuilt Skia binding: no browser, no
 * system fonts. The text is drawn at a whole multiple of the font's 8-pixel grid, on whole
 * pixels, so its letters stay square.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KITTENS, BACKGROUNDS, LOGO_SIZE, FONT_FAMILY, measureSign, fitScale, drawLogo, logoSpec, pickArt } from "./logo-layout.mjs";

/* The layout lives in logo-layout.mjs, which the extension bundles too: this file is the Node
   renderer around it (the files on disk, @napi-rs/canvas, the registered font). */
export { KITTENS, BACKGROUNDS, LOGO_SIZE, measureSign, fitScale, pickArt };

export const ART_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "art");

let canvasLib = null;
async function lib() {
  if (canvasLib) return canvasLib;
  try { canvasLib = await import("@napi-rs/canvas"); }
  catch { throw new Error("@napi-rs/canvas is not installed: run `npm ci --prefix bots`"); }
  const font = path.join(ART_DIR, "font", "PressStart2P-Regular.ttf");
  if (!canvasLib.GlobalFonts.has(FONT_FAMILY)) canvasLib.GlobalFonts.registerFromPath(font, FONT_FAMILY);
  return canvasLib;
}

/** The renderer, resolved from bots/node_modules (for the tests, which live at the root). */
export const canvasModule = () => lib();

export async function measureKitten(kitten) {
  const { loadImage, createCanvas } = await lib();
  const img = await loadImage(fs.readFileSync(path.join(ART_DIR, `${kitten}.png`)));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return measureSign(ctx.getImageData(0, 0, img.width, img.height));
}

export function loadSigns() {
  return JSON.parse(fs.readFileSync(path.join(ART_DIR, "signs.json"), "utf8"));
}

/** Render one logo. Returns a PNG as a Buffer. */
export async function renderLogo({ ticker, kitten, background }) {
  logoSpec({ ticker, kitten, background });
  const { createCanvas, loadImage } = await lib();
  const sign = loadSigns()[kitten];
  const img = await loadImage(fs.readFileSync(path.join(ART_DIR, `${kitten}.png`)));
  const canvas = createCanvas(LOGO_SIZE, LOGO_SIZE);
  drawLogo(canvas.getContext("2d"), { image: img, sign, ticker, kitten, background });
  return canvas.toBuffer("image/png");
}
