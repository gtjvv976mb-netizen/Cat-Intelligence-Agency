/**
 * PUMP.FUN, SOL-QUOTED: CashCat's create_v2, its optional dev buy, and the creator-fee claim.
 *
 * Built by hand from the program's own on-chain IDL (bots/lib/verified.mjs says where and
 * when it was read), not through any third-party transaction API.
 *
 * create_v2 — sixteen accounts, every one derived from (mint, user) and matched, index by
 * index, against eleven real create_v2 transactions read on 2026-09-24
 * (fixtures/bots/pumpfun/create-v2-samples.json; test-bots-pumpfun.mjs re-derives all of
 * them and re-encodes their data byte for byte):
 *
 *    0 mint                 signer, writable   (a fresh keypair, made and held in wallet.mjs)
 *    1 mint_authority       PDA ["mint-authority"]
 *    2 bonding_curve        PDA ["bonding-curve", mint]                  writable
 *    3 associated_bonding_curve  ATA(bonding_curve, Token-2022, mint)     writable
 *    4 global               PDA ["global"]
 *    5 user                 signer, writable   (CashCat's wallet, the fee payer)
 *    6 system program   7 Token-2022   8 associated token program
 *    9 mayhem program       writable (as the IDL declares and the tape shows)
 *   10 global_params        PDA ["global-params"] on the mayhem program
 *   11 sol_vault            PDA ["sol-vault"] on the mayhem program          writable
 *   12 mayhem_state         PDA ["mayhem-state", mint] on the mayhem program writable
 *   13 mayhem_token_vault   ATA(sol_vault, Token-2022, mint)                  writable
 *   14 event_authority      PDA ["__event_authority"]
 *   15 program
 *
 * Arguments: name, symbol, uri (borsh strings), creator (the wallet), is_mayhem_mode false,
 * is_cashback_enabled false, creator_fee_bps 0, is_holder_reward false — the all-zero tail
 * most of the sampled real launches sent. Coins created that way were charging a 30 bps
 * creator fee on trades the same minute (their TradeEvents, 2026-09-24), which accrues to
 * PDA ["creator-vault", creator] in lamports.
 *
 * collect_creator_fee — five accounts [creator (writable), creator_vault (writable), system,
 * event_authority, program], no arguments, matched against a real claim
 * (fixtures/bots/pumpfun/collect-creator-fee.json). It pays the vault to the creator.
 * PumpSwap's post-graduation creator fees are NOT claimed: that path was not verified here.
 *
 * The dev buy, when the owner sets one (≤ 0.05 SOL; 0 by default), is a SEPARATE transaction
 * after the create has landed, from the same wallet, built by the executor's proven buy_v2
 * encoder against the curve as read back from the chain.
 */
import {
  PUMPFUN_PROGRAM, PUMPFUN_GLOBAL, PUMPFUN_MINT_AUTHORITY, PUMPFUN_EVENT_AUTHORITY, PUMPFUN_MAYHEM_PROGRAM,
  PUMPFUN_MAYHEM_GLOBAL_PARAMS, PUMPFUN_MAYHEM_SOL_VAULT, SYSTEM_PROGRAM, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, ATA_PROGRAM,
  IX, ACCOUNT_DISC, WSOL_MINT,
} from "../lib/verified.mjs";
import { pda, ata, str, key, bool, u64, meta, instruction, reader } from "../lib/solana.mjs";
import {
  buyIx, decodeBuyIx, decodeBondingCurve, decodeGlobalFeeRecipients,
} from "../../vendor/executor/snipe-venue-pumpfun.mjs";

export const CREATE_V2_ACCOUNT_NAMES = Object.freeze(["mint", "mint_authority", "bonding_curve", "associated_bonding_curve", "global", "user",
  "system_program", "token_program", "associated_token_program", "mayhem_program_id", "global_params", "sol_vault", "mayhem_state",
  "mayhem_token_vault", "event_authority", "program"]);

/** pump.fun's own limits on the strings, from its frontend form and the samples. */
export const PUMP_LIMITS = Object.freeze({ name: 32, symbol: 10, uri: 200 });

export function createV2Accounts({ mint, user }) {
  const curve = pda([{ utf8: "bonding-curve" }, { key: mint }], PUMPFUN_PROGRAM);
  return [
    meta(mint, true, true),
    meta(pda([{ utf8: "mint-authority" }], PUMPFUN_PROGRAM)),
    meta(curve, true),
    meta(ata(curve, TOKEN_2022_PROGRAM, mint), true),
    meta(pda([{ utf8: "global" }], PUMPFUN_PROGRAM)),
    meta(user, true, true),
    meta(SYSTEM_PROGRAM),
    meta(TOKEN_2022_PROGRAM),
    meta(ATA_PROGRAM),
    meta(PUMPFUN_MAYHEM_PROGRAM, true),
    meta(pda([{ utf8: "global-params" }], PUMPFUN_MAYHEM_PROGRAM)),
    meta(pda([{ utf8: "sol-vault" }], PUMPFUN_MAYHEM_PROGRAM), true),
    meta(pda([{ utf8: "mayhem-state" }, { key: mint }], PUMPFUN_MAYHEM_PROGRAM), true),
    meta(ata(pda([{ utf8: "sol-vault" }], PUMPFUN_MAYHEM_PROGRAM), TOKEN_2022_PROGRAM, mint), true),
    meta(pda([{ utf8: "__event_authority" }], PUMPFUN_PROGRAM)),
    meta(PUMPFUN_PROGRAM),
  ];
}

