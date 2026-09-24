/**
 * ONE CASHCAT RUN: CAPS, TRENDS, A COIN, ITS LOGO AND METADATA, THE TRANSACTION, THE CHECK, THE
 * SIMULATION — AND, ONLY WHEN EVERY LIVE GUARD IS GREEN, THE SIGNATURE.
 *
 * Dry run (the default): every step up to the point of sending — the coin is invented and
 * reviewed (when a key is set), the logo is rendered, the metadata is built but not uploaded,
 * the transaction is built from the verified layouts, checked, and simulated on mainnet when a
 * funded address is known (the wallet, or CASHCAT_WALLET_ADDRESS). The plan is printed. Nothing
 * is uploaded, signed or sent, and nothing is written to launches.json.
 *
 * Live (CASHCAT_LIVE=1 and every guard in config.mjs liveRefusals green): the metadata is pinned
 * and read back, the transaction is rebuilt with the real URI, checked and simulated again,
 * signed by wallet.mjs over exactly the checked message, sent, confirmed, and read back from the
 * chain; then, and only then, the launch is appended to launches.json. The optional dev buy (a
 * second transaction, same wallet) and the creator-fee claim follow the same check → simulate →
 * sign path. CashCat never buys or sells from any other wallet and never trades its coins after
 * launch: the only money that comes back is the pump.fun creator fee its wallet claims.
 */
