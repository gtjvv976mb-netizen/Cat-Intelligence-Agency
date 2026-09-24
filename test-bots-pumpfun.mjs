/**
 * CASHCAT'S PUMP.FUN TRANSACTIONS AGREE WITH THE CHAIN, BYTE FOR BYTE.
 *
 * Against what was read off mainnet on 2026-09-24 (fixtures/bots/pumpfun/):
 *   · the program's on-chain IDL: create_v2's discriminator is sha256("global:create_v2"), its
 *     sixteen accounts are the ones pumpfun.mjs derives, its fixed addresses are verified.mjs's;
 *   · eleven real create_v2 instructions: every account (address, signer, writable) re-derived
 *     from (mint, user), 176 of 176, and their data re-encoded byte for byte;
 *   · Global: the reserves, create_v2 enabled, and the fee-recipient sets;
 *   · a real collect_creator_fee: the instruction CashCat would build for that creator is it;
 *   · CashCat's own create_v2, SOL-quoted and SPYx-quoted (Custom Pairs), as simulated on
 *     mainnet: rebuilt here from the same inputs, the message is the same bytes, and the
 *     recorded simulation succeeded inside the launch budget;
 *   · the real GLDx-quoted create_v2: its twenty accounts are the Custom Pairs builder's;
 *   · the optional dev buy: built by the executor's buy_v2 encoder against a recorded curve, it
 *     passes the dev-buy check and spends at most the cap.
 */
import { createHash } from "node:crypto";
import { Transaction, PublicKey } from "@solana/web3.js";
import { harness, fixture } from "./bots/test/doubles.mjs";
import {
  createV2Accounts, encodeCreateV2, decodeCreateV2, createV2Ix, collectCreatorFeeIx, creatorVault, decodeGlobalForLaunch, CREATE_V2_ACCOUNT_NAMES,
  createV2CustomPairIx, decodeQuoteControl, quoteControlAddress, QUOTE_CONTROL_DISC, devBuyIxs, decodeBuyIx,
} from "./bots/cashcat/pumpfun.mjs";
import {
  IX, PUMPFUN_PROGRAM, PUMPFUN_MINT_AUTHORITY, PUMPFUN_EVENT_AUTHORITY, PUMPFUN_MAYHEM_PROGRAM, PUMPFUN_MAYHEM_GLOBAL_PARAMS, PUMPFUN_MAYHEM_SOL_VAULT, PUMPFUN_GLOBAL, TOKEN_2022_PROGRAM,
} from "./bots/lib/verified.mjs";
import { pda } from "./bots/lib/solana.mjs";
import { MAX_LAUNCH_SPEND_LAMPORTS } from "./bots/cashcat/config.mjs";
import { checkDevBuyMessage } from "./bots/lib/txcheck.mjs";

const { ok, section, done } = harness("test-bots-pumpfun");
const disc = (name, ns = "global") => createHash("sha256").update(`${ns}:${name}`).digest().subarray(0, 8).toString("hex");
const same = (mine, recorded) => mine.length === recorded.length && mine.every((m, i) => m.pubkey.toBase58() === recorded[i].pubkey && m.isSigner === recorded[i].isSigner && m.isWritable === recorded[i].isWritable);

section("THE ON-CHAIN IDL");
const idl = fixture("pumpfun/idl-subset.json");
const cv2 = idl.instructions.find((i) => i.name === "create_v2");
ok("create_v2's discriminator is sha256(\"global:create_v2\")[0..8], and verified.mjs's", disc("create_v2") === IX.pumpCreateV2 && Buffer.from(cv2.discriminator).toString("hex") === IX.pumpCreateV2);
ok("collect_creator_fee's likewise", disc("collect_creator_fee") === IX.pumpCollectCreatorFee && Buffer.from(idl.instructions.find((i) => i.name === "collect_creator_fee").discriminator).toString("hex") === IX.pumpCollectCreatorFee);
ok("sixteen accounts, in the order pumpfun.mjs names them", JSON.stringify(cv2.accounts.map((a) => a.name)) === JSON.stringify(CREATE_V2_ACCOUNT_NAMES));
ok("eight arguments: name, symbol, uri, creator, and four options", JSON.stringify(cv2.args.map((a) => a.name)) === JSON.stringify(["name", "symbol", "uri", "creator", "is_mayhem_mode", "is_cashback_enabled", "creator_fee_bps", "is_holder_reward"]));
ok("the option types are one bool and one u64 wide", JSON.stringify(idl.types.find((t) => t.name === "OptionBool").type.fields) === '["bool"]' && JSON.stringify(idl.types.find((t) => t.name === "OptionU64").type.fields) === '["u64"]');
const seedsOf = (name) => cv2.accounts.find((a) => a.name === name).pda.seeds.map((s) => Buffer.from(s.value).toString());
ok("the IDL's seeds give verified.mjs's fixed addresses",
  pda([{ utf8: seedsOf("mint_authority")[0] }], PUMPFUN_PROGRAM) === PUMPFUN_MINT_AUTHORITY && pda([{ utf8: seedsOf("event_authority")[0] }], PUMPFUN_PROGRAM) === PUMPFUN_EVENT_AUTHORITY
    && pda([{ utf8: seedsOf("global")[0] }], PUMPFUN_PROGRAM) === PUMPFUN_GLOBAL
    && pda([{ utf8: seedsOf("global_params")[0] }], PUMPFUN_MAYHEM_PROGRAM) === PUMPFUN_MAYHEM_GLOBAL_PARAMS && pda([{ utf8: seedsOf("sol_vault")[0] }], PUMPFUN_MAYHEM_PROGRAM) === PUMPFUN_MAYHEM_SOL_VAULT
    && cv2.accounts.find((a) => a.name === "mayhem_program_id").address === PUMPFUN_MAYHEM_PROGRAM);
