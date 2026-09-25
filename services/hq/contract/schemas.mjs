/**
 * THE CONTRACT (docs/hq/API.md) AS JSON SCHEMA, AND A SMALL VALIDATOR FOR IT.
 *
 * One file both sides can hold a response to: test-hq-api.mjs checks every answer HQ gives
 * against these, and the site's tests can import this module (it has no dependencies) and check
 * the fixtures they draw with. The schemas are strict — every object lists its fields and allows
 * no other — so a field added on one side and not the other fails a test on both. They follow the
 * site's validator (site/assets/hq-validate.js) rule for rule, so the two accept the same answers:
 * the formats, the ids, the text limits and the characters text may not carry, the amounts that
 * are never negative, a live trade's transaction, and a buy's rug check (four checks, in order,
 * passed exactly when all four pass).
 *
 * The validator knows the subset used here: type (one or a list, "null" included), properties,
 * required, additionalProperties: false, items, prefixItems, minItems, maxItems, contains, enum,
 * const, pattern, minLength, maxLength (in UTF-16 code units, as a string's length counts),
 * minimum, maximum and oneOf.
 */
/* The characters no text may carry (services/hq/lib/text.mjs holds the same class). */
const HIDDEN = "\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\ufff0-\\ufffb";
export const PATTERNS = Object.freeze({
  sol: "^-?(0|[1-9]\\d*)(\\.\\d{1,9})?$",
  solNonNegative: "^(0|[1-9]\\d*)(\\.\\d{1,9})?$",
  units: "^-?(0|[1-9]\\d*)(\\.\\d+)?$",
  unitsNonNegative: "^(0|[1-9]\\d*)(\\.\\d+)?$",
  pct: "^-?(0|[1-9]\\d*)(\\.\\d+)?$",
  sprite: "^[a-z0-9][a-z0-9-]{0,31}$",
  iso: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z$",
  address: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
  signature: "^[1-9A-HJ-NP-Za-km-z]{64,90}$",
  number3: "^\\d{3}$",
  itemId: "^[A-Za-z0-9_-]{1,64}$",
  cursor: "^[A-Za-z0-9_-]{1,128}$",
  nonce: "^[A-Za-z0-9_-]{16,128}$",
  /* the perks challenge, line for line (API.md GET /v1/perks/challenge) */
  challenge: "^catintelligenceagency\\.com asks you to prove you hold this wallet, to show your \\$CIA holder perks\\.\\n"
    + "Wallet: [1-9A-HJ-NP-Za-km-z]{32,44}\\nNonce: [A-Za-z0-9_-]{16,128}\\n"
    + "Issued: \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z\\nExpires: \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z\\n"
    + "Signing this message moves nothing: no SOL, no tokens, no approval, and it costs nothing\\.$",
  /* plain text: at least one visible character, none of the hidden ones */
  plain: `^(?=[^${HIDDEN}]*[^\\s${HIDDEN}])[^${HIDDEN}]*$`,
});
/** The contract's text limits (API.md "Text is plain"). */
export const TEXT_LIMITS = Object.freeze({ agentName: 48, symbol: 16, coinName: 64, reason: 500, detail: 500, perk: 120, schedule: 120 });

const str = { type: "string" };
const nullable = (s) => ({ ...s, type: [].concat(s.type, "null") });
const text = (max) => ({ type: "string", minLength: 1, maxLength: max, pattern: PATTERNS.plain });
const sol = { type: "string", pattern: PATTERNS.sol };
const sol0 = { type: "string", pattern: PATTERNS.solNonNegative };
const units0 = { type: "string", pattern: PATTERNS.unitsNonNegative };
const pct = { type: "string", pattern: PATTERNS.pct };
const pct0 = { type: "string", pattern: PATTERNS.unitsNonNegative };
const iso = { type: "string", pattern: PATTERNS.iso };
const address = { type: "string", pattern: PATTERNS.address };
const sig = { type: "string", pattern: PATTERNS.signature };
const itemId = { type: "string", pattern: PATTERNS.itemId };
const agentId = { type: "integer", minimum: 1, maximum: 999 };
const obj = (properties, extra = {}) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties, ...extra });
const count = { type: "integer", minimum: 0 };

