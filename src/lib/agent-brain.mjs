/**
 * THE BRAIN: THE OWNER'S STRATEGY AND A MARKET SNAPSHOT IN, PROPOSED ACTIONS OUT.
 *
 * The agent asks a model, through the Anthropic Messages API and the owner's own API key
 * (bring your own key: there is no CoinMarketCat server to hold one), what to do about the
 * tokens in its universe. What comes back is a PROPOSAL. agent-risk.mjs decides what, if
 * anything, of it is executed; the model cannot change a limit, move money anywhere but
 * between the settlement token and the listed tokens, or withdraw — withdrawing is not an
 * action it can name, and the runner has no path from its output to the sweep.
 *
 * THE CALL. POST https://api.anthropic.com/v1/messages with the headers the API documents
 * for a direct browser call — x-api-key, anthropic-version: 2023-06-01, content-type
 * application/json, anthropic-dangerous-direct-browser-access: true — one tool,
 * `submit_decisions`, whose input_schema IS the decision format, and tool_choice forcing
 * it. Some models answer a forced tool_choice with a 400 naming tool_choice; the brain then
 * asks once more with tool_choice "auto" and an instruction to call the tool, remembers that
 * for the model, and the journal says which way each decision was asked. The system prompt
 * carries the rules and the owner's strategy; the user message carries the snapshot, the
 * vault, the positions, the P&L, the limits (read-only) and the last few decisions.
 *
 * THE MODEL IS CHOSEN AT RUN TIME. No model identifier is written anywhere in this
 * repository. GET https://api.anthropic.com/v1/models with the owner's key lists what that
 * key may use, newest first; the owner picks one in Options, and with none picked the first
 * listed is used. Tests use invented ids.
 *
 * A FAILURE MEANS NO NEW ENTRIES THIS TICK: a network error, a timeout, any 4xx or 5xx, a
 * refusal, a truncated answer, no tool call, or a tool input that is not exactly the
 * decision format. It is thrown as BrainError with a clause; the runner journals it and
 * the protections run regardless. Token usage is read from every answer and journaled.
 *
 * THE KEY. `apiKey()` is injected by the service worker, which alone reads it from
 * chrome.storage.local. This file sends it in exactly one header, to exactly one origin,
 * ANTHROPIC_API, and refuses to build a request to anything else; it never logs it, never
 * returns it, never puts it in an error. test-agent-no-leak.mjs pins all of that.
 */
export const ANTHROPIC_API = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2023-06-01";
export const DECISION_TOOL_NAME = "submit_decisions";
export const BRAIN_ACTIONS = Object.freeze(["buy", "sell", "hold"]);
/** Room for the answer and any reasoning the model does before it; billed as used, not as capped. */
export const BRAIN_MAX_TOKENS = 8_000;
export const BRAIN_TIMEOUT_MS = 90_000;
export const MAX_ACTIONS = 10;
export const RATIONALE_MAX = 2_000;
export const REASON_MAX = 400;
/** The model list is re-read at most this often. */
export const MODELS_TTL_MS = 6 * 3_600_000;

/** The decision format, as the tool's input_schema. The model may name nothing else. */
export const DECISION_TOOL = Object.freeze({
  name: DECISION_TOOL_NAME,
  description: "Submit this tick's trading decisions for the agent's universe. Call it exactly once. " +
    "Each action is a proposal: deterministic code applies the owner's limits afterwards and may clamp or refuse it.",
  input_schema: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["rationale", "actions"],
    properties: Object.freeze({
      rationale: { type: "string", description: "The overall reasoning for this tick, in plain words, for the owner's journal." },
      actions: {
        type: "array",
        maxItems: MAX_ACTIONS,
        description: "One entry per token acted on. An empty list, or hold, means do nothing.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["action", "mint", "confidence", "reason"],
          properties: {
            action: { type: "string", enum: [...BRAIN_ACTIONS] },
            mint: { type: "string", description: "The token's mint address, exactly as listed in the market snapshot." },
            usd: { type: "number", description: "For a buy: how many US dollars of the settlement token to spend." },
            fraction: { type: "number", description: "For a sell: the fraction of the held position to sell, above 0 and at most 1." },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reason: { type: "string", description: "Why, in one or two sentences." },
          },
        },
      },
    }),
  }),
});

export class BrainError extends Error {
  constructor(clause, message, detail = {}) { super(message); this.name = "BrainError"; this.clause = clause; this.detail = detail; }
}

const isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const trimText = (v, max) => { const s = String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim(); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

/* ── the prompt ───────────────────────────────────────────────────────────────────── */

/** The rules and the owner's strategy. Stable across ticks, so it can be cached by the API. */
/**
 * WHAT THE AGENCY'S OWN MONEY TAUGHT, AND WHAT THE PUBLISHED RECORD SAYS. Measured facts,
 * not tips: HAWK-AI's 64 real round trips and the Claude Co desk's 132 graded calls and 20
 * live trades (Claude-Company, read back 2026-09-16/17), and the public LLM-trading results
 * (StockBench 2025; Nof1's Alpha Arena, Oct–Nov 2025). docs/coinmarketcat-lessons.md has
 * the tables. The code enforces what can be enforced; this is what the model is told.
 */
export const AGENT_LESSONS = Object.freeze([
  "What real money has already taught this agency (facts, not rules; the owner's limits still decide):",
  "- The bar is buy-and-hold. Most published LLM trading agents did not beat simply holding. The context's versusBuyAndHold says whether you are ahead of holding the universe; if you are behind, trade less, not more.",
  "- Trade rarely and only with conviction. The desk's low-conviction calls were 39% of its record and all of its loss; in the public LLM contests the models that churned paid the most in fees and lost the most. Your confidence is graded: a buy under the owner's floor is refused.",
  "- Friction is real. The desk's live trades lost 3.2 points a trade more than its paper marks. A move smaller than a few times the round trip (slippage plus fees) is not worth taking.",
  "- Price action and flow predicted; stories did not. On the desk's scorecard the technical read (rank correlation +0.23) and buy/sell flow (+0.12) predicted the next day; narrative and hype did not.",
  "- Do not chase a move that is already over: falling over the hour, sellers ahead of buyers, volume fading.",
  "- Size small into thin liquidity: HAWK-AI's whole net loss sat in its largest tickets.",
]);

export function buildSystemPrompt(spec, { settlementSymbol }) {
  return [
    `You are the trading brain of "${spec.name}", a CoinMarketCat agent. It trades Solana spot tokens for its owner, `
      + `from an autopilot wallet the owner funded, settled in ${settlementSymbol}.`,
    "",
    "Rules you cannot change:",
    `- Act only on the tokens in the market snapshot, by their mint address. Every buy spends ${settlementSymbol}; every sell returns ${settlementSymbol}.`,
    "- Propose buy, sell or hold, and nothing else. A buy is sized in US dollars (\"usd\"); a sell is a fraction of the held position (\"fraction\", above 0 and at most 1).",
    "- Spot only: no leverage, no shorting, no borrowing.",
    "- Deterministic code applies the owner's limits after you — the per-token cap, the exposure cap, the stop loss, the take profit, "
      + "the daily drawdown breaker, trades per day and the slippage cap — and clamps or refuses what you propose. The stop loss and "
      + "the take profit fire on their own between your turns. You cannot change a limit, move funds elsewhere, or withdraw.",
    "- A value of null is missing. Do not guess it, and do not trade on it as if it were known.",
    "- Holding is a valid answer. Say why in the rationale.",
    `- Answer by calling the ${DECISION_TOOL_NAME} tool exactly once.`,
    "",
    ...AGENT_LESSONS,
    "",
    "The owner's strategy, in their own words. Follow it within the rules above; where it conflicts with a rule, the rule wins:",
    "<strategy>",
    spec.strategy,
    "</strategy>",
  ].join("\n");
}

/** The snapshot, the vault, the positions, the limits and the recent decisions, as JSON. */
export function buildUserMessage(context) {
  return "Decide for this tick. The context, as JSON:\n" + JSON.stringify(context, null, 1);
}

/* ── the answer ───────────────────────────────────────────────────────────────────── */

const TOP_KEYS = new Set(["rationale", "actions"]);
const ACTION_KEYS = new Set(["action", "mint", "usd", "fraction", "confidence", "reason"]);

/**
 * The tool input, held to the decision format exactly. A malformed WHOLE (not an object,
 * no rationale, no action list, a field the format does not have — a limit, say) refuses
 * the decision: no new entries this tick. A malformed ACTION refuses that action by name
 * and keeps the rest, because one bad line should not cost the owner a good one.
 */
export function validateDecision(input, { universeMints }) {
  if (!isPlainObject(input)) throw new BrainError("malformed_output", "the decision is not an object");
  const extra = Object.keys(input).filter((k) => !TOP_KEYS.has(k));
  if (extra.length) throw new BrainError("unexpected_field", `the decision carries ${extra.map((k) => `"${k}"`).join(", ")}, which the format does not have — nothing the model sends can set a limit`);
  if (typeof input.rationale !== "string" || !input.rationale.trim()) throw new BrainError("rationale_missing", "the decision has no rationale");
  if (!Array.isArray(input.actions)) throw new BrainError("actions_missing", "the decision has no list of actions");
  if (input.actions.length > MAX_ACTIONS) throw new BrainError("too_many_actions", `${input.actions.length} actions; at most ${MAX_ACTIONS}`);
  const universe = new Set(universeMints);
  const actions = [], rejected = [];
  input.actions.forEach((a, i) => {
    const no = (clause, message) => rejected.push({ index: i, mint: isPlainObject(a) && typeof a.mint === "string" ? a.mint : null, action: isPlainObject(a) ? String(a.action ?? "") : null, clause, message });
    if (!isPlainObject(a)) return no("action_malformed", `action ${i} is not an object`);
    const extraKeys = Object.keys(a).filter((k) => !ACTION_KEYS.has(k));
    if (extraKeys.length) return no("unexpected_field", `action ${i} carries ${extraKeys.join(", ")}, which the format does not have`);
    if (!BRAIN_ACTIONS.includes(a.action)) return no("action_unknown", `action ${i} is "${String(a.action)}"; only ${BRAIN_ACTIONS.join(", ")} exist`);
    if (typeof a.mint !== "string" || !universe.has(a.mint)) return no("not_in_universe", `action ${i} names ${JSON.stringify(a.mint)}, which is not in the universe`);
    /* A number is a JSON number: "25", [25] or true is not coerced into one. */
    const confidence = typeof a.confidence === "number" ? a.confidence : NaN;
    if (!(Number.isFinite(confidence) && confidence >= 0 && confidence <= 1)) return no("confidence_invalid", `action ${i}: confidence must be a number from 0 to 1`);
    if (typeof a.reason !== "string" || !a.reason.trim()) return no("reason_missing", `action ${i} gives no reason`);
    const out = { action: a.action, mint: a.mint, confidence, reason: trimText(a.reason, REASON_MAX) };
    if (a.action === "buy") {
      const usd = typeof a.usd === "number" ? a.usd : NaN;
      if (!(Number.isFinite(usd) && usd > 0)) return no("size_invalid", `action ${i}: a buy needs a positive number "usd"`);
      if (a.fraction !== undefined) return no("size_invalid", `action ${i}: a buy is sized in "usd", not "fraction"`);
      out.usd = usd;
    } else if (a.action === "sell") {
      const fraction = typeof a.fraction === "number" ? a.fraction : NaN;
      if (!(Number.isFinite(fraction) && fraction > 0 && fraction <= 1)) return no("size_invalid", `action ${i}: a sell needs a number "fraction" above 0 and at most 1`);
      if (a.usd !== undefined) return no("size_invalid", `action ${i}: a sell is sized as a "fraction" of the position, not in "usd"`);
      out.fraction = fraction;
    }
    actions.push(Object.freeze(out));
  });
  return Object.freeze({ rationale: trimText(input.rationale, RATIONALE_MAX), actions: Object.freeze(actions), rejected: Object.freeze(rejected) });
}

/** GET /v1/models: [{ id, displayName, createdAt }] in the order the API listed them. */
export function parseModels(body) {
  const list = Array.isArray(body?.data) ? body.data : [];
  return list.filter((m) => isPlainObject(m) && typeof m.id === "string" && m.id.length > 0 && m.id.length <= 120)
    .map((m) => Object.freeze({ id: m.id, displayName: typeof m.display_name === "string" ? m.display_name : m.id, createdAt: typeof m.created_at === "string" ? m.created_at : null }));
}

/** The token counts one answer used, as the API reported them. */
export function usageOf(body) {
  const u = isPlainObject(body?.usage) ? body.usage : {};
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
  return Object.freeze({ inputTokens: n(u.input_tokens), outputTokens: n(u.output_tokens), cacheWriteTokens: n(u.cache_creation_input_tokens), cacheReadTokens: n(u.cache_read_input_tokens) });
}

/* ── the client ───────────────────────────────────────────────────────────────────── */

export function createBrain({
  fetchImpl = globalThis.fetch, clock = () => Date.now(),
  timers = { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) },
  apiKey,                     // async () => the owner's key or null; the worker's, read from chrome.storage.local
  timeoutMs = BRAIN_TIMEOUT_MS,
} = {}) {
  if (typeof apiKey !== "function") throw new Error("createBrain needs apiKey(): the worker's reader of the owner's key");
  const autoFor = new Set();          // models that refused a forced tool_choice
  let models = null;                  // { at, list }
  const counters = { calls: 0, ok: 0, failures: 0, lastError: null, lastClause: null };

  async function call(path, { method = "GET", body = null } = {}) {
    const url = `${ANTHROPIC_API}${path}`;
    /* The one origin the key may travel to, asserted where the request is built. */
    if (!url.startsWith(`${ANTHROPIC_API}/v1/`)) throw new BrainError("bad_request", "the brain builds requests to the Anthropic API only");
    const key = await apiKey();
    if (typeof key !== "string" || !key) throw new BrainError("no_api_key", "no API key is saved — add yours in Options → Agent");
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? timers.setTimeout(() => controller.abort(), timeoutMs) : null;
    let res, text;
    try {
      res = await fetchImpl(url, {
        method, signal: controller?.signal,
        headers: {
          "x-api-key": key,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
      });
      text = typeof res.text === "function" ? await res.text() : JSON.stringify(await res.json());
    } catch (error) {
      throw new BrainError(error?.name === "AbortError" ? "timeout" : "network", error?.name === "AbortError" ? `the Anthropic API did not answer inside ${Math.round(timeoutMs / 1000)} s` : "the Anthropic API could not be reached");
    } finally { if (timer !== null) timers.clearTimeout(timer); }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (!res.ok) {
      const type = typeof parsed?.error?.type === "string" ? parsed.error.type : null;
      const message = typeof parsed?.error?.message === "string" ? parsed.error.message.slice(0, 300) : `HTTP ${res.status}`;
      const clause = res.status === 401 ? "unauthorized" : res.status === 403 ? "forbidden" : res.status === 404 ? "not_found" : res.status === 429 ? "rate_limited"
        : res.status === 529 ? "overloaded" : res.status >= 500 ? "server" : res.status === 400 ? "bad_request" : "http";
      const said = clause === "unauthorized" ? "the API key was refused (401): check it in Options → Agent" : `the Anthropic API answered ${res.status}${type ? ` ${type}` : ""}: ${message}`;
      throw new BrainError(clause, said, { status: res.status, type, message });
    }
    if (!isPlainObject(parsed)) throw new BrainError("malformed", "the Anthropic API answered with something that is not a JSON object");
    return parsed;
  }

  async function listModels({ force = false } = {}) {
    if (!force && models && clock() - models.at < MODELS_TTL_MS) return models.list;
    const list = parseModels(await call("/v1/models?limit=100"));
    if (!list.length) throw new BrainError("no_models", "the API listed no models for this key");
    models = { at: clock(), list };
    return list;
  }

  /** The owner's pick when it is listed, else the first listed (the newest). */
  async function resolveModel(chosen) {
    const list = await listModels();
    if (chosen) {
      if (list.some((m) => m.id === chosen)) return chosen;
      throw new BrainError("model_unavailable", `the model chosen in Options is not among the ${list.length} this key lists — pick another`);
    }
    return list[0].id;
  }

  /**
   * One decision. Returns { decision, usage, model, toolChoice, stopReason, requestId }
   * or throws BrainError. `context` is what buildUserMessage serialises.
   */
  async function decide({ spec, settlementSymbol, context, universeMints }) {
    counters.calls++;
    try {
      const model = await resolveModel(spec.model);
      const system = buildSystemPrompt(spec, { settlementSymbol });
      const ask = async (forced) => call("/v1/messages", { method: "POST", body: {
        model, max_tokens: BRAIN_MAX_TOKENS, system,
        messages: [{ role: "user", content: buildUserMessage(context) + (forced ? "" : `\n\nCall the ${DECISION_TOOL_NAME} tool exactly once with your decisions.`) }],
        tools: [DECISION_TOOL],
        tool_choice: forced ? { type: "tool", name: DECISION_TOOL_NAME } : { type: "auto" },
      } });
      let forced = !autoFor.has(model);
      let body;
      try { body = await ask(forced); }
      catch (error) {
        if (!(error instanceof BrainError) || error.clause !== "bad_request" || !forced || !/tool_choice/i.test(error.detail?.message ?? "")) throw error;
        autoFor.add(model);
        forced = false;
        body = await ask(false);
      }
      const usage = usageOf(body);
      const stopReason = typeof body.stop_reason === "string" ? body.stop_reason : null;
      if (stopReason === "refusal") throw new BrainError("refused", "the model declined to answer", { usage });
      /* An answer cut off at max_tokens is refused whole, even with a tool call in it: the
         call may be missing the actions after the cut (a sell, say), and half a decision is
         not the decision. */
      if (stopReason === "max_tokens") throw new BrainError("truncated", "the answer ran out of room before the decision was complete", { usage });
      const calls = (Array.isArray(body.content) ? body.content : []).filter((b) => isPlainObject(b) && b.type === "tool_use" && b.name === DECISION_TOOL_NAME);
      if (!calls.length) throw new BrainError("no_tool_call", `the model did not call ${DECISION_TOOL_NAME}`, { usage });
      if (calls.length > 1) throw new BrainError("malformed_output", `the model called ${DECISION_TOOL_NAME} ${calls.length} times`, { usage });
      let decision;
      try { decision = validateDecision(calls[0].input, { universeMints }); }
      catch (error) { if (error instanceof BrainError) error.detail = { ...error.detail, usage }; throw error; }
      counters.ok++; counters.lastError = null; counters.lastClause = null;
      return Object.freeze({ decision, usage, model: typeof body.model === "string" ? body.model : model, toolChoice: forced ? "forced" : "auto", stopReason, requestId: typeof body.id === "string" ? body.id : null });
    } catch (error) {
      counters.failures++;
      const e = error instanceof BrainError ? error : new BrainError("error", String(error?.message ?? error));
      counters.lastError = e.message; counters.lastClause = e.clause;
      throw e;
    }
  }

  /**
   * One forced tool call for another cat (CashCat's drafts and reviews), through the same key,
   * the same origin and the same failures as decide(). Returns { input, usage, model } with the
   * tool input unvalidated: the caller holds it to its own format. `chosen` is the model the
   * owner picked for that cat ("" = the first the key lists).
   */
  async function callTool({ chosen = "", system, user, tool, maxTokens = 2_000 }) {
    if (!isPlainObject(tool) || typeof tool.name !== "string" || !isPlainObject(tool.input_schema)) throw new BrainError("bad_request", "callTool needs a tool with a name and an input_schema");
    counters.calls++;
    try {
      const model = await resolveModel(chosen);
      const ask = async (forced) => call("/v1/messages", { method: "POST", body: {
        model, max_tokens: Math.min(Math.max(256, Number(maxTokens) || 2_000), BRAIN_MAX_TOKENS), system: String(system ?? ""),
        messages: [{ role: "user", content: String(user ?? "") + (forced ? "" : `\n\nAnswer by calling the ${tool.name} tool exactly once.`) }],
        tools: [tool],
        tool_choice: forced ? { type: "tool", name: tool.name } : { type: "auto" },
      } });
      let forced = !autoFor.has(model);
      let body;
      try { body = await ask(forced); }
      catch (error) {
        if (!(error instanceof BrainError) || error.clause !== "bad_request" || !forced || !/tool_choice/i.test(error.detail?.message ?? "")) throw error;
        autoFor.add(model);
        forced = false;
        body = await ask(false);
      }
      const usage = usageOf(body);
      const stopReason = typeof body.stop_reason === "string" ? body.stop_reason : null;
      if (stopReason === "refusal") throw new BrainError("refused", "the model declined to answer", { usage });
      if (stopReason === "max_tokens") throw new BrainError("truncated", "the answer ran out of room", { usage });
      const calls = (Array.isArray(body.content) ? body.content : []).filter((b) => isPlainObject(b) && b.type === "tool_use" && b.name === tool.name);
      if (calls.length !== 1) throw new BrainError(calls.length ? "malformed_output" : "no_tool_call", `the model called ${tool.name} ${calls.length} times`, { usage });
      if (!isPlainObject(calls[0].input)) throw new BrainError("malformed_output", "the tool input is not an object", { usage });
      counters.ok++; counters.lastError = null; counters.lastClause = null;
      return Object.freeze({ input: calls[0].input, usage, model: typeof body.model === "string" ? body.model : model });
    } catch (error) {
      counters.failures++;
      const e = error instanceof BrainError ? error : new BrainError("error", String(error?.message ?? error));
      counters.lastError = e.message; counters.lastClause = e.clause;
      throw e;
    }
  }

  function status() { return { ...counters, modelsListed: models ? models.list.length : null, modelsAt: models?.at ?? null, autoToolChoice: [...autoFor] }; }
  return Object.freeze({ listModels, resolveModel, decide, callTool, status });
}
