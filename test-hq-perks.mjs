/**
 * $CIA HOLDER PERKS: THE CHALLENGE, THE SIGNATURE, THE BALANCE ON CHAIN, THE TIER.
 *
 *   · a challenge is a message with a fresh nonce and an expiry, stored single-use;
 *   · a good signature over exactly that message, by that wallet, answers the tier its $CIA
 *     balance reaches; a bad signature, a replayed nonce, an expired one, another wallet's, a
 *     nonce the server never issued are each refused, by name;
 *   · the balance is read from the chain (every token account of the $CIA mint the wallet owns),
 *     and an unreadable balance is an error, never a tier;
 *   · the tiers come from HQ_PERK_TIERS; perks are cosmetic or a say, never early access.
 */
import crypto from "node:crypto";
import bs58 from "bs58";
import { harness } from "./bots/test/doubles.mjs";
import { createPerks, verifyEd25519, tierFor, readCiaBalance, challengeMessage, perksTiers, PERKS, TIERS, PerksError } from "./services/hq/lib/perks.mjs";
import { parsePerkTiers, CIA_MINT, ConfigError } from "./services/hq/lib/config.mjs";
import { SCHEMAS, validate } from "./services/hq/contract/schemas.mjs";
import { memDb, testConfig, testClock, extRpc, addr } from "./services/hq/test/doubles.mjs";

const { ok, section, done } = harness("test-hq-perks");
const CIA = 1_000_000n;                       // raw units in one $CIA (6 decimals)

/** A holder's wallet, made here: the address and a signMessage like Phantom's. */
function holderWallet() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const address = bs58.encode(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
  return { address, sign: (message) => bs58.encode(crypto.sign(null, Buffer.from(message, "utf8"), privateKey)) };
}
async function refusal(p) { try { await p; return null; } catch (e) { return e instanceof PerksError ? { clause: e.clause, status: e.status } : { clause: `threw ${e.message}` }; } }

section("THE CHALLENGE");
{
  const clock = testClock();
  const db = memDb(clock);
  const perks = createPerks({ db, config: testConfig(), clock, balanceOf: async () => 0n });
  const w = holderWallet();
  const c = perks.challenge(w.address);
  ok("it is the contract's shape", validate(SCHEMAS.PerksChallenge, c).length === 0, JSON.stringify(validate(SCHEMAS.PerksChallenge, c)));
  ok("the message is plain text naming the site, the wallet, the nonce and the expiry, and says signing moves nothing", c.message.includes("catintelligenceagency.com") && c.message.includes(w.address) && c.message.includes(`Nonce: ${c.nonce}`) && c.message.includes(c.expiresAt) && /moves nothing/.test(c.message) && /^[\x20-\x7e\n$—]+$/.test(c.message));
  ok("it expires after HQ_CHALLENGE_TTL_SECONDS (300 by default)", Date.parse(c.expiresAt) - clock() === 300_000);
  ok("each challenge has its own nonce", perks.challenge(w.address).nonce !== c.nonce);
  ok("it is stored single-use, for this wallet and this message", (() => { const r = db.getNonce(c.nonce); return r.purpose === "perks" && r.wallet === w.address && r.message === c.message && r.used_at === null; })());
  ok("a wallet that is not an address gets no challenge", (() => { try { perks.challenge("not-a-wallet"); return false; } catch (e) { return e.clause === "bad_wallet"; } })());
}