export const ENUMS = Object.freeze({
  rank: ["recruit", "field", "special", "senior", "director"],
  strategy: ["snipurr", "coinmarketcat", "popcat-scout", "crying-cat-safe"],
  mode: ["paper", "live"],
  status: ["active", "paused", "retired"],
  trigger: ["strategy", "stop_loss", "take_profit", "trailing_stop", "daily_limit", "manual"],
  flow: ["fee_in", "profit_in", "buyback", "funding_out", "funding_in"],
  tier: ["none", "holder", "agent", "director"],
  rugCheck: ["mint_authority", "freeze_authority", "holders", "creator_share"],
});

/**
 * Crying Cat's check of a coin, made before a buy: exactly four checks, one per id, in the
 * contract's order, and passed exactly when all four pass.
 */
const rugLine = (id, pass = { type: "boolean" }) => obj({ id: { const: id }, pass, detail: text(TEXT_LIMITS.detail) });
const PassedRugCheck = obj({ passed: { const: true }, checks: { type: "array", minItems: 4, maxItems: 4, prefixItems: ENUMS.rugCheck.map((id) => rugLine(id, { const: true })) } });
const FailedRugCheck = obj({ passed: { const: false }, checks: { type: "array", minItems: 4, maxItems: 4, prefixItems: ENUMS.rugCheck.map((id) => rugLine(id)),
  contains: { type: "object", properties: { pass: { const: false } } } } });
const RugCheck = { oneOf: [PassedRugCheck, FailedRugCheck] };

/* A decision: a buy carries its rug check once the check ran (null before it); a sell or a hold never. */
const decisionFields = { kind: { const: "decision" }, id: itemId, t: iso, agentId, mint: nullable(address), symbol: nullable(text(TEXT_LIMITS.symbol)),
  reason: text(TEXT_LIMITS.reason), mode: { enum: ENUMS.mode } };
const Decision = { oneOf: [
  obj({ ...decisionFields, action: { const: "buy" }, rugCheck: { oneOf: [RugCheck, { type: "null" }] } }),
  obj({ ...decisionFields, action: { enum: ["sell", "hold"] }, rugCheck: { type: "null" } }),
] };
/* A trade: a live one always carries its transaction and a paper one never does; every buy
   carries the rug check that passed before it, and a sell carries none. */
const tradeFields = { kind: { const: "trade" }, id: itemId, t: iso, agentId, mint: address, symbol: text(TEXT_LIMITS.symbol),
  sol: sol0, tokens: units0, price: units0, pnlSol: nullable(sol), pnlPct: nullable(pct), trigger: { enum: ENUMS.trigger } };
const Trade = { oneOf: [
  obj({ ...tradeFields, side: { const: "buy" }, rugCheck: PassedRugCheck, tx: { type: "null" }, mode: { const: "paper" } }),
  obj({ ...tradeFields, side: { const: "sell" }, rugCheck: { type: "null" }, tx: { type: "null" }, mode: { const: "paper" } }),
  obj({ ...tradeFields, side: { const: "buy" }, rugCheck: PassedRugCheck, tx: sig, mode: { const: "live" } }),
  obj({ ...tradeFields, side: { const: "sell" }, rugCheck: { type: "null" }, tx: sig, mode: { const: "live" } }),
] };
/* Only the P&L can be negative; careerRealizedSol is the profit the rank counts (a loss counts as none). */
const Stats = obj({ balanceSol: sol0, portfolioSol: sol0, realizedPnlSol: sol, unrealizedPnlSol: sol, careerRealizedSol: sol0, feesClaimedSol: sol0, depositedSol: sol0,
  withdrawnSol: sol0, trades: count, wins: count, losses: count, maxDrawdownPct: pct0, roiPct: nullable(pct), unpricedPositions: count });
const agentFields = {
  id: agentId, number: { type: "string", pattern: PATTERNS.number3 }, name: text(TEXT_LIMITS.agentName),
  cat: { type: "string", pattern: PATTERNS.sprite }, skin: { type: "string", pattern: PATTERNS.sprite },
  rank: { enum: ENUMS.rank }, strategy: { enum: ENUMS.strategy }, mode: { enum: ENUMS.mode }, status: { enum: ENUMS.status },
  coin: { type: ["object", "null"], additionalProperties: false, required: ["mint", "symbol", "name"],
    properties: { mint: address, symbol: nullable(text(TEXT_LIMITS.symbol)), name: nullable(text(TEXT_LIMITS.coinName)) } },
  wallet: address, hiredAt: iso, stats: Stats,
};
const Agent = obj(agentFields);
/* A position: priced by a quote under an hour old (price, pnlPct and markAt set), or not (price
   and pnlPct null; markAt the last quote's time, or null if it never had one). */