import { Transaction, PublicKey } from "@solana/web3.js";
import { readConfig, liveRefusals, MAX_LAUNCH_SPEND_LAMPORTS, COMPUTE_LIMITS } from "./config.mjs";
import { readTrends } from "./trends.mjs";
import { loadVerifiedIndex } from "./tickers.mjs";
import { inventCoin } from "./invent.mjs";
import { pinMetadata, dryRunMetadata } from "./metadata.mjs";
import { createV2Ix, createV2CustomPairIx, customPairAccounts, decodeQuoteControl, quoteControlAddress, collectCreatorFeeIx, creatorVault, devBuyIxs } from "./pumpfun.mjs";
import { planStonkfunLaunch, initializeIx, resolveQuote, poolState } from "./stonkfun.mjs";
import { checkLaunchMessage, checkSimulation, checkDevBuyMessage, checkCollectFeeMessage, TxRefused } from "../lib/txcheck.mjs";
import { computeUnitLimit, computeUnitPrice, pda } from "../lib/solana.mjs";
import { loadLaunches, appendLaunch } from "../lib/data.mjs";
import { throwawayAddress } from "./wallet.mjs";
import { PUMPFUN_PROGRAM, PUMPFUN_GLOBAL, LAUNCHLAB_PROGRAM, IX, WSOL_MINT, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "../lib/verified.mjs";
import { describeMint } from "../../vendor/executor/token2022.mjs";
import bs58 from "bs58";

const LAMPORTS = 1_000_000_000;
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const isoSecond = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Venues take turns, by how many launches are on file. */
export function pickVenue(venues, launches) { return venues[launches.length % venues.length]; }

/**
 * Launches the wallet made on chain today (a create_v2 or a LaunchLab initialize it signed),
 * so a launch that was sent but never recorded still counts against the day.
 */
export async function onchainLaunchesToday({ rpc, wallet, now }) {
  const dayStart = Math.floor(Date.parse(`${utcDay(now())}T00:00:00Z`) / 1000);
  const sigs = (await rpc.getSignaturesForAddress(wallet, { limit: 100 })).filter((s) => !s.err && (s.blockTime ?? 0) >= dayStart);
  const found = [];
  for (const s of sigs.slice(0, 30)) {
    const tx = await rpc.getTransaction(s.signature);
    const m = tx?.transaction?.message;
    if (!m || tx.meta?.err) continue;
    const keys = [...m.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
    if (keys[0] !== wallet) continue;
    const isLaunch = m.instructions.some((ix) => {
      const program = keys[ix.programIdIndex];
      const disc = Buffer.from(bs58decode(ix.data)).subarray(0, 8).toString("hex");
      return (program === PUMPFUN_PROGRAM && disc === IX.pumpCreateV2) || (program === LAUNCHLAB_PROGRAM && disc === IX.launchlabInitializeWithToken2022);
    });
    if (isLaunch) found.push(s.signature);
  }
  return found;
}
const bs58decode = (s) => bs58.decode(s);

function buildLaunchTx({ venue, payer, mint, coin, uri, plan, blockhash, priority }) {
  const tx = new Transaction({ feePayer: new PublicKey(payer), recentBlockhash: blockhash });
  tx.add(computeUnitLimit(COMPUTE_LIMITS[venue]), computeUnitPrice(priority));
  const base = { mint, user: payer, name: coin.name, symbol: coin.symbol, uri };
  if (venue === "pumpfun") tx.add(createV2Ix(base));
  else if (venue === "pumpfun-xstock") tx.add(createV2CustomPairIx({ ...base, quoteMint: plan.quote.mint, quoteTokenProgram: plan.quote.tokenProgram }));
  else tx.add(initializeIx({ payer, mint, quoteMint: plan.quote.mint, quoteTokenProgram: plan.quote.tokenProgram, globalConfig: plan.globalConfig, curveRule: plan.curveRule, name: coin.name, symbol: coin.symbol, uri, raiseRaw: plan.raiseRaw, cpmmCreatorFeeOn: plan.cpmmCreatorFeeOn }));
  return tx;
}

async function planFor({ venue, config, http, rpc }) {
  if (venue === "pumpfun") return { quote: { symbol: "SOL", mint: WSOL_MINT } };
  if (venue === "stonkfun") return planStonkfunLaunch({ http, rpc, quoteChoice: config.stonkfunQuote });
  /* pump.fun Custom Pairs: the stock must be on the official xStock list, on pump.fun's
     QuoteControl list on chain, and a token mint. */
  const quote = resolveQuote(config.pumpXstockQuote);
  const [qc, mintAcc] = await rpc.getMultipleAccounts([quoteControlAddress(), quote.mint]);
  if (!qc || qc.owner !== PUMPFUN_PROGRAM) throw new TxRefused("quote_control", "pump.fun's QuoteControl account is not readable");
  if (!decodeQuoteControl(qc.data).mints.some((m) => m.mint === quote.mint)) throw new TxRefused("quote_control", `${quote.symbol} is not on pump.fun's quote list`);
  if (!mintAcc || (mintAcc.owner !== TOKEN_2022_PROGRAM && mintAcc.owner !== TOKEN_PROGRAM)) throw new TxRefused("quote_mint", `${quote.symbol}'s mint does not read as a token mint`);
  return { quote: { symbol: quote.symbol, mint: quote.mint, tokenProgram: mintAcc.owner } };
}

async function checkAndSimulate({ rpc, tx, venue, payer, mint, coin, uri, plan, log }) {
  const message = tx.serializeMessage();
  const checkPlan = venue === "pumpfun-xstock" ? { extraAccounts: customPairAccounts({ mint, quoteMint: plan.quote.mint, quoteTokenProgram: plan.quote.tokenProgram }) } : plan;
  checkLaunchMessage(tx.compileMessage(), { wallet: payer, mint, venue, coin: { name: coin.name, symbol: coin.symbol, uri }, plan: checkPlan });
  log.info(`pre-sign check: passed (${venue}: fee payer, signers, programs, accounts and arguments are the planned ones)`);
  if (!rpc) return { message, simulated: false, why: "no RPC" };
  const before = await rpc.getBalance(payer);
  if (!before) return { message, simulated: false, why: `the payer ${payer} holds no SOL, so the launch cannot be simulated` };
  const sim = await rpc.simulate(tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), { replaceRecentBlockhash: true, accounts: [payer] });
  const result = checkSimulation(sim, { walletBefore: before, walletAfter: sim?.accounts?.[0]?.lamports, maxSpendLamports: MAX_LAUNCH_SPEND_LAMPORTS[venue],
    mustLog: venue === "stonkfun" ? "Instruction: InitializeWithToken2022" : "Instruction: CreateV2" });
  log.info(`simulation: ok, ${result.units} compute units, the wallet spends ${(result.spentLamports / LAMPORTS).toFixed(6)} SOL (rent and fees)`);
  return { message, simulated: true, spentLamports: result.spentLamports, units: result.units };
}

async function sendAndConfirm({ rpc, tx, now, sleep, log, timeoutMs = 90_000 }) {
  const signature = await rpc.sendRaw(tx.serialize().toString("base64"));
  log.info(`sent: ${signature}`);
  const start = now();
  for (;;) {
    const [st] = await rpc.getSignatureStatuses([signature]);
    if (st?.err) throw new TxRefused("failed_on_chain", `the transaction failed on chain: ${JSON.stringify(st.err).slice(0, 200)}`);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return signature;
    if (now() - start > timeoutMs) throw new TxRefused("unconfirmed", `not confirmed after ${timeoutMs / 1000} s: check ${signature} by hand before the next run`);
    await sleep(2_000);
  }
}

/** Read a landed launch back: success, the wallet's cost, and the new mint on chain. */
async function readBack({ rpc, signature, wallet, mint, sleep }) {
  let tx = null;
  for (let i = 0; i < 10 && !tx; i++) { tx = await rpc.getTransaction(signature); if (!tx) await sleep(2_000); }
  if (!tx) throw new TxRefused("read_back", `the transaction ${signature} could not be read back`);
  if (tx.meta?.err) throw new TxRefused("read_back", "the transaction is recorded as failed");
  const keys = tx.transaction.message.accountKeys;
  const i = keys.indexOf(wallet);
  if (i !== 0) throw new TxRefused("read_back", "the wallet is not the fee payer of the landed transaction");
  const costLamports = tx.meta.preBalances[0] - tx.meta.postBalances[0];
  const acc = await rpc.getAccountInfo(mint);
  if (!acc) throw new TxRefused("read_back", "the new mint does not exist on chain");
  const d = describeMint({ owner: acc.owner, data: acc.data }, mint);
  if (d.mintAuthority || d.freezeAuthority) throw new TxRefused("read_back", "the new mint kept a mint or freeze authority");
  return { costLamports, feeLamports: tx.meta.fee, slot: tx.slot };
}

/** Claim pump.fun creator fees when the vault holds enough to be worth the network fee. */
export async function collectFees({ rpc, wallet, config, now, sleep, log }) {
  const vault = creatorVault(wallet.publicKey);
  const acc = await rpc.getAccountInfo(vault);
  if (!acc) { log.info("creator fees: the vault does not exist yet (no trades on a CashCat coin)"); return null; }
  const rent = await rpc.getMinimumBalanceForRentExemption(acc.data.length);
  const claimable = acc.lamports - rent;
  if (claimable < config.collectFeesMinSol * LAMPORTS) { log.info(`creator fees: ${(Math.max(0, claimable) / LAMPORTS).toFixed(6)} SOL waiting, under the ${config.collectFeesMinSol} SOL threshold`); return null; }
  const { blockhash } = await rpc.getLatestBlockhash();
  const tx = new Transaction({ feePayer: new PublicKey(wallet.publicKey), recentBlockhash: blockhash });
  tx.add(computeUnitLimit(60_000), computeUnitPrice(config.priorityMicroLamports), collectCreatorFeeIx({ creator: wallet.publicKey }));
  checkCollectFeeMessage(tx.compileMessage(), { wallet: wallet.publicKey });
  const before = await rpc.getBalance(wallet.publicKey);
  const sim = await rpc.simulate(tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), { replaceRecentBlockhash: true, accounts: [wallet.publicKey] });
  checkSimulation(sim, { walletBefore: before, walletAfter: sim?.accounts?.[0]?.lamports, maxSpendLamports: 0, mayGain: true });
  wallet.sign(tx, { checkedMessage: tx.serializeMessage() });
  const signature = await sendAndConfirm({ rpc, tx, now, sleep, log });
  log.info(`creator fees: claimed about ${(claimable / LAMPORTS).toFixed(6)} SOL in ${signature}`);
  return signature;
}

