/**
 * ONE TRANSACTION, READ FOR ONE WALLET: WHAT IT DID TO THAT WALLET'S MONEY.
 *
 * The ledger is rebuilt from the chain, so this is where every number starts. It reads a
 * transaction as getTransaction returns it (encoding "json", versions legacy, 0 and 1) and
 * nothing else: the balance arrays, the token balance arrays, the fee, the instructions of the
 * transaction itself. What HQ meant to do (its intents) never changes what this says happened;
 * it is joined afterwards only to label a trade's trigger.
 *
 * THE WALLET'S MONEY, three ways (all lamports):
 *   cash C   its native SOL plus its wrapped SOL (the wSOL account's token amount): what it can spend
 *   rent R   the lamports sitting in its own token accounts as rent (every own token account's
 *            lamports, less the wSOL amount): a deposit the chain returns when an account closes
 *   value    C + R
 * A token account is the wallet's own when the token balance arrays name the wallet as owner.
 *
 * WHAT IT CAN BE (first rule that fits):
 *   failed     it failed on chain; if the wallet paid, its fee is a cost ("ops")
 *   fee        the wallet paid, and it calls pump.fun's collect_creator_fee (or PumpSwap's
 *              collect_coin_creator_fee, for a coin that graduated): a creator-fee claim,
 *              lamports = what the claim added to the wallet, net of its own network fee (a claim
 *              of an empty vault is an operation that cost its fee)
 *   buy/sell   the wallet paid, exactly one token other than wSOL moved in its accounts, and cash
 *              moved the other way: a trade. A buy costs −ΔC − ΔR (the network fee and any rent
 *              that is not the wallet's own account's are part of the cost; its own account's rent
 *              is a refundable deposit, not a cost); a sell returns ΔC + ΔR (net of the fee)
 *   withdrawal the wallet paid, no token moved, and more than the fee left: SOL sent away, to the
 *              recipient of its System transfer, with the memo it carried
 *   ops        the wallet paid, no token moved, nothing but the fee (and rent) moved: a wrap, an
 *              unwrap, an account closed; cost = −(ΔC + ΔR). Value that ARRIVES in a transaction
 *              the wallet paid (some other program paying it) is "other", never trading
 *   deposit    someone else paid, no token moved, cash arrived: SOL sent to the wallet
 *   airdrop    someone else paid and a token arrived: never a position (it was not bought); the
 *              rent of an account they opened for it is value that is not a deposit ("other")
 *   token_out  the wallet paid and a token left with nothing back beyond the fee: moved by hand, not
 *              sold (it leaves the books at its cost, as a withdrawal)
 *   other      anything else, with its value change, never counted as trading
 */
import bs58 from "bs58";
import { PUMPFUN_PROGRAM, SYSTEM_PROGRAM, IX } from "../../../bots/lib/verified.mjs";

export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const MEMO_PROGRAMS = Object.freeze(["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"]);
/** HQ writes these memos on the transfers it makes, so the chain itself says what each was. */
export const MEMO_KINDS = Object.freeze(["withdraw", "fee_sweep", "profit_sweep"]);
export const memoFor = (kind, agentNumber) => `cia-hq:${kind}:${String(agentNumber).padStart(3, "0")}`;
export function parseHqMemo(text) {
  const m = /^cia-hq:(withdraw|fee_sweep|profit_sweep):(\d{3})$/.exec(String(text ?? ""));
  return m ? { kind: m[1], agent: Number(m[2]) } : null;
}

const decode58 = (s) => { try { return Buffer.from(bs58.decode(String(s))); } catch { return Buffer.alloc(0); } };

/** The full account list: static keys, then the loaded writable, then the loaded readonly. */
export function accountKeysOf(tx) {
  const m = tx?.transaction?.message ?? {};
  const statics = (m.accountKeys ?? []).map((k) => (typeof k === "string" ? k : k?.pubkey ?? String(k)));
  const loaded = tx?.meta?.loadedAddresses ?? {};
  return [...statics, ...(loaded.writable ?? []), ...(loaded.readonly ?? [])];
}

