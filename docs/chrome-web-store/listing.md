# The store listing

What to paste into the Chrome Web Store Developer Dashboard's **Store listing** tab. It
describes the renamed extension, with the five cats the extension branch adds. **Check every
line against the extension as merged before you paste it**: a listing that describes something
the extension does not do is a reason for the review to refuse it.

## Name

```
Cat Intelligence Agency
```

The store takes the name from `manifest.json`'s `name`, so the manifest must say exactly this.

## Short description (at most 132 characters)

```
Five pixel cats for Solana in your browser: AI trading, a pump.fun sniper, a cat-coin scanner, a coin launcher and a rug check.
```

127 characters. The store takes this from `manifest.json`'s `description` (Chrome allows 132
there), so put the same sentence in the manifest; `test-hawk-manifest.mjs` pins the
description and will need the new wording.

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
Checks new cat coins on pump.fun and names their red flags.

CASHCAT: THE COIN LAUNCHER
Launches cat-themed coins from what is trending.

CRYING CAT: THE RUG CHECK
Checks a coin for the signs of a rug.

WHAT TO KNOW FIRST
- It runs only while your browser is open on your computer, not in a cloud.
- Spot only, with no leverage.
- Nothing about its returns has been measured. Launch sniping loses money more often than not. Only fund what you can afford to lose.
- Model calls are billed to your own API key; every trade pays network fees.
- Not financial advice.

YOUR KEYS
Your API keys, your RPC address and the encrypted key of any wallet the extension makes stay in the extension's storage in this browser. Each key is sent only to the service it is for. The agency runs no server and collects nothing.

Source code: https://github.com/gtjvv976mb-netizen/Cat-Intelligence-Agency
Website: https://catintelligenceagency.com/

CoinMarketCat is not affiliated with CoinMarketCap. Cat Intelligence Agency is a meme and software project. It is not affiliated with any government agency, CoinMarketCap, or the owners of any real cat.
```

Lines to recheck after the merge, because they describe the extension branch's work:

- Popcat, CashCat and Crying Cat: what each does inside the extension, and what each needs
  (CashCat launching from the user's own wallet, with the user's own Pinata JWT, for example).
- "Nothing trades with real money until you fund a wallet and arm it yourself": true on main for
  CoinMarketCat (paper by default) and Snipurr (off by default); confirm it for CashCat's
  launches.
- The numbers (every 15, 30 or 60 minutes; up to ten tokens) are `AGENT_BOUNDS` in
  `src/lib/agent-strategy.mjs` today.

## Links and pictures

- **Homepage URL:** `https://catintelligenceagency.com/`
- **Support URL:** `https://github.com/gtjvv976mb-netizen/Cat-Intelligence-Agency/issues`
- **Store icon, 128 × 128:** the extension's own 128 px icon, from the zip's `icons/`.
- **Screenshots, 1280 × 800:** `npm run build && node scripts/store-screenshots.mjs` writes the
  popup, the options page and the setup page to `docs/chrome-web-store/screenshots/`. Run it
  after the merge, so they show the renamed extension. At least one is required, up to five.
- **Small promo tile, 440 × 280:** not made yet. Crop it from the kit's banners
  (`brand/banner/og-1200x630.jpg` or `site-hero-2400x1029.jpg`).
