/**
 * THE ONE RISK LAYER, THE RUG CHECK AND THE AGENCY'S OWN COINS.
 *
 *   · the limits are fenced: each has a floor and a ceiling, and an unknown limit is refused;
 *   · every buy refusal the risk layer has, each on its own, and in its order (the kill switch
 *     first); the size clamped to the max per trade and to what the wallet can spend;
 *   · the exits: stop loss, take profit, trailing stop at their exact edges; an unpriced position
 *     waits; the daily loss limit trips at the limit, stays tripped all UTC day, and resets;
 *   · Crying Cat's rug check blocks a coin that fails it — on recorded mainnet accounts, and with
 *     each failing line alone — and fails closed on what it could not read;
 *   · through the runtime: a failing coin is refused before any quote, an agency coin before the
 *     rug check, and the protections sell while the agent is paused and under the kill switch.
 * No network: every answer is scripted or recorded.
 */
import { PublicKey } from "@solana/web3.js";
import { harness, fixture, scriptedRpc } from "./bots/test/doubles.mjs";
import { PUMPFUN_PROGRAM, PUMPFUN_GLOBAL } from "./bots/lib/verified.mjs";
import { cryingCatReport } from "./src/lib/crying-cat.mjs";
import { normalizeLimits, checkBuy, checkExits, rollDay, LIMIT_FENCES, BUY_CLAUSES, MIN_TRADE_LAMPORTS, FEE_RESERVE_LAMPORTS, LimitError } from "./services/hq/lib/risk.mjs";
import { judgeRugReport, createRugChecker, RUG_RULES } from "./services/hq/lib/rugcheck.mjs";
import { agencyExclusions, agencyCoin, parseLaunches } from "./services/hq/lib/agency.mjs";
import { CIA_MINT } from "./services/hq/lib/config.mjs";
import { STRATEGIES, strategyOf } from "./services/hq/strategies/index.mjs";
import { paperRig, rugDouble, jupiterDouble, addr, testClock, TEST_LIMITS } from "./services/hq/test/doubles.mjs";
import { parseSol } from "./services/hq/lib/amounts.mjs";

const { ok, section, done } = harness("test-hq-risk");
const SOL = 1_000_000_000n;
const throwsKey = (fn, key) => { try { fn(); return false; } catch (e) { return e instanceof LimitError && e.key === key; } };

