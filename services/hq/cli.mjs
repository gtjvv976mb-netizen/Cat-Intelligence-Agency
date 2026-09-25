#!/usr/bin/env node
/**
 * THE OWNER'S CLI, RUN ON THE SERVER (`railway ssh`, then `node services/hq/cli.mjs …`).
 * It opens the same SQLite file the server uses and runs the same commands the signed admin
 * endpoint runs (lib/admin.mjs). Agents are created here, by the owner, never by the public.
 *
 *   node services/hq/cli.mjs agent create --name "Agent Whiskers" --strategy snipurr [--cat snipurr]
 *        [--number 1] [--limits '{"maxPerTradeSol":"0.01"}'] [--settings '{…}'] [--paper-sol 1] [--coin <mint>]
 *   node services/hq/cli.mjs agent list
 *   node services/hq/cli.mjs agent show <id>
 *   node services/hq/cli.mjs agent mode <id> paper|live [--confirm <the agent's wallet>]
 *   node services/hq/cli.mjs agent strategy <id> <strategy> [--settings '{…}']
 *   node services/hq/cli.mjs agent limits <id> '{"stopLossPct":10}'
 *   node services/hq/cli.mjs agent settings <id> '{"strategy":"…"}'
 *   node services/hq/cli.mjs agent name <id> "<name>"   |   agent skin <id> <skin>
 *   node services/hq/cli.mjs agent pause|resume|retire|liquidate <id>
 *   node services/hq/cli.mjs agent withdraw <id> <sol|all>        (to HQ_TREASURY_ADDRESS, only there)
 *   node services/hq/cli.mjs kill on|off
 *   node services/hq/cli.mjs coin register <mint> [--agent <id>]
 *   node services/hq/cli.mjs coins   |   status
 */
import { pathToFileURL } from "node:url";
import { buildHq } from "./server.mjs";
import { executeAdminCommand, AdminError } from "./lib/admin.mjs";
import { agentDetail } from "./lib/views.mjs";
import { walletReadiness } from "./wallet.mjs";
import { describeSwitches } from "./lib/config.mjs";

export function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : true; flags[k] = v; }
    else pos.push(a);
  }
  return { pos, flags };
}
const json = (text, what) => { try { return JSON.parse(text); } catch { throw new AdminError("bad_json", `${what} must be JSON, e.g. '{"stopLossPct":10}'`); } };

/** The admin command a CLI line means, or null for the read-only lines. Pure. */
export function commandFor({ pos, flags }) {
  const [area, verb, id, arg] = pos;
  if (area === "kill") return { op: "kill", on: verb === "on" ? true : verb === "off" ? false : (() => { throw new AdminError("bad_request", "kill on | kill off"); })() };
  if (area === "coin" && verb === "register") return { op: "coin.register", mint: id, ...(flags.agent !== undefined ? { agentId: Number(flags.agent) } : {}) };
  if (area !== "agent") return null;
  switch (verb) {
    case "create": return { op: "agent.create", name: flags.name, strategy: flags.strategy, ...(flags.cat ? { cat: flags.cat } : {}), ...(flags.number ? { number: Number(flags.number) } : {}),
      ...(flags.limits ? { limits: json(flags.limits, "--limits") } : {}), ...(flags.settings ? { settings: json(flags.settings, "--settings") } : {}),
      ...(flags["paper-sol"] ? { paperBankrollSol: String(flags["paper-sol"]) } : {}), ...(flags.coin ? { coin: flags.coin } : {}) };
    case "mode": return { op: "agent.set", id: Number(id), mode: arg, ...(flags.confirm ? { confirmWallet: flags.confirm } : {}) };
    case "strategy": return { op: "agent.set", id: Number(id), strategy: arg, ...(flags.settings ? { settings: json(flags.settings, "--settings") } : {}) };
    case "limits": return { op: "agent.set", id: Number(id), limits: json(arg, "the limits") };
    case "settings": return { op: "agent.set", id: Number(id), settings: json(arg, "the settings") };
    case "name": return { op: "agent.set", id: Number(id), name: arg };
    case "skin": return { op: "agent.set", id: Number(id), skin: arg };
    case "cat": return { op: "agent.set", id: Number(id), cat: arg };
    case "pause": case "resume": case "retire": case "liquidate": return { op: `agent.${verb}`, id: Number(id) };
    case "withdraw": return { op: "agent.withdraw", id: Number(id), sol: arg ?? "all" };
    default: return null;
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.pos.length || args.flags.help) { console.log("usage: see the top of services/hq/cli.mjs, or docs/hq/DEPLOY.md"); return 0; }
  const hq = await buildHq({ log: () => {} });
  const { db, runtime, adminDeps, config } = hq;
  try {
    const [area, verb, id] = args.pos;
    if (area === "status") {
      const ready = walletReadiness(process.env);
      console.log(JSON.stringify({ switches: { ...describeSwitches(config, ready), kill: config.kill || db.getKv("kill") === true }, killBy: { variable: config.kill, console: db.getKv("kill") === true },
        wallets: ready, agents: db.listAgents().length, openIntents: db.openIntents().length }, null, 2));
      return 0;
    }
    if (area === "coins") { console.log(JSON.stringify(db.listCoins(), null, 2)); return 0; }
    if (area === "agent" && verb === "list") {
      for (const a of db.listAgents()) console.log(`${String(a.id).padStart(3, "0")}  ${a.name.padEnd(24)} ${a.strategy.padEnd(16)} ${a.mode.padEnd(6)} ${a.status.padEnd(8)} ${a.wallet}`);
      return 0;
    }
    if (area === "agent" && verb === "show") {
      const agent = db.getAgent(Number(id));
      if (!agent) { console.error(`no agent ${id}`); return 1; }
      const view = await runtime.refresh(agent);
      const d = agentDetail({ agent, view, db, symbolOf: (m) => db.getToken(m)?.symbol ?? null });
      console.log(JSON.stringify({ ...d, settings: agent.settings, decisions: d.decisions.slice(0, 10), trades: d.trades.slice(0, 10), equity: d.equity.slice(-5) }, null, 2));
      return 0;
    }
    const command = commandFor(args);
    if (!command) { console.error(`unknown command: ${args.pos.join(" ")}`); return 1; }
    const result = await executeAdminCommand(command, { source: "cli", deps: adminDeps });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (e) {
    console.error(e instanceof AdminError ? `refused (${e.clause}): ${e.message}` : `failed: ${e?.message ?? e}`);
    return 1;
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((code) => process.exit(code));
