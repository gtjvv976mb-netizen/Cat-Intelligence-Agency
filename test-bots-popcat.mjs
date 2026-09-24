/**
 * POPCAT: CHECKS, NOT ADVICE — AND NEVER A CASHCAT COIN.
 *
 * Replayed from what Popcat read about two real cat coins on 2026-09-24
 * (fixtures/bots/popcat/snapshots.json: pump.fun's listing row, the mint, the curve, every
 * holder, the signatures back to the creation, the same-slot buyers, the creator's count, the
 * metadata): the checks come out as they did that day — one coin passing every check, one
 * failing three. Then every threshold at its edge, on inputs changed from those recordings:
 * creator share, top-10 share and holder count, same-slot buyers, the creator's earlier coins,
 * age, curve progress, the mint and freeze authorities, a Token-2022 transfer fee (the recorded
 * catwifhat mint), socials, and the copycat flag against the established cat coins (whose
 * recorded mints are re-read). Then a whole Popcat run on a scripted pump.fun and chain: a dry
 * run writes nothing; a live run publishes exactly the passing coin, as the site validates it;
 * and a coin made by CashCat's wallet, or listed in its launches, is never called out.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { harness, fixture, scriptedFetch, scriptedRpc, response, captureSink } from "./bots/test/doubles.mjs";
import { evaluate, THRESHOLDS, holdersOf, creationAndSameSlot } from "./bots/popcat/checks.mjs";
import { copycatOf, ESTABLISHED_CAT_COINS, verifyEstablished } from "./bots/popcat/established.mjs";
import { coinRow, cidOf, readMetadata } from "./bots/popcat/sources.mjs";
import { runPopcat } from "./bots/popcat/callout.mjs";
import { createHttp } from "./bots/lib/http.mjs";
import { createLogger } from "./bots/lib/log.mjs";
import { HOSTS, URLS } from "./bots/lib/verified.mjs";
import { validateCallouts } from "./site/assets/callouts.js";

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
  ok("pump.fun metadata is read by CID only", cidOf("https://ipfs.io/ipfs/QmdZQP9jUWvH3j2yLDVhpYuG5ovWCNbeDMmW85vusUyWFr") === "QmdZQP9jUWvH3j2yLDVhpYuG5ovWCNbeDMmW85vusUyWFr" && cidOf("https://evil.example/ipfs/Qm" + "a".repeat(44)) === null);
  const { fetchImpl, calls } = scriptedFetch([["https://pump.mypinata.cloud/ipfs/", () => response(403, "no")], ["https://gateway.pinata.cloud/ipfs/", () => ({ name: "x", twitter: "https://x.com/a" })]]);
  const http = createHttp({ fetchImpl, allowedHosts: Object.values(HOSTS), sleep: async () => {} });
  const md = await readMetadata({ http, uri: "https://ipfs.io/ipfs/QmdZQP9jUWvH3j2yLDVhpYuG5ovWCNbeDMmW85vusUyWFr" });
  ok("pump.fun's gateway refusing (403, as it did for some CIDs that day) falls back to Pinata's", md.ok && calls.length === 2);
  ok("a metadata URI on any other host is not fetched at all", !(await readMetadata({ http, uri: "https://evil.example/x.json" })).ok && calls.length === 2);
}

section("A WHOLE POPCAT RUN, ON A SCRIPTED PUMP.FUN AND CHAIN");
function popWorld({ env = {}, launches = [], model = null } = {}) {
  const passing = snaps[0], failing = snaps[1];
  const notCat = { ...failing.apiRow, mint: "So11111111111111111111111111111111111111112", name: "Dog Money", symbol: "DOGM", description: "a dog", bonding_curve: failing.apiRow.bonding_curve };
  const rows = [passing.apiRow, failing.apiRow, notCat];
  const byMint = Object.fromEntries(snaps.map((s) => [s.apiRow.mint, s]));
  const { fetchImpl } = scriptedFetch([
    [/frontend-api-v3\.pump\.fun\/coins\?offset=0&limit=50&sort=created_timestamp/, () => rows],
    [/frontend-api-v3\.pump\.fun\/coins\?offset=\d+&limit=50&sort=created_timestamp/, () => []],
    [/frontend-api-v3\.pump\.fun\/coins\?offset=\d+&limit=50&sort=last_trade_timestamp/, () => []],
    [/frontend-api-v3\.pump\.fun\/coins-v2\/user-created-coins\//, (u) => ({ count: snaps.find((s) => u.includes(s.apiRow.creator))?.creatorLaunchCount ?? 0, coins: [] })],
    [/\/ipfs\//, (u) => { const s = snaps.find((x) => u.endsWith(cidOf(x.apiRow.metadata_uri))); return s && !s.metadata.unreadable ? s.metadata : response(404, "{}"); }],
  ]);
  const http = createHttp({ fetchImpl, allowedHosts: Object.values(HOSTS), sleep: async () => {} });
  const acc = (a) => (a ? { owner: a.owner, lamports: 1, data: [a.dataBase64, "base64"] } : null);
  const rpc = scriptedRpc({
    getMultipleAccounts: ([list]) => ({ value: list.map((k) => {
      const s = byMint[k] ?? Object.values(byMint).find((x) => x.apiRow.bonding_curve === k);
      if (k === "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf") return acc({ owner: globalAcc.owner, dataBase64: fixture("pumpfun/global.json").dataBase64 });
      if (s && byMint[k]) return acc(s.mintAccount);
      if (s) return acc(s.curveAccount);
      const e = fixture("popcat/established-mints.json").accounts.find((a) => a.address === k);
      return e ? acc(e) : null;
    }) }),
    getProgramAccounts: ([, opts]) => (byMint[opts.filters[0].memcmp.bytes]?.holders.list ?? []).map((h) => { const b = Buffer.alloc(40); new PublicKey(h.owner).toBuffer().copy(b); b.writeBigUInt64LE(BigInt(h.amount), 32); return { pubkey: h.account, account: { data: [b.toString("base64"), "base64"] } }; }),
    getSignaturesForAddress: ([addr]) => { const s = Object.values(byMint).find((x) => x.apiRow.bonding_curve === addr); return s ? [...s.creation.sameSlotBuyers.map((b, i) => ({ signature: `same${i}`, slot: s.creation.createSlot })), { signature: s.creation.createSig, slot: s.creation.createSlot, blockTime: s.creation.createTime }] : []; },
    getTransaction: ([sig]) => { const s = snaps[0]; const i = Number(String(sig).replace("same", "")); return { transaction: { message: { accountKeys: [s.creation.sameSlotBuyers[i]] } } }; },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "popcat-"));
  fs.writeFileSync(path.join(dir, "launches.json"), JSON.stringify({ launches }));
  const cap = captureSink();
  const log = createLogger({ sink: cap.sink });
  const run = () => runPopcat({ env, http, rpc, model: model ?? { hasKey: false }, dataDir: dir, log, now: () => Date.parse(snaps[0].read) });
  return { run, dir, cap, rpc };
}
{
  const dry = popWorld();
  const r = await dry.run();
  ok("a dry run finds the passing cat coin and writes nothing", r.mode === "dry" && r.callouts.length === 1 && r.callouts[0].mint === snaps[0].apiRow.mint && !fs.existsSync(path.join(dry.dir, "callouts.json")) && !fs.existsSync(path.join(dry.dir, "popcat-state.json")));
  ok("the not-a-cat coin was never checked on chain", !dry.rpc.calls.some((c) => c.method === "getProgramAccounts" && c.params[1].filters[0].memcmp.bytes === "So11111111111111111111111111111111111111112"));
  const live = popWorld({ env: { POPCAT_LIVE: "1" } });
  const r2 = await live.run();
  const file = JSON.parse(fs.readFileSync(path.join(live.dir, "callouts.json"), "utf8"));
  const v = validateCallouts(file);
  ok("a live run publishes exactly the passing coin, and the site validates it", r2.mode === "live" && file.callouts.length === 1 && v.problems.length === 0 && v.callouts[0].mint === snaps[0].apiRow.mint, v.problems.join(" | "));
  ok("it shows all twelve checks and no link or image of the coin's own (socials are named, never linked)", v.callouts[0].checks.length === 12 && !JSON.stringify(file).match(/https?:|ipfs\/|x\.com\//));
  ok("it remembers what it checked, so the next run spends its reads on new coins", JSON.parse(fs.readFileSync(path.join(live.dir, "popcat-state.json"), "utf8")).checked[snaps[0].apiRow.mint]?.verdict === "passed");
  const again = await live.run();
  ok("the same coin is not called out twice", again.callouts.length === 0 && JSON.parse(fs.readFileSync(path.join(live.dir, "callouts.json"), "utf8")).callouts.length === 1);
  const testEnv = popWorld({ env: { POPCAT_LIVE: "1", NODE_ENV: "test" } });
  ok("a test environment is never live", (await testEnv.run()).mode === "dry");
}
{
  const byWallet = popWorld({ env: { POPCAT_LIVE: "1", CASHCAT_WALLET_ADDRESS: snaps[0].apiRow.creator } });
  const r = await byWallet.run();
  ok("a coin whose creator is CashCat's wallet (CASHCAT_WALLET_ADDRESS) is never called out, nor even checked", r.callouts.length === 0 && !byWallet.rpc.calls.some((c) => c.method === "getProgramAccounts" && c.params[1].filters[0].memcmp.bytes === snaps[0].apiRow.mint));
  const launch = { time: "2026-09-24T20:00:00Z", venue: "pumpfun", name: "Asset Cat", symbol: "ASSCAT", tagline: "A launch record for the exclusion test.", trend: { title: "x", source: "google-trends" },
    mint: snaps[0].apiRow.mint, creator: "FFWtrEQ4B4PKQoVuHYzZq8FabGkVatYzDpEVHsK5rrhF", tx: fixture("pumpfun/create-v2-samples.json").samples[0].signature, quote: { symbol: "SOL", mint: "So11111111111111111111111111111111111111112" }, devBuy: { sol: 0 }, costSol: 0.005, kitten: "black" };
  const byList = popWorld({ env: { POPCAT_LIVE: "1" }, launches: [launch] });
  ok("a coin in CashCat's launches is never called out", (await byList.run()).callouts.length === 0);
  const declined = popWorld({ model: { hasKey: true, callTool: async () => ({ cat_themed: false, fit_to_print: true, reason: "not about a cat" }) } });
  ok("with a model key, a coin the model says is not a cat is skipped", (await declined.run()).callouts.length === 0);
}

done();
