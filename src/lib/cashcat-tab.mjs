/**
 * CASHCAT, IN YOUR BROWSER: LAUNCH A CAT COIN OF YOUR OWN ON PUMP.FUN.
 *
 * The agency's CashCat (bots/cashcat/) launches cat coins by itself from GitHub Actions. This is
 * the same machinery, driven by one person from the extension, with every guard the bot has and
 * none loosened. What it reuses, byte for byte:
 *
 *   · the create transaction: bots/cashcat/pumpfun.mjs createV2Ix — pump.fun's create_v2, whose
 *     sixteen accounts were re-derived from eleven real launches (test-bots-pumpfun.mjs);
 *   · the check before any signature: bots/lib/txcheck.mjs checkLaunchMessage, on the COMPILED
 *     v0 message (exactly the payer and the new mint as signers, at most two compute-budget
 *     instructions, one create_v2 whose accounts and decoded arguments are the planned ones: this
 *     coin's name, ticker and metadata URI, the wallet as creator, no option set), then a
 *     simulation that must succeed, log CreateV2 and spend at most the bot's launch budget
 *     (MAX_LAUNCH_SPEND_LAMPORTS, 0.015 SOL) — checkSimulation;
 *   · the metadata: bots/cashcat/metadata.mjs pinMetadata, through the user's own Pinata key,
 *     read back from the public gateway before its URI is written into a transaction, with the
 *     user's document (buildUserDocument): "Not financial advice. Not affiliated with [topic]."
 *     and no claim of the agency; "Made with CashCat." only when the user ticks it (off by default);
 *   · the optional dev buy: the bot's devBuyIxs and checkDevBuyMessage, a separate transaction
 *     after the launch landed, 0 by default, at most 0.05 SOL (FENCES.devBuySol), manual only.
 *
 * WHO SIGNS: THE AUTOPILOT WALLET, ONLY. A create names two signers, the payer and the new mint.
 * The mint's keypair is made, used once and dropped in the autopilot wallet's own module (the
 * one file under src/ that may hold a key, which only the worker imports), handed here as
 * `mintKeys`; its signature is added first, and then the engine's signSendConfirm, bound to the
 * autopilot wallet (engine.agentFences), signs, checks the message is the one that was checked,
 * sends and confirms. Phantom is not offered for CashCat: whether Phantom keeps another signer's
 * signature on a v0 transaction it is asked to sign could not be verified here, and a launch whose
 * mint signature Phantom dropped or whose message it changed would fail or be refused after the
 * user approved it.
 *
 * AUTO MODE (off by default): draft from a trend → the model's review → launch, on a schedule,
 * while Chrome is open, from the autopilot wallet only, armed by a typed sentence that names the
 * wallet and every cap: at most 2 launches a UTC day (every launch from the extension counts),
 * never below the minimum balance, no dev buy, and nothing after a launch — it never buys or
 * sells the coins it launched, from any wallet, and uses no other wallet. Changing a cap, or the
 * wallet, disarms it. A launch whose outcome could not be read disarms it too.
 *
 * THE JOURNAL keeps every launch (its mint, signature, trend or topic, cost) and every refusal,
 * newest first. A launch is written as "sending" BEFORE it is signed, so a worker that dies
 * mid-send still counts it against the day and leaves it for the user to check. Trimming it to
 * JOURNAL_MAX never drops a launch that still blocks the next one or counts against the day.
 *
 * THE SETTINGS are read, changed and written under one lock (withSettings), so a disarm or a cap
 * changed while the alarm's tick reads them is never overwritten by that tick; and an automatic
 * run checks it is still armed, for the same wallet and caps, before it pins and again before
 * anything is signed.
 *
 * STOCK CATS (CoinMarketCat's tab) launch through this file too, because it is the one file besides
 * the key file that reaches a mint's signature: `stockCats` below. A stock cat is a cat coin of the
 * owner's own paired on StonkFun with one xStock (src/lib/stockcats.mjs has its rules). It is the
 * same pipeline with the venue swapped (VENUE_RUN): Raydium LaunchLab's initialize_with_token_2022
 * (bots/cashcat/stonkfun.mjs initializeIx), from a plan StonkFun's API priced and the chain proved
 * (planStonkfunLaunch, injected as `stonkfun.plan`, read once for the check and again at the
 * launch), held to the bot's pre-sign check with venue "stonkfun" and to a simulation that must log
 * InitializeWithToken2022 and spend at most the bot's StonkFun budget. What differs, on purpose:
 *   · MANUAL ONLY, one at a time, from the autopilot wallet: never in auto mode (manual_only), never
 *     a dev buy (a dev buy there would be paid in the stock; devBuy refuses any venue but pump.fun);
 *   · ARMED BY A CHECK, NOT A SENTENCE: "Check the launch" keeps a record in this worker's memory
 *     only — the pair, the draft's fingerprint, the wallet and the plan's accounts — and the launch
 *     needs that record, under ten minutes old, for the same pair, draft and wallet, and the ticker
 *     typed; the record is used once, so nothing stays armed;
 *   · ONE CAT PER STOCK, EVER, and the day's cap counts every launch from this extension; a stock
 *     cat's launch record is never trimmed from the journal, so "ever" holds;
 *   · a launch whose new mint still carries a mint or freeze authority when it is read back blocks
 *     every further stock cat (unclean_mint) until the owner marks it checked.
 *
 * pump.fun coins quoted in a stock stay the agency's CashCat's: this tab's own coins are SOL-quoted
 * pump.fun coins. Everything is injected; this file touches no chrome.* API and holds no key.
 */
import { buildUnsignedTransaction, toBase64, RENT_EXEMPT_EMPTY_ACCOUNT_LAMPORTS } from "./tx.mjs";
import { createV2Ix, devBuyIxs } from "../../bots/cashcat/pumpfun.mjs";
import { initializeIx, poolState } from "../../bots/cashcat/stonkfun.mjs";
import { checkLaunchMessage, checkDevBuyMessage, checkSimulation } from "../../bots/lib/txcheck.mjs";
import { MAX_LAUNCH_SPEND_LAMPORTS, COMPUTE_LIMITS, FENCES } from "../../bots/cashcat/config.mjs";
import { buildUserDocument, userDisclosure, uriFor } from "../../bots/cashcat/metadata.mjs";
import { PUMPFUN_PROGRAM, PUMPFUN_GLOBAL, PAGES } from "../../bots/lib/verified.mjs";
import { pda } from "../../bots/lib/solana.mjs";
import { describeMint } from "../../vendor/executor/token2022.mjs";
import { typedDraft, draftKey } from "./cashcat-draft.mjs";
import {
  STOCK_PAIRS, STOCKCAT_LIMITS, STOCKCAT_TEXT, pairByMint, noteRow, stockDraft, stockDraftKey, suggestNames, pairDisclosure, quoteRefusals, otherQuotes,
} from "./stockcats.mjs";
import { STOCK_CAT_NOTES } from "./stock-cat-notes.mjs";

export const CASHCAT_TAB_KEYS = Object.freeze({ settings: "cia:cashcat:settings", journal: "cia:cashcat:journal", draft: "cia:cashcat:draft",
  stockDraft: "cia:stockcats:draft", stockSettings: "cia:stockcats:settings" });

/** The most one launch transaction may cost the wallet: the bot's own budget. */
export const LAUNCH_BUDGET_LAMPORTS = MAX_LAUNCH_SPEND_LAMPORTS.pumpfun;
/** The dev buy's own fence, the bot's: 0 to 0.05 SOL. */
export const DEV_BUY_FENCE = FENCES.devBuySol;
/** A dev buy may cost its spend plus this much in fees and the new token account's rent (the bot's allowance). */
export const DEV_BUY_OVERHEAD_LAMPORTS = 4_000_000;
/** 2,500 lamports over the 250,000-unit limit: 10,000 micro-lamports a unit, the bot's default price. */
export const PRIORITY_FEE_LAMPORTS = 2_500;
export const JOURNAL_MAX = 200;
export const AUTO_EVERY_HOURS = Object.freeze([2, 4, 6, 8, 12, 24]);
export const AUTO_MAX_PER_DAY = 2;
/** The first automatic launch comes this long after arming: time to read what was armed. */
export const FIRST_AUTO_DELAY_MS = 10 * 60_000;

export const CASHCAT_TAB_DEFAULTS = Object.freeze({
  devBuySol: 0,
  madeWithCashCat: false,
  model: "",
  auto: Object.freeze({ on: false, maxPerDay: AUTO_MAX_PER_DAY, minBalanceSol: 0.05, everyHours: 12, armed: null, nextAt: null }),
});