const positionFields = { mint: address, symbol: text(TEXT_LIMITS.symbol), costSol: sol0, valueSol: sol0, entryPrice: units0, pnlSol: sol, openedAt: iso };
const Position = { oneOf: [
  obj({ ...positionFields, price: units0, pnlPct: pct, markAt: iso }),
  obj({ ...positionFields, price: { type: "null" }, pnlPct: { type: "null" }, markAt: nullable(iso) }),
] };
const AgentDetail = obj({
  ...agentFields,
  limits: obj({ maxPerTradeSol: sol0, maxOpenPositions: { type: "integer", minimum: 1 }, stopLossPct: pct0, takeProfitPct: pct0, trailingStopPct: nullable(pct0), dailyLossLimitSol: sol0 }),
  positions: { type: "array", items: Position },
  decisions: { type: "array", items: Decision },
  trades: { type: "array", items: Trade },
  equity: { type: "array", items: obj({ t: iso, portfolioSol: sol0 }) },
  fees: { type: "array", items: obj({ t: iso, sol: sol0, tx: sig }) },
  transfers: { type: "array", items: obj({ t: iso, kind: { enum: ["deposit", "withdrawal"] }, sol: sol0, tx: nullable(sig) }) },
  promotions: { type: "array", items: obj({ t: iso, from: { enum: ENUMS.rank }, to: { enum: ENUMS.rank } }) },
});
/** One mode's figures, over that mode's agents only: paper and live are never added together. */
const ModeSummary = obj({ agents: obj({ active: count, total: count }), trades24h: obj({ count, volumeSol: sol0 }), solInAgentWallets: sol0,
  tradingPnlSol: obj({ realized: sol, unrealized: sol }), wins: count, losses: count, maxDrawdownPct: nullable(pct0) });
const Summary = obj({
  updatedAt: iso, live: ModeSummary, paper: ModeSummary, creatorFeesClaimedSol: sol0,
  buybacks: obj({ count, solSpent: sol0, ciaBought: units0 }), treasury: obj({ address: nullable(address), sol: sol0, cia: units0 }),
});
/* A buyback is always a real transaction: its tx and its price (SOL per $CIA) are never null. */
const BuybackItem = obj({ t: iso, solSpent: sol0, ciaBought: units0, price: units0, tx: sig, burnTx: nullable(sig) });
const Promotion = obj({ agentId, mode: { enum: ENUMS.mode }, t: iso, from: { enum: ENUMS.rank }, to: { enum: ENUMS.rank } });
const Fee = obj({ agentId, t: iso, sol: sol0, tx: sig });
const perks = { type: "array", items: text(TEXT_LIMITS.perk) };

export const SCHEMAS = Object.freeze({
  Decision, Trade, RugCheck, Agent, AgentDetail, Position, ModeSummary, Summary, BuybackItem, Promotion, Fee,
  /* the stream's first event when it cannot resume from the client's Last-Event-ID */
  Reset: obj({}),
  Agents: obj({ agents: { type: "array", items: Agent } }),
  Desk: obj({ items: { type: "array", items: { oneOf: [Decision, Trade] } }, next: nullable({ type: "string", pattern: PATTERNS.cursor }) }),
  /* value: a percentage (by=roi) or SOL (by=pnl), both in SOL's format; rows best first */
  Leaderboard: obj({ period: { enum: ["7d", "30d", "all"] }, by: { enum: ["roi", "pnl"] },
    rows: { type: "array", items: obj({ agentId, value: sol, rank: { enum: ENUMS.rank }, mode: { enum: ENUMS.mode } }) } }),
  Buybacks: obj({ policy: obj({ sharePct: pct0, sources: { type: "array", items: { enum: ["creator_fees", "trading_profit"] } }, schedule: text(TEXT_LIMITS.schedule), destination: { enum: ["burn", "treasury"] } }),
    items: { type: "array", items: BuybackItem } }),
  Treasury: obj({ address: nullable(address), sol: sol0, cia: units0, flows: { type: "array", items: obj({ t: iso, kind: { enum: ENUMS.flow }, sol: sol0, tx: sig }) } }),
  PerksTiers: obj({ tiers: { type: "array", items: obj({ id: { enum: ["holder", "agent", "director"] }, minCia: units0, perks }) } }),
  /* the challenge's message is exactly the contract's six lines; only the wallet, the nonce and the
     two times vary (the site also checks they are the challenge's own, and Expires = expiresAt) */
  PerksChallenge: obj({ wallet: address, nonce: { type: "string", pattern: PATTERNS.nonce }, message: { type: "string", pattern: PATTERNS.challenge }, expiresAt: iso }),
  /* holder is true exactly when the tier is not none */
  PerksVerify: { oneOf: [
    obj({ holder: { const: true }, balance: units0, tier: { enum: ["holder", "agent", "director"] }, perks, expiresAt: iso }),
    obj({ holder: { const: false }, balance: units0, tier: { const: "none" }, perks, expiresAt: iso }),
  ] },
  Error: obj({ error: str, message: str }),
});
/** What each stream event's data is. */
export const STREAM_EVENTS = Object.freeze({ trade: "Trade", decision: "Decision", promotion: "Promotion", buyback: "BuybackItem", fee: "Fee", summary: "Summary", reset: "Reset" });

