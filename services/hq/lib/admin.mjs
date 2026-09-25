/**
 * THE OWNER'S COMMANDS, AND THE ONLY TWO DOORS TO THEM.
 *
 *   · the CLI (services/hq/cli.mjs), run on the server itself (`railway ssh`, then
 *     `node services/hq/cli.mjs …`): whoever has a shell there is the owner;
 *   · POST /v1/admin, a SIGNED request: { command, nonce, issuedAt, signature }, where the
 *     signature is HQ_OWNER_WALLET's ed25519 signature over adminMessage({ command, nonce,
 *     issuedAt, server }), server being this HQ's id (HQ_SERVER_ID). issuedAt must be within HQ_ADMIN_MAX_SKEW_SECONDS of the server's clock and
 *     the nonce never seen before (it is kept past that window). Without HQ_OWNER_WALLET the
 *     endpoint refuses everything. No other endpoint changes anything but a perks nonce.
 *
 * THE COMMANDS: agent.create, agent.set (name, skin, strategy, limits, settings, mode — live needs
 * `confirmWallet` equal to the agent's wallet, typed), agent.pause, agent.resume, agent.retire,
 * agent.withdraw (to the treasury, only there), agent.liquidate, kill (on / off), coin.register.
 * Nobody from the public can create an agent: there is no unsigned path to this file.
 */
import { randomUUID } from "node:crypto";
import { STRATEGIES, STRATEGY_IDS, strategyOf, normalizeSettingsFor } from "../strategies/index.mjs";
import { normalizeLimits, LimitError } from "./risk.mjs";
import { skinsUnlocked } from "./ranks.mjs";
import { verifyEd25519, isAddress } from "./perks.mjs";
import { parseSol, solString } from "./amounts.mjs";
import { displaySafe } from "../../../bots/lib/content-rules.mjs";
import { describeMint } from "../../../vendor/executor/token2022.mjs";
import { decodeBondingCurve, bondingCurveAddress } from "../../../vendor/executor/snipe-venue-pumpfun.mjs";
import { PUMPFUN_PROGRAM } from "../../../bots/lib/verified.mjs";
import { CIA_MINT } from "./config.mjs";

export class AdminError extends Error {
  constructor(clause, message, status = 400) { super(message); this.name = "AdminError"; this.clause = clause; this.status = status; }
}
/** The sprites in brand/sprites/, which an agent's `cat` names. */
export const SPRITES = Object.freeze(["cashcat", "coinmarketcat", "crying-cat", "director", "grumpy-cat", "popcat", "snipurr"]);
export const COMMANDS = Object.freeze(["agent.create", "agent.set", "agent.pause", "agent.resume", "agent.retire", "agent.withdraw", "agent.liquidate", "kill", "coin.register"]);

/** Keys sorted at every level, so the signed text is one string whatever the JSON order. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
/** The signed text names the server it is for (HQ_SERVER_ID), so a command signed for one HQ is
 *  refused by any other that shares the owner's wallet. */
export const adminMessage = ({ command, nonce, issuedAt, server }) => `cia-hq admin\n${canonical({ command, issuedAt, nonce, server })}`;

/** Check a signed admin request; returns the command. Spends the nonce. */
export function verifyAdminRequest({ body, config, db, clock = () => Date.now() }) {
  if (!config.owner) throw new AdminError("admin_disabled", "no HQ_OWNER_WALLET is set: remote admin is off (use the CLI on the server)", 403);
  const { command, nonce, issuedAt, signature } = body ?? {};
  if (!command || typeof command !== "object" || Array.isArray(command)) throw new AdminError("bad_request", "command must be an object");
  if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) throw new AdminError("bad_request", "nonce must be 16 to 64 letters, digits, - or _");
  const at = Date.parse(issuedAt);
  if (!Number.isFinite(at) || Math.abs(clock() - at) > config.adminSkewMs) throw new AdminError("stale", "issuedAt is missing or too far from the server's clock", 401);
  if (!verifyEd25519({ address: config.owner, message: adminMessage({ command, nonce, issuedAt, server: config.serverId }), signature })) throw new AdminError("bad_signature", `not signed by the owner's wallet for this server (${config.serverId})`, 401);
  if (db.getNonce(`admin:${nonce}`)) throw new AdminError("replayed", "that nonce was already used", 401);
  db.createNonce({ nonce: `admin:${nonce}`, purpose: "admin", wallet: config.owner, expiresAt: clock() + 2 * config.adminSkewMs + 86_400_000 });
  db.useNonce(`admin:${nonce}`, clock());
  return command;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9 .'-]{0,31}$/;