section("THE VERIFY: GOOD, BAD, REPLAYED, EXPIRED");
{
  const clock = testClock();
  const db = memDb(clock);
  const balances = new Map();
  const perks = createPerks({ db, config: testConfig(), clock, balanceOf: async (w) => balances.get(w) ?? 0n });
  const w = holderWallet();
  balances.set(w.address, 1_500_000n * CIA);
  const c = perks.challenge(w.address);
  const good = await perks.verify({ wallet: w.address, message: c.message, signature: w.sign(c.message) });
  ok("a good signature: holder, its balance as a $CIA decimal string, the tier its balance reaches, and the perks", good.holder === true && good.balance === "1500000" && good.tier === "agent" && good.perks.includes("vote:next-agent-strategy"));
  ok("…in the contract's shape, with the perks valid for HQ_PERKS_TTL_HOURS (24)", validate(SCHEMAS.PerksVerify, good).length === 0 && Date.parse(good.expiresAt) - clock() === 24 * 3_600_000);
  ok("the same signed message again: refused, replayed", JSON.stringify(await refusal(perks.verify({ wallet: w.address, message: c.message, signature: w.sign(c.message) }))) === JSON.stringify({ clause: "replayed", status: 401 }));
  const c2 = perks.challenge(w.address);
  const other = holderWallet();
  ok("a signature by another key: refused, bad_signature", (await refusal(perks.verify({ wallet: w.address, message: c2.message, signature: other.sign(c2.message) })))?.clause === "bad_signature");
  ok("…and that spent the nonce: a correct signature after it is refused as replayed", (await refusal(perks.verify({ wallet: w.address, message: c2.message, signature: w.sign(c2.message) })))?.clause === "replayed");
  const c3 = perks.challenge(w.address);
  clock.advance(300_001);
  ok("a challenge answered after its expiry: refused, expired", (await refusal(perks.verify({ wallet: w.address, message: c3.message, signature: w.sign(c3.message) })))?.clause === "expired");
  const c4 = perks.challenge(w.address);
  ok("another wallet presenting this wallet's challenge (signed by itself): refused, mismatch", (await refusal(perks.verify({ wallet: other.address, message: c4.message, signature: other.sign(c4.message) })))?.clause === "mismatch");
  const forged = challengeMessage({ wallet: w.address, nonce: bs58.encode(crypto.randomBytes(16)), issuedAt: new Date(clock()).toISOString(), expiresAt: new Date(clock() + 60_000).toISOString() });
  ok("a message with a nonce this server never issued: refused, unknown_challenge", (await refusal(perks.verify({ wallet: w.address, message: forged, signature: w.sign(forged) })))?.clause === "unknown_challenge");
  const c5 = perks.challenge(w.address);
  const edited = c5.message.replace("moves nothing", "moves everything");
  ok("the challenge's text edited, signed as edited: refused, mismatch", (await refusal(perks.verify({ wallet: w.address, message: edited, signature: w.sign(edited) })))?.clause === "mismatch");
  ok("a signature that is not base58: refused before anything is read", (await refusal(perks.verify({ wallet: w.address, message: c5.message, signature: "0x1234" })))?.clause === "bad_signature");
  ok("verifyEd25519 never throws on junk", verifyEd25519({ address: "x", message: "m", signature: "y" }) === false && verifyEd25519({ address: w.address, message: "m", signature: bs58.encode(Buffer.alloc(64)) }) === false);
}

