/**
 * POPCAT'S TAB: THE CAT-COIN SCANNER IN THE EXTENSION, ON RECORDED ANSWERS.
 *
 * The listing, the chain and the metadata are the two real cat coins Popcat recorded on
 * 2026-09-24 (fixtures/bots/popcat/snapshots.json), with coins added around them to be refused:
 * one that is not a cat, one whose name carries HTML, one pump.fun marks banned, one that is a cat
 * only by its description, one the user launched with CashCat and one whose creator is the user's
 * autopilot wallet. No network: every answer is scripted.
 *
 *   · the list and the checks: the bot's twelve checks, the site validator's verdicts, every check
 *     shown with its label and what it read;
 *   · text only: nothing a coin supplied is shown but its name and ticker as text; no picture, no
 *     link but pump.fun's page and Solscan's, built from validated addresses; the popup draws it
 *     with textContent and never innerHTML;
 *   · the user's own CashCat coins are never listed, by mint, by wallet, or by the creator the
 *     bonding curve records;
 *   · the pace: a step checks at most two coins, never two steps at once, not closer than twenty
 *     seconds; pump.fun answering 429 rests the scanner and doubles; the public RPC refusing this
 *     browser rests it half an hour and says so; no RPC lists but checks nothing;
 *   · no trading: the tab's code names no signer, no wallet key and no transaction.
 */
import fs from "node:fs";
import path from "node:path";
import { PublicKey, Keypair } from "@solana/web3.js";
import { harness, fixture, scriptedFetch, scriptedRpc, response, ROOT } from "./bots/test/doubles.mjs";
import { createHttp } from "./bots/lib/http.mjs";
import { HOSTS } from "./bots/lib/verified.mjs";
import { cidOf } from "./bots/popcat/sources.mjs";
import { evaluate, THRESHOLDS } from "./bots/popcat/checks.mjs";
import { coinRow } from "./bots/popcat/sources.mjs";
import { CHECKS } from "./site/assets/callouts.js";
import { BONDING_CURVE_LAYOUT } from "./vendor/executor/snipe-venue-pumpfun.mjs";
import { createPopcatTab, POPCAT_TAB_LIMITS, POPCAT_TAB_HOSTS, POPCAT_NOT_ADVICE, POPCAT_CASHCAT_RULE, PUBLIC_RPC_REFUSED, POPCAT_TAB_STATE_KEY } from "./src/lib/popcat-tab.mjs";

const { ok, section, done } = harness("test-cats-popcat");
const MIN = 60_000;
const snaps = fixture("popcat/snapshots.json").snapshots;
const [passing, failing] = snaps;
const GLOBAL_ADDR = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf";
const encodeHolder = (h) => { const b = Buffer.alloc(40); new PublicKey(h.owner).toBuffer().copy(b); b.writeBigUInt64LE(BigInt(h.amount), 32); return { pubkey: h.account, account: { data: [b.toString("base64"), "base64"] } }; };
const acc = (a) => (a ? { owner: a.owner, lamports: 1, data: [a.dataBase64, "base64"] } : null);
const mapStore = () => { const m = new Map(); return { m, async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; }, async set(k, v) { m.set(k, structuredClone(v)); } }; };
const newKey = () => Keypair.generate().publicKey.toBase58();

const USER_WALLET = newKey();
const USER_COIN = newKey();