function checkName(name) {
  const n = String(name ?? "").trim();
  if (!NAME.test(n)) throw new AdminError("bad_name", "a name is 1 to 32 letters, digits, spaces, . ' or -, starting with a letter or digit");
  const safe = displaySafe({ name: n, symbol: "CAT" });
  if (!safe.ok) throw new AdminError("bad_name", `the content rules refuse that name (${safe.violations.map((v) => v.rule).join(", ")})`);
  return n;
}
const agentOr404 = (db, id) => { const a = db.getAgent(Number(id)); if (!a) throw new AdminError("no_agent", `no agent ${id}`, 404); return a; };
const wrap = (fn) => { try { return fn(); } catch (e) { if (e instanceof LimitError) throw new AdminError("bad_limits", e.message); if (e instanceof AdminError) throw e; throw new AdminError("bad_request", e.message); } };

/** A coin's facts from the chain, for registering it. */
async function coinFacts(rpc, mint) {
  if (!rpc) return { mint };
  const read = await rpc.getMultipleAccounts([mint, bondingCurveAddress(mint)], { commitment: "confirmed" });
  const [m, c] = read.accounts ?? [];
  if (!m) throw new AdminError("no_mint", `no mint account lives at ${mint}`);
  const d = describeMint(m, mint);
  let creator = null;
  if (c && c.owner === PUMPFUN_PROGRAM) { try { creator = decodeBondingCurve(c, { mint }).creator ?? null; } catch { creator = null; } }
  return { mint, symbol: d.metadataSymbol ?? null, name: d.metadataName ?? null, decimals: d.decimals, program: d.program, creator };
}

/**
 * Run one command. `deps`: { db, config, runtime, rpc, agentAddress, withdraw, clock }.
 * Returns a plain result; every command is logged with its source.
 */
