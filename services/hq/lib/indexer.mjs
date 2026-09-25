/**
 * THE INDEXER: EVERY TRANSACTION OF EVERY AGENT WALLET AND OF THE TREASURY, FROM THE CHAIN.
 *
 * getSignaturesForAddress pages back (1,000 at a time) to the newest signature already read,
 * and every new one is fetched with getTransaction (encoding json, versions up to 1) and kept as
 * the RPC returned it. The ledger is rebuilt from these alone. An agent wallet is new when HQ
 * derives it, so its whole history is read; an address with more history than
 * HQ_MAX_HISTORY_PAGES pages (the treasury, if the owner's old wallet is used) is read that far
 * and marked incomplete, and the treasury's figures say so.
 */
import { classifyTransaction } from "./classify.mjs";

export function createIndexer({ db, rpc, log = () => {}, maxPages = 20, pageSize = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = 0 } = {}) {
  const busy = new Set();

  async function getTransaction(signature) {
    return rpc.call("getTransaction", [signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]);
  }

  /** Read what is new for `address`. Returns { added, complete }. */
  async function indexAddress(address) {
    if (busy.has(address)) return { added: 0, complete: null, skipped: true };
    busy.add(address);
    try {
      const cursor = db.getCursor(address);
      const until = cursor?.newest_signature ?? null;
      const fresh = [];
      let before = null, pages = 0, reachedEnd = false;
      for (;;) {
        const opts = { limit: pageSize, commitment: "confirmed", ...(before ? { before } : {}), ...(until ? { until } : {}) };
        const page = await rpc.call("getSignaturesForAddress", [address, opts]);
        if (!Array.isArray(page)) throw new Error("the RPC did not list the address's transactions");
        pages++;
        fresh.push(...page);
        if (page.length < pageSize) { reachedEnd = true; break; }
        if (pages >= maxPages) break;
        before = page[page.length - 1].signature;
      }
      let added = 0;
      /* Oldest first, so a partial run leaves a clean prefix; the cursor moves only when all are in. */
      for (const s of [...fresh].reverse()) {
        if (db.hasChainTx(address, s.signature)) continue;
        const tx = await getTransaction(s.signature);
        if (!tx) throw new Error(`the transaction ${s.signature} could not be read yet`);
        db.putChainTx({ address, signature: s.signature, slot: tx.slot ?? s.slot, blockTime: tx.blockTime ?? s.blockTime ?? null, err: Boolean(tx.meta?.err), tx });
        added++;
        if (gapMs) await sleep(gapMs);
      }
      const complete = until ? Boolean(cursor.complete) : reachedEnd;
      db.setCursor(address, { newest: fresh[0]?.signature ?? until, complete, note: complete ? null : `only the newest ${pages * pageSize} transactions were read` });
      return { added, complete };
    } finally { busy.delete(address); }
  }

  /** A transaction HQ itself just confirmed, stored at once (the next poll would find it too). */
  function ingest({ wallet, signature, tx }) {
    if (!tx || db.hasChainTx(wallet, signature)) return false;
    db.putChainTx({ address: wallet, signature, slot: tx.slot ?? 0, blockTime: tx.blockTime ?? null, err: Boolean(tx.meta?.err), tx });
    return true;
  }

  /**
   * The wallet's events, classified, with each trade labelled by what HQ meant (its intent's
   * trigger and decision), or "manual" when HQ never meant it: a trade made by hand.
   */
  function eventsFor(address) {
    const out = [];
    for (const row of db.listChainTxs(address)) {
      if (!row.tx) continue;
      const e = classifyTransaction(row.tx, { wallet: address });
      if (!e) continue;
      if (e.kind === "trade") {
        const intent = db.intentBySignature(e.signature);
        e.trigger = intent?.trigger ?? "manual";
        e.decisionId = intent?.decision_id ?? null;
        e.id = e.signature;
      }
      out.push(e);
    }
    return out;
  }

  return Object.freeze({ indexAddress, ingest, eventsFor, getTransaction });
}
