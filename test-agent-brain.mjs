/**
 * THE BRAIN AGAINST A SCRIPTED ANTHROPIC API: THE REQUEST, THE ANSWER, EVERY FAILURE, AND THE KEY.
 *
 * `fetch` is scripted: it answers https://api.anthropic.com in the documented shapes and
 * throws on any other host. Model ids here are invented ("model-a"): no real identifier is
 * written in this repository, and the brain never needs one — it lists the models the key
 * may use and takes the first (the API lists newest first) unless the owner picked another.
 *
 * What is proved:
 *   1. the request: POST /v1/messages with x-api-key, anthropic-version 2023-06-01, JSON, and
 *      the direct-browser-access header; the owner's strategy in the system prompt; the
 *      snapshot in the user message; one tool, forced;
 *   2. the model: the first listed by default; the owner's pick when listed; refused by name
 *      when not; the list read once and kept;
 *   3. the answer held to the decision format: a whole decision refused for a field it does
 *      not have (a limit, say), no rationale, no action list, too many actions; one bad action
 *      refused by name while the rest stand;
 *   4. every failure is a BrainError with a clause — 401, 403, 429, 500, 529, 400, a body that
 *      is not JSON, the network, a timeout, a refusal, a truncated answer, no tool call, two;
 *   5. a model that refuses a forced tool_choice is asked once more with "auto", and after
 *      that straight away;
 *   6. the token usage of every answer is reported, including a failed one's;
 *   7. THE KEY goes in one header to one origin: every request that carries it is to
 *      api.anthropic.com, no request goes anywhere else, no request is made without a key,
 *      and no error carries it.
 */
import {
  createBrain, validateDecision, parseModels, usageOf, buildSystemPrompt, buildUserMessage, BrainError,
  ANTHROPIC_API, ANTHROPIC_VERSION, DECISION_TOOL, DECISION_TOOL_NAME, BRAIN_ACTIONS, MAX_ACTIONS, BRAIN_MAX_TOKENS,
} from "./src/lib/agent-brain.mjs";
import { normalizeAgentSpec, SOLANA_MAJORS } from "./src/lib/agent-strategy.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? "  — " + detail : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const section = (title) => console.log(`\n${title}\n${"─".repeat(title.length)}`);

const KEY = "sk-test-DO-NOT-LEAK-0123456789abcdefghij";
const [JITO, JUP, JTO] = SOLANA_MAJORS.map((m) => m.mint);
const UNIVERSE = SOLANA_MAJORS.map((m) => m.mint);
const spec = normalizeAgentSpec({ name: "Brain test", strategy: "Buy JUP when its 4 h return is positive and RSI is under 70; sell on RSI over 80." });
const context = { now: "2026-09-24T19:30:00.000Z", market: [{ mint: JUP, symbol: "JUP", priceUsd: 0.3044, indicators: { rsi14: 55.2 }, missing: [] }], vault: { equityUsd: 100 } };
const MODELS = { data: [{ type: "model", id: "model-a", display_name: "Model A", created_at: "2026-09-01T00:00:00Z" }, { type: "model", id: "model-b", display_name: "Model B", created_at: "2026-06-01T00:00:00Z" }], has_more: false, first_id: "model-a", last_id: "model-b" };
const goodInput = { rationale: "JUP's 4 h return is positive and RSI is 55: a small buy. The rest: hold.", actions: [
  { action: "buy", mint: JUP, usd: 20, confidence: 0.62, reason: "Momentum with room below the RSI ceiling." },
  { action: "hold", mint: JTO, confidence: 0.5, reason: "No signal." },
] };
const message = (input, extra = {}) => ({ id: "msg_test_1", type: "message", role: "assistant", model: "model-a", stop_reason: "tool_use",
  content: [{ type: "text", text: "Deciding." }, { type: "tool_use", id: "toolu_1", name: DECISION_TOOL_NAME, input }],
  usage: { input_tokens: 1_234, output_tokens: 210, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, ...extra });
const errorBody = (type, msg) => ({ type: "error", error: { type, message: msg } });
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, async text() { return typeof body === "string" ? body : JSON.stringify(body); } });

