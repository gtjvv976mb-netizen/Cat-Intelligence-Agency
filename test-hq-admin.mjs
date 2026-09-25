/**
 * THE OWNER'S COMMANDS: SIGNED REQUESTS, THE CLI, AND WHAT EACH COMMAND MAY DO.
 *
 *   · a signed request is HQ_OWNER_WALLET's ed25519 signature over the canonical command, a
 *     fresh nonce, the time and the server it is for (HQ_SERVER_ID); without HQ_OWNER_WALLET
 *     remote admin is off; a bad signature, one for another server, one for a key of small order,
 *     a stale time and a replayed nonce are refused;
 *   · the owner's admin client signs on the owner's machine from a keypair file, and HQ verifies;
 *   · agent.create makes a paper agent with its derived wallet and its paper bankroll; names pass
 *     the content rules; limits are fenced; live needs the agent's wallet typed back; skins
 *     follow the rank; a retired agent stays retired; the kill switch is a stored switch;
 *     withdrawals go to the treasury only; $CIA is never an agent's coin;
 *   · the CLI's lines mean the same commands; keygen refuses to run where its output is logged.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import { harness, ROOT } from "./bots/test/doubles.mjs";
import { canonical, adminMessage, verifyAdminRequest, executeAdminCommand, AdminError, COMMANDS, SPRITES } from "./services/hq/lib/admin.mjs";
import { parseArgs, commandFor } from "./services/hq/cli.mjs";
import { signedRequest, serverIdFor } from "./services/hq/admin-client.mjs";
import { refusal as keygenRefusal } from "./services/hq/keygen.mjs";
import { CIA_MINT } from "./services/hq/lib/config.mjs";
import { memDb, testConfig, testClock, addr } from "./services/hq/test/doubles.mjs";
import { parseSol } from "./services/hq/lib/amounts.mjs";

const { ok, section, done } = harness("test-hq-admin");

function ownerKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { address: bs58.encode(pub), secret64: [...seed, ...pub], sign: (m) => bs58.encode(crypto.sign(null, Buffer.from(m, "utf8"), privateKey)) };
}
const refused = async (fn) => { try { await fn(); return null; } catch (e) { return e instanceof AdminError ? e.clause : `threw ${e.message}`; } };

section("A SIGNED REQUEST");
{
  const owner = ownerKey();
  const clock = testClock();
  const db = memDb(clock);
  const config = testConfig({ HQ_OWNER_WALLET: owner.address });
  const req = (command, { nonce = crypto.randomBytes(18).toString("base64url"), issuedAt = new Date(clock()).toISOString(), signer = owner } = {}) =>
    ({ command, nonce, issuedAt, signature: signer.sign(adminMessage({ command, nonce, issuedAt, server: config.serverId })) });
  ok("the signed text is canonical: key order does not change it", canonical({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: "x" } }) === canonical({ a: { c: "x", d: [1, { e: 3, f: 2 }] }, b: 1 }));
  ok("…and says what it is, and which server it is for", adminMessage({ command: { op: "kill", on: true }, nonce: "n", issuedAt: "t", server: "api.catintelligenceagency.com" }) === 'cia-hq admin\n{"command":{"on":true,"op":"kill"},"issuedAt":"t","nonce":"n","server":"api.catintelligenceagency.com"}');
  ok("the server's id is HQ_SERVER_ID, api.catintelligenceagency.com unless set", config.serverId === "api.catintelligenceagency.com" && testConfig({ HQ_SERVER_ID: "hq-staging.up.railway.app" }).serverId === "hq-staging.up.railway.app");
  const good = req({ op: "agent.pause", id: 1 });
  ok("the owner's signature: the command comes back", verifyAdminRequest({ body: good, config, db, clock })?.op === "agent.pause");
  ok("the same request again: replayed", await refused(() => verifyAdminRequest({ body: good, config, db, clock })) === "replayed");
  ok("signed by anyone else: bad_signature", await refused(() => verifyAdminRequest({ body: req({ op: "kill", on: false }, { signer: ownerKey() }), config, db, clock })) === "bad_signature");
  const tampered = req({ op: "agent.pause", id: 1 });
  ok("a signed command altered after signing: bad_signature", await refused(() => verifyAdminRequest({ body: { ...tampered, command: { op: "agent.withdraw", id: 1, sol: "all" } }, config, db, clock })) === "bad_signature");
  ok("issued more than HQ_ADMIN_MAX_SKEW_SECONDS ago: stale", await refused(() => verifyAdminRequest({ body: req({ op: "kill", on: true }, { issuedAt: new Date(clock() - 301_000).toISOString() }), config, db, clock })) === "stale");
  ok("…or in the future: stale", await refused(() => verifyAdminRequest({ body: req({ op: "kill", on: true }, { issuedAt: new Date(clock() + 301_000).toISOString() }), config, db, clock })) === "stale");
  ok("a short nonce: bad_request", await refused(() => verifyAdminRequest({ body: req({ op: "kill", on: true }, { nonce: "abc" }), config, db, clock })) === "bad_request");
  ok("a command that is not an object: bad_request", await refused(() => verifyAdminRequest({ body: { ...req({ op: "kill", on: true }), command: ["kill"] }, config, db, clock })) === "bad_request");
  ok("with no HQ_OWNER_WALLET set, remote admin is off (403) whatever is signed", await (async () => { try { verifyAdminRequest({ body: req({ op: "kill", on: true }), config: testConfig(), db, clock }); return false; } catch (e) { return e.clause === "admin_disabled" && e.status === 403; } })());

  /* one owner wallet, two servers (production and a staging copy): a command signed for one is refused by the other */
  const staging = testConfig({ HQ_OWNER_WALLET: owner.address, HQ_SERVER_ID: "hq-staging.up.railway.app" });
  const forStaging = (() => { const command = { op: "kill", on: true }, nonce = crypto.randomBytes(18).toString("base64url"), issuedAt = new Date(clock()).toISOString();
    return { command, nonce, issuedAt, signature: owner.sign(adminMessage({ command, nonce, issuedAt, server: staging.serverId })) }; })();
  ok("a command the owner signed for the staging server: refused by production (bad_signature), and it spends nothing there", await refused(() => verifyAdminRequest({ body: forStaging, config, db, clock })) === "bad_signature" && db.getNonce(`admin:${forStaging.nonce}`) === null);
  ok("…accepted by the staging server it was signed for", verifyAdminRequest({ body: forStaging, config: staging, db: memDb(clock), clock }).op === "kill");
  const unsigned = { command: { op: "kill", on: true }, nonce: crypto.randomBytes(18).toString("base64url"), issuedAt: new Date(clock()).toISOString() };
  ok("…and one signed with no server named (the old message): refused", await refused(() => verifyAdminRequest({ body: { ...unsigned, signature: owner.sign(`cia-hq admin\n${canonical({ command: unsigned.command, issuedAt: unsigned.issuedAt, nonce: unsigned.nonce })}`) }, config, db, clock })) === "bad_signature");

  /* HQ_OWNER_WALLET set to a key of small order (the System Program's address): a signature forged for it over this exact request */
  const sysOwner = testConfig({ HQ_OWNER_WALLET: "11111111111111111111111111111111" });
  const forgedBody = { command: { op: "kill", on: false }, nonce: "fixednonce-0123456789", issuedAt: "2026-09-25T12:00:00.000Z", signature: "47XMu7naT17gJat5YUmvcy4Guqxse5FdGqbKN2zXHS1XW4dYTdwdcXRz8Dn9D448WF9jfFrtu5UpneF6HZuwkGFZ" };
  ok("an owner wallet of small order: a forged signature (one Node's own verify accepts) is refused", await refused(() => verifyAdminRequest({ body: forgedBody, config: sysOwner, db: memDb(clock), clock: testClock(Date.parse("2026-09-25T12:00:00.000Z")) })) === "bad_signature");

  /* The owner's admin client, on the owner's own machine, from a keypair file. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-admin-test-"));
  const file = path.join(dir, "owner.json");
  try {
    fs.writeFileSync(file, JSON.stringify(owner.secret64));
    const { signer, body } = signedRequest({ command: { op: "kill", on: true }, keypairPath: file, now: clock() });
    ok("the admin client signs with the keypair file: the signer is the owner's address", signer === owner.address);
    ok("…and HQ accepts what it made (signed for api.catintelligenceagency.com by default)", verifyAdminRequest({ body, config, db, clock }).op === "kill");
    ok("…it names the server from --server, else the host of --url", serverIdFor({ server: "x.example" }) === "x.example" && serverIdFor({ url: "https://hq-staging.up.railway.app/" }) === "hq-staging.up.railway.app" && serverIdFor({}) === "api.catintelligenceagency.com");
    const staged = signedRequest({ command: { op: "kill", on: true }, keypairPath: file, now: clock(), server: serverIdFor({ url: "https://hq-staging.up.railway.app" }) });
    ok("…and what it signed for another server, production refuses", await refused(() => verifyAdminRequest({ body: staged.body, config, db, clock })) === "bad_signature");
    ok("…the body carries the command, a nonce, the time and the signature — never the key", Object.keys(body).sort().join() === "command,issuedAt,nonce,signature" && !JSON.stringify(body).includes(String(owner.secret64.slice(0, 8))));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

section("THE COMMANDS");
{
  const clock = testClock();
  const db = memDb(clock);
  const withdrawals = [];
  let heldLive = [];                                   /* what the agent's wallet holds, bought live */
  const deps = { db, config: testConfig({ HQ_TREASURY_ADDRESS: addr(1) }), rpc: null, clock, agentAddress: (n) => addr(100 + n),
    withdraw: async ({ agent, lamports }) => { withdrawals.push({ id: agent.id, lamports }); return { signature: "sig" }; },
    runtime: { refresh: async () => ({ ledger: { positions: [] } }), sell: async () => ({ ok: true }), walletLedger: () => ({ positions: heldLive }) } };
  const run = (command) => executeAdminCommand(command, { source: "test", deps });
  const created = await run({ op: "agent.create", name: "Agent Whiskers", strategy: "crying-cat-safe" });
  const a = db.getAgent(1);
  ok("agent.create: agent 001, paper, active, its wallet derived for its number", created.created === 1 && a.mode === "paper" && a.status === "active" && a.wallet === addr(101) && created.derivation === "m/44'/501'/1'/0'");
  ok("…the strategy's sprite and default limits, and a paper bankroll deposit of HQ_PAPER_BANKROLL_SOL (1)", a.cat === "crying-cat" && a.limits.maxPerTradeSol === "0.05" && db.listPaperTransfers(1).length === 1 && db.listPaperTransfers(1)[0].lamports === String(parseSol("1")));
  ok("the next agent takes the next number", (await run({ op: "agent.create", name: "Agent Two", strategy: "snipurr" })).created === 2);
  ok("a number that is taken: refused", await refused(() => run({ op: "agent.create", name: "Agent Again", strategy: "snipurr", number: 1 })) === "taken");
  ok("a number over 999: refused", await refused(() => run({ op: "agent.create", name: "Agent Big", strategy: "snipurr", number: 1000 })) === "bad_number");
  ok("an unknown strategy: refused", await refused(() => run({ op: "agent.create", name: "Agent X", strategy: "yolo" })) === "bad_strategy");
  ok("a name with markup: refused", await refused(() => run({ op: "agent.create", name: "<b>Agent</b>", strategy: "snipurr" })) === "bad_name");
  ok("a sprite that is not in brand/sprites: refused", await refused(() => run({ op: "agent.create", name: "Agent Dog", strategy: "snipurr", cat: "doge" })) === "bad_cat");
  ok("limits outside their fences: refused as bad_limits", await refused(() => run({ op: "agent.create", name: "Agent Risky", strategy: "snipurr", limits: { maxPerTradeSol: "5" } })) === "bad_limits");
  ok("settings a strategy does not know: refused", await refused(() => run({ op: "agent.create", name: "Agent Odd", strategy: "popcat-scout", settings: { leverage: 10 } })) === "bad_request");
  ok("a paper bankroll outside 0.01–100 SOL: refused", await refused(() => run({ op: "agent.create", name: "Agent Rich", strategy: "snipurr", paperBankrollSol: "1000" })) === "bad_bankroll");
  ok("when the wallets cannot be derived (no master seed), no agent is made", await refused(() => executeAdminCommand({ op: "agent.create", name: "Agent Seedless", strategy: "snipurr" }, { source: "test", deps: { ...deps, agentAddress: () => { throw new Error("HQ_MASTER_SEED is missing"); } } })) === "no_wallet" && !db.getAgent(3));

  ok("to live without the agent's wallet typed back: refused", await refused(() => run({ op: "agent.set", id: 1, mode: "live" })) === "confirm" && db.getAgent(1).mode === "paper");
  ok("…with another wallet typed: refused", await refused(() => run({ op: "agent.set", id: 1, mode: "live", confirmWallet: addr(102) })) === "confirm");
  await run({ op: "agent.set", id: 1, mode: "live", confirmWallet: addr(101) });
  ok("…with its own wallet typed: live", db.getAgent(1).mode === "live");
  heldLive = [{ mint: addr(55), qty: 1_000n, cost: 10_000_000n }];
  const stuck = await refused(() => run({ op: "agent.set", id: 1, mode: "paper" }));
  ok("back to paper while the wallet still holds a coin bought live: refused (holds_positions) — its stops would stop watching real tokens", stuck === "holds_positions" && db.getAgent(1).mode === "live");
  ok("…and where the holdings cannot be read, it stays live too", await refused(() => executeAdminCommand({ op: "agent.set", id: 1, mode: "paper" }, { source: "test", deps: { ...deps, runtime: { refresh: deps.runtime.refresh } } })) === "holds_unknown" && db.getAgent(1).mode === "live");
  heldLive = [];
  await run({ op: "agent.set", id: 1, mode: "paper" });
  ok("once liquidated, back to paper needs no confirmation", db.getAgent(1).mode === "paper");
  await run({ op: "agent.set", id: 1, limits: { stopLossPct: 12 } });
  ok("new limits merge over the agent's own, fenced", db.getAgent(1).limits.stopLossPct === 12 && db.getAgent(1).limits.maxPerTradeSol === "0.05");
  await run({ op: "agent.set", id: 1, strategy: "coinmarketcat" });
  ok("a new strategy brings its own default limits and settings", db.getAgent(1).strategy === "coinmarketcat" && db.getAgent(1).limits.maxPerTradeSol === "0.1" && db.getAgent(1).settings.scheduleMinutes === 30);
  ok("a skin the agent's rank has not unlocked: refused", await refused(() => run({ op: "agent.set", id: 1, skin: "director" })) === "skin_locked");
  db.setRank(1, "paper", "special");
  await run({ op: "agent.set", id: 1, skin: "special" });
  ok("…one it has: set", db.getAgent(1).skin === "special");

  await run({ op: "agent.pause", id: 2 });
  ok("pause", db.getAgent(2).status === "paused");
  await run({ op: "agent.resume", id: 2 });
  ok("resume", db.getAgent(2).status === "active");
  await run({ op: "agent.retire", id: 2 });
  ok("retire, and a retired agent stays retired", db.getAgent(2).status === "retired" && await refused(() => run({ op: "agent.resume", id: 2 })) === "retired");
  ok("an agent that does not exist: 404", await refused(() => run({ op: "agent.pause", id: 77 })) === "no_agent");

  const w = await run({ op: "agent.withdraw", id: 1, sol: "0.25" });
  await run({ op: "agent.withdraw", id: 1, sol: "all" });
  ok("withdraw: the amount, or everything; the result names the treasury as where it went", withdrawals[0].lamports === parseSol("0.25") && withdrawals[1].lamports === null && w.to === addr(1));
  const cliWithdraw = commandFor({ pos: ["agent", "withdraw", "1", "0.1"], flags: { to: addr(9) } });
  ok("the withdraw command carries no destination, even when one is typed: there is nowhere else to name", Object.keys(cliWithdraw).sort().join() === "id,op,sol");

  await run({ op: "kill", on: true });
  ok("kill on: stored, and survives as a switch", db.getKv("kill") === true);
  await run({ op: "kill", on: false });
  ok("kill off", db.getKv("kill") === false);
  ok("kill needs on: true or false", await refused(() => run({ op: "kill", on: "yes" })) === "bad_request");

  const coin = addr(50);
  const reg = await run({ op: "coin.register", mint: coin, agentId: 1 });
  ok("coin.register: the agency's coin, and the agent's", reg.registered === coin && db.getCoin(coin).source === "owner" && db.getAgent(1).coinMint === coin);
  ok("$CIA is never an agent's coin: refused", await refused(() => run({ op: "coin.register", mint: CIA_MINT })) === "bad_mint");
  ok("a mint that is not an address: refused", await refused(() => run({ op: "coin.register", mint: "pump.fun/coin/x" })) === "bad_mint");
  ok("an unknown command: refused, naming the commands", await refused(() => run({ op: "agent.promote", id: 1 })) === "unknown_command" && COMMANDS.length === 9);
  ok("every command is logged with its source", db.listAdminLog(100).length >= 15 && db.listAdminLog(100).every((r) => r.source === "test"));
  const files = fs.readdirSync(path.join(ROOT, "brand", "sprites")).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)).sort();
  ok("the sprites an agent's cat may name are exactly the files in brand/sprites/", JSON.stringify(files) === JSON.stringify([...SPRITES].sort()), files.join(", "));
}

