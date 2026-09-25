/**
 * THE FOUR STRATEGIES, AS THE CONTRACT NAMES THEM. Each is its own module; all of them trade only
 * through the runtime's gate (risk layer, agency coins, Crying Cat) and never sign anything.
 */
import * as snipurr from "./snipurr.mjs";
import * as coinmarketcat from "./coinmarketcat.mjs";
import * as popcatScout from "./popcat-scout.mjs";
import * as cryingCatSafe from "./crying-cat-safe.mjs";

export const STRATEGIES = Object.freeze({
  snipurr: Object.freeze({ module: snipurr, cat: "Snipurr", sprite: "snipurr" }),
  coinmarketcat: Object.freeze({ module: coinmarketcat, cat: "CoinMarketCat", sprite: "coinmarketcat" }),
  "popcat-scout": Object.freeze({ module: popcatScout, cat: "Popcat", sprite: "popcat" }),
  "crying-cat-safe": Object.freeze({ module: cryingCatSafe, cat: "Crying Cat", sprite: "crying-cat" }),
});
export const STRATEGY_IDS = Object.freeze(Object.keys(STRATEGIES));

export function strategyOf(id) {
  const s = STRATEGIES[id];
  if (!s) throw new Error(`unknown strategy "${id}": the strategies are ${STRATEGY_IDS.join(", ")}`);
  return s.module;
}

/** A strategy's settings, validated by its own module (snipurr's by the extension lane's normalizeConfig). */
export function normalizeSettingsFor(id, settings, limits) {
  const m = strategyOf(id);
  return id === "snipurr" ? m.normalizeSettings(settings, limits) : m.normalizeSettings(settings);
}
