/**
 * TEST DOUBLES FOR THE BOTS' TESTS: a scripted fetch, a scripted JSON-RPC, a fixture loader and a
 * tiny assertion harness. No test touches the network: every answer is either a recorded live
 * answer from fixtures/bots/ or built here and named as built.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const fixture = (rel) => {
  const p = path.join(ROOT, "fixtures", "bots", rel);
  return rel.endsWith(".json") ? JSON.parse(fs.readFileSync(p, "utf8")) : fs.readFileSync(p, "utf8");
};

export function harness(title) {
  let pass = 0, fail = 0;
  const ok = (name, cond, detail = "") => {
    if (cond) { pass++; console.log(`  ok   ${name}${detail ? "  — " + detail : ""}`); }
    else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
  };
  const section = (t) => console.log(`\n${t}\n${"─".repeat(t.length)}`);
  const throwsClause = async (fn, clause) => {
    try { await fn(); return false; } catch (e) { return clause === undefined ? true : e?.clause === clause || (clause instanceof RegExp && clause.test(e.message)); }
  };
  const done = () => { console.log(`\n${title}: ${pass} passed, ${fail} failed\n`); process.exit(fail ? 1 : 0); };
  return { ok, section, throwsClause, done, counts: () => ({ pass, fail }) };
}

/** A Response-like object. */
export function response(status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { status, ok: status >= 200 && status < 300, headers: { get: (k) => h.get(k.toLowerCase()) ?? null }, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), text: async () => buf.toString("utf8") };
}

/**
 * A scripted fetch. `routes` is a list of [matcher, handler]: a matcher is a string prefix, a
 * RegExp, or a function(url, init); a handler returns a response() or a value (sent as JSON 200).
 * Every call is recorded in `calls`. An unmatched URL is an error, so no test can reach a
 * real host by accident.
 */
export function scriptedFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [m, h] of routes) {
      const hit = typeof m === "string" ? String(url).startsWith(m) : m instanceof RegExp ? m.test(String(url)) : m(String(url), init);
      if (!hit) continue;
      const out = await h(String(url), init);
      return out && typeof out.status === "number" && typeof out.text === "function" ? out : response(200, out);
    }
    throw new Error(`scriptedFetch: no route for ${url}`);
  };
  return { fetchImpl, calls };
}

/**
 * A scripted RPC with the same surface as bots/lib/rpc.mjs. `handlers` maps a JSON-RPC method
 * to (params) => result. Every call is recorded; sendRaw is counted separately.
 */
export function scriptedRpc(handlers, { isPublic = false } = {}) {
  const calls = [];
  const call = async (method, params = []) => {
    calls.push({ method, params });
    const h = handlers[method];
    if (!h) throw Object.assign(new Error(`scriptedRpc: no handler for ${method}`), { clause: "rpc_error" });
    return h(params);
  };
  const acc = (a) => (a ? { ...a, data: Buffer.isBuffer(a.data) ? a.data : Buffer.from(a.data[0], "base64") } : null);
  return {
    calls, isPublic, call,
    getSlot: () => call("getSlot"),
    getBalance: async (a) => (await call("getBalance", [a])).value,
    getAccountInfo: async (a) => acc((await call("getAccountInfo", [a])).value),
    getMultipleAccounts: async (list) => (await call("getMultipleAccounts", [list])).value.map(acc),
    getLatestBlockhash: async () => (await call("getLatestBlockhash")).value,
    getMinimumBalanceForRentExemption: (n) => call("getMinimumBalanceForRentExemption", [n]),
    getSignaturesForAddress: (a, o = {}) => call("getSignaturesForAddress", [a, o]),
    getTransaction: (s) => call("getTransaction", [s]),
    getTokenLargestAccounts: async (m) => (await call("getTokenLargestAccounts", [m])).value,
    getSignatureStatuses: async (s) => (await call("getSignatureStatuses", [s])).value,
    simulate: async (b64, opts) => (await call("simulateTransaction", [b64, opts])).value,
    sendRaw: (b64) => call("sendTransaction", [b64]),
  };
}

/** A logger that keeps every line (already redacted by the real logger when wrapped). */
export function captureSink() {
  const lines = [];
  return { lines, sink: (_level, line) => lines.push(line) };
}