export function encodeCreateV2({ name, symbol, uri, creator, isMayhemMode = false, isCashbackEnabled = false, creatorFeeBps = 0n, isHolderReward = false }) {
  if (Buffer.byteLength(name) > PUMP_LIMITS.name || Buffer.byteLength(symbol) > PUMP_LIMITS.symbol || Buffer.byteLength(uri) > PUMP_LIMITS.uri)
    throw new Error("name, symbol or uri is longer than pump.fun accepts");
  return Buffer.concat([Buffer.from(IX.pumpCreateV2, "hex"), str(name), str(symbol), str(uri), key(creator),
    bool(isMayhemMode), bool(isCashbackEnabled), u64(creatorFeeBps), bool(isHolderReward)]);
}

/** Decode create_v2 data back (the pre-sign check reads the bytes, not the builder's inputs). */
export function decodeCreateV2(data) {
  const d = Buffer.from(data);
  if (d.subarray(0, 8).toString("hex") !== IX.pumpCreateV2) throw new Error("not a create_v2 instruction");
  const r = reader(d, 8);
  const out = { name: r.str(), symbol: r.str(), uri: r.str(), creator: r.key() };
  const rest = r.rest();
  out.isMayhemMode = rest.length >= 1 ? rest[0] === 1 : false;
  out.isCashbackEnabled = rest.length >= 2 ? rest[1] === 1 : false;
  out.creatorFeeBps = rest.length >= 10 ? rest.readBigUInt64LE(2) : 0n;
  out.isHolderReward = rest.length >= 11 ? rest[10] === 1 : false;
  out.tailBytes = rest.length;
  return out;
}

export function createV2Ix({ mint, user, name, symbol, uri }) {
  return instruction(PUMPFUN_PROGRAM, createV2Accounts({ mint, user }), encodeCreateV2({ name, symbol, uri, creator: user }));
}

/* ── the creator fee ──────────────────────────────────────────────────────────────────── */

export const creatorVault = (creator) => pda([{ utf8: "creator-vault" }, { key: creator }], PUMPFUN_PROGRAM);

export function collectCreatorFeeIx({ creator }) {
  return instruction(PUMPFUN_PROGRAM, [
    meta(creator, true),
    meta(creatorVault(creator), true),
    meta(SYSTEM_PROGRAM),
    meta(pda([{ utf8: "__event_authority" }], PUMPFUN_PROGRAM)),
    meta(PUMPFUN_PROGRAM),
  ], Buffer.from(IX.pumpCollectCreatorFee, "hex"));
}

/* ── Global ───────────────────────────────────────────────────────────────────────────── */

/** The fields of Global CashCat reads, at the offsets the live IDL declares. */
export function decodeGlobalForLaunch(data) {
  const b = Buffer.from(data);
  if (b.subarray(0, 8).toString("hex") !== ACCOUNT_DISC.pumpGlobal) throw new Error("not pump.fun's Global account");
  if (b.length < 1087) throw new Error(`Global is ${b.length} bytes; the live IDL's layout is 1,087`);
  return {
    initialVirtualTokenReserves: b.readBigUInt64LE(73),
    initialVirtualSolReserves: b.readBigUInt64LE(81),
    initialRealTokenReserves: b.readBigUInt64LE(89),
    tokenTotalSupply: b.readBigUInt64LE(97),
    feeBasisPoints: b.readBigUInt64LE(105),
    createV2Enabled: b[450] === 1,
    feeRecipients: decodeGlobalFeeRecipients(b),
  };
}

/* ── the dev buy (optional, second transaction) ───────────────────────────────────────── */

/**
 * A buy_v2 for `spendLamports` in total, against the curve as read at `curveReadSlot`. The
 * token amount asked for assumes up to 2% of fees on top of the curve input and keeps a 1%
 * margin, so the spend ceiling (maxQuoteInRaw = spendLamports) is what binds; the simulation
 * must then show the wallet paying no more than that plus the network fee and account rent.
 */
