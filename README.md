# Cat Intelligence Agency

*Every agent is a cat built for crypto.*

**Website:** [catintelligenceagency.com](https://catintelligenceagency.com/)

Cat Intelligence Agency is a crew of seven pixel kittens built for crypto, plus the agency's
memecoin, **$CIA**. Two of them investigate the market in public on X. Two are real software:
**CoinMarketCat**, the agentic trading cat — agentic trading for Solana, in plain English — a
Chrome extension you run in your own browser, and **Snipurr**, the pump.fun sniper cat, which
ships inside it as its other lane. Two more, **CashCat** and **Popcat**, are bots the agency
is building. This repository holds all of it. CoinMarketCat is not affiliated with
CoinMarketCap.

| Agent | Beat | What it is |
|---|---|---|
| **The Director** | Runs the agency | The mascot |
| **CoinMarketCat** | Agentic trading for Solana, in plain English | **A product: the Chrome extension in this repository** ([manual below](#coinmarketcat--the-agentic-trading-cat)). An orange tabby pixel kitten in a purple hoodie |
| **Snipurr** | New pump.fun launches, sniped by rule | Software: the sniper lane inside CoinMarketCat ([manual below](#snipurr--the-sniper-lane)). It posts nothing on X. The mint-green kitten with the sniper-scope eyepiece, CoinMarketCat's old art |
| **Crying Cat** | Ruggers | A persona the agency posts as on X, and the face of $CIA |
| **Grumpy Cat** | Fake hype | A persona the agency posts as on X |
| **CashCat** | Launches cat-themed coins by itself, from what is trending, on pump.fun and on StonkFun (Solana's stock-paired launchpad) | An auto-launcher bot, **being built**; nothing has launched. It no longer investigates whales and KOLs |
| **Popcat** | Calls out new cat coins on pump.fun, each with its safety checks, at its desk on the work floor and in the floor's feed. Cat coins only | A callout bot, **being built**; nothing has been called out |

## What is in this repository

| Path | What |
|---|---|
| `src/`, `manifest.json`, `build.mjs`, `vendor/`, `fixtures/` | CoinMarketCat, the agentic trading extension, and Snipurr, its sniper lane |
| `site/` | The website: the agency's home with its 3D headquarters, [the work floor](https://catintelligenceagency.com/floor/) where the cats post their cases, [CoinMarketCat's page](https://catintelligenceagency.com/coinmarketcat/), and [the console](https://catintelligenceagency.com/console/) the extension signs through |
| `brand/` | The [brand kit](brand/README.md): the seven pixel kittens (CoinMarketCat in its purple hoodie, Snipurr in CoinMarketCat's old art), the work floor with seven desks, the X header, the $CIA coin image, the 3D headquarters model, and [the launch copy](brand/COPY.md) |
| `icons/` | The extension's icons: CoinMarketCat's face, in its hoodie |

$CIA is a memecoin with no intrinsic value and no expectation of profit. Nothing here is
financial advice. Cat Intelligence Agency is a meme and software project, not a government
agency, and is not affiliated with CoinMarketCap or with the owners of any real cat or meme.

## The work floor, and how to post a case

Click the 3D headquarters on the home page (or **Enter the agency**, or **The Floor** in the
bar) and you are on [the work floor](https://catintelligenceagency.com/floor/): the office in
pixel art, each of the seven cats at its own desk. Click a desk to open that cat's station: its monitor,
who it is, and **its case files**, newest first. Every case also shows up under **Latest from
the floor**. Until a cat has posted something, its station says so and shows its case
template instead. Nothing on the floor is invented: it shows only what is in one file.

**Posting a case** (after the thread is up on X, written from the templates in
[brand/COPY.md](brand/COPY.md)):

1. Open `site/assets/cases.json` and add one entry at the end of `"cases"`.
2. In `test-site.mjs`, raise `POSTED_CASES` by one. The test pins the count, so a case can
   only reach the site on purpose.
3. Run `node test-site.mjs`. It runs the same check the page runs and names any entry it
   would refuse.
4. Commit and push to `main`. Pages redeploys, and the case is on its cat's desk, at the top
   of the feed, and linkable as `https://catintelligenceagency.com/floor/#CRY-001`.

| Field | Rule |
|---|---|
| `id` | The agent's prefix and a number: `DIR-001` (the Director), `CRY-001` (Crying Cat), `GRR-001` (Grumpy Cat), `CSH-001` (CashCat), `POP-001` (Popcat), `CMC-001` (CoinMarketCat's field reports), `SNP-001` (Snipurr's field reports). Unique. |
| `agent` | `director`, `crying-cat`, `grumpy-cat`, `cashcat`, `popcat`, `coinmarketcat` or `snipurr` |
| `date` | The day it was posted, UTC, `YYYY-MM-DD` |
| `verdict` | One of that agent's verdicts (below) |
| `title` | One line, up to 140 characters. Plain text. |
| `summary` | A few sentences, up to 700 characters. Plain text. |
| `evidence` | A list of links, each `{ "label": "...", ... }` with exactly one of `"tx"` (a transaction signature, linked on Solscan), `"address"` (a wallet or mint, linked on Solscan) or `"url"` (any `https://` page; an archived copy for anything off-chain). At least one, except for the Director's announcements: no link, no case. Up to 12. |
| `x` | Optional: the post on X, `https://x.com/<handle>/status/<id>`. It shows as **Read on X**. |

| Agent | Verdicts |
|---|---|
| The Director | `ANNOUNCEMENT`, `CORRECTION` |
| Crying Cat | `RUGGED`, `NO RED FLAGS FOUND`, `CORRECTED` |
| Grumpy Cat | `NOT IMPRESSED`, `NO RED FLAGS FOUND`, `CORRECTED` |
| CashCat | `WHALE MOVE`, `NO RED FLAGS FOUND`, `CORRECTED` |
| Popcat | `COPYCAT`, `CLONE`, `HONEYPOT`, `NO RED FLAGS FOUND`, `CORRECTED` |
| CoinMarketCat | `FIELD REPORT` |
| Snipurr | `FIELD REPORT` |

CashCat's and Popcat's rows are still those of their old investigator beats. Their new jobs
(launches and callouts) are being built, and those rows change when the bots do.

A worked example: a Crying Cat case, as it would sit in the file. Every `[bracketed]` value
is a slot to fill from the case's own thread; the validator refuses the entry until the date,
the signatures and the addresses are real, so a half-filled copy can never reach the page.

```json
{
  "cases": [
    {
      "id": "CRY-001",
      "agent": "crying-cat",
      "date": "[YYYY-MM-DD]",
      "verdict": "RUGGED",
      "title": "[Token name] ($[TICKER]): the pool's creator pulled the liquidity [n] minutes in",
      "summary": "[One or two sentences: what the wallets did, in order, in plain words.] Our opinion on public on-chain data, not an accusation of a crime.",
      "evidence": [
        { "label": "Launch", "tx": "[transaction signature]" },
        { "label": "Liquidity removed", "tx": "[transaction signature]" },
        { "label": "Deployer", "address": "[wallet address]" },
        { "label": "Funds went to", "address": "[wallet address]" },
        { "label": "Archived token page", "url": "https://web.archive.org/web/[...]" }
      ],
      "x": "https://x.com/[handle]/status/[post id]"
    }
  ]
}
```

**A correction** goes out as loud as the case: add a `DIR-` entry with the verdict
`CORRECTION` that names the case in its title, and set the original case's verdict to
`CORRECTED`, saying in its summary what changed. The original stays up.

**If something is wrong in the file**, the floor never breaks: an entry that fails a rule
(an unknown agent, a date that is not a real day, a link that is not `http(s)`, anything that
looks like HTML, a misspelt field) is skipped and named in the browser console, and a file
that is not valid JSON leaves every station working with a note that the case files could
not be read. `node test-site.mjs` catches both before they ship. The rules live in
`site/assets/cases.js`, which the page and the test share.

## CoinMarketCat — the agentic trading cat

*Agentic trading for Solana, in plain English. You write the plan; code keeps the limits.*

CoinMarketCat is a Chrome extension that trades Solana spot tokens from a strategy you
describe in your own words. You name an agent, write its strategy, choose up to ten tokens
and set hard limits; on the schedule you choose it asks a model — through **your own
Anthropic API key** — what to do, and deterministic code then decides what of that is
allowed. It starts on **paper**. It trades live only from the autopilot wallet you fund and
unlock, and only after you type the sentence that arms it. It is **spot only**, with no
leverage, and it **runs only while Chrome is open** on your computer. Nothing about its
returns has been measured.

Its other lane is **Snipurr**, the sniper cat: the pump.fun launch sniper this extension
started as, unchanged, [documented below](#snipurr--the-sniper-lane).

CoinMarketCat is not affiliated with CoinMarketCap. Its agent follows the shape of the
"agentic trading" idea CoinMarketCap describes publicly — a plain-English strategy, a
universe, risk limits enforced by code, a vault the owner alone controls, a journal of
every decision — on Solana spot instead of leveraged futures, and in your browser instead
of a hosted service. The strategy marketplace and profit share that idea includes are
**not built** (they would need a server this project does not have).

### How the agent works

Every half minute the service worker's alarm runs one tick (`src/lib/agent-runner.mjs`):

1. **Snapshot.** One DexScreener request prices every token in the universe: price, 1 h
   and 24 h change, 24 h volume, liquidity (`src/lib/agent-market.mjs`). A token DexScreener
   does not price is asked of Jupiter's price API. A figure a source did not give is `null`
   and named as missing — never guessed, never carried over.
2. **Protections**, before anything else and whether or not the model is reachable: the
   stop loss, the take profit and the daily drawdown breaker (`src/lib/agent-risk.mjs`).
3. **The model**, only while running and only when its schedule (15, 30 or 60 minutes)
   comes round. It is shown the owner's strategy (in the system prompt, after the rules),
   the snapshot plus RSI(14), EMA(20), EMA(50) and 1 h / 4 h / 24 h returns computed here
   from GeckoTerminal's 15-minute candles, the vault, the positions, the P&L, the limits
   (read-only) and its last five decisions. It must answer through one tool,
   `submit_decisions`: a rationale and a list of `buy` (in dollars), `sell` (a fraction of
   the position) or `hold`, each with a confidence and a reason (`src/lib/agent-brain.mjs`).
4. **The limits** turn the proposal into clamped orders and named refusals.
5. **Execute**, sells first. Paper fills at Jupiter's quote; live runs Jupiter's
   transaction through the check before signing and has the autopilot wallet sign it.
6. **Journal**: every decision with its rationale and what became of each action, every
   refusal with its clause, every fill (with its signature when live), the breaker, the
   controls, and the tokens each model call used. It keeps the last 300 entries, in
   `chrome.storage.local`, and the popup shows them.

A model failure — the network, a timeout, a 401/429/5xx, a refusal, an answer with no
tool call, or a tool input that is not exactly the decision format (a field it does not
have, such as a limit, refuses the whole decision) — means **no new entries that tick**,
journaled by its clause. The protections run regardless.

### The limits

The model cannot change any of these: they are read from the spec the owner saved, which
nothing the model returns can write. Every clause is walked in `test-agent-risk.mjs`.

| Limit | Default | Fence | What happens |
|---|---|---|---|
| Most in one token | $25 | $10 and up | a buy is clamped to what is left under it (`position_cap`) |
| Most of the vault in tokens | 60% | 1–100% | pending buys count too (`exposure_cap`) |
| Stop loss | 8% under entry | 0.5–50% | the whole position is sold, every half minute (`stop_loss`) |
| Take profit | 15% over entry | 0.5–1000% | the whole position is sold, every half minute (`take_profit`) |
| Daily drawdown | 5% | 0.5–50% | measured from the vault's value at the start of the UTC day; at the limit the breaker trips until UTC midnight and either stops new buys or sells everything (`drawdown_breaker`, `drawdown_liquidate`) |
| Trades a day | 6 | 1–96 | the model's buys and sells per UTC day; a stop or take never counts and is never refused (`trades_per_day`) |
| Slippage | 100 bps | 10–300 bps | written into every Jupiter instruction; a quote or transaction that says otherwise is refused |
| Minimum trade | $10 | fixed | a smaller buy, or a partial sell worth less, is refused (`below_min_trade`); a whole position may always be sold |
| Minimum vault | $50 | fixed | no buys below it (`vault_below_minimum`), and the model is not called when nothing is held |
| Buy price impact | 2% | fixed | a buy whose quote moves the price more is refused; a sell never is |

A buy is clamped in order — the per-token cap, the settlement balance, the exposure cap —
and refused, naming the tightest, when what is left is under $10. Only tokens in the
universe may be traded (`not_in_universe`); the settlement token cannot be traded into;
a second action for one token in one tick is refused; no buys while paused (`paused`) or
after the breaker trips. The proceeds of a sell are not spent by a buy in the same tick.

**The universe** is at most ten tokens: the **Solana majors** preset — JitoSOL, JUP, JTO,
PYTH, RAY, BONK, WIF and cbBTC — and custom mints. Every preset mint was found on
Jupiter's token API (verified, strict) and read back as a mint account on mainnet on
2026-09-24 at slot 450,123,200; the bytes are in `fixtures/agent/mints-verified.json` and
`test-agent-strategy.mjs` re-derives every decimals and token-program figure from them. A
custom mint is read over your RPC when you save it (its decimals and program come from the
chain; a Token-2022 mint with a transfer fee, a live hook or a pause is refused). **SOL
itself is not in this version**: buying SOL delivers wrapped SOL, and the check before
signing is a port that dropped the executor's wrapped-SOL branches, so the wrapped-SOL mint
is refused by name (`sol_not_in_v1`). JitoSOL follows SOL's price; it is not SOL.

**The settlement token** is USDC by default, or USDT, counted at face value. Every buy
spends it and every sell returns it, so every trade is a token-to-token swap — the kind the
existing check before signing handles. USDC, USDT and cbBTC keep a freeze authority held by
their issuers.

### Paper and live

- **Paper** (the default) starts a paper vault ($100 unless you change it, at least $50)
  and fills every order at the output Jupiter quotes for it. Nothing is signed; no wallet
  and no RPC are needed, only your API key. A quote is not a fill: a real trade can come in
  lower, down to the slippage cap.
- **Live** trades from the **autopilot wallet** (see [Who signs](#who-signs-phantom-per-trade-or-autopilot)).
  Fund it from Phantom with at least $50 of the settlement token — the popup's *Fund from
  Phantom* now offers USDC and USDT beside SOL — and a little SOL (the checklist asks for
  0.02) for network fees and each token's account rent. Unlock it, set an RPC in Options,
  and type the sentence the agent prints, which names the agent, the autopilot wallet, the
  settlement token, every limit and every token; change any of them and it must be typed
  again. Every live swap is Jupiter's transaction run through the check the xStock venue
  uses: the pair must be the settlement token and a listed token, either way
  (`allowedPairs`, refused at `pair_not_allowed` inside `checkSwapTransaction`); the route
  decoded and bound to the quote; the lookup tables resolved on your RPC; the wallet's other
  token accounts untouched; the engine's simulation guard on the settlement-token and token
  deltas; the exact input; both accounts safe after the simulation. Then the engine's
  `signSendConfirm`, bound to the autopilot wallet, signs without a window, sends, confirms,
  and the fill is read back from the chain. A live USDC → JUP transaction Jupiter built on
  2026-09-24 passes that check (`fixtures/agent/jupiter-usdc-jup-swap.json`).

### Your API key, and what the model costs

There is no CoinMarketCat server, so the agent calls the Anthropic Messages API with **your
own key** (bring your own key). Paste it in **Options → Agent**: it is kept in
`chrome.storage.local`, read by the service worker alone, sent only to
`https://api.anthropic.com` in the `x-api-key` header, never shown again, never logged, and
never given to a content script, a web page or the site. `test-agent-no-leak.mjs` pins that
in the source, in the built bundles and through the running worker.

No model identifier is written anywhere in this repository. The model is chosen at run
time: Options lists the models your key may use (`GET /v1/models`), newest first, and with
none picked the agent uses the first one listed. Every call is billed to your key: one per
tick that the schedule comes round (every 15 minutes is 96 calls a day), plus one to list
the models. The journal and the popup show the tokens each call used. If a model refuses a
forced tool choice, the agent asks once more with the tool choice left to the model, and
remembers that for it.

### What runs where

- **In your browser**: the agent, its limits, its journal, the autopilot wallet, your key.
  It runs while Chrome is open on this computer — close Chrome or let it sleep and nothing
  runs, not the model and not the stop loss. It is not a cloud service and it does not run
  around the clock.
- **Anthropic's API**: the model calls, on your key.
- **Keyless public data**: DexScreener (one request per tick, 300 a minute allowed),
  GeckoTerminal (15-minute candles, only when the model is due, 2.1 s apart, a 429 rests it
  a minute and doubles), Jupiter (quotes, swaps and fallback prices on ONE client shared with
  Snipurr's xStock venue, at the keyless 0.5 requests a second).
- **Your RPC**: live reads, simulations and sends only.
- **Nowhere else.** The site never talks to any of this; the agent's live data stays in the
  extension.

### The controls

In the popup's **Agent** tab: **Start** (on paper, or live with the typed sentence),
**Pause** (the model is not asked; the protections keep running), **Decide now** (ask the
model at the next tick), **Liquidate all** (every position sold back to the settlement token
through the same checks, then paused), **Withdraw**, and **Stop** (what is still held keeps
its protections). **Withdraw** is yours alone: it pauses the agent and runs the existing
sweep of the autopilot wallet — every token, then the SOL above the rent floor — to your
connected Phantom address, then closes the agent's rows for what left as withdrawn. The
model cannot name it (only `buy`, `sell` and `hold` exist), and the runner has no code path
from a decision to a sweep. While the agent holds live positions the autopilot card's plain
*Sweep* refuses and points to Withdraw.

### What is not measured, and what it is not

- **Unmeasured.** No win rate, no return and no drawdown from a real run, paper or live.
  A model deciding from a snapshot of prices and a few indicators is not evidence of an edge.
- **Not 24/7**: it runs while Chrome is open. **Not leveraged**: spot only.
- **Not free to run**: every model call costs your own API credits, and every live trade a
  network fee in SOL.
- **Not a marketplace**: sharing or selling a strategy, and any profit share, is not built.
- **No live agent trade has been made on mainnet.** The live path is proven against the
  scripted chain in `test-agent-runner.mjs` and against Jupiter's recorded live transaction,
  and nowhere else.

## Snipurr — the sniper lane

*Snipurr, the sniper cat. It hovers ten seconds over every launch and buys only what others followed.*

Snipurr is CoinMarketCat's pump.fun sniper lane — the Claude Company launch sniper's lane
(HAWK-AI's), run in your own browser, and the lane this extension started as. You set the
limits: the take-profit, the SOL per trade, the daily budget it will not exceed, the stop,
and which stock-paired tokens to focus on. You also choose who signs:

- **Phantom, one approval per trade** (the default). The extension holds no key. Every buy
  and every sell is one Phantom window on the console tab.
- **Autopilot.** The extension generates one wallet of its own, keeps its key encrypted
  under your passphrase, and — while you have it unlocked — signs the lane's buys and
  sells without asking. You fund it from Phantom with one approval and sweep it back when
  you are done. This is the one mode in which the extension holds a key; see
  [Who signs](#who-signs-phantom-per-trade-or-autopilot) for exactly what that means. The
  agent's live mode uses the same wallet.

When you install it, a setup page opens and walks you through Snipurr's limits and the
wallet before anything can spend. It sits in the popup's **Snipurr** tab.

It is a Chrome extension you build from this repository and load unpacked. It is not in
a store.

### What it does

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
  curve, rebuild and simulate the exact instruction it will sign, and ask Phantom (or, on
  autopilot, have the autopilot wallet sign it).
- **Leaves in full** at the 1.5× take, the stop, the creator's exit, the 90-second stall
  or the three-minute clock — each one more Phantom window, or on autopilot, none.
- **Keeps the executor's shadow book**, exported as the JSONL
  `node vendor/executor/grade-entry-gates.mjs --file <export>` reads, with the scorecard
  for the two entry rulers live in the popup.
- **Puts its own losing record beside the arming switch.** The lane starts **Off**; you choose Observe before you ever choose Execute.
- **Trades on its own, if you choose autopilot** — from a wallet you funded, inside the
  same caps, with the balance as one more cap the chain enforces.
- **Can pay in a tokenised stock, if you list one.** pump.fun "Custom Pairs" let a launch be
  priced in a token instead of SOL; the ones this lane is built and tested for are xStocks
  (GLDx, TSLAx, SPYx), paid from the stock already in your wallet. With nothing listed — the
  default — every such launch is refused, as before. See [Launches quoted in a stock](#launches-quoted-in-a-stock-pumpfun-custom-pairs).
- **Can watch new pools paired with a stock anywhere on Solana, if you turn it on.** A second
  venue, **off by default**, polls public new-pool feeds for pools on any exchange that pair
  a token with an xStock you watch, and trades them through Jupiter, paid in that stock,
  inside that stock's limits. It follows the lane: Observe only watches. See
  [New pools paired with a stock, through Jupiter](#new-pools-paired-with-a-stock-through-jupiter-off-by-default).

### What HAWK-AI's trades taught it

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

### Launches quoted in a stock (pump.fun Custom Pairs)

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

### New pools paired with a stock, through Jupiter (off by default)

The pump.fun lane hears launches from the pump.fun program's own logs. Tokens are also
launched straight into pools on Raydium, Meteora, Orca and launchpads, paired with an xStock
instead of SOL, and there is no single program to listen to for those. This venue reads what
public indexers publish about new pools and trades the ones that pass its gates through
Jupiter. Turn it on in the popup's **Venues** card (or Options). With the lane on **Observe**
it only watches; it buys only when the lane is armed, and the arm sentence names it.

**Where it looks** (Options → *Feeds*; each was read live on 2026-09-24 and its captured
answer is in `fixtures/xstock-pools/`):

| feed | what it is | what to know |
|---|---|---|
| GeckoTerminal `new_pools` | the 20 newest Solana pools of any pair | cached 30–60 s; the free tier answered 429 to the first request of the session |
| DexScreener `token-pairs` | up to 30 pools of one stock, either side | ordered by liquidity, so a pool with none yet can be missed; 300 requests a minute |
| Jupiter `gems` (opt-in) | the 30 newest launchpad pools, with their quote mint | **undocumented**; it may change or stop without notice |

It watches the stocks you listed in Options → Stock quotes. With none listed it watches a
built-in list of fifteen xStocks (addresses from the official product page, read
2026-09-24) and can only observe them: a stock with no ticket is refused at
`stock_not_listed`. Every pool found is recorded in the popup with the feed that found it,
how old it was when first seen, and what became of it. A feed that answers 429 or fails rests
a minute (a `retry-after: 0` is not trusted), and longer each time it keeps failing.

**What it pays with.** The pool's own stock, from the stock already in your wallet, at that
stock's listed ticket, canary and 24-hour cap — the same numbers and the same day ledger the
pump.fun stock lane uses. Jupiter is asked for **direct routes only**, so the swap goes from
the stock to the token on a pool that pairs them, and nothing else touches the wallet. The
network fee and the token account's rent are SOL, charged to the SOL day; on autopilot the
wallet's SOL balance must cover them.

**What it refuses, and in what order** (the first gate that fails names the refusal):

- *in-process:* the lane or venue off, no RPC, HARD STOP, paused entries; `no_new_token` (the
  other side is SOL, USDC, USDT or another stock: a market in the stock, not a launch);
  `left_to_pumpfun_lane` (a pump.fun bonding curve: that lane hears it from the program's logs
  with its own gates and canary); `notice_stale` (first seen more than 5 minutes after it was
  created, or undated); already held or already judged; `stock_not_listed`;
  `stock_canary_blocked`.
- *one account read:* `mint_refused` — the executor's `auditMintAccount` on the **new token**
  (plus a live mint or freeze authority), never on the stock, whose permanent delegate and
  pause switch the audit refuses; the live GAYMF token in the fixture is refused here for
  its TransferFee extension. `stock_unpayable` — the stock described (paused, a live
  transfer hook, a symbol that is not the listed one) and its ticket checked by the
  executor's `quoteTicketFor`. `daily_capacity`, `daily_capacity_sol`, and the fee and rent
  caps through the executor's `assertNetworkFeeBudget`.
- *Jupiter:* `no_route` (Jupiter cannot price it — the brand-new pump.fun curve quoted in GLDx
  answered `TOKEN_NOT_TRADABLE`), `quote_mismatch`, `route_not_direct`, `impact_over_cap`,
  `no_exit_route` (it cannot price the way back), `round_trip_over_cap`.

A pool that clears opens a would-have position. In an armed lane the entry rule is the
pump.fun lane's: after 10 s it must still mark at or above its would-have fill, the mark
being Jupiter's quote to sell it straight back. Exits are the same determiner (1.5× take,
stop, 90 s stall, 180 s time stop, the hold clock), sold back through Jupiter.

**The check before anything is signed.** Jupiter builds the transaction here, so each one is
decoded and bound before Phantom (or the autopilot wallet) sees it. The check is a port of
the executor's own Jupiter validator: the wallet must be the fee payer and the only signer;
every lookup table is read from **your** RPC, never taken from Jupiter; the only programs
allowed are the compute budget, idempotent creates of the wallet's own account for the two
mints, and one Jupiter `route_v2` whose data must spend **exactly the ticket**, at the
quote's output and slippage (inside the cap), with no fee of its own, from the wallet's own
stock account into its own token account; the priority fee must be inside the lane's. Then
no other token account of the wallet may be writable; then the engine's own simulation must
show the stock paid is exactly the ticket, the tokens delivered at or above the floor, and
SOL moving by the fee and rent only; then neither account may have gained a delegate or a
close authority. A transaction that spends from another account, changes the amount, sends
the output elsewhere, adds a transfer or a signer, or hides an account behind a lookup
table is refused **before signing**, by name (`transaction_refused`, `simulation_refused`).
The fill is then read from the transaction's own balances, as for pump.fun.

**The canary, for this venue.** The first live buy here in each stock is that stock's
canary size (`minPerTrade`); the full ticket only after one Jupiter fill in it has been read
back off the chain. A buy that was sent and cannot be read back or booked blocks that stock
in this venue until you check the signature and press *clear the block* in the Venues card.

**What is not measured.** Nothing about these pools has been measured by this lane: no win
rate, no follow-through, no fill. HAWK-AI's record is pump.fun launches paid in SOL. The
feeds see a pool a minute or more after it is created, so the 10 s wait runs from first
sight, not from creation. Keyless Jupiter answers about one request every two seconds,
shared by every quote and mark, so marks are seconds apart and would-have rows beyond two
are recorded, not marked. On the one pool read while this was built (GAYMF / GLDx, Raydium
CPMM, 0.01 GLDx) a round trip through Jupiter returned 899,767 of 1,000,000 raw GLDx — about
10% before network fees, which the follow-through rule then has to clear. Jupiter's own
program and the pool's program still run inside the swap: the check above bounds what the
wallet can lose to them in the simulation, not what those programs are. Jupiter calls
`/swap/v1` "no longer actively maintained" and names a successor; no sunset date is
published.

### Who signs: Phantom per trade, or autopilot

**Phantom per trade** is the default. Phantom has no auto-approve, and this mode does not
route around it: a buy the lane clears becomes one Phantom window on the console tab; a
sell the exit rules order becomes one Phantom window. The extension never sees a key.
Close the console tab and the lane cannot sign; a stop that needs a click is a weaker
stop than a key's.

**Autopilot** trades without asking. In the popup's *Who signs* card:

1. **Create** the autopilot wallet: a passphrase of at least 12 characters, typed twice.
   The extension generates a keypair and stores its 64-byte secret as AES-GCM-256
   ciphertext under a key PBKDF2-SHA256 derives from your passphrase (600,000 iterations,
   a fresh salt and nonce every write), in `chrome.storage.local`. The passphrase is never
   stored. There is no reset: write it down somewhere that is not this browser.
2. **Fund from Phantom**: an amount you type (default: your daily budget), or a listed
   stock. The extension builds the transfer, simulates it, and asks Phantom **once**, on
   the console tab.
3. **Unlock** for a while (8 hours by default; 5 minutes to 24 hours, set in Options). The
   decrypted key then sits in `chrome.storage.session` — memory only, readable by the
   extension's own pages and worker, gone when the browser closes — until the unlock runs
   out. **Lock** removes it at once.
4. **Arm**: the sentence you type names the autopilot wallet's address and ends *"signed
   without asking me, by the autopilot key this browser holds"*. A sentence typed for
   Phantom cannot arm autopilot. The checklist adds three items: the wallet exists, it is
   unlocked, and it holds enough for one buy (the ticket, the buy's fee and rent, one
   sell's fee, and the 0.00089088 SOL rent floor).
5. **Sweep back**: every token it holds (by `TransferChecked`, each emptied account closed
   for its rent), every empty token account closed, then all SOL above the rent floor — to
   your Phantom wallet, signed by the autopilot wallet. Refused while it holds a live
   position (the position would have no SOL left to sell with).
6. **Export** is for recovery: with the passphrase, the key is shown once in the base58
   form Phantom imports. After exporting, treat the wallet as exposed: sweep it and
   **Replace** it (the popup does this only for a swept wallet holding no position, and
   only with its current passphrase).

What is true on autopilot, plainly:

- **A key in a browser is a bigger attack surface than Phantom.** While the wallet is
  unlocked, anything that can read the extension's session storage — malware on the
  machine, a debugger attached to the worker, a hostile extension — can read the key and
  spend what the wallet holds. A keylogger has the passphrase.
- **Your exposure is what you fund it with.** The budget is enforced twice: by the day cap,
  as always, and by the balance — a buy the wallet cannot cover is refused by name before
  anything is signed (`autopilot_balance_short`), and were that check wrong, the chain
  would refuse the spend.
- **Locking clears the unlocked key; a locked wallet signs nothing** — including sells. An
  unlock that runs out locks itself and says so; a position the locked wallet holds waits,
  with a notification, until you unlock it.
- **A sell is always signed by the wallet that holds the position**, whatever the signer
  setting says now, so switching modes never strands one. A curve that graduates must be
  sold by hand: Forget the row, Sweep back, and sell it in Phantom.
- **The console tab is not needed to trade on autopilot** (only to fund). The worker is
  kept awake by the feed's socket and the half-minute keepalive alarm.
- **Unmeasured:** no autopilot trade, fund or sweep has been made on mainnet. The path is
  proven against the scripted chains in the tests below and nowhere else. Autopilot
  changes who signs, not what is bought: the record below still loses.

`docs/session-wallet.md` has the threat model.

### What it refuses, and what you must know

- **A stop that needs a click is a weaker stop than a key's.** In Phantom mode every exit is one Phantom
  window. A declined sell is asked again 8 s later, and an unanswered window is abandoned
  after 32 s and asked again, for as long as the determiner still says sell; the lane
  fires a notification and puts SELL on the badge. It cannot press Approve for you.
- **In Phantom mode, close the console tab and the lane loses its signer.** Open
  positions are still yours, and still priced, but nothing can be sold until it is back.
  On autopilot the tab is needed only to fund; a locked autopilot wallet is the same stop.
- **A buy window that sits past 25 s is abandoned.** A declined buy is never re-asked.
- **One live position at a time** by default, on either signer.
- **The checklist is the condition.** The sentence alone does not arm: every item the popup
  lists under "Before this lane may spend money" must be green (a stock listed with no stop
  chosen, for one, keeps the lane unarmed with the sentence typed).
- **A curve that has graduated to a pool cannot be sold by this lane** — it sells on the
  curve only. The row says SELL BY HAND; sell it yourself, then press **Forget**.
- **The manifest is the charter.** Permissions are `storage`, `alarms`, `notifications`;
  the content script matches the console pages only; `injected.js` is the only
  web-accessible resource. Widening any of it (beyond `unlimitedStorage`, which the test
  tolerates) fails `test-hawk-manifest.mjs`. The xStock venue added no permission: its
  requests to api.jup.ag, api.geckoterminal.com and api.dexscreener.com (and datapi.jup.ag if
  you choose that feed) are fetches under the same https host permission the RPC uses.
- **Exactly one file may hold a key, and only on autopilot.** In Phantom mode the
  extension holds no key at all. On autopilot the key lives in `src/lib/session-wallet.mjs`
  and nowhere else: `test-hawk-no-key.mjs` scans every source file on every run, and the
  built bundle in `dist/` whenever one is present (build first, then `npm test`), for a
  Keypair, a secret, a derivation or a signer outside that file; pins that only the
  service worker imports it; that the unlocked key goes to session storage only; that
  only the create, unlock and export messages carry a passphrase and only the export
  returns a key; that no message carries transaction bytes from a page; and that nothing
  logs or stores either. `test-hawk-autopilot.mjs` checks the same through the running
  worker. Either way, the engine refuses to send any signed transaction whose message is
  not the one it asked to have signed.
- **Two RPCs are optional here; on the executor they are mandatory.** A single provider
  is a single witness; the shadow row's `endpointVerdict` says `single` when so.

## Install

```bash
git clone https://github.com/gtjvv976mb-netizen/Cat-Intelligence-Agency
cd Cat-Intelligence-Agency && npm ci && npm run build      # → dist/
```

`chrome://extensions` → **Developer mode** → **Load unpacked** → `Cat-Intelligence-Agency/dist`.

**The agent.** Open **Options** (the popup's *Options* link, or the agent card's *Set up the
agent*). In **The agent**: name it, write the strategy, tick the tokens (or add a custom mint
— that needs an RPC, below), choose the settlement token and the schedule, set the limits,
paste your Anthropic API key and press **Save key**, press **Load the list** and pick a model
(or keep the newest), and **Save the agent**. In the popup's **Agent** tab press **Start on
paper**. Read the journal. To go live: set an RPC (below), create, fund (USDC or USDT, at
least $50, and a little SOL) and unlock the autopilot wallet in the popup, switch the mode to
Live in Options, then type the sentence the agent card prints and press **Start LIVE**.

**Snipurr and the wallet.** The rest of this section is the setup page that opens on install,
which sets up Snipurr's lane and the parts both lanes share.

1. The setup page opens on install: connect, pick a style, set your limits, choose stocks and who
   signs, and save — which puts the lane in **Observe**. Everything it sets stays editable
   in Options, and the popup's *Setup* link opens it again. The styles: **Balanced** is
   the lane's own defaults (the record's 1.5× take, 90 s stall and 180 s time stop at the
   executor's 0.005 SOL canary, 0.01 SOL a day); **Cautious** is no looser on any dial and
   tighter on three (one canary a day, 60 s stall, 120 s time stop — a choice, not a
   measured improvement); **Bold** is labelled *looser than the record supports* (0.05 SOL
   a ticket, 0.25 SOL a day, 2× take, 120 s stall, 300 s time stop, a proposed 0.5× stop).
   Every style keeps the 10 s wait and the ≥ 1.0× follow-through. The stock checklist
   offers GLDx, TSLAx and SPYx (read from the vendored fixture) and AAPLx and NVDAx (read
   over RPC on 2026-09-24, not in the fixture); a ticked stock is written into the same
   stock list Options edits, in that stock's own units.
2. Open the extension's **Options** and paste an RPC URL (the setup page asks for it too) (Helius, Triton, QuickNode). The
   public mainnet RPC refuses browsers. A second RPC is optional; with one set, a curve
   the two disagree on is not trusted, and a read one of them missed or failed is used
   alone (the shadow row's `endpointVerdict` says `single` or `one_missing`).
3. Open the console page — the popup's **Console** button opens
   `https://catintelligenceagency.com/console/` — and press **Connect Phantom**.
   Phantom injects its provider into web pages only, so signing happens in that tab.
   **Keep it open.**
4. In the popup's **Snipurr** tab choose **Observe**. Watch the shadow book fill. Export it, grade it.
5. To arm: choose **Execute**, read the checklist, type the sentence the lane prints for
   the wallet that will sign (Phantom's, or the autopilot wallet's), press **Arm**. It is compared byte for byte, as WALL-ST-E does
   with `SNIPE_LIVE_ACK`. A ticket above the 0.005 SOL canary must also have a stop you
   chose.

`npm run watch` rebuilds on save; press the reload arrow on the extension card afterwards.

## How it is built

```
manifest.json            MV3; permissions pinned by test-hawk-manifest.mjs
build.mjs                esbuild; a plugin swaps node:crypto and jupiter.mjs for src/shims/
src/background.mjs       the service worker: hosts the agent and Snipurr's engine, the bridge, the autopilot wallet's keystore, fund and sweep, the agent's API key, the badge, notifications
src/lib/agent-strategy.mjs  the agent's spec: name, strategy, universe (the verified majors, custom mints), settlement, schedule, limits, the arm sentence
src/lib/agent-market.mjs    the snapshot: DexScreener prices, GeckoTerminal candles, Jupiter's fallback price, the indicators, rate limits and backoff
src/lib/agent-brain.mjs     the model call: the Messages API with the owner's key, the submit_decisions tool, the decision format, every failure by clause
src/lib/agent-risk.mjs      the hard limits: pure functions — the protections, the breaker and its UTC reset, clamps and refusals
src/lib/agent-runner.mjs    the tick: snapshot, protections, the model on schedule, the limits, paper or live execution, the journal
fixtures/agent/             the live answers the agent's tests replay: the verified mints, DexScreener, GeckoTerminal, Jupiter prices and a USDC → JUP swap
src/content.mjs          on the console page only: injects injected.js, relays with a nonce
src/injected.mjs         in the page's world: the only code that touches window.phantom.solana
src/lib/engine.mjs       Snipurr's lane — dependency-injected, runs in Node for its tests; hands the agent its fences (agentFences)
src/lib/config.mjs       the dials, the arming checklist, RECORD
src/lib/rpc.mjs          a small JSON-RPC client and the logsSubscribe feed with its watchdog
src/lib/tx.mjs           transaction assembly (mirrors snipe-execute.mjs) and the fill reader
src/lib/xstock-lane.mjs  the second venue: new pools paired with a stock — its gates, its book, its entries and exits
src/lib/xstock-discovery.mjs  the new-pool feeds: parsers, pair classification, dedupe, backoff
src/lib/jupiter-swap.mjs the Jupiter client (0.5 requests a second, quotes, swaps and prices) and the check before signing (a port of the executor's), with the agent's pair allowlist
fixtures/xstock-pools/   the feeds' and Jupiter's live answers, captured 2026-09-24, that the tests replay
src/lib/session-wallet.mjs  the autopilot wallet: keystore, signer, fund and sweep builders — the one file that may hold a key
src/popup/ src/options/  the UI
src/welcome/             the first-run setup page, opened once on install
vendor/executor/         the executor's decision modules, verbatim, from PROVENANCE.json's commit
scripts/sync-executor.mjs  --from <checkout> re-vendors; --check reports drift from upstream main
site/                    the website: the agency (index.html, with the 3D headquarters in assets/hq3d.js on three.js 0.169.0 served from assets/vendor/three/,
                         and every not-yet-known value — X link, contract address, buy link — in assets/config.js), the cat's page (coinmarketcat/),
                         and under console/ the page Phantom lives on
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

A buy in the xStock venue: a feed's pool → the gates above → one `getMultipleAccounts` (the
new token, audited; the stock, described) → Jupiter's quote in and quote back out → a
would-have position → the wait → the same again, fresh → Jupiter's transaction → decoded and
bound, lookup tables from your RPC → the wallet's other accounts proved untouched → the
engine's simulate guard → one Phantom window (or the autopilot key) → the same-message check →
sent → confirmed → the fill read from the transaction → booked in the stock.

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
| `test-agent-strategy.mjs` | the agent's spec: every preset mint re-derived from the recorded mainnet bytes and Jupiter's token list; the defaults; every refusal by name (SOL, the settlement token, an unverified mint, eleven tokens, each limit's fence); the pair allowlist; the arm sentence binding every limit and token |
| `test-agent-market.mjs` | the snapshot replayed from the recorded DexScreener, GeckoTerminal and Jupiter answers: the parsers, missing stays missing, the indicators worked by hand and cross-checked on the live candles, one request per tick, candles only when asked and 2.1 s apart, a 429 resting the host and doubling, Jupiter pricing only what DexScreener did not |
| `test-agent-brain.mjs` | the brain against a scripted Anthropic API with invented model ids: the request and its headers, the model list and the default, the decision format held exactly, 401/403/429/500/529/400, a refusal, a truncated answer, no tool call, the retry when a forced tool choice is refused, usage, and the key in one header to one origin |
| `test-agent-risk.mjs` | the hard limits clause by clause: the UTC day, valuation with stale and unpriced marks, the stop and take at their edges, the breaker tripping, holding and resetting at UTC midnight, liquidate, every clamp in order, every refusal clause produced, and no limit the model can move |
| `test-agent-runner.mjs` | the agent end to end: paper against scripted feeds, Jupiter and the model — decisions, clamps, fills, the take and stop between turns, the model failing, the breaker, pause, liquidate, stop, the journal cap, a restart; then live on a chain double with the real engine's fences and the real autopilot wallet — arming, a checked and signed buy read back from the chain, five hostile transactions refused before signing, a live take profit, a locked wallet; and the pair allowlist on Jupiter's recorded live transaction |
| `test-agent-no-leak.mjs` | the API key: the AGENT messages, where the key is read, the password field that is cleared, the running worker (the key only ever to api.anthropic.com, never stored elsewhere, logged or answered), the bundles, the site; and no model identifier in any file or commit message |
| `test-hawk-engine.mjs` | Snipurr's lane end to end against a scripted chain that executes the venue's own `buy_v2`/`sell_v2` and a scripted Phantom: notice → shadow row → the wait → re-read → sign → fill → 1.5× take → declined sell re-asked → approved sell closes with the chain's SOL; a launch nobody followed is never bought; a declined or unanswered buy; a tampered signature refused; the day cap; the hard stop; the JSONL export read back and scored. Then a GLDx-quoted curve built from the live fixture bytes: refused when GLDx is not listed; read on the same call and filed in GLDx when it is; the canary buy with the GLDx account created under Token-2022, simulated on the GLDx delta, read back in eight decimals; the sell for GLDx; the full ticket once proven; the per-stock day cap and the SOL day; a short wallet, a paused stock, a buy that cannot be read back; SOL and GLDx graded apart; the stock list's validation and the arm sentence; the fill reader alone |
| `test-hawk-engine.mjs` §18 | autopilot with the real session wallet (a keystore over Maps, `createSessionSigner`): locked it does not arm; unlocked and funded it arms on the autopilot sentence; the buy and the sell reaching the chain carry ed25519 signatures by the autopilot key and Phantom is asked nothing; the key reaches no log, notification or store; a wallet short of one buy does not arm, and one that fell short since the last read is refused at `autopilot_balance_short`; switching to Phantom never strands a position; locked, a sell waits and says so; an unlock that runs out disarms |
| `test-hawk-autopilot.mjs` | the running service worker under a `chrome` double and a JSON-RPC chain double that verifies every signature and applies the rent rule: install opens the setup page once; the three styles against the defaults dial by dial; only extension pages drive the wallet; create, fund (one Phantom approval, SOL and GLDx by TransferChecked), unlock with a TTL and its alarm, export, sweep to exactly the rent floor with every token and empty account, lock, an unlock that runs out; nothing logged or stored carries the passphrase or the key; no sweep while a position is held |
| `test-hawk-session-wallet.mjs` | the keystore, the signer and the builders in isolation, including why a token sweep is TransferChecked: Token-2022 refuses a plain Transfer out of an xStock's pausable, hooked account |
| `test-hawk-manifest.mjs` | the permissions, matches and resources above; the name and description (the agentic trading cat, and Snipurr); the setup page is built, not web-accessible, and opened only on install |
| `test-hawk-no-key.mjs` | one file may hold a key and only the worker imports it; the agent's files name only their hosts, sign nothing and never reach the sweep, and its runner signs only through the engine's fences, after its own check; the autopilot messages, the passphrase and the exported key pinned to where they may appear; the xStock venue's code names only its four hosts, sends Jupiter the wallet's public key and nothing else of it, and reaches a signature only through the engine's `signSendConfirm`, each call after its own pre-sign check; in source and in the bundle |
| `test-hawk-xstock-venue.mjs` | the second venue against a chain double that runs Jupiter's `route_v2` on a constant-product pool, a scripted Jupiter and scripted feeds, no network: the venue off by default and silent; the captured GeckoTerminal and DexScreener pages parsed and classified; the poller's backoff on the captured 429, dedupe and horizon; the Jupiter client's rate budget; the quote and transaction checks on the **live** GLDx → GAYMF bytes and every hostile edit of them; observe with each gate refusing by name; armed on Phantom: wait, follow-through, buy, 1.5× take, sell, booked in GLDx; ten hostile Jupiter transactions and two hostile pools refused before signing; the canary, full ticket, day caps and a short wallet; an unreadable buy blocking the stock; autopilot signing with nothing secret on the wire; the pump.fun lane unchanged |
| `test-hawk-bundle.mjs` | the shims agree with what they replace; the build succeeds; every entry parses with no `node:` specifier; the bundled contract refuses a stale notice at the same gate the vendored contract does; the bundled agent limits decide exactly as their source |
| `test-vendor-integrity.mjs` | every vendored module hashes to the manifest, from a named upstream commit |
| `test-site.mjs` | the website: the work floor (the 3D building and the hero lead to it, a kitten always wins the click over the building, seven stations for the seven cats, each hotspot on its own desk, each station with its sprite, screen, copy and an honest empty state, Snipurr's and CoinMarketCat's linking to the extension's page and the console; `cases.json` parses, fits the schema and holds `POSTED_CASES` entries, none invented; the shared validator refuses an unknown agent, an impossible date, a `javascript:` link and HTML; every floor picture a web-sized copy from `brand/floor/`; the page under 2.5 MB); every dial and record figure it quotes read from the code that decides it; the console still the bridge (protocol.mjs's channel and types, its own origin, every element it draws); no page that signs, collects, stores beyond the theme or calls out; three.js self-hosted and byte for byte 0.169.0, every file the 3D scene loads present, the roster picture as its fallback, the home page under 3.5 MB; the seven cards, CashCat and Popcat marked as being built; every placeholder from one config and empty until it exists; the two-line disclaimer, $CIA as the only use of the initials, no government imagery in any image description; no hype, no invented counts; titles, descriptions, og tags on the domain, the kit's favicons and every local link |
| `vendor/executor/test-snipe-stall-default.mjs` | the executor's stall-default fix, as vendored |
| `vendor/executor/test-snipe-quote-mint.mjs` | the executor's stock-quote contract, as vendored: the allowlist, `quoteTicketFor`, `describeMint` on the live xStock bytes, the book row at eight decimals, one scorecard per quote |

## Not advice

A user-operated tool that runs in your own browser against your own wallet. Nothing here
is financial advice, and nothing here has an edge until you have measured it over a real
sample: the agent's journal on paper, Snipurr's graded shadow book. A model's judgement is
not an edge, and the agent's returns are unmeasured. In Phantom mode every position Snipurr
opens can be sold only by a click you make; on autopilot both lanes sell without asking,
from a wallet that can lose everything you fund it with. CoinMarketCat is not affiliated
with CoinMarketCap.
