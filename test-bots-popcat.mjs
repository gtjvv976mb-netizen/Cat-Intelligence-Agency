/**
 * POPCAT: CHECKS, NOT ADVICE — EVERY CAT COIN LISTED, NONE MISSED, AT MOST ONE PICK A WINDOW,
 * AND NEVER A CASHCAT COIN.
 *
 * Replayed from what Popcat read about two real cat coins on 2026-09-24
 * (fixtures/bots/popcat/snapshots.json: pump.fun's listing row, the mint, the curve, every
 * holder, the signatures back to the creation, the same-slot buyers, the creator's count, the
 * metadata): the checks come out as they did that day — one coin passing every check, one
 * failing three. Then every threshold at its edge, on inputs changed from those recordings, and
 * the site's plain words for each red flag pinned to the same numbers. The CashCat exclusion and
 * the creator's share read the creator the bonding curve records as well as pump.fun's listing;
 * same-slot transactions it could not read count as buyers; a creation on an exact page of 1,000
 * signatures is still found.
 *
 * Then whole Popcat runs on a scripted pump.fun and chain. The two recorded coins: a dry run
 * writes nothing; a live run publishes both, the passing one as a callout and the failing one as
 * spotted with its red flags named, as the site validates them; a coin made by CashCat's wallet,
 * listed in its launches, or named by its bonding curve on chain is never listed; a name carrying
 * a web address is never printed and is counted as skipped. Then synthetic coins built from those
 * recordings (the same accounts under new addresses, named as built here): a pump.fun listing only
 * so deep, runs every fifteen minutes with one skipped and no cat coin missed, two skipped and the
 * stretch it could not list named in the log; the per-run budget, with the coins left over named
 * and checked next run; a coin whose accounts could not be read, tried again; and the pick — at
 * most one per six-hour window, none when no coin is clean, the same pick whatever the order,
 * never the same coin twice, and a draft with no price, no promise and no "buy". Last, the job
 * summary a run writes for the Actions tab, fed hostile coin names.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { harness, fixture, scriptedFetch, scriptedRpc, response, captureSink } from "./bots/test/doubles.mjs";
import { evaluate, THRESHOLDS, holdersOf, creationAndSameSlot } from "./bots/popcat/checks.mjs";
import { BONDING_CURVE_LAYOUT } from "./vendor/executor/snipe-venue-pumpfun.mjs";
import { copycatOf, ESTABLISHED_CAT_COINS, verifyEstablished } from "./bots/popcat/established.mjs";
import { coinRow, cidOf, readMetadata, newestCoins } from "./bots/popcat/sources.mjs";
import { runPopcat, RUN_LIMITS, RECHECKABLE } from "./bots/popcat/callout.mjs";
import { choosePick, buildDraft, pickDue, windowOf, rankCompare, PICK_RANKING } from "./bots/popcat/pick.mjs";
import { summaryMarkdown, summaryOfError, esc } from "./bots/popcat/summary.mjs";
import { createHash } from "node:crypto";
import { createHttp } from "./bots/lib/http.mjs";
import { createLogger } from "./bots/lib/log.mjs";
import { HOSTS, URLS } from "./bots/lib/verified.mjs";
import { validateCallouts, CHECKS, DRAFT_MAX, DRAFT_BANNED, DRAFT_DISCLOSURE, ticker } from "./site/assets/callouts.js";

const { ok, section, done } = harness("test-bots-popcat");
const snaps = fixture("popcat/snapshots.json").snapshots;
const globalAcc = { owner: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", data: Buffer.from(fixture("pumpfun/global.json").dataBase64, "base64") };

function onchainOf(s) {
  return {
    mintAcc: { owner: s.mintAccount.owner, data: Buffer.from(s.mintAccount.dataBase64, "base64") },
    curveAcc: { owner: s.curveAccount.owner, data: Buffer.from(s.curveAccount.dataBase64, "base64") },
    globalAcc,
    holders: s.holders.list.map((h) => ({ account: h.account, owner: h.owner, amount: BigInt(h.amount) })),
    ...s.creation,
  };
}
const inputsOf = (s) => ({ coin: coinRow(s.apiRow), onchain: onchainOf(s), creatorLaunches: s.creatorLaunchCount, metadata: s.metadata.unreadable ? { ok: false, why: s.metadata.unreadable } : { ok: true, doc: s.metadata }, now: Date.parse(s.read) });
const check = (v, id) => v.checks.find((c) => c.id === id);

section("REPLAYED FROM THE RECORDED CHAIN AND API");
for (const s of snaps) {
  const v = evaluate(inputsOf(s));
  const same = v.checks.every((c, i) => c.id === s.evaluatedThen.checks[i].id && c.result === s.evaluatedThen.checks[i].result && (c.id === "top10_share" || c.value === s.evaluatedThen.checks[i].value));
  ok(`${s.apiRow.name.trim()}: the same twelve checks, the same results`, same && v.pass === s.evaluatedThen.pass, v.failed.join(", ") || "passes every check");
}
ok("one recorded coin passes every check; the other fails top-10/holders, age and curve", evaluate(inputsOf(snaps[0])).pass && evaluate(inputsOf(snaps[1])).failed.join() === "top10_share,age,curve");
ok("every check is shown, twelve of them, and none is advice", evaluate(inputsOf(snaps[0])).checks.length === 12 && !evaluate(inputsOf(snaps[0])).checks.some((c) => /\b(buy|sell|moon|ape)\b/i.test(c.value)));
{
  const st = evaluate(inputsOf(snaps[0])).stats;
  ok("the checks also give what the pick ranks by: holders besides the curve, the top 10's share, the curve sold, and the curve's transactions (not counted in a recording that did not count them)",
    st.holders === 40 && st.top10Pct > 0 && st.top10Pct <= 30 && st.curvePct === 100 && st.txs === null && evaluate({ ...inputsOf(snaps[0]), onchain: { ...inputsOf(snaps[0]).onchain, curveTxs: 812 } }).stats.txs === 812, JSON.stringify(st));
}

section("EVERY RED FLAG IN PLAIN WORDS, WITH THE CHECKS' OWN NUMBERS");
{
  const T = THRESHOLDS;
  const says = (id, ...parts) => parts.every((x) => CHECKS[id].flag.includes(String(x)));
  ok("every check has its red flag in plain words", Object.values(CHECKS).every((c) => typeof c.flag === "string" && c.flag.length > 10 && /[.…)]$/.test(c.flag)));
  ok("the words quote THRESHOLDS: creator 5%, top 10 30% and 25 holders, 2 same-slot buyers, 10 earlier coins, 15 minutes to 24 hours, 10% of the curve",
    says("creator_share", `${T.MAX_CREATOR_SHARE_PCT}%`) && says("top10_share", `${T.MAX_TOP10_SHARE_PCT}%`, `${T.MIN_HOLDERS} holders`) && says("same_slot_buyers", `More than ${T.MAX_SAME_SLOT_BUYERS} other`)
      && says("creator_launches", `more than ${T.MAX_CREATOR_PRIOR_LAUNCHES} coins`) && says("age", `${T.MIN_AGE_MINUTES} minutes`, `${T.MAX_AGE_HOURS} hours`) && says("curve", `${T.MIN_CURVE_PROGRESS_PCT}%`));
  ok("only the two checks whose source may be silent may read \"info\"", Object.entries(CHECKS).filter(([, c]) => c.info).map(([id]) => id).join() === "same_slot_buyers,creator_launches");
  ok("a spotted coin is checked again only for red flags that can clear with time", RECHECKABLE.join() === "creator_share,top10_share,age,curve");
}

section("EVERY THRESHOLD AT ITS EDGE (inputs changed from the recordings)");
const base = inputsOf(snaps[0]);
const supply = base.onchain.mintAcc.data.readBigUInt64LE(36);
const pct = (p) => (supply * BigInt(Math.round(p * 1e6))) / 100_000_000n;
const withHolders = (extra, keep = base.onchain.holders) => ({ ...base, onchain: { ...base.onchain, holders: [...keep, ...extra] } });
{
  const creator = base.coin.creator;
  ok(`creator share: ${THRESHOLDS.MAX_CREATOR_SHARE_PCT}% passes, a hair more fails`,
    check(evaluate(withHolders([{ owner: creator, amount: pct(5) }])), "creator_share").result === "pass" && check(evaluate(withHolders([{ owner: creator, amount: pct(5.01) }])), "creator_share").result === "fail");
  const curveOwned = base.onchain.holders.filter((h) => h.owner === base.coin.curve);
  const many = (n, each) => Array.from({ length: n }, (_, i) => ({ owner: new PublicKey(Buffer.alloc(32, i + 1)).toBase58(), amount: each }));
  const t30 = withHolders([...many(10, pct(3)), ...many(20, 1n)], curveOwned);
  const t31 = withHolders([...many(10, pct(3.1)), ...many(20, 1n)], curveOwned);
  ok(`top-10 share, bonding curve excluded: ${THRESHOLDS.MAX_TOP10_SHARE_PCT}% passes, more fails`, check(evaluate(t30), "top10_share").result === "pass" && check(evaluate(t31), "top10_share").result === "fail", check(evaluate(t30), "top10_share").value);
  const h24 = withHolders(many(24, 1000n), curveOwned), h25 = withHolders(many(25, 1000n), curveOwned);
  ok(`at least ${THRESHOLDS.MIN_HOLDERS} holders besides the curve`, check(evaluate(h24), "top10_share").result === "fail" && check(evaluate(h25), "top10_share").result === "pass");
  ok("the bonding curve's own account never counts toward the top 10", check(evaluate(withHolders([], curveOwned)), "top10_share").value.startsWith("0.00%"));
}
{
  const buyers = (n) => ({ ...base, onchain: { ...base.onchain, sameSlotBuyers: Array.from({ length: n }, (_, i) => `b${i}`) } });
  ok(`same-slot buyers: ${THRESHOLDS.MAX_SAME_SLOT_BUYERS} pass, one more fails`, check(evaluate(buyers(2)), "same_slot_buyers").result === "pass" && check(evaluate(buyers(3)), "same_slot_buyers").result === "fail");
  ok("a creation beyond the paging limit reads \"not reached\" (info), not a guess", check(evaluate({ ...base, onchain: { ...base.onchain, createSig: null } }), "same_slot_buyers").result === "info");
  ok(`creator's earlier coins: ${THRESHOLDS.MAX_CREATOR_PRIOR_LAUNCHES} pass, ${THRESHOLDS.MAX_CREATOR_PRIOR_LAUNCHES + 1} fail, unknown is "not available"`,
    check(evaluate({ ...base, creatorLaunches: 11 }), "creator_launches").result === "pass" && check(evaluate({ ...base, creatorLaunches: 12 }), "creator_launches").result === "fail" && check(evaluate({ ...base, creatorLaunches: null }), "creator_launches").result === "info");
  const created = base.onchain.createTime * 1000;
  const at = (min) => evaluate({ ...base, now: created + min * 60_000 });
  ok(`age: under ${THRESHOLDS.MIN_AGE_MINUTES} minutes fails, ${THRESHOLDS.MIN_AGE_MINUTES} passes, over ${THRESHOLDS.MAX_AGE_HOURS} hours fails`,
    check(at(14.9), "age").result === "fail" && check(at(15), "age").result === "pass" && check(at(24 * 60 + 1), "age").result === "fail");
}
{
  const fresh = inputsOf(snaps[1]);
  const curveWith = (sold) => { const d = Buffer.from(fresh.onchain.curveAcc.data); d.writeBigUInt64LE(793_100_000_000_000n - (793_100_000_000_000n * BigInt(Math.round(sold * 100))) / 10_000n, 24); return { ...fresh, onchain: { ...fresh.onchain, curveAcc: { ...fresh.onchain.curveAcc, data: d } } }; };
  ok(`curve: ${THRESHOLDS.MIN_CURVE_PROGRESS_PCT}% sold passes, 9.99% fails, and the value says the market cap in SOL`,
    check(evaluate(curveWith(10)), "curve").result === "pass" && check(evaluate(curveWith(9.99)), "curve").result === "fail" && /SOL/.test(check(evaluate(curveWith(10)), "curve").value));
  ok("a graduated curve passes as graduated", check(evaluate(base), "curve").value === "graduated");
}
{
  const mint = Buffer.from(base.onchain.mintAcc.data);
  const withMintAuth = Buffer.from(mint); withMintAuth.writeUInt32LE(1, 0); new PublicKey(base.coin.creator).toBuffer().copy(withMintAuth, 4);
  const withFreeze = Buffer.from(mint); withFreeze.writeUInt32LE(1, 46); new PublicKey(base.coin.creator).toBuffer().copy(withFreeze, 50);
  const m = (data) => evaluate({ ...base, onchain: { ...base.onchain, mintAcc: { ...base.onchain.mintAcc, data } } });
  ok("a live mint authority fails", check(m(withMintAuth), "mint_authority").result === "fail");
  ok("a live freeze authority fails (and the extension audit refuses it on Token-2022)", check(m(withFreeze), "freeze_authority").result === "fail" && check(m(withFreeze), "mint_extensions").result === "fail");
  const cwif = fixture("popcat/established-mints.json").accounts.find((a) => a.address === "7atgF8KQo4wJrD5ATGX7t1V2zVvykPJbFfNeVf1icFv1");
  const tf = evaluate({ ...base, onchain: { ...base.onchain, mintAcc: { owner: cwif.owner, data: Buffer.from(cwif.dataBase64, "base64") } } });
  ok("a Token-2022 transfer fee (the recorded catwifhat mint) fails the extension audit", check(tf, "mint_extensions").result === "fail", check(tf, "mint_extensions").value);
  ok("no socials in the metadata fails; unreadable metadata fails", check(evaluate({ ...base, metadata: { ok: true, doc: { name: "x" } } }), "socials").result === "fail" && check(evaluate({ ...base, metadata: { ok: false, why: "unreadable" } }), "socials").result === "fail");
}

section("COPYCATS, AGAINST THE ESTABLISHED CAT COINS");
{
  ok("six established cat coins, each verified and strict on Jupiter as recorded", ESTABLISHED_CAT_COINS.length === 6 && fixture("popcat/established-jupiter.json").tokens.every((t) => t.isVerified && t.tags.includes("strict")));
  ok("their recorded mints read as live mints with supply", fixture("popcat/established-mints.json").accounts.every((a) => /^Token/.test(a.owner) && Buffer.from(a.dataBase64, "base64").readBigUInt64LE(36) > 0n));
  const accs = fixture("popcat/established-mints.json").accounts;
  const rpc = scriptedRpc({ getMultipleAccounts: ([list]) => ({ value: list.map((k) => { const a = accs.find((x) => x.address === k); return a ? { owner: a.owner, lamports: a.lamports, data: [a.dataBase64, "base64"] } : null; }) }) });
  ok("re-reading them finds none stale", (await verifyEstablished(rpc)).length === 0);
  ok("\"Popcat\", \"$POPCAT\", \"MEW\", \"michi\", \"catwifhat\", \"shark cat\" are copies", ["Popcat", "$POPCAT", "MEW", "michi", "catwifhat", "shark cat"].every((n) => copycatOf({ name: n, symbol: "ZZZ" }) || copycatOf({ name: "zzz", symbol: n })));
  ok("a coin is never a copy of itself, and \"Pop Cat Party\" is not a copy", !copycatOf({ name: "Popcat", symbol: "POPCAT", mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr" }) && !copycatOf({ name: "Pop Cat Party", symbol: "PCP" }));
  ok("a copy fails its callout, naming the coin it copies", check(evaluate({ ...base, coin: { ...base.coin, name: "Popcat" } }), "copycat").result === "fail" && /Popcat/.test(check(evaluate({ ...base, coin: { ...base.coin, name: "Popcat" } }), "copycat").value));
}

section("NEVER A CASHCAT COIN, BY WHAT THE CHAIN SAYS AS WELL AS PUMP.FUN'S LISTING");
{
  const CASHCAT = "FFWtrEQ4B4PKQoVuHYzZq8FabGkVatYzDpEVHsK5rrhF";
  const curveData = Buffer.from(base.onchain.curveAcc.data);
  new PublicKey(CASHCAT).toBuffer().copy(curveData, BONDING_CURVE_LAYOUT.creator);
  const byChain = { ...base, onchain: { ...base.onchain, curveAcc: { ...base.onchain.curveAcc, data: curveData } } };
  ok("a coin whose bonding curve names CashCat's wallet as its creator fails not_cashcat, whatever the listing says",
    check(evaluate({ ...byChain, cashcat: { mints: new Set(), wallets: new Set([CASHCAT]) } }), "not_cashcat").result === "fail");
  ok("and the creator's share counts what the curve's creator holds too", check(evaluate({ ...byChain, onchain: { ...byChain.onchain, holders: [...base.onchain.holders, { owner: CASHCAT, amount: pct(6) }] } }), "creator_share").result === "fail");
}

section("THE CHAIN READS");
{
  const s = snaps[1];
  const raw = s.holders.list.map((h) => { const b = Buffer.alloc(40); new PublicKey(h.owner).toBuffer().copy(b, 0); b.writeBigUInt64LE(BigInt(h.amount), 32); return { pubkey: h.account, account: { data: [b.toString("base64"), "base64"] } }; });
  const rpc = scriptedRpc({ getProgramAccounts: ([prog, opts]) => { if (opts.filters[0].memcmp.bytes !== s.apiRow.mint || opts.dataSlice.offset !== 32) throw new Error("unexpected query"); return raw; } });
  const h = await holdersOf({ rpc, mint: s.apiRow.mint, tokenProgram: s.mintAccount.owner });
  ok("holders come from getProgramAccounts filtered by the mint, owner and amount read from a 40-byte slice", h.length === raw.length && h.every((x, i) => x.owner === s.holders.list[i].owner && x.amount === BigInt(s.holders.list[i].amount)));
  const creator = "C".repeat(0) + s.apiRow.creator;
  const sigs = [{ signature: "s3", slot: 12 }, { signature: "s2", slot: 10 }, { signature: "s1b", slot: 10 }, { signature: "s1c", slot: 10, err: { x: 1 } }, { signature: "s1", slot: 10, blockTime: 1000 }];
  const payers = { s2: "Buyer111111111111111111111111111111111111111", s1b: creator };
  const rpc2 = scriptedRpc({ getSignaturesForAddress: () => sigs, getTransaction: ([sig]) => ({ transaction: { message: { accountKeys: [payers[sig]] } } }) });
  const c = await creationAndSameSlot({ rpc: rpc2, curve: s.apiRow.bonding_curve, creator });
  ok("the creation is the oldest signature; same-slot buyers are the other fee payers in its slot, the creator and failed ones left out", c.createSig === "s1" && c.createSlot === 10 && c.sameSlotBuyers.length === 1 && c.sameSlotBuyers[0].startsWith("Buyer"));
  {
    /* Exactly 1,000 signatures: the second page is empty, and the creation is the last of the first. */
    const thousand = Array.from({ length: 1000 }, (_, i) => ({ signature: `t${i}`, slot: 2000 - i, blockTime: 5000 - i }));
    const rpc3 = scriptedRpc({ getSignaturesForAddress: ([, o]) => (o.before ? [] : thousand), getTransaction: () => null });
    const c3 = await creationAndSameSlot({ rpc: rpc3, curve: s.apiRow.bonding_curve, creator });
    ok("a curve with exactly 1,000 signatures still finds its creation", c3.createSig === "t999" && c3.createSlot === 1001, JSON.stringify(c3).slice(0, 120));
    /* Twelve other transactions in the creation slot, only the first eight read, all by the creator. */
    const crowded = [...Array.from({ length: 12 }, (_, i) => ({ signature: `x${i}`, slot: 10 })), { signature: "c0", slot: 10, blockTime: 1000 }];
    const rpc4 = scriptedRpc({ getSignaturesForAddress: () => crowded, getTransaction: () => ({ transaction: { message: { accountKeys: [creator] } } }) });
    const c4 = await creationAndSameSlot({ rpc: rpc4, curve: s.apiRow.bonding_curve, creator });
    const v4 = evaluate({ ...base, onchain: { ...base.onchain, ...c4 } });
    ok("same-slot transactions it did not read, or could not, count as buyers it cannot rule out: the check fails", check(v4, "same_slot_buyers").result === "fail", check(v4, "same_slot_buyers").value);
  }
  ok("pump.fun metadata is read by CID only", cidOf("https://ipfs.io/ipfs/QmdZQP9jUWvH3j2yLDVhpYuG5ovWCNbeDMmW85vusUyWFr") === "QmdZQP9jUWvH3j2yLDVhpYuG5ovWCNbeDMmW85vusUyWFr" && cidOf("https://evil.example/ipfs/Qm" + "a".repeat(44)) === null);
  const { fetchImpl, calls } = scriptedFetch([["https://pump.mypinata.cloud/ipfs/", () => response(403, "no")], ["https://gateway.pinata.cloud/ipfs/", () => ({ name: "x", twitter: "https://x.com/a" })]]);
  const http = createHttp({ fetchImpl, allowedHosts: Object.values(HOSTS), sleep: async () => {} });
  const md = await readMetadata({ http, uri: "https://ipfs.io/ipfs/QmdZQP9jUWvH3j2yLDVhpYuG5ovWCNbeDMmW85vusUyWFr" });
  ok("pump.fun's gateway refusing (403, as it did for some CIDs that day) falls back to Pinata's", md.ok && calls.length === 2);
  ok("a metadata URI on any other host is not fetched at all", !(await readMetadata({ http, uri: "https://evil.example/x.json" })).ok && calls.length === 2);
}

