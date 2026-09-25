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
 * mid-send still counts it against the day and leaves it for the user to check.
 *
 * StonkFun, and pump.fun coins quoted in a stock, stay the agency's CashCat's for now: this tab
 * launches SOL-quoted pump.fun coins only. Everything is injected; this file touches no chrome.*
 * API and holds no key.
 */
import { buildUnsignedTransaction, toBase64, RENT_EXEMPT_EMPTY_ACCOUNT_LAMPORTS } from "./tx.mjs";
import { createV2Ix, devBuyIxs } from "../../bots/cashcat/pumpfun.mjs";
import { checkLaunchMessage, checkDevBuyMessage, checkSimulation } from "../../bots/lib/txcheck.mjs";
import { MAX_LAUNCH_SPEND_LAMPORTS, COMPUTE_LIMITS, FENCES } from "../../bots/cashcat/config.mjs";
import { buildUserDocument, userDisclosure, uriFor } from "../../bots/cashcat/metadata.mjs";
import { PUMPFUN_PROGRAM, PUMPFUN_GLOBAL, PAGES } from "../../bots/lib/verified.mjs";
import { pda } from "../../bots/lib/solana.mjs";
import { describeMint } from "../../vendor/executor/token2022.mjs";
import { typedDraft, draftKey } from "./cashcat-draft.mjs";

export const CASHCAT_TAB_KEYS = Object.freeze({ settings: "cia:cashcat:settings", journal: "cia:cashcat:journal", draft: "cia:cashcat:draft" });

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
export const CASHCAT_VENUE_NOTE = "SOL-quoted pump.fun coins only. StonkFun launches, and pump.fun coins quoted in a stock, are the agency's CashCat's for now.";
export const CASHCAT_NOT_ADVICE = "Your coin is yours: it does not claim to be from the Cat Intelligence Agency. Most coins like it go nowhere; a launch costs its fee whether or not anyone buys. Not financial advice.";

export class CashcatError extends Error {
  constructor(clause, message, detail = {}) { super(message); this.name = "CashcatError"; this.clause = clause; this.detail = detail; }
}
const refuse = (clause, message, detail) => { throw new CashcatError(clause, message, detail); };

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

/**
 * The CashCat tab's worker side.
 *   storage     { get, set } (chrome.storage.local, wrapped)
 *   desk        cashcat-draft.mjs createDraftDesk
 *   renderLogo  ({ ticker, kitten, background }) → { png }
 *   pinata      { hasJwt(), pin({ logoPng, coin, buildDoc }) } — the worker's, which alone reads the JWT
 *   fences      () → engine.agentFences(): { rpc(), wallet(), ready(), signSendConfirm } or null
 *   mintKeys    the key file's createMintKeys, from the worker: { newMint, signAsMint, forget }
 *   hasApiKey   () → whether an Anthropic key is saved (never the key)
 */