section("THE LIMITS, FENCED");
{
  for (const id of Object.keys(STRATEGIES)) {
    const d = strategyOf(id).defaults.limits;
    const L = normalizeLimits({}, d);
    ok(`${id}: its default limits are inside every fence`, L.maxPerTradeSol === d.maxPerTradeSol && L.maxOpenPositions === d.maxOpenPositions && L.stopLossPct === d.stopLossPct);
  }
  const d = TEST_LIMITS;
  ok("a max per trade over 1 SOL is refused", throwsKey(() => normalizeLimits({ maxPerTradeSol: "1.000000001" }, d), "maxPerTradeSol"));
  ok("…and under 0.001 SOL", throwsKey(() => normalizeLimits({ maxPerTradeSol: "0.0009" }, d), "maxPerTradeSol"));
  ok("…and one that is not a SOL amount", throwsKey(() => normalizeLimits({ maxPerTradeSol: "1e3" }, d), "maxPerTradeSol"));
  ok("max open positions: a whole number from 1 to 10", throwsKey(() => normalizeLimits({ maxOpenPositions: 11 }, d), "maxOpenPositions") && throwsKey(() => normalizeLimits({ maxOpenPositions: 0 }, d), "maxOpenPositions") && throwsKey(() => normalizeLimits({ maxOpenPositions: 1.5 }, d), "maxOpenPositions"));
  ok("a stop loss from 1% to 90%", throwsKey(() => normalizeLimits({ stopLossPct: 0 }, d), "stopLossPct") && throwsKey(() => normalizeLimits({ stopLossPct: 91 }, d), "stopLossPct"));
  ok("a take profit from 1% to 1000%", throwsKey(() => normalizeLimits({ takeProfitPct: 0.5 }, d), "takeProfitPct") && throwsKey(() => normalizeLimits({ takeProfitPct: 1001 }, d), "takeProfitPct"));
  ok("a trailing stop from 1% to 90%, or off", throwsKey(() => normalizeLimits({ trailingStopPct: 95 }, d), "trailingStopPct") && normalizeLimits({ trailingStopPct: "off" }, d).trailingStopPct === null && normalizeLimits({ trailingStopPct: null }, d).trailingStopPct === null);
  ok("a daily loss limit from 0.001 to 10 SOL", throwsKey(() => normalizeLimits({ dailyLossLimitSol: "10.1" }, d), "dailyLossLimitSol"));
  ok("a daily loss limit under half the max per trade is refused (the first stop would trip it)", throwsKey(() => normalizeLimits({ maxPerTradeSol: "0.5", dailyLossLimitSol: "0.2" }, d), "dailyLossLimitSol"));
  ok("an unknown limit is refused, not ignored", throwsKey(() => normalizeLimits({ maxLeverage: 10 }, d), "maxLeverage"));
  ok("the fences are what the owner's guide says: at most 1 SOL a trade, 10 positions, 10 SOL a day", LIMIT_FENCES.maxPerTradeSol.max === "1" && LIMIT_FENCES.maxOpenPositions.max === 10 && LIMIT_FENCES.dailyLossLimitSol.max === "10");
  const stored = normalizeLimits({ maxPerTradeSol: "0.02", stopLossPct: "12.345" }, d);
  ok("limits are stored as strings of SOL and percentages rounded to 0.01", stored.maxPerTradeSol === "0.02" && stored.stopLossPct === 12.35 && Object.isFrozen(stored));
}

section("EVERY BUY REFUSAL, EACH ON ITS OWN");
{
  const agent = { id: 1, status: "active", mode: "paper" };
  const base = { killSwitch: false, agent, liveAllowed: false, agencyVerdict: { agency: false }, inflight: false, holding: false, openPositions: 0, dayTripped: false,
    limits: normalizeLimits({}, TEST_LIMITS), cashLamports: SOL, reserveLamports: 10_000_000n, askedLamports: parseSol("0.05") };
  const pass = checkBuy(base);
  ok("the base case buys, at the asked size", pass.ok === true && pass.sizeLamports === parseSol("0.05") && pass.clampedBy.length === 0);
  const cases = [
    ["kill_switch", { killSwitch: true }],
    ["agent_retired", { agent: { ...agent, status: "retired" } }],
    ["agent_paused", { agent: { ...agent, status: "paused" } }],
    ["live_not_enabled", { agent: { ...agent, mode: "live" }, liveAllowed: false }],
    ["agency_coin", { agencyVerdict: { agency: true, why: "it is $CIA" } }],
    ["in_flight", { inflight: true }],
    ["already_holding", { holding: true }],
    ["max_open_positions", { openPositions: 3 }],
    ["daily_loss_limit", { dayTripped: true }],
    ["insufficient_balance", { cashLamports: 10_000_000n + FEE_RESERVE_LAMPORTS + MIN_TRADE_LAMPORTS - 1n }],
    ["below_min_trade", { askedLamports: MIN_TRADE_LAMPORTS - 1n }],
  ];
  for (const [clause, patch] of cases) {
    const r = checkBuy({ ...base, ...patch });
    ok(`${clause}: refused, with its clause and words`, r.ok === false && r.clause === clause && r.message.length > 10, JSON.stringify(r));
  }
  ok("every clause the risk layer names is tested here or at the rug check below", BUY_CLAUSES.every((c) => c === "rug_check" || cases.some(([k]) => k === c)));
  ok("a live agent with HQ_LIVE on passes the switch", checkBuy({ ...base, agent: { ...agent, mode: "live" }, liveAllowed: true }).ok === true);
  const all = checkBuy({ ...base, killSwitch: true, agent: { ...agent, status: "paused", mode: "live" }, agencyVerdict: { agency: true, why: "x" }, inflight: true, holding: true, dayTripped: true });
  ok("in order: the kill switch wins over every other refusal", all.clause === "kill_switch");
  const big = checkBuy({ ...base, askedLamports: 5n * SOL });
  ok("an ask over the max per trade is held to it, and says so", big.ok && big.sizeLamports === parseSol("0.05") && big.clampedBy.includes("max_per_trade"));
  const short = checkBuy({ ...base, cashLamports: parseSol("0.04") });
  ok("an ask over what the wallet can spend is held to its cash less the reserve and two fees", short.ok && short.sizeLamports === parseSol("0.04") - 10_000_000n - FEE_RESERVE_LAMPORTS && short.clampedBy.includes("balance"));
  ok("the fee reserve is two transactions at the executor's measured peak priority fee plus the signature fee", FEE_RESERVE_LAMPORTS === 2n * (92_207n + 5_000n));
}