function world({ at = Date.parse(passing.read) + 10 * MIN, rpcMode = "yours", listing429 = 0, curveCreator = null, launches = null, extraRows = [] } = {}) {
  const T = { now: at };
  const clock = () => T.now;
  const byMint = Object.fromEntries(snaps.map((s) => [s.apiRow.mint, s]));
  const row = (over) => ({ ...failing.apiRow, mint: newKey(), bonding_curve: newKey(), creator: newKey(), ...over });
  const rows = [
    passing.apiRow, failing.apiRow,
    row({ name: "Dog Money", symbol: "DOGM", description: "a dog" }),
    row({ name: "<img src=x onerror=alert(1)> Cat", symbol: "HTMLCAT" }),
    row({ name: "Banned Cat", symbol: "BANCAT", is_banned: true }),
    row({ name: "Plain Coin", symbol: "PLAIN", description: "a cat and a kitten and a meow" }),
    row({ name: "My Own Cat", symbol: "MINECAT", mint: USER_COIN }),
    row({ name: "Wallet Cat", symbol: "WALLCAT", creator: USER_WALLET }),
    ...extraRows,
  ];
  let fail429 = listing429;
  const { fetchImpl, calls } = scriptedFetch([
    [/frontend-api-v3\.pump\.fun\/coins\?offset=0&limit=50&sort=created_timestamp/, () => (fail429-- > 0 ? response(429, "{}", { "retry-after": "1" }) : rows)],
    [/frontend-api-v3\.pump\.fun\/coins\?offset=\d+&limit=50&sort=created_timestamp/, () => []],
    [/frontend-api-v3\.pump\.fun\/coins-v2\/user-created-coins\//, (u) => ({ count: snaps.find((s) => u.includes(s.apiRow.creator))?.creatorLaunchCount ?? 0, coins: [] })],
    [/\/ipfs\//, (u) => { const s = snaps.find((x) => u.endsWith(cidOf(x.apiRow.metadata_uri))); return s && !s.metadata.unreadable ? s.metadata : response(404, "{}"); }],
  ]);
  const http = createHttp({ fetchImpl, allowedHosts: POPCAT_TAB_HOSTS, now: clock, sleep: async () => {} });
  const curveOf = (s) => {
    if (!curveCreator || s !== passing) return s.curveAccount;
    const d = Buffer.from(s.curveAccount.dataBase64, "base64"); new PublicKey(curveCreator).toBuffer().copy(d, BONDING_CURVE_LAYOUT.creator);
    return { ...s.curveAccount, dataBase64: d.toString("base64") };
  };
  const forbidden = () => { throw Object.assign(new Error("getMultipleAccounts: Access forbidden"), { clause: "rpc_error", detail: { code: 403 } }); };
  const rpc = scriptedRpc({
    getMultipleAccounts: ([list]) => (rpcMode === "forbidden" ? forbidden() : { value: list.map((k) => {
      if (k === GLOBAL_ADDR) return acc({ owner: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", dataBase64: fixture("pumpfun/global.json").dataBase64 });
      const s = byMint[k] ?? Object.values(byMint).find((x) => x.apiRow.bonding_curve === k);
      if (s && byMint[k]) return acc(s.mintAccount);
      return s ? acc(curveOf(s)) : null;
    }) }),
    getProgramAccounts: ([, opts]) => (byMint[opts.filters[0].memcmp.bytes]?.holders.list ?? []).map(encodeHolder),
    getSignaturesForAddress: ([addr]) => { const s = Object.values(byMint).find((x) => x.apiRow.bonding_curve === addr); return s ? [...s.creation.sameSlotBuyers.map((b, i) => ({ signature: `same${i}`, slot: s.creation.createSlot })), { signature: s.creation.createSig, slot: s.creation.createSlot, blockTime: s.creation.createTime }] : []; },
    getTransaction: ([sig]) => ({ transaction: { message: { accountKeys: [passing.creation.sameSlotBuyers[Number(String(sig).replace("same", ""))]] } } }),
  }, { isPublic: rpcMode !== "yours" });
  const storage = mapStore();
  const tab = createPopcatTab({ http, rpc: () => (rpcMode === "none" ? null : { rpc, isPublic: rpcMode !== "yours" }), storage, clock,
    exclusions: async () => launches ?? { launches: [{ mint: USER_COIN, creator: USER_WALLET }], wallets: [USER_WALLET] } });
  return { T, tab, rpc, calls, storage, http };
}
const checkedOnChain = (w, mint) => w.rpc.calls.some((c) => c.method === "getProgramAccounts" && c.params[1].filters[0].memcmp.bytes === mint);
const scanUntilQuiet = async (w) => { for (let i = 0; i < 6; i++) { w.T.now += POPCAT_TAB_LIMITS.minStepGapMs; await w.tab.step(); } };

section("THE LIST AND THE CHECKS, FROM THE RECORDED COINS");
{
  const w = world();
  const first = await w.tab.step();
  ok("one step reads the listing and checks at most two coins", first.ran === true && first.checked <= POPCAT_TAB_LIMITS.checksPerStep && POPCAT_TAB_LIMITS.checksPerStep === 2, JSON.stringify(first));
  await scanUntilQuiet(w);
  const st = await w.tab.status();
  const [a, b] = [st.results.find((r) => r.mint === passing.apiRow.mint), st.results.find((r) => r.mint === failing.apiRow.mint)];
  const expectB = evaluate({ coin: coinRow(failing.apiRow), onchain: { mintAcc: { owner: failing.mintAccount.owner, data: Buffer.from(failing.mintAccount.dataBase64, "base64") }, curveAcc: { owner: failing.curveAccount.owner, data: Buffer.from(failing.curveAccount.dataBase64, "base64") }, globalAcc: { owner: "x", data: Buffer.from(fixture("pumpfun/global.json").dataBase64, "base64") }, holders: failing.holders.list.map((h) => ({ ...h, amount: BigInt(h.amount) })), ...failing.creation }, creatorLaunches: Number(failing.creatorLaunchCount), metadata: { ok: true, doc: failing.metadata }, now: w.T.now });
  ok("the recorded passing coin is listed: NO RED FLAGS FOUND", a?.verdict === "NO RED FLAGS FOUND" && a.callout === true, a?.verdict);
  ok("the recorded failing coin is listed with its red flags counted, as the bot's checks find them", b?.verdict === `RED FLAGS (${expectB.failed.length})` && b.flags.map((f) => f.id).join() === expectB.failed.join(), `${b?.verdict}: ${b?.flags.map((f) => f.id).join()}`);
  ok("each shows all twelve checks, labelled as the floor labels them, with what each read", [a, b].every((r) => r.checks.length === 12 && r.checks.every((c) => c.label === CHECKS[c.id].label && typeof c.value === "string" && ["pass", "fail", "info"].includes(c.result))));
  ok("a red flag is said in the floor's plain words, which quote Popcat's own thresholds", b.flags.every((f) => f.flag === CHECKS[f.id].flag));
  ok("each carries the counts the checks read: holders besides the curve, the top 10's share, the curve sold", Number.isInteger(a.stats.holders) && typeof a.stats.top10Pct === "number" && typeof a.stats.curvePct === "number");
  ok("only the two recorded cat coins are listed", st.results.length === 2, st.results.map((r) => r.name).join(", "));
  ok("the coin that is not a cat was never checked on chain", !w.rpc.calls.some((c) => c.method === "getProgramAccounts" && ![passing.apiRow.mint, failing.apiRow.mint].includes(c.params[1].filters[0].memcmp.bytes)));
  ok("the coin whose name carries HTML is never shown, not even as waiting, nor checked", !JSON.stringify(st).includes("<img") && !JSON.stringify(st).includes("HTMLCAT") && w.rpc.calls.length > 0);
  const ghost = world({ extraRows: [{ ...failing.apiRow, mint: newKey(), bonding_curve: newKey(), creator: newKey(), name: "Ghost Cat", symbol: "GHOST" }] });
  await scanUntilQuiet(ghost);
  const sg = await ghost.tab.status();
  ok("a cat coin whose accounts do not exist on chain is tried, dropped after three tries, and never rests the scanner for the others", sg.results.length === 2 && !sg.resting && !JSON.stringify(sg).includes("GHOST"));
  ok("the coin pump.fun marks banned is never shown", !JSON.stringify(st).includes("BANCAT"));
  ok("a coin that is a cat only by its description is left out (no model in the tab to confirm it, as the bot without a key)", !JSON.stringify(st).includes("PLAIN"));
  ok("the not-advice line and the CashCat rule are carried with the list", st.notAdvice === POPCAT_NOT_ADVICE && st.cashcatRule === POPCAT_CASHCAT_RULE && /Not financial advice\.$/.test(st.notAdvice) && /never calls out a coin you launched with CashCat/.test(st.cashcatRule));
}

section("TEXT ONLY: NO PICTURE, NO LINK BUT PUMP.FUN'S AND SOLSCAN'S");
{
  const w = world();
  await scanUntilQuiet(w);
  const st = await w.tab.status();
  const text = JSON.stringify(st);
  const urls = [...text.matchAll(/https?:\/\/[^"\s]+/g)].map((m) => m[0]);
  ok("every URL in what the popup is given is a pump.fun coin page or a Solscan account page", urls.length > 0 && urls.every((u) => /^https:\/\/(pump\.fun\/coin|solscan\.io\/account)\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(u)), urls.filter((u) => !/pump\.fun\/coin|solscan\.io\/account/.test(u)).join(", "));
  ok("…each built from the coin's validated mint or creator", st.results.every((r) => r.links.map((l) => l.href).join() === `https://pump.fun/coin/${r.mint},https://solscan.io/account/${r.mint},https://solscan.io/account/${r.creator}`));
  ok("no picture and no link the coin supplied: not its image, its IPFS metadata, its website or its socials", !/ipfs|image|\.png|\.jpg|x\.com|t\.me|twitter\.com|theassetcats/i.test(text));
  const popup = fs.readFileSync(path.join(ROOT, "src", "popup", "cats.mjs"), "utf8");
  const code = popup.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  ok("the popup draws the tab with textContent and createElement, and never assigns innerHTML", !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code) && /textContent/.test(code) && /createElement/.test(code));
  ok("…and draws a link only when it is pump.fun's coin page or Solscan's, checked again there", /const SAFE_LINK = \/\^https:\\\/\\\/\(pump\\\.fun\\\/coin\|solscan\\\.io\\\/\(account\|tx\)\)/.test(code) && /if \(!l \|\| typeof l\.href !== "string" \|\| !SAFE_LINK\.test\(l\.href\)\) continue;/.test(code));
  ok("…opened in a new tab with no referrer and no opener", /rel: "noopener noreferrer"/.test(code) && /target: "_blank"/.test(code));
  ok("…and shows no image but CashCat's own logo, drawn in this browser", (code.match(/"img"|\.src =/g) ?? []).length === 1 && /\$\("ccLogo"\)\.src = res\.dataUrl/.test(code) && /res\.dataUrl\.startsWith\("data:image\/png;base64,"\)/.test(code));
}

section("THE USER'S OWN CASHCAT COINS ARE NEVER LISTED");
{
  const w = world();
  await scanUntilQuiet(w);
  const st = await w.tab.status();
  ok("a coin in the user's CashCat journal is never listed, nor checked", !JSON.stringify(st).includes(USER_COIN) && !checkedOnChain(w, USER_COIN));
  ok("a coin whose creator is the user's autopilot wallet is never listed", !JSON.stringify(st).includes("WALLCAT"));
  const byCurve = world({ curveCreator: USER_WALLET });
  await scanUntilQuiet(byCurve);
  const sc = await byCurve.tab.status();
  ok("a coin whose bonding curve names the user's wallet as creator, whatever pump.fun lists, is checked and then never listed", checkedOnChain(byCurve, passing.apiRow.mint) && !sc.results.some((r) => r.mint === passing.apiRow.mint));
  const late = world();
  await scanUntilQuiet(late);
  const before = (await late.tab.status()).results.length;
  const lateTab = createPopcatTab({ http: late.http, rpc: () => ({ rpc: late.rpc, isPublic: false }), storage: late.storage, clock: () => late.T.now,
    exclusions: async () => ({ launches: [{ mint: USER_COIN, creator: USER_WALLET }, { mint: passing.apiRow.mint, creator: passing.apiRow.creator }], wallets: [USER_WALLET] }) });
  const after = await lateTab.status();
  ok("a coin listed before the user launched it with CashCat leaves the list once it is in the journal (the validator excludes it)", before === 2 && !after.results.some((r) => r.mint === passing.apiRow.mint));
}

section("THE PACE: RATE LIMITS AND BACK-OFF");
{
  const w = world();
  const runs = await Promise.all([w.tab.step(), w.tab.step()]);
  ok("never two steps at once", runs.filter((r) => r.ran).length === 1 && runs.some((r) => /already running/.test(r.why ?? "")));
  const soon = await w.tab.step();
  ok("not two steps closer than twenty seconds, whoever asks (but the popup's Scan now may force it)", soon.ran === false && /moments ago/.test(soon.why) && (await w.tab.step({ force: true })).ran === true);
  const r = world({ listing429: 99 });
  const failed = await r.tab.step();
  const st = await r.tab.status();
  ok("pump.fun answering 429 rests the scanner, and says why", failed.ran === false && st.resting > r.T.now && /pump\.fun's listing could not be read \(rate_limited\)/.test(st.lastError ?? ""), st.lastError);
  const calls = r.calls.length;
  r.T.now += 30_000;
  const resting = await r.tab.step({ force: true });
  ok("while it rests, nothing is asked of pump.fun, even when forced", resting.ran === false && /resting until/.test(resting.why) && r.calls.length === calls);
  const firstRest = st.resting - (r.T.now - 30_000);
  r.T.now = st.resting + 1;
  await r.tab.step();
  const st2 = await r.tab.status();
  ok("a second failure rests it twice as long", st2.resting - r.T.now >= firstRest * 2 - 1, `${firstRest} then ${st2.resting - r.T.now}`);
  const pub = world({ rpcMode: "forbidden" });
  await pub.tab.step();
  const sp = await pub.tab.status();
  ok("the public RPC refusing this browser (403) rests the checks for half an hour and says to set an RPC", sp.lastError === PUBLIC_RPC_REFUSED && sp.resting - pub.T.now === POPCAT_TAB_LIMITS.publicRefusedRestMs && sp.rpc === "public");
  const none = world({ rpcMode: "none" });
  await none.tab.step();
  const sn = await none.tab.status();
  ok("with no RPC it still lists what it will check, checks nothing, and says why", sn.rpc === "none" && sn.results.length === 0 && sn.waiting.length >= 1 && /no RPC/.test(sn.lastError ?? "") && none.rpc.calls.length === 0);
}

section("A COIN IS CHECKED ONLY ONCE IT IS OLD ENOUGH");
{
  const young = Date.parse(failing.read) - 7 * MIN;       // the failing coin was about eight minutes old when recorded
  const w = world({ at: young });
  await w.tab.step();
  const st = await w.tab.status();
  ok(`a coin younger than ${THRESHOLDS.MIN_AGE_MINUTES} minutes waits in the queue, unchecked, and says when it will be checked`, !checkedOnChain(w, failing.apiRow.mint) && st.waiting.some((q) => q.ticker === "$Meow" && q.dueInMin > 0), JSON.stringify(st.waiting));
}

section("NO TRADING FROM THIS TAB");
{
  const src = fs.readFileSync(path.join(ROOT, "src", "lib", "popcat-tab.mjs"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  ok("the scanner's code names no signer, no key, no transaction and no swap", !/sign|Keypair|secret|Transaction|swap|jupiter|sendTransaction/i.test(src));
  ok("it touches no chrome.* API and stores only through the storage it is given", !/chrome\.|localStorage|sessionStorage/.test(src));
  ok("its hosts are pump.fun's API and the two IPFS gateways (plus the RPC the user set)", JSON.stringify([...POPCAT_TAB_HOSTS].sort()) === JSON.stringify([HOSTS.pinataGateway, HOSTS.pumpApi, HOSTS.pumpGateway].sort()));
  const w = world();
  await scanUntilQuiet(w);
  const hosts = new Set(w.calls.map((c) => new URL(c.url).host));
  ok("…and those are the only hosts a scan called", [...hosts].every((h) => POPCAT_TAB_HOSTS.includes(h)), [...hosts].join(", "));
  const stored = JSON.stringify([...w.storage.m.values()]);
  ok("what it keeps is its own state, under one key", [...w.storage.m.keys()].join() === POPCAT_TAB_STATE_KEY && !/sk-|secret|jwt/i.test(stored));
}

done();