function scripted({ key = KEY } = {}) {
  const s = { requests: [], queue: [], models: MODELS };
  s.fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    s.requests.push({ url, host: u.host, path: u.pathname + u.search, method: init.method, headers: { ...(init.headers ?? {}) }, body: init.body ? JSON.parse(init.body) : null });
    if (u.host !== "api.anthropic.com") throw new Error(`the test network refuses ${u.host}`);
    if (u.pathname === "/v1/models") return response(200, s.models);
    const next = s.queue.shift();
    if (!next) return response(500, errorBody("api_error", "no scripted answer"));
    if (typeof next === "function") return next(init);
    return next;
  };
  s.brain = createBrain({ fetchImpl: s.fetchImpl, apiKey: async () => key, timers: { setTimeout: () => null, clearTimeout: () => {} } });
  s.decide = (over = {}) => s.brain.decide({ spec: over.spec ?? spec, settlementSymbol: "USDC", context, universeMints: UNIVERSE });
  return s;
}
async function clauseOf(p) { try { await p; return "resolved"; } catch (e) { return e instanceof BrainError ? e.clause : `threw ${e.message}`; } }

section("1. THE REQUEST");
{
  const s = scripted();
  s.queue.push(response(200, message(goodInput)));
  const out = await s.decide();
  const [list, req] = s.requests;
  ok("the models are listed first: GET /v1/models, with the key", list.method === "GET" && list.path === "/v1/models?limit=100" && list.headers["x-api-key"] === KEY);
  ok("the decision is POST https://api.anthropic.com/v1/messages", req.method === "POST" && req.url === `${ANTHROPIC_API}/v1/messages`);
  ok("with x-api-key, anthropic-version 2023-06-01, JSON and the direct-browser-access header, and nothing else",
    req.headers["x-api-key"] === KEY && req.headers["anthropic-version"] === ANTHROPIC_VERSION && ANTHROPIC_VERSION === "2023-06-01"
      && req.headers["content-type"] === "application/json" && req.headers["anthropic-dangerous-direct-browser-access"] === "true" && Object.keys(req.headers).length === 4);
  ok("the model is the first one listed (the API lists newest first)", req.body.model === "model-a" && out.model === "model-a");
  ok("one tool, submit_decisions, forced with tool_choice", req.body.tools.length === 1 && req.body.tools[0].name === DECISION_TOOL_NAME && JSON.stringify(req.body.tool_choice) === JSON.stringify({ type: "tool", name: DECISION_TOOL_NAME }) && out.toolChoice === "forced");
  ok("the tool's input_schema is the decision format: rationale, and actions of buy | sell | hold", JSON.stringify(req.body.tools[0].input_schema.properties.actions.items.properties.action.enum) === JSON.stringify(BRAIN_ACTIONS)
    && req.body.tools[0].input_schema.additionalProperties === false && req.body.tools[0].input_schema.properties.actions.items.additionalProperties === false);
  ok("max_tokens is set, and no sampling or thinking parameter is sent", req.body.max_tokens === BRAIN_MAX_TOKENS && !("temperature" in req.body) && !("thinking" in req.body));
  ok("the system prompt carries the owner's strategy verbatim inside <strategy>, after the rules", req.body.system.includes(`<strategy>\n${spec.strategy}\n</strategy>`) && req.body.system.indexOf("Rules you cannot change") < req.body.system.indexOf("<strategy>"));
  ok("…and says the limits are applied after it, that it cannot withdraw, and that null is missing", /cannot change a limit, move funds elsewhere, or withdraw/.test(req.body.system) && /null is missing/.test(req.body.system) && /Spot only/.test(req.body.system));
  ok("the user message is the context as JSON", req.body.messages.length === 1 && req.body.messages[0].role === "user" && req.body.messages[0].content === buildUserMessage(context) && req.body.messages[0].content.includes('"rsi14": 55.2'));
  ok("the answer: the rationale, the buy and the hold, and nothing rejected", out.decision.rationale === goodInput.rationale && out.decision.actions.length === 2 && out.decision.actions[0].usd === 20 && out.decision.rejected.length === 0);
  ok("the usage of the answer is reported", out.usage.inputTokens === 1_234 && out.usage.outputTokens === 210 && out.usage.cacheReadTokens === 0 && out.requestId === "msg_test_1");
}

