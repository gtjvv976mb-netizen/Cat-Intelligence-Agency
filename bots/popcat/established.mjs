/**
 * THE ESTABLISHED CAT COINS, FOR THE COPYCAT FLAG.
 *
 * The list is the cat-themed coins that carry Jupiter's "verified" AND "strict" tags, read
 * from https://lite-api.jup.ag/tokens/v2/search on 2026-09-24, each mint then read on chain
 * the same day (getMultipleAccounts at slot 450,154,234 through the public mainnet endpoint:
 * every one a live mint with its supply, and its mint and freeze authorities revoked). The
 * answers are in fixtures/bots/popcat/established-jupiter.json and established-mints.json.
 * Each run of Popcat reads the mints
 * again and says in its log if one no longer reads as a mint.
 *
 * A new coin is a COPYCAT when its name or its ticker, reduced to letters and digits, is one of
 * these coins' names or tickers (with or without the "$"). That flag fails the callout.
 */
export const ESTABLISHED_CAT_COINS = Object.freeze([
  { name: "Popcat", symbol: "POPCAT", mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", aliases: [] },
  { name: "cat in a dogs world", symbol: "MEW", mint: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5", aliases: [] },
  { name: "michi", symbol: "$michi", mint: "5mbK36SZ7J19An8jFochhQS4of8g6BwUjbeCSxBSoWdp", aliases: ["michi"] },
  { name: "catwifhat", symbol: "$CWIF", mint: "7atgF8KQo4wJrD5ATGX7t1V2zVvykPJbFfNeVf1icFv1", aliases: ["cwif", "catwif"] },
  { name: "Shark Cat", symbol: "SC", mint: "6D7NaB2xsLd7cauWu1wKk6KBsJohJmP2qZH9GEfVi5Ui", aliases: ["sharkcat"] },
  { name: "MANEKI", symbol: "MANEKI", mint: "25hAyBQfoDhfWx9ay6rarbgvWGwDdNqcHsXS3jQ3mTDJ", aliases: [] },
].map((c) => Object.freeze({ ...c, aliases: Object.freeze(c.aliases) })));

export const ESTABLISHED_READ = Object.freeze({ date: "2026-09-24", slot: 450_154_234, source: "Jupiter tokens v2 search (verified + strict tags), then getMultipleAccounts on mainnet" });

const squash = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/^\$/, "").replace(/[^\p{L}\p{N}]+/gu, "");

const KEYS = new Map();
for (const c of ESTABLISHED_CAT_COINS) for (const k of [c.name, c.symbol, ...c.aliases]) {
  const s = squash(k);
  if (s.length >= 2) KEYS.set(s, c);
}

/** The established coin this one copies, or null. Its own mint is never a copy of itself. */
export function copycatOf({ name, symbol, mint = null }) {
  for (const v of [name, symbol]) {
    const hit = KEYS.get(squash(v));
    if (hit && hit.mint !== mint) return hit;
  }
  return null;
}

/** Read the mints again; returns the ones that no longer read as a live mint. */
export async function verifyEstablished(rpc) {
  const accs = await rpc.getMultipleAccounts(ESTABLISHED_CAT_COINS.map((c) => c.mint));
  return ESTABLISHED_CAT_COINS.filter((c, i) => {
    const a = accs[i];
    return !a || (a.owner !== "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" && a.owner !== "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") || a.data.length < 82 || a.data.readBigUInt64LE(36) === 0n;
  });
}
