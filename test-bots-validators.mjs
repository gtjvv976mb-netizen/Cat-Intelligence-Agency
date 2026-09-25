/**
 * THE BOTS' DATA FILES CAN ONLY SAY WHAT THE SITE WILL SAFELY SHOW.
 *
 * site/assets/launches.js and callouts.js are the validators the floor and the bots share: a
 * bot never writes an entry they refuse, and the floor skips (and names in the console) any
 * entry that does not pass. This file walks every refusal: HTML, control and direction
 * characters (the soft hyphen and word joiners among them), a link scheme in text, a bad address
 * or signature (base58 that does not decode to 32 or 64 bytes included), an unknown field anywhere, an
 * impossible time, a wrong venue, ticker or kitten, a dev buy over 0.05 SOL or without its
 * transaction, a dev buy on StonkFun, a pump.fun launch not quoted in SOL; for Popcat's file, a
 * missing, repeated or unknown check, an "info" from a source that is never silent, a CashCat coin
 * (by the file's launches or by its own not_cashcat check), stats that are not counts, and every
 * way a pick can be malformed: a window off the six-hour grid, a time outside it, checks too old, a
 * draft too long, without its disclosure, not opening with the coin, or saying "buy", two picks for
 * one window or one coin, a pick of a spotted coin or of CashCat's. A failed check is a red flag,
 * not a refusal: the coin is listed as spotted. Links are built only from checked strings, to
 * Solscan, pump.fun and StonkFun. Then the data module (bots/lib/data.mjs): newest first, one entry
 * per coin (a newer check replaces an older), capped at 200 coins and 28 picks, validated as a whole
 * before a file is replaced.
 *
 * The entries below are built for the test from addresses and signatures recorded on chain
 * (fixtures/bots/); none of them is a launch or a callout that happened.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { harness, fixture } from "./bots/test/doubles.mjs";
import { validateLaunches, launchLinks, MAX_LAUNCHES, VENUES } from "./site/assets/launches.js";
import { validateCallouts, calloutLinks, CHECK_IDS, CHECKS, MAX_CALLOUTS, MAX_PICKS, DRAFT_DISCLOSURE, DRAFT_MAX } from "./site/assets/callouts.js";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { appendLaunch, appendCallouts, loadLaunches, loadCallouts, loadCalloutsFile, savePopcatState, loadPopcatState } from "./bots/lib/data.mjs";

const { ok, section, done } = harness("test-bots-validators");
const sample = fixture("pumpfun/create-v2-samples.json").samples[0];
const MINT = sample.accounts[0].pubkey, WALLET = sample.accounts[5].pubkey, SIG = sample.signature;
const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const launch = (over = {}) => ({
  time: "2026-09-24T21:08:50Z", venue: "pumpfun", name: "Pickle Cat", symbol: "PKLCAT", tagline: "A cat who judges pickleball from the bench.",
  trend: { title: "pickleball", source: "google-trends" }, mint: MINT, creator: WALLET, tx: SIG,
  quote: { symbol: "SOL", mint: "So11111111111111111111111111111111111111112" }, devBuy: { sol: 0 }, costSol: 0.00555, kitten: "ginger", ...over,
});
const one = (e) => validateLaunches({ launches: [e] });
const refused = (e, re) => { const v = one(e); return v.launches.length === 0 && v.problems.length === 1 && re.test(v.problems[0]); };

section("LAUNCHES: WHAT PASSES");
{
  const v = one(launch());
  ok("a well-formed pump.fun launch passes", v.launches.length === 1 && v.problems.length === 0, v.problems.join(" | "));
  ok("a StonkFun launch paired with SPYx, with its pool, passes", one(launch({ venue: "stonkfun", quote: { symbol: "SPYx", mint: SPYX }, pool: WALLET })).launches.length === 1);
  ok("a disclosed dev buy of 0.05 SOL with its transaction passes", one(launch({ devBuy: { sol: 0.05, tx: SIG } })).launches.length === 1);
  const links = launchLinks(v.launches[0]);
  ok("links are pump.fun and Solscan pages built from the checked mint, signature and wallet — nothing else",
    links.length === 4 && links[0].href === `https://pump.fun/coin/${MINT}` && links[1].href === `https://solscan.io/tx/${SIG}` && links.every((l) => /^https:\/\/(pump\.fun|solscan\.io|www\.stonkfun\.xyz)\//.test(l.href)));
  ok("a StonkFun launch links to its StonkFun token page", launchLinks(one(launch({ venue: "stonkfun", quote: { symbol: "SPYx", mint: SPYX } })).launches[0])[0].href === `https://www.stonkfun.xyz/token/${MINT}`);
  ok("three venues: pump.fun, pump.fun paired with a stock, StonkFun", JSON.stringify(Object.keys(VENUES)) === '["pumpfun","pumpfun-xstock","stonkfun"]');
}

section("LAUNCHES: WHAT IS REFUSED");
ok("HTML in the name", refused(launch({ name: "<img src=x onerror=alert(1)>" }), /HTML/));
ok("an HTML entity in the tagline", refused(launch({ tagline: "A cat &lt;script&gt; walks in the park." }), /HTML/));
ok("a javascript: link in the tagline", refused(launch({ tagline: "click javascript:alert(1) for a cat" }), /link scheme/));
ok("a data: link in the trend", refused(launch({ trend: { title: "data:text/html,hi", source: "google-trends" } }), /link scheme/));
ok("a direction override in the name", refused(launch({ name: "Cat‮yrt" }), /control or direction/));
ok("a bad mint address", refused(launch({ mint: "not-an-address" }), /mint/));
ok("an address with a 0 in it", refused(launch({ creator: "0" + WALLET.slice(1) }), /creator/));
ok("a bad transaction signature", refused(launch({ tx: "abc" }), /signature/));
ok("base58 of the right length that is not 32 bytes is no address (44 ones are 44 zero bytes)", refused(launch({ mint: "1".repeat(44) }), /mint/) && refused(launch({ creator: "z".repeat(44) }), /creator/));
ok("base58 that is not 64 bytes is no signature", refused(launch({ tx: "1".repeat(88) }), /signature/) && refused(launch({ tx: SIG.slice(0, 70) }), /signature/));
ok("an invisible soft hyphen or word joiner in a name", refused(launch({ name: "Tr\u00ADump Cat" }), /control or direction/) && refused(launch({ tagline: "A cat\u2060 walks in the park all day." }), /control or direction/));
ok("an unknown field (a url)", refused(launch({ url: "https://evil.example" }), /unknown field "url"/));
ok("an unknown field inside trend", refused(launch({ trend: { title: "x", source: "google-trends", href: "javascript:alert(1)" } }), /unknown field "href"/));
ok("an unknown field inside quote", refused(launch({ quote: { symbol: "SOL", mint: "So11111111111111111111111111111111111111112", url: "x" } }), /unknown field/));
ok("an impossible time", refused(launch({ time: "2026-02-30T10:00:00Z" }), /real moment/));
ok("a time with milliseconds or no Z", refused(launch({ time: "2026-09-24T21:08:50.000Z" }), /time/) && refused(launch({ time: "2026-09-24 21:08:50" }), /time/));
ok("an unknown venue", refused(launch({ venue: "raydium" }), /venue/));
ok("a lower-case or $ ticker", refused(launch({ symbol: "pklcat" }), /symbol/) && refused(launch({ symbol: "$PKL" }), /symbol/));
ok("an unknown trend source", refused(launch({ trend: { title: "x", source: "twitter" } }), /source/));
ok("a dev buy over 0.05 SOL", refused(launch({ devBuy: { sol: 0.06, tx: SIG } }), /devBuy.sol/));
ok("a dev buy without its transaction", refused(launch({ devBuy: { sol: 0.01 } }), /devBuy.tx/));
ok("a transaction on a dev buy that did not happen", refused(launch({ devBuy: { sol: 0, tx: SIG } }), /only for a dev buy/));
ok("a dev buy on StonkFun", refused(launch({ venue: "stonkfun", quote: { symbol: "SPYx", mint: SPYX }, devBuy: { sol: 0.01, tx: SIG } }), /StonkFun/));
ok("a pump.fun launch not quoted in SOL, or a stock launch quoted in SOL", refused(launch({ quote: { symbol: "SPYx", mint: SPYX } }), /quoted in SOL/) && refused(launch({ venue: "stonkfun" }), /quoted in SOL/));
ok("a cost that is not a number", refused(launch({ costSol: "0.005" }), /costSol/));
ok("an unknown kitten", refused(launch({ kitten: "lion" }), /kitten/));
ok("the same mint twice keeps the first", validateLaunches({ launches: [launch(), launch({ time: "2026-09-24T22:00:00Z" })] }).launches.length === 1);
ok("a file that is not { launches: [...] } is empty, not an error", validateLaunches(null).launches.length === 0 && validateLaunches({ launches: "x" }).problems.length === 1);
ok(`more than ${MAX_LAUNCHES} is capped and said`, (() => { const many = Array.from({ length: MAX_LAUNCHES + 1 }, () => launch()); const v = validateLaunches({ launches: many }); return v.problems.some((p) => /more than/.test(p)); })());
ok("newest first", (() => { const b = sample; const other = fixture("pumpfun/create-v2-samples.json").samples[1]; const v = validateLaunches({ launches: [launch(), launch({ mint: other.accounts[0].pubkey, time: "2026-09-25T01:00:00Z" })] }); return v.launches[0].time === "2026-09-25T01:00:00Z"; })());

section("POPCAT'S FILE: CALLOUTS AND SPOTTED COINS");
const snap = fixture("popcat/snapshots.json").snapshots[0];
const callout = (over = {}) => ({
  time: "2026-09-24T21:40:00Z", venue: "pumpfun", mint: snap.apiRow.mint, creator: snap.apiRow.creator, name: snap.apiRow.name, symbol: snap.apiRow.symbol,
  cat: { field: "name", word: "cat" }, checks: snap.evaluatedThen.checks.map(({ id, value }) => ({ id, result: "pass", value })),
  stats: { holders: 40, top10Pct: 14.8, curvePct: 100, txs: 5000 }, ...over,
});
const oneC = (e, opts) => validateCallouts({ callouts: [e] }, opts);
const refusedC = (e, re, opts) => { const v = oneC(e, opts); return v.callouts.length === 0 && v.problems.length === 1 && re.test(v.problems[0]); };
{
  const v = oneC(callout());
  ok("a callout of a recorded coin that passed every check validates", v.callouts.length === 1 && v.problems.length === 0, v.problems.join(" | "));
  ok("its checks come back in the page's order, each with its label", v.callouts[0].checks.map((c) => c.id).join() === CHECK_IDS.join() && v.callouts[0].checks.every((c) => c.label));
  const links = calloutLinks(v.callouts[0]);
  ok("links: pump.fun and Solscan only, from the checked addresses; never the coin's own links or image", links.length === 3 && links.every((l) => /^https:\/\/(pump\.fun\/coin|solscan\.io\/account)\//.test(l.href)));
}
{
  const failed = callout({ checks: callout().checks.map((c) => (["creator_share", "curve"].includes(c.id) ? { ...c, result: "fail" } : c)) });
  const v = oneC(failed);
  ok("a coin with failed checks is listed as spotted, not refused: its verdict counts its red flags, each named in plain words",
    v.problems.length === 0 && v.callouts[0].callout === false && v.callouts[0].verdict === "RED FLAGS (2)" && v.callouts[0].flags.map((f) => `${f.id}:${f.flag === CHECKS[f.id].flag}`).join() === "creator_share:true,curve:true");
  ok("a coin with none is a callout: \"no red flags found\"", oneC(callout()).callouts[0].callout === true && oneC(callout()).callouts[0].verdict === "NO RED FLAGS FOUND" && oneC(callout()).callouts[0].flags.length === 0);
}
ok("a result other than pass, fail or info is refused", refusedC(callout({ checks: callout().checks.map((c, i) => (i === 3 ? { ...c, result: "maybe" } : c)) }), /must be "pass", "fail" or "info"/));
ok("an \"info\" check (a silent source) is allowed", oneC(callout({ checks: callout().checks.map((c) => (c.id === "creator_launches" ? { ...c, result: "info", value: "not available from pump.fun" } : c)) })).callouts.length === 1);
ok("…but only for the two checks whose source may be silent", refusedC(callout({ checks: callout().checks.map((c) => (c.id === "mint_authority" ? { ...c, result: "info" } : c)) }), /cannot be "info"/));
ok("a failed not_cashcat check is refused outright: Popcat never lists a coin CashCat launched", refusedC(callout({ checks: callout().checks.map((c) => (c.id === "not_cashcat" ? { ...c, result: "fail" } : c)) }), /never lists a coin CashCat launched/));
ok("stats must be there and be counts and percentages, nothing else", refusedC(callout({ stats: undefined }), /"stats" must be/) && refusedC(callout({ stats: { ...callout().stats, holders: 1.5 } }), /holders/)
  && refusedC(callout({ stats: { ...callout().stats, top10Pct: 101 } }), /top10Pct/) && refusedC(callout({ stats: { ...callout().stats, url: "x" } }), /unknown field "url"/)
  && oneC(callout({ stats: { ...callout().stats, txs: null } })).callouts.length === 1);
ok("a missing check is refused", refusedC(callout({ checks: callout().checks.slice(1) }), /missing checks/));
ok("a repeated check is refused", refusedC(callout({ checks: [...callout().checks, callout().checks[0]] }), /twice/));
ok("an unknown check id is refused", refusedC(callout({ checks: [...callout().checks.slice(1), { id: "vibes", result: "pass", value: "good" }] }), /unknown id/));
ok("HTML in a stranger's coin name is refused", refusedC(callout({ name: "<b>cat</b>" }), /HTML/));
ok("a javascript: link in a check value is refused", refusedC(callout({ checks: callout().checks.map((c, i) => (i === 0 ? { ...c, value: "javascript:alert(1)" } : c)) }), /link scheme/));
ok("a bad address is refused", refusedC(callout({ creator: "x" }), /creator/));
ok("base58 of the right length that is not 32 bytes is refused", refusedC(callout({ creator: "1".repeat(44) }), /creator/) && refusedC(callout({ mint: "z".repeat(44) }), /mint/));
ok("an invisible soft hyphen in a stranger's coin name is refused", refusedC(callout({ name: "Tr\u00ADump cat" }), /control or direction/));
ok("an image or link field is refused as unknown", refusedC(callout({ image: "https://ipfs.io/ipfs/x" }), /unknown field "image"/) && refusedC(callout({ twitter: "https://x.com/a" }), /unknown field "twitter"/));
ok("a venue other than pump.fun is refused", refusedC(callout({ venue: "stonkfun" }), /venue/));
{
  const cc = [{ mint: snap.apiRow.mint, creator: "11111111111111111111111111111111" }];
  const cw = [{ mint: "11111111111111111111111111111111", creator: snap.apiRow.creator }];
  ok("a callout on a coin CashCat launched is refused, by mint and by creator wallet", refusedC(callout(), /CashCat/, { exclude: cc }) && refusedC(callout(), /CashCat/, { exclude: cw }));
}
ok("the file may carry picks and nothing else beside its coins", validateCallouts({ callouts: [], picks: [] }).problems.length === 0 && validateCallouts({ callouts: [], extra: 1 }).problems.some((p) => /unknown top-level field "extra"/.test(p))
  && validateCallouts({ callouts: [], picks: "x" }).problems.some((p) => /"picks" must be a list/.test(p)));

section("POPCAT'S PICKS: EVERY WAY ONE CAN BE MALFORMED");
const pick = (over = {}) => ({
  window: "2026-09-25T12:00:00Z", time: "2026-09-25T12:07:31Z", checked: "2026-09-25T11:37:04Z", mint: snap.apiRow.mint, creator: snap.apiRow.creator, name: "Asset Cat", symbol: "ASSCAT",
  stats: { holders: 40, top10Pct: 14.8, curvePct: 100, txs: 5000 },
  draft: `Asset Cat ($ASSCAT): no red flags in 12 on-chain checks at 11:37 UTC. 40 holders, top 10 hold 14.8%, mint and freeze revoked. ${DRAFT_DISCLOSURE}`, ...over,
});
const oneP = (p, opts, callouts = []) => validateCallouts({ callouts, picks: [p] }, opts);
const refusedP = (p, re, opts, callouts) => { const v = oneP(p, opts, callouts); return v.picks.length === 0 && v.problems.length === 1 && re.test(v.problems[0]); };
{
  const v = oneP(pick());
  ok("a well-formed pick passes, and knows where its window ends", v.problems.length === 0 && v.picks[0].end === "2026-09-25T18:00:00Z", v.problems.join(" | "));
}
ok("a window that does not start at 00, 06, 12 or 18 UTC", refusedP(pick({ window: "2026-09-25T13:00:00Z", time: "2026-09-25T13:07:31Z" }), /00, 06, 12 or 18/));
ok("a time outside its window", refusedP(pick({ time: "2026-09-25T18:00:00Z" }), /inside its window/) && refusedP(pick({ time: "2026-09-25T11:59:59Z", checked: "2026-09-25T11:00:00Z" }), /inside its window/));
ok("checks older than six hours, or after the pick", refusedP(pick({ checked: "2026-09-25T06:07:31Z" }), /6 hours before/) && refusedP(pick({ checked: "2026-09-25T12:08:00Z" }), /6 hours before/));
ok("an impossible moment", refusedP(pick({ checked: "2026-02-30T11:00:00Z" }), /real moment/));
ok(`a draft over ${DRAFT_MAX} characters`, refusedP(pick({ draft: pick().draft.replace("40 holders", "40 holders" + " and more".repeat(8)) }), /longer than 200/));
ok("a draft without the disclosure, or not opening with the coin's name and ticker", refusedP(pick({ draft: pick().draft.replace(DRAFT_DISCLOSURE, "Not financial advice.") }), /disclosure/)
  && refusedP(pick({ draft: pick().draft.replace("Asset Cat ($ASSCAT)", "Other Cat ($OTHER)") }), /open with the coin/));
ok("a draft that says buy, moon, a price or a multiple", ["Buy it now.", "To the moon.", "Price 0.1 SOL.", "Easy 100x."].every((w) => refusedP(pick({ draft: pick().draft.replace("mint and freeze revoked", w) }), /no call to trade/)));
ok("HTML, a link scheme or a hidden character in a draft", refusedP(pick({ draft: pick().draft.replace("40 holders", "<b>40</b> holders") }), /HTML/)
  && refusedP(pick({ draft: pick().draft.replace("40 holders", "javascript:alert(1)") }), /link scheme/) && refusedP(pick({ draft: pick().draft.replace("40 holders", "40" + String.fromCharCode(0x200b) + " holders") }), /control or direction/));
ok("an unknown field (a link, an image)", refusedP(pick({ url: "https://pump.fun/x" }), /unknown field "url"/) && refusedP(pick({ image: "x" }), /unknown field "image"/));
ok("a bad address", refusedP(pick({ mint: "1".repeat(44) }), /mint/));
ok("a pick of a coin CashCat launched", refusedP(pick(), /never picks a coin CashCat launched/, { exclude: [{ mint: snap.apiRow.mint, creator: "11111111111111111111111111111111" }] }));
ok("a pick of a coin the file lists as spotted", refusedP(pick(), /no check found a red flag/, {}, [callout({ checks: callout().checks.map((c) => (c.id === "curve" ? { ...c, result: "fail" } : c)) })]));
{
  const other = new PublicKey(createHash("sha256").update("validators:other").digest()).toBase58();
  const two = validateCallouts({ callouts: [], picks: [pick(), pick({ mint: other, time: "2026-09-25T12:37:00Z" })] });
  ok("two picks for one window: the first is kept", two.picks.length === 1 && two.problems.some((p) => /already has its pick/.test(p)));
  const again = validateCallouts({ callouts: [], picks: [pick(), pick({ window: "2026-09-25T18:00:00Z", time: "2026-09-25T18:07:00Z", checked: "2026-09-25T17:00:00Z" })] });
  ok("the same coin picked twice: the first is kept", again.picks.length === 1 && again.problems.some((p) => /already picked/.test(p)));
}

section("THE DATA MODULE: NEWEST FIRST, CAPPED, VALIDATED WHOLE");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bots-data-"));
  ok("an empty directory reads as no launches and no callouts", loadLaunches(dir).length === 0 && loadCallouts(dir).length === 0);
  appendLaunch(dir, launch());
  const other = fixture("pumpfun/create-v2-samples.json").samples[1];
  appendLaunch(dir, launch({ mint: other.accounts[0].pubkey, tx: other.signature, time: "2026-09-24T23:00:00Z" }));
  const back = JSON.parse(fs.readFileSync(path.join(dir, "launches.json"), "utf8"));
  ok("two launches appended: newest first, in the file's own shape (no empty pool, no empty dev-buy tx)", back.launches.length === 2 && back.launches[0].time === "2026-09-24T23:00:00Z" && !("pool" in back.launches[0]) && !("tx" in back.launches[0].devBuy));
  let threw = false;
  try { appendLaunch(dir, launch({ name: "<script>" })); } catch { threw = true; }
  ok("an entry the site would refuse is never written", threw && JSON.parse(fs.readFileSync(path.join(dir, "launches.json"), "utf8")).launches.length === 2);
  appendCallouts(dir, [callout()]);
  ok("a callout appended and read back", loadCallouts(dir).length === 1);
  appendCallouts(dir, [callout({ time: "2026-09-24T22:40:00Z", checks: callout().checks.map((c) => (c.id === "curve" ? { ...c, result: "fail", value: "5.00% sold" } : c)) })]);
  ok("a newer check of the same coin replaces the older: one entry per coin", loadCallouts(dir).length === 1 && loadCallouts(dir)[0].time === "2026-09-24T22:40:00Z" && loadCallouts(dir)[0].callout === false);
  let threwC = false;
  try { appendCallouts(dir, [callout({ mint: MINT, creator: WALLET })], { exclude: loadLaunches(dir) }); } catch { threwC = true; }
  ok("a callout on a CashCat coin is never written", threwC && loadCallouts(dir).length === 1);
  fs.writeFileSync(path.join(dir, "launches.json"), '{"launches":[{"time":"bad"}]}');
  let threwBad = false;
  try { loadLaunches(dir); } catch { threwBad = true; }
  ok("a data file that does not validate stops the bot instead of being overwritten", threwBad);
  savePopcatState(dir, { checked: { [MINT]: { at: 1, verdict: "passed" }, "bad key": { at: 2, verdict: "x" } } });
  ok("Popcat's memory keeps only well-formed entries", Object.keys(loadPopcatState(dir).checked).length === 1);
  fs.rmSync(dir, { recursive: true, force: true });
  ok(`the caps: ${MAX_LAUNCHES} launches, ${MAX_CALLOUTS} coins in Popcat's file, ${MAX_PICKS} picks`, MAX_LAUNCHES === 200 && MAX_CALLOUTS === 200 && MAX_PICKS === 28);
}
{
  /* 230 coins checked, 30 picks: the file keeps the newest 200 and the newest 28, and still validates. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bots-cap-"));
  const addr = (i) => new PublicKey(createHash("sha256").update(`cap:${i}`).digest()).toBase58();
  const at = (i) => new Date(Date.UTC(2026, 8, 20) + i * 600_000).toISOString().replace(".000", "");
  const many = Array.from({ length: 230 }, (_, i) => callout({ mint: addr(i), creator: addr(i), name: `Cap Cat ${i}`, time: at(i) }));
  appendCallouts(dir, many.slice(0, 120));
  appendCallouts(dir, many.slice(120));
  const picks = Array.from({ length: 30 }, (_, i) => { const w = Date.UTC(2026, 8, 20) + i * 6 * 3_600_000; const iso = (ms) => new Date(ms).toISOString().replace(".000", "");
    return pick({ window: iso(w), time: iso(w + 420_000), checked: iso(w - 600_000), mint: addr(1000 + i), creator: addr(1000 + i), name: "Cap Cat", symbol: "CAP", draft: pick().draft.replace("Asset Cat ($ASSCAT)", "Cap Cat ($CAP)") }); });
  for (const p of picks) appendCallouts(dir, [], { picks: [p] });
  const f = loadCalloutsFile(dir), raw = JSON.parse(fs.readFileSync(path.join(dir, "callouts.json"), "utf8"));
  ok(`capped: the newest ${MAX_CALLOUTS} coins and the newest ${MAX_PICKS} picks stay, and the file validates`,
    raw.callouts.length === 200 && f.callouts[0].time === at(229) && f.callouts[199].time === at(30) && raw.picks.length === 28 && f.picks[0].window === picks[29].window && validateCallouts(raw).problems.length === 0);
  /* 20 callouts, then 200 newer spotted coins, all inside six hours: the callouts a pick may still choose are kept. */
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "bots-cap2-"));
  const at2 = (i) => new Date(Date.UTC(2026, 8, 21) + i * 60_000).toISOString().replace(".000", "");
  const clean = Array.from({ length: 20 }, (_, i) => callout({ mint: addr(2000 + i), creator: addr(2000 + i), name: `Clean Cat ${i}`, time: at2(i) }));
  const flagged = Array.from({ length: 200 }, (_, i) => callout({ mint: addr(3000 + i), creator: addr(3000 + i), name: `Flag Cat ${i}`, time: at2(20 + i), checks: callout().checks.map((c) => (c.id === "curve" ? { ...c, result: "fail" } : c)) }));
  appendCallouts(dir2, clean);
  appendCallouts(dir2, flagged);
  const f2 = loadCalloutsFile(dir2);
  ok("the cap keeps the callouts of the last six hours ahead of newer spotted coins, so the next pick can still choose them",
    f2.callouts.length === 200 && f2.callouts.filter((c) => c.callout).length === 20 && f2.callouts.filter((c) => !c.callout).length === 180 && f2.callouts[0].time === at2(219));
  fs.rmSync(dir2, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bots-state-"));
  const p = { creator: MINT, curve: WALLET, name: "Queue Cat", symbol: "QCAT", description: "", metadataUri: "", createdMs: 5, cat: { field: "name", word: "cat" }, due: 6, n: 0, tries: 1, reviewed: false };
  savePopcatState(dir, { listedTo: 123, pickWindow: "2026-09-25T12:00:00Z", pending: { [WALLET]: p, "bad key": p, [MINT]: { ...p, curve: "x" } }, checked: {} });
  const back = loadPopcatState(dir);
  ok("Popcat's queue keeps only well-formed coins, with where the last listing reached and the last window tried",
    Object.keys(back.pending).join() === WALLET && back.pending[WALLET].tries === 1 && back.listedTo === 123 && back.pickWindow === "2026-09-25T12:00:00Z");
  fs.rmSync(dir, { recursive: true, force: true });
}

done();