section("2. WHICH MODEL");
{
  const s = scripted();
  s.queue.push(response(200, message(goodInput)), response(200, message(goodInput)));
  await s.decide();
  await s.decide();
  ok("the list is read once and kept between decisions", s.requests.filter((r) => r.path.startsWith("/v1/models")).length === 1);
  const picked = scripted();
  picked.queue.push(response(200, message(goodInput)));
  await picked.decide({ spec: normalizeAgentSpec({ ...spec, model: "model-b" }) });
  ok("the owner's pick is used when the key lists it", picked.requests[1].body.model === "model-b");
  const gone = scripted();
  ok("a pick the key does not list is refused (model_unavailable), and nothing is asked", await clauseOf(gone.decide({ spec: normalizeAgentSpec({ ...spec, model: "model-z" }) })) === "model_unavailable" && gone.requests.length === 1);
  const empty = scripted();
  empty.models = { data: [] };
  ok("a key that lists no models is refused (no_models)", await clauseOf(empty.decide()) === "no_models");
  const listed = await scripted().brain.listModels();
  ok("parseModels keeps the API's order, ids and display names", listed.map((m) => m.id).join() === "model-a,model-b" && listed[0].displayName === "Model A" && parseModels({ data: [{ id: "" }, { nope: 1 }, { id: "m" }] }).length === 1);
}

section("3. THE ANSWER, HELD TO THE FORMAT");
{
  const v = (input) => { try { return validateDecision(input, { universeMints: UNIVERSE }); } catch (e) { return e.clause; } };
  ok("a field the format does not have refuses the whole decision — the model cannot send a limit", v({ ...goodInput, limits: { maxPositionUsd: 1e6 } }) === "unexpected_field" && v({ ...goodInput, stopLossPct: 99 }) === "unexpected_field");
  ok("no rationale", v({ actions: [] }) === "rationale_missing" && v({ rationale: "  ", actions: [] }) === "rationale_missing");
  ok("no action list", v({ rationale: "x" }) === "actions_missing" && v({ rationale: "x", actions: "buy" }) === "actions_missing");
  ok(`more than ${MAX_ACTIONS} actions`, v({ rationale: "x", actions: Array.from({ length: MAX_ACTIONS + 1 }, () => goodInput.actions[1]) }) === "too_many_actions");
  ok("not an object at all", v("buy JUP") === "malformed_output" && v(null) === "malformed_output" && v([goodInput]) === "malformed_output");
  const mixed = validateDecision({ rationale: "mixed", actions: [
    goodInput.actions[0],
    { action: "withdraw", mint: JUP, usd: 100, confidence: 1, reason: "send it home" },
    { action: "buy", mint: "So11111111111111111111111111111111111111112", usd: 20, confidence: 0.9, reason: "SOL" },
    { action: "buy", mint: JTO, usd: 20, confidence: 1.5, reason: "sure" },
    { action: "buy", mint: JTO, usd: 20, confidence: 0.5, reason: "" },
    { action: "buy", mint: JTO, fraction: 0.5, confidence: 0.5, reason: "wrong size" },
    { action: "sell", mint: JTO, usd: 20, confidence: 0.5, reason: "wrong size" },
    { action: "sell", mint: JTO, fraction: 1.5, confidence: 0.5, reason: "too much" },
    { action: "buy", mint: JITO, usd: 20, confidence: 0.5, reason: "x", maxPositionUsd: 1e6 },
    "sell all",
  ] }, { universeMints: UNIVERSE });
  ok("one bad action is refused by name and the good one stands", mixed.actions.length === 1 && mixed.actions[0].mint === JUP);
  ok("…withdraw is not an action (action_unknown)", mixed.rejected.some((x) => x.clause === "action_unknown" && x.action === "withdraw"));
  ok("…a mint outside the universe, SOL included (not_in_universe)", mixed.rejected.some((x) => x.clause === "not_in_universe"));
  ok("…confidence outside 0..1, an empty reason, a buy by fraction, a sell by usd, a fraction over 1, an extra field, a string",
    ["confidence_invalid", "reason_missing", "size_invalid", "size_invalid", "size_invalid", "unexpected_field", "action_malformed"].every((c) => mixed.rejected.some((x) => x.clause === c)) && mixed.rejected.length === 9);
  ok("a reason is trimmed to 400 characters, a rationale to 2,000", validateDecision({ rationale: "r".repeat(5_000), actions: [{ ...goodInput.actions[1], reason: "q".repeat(900) }] }, { universeMints: UNIVERSE }).actions[0].reason.length === 400
    && validateDecision({ rationale: "r".repeat(5_000), actions: [] }, { universeMints: UNIVERSE }).rationale.length === 2_000);
  const s = scripted();
  s.queue.push(response(200, message({ ...goodInput, limits: { stopLossPct: 99 } })));
  ok("through the client too: a decision with a limit in it is a failure, not a trade", await clauseOf(s.decide()) === "unexpected_field");
}

