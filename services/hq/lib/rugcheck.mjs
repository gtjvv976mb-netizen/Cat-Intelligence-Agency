/**
 * CRYING CAT BEFORE EVERY BUY. No agent buys anything that fails it, on paper or live.
 *
 * The check is Crying Cat's own report (src/lib/crying-cat.mjs cryingCatReport, the one the
 * extension shows), read from the chain at the moment of the buy, judged on four things:
 *   mint_authority     revoked: nobody can mint more
 *   freeze_authority   revoked: nobody can freeze the agent's tokens so they cannot be sold
 *   mint_extensions    the Token-2022 settings the trading lanes accept (no transfer fee, hook,
 *                      permanent delegate or pause)
 *   holder concentration  the ten largest holders, with the bonding curve and every
 *                      program-held account (pools, vaults) left out, hold at most
 *                      Popcat's MAX_TOP10_SHARE_PCT of the supply; holders that could not be
 *                      read are a refusal, never a pass
 *   creator share      the creator (named by the pump.fun curve) holds at most Popcat's
 *                      MAX_CREATOR_SHARE_PCT; for a coin that is not a pump.fun coin the chain
 *                      names no creator, which is said, not guessed
 * What this does NOT use from the report: the holder COUNT (a launch seconds old has few
 * holders by nature; Popcat's own scout applies it through Popcat's twelve checks) and the
 * copycat line. Nothing here loosens Crying Cat: the report is the report; this file decides
 * which of its lines stop a buy, and fails closed on anything it could not read.
 */
import { cryingCatReport } from "../../../src/lib/crying-cat.mjs";
import { THRESHOLDS } from "../../../bots/popcat/checks.mjs";
import { plainText, TEXT_MAX } from "./text.mjs";

export const RUG_RULES = Object.freeze({
  maxTop10Pct: THRESHOLDS.MAX_TOP10_SHARE_PCT,
  maxCreatorPct: THRESHOLDS.MAX_CREATOR_SHARE_PCT,
  must: Object.freeze(["mint_authority", "freeze_authority", "mint_extensions"]),
});

/**
 * Judge a Crying Cat report. Pure: { ok, failed: [{ id, why }], passed: [ids], checks }, where
 * `checks` is the contract's RugCheck lines (docs/hq/API.md): mint_authority, freeze_authority,
 * holders, creator_share, each { id, pass, detail }. The contract names four lines; the
 * Token-2022 extension check (a transfer fee, hook, permanent delegate or pause — powers over
 * holders' tokens that a mint can carry besides its two authorities) is shown inside the
 * mint_authority line, which passes only when both do.
 */