section("THE EXITS, AT THEIR EDGES");
{
  const L = normalizeLimits({ stopLossPct: 8, takeProfitPct: 15, trailingStopPct: 5 }, TEST_LIMITS);
  const cost = 100_000_000n;
  const at = (value, peak = null) => checkExits({ positions: [{ mint: "M", cost, value, peak }], limits: L });
  ok("down 7.99%: nothing", at(92_010_000n).length === 0);
  ok("down exactly 8%: the stop loss", at(92_000_000n)[0]?.trigger === "stop_loss");
  ok("up 14.99%: nothing", at(114_990_000n, 114_990_000n).length === 0);
  ok("up exactly 15%: the take profit", at(115_000_000n)[0]?.trigger === "take_profit");
  ok("5% under its peak (still up): the trailing stop", at(104_500_000n, 110_000_000n)[0]?.trigger === "trailing_stop");
  ok("4.9% under its peak: nothing", at(104_610_000n, 110_000_000n).length === 0);
  ok("the stop loss is judged before the trailing stop", at(90_000_000n, 110_000_000n)[0]?.trigger === "stop_loss");
  ok("an unpriced position is not judged this tick (no sell on a missing mark)", at(null, 110_000_000n).length === 0);
  const noTrail = normalizeLimits({ trailingStopPct: null }, TEST_LIMITS);
  ok("with no trailing stop set, a fall from the peak alone sells nothing", checkExits({ positions: [{ mint: "M", cost, value: 101_000_000n, peak: 114_000_000n }], limits: noTrail }).length === 0);
  ok("each exit says how far it moved from cost", at(92_000_000n)[0].movePct === -8);
}

section("THE DAILY LOSS LIMIT");
{
  const L = normalizeLimits({ dailyLossLimitSol: "0.1" }, TEST_LIMITS);
  const t0 = Date.parse("2026-09-25T00:05:00Z");
  let d = rollDay({ prev: null, nowMs: t0, tradingEquity: 0n, limits: L });
  ok("the day starts at the trading equity it first sees", d.day === "2026-09-25" && d.start === "0" && d.tripped === false);
  d = rollDay({ prev: d, nowMs: t0 + 3_600_000, tradingEquity: -99_999_999n, limits: L });
  ok("down 0.099999999 SOL today: not tripped", d.tripped === false && d.change === "-99999999");
  d = rollDay({ prev: d, nowMs: t0 + 7_200_000, tradingEquity: -100_000_000n, limits: L });
  ok("down exactly the limit: tripped, with the time", d.tripped === true && typeof d.trippedAt === "string");
  const later = rollDay({ prev: d, nowMs: t0 + 10_800_000, tradingEquity: 50_000_000n, limits: L });
  ok("a recovery later the same day does not untrip it", later.tripped === true && later.trippedAt === d.trippedAt);
  const next = rollDay({ prev: later, nowMs: Date.parse("2026-09-26T00:00:01Z"), tradingEquity: 50_000_000n, limits: L });
  ok("the next UTC day starts fresh, from where the last one ended", next.tripped === false && next.day === "2026-09-26" && next.start === "50000000");
}

