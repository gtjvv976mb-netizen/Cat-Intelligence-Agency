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
 * WHERE THE SIGN IS. Each kitten's blank sign was measured from its pixels (measureSign below:
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

export const ART_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "art");
export const KITTENS = Object.freeze(["black", "calico", "ginger", "greytabby", "siamese", "sphynx", "tuxedo", "white"]);
/** Backgrounds: the agency's palette (site/assets/home.css) plus a few more, all strong enough under a sign. */
export const BACKGROUNDS = Object.freeze({
  violet: "#9945ff", mint: "#14f195", gold: "#f5c542", sky: "#5ab8ff", orange: "#e8742c", pink: "#ff4fd8", ink: "#0b0716", teal: "#1fb5a8",
});
export const LOGO_SIZE = 1024;
const INK = "#2b1a10";
const FONT_FAMILY = "CashCatPixel";

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

const isCream = (r, g, b, a) => a > 200 && r > 215 && g > 200 && b > 170 && r - b < 70 && r >= g && g >= b - 5;

/**
 * The sign's rectangle in a kitten image: the rows where cream pixels are densest, as one
 * contiguous band, then the columns cream across most of that band. Returns { x, y, w, h }.
 */
export function measureSign({ width, height, data }) {
  const at = (x, y) => { const i = (y * width + x) * 4; return isCream(data[i], data[i + 1], data[i + 2], data[i + 3]); };
  const rows = [];
  for (let y = 0; y < height; y++) { let n = 0; for (let x = 0; x < width; x += 2) if (at(x, y)) n++; rows.push(n); }
  const best = Math.max(...rows), ym = rows.indexOf(best);
  let y0 = ym, y1 = ym;
  while (y0 > 0 && rows[y0 - 1] > best * 0.6) y0--;
  while (y1 < height - 1 && rows[y1 + 1] > best * 0.6) y1++;
  const cols = [];
  for (let x = 0; x < width; x++) { let n = 0; for (let y = y0; y <= y1; y += 2) if (at(x, y)) n++; cols.push(n); }
  const cb = Math.max(...cols), xm = cols.indexOf(cb);
  let x0 = xm, x1 = xm;
  while (x0 > 0 && cols[x0 - 1] > cb * 0.6) x0--;
  while (x1 < width - 1 && cols[x1 + 1] > cb * 0.6) x1++;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

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

/**
 * The largest pixel scale at which `text` fits inside the sign with a margin: Press Start 2P
 * draws each glyph on an 8 × 8 grid, so a scale s is a font size of 8·s pixels.
 */
export function fitScale(text, sign) {
  const chars = text.length;
  const maxW = sign.w * 0.9, maxH = sign.h * 0.5;
  let s = Math.floor(Math.min(maxW / (chars * 8), maxH / 8));
  return Math.max(2, Math.min(s, 12));
}

/** Render one logo. Returns a PNG as a Buffer. */
export async function renderLogo({ ticker, kitten, background }) {
  if (!KITTENS.includes(kitten)) throw new Error(`unknown kitten ${kitten}`);
  const color = BACKGROUNDS[background];
  if (!color) throw new Error(`unknown background ${background}`);
  if (typeof ticker !== "string" || !/^[A-Z0-9]{2,10}$/.test(ticker)) throw new Error("the ticker must be 2 to 10 of A-Z and 0-9");
  const { createCanvas, loadImage } = await lib();
  const sign = loadSigns()[kitten];
  const img = await loadImage(fs.readFileSync(path.join(ART_DIR, `${kitten}.png`)));
  const canvas = createCanvas(LOGO_SIZE, LOGO_SIZE);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, LOGO_SIZE, LOGO_SIZE);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, LOGO_SIZE, LOGO_SIZE);
  const text = `$${ticker}`;
  const s = fitScale(text, sign);
  ctx.font = `${8 * s}px ${FONT_FAMILY}`;
  ctx.fillStyle = INK;
  ctx.textBaseline = "top";
  const width = Math.round(ctx.measureText(text).width);
  const x = Math.round(sign.x + (sign.w - width) / 2);
  const y = Math.round(sign.y + (sign.h - 8 * s) / 2);
  ctx.fillText(text, x, y);
  return canvas.toBuffer("image/png");
}

/** A kitten and a background for a ticker, when the model named none: stable per ticker. */
export function pickArt(ticker) {
  let h = 0;
  for (const ch of String(ticker)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = Object.keys(BACKGROUNDS);
  return { kitten: KITTENS[h % KITTENS.length], background: bg[(h >>> 3) % bg.length] };
}