section("THE BALANCE, THE TIERS");
{
  const tiers = parsePerkTiers("holder:1,agent:1000000,director:10000000");
  const cases = [[0n, "none"], [1n, "none"], [CIA - 1n, "none"], [CIA, "holder"], [999_999n * CIA, "holder"], [1_000_000n * CIA, "agent"], [10_000_000n * CIA, "director"]];
  for (const [raw, want] of cases) ok(`${raw} raw units of $CIA: ${want}`, tierFor(raw, tiers) === want);
  const d = testConfig().perkTiers;
  ok("the default tiers are 1, 1,000,000 and 10,000,000 $CIA", d.holder === CIA && d.agent === 1_000_000n * CIA && d.director === 10_000_000n * CIA);
  ok("tiers must rise: an agent tier under the holder tier is refused", (() => { try { parsePerkTiers("holder:10,agent:5"); return false; } catch (e) { return e instanceof ConfigError; } })());
  ok("an unknown tier name is refused", (() => { try { parsePerkTiers("holder:1,whale:5"); return false; } catch (e) { return e instanceof ConfigError; } })());
  const wallet = addr(9);
  const rows = [
    { pubkey: addr(10), account: { data: { parsed: { info: { mint: CIA_MINT, owner: wallet, tokenAmount: { amount: "700000000" } } } } } },
    { pubkey: addr(11), account: { data: { parsed: { info: { mint: CIA_MINT, owner: wallet, tokenAmount: { amount: "300000000" } } } } } },
    { pubkey: addr(12), account: { data: { parsed: { info: { mint: addr(13), owner: wallet, tokenAmount: { amount: "999999999999" } } } } } },
    { pubkey: addr(14), account: { data: { parsed: { info: { mint: CIA_MINT, owner: addr(15), tokenAmount: { amount: "999999999999" } } } } } },
  ];
  const rpc = extRpc({ getTokenAccountsByOwner: () => ({ value: rows }) });
  const b = await readCiaBalance(rpc, wallet);
  ok("the balance: every $CIA account the wallet owns, summed; other mints and other owners ignored", b === 1_000_000_000n);
  ok("…read from the chain by the $CIA mint", rpc.calls[0].method === "getTokenAccountsByOwner" && rpc.calls[0].params[1].mint === CIA_MINT);
  const clock = testClock();
  const perks = createPerks({ db: memDb(clock), config: testConfig(), clock, balanceOf: async () => { throw new Error("rpc down"); } });
  const w = holderWallet();
  const c = perks.challenge(w.address);
  ok("a balance that cannot be read: an error (503), never a tier", JSON.stringify(await refusal(perks.verify({ wallet: w.address, message: c.message, signature: w.sign(c.message) }))) === JSON.stringify({ clause: "balance_unreadable", status: 503 }));
  const none = createPerks({ db: memDb(clock), config: testConfig(), clock, balanceOf: async () => 0n });
  const c2 = none.challenge(w.address);
  const r = await none.verify({ wallet: w.address, message: c2.message, signature: w.sign(c2.message) });
  ok("a wallet with no $CIA: holder false, tier none, no perks", r.holder === false && r.tier === "none" && r.perks.length === 0 && r.balance === "0");
}

section("GET /v1/perks: THE TIERS, AS THE OWNER SET THEM");
{
  const t = perksTiers(testConfig());
  ok("the contract's shape", validate(SCHEMAS.PerksTiers, t).length === 0, JSON.stringify(validate(SCHEMAS.PerksTiers, t)));
  ok("lowest first, with the $CIA each needs, from HQ_PERK_TIERS", t.tiers.map((x) => `${x.id}:${x.minCia}`).join() === "holder:1,agent:1000000,director:10000000");
  const custom = testConfig({ HQ_PERK_TIERS: "holder:500,agent:250000.5" });
  const tc = perksTiers(custom);
  ok("the owner's own tiers (a tier left out is not listed)", tc.tiers.map((x) => `${x.id}:${x.minCia}`).join() === "holder:500,agent:250000.5");
  ok("…and verify judges by the same thresholds", tierFor(250_000_500_000n, custom.perkTiers) === "agent" && tierFor(250_000_499_999n, custom.perkTiers) === "holder" && tierFor(499_999_999n, custom.perkTiers) === "none");
  ok("each tier's perks are the perks verify answers for it", t.tiers.every((x) => JSON.stringify(x.perks) === JSON.stringify(PERKS[x.id])));
}

section("PERKS ARE COSMETIC OR A SAY, NEVER MONEY OR TIMING");
{
  const all = [...new Set(Object.values(PERKS).flat())];
  ok("every perk is a skin, a vote or a proposal", all.every((p) => /^(skins|vote|propose):[a-z-]+$/.test(p)), all.join(", "));
  ok("none is early access, a signal, a pick or a fee", !all.some((p) => /early|signal|pick|alert|trade|fee|yield|reward|airdrop/i.test(p)));
  ok("each tier keeps what the tier below has", TIERS.slice(1).every((t, i) => PERKS[TIERS[i]].every((p) => PERKS[t].includes(p))));
}

done();