export function judgeRugReport(report) {
  const failed = [], passed = [];
  const line = {};
  const check = (id) => report?.checks?.find((c) => c.id === id) ?? null;
  const said = (c, id) => (c ? `${c.label ?? id}: ${c.value}` : `${id.replace(/_/g, " ")} was not read`);
  for (const id of RUG_RULES.must) {
    const c = check(id);
    if (c?.result === "pass") passed.push(id);
    else failed.push({ id, why: said(c, id) });
  }
  const mintAuth = check("mint_authority"), ext = check("mint_extensions"), freeze = check("freeze_authority");
  line.mint_authority = { pass: mintAuth?.result === "pass" && ext?.result === "pass", detail: `${said(mintAuth, "mint_authority")}; ${said(ext, "mint_extensions")}` };
  line.freeze_authority = { pass: freeze?.result === "pass", detail: said(freeze, "freeze_authority") };
  const h = report?.holders ?? null;
  let why;
  if (!h || typeof h.top10Pct !== "number") { why = "the holders could not be read, so their concentration is unknown"; failed.push({ id: "holders", why }); line.holders = { pass: false, detail: why }; }
  else if (h.top10Pct > RUG_RULES.maxTop10Pct) { why = `the ten largest holders (the curve and pools left out) hold ${h.top10Pct}% of the supply, over ${RUG_RULES.maxTop10Pct}%`; failed.push({ id: "holders", why }); line.holders = { pass: false, detail: why }; }
  else { passed.push("holders"); line.holders = { pass: true, detail: `the ten largest holders (the curve and pools left out) hold ${h.top10Pct}% of the supply, at most ${RUG_RULES.maxTop10Pct}%` }; }
  const creator = check("creator_share");
  if (creator?.result === "fail") { why = said(creator, "creator_share"); failed.push({ id: "creator_share", why }); line.creator_share = { pass: false, detail: why }; }
  else if (report?.pumpfun && creator?.result !== "pass") { why = "the creator's share of this pump.fun coin could not be read"; failed.push({ id: "creator_share", why }); line.creator_share = { pass: false, detail: why }; }
  else { passed.push("creator_share"); line.creator_share = { pass: true, detail: creator ? said(creator, "creator_share") : "the chain names no creator for a coin that is not a pump.fun coin; nothing is guessed" }; }
  const checks = RUG_LINES.map((id) => Object.freeze({ id, pass: line[id].pass, detail: plainText(line[id].detail, TEXT_MAX.detail) ?? id.replace(/_/g, " ") }));
  return Object.freeze({ ok: failed.length === 0, failed: Object.freeze(failed), passed: Object.freeze(passed), checks: Object.freeze(checks) });
}
/** The contract's four lines, in its order. */
export const RUG_LINES = Object.freeze(["mint_authority", "freeze_authority", "holders", "creator_share"]);

/**
 * The RugCheck the contract prints for a checker result: { passed, checks } with exactly the four
 * lines in the contract's order, and passed exactly when all four pass.
 */
export function rugCheckView(result) {
  if (!result) return null;
  const byId = new Map((Array.isArray(result.checks) ? result.checks : []).map((c) => [c.id, c]));
  const fallback = plainText(result.failed?.map((f) => f.why).join("; "), TEXT_MAX.detail) ?? "not read";
  const checks = RUG_LINES.map((id) => {
    const c = byId.get(id);
    return c ? { id, pass: c.pass === true, detail: plainText(c.detail, TEXT_MAX.detail) ?? id.replace(/_/g, " ") } : { id, pass: false, detail: fallback };
  });
  return { passed: checks.every((c) => c.pass), checks };
}

/** What a buy HQ never made carries (the wallet was used outside HQ): no check was made before
 *  it, so none passed — said in words, never invented. */
export const NOT_CHECKED = Object.freeze({ passed: false, checks: Object.freeze(RUG_LINES.map((id) => Object.freeze({ id, pass: false, detail: "not checked: HQ did not make this buy (the wallet was used outside HQ)" }))) });

/**
 * The check, with a short memory so one tick does not read the same mint twice. `rpc` is the
 * bots' JSON-RPC client shape (Buffer data), as Crying Cat takes it.
 */
export function createRugChecker({ rpc, clock = () => Date.now(), ttlMs = 60_000, report = cryingCatReport } = {}) {
  const memo = new Map();
  return Object.freeze({
    async check(mint) {
      const hit = memo.get(mint);
      if (hit && clock() - hit.at < ttlMs) return hit.result;
      let result;
      try {
        const r = await report({ rpc, mint, now: clock() });
        const verdict = judgeRugReport(r);
        result = Object.freeze({ ...verdict, symbol: r.symbol ?? null, name: r.name ?? null, decimals: r.decimals, program: r.program, pumpfun: r.pumpfun, holders: r.holders });
      } catch (error) {
        const why = `Crying Cat could not read it: ${String(error?.message ?? error).slice(0, 160)}`;
        result = Object.freeze({ ok: false, failed: Object.freeze([{ id: "unreadable", why }]), passed: Object.freeze([]), checks: Object.freeze(RUG_LINES.map((id) => Object.freeze({ id, pass: false, detail: why }))) });
      }
      memo.set(mint, { at: clock(), result });
      if (memo.size > 500) for (const k of [...memo.keys()].slice(0, 100)) memo.delete(k);
      return result;
    },
  });
}
