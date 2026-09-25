/**
 * THE SIMULATION GUARD: simulate the unsigned bytes on the node and refuse anything the plan
 * did not ask for. Moved here out of engine.mjs (where it was the lane's closure
 * `simulateGuard`) so the extension's lane and Agency HQ (services/hq) run one copy of it; the
 * engine calls it with its own RPC exactly as before, and its tests run unchanged.
 *
 * `quote` ({ mint, ata, decimals, symbol }) marks a trade paid in a token: its spend and its
 * proceeds are read off the wallet's account of that token, and SOL may move by the network fee
 * and rent caps and nothing more. Without it the trade is paid in SOL: a buy may spend at most
 * its ceiling plus the fee and rent caps and must deliver at least the base it asked for; a sell
 * must move exactly the base the position holds and return at least its floor less the fee cap.
 */
import { SNIPE_LANE_DEFAULTS } from "../../vendor/executor/snipe-lane.mjs";
import { tokenAmountOf, TxError, rawToUnits } from "./tx.mjs";

const units = (raw, decimals, symbol) => `${rawToUnits(raw, decimals)} ${symbol}`;

export async function simulateTradeGuard({ rpc, txBase64, wallet, ata, mint, side, expected, quote = null }) {
  const addresses = quote ? [wallet, ata, quote.ata] : [wallet, ata];
  const pre = await rpc.getMultipleAccounts(addresses);
  const preLamports = BigInt(pre.accounts[0]?.lamports ?? 0);
  const preBase = tokenAmountOf(pre.accounts[1] ?? null, { mint, owner: wallet }) ?? 0n;
  const sim = await rpc.simulateTransaction(txBase64, { addresses });
  if (sim?.err) throw new TxError("simulation_failed", `simulation failed: ${JSON.stringify(sim.err)}` + (Array.isArray(sim.logs) ? ` — ${sim.logs.slice(-3).join(" | ")}` : ""));
  const post = sim?.accounts;
  if (!Array.isArray(post) || post.length !== addresses.length) throw new TxError("simulation_failed", "simulation omitted the requested accounts");
  const spend = preLamports - BigInt(post[0]?.lamports ?? 0);
  const base = tokenAmountOf(post[1] ? { owner: post[1].owner, data: post[1].data } : null, { mint, owner: wallet }) ?? 0n;
  if (quote) {
    const preQuote = tokenAmountOf(pre.accounts[2] ?? null, { mint: quote.mint, owner: wallet }) ?? 0n;
    const postQuote = tokenAmountOf(post[2] ? { owner: post[2].owner, data: post[2].data } : null, { mint: quote.mint, owner: wallet }) ?? 0n;
    const feeCap = BigInt(SNIPE_LANE_DEFAULTS.maxNetworkFeeLamports), rentCap = BigInt(SNIPE_LANE_DEFAULTS.maxRentLamports);
    const u = (raw) => units(raw, quote.decimals, quote.symbol);
    if (side === "buy") {
      const took = preQuote - postQuote;
      if (took > expected.maxQuoteInRaw) throw new TxError("simulation_failed", `the buy would take ${u(took)} against the ${u(expected.maxQuoteInRaw)} ceiling`);
      if (took <= 0n) throw new TxError("simulation_failed", `the buy would take no ${quote.symbol} from the wallet — it is not paying in the quote it names`);
      if (spend > feeCap + rentCap) throw new TxError("simulation_failed", `the buy would spend ${spend} lamports of SOL; a ${quote.symbol}-quoted buy pays SOL for the network fee and rent only (caps ${feeCap} + ${rentCap}) — an unexplained drain`);
      const delta = base - preBase;
      if (delta < expected.baseOutRaw) throw new TxError("simulation_failed", `the buy would deliver ${delta} base against the ${expected.baseOutRaw} the instruction asked for`);
      return { spend, quoteDeltaRaw: -took, units: Number(sim.unitsConsumed) || null, post };
    }
    const delta = preBase - base;
    if (delta !== expected.qtyRaw) throw new TxError("simulation_failed", `the sell would move ${delta} base, not the ${expected.qtyRaw} the position holds`);
    const got = postQuote - preQuote;
    if (got < expected.minQuoteOutRaw) throw new TxError("simulation_failed", `the sell would return ${u(got)}, under the ${u(expected.minQuoteOutRaw)} floor`);
    const allowance = feeCap + (pre.accounts[2] ? 0n : rentCap);
    if (spend > allowance) throw new TxError("simulation_failed", `the sell would spend ${spend} lamports of SOL against a ${allowance} allowance for the fee${pre.accounts[2] ? "" : " and the re-created " + quote.symbol + " account"}`);
    return { spend, quoteDeltaRaw: got, units: Number(sim.unitsConsumed) || null, post };
  }
  if (side === "buy") {
    const allowance = expected.maxQuoteInRaw + BigInt(SNIPE_LANE_DEFAULTS.maxNetworkFeeLamports) + BigInt(SNIPE_LANE_DEFAULTS.maxRentLamports);
    if (spend > allowance) throw new TxError("simulation_failed", `the buy would spend ${spend} lamports against a ceiling of ${expected.maxQuoteInRaw} plus the fee and rent caps — an unexplained drain`);
    const delta = base - preBase;
    if (delta < expected.baseOutRaw) throw new TxError("simulation_failed", `the buy would deliver ${delta} base against the ${expected.baseOutRaw} the instruction asked for`);
  } else {
    const delta = preBase - base;
    if (delta !== expected.qtyRaw) throw new TxError("simulation_failed", `the sell would move ${delta} base, not the ${expected.qtyRaw} the position holds`);
    const proceeds = -spend;
    if (proceeds < expected.minQuoteOutRaw - BigInt(SNIPE_LANE_DEFAULTS.maxNetworkFeeLamports))
      throw new TxError("simulation_failed", `the sell would return ${proceeds} lamports, under the ${expected.minQuoteOutRaw} floor less the fee cap`);
  }
  return { spend, units: Number(sim.unitsConsumed) || null, post };
}