export function createCashcatTab({ storage, desk, renderLogo, pinata, fences, mintKeys, hasApiKey = async () => false, clock = () => Date.now(), log = () => {}, notify = () => {} } = {}) {
  for (const [name, v] of Object.entries({ storage, desk, renderLogo, pinata, fences, mintKeys })) if (!v) throw new Error(`createCashcatTab needs ${name}`);
  let busy = null;

  const loadSettings = async () => readSettings(await storage.get(CASHCAT_TAB_KEYS.settings));
  const saveSettingsRaw = (s) => storage.set(CASHCAT_TAB_KEYS.settings, s);
  const loadJournal = async () => { const j = await storage.get(CASHCAT_TAB_KEYS.journal); return Array.isArray(j) ? j.filter(isObject) : []; };
  const saveJournal = (j) => storage.set(CASHCAT_TAB_KEYS.journal, j.slice(0, JOURNAL_MAX));
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

  async function buildCheckSimulate({ rpc, wallet, mint, draft, uri }) {
    const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
    if (typeof blockhash !== "string" || !blockhash) refuse("rpc", "the RPC gave no recent blockhash");
    const tx = buildUnsignedTransaction({ payer: wallet, blockhash, instructions: [createV2Ix({ mint, user: wallet, name: draft.name, symbol: draft.symbol, uri })],
      computeUnitLimit: COMPUTE_LIMITS.pumpfun, priorityFeeLamports: PRIORITY_FEE_LAMPORTS });
    /* The check reads the compiled v0 message: what the signatures will cover. */
    try { checkLaunchMessage(tx.message, { wallet, mint, venue: "pumpfun", coin: { name: draft.name, symbol: draft.symbol, uri } }); }
    catch (e) { refuse("transaction_refused", `refused before signing (${e.clause ?? "check"}): ${e.message}`); }
    const txBase64 = toBase64(tx.serialize());
    const before = Number(await rpc.getBalance(wallet));
    const sim = await rpc.simulateTransaction(txBase64, { addresses: [wallet] });
    let result;
    try { result = checkSimulation(sim, { walletBefore: before, walletAfter: sim?.accounts?.[0]?.lamports, maxSpendLamports: LAUNCH_BUDGET_LAMPORTS, mustLog: "Instruction: CreateV2" }); }
    catch (e) { refuse("simulation_refused", `refused before signing (${e.clause ?? "simulation"}): ${e.message}`); }
    return { txBase64, lastValidBlockHeight, spentLamports: result.spentLamports, units: result.units };
  }

  const bufAcc = (a) => (a ? { owner: a.owner, lamports: a.lamports, data: Buffer.from(a.data[0], a.data[1] || "base64") } : null);

  async function devBuy({ f, rpc, wallet, mint, spendSol }) {
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
  async function preflight({ mode, settings, journal }) {
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
    const need = BigInt(Math.round((mode === "auto" ? settings.auto.minBalanceSol : 0) * 1e9)) + BigInt(LAUNCH_BUDGET_LAMPORTS)
      + (devBuySol > 0 ? BigInt(Math.round(devBuySol * 1e9)) + BigInt(DEV_BUY_OVERHEAD_LAMPORTS) : 0n) + BigInt(RENT_EXEMPT_EMPTY_ACCOUNT_LAMPORTS);
    const balance = BigInt(await rpc.getBalance(wallet));
    if (balance < need) refuse("balance", `the autopilot wallet holds ${sol(balance).toFixed(6)} SOL; this launch needs at least ${sol(need).toFixed(6)} SOL${mode === "auto" ? ` (the ${settings.auto.minBalanceSol} SOL minimum, ` : " ("}the ${sol(LAUNCH_BUDGET_LAMPORTS)} SOL launch budget${devBuySol ? `, the ${devBuySol} SOL dev buy and its fees` : ""} and the rent floor)`);
    return { f, wallet, rpc, devBuySol, today, balance };
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
        const sim = await buildCheckSimulate({ rpc: p.rpc, wallet: p.wallet, mint, draft, uri: uriFor("pumpfun", `bafkrei${"a".repeat(52)}`) });
        return {
          ok: true, wallet: p.wallet, balanceSol: sol(p.balance), simulatedSpendSol: sol(sim.spentLamports), units: sim.units, budgetSol: sol(LAUNCH_BUDGET_LAMPORTS),
          devBuySol: p.devBuySol, disclosure: userDisclosure({ topic: draft.topic, madeWithCashCat: settings.madeWithCashCat }), reviewedBy: r.reviewed ? "the rules and the model" : "the rules",
          launchesToday: p.today, draft,
        };
      } finally { mintKeys.forget(mint); }
    });
  }

  /** The launch itself: the same checks, the pin, the check and simulation again, the signatures, the chain. */
  async function launchPipeline({ draft, mode }) {
    const settings = await loadSettings();
    const journal = await loadJournal();
    const p = await preflight({ mode, settings, journal });
    const r = await judged(draft, { requireModel: mode === "auto" });
    if (!r.ok) refuse("draft_refused", r.refusals.join("; "));
    const { png } = await renderLogo({ ticker: draft.symbol, kitten: draft.kitten, background: draft.background });
    const buildDoc = ({ imageUri }) => buildUserDocument({ name: draft.name, symbol: draft.symbol, tagline: draft.tagline, topic: draft.topic, imageUri, madeWithCashCat: settings.madeWithCashCat });
    const mint = mintKeys.newMint();
    let stage = "checking";
    try {
      /* Everything decidable before an upload is decided first, with a placeholder URI of the
         real length: a launch a guard would refuse never pins files. */
      await buildCheckSimulate({ rpc: p.rpc, wallet: p.wallet, mint, draft, uri: uriFor("pumpfun", `bafkrei${"a".repeat(52)}`) });
      stage = "pinning";
      const pinned = await pinata.pin({ logoPng: png, coin: { name: draft.name, symbol: draft.symbol }, buildDoc });
      stage = "checking";
      const built = await buildCheckSimulate({ rpc: p.rpc, wallet: p.wallet, mint, draft, uri: pinned.uri });
      await journalAdd({ kind: "sending", mode, mint, creator: p.wallet, name: draft.name, symbol: draft.symbol, topic: draft.topic, source: draft.source, uri: pinned.uri,
        simulatedSpendSol: sol(built.spentLamports) });
      stage = "signing";
      const byMint = mintKeys.signAsMint({ txBase64: built.txBase64, mint, payer: p.wallet });
      stage = "sending";
      const summary = `LAUNCH ${draft.name} ($${draft.symbol}) on pump.fun — mint ${short(mint)}`;
      const { signature, tx } = await p.f.signSendConfirm({ txBase64: byMint.signedBase64, purpose: "launch", mint, summary, lastValidBlockHeight: built.lastValidBlockHeight, timeoutMs: 60_000, wallet: p.wallet });
      stage = "reading back";
      const meta = tx?.meta;
      const keys = tx?.transaction?.message?.accountKeys ?? [];
      if (!meta || meta.err || keys[0] !== p.wallet) refuse("read_back", "the landed transaction does not read back as this wallet's successful launch", { signature });
      const costLamports = Number(meta.preBalances[0]) - Number(meta.postBalances[0]);
      const acc = (await p.rpc.getMultipleAccounts([mint], { commitment: "confirmed" })).accounts?.[0] ?? null;
      const d = acc ? describeMint(acc, mint) : null;
      const clean = Boolean(d && d.mintAuthority === null && d.freezeAuthority === null);
      await journalUpdate(mint, { kind: "launched", signature, costSol: sol(costLamports), mintClean: clean, links: [PAGES.pumpCoin(mint), PAGES.solscanTx(signature)] });
      log(`cashcat: launched ${draft.name} ($${draft.symbol}), mint ${mint}, ${signature}`);
      let devBuySignature = null;
      if (p.devBuySol > 0 && mode === "manual") {
        stage = "dev buy";
        try { devBuySignature = await devBuy({ f: p.f, rpc: p.rpc, wallet: p.wallet, mint, spendSol: p.devBuySol }); await journalUpdate(mint, { kind: "launched", devBuy: { sol: p.devBuySol, signature: devBuySignature } }); }
        catch (e) { await journalUpdate(mint, { kind: "launched", devBuy: { sol: p.devBuySol, error: String(e?.message ?? e).slice(0, 200) } }); }
      }
      return { ok: true, mint, signature, costSol: sol(costLamports), mintClean: clean, devBuySignature, links: [{ label: "The coin on pump.fun", href: PAGES.pumpCoin(mint) }, { label: "The launch on Solscan", href: PAGES.solscanTx(signature) }] };
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

  /** The user checked an unresolved launch on an explorer: it stops blocking the next one. */
  async function markChecked({ mint, landed }) {
    const j = await loadJournal();
    const i = j.findIndex((e) => e.mint === mint && (e.kind === "sending" || e.kind === "unknown"));
    if (i < 0) refuse("not_found", "no unresolved launch with that mint");
    j[i] = { ...j[i], kind: landed === true ? "launched" : "failed", checkedByUser: clock() };
    await saveJournal(j);
    return { ok: true };
  }

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
      settings.auto.on = true;
      settings.auto.armed = { sentence: c.expected, at: clock(), wallet: c.wallet };
      settings.auto.nextAt = clock() + FIRST_AUTO_DELAY_MS;
      await saveSettingsRaw(settings);
      await journalAdd({ kind: "armed", mode: "auto", message: `auto mode armed: at most ${settings.auto.maxPerDay} a day, every ${settings.auto.everyHours} h at most, first run at ${new Date(settings.auto.nextAt).toISOString().slice(11, 16)} UTC` });
      return { ok: true, nextAt: settings.auto.nextAt };
    });
  }

  async function disarmAuto(why = "you disarmed it") {
    const settings = await loadSettings();
    const was = settings.auto.on;
    settings.auto.on = false; settings.auto.armed = null; settings.auto.nextAt = null;
    await saveSettingsRaw(settings);
    if (was) await journalAdd({ kind: "disarmed", mode: "auto", message: `auto mode disarmed: ${why}` });
    return { ok: true };
  }

  /** On the worker's alarm: one automatic launch when armed, due, and every guard is green. */
  async function autoTick() {
    const settings = await loadSettings();
    if (!settings.auto.on) return { ran: false, why: "off" };
    const f = fences();
    const wallet = f?.wallet() ?? null;
    if (!wallet || settings.auto.armed?.sentence !== autoArmSentence({ wallet, settings })) { await disarmAuto("the wallet or a cap changed since it was armed"); return { ran: false, why: "disarmed" }; }
    if (!Number.isFinite(settings.auto.nextAt) || settings.auto.nextAt > clock()) return { ran: false, why: "not due" };
    if (busy) return { ran: false, why: "busy" };
    /* The next run is scheduled first: a refusal never retries every half minute. */
    settings.auto.nextAt = clock() + settings.auto.everyHours * 3_600_000;
    await saveSettingsRaw(settings);
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
        if (!(e instanceof CashcatError) && !["failed_on_chain", "expired"].includes(clause)) await disarmAuto(`a launch failed in a way that needs you to look (${clause})`);
        return { ran: true, ok: false, clause, message: String(e?.message ?? e) };
      }
    });
  }

  /* ── what the popup and Popcat read ──────────────────────────────────────────────────── */

  async function saveSettings(input) {
    const prev = await loadSettings();
    const next = normalizeCashcatSettings(isObject(input) ? input : {}, prev);
    await saveSettingsRaw(next);
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

  return Object.freeze({ status, saveSettings, draftTyped, draftFromTrend, clearDraft, prepare, launch, markChecked, armAuto, disarmAuto, autoTick, exclusions, loadDraft });
}
