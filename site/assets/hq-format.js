/* AGENCY HQ: HOW A NUMBER IS WRITTEN.
   Pure functions, no page and no network, so the tests run them in Node exactly as the pages
   do. HQ sends every amount as a string of decimal SOL or token units (docs/hq/API.md, never a
   float), and this file keeps it that way: sums, comparisons and rounding are done on the
   digits, with BigInt, so nothing HQ computed is changed by floating point on the way to the
   page. A number is only ever rounded for display, and a sign is always a character (+ or the
   minus sign −), never a colour alone.

   The ranks and the strategies are the contract's tables, word for word; test-site.mjs reads
   them out of docs/hq/API.md and compares. */

export const BASE58 = "[1-9A-HJ-NP-Za-km-z]";
export const ADDRESS = new RegExp(`^${BASE58}{32,44}$`);
export const SIGNATURE = new RegExp(`^${BASE58}{64,90}$`);
/* A decimal string: an optional minus, no leading zeros, no exponent, no separators. */
export const DECIMAL = /^-?(0|[1-9]\d{0,29})(\.\d{1,18})?$/;
export const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?Z$/;
export const MINUS = "−";

/* ── the contract's tables ─────────────────────────────────────────────── */
/* Ranks follow career realized trading profit (SOL, fees excluded), and are cosmetic only. */
export const RANKS = Object.freeze([
  Object.freeze({ id: "recruit", name: "Recruit", min: "0" }),
  Object.freeze({ id: "field", name: "Field Agent", min: "0.25" }),
  Object.freeze({ id: "special", name: "Special Agent", min: "1" }),
  Object.freeze({ id: "senior", name: "Senior Agent", min: "5" }),
  Object.freeze({ id: "director", name: "Director's Office", min: "25" }),
]);
export const RANK_IDS = Object.freeze(RANKS.map((r) => r.id));

export const STRATEGIES = Object.freeze({
  snipurr: Object.freeze({ cat: "Snipurr", sprite: "snipurr", does: "pump.fun sniping by rule: wait, watch, buy only what others followed, strict exits" }),
  coinmarketcat: Object.freeze({ cat: "CoinMarketCat", sprite: "coinmarketcat", does: "the owner's plain-English strategy, decided by a model, limits enforced by code" }),
  "popcat-scout": Object.freeze({ cat: "Popcat", sprite: "popcat", does: "buys only new cat coins that pass all of Popcat's checks" }),
  "crying-cat-safe": Object.freeze({ cat: "Crying Cat", sprite: "crying-cat", does: "conservative: established tokens only, every buy rug-checked first" }),
});

/* The seven brand cats an agent's "cat" (its sprite id) may be, at the sprite's own size. */
export const CATS = Object.freeze({
  director: Object.freeze({ name: "The Director", size: [150, 211], accent: "#9945ff" }),
  coinmarketcat: Object.freeze({ name: "CoinMarketCat", size: [175, 209], accent: "#8b5cf6" }),
  snipurr: Object.freeze({ name: "Snipurr", size: [146, 207], accent: "#14f195" }),
  "crying-cat": Object.freeze({ name: "Crying Cat", size: [144, 206], accent: "#5ab8ff" }),
  "grumpy-cat": Object.freeze({ name: "Grumpy Cat", size: [144, 202], accent: "#e8742c" }),
  cashcat: Object.freeze({ name: "CashCat", size: [143, 208], accent: "#f5c542" }),
  popcat: Object.freeze({ name: "Popcat", size: [197, 211], accent: "#ff4fd8" }),
});

/* The agent skins (brand/hq/skins/, the same grey tabby in an outfit, on the 4 px grid). Each
   rank has its own; an agent whose skin HQ does not name here wears its rank's. nightops and
   holder are perk skins, cosmetic only. */
export const SKINS = Object.freeze({
  recruit: Object.freeze({ name: "Recruit", size: [148, 212], look: "a grey hoodie with a lanyard" }),
  field: Object.freeze({ name: "Field Agent", size: [166, 211], look: "a trench coat, a fedora and a magnifier" }),
  special: Object.freeze({ name: "Special Agent", size: [150, 211], look: "a black suit, sunglasses and an earpiece" }),
  senior: Object.freeze({ name: "Senior Agent", size: [169, 212], look: "a navy suit, a gold tie and a holo pass" }),
  director: Object.freeze({ name: "Director's Office", size: [162, 215], look: "a suit, a violet cape and a crown" }),
  nightops: Object.freeze({ name: "Night Ops", size: [149, 210], look: "night-ops gear with green goggles", perk: true }),
  holder: Object.freeze({ name: "Holder", size: [178, 211], look: "a gold bomber jacket with a $CIA coin", perk: true }),
});
/* The rank art (brand/hq/ranks/), each on the 4 px grid; higher ranks are drawn larger. */
export const RANK_ART = Object.freeze({
  recruit: Object.freeze({ size: [100, 141], look: "bronze, one star" }),
  field: Object.freeze({ size: [174, 199], look: "silver, two stars and a mint ribbon" }),
  special: Object.freeze({ size: [184, 236], look: "gold, a cat in sunglasses and three stars" }),
  senior: Object.freeze({ size: [182, 228], look: "platinum and blue, four stars" }),
  director: Object.freeze({ size: [228, 239], look: "violet and gold, a crowned cat and five stars" }),
});
/* The brand cat an agent is drawn as: its own, or, for a sprite the site has no art for, its
   strategy's cat. */