/* Crying Cat on the accounts Popcat recorded on mainnet (fixtures/bots/popcat/snapshots.json). */
const snaps = fixture("popcat/snapshots.json").snapshots;
const acc = (owner, dataBase64) => ({ owner, lamports: 1, data: [dataBase64, "base64"] });
const encodeHolder = (h) => { const b = Buffer.alloc(40); new PublicKey(h.owner).toBuffer().copy(b); b.writeBigUInt64LE(BigInt(h.amount), 32); return { pubkey: h.account, account: { data: [b.toString("base64"), "base64"] } }; };
function chainFor({ mintData, s, holders = s.holders.list, gpaFails = false }) {
  return scriptedRpc({
    getMultipleAccounts: ([list]) => ({ value: list.map((k) => (k === PUMPFUN_GLOBAL ? acc(PUMPFUN_PROGRAM, fixture("pumpfun/global.json").dataBase64) : k === list[0] ? acc(s.mintAccount.owner, mintData ?? s.mintAccount.dataBase64) : k === list[1] ? acc(s.curveAccount.owner, s.curveAccount.dataBase64) : null)) }),
    getProgramAccounts: () => { if (gpaFails) throw Object.assign(new Error("getProgramAccounts: too many accounts"), { clause: "rpc_error" }); return holders.map(encodeHolder); },
    getTokenLargestAccounts: () => { throw Object.assign(new Error("getTokenLargestAccounts: refused"), { clause: "rpc_error" }); },
  });
}
const judge = async (opts) => judgeRugReport(await cryingCatReport({ rpc: chainFor(opts), mint: opts.s.apiRow.mint, now: Date.parse(opts.s.read) }));

section("CRYING CAT'S RUG CHECK, ON RECORDED MAINNET COINS");
{
  const s = snaps[0];
  const good = await judge({ s });
  ok("Asset Cat as recorded: authorities revoked, extensions accepted, holders spread, creator small — it passes", good.ok === true && good.passed.length === 5, JSON.stringify(good.failed));
  const withMint = Buffer.from(s.mintAccount.dataBase64, "base64"); withMint.writeUInt32LE(1, 0); new PublicKey(s.apiRow.creator).toBuffer().copy(withMint, 4);
  const m = await judge({ s, mintData: withMint.toString("base64") });
  ok("the same coin with a mint authority set: refused on mint_authority", m.ok === false && m.failed.some((f) => f.id === "mint_authority"), JSON.stringify(m.failed));
  const withFreeze = Buffer.from(s.mintAccount.dataBase64, "base64"); withFreeze.writeUInt32LE(1, 46); new PublicKey(s.apiRow.creator).toBuffer().copy(withFreeze, 50);
  const f = await judge({ s, mintData: withFreeze.toString("base64") });
  ok("…with a freeze authority set: refused on freeze_authority", f.ok === false && f.failed.some((x) => x.id === "freeze_authority"), JSON.stringify(f.failed));
  const people = s.holders.list.filter((h) => h.owner !== s.curveAccount.address);
  const whale = s.holders.list.map((h, i) => (h === people[3] ? { ...h, amount: String(BigInt(h.amount) + 400_000_000_000_000n) } : h));
  const w = await judge({ s, holders: whale });
  ok(`…with one wallet holding over ${RUG_RULES.maxTop10Pct}% of the supply: refused on holders`, w.ok === false && w.failed.some((x) => x.id === "holders"), JSON.stringify(w.failed));
  const creatorBig = s.holders.list.map((h) => (h.owner === s.apiRow.creator ? { ...h, amount: "90000000000000" } : h));
  const hasCreator = s.holders.list.some((h) => h.owner === s.apiRow.creator);
  const c = await judge({ s, holders: hasCreator ? creatorBig : [...s.holders.list, { account: addr(77), owner: s.apiRow.creator, amount: "90000000000000" }] });
  ok(`…with the creator holding over ${RUG_RULES.maxCreatorPct}%: refused on creator_share`, c.ok === false && c.failed.some((x) => x.id === "creator_share"), JSON.stringify(c.failed));
  const u = await judge({ s, gpaFails: true });
  ok("…when the holders cannot be read at all: refused (unknown is never a pass)", u.ok === false && u.failed.some((x) => x.id === "holders"), JSON.stringify(u.failed));
}

