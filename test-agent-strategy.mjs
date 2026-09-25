/**
 * THE AGENT'S SPEC, AND THE MINTS IT MAY TRADE — CHECKED AGAINST WHAT THE CHAIN SAID.
 *
 * What is proved:
 *   1. every preset mint — the eight majors and both settlement tokens — is the one read live
 *      on 2026-09-24 (fixtures/agent/mints-verified.json): the recorded mint account bytes,
 *      decoded here by the executor's own describeMint, give the decimals and the token
 *      program the constants carry, and Jupiter's token API agrees and marks each verified;
 *      none is Token-2022, none is the wrapped-SOL mint, none repeats;
 *   2. the defaults: paper, USDC, every 30 minutes, the majors, the $10 trade and $50 vault
 *      fixed, the model left to run time, no model identifier anywhere in the defaults;
 *   3. normalizeAgentSpec refuses by name: SOL (sol_not_in_v1), a settlement token in the
 *      universe, an unverified or malformed mint, more than ten tokens, a duplicate, an
 *      unknown schedule, every limit outside its fence, an over-long name or strategy, an
 *      unknown mode or drawdown action; a custom mint must carry what the chain said;
 *   4. the pair allowlist is exactly the settlement token into each listed token and back;
 *   5. the arm sentence names the wallet, the settlement, every limit and every token (a
 *      custom one by its mint), and changes when any of them does.
 */
