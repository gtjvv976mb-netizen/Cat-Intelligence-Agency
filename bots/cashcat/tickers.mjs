/**
 * IS THE TICKER TAKEN? CashCat never launches a coin whose ticker (or name) is that of a
 * verified token. The list is Jupiter's verified tokens, read at launch time from
 * https://lite-api.jup.ag/tokens/v2/tag?query=verified (3,692 tokens on 2026-09-24). If the
 * list cannot be read, a live launch is refused: an unverifiable ticker is not a free one.
 * It also refuses the name or ticker of an established cat coin (Popcat's copycat list), so
 * CashCat never makes the kind of copy Popcat exists to flag.
 */
import { URLS } from "../lib/verified.mjs";
import { copycatOf } from "../popcat/established.mjs";

const norm = (s) => String(s ?? "").replace(/^\$/, "").trim().toUpperCase();
const normName = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function verifiedIndex(list) {
  if (!Array.isArray(list) || list.length < 100) throw new Error("Jupiter's verified list is missing or implausibly short");
  const symbols = new Map(), names = new Map();
  for (const t of list) {
    if (!t || typeof t.symbol !== "string" || typeof t.id !== "string") continue;
    const s = norm(t.symbol);
    if (s && !symbols.has(s)) symbols.set(s, { symbol: t.symbol, name: t.name, mint: t.id });
    const n = normName(t.name);
    if (n.length >= 3 && !names.has(n)) names.set(n, { symbol: t.symbol, name: t.name, mint: t.id });
  }
  return { symbols, names, size: list.length };
}

export async function loadVerifiedIndex(http) {
  return verifiedIndex(await http.json(URLS.jupiterVerified, { timeoutMs: 45_000, maxBytes: 32 * 1024 * 1024 }));
}

/** { ok, reasons[] } for a proposed coin against the index (null index = unverifiable). */
export function tickerFree(index, { name, symbol }) {
  const reasons = [];
  if (!index) return { ok: false, reasons: ["Jupiter's verified list could not be read, so the ticker cannot be checked"] };
  const s = index.symbols.get(norm(symbol));
  if (s) reasons.push(`$${norm(symbol)} is the ticker of the verified token ${s.name} (${s.mint})`);
  const n = index.names.get(normName(name));
  if (n) reasons.push(`"${name}" is the name of the verified token $${n.symbol} (${n.mint})`);
  const copy = copycatOf({ name, symbol });
  if (copy) reasons.push(`it would copy the established cat coin ${copy.name} ($${copy.symbol})`);
  return { ok: reasons.length === 0, reasons };
}