ok("the IDL was read from the program's own IDL account, with a digest of what was read", idl.source.account === "AYgC53tU5BbP2NAnv5nConJxAdpQZctvmZK88pu69xRs" && /^[0-9a-f]{64}$/.test(idl.source.decompressedSha256));

section("ELEVEN REAL create_v2 INSTRUCTIONS");
const samples = fixture("pumpfun/create-v2-samples.json").samples;
let accountsOk = 0, dataOk = 0, fullTail = 0;
for (const s of samples) {
  const mint = s.accounts[0].pubkey, user = s.accounts[5].pubkey;
  if (same(createV2Accounts({ mint, user }), s.accounts)) accountsOk++;
  const data = Buffer.from(s.dataHex, "hex");
  const d = decodeCreateV2(data);
  if (d.tailBytes === 11) { fullTail++; if (encodeCreateV2(d).equals(data)) dataOk++; }
}
ok(`every account of all ${samples.length} re-derives, address and flags (${samples.length * 16} accounts)`, accountsOk === samples.length);
ok(`every sample with the full eleven-byte option tail re-encodes byte for byte (${dataOk} of ${fullTail})`, dataOk === fullTail && fullTail >= 5);
ok("in every sample the creator argument is the signing user", samples.every((s) => decodeCreateV2(Buffer.from(s.dataHex, "hex")).creator === s.accounts[5].pubkey));
ok("CashCat's own tail is the all-zero form most samples sent", encodeCreateV2({ name: "A", symbol: "B", uri: "C", creator: samples[0].accounts[5].pubkey }).subarray(-11).equals(Buffer.alloc(11)));

section("GLOBAL");
const global = fixture("pumpfun/global.json");
const g = decodeGlobalForLaunch(Buffer.from(global.dataBase64, "base64"));
ok("reserves as the live IDL decodes them: 1,073,000,000,000,000 / 30 SOL / 793,100,000,000,000", g.initialVirtualTokenReserves === 1_073_000_000_000_000n && g.initialVirtualSolReserves === 30_000_000_000n && g.initialRealTokenReserves === 793_100_000_000_000n);
ok("create_v2 is enabled", g.createV2Enabled === true);
ok("eight standard, eight mayhem and eight buyback fee recipients", g.feeRecipients.standardFeeRecipients.length === 8 && g.feeRecipients.mayhemFeeRecipients.length === 8 && g.feeRecipients.buybackFeeRecipients.length === 8);

section("THE CREATOR-FEE CLAIM");
const claim = fixture("pumpfun/collect-creator-fee.json");
{
  const ix = collectCreatorFeeIx({ creator: claim.accounts[0].pubkey });
  ok("the recorded claim's five accounts are CashCat's for that creator (the vault is PDA [\"creator-vault\", creator])",
    ix.keys.length === 5 && ix.keys.every((k, i) => k.pubkey.toBase58() === claim.accounts[i].pubkey) && creatorVault(claim.accounts[0].pubkey) === claim.accounts[1].pubkey);
  ok("its data is the bare discriminator", Buffer.from(ix.data).toString("hex") === claim.dataHex);
  ok("the creator signed it and was paid", claim.signers[0] === claim.accounts[0].pubkey && claim.creatorLamportsAfter > claim.creatorLamportsBefore);
}