section("THE JUDGE, LINE BY LINE, AND THE CHECKER");
{
  const pass = { checks: [{ id: "mint_authority", result: "pass" }, { id: "freeze_authority", result: "pass" }, { id: "mint_extensions", result: "pass" }, { id: "creator_share", result: "pass" }], holders: { top10Pct: 12 }, pumpfun: { complete: false } };
  ok("a clean report passes", judgeRugReport(pass).ok === true);
  for (const id of RUG_RULES.must) {
    const r = judgeRugReport({ ...pass, checks: pass.checks.map((c) => (c.id === id ? { ...c, result: "fail", label: id, value: "set" } : c)) });
    ok(`${id} failing alone: refused`, r.ok === false && r.failed.length === 1 && r.failed[0].id === id);
    const gone = judgeRugReport({ ...pass, checks: pass.checks.filter((c) => c.id !== id) });
    ok(`${id} missing from the report: refused, not assumed`, gone.ok === false && gone.failed[0].id === id);
  }
  ok("a pump.fun coin whose creator share was not read: refused", judgeRugReport({ ...pass, checks: pass.checks.filter((c) => c.id !== "creator_share") }).ok === false);
  ok("a coin off pump.fun (no creator named on chain): the creator line is not invented", judgeRugReport({ ...pass, pumpfun: null, checks: pass.checks.filter((c) => c.id !== "creator_share") }).ok === true);
  ok("the thresholds are Popcat's own (30% top ten, 5% creator)", RUG_RULES.maxTop10Pct === 30 && RUG_RULES.maxCreatorPct === 5);
  const clock = testClock();
  let reads = 0;
  const checker = createRugChecker({ rpc: null, clock, ttlMs: 60_000, report: async () => { reads++; throw new Error("rpc down"); } });
  const r1 = await checker.check(addr(9));
  ok("a report that cannot be read at all is a refusal", r1.ok === false && r1.failed[0].id === "unreadable");
  await checker.check(addr(9));
  ok("the same mint within a minute is not read twice", reads === 1);
  clock.advance(60_001);
  await checker.check(addr(9));
  ok("…and is read again after it", reads === 2);
}

section("THE AGENCY'S OWN COINS");
{
  const treasury = addr(1), cashcat = addr(2), agentWallet = addr(3), launched = addr(4), launcher = addr(5), registered = addr(6), agentCoin = addr(7), stranger = addr(8);
  const ex = agencyExclusions({ agents: [{ wallet: agentWallet, coinMint: agentCoin }], coins: [{ mint: registered, creator: null }], launches: [{ mint: launched, creator: launcher }], treasury, cashcatWallet: cashcat });
  ok("$CIA is always excluded, even with nothing registered", agencyCoin({ mint: CIA_MINT }, agencyExclusions({})).agency === true);
  ok("an agent's own coin", agencyCoin({ mint: agentCoin }, ex).agency === true);
  ok("a coin the owner registered", agencyCoin({ mint: registered }, ex).agency === true);
  ok("a coin CashCat launched (the site's launches.json)", agencyCoin({ mint: launched }, ex).agency === true);
  ok("any coin created by the treasury, an agent wallet, CashCat's wallet or a launcher", [treasury, agentWallet, cashcat, launcher].every((c) => agencyCoin({ mint: stranger, creator: c }, ex).agency === true));
  ok("a stranger's coin by a stranger is not the agency's", agencyCoin({ mint: stranger, creator: addr(10) }, ex).agency === false);
  const parsed = parseLaunches({ launches: [{ mint: launched, creator: launcher, symbol: "CAT" }, { mint: "not a mint" }, { mint: addr(11), creator: "<script>" }] });
  ok("launches.json is read strictly: bad mints dropped, a bad creator is null", parsed.length === 2 && parsed[1].creator === null);
}