/** The optional dev buy: a second transaction, after the launch landed, from the same wallet. */
async function devBuy({ rpc, wallet, mint, config, now, sleep, log }) {
  const spend = BigInt(Math.round(config.devBuySol * LAMPORTS));
  const curveAddr = pda([{ utf8: "bonding-curve" }, { key: mint }], PUMPFUN_PROGRAM);
  const slot = await rpc.getSlot();
  const [curveAcc, globalAcc] = await rpc.getMultipleAccounts([curveAddr, PUMPFUN_GLOBAL]);
  const { ixs } = devBuyIxs({ mint, user: wallet.publicKey, curveAccount: curveAcc, curveReadSlot: slot, globalAccount: globalAcc, spendLamports: spend });
  const { blockhash } = await rpc.getLatestBlockhash();
  const tx = new Transaction({ feePayer: new PublicKey(wallet.publicKey), recentBlockhash: blockhash });
  tx.add(computeUnitLimit(200_000), computeUnitPrice(config.priorityMicroLamports), ...ixs);
  checkDevBuyMessage(tx.compileMessage(), { wallet: wallet.publicKey, mint, maxSpendLamports: spend });
  const before = await rpc.getBalance(wallet.publicKey);
  const sim = await rpc.simulate(tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), { replaceRecentBlockhash: true, accounts: [wallet.publicKey] });
  checkSimulation(sim, { walletBefore: before, walletAfter: sim?.accounts?.[0]?.lamports, maxSpendLamports: Number(spend) + 4_000_000 });
  wallet.sign(tx, { checkedMessage: tx.serializeMessage() });
  const signature = await sendAndConfirm({ rpc, tx, now, sleep, log });
  log.info(`dev buy: ${config.devBuySol} SOL at most, ${signature}`);
  return signature;
}