section("THE CLI'S LINES, AND KEYGEN'S REFUSALS");
{
  const c = (line) => commandFor(parseArgs(line.match(/'[^']*'|"[^"]*"|\S+/g).map((x) => x.replace(/^['"]|['"]$/g, ""))));
  ok("agent create", JSON.stringify(c(`agent create --name "Agent Whiskers" --strategy snipurr --limits '{"maxPerTradeSol":"0.02"}' --paper-sol 2`)) === JSON.stringify({ op: "agent.create", name: "Agent Whiskers", strategy: "snipurr", limits: { maxPerTradeSol: "0.02" }, paperBankrollSol: "2" }));
  ok("agent mode, with the wallet typed back", JSON.stringify(c(`agent mode 3 live --confirm ${addr(103)}`)) === JSON.stringify({ op: "agent.set", id: 3, mode: "live", confirmWallet: addr(103) }));
  ok("agent limits / settings take JSON", c(`agent limits 3 '{"stopLossPct":10}'`).limits.stopLossPct === 10 && c(`agent settings 3 '{"strategy":"buy JUP on dips"}'`).settings.strategy === "buy JUP on dips");
  ok("agent pause / resume / retire / liquidate", ["pause", "resume", "retire", "liquidate"].every((v) => c(`agent ${v} 4`).op === `agent.${v}` && c(`agent ${v} 4`).id === 4));
  ok("agent withdraw: an amount, or all by default", c("agent withdraw 4 0.5").sol === "0.5" && c("agent withdraw 4").sol === "all");
  ok("kill on / kill off", c("kill on").on === true && c("kill off").on === false);
  ok("coin register, optionally for an agent", JSON.stringify(c(`coin register ${addr(50)} --agent 2`)) === JSON.stringify({ op: "coin.register", mint: addr(50), agentId: 2 }));
  ok("bad JSON is refused with an example", (() => { try { c("agent limits 3 {stopLoss:10}"); return false; } catch (e) { return e.clause === "bad_json"; } })());
  ok("keygen refuses in CI, on GitHub Actions and on Railway", ["CI", "GITHUB_ACTIONS", "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID"].every((k) => keygenRefusal({ [k]: "1" }, true) !== null));
  ok("…and when its output is piped or written to a file", keygenRefusal({}, false) !== null);
  ok("…and runs in a terminal on the owner's own machine", keygenRefusal({}, true) === null);
}

done();
