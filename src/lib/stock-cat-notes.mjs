/**
 * STOCK CAT NOTES: WHAT A STOCK CAT MAY NOT NAME, FOR EACH xSTOCK, AND WHERE THAT WAS FOUND.
 *
 * A stock cat is a cat coin paired on StonkFun with one tokenised stock (src/lib/stockcats.mjs).
 * The fixed lists in bots/lib/content-rules.mjs know some companies by name, but no rule knows who
 * runs each one, what its mascots are called, or which of its brands a coin could lean on: "Ronald
 * Cat" beside MCDx, or a coin named for a chief executive beside his company's stock, would pass
 * every list. So a pair is launchable only once this file carries its row, and a pair with no row
 * is refused at `pair_terms_missing`. THE LIST SHIPS EMPTY: every pair is refused until the research
 * (people, mascots and brands, each sourced, or a dated "none found") is written here and reviewed.
 *
 * ONE ROW PER xSTOCK, keyed by its Solana mint (one of src/lib/config.mjs STONKFUN_XSTOCKS):
 *
 *   {
 *     mint:       "<the xStock's mint address>",
 *     people:     [ "<a name>" | { name, source } ],   // its executives, founders, famous faces
 *     mascots:    [ "<a name>" | { name, source } ],   // its mascots and characters
 *     brands:     [ "<a name>" | { name, source } ],   // its products and brands a coin could lean on
 *     catFacts:   [ { text, source, readAt } ],         // cats and this company, for the owner's eyes only
 *     searchedAt: "YYYY-MM-DD",                          // when the search was made
 *     method:     "<how it was searched, and where>",
 *   }
 *
 *   · An EMPTY list is a dated "none found": it counts only because `searchedAt` dates it. A row
 *     without a valid `searchedAt`, or without `method`, is not a row, and its pair stays refused.
 *   · Every name in people, mascots and brands becomes a term no stock cat may carry, for its own
 *     pair (`pair_term`) and for every other pair (`other_pair`), matched by the content rules'
 *     own matching (checkTerms): glued compounds, look-alike letters, spelt-out letters, capitals
 *     inside a word.
 *   · `catFacts` are shown to the owner in CoinMarketCat's tab, each labelled "Sourced fact, not an
 *     endorsement" with its source and date. They are NEVER written into a coin: not its name, not
 *     its tagline, not its metadata, and the model's review never sees them.
 *   · A `source` is text: a URL and the date it was read. Nothing in the extension fetches it.
 *
 * test-cats-stockcats.mjs holds every row to this shape and every mint to the list of pairs.
 */
export const STOCK_CAT_NOTES = Object.freeze([]);
