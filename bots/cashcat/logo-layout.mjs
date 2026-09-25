/**
 * CASHCAT'S LOGO, WITHOUT A RENDERER: the eight kittens, the backgrounds, where each sign is, how
 * big the ticker may be, and the drawing itself on ANY 2D canvas context.
 *
 * Two renderers use this file and nothing else decides the picture:
 *   · the bot, in Node, on @napi-rs/canvas (bots/cashcat/logo.mjs);
 *   · the extension, in the service worker, on an OffscreenCanvas with the same PNGs and the same
 *     font file copied into the build (src/lib/cashcat-logo.mjs).
 * So a coin drawn by the extension is laid out exactly as the bot lays out its own: the same
 * kitten image at 1024 × 1024, the same background, the ticker in Press Start 2P at the largest
 * whole multiple of the font's 8-pixel grid that fits the sign, centred on whole pixels.
 *
 * WHERE THE SIGN IS. measureSign() reads a kitten image's pixels (the block of cream, opaque
 * pixels the blank sign is painted in); the rectangles it gives are kept in art/signs.json, and
 * both the bot's test and the extension's re-measure the PNGs and must get the same numbers.
 *
 * No fs, no path, no Node built-in: this module is bundled into the extension as it is.
 */
export const KITTENS = Object.freeze(["black", "calico", "ginger", "greytabby", "siamese", "sphynx", "tuxedo", "white"]);
/** Backgrounds: the agency's palette (site/assets/home.css) plus a few more, all strong enough under a sign. */
export const BACKGROUNDS = Object.freeze({
  violet: "#9945ff", mint: "#14f195", gold: "#f5c542", sky: "#5ab8ff", orange: "#e8742c", pink: "#ff4fd8", ink: "#0b0716", teal: "#1fb5a8",
});
export const LOGO_SIZE = 1024;
export const INK = "#2b1a10";
export const FONT_FAMILY = "CashCatPixel";
export const TICKER_RE = /^[A-Z0-9]{2,10}$/;

const isCream = (r, g, b, a) => a > 200 && r > 215 && g > 200 && b > 170 && r - b < 70 && r >= g && g >= b - 5;

/**
 * The sign's rectangle in a kitten image: the rows where cream pixels are densest, as one
 * contiguous band, then the columns cream across most of that band. Returns { x, y, w, h }.
 * `data` is RGBA, as ImageData gives it (a canvas's getImageData, in Node or a browser).
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

/**
 * The largest pixel scale at which `text` fits inside the sign with a margin: Press Start 2P
 * draws each glyph on an 8 × 8 grid, so a scale s is a font size of 8·s pixels.
 */
export function fitScale(text, sign) {
  const chars = text.length;
  const maxW = sign.w * 0.9, maxH = sign.h * 0.5;
  const s = Math.floor(Math.min(maxW / (chars * 8), maxH / 8));
  return Math.max(2, Math.min(s, 12));
}

/** The words on the sign, and the checks every renderer makes before it draws. */
export function logoSpec({ ticker, kitten, background }) {
  if (!KITTENS.includes(kitten)) throw new Error(`unknown kitten ${kitten}`);
  const color = BACKGROUNDS[background];
  if (!color) throw new Error(`unknown background ${background}`);
  if (typeof ticker !== "string" || !TICKER_RE.test(ticker)) throw new Error("the ticker must be 2 to 10 of A-Z and 0-9");
  return { text: `$${ticker}`, color, kitten };
}

/**
 * Where the ticker goes on the sign: { scale, fontPx, x, y } for a text `width` wide at fontPx.
 * `measure(fontPx)` returns that width (the renderer's own measureText, in the loaded font).
 */
export function placeText({ text, sign, measure }) {
  const scale = fitScale(text, sign);
  const fontPx = 8 * scale;
  const width = Math.round(measure(fontPx));
  return { scale, fontPx, width, x: Math.round(sign.x + (sign.w - width) / 2), y: Math.round(sign.y + (sign.h - fontPx) / 2) };
}

/**
 * Draw one logo on `ctx` (a 1024 × 1024 2D context: @napi-rs/canvas or an OffscreenCanvas):
 * the background, the kitten image, the ticker on its sign. The font `fontFamily` must be
 * loaded by the caller. Returns the placement it used.
 */
export function drawLogo(ctx, { image, sign, ticker, kitten, background, fontFamily = FONT_FAMILY }) {
  const spec = logoSpec({ ticker, kitten, background });
  ctx.fillStyle = spec.color;
  ctx.fillRect(0, 0, LOGO_SIZE, LOGO_SIZE);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, LOGO_SIZE, LOGO_SIZE);
  const place = placeText({ text: spec.text, sign, measure: (px) => { ctx.font = `${px}px ${fontFamily}`; return ctx.measureText(spec.text).width; } });
  ctx.font = `${place.fontPx}px ${fontFamily}`;
  ctx.fillStyle = INK;
  ctx.textBaseline = "top";
  ctx.fillText(spec.text, place.x, place.y);
  return place;
}

/** A kitten and a background for a ticker, when none was named: stable per ticker. */
export function pickArt(ticker) {
  let h = 0;
  for (const ch of String(ticker)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = Object.keys(BACKGROUNDS);
  return { kitten: KITTENS[h % KITTENS.length], background: bg[(h >>> 3) % bg.length] };
}