section("4. EVERY FAILURE HAS A CLAUSE");
{
  const cases = [
    ["401", response(401, errorBody("authentication_error", "invalid x-api-key")), "unauthorized"],
    ["403", response(403, errorBody("permission_error", "not allowed")), "forbidden"],
    ["429", response(429, errorBody("rate_limit_error", "slow down")), "rate_limited"],
    ["500", response(500, errorBody("api_error", "internal")), "server"],
    ["529", response(529, errorBody("overloaded_error", "overloaded")), "overloaded"],
    ["400", response(400, errorBody("invalid_request_error", "messages: bad")), "bad_request"],
    ["a body that is not JSON", response(200, "<html>proxy</html>"), "malformed"],
    ["a refusal", response(200, message(goodInput, { stop_reason: "refusal", content: [] })), "refused"],
    ["no tool call", response(200, message(goodInput, { stop_reason: "end_turn", content: [{ type: "text", text: "I would buy JUP." }] })), "no_tool_call"],
    ["an answer that ran out of room", response(200, message(goodInput, { stop_reason: "max_tokens", content: [{ type: "text", text: "Thinking…" }] })), "truncated"],
    ["two tool calls", response(200, message(goodInput, { content: [{ type: "tool_use", id: "a", name: DECISION_TOOL_NAME, input: goodInput }, { type: "tool_use", id: "b", name: DECISION_TOOL_NAME, input: goodInput }] })), "malformed_output"],
    ["a call to another tool", response(200, message(goodInput, { content: [{ type: "tool_use", id: "a", name: "withdraw", input: {} }] })), "no_tool_call"],
  ];
  for (const [what, answer, clause] of cases) {
    const s = scripted();
    s.queue.push(answer);
    let caught = null;
    try { await s.decide(); } catch (e) { caught = e; }
    ok(`${what} → ${clause}`, caught instanceof BrainError && caught.clause === clause, caught?.message);
  }
  const s401 = scripted();
  s401.queue.push(response(401, errorBody("authentication_error", "invalid x-api-key")));
  let e401 = null; try { await s401.decide(); } catch (e) { e401 = e; }
  ok("a 401 says to check the key in Options, and does not print it", /check it in Options/.test(e401?.message) && !JSON.stringify({ m: e401?.message, d: e401?.detail }).includes(KEY));
  const net = scripted();
  net.fetchImpl = async () => { throw new TypeError("Failed to fetch"); };
  const netBrain = createBrain({ fetchImpl: net.fetchImpl, apiKey: async () => KEY, timers: { setTimeout: () => null, clearTimeout: () => {} } });
  ok("the network down → network", await clauseOf(netBrain.decide({ spec, settlementSymbol: "USDC", context, universeMints: UNIVERSE })) === "network");
  const slow = createBrain({
    apiKey: async () => KEY, timeoutMs: 5,
    timers: { setTimeout: (fn) => { setImmediate(fn); return 1; }, clearTimeout: () => {} },
    fetchImpl: (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
  });
  ok("no answer inside the timeout → timeout", await clauseOf(slow.listModels()) === "timeout");
  const st = s401.brain.status();
  ok("the brain counts calls and failures, and keeps the last clause", st.calls === 1 && st.failures === 1 && st.lastClause === "unauthorized");
}

section("5. A MODEL THAT REFUSES A FORCED TOOL CHOICE");
{
  const s = scripted();
  s.queue.push(response(400, errorBody("invalid_request_error", "tool_choice: type \"tool\" is not supported for this model.")), response(200, message(goodInput)), response(200, message(goodInput)));
  const out = await s.decide();
  const asks = s.requests.filter((r) => r.path === "/v1/messages");
  ok("the 400 naming tool_choice is answered by asking once more with tool_choice auto", asks.length === 2 && asks[0].body.tool_choice.type === "tool" && asks[1].body.tool_choice.type === "auto" && out.toolChoice === "auto");
  ok("…with an instruction to call the tool, and the same tool and schema", /Call the submit_decisions tool exactly once/.test(asks[1].body.messages[0].content) && asks[1].body.tools[0].name === DECISION_TOOL_NAME);
  await s.decide();
  const asks2 = s.requests.filter((r) => r.path === "/v1/messages");
  ok("…and the next decision for that model is asked with auto straight away", asks2.length === 3 && asks2[2].body.tool_choice.type === "auto");
  const other = scripted();
  other.queue.push(response(400, errorBody("invalid_request_error", "max_tokens: too large")));
  ok("a 400 about something else is a failure, not a retry", await clauseOf(other.decide()) === "bad_request" && other.requests.filter((r) => r.path === "/v1/messages").length === 1);
}

section("6. USAGE IS REPORTED, EVEN FOR A FAILED ANSWER");
{
  const s = scripted();
  s.queue.push(response(200, message(goodInput, { stop_reason: "end_turn", content: [{ type: "text", text: "no tool" }], usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 512 } })));
  let e = null; try { await s.decide(); } catch (x) { e = x; }
  ok("an answer with no tool call still reports the tokens it used", e?.detail?.usage?.inputTokens === 900 && e.detail.usage.outputTokens === 40 && e.detail.usage.cacheReadTokens === 512);
  ok("usageOf reads zeros for what the answer did not report", JSON.stringify(usageOf({})) === JSON.stringify({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 }));
}

