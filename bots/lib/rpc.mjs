/**
 * A SMALL SOLANA JSON-RPC CLIENT OVER THE BOTS' HTTP CLIENT.
 *
 * The RPC URL is the owner's (SOLANA_RPC_URL, a secret because providers put their key in
 * it). Its host is added to the allow-list for the run and nowhere else. With no URL, the
 * public mainnet endpoint is used for READS only: CashCat refuses to send a transaction
 * through it, because a launch should not depend on an endpoint that rate-limits by the
 * method (it answered 429 to getTokenLargestAccounts all day while this was built).
 */
import { HttpError } from "./http.mjs";

export const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";

export class RpcError extends Error {
  constructor(clause, message, detail = {}) { super(message); this.name = "RpcError"; this.clause = clause; this.detail = detail; }
}

export function createRpc({ http, url = PUBLIC_RPC, commitment = "confirmed" } = {}) {
  if (!http) throw new Error("createRpc needs the http client");
  let u;
  try { u = new URL(url); } catch { throw new RpcError("bad_url", "SOLANA_RPC_URL is not a URL"); }
  if (u.protocol !== "https:") throw new RpcError("bad_url", "SOLANA_RPC_URL must be https");
  http.allow(u.host);
  let id = 0;

  async function call(method, params = []) {
    let body;
    try {
      const r = await http.request(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        timeoutMs: 30_000,
      });
      body = JSON.parse(r.body.toString("utf8"));
    } catch (error) {
      if (error instanceof HttpError) throw new RpcError(error.clause, `${method}: ${error.message}`);
      throw new RpcError("malformed", `${method}: the RPC did not answer with JSON`);
    }
    if (body?.error) {
      const code = body.error.code;
      throw new RpcError(code === 429 || code === -32429 ? "rate_limited" : "rpc_error", `${method}: ${String(body.error.message ?? "error").slice(0, 300)}`, { code, data: body.error.data ?? null });
    }
    return body?.result;
  }

  const b64 = (acc) => (acc ? { ...acc, data: Buffer.from(acc.data[0], "base64") } : null);

  return Object.freeze({
    url,
    isPublic: u.host === new URL(PUBLIC_RPC).host,
    call,
    getSlot: () => call("getSlot", [{ commitment }]),
    getBalance: async (address) => (await call("getBalance", [address, { commitment }])).value,
    getAccountInfo: async (address) => b64((await call("getAccountInfo", [address, { encoding: "base64", commitment }])).value),
    getMultipleAccounts: async (addresses) => (await call("getMultipleAccounts", [addresses, { encoding: "base64", commitment }])).value.map(b64),
    getLatestBlockhash: async () => (await call("getLatestBlockhash", [{ commitment }])).value,
    getMinimumBalanceForRentExemption: (size) => call("getMinimumBalanceForRentExemption", [size, { commitment }]),
    getSignaturesForAddress: (address, opts = {}) => call("getSignaturesForAddress", [address, { limit: 1000, commitment, ...opts }]),
    getTransaction: (signature) => call("getTransaction", [signature, { encoding: "json", maxSupportedTransactionVersion: 1, commitment }]),
    getTokenLargestAccounts: async (mint) => (await call("getTokenLargestAccounts", [mint, { commitment }])).value,
    getSignatureStatuses: async (sigs) => (await call("getSignatureStatuses", [sigs, { searchTransactionHistory: false }])).value,
    /** Simulate a signed or unsigned transaction. `accounts` asks for their post-state. */
    simulate: async (base64Tx, { sigVerify = false, replaceRecentBlockhash = false, accounts = [] } = {}) => (await call("simulateTransaction", [base64Tx, {
      encoding: "base64", commitment, sigVerify, replaceRecentBlockhash,
      ...(accounts.length ? { accounts: { encoding: "base64", addresses: accounts } } : {}),
    }])).value,
    sendRaw: (base64Tx) => call("sendTransaction", [base64Tx, { encoding: "base64", skipPreflight: false, preflightCommitment: commitment, maxRetries: 3 }]),
  });
}
