/**
 * THE BOTS' DATA FILES CAN ONLY SAY WHAT THE SITE WILL SAFELY SHOW.
 *
 * site/assets/launches.js and callouts.js are the validators the floor and the bots share: a
 * bot never writes an entry they refuse, and the floor skips (and names in the console) any
 * entry that does not pass. This file walks every refusal: HTML, control and direction
 * characters, a link scheme in text, a bad address or signature, an unknown field anywhere, an
 * impossible time, a wrong venue, ticker or kitten, a dev buy over 0.05 SOL or without its
 * transaction, a dev buy on StonkFun, a pump.fun launch not quoted in SOL; for callouts, a check
 * that did not pass, a missing, repeated or unknown check, and any callout on a CashCat coin.
 * Links are built only from checked strings, to Solscan, pump.fun and StonkFun. Then the data
 * module (bots/lib/data.mjs): newest first, capped, validated as a whole before a file is replaced.
 *
 * The entries below are built for the test from addresses and signatures recorded on chain
 * (fixtures/bots/); none of them is a launch or a callout that happened.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { harness, fixture } from "./bots/test/doubles.mjs";
import { validateLaunches, launchLinks, MAX_LAUNCHES, VENUES } from "./site/assets/launches.js";
import { validateCallouts, calloutLinks, CHECK_IDS, MAX_CALLOUTS } from "./site/assets/callouts.js";
import { appendLaunch, appendCallouts, loadLaunches, loadCallouts, savePopcatState, loadPopcatState } from "./bots/lib/data.mjs";

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

section("CALLOUTS");
const snap = fixture("popcat/snapshots.json").snapshots[0];
const callout = (over = {}) => ({
  time: "2026-09-24T21:40:00Z", venue: "pumpfun", mint: snap.apiRow.mint, creator: snap.apiRow.creator, name: snap.apiRow.name, symbol: snap.apiRow.symbol,
  cat: { field: "name", word: "cat" }, checks: snap.evaluatedThen.checks.map(({ id, value }) => ({ id, result: "pass", value })), ...over,
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
ok("a check that failed is refused: a callout lists only checks that passed", refusedC(callout({ checks: callout().checks.map((c, i) => (i === 3 ? { ...c, result: "fail" } : c)) }), /did not pass/));
ok("an \"info\" check (a silent source) is allowed", oneC(callout({ checks: callout().checks.map((c) => (c.id === "creator_launches" ? { ...c, result: "info", value: "not available from pump.fun" } : c)) })).callouts.length === 1);
ok("a missing check is refused", refusedC(callout({ checks: callout().checks.slice(1) }), /missing checks/));
ok("a repeated check is refused", refusedC(callout({ checks: [...callout().checks, callout().checks[0]] }), /twice/));
ok("an unknown check id is refused", refusedC(callout({ checks: [...callout().checks.slice(1), { id: "vibes", result: "pass", value: "good" }] }), /unknown id/));
ok("HTML in a stranger's coin name is refused", refusedC(callout({ name: "<b>cat</b>" }), /HTML/));
ok("a javascript: link in a check value is refused", refusedC(callout({ checks: callout().checks.map((c, i) => (i === 0 ? { ...c, value: "javascript:alert(1)" } : c)) }), /link scheme/));
ok("a bad address is refused", refusedC(callout({ creator: "x" }), /creator/));
ok("an image or link field is refused as unknown", refusedC(callout({ image: "https://ipfs.io/ipfs/x" }), /unknown field "image"/) && refusedC(callout({ twitter: "https://x.com/a" }), /unknown field "twitter"/));
ok("a venue other than pump.fun is refused", refusedC(callout({ venue: "stonkfun" }), /venue/));
{
  const cc = [{ mint: snap.apiRow.mint, creator: "11111111111111111111111111111111" }];
  const cw = [{ mint: "11111111111111111111111111111111", creator: snap.apiRow.creator }];
  ok("a callout on a coin CashCat launched is refused, by mint and by creator wallet", refusedC(callout(), /CashCat/, { exclude: cc }) && refusedC(callout(), /CashCat/, { exclude: cw }));
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
  ok(`the caps: ${MAX_LAUNCHES} launches, ${MAX_CALLOUTS} callouts`, MAX_LAUNCHES === 200 && MAX_CALLOUTS === 200);
}

done();
