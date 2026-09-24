/**
 * THE MODEL, THROUGH THE OWNER'S OWN ANTHROPIC KEY, CHOSEN AT RUN TIME.
 *
 * No model identifier is written anywhere in this repository. GET /v1/models with the key
 * lists the models it may use; the bot takes the one the owner named in CASHCAT_MODEL or
 * POPCAT_MODEL (a repository variable) when it is listed, and otherwise the first listed.
 * A named model that is not listed is an error, never a silent substitute.
 *
 * The key travels in one header (x-api-key) to one origin (https://api.anthropic.com) and
 * nowhere else; it is never logged, returned or put in an error. Every answer goes through
 * one forced tool, and the caller validates the tool input field by field.
 */
import { HttpError } from "./http.mjs";

export const ANTHROPIC_API = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2023-06-01";

export class ModelError extends Error {
  constructor(clause, message, detail = {}) { super(message); this.name = "ModelError"; this.clause = clause; this.detail = detail; }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** GET /v1/models → ids, in the order the API listed them. */
export function parseModelList(body) {
  const list = Array.isArray(body?.data) ? body.data : [];
  return list.filter((m) => isObject(m) && typeof m.id === "string" && m.id.length > 0 && m.id.length <= 120).map((m) => m.id);
}

export function createModel({ http, apiKey, preferred = "", log = null, maxTokens = 2_000 } = {}) {
  const hasKey = typeof apiKey === "string" && apiKey.length > 0;
  let chosen = null;
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };

  async function call(path, { method = "GET", body = null } = {}) {
    if (!hasKey) throw new ModelError("no_api_key", "ANTHROPIC_API_KEY is not set");
    const url = `${ANTHROPIC_API}${path}`;
    if (!url.startsWith(`${ANTHROPIC_API}/v1/`)) throw new ModelError("bad_request", "requests go to the Anthropic API only");
    let r;
    try {
      r = await http.request(url, {
        method, timeoutMs: 120_000, retries: 1,
        headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json", accept: "application/json" },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new ModelError(error instanceof HttpError ? error.clause : "network", "the Anthropic API could not be reached or kept failing");
    }
    let parsed = null;
    try { parsed = JSON.parse(r.body.toString("utf8")); } catch { parsed = null; }
    if (!r.ok) {
      const type = typeof parsed?.error?.type === "string" ? parsed.error.type : null;
      const message = typeof parsed?.error?.message === "string" ? parsed.error.message.slice(0, 300) : `HTTP ${r.status}`;
      const clause = r.status === 401 ? "unauthorized" : r.status === 403 ? "forbidden" : r.status === 400 ? "bad_request" : "http";
      throw new ModelError(clause, clause === "unauthorized" ? "the API key was refused (401)" : `the Anthropic API answered ${r.status}${type ? ` ${type}` : ""}: ${message}`, { status: r.status, message });
    }
    if (!isObject(parsed)) throw new ModelError("malformed", "the Anthropic API did not answer with a JSON object");
    return parsed;
  }

  /** The model for this run: the preferred one when listed, else the first listed. */
  async function pickModel() {
    if (chosen) return chosen;
    const ids = parseModelList(await call("/v1/models?limit=100"));
    if (!ids.length) throw new ModelError("no_models", "the API listed no models for this key");
    if (preferred) {
      if (!ids.includes(preferred)) throw new ModelError("model_unavailable", `the model named in the repository variable is not among the ${ids.length} this key lists`);
      chosen = preferred;
    } else chosen = ids[0];
    log?.info(`model: ${chosen} (${preferred ? "named by the owner" : "the first the API listed"})`);
    return chosen;
  }

  /**
   * Ask once, answer through `tool` (forced). Returns the tool input, unvalidated — the
   * caller validates it. A model that refuses a forced tool_choice is asked once more with
   * tool_choice "auto" and an instruction to call the tool.
   */
  async function callTool({ system, user, tool }) {
    const model = await pickModel();
    const ask = (forced) => call("/v1/messages", { method: "POST", body: {
      model, max_tokens: maxTokens, system,
      messages: [{ role: "user", content: forced ? user : `${user}\n\nAnswer by calling the ${tool.name} tool exactly once.` }],
      tools: [tool],
      tool_choice: forced ? { type: "tool", name: tool.name } : { type: "auto" },
    } });
    let body;
    try { body = await ask(true); }
    catch (error) {
      if (!(error instanceof ModelError) || error.clause !== "bad_request" || !/tool_choice/i.test(error.detail?.message ?? "")) throw error;
      body = await ask(false);
    }
    usage.calls++;
    usage.inputTokens += Number(body?.usage?.input_tokens) || 0;
    usage.outputTokens += Number(body?.usage?.output_tokens) || 0;
    if (body.stop_reason === "refusal") throw new ModelError("refused", "the model declined to answer");
    const uses = (Array.isArray(body.content) ? body.content : []).filter((b) => isObject(b) && b.type === "tool_use" && b.name === tool.name);
    if (uses.length !== 1) throw new ModelError(body.stop_reason === "max_tokens" ? "truncated" : "no_tool_call", `the model called ${tool.name} ${uses.length} times`);
    if (!isObject(uses[0].input)) throw new ModelError("malformed", "the tool input is not an object");
    return uses[0].input;
  }

  return Object.freeze({ hasKey, pickModel, callTool, usage });
}