export const catOf = (agent) => (agent && Object.prototype.hasOwnProperty.call(CATS, agent.cat) ? agent.cat : STRATEGIES[agent && agent.strategy] ? STRATEGIES[agent.strategy].sprite : "director");
/* A coin's name on the page: its ticker, or, registered by its mint alone, the mint shortened. */
export const coinLabel = (coin) => (coin.symbol ? `$${String(coin.symbol).replace(/^\$+/, "")}` : `${coin.mint.slice(0, 4)}…${coin.mint.slice(-4)}`);
export const skinOf = (agent) => (agent && Object.prototype.hasOwnProperty.call(SKINS, agent.skin) ? agent.skin : agent && RANK_IDS.includes(agent.rank) ? agent.rank : "recruit");

/* ── decimals, on the digits ──────────────────────────────────────────── */
export const isDecimal = (s) => typeof s === "string" && DECIMAL.test(s);
function parts(s) {
  if (!isDecimal(s)) throw new TypeError(`not a decimal string: ${String(s).slice(0, 40)}`);
  const neg = s.startsWith("-");
  const [int, frac = ""] = (neg ? s.slice(1) : s).split(".");
  return { neg, int, frac };
}
/* s scaled by 10^scale, as a BigInt (the decimals beyond scale are cut, never rounded). */
function scaled(s, scale) {
  const { neg, int, frac } = parts(s);
  const v = BigInt(int + (frac + "0".repeat(scale)).slice(0, scale));
  return neg ? -v : v;
}
function unscale(v, scale) {
  const neg = v < 0n;
  let digits = (neg ? -v : v).toString().padStart(scale + 1, "0");
  let int = scale ? digits.slice(0, -scale) : digits, frac = scale ? digits.slice(-scale) : "";
  frac = frac.replace(/0+$/, "");
  const out = frac ? `${int}.${frac}` : int;
  return neg && out !== "0" ? `-${out}` : out;
}
const scaleOf = (...xs) => Math.max(0, ...xs.map((s) => parts(s).frac.length));
export function decAdd(a, b) { const k = scaleOf(a, b); return unscale(scaled(a, k) + scaled(b, k), k); }
export function decSub(a, b) { const k = scaleOf(a, b); return unscale(scaled(a, k) - scaled(b, k), k); }
export function decCmp(a, b) { const k = scaleOf(a, b); const x = scaled(a, k), y = scaled(b, k); return x < y ? -1 : x > y ? 1 : 0; }
export const decSign = (s) => decCmp(s, "0");
export const decAbs = (s) => (decSign(s) < 0 ? s.slice(1) : s);
export const decSum = (list) => list.reduce((acc, s) => decAdd(acc, s), "0");
export const decMax = (list) => list.reduce((m, s) => (m === null || decCmp(s, m) > 0 ? s : m), null);
/* a / b as a number, for a bar's length or a ratio shown to one decimal: never for an amount. */
export function decRatio(a, b) {
  const k = Math.max(scaleOf(a, b), 9);
  const y = scaled(b, k);
  if (y === 0n) return null;
  return Number((scaled(a, k) * 1_000_000n) / y) / 1_000_000;
}

/* Rounds half away from zero to exactly `places` decimals, on the digits. */
export function roundDec(s, places) {
  const { neg, int, frac } = parts(s);
  let v = BigInt(int + (frac + "0".repeat(places + 1)).slice(0, places + 1));
  v = (v + 5n) / 10n;
  const digits = v.toString().padStart(places + 1, "0");
  const i = places ? digits.slice(0, -places) : digits, f = places ? digits.slice(-places) : "";
  const zero = /^0*$/.test(i + f);
  return (neg && !zero ? "-" : "") + (f ? `${i}.${f}` : i);
}
const group = (int) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
function write(rounded, signed) {
  const neg = rounded.startsWith("-");
  const body = neg ? rounded.slice(1) : rounded;
  const [i, f] = body.split(".");
  const text = group(i) + (f ? `.${f}` : "");
  const zero = /^[0.]+$/.test(body);
  if (zero) return text.replace(/^0\.0+$/, "0");
  return (neg ? MINUS : signed ? "+" : "") + text;
}
/* Leading zeros after the point, for a small value: 0.00012 → 3. */
function leadingZeros(s) { const { int, frac } = parts(s); return int !== "0" ? 0 : (frac.match(/^0*/)[0].length); }

