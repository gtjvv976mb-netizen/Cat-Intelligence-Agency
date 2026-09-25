/**
 * SMALL SOLANA HELPERS SHARED BY BOTH BOTS: addresses, PDAs, borsh, compute budget, and the
 * decoder the pre-sign check reads a transaction with. No key material is handled here.
 */
import { PublicKey, TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import bs58 from "bs58";
import { ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM } from "./verified.mjs";

export const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/** A valid on-curve-or-off-curve 32-byte address, or null. */
export function address(value) {
  if (typeof value !== "string" || !BASE58_ADDRESS.test(value)) return null;
  try { return new PublicKey(value).toBase58() === value ? value : null; } catch { return null; }
}

export const pk = (s) => (s instanceof PublicKey ? s : new PublicKey(s));

/**
 * A PDA. Each seed is either { utf8: "literal" } or { key: <base58 address> } or raw bytes:
 * a base58 string is never guessed at, because "bonding-curve" and a mint are both strings.
 */
export function pda(seeds, programId) {
  const bufs = seeds.map((s) => {
    if (s && typeof s === "object" && "utf8" in s) return Buffer.from(s.utf8, "utf8");
    if (s && typeof s === "object" && "key" in s) return pk(s.key).toBuffer();
    if (s instanceof Uint8Array) return Buffer.from(s);
    throw new Error("a PDA seed must be { utf8 }, { key } or bytes");
  });
  return PublicKey.findProgramAddressSync(bufs, pk(programId))[0].toBase58();
}

export const ata = (owner, tokenProgram, mint) => pda([{ key: owner }, { key: tokenProgram }, { key: mint }], ATA_PROGRAM);

/* ── borsh writers ──────────────────────────────────────────────────────────────────────── */
export const u8 = (n) => Buffer.from([n & 0xff]);
export const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
export const u64 = (n) => {
  const v = BigInt(n);
  if (v < 0n || v > 0xffffffffffffffffn) throw new Error(`u64 out of range: ${v}`);
  const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b;
};
export const bool = (v) => u8(v ? 1 : 0);
export const str = (s) => { const t = Buffer.from(String(s), "utf8"); return Buffer.concat([u32(t.length), t]); };
export const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
export const key = (s) => pk(s).toBuffer();

/** A borsh reader over a buffer; every read is bounds-checked. */
export function reader(buf, offset = 0) {
  let o = offset;
  const need = (n) => { if (o + n > buf.length) throw new Error(`read past the end at ${o}+${n} of ${buf.length}`); };
  return {
    get offset() { return o; },
    u8() { need(1); return buf[o++]; },
    u16() { need(2); const v = buf.readUInt16LE(o); o += 2; return v; },
    u32() { need(4); const v = buf.readUInt32LE(o); o += 4; return v; },
    u64() { need(8); const v = buf.readBigUInt64LE(o); o += 8; return v; },
    u128() { need(16); const lo = buf.readBigUInt64LE(o), hi = buf.readBigUInt64LE(o + 8); o += 16; return (hi << 64n) | lo; },
    bool() { need(1); return buf[o++] === 1; },
    key() { need(32); const v = bs58.encode(buf.subarray(o, o + 32)); o += 32; return v; },
    str() { const n = this.u32(); need(n); const v = buf.subarray(o, o + n).toString("utf8"); o += n; return v; },
    bytes(n) { need(n); const v = buf.subarray(o, o + n); o += n; return v; },
    rest() { return buf.subarray(o); },
  };
}

export const meta = (pubkey, isWritable = false, isSigner = false) => ({ pubkey: pk(pubkey), isWritable, isSigner });

export function instruction(programId, keys, data) {
  return new TransactionInstruction({ programId: pk(programId), keys: keys.map((k) => ({ pubkey: pk(k.pubkey), isWritable: !!k.isWritable, isSigner: !!k.isSigner })), data: Buffer.from(data) });
}

export const computeUnitLimit = (units) => ComputeBudgetProgram.setComputeUnitLimit({ units });
export const computeUnitPrice = (microLamports) => ComputeBudgetProgram.setComputeUnitPrice({ microLamports });

/** Decode a ComputeBudget instruction's data: { kind, value }. */
export function decodeComputeBudget(data) {
  const d = Buffer.from(data);
  if (d[0] === 2 && d.length === 5) return { kind: "limit", value: d.readUInt32LE(1) };
  if (d[0] === 3 && d.length === 9) return { kind: "price", value: d.readBigUInt64LE(1) };
  return { kind: "other", value: null };
}
export { COMPUTE_BUDGET_PROGRAM };

/**
 * A transaction's message, read back into plain data the check can reason about:
 * { feePayer, signers[], instructions: [{ programId, accounts: [{ pubkey, isSigner, isWritable }], data }] }.
 * It reads the COMPILED message (what the signature covers), never the builder's objects: a legacy
 * Message (the bots' Transaction) or a v0 MessageV0 (what the extension builds and its wallets
 * sign). A v0 message that loads accounts from an address lookup table is refused: every account
 * a check reasons about must be in the bytes it read, not in a table someone else controls.
 */
export function readMessage(message) {
  const v0 = Array.isArray(message?.compiledInstructions);
  if (v0 && (message.addressTableLookups ?? []).length) {
    throw Object.assign(new Error("the message loads accounts from an address lookup table; every account must be in the message itself"), { clause: "lookup_tables" });
  }
  const keys = (v0 ? message.staticAccountKeys : message.accountKeys).map((k) => k.toBase58());
  const h = message.header;
  const isSigner = (i) => i < h.numRequiredSignatures;
  const isWritable = (i) => (i < h.numRequiredSignatures
    ? i < h.numRequiredSignatures - h.numReadonlySignedAccounts
    : i < keys.length - h.numReadonlyUnsignedAccounts);
  const ixs = v0
    ? message.compiledInstructions.map((ix) => ({ programIdIndex: ix.programIdIndex, accounts: [...ix.accountKeyIndexes], data: Buffer.from(ix.data) }))
    : message.instructions.map((ix) => ({ programIdIndex: ix.programIdIndex, accounts: ix.accounts, data: Buffer.from(bs58.decode(ix.data)) }));
  return {
    feePayer: keys[0],
    signers: keys.slice(0, h.numRequiredSignatures),
    accountKeys: keys,
    version: v0 ? 0 : "legacy",
    instructions: ixs.map((ix) => ({
      programId: keys[ix.programIdIndex],
      accounts: ix.accounts.map((i) => ({ pubkey: keys[i], isSigner: isSigner(i), isWritable: isWritable(i) })),
      data: ix.data,
    })),
  };
}
