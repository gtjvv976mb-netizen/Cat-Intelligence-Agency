/**
 * CASHCAT'S LOGO, DRAWN IN THE SERVICE WORKER.
 *
 * The same picture the agency's CashCat draws (bots/cashcat/logo.mjs), from the same files and
 * the same layout code (bots/cashcat/logo-layout.mjs): one of the eight kitten PNGs, copied into
 * the build byte for byte under art/, on its background, with the ticker on its sign in Press
 * Start 2P (art/font/, SIL Open Font License, unmodified), on a 1024 × 1024 OffscreenCanvas.
 *
 * THE SIGN IS MEASURED THE WAY THE BOT MEASURES IT. Before a kitten is used, its pixels are read
 * back from a canvas and run through the bot's own measureSign; the rectangle must equal the one
 * in art/signs.json (the bot's recorded measurement, which its own test re-measures). Art that
 * does not measure as recorded is refused, never drawn over.
 *
 * Only the extension's own files are read (through `urlFor`, chrome.runtime.getURL in the
 * worker): no image of anyone else's is ever loaded. Everything is injected — the canvas, the
 * image decoder, the font loader — so the same code renders in Node for the tests.
 */
import { drawLogo, measureSign, logoSpec, LOGO_SIZE, FONT_FAMILY, KITTENS } from "../../bots/cashcat/logo-layout.mjs";

export const ART_FILES = Object.freeze({
  kitten: (k) => `art/${k}.png`,
  signs: "art/signs.json",
  font: "art/font/PressStart2P-Regular.ttf",
});

export class LogoError extends Error {
  constructor(clause, message) { super(message); this.name = "LogoError"; this.clause = clause; }
}

/**
 * `urlFor(path)` → the extension's URL of one of its files; `fetchImpl` reads it; `decode(blob or
 * bytes)` → an image the canvas can draw (createImageBitmap); `makeCanvas(w, h)` → a canvas with
 * getContext("2d") and `toPng()` (an OffscreenCanvas's convertToBlob); `loadFont(family, url)`
 * makes the font drawable (a FontFace added to the worker's fonts).
 */
export function createLogoRenderer({ urlFor, fetchImpl = globalThis.fetch, decode, makeCanvas, toPng, loadFont } = {}) {
  for (const [name, fn] of Object.entries({ urlFor, fetchImpl, decode, makeCanvas, toPng, loadFont })) {
    if (typeof fn !== "function") throw new Error(`createLogoRenderer needs ${name}()`);
  }
  let fontReady = null;
  let signs = null;
  const images = new Map();     // kitten → { image, sign }

  async function read(path, as) {
    const res = await fetchImpl(urlFor(path));
    if (!res.ok) throw new LogoError("art_missing", `${path} is not in the extension's files`);
    return as === "json" ? res.json() : as === "blob" && typeof res.blob === "function" ? res.blob() : new Uint8Array(await res.arrayBuffer());
  }
  async function font() {
    fontReady ??= Promise.resolve(loadFont(FONT_FAMILY, urlFor(ART_FILES.font))).catch((e) => { fontReady = null; throw new LogoError("font", `the pixel font could not be loaded: ${e?.message ?? e}`); });
    return fontReady;
  }
  async function kitten(k) {
    if (!KITTENS.includes(k)) throw new LogoError("kitten", `unknown kitten ${k}`);
    if (images.has(k)) return images.get(k);
    signs ??= await read(ART_FILES.signs, "json");
    const recorded = signs[k];
    const image = await decode(await read(ART_FILES.kitten(k), "blob"));
    const w = image.width, h = image.height;
    if (w !== LOGO_SIZE || h !== LOGO_SIZE) throw new LogoError("art_size", `${k}.png is ${w} × ${h}, not ${LOGO_SIZE} × ${LOGO_SIZE}`);
    const probe = makeCanvas(w, h);
    const ctx = probe.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const measured = measureSign(ctx.getImageData(0, 0, w, h));
    if (!recorded || ["x", "y", "w", "h"].some((f) => measured[f] !== recorded[f]))
      throw new LogoError("sign_mismatch", `${k}.png's sign measures ${JSON.stringify(measured)}, not the ${JSON.stringify(recorded ?? null)} the bot recorded`);
    const out = { image, sign: measured };
    images.set(k, out);
    return out;
  }

  /** Render one logo: { png: Uint8Array, sign, place }. */
  async function render({ ticker, kitten: k, background }) {
    try { logoSpec({ ticker, kitten: k, background }); } catch (e) { throw new LogoError("spec", e.message); }
    await font();
    const { image, sign } = await kitten(k);
    const canvas = makeCanvas(LOGO_SIZE, LOGO_SIZE);
    const place = drawLogo(canvas.getContext("2d"), { image, sign, ticker, kitten: k, background });
    const png = await toPng(canvas);
    return { png, sign, place };
  }
  return Object.freeze({ render, measure: async (k) => (await kitten(k)).sign });
}

/** The worker's renderer: OffscreenCanvas, createImageBitmap and a FontFace in self.fonts. */
export function workerLogoRenderer({ urlFor, scope = globalThis }) {
  return createLogoRenderer({
    urlFor,
    fetchImpl: (u) => scope.fetch(u),
    decode: (blob) => scope.createImageBitmap(blob),
    makeCanvas: (w, h) => new scope.OffscreenCanvas(w, h),
    toPng: async (c) => new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer()),
    loadFont: async (family, url) => {
      const face = new scope.FontFace(family, `url(${url})`);
      await face.load();
      scope.fonts.add(face);
    },
  });
}