export const CASHCAT_SIGNER_NOTE = "CashCat launches are signed by the autopilot wallet only. A launch needs two signatures (yours and the new mint's); whether Phantom keeps the mint's signature on the transaction it is asked to sign could not be verified, so Phantom is not offered here.";
export const CASHCAT_VENUE_NOTE = "SOL-quoted pump.fun coins here. Stock cats, one per xStock on StonkFun, are in CoinMarketCat's tab. pump.fun coins quoted in a stock stay the agency's CashCat's.";
export const CASHCAT_NOT_ADVICE = "Your coin is yours: it does not claim to be from the Cat Intelligence Agency. Most coins like it go nowhere; a launch costs its fee whether or not anyone buys. Not financial advice.";

export class CashcatError extends Error {
  constructor(clause, message, detail = {}) { super(message); this.name = "CashcatError"; this.clause = clause; this.detail = detail; }
}
const refuse = (clause, message, detail) => { throw new CashcatError(clause, message, detail); };

/** A placeholder of a real CIDv1's length: a launch is built and simulated with it before anything is pinned. */
const PLACEHOLDER_CID = `bafkrei${"a".repeat(52)}`;

/**
 * EACH VENUE'S RUN: the one instruction a launch carries, its compute limit, the most it may cost
 * the wallet (the bot's own per-venue budget, MAX_LAUNCH_SPEND_LAMPORTS) and the log its simulation
 * must show. pump.fun is CashCat's; StonkFun is a stock cat's, built from a verified plan.
 */
export const VENUE_RUN = Object.freeze({
  pumpfun: Object.freeze({ ix: ({ mint, wallet, draft, uri }) => createV2Ix({ mint, user: wallet, name: draft.name, symbol: draft.symbol, uri }),
    compute: COMPUTE_LIMITS.pumpfun, budget: MAX_LAUNCH_SPEND_LAMPORTS.pumpfun, mustLog: "Instruction: CreateV2" }),
  stonkfun: Object.freeze({ ix: ({ mint, wallet, draft, uri, plan }) => initializeIx({ payer: wallet, mint, quoteMint: plan.quote.mint, quoteTokenProgram: plan.quote.tokenProgram,
    globalConfig: plan.globalConfig, platformConfig: plan.platformConfig, curveRule: plan.curveRule, name: draft.name, symbol: draft.symbol, uri, raiseRaw: plan.raiseRaw, cpmmCreatorFeeOn: plan.cpmmCreatorFeeOn }),
    compute: COMPUTE_LIMITS.stonkfun, budget: MAX_LAUNCH_SPEND_LAMPORTS.stonkfun, mustLog: "Instruction: InitializeWithToken2022" }),
});

/** The run for a venue, or a refusal: an unknown venue (venue), or a stock cat asked for outside a
 *  manual launch (manual_only) — auto mode is pump.fun's only. */
export function venueRun(venue, mode = "manual") {
  if (typeof venue !== "string" || !Object.hasOwn(VENUE_RUN, venue)) refuse("venue", `this tab launches on pump.fun or, for a stock cat, StonkFun; not "${venue}"`);
  if (venue !== "pumpfun" && mode !== "manual") refuse("manual_only", "a stock cat is launched by hand, one at a time: never in auto mode");
  return VENUE_RUN[venue];
}

/** A dev buy is pump.fun's only: on StonkFun it would be paid in the stock, and a stock cat makes none. */
export function assertDevBuyVenue(venue) {
  if (venue !== "pumpfun") refuse("no_dev_buy_on_stonkfun", "a stock cat makes no dev buy: on StonkFun it would be paid in the stock");
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const sol = (lamports) => Number(lamports) / 1e9;
const short = (a) => (typeof a === "string" && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : String(a));
const plainNumber = (v) => (typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d{1,9})?$/.test(v.trim()) ? Number(v) : NaN);

/**
 * The settings, fenced. A value outside its fence is refused by name, never clamped. A change to
 * anything the arm sentence names disarms auto mode.
 */
export function normalizeCashcatSettings(input = {}, prev = CASHCAT_TAB_DEFAULTS) {
  const out = { devBuySol: prev.devBuySol, madeWithCashCat: prev.madeWithCashCat, model: prev.model, auto: { ...prev.auto } };
  if ("devBuySol" in input) {
    const n = plainNumber(input.devBuySol);
    if (!(Number.isFinite(n) && n >= DEV_BUY_FENCE[0] && n <= DEV_BUY_FENCE[1])) refuse("dev_buy", `the dev buy must be from ${DEV_BUY_FENCE[0]} to ${DEV_BUY_FENCE[1]} SOL`);
    out.devBuySol = n;
  }
  if ("madeWithCashCat" in input) out.madeWithCashCat = input.madeWithCashCat === true;
  if ("model" in input) {
    const m = String(input.model ?? "").trim();
    if (m.length > 120 || !/^[A-Za-z0-9._:@/-]*$/.test(m)) refuse("model", "the model must be one of the ids your key lists, or empty for the first listed");
    out.model = m;
  }
  const a = isObject(input.auto) ? input.auto : {};
  if ("maxPerDay" in a) {
    const n = Number(a.maxPerDay);
    if (!(Number.isInteger(n) && n >= 1 && n <= AUTO_MAX_PER_DAY)) refuse("max_per_day", `auto mode launches 1 or ${AUTO_MAX_PER_DAY} coins a day at most`);
    out.auto.maxPerDay = n;
  }
  if ("minBalanceSol" in a) {
    const n = plainNumber(a.minBalanceSol);
    if (!(Number.isFinite(n) && n >= FENCES.minBalanceSol[0] && n <= FENCES.minBalanceSol[1])) refuse("min_balance", `the minimum balance must be from ${FENCES.minBalanceSol[0]} to ${FENCES.minBalanceSol[1]} SOL`);
    out.auto.minBalanceSol = n;
  }
  if ("everyHours" in a) {
    const n = Number(a.everyHours);
    if (!AUTO_EVERY_HOURS.includes(n)) refuse("every_hours", `auto mode launches at most every ${AUTO_EVERY_HOURS.join(", ")} hours`);
    out.auto.everyHours = n;
  }
  const armedFields = ["maxPerDay", "minBalanceSol", "everyHours"];
  if (armedFields.some((k) => out.auto[k] !== prev.auto[k])) { out.auto.on = false; out.auto.armed = null; out.auto.nextAt = null; }
  return out;
}

export function readSettings(raw) {
  if (!isObject(raw)) return structuredClone(CASHCAT_TAB_DEFAULTS);
  try {
    const s = normalizeCashcatSettings({ devBuySol: raw.devBuySol, madeWithCashCat: raw.madeWithCashCat, model: raw.model ?? "",
      auto: isObject(raw.auto) ? { maxPerDay: raw.auto.maxPerDay, minBalanceSol: raw.auto.minBalanceSol, everyHours: raw.auto.everyHours } : {} },
    { ...CASHCAT_TAB_DEFAULTS, auto: { ...CASHCAT_TAB_DEFAULTS.auto } });
    if (isObject(raw.auto) && raw.auto.on === true && isObject(raw.auto.armed) && typeof raw.auto.armed.sentence === "string") {
      s.auto.on = true;
      s.auto.armed = { sentence: raw.auto.armed.sentence, at: Number(raw.auto.armed.at) || 0, wallet: String(raw.auto.armed.wallet ?? "") };
      s.auto.nextAt = Number.isFinite(raw.auto.nextAt) ? raw.auto.nextAt : null;
    }
    return s;
  } catch { return structuredClone(CASHCAT_TAB_DEFAULTS); }
}

/** The sentence that arms auto mode, byte for byte: the wallet and every cap, in words. */
export function autoArmSentence({ wallet, settings }) {
  const a = settings.auto, n = a.maxPerDay;
  return `I arm CashCat auto mode: at most ${n} launch${n === 1 ? "" : "es"} a day, one every ${a.everyHours} hours at most, on pump.fun, `
    + `from the autopilot wallet ${wallet}, never below ${a.minBalanceSol} SOL, with no dev buy and never buying or selling its coins`
    + " — signed without asking me, by the autopilot key this browser holds";
}

/** Launches that count against the day: every one sent or being sent, manual or auto. */
export const COUNTS_AGAINST_DAY = Object.freeze(["sending", "launched", "unknown"]);
export function launchesOn(journal, day) {
  return journal.filter((j) => COUNTS_AGAINST_DAY.includes(j.kind) && utcDay(j.at) === day).length;
}
/** Kept past JOURNAL_MAX: a launch with no known outcome (it blocks the next one), and any launch
 *  of the last two days (it counts against a UTC day's cap). Refusals are what gets trimmed. */