import fs from "node:fs";
import { describeMint, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from "./vendor/executor/token2022.mjs";
import {
  SOLANA_MAJORS, SOLANA_MAJORS_VERIFIED, SETTLEMENT_TOKENS, DEFAULT_SETTLEMENT_MINT, AGENT_SPEC_DEFAULTS, AGENT_BOUNDS, AGENT_MODES,
  normalizeAgentSpec, universeEntries, allowedPairsFor, agentArmSentence, agentStartProblems, AgentSpecError, settlementFor,
  AGENT_UNMEASURED, AGENT_RUNS_WHERE,
} from "./src/lib/agent-strategy.mjs";
import { WSOL } from "./src/lib/tx.mjs";
import { PublicKey } from "@solana/web3.js";

/** Synthetic addresses for custom-mint tests: 32 repeated bytes, obviously not anyone's mint. */
const synthetic = (byte) => new PublicKey(Buffer.alloc(32, byte)).toBase58();

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? "  — " + detail : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const section = (title) => console.log(`\n${title}\n${"─".repeat(title.length)}`);
const clauseOf = (input) => { try { normalizeAgentSpec(input); return "accepted"; } catch (e) { return e instanceof AgentSpecError ? e.clause : `threw ${e.message}`; } };
const FIX = JSON.parse(fs.readFileSync(new URL("./fixtures/agent/mints-verified.json", import.meta.url), "utf8"));
const CUSTOM = { mint: synthetic(41), symbol: "TESTC", decimals: 6, program: TOKEN_PROGRAM, verifiedAt: 1_790_000_000_000 };

section("1. EVERY PRESET MINT IS THE ONE THE CHAIN DESCRIBED");
{
  ok("the fixture is the live read the constants cite", FIX.readAt.startsWith("2026-09-24T19:27") && FIX.slot === SOLANA_MAJORS_VERIFIED.slot && SOLANA_MAJORS_VERIFIED.fixture === "fixtures/agent/mints-verified.json", `${FIX.readAt}, slot ${FIX.slot}`);
  for (const t of [...SETTLEMENT_TOKENS, ...SOLANA_MAJORS]) {
    const rec = FIX.tokens.find((x) => x.mint === t.mint);
    if (!rec) { ok(`${t.symbol}: recorded in the fixture`, false); continue; }
    const facts = describeMint({ owner: rec.rpc.owner, data: rec.rpc.data }, t.mint);
    ok(`${t.symbol} (${t.mint}): the recorded mint account decodes to ${t.decimals} decimals under ${t.program === TOKEN_PROGRAM ? "the Token program" : t.program}`,
      facts.decimals === t.decimals && facts.program === t.program && facts.initialized === true && rec.rpc.owner === t.program);
    ok(`${t.symbol}: Jupiter's token API agrees on decimals and program, and marks it verified`,
      rec.jupiter?.decimals === t.decimals && rec.jupiter?.tokenProgram === t.program && rec.jupiter?.isVerified === true, (rec.jupiter?.tags ?? []).join("|"));
  }
  const all = [...SETTLEMENT_TOKENS, ...SOLANA_MAJORS].map((t) => t.mint);
  ok("ten distinct mints, none of them wrapped SOL, none Token-2022", new Set(all).size === 10 && !all.includes(WSOL) && [...SETTLEMENT_TOKENS, ...SOLANA_MAJORS].every((t) => t.program !== TOKEN_2022_PROGRAM));
  ok("the majors are eight, and fit the ten-token universe", SOLANA_MAJORS.length === 8 && SOLANA_MAJORS.length <= AGENT_BOUNDS.universeMax);
  ok("the issuer controls the constants' comment names are the ones the chain shows (USDC, USDT and cbBTC keep a freeze authority)",
    ["USDC", "USDT", "cbBTC"].every((s) => FIX.tokens.find((x) => x.symbol === s)?.facts.freezeAuthority) && ["JUP", "JTO", "PYTH", "RAY", "Bonk", "$WIF", "JitoSOL"].every((s) => FIX.tokens.find((x) => x.symbol === s)?.facts.freezeAuthority === null));
}

section("2. THE DEFAULTS");
{
  const d = normalizeAgentSpec({});
  ok("paper by default, settled in USDC, asked every 30 minutes", d.mode === "paper" && d.settlementMint === DEFAULT_SETTLEMENT_MINT && settlementFor(d).symbol === "USDC" && d.scheduleMinutes === 30);
  ok("the universe defaults to the eight majors", JSON.stringify(d.universe) === JSON.stringify(SOLANA_MAJORS.map((m) => m.mint)) && universeEntries(d).length === 8);
  ok("the schedules are 15, 30 and 60 minutes; the modes paper and live", JSON.stringify(AGENT_BOUNDS.schedules) === "[15,30,60]" && JSON.stringify(AGENT_MODES) === '["paper","live"]');
  ok("the limits default inside their fences: $25 a token, 60% exposure, −8% stop, +15% take, 5% daily drawdown that stops entries, 6 trades, 100 bps",
    d.maxPositionUsd === 25 && d.maxExposurePct === 60 && d.stopLossPct === 8 && d.takeProfitPct === 15 && d.maxDailyDrawdownPct === 5 && d.drawdownAction === "stop_entries" && d.maxTradesPerDay === 6 && d.slippageBps === 100);
  ok("the $10 minimum trade and the $50 minimum vault are fixed, not dials", AGENT_BOUNDS.minTradeUsd === 10 && AGENT_BOUNDS.minVaultUsd === 50 && !("minTradeUsd" in d));
  ok("the paper vault defaults to $100, and may not be under the $50 minimum", d.paperVaultUsd === 100 && clauseOf({ paperVaultUsd: 49 }) === "out_of_range");
  ok("the model is left to run time: an empty string, never an identifier", d.model === "" && AGENT_SPEC_DEFAULTS.model === "");
  ok("a new spec is a draft: it saves, and says what keeps it from starting", agentStartProblems(d).map((p) => p.name).join() === "name,strategy");
  ok("the spec is frozen", Object.isFrozen(d) && Object.isFrozen(d.universe));
  ok("the words the UI prints say it runs while Chrome is open, spot only, on the owner's credits, unmeasured",
    /while Chrome is open/.test(AGENT_RUNS_WHERE) && /spot only, with no leverage/.test(AGENT_RUNS_WHERE) && /your own API key/.test(AGENT_RUNS_WHERE) && /has been measured/.test(AGENT_UNMEASURED));
}

section("3. REFUSALS BY NAME");
{
  ok("SOL is not in v1: the wrapped-SOL mint is refused in the universe", clauseOf({ universe: [WSOL] }) === "sol_not_in_v1");
  ok("…and as a custom mint", clauseOf({ custom: [{ ...CUSTOM, mint: WSOL }] }) === "sol_not_in_v1");
  ok("the settlement token cannot be traded into", clauseOf({ universe: [DEFAULT_SETTLEMENT_MINT] }) === "settlement_in_universe");
  ok("a mint that is neither a major nor a verified custom one is refused", clauseOf({ universe: [CUSTOM.mint] }) === "mint_unverified");
  ok("a malformed address is refused", clauseOf({ universe: ["not-a-mint"] }) === "mint_malformed" && clauseOf({ custom: [{ ...CUSTOM, mint: "0OIl" }] }) === "mint_malformed");
  ok("a mint listed twice is refused", clauseOf({ universe: [SOLANA_MAJORS[0].mint, SOLANA_MAJORS[0].mint] }) === "duplicate_mint");
  const customs = Array.from({ length: 3 }, (_, i) => ({ ...CUSTOM, mint: synthetic(50 + i), symbol: `C${i}` }));
  ok("eight majors and three custom mints is eleven: over the ten-token universe", clauseOf({ custom: customs }) === "universe_too_big");
  ok("…seven majors and three custom is ten, and saves", clauseOf({ universe: SOLANA_MAJORS.slice(0, 7).map((m) => m.mint), custom: customs }) === "accepted");
  ok("a custom mint without its on-chain decimals, program or read time is unverified", ["decimals", "program", "verifiedAt"].every((k) => clauseOf({ custom: [{ ...CUSTOM, [k]: undefined }] }) === "custom_unverified"));
  ok("a custom mint that is a major is sent back to the preset", clauseOf({ custom: [{ ...CUSTOM, mint: SOLANA_MAJORS[1].mint }] }) === "custom_is_a_major");
  ok("a custom symbol is short and plain", clauseOf({ custom: [{ ...CUSTOM, symbol: "<script>" }] }) === "symbol_malformed" && clauseOf({ custom: [{ ...CUSTOM, symbol: "A".repeat(13) }] }) === "symbol_malformed");
  ok("a verified custom mint joins the universe with what the chain said", (() => { const s = normalizeAgentSpec({ universe: [SOLANA_MAJORS[0].mint], custom: [CUSTOM] }); const e = universeEntries(s); return e.length === 2 && e[1].decimals === 6 && e[1].source === "custom"; })());
  ok("an unknown schedule is refused", clauseOf({ scheduleMinutes: 5 }) === "schedule_unknown" && clauseOf({ scheduleMinutes: 45 }) === "schedule_unknown");
  const fences = [
    ["maxPositionUsd", 9.99, "out_of_range"], ["maxExposurePct", 101, "out_of_range"], ["maxExposurePct", 0, "out_of_range"], ["stopLossPct", 0, "out_of_range"],
    ["stopLossPct", 51, "out_of_range"], ["takeProfitPct", 0.1, "out_of_range"], ["maxDailyDrawdownPct", 60, "out_of_range"], ["maxTradesPerDay", 0, "out_of_range"],
    ["maxTradesPerDay", 2.5, "not_whole"], ["slippageBps", 500, "out_of_range"], ["slippageBps", 5, "out_of_range"], ["minBuyConfidence", 1.5, "out_of_range"], ["maxPositionUsd", "lots", "not_a_number"],
  ];
  for (const [key, value, clause] of fences) ok(`${key} = ${JSON.stringify(value)} is refused (${clause})`, clauseOf({ [key]: value }) === clause);
  ok("a name over 40 characters, or with a quote, is refused", clauseOf({ name: "x".repeat(41) }) === "name_too_long" && clauseOf({ name: 'the "cat"' }) === "name_malformed");
  ok("a strategy over 4,000 characters is refused", clauseOf({ strategy: "y".repeat(4_001) }) === "strategy_too_long" && clauseOf({ strategy: "y".repeat(4_000) }) === "accepted");
  ok("an unknown mode, drawdown action or settlement token is refused", clauseOf({ mode: "leverage" }) === "mode_unknown" && clauseOf({ drawdownAction: "double_down" }) === "drawdown_action_unknown" && clauseOf({ settlementMint: WSOL }) === "settlement_unknown");
  ok("control characters are stripped from the strategy, line breaks kept", normalizeAgentSpec({ strategy: "buy\u0007 dips\nsell rips" }).strategy === "buy dips\nsell rips");
  ok("unknown keys are dropped, not carried", !("leverage" in normalizeAgentSpec({ leverage: 10 })));
}

section("4. THE PAIRS A SWAP MAY BE");
{
  const s = normalizeAgentSpec({ universe: [SOLANA_MAJORS[1].mint, SOLANA_MAJORS[2].mint] });
  const pairs = allowedPairsFor(s);
  ok("the settlement token into each listed token and back, and nothing else", pairs.length === 4 && pairs.includes(`${DEFAULT_SETTLEMENT_MINT}>${SOLANA_MAJORS[1].mint}`) && pairs.includes(`${SOLANA_MAJORS[2].mint}>${DEFAULT_SETTLEMENT_MINT}`)
    && !pairs.includes(`${SOLANA_MAJORS[1].mint}>${SOLANA_MAJORS[2].mint}`) && !pairs.some((p) => p.includes(WSOL)));
}

section("5. THE ARM SENTENCE");
{
  const W = synthetic(7);
  const s = normalizeAgentSpec({ name: "Major cat", strategy: "x".repeat(30), universe: [SOLANA_MAJORS[1].mint], custom: [CUSTOM] });
  const sentence = agentArmSentence(s, W);
  ok("it names the agent, the wallet, the settlement and says nothing will ask", sentence.startsWith(`I arm the CoinMarketCat agent "Major cat" for ${W}: settled in USDC`) && sentence.endsWith("signed without asking me, by the autopilot key this browser holds"), sentence);
  ok("it names every limit", ["$25 in one token", "60% of the vault", "8% stop loss", "15% take profit", "5% daily drawdown that stops new buys", "6 trades a day at 100 bps slippage"].every((p) => sentence.includes(p)));
  ok("it names every token, a custom one by its mint", sentence.includes(`in JUP, TESTC (${CUSTOM.mint})`));
  const variants = [{ maxPositionUsd: 26 }, { stopLossPct: 9 }, { drawdownAction: "liquidate" }, { settlementMint: SETTLEMENT_TOKENS[1].mint }, { universe: [SOLANA_MAJORS[2].mint] }, { name: "Other cat" }, { slippageBps: 50 }];
  ok("change any limit, the settlement, the universe or the name, and the sentence changes", variants.every((v) => agentArmSentence(normalizeAgentSpec({ ...s, ...v }), W) !== sentence));
  ok("another wallet, another sentence", agentArmSentence(s, synthetic(8)) !== sentence);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