section("THROUGH THE RUNTIME: THE GATE, IN ORDER");
{
  const M = addr(50), BAD = addr(51);
  const rug = rugDouble({ [BAD]: { ok: false, failed: [{ id: "mint_authority", why: "Mint authority: still set" }], passed: [] } });
  const rig = await paperRig({ rug, agents: [{ id: 1, coinMint: addr(60) }], launches: [{ mint: addr(61), creator: addr(62) }] });
  const { runtime, db, jupiter } = rig;
  const agent = db.getAgent(1);
  const bad = await runtime.buy(agent, { mint: BAD, symbol: "BAD", decimals: 6, venue: "jupiter", askedLamports: parseSol("0.05"), reason: "test" });
  ok("a coin that fails Crying Cat is refused, with the reason", bad.ok === false && bad.clause === "rug_check" && /Mint authority/.test(bad.message));
  ok("…before Jupiter is asked for any quote, and no trade is recorded", jupiter.calls.length === 0 && db.listTrades(1, "paper").length === 0);
  const refusal = db.listDecisions(1).find((d) => /refused \(rug_check\)/.test(d.reason));
  ok("…and on the desk it is a buy decision carrying the check that refused it (passed: false), as the contract has it", refusal?.action === "buy" && JSON.parse(refusal.rug_json).passed === false && JSON.parse(refusal.rug_json).checks.length === 4);
  for (const [what, p] of [["$CIA", { mint: CIA_MINT }], ["its own coin", { mint: addr(60) }], ["a CashCat launch", { mint: addr(61) }], ["a coin its launcher made", { mint: addr(63), creator: addr(62) }], ["a coin another agent's wallet made", { mint: addr(64), creator: agent.wallet }]]) {
    const before = rig.rug.calls.length;
    const r = await runtime.buy(agent, { ...p, symbol: "X", decimals: 6, venue: "jupiter", askedLamports: parseSol("0.05"), reason: "test" });
    ok(`never buys ${what}: refused as agency_coin before the rug check`, r.ok === false && r.clause === "agency_coin" && rig.rug.calls.length === before);
  }
  const good = await runtime.buy(agent, { mint: M, symbol: "GOOD", decimals: 6, venue: "jupiter", askedLamports: 5n * SOL, reason: "test" });
  ok("a coin that passes is bought on paper, held to the max per trade", good.ok === true && db.listTrades(1, "paper").length === 1 && jupiter.calls[0].amountRaw === String(parseSol("0.05")));
  ok("…after the rug check read it", rig.rug.calls.includes(M));
  const boughtRow = db.listTrades(1, "paper")[0];
  const buyDecision = db.getDecision(boughtRow.decision_id);
  ok("…the trade and its buy decision carry the check it was bought on, as it was made", JSON.parse(boughtRow.rug_json).passed === true && boughtRow.rug_json === buyDecision.rug_json && buyDecision.action === "buy");
  const refusedBefore = db.listDecisions(1).find((d) => /refused \(agency_coin\)/.test(d.reason));
  ok("…a refusal before any check (an agency coin) is a hold with no rug check", refusedBefore?.action === "hold" && refusedBefore.rug_json === null);
  const again = await runtime.buy(agent, { mint: M, symbol: "GOOD", decimals: 6, venue: "jupiter", askedLamports: parseSol("0.05"), reason: "test" });
  ok("the same coin again: already_holding", again.clause === "already_holding");
  db.updateAgent(1, { status: "paused" });
  const paused = await runtime.buy(db.getAgent(1), { mint: addr(52), symbol: "P", decimals: 6, venue: "jupiter", askedLamports: parseSol("0.05"), reason: "test" });
  ok("a paused agent buys nothing", paused.clause === "agent_paused");
  db.updateAgent(1, { status: "active" });
  db.setKv("kill", true);
  const killed = await runtime.buy(db.getAgent(1), { mint: addr(52), symbol: "P", decimals: 6, venue: "jupiter", askedLamports: parseSol("0.05"), reason: "test" });
  ok("the owner's kill command stops every buy", killed.clause === "kill_switch");
}