/* SOL: 2 decimals from 100, 3 from 1, 4 below; a tiny non-zero amount keeps 3 significant
   digits (never shown as 0), down to the lamport. */
export function fmtSol(s, { signed = false } = {}) {
  const a = decAbs(s);
  if (decSign(a) !== 0 && decCmp(a, "0.0001") < 0) {
    const r = roundDec(s, Math.min(9, leadingZeros(a) + 3));
    return write(r.replace(/0+$/, "").replace(/\.$/, ""), signed);
  }
  return write(roundDec(s, decCmp(a, "100") >= 0 ? 2 : decCmp(a, "1") >= 0 ? 3 : 4), signed);
}
/* A percent HQ computed (the string is already in percent): one decimal, two under 1%, none
   from 1,000%. */
export function fmtPct(s, { signed = true } = {}) {
  const a = decAbs(s);
  const places = decCmp(a, "1000") >= 0 ? 0 : decCmp(a, "1") >= 0 ? 1 : 2;
  return write(roundDec(s, places), signed) + "%";
}
/* Token units: compact above a thousand (12.3K, 4.56M, 1.23B), plain below. */
const UNITS = [["K", 3], ["M", 6], ["B", 9]];
function shift(s, k) {   // s / 10^k, on the digits
  const { neg, int, frac } = parts(s);
  const padded = int.padStart(k + 1, "0");
  const i = padded.slice(0, padded.length - k).replace(/^0+(?=\d)/, ""), f = (padded.slice(padded.length - k) + frac).replace(/0+$/, "");
  return `${neg ? "-" : ""}${i}${f ? "." + f : ""}`;
}
export function fmtTokens(s) {
  const a = decAbs(s);
  for (let u = UNITS.length - 1; u >= 0; u--) {
    const [unit, k] = UNITS[u];
    if (decCmp(a, "1" + "0".repeat(k)) < 0) continue;
    const v = shift(s, k), whole = parts(decAbs(v)).int.length;
    const r = roundDec(v, whole >= 3 ? 0 : whole === 2 ? 1 : 2);
    if (decCmp(decAbs(r), "1000") >= 0 && u < UNITS.length - 1) return write(roundDec(shift(s, UNITS[u + 1][1]), 2), false) + UNITS[u + 1][0];
    return write(r, false) + unit;
  }
  const r = roundDec(s, decCmp(a, "1") >= 0 ? 2 : Math.min(9, leadingZeros(a) + 3));
  return write(r.includes(".") ? r.replace(/0+$/, "").replace(/\.$/, "") : r, false);
}
const SUB = "₀₁₂₃₄₅₆₇₈₉";
/* A price in SOL per token. Tiny prices keep their zeros countable: 0.00000031 → 0.0₆31. */
export function fmtPrice(s) {
  const a = decAbs(s);
  if (decSign(a) === 0) return "0";
  const trim = (r) => (r.includes(".") ? r.replace(/0+$/, "").replace(/\.$/, "") : r);
  if (decCmp(a, "1") >= 0) return write(trim(roundDec(s, 4)), false);
  const z = leadingZeros(a);
  if (z < 4) return write(trim(roundDec(s, z + 4)), false);
  const { neg, frac } = parts(roundDec(s, Math.min(18, z + 4)));
  const sig = frac.slice(z).replace(/0+$/, "") || "0";
  return `${neg ? MINUS : ""}0.0${String(z).split("").map((d) => SUB[d]).join("")}${sig}`;
}
export const fmtCount = (n) => (Number.isSafeInteger(n) ? group(String(Math.abs(n))) : "—");

/* Up, down or flat: the sign of an amount, for its colour (the sign character goes with it). */
export function signClass(s) {
  if (s === null || s === undefined) return "flat";
  const k = decSign(s);
  return k > 0 ? "up" : k < 0 ? "down" : "flat";
}

/* ── time ─────────────────────────────────────────────────────────────── */
export function isIsoTime(s) {
  const m = typeof s === "string" && s.match(ISO_TIME);
  if (!m) return false;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && h < 24 && mi < 60 && se < 60 && y >= 2020 && y <= 2100;
}
export const fmtUtc = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
export const fmtDate = (iso) => iso.slice(0, 10);
export function fmtAgo(iso, now = Date.now()) {
  const s = Math.floor((now - Date.parse(iso)) / 1000);
  if (s < -60) return fmtUtc(iso);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso);
}