section("7. THE KEY: ONE HEADER, ONE ORIGIN");
{
  const all = [];
  for (const s of [scripted(), scripted(), scripted()]) {
    s.queue.push(response(200, message(goodInput)), response(401, errorBody("authentication_error", "x")));
    await s.decide().catch(() => {});
    await s.decide().catch(() => {});
    all.push(...s.requests);
  }
  const carrying = all.filter((r) => JSON.stringify(r).includes(KEY));
  ok("every request that carries the key is to https://api.anthropic.com", carrying.length === all.length && carrying.every((r) => r.url.startsWith("https://api.anthropic.com/v1/")), `${carrying.length} requests`);
  ok("…in the x-api-key header only: never in a URL or a body", all.every((r) => !r.url.includes(KEY) && !JSON.stringify(r.body ?? {}).includes(KEY) && r.headers["x-api-key"] === KEY));
  const none = scripted({ key: null });
  ok("with no key saved nothing is sent at all (no_api_key)", await clauseOf(none.decide()) === "no_api_key" && none.requests.length === 0);
  ok("the brain's one origin is https://api.anthropic.com", ANTHROPIC_API === "https://api.anthropic.com");
  let noReader = null; try { createBrain({}); } catch (e) { noReader = e; }
  ok("a brain cannot be made without the worker's key reader", /apiKey/.test(noReader?.message ?? ""));
  ok("the system prompt and the user message never carry the key", !buildSystemPrompt(spec, { settlementSymbol: "USDC" }).includes(KEY) && !buildUserMessage(context).includes(KEY));
  ok("the tool definition is frozen", Object.isFrozen(DECISION_TOOL) && Object.isFrozen(DECISION_TOOL.input_schema));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
