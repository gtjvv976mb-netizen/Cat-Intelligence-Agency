# The store listing

What to paste into the Chrome Web Store Developer Dashboard's **Store listing** tab. It
describes the Cat Intelligence Agency extension as merged, with its five cats, and was checked
line by line against the merged code. Check it again if the extension changes: a listing that
describes something the extension does not do is a reason for the review to refuse it.

## Name

```
Cat Intelligence Agency
```

The store takes the name from `manifest.json`'s `name`, so the manifest must say exactly this.

## Short description (at most 132 characters)

```
Five cats: CoinMarketCat (AI trading), Snipurr (sniper), Popcat (cat-coin scanner), CashCat (coin launcher), Crying Cat (rug check)
```

131 characters. The store takes this from `manifest.json`'s `description` (Chrome allows 132
there), and this is that description, character for character: `test-hawk-manifest.mjs` checks
the two agree, and pins what the description must say.

## Category and language

- **Category:** Tools (under Productivity). The store has no finance category; Tools is the
  closest fit for a trading and research tool. Pick the nearest one if the dashboard's list has
  changed.
- **Language:** English.

## Detailed description

```
Cat Intelligence Agency puts five of the agency's pixel cats in your browser, for Solana. Each one is yours to set up, with your own keys, and nothing trades with real money until you fund a wallet and arm it yourself.

COINMARKETCAT: AI TRADING
Write a strategy in plain English and pick up to ten Solana tokens. On a schedule you choose (every 15, 30 or 60 minutes) it asks a model, with your own Anthropic API key, what to do. Code, not the model, then applies your limits: a cap per token, total exposure, stop loss, take profit, a daily drawdown breaker, trades per day and slippage. The model cannot change a limit, trade outside your list, or withdraw. Every decision is logged with its reason. It starts on paper.

SNIPURR: THE SNIPER
Watches new pump.fun launches and enters only by rule: it waits, and buys only if the price held. It starts switched off; you choose Observe before you ever choose Execute.

POPCAT: THE CAT-COIN SCANNER
Reads pump.fun's newest coins, keeps the cat ones, and runs twelve on-chain checks on each through your own RPC: mint and freeze authority, holders, the creator's share and more. Each coin is listed as text with its red flags named. It trades nothing, and never lists a coin you launched.

CASHCAT: THE COIN LAUNCHER
Launches a cat coin of your own on pump.fun. Type it, or draft one from what is trending with your own Anthropic key. Every draft passes content rules (no real people, brands, tragedies or financial promises) and, with a key, a model's review. The logo is drawn in your browser and pinned on IPFS with your own Pinata key. The launch is checked and simulated before the extension's autopilot wallet signs it, and goes only when you type the coin's ticker. Auto mode is off until you arm it by typing the sentence it prints; armed, it launches at most two coins a day, with no dev buy, and never buys or sells them.

CRYING CAT: THE RUG CHECK
Paste a mint address: it reads the chain through your own RPC and reports, in plain words, what could let someone rug it: live mint or freeze authority, risky token extensions, how much the top holders and the creator hold, and copies of established cat coins. It trades nothing.

WHAT TO KNOW FIRST
- It runs only while your browser is open on your computer, not in a cloud.
- Spot only, with no leverage.
- Nothing about its returns has been measured. Launch sniping loses money more often than not. Only fund what you can afford to lose.
- Model calls are billed to your own API key; every trade pays network fees, and a CashCat launch costs SOL whether or not anyone buys the coin.
- Popcat, CashCat and Crying Cat need your own Solana RPC: the public one refuses browser extensions.
- Not financial advice.

YOUR KEYS
Your API keys, your RPC address and the encrypted key of any wallet the extension makes stay in the extension's storage in this browser. Each key is sent only to the service it is for: your Anthropic key only to Anthropic, your Pinata key only to Pinata. The agency runs no server and collects nothing.

Source code: https://github.com/gtjvv976mb-netizen/Cat-Intelligence-Agency
Website: https://catintelligenceagency.com/

CoinMarketCat is not affiliated with CoinMarketCap. Cat Intelligence Agency is a meme and software project. It is not affiliated with any government agency, CoinMarketCap, or the owners of any real cat.
```

Checked against the merged code:

- Popcat, CashCat and Crying Cat say what each does in the extension and what each needs: the
  user's own RPC for all three (`src/lib/popcat-tab.mjs`, `crying-cat.mjs`, `cashcat-tab.mjs`),
  the autopilot wallet and the user's Pinata JWT for CashCat.
- "Nothing trades with real money until you fund a wallet and arm it yourself": CoinMarketCat is
  on paper by default and Snipurr off; CashCat spends only from the autopilot wallet, which the
  user creates and funds, on a launch the user confirms by typing its ticker, or in auto mode,
  which is off until the user arms it.
- The numbers (every 15, 30 or 60 minutes; up to ten tokens) are `AGENT_BOUNDS` in
  `src/lib/agent-strategy.mjs`; CashCat's two a day is `AUTO_MAX_PER_DAY` in
  `src/lib/cashcat-tab.mjs`.

## Links and pictures

- **Homepage URL:** `https://catintelligenceagency.com/`
- **Support URL:** `https://github.com/gtjvv976mb-netizen/Cat-Intelligence-Agency/issues`
- **Store icon, 128 × 128:** the extension's own 128 px icon, from the zip's `icons/`.
- **Screenshots, 1280 × 800:** in [screenshots/](screenshots/), taken from the merged build
  with `npm run build && node scripts/store-screenshots.mjs`: `popup-1280x800.jpg` (the popup),
  `options-1280x800.jpg` (the options page) and `welcome-1280x800.jpg` (the setup page), each a
  fresh install with nothing set up. At least one is required, up to five. Take them again when
  the extension's pages change.
- **Small promo tile, 440 × 280:** not made yet. Crop it from the kit's banners
  (`brand/banner/og-1200x630.jpg` or `site-hero-2400x1029.jpg`).
