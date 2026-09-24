/**
 * IS THIS COIN A CAT? By its name, its ticker and its description, word by word.
 *
 * A word is a cat when it IS a cat word ("cat", "kitten", "meow", "neko"…), or when a cat
 * word is glued to the front or back of it the way meme names are built ("DoomCat",
 * "$GRENCAT", "catwifhat", "purrfect"). The glue rule is where false friends live, so each
 * is guarded by name: catch, cattle, category, catalog, catalyst, catastrophe, cathedral,
 * catholic, caterpillar, catering, catwalk, catfish, cation… and every word ending in
 * -cate/-cation (education, location, vacation, certificate, delicate, duplicate…), plus the
 * animals and words that end in "cat" and are not cats (polecat, bearcat, muscat, scat…).
 * A cat word in the middle of a word ("concatenate", "scatter") never counts.
 *
 * The name or the ticker is enough. The description alone needs two cat words: "my dog
 * chased a cat" is not a cat coin.
 */

/** Words that are cats by themselves. Also the glue list content-rules.mjs uses. */
export const CAT_WORDS = Object.freeze(["cat", "cats", "catto", "kitty", "kitties", "kitten", "kittens", "kitteh", "kat", "kats", "katz", "katze",
  "meow", "meows", "meowing", "miau", "miaow", "mew", "nyan", "neko", "nekos", "purr", "purrs", "purring", "feline", "felines", "tabby", "calico",
  "moggy", "catnip", "gato", "gatos", "gatito", "gata", "tomcat", "wildcat", "bobcat", "housecat", "alleycat"]);

/** Cat words that may be glued onto another word. Short or name-like ones ("kat", "mew", "gata") may not. */
const GLUE = Object.freeze(["cat", "cats", "kitty", "kitten", "meow", "neko", "nyan", "purr"]);

/** Words that start with a glue word and are not cats. Matched as prefixes. */
const FALSE_PREFIXES = Object.freeze(["catch", "cattl", "categ", "cata", "cath", "cater", "catwalk", "catfish", "cation", "catsup", "catan"]);
/** Words that end with a glue word and are not cats. Matched whole. */
const FALSE_WHOLE = Object.freeze(new Set(["scat", "scats", "muscat", "muscats", "polecat", "polecats", "bearcat", "bearcats", "hepcat", "hepcats", "ducat", "ducats", "concat"]));
/** Endings that mark an English word, not a cat: education, locate, delicate, vacation. */
const FALSE_ENDINGS = /(cate|cated|cates|cating|cation|cations|cative|catory)$/;

/** Tokens of a text: camelCase split, lower case, letters and digits only. */
export function catTokens(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

/** The cat word a token carries, or null. */
export function catWordIn(token) {
  const t = String(token).toLowerCase();
  if (!t) return null;
  if (CAT_WORDS.includes(t)) return t;
  if (FALSE_WHOLE.has(t) || FALSE_ENDINGS.test(t)) return null;
  for (const g of GLUE) {
    if (t.startsWith(g) && t.length > g.length) {
      if (FALSE_PREFIXES.some((p) => t.startsWith(p))) continue;
      return g;
    }
    if (t.endsWith(g) && t.length > g.length) return g;
  }
  return null;
}

/**
 * { isCat, field, word } for a coin. `field` is where the cat was found: name, symbol or
 * description (two or more cat words needed there).
 */
export function detectCat({ name = "", symbol = "", description = "" } = {}) {
  for (const [field, text] of [["name", name], ["symbol", String(symbol).replace(/^\$/, "")]]) {
    for (const tok of catTokens(text)) {
      const w = catWordIn(tok);
      if (w) return { isCat: true, field, word: tok };
    }
    /* An all-caps ticker or a name typed as one word: "SHARKCAT", "GrenCAT". */
    const squashed = String(text).replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
    if (squashed && catWordIn(squashed)) return { isCat: true, field, word: squashed };
  }
  const hits = catTokens(String(description).slice(0, 600)).filter((t) => catWordIn(t));
  if (new Set(hits).size >= 2 || hits.length >= 3) return { isCat: true, field: "description", word: hits[0] };
  return { isCat: false, field: null, word: null };
}
