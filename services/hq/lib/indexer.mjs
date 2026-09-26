/**
 * THE INDEXER: EVERY TRANSACTION OF EVERY AGENT WALLET AND OF THE TREASURY, FROM THE CHAIN.
 *
 * getSignaturesForAddress pages back (1,000 at a time) to the newest signature already read,
 * and every new one is fetched with getTransaction (encoding json, versions up to 1) and kept as
 * the RPC returned it. The ledger is rebuilt from these alone.
 *
 * NOTHING IS SKIPPED. A pass reads at most HQ_MAX_HISTORY_PAGES pages; when there is more (a
 * wallet's long first history, or more new transactions than that since the last pass), the
 * cursor does not jump ahead: the stretch still unread is kept as a resume point, the address is
 * marked incomplete, and the next passes read it, oldest boundary first, until it meets what was
 * read before. /health counts the addresses still being read and the log names them.
 *
 * A rate limit or a failed call is retried with backoff; an address that still fails is left for
 * the next pass without stopping the others. A transaction the RPC lists but will not return
 * yet (getTransaction answers null) is kept as a pending read and asked for again at the start
 * of every pass until it comes; the rest of the wallet's history is read meanwhile.
 */
import { classifyTransaction } from "./classify.mjs";

export const RETRY_DELAYS_MS = Object.freeze([1_000, 3_000, 9_000]);

export function createIndexer({ db, rpc, log = () => {}, maxPages = 20, pageSize = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = 0, retryDelaysMs = RETRY_DELAYS_MS } = {}) {
  const busy = new Set();

  /** One RPC call, retried with backoff on any failure (a 429 above all). */
  async function withRetry(fn) {
    for (let i = 0; ; i++) {
      try { return await fn(); }
      catch (error) { if (i >= retryDelaysMs.length) throw error; await sleep(retryDelaysMs[i]); }
    }
  }
  async function getTransaction(signature) {
    return withRetry(() => rpc.call("getTransaction", [signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]));
  }
  const listPage = (address, opts) => withRetry(async () => {
    const page = await rpc.call("getSignaturesForAddress", [address, opts]);
    if (!Array.isArray(page)) throw new Error("the RPC did not list the address's transactions");
    return page;
  });

  /**
   * Read back from `before` (or the newest) toward `until` (or the start of history), at most
   * maxPages pages. Returns { sigs (newest first), reached: whether it got to `until` or the start }.
   */
  async function readStretch(address, { before = null, until = null }) {
    const sigs = [];
    let cursor = before, pages = 0;
    for (;;) {
      const page = await listPage(address, { limit: pageSize, commitment: "confirmed", ...(cursor ? { before: cursor } : {}), ...(until ? { until } : {}) });
      pages++;
      sigs.push(...page);
      if (page.length < pageSize) return { sigs, reached: true };
      if (pages >= maxPages) return { sigs, reached: false };
      cursor = page[page.length - 1].signature;
    }
  }
  async function store(address, sigs) {
    let added = 0;
    for (const s of [...sigs].reverse()) {
      if (db.hasChainTx(address, s.signature)) continue;
      const tx = await getTransaction(s.signature);
      if (!tx) {
        /* listed, but not returned yet: kept to read again, and the pass moves on */
        db.addPendingRead({ address, signature: s.signature, slot: s.slot ?? null, blockTime: s.blockTime ?? null });
        log(`indexer: ${s.signature} of ${address} could not be read yet; it is asked for again on the next passes`);
        continue;
      }
      db.putChainTx({ address, signature: s.signature, slot: tx.slot ?? s.slot, blockTime: tx.blockTime ?? s.blockTime ?? null, err: Boolean(tx.meta?.err), tx });
      db.dropPendingRead(address, s.signature);
      added++;
      if (gapMs) await sleep(gapMs);
    }
    return added;
  }
  /** The pending reads of an address, asked for once each (a failed call leaves them for the next pass). */
  async function readPending(address) {
    let added = 0;
    for (const p of db.listPendingReads(address)) {
      if (db.hasChainTx(address, p.signature)) { db.dropPendingRead(address, p.signature); continue; }
      let tx = null;
      try { tx = await rpc.call("getTransaction", [p.signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]); } catch { tx = null; }
      if (!tx) { db.triedPendingRead(address, p.signature); continue; }
      db.putChainTx({ address, signature: p.signature, slot: tx.slot ?? p.slot ?? 0, blockTime: tx.blockTime ?? p.block_time ?? null, err: Boolean(tx.meta?.err), tx });
      db.dropPendingRead(address, p.signature);
      added++;
    }
    return added;
  }

  /**
   * Read what is new for `address`. Returns { added, complete }. With a resume point pending, the
   * pass reads that stretch first; the newest boundary moves only when everything below it is read.
   */
  async function indexAddress(address) {
    if (busy.has(address)) return { added: 0, complete: null, skipped: true };
    busy.add(address);
    try {
      const late = await readPending(address);
      const cursor = db.getCursor(address);
      const resume = cursor?.resume ?? null;
      if (resume) {
        /* the stretch still unread: from `before` back to `until` (null: the start of history) */
        const r = await readStretch(address, { before: resume.before, until: resume.until });
        const added = late + await store(address, r.sigs);
        if (r.reached) {
          db.setCursor(address, { newest: resume.newest, complete: true, note: null, resume: null });
          log(`indexer: ${address} is read in full`);
          return { added, complete: true };
        }
        const next = { ...resume, before: r.sigs[r.sigs.length - 1].signature };
        db.setCursor(address, { newest: cursor.newest_signature, complete: false, note: "reading older transactions", resume: next });
        return { added, complete: false };
      }
      const until = cursor?.newest_signature ?? null;
      const r = await readStretch(address, { until });
      const added = late + await store(address, r.sigs);
      const top = r.sigs[0]?.signature ?? until;
      if (r.reached) {
        db.setCursor(address, { newest: top, complete: true, note: null, resume: null });
        return { added, complete: true };
      }
      /* More than one pass can read: keep the old boundary until the gap below is read too. */
      const next = { before: r.sigs[r.sigs.length - 1].signature, until, newest: top };
      db.setCursor(address, { newest: until, complete: false, note: "reading older transactions", resume: next });
      log(`indexer: ${address} has more history than one pass reads; the rest follows on the next passes`);
      return { added, complete: false };
    } finally { busy.delete(address); }
  }

  /** How many addresses still have history to read (an unread stretch, or a transaction to read again). */
  const incomplete = () => new Set([...db.listCursors().filter((c) => c.resume || !c.complete).map((c) => c.address), ...db.listPendingReads().map((p) => p.address)]).size;

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

  return Object.freeze({ indexAddress, ingest, eventsFor, getTransaction, incomplete });
}
