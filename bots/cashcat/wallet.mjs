/**
 * CASHCAT'S WALLET: THE ONE FILE IN bots/ THAT MAY HOLD A KEY.
 *
 * The secret comes from the environment variable CASHCAT_WALLET_SECRET only (a GitHub
 * Actions secret in the workflow), as the base58 string Phantom exports or as a 64-number JSON
 * array. It is parsed here, into memory, and never written anywhere: no file, no log line, no
 * error message, no return value. What leaves this module is the public key and signatures.
 * It is CashCat's own wallet, never the owner's main wallet: the owner creates a fresh one
 * for it and funds it with only what it may spend (see the README).
 *
 * The same goes for a launch's MINT keypair: it is generated here, signs the one create
 * transaction, and is dropped. After the create the mint's authority belongs to the venue's
 * program, so that key is worth nothing afterwards; it still never leaves this file.
 *
 * test-bots-no-leak.mjs pins that no other file under bots/ constructs a Keypair, reads a
 * secret key or signs, and that nothing a run prints contains the secret.
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export class WalletError extends Error {
  constructor(clause, message) { super(message); this.name = "WalletError"; this.clause = clause; }
}

function parseSecret(raw) {
  const s = String(raw ?? "").trim();
  if (!s) throw new WalletError("no_wallet", "CASHCAT_WALLET_SECRET is not set");
  let bytes;
  try {
    if (s.startsWith("[")) {
      const arr = JSON.parse(s);
      if (!Array.isArray(arr) || arr.length !== 64 || !arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error();
      bytes = Uint8Array.from(arr);
    } else {
      bytes = bs58.decode(s);
    }
  } catch {
    throw new WalletError("bad_wallet", "CASHCAT_WALLET_SECRET is neither a base58 secret key nor a 64-number array");
  }
  if (bytes.length !== 64) throw new WalletError("bad_wallet", "CASHCAT_WALLET_SECRET does not decode to 64 bytes");
  try {
    /* A copy: web3.js keeps the array it is given, so the decoded buffer can be wiped after. */
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    throw new WalletError("bad_wallet", "CASHCAT_WALLET_SECRET is not a valid Solana keypair");
  } finally {
    bytes.fill(0);
  }
}

/**
 * The wallet, from the environment. Returns { publicKey, sign(tx, extraSigners), newMint() }
 * or null when no secret is set (a dry run without a wallet).
 */
export function walletFromEnv(env = process.env) {
  if (!env.CASHCAT_WALLET_SECRET) return null;
  const keypair = parseSecret(env.CASHCAT_WALLET_SECRET);
  const publicKey = keypair.publicKey.toBase58();
  const mints = new Map(); // mint address → Keypair, for the one transaction each signs

  return Object.freeze({
    publicKey,
    /** A fresh mint for one launch. Only its address leaves this module. */
    newMint() {
      const k = Keypair.generate();
      const address = k.publicKey.toBase58();
      mints.set(address, k);
      return address;
    },
    /**
     * Sign a legacy Transaction whose message has ALREADY passed txcheck.mjs. `mint` names the
     * launch's mint when the transaction needs its signature. The message bytes are compared
     * before and after, so a signature is only ever over the checked message.
     */
    sign(tx, { checkedMessage, mint = null } = {}) {
      if (!Buffer.isBuffer(checkedMessage)) throw new WalletError("unchecked", "refusing to sign a transaction whose message was not checked");
      const before = tx.serializeMessage();
      if (!before.equals(checkedMessage)) throw new WalletError("changed", "the message is not the one that was checked");
      const signers = [keypair];
      if (mint) {
        const m = mints.get(mint);
        if (!m) throw new WalletError("no_mint", "this mint was not made by this wallet");
        signers.push(m);
      }
      tx.sign(...signers);
      if (!tx.serializeMessage().equals(checkedMessage)) throw new WalletError("changed", "the message changed while signing");
      if (mint) mints.delete(mint);
      return tx;
    },
    /** A launch that will not happen drops its mint key. */
    forgetMint(mint) { mints.delete(mint); },
    toJSON() { return { publicKey }; },
  });
}

/** For a dry run with no wallet set: an address to build and simulate with, and no key. */
export function throwawayAddress() {
  return Keypair.generate().publicKey.toBase58();
}