/** The top-level instructions with their program and accounts resolved. */
export function instructionsOf(tx, keys = accountKeysOf(tx)) {
  return (tx?.transaction?.message?.instructions ?? []).map((ix) => ({
    programId: keys[ix.programIdIndex] ?? null,
    accounts: (ix.accounts ?? []).map((i) => keys[i] ?? null),
    data: decode58(ix.data),
  }));
}

/** The wallet's view of one transaction: its cash, rent and token moves. */
export function walletView(tx, wallet) {
  const meta = tx?.meta;
  if (!meta || !Array.isArray(meta.preBalances) || !Array.isArray(meta.postBalances)) return null;
  const keys = accountKeysOf(tx);
  const idx = keys.indexOf(wallet);
  const nativeDelta = idx >= 0 ? BigInt(meta.postBalances[idx]) - BigInt(meta.preBalances[idx]) : 0n;
  /* The wallet's own token accounts, by account index. */
  const own = new Map();
  const note = (list, when) => {
    for (const b of list ?? []) {
      if (b?.owner !== wallet) continue;
      const i = Number(b.accountIndex);
      const row = own.get(i) ?? { index: i, mint: b.mint, decimals: Number(b.uiTokenAmount?.decimals ?? 0), pre: 0n, post: 0n };
      row[when] = BigInt(b.uiTokenAmount?.amount ?? "0");
      own.set(i, row);
    }
  };
  note(meta.preTokenBalances, "pre");
  note(meta.postTokenBalances, "post");
  let ownLamportsDelta = 0n, wsolDelta = 0n;
  const tokens = new Map();                 // mint → { delta, decimals }
  for (const row of own.values()) {
    const pre = BigInt(meta.preBalances[row.index] ?? 0), post = BigInt(meta.postBalances[row.index] ?? 0);
    ownLamportsDelta += post - pre;
    const d = row.post - row.pre;
    if (row.mint === WSOL_MINT) { wsolDelta += d; continue; }
    const t = tokens.get(row.mint) ?? { delta: 0n, decimals: row.decimals };
    t.delta += d;
    tokens.set(row.mint, t);
  }
  const cashDelta = nativeDelta + wsolDelta;
  const rentDelta = ownLamportsDelta - wsolDelta;
  const moved = [...tokens.entries()].filter(([, t]) => t.delta !== 0n).map(([mint, t]) => ({ mint, delta: t.delta, decimals: t.decimals }));
  return { keys, walletIndex: idx, payer: keys[0] ?? null, paidByWallet: keys[0] === wallet, fee: BigInt(meta.fee ?? 0), nativeDelta, wsolDelta, cashDelta, rentDelta, moved };
}

/** The memo text a transaction carries, from its own instruction data. */
export function memoOf(ixs) {
  for (const ix of ixs) if (MEMO_PROGRAMS.includes(ix.programId)) return ix.data.toString("utf8");
  return null;
}

/** System transfers in the transaction: [{ from, to, lamports }]. */
export function systemTransfersOf(ixs) {
  const out = [];
  for (const ix of ixs) {
    if (ix.programId !== SYSTEM_PROGRAM || ix.data.length < 12) continue;
    if (ix.data.readUInt32LE(0) !== 2) continue;       // SystemInstruction::Transfer
    out.push({ from: ix.accounts[0], to: ix.accounts[1], lamports: ix.data.readBigUInt64LE(4) });
  }
  return out;
}

/** PumpSwap, the pool a pump.fun coin graduates to, and its creator-fee claim: read from a real
 *  claim in fixtures/hq/ledger/ (5Gy6fNK7…, slot 445,111,087; the log names CollectCoinCreatorFee),
 *  its discriminator sha256("global:collect_coin_creator_fee")[0..8]. HQ never SENDS this claim
 *  (the path is not verified here); the ledger only reads one as the fee it is, never as trading. */
export const PUMPSWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const PUMPSWAP_COLLECT_COIN_CREATOR_FEE = "a039592ab58b2b42";
const isClaim = (ix) => (ix.programId === PUMPFUN_PROGRAM && ix.data.subarray(0, 8).toString("hex") === IX.pumpCollectCreatorFee)
  || (ix.programId === PUMPSWAP_PROGRAM && ix.data.subarray(0, 8).toString("hex") === PUMPSWAP_COLLECT_COIN_CREATOR_FEE);