section("CASHCAT'S OWN create_v2, AS SIMULATED ON MAINNET");
function rebuild(recorded, ix) {
  const orig = Transaction.from(Buffer.from(recorded.transactionBase64, "base64"));
  const tx = new Transaction({ feePayer: new PublicKey(recorded.payer), recentBlockhash: orig.recentBlockhash });
  tx.add(orig.instructions[0], orig.instructions[1], ix);
  return { orig, tx };
}
{
  const s = fixture("pumpfun/simulate-create-v2.json");
  const { orig, tx } = rebuild(s, createV2Ix({ mint: s.mint, user: s.payer, ...s.coin }));
  ok("rebuilt from the same inputs, the message is the recorded one, byte for byte", tx.serializeMessage().equals(orig.serializeMessage()));
  ok("the simulation succeeded, logged CreateV2, and spent inside the launch budget",
    s.result.err === null && s.result.logs.some((l) => l.includes("Instruction: CreateV2")) && s.result.payerBefore - s.result.payerAfter > 0 && s.result.payerBefore - s.result.payerAfter <= MAX_LAUNCH_SPEND_LAMPORTS.pumpfun,
    `${s.result.payerBefore - s.result.payerAfter} lamports, ${s.result.unitsConsumed} units`);
}

section("PUMP.FUN CUSTOM PAIRS (A CURVE QUOTED IN A STOCK)");
{
  const cp = fixture("pumpfun/custom-pair.json");
  const real = cp.realCreate;
  const ix = createV2CustomPairIx({ mint: real.accounts[0].pubkey, user: real.accounts[5].pubkey, name: "x", symbol: "x", uri: "x", quoteMint: real.quoteMint, quoteTokenProgram: TOKEN_2022_PROGRAM });
  ok("the real GLDx-quoted create_v2's twenty accounts are the builder's, flags included", same(ix.keys, real.accounts), `${real.accounts.length} accounts`);
  ok("the twentieth is the QuoteControl PDA [\"quote-control\"]", real.accounts[19].pubkey === quoteControlAddress() && cp.quoteControl.address === quoteControlAddress());
  const qc = decodeQuoteControl(Buffer.from(cp.quoteControl.dataBase64, "base64"));
  ok("QuoteControl decodes with the live IDL's layout and lists SPYx and GLDx", Buffer.from(cp.quoteControl.dataBase64, "base64").subarray(0, 8).toString("hex") === QUOTE_CONTROL_DISC && disc("QuoteControl", "account") === QUOTE_CONTROL_DISC
    && qc.mints.length === cp.quoteControl.mints && ["XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re"].every((m) => qc.mints.some((x) => x.mint === m)), `${qc.mints.length} quote mints`);
  const s = cp.simulation;
  const { orig, tx } = rebuild(s, createV2CustomPairIx({ mint: s.mint, user: s.payer, ...s.coin, quoteMint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", quoteTokenProgram: TOKEN_2022_PROGRAM }));
  ok("CashCat's SPYx-quoted create_v2 rebuilds to the simulated bytes, and the simulation succeeded inside the budget",
    tx.serializeMessage().equals(orig.serializeMessage()) && s.result.err === null && s.result.payerBefore - s.result.payerAfter <= MAX_LAUNCH_SPEND_LAMPORTS["pumpfun-xstock"], `${s.result.payerBefore - s.result.payerAfter} lamports`);
}

section("THE OPTIONAL DEV BUY");
{
  const snap = fixture("popcat/snapshots.json").snapshots[1];
  const curveAccount = { owner: snap.curveAccount.owner, data: Buffer.from(snap.curveAccount.dataBase64, "base64") };
  const mint = snap.apiRow.mint, user = snap.apiRow.creator;
  const { ixs, amountRaw } = devBuyIxs({ mint, user, curveAccount, curveReadSlot: 450_150_200, globalAccount: { data: Buffer.from(global.dataBase64, "base64") }, spendLamports: 50_000_000n });
  const tx = new Transaction({ feePayer: new PublicKey(user), recentBlockhash: "11111111111111111111111111111111" });
  tx.add(...ixs);
  let passed = false;
  try { passed = checkDevBuyMessage(tx.compileMessage(), { wallet: user, mint, maxSpendLamports: 50_000_000n }); } catch (e) { passed = e.message; }
  ok("built against a recorded curve, the dev buy passes the dev-buy check", passed === true, String(passed));
  const d = decodeBuyIx(ixs[1].data);
  ok("it is a buy_v2 whose spend ceiling is exactly the dev buy, for a positive amount", d.instruction === "buy_v2" && d.maxQuoteInRaw === 50_000_000n && amountRaw > 0n);
  let refused = false;
  try { checkDevBuyMessage(tx.compileMessage(), { wallet: user, mint, maxSpendLamports: 49_999_999n }); } catch { refused = true; }
  ok("a ceiling over the cap is refused", refused);
  let notCreator = false;
  try { devBuyIxs({ mint, user: PUMPFUN_GLOBAL, curveAccount, curveReadSlot: 1, globalAccount: { data: Buffer.from(global.dataBase64, "base64") }, spendLamports: 1_000_000n }); } catch { notCreator = true; }
  ok("a dev buy on a coin CashCat did not create is refused", notCreator);
}

done();
