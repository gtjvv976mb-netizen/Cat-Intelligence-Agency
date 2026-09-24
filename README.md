# COINMARKETCAT

*A sniper bot for Phantom. It hovers ten seconds over every launch and buys only what others followed.*

CoinMarketCat is the Claude Company launch sniper's lane — HAWK-AI's — run in your own
browser and signed by **your own Phantom**, one approval window per trade. It never holds
a key. You set the limits: the take-profit, the SOL per trade, the daily budget it will
not exceed, the stop, and which stock-paired tokens to focus on.

It is a Chrome extension you build from this repository and load unpacked. It is not in
a store.

## What it does

- **Watches pump.fun's own program logs** and runs every launch through the same entry
  contract WALL-ST-E runs. The contract, the exit determiner, the curve arithmetic, the
  proved `buy_v2`/`sell_v2` encoders and the shadow book are the executor's own modules,
  copied verbatim from a named commit of
  [Claude-Company](https://github.com/gtjvv976mb-netizen/Claude-Company) into
  `vendor/executor/` and hashed in `PROVENANCE.json`. What this bot refuses is decided
  upstream and synced here, never edited here.
- **Hovers, then buys only what others followed.** Every launch that clears opens a
  would-have position. In an armed lane, only once that position is ten seconds old
  **and still marks at or above its own would-have fill** does the lane re-read the
  curve, rebuild and simulate the exact instruction it will sign, and ask Phantom.
- **Leaves in full** at the 1.5× take, the stop, the creator's exit, the 90-second stall
  or the three-minute clock — each one more Phantom window.
- **Keeps the executor's shadow book**, exported as the JSONL
  `node vendor/executor/grade-entry-gates.mjs --file <export>` reads, with the scorecard
  for the two entry rulers live in the popup.
- **Puts its own losing record beside the arming switch.** The lane starts **Off**; you choose Observe before you ever choose Execute.
- **Can pay in a tokenised stock, if you list one.** pump.fun "Custom Pairs" let a launch be
  priced in a token instead of SOL; the ones this lane is built and tested for are xStocks
  (GLDx, TSLAx, SPYx), paid from the stock already in your wallet. With nothing listed — the
  default — every such launch is refused, as before. See [Launches quoted in a stock](#launches-quoted-in-a-stock-pumpfun-custom-pairs).

## What HAWK-AI's trades taught it

The executor's live record, read back off mainnet in full on 2026-09-17 (the tables are
in Claude-Company's `executor/README.md`):

| | |
|---|---|
| first 58 round trips | **10 up, 48 down, −1.58 SOL**; average winner +75%, average loser −22% |
| six more, under the socials filter and the stall exit | 1 up, 5 down, −0.07 SOL |
| positions that ran to the old ten-minute clock | **18, none won** |
| where the net loss sat | every SOL of it in tickets of 0.35 SOL and up |
| entries under 3 seconds late | 9, **0 won**, mean −18.5% |
| entries 10 seconds and later | 10, 40% won, mean +34% |
| coins that reached 1.5× after the fill | 28 of 64; the bot took it on 5 |
| any signal at entry that ordered the outcome | none (every Spearman ρ under 0.13) |
| the best modelled exit ladder over the 64 | still −0.12 SOL |

The wait, the follow-through rule and the 1.5× take follow from that record. **None of it
is evidence of an edge.** The record loses, every modelled variant of it loses, and
nothing measured at entry orders the outcome. What the record supports is a rule that
keeps this lane out of the one bucket that never won, and a book that will say — over
thousands of unselected rows — whether anything separates a good launch from a bad one.

Wiring this lane also found a bug in the executor: an unset `SNIPE_STALL_MS` read as
`0`, which is *off*, so the 90-second stall exit was never running by default. The fix
and its regression (`vendor/executor/test-snipe-stall-default.mjs`) are in the vendored
commit.

## Launches quoted in a stock (pump.fun Custom Pairs)

In **Options → Stock quotes** you may list up to eight stock mints, each with its own
numbers **in that stock's units**: a ticket per launch, a canary (the first buy), and a
rolling 24-hour cap. The shortcuts for GLDx, TSLAx and SPYx carry the addresses and symbols
read from each mint account on mainnet (the vendored fixture
`vendor/executor/fixtures/pumpfun-xstock-quote.json`). What the lane then does:

- **It reads the stock's mint on the same call as the curve.** A listed stock's mint account
  rides on the one `getMultipleAccounts` every launch already costs, and the executor's
  `describeMint` reads its token program, decimals and pause switch. It is *described*,
  never *audited*: the base-mint kill set (`auditMintAccount`) rightly refuses every xStock,
  because each carries a permanent delegate, a live freeze authority and a pause switch
  held by its issuer. The executor's entry contract gets those facts as `quote` and judges
  the ticket, the minimum and the day cap in the stock's raw units.
- **It refuses** a stock that is not listed, a listed symbol that is not the mint's own, a
  paused stock (at first notice, at the moment of asking, and it will not ask Phantom to
  sell while one is paused), a stock whose transfer hook points at a live program, a wallet
  holding less of the stock than the buy's ceiling, and a buy whose SOL fee and rent would
  break the SOL day cap. Each refusal says which.
- **It pays through the right accounts.** The quote's token program is the stock mint's
  owner (Token-2022 for an xStock), never assumed; the wallet's stock account is its
  179-byte Token-2022 associated account, created idempotently before the buy and the sell.
  The simulation must show the stock account paying at most the ceiling and SOL moving by
  the fee and rent caps only; the fill is read from the transaction's token balances in the
  stock's decimals, and a lamport that is not fee or rent is a refusal, not a fee.
- **It books in the stock.** A stock position's size, P&L and day ledger are in the stock;
  its network fee and rent are SOL, reported beside it and charged to the SOL day. The two
  are never added together: there is no SOL price for an xStock in this lane. The shadow
  book grades stock-quoted launches on their own card per stock, never pooled with SOL.
- **The first live buy in each stock is a canary.** No buy on a stock-quoted pump.fun curve
  had been observed on chain when this was built — only one sell — so the buy's account
  order rests on the venue's IDL and the SOL buys it was proven against. The first live buy
  in each listed stock is sized at its canary (`minPerTrade`); the full ticket is used only
  after one buy in that stock has landed and its fill was read back off the chain. A buy
  that lands but cannot be read back or booked **blocks** that stock, says so in the log,
  the notification and the popup, and stays blocked until you check the signature, sell
  by hand, and press *clear the block*. The popup shows each stock's state (canary, proven,
  blocked), and the arm sentence names each stock's canary and mint.

**What is not measured.** HAWK-AI's record is SOL-quoted launches only. Nothing is known
about stock-quoted launches: not a win rate, not whether they follow through, not the fee
on a buy (one sell was read: 125 bps of the quote), not the compute a two-account-create
buy uses. A stock-quoted row's round-trip friction cannot include its SOL fees, so the stop
you choose is its only stop, and the lane will not arm with a stock listed until you have
chosen one. SPYx carries a display multiplier: Phantom shows it scaled, this lane shows the
raw count over 10^8. A coin that graduates to a pool must be sold by hand, as with SOL.

## Install

```bash
git clone https://github.com/gtjvv976mb-netizen/coinmarketcat
cd coinmarketcat && npm ci && npm run build      # → dist/
```

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → `coinmarketcat/dist`.
2. Open the extension's **Options** and paste an RPC URL (Helius, Triton, QuickNode). The
   public mainnet RPC refuses browsers. A second RPC is optional; with one set, a curve
   the two disagree on is not trusted, and a read one of them missed or failed is used
   alone (the shadow row's `endpointVerdict` says `single` or `one_missing`).
3. Open the console page — the popup's **Console** button opens
   `https://gtjvv976mb-netizen.github.io/coinmarketcat/console/` — and press **Connect Phantom**.
   Phantom injects its provider into web pages only, so signing happens in that tab.
   **Keep it open.**
4. In the popup choose **Observe**. Watch the shadow book fill. Export it, grade it.
5. To arm: choose **Execute**, read the checklist, type the sentence the lane prints for
   the connected wallet, press **Arm**. It is compared byte for byte, as WALL-ST-E does
   with `SNIPE_LIVE_ACK`. A ticket above the 0.005 SOL canary must also have a stop you
   chose.

`npm run watch` rebuilds on save; press the reload arrow on the extension card afterwards.

## What it refuses, and what you must know

- **A stop that needs a click is a weaker stop than a key's.** Every exit is one Phantom
  window. A declined sell is asked again 8 s later, and an unanswered window is abandoned
  after 32 s and asked again, for as long as the determiner still says sell; the lane
  fires a notification and puts SELL on the badge. It cannot press Approve for you.
- **Close the console tab and the lane loses its signer.** Open positions are still
  yours, and still priced, but nothing can be sold until it is back.
- **A buy window that sits past 25 s is abandoned.** A declined buy is never re-asked.
- **One live position at a time** by default. One window at a time is the whole point.
- **The checklist is the condition.** The sentence alone does not arm: every item the popup
  lists under "Before this lane may spend money" must be green (a stock listed with no stop
  chosen, for one, keeps the lane unarmed with the sentence typed).
- **A curve that has graduated to a pool cannot be sold by this lane** — it sells on the
  curve only. The row says SELL BY HAND; sell it yourself, then press **Forget**.
- **The manifest is the charter.** Permissions are `storage`, `alarms`, `notifications`;
  the content script matches the console pages only; `injected.js` is the only
  web-accessible resource. Widening any of it (beyond `unlimitedStorage`, which the test
  tolerates) fails `test-hawk-manifest.mjs`.
- **It never holds a key.** `test-hawk-no-key.mjs` scans every source file on every run,
  and the built bundle in `dist/` whenever one is present (build first, then `npm test`,
  to have it scanned). The engine refuses to send any signed transaction whose message
  is not the one it asked Phantom to sign.
- **Two RPCs are optional here; on the executor they are mandatory.** A single provider
  is a single witness; the shadow row's `endpointVerdict` says `single` when so.

## How it is built

```
manifest.json            MV3; permissions pinned by test-hawk-manifest.mjs
build.mjs                esbuild; a plugin swaps node:crypto and jupiter.mjs for src/shims/
src/background.mjs       the service worker: hosts the engine, the bridge, the badge, notifications
src/content.mjs          on the console page only: injects injected.js, relays with a nonce
src/injected.mjs         in the page's world: the only code that touches window.phantom.solana
src/lib/engine.mjs       the lane — dependency-injected, runs in Node for its tests
src/lib/config.mjs       the dials, the arming checklist, RECORD
src/lib/rpc.mjs          a small JSON-RPC client and the logsSubscribe feed with its watchdog
src/lib/tx.mjs           transaction assembly (mirrors snipe-execute.mjs) and the fill reader
src/popup/ src/options/  the UI
vendor/executor/         the executor's decision modules, verbatim, from PROVENANCE.json's commit
scripts/sync-executor.mjs  --from <checkout> re-vendors; --check reports drift from upstream main
site/                    the website: the landing page, and under console/ the page Phantom lives on
```

What a buy is, end to end: the feed's `logsSubscribe` notice → `noticesFromLogs` (the
venue's own parser) → one `getMultipleAccounts` (curve, Global, mint) → `snipeContract`
in observe mode → a would-have position and a shadow row → the wait → a fresh read →
`planSnipeCeiling` → `buyIx` → `snipeContract` in execute mode, which decodes the bytes
back and matches them to the plan → a v0 transaction (compute budget, idempotent ATA
create, `buy_v2`) → **simulated on your RPC with a spend ceiling and a delivery floor** →
one Phantom window → the signed bytes are checked to be the same message → sent with
preflight skipped → confirmed → the fill read from the transaction's own balances →
booked, charged to the rolling day. A sell is the same path with `sell_v2`.

## Keeping the decision code honest

```bash
npm run check-upstream                          # does vendor/executor still match Claude-Company main?
node scripts/sync-executor.mjs --from ../Claude-Company   # re-vendor from a checkout, record its commit
```

`test-vendor-integrity.mjs` refuses a vendored file whose bytes do not match the
manifest, so a hand edit under `vendor/` fails the suite by name. CI runs the drift check
on every push to `main`.

## Tests

`npm test` runs every `test-*.mjs` at the root and under `vendor/executor/`:

| file | proves |
|---|---|
| `test-hawk-engine.mjs` | the lane end to end against a scripted chain that executes the venue's own `buy_v2`/`sell_v2` and a scripted Phantom: notice → shadow row → the wait → re-read → sign → fill → 1.5× take → declined sell re-asked → approved sell closes with the chain's SOL; a launch nobody followed is never bought; a declined or unanswered buy; a tampered signature refused; the day cap; the hard stop; the JSONL export read back and scored. Then a GLDx-quoted curve built from the live fixture bytes: refused when GLDx is not listed; read on the same call and filed in GLDx when it is; the canary buy with the GLDx account created under Token-2022, simulated on the GLDx delta, read back in eight decimals; the sell for GLDx; the full ticket once proven; the per-stock day cap and the SOL day; a short wallet, a paused stock, a buy that cannot be read back; SOL and GLDx graded apart; the stock list's validation and the arm sentence; the fill reader alone |
| `test-hawk-manifest.mjs` | the permissions, matches and resources above |
| `test-hawk-no-key.mjs` | no key, no key derivation, no signer but the bridge, in source and in the bundle |
| `test-hawk-bundle.mjs` | the shims agree with what they replace; the build succeeds; every entry parses with no `node:` specifier; the bundled contract refuses a stale notice at the same gate the vendored contract does |
| `test-vendor-integrity.mjs` | every vendored module hashes to the manifest, from a named upstream commit |
| `vendor/executor/test-snipe-stall-default.mjs` | the executor's stall-default fix, as vendored |
| `vendor/executor/test-snipe-quote-mint.mjs` | the executor's stock-quote contract, as vendored: the allowlist, `quoteTicketFor`, `describeMint` on the live xStock bytes, the book row at eight decimals, one scorecard per quote |

## Not advice

A user-operated tool that runs in your own browser against your own wallet. Nothing here
is financial advice, nothing here has an edge until you have graded its book over a real
sample, and every position it opens can be sold only by a click you make.