section("A CURVE BUY'S CEILING IS HELD TO THE SIZE THE LIMITS ALLOWED");
{
  const rig = await paperRig({ agents: [{ id: 4 }] });
  const { runtime, db } = rig;
  const buyWith = (plan, mint) => runtime.buy(db.getAgent(4), { mint, symbol: "C", decimals: 6, venue: "pumpfun", askedLamports: parseSol("0.05"), plan: async () => plan, reason: "test" });
  const sizes = [];
  const over = await runtime.buy(db.getAgent(4), { mint: addr(80), symbol: "C", decimals: 6, venue: "pumpfun", askedLamports: parseSol("0.05"), plan: async (size) => { sizes.push(size); return { deliverable: true, baseOutRaw: 1_000_000n, maxQuoteInRaw: size + 1n }; }, reason: "test" });
  ok("a plan whose ceiling is one lamport over the size the gate allowed: refused (plan_over_size), nothing bought", over.ok === false && over.clause === "plan_over_size" && sizes[0] === parseSol("0.05") && db.listTrades(4, "paper").length === 0);
  const undeliverable = await buyWith({ deliverable: false, baseOutRaw: 1_000_000n, maxQuoteInRaw: parseSol("0.01") }, addr(81));
  ok("a plan the planner says cannot deliver: refused (no_plan)", undeliverable.clause === "no_plan");
  const nothing = await buyWith({ deliverable: true, baseOutRaw: 0n, maxQuoteInRaw: parseSol("0.01") }, addr(82));
  ok("…and one that delivers no tokens: refused (no_plan)", nothing.clause === "no_plan" && db.listTrades(4, "paper").length === 0);
  const fine = await buyWith({ deliverable: true, baseOutRaw: 1_000_000n, maxQuoteInRaw: parseSol("0.05") }, addr(83));
  ok("a deliverable plan at the size: bought", fine.ok === true && db.listTrades(4, "paper").length === 1);
}

section("A COIN THAT STOPS QUOTING: SHOWN AT THE STALE RULE, BUT NO STOP SELLS ON IT AND NO DAY TRIPS ON IT");
{
  const M = addr(90);
  const clock = testClock();
  const markMap = new Map([[M, { lamports: 60_000_000n, tokens: 50_000_000_000n, source: "test" }]]);
  const rig = await paperRig({ clock, marks: markMap, agents: [{ id: 6, limits: normalizeLimits({ stopLossPct: 10, takeProfitPct: 50, trailingStopPct: null, dailyLossLimitSol: "0.03" }, TEST_LIMITS) }] });
  const { runtime, db } = rig;
  db.upsertTrade({ id: "paper:stale", agentId: 6, mode: "paper", t: new Date(clock()).toISOString(), side: "buy", mint: M, decimals: 6, sol: 50_055_000n, tokens: 50_000_000_000n, fee: 55_000n, trigger: "strategy" });
  const v1 = await runtime.refresh(6);
  ok("quoted now: valued at the quote, priced", v1.ledger.positions[0].value === 60_000_000n && v1.ledger.positions[0].priced && v1.ledger.positions[0].quotedNow);
  markMap.clear();                                   /* no source prices it any more */
  clock.advance(25 * 3_600_000);
  const out = await runtime.runExits(db.getAgent(6));
  const v2 = runtime.viewOf(6);
  ok("a day later, unquoted: the dossier's value is 0 and it counts as unpriced", v2.ledger.positions[0].value === 0n && !v2.ledger.positions[0].priced && v2.ledger.unpricedPositions === 1);
  ok("…but no stop loss fires on that 0 (the protections act on a quote this tick only), and the day does not trip on it", out.length === 0 && v2.day.tripped === false && db.listTrades(6, "paper").length === 1, JSON.stringify(out));
  markMap.set(M, { lamports: 40_000_000n, tokens: 50_000_000_000n, source: "test" });
  const back = await runtime.runExits(db.getAgent(6));
  ok("a quote returns 20% under its cost: the stop loss sells on it", back.length === 1 && back[0].trigger === "stop_loss" && back[0].result.ok === true);
}