/** Errors of `value` against `schema` ([] when it conforms): [{ path, message }]. */
export function validate(schema, value, path = "$") {
  const errors = [];
  const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
  const matchesType = (t, v) => { const a = typeOf(v); return t === a || (t === "number" && (a === "integer" || a === "number")); };
  (function walk(s, v, p) {
    if (s.oneOf) { if (!s.oneOf.some((x) => validate(x, v, p).length === 0)) errors.push({ path: p, message: "matches none of its shapes" }); return; }
    if ("const" in s && v !== s.const) { errors.push({ path: p, message: `${JSON.stringify(v)} is not ${JSON.stringify(s.const)}` }); return; }
    if (s.enum && !s.enum.includes(v)) { errors.push({ path: p, message: `${JSON.stringify(v)} is not one of ${s.enum.join(", ")}` }); return; }
    if (s.type) {
      const types = [].concat(s.type);
      if (!types.some((t) => matchesType(t, v))) { errors.push({ path: p, message: `is ${typeOf(v)}, not ${types.join(" or ")}` }); return; }
    }
    if (v === null) return;
    if (typeof v === "string") {
      if (s.minLength !== undefined && v.length < s.minLength) errors.push({ path: p, message: `is shorter than ${s.minLength}` });
      if (s.maxLength !== undefined && v.length > s.maxLength) errors.push({ path: p, message: `is longer than ${s.maxLength}` });
      if (s.pattern && !new RegExp(s.pattern).test(v)) errors.push({ path: p, message: `${JSON.stringify(v).slice(0, 60)} does not match the contract's format` });
    }
    if (typeof v === "number" && s.minimum !== undefined && v < s.minimum) errors.push({ path: p, message: `${v} is under ${s.minimum}` });
    if (typeof v === "number" && s.maximum !== undefined && v > s.maximum) errors.push({ path: p, message: `${v} is over ${s.maximum}` });
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) errors.push({ path: p, message: `has fewer than ${s.minItems} entries` });
      if (s.maxItems !== undefined && v.length > s.maxItems) errors.push({ path: p, message: `has more than ${s.maxItems} entries` });
      if (s.prefixItems) s.prefixItems.forEach((x, i) => { if (i < v.length) walk(x, v[i], `${p}[${i}]`); });
      if (s.items) v.forEach((x, i) => { if (!s.prefixItems || i >= s.prefixItems.length) walk(s.items, x, `${p}[${i}]`); });
      if (s.contains && !v.some((x) => validate(s.contains, x).length === 0)) errors.push({ path: p, message: "has no entry of the kind it must contain" });
    }
    if (typeOf(v) === "object" && s.properties) {
      for (const k of s.required ?? []) if (!Object.hasOwn(v, k)) errors.push({ path: `${p}.${k}`, message: "is missing" });
      for (const [k, x] of Object.entries(v)) {
        if (Object.hasOwn(s.properties, k)) walk(s.properties[k], x, `${p}.${k}`);
        else if (s.additionalProperties === false) errors.push({ path: `${p}.${k}`, message: "is not in the contract" });
      }
    }
  })(schema, value, path);
  return errors;
}
