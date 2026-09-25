/**
 * AGENCY HQ'S WALLETS: THE ONE FILE THAT MAY HOLD A KEY.
 *
 * Every agent's wallet is derived from ONE master recovery phrase, HQ_MASTER_SEED, an
 * environment secret the owner generates on their own machine (keygen.mjs) and pastes into
 * the host's secret store. The treasury's key, HQ_TREASURY_SECRET, is optional and only signs
 * $CIA buybacks. Both are read here, from the environment, at the moment a signature or an
 * address is needed, and nowhere else: test-hq-no-key.mjs scans every other file of the
 * repository for the variable names, key constructors, derivations and signers, and fails on
 * any it finds outside this file.
 *
 * THE DERIVATION, compatible with Solana tooling (Phantom, Solflare, solana-keygen):
 *   · the phrase is a BIP-39 English recovery phrase (12 to 24 words; keygen writes 24),
 *     checked word by word and against its checksum, with no BIP-39 passphrase;
 *   · seed = PBKDF2-HMAC-SHA512(phrase, "mnemonic", 2,048 rounds, 64 bytes) (BIP-39);
 *   · agent N's key = SLIP-0010 ed25519 at m/44'/501'/N'/0' (every level hardened), which is
 *     "account N" in Phantom when the phrase is imported there (Phantom's first account is
 *     N = 0; HQ never uses 0, so agent 001 is Phantom's second account);
 *   · verified in test-hq-wallet.mjs against SLIP-0010's own ed25519 vectors and against
 *     Solana addresses that two independent libraries derive from published phrases.
 *
 * WHAT NEVER LEAVES THIS FILE: the phrase, the BIP-39 seed, any private key, any chain code.
 * What leaves it: public addresses, signatures, signed transactions, and a readiness report
 * that says whether each secret is set and well formed, never what it is. A key exists only
 * while a signature is being made: derived, used, its buffers zeroed. Nothing here writes a
 * file, logs, or puts a secret into an error message.
 *
 * WHAT IT SIGNS: one v0 transaction at a time, only when its message is byte for byte the
 * message the caller's pre-sign check ran on, only when that transaction has exactly one
 * signer and it is the signing wallet (the fee payer), and only behind the live switch:
 * an agent's key signs only with HQ_LIVE=1, the treasury's only with HQ_BUYBACK_LIVE=1.
 * The switches are checked again by the executor, with the agent's own mode; this is the
 * last door, not the only one.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { BIP39_ENGLISH } from "./lib/bip39-english.mjs";

export const DERIVATION_PATH_TEMPLATE = "m/44'/501'/<agent number>'/0'";
/** Agent numbers are 001 to 999 (the contract prints them with three digits). */
export const AGENT_NUMBER_MAX = 999;

export class WalletError extends Error {
  constructor(clause, message) { super(message); this.name = "WalletError"; this.clause = clause; }
}

/** The path agent `n` derives at. */
export function derivationPath(n) {
  if (!(Number.isInteger(n) && n >= 1 && n <= AGENT_NUMBER_MAX)) throw new WalletError("bad_number", `an agent number is a whole number from 1 to ${AGENT_NUMBER_MAX}`);
  return `m/44'/501'/${n}'/0'`;
}

/* ── BIP-39 ────────────────────────────────────────────────────────────────────────── */

const WORD_INDEX = new Map(BIP39_ENGLISH.map((w, i) => [w, i]));
const normalizePhrase = (text) => String(text ?? "").normalize("NFKD").trim().toLowerCase().split(/\s+/).filter(Boolean);