section("THE PROTECTIONS SELL WHILE PAUSED AND UNDER THE KILL SWITCH");
{
  const M = addr(70);
  /* Jupiter's paper quotes follow the marks the test sets: selling gets what the mark says. */
  const markMap = new Map();
  const jupiter = jupiterDouble({ outFor: ({ inputMint, amountRaw }) => { const m = markMap.get(inputMint); return m ? (amountRaw * m.lamports) / m.tokens : amountRaw * 1_000n; } });
  const rig = await paperRig({ env: { HQ_KILL: "1" }, jupiter, marks: markMap, agents: [{ id: 2, limits: normalizeLimits({ stopLossPct: 10, takeProfitPct: 20, trailingStopPct: null }, TEST_LIMITS) }] });
  const { runtime, db, marks } = rig;
  /* bought before the switch: write the paper fill as the runtime does */
  db.upsertTrade({ id: "paper:seed", agentId: 2, mode: "paper", t: "2026-09-25T11:00:00.000Z", side: "buy", mint: M, decimals: 6, sol: 50_055_000n, tokens: 50_000_000_000n, fee: 55_000n, trigger: "strategy" });
  db.updateAgent(2, { status: "paused" });
  marks.set(M, { lamports: 44_000_000n, tokens: 50_000_000_000n, source: "test" });
  const out = await runtime.runExits(db.getAgent(2));
  ok("a 12% fall on a paused agent under HQ_KILL=1 is sold by the stop loss", out.length === 1 && out[0].trigger === "stop_loss" && out[0].result.ok === true);
  const sells = db.listTrades(2, "paper").filter((t) => t.side === "sell");
  ok("…recorded as a stop_loss sell with its P&L", sells.length === 1 && sells[0].trigger === "stop_loss" && BigInt(sells[0].pnl) < 0n);
  const marks2 = new Map();
  const jupiter2 = jupiterDouble({ outFor: ({ inputMint, amountRaw }) => { const m = marks2.get(inputMint); return m ? (amountRaw * m.lamports) / m.tokens : amountRaw * 1_000n; } });
  const rig2 = await paperRig({ jupiter: jupiter2, marks: marks2, agents: [{ id: 3, limits: normalizeLimits({ dailyLossLimitSol: "0.03", maxPerTradeSol: "0.05" }, TEST_LIMITS) }] });
  rig2.db.upsertTrade({ id: "paper:a", agentId: 3, mode: "paper", t: "2026-09-25T11:00:00.000Z", side: "buy", mint: addr(71), decimals: 6, sol: 50_055_000n, tokens: 1_000_000n, fee: 55_000n, trigger: "strategy" });
  rig2.db.upsertTrade({ id: "paper:b", agentId: 3, mode: "paper", t: "2026-09-25T11:01:00.000Z", side: "buy", mint: addr(72), decimals: 6, sol: 50_055_000n, tokens: 1_000_000n, fee: 55_000n, trigger: "strategy" });
  await rig2.runtime.refresh(3);                                  /* the day starts here */
  /* each down 30%, 0.03 SOL in all: the daily limit (checked before the 8% stops) */
  rig2.marks.set(addr(71), { lamports: 35_000_000n, tokens: 1_000_000n, source: "test" });
  rig2.marks.set(addr(72), { lamports: 35_000_000n, tokens: 1_000_000n, source: "test" });
  const out2 = await rig2.runtime.runExits(rig2.db.getAgent(3));
  ok("today's loss reaching the daily limit sells everything held, as daily_limit", out2.length === 2 && out2.every((x) => x.trigger === "daily_limit" && x.result.ok));
  const after = await rig2.runtime.buy(rig2.db.getAgent(3), { mint: addr(73), symbol: "N", decimals: 6, venue: "jupiter", askedLamports: parseSol("0.01"), reason: "test" });
  ok("…and no buy follows until UTC midnight", after.clause === "daily_loss_limit");
}

done();
