/**
 * TEXT IS PLAIN (docs/hq/API.md, "Formats, exactly"): no control, zero-width or
 * bidirectional-override characters, and each kind of text within its limit. Text HQ did not
 * write itself — a coin's symbol and name from its metadata, a model's reason, anything a launch
 * put in its name — is cleaned and cut here before it is stored, and again before it is answered.
 *
 * The characters are the ones the site's validator refuses (site/assets/hq-validate.js HIDDEN):
 * C0 and C1 controls, the soft hyphen, the Arabic letter mark, the Hangul and Khmer fillers, the
 * Mongolian vowel separator, zero-width spaces and joiners, the directional marks, embeddings and
 * overrides, the invisible operators and isolates, variation selectors, the byte-order mark and
 * the specials block's non-characters.
 */
export const HIDDEN_CLASS = "\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\ufff0-\\ufffb";
const HIDDEN = new RegExp(`[${HIDDEN_CLASS}]`, "g");

/** The contract's limits, in UTF-16 code units (what a string's length counts). */
export const TEXT_MAX = Object.freeze({ agentName: 48, symbol: 16, coinName: 64, reason: 500, detail: 500, perk: 120, schedule: 120 });

/**
 * `value` as plain text of at most `max` units: line breaks and tabs become spaces, the hidden
 * characters go, runs of spaces fold, and an over-long text is cut (never inside a character)
 * and ends with "…". Empty after that is null.
 */
export function plainText(value, max) {
  if (value === null || value === undefined) return null;
  let t = String(value).replace(/[\t\n\v\f\r]/g, " ").replace(HIDDEN, "").replace(/\s+/g, " ").trim();
  if (t.length > max) {
    const chars = [...t];
    while (chars.join("").length > max - 1) chars.pop();
    t = `${chars.join("").trimEnd()}…`;
  }
  return t.length ? t : null;
}