/** Whether a phrase is a well-formed BIP-39 English phrase: { ok, words, why }. Never echoes it. */
export function checkRecoveryPhrase(text) {
  const words = normalizePhrase(text);
  if (![12, 15, 18, 21, 24].includes(words.length)) return { ok: false, words: words.length, why: "a recovery phrase has 12, 15, 18, 21 or 24 words" };
  const unknown = words.filter((w) => !WORD_INDEX.has(w)).length;
  if (unknown) return { ok: false, words: words.length, why: `${unknown} word(s) are not on the BIP-39 English list` };
  /* 11 bits a word: the entropy, then one checksum bit per 32 bits of entropy. */
  let bits = "";
  for (const w of words) bits += WORD_INDEX.get(w).toString(2).padStart(11, "0");
  const checksumBits = bits.length / 33;
  const entropyBits = bits.length - checksumBits;
  const entropy = Buffer.alloc(entropyBits / 8);
  for (let i = 0; i < entropy.length; i++) entropy[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const hash = crypto.createHash("sha256").update(entropy).digest();
  entropy.fill(0);
  const want = [...hash].map((b) => b.toString(2).padStart(8, "0")).join("").slice(0, checksumBits);
  const ok = want === bits.slice(entropyBits);
  return ok ? { ok: true, words: words.length, why: null } : { ok: false, words: words.length, why: "the checksum does not match: a word is wrong or out of order" };
}

/** A new 24-word phrase from 256 bits of entropy. keygen.mjs prints it once; nothing keeps it. */
export function newRecoveryPhrase({ randomBytes = crypto.randomBytes } = {}) {
  const entropy = Buffer.from(randomBytes(32));
  if (entropy.length !== 32) throw new WalletError("entropy", "32 bytes of entropy are needed");
  const hash = crypto.createHash("sha256").update(entropy).digest();
  let bits = [...entropy].map((b) => b.toString(2).padStart(8, "0")).join("") + hash[0].toString(2).padStart(8, "0");
  entropy.fill(0);
  const words = [];
  for (let i = 0; i < 24; i++) words.push(BIP39_ENGLISH[parseInt(bits.slice(i * 11, i * 11 + 11), 2)]);
  bits = "";
  return words.join(" ");
}

function phraseToSeed(text) {
  const words = normalizePhrase(text);
  return crypto.pbkdf2Sync(Buffer.from(words.join(" ").normalize("NFKD"), "utf8"), Buffer.from("mnemonic", "utf8"), 2048, 64, "sha512");
}

/* ── SLIP-0010, ed25519, hardened only ─────────────────────────────────────────────── */

const HARDENED = 0x80000000;
function parsePath(path) {
  const parts = String(path).split("/");
  if (parts[0] !== "m") throw new WalletError("bad_path", "a derivation path starts with m");
  return parts.slice(1).map((p) => {
    const m = /^(\d+)'$/.exec(p);
    if (!m || Number(m[1]) >= HARDENED) throw new WalletError("bad_path", "every level of an ed25519 path is hardened (')");
    return Number(m[1]) + HARDENED;
  });
}
function deriveKey(seed, path) {
  let I = crypto.createHmac("sha512", Buffer.from("ed25519 seed", "utf8")).update(seed).digest();
  let key = I.subarray(0, 32), chain = I.subarray(32);
  for (const index of parsePath(path)) {
    const data = Buffer.alloc(37);
    key.copy(data, 1);
    data.writeUInt32BE(index, 33);
    const next = crypto.createHmac("sha512", chain).update(data).digest();
    data.fill(0); I.fill(0);
    I = next; key = I.subarray(0, 32); chain = I.subarray(32);
  }
  const out = Buffer.from(key);
  I.fill(0);
  return out;
}

/* ── ed25519 through node:crypto ───────────────────────────────────────────────────── */

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");
function privateKeyObject(seed32) {
  const der = Buffer.concat([PKCS8_ED25519, seed32]);
  try { return crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" }); }
  finally { der.fill(0); }
}
const publicKeyOf = (privateKey) => Buffer.from(crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32));

/** The public key SLIP-0010 derives at `path` from a raw seed (hex), as its vectors print it:
 *  "00" then 32 bytes. For the published test vectors; no secret leaves. */
export function slip10PublicKeyHex({ seedHex, path }) {
  const seed = Buffer.from(String(seedHex), "hex");
  const key = deriveKey(seed, path);
  seed.fill(0);
  try { return `00${publicKeyOf(privateKeyObject(key)).toString("hex")}`; } finally { key.fill(0); }
}

/** The Solana address a phrase derives at a path. keygen.mjs shows the first agents' addresses
 *  with it; the tests check published vectors. Only the public address is returned. */
export function addressFromPhrase({ phrase, path }) {
  const check = checkRecoveryPhrase(phrase);
  if (!check.ok) throw new WalletError("bad_phrase", `not a valid recovery phrase: ${check.why}`);
  const seed = phraseToSeed(phrase);
  const key = deriveKey(seed, path);
  seed.fill(0);
  try { return bs58.encode(publicKeyOf(privateKeyObject(key))); } finally { key.fill(0); }
}

/* ── the environment's secrets ─────────────────────────────────────────────────────── */

function masterPhrase(env) {
  const raw = env?.HQ_MASTER_SEED;
  if (typeof raw !== "string" || !raw.trim()) throw new WalletError("no_master_seed", "HQ_MASTER_SEED is not set: agent wallets cannot be derived");
  const check = checkRecoveryPhrase(raw);
  if (!check.ok) throw new WalletError("bad_master_seed", `HQ_MASTER_SEED is not a valid recovery phrase (${check.why})`);
  return raw;
}

/** A 64-byte secret key (base58, or the 64-number array of a keypair file) → its 32-byte seed. */
function parseSecret64(raw, name) {
  const s = String(raw ?? "").trim();
  if (!s) throw new WalletError("no_secret", `${name} is not set`);
  let bytes;
  try {
    if (s.startsWith("[")) {
      const arr = JSON.parse(s);
      if (!Array.isArray(arr) || arr.length !== 64 || !arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error("shape");
      bytes = Buffer.from(arr);
    } else bytes = Buffer.from(bs58.decode(s));
  } catch { throw new WalletError("bad_secret", `${name} is neither a base58 secret key nor a 64-number array`); }
  if (bytes.length !== 64) { bytes.fill(0); throw new WalletError("bad_secret", `${name} does not decode to 64 bytes`); }
  const seed = Buffer.from(bytes.subarray(0, 32));
  const pub = Buffer.from(bytes.subarray(32));
  bytes.fill(0);
  return { seed, pub };
}

const addressCache = new Map();          // `${fingerprint}:${n}` → address (public)
/** A fingerprint of the phrase that is not the phrase: which cache entries belong to it. */
const fingerprintOf = (raw) => crypto.createHash("sha256").update(`cia-hq-address-cache:${normalizePhrase(raw).join(" ")}`).digest("hex").slice(0, 16);

/** Agent `n`'s wallet address. Derived from the phrase once, then remembered (it is public). */
export function agentAddress(n, { env = process.env } = {}) {
  const path = derivationPath(n);
  const raw = masterPhrase(env);
  const cacheKey = `${fingerprintOf(raw)}:${n}`;
  if (addressCache.has(cacheKey)) return addressCache.get(cacheKey);
  const seed = phraseToSeed(raw);
  const key = deriveKey(seed, path);
  seed.fill(0);
  let address;
  try { address = bs58.encode(publicKeyOf(privateKeyObject(key))); } finally { key.fill(0); }
  addressCache.set(cacheKey, address);
  return address;
}

const validAddress = (a) => { try { return typeof a === "string" && new PublicKey(a).toBase58() === a; } catch { return false; } };

/**
 * Whether each secret is present and well formed, and whether the treasury secret belongs to
 * HQ_TREASURY_ADDRESS. Words like "missing" and "ok" only: never a value, a length or a prefix.
 */
export function walletReadiness(env = process.env) {
  const out = { masterSeed: "missing", treasuryAddress: "missing", treasurySecret: "missing" };
  if (typeof env.HQ_MASTER_SEED === "string" && env.HQ_MASTER_SEED.trim()) out.masterSeed = checkRecoveryPhrase(env.HQ_MASTER_SEED).ok ? "ok" : "invalid";
  if (env.HQ_TREASURY_ADDRESS) out.treasuryAddress = validAddress(env.HQ_TREASURY_ADDRESS) ? "ok" : "invalid";
  if (typeof env.HQ_TREASURY_SECRET === "string" && env.HQ_TREASURY_SECRET.trim()) {
    try {
      const { seed, pub } = parseSecret64(env.HQ_TREASURY_SECRET, "HQ_TREASURY_SECRET");
      let derived;
      try { derived = publicKeyOf(privateKeyObject(seed)); } finally { seed.fill(0); }
      out.treasurySecret = !derived.equals(pub) ? "invalid" : out.treasuryAddress !== "ok" ? "no_address" : bs58.encode(derived) === env.HQ_TREASURY_ADDRESS ? "ok" : "mismatch";
    } catch { out.treasurySecret = "invalid"; }
  }
  return Object.freeze(out);
}

/* ── signing ───────────────────────────────────────────────────────────────────────── */

function signWith({ seed32, address, txBase64, expectedMessageBase64 }) {
  let tx;
  try { tx = VersionedTransaction.deserialize(Buffer.from(String(txBase64), "base64")); }
  catch { throw new WalletError("malformed", "the transaction does not decode as a v0 transaction"); }
  const message = Buffer.from(tx.message.serialize());
  if (typeof expectedMessageBase64 !== "string" || !message.equals(Buffer.from(expectedMessageBase64, "base64")))
    throw new WalletError("unchecked", "refusing to sign: the message is not byte for byte the one the pre-sign check ran on");
  if (tx.message.header.numRequiredSignatures !== 1) throw new WalletError("signers", `the transaction asks for ${tx.message.header.numRequiredSignatures} signatures; HQ signs only its own one-signer transactions`);
  const payer = tx.message.staticAccountKeys[0].toBase58();
  if (payer !== address) throw new WalletError("fee_payer", `the fee payer is ${payer}, not the signing wallet ${address}`);
  const privateKey = privateKeyObject(seed32);
  if (bs58.encode(publicKeyOf(privateKey)) !== address) throw new WalletError("key_mismatch", "the key does not belong to the wallet it was asked to sign for");
  const signature = crypto.sign(null, message, privateKey);
  tx.signatures[0] = new Uint8Array(signature);
  if (!Buffer.from(tx.message.serialize()).equals(message)) throw new WalletError("changed", "the message changed while signing");
  return Object.freeze({ signature: bs58.encode(signature), signedBase64: Buffer.from(tx.serialize()).toString("base64") });
}

/**
 * Agent `n` signs one checked transaction. Needs HQ_LIVE=1. The key is derived for this
 * signature and its bytes zeroed before this returns.
 */
export function signAsAgent(n, { txBase64, expectedMessageBase64, env = process.env } = {}) {
  if (env.HQ_LIVE !== "1") throw new WalletError("not_live", "HQ_LIVE is not 1: agent wallets sign nothing");
  const path = derivationPath(n);
  const address = agentAddress(n, { env });
  const seed = phraseToSeed(masterPhrase(env));
  const key = deriveKey(seed, path);
  seed.fill(0);
  try { return signWith({ seed32: key, address, txBase64, expectedMessageBase64 }); } finally { key.fill(0); }
}

/**
 * The treasury signs one checked transaction (a buyback leg or its burn). Needs
 * HQ_BUYBACK_LIVE=1, HQ_TREASURY_SECRET, and HQ_TREASURY_ADDRESS naming the same wallet.
 */
export function signAsTreasury({ txBase64, expectedMessageBase64, env = process.env } = {}) {
  if (env.HQ_BUYBACK_LIVE !== "1") throw new WalletError("not_live", "HQ_BUYBACK_LIVE is not 1: the treasury signs nothing");
  const ready = walletReadiness(env);
  if (ready.treasurySecret !== "ok") throw new WalletError("no_treasury_key", `the treasury key is ${ready.treasurySecret}: set HQ_TREASURY_SECRET for the wallet HQ_TREASURY_ADDRESS names`);
  const { seed, pub } = parseSecret64(env.HQ_TREASURY_SECRET, "HQ_TREASURY_SECRET");
  try { return signWith({ seed32: seed, address: bs58.encode(pub), txBase64, expectedMessageBase64 }); } finally { seed.fill(0); pub.fill(0); }
}

/** A new treasury wallet for keygen.mjs: { address, secretBase58 }. Printed once there, kept nowhere. */
export function newTreasuryKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const seed = Buffer.from(privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32));
  const pub = Buffer.from(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
  const secret = Buffer.concat([seed, pub]);
  seed.fill(0);
  try { return Object.freeze({ address: bs58.encode(pub), secretBase58: bs58.encode(secret) }); } finally { secret.fill(0); }
}

/**
 * The OWNER's signature on an admin command, made on the owner's own machine by admin-client.mjs
 * from a keypair file the owner keeps (solana-keygen's 64-number array, or a base58 secret in a
 * file). The file is read, the message signed, the bytes zeroed; only the signature leaves. HQ
 * itself never holds this key: it knows HQ_OWNER_WALLET, the public address, and verifies.
 */
export function signOwnerMessage({ keypairPath, message }) {
  const raw = fs.readFileSync(keypairPath, "utf8");
  const { seed, pub } = parseSecret64(raw, "the keypair file");
  try {
    const privateKey = privateKeyObject(seed);
    if (!publicKeyOf(privateKey).equals(pub)) throw new WalletError("key_mismatch", "the keypair file's two halves do not belong together");
    return Object.freeze({ address: bs58.encode(pub), signature: bs58.encode(crypto.sign(null, Buffer.from(message, "utf8"), privateKey)) });
  } finally { seed.fill(0); pub.fill(0); }
}