const JOURNAL_KEEP_MS = 2 * 24 * 3_600_000;
export function trimJournal(journal, now) {
  return journal.filter((e, i) => i < JOURNAL_MAX || e.kind === "sending" || e.kind === "unknown"
    || (COUNTS_AGAINST_DAY.includes(e.kind) && now - Number(e.at) < JOURNAL_KEEP_MS)
    /* A stock cat's launch is kept for good: one cat per stock, ever, and no name used twice. */
    || (e.venue === "stonkfun" && COUNTS_AGAINST_DAY.includes(e.kind)));
}

/**
 * The CashCat tab's worker side.
 *   storage     { get, set } (chrome.storage.local, wrapped)
 *   desk        cashcat-draft.mjs createDraftDesk
 *   renderLogo  ({ ticker, kitten, background }) → { png }
 *   pinata      { hasJwt(), pin({ logoPng, coin, buildDoc }) } — the worker's, which alone reads the JWT
 *   fences      () → engine.agentFences(): { rpc(), wallet(), ready(), signSendConfirm } or null
 *   stonkfun    { pairs(), plan({ pairMint }), token(mint) } — StonkFun's public API through the worker's
 *               client, the plan proved on chain (planStonkfunLaunch); stock cats only
 *   stockNotes  the research rows (stock-cat-notes.mjs), injected so a test can supply one
 *   mintKeys    the key file's createMintKeys, from the worker: { newMint, signAsMint, forget }
 *   hasApiKey   () → whether an Anthropic key is saved (never the key)
 */