section("A WHOLE POPCAT RUN, ON A SCRIPTED PUMP.FUN AND CHAIN");
const MIN = 60_000, HOUR = 3_600_000;
const GLOBAL_ADDR = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf";
const encodeHolder = (h) => { const b = Buffer.alloc(40); new PublicKey(h.owner).toBuffer().copy(b); b.writeBigUInt64LE(BigInt(h.amount), 32); return { pubkey: h.account, account: { data: [b.toString("base64"), "base64"] } }; };
const acc = (a) => (a ? { owner: a.owner, lamports: 1, data: [a.dataBase64, "base64"] } : null);
const established = (k) => fixture("popcat/established-mints.json").accounts.find((a) => a.address === k);
const readFile = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));

/* The recorded pump.fun and chain: the two recorded cat coins and one that is not a cat. The clock
   is ten minutes after the recording by default, so the failing coin (eight minutes old then) is
   old enough to check. */
function popWorld({ env = {}, launches = [], model = null, rename = null, breakCurve = false, curveCreator = null, at = Date.parse(snaps[0].read) + 10 * MIN } = {}) {
  const passing = snaps[0], failing = snaps[1];
  const notCat = { ...failing.apiRow, mint: "So11111111111111111111111111111111111111112", name: "Dog Money", symbol: "DOGM", description: "a dog", bonding_curve: failing.apiRow.bonding_curve };
  const rows = [rename ? { ...passing.apiRow, name: rename } : passing.apiRow, failing.apiRow, notCat];
  const byMint = Object.fromEntries(snaps.map((s) => [s.apiRow.mint, s]));
  const { fetchImpl } = scriptedFetch([
    [/frontend-api-v3\.pump\.fun\/coins\?offset=0&limit=50&sort=created_timestamp/, () => rows],
    [/frontend-api-v3\.pump\.fun\/coins\?offset=\d+&limit=50&sort=created_timestamp/, () => []],
    [/frontend-api-v3\.pump\.fun\/coins\?offset=\d+&limit=50&sort=last_trade_timestamp/, () => []],
    [/frontend-api-v3\.pump\.fun\/coins-v2\/user-created-coins\//, (u) => ({ count: snaps.find((s) => u.includes(s.apiRow.creator))?.creatorLaunchCount ?? 0, coins: [] })],
    [/\/ipfs\//, (u) => { const s = snaps.find((x) => u.endsWith(cidOf(x.apiRow.metadata_uri))); return s && !s.metadata.unreadable ? s.metadata : response(404, "{}"); }],
  ]);
  const http = createHttp({ fetchImpl, allowedHosts: Object.values(HOSTS), sleep: async () => {} });
  const curveOf = (s) => {
    if (breakCurve && s === passing) return { ...s.curveAccount, owner: "11111111111111111111111111111111" };
    if (curveCreator && s === passing) { const d = Buffer.from(s.curveAccount.dataBase64, "base64"); new PublicKey(curveCreator).toBuffer().copy(d, BONDING_CURVE_LAYOUT.creator); return { ...s.curveAccount, dataBase64: d.toString("base64") }; }
    return s.curveAccount;
  };
  const rpc = scriptedRpc({
    getMultipleAccounts: ([list]) => ({ value: list.map((k) => {
      const s = byMint[k] ?? Object.values(byMint).find((x) => x.apiRow.bonding_curve === k);
      if (k === GLOBAL_ADDR) return acc({ owner: globalAcc.owner, dataBase64: fixture("pumpfun/global.json").dataBase64 });
      if (s && byMint[k]) return acc(s.mintAccount);
      if (s) return acc(curveOf(s));
      return acc(established(k));
    }) }),
    getProgramAccounts: ([, opts]) => (byMint[opts.filters[0].memcmp.bytes]?.holders.list ?? []).map(encodeHolder),
    getSignaturesForAddress: ([addr]) => { const s = Object.values(byMint).find((x) => x.apiRow.bonding_curve === addr); return s ? [...s.creation.sameSlotBuyers.map((b, i) => ({ signature: `same${i}`, slot: s.creation.createSlot })), { signature: s.creation.createSig, slot: s.creation.createSlot, blockTime: s.creation.createTime }] : []; },
    getTransaction: ([sig]) => { const s = snaps[0]; const i = Number(String(sig).replace("same", "")); return { transaction: { message: { accountKeys: [s.creation.sameSlotBuyers[i]] } } }; },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "popcat-"));
  fs.writeFileSync(path.join(dir, "launches.json"), JSON.stringify({ launches }));
  const cap = captureSink();
  const log = createLogger({ sink: cap.sink });
  const run = () => runPopcat({ env, http, rpc, model: model ?? { hasKey: false }, dataDir: dir, log, now: () => at });
  return { run, dir, cap, rpc };
}
const checkedOnChain = (rpc, mint) => rpc.calls.some((c) => c.method === "getProgramAccounts" && c.params[1].filters[0].memcmp.bytes === mint);
const [PASSING, FAILING] = [snaps[0].apiRow.mint, snaps[1].apiRow.mint];
{
  const dry = popWorld();
  const r = await dry.run();
  ok("a dry run checks both recorded cat coins and writes nothing", r.mode === "dry" && r.entries.length === 2 && r.counts.callouts === 1 && r.counts.spotted === 1
    && !fs.existsSync(path.join(dry.dir, "callouts.json")) && !fs.existsSync(path.join(dry.dir, "popcat-state.json")), JSON.stringify(r.counts));
  ok("the not-a-cat coin was never checked on chain", !checkedOnChain(dry.rpc, "So11111111111111111111111111111111111111112"));
  const live = popWorld({ env: { POPCAT_LIVE: "1" } });
  const r2 = await live.run();
  const file = readFile(live.dir, "callouts.json");
  const v = validateCallouts(file);
  const [called, spotted] = [v.callouts.find((c) => c.mint === PASSING), v.callouts.find((c) => c.mint === FAILING)];
  ok("a live run publishes every cat coin it checked, as the site validates them: the passing one as a callout, the failing one as spotted",
    r2.mode === "live" && file.callouts.length === 2 && v.problems.length === 0 && called?.callout === true && called.verdict === "NO RED FLAGS FOUND" && spotted?.callout === false, v.problems.join(" | "));
  ok("the spotted coin carries its red flags, each in plain words: too few holders, too little of its curve sold",
    spotted?.verdict === "RED FLAGS (2)" && spotted.flags.map((f) => f.id).join() === "top10_share,curve" && spotted.flags.every((f) => f.flag === CHECKS[f.id].flag && f.value.length > 0));
  ok("both show all twelve checks, with the stats the pick ranks by, and no link or image of the coin's own (socials are named, never linked)",
    v.callouts.every((c) => c.checks.length === 12 && Number.isInteger(c.stats.holders)) && !JSON.stringify(file.callouts).match(/https?:|ipfs\/|x\.com\//));
  const st = readFile(live.dir, "popcat-state.json");
  ok("it remembers what it checked, and queues the spotted coin for one more look in an hour (its red flags can clear)",
    st.checked[PASSING]?.verdict === "no red flags" && /^red flags/.test(st.checked[FAILING]?.verdict) && st.pending[FAILING]?.n === 1 && st.pending[FAILING].due > Date.parse(snaps[0].read) + 60 * MIN && !st.pending[PASSING]);
  const again = await live.run();
  ok("the same coin is not listed twice, and a spotted coin is not checked again before its hour is up", again.entries.length === 0 && readFile(live.dir, "callouts.json").callouts.length === 2);
  const early = popWorld({ env: { POPCAT_LIVE: "1" }, at: snaps[1].apiRow.created_timestamp + 15.5 * MIN });
  const re = await early.run();
  const waitsFor = readFile(early.dir, "popcat-state.json").pending[FAILING];
  ok("a coin pump.fun lists as 15 minutes old but the chain says is younger waits for its age, never flagged for it",
    !re.entries.some((c) => c.mint === FAILING) && waitsFor?.n === 0 && waitsFor.tries === 0 && waitsFor.due === snaps[1].creation.createTime * 1000 + THRESHOLDS.MIN_AGE_MINUTES * MIN);
  const testEnv = popWorld({ env: { POPCAT_LIVE: "1", NODE_ENV: "test" } });
  ok("a test environment is never live", (await testEnv.run()).mode === "dry");
}
{
  const byWallet = popWorld({ env: { POPCAT_LIVE: "1", CASHCAT_WALLET_ADDRESS: snaps[0].apiRow.creator } });
  const r = await byWallet.run();
  ok("a coin whose creator is CashCat's wallet (CASHCAT_WALLET_ADDRESS) is never listed, nor even checked", !r.entries.some((c) => c.mint === PASSING) && r.skipped.cashcat === 1 && !checkedOnChain(byWallet.rpc, PASSING));
  const launch = { time: "2026-09-24T20:00:00Z", venue: "pumpfun", name: "Asset Cat", symbol: "ASSCAT", tagline: "A launch record for the exclusion test.", trend: { title: "x", source: "google-trends" },
    mint: PASSING, creator: "FFWtrEQ4B4PKQoVuHYzZq8FabGkVatYzDpEVHsK5rrhF", tx: fixture("pumpfun/create-v2-samples.json").samples[0].signature, quote: { symbol: "SOL", mint: "So11111111111111111111111111111111111111112" }, devBuy: { sol: 0 }, costSol: 0.005, kitten: "black" };
  const byList = popWorld({ env: { POPCAT_LIVE: "1" }, launches: [launch] });
  const rl0 = await byList.run();
  ok("a coin in CashCat's launches is never listed", !rl0.entries.some((c) => c.mint === PASSING) && !readFile(byList.dir, "callouts.json").callouts.some((c) => c.mint === PASSING));
  const CASHCAT = "FFWtrEQ4B4PKQoVuHYzZq8FabGkVatYzDpEVHsK5rrhF";
  const byChain = popWorld({ env: { POPCAT_LIVE: "1", CASHCAT_WALLET_ADDRESS: CASHCAT }, curveCreator: CASHCAT });
  const rc = await byChain.run();
  ok("a coin whose bonding curve names CashCat's wallet on chain, whatever pump.fun lists, is checked and then never listed or picked",
    checkedOnChain(byChain.rpc, PASSING) && !rc.entries.some((c) => c.mint === PASSING) && rc.pick.pick?.mint !== PASSING && readFile(byChain.dir, "popcat-state.json").checked[PASSING]?.verdict === "cashcat");
  const declined = popWorld({ model: { hasKey: true, callTool: async () => ({ cat_themed: false, fit_to_print: true, reason: "not about a cat" }) } });
  ok("with a model key, a coin the model says is not a cat is not listed", (await declined.run()).entries.length === 0);
  const linked = popWorld({ env: { POPCAT_LIVE: "1" }, rename: "Asset Cat at assetcat.xyz" });
  const rn = await linked.run();
  ok("a coin whose name carries a web address is never printed, nor even checked on chain: counted as skipped",
    !rn.entries.some((c) => c.mint === PASSING) && rn.skipped.unprintable === 1 && !checkedOnChain(linked.rpc, PASSING) && !JSON.stringify(readFile(linked.dir, "callouts.json")).includes("assetcat")
      && !linked.cap.lines.some((l) => l.includes("assetcat")) && !summaryMarkdown(rn).includes("assetcat"));
  const broken = popWorld({ env: { POPCAT_LIVE: "1" }, breakCurve: true });
  let rb;
  try { rb = await broken.run(); } catch (e) { rb = { threw: e.message }; }
  ok("a coin whose bonding curve does not decode is dropped by name, and the run goes on to the end", !rb.threw && rb.mode === "live" && !rb.entries.some((c) => c.mint === PASSING) && rb.dropped.some((d) => d.mint === PASSING) && rb.entries.length === 1, JSON.stringify(rb.dropped ?? rb).slice(0, 160));
}

section("THE LISTING, AND NO CAT COIN MISSED ACROSS A SKIPPED RUN (synthetic coins)");
/* Synthetic coins, named as built here: the recorded passing coin's accounts (or the failing one's)
   under new addresses, listed by a scripted pump.fun that, like the real one, lists only so deep. */
const addrOf = (seed) => new PublicKey(createHash("sha256").update(`popcat-test:${seed}`).digest()).toBase58();
function synthWorld({ depth = 1050, env = { POPCAT_LIVE: "1" }, launches = [] } = {}) {
  let clock = 0, n = 0;
  const rows = [], chain = new Map(), byCurve = new Map(), failOnce = new Set();
  const add = ({ name, symbol, kind = "clean", createdMs, extraHolders = 0, txs = 1, cat = true }) => {
    const i = n++;
    const mint = addrOf(`mint-${i}`), curve = addrOf(`curve-${i}`), creator = addrOf(`creator-${i}`);
    const base = kind === "clean" ? snaps[0] : snaps[1];
    rows.push({ ...base.apiRow, mint, bonding_curve: curve, creator, name: name ?? (cat ? `Synth Cat ${i}` : `Dog Coin ${i}`), symbol: symbol ?? (cat ? `SYN${i}` : `DOG${i}`), description: "", created_timestamp: createdMs, is_banned: false, nsfw: false });
    if (cat) { chain.set(mint, { base, curve, createdMs, extraHolders, txs }); byCurve.set(curve, mint); }
    return mint;
  };
  const { fetchImpl } = scriptedFetch([
    [/sort=created_timestamp/, (u) => { const off = Number(new URL(u).searchParams.get("offset")); return off >= depth ? [] : rows.filter((r) => r.created_timestamp <= clock).sort((a, b) => b.created_timestamp - a.created_timestamp).slice(off, off + 50); }],
    [/sort=last_trade_timestamp/, () => []],
    [/user-created-coins/, () => ({ count: 1, coins: [] })],
    [/\/ipfs\//, (u) => { const s = snaps.find((x) => u.endsWith(cidOf(x.apiRow.metadata_uri))); return s ? s.metadata : response(404, "{}"); }],
  ]);
  const http = createHttp({ fetchImpl, allowedHosts: Object.values(HOSTS), sleep: async () => {} });
  const rpc = scriptedRpc({
    getMultipleAccounts: ([list]) => {
      if (failOnce.has(list[0])) { failOnce.delete(list[0]); throw Object.assign(new Error("getMultipleAccounts: scripted outage"), { clause: "rate_limited" }); }
      return { value: list.map((k) => {
        if (k === GLOBAL_ADDR) return acc({ owner: globalAcc.owner, dataBase64: fixture("pumpfun/global.json").dataBase64 });
        if (chain.has(k)) return acc(chain.get(k).base.mintAccount);
        if (byCurve.has(k)) return acc(chain.get(byCurve.get(k)).base.curveAccount);
        return acc(established(k));
      }) };
    },
    getProgramAccounts: ([, opts]) => {
      const mint = opts.filters[0].memcmp.bytes, c = chain.get(mint);
      if (!c) return [];
      const list = c.base.holders.list.map((h) => ({ ...h, owner: h.owner === c.base.apiRow.bonding_curve ? c.curve : h.owner }));
      for (let k = 0; k < c.extraHolders; k++) list.push({ account: addrOf(`acct-${mint}-${k}`), owner: addrOf(`holder-${mint}-${k}`), amount: "1" });
      return list.map(encodeHolder);
    },
    getSignaturesForAddress: ([address]) => {
      const mint = byCurve.get(address);
      if (!mint) return [];
      const c = chain.get(mint), t = Math.floor(c.createdMs / 1000);
      return [...Array.from({ length: c.txs - 1 }, (_, k) => ({ signature: `tx-${mint.slice(0, 8)}-${k}`, slot: 5000 + c.txs - k, blockTime: t + 60 })), { signature: `create-${mint.slice(0, 8)}`, slot: 4000, blockTime: t }];
    },
    getTransaction: () => null,
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "popcat-synth-"));
  fs.writeFileSync(path.join(dir, "launches.json"), JSON.stringify({ launches }));
  const run = async (at) => {
    clock = at;
    const cap = captureSink();
    const r = await runPopcat({ env, http, rpc, model: { hasKey: false }, dataDir: dir, log: createLogger({ sink: cap.sink }), now: () => clock });
    return { r, lines: cap.lines };
  };
  const file = () => (fs.existsSync(path.join(dir, "callouts.json")) ? validateCallouts(readFile(dir, "callouts.json"), { exclude: launches }) : { callouts: [], picks: [], problems: [] });
  return { add, run, file, dir, rpc, failOnce, state: () => readFile(dir, "popcat-state.json") };
}
const T12 = Date.UTC(2026, 8, 25, 12, 7);   // a run at 12:07 UTC, as the schedule has it
{
  /* Three coins a minute, one in five a cat coin, and a listing only 100 coins deep: about 33 minutes. */
  const build = () => {
    const w = synthWorld({ depth: 100 });
    const cats = [];
    for (let k = 0, at = T12 - 60 * MIN; at <= T12 + 100 * MIN; k++, at += 20_000) {
      if (k % 5 === 0) cats.push({ at, mint: w.add({ createdMs: at, kind: k % 10 === 0 ? "clean" : "flagged" }) });
      else w.add({ createdMs: at, cat: false });
    }
    return { w, cats };
  };
  {
    const { w, cats } = build();
    const times = [0, 30, 45, 60, 75, 90].map((m) => T12 + m * MIN);   // every fifteen minutes; the 12:22 run never came
    const runs = [];
    for (const at of times) runs.push(await w.run(at));
    const published = new Set(w.file().callouts.map((c) => c.mint));
    const reach = runs[0].r.listing.oldestMs, last = times[times.length - 1];
    const due = cats.filter((c) => c.at >= reach && c.at <= last - THRESHOLDS.MIN_AGE_MINUTES * MIN);
    const inSkipped = due.filter((c) => c.at > T12 && c.at <= T12 + 15 * MIN);
    ok("with the 12:22 run skipped, the 12:37 run reads back to where 12:07's listing began, and says so", runs[1].r.listing.covered === true && runs[1].r.listing.gap === null && !runs.some((x) => x.lines.some((l) => /MISSED/.test(l))));
    ok(`no cat coin missed: all ${due.length} created from the first listing's reach to fifteen minutes before the last run are listed, the ${inSkipped.length} made around the skipped run among them`,
      due.length > 40 && inSkipped.length > 5 && due.every((c) => published.has(c.mint)), `${due.filter((c) => !published.has(c.mint)).length} missing`);
    ok("coins younger than fifteen minutes wait in the queue rather than being checked or skipped", cats.filter((c) => c.at > last - THRESHOLDS.MIN_AGE_MINUTES * MIN && c.at <= last).every((c) => !published.has(c.mint) && w.state().pending[c.mint]?.n === 0));
    ok("spotted coins and callouts both reach the file, one entry per coin, and the file validates", w.file().problems.length === 0 && w.file().callouts.some((c) => c.callout) && w.file().callouts.some((c) => !c.callout));
  }
  {
    const { w, cats } = build();
    const a = await w.run(T12), b = await w.run(T12 + 45 * MIN);   // 12:22 and 12:37 both skipped
    const gap = b.r.listing.gap;
    const lost = cats.filter((c) => gap && c.at > gap.fromMs && c.at < gap.toMs);
    ok("two skipped runs outrun the listing: the stretch it could not read is named in the log and in the summary, never passed over quietly",
      gap && gap.fromMs === a.r.listing.newestMs && b.lines.some((l) => /MISSED: pump\.fun's listing ran out/.test(l)) && /could not be listed/.test(summaryMarkdown(b.r)) && lost.length > 0,
      gap ? `${Math.round((gap.toMs - gap.fromMs) / MIN)} minutes, ${lost.length} cat coin(s)` : "no gap");
  }
}
{
  /* A listing that fails part-way is read again next run, so the stretch is not lost. */
  const rows = Array.from({ length: 120 }, (_, i) => ({ ...snaps[1].apiRow, mint: addrOf(`p-${i}`), bonding_curve: addrOf(`pc-${i}`), creator: addrOf(`pk-${i}`), name: `Dog ${i}`, symbol: `D${i}`, created_timestamp: T12 - i * 10_000 }));
  let fail = true;
  const { fetchImpl } = scriptedFetch([[/sort=created_timestamp/, (u) => { const off = Number(new URL(u).searchParams.get("offset")); if (off === 50 && fail) return response(500, "{}"); return rows.slice(off, off + 50); }]]);
  const http = createHttp({ fetchImpl, allowedHosts: Object.values(HOSTS), sleep: async () => {}, defaults: { ...(await import("./bots/lib/http.mjs")).HTTP_DEFAULTS, retries: 0 } });
  const l = await newestCoins({ http, untilMs: T12 - 30 * MIN, maxPages: 25 });
  fail = false;
  const l2 = await newestCoins({ http, untilMs: T12 - 15 * MIN, maxPages: 25 });
  ok("the listing says how far it read and why it stopped: a failed page (kept pages read), reaching the last listing, or running out",
    l.stoppedBy && /page 2 failed/.test(l.stoppedBy) && l.pages === 1 && !l.reached && l2.reached && l2.pages === 2);
}

section("THE BUDGET, AND WHAT FAILED TO READ");
{
  const w = synthWorld();
  const mints = Array.from({ length: RUN_LIMITS.maxChecksPerRun + 7 }, (_, i) => w.add({ createdMs: T12 - 40 * MIN + i * 1000, kind: "clean" }));
  const first = await w.run(T12);
  const leftLine = first.lines.find((l) => /over this run's budget/.test(l)) ?? "";
  ok(`a run checks at most ${RUN_LIMITS.maxChecksPerRun} coins, oldest first, and names the ones left for the next run`,
    first.r.counts.checked === RUN_LIMITS.maxChecksPerRun && first.r.counts.left === 7 && mints.slice(-7).every((m) => leftLine.includes(m)) && mints.slice(0, RUN_LIMITS.maxChecksPerRun).every((m) => first.r.entries.some((e) => e.mint === m)));
  const second = await w.run(T12 + 15 * MIN);
  ok("the next run checks them", second.r.counts.checked === 7 && mints.every((m) => w.file().callouts.some((c) => c.mint === m)));
}
{
  const w = synthWorld();
  const m = w.add({ createdMs: T12 - 30 * MIN });
  w.failOnce.add(m);
  const first = await w.run(T12);
  ok("a coin whose accounts could not be read waits in the queue, its try counted", !first.r.entries.some((e) => e.mint === m) && w.state().pending[m]?.tries === 1 && first.lines.some((l) => /tried 1 of 3 times/.test(l)));
  const second = await w.run(T12 + 15 * MIN);
  ok("and is checked on the next run", second.r.entries.some((e) => e.mint === m) && !w.state().pending[m]);
  const w2 = synthWorld();
  const m2 = w2.add({ createdMs: T12 - 30 * MIN });
  for (const [i, at] of [T12, T12 + 15 * MIN, T12 + 30 * MIN].entries()) { w2.failOnce.add(m2); const x = await w2.run(at); if (i === 2) ok(`after ${RUN_LIMITS.maxReadTries} failed tries it is dropped, by name`, x.r.dropped.some((d) => d.mint === m2) && x.lines.some((l) => l.includes("DROPPED") && l.includes(m2))); }
}
{
  const w = synthWorld();
  const m = w.add({ createdMs: T12 - 30 * MIN });
  await w.run(T12);
  w.add({ createdMs: T12 + 10 * MIN, cat: false });
  const late = await w.run(T12 + (THRESHOLDS.MAX_AGE_HOURS + 1) * HOUR);
  ok("a coin a day old leaves the queue; one never checked is named as dropped (none here: it was checked)", !late.r.dropped.some((d) => d.mint === m));
  const w2 = synthWorld();
  const m2 = w2.add({ createdMs: T12 - 5 * MIN });                        // too young at 12:07
  await w2.run(T12);
  const late2 = await w2.run(T12 + (THRESHOLDS.MAX_AGE_HOURS + 1) * HOUR);  // the next run comes a day later
  ok("…and a queued coin no run reached before it was a day old is dropped and named, never silently", late2.r.dropped.some((d) => d.mint === m2 && /24 hours/.test(d.why)));
}

section("POPCAT'S PICK");
{
  const at = (h, m = 0) => Date.UTC(2026, 8, 25, h, m);
  ok("the windows start at 00, 06, 12 and 18 UTC", [[0, 5], [6, 0], [12, 7], [17, 59], [23, 59]].every(([h, m]) => new Date(windowOf(at(h, m)).start).getUTCHours() === Math.floor(h / 6) * 6));
  ok("a pick is due at the first run in a window that was not tried yet, and only then", pickDue({ pickWindow: null }, at(12, 7)) && pickDue({ pickWindow: "2026-09-25T06:00:00Z" }, at(12, 7)) && !pickDue({ pickWindow: "2026-09-25T12:00:00Z" }, at(12, 22)));
  const e = (mint, holders, txs, curvePct, over = {}) => ({ mint, creator: mint, name: "Tie Cat", symbol: "TIE", time: "2026-09-25T11:00:00Z", callout: true, stats: { holders, top10Pct: 12.5, curvePct, txs }, ...over });
  const [A, B, C] = [addrOf("a"), addrOf("b"), addrOf("c")].sort();
  const now = at(12, 7);
  ok("ranked by holders, then transactions on the curve, then the curve sold", choosePick({ entries: [e(A, 50, 10, 20), e(B, 60, 1, 1)], now }).pick.mint === B
    && choosePick({ entries: [e(A, 50, 10, 20), e(B, 50, 11, 1)], now }).pick.mint === B && choosePick({ entries: [e(A, 50, 10, 20), e(B, 50, 10, 21)], now }).pick.mint === B
    && choosePick({ entries: [e(A, 50, null, 20), e(B, 50, 0, 1)], now }).pick.mint === B && PICK_RANKING.map((r) => r.key).join() === "holders,txs,curvePct");
  ok("a tie on all three goes to the mint that sorts first, whatever order the coins come in", choosePick({ entries: [e(C, 9, 9, 9), e(A, 9, 9, 9), e(B, 9, 9, 9)], now }).pick.mint === A
    && choosePick({ entries: [e(B, 9, 9, 9), e(C, 9, 9, 9), e(A, 9, 9, 9)], now }).pick.mint === A && rankCompare(e(A, 9, 9, 9), e(A, 9, 9, 9)) === 0);
  ok("none when no coin checked in the six hours before is clean: spotted coins, older checks and coins already picked do not count",
    choosePick({ entries: [e(A, 99, 9, 9, { callout: false })], now }).pick === null
      && choosePick({ entries: [e(A, 99, 9, 9, { time: "2026-09-25T06:07:00Z" })], now }).pick === null
      && choosePick({ entries: [e(A, 99, 9, 9, { time: "2026-09-25T06:08:00Z" })], now }).pick?.mint === A
      && choosePick({ entries: [e(A, 99, 9, 9)], picked: new Set([A]), now }).pick === null && choosePick({ entries: [], now }).pick === null);
  const p = choosePick({ entries: [e(A, 6127, 5000, 100)], now }).pick;
  ok("the pick names its window, when it was chosen, when its checks ran, and the facts it was chosen on", p.window === "2026-09-25T12:00:00Z" && p.time === "2026-09-25T12:07:00Z" && p.checked === "2026-09-25T11:00:00Z" && p.stats.holders === 6127);
  ok("the site's validator takes it", validateCallouts({ callouts: [], picks: [p] }).problems.length === 0);
}
{
  const PROMISE = /\b(buy|buying|sell|moon|gem|ape|pump|profit|gain|guarantee\w*|safe|price|market ?cap|mcap|will|soon|next|\d+x|x\d+|lfg|don'?t miss|early|entry|target)\b/i;
  const names = ["Asset Cat", "cosmic cat protocol", "A".repeat(38) + " C", "Kitty 🐈 Party", "$Meow"].flatMap((name) => ["CAT", "$Meow", "K".repeat(16)].map((symbol) => ({ name, symbol })));
  const stats = [{ holders: 25, top10Pct: 29.99, curvePct: 10, txs: 1 }, { holders: 99_999_999, top10Pct: 0.01, curvePct: 100, txs: 5000 }, { holders: 312, top10Pct: 18.2, curvePct: 42.5, txs: null }];
  const drafts = names.flatMap((n) => stats.map((s) => buildDraft({ ...n, mint: addrOf("d"), creator: addrOf("d"), time: "2026-09-25T11:37:04Z", callout: true, stats: s })));
  ok(`every draft is at most ${DRAFT_MAX} characters, opens with the name and ticker, ends with the disclosure, and carries no price, promise or "buy"`,
    drafts.length === 45 && drafts.every((d) => d && d.length <= DRAFT_MAX && d.endsWith(DRAFT_DISCLOSURE) && !PROMISE.test(d) && !DRAFT_BANNED.test(d)), drafts.find((d) => !d || d.length > DRAFT_MAX || PROMISE.test(d)) ?? `longest ${Math.max(...drafts.map((d) => d.length))}`);
  ok("it says no red flags in twelve on-chain checks, and when", drafts[0].startsWith("Asset Cat ($CAT): no red flags in 12 on-chain checks at 11:37 UTC."), drafts[0]);
  ok("the ticker carries one \"$\", whatever the coin wrote", drafts.filter((d) => d.includes("($$")).length === 0 && ticker("$Meow") === "$Meow" && ticker("MEOW") === "$MEOW");
  const bad = ["Moon Cat", "Buy The Cat", "100x Kitty", "Safe Cat", "Cat Pump"].map((name) => buildDraft({ name, symbol: "CAT", mint: addrOf("x"), creator: addrOf("x"), time: "2026-09-25T11:37:04Z", callout: true, stats: stats[2] }));
  ok("a coin whose own name carries such a word gets no draft, so it is never picked", bad.every((d) => d === null));
  const [A, B] = [addrOf("m1"), addrOf("m2")].sort();
  const c = choosePick({ entries: [{ mint: A, creator: A, name: "Moon Cat", symbol: "MOON", time: "2026-09-25T11:00:00Z", callout: true, stats: { holders: 900, top10Pct: 9, curvePct: 50, txs: 50 } },
    { mint: B, creator: B, name: "Plain Cat", symbol: "PLAIN", time: "2026-09-25T11:00:00Z", callout: true, stats: { holders: 30, top10Pct: 9, curvePct: 50, txs: 50 } }], now: Date.UTC(2026, 8, 25, 12, 7) });
  ok("the next coin down is picked instead, and the one passed over is counted", c.pick?.mint === B && c.passedOver.length === 1);
}
{
  /* Whole runs: at most one pick a window, a new one in the next window, never the same coin twice. */
  const w = synthWorld();
  const first = [10, 300, 40, 300].map((extra, i) => w.add({ createdMs: T12 - 50 * MIN + i * MIN, extraHolders: extra, txs: i + 1 }));
  const a = await w.run(T12), b = await w.run(T12 + 15 * MIN);
  ok("the first run in the 12:00 window picks the best clean coin: most holders, then most transactions", a.r.pick.pick?.mint === first[3] && w.file().picks.length === 1 && w.file().picks[0].window === "2026-09-25T12:00:00Z");
  ok("a later run in the same window makes no second pick", b.r.pick.due === false && b.r.pick.pick === null && w.file().picks.length === 1 && b.lines.some((l) => /was tried by an earlier run/.test(l)));
  const later = [5, 7].map((extra, i) => w.add({ createdMs: T12 + 5 * HOUR + i * MIN, extraHolders: extra }));
  await w.run(T12 + 5 * HOUR + 45 * MIN);
  const c = await w.run(T12 + 6 * HOUR);
  const picks = w.file().picks;
  ok("the next window gets its own pick, from coins checked in the six hours before it, never a coin picked before",
    c.r.pick.pick && picks.length === 2 && picks[0].window === "2026-09-25T18:00:00Z" && picks[0].mint === later[1] && picks[0].mint !== picks[1].mint && w.file().problems.length === 0);
  ok("each pick's draft is in the file, within the rules", picks.every((p) => p.draft.length <= DRAFT_MAX && p.draft.endsWith(DRAFT_DISCLOSURE)));
}
{
  const w = synthWorld();
  w.add({ createdMs: T12 - 40 * MIN, kind: "flagged" });
  const a = await w.run(T12);
  ok("no pick when no coin checked in the six hours before is clean, and the window is marked tried", a.r.pick.due && a.r.pick.pick === null && w.file().picks.length === 0 && w.state().pickWindow === "2026-09-25T12:00:00Z"
    && /No pick for 12:00 to 18:00 UTC/.test(summaryMarkdown(a.r)));
  const clean = w.add({ createdMs: T12 - 10 * MIN, kind: "clean" });
  const b = await w.run(T12 + 15 * MIN);
  ok("a clean coin found later in the same window waits for the next window's pick", b.r.pick.pick === null && b.r.entries.some((e) => e.mint === clean && e.callout));
  const c = await w.run(T12 + 6 * HOUR);
  ok("…and is picked then, as it was checked within the six hours before", c.r.pick.pick?.mint === clean);
}

section("THE JOB SUMMARY, AGAINST HOSTILE NAMES");
{
  const hostile = ["<script>alert(1)</script>", "**bold** _it_ ~x~", "[x](javascript:alert(1))", "| a | b |", "::add-mask::secret", "`code`", "@octocat #1", "https://evil.example/x", "a\n\n# heading", "<img src=x onerror=alert(1)>", "&lt;b&gt;"];
  const mint = addrOf("h");
  const entryOf = (name, i) => ({ mint: addrOf(`h${i}`), creator: mint, name, symbol: name.slice(0, 16), callout: i % 2 === 0, flags: i % 2 ? [{ id: "curve", label: CHECKS.curve.label, flag: CHECKS.curve.flag, value: name }] : [] });
  const r = {
    mode: "live", at: T12, listing: { pages: 3, covered: true, stoppedBy: hostile[0], newestMs: T12, oldestMs: T12 - 40 * MIN, gap: null },
    counts: { read: 150, queued: 11, checked: 11, callouts: 6, spotted: 5, waiting: 2, left: 0, dropped: 1 },
    entries: hostile.map(entryOf), dropped: [{ mint, name: hostile[1], symbol: hostile[2], why: hostile[3] }],
    pick: { due: true, windowStart: Date.UTC(2026, 8, 25, 12), pool: 3, passedOver: 0,
      pick: { window: "2026-09-25T12:00:00Z", time: "2026-09-25T12:07:00Z", checked: "2026-09-25T11:37:04Z", mint, creator: mint, name: hostile.join(" "), symbol: hostile[5], stats: { holders: 1, top10Pct: 1, curvePct: 1, txs: 1 }, draft: hostile.join(" ") } },
  };
  const md = summaryMarkdown(r);
  const lines = md.split("\n");
  const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  ok("nothing a coin wrote can open a tag, a link, emphasis, a table or a code span: every character but letters, digits and spaces is a numbered reference",
    !/<script|<img|onerror=|\]\(|\*\*|`|\| a \||javascript:|https:\/\/evil|@octocat|::add-mask/.test(md) && decode(md).includes("<script>alert(1)</script>") && decode(md).includes("[x](javascript:alert(1))"));
  ok("every line of it is HTML or blank, so none can start a heading, a list or a workflow command", lines.every((l) => l === "" || l.startsWith("<")) && !lines.some((l) => l.startsWith("::")));
  ok("no blank line inside a block, so no block ends early and lets Markdown in", md.split("\n\n").filter(Boolean).every((b) => b.trim().startsWith("<") && b.trim().endsWith(">")));
  ok("the pick, its window and its draft are there, the draft in a <pre> of its own, with the rules for posting it and the disclosure",
    /<h3>Popcat's pick for 12:00 to 18:00 UTC on 2026-09-25<\/h3>/.test(md) && /<pre>[^\n]*<\/pre>/.test(md) && /Post it only by hand/.test(md) && md.includes(esc("The agency may post Popcat's pick as a callout on pump.fun")));
  ok("the only link is the coin's pump.fun page, built from a checked address", [...md.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).join() === `https://pump.fun/coin/${mint}`);
  ok("a run that stopped says why, escaped the same way", summaryOfError("<b>boom</b> ::x").includes("&#60;b&#62;boom") && !summaryOfError("<b>boom</b>").includes("<b>boom"));
}

done();
