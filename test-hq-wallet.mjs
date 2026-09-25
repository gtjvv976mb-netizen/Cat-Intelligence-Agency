/**
 * AGENCY HQ'S WALLETS: THE DERIVATION AGAINST PUBLISHED VECTORS, AND THE KEY THAT NEVER LEAVES.
 *
 *   · SLIP-0010's own ed25519 test vector 1 (github.com/satoshilabs/slips, slip-0010.md), every
 *     level's public key: the hardened derivation HQ runs is the standard one;
 *   · BIP-39 phrases from trezor/python-mnemonic's vectors.json are accepted, and a changed word
 *     or a broken checksum is refused; the English list hashes to the value BIP-39 pins;
 *   · the Solana addresses of two published phrases at m/44'/501'/N'/0' — the path Phantom and
 *     solana-keygen use — as two independent libraries derive them (@scure/bip39 1.x with
 *     ed25519-hd-key 1.3.0 and @solana/web3.js Keypair.fromSeed, run on 2026-09-25): the first is
 *     the address Solana's documentation and Phantom show for "abandon … about";
 *   · agent N's wallet is that path; the readiness report says words, never values;
 *   · a signature is only ever made behind HQ_LIVE (the treasury's behind HQ_BUYBACK_LIVE), over
 *     exactly the message that was checked, for a one-signer transaction the wallet pays for,
 *     and verifies against the wallet's address;
 *   · no error, return value or JSON of the module carries the phrase or a key.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { harness, TEST_PHRASE } from "./services/hq/test/doubles.mjs";
import * as W from "./services/hq/wallet.mjs";
import { BIP39_ENGLISH } from "./services/hq/lib/bip39-english.mjs";
import { refusal } from "./services/hq/keygen.mjs";
import { verifyEd25519 } from "./services/hq/lib/perks.mjs";

const { ok, section, done } = harness("test-hq-wallet");
const ABOUT = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

section("SLIP-0010 ED25519, TEST VECTOR 1 (seed 000102030405060708090a0b0c0d0e0f)");
{
  const vectors = [
    ["m", "00a4b2856bfec510abab89753fac1ac0e1112364e7d250545963f135f2a33188ed"],
    ["m/0'", "008c8a13df77a28f3445213a0f432fde644acaa215fc72dcdf300d5efaa85d350c"],
    ["m/0'/1'", "001932a5270f335bed617d5b935c80aedb1a35bd9fc1e31acafd5372c30f5c1187"],
    ["m/0'/1'/2'", "00ae98736566d30ed0e9d2f4486a64bc95740d89c7db33f52121f8ea8f76ff0fc1"],
    ["m/0'/1'/2'/2'", "008abae2d66361c879b900d204ad2cc4984fa2aa344dd7ddc46007329ac76c429c"],
    ["m/0'/1'/2'/2'/1000000000'", "003c24da049451555d51a7014a37337aa4e12d41e485abccfa46b47dfb2af54b7a"],
  ];
  for (const [p, pub] of vectors) ok(`${p} → public ${pub.slice(0, 18)}…`, W.slip10PublicKeyHex({ seedHex: "000102030405060708090a0b0c0d0e0f", path: p }) === pub);
  let refused = false;
  try { W.slip10PublicKeyHex({ seedHex: "00", path: "m/0" }); } catch (e) { refused = e.clause === "bad_path"; }
  ok("a non-hardened level is refused (ed25519 has none)", refused);
}

section("BIP-39");
{
  const hash = crypto.createHash("sha256").update(BIP39_ENGLISH.join("\n") + "\n").digest("hex");
  ok("the English list is 2,048 words and hashes to BIP-39's pinned value", BIP39_ENGLISH.length === 2048 && hash === "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda", hash);
  const trezor = [ABOUT, TEST_PHRASE, "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
    "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong",
    "void come effort suffer camp survey warrior heavy shoot primary clutch crush open amazing screen patrol group space point ten exist slush involve unfold"];
  for (const p of trezor) ok(`accepted: "${p.split(" ").slice(0, 3).join(" ")} …" (${p.split(" ").length} words)`, W.checkRecoveryPhrase(p).ok === true);
  const bad = [[ABOUT.replace(/about$/, "abandon"), "a broken checksum"], [ABOUT.replace("abandon", "abandonx"), "a word not on the list"], ["abandon abandon", "too few words"], ["", "nothing"]];
  for (const [p, what] of bad) ok(`refused: ${what}`, W.checkRecoveryPhrase(p).ok === false && typeof W.checkRecoveryPhrase(p).why === "string");
  const fresh = W.newRecoveryPhrase();
  ok("a new phrase is 24 words and passes its own checksum", fresh.split(" ").length === 24 && W.checkRecoveryPhrase(fresh).ok);
  const fixed = W.newRecoveryPhrase({ randomBytes: () => Buffer.alloc(32, 0) });
  ok("…from 256 bits of entropy: all-zero entropy is the 24-word 'abandon … art' vector", fixed === `${"abandon ".repeat(23)}art`);
}

section("SOLANA ADDRESSES AT m/44'/501'/N'/0' (the path Phantom uses)");
{
  const want = [
    [ABOUT, 0, "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk"], [ABOUT, 1, "Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb"],
    [ABOUT, 2, "7WktogJEd2wQ9eH2oWusmcoFTgeYi6rS632UviTBJ2jm"], [ABOUT, 7, "9h1cLBiraaUqM1CdJTaVaew1oQtgQUW24FZ8YdnLLgJY"],
    [TEST_PHRASE, 0, "BLeUXTx9thHGT7VJUtF9vHEmfMDgW1nnKZ9UVer2CoLX"], [TEST_PHRASE, 1, "EdjcxP8MmXP4yRHguEVoH75kbXVfZNFXPgNfL9NqcXXK"],
    [TEST_PHRASE, 2, "AFG4eoTGSCdNemYFQhhJBqT7tJwo3WdC4Raeq9SkXx7p"], [TEST_PHRASE, 7, "GPAJ4A3YSzzVYeTigrfxB91j8ELPcqHCCq13vJvJhna1"],
  ];
  for (const [phrase, n, address] of want) ok(`"${phrase.split(" ")[0]} …" account ${n} → ${address}`, W.addressFromPhrase({ phrase, path: `m/44'/501'/${n}'/0'` }) === address);
  const env = { HQ_MASTER_SEED: TEST_PHRASE };
  ok("agent 1's wallet is account 1 of the master phrase", W.agentAddress(1, { env }) === "EdjcxP8MmXP4yRHguEVoH75kbXVfZNFXPgNfL9NqcXXK");
  ok("agent 7's wallet is account 7", W.agentAddress(7, { env }) === "GPAJ4A3YSzzVYeTigrfxB91j8ELPcqHCCq13vJvJhna1");
  ok("the path is documented per agent number", W.derivationPath(1) === "m/44'/501'/1'/0'" && W.derivationPath(999) === "m/44'/501'/999'/0'");
  for (const n of [0, 1000, 1.5, -1]) { let r = false; try { W.derivationPath(n); } catch (e) { r = e.clause === "bad_number"; } ok(`agent number ${n} is refused (agents are 1 to 999; account 0 is never an agent)`, r); }
  let refusedNoSeed = null;
  try { W.agentAddress(1, { env: {} }); } catch (e) { refusedNoSeed = e.clause; }
  ok("no HQ_MASTER_SEED: no address, said by name", refusedNoSeed === "no_master_seed");
  let badSeed = null;
  try { W.agentAddress(1, { env: { HQ_MASTER_SEED: ABOUT.replace(/about$/, "abandon") } }); } catch (e) { badSeed = e; }
  ok("a phrase with a broken checksum derives nothing, and the error does not repeat it", badSeed?.clause === "bad_master_seed" && !badSeed.message.includes("abandon abandon"));
}

section("READINESS: WORDS, NEVER VALUES");
{
  const t = W.newTreasuryKey();
  const r = W.walletReadiness({ HQ_MASTER_SEED: TEST_PHRASE, HQ_TREASURY_SECRET: t.secretBase58, HQ_TREASURY_ADDRESS: t.address });
  ok("a set phrase and a matching treasury pair read ok", r.masterSeed === "ok" && r.treasurySecret === "ok" && r.treasuryAddress === "ok");
  const other = W.newTreasuryKey();
  ok("a treasury secret for another address reads mismatch", W.walletReadiness({ HQ_TREASURY_SECRET: t.secretBase58, HQ_TREASURY_ADDRESS: other.address }).treasurySecret === "mismatch");
  ok("nothing set reads missing", JSON.stringify(W.walletReadiness({})) === JSON.stringify({ masterSeed: "missing", treasuryAddress: "missing", treasurySecret: "missing" }));
  ok("a 64-number array works too", W.walletReadiness({ HQ_TREASURY_SECRET: JSON.stringify([...bs58.decode(t.secretBase58)]), HQ_TREASURY_ADDRESS: t.address }).treasurySecret === "ok");
  const text = JSON.stringify(r);
  ok("the report carries no secret", !text.includes(t.secretBase58) && !text.includes("legal winner"));
}

/* A one-signer transfer the wallet pays for, as the executor would hand it over, checked. */
function transferTx(from, to, lamports = 1000) {
  const msg = new TransactionMessage({ payerKey: new PublicKey(from), recentBlockhash: "11111111111111111111111111111111",
    instructions: [SystemProgram.transfer({ fromPubkey: new PublicKey(from), toPubkey: new PublicKey(to), lamports })] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  return { txBase64: Buffer.from(tx.serialize()).toString("base64"), expectedMessageBase64: Buffer.from(msg.serialize()).toString("base64") };
}

section("SIGNING: BEHIND THE SWITCH, OVER THE CHECKED MESSAGE ONLY");
{
  const env = { HQ_MASTER_SEED: TEST_PHRASE, HQ_LIVE: "1" };
  const wallet = W.agentAddress(1, { env });
  const target = W.agentAddress(2, { env });
  const t = transferTx(wallet, target);
  let clause = null;
  try { W.signAsAgent(1, { ...t, env: { HQ_MASTER_SEED: TEST_PHRASE } }); } catch (e) { clause = e.clause; }
  ok("without HQ_LIVE=1 an agent signs nothing", clause === "not_live");
  const signed = W.signAsAgent(1, { ...t, env });
  const back = VersionedTransaction.deserialize(Buffer.from(signed.signedBase64, "base64"));
  ok("with it, the signature verifies against the agent's address over the message", verifyEd25519({ address: wallet, message: Buffer.from(back.message.serialize()), signature: signed.signature }));
  ok("…and the signed transaction carries exactly that signature", bs58.encode(back.signatures[0]) === signed.signature);
  const other = transferTx(wallet, target, 2000);
  clause = null;
  try { W.signAsAgent(1, { txBase64: other.txBase64, expectedMessageBase64: t.expectedMessageBase64, env }); } catch (e) { clause = e.clause; }
  ok("a transaction whose message is not the checked one is refused", clause === "unchecked");
  const foreign = transferTx(target, wallet);
  clause = null;
  try { W.signAsAgent(1, { ...foreign, env }); } catch (e) { clause = e.clause; }
  ok("a transaction another wallet pays for is refused", clause === "fee_payer");
  const two = new TransactionMessage({ payerKey: new PublicKey(wallet), recentBlockhash: "11111111111111111111111111111111",
    instructions: [SystemProgram.transfer({ fromPubkey: new PublicKey(target), toPubkey: new PublicKey(wallet), lamports: 5 })] }).compileToV0Message();
  clause = null;
  try { W.signAsAgent(1, { txBase64: Buffer.from(new VersionedTransaction(two).serialize()).toString("base64"), expectedMessageBase64: Buffer.from(two.serialize()).toString("base64"), env }); } catch (e) { clause = e.clause; }
  ok("a transaction asking a second signer is refused", clause === "signers");

  const tk = W.newTreasuryKey();
  const tenv = { HQ_TREASURY_SECRET: tk.secretBase58, HQ_TREASURY_ADDRESS: tk.address, HQ_BUYBACK_LIVE: "1" };
  const tt = transferTx(tk.address, wallet);
  clause = null;
  try { W.signAsTreasury({ ...tt, env: { ...tenv, HQ_BUYBACK_LIVE: "" } }); } catch (e) { clause = e.clause; }
  ok("without HQ_BUYBACK_LIVE=1 the treasury signs nothing", clause === "not_live");
  clause = null;
  try { W.signAsTreasury({ ...tt, env: { ...tenv, HQ_TREASURY_ADDRESS: W.newTreasuryKey().address } }); } catch (e) { clause = e.clause; }
  ok("a treasury secret that is not HQ_TREASURY_ADDRESS's signs nothing", clause === "no_treasury_key");
  const ts = W.signAsTreasury({ ...tt, env: tenv });
  ok("with both, the treasury's signature verifies", verifyEd25519({ address: tk.address, message: Buffer.from(tt.expectedMessageBase64, "base64"), signature: ts.signature }));
}

section("THE OWNER'S ADMIN SIGNATURE, FROM A KEYPAIR FILE ON THE OWNER'S MACHINE");
{
  const tk = W.newTreasuryKey();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-owner-"));
  const file = path.join(dir, "owner.json");
  fs.writeFileSync(file, JSON.stringify([...bs58.decode(tk.secretBase58)]));
  const s = W.signOwnerMessage({ keypairPath: file, message: "cia-hq admin\n{}" });
  ok("the file's wallet signs, and the signature verifies", s.address === tk.address && verifyEd25519({ address: tk.address, message: "cia-hq admin\n{}", signature: s.signature }));
  ok("only the address and the signature come back", JSON.stringify(Object.keys(s)) === '["address","signature"]');
  fs.rmSync(dir, { recursive: true, force: true });
}

section("KEYGEN SHOWS ITS SECRETS ONLY IN A TERMINAL, NEVER ON A SERVER");
{
  ok("in a terminal on the owner's machine it runs", refusal({}, true) === null);
  ok("piped or written to a file it refuses", /not a terminal/.test(refusal({}, false) ?? ""));
  for (const k of ["CI", "GITHUB_ACTIONS", "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID"]) ok(`with ${k} set it refuses`, /CI or a server/.test(refusal({ [k]: "1" }, true) ?? ""));
}

section("NOTHING SECRET IN WHAT THE MODULE EXPORTS");
{
  const names = Object.keys(W).sort();
  ok("the exports are addresses, checks, signers and the keygen makers", JSON.stringify(names) === JSON.stringify(["AGENT_NUMBER_MAX", "DERIVATION_PATH_TEMPLATE", "WalletError", "addressFromPhrase", "agentAddress",
    "checkRecoveryPhrase", "derivationPath", "newRecoveryPhrase", "newTreasuryKey", "signAsAgent", "signAsTreasury", "signOwnerMessage", "slip10PublicKeyHex", "walletReadiness"]), names.join(","));
  const src = fs.readFileSync("services/hq/wallet.mjs", "utf8");
  ok("wallet.mjs never prints (no console) and never writes a file", !/console\./.test(src) && !/writeFile|appendFile|createWriteStream/.test(src));
}

done();