export function createCashcatTab({ storage, desk, renderLogo, pinata, fences, stonkfun = null, stockNotes = STOCK_CAT_NOTES, mintKeys, hasApiKey = async () => false, clock = () => Date.now(), log = () => {}, notify = () => {} } = {}) {
  for (const [name, v] of Object.entries({ storage, desk, renderLogo, pinata, fences, mintKeys })) if (!v) throw new Error(`createCashcatTab needs ${name}`);
  let busy = null;

  const loadSettings = async () => readSettings(await storage.get(CASHCAT_TAB_KEYS.settings));
  const saveSettingsRaw = (s) => storage.set(CASHCAT_TAB_KEYS.settings, s);
  /* Every read-change-write of the settings runs under this one lock, in turn: a disarm, a cap
     changed in Options and the alarm's tick never interleave, so none overwrites another. */
  let settingsTurn = Promise.resolve();
  function withSettings(fn) {
    const run = settingsTurn.then(async () => fn(await loadSettings()));
    settingsTurn = run.catch(() => {});
    return run;
  }
  const armedFor = (settings, wallet) => settings.auto.on === true && Boolean(wallet) && settings.auto.armed?.sentence === autoArmSentence({ wallet, settings });
  /** An automatic run, before it pins and before it signs: still armed, for this wallet, with these caps. */
  async function stillArmed(wallet) {
    const now = await loadSettings();
    if (!armedFor(now, wallet)) refuse("disarmed", "auto mode was disarmed, or a cap changed, while this run was under way: nothing was signed");
  }
  const loadJournal = async () => { const j = await storage.get(CASHCAT_TAB_KEYS.journal); return Array.isArray(j) ? j.filter(isObject) : []; };
  const saveJournal = (j) => storage.set(CASHCAT_TAB_KEYS.journal, trimJournal(j, clock()));
  async function journalAdd(entry) { const j = await loadJournal(); const e = { at: clock(), ...entry }; await saveJournal([e, ...j]); return e; }
  async function journalUpdate(mint, patch) {
    const j = await loadJournal();
    const i = j.findIndex((e) => e.mint === mint && ["sending", "launched", "unknown", "failed"].includes(e.kind));
    if (i >= 0) j[i] = { ...j[i], ...patch, updatedAt: clock() };
    else j.unshift({ at: clock(), mint, ...patch });
    await saveJournal(j);
  }
  const loadDraft = async () => { const d = await storage.get(CASHCAT_TAB_KEYS.draft); return isObject(d) && isObject(d.draft) ? d : null; };
  const saveDraft = (d) => storage.set(CASHCAT_TAB_KEYS.draft, d);

  /** Only one thing at a time touches the wallet or the model. */
  async function exclusive(what, fn) {
    if (busy) refuse("busy", `CashCat is busy (${busy}); try again in a moment`);
    busy = what;
    try { return await fn(); } finally { busy = null; }
  }

  /* ── drafts ──────────────────────────────────────────────────────────────────────────── */

  async function judge(draft, { requireModel = false } = {}) {
    const r = await desk.review(draft, { requireModel });
    return { ...r, key: draftKey(draft), at: clock() };
  }

  async function draftTyped(input) {
    return exclusive("reviewing your draft", async () => {
      const draft = typedDraft(input);
      const review = await judge(draft);
      await saveDraft({ draft, review: { ok: review.ok, refusals: review.refusals, reviewed: review.reviewed, reviewedBy: review.reviewedBy, key: review.key, at: review.at } });
      return { ok: review.ok, draft, refusals: review.refusals, reviewedBy: review.reviewedBy };
    });
  }

  async function draftFromTrend() {
    return exclusive("drafting from a trend", async () => {
      const r = await desk.fromTrend();
      if (!r.draft) return { ok: false, refusals: r.refusals, attempts: r.attempts?.length ?? 0, trends: r.trends };
      await saveDraft({ draft: r.draft, review: { ok: r.ok, refusals: r.refusals, reviewed: r.reviewed, reviewedBy: r.reviewed ? "the rules and the model" : "the rules", key: draftKey(r.draft), at: clock() } });
      return { ok: r.ok, draft: r.draft, refusals: r.refusals, trends: r.trends };
    });
  }

  async function clearDraft() { await storage.set(CASHCAT_TAB_KEYS.draft, null); }

  /**
   * The draft, judged at launch. The rules cost nothing and run again every time. The model's
   * approval is reused only for exactly the words it approved; a draft it never saw is sent to it
   * whenever a key is saved (and must be, for auto mode).
   */
  async function judged(draft, { requireModel }) {
    const stored = await loadDraft();
    const same = stored?.review?.key === draftKey(draft) && stored.review.ok === true;
    const keyNow = await hasApiKey();
    if (same && (stored.review.reviewed === true || (!keyNow && !requireModel))) {
      const rules = await desk.review(draft, { skipModel: true });
      return rules.ok ? { ok: true, draft, refusals: [], reviewed: stored.review.reviewed === true } : rules;
    }
    const r = await judge(draft, { requireModel });
    if (stored && draftKey(stored.draft) === draftKey(draft))
      await saveDraft({ draft, review: { ok: r.ok, refusals: r.refusals, reviewed: r.reviewed, reviewedBy: r.reviewedBy, key: r.key, at: r.at } });
    return r;
  }

  /* ── the transaction ─────────────────────────────────────────────────────────────────── */

  /** One plan per launch, the same for both builds: StonkFun's is the verified plan; pump.fun needs none. */
  async function buildCheckSimulate({ rpc, wallet, mint, draft, uri, venue = "pumpfun", plan = null }) {
    const run = venueRun(venue);
    const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
    if (typeof blockhash !== "string" || !blockhash) refuse("rpc", "the RPC gave no recent blockhash");
    const tx = buildUnsignedTransaction({ payer: wallet, blockhash, instructions: [run.ix({ mint, wallet, draft, uri, plan })],
      computeUnitLimit: run.compute, priorityFeeLamports: PRIORITY_FEE_LAMPORTS });
    /* The check reads the compiled v0 message: what the signatures will cover. */
    try { checkLaunchMessage(tx.message, { wallet, mint, venue, plan, coin: { name: draft.name, symbol: draft.symbol, uri } }); }
    catch (e) { refuse("transaction_refused", `refused before signing (${e.clause ?? "check"}): ${e.message}`); }
    const txBase64 = toBase64(tx.serialize());
    const before = Number(await rpc.getBalance(wallet));
    const sim = await rpc.simulateTransaction(txBase64, { addresses: [wallet] });
    let result;
    try { result = checkSimulation(sim, { walletBefore: before, walletAfter: sim?.accounts?.[0]?.lamports, maxSpendLamports: run.budget, mustLog: run.mustLog }); }
    catch (e) { refuse("simulation_refused", `refused before signing (${e.clause ?? "simulation"}): ${e.message}`); }
    return { txBase64, lastValidBlockHeight, spentLamports: result.spentLamports, units: result.units, version: tx.version, signers: tx.message.header.numRequiredSignatures };
  }

  const bufAcc = (a) => (a ? { owner: a.owner, lamports: a.lamports, data: Buffer.from(a.data[0], a.data[1] || "base64") } : null);

  async function devBuy({ f, rpc, wallet, mint, spendSol, venue = "pumpfun" }) {
    assertDevBuyVenue(venue);
    const spend = BigInt(Math.round(spendSol * 1e9));
    const curve = pda([{ utf8: "bonding-curve" }, { key: mint }], PUMPFUN_PROGRAM);
    const read = await rpc.getMultipleAccounts([curve, PUMPFUN_GLOBAL], { commitment: "confirmed" });
    const { ixs } = devBuyIxs({ mint, user: wallet, curveAccount: bufAcc(read.accounts[0]), curveReadSlot: read.slot, globalAccount: bufAcc(read.accounts[1]), spendLamports: spend });
    const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
    const tx = buildUnsignedTransaction({ payer: wallet, blockhash, instructions: ixs, computeUnitLimit: 200_000, priorityFeeLamports: PRIORITY_FEE_LAMPORTS });
    checkDevBuyMessage(tx.message, { wallet, mint, maxSpendLamports: spend });
    const txBase64 = toBase64(tx.serialize());
    const before = Number(await rpc.getBalance(wallet));
    const sim = await rpc.simulateTransaction(txBase64, { addresses: [wallet] });
    checkSimulation(sim, { walletBefore: before, walletAfter: sim?.accounts?.[0]?.lamports, maxSpendLamports: Number(spend) + DEV_BUY_OVERHEAD_LAMPORTS });
    const { signature } = await f.signSendConfirm({ txBase64, purpose: "dev_buy", mint, summary: `DEV BUY of ${short(mint)}: at most ${spendSol} SOL`, lastValidBlockHeight, timeoutMs: 60_000, wallet });
    return signature;
  }

  /** What every launch needs before anything is drafted, rendered, pinned or built. */
  async function preflight({ mode, settings, journal, venue = "pumpfun" }) {
    const budget = venueRun(venue, mode).budget;
    const f = fences();
    if (!f) refuse("no_autopilot", "create the autopilot wallet first: CashCat launches are signed by it");
    const wallet = f.wallet();
    if (!wallet) refuse("no_autopilot", "create the autopilot wallet first: CashCat launches are signed by it");
    const rpc = f.rpc();
    if (!rpc) refuse("no_rpc", "set your RPC in Options: the launch is built, simulated and sent through it");
    if (!f.ready()) refuse("autopilot_locked", "unlock the autopilot wallet: it signs the launch");
    if (!(await pinata.hasJwt())) refuse("no_pinata", "save your Pinata JWT in Options → CashCat: the logo and metadata are pinned on IPFS with it");
    const open = journal.find((j) => j.kind === "sending" || j.kind === "unknown");
    if (open) refuse("unresolved", `the launch of ${open.symbol ? `$${open.symbol}` : short(open.mint)} (mint ${open.mint}) has no known outcome: check it on Solscan, then mark it checked in the journal before launching again`);
    const today = launchesOn(journal, utcDay(clock()));
    if (mode === "auto" && today >= settings.auto.maxPerDay) refuse("day_cap", `the day's cap is reached: ${today} of ${settings.auto.maxPerDay} launches today (UTC)`);
    const devBuySol = mode === "auto" ? 0 : settings.devBuySol;
    /* CashCat's dev-buy setting is pump.fun's: a stock cat on StonkFun makes none, whatever it says. */
    const devBuyHere = venue === "pumpfun" ? devBuySol : 0;
    const need = BigInt(Math.round((mode === "auto" ? settings.auto.minBalanceSol : 0) * 1e9)) + BigInt(budget)
      + (devBuyHere > 0 ? BigInt(Math.round(devBuyHere * 1e9)) + BigInt(DEV_BUY_OVERHEAD_LAMPORTS) : 0n) + BigInt(RENT_EXEMPT_EMPTY_ACCOUNT_LAMPORTS);
    const balance = BigInt(await rpc.getBalance(wallet));
    if (balance < need) refuse("balance", `the autopilot wallet holds ${sol(balance).toFixed(6)} SOL; this launch needs at least ${sol(need).toFixed(6)} SOL${mode === "auto" ? ` (the ${settings.auto.minBalanceSol} SOL minimum, ` : " ("}the ${sol(budget)} SOL launch budget${devBuyHere ? `, the ${devBuyHere} SOL dev buy and its fees` : ""} and the rent floor)`);
    return { f, wallet, rpc, devBuySol: devBuyHere, today, balance, budget };
  }

  /**
   * A dry run of the launch: every check and the simulation, with a mint key that is dropped
   * at once and a placeholder URI of the real length. Nothing is pinned, signed or sent.
   */
  async function prepare() {
    return exclusive("checking the launch", async () => {
      const settings = await loadSettings();
      const journal = await loadJournal();
      const stored = await loadDraft();
      if (!stored) refuse("no_draft", "type a coin or draft one from a trend first");
      const draft = stored.draft;
      const p = await preflight({ mode: "manual", settings, journal });
      const r = await judged(draft, { requireModel: false });
      if (!r.ok) refuse("draft_refused", r.refusals.join("; "));
      const mint = mintKeys.newMint();
      try {
        const sim = await buildCheckSimulate({ rpc: p.rpc, wallet: p.wallet, mint, draft, uri: uriFor("pumpfun", PLACEHOLDER_CID) });
        return {
          ok: true, wallet: p.wallet, balanceSol: sol(p.balance), simulatedSpendSol: sol(sim.spentLamports), units: sim.units, budgetSol: sol(LAUNCH_BUDGET_LAMPORTS),
          devBuySol: p.devBuySol, disclosure: userDisclosure({ topic: draft.topic, madeWithCashCat: settings.madeWithCashCat }), reviewedBy: r.reviewed ? "the rules and the model" : "the rules",
          launchesToday: p.today, draft,
        };
      } finally { mintKeys.forget(mint); }
    });
  }

  /** The launch itself: the same checks, the pin, the check and simulation again, the signatures, the chain. */
  /**
   * The launch itself: the same checks, the pin, the check and simulation again, the signatures,
   * the chain. `venue` is pump.fun (CashCat's coins, manual or auto) or StonkFun (a stock cat,
   * manual only, from a record "Check the launch" left: `pair` and `prepared`).
   */
  async function launchPipeline({ draft, mode, venue = "pumpfun", pair = null, prepared = null }) {
    venueRun(venue, mode);
    const settings = await loadSettings();
    const journal = await loadJournal();
    const p = await preflight({ mode, settings, journal, venue });
    if (mode === "auto") await stillArmed(p.wallet);
    let plan = null;
    if (venue === "stonkfun") {
      await judgedStock(draft, pair, journal);
      stockCaps({ journal, pair, stockSettings: await loadStockSettings() });
      /* The plan is read and proved again: what was checked ten minutes ago is not trusted now.
         A different config, curve rule, platform or token program is a different launch; a
         different raise is StonkFun's price moving, and is written down beside the one checked. */
      plan = await planFor(pair);
      const was = prepared?.plan;
      if (!was || was.globalConfig !== plan.globalConfig || was.curveRule !== plan.curveRule || was.platformConfig !== plan.platformConfig || was.quoteTokenProgram !== plan.quote.tokenProgram || was.quoteMint !== plan.quote.mint)
        refuse("plan_changed", "StonkFun's config, curve rule, platform or the stock's token program changed since the launch was checked: check it again");
      quoteChecks(plan, pair);
    } else {
      const r = await judged(draft, { requireModel: mode === "auto" });
      if (!r.ok) refuse("draft_refused", r.refusals.join("; "));
    }
    const { png } = await renderLogo({ ticker: draft.symbol, kitten: draft.kitten, background: draft.background });
    const buildDoc = venue === "stonkfun"
      ? ({ imageUri }) => buildUserDocument({ name: draft.name, symbol: draft.symbol, tagline: draft.tagline, imageUri, venue: "stonkfun", disclosure: pairDisclosure(pair) })
      : ({ imageUri }) => buildUserDocument({ name: draft.name, symbol: draft.symbol, tagline: draft.tagline, topic: draft.topic, imageUri, madeWithCashCat: settings.madeWithCashCat });
    const where = venue === "stonkfun" ? `StonkFun, paired with ${pair.symbol}` : "pump.fun";
    const mint = mintKeys.newMint();
    let stage = "checking";
    try {
      /* Everything decidable before an upload is decided first, with a placeholder URI of the
         real length: a launch a guard would refuse never pins files. */
      await buildCheckSimulate({ rpc: p.rpc, wallet: p.wallet, mint, draft, uri: uriFor(venue, PLACEHOLDER_CID), venue, plan });
      if (mode === "auto") await stillArmed(p.wallet);
      stage = "pinning";
      const pinned = await pinata.pin({ logoPng: png, coin: { name: draft.name, symbol: draft.symbol }, buildDoc, venue });
      stage = "checking";
      const built = await buildCheckSimulate({ rpc: p.rpc, wallet: p.wallet, mint, draft, uri: pinned.uri, venue, plan });
      if (mode === "auto") await stillArmed(p.wallet);
      const stock = venue === "stonkfun"
        ? { pair: { official: pair.symbol, stonkfun: pair.stonkfun, mint: pair.mint }, pool: poolState(mint, pair.mint), raiseRaw: String(plan.raiseRaw), checkedRaiseRaw: prepared?.raiseRaw ?? null }
        : { topic: draft.topic };
      await journalAdd({ kind: "sending", mode, venue, mint, creator: p.wallet, name: draft.name, symbol: draft.symbol, ...stock, source: draft.source, uri: pinned.uri,
        simulatedSpendSol: sol(built.spentLamports) });
      stage = "signing";
      const byMint = mintKeys.signAsMint({ txBase64: built.txBase64, mint, payer: p.wallet });
      stage = "sending";
      const summary = `LAUNCH ${draft.name} ($${draft.symbol}) on ${where} — mint ${short(mint)}`;
      const { signature, tx } = await p.f.signSendConfirm({ txBase64: byMint.signedBase64, purpose: "launch", mint, summary, lastValidBlockHeight: built.lastValidBlockHeight, timeoutMs: 60_000, wallet: p.wallet });
      stage = "reading back";
      const meta = tx?.meta;
      const keys = tx?.transaction?.message?.accountKeys ?? [];
      if (!meta || meta.err || keys[0] !== p.wallet) refuse("read_back", "the landed transaction does not read back as this wallet's successful launch", { signature });
      const costLamports = Number(meta.preBalances[0]) - Number(meta.postBalances[0]);
      const acc = (await p.rpc.getMultipleAccounts([mint], { commitment: "confirmed" })).accounts?.[0] ?? null;
      const d = acc ? describeMint(acc, mint) : null;
      const clean = Boolean(d && d.mintAuthority === null && d.freezeAuthority === null);
      const coinPage = venue === "stonkfun" ? PAGES.stonkfunToken(mint) : PAGES.pumpCoin(mint);
      await journalUpdate(mint, { kind: "launched", signature, costSol: sol(costLamports), mintClean: clean, links: [coinPage, PAGES.solscanTx(signature)] });
      log(`cashcat: launched ${draft.name} ($${draft.symbol}) on ${where}, mint ${mint}, ${signature}`);
      if (!clean && venue === "stonkfun") notify({ kind: "attention", title: "Stock cats: a launch did not read back clean", body: `The mint ${mint} still carries a mint or freeze authority. No stock cat launches until you check it and mark it in the journal.` });
      let devBuySignature = null;
      if (p.devBuySol > 0 && mode === "manual") {
        stage = "dev buy";
        try { devBuySignature = await devBuy({ f: p.f, rpc: p.rpc, wallet: p.wallet, mint, spendSol: p.devBuySol, venue }); await journalUpdate(mint, { kind: "launched", devBuy: { sol: p.devBuySol, signature: devBuySignature } }); }
        catch (e) { await journalUpdate(mint, { kind: "launched", devBuy: { sol: p.devBuySol, error: String(e?.message ?? e).slice(0, 200) } }); }
      }
      return { ok: true, mint, signature, costSol: sol(costLamports), mintClean: clean, devBuySignature, venue,
        links: [{ label: venue === "stonkfun" ? "The coin on StonkFun" : "The coin on pump.fun", href: coinPage }, { label: "The launch on Solscan", href: PAGES.solscanTx(signature) }] };
    } catch (e) {
      const signature = e?.detail?.signature ?? null;
      if (stage === "sending" || stage === "reading back") {
        /* It may have landed: the journal says so, and the day counts it until the user checks. */
        const landedNot = e?.clause === "failed_on_chain" || e?.clause === "expired";
        await journalUpdate(mint, { kind: landedNot ? "failed" : "unknown", signature, error: String(e?.message ?? e).slice(0, 300) });
        if (!landedNot) notify({ kind: "attention", title: "CashCat: a launch's outcome is unknown", body: `Check ${signature ?? mint} on Solscan before launching again.` });
      } else if (stage === "signing") await journalUpdate(mint, { kind: "failed", error: String(e?.message ?? e).slice(0, 300) });
      throw e;
    } finally { mintKeys.forget(mint); }
  }

  async function launch({ confirmTicker } = {}) {
    return exclusive("launching", async () => {
      const stored = await loadDraft();
      if (!stored) refuse("no_draft", "type a coin or draft one from a trend first");
      if (typeof confirmTicker !== "string" || confirmTicker.trim().replace(/^\$/, "").toUpperCase() !== stored.draft.symbol) refuse("confirm", `type the ticker (${stored.draft.symbol}) to confirm the launch`);
      try { return await launchPipeline({ draft: stored.draft, mode: "manual" }); }
      catch (e) {
        /* A refusal before anything was signed is journaled as one; what happened after the
           signature is already in the launch's own entry. */
        if (e instanceof CashcatError && !["busy", "read_back"].includes(e.clause)) await journalAdd({ kind: "refused", mode: "manual", clause: e.clause, message: String(e.message).slice(0, 300), symbol: stored.draft.symbol });
        throw e;
      }
    });
  }

  /**
   * The user checked an unresolved launch on an explorer: it stops blocking the next one. The same
   * message clears a stock cat that landed but read back with a mint or freeze authority still set
   * (unclean_mint): the owner has looked, and the launch stays in the journal as it read.
   */
  async function markChecked({ mint, landed }) {
    const j = await loadJournal();
    const i = j.findIndex((e) => e.mint === mint && (e.kind === "sending" || e.kind === "unknown"));
    if (i < 0) {
      const u = j.findIndex((e) => e.mint === mint && e.venue === "stonkfun" && e.kind === "launched" && e.mintClean === false && !e.cleanCheckedByUser);
      if (u < 0) refuse("not_found", "no unresolved launch with that mint");
      j[u] = { ...j[u], cleanCheckedByUser: clock() };
      await saveJournal(j);
      return { ok: true };
    }
    j[i] = { ...j[i], kind: landed === true ? "launched" : "failed", checkedByUser: clock() };
    await saveJournal(j);
    return { ok: true };
  }

  /* ── stock cats: CoinMarketCat's tab ─────────────────────────────────────────────────── */

  let lastPairs = null;        // { at, ready: [mints], others } — StonkFun's /pairs, when the owner last refreshed
  let preparedRec = null;      // the one prepared stock cat, in this worker's memory only
  let preparedCount = 0;

  const loadStockSettings = async () => {
    const raw = await storage.get(CASHCAT_TAB_KEYS.stockSettings);
    const n = Number(raw?.maxPerDay);
    const [lo, hi] = STOCKCAT_LIMITS.fence;
    return { maxPerDay: Number.isInteger(n) && n >= lo && n <= hi ? n : STOCKCAT_LIMITS.maxPerDay };
  };
  const loadStockDraft = async () => { const d = await storage.get(CASHCAT_TAB_KEYS.stockDraft); return isObject(d) && isObject(d.draft) ? d : null; };
  /** Stock cats launched or being launched: one per stock, ever, and their names are taken. */
  const stockCatsIn = (journal) => journal.filter((e) => e.venue === "stonkfun" && COUNTS_AGAINST_DAY.includes(e.kind));
  const earlierOf = (journal) => stockCatsIn(journal).map((e) => ({ name: e.name, symbol: e.symbol }));
  function pairOf(pairMint) {
    const pair = pairByMint(typeof pairMint === "string" ? pairMint.trim() : "");
    if (!pair) refuse("pair_unknown", "that stock is not one a stock cat may be paired with");
    return pair;
  }
  function needStonkfun(what) {
    if (!stonkfun || typeof stonkfun[what] !== "function") refuse("venue", "StonkFun is not wired into this tab");
  }

  /** The stock cat's words, judged: its rules every time, and the model's review when a key is
   *  saved and the model has not already approved exactly these words. */
  async function judgedStock(draft, pair, journal) {
    const stored = await loadStockDraft();
    const approved = stored?.review?.key === stockDraftKey(draft) && stored.review.ok === true && stored.review.reviewed === true;
    const r = await desk.reviewStock(draft, pair, { notes: stockNotes, earlier: earlierOf(journal), skipModel: approved });
    if (!r.ok) refuse(r.clauses?.[0] ?? "draft_refused", r.refusals.join("; "));
    return { ...r, reviewed: r.reviewed || approved };
  }

  /** One stock cat per stock, ever; no stock cat while one read back unclean; the day's cap. */
  function stockCaps({ journal, pair, stockSettings }) {
    const had = stockCatsIn(journal).find((e) => e.pair?.mint === pair.mint);
    if (had) refuse("stock_has_cat", `${pair.symbol} already has its stock cat: ${had.name} ($${had.symbol}), mint ${had.mint}. One cat per stock, ever.`);
    const unclean = journal.find((e) => e.venue === "stonkfun" && e.kind === "launched" && e.mintClean === false && !e.cleanCheckedByUser);
    if (unclean) refuse("unclean_mint", `the stock cat ${unclean.name ?? ""} (mint ${unclean.mint}) read back with a mint or freeze authority still set: check it on Solscan and mark it in the journal before another`);
    const today = launchesOn(journal, utcDay(clock()));
    if (today >= stockSettings.maxPerDay) refuse("stock_day_cap", `the day's cap is reached: ${today} of ${stockSettings.maxPerDay} launches today (UTC), counting every launch from this extension`);
  }

  /** StonkFun's plan for the pair, proved on chain by the planner; its refusal named. */
  async function planFor(pair) {
    needStonkfun("plan");
    try { return await stonkfun.plan({ pairMint: pair.mint }); }
    catch (e) {
      if (e?.clause === "no_rpc") refuse("no_rpc", "set your own RPC in Options: the public mainnet RPC answers 403 to the extension, and the plan is proved on the chain through it");
      const inner = typeof e?.clause === "string" ? e.clause : "error";
      refuse("plan_refused", `plan_refused:${inner} — ${String(e?.message ?? e).slice(0, 240)}`, { inner });
    }
  }

  /** The stock's own mint, read with the plan, held to what every xStock read (quoteRefusals). */
  function quoteChecks(plan, pair) {
    if (plan?.quote?.mint !== pair.mint || !plan.quoteMintAccount) refuse("plan_refused", "plan_refused:quote — the plan is not for this stock", { inner: "quote" });
    let d;
    try { d = describeMint(plan.quoteMintAccount, pair.mint); }
    catch (e) { refuse("plan_refused", `plan_refused:quote_mint — ${e?.message ?? e}`, { inner: "quote_mint" }); }
    const q = quoteRefusals(d, pair);
    if (q.length) refuse(q[0].clause, q.map((x) => x.message).join("; "));
    return d;
  }

  async function stockList() {
    const journal = await loadJournal();
    const settings = await loadStockSettings();
    const stored = await loadStockDraft();
    const cats = stockCatsIn(journal);
    const fresh = preparedRec && clock() - preparedRec.at <= STOCKCAT_LIMITS.prepareTtlMs;
    return {
      pairs: STOCK_PAIRS.map((p) => {
        const row = noteRow(p.mint, stockNotes);
        const cat = cats.find((e) => e.pair?.mint === p.mint) ?? null;
        const ready = lastPairs ? lastPairs.ready.includes(p.mint) : null;
        return {
          symbol: p.symbol, name: p.name, mint: p.mint, stonkfun: p.stonkfun, researched: Boolean(row), searchedAt: row?.searchedAt ?? null,
          /* For the owner's eyes only: never written into a coin, never shown to the model. */
          catFacts: row ? row.catFacts.map((f) => ({ label: STOCKCAT_TEXT.catFact, text: f.text, source: f.source, readAt: f.readAt })) : [],
          cat: cat ? { name: cat.name, symbol: cat.symbol, mint: cat.mint, kind: cat.kind, adopted: cat.adoption?.adopted ?? null } : null,
          ready, launchable: Boolean(row) && !cat && ready !== false,
        };
      }),
      others: lastPairs?.others ?? null, readAt: lastPairs?.at ?? null,
      draft: stored?.draft ?? null,
      review: stored?.review ? { ok: stored.review.ok, refusals: stored.review.refusals, clauses: stored.review.clauses ?? [], reviewedBy: stored.review.reviewedBy } : null,
      disclosure: stored?.draft && pairByMint(stored.draft.pairMint) ? pairDisclosure(pairByMint(stored.draft.pairMint)) : null,
      prepared: fresh ? { id: preparedRec.id, pairMint: preparedRec.pairMint, at: preparedRec.at, expiresAt: preparedRec.at + STOCKCAT_LIMITS.prepareTtlMs } : null,
      settings, fence: STOCKCAT_LIMITS.fence, launchesToday: launchesOn(journal, utcDay(clock())),
      journal: journal.filter((e) => e.venue === "stonkfun").slice(0, 30), text: STOCKCAT_TEXT, busy,
    };
  }

  /** StonkFun's pairs, read when the owner asks: which of the 24 are ready, and the rest as counts. */
  async function stockRefresh() {
    needStonkfun("pairs");
    const answer = await stonkfun.pairs();
    const rows = answer?.data?.pairs;
    if (!Array.isArray(rows)) refuse("pairs", "StonkFun's /pairs answer has no pairs list");
    lastPairs = { at: clock(), ready: STOCK_PAIRS.filter((p) => rows.some((r) => r?.mint === p.mint && r.launchable === true && r.launchLabReady === true)).map((p) => p.mint), others: otherQuotes(answer) };
    return stockList();
  }

  /** Names for a pair, from the eight kittens and the backgrounds, each passing every rule. No model. */
  async function stockSuggest({ pairMint } = {}) {
    const pair = pairOf(pairMint);
    if (!noteRow(pair.mint, stockNotes)) return { ok: false, suggestions: [], clauses: ["pair_terms_missing"], refusals: [`pair_terms_missing: ${pair.symbol} has no research row yet, so nothing may be named for it`] };
    const journal = await loadJournal();
    const suggestions = suggestNames(pair, { notes: stockNotes, earlier: earlierOf(journal), verifiedIndex: await desk.verifiedIndex() });
    return { ok: suggestions.length > 0, suggestions, clauses: [], refusals: suggestions.length ? [] : ["no suggestion passes every rule for this pair: type a name of your own"], disclosure: pairDisclosure(pair) };
  }

  /** A stock cat typed, or a suggestion picked: judged, and kept as the one stock-cat draft. */
  async function stockDraftIn({ pairMint, idea } = {}) {
    return exclusive("reviewing a stock cat", async () => {
      const pair = pairOf(pairMint);
      const draft = stockDraft(isObject(idea) ? idea : {}, pair);
      const r = await desk.reviewStock(draft, pair, { notes: stockNotes, earlier: earlierOf(await loadJournal()) });
      await storage.set(CASHCAT_TAB_KEYS.stockDraft, { draft, review: { ok: r.ok, refusals: r.refusals, clauses: r.clauses, reviewed: r.reviewed, reviewedBy: r.reviewedBy, key: stockDraftKey(draft), at: clock() } });
      return { ok: r.ok, draft, refusals: r.refusals, clauses: r.clauses, reviewedBy: r.reviewedBy, disclosure: pairDisclosure(pair) };
    });
  }

  /**
   * "Check the launch" for a stock cat: every check, the plan proved on chain, the stock's mint,
   * a build with a throwaway mint key, the pre-sign check and the simulation. Nothing is pinned,
   * signed or sent. It leaves one record in this worker's memory — the pair, the draft's
   * fingerprint, the wallet and the plan's accounts — which the launch needs within ten minutes.
   */
  async function stockPrepare({ pairMint } = {}) {
    return exclusive("checking a stock cat", async () => {
      const pair = pairOf(pairMint);
      const stored = await loadStockDraft();
      if (!stored || stored.draft.pairMint !== pair.mint) refuse("no_draft", `name a stock cat for ${pair.symbol} first`);
      const draft = stored.draft;
      venueRun("stonkfun", "manual");
      const settings = await loadSettings();
      const journal = await loadJournal();
      preparedRec = null;
      const p = await preflight({ mode: "manual", settings, journal, venue: "stonkfun" });
      const r = await judgedStock(draft, pair, journal);
      stockCaps({ journal, pair, stockSettings: await loadStockSettings() });
      const plan = await planFor(pair);
      const quote = quoteChecks(plan, pair);
      const mint = mintKeys.newMint();
      try {
        const sim = await buildCheckSimulate({ rpc: p.rpc, wallet: p.wallet, mint, draft, uri: uriFor("stonkfun", PLACEHOLDER_CID), venue: "stonkfun", plan });
        preparedRec = { id: `stockcat-${clock().toString(36)}-${++preparedCount}`, pairMint: pair.mint, draftKey: stockDraftKey(draft), wallet: p.wallet, at: clock(), raiseRaw: String(plan.raiseRaw),
          plan: { globalConfig: plan.globalConfig, curveRule: plan.curveRule, platformConfig: plan.platformConfig, quoteMint: plan.quote.mint, quoteTokenProgram: plan.quote.tokenProgram } };
        const decimals = Number.isInteger(quote.decimals) ? quote.decimals : null;
        return {
          ok: true, preparedId: preparedRec.id, expiresAt: preparedRec.at + STOCKCAT_LIMITS.prepareTtlMs, wallet: p.wallet, balanceSol: sol(p.balance),
          pair: { symbol: pair.symbol, name: pair.name, mint: pair.mint, stonkfun: pair.stonkfun }, draft,
          accounts: [
            { label: "StonkFun's platform (its on-chain name, read by the planner: \"StonkFun\")", address: plan.platformConfig },
            { label: `LaunchLab's config for ${pair.symbol}`, address: plan.globalConfig },
            { label: "StonkFun's curve rule for that config", address: plan.curveRule },
            { label: `The pool: PDA("pool", the new mint, ${pair.symbol}), made by the launch`, address: null },
          ],
          message: { version: sim.version, signers: sim.signers },
          simulatedSpendSol: sol(sim.spentLamports), units: sim.units, budgetSol: sol(p.budget),
          raise: { raw: String(plan.raiseRaw), units: decimals === null ? null : Number(plan.raiseRaw) / 10 ** decimals, symbol: pair.symbol },
          marketCap: { startUsd: plan.marketCap?.startUsd ?? null, graduationUsd: plan.marketCap?.graduationUsd ?? null, label: STOCKCAT_TEXT.marketCap, pricedAt: plan.pricedAt },
          scaledUiMultiplier: quote.scaledUiMultiplier,
          notes: [STOCKCAT_TEXT.issuer, STOCKCAT_TEXT.noDevBuy, STOCKCAT_TEXT.creatorShare],
          disclosure: pairDisclosure(pair), reviewedBy: r.reviewed ? "the rules and the model" : "the rules", launchesToday: p.today,
        };
      } finally { mintKeys.forget(mint); }
    });
  }

  /**
   * The launch of a prepared stock cat. Armed only by the record "Check the launch" left: the same
   * id, under ten minutes old, for the same pair, the same draft and the same wallet, with the
   * ticker typed. The record is used once, whatever happens next.
   */
  async function stockLaunch({ pairMint, preparedId, confirmTicker } = {}) {
    return exclusive("launching a stock cat", async () => {
      const rec = preparedRec;
      let stored = null;
      /* The record check sits inside the try, as the first thing it does, so a launch refused for
         want of a check (prepare_first) is journaled like every other refusal: the owner's list of
         stock-cat refusals is then the whole story, including a second press after a refused
         launch had already used the record up. It is still the first check, and the record is
         still dropped only once it has matched, so a wrong id never spends someone's real check.
         With no record there is no checked pair to name, so the journal names the pair that was
         asked for, and only when it is one of the pairs (never a stray string from a message). */
      try {
        if (!rec || typeof preparedId !== "string" || rec.id !== preparedId) refuse("prepare_first", "check the launch first: a stock cat is launched only from a check made in the last ten minutes");
        preparedRec = null;
        if (clock() - rec.at > STOCKCAT_LIMITS.prepareTtlMs) refuse("prepare_stale", "the check is more than ten minutes old: check the launch again");
        if (rec.pairMint !== pairMint) refuse("pair_changed", "the pair is not the one that was checked: check the launch again");
        const pair = pairOf(pairMint);
        stored = await loadStockDraft();
        if (!stored || stockDraftKey(stored.draft) !== rec.draftKey) refuse("draft_changed", "the stock cat changed since it was checked: check the launch again");
        const wallet = fences()?.wallet() ?? null;
        if (wallet !== rec.wallet) refuse("wallet_changed", "the autopilot wallet changed since the launch was checked: check it again");
        if (typeof confirmTicker !== "string" || confirmTicker.trim().replace(/^\$/, "").toUpperCase() !== stored.draft.symbol) refuse("confirm", `type the ticker (${stored.draft.symbol}) to confirm the launch`);
        return await launchPipeline({ draft: stored.draft, mode: "manual", venue: "stonkfun", pair, prepared: rec });
      } catch (e) {
        if (e instanceof CashcatError && !["busy", "read_back"].includes(e.clause))
          await journalAdd({ kind: "refused", mode: "manual", venue: "stonkfun", clause: e.clause, message: String(e.message).slice(0, 300), symbol: stored?.draft?.symbol ?? null,
            pairMint: rec?.pairMint ?? (typeof pairMint === "string" ? pairByMint(pairMint.trim())?.mint ?? null : null) });
        throw e;
      }
    });
  }

  /**
   * Has StonkFun adopted a stock cat? Asked by the owner, never on a timer. It counts only when
   * StonkFun's record of it agrees with the chain and with what was launched: the mint, the pool
   * (PDA of the mint and the stock), the creator (the autopilot wallet that paid), LaunchLab,
   * the standard mode, and the stock as the quote. "Not found" is "not adopted yet", no failure.
   */
  async function stockCheckAdoption({ mint } = {}) {
    needStonkfun("token");
    const j = await loadJournal();
    const e = j.find((x) => x.mint === mint && x.venue === "stonkfun" && x.kind === "launched");
    if (!e || !e.pair?.mint) refuse("not_found", "no launched stock cat with that mint");
    let body;
    try { body = await stonkfun.token(mint); }
    catch (err) {
      if (err?.clause !== "not_found") throw err;
      await journalUpdate(mint, { adoption: { at: clock(), adopted: false, why: "not_found" } });
      return { ok: true, adopted: false, notFound: true, why: "StonkFun does not list it yet: not adopted yet" };
    }
    const L = body?.data?.launch, T = body?.data?.token;
    const checks = [["launch.mint", L?.mint, mint], ["launch.pool", L?.pool, poolState(mint, e.pair.mint)], ["launch.creator", L?.creator, e.creator],
      ["launch.launchpad", L?.launchpad, "launchlab"], ["launch.mode", L?.mode, "standard"], ["token.quote.mint", T?.quote?.mint, e.pair.mint]];
    const mismatches = checks.filter(([, got, want]) => got !== want).map(([what, got, want]) => ({ what, got: String(got ?? "none").slice(0, 60), want }));
    const adopted = mismatches.length === 0;
    await journalUpdate(mint, { adoption: { at: clock(), adopted, mismatches } });
    return { ok: true, adopted, mismatches };
  }

  async function stockSaveSettings(input = {}) {
    const n = Number(isObject(input) ? input.maxPerDay : NaN);
    const [lo, hi] = STOCKCAT_LIMITS.fence;
    if (!(Number.isInteger(n) && n >= lo && n <= hi)) refuse("max_per_day", `stock cats count against at most ${lo} to ${hi} launches a UTC day`);
    await storage.set(CASHCAT_TAB_KEYS.stockSettings, { maxPerDay: n });
    return { maxPerDay: n };
  }

  const stockCats = Object.freeze({
    list: stockList, refresh: stockRefresh, suggest: stockSuggest, draft: stockDraftIn, prepare: stockPrepare, launch: stockLaunch,
    checkAdoption: stockCheckAdoption, saveSettings: stockSaveSettings,
  });

  /* ── auto mode ───────────────────────────────────────────────────────────────────────── */

  async function autoChecklist(settings) {
    const f = fences();
    const wallet = f?.wallet() ?? null;
    const rpc = f?.rpc() ?? null;
    let balance = null;
    if (wallet && rpc) { try { balance = BigInt(await rpc.getBalance(wallet)); } catch { balance = null; } }
    const need = BigInt(Math.round(settings.auto.minBalanceSol * 1e9)) + BigInt(LAUNCH_BUDGET_LAMPORTS) + BigInt(RENT_EXEMPT_EMPTY_ACCOUNT_LAMPORTS);
    const journal = await loadJournal();
    const items = [
      { name: "autopilot_wallet", ok: Boolean(wallet), detail: wallet ? `the autopilot wallet ${short(wallet)} signs every launch` : "create the autopilot wallet in the popup" },
      { name: "unlocked", ok: Boolean(f?.ready()), detail: f?.ready() ? "unlocked" : "unlock it: a locked wallet signs nothing, and auto mode then refuses each launch" },
      { name: "rpc", ok: Boolean(rpc), detail: rpc ? "your RPC is set" : "set your RPC in Options" },
      { name: "api_key", ok: await hasApiKey(), detail: "auto mode drafts from trends and needs the model's review: save your Anthropic key in Options → Agent" },
      { name: "pinata", ok: await pinata.hasJwt(), detail: "save your Pinata JWT in Options → CashCat" },
      { name: "balance", ok: balance !== null && balance >= need, detail: balance === null ? "the balance could not be read" : `${sol(balance).toFixed(6)} SOL; at least ${sol(need).toFixed(6)} needed (the minimum, one launch's budget, the rent floor)` },
      { name: "no_unresolved_launch", ok: !journal.some((j) => j.kind === "sending" || j.kind === "unknown"), detail: "every launch in the journal has a known outcome" },
    ];
    return { wallet, items, ready: items.every((i) => i.ok), expected: wallet ? autoArmSentence({ wallet, settings }) : null };
  }

  async function armAuto({ sentence } = {}) {
    return exclusive("arming auto mode", async () => {
      const settings = await loadSettings();
      const c = await autoChecklist(settings);
      if (!c.wallet) refuse("no_autopilot", "create the autopilot wallet first");
      if (!c.ready) refuse("checklist", `not armed: ${c.items.filter((i) => !i.ok).map((i) => i.name.replace(/_/g, " ")).join(", ")}`);
      if (typeof sentence !== "string" || sentence.trim() !== c.expected) refuse("sentence", "the sentence does not match, byte for byte; copy it from above the box");
      /* Armed only as the sentence reads: if a cap changed since it was printed, it does not arm. */
      const armed = await withSettings(async (now) => {
        if (autoArmSentence({ wallet: c.wallet, settings: now }) !== c.expected) refuse("sentence", "a cap changed since the sentence was printed; copy the new one");
        now.auto.on = true;
        now.auto.armed = { sentence: c.expected, at: clock(), wallet: c.wallet };
        now.auto.nextAt = clock() + FIRST_AUTO_DELAY_MS;
        await saveSettingsRaw(now);
        return now;
      });
      await journalAdd({ kind: "armed", mode: "auto", message: `auto mode armed: at most ${armed.auto.maxPerDay} a day, every ${armed.auto.everyHours} h at most, first run at ${new Date(armed.auto.nextAt).toISOString().slice(11, 16)} UTC` });
      return { ok: true, nextAt: armed.auto.nextAt };
    });
  }

  async function disarmAuto(why = "you disarmed it") {
    const was = await withSettings(async (settings) => {
      const on = settings.auto.on;
      settings.auto.on = false; settings.auto.armed = null; settings.auto.nextAt = null;
      await saveSettingsRaw(settings);
      return on;
    });
    if (was) await journalAdd({ kind: "disarmed", mode: "auto", message: `auto mode disarmed: ${why}` });
    return { ok: true };
  }

  /** On the worker's alarm: one automatic launch when armed, due, and every guard is green. */
  async function autoTick() {
    /* Read, judged and rescheduled under the settings' lock: a disarm or a cap change that lands
       at the same moment is never overwritten by this tick. */
    const due = await withSettings(async (settings) => {
      if (!settings.auto.on) return { ran: false, why: "off" };
      const wallet = fences()?.wallet() ?? null;
      if (!armedFor(settings, wallet)) return { ran: false, why: "disarmed", disarm: true };
      if (!Number.isFinite(settings.auto.nextAt) || settings.auto.nextAt > clock()) return { ran: false, why: "not due" };
      if (busy) return { ran: false, why: "busy" };
      /* The next run is scheduled first: a refusal never retries every half minute. */
      settings.auto.nextAt = clock() + settings.auto.everyHours * 3_600_000;
      await saveSettingsRaw(settings);
      return { go: true, settings };
    });
    if (due.disarm) { await disarmAuto("the wallet or a cap changed since it was armed"); return { ran: false, why: "disarmed" }; }
    if (!due.go) return due;
    const { settings } = due;
    return exclusive("auto mode", async () => {
      try {
        const journal = await loadJournal();
        const today = launchesOn(journal, utcDay(clock()));
        if (today >= settings.auto.maxPerDay) refuse("day_cap", `the day's cap is reached: ${today} of ${settings.auto.maxPerDay} launches today (UTC)`);
        const d = await desk.fromTrend();
        if (!d.ok || !d.draft) refuse("no_coin", `no coin this time: ${(d.refusals ?? []).join("; ") || "nothing could be drafted"}`);
        await saveDraft({ draft: d.draft, review: { ok: true, refusals: [], reviewed: d.reviewed, reviewedBy: "the rules and the model", key: draftKey(d.draft), at: clock() } });
        const out = await launchPipeline({ draft: d.draft, mode: "auto" });
        notify({ kind: "info", title: "CashCat auto mode launched a coin", body: `${d.draft.name} ($${d.draft.symbol}) on "${d.draft.topic}" — mint ${out.mint}` });
        return { ran: true, ...out };
      } catch (e) {
        const clause = e?.clause ?? "error";
        await journalAdd({ kind: "refused", mode: "auto", clause, message: String(e?.message ?? e).slice(0, 300) });
        /* A failure that is not a plain refusal, or a launch whose outcome could not be read back,
           needs the owner: auto mode stops until they look. */
        if ((!(e instanceof CashcatError) || clause === "read_back") && !["failed_on_chain", "expired"].includes(clause)) await disarmAuto(`a launch failed in a way that needs you to look (${clause})`);
        return { ran: true, ok: false, clause, message: String(e?.message ?? e) };
      }
    });
  }

  /* ── what the popup and Popcat read ──────────────────────────────────────────────────── */

  async function saveSettings(input) {
    const { prev, next } = await withSettings(async (prev) => {
      const next = normalizeCashcatSettings(isObject(input) ? input : {}, prev);
      await saveSettingsRaw(next);
      return { prev, next };
    });
    if (prev.auto.on && !next.auto.on) await journalAdd({ kind: "disarmed", mode: "auto", message: "auto mode disarmed: a cap changed" });
    return next;
  }

  async function exclusions() {
    const j = await loadJournal();
    const launches = j.filter((e) => typeof e.mint === "string" && typeof e.creator === "string").map((e) => ({ mint: e.mint, creator: e.creator }));
    const wallet = fences()?.wallet() ?? null;
    return { launches, wallets: wallet ? [wallet] : [] };
  }

  async function status() {
    const settings = await loadSettings();
    const journal = await loadJournal();
    const stored = await loadDraft();
    const c = await autoChecklist(settings);
    return {
      settings: { devBuySol: settings.devBuySol, madeWithCashCat: settings.madeWithCashCat, model: settings.model,
        auto: { on: settings.auto.on, maxPerDay: settings.auto.maxPerDay, minBalanceSol: settings.auto.minBalanceSol, everyHours: settings.auto.everyHours, nextAt: settings.auto.nextAt, armedAt: settings.auto.armed?.at ?? null } },
      draft: stored?.draft ?? null, review: stored?.review ? { ok: stored.review.ok, refusals: stored.review.refusals, reviewedBy: stored.review.reviewedBy } : null,
      disclosure: stored?.draft?.topic ? (() => { try { return userDisclosure({ topic: stored.draft.topic, madeWithCashCat: settings.madeWithCashCat }); } catch { return null; } })() : null,
      journal: journal.slice(0, 40), launchesToday: launchesOn(journal, utcDay(clock())), busy,
      auto: { checklist: c.items, expected: c.expected, ready: c.ready },
      budgetSol: sol(LAUNCH_BUDGET_LAMPORTS), devBuyFence: DEV_BUY_FENCE, everyHoursChoices: AUTO_EVERY_HOURS, maxPerDay: AUTO_MAX_PER_DAY,
      notes: { signer: CASHCAT_SIGNER_NOTE, venue: CASHCAT_VENUE_NOTE, notAdvice: CASHCAT_NOT_ADVICE },
    };
  }

  return Object.freeze({ status, saveSettings, draftTyped, draftFromTrend, clearDraft, prepare, launch, markChecked, armAuto, disarmAuto, autoTick, exclusions, loadDraft, stockCats });
}