/**
 * Run CashCat once. Everything is injected; nothing here reads process.env or the network by
 * itself. Returns a summary: { mode, outcome, ... }.
 */
export async function runCashCat({ env, http, rpc, model, wallet, dataDir, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log, render }) {
  const config = readConfig(env);
  const mode = config.live ? "live" : "dry";
  log.section(`CashCat — ${mode === "live" ? "LIVE" : "dry run: nothing will be uploaded, signed or sent"}`);
  const launches = loadLaunches(dataDir);
  const today = utcDay(now());
  const recordedToday = launches.filter((l) => l.time.startsWith(today)).length;
  let onchainToday = [];
  const payer = wallet?.publicKey ?? config.walletAddress ?? "";
  if (payer && rpc) {
    try { onchainToday = await onchainLaunchesToday({ rpc, wallet: payer, now }); }
    catch (e) { log.warn(`could not count today's launches on chain: ${e.message}`); if (mode === "live") return { mode, outcome: "refused", refusals: ["today's launches could not be counted on chain"] }; }
  }
  const recordedTx = new Set(launches.map((l) => l.tx));
  const unrecorded = onchainToday.filter((s) => !recordedTx.has(s));
  const launchesToday = Math.max(recordedToday, onchainToday.length);
  log.info(`launches today (UTC ${today}): ${launchesToday} of ${config.maxLaunchesPerDay}${unrecorded.length ? `; ${unrecorded.length} on chain but not recorded: ${unrecorded.join(", ")}` : ""}`);

  if (mode === "live" && wallet && rpc && config.hasOwnRpc) {
    try { await collectFees({ rpc, wallet, config, now, sleep, log }); }
    catch (e) { log.warn(`creator fees: not claimed — ${e.message}`); }
  }
  if (launchesToday >= config.maxLaunchesPerDay) return { mode, outcome: "cap_reached", launchesToday };

  const venue = pickVenue(config.venues, launches);
  log.info(`venue: ${venue}`);
  let plan;
  try { plan = await planFor({ venue, config, http, rpc }); }
  catch (e) { log.warn(`the ${venue} plan was refused: ${e.message}`); return { mode, outcome: "venue_refused", venue, why: e.message }; }
  if (plan.quote) log.info(`quote: ${plan.quote.symbol} ${plan.quote.mint}${plan.globalConfig ? `, LaunchLab config ${plan.globalConfig}, curve rule ${plan.curveRule}, raise ${plan.raiseRaw}` : ""}`);

  const trends = await readTrends({ http, log });
  for (const d of trends.dropped.slice(0, 8)) log.info(`  dropped trend "${d.title}": ${d.why}`);
  let verifiedIndex = null;
  try { verifiedIndex = await loadVerifiedIndex(http); log.info(`Jupiter verified tokens: ${verifiedIndex.size}`); }
  catch (e) { log.warn(`Jupiter's verified list could not be read: ${e.message}`); }

  const invention = await inventCoin({ model, trends: trends.usable, verifiedIndex, requireModel: mode === "live", log });
  for (const a of invention.attempts) log.info(`  attempt: ${JSON.stringify(a)}`);
  if (!invention.coin) { log.info(`no coin this run: ${invention.why}`); return { mode, outcome: "no_coin", why: invention.why, attempts: invention.attempts }; }
  const coin = invention.coin;
  log.info(`coin: ${coin.name} ($${coin.symbol}) — "${coin.tagline}" — riffing on "${coin.trend.title}" (${coin.trend.source})${coin.template ? " [template: no model]" : ""}`);

  const logo = await render({ ticker: coin.symbol, kitten: coin.kitten, background: coin.background });
  log.info(`logo: ${coin.kitten} kitten on ${coin.background}, ${logo.length} bytes`);

  const mint = wallet ? wallet.newMint() : throwawayAddress();
  const txPayer = payer || throwawayAddress();
  /* The first build uses a placeholder URI of the real length: everything that can be decided
     before an upload is decided first, so a live run never pins files for a launch a guard
     would refuse. A dry run stops after this build. */
  const placeholder = dryRunMetadata({ coin: { ...coin, trendTitle: coin.trend.title }, venue });
  log.info(`metadata document${mode === "dry" ? " (not uploaded in a dry run)" : ""}: ${JSON.stringify(placeholder.document)}`);
  const { blockhash } = rpc ? await rpc.getLatestBlockhash() : { blockhash: "11111111111111111111111111111111" };
  let tx = buildLaunchTx({ venue, payer: txPayer, mint, coin, uri: placeholder.uri, plan, blockhash, priority: config.priorityMicroLamports });
  let sim;
  try { sim = await checkAndSimulate({ rpc, tx, venue, payer: txPayer, mint, coin, uri: placeholder.uri, plan, log }); }
  catch (e) { wallet?.forgetMint(mint); log.warn(`refused before signing: ${e.message}`); return { mode, outcome: "refused", refusals: [e.message] }; }
  if (!sim.simulated) log.info(`not simulated: ${sim.why}`);

  let balance = null;
  if (rpc && payer) { try { balance = await rpc.getBalance(payer); } catch { balance = null; } }
  const refusals = liveRefusals(config, { wallet, balanceLamports: balance, launchesToday, unrecordedToday: unrecorded.length, venue, simulated: sim.simulated, reviewed: invention.reviewed === true });
  if (mode === "dry") {
    wallet?.forgetMint(mint);
    log.info(`dry run complete. A live launch would still need: ${refusals.filter((r) => r !== "CASHCAT_LIVE is not 1").join("; ") || "nothing — every guard is green"}`);
    return { mode, outcome: "dry_run", venue, coin: { name: coin.name, symbol: coin.symbol, trend: coin.trend.title }, simulated: sim.simulated, refusals };
  }
  if (refusals.length) { wallet?.forgetMint(mint); log.warn(`LIVE refused: ${refusals.join("; ")}`); return { mode, outcome: "refused", refusals }; }

  /* ── live: pin, rebuild with the real URI, check and simulate again, sign, send ── */
  const pinned = await pinMetadata({ http, jwt: env.PINATA_JWT, logoPng: logo, coin: { ...coin, trendTitle: coin.trend.title }, venue });
  const uri = pinned.uri;
  log.info(`metadata pinned and read back: ${uri}`);
  const fresh = await rpc.getLatestBlockhash();
  tx = buildLaunchTx({ venue, payer, mint, coin, uri, plan, blockhash: fresh.blockhash, priority: config.priorityMicroLamports });
  const again = await checkAndSimulate({ rpc, tx, venue, payer, mint, coin, uri, plan, log });
  if (!again.simulated) { wallet.forgetMint(mint); return { mode, outcome: "refused", refusals: [`not simulated: ${again.why}`] }; }
  wallet.sign(tx, { checkedMessage: again.message, mint });
  const signature = await sendAndConfirm({ rpc, tx, now, sleep, log });
  const back = await readBack({ rpc, signature, wallet: payer, mint, sleep });
  log.info(`launched: ${coin.name} ($${coin.symbol}) mint ${mint}, cost ${(back.costLamports / LAMPORTS).toFixed(6)} SOL`);

  let devBuyTx = null;
  if (config.devBuySol > 0 && venue === "pumpfun") {
    try { devBuyTx = await devBuy({ rpc, wallet, mint, config, now, sleep, log }); }
    catch (e) { log.warn(`dev buy not made: ${e.message}`); }
  }
  const entry = {
    time: isoSecond(now()), venue, name: coin.name, symbol: coin.symbol, tagline: coin.tagline,
    trend: { title: coin.trend.title, source: coin.trend.source }, mint, creator: payer, tx: signature,
    quote: { symbol: plan.quote.symbol, mint: plan.quote.mint },
    ...(venue === "stonkfun" ? { pool: poolState(mint, plan.quote.mint) } : {}),
    devBuy: devBuyTx ? { sol: config.devBuySol, tx: devBuyTx } : { sol: 0 },
    costSol: Number((back.costLamports / LAMPORTS).toFixed(9)),
    kitten: coin.kitten,
  };
  appendLaunch(dataDir, entry);
  log.info("recorded in launches.json");
  return { mode, outcome: "launched", entry };
}