export function devBuyIxs({ mint, user, curveAccount, curveReadSlot, globalAccount, spendLamports }) {
  const curve = decodeBondingCurve(curveAccount, { mint });
  if (curve.creator !== user) throw new Error("the curve's creator is not CashCat's wallet");
  if (!curve.quoteIsSol) throw new Error("the curve is not SOL-quoted");
  const g = decodeGlobalForLaunch(Buffer.from(globalAccount.data ?? globalAccount));
  const spend = BigInt(spendLamports);
  const curveIn = (spend * 10_000n) / 10_200n;
  const out = (curve.vBaseRaw * curveIn) / (curve.vQuoteRaw + curveIn);
  const amountRaw = (out * 99n) / 100n;
  if (amountRaw <= 0n) throw new Error("the dev buy is too small to buy anything");
  const sets = g.feeRecipients;
  const pool = curve.isMayhemMode ? sets.mayhemFeeRecipients : sets.standardFeeRecipients;
  const associatedBaseUser = ata(user, TOKEN_2022_PROGRAM, mint);
  const buy = buyIx({
    mint, user, curve, curveReadSlot,
    feeRecipient: pool[0], buybackFeeRecipient: sets.buybackFeeRecipients[0],
    baseTokenProgram: TOKEN_2022_PROGRAM, quoteTokenProgram: TOKEN_PROGRAM,
    associatedBaseUser, associatedBaseUserOwner: user, globalFeeRecipients: sets,
    amountRaw, maxQuoteInRaw: spend,
  });
  /* The wallet's own Token-2022 account for the new mint, created idempotently (ATA program
     instruction 1). */
  const createAta = instruction(ATA_PROGRAM, [
    meta(user, true, true), meta(associatedBaseUser, true), meta(user), meta(mint), meta(SYSTEM_PROGRAM), meta(TOKEN_2022_PROGRAM),
  ], Buffer.from([1]));
  return { ixs: [createAta, instruction(buy.programId, buy.keys, buy.data)], amountRaw, associatedBaseUser };
}

/* ── pump.fun Custom Pairs: a curve quoted in a tokenised stock ──────────────────────────
 *
 * Verified on 2026-09-24 three ways: (1) a real GLDx-quoted create_v2 (tx 2PpxRxE3…vdUG, slot
 * 446,086,957) carries the sixteen accounts above plus four more — the quote mint, the
 * curve's associated account for it, the quote's token program, and the QuoteControl PDA
 * ["quote-control"]; (2) that QuoteControl account (7,108 bytes, the live IDL's layout)
 * lists 175 quote mints, SPYx, TSLAx, GLDx and other xStocks among them; (3) CashCat's own
 * create_v2 with those four accounts for SPYx SIMULATED WITHOUT ERROR on mainnet
 * (fixtures/bots/pumpfun/custom-pair.json). The IDL does not declare the four extra
 * accounts, which is why a launch here is simulated and refused on any error, like every
 * launch. Claiming the creator fees such a coin earns (in the stock, collect_creator_fee_v2)
 * was NOT verified and is not done: they stay in the creator vault until claimed by hand.
 */
export const quoteControlAddress = () => pda([{ utf8: "quote-control" }], PUMPFUN_PROGRAM);
export const QUOTE_CONTROL_DISC = "38f423eec1d5a2c9"; // sha256("account:QuoteControl")[0..8], equal to the live account's first 8 bytes

export function decodeQuoteControl(data) {
  const b = Buffer.from(data);
  if (b.subarray(0, 8).toString("hex") !== QUOTE_CONTROL_DISC) throw new Error("not pump.fun's QuoteControl account");
  const r = reader(b, 8);
  const admin = r.key();
  r.bytes(64);
  const n = r.u32();
  const mints = [];
  for (let i = 0; i < n; i++) mints.push({ mint: r.key(), initialVirtualQuoteReserves: r.u64() });
  return { admin, mints };
}

export function customPairAccounts({ mint, quoteMint, quoteTokenProgram }) {
  const curve = pda([{ utf8: "bonding-curve" }, { key: mint }], PUMPFUN_PROGRAM);
  return [meta(quoteMint), meta(ata(curve, quoteTokenProgram, quoteMint), true), meta(quoteTokenProgram), meta(quoteControlAddress())];
}

export function createV2CustomPairIx({ mint, user, name, symbol, uri, quoteMint, quoteTokenProgram }) {
  return instruction(PUMPFUN_PROGRAM, [...createV2Accounts({ mint, user }), ...customPairAccounts({ mint, quoteMint, quoteTokenProgram })],
    encodeCreateV2({ name, symbol, uri, creator: user }));
}

export { decodeBuyIx };
export const PUMPFUN_FIXED = Object.freeze({ PUMPFUN_GLOBAL, PUMPFUN_MINT_AUTHORITY, PUMPFUN_EVENT_AUTHORITY, PUMPFUN_MAYHEM_GLOBAL_PARAMS, PUMPFUN_MAYHEM_SOL_VAULT, WSOL_MINT });
