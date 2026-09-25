/**
 * CRYING CAT'S TAB: THE RUG CHECK FOR ONE MINT, ON RECORDED ACCOUNTS.
 *
 *   · the input, checked strictly: a base58 address that decodes to 32 bytes, or a pump.fun coin
 *     link of exactly that form, and nothing else;
 *   · the report, from the mint and holder accounts Popcat recorded on 2026-09-24
 *     (fixtures/bots/popcat/snapshots.json) and the established cat coins' recorded mints: the
 *     mint and freeze authority, the Token-2022 extensions, the holders with the curve and
 *     program-held pools left out, the creator's share when pump.fun's curve names a creator,
 *     the curve's state, copycats; plain-language notes; links only to Solscan and pump.fun;
 *   · what is not a mint (a wallet, a token account, nothing at all) is said so, not reported on;
 *   · a token too big to list falls back to its 20 largest accounts, and says so.
 * No network: every answer is scripted.
 */
import fs from "node:fs";
import path from "node:path";
import { PublicKey, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { harness, fixture, scriptedRpc, ROOT } from "./bots/test/doubles.mjs";
import { pda } from "./bots/lib/solana.mjs";
import { PUMPFUN_PROGRAM, PUMPFUN_GLOBAL, TOKEN_PROGRAM, SYSTEM_PROGRAM } from "./bots/lib/verified.mjs";
import { parseMintInput, cryingCatReport, createCryingCat, CRYING_LIMITS, CRYING_NOT_ADVICE } from "./src/lib/crying-cat.mjs";

const { ok, section, done } = harness("test-cats-crying");
const snaps = fixture("popcat/snapshots.json").snapshots;
const established = fixture("popcat/established-mints.json").accounts;
const acc = (owner, dataBase64) => ({ owner, lamports: 1, data: [dataBase64, "base64"] });
const encodeHolder = (h) => { const b = Buffer.alloc(40); new PublicKey(h.owner).toBuffer().copy(b); b.writeBigUInt64LE(BigInt(h.amount), 32); return { pubkey: h.account, account: { data: [b.toString("base64"), "base64"] } }; };

section("THE INPUT, CHECKED STRICTLY");
{
  const mint = snaps[0].apiRow.mint;
  const good = [[mint, mint], [`  ${mint}\n`, mint], [`https://pump.fun/coin/${mint}`, mint], [`https://pump.fun/coin/${mint}/`, mint]];
  for (const [input, want] of good) ok(`accepted: ${JSON.stringify(input).slice(0, 60)}`, parseMintInput(input).ok === true && parseMintInput(input).mint === want);
  const bad = [
    ["", "empty"], ["   ", "blank"], [null, "not text"], [`${mint.slice(0, 20)} ${mint.slice(20)}`, "a space inside"],
    ["0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl", "letters base58 does not have"], ["abc", "too short"], [mint + mint, "too long"],
    [`http://pump.fun/coin/${mint}`, "plain http"], [`https://pump.fun/coin/${mint}?ref=x`, "a query string"], [`https://evil.example/coin/${mint}`, "another site"],
    [`https://pump.fun.evil.example/coin/${mint}`, "a look-alike host"], [`javascript:alert(1)//${mint}`, "a script link"], [`<img src=x>${mint}`, "HTML"],
    ["1111111111111111111111111111111", "31 characters, too short to be 32 bytes"], [bs58.encode(Buffer.alloc(33, 9)), "33 bytes"],
  ];
  for (const [input, what] of bad) { const r = parseMintInput(input); ok(`refused, with a reason: ${what}`, r.ok === false && typeof r.why === "string" && r.why.length > 10, r.why); }
}

function chainFor({ mintAcc, curveAcc = null, holders = [], largest = null, gpaFails = false, extra = {} } = {}) {
  return scriptedRpc({
    getMultipleAccounts: ([list]) => ({ value: list.map((k) => (k === PUMPFUN_GLOBAL ? acc(PUMPFUN_PROGRAM, fixture("pumpfun/global.json").dataBase64) : extra[k] ?? (k === list[0] ? mintAcc : k === list[1] ? curveAcc : null))) }),
    getProgramAccounts: () => { if (gpaFails) throw Object.assign(new Error("getProgramAccounts: too many accounts"), { clause: "rpc_error" }); return holders.map(encodeHolder); },
    getTokenLargestAccounts: () => { if (!largest) throw Object.assign(new Error("getTokenLargestAccounts: refused"), { clause: "rpc_error" }); return { value: largest.map((l) => ({ address: l.account, amount: String(l.amount) })) }; },
  });
}
const check = (r, id) => r.checks.find((c) => c.id === id);

section("THE REPORT, FROM THE RECORDED COINS");
{
  const s = snaps[0];
  const rpc = chainFor({ mintAcc: acc(s.mintAccount.owner, s.mintAccount.dataBase64), curveAcc: acc(s.curveAccount.owner, s.curveAccount.dataBase64), holders: s.holders.list });
  const r = await cryingCatReport({ rpc, mint: s.apiRow.mint, now: Date.parse(s.read) });
  ok("Asset Cat, recorded: mint and freeze authority revoked, its Token-2022 extensions accepted", check(r, "mint_authority").result === "pass" && check(r, "freeze_authority").result === "pass" && check(r, "mint_extensions").result === "pass");
  ok("…its name and ticker read from the mint itself, not from anything the coin's page says", r.name === "Asset Cat" && r.symbol === "ASSCAT" && r.program === "Token-2022");
  ok("…the curve read as pump.fun's, graduated", r.pumpfun?.complete === true && check(r, "curve").value === "graduated");
  ok("…the holders with the curve and the program-held pool left out, counted (every account was listed)", r.holders.counted === true && r.holders.holders === 39 && r.holders.programHeld >= 1 && check(r, "top10_share").result === "pass", check(r, "top10_share").value);
  ok("…the creator's share known, because the curve names the creator", check(r, "creator_share").result === "pass" && /creator/.test(check(r, "creator_share").value));
  ok("…no copy of an established cat coin", check(r, "copycat").result === "pass");
  ok("…so no red flag found", r.verdict === "NO RED FLAGS FOUND" && r.flags.length === 0);
  ok("every check comes with plain words, and the not-advice line", r.notes.length >= 5 && r.notes.every((n) => typeof n === "string" && n.length > 20) && r.notAdvice === CRYING_NOT_ADVICE && /not advice/.test(CRYING_NOT_ADVICE));
  ok("the only links are Solscan and pump.fun, built from the mint and the curve's creator", r.links.every((l) => /^https:\/\/(solscan\.io\/account|pump\.fun\/coin)\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(l.href)) && r.links.some((l) => l.href === `https://pump.fun/coin/${s.apiRow.mint}`));
  ok("…and nothing the coin supplied: no image, no metadata link, no website", !/ipfs|image|theassetcats|x\.com|t\.me/i.test(JSON.stringify(r)));
  ok("it reads the chain only: one getMultipleAccounts (the mint, its curve, pump.fun's Global) and the holders", rpc.calls.map((c) => c.method).join() === "getMultipleAccounts,getProgramAccounts");

  const f = snaps[1];
  const r2 = await cryingCatReport({ rpc: chainFor({ mintAcc: acc(f.mintAccount.owner, f.mintAccount.dataBase64), curveAcc: acc(f.curveAccount.owner, f.curveAccount.dataBase64), holders: f.holders.list }), mint: f.apiRow.mint });
  ok("cosmic cat protocol, recorded: too few holders is a red flag, and the curve is still on pump.fun, partly sold", check(r2, "top10_share").result === "fail" && r2.pumpfun?.complete === false && /of the curve sold/.test(check(r2, "curve").value) && r2.verdict.startsWith("RED FLAGS"));
}

section("WHAT ONLY A BAD MINT HAS");
{
  const s = snaps[0];
  const base = Buffer.from(s.mintAccount.dataBase64, "base64");
  const withAuth = Buffer.from(base); withAuth.writeUInt32LE(1, 0); new PublicKey(s.apiRow.creator).toBuffer().copy(withAuth, 4);
  const withFreeze = Buffer.from(base); withFreeze.writeUInt32LE(1, 46); new PublicKey(s.apiRow.creator).toBuffer().copy(withFreeze, 50);
  const run = (data) => cryingCatReport({ rpc: chainFor({ mintAcc: acc(s.mintAccount.owner, data.toString("base64")), curveAcc: acc(s.curveAccount.owner, s.curveAccount.dataBase64), holders: s.holders.list }), mint: s.apiRow.mint });
  const a = await run(withAuth), b = await run(withFreeze);
  ok("a live mint authority is a red flag, said in plain words (more can be minted)", check(a, "mint_authority").result === "fail" && a.notes.some((n) => /can mint more of it/.test(n)));
  ok("a live freeze authority is a red flag, said in plain words (holders can be frozen)", check(b, "freeze_authority").result === "fail" && b.notes.some((n) => /can freeze any holder's tokens/.test(n)));
  const cwif = established.find((x) => x.address === "7atgF8KQo4wJrD5ATGX7t1V2zVvykPJbFfNeVf1icFv1");
  const tf = await cryingCatReport({ rpc: chainFor({ mintAcc: acc(cwif.owner, cwif.dataBase64), largest: [] }), mint: cwif.address });
  ok("a Token-2022 transfer fee (the recorded catwifhat mint) fails the extension audit, and is not a pump.fun coin", check(tf, "mint_extensions").result === "fail" && tf.pumpfun === null && check(tf, "creator_share").result === "info");
  const creator = s.apiRow.creator;
  const supply = base.readBigUInt64LE(36);
  const hoard = await cryingCatReport({ rpc: chainFor({ mintAcc: acc(s.mintAccount.owner, s.mintAccount.dataBase64), curveAcc: acc(s.curveAccount.owner, s.curveAccount.dataBase64), holders: [...s.holders.list, { account: Keypair.generate().publicKey.toBase58(), owner: creator, amount: String(supply / 10n) }] }), mint: s.apiRow.mint });
  ok("a creator holding 10% of the supply is a red flag (Popcat's line is 5%)", check(hoard, "creator_share").result === "fail" && /^10\.0/.test(check(hoard, "creator_share").value));
}

section("NOT A MINT, SAID SO");
{
  const who = Keypair.generate().publicKey.toBase58();
  const refuses = async (mintAcc, clause, re) => { try { await cryingCatReport({ rpc: chainFor({ mintAcc }), mint: who }); return false; } catch (e) { return e.clause === clause && re.test(e.message); } };
  ok("nothing at the address", await refuses(null, "not_found", /no account/));
  ok("a wallet", await refuses({ owner: SYSTEM_PROGRAM, lamports: 1, data: ["", "base64"] }, "not_a_mint", /wallet/));
  ok("a token account (someone's balance, 165 bytes)", await refuses(acc(TOKEN_PROGRAM, Buffer.alloc(165).toString("base64")), "not_a_mint", /token account/));
  ok("an account of another program", await refuses(acc(PUMPFUN_PROGRAM, Buffer.alloc(100).toString("base64")), "not_a_mint", /another program/));
  let noRpc = null; try { await cryingCatReport({ rpc: null, mint: who }); } catch (e) { noRpc = e.clause; }
  ok("no RPC: it asks for one", noRpc === "no_rpc");
}

section("A TOKEN TOO BIG TO LIST");
{
  const s = snaps[0];
  const mintAcc = acc(s.mintAccount.owner, s.mintAccount.dataBase64);
  const top = s.holders.list.slice(0, 20);
  const extra = Object.fromEntries(top.map((h) => { const d = Buffer.alloc(165); new PublicKey(s.apiRow.mint).toBuffer().copy(d, 0); new PublicKey(h.owner).toBuffer().copy(d, 32); d.writeBigUInt64LE(BigInt(h.amount), 64); return [h.account, acc(TOKEN_PROGRAM, d.toString("base64"))]; }));
  const rpc = chainFor({ mintAcc, curveAcc: null, gpaFails: true, largest: top, extra });
  const r = await cryingCatReport({ rpc, mint: s.apiRow.mint });
  ok("with no pump.fun curve it asks for the 20 largest accounts first, reads their owners, and leaves the pools out", r.holders.counted === false && /20 largest/.test(r.holders.source) && rpc.calls.map((c) => c.method).join() === "getMultipleAccounts,getTokenLargestAccounts,getMultipleAccounts");
  ok("…and says the holders were not counted rather than failing the count", /holders not counted/.test(check(r, "top10_share").value));
}

section("A NAME ON CHAIN IS A STRANGER'S TEXT");
{
  const s = snaps[0];
  const data = Buffer.from(s.mintAccount.dataBase64, "base64");
  const at = (text) => data.indexOf(Buffer.from(text, "utf8"));
  ok("the recorded mint carries its name and ticker in its Token-2022 metadata", at("Asset Cat") > 0 && at("ASSCAT") > 0);
  /* Same byte lengths, so the metadata's own length prefixes still hold: a right-to-left override
     in the name, and a zero-width space in the ticker. */
  const hostile = Buffer.from(data);
  Buffer.from("A‮t Cat", "utf8").copy(hostile, at("Asset Cat"));
  Buffer.from("​CAT", "utf8").copy(hostile, at("ASSCAT"));
  const r = await cryingCatReport({ rpc: chainFor({ mintAcc: acc(s.mintAccount.owner, hostile.toString("base64")), curveAcc: acc(s.curveAccount.owner, s.curveAccount.dataBase64), holders: s.holders.list }), mint: s.apiRow.mint });
  ok("a direction override or an invisible character in the name or ticker is dropped before the report carries it", r.name === "At Cat" && r.symbol === "CAT", JSON.stringify([r.name, r.symbol]));
}

section("ONE CHECK AT A TIME, NOT TWO WITHIN THREE SECONDS");
{
  const s = snaps[0];
  const T = { now: Date.parse("2026-09-25T12:00:00Z") };
  const desk = createCryingCat({ clock: () => T.now });
  const rpc = () => chainFor({ mintAcc: acc(s.mintAccount.owner, s.mintAccount.dataBase64), curveAcc: acc(s.curveAccount.owner, s.curveAccount.dataBase64), holders: s.holders.list });
  const clause = async (p) => { try { await p; return "ok"; } catch (e) { return e.clause; } };
  const [first, second] = await Promise.all([clause(desk.check({ rpc: rpc(), mint: s.apiRow.mint })), clause(desk.check({ rpc: rpc(), mint: s.apiRow.mint }))]);
  ok("a second check while one is running is refused (busy), and the first is answered", first === "ok" && second === "busy", `${first}, ${second}`);
  T.now += 1_000;
  ok("another a second later is refused (too_soon): at most one every three seconds", (await clause(desk.check({ rpc: rpc(), mint: s.apiRow.mint }))) === "too_soon");
  T.now += CRYING_LIMITS.minGapMs;
  ok("…and answered once the gap has passed", (await clause(desk.check({ rpc: rpc(), mint: s.apiRow.mint }))) === "ok");
  const bg = fs.readFileSync(path.join(ROOT, "src", "background.mjs"), "utf8");
  ok("the worker answers CRYING.CHECK through that one limiter", /const cryingCat = createCryingCat\(\);/.test(bg) && /cryingCat\.check\(\{ rpc: r\.rpc, mint: parsed\.mint \}\)/.test(bg) && !/cryingCatReport\(/.test(bg));
}

section("THE CODE: READS ONLY, AND GRUMPY CAT IS NOT BUILT");
{
  const src = fs.readFileSync(path.join(ROOT, "src", "lib", "crying-cat.mjs"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  ok("it signs nothing, holds no key, sends nothing and touches no chrome.* API", !/sign|Keypair|secret|sendTransaction|chrome\.|localStorage/.test(code));
  ok("it never fetches what the user pasted: only the address read out of it goes to the RPC", !/fetch\(/.test(code));
  ok("Grumpy Cat stays a character: the tab says why it is not here", /Grumpy Cat \(fake hype\) is not in the extension/.test(fs.readFileSync(path.join(ROOT, "src", "popup", "popup.html"), "utf8")));
}

done();
