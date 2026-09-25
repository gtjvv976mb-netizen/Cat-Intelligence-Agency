/**
 * RANKS AND PROMOTIONS, EXACTLY AS docs/hq/API.md SAYS.
 *
 * An agent's rank follows its career realized trading profit in SOL — creator fees excluded,
 * because fees are not trading — and it is only ever cosmetic: it unlocks a look (a skin),
 * never more money or more risk. Nothing in the risk layer, the strategies or the executor
 * reads a rank (test-hq-ranks.mjs scans them). A loss never demotes: the rank held is the
 * highest ever reached. Paper and live keep separate ranks, and a paper agent's is marked
 * paper, so a paper record can never promote a live agent.
 */
import { parseSol } from "./amounts.mjs";

export const RANKS = Object.freeze([
  Object.freeze({ id: "recruit", name: "Recruit", minLamports: null }),
  Object.freeze({ id: "field", name: "Field Agent", minLamports: parseSol("0.25") }),
  Object.freeze({ id: "special", name: "Special Agent", minLamports: parseSol("1") }),
  Object.freeze({ id: "senior", name: "Senior Agent", minLamports: parseSol("5") }),
  Object.freeze({ id: "director", name: "Director's Office", minLamports: parseSol("25") }),
]);
export const RANK_IDS = Object.freeze(RANKS.map((r) => r.id));
const order = (id) => RANK_IDS.indexOf(id);

/** The rank a career realized profit (lamports, BigInt) earns on its own. */
export function rankFor(careerRealizedLamports) {
  const v = BigInt(careerRealizedLamports);
  let rank = "recruit";
  for (const r of RANKS) if (r.minLamports !== null && v >= r.minLamports) rank = r.id;
  return rank;
}

/**
 * The rank to hold now, given the one held: never lower. Returns { rank, promotion } where
 * promotion is { from, to } when the rank rose, else null. Skipping ranks is one promotion.
 */
export function promote({ held, careerRealizedLamports }) {
  const earned = rankFor(careerRealizedLamports);
  const current = RANK_IDS.includes(held) ? held : "recruit";
  if (order(earned) > order(current)) return { rank: earned, promotion: { from: current, to: earned } };
  return { rank: current, promotion: null };
}

/** The skins a rank unlocks: "standard" for every agent, then one per rank reached. Cosmetic. */
export const SKINS = Object.freeze(["standard", "field", "special", "senior", "director"]);
export function skinsUnlocked(rank) {
  const i = Math.max(0, order(rank));
  return Object.freeze(["standard", ...RANK_IDS.slice(1, i + 1)]);
}