/**
 * Classify `tx` for `wallet`. Returns an event
 *   { kind, signature, slot, blockTime, t, fee, ...kind-specific } or null when the wallet's
 *   money did not change and it paid nothing.
 * Amounts are BigInt lamports / raw token units.
 */
export function classifyTransaction(tx, { wallet }) {
  const v = walletView(tx, wallet);
  if (!v) return null;
  const signature = tx?.transaction?.signatures?.[0] ?? null;
  const base = { signature, slot: Number(tx.slot ?? 0), index: Number.isInteger(tx.transactionIndex) ? tx.transactionIndex : null, blockTime: tx.blockTime ?? null, t: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
    fee: v.paidByWallet ? v.fee : 0n, cashDelta: v.cashDelta, rentDelta: v.rentDelta };
  const ixs = instructionsOf(tx, v.keys);
  const value = v.cashDelta + v.rentDelta;
  if (tx.meta.err) return v.paidByWallet ? { ...base, kind: "ops", cost: -value, failed: true } : null;

  if (v.paidByWallet && ixs.some(isClaim) && v.moved.length === 0) {
    /* A claim of an empty vault paid only its fee: that is an operation, not a fee earned. */
    if (value + v.fee > 0n) return { ...base, kind: "fee", lamports: value, gross: value + v.fee };
    return { ...base, kind: "ops", cost: -value, note: "a creator-fee claim of an empty vault" };
  }
  if (v.moved.length === 1) {
    const { mint, delta, decimals } = v.moved[0];
    if (v.paidByWallet && delta > 0n && v.cashDelta < 0n) return { ...base, kind: "trade", side: "buy", mint, decimals, tokens: delta, sol: -v.cashDelta - v.rentDelta };
    /* A sell brings value back beyond its own fee: cash AND the wallet's own account rent, because
       a Jupiter sell that pays out wrapped SOL may open the wallet's wSOL account out of it. */
    if (v.paidByWallet && delta < 0n && v.cashDelta + v.rentDelta + v.fee > 0n) return { ...base, kind: "trade", side: "sell", mint, decimals, tokens: -delta, sol: v.cashDelta + v.rentDelta };
    if (v.paidByWallet && delta < 0n) return { ...base, kind: "token_out", mint, decimals, tokens: -delta, value };
    if (!v.paidByWallet && delta > 0n) return { ...base, kind: "airdrop", mint, decimals, tokens: delta, value };
    return { ...base, kind: "other", value, note: `a ${mint} move the ledger does not read as a trade` };
  }
  if (v.moved.length > 1) return { ...base, kind: "other", value, note: `${v.moved.length} tokens moved in one transaction` };

  if (v.paidByWallet) {
    const memo = memoOf(ixs);
    if (value < -v.fee) {
      const out = systemTransfersOf(ixs).filter((x) => x.from === wallet && x.to !== wallet);
      return { ...base, kind: "withdrawal", lamports: -value - v.fee, to: out.length === 1 ? out[0].to : null, memo, hq: parseHqMemo(memo) };
    }
    /* Money that ARRIVED in a transaction the wallet paid for, with no token moving, is not a
       trade and not a pump.fun creator fee (both are read above): it is never counted as
       trading. Closing the wallet's own token accounts returns their rent, which is not
       value arriving (it moves from rent to cash), so an HQ unwrap or close is an operation. */
    if (value > 0n) return { ...base, kind: "other", value, memo, note: "value arrived in a transaction the wallet paid for, not as a trade or a pump.fun creator fee" };
    return { ...base, kind: "ops", cost: -value, memo };
  }
  if (v.cashDelta > 0n && v.rentDelta === 0n) {
    const ins = systemTransfersOf(ixs).filter((x) => x.to === wallet);
    return { ...base, kind: "deposit", lamports: v.cashDelta, from: ins.length ? ins[0].from : v.payer, memo: memoOf(ixs) };
  }
  if (value !== 0n) return { ...base, kind: "other", value, note: "value moved by a transaction someone else paid for" };
  return null;
}