/* ── ranks ────────────────────────────────────────────────────────────── */
export const rankOf = (id) => RANKS.find((r) => r.id === id) || null;
export function rankForCareer(career) {
  let at = RANKS[0];
  for (const r of RANKS) if (decCmp(career, r.min) >= 0) at = r;
  return at.id;
}
/* How far an agent is from its next rank: the SOL of realized profit still to make, and how
   much of the step from this rank's floor to the next it has made (0 to 100). A loss never
   demotes, so the rank HQ reports is kept even when the career figure is under its floor. */
export function rankProgress(rank, careerRealizedSol) {
  const i = RANK_IDS.indexOf(rank);
  if (i < 0) return null;
  const here = RANKS[i], next = RANKS[i + 1] || null;
  if (!next) return { rank: here, next: null, remaining: "0", pct: 100 };
  const remaining = decCmp(careerRealizedSol, next.min) >= 0 ? "0" : decSub(next.min, careerRealizedSol);
  const made = decSub(careerRealizedSol, here.min);
  const step = decSub(next.min, here.min);
  const r = decRatio(decSign(made) < 0 ? "0" : made, step) ?? 0;
  return { rank: here, next, remaining, pct: Math.max(0, Math.min(100, r * 100)) };
}

/* Wins over closed round trips, as a percent string with one decimal; null with none closed. */
export function winRate(wins, losses) {
  const closed = wins + losses;
  if (!Number.isSafeInteger(closed) || closed <= 0) return null;
  const tenths = Math.round((wins * 1000) / closed);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

/* ── links: built only from a validated address or signature ────────── */
export const solscanTx = (sig) => (typeof sig === "string" && SIGNATURE.test(sig) ? `https://solscan.io/tx/${sig}` : "");
export const solscanAccount = (a) => (typeof a === "string" && ADDRESS.test(a) ? `https://solscan.io/account/${a}` : "");
export const solscanToken = (m) => (typeof m === "string" && ADDRESS.test(m) ? `https://solscan.io/token/${m}` : "");
export const pumpFun = (m) => (typeof m === "string" && ADDRESS.test(m) ? `https://pump.fun/coin/${m}` : "");
export const gmgn = (m) => (typeof m === "string" && ADDRESS.test(m) ? `https://gmgn.ai/sol/token/${m}` : "");
export const LINK_HOSTS = Object.freeze(["solscan.io", "pump.fun", "gmgn.ai"]);
export const shortAddr = (a) => (typeof a === "string" && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : String(a ?? ""));
/* An agent's dossier, relative to the site's root: only for a positive whole id. */
export const agentPath = (id) => (Number.isSafeInteger(id) && id > 0 ? `hq/agent/?id=${id}` : "");
export const ticker = (symbol) => `$${String(symbol).replace(/^\$+/, "")}`;

/* A signature's bytes as base58 text (the perks check sends Phantom's 64-byte signature so). */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) { carry += digits[j] * 256; digits[j] = carry % 58; carry = Math.floor(carry / 58); }
    while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => B58[d]).join("");
}

/* ── the agency's record, by mode, from each agent's own HQ figures ──── */
/* Paper and live are never added together: every total here is one mode's. Sums are exact;
   the deepest drawdown is the worst single agent's (drawdowns do not add up). */
export function modeTotals(agents) {
  const out = {};
  for (const mode of ["live", "paper"]) {
    const mine = agents.filter((a) => a.mode === mode);
    const s = (k) => decSum(mine.map((a) => a.stats[k]));
    const wins = mine.reduce((n, a) => n + a.stats.wins, 0), losses = mine.reduce((n, a) => n + a.stats.losses, 0);
    out[mode] = {
      agents: mine.length, active: mine.filter((a) => a.status === "active").length,
      balanceSol: s("balanceSol"), portfolioSol: s("portfolioSol"),
      realizedPnlSol: s("realizedPnlSol"), unrealizedPnlSol: s("unrealizedPnlSol"),
      tradingPnlSol: decAdd(s("realizedPnlSol"), s("unrealizedPnlSol")),
      feesClaimedSol: s("feesClaimedSol"), depositedSol: s("depositedSol"), withdrawnSol: s("withdrawnSol"),
      trades: mine.reduce((n, a) => n + a.stats.trades, 0), wins, losses, winRatePct: winRate(wins, losses),
      worstDrawdownPct: decMax(mine.map((a) => a.stats.maxDrawdownPct)),
    };
  }
  return out;
}
