/**
 * AMOUNTS AS STRINGS. The contract (docs/hq/API.md) carries every amount as a string of decimal
 * SOL or token units, never a float in JSON. Money is BigInt lamports and raw token units in
 * here, and becomes a string only at the edge, exactly: 1500000000 lamports is "1.5".
 */
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const SOL_DECIMALS = 9;

const big = (v, label = "amount") => {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") { if (!Number.isSafeInteger(v)) throw new Error(`${label} must be an integer, got ${v}`); return BigInt(v); }
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  throw new Error(`${label} must be an integer amount, got ${JSON.stringify(v)}`);
};
export const toBig = big;

/** A raw integer in `decimals` as an exact decimal string: (5000000, 8) → "0.05". */
export function unitsString(raw, decimals) {
  const n = big(raw);
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().padStart(decimals + 1, "0");
  const whole = decimals === 0 ? s : s.slice(0, s.length - decimals);
  const frac = decimals === 0 ? "" : s.slice(s.length - decimals).replace(/0+$/, "");
  const out = `${whole}${frac ? `.${frac}` : ""}`;
  return neg && out !== "0" ? `-${out}` : out;
}
export const solString = (lamports) => unitsString(lamports, SOL_DECIMALS);

/** A decimal string (or number) in `decimals` as its exact raw integer. More precision than
 *  the unit carries is refused, never rounded. */
export function parseUnits(text, decimals, label = "amount") {
  const t = typeof text === "number" ? (Number.isFinite(text) ? text.toFixed(Math.min(decimals, 12)) : "") : String(text ?? "").trim();
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new Error(`${label} is not a plain decimal number: ${JSON.stringify(text)}`);
  const frac = (m[3] ?? "").replace(/0+$/, "");
  if (frac.length > decimals) throw new Error(`${label} ${t} has more than ${decimals} decimal places`);
  const raw = BigInt(m[2] || "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
  return m[1] ? -raw : raw;
}
export const parseSol = (text, label = "SOL amount") => parseUnits(text, SOL_DECIMALS, label);

/** part / whole × 100 as a string with `digits` decimals (truncated toward zero), or null. */
export function pctString(part, whole, digits = 2) {
  const p = big(part), w = big(whole);
  if (w === 0n) return null;
  const scale = 10n ** BigInt(digits);
  const v = (p * 100n * scale) / w;
  return unitsString(v, digits);
}

/** A price: SOL per token, from lamports and raw token units, to 12 significant decimals of SOL. */
export function priceString(lamports, tokensRaw, decimals) {
  const l = big(lamports), t = big(tokensRaw);
  if (t === 0n) return null;
  /* lamports / 1e9 ÷ (raw / 10^decimals) = lamports × 10^decimals / (raw × 1e9), at 18 places. */
  const PLACES = 18n;
  const v = (l * 10n ** BigInt(decimals) * 10n ** PLACES) / (t * LAMPORTS_PER_SOL);
  return trimSignificant(unitsString(v, Number(PLACES)), 12);
}

/** Keep at most `sig` significant digits after the first non-zero one (truncating). */
export function trimSignificant(text, sig = 12) {
  const neg = text.startsWith("-");
  const t = neg ? text.slice(1) : text;
  const [w, f = ""] = t.split(".");
  if (w !== "0") return text;
  const lead = f.search(/[1-9]/);
  if (lead < 0) return "0";
  const kept = f.slice(0, lead + sig).replace(/0+$/, "");
  return `${neg ? "-" : ""}0${kept ? `.${kept}` : ""}`;
}

/** A float from a decimal string, for display maths only (never for money). */
export const asNumber = (text) => (text === null || text === undefined ? null : Number(text));
export const maxBig = (a, b) => (a > b ? a : b);
export const minBig = (a, b) => (a < b ? a : b);
export const absBig = (a) => (a < 0n ? -a : a);