export async function executeAdminCommand(command, { source, deps }) {
  const { db, config } = deps;
  const op = command?.op;
  if (!COMMANDS.includes(op)) throw new AdminError("unknown_command", `unknown command ${JSON.stringify(op)}: ${COMMANDS.join(", ")}`);
  let result;
  switch (op) {
    case "agent.create": {
      const strategy = String(command.strategy ?? "");
      if (!STRATEGY_IDS.includes(strategy)) throw new AdminError("bad_strategy", `strategy is one of ${STRATEGY_IDS.join(", ")}`);
      const id = command.number === undefined ? db.nextAgentId() : Number(command.number);
      if (!(Number.isInteger(id) && id >= 1 && id <= 999)) throw new AdminError("bad_number", "an agent number is 1 to 999");
      if (db.getAgent(id)) throw new AdminError("taken", `agent ${id} exists`);
      const name = checkName(command.name);
      const cat = command.cat ?? STRATEGIES[strategy].sprite;
      if (!SPRITES.includes(cat)) throw new AdminError("bad_cat", `cat is one of ${SPRITES.join(", ")}`);
      const mod = strategyOf(strategy);
      const limits = wrap(() => normalizeLimits(command.limits ?? {}, mod.defaults.limits));
      const settings = wrap(() => normalizeSettingsFor(strategy, command.settings ?? {}, limits));
      let wallet;
      try { wallet = deps.agentAddress(id); } catch (e) { throw new AdminError("no_wallet", `the agent's wallet cannot be derived: ${e.message}`); }
      const bankroll = command.paperBankrollSol === undefined ? config.paperBankroll : wrap(() => parseSol(String(command.paperBankrollSol)));
      if (bankroll < parseSol("0.01") || bankroll > parseSol("100")) throw new AdminError("bad_bankroll", "paperBankrollSol is 0.01 to 100");
      let coinMint = null;
      if (command.coin) coinMint = (await registerCoin({ deps, mint: command.coin, source: "agent" })).mint;
      db.tx(() => {
        db.createAgent({ id, name, cat, skin: "standard", strategy, mode: "paper", status: "active", wallet, coinMint, limits, settings, paperBankroll: bankroll });
        db.addPaperTransfer({ id: `bankroll:${id}:${randomUUID()}`, agentId: id, kind: "deposit", lamports: bankroll });
      });
      result = { created: id, wallet, mode: "paper", paperBankrollSol: solString(bankroll), derivation: `m/44'/501'/${id}'/0'` };
      break;
    }
    case "agent.set": {
      const agent = agentOr404(db, command.id);
      const patch = {};
      if (command.name !== undefined) patch.name = checkName(command.name);
      const strategy = command.strategy ?? agent.strategy;
      if (!STRATEGY_IDS.includes(strategy)) throw new AdminError("bad_strategy", `strategy is one of ${STRATEGY_IDS.join(", ")}`);
      if (command.strategy !== undefined) patch.strategy = strategy;
      const mod = strategyOf(strategy);
      if (command.limits !== undefined || command.strategy !== undefined) patch.limits = wrap(() => normalizeLimits({ ...(command.strategy !== undefined ? {} : agent.limits), ...(command.limits ?? {}) }, mod.defaults.limits));
      if (command.settings !== undefined || command.strategy !== undefined || patch.limits) patch.settings = wrap(() => normalizeSettingsFor(strategy, { ...(command.strategy !== undefined ? {} : agent.settings), ...(command.settings ?? {}) }, patch.limits ?? agent.limits));
      if (command.skin !== undefined) {
        const unlocked = skinsUnlocked(db.getRank(agent.id, agent.mode) ?? "recruit");
        if (!unlocked.includes(command.skin)) throw new AdminError("skin_locked", `skin ${command.skin} is not unlocked: ${unlocked.join(", ")} are`);
        patch.skin = command.skin;
      }
      if (command.cat !== undefined) { if (!SPRITES.includes(command.cat)) throw new AdminError("bad_cat", `cat is one of ${SPRITES.join(", ")}`); patch.cat = command.cat; }
      if (command.mode !== undefined) {
        if (!["paper", "live"].includes(command.mode)) throw new AdminError("bad_mode", "mode is paper or live");
        if (command.mode === "live" && agent.mode !== "live" && command.confirmWallet !== agent.wallet)
          throw new AdminError("confirm", `to trade real SOL, confirmWallet must be this agent's wallet, typed: ${agent.wallet}`);
        /* Back to paper leaves real tokens with no stop watching them: refused while the wallet holds any. */
        if (command.mode === "paper" && agent.mode === "live") {
          if (typeof deps.runtime?.walletLedger !== "function") throw new AdminError("holds_unknown", "the wallet's holdings cannot be read here, so it stays live: liquidate it first where they can be", 503);
          const held = deps.runtime.walletLedger(agent)?.positions ?? [];
          if (held.length) throw new AdminError("holds_positions", `agent ${agent.id}'s wallet still holds ${held.length} coin(s) bought live: liquidate it first (agent.liquidate), then switch it to paper`, 409);
        }
        patch.mode = command.mode;
      }
      db.updateAgent(agent.id, patch);
      result = { updated: agent.id, fields: Object.keys(patch) };
      break;
    }
    case "agent.pause": case "agent.resume": case "agent.retire": {
      const agent = agentOr404(db, command.id);
      if (agent.status === "retired") throw new AdminError("retired", "a retired agent stays retired");
      const status = op === "agent.pause" ? "paused" : op === "agent.resume" ? "active" : "retired";
      db.updateAgent(agent.id, { status });
      result = { updated: agent.id, status };
      break;
    }
    case "agent.withdraw": {
      const agent = agentOr404(db, command.id);
      const lamports = command.sol === "all" || command.sol === undefined ? null : wrap(() => parseSol(String(command.sol)));
      const r = await deps.withdraw({ agent, lamports });
      result = { withdrew: agent.id, to: config.treasury, signature: r.signature };
      break;
    }
    case "agent.liquidate": {
      const agent = agentOr404(db, command.id);
      const view = await deps.runtime.refresh(agent);
      const sold = [];
      for (const p of view.ledger.positions) sold.push({ mint: p.mint, ...(await deps.runtime.sell(agent, p.mint, { trigger: "manual", reason: "the owner liquidated the agent" })) });
      result = { liquidated: agent.id, sold: sold.map((s) => ({ mint: s.mint, ok: s.ok, clause: s.clause ?? null })) };
      break;
    }
    case "kill": {
      if (typeof command.on !== "boolean") throw new AdminError("bad_request", "kill needs on: true or false");
      db.setKv("kill", command.on);
      result = { kill: command.on, env: config.kill ? "HQ_KILL=1 is also set in the environment and wins while it is" : null };
      break;
    }
    case "coin.register": {
      const c = await registerCoin({ deps, mint: command.mint, source: "owner" });
      if (command.agentId !== undefined) { const agent = agentOr404(db, command.agentId); db.updateAgent(agent.id, { coinMint: c.mint }); }
      result = { registered: c.mint, symbol: c.symbol ?? null, creator: c.creator ?? null, agentId: command.agentId ?? null };
      break;
    }
    default: throw new AdminError("unknown_command", "unknown command");
  }
  db.logAdmin({ source, command, result: JSON.stringify(result) });
  return result;
}

async function registerCoin({ deps, mint, source }) {
  if (!isAddress(mint)) throw new AdminError("bad_mint", "mint must be a Solana address");
  if (mint === CIA_MINT) throw new AdminError("bad_mint", "$CIA is the agency's own coin already; it is never an agent's to trade");
  const facts = await coinFacts(deps.rpc, mint);
  deps.db.upsertCoin({ ...facts, source });
  if (facts.symbol || facts.decimals !== undefined) deps.db.upsertToken({ mint, symbol: facts.symbol ?? null, name: facts.name ?? null, decimals: facts.decimals ?? null, program: facts.program ?? null });
  return facts;
}
