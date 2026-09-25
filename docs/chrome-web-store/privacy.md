# Privacy practices

Answers for the Developer Dashboard's **Privacy** tab, and a privacy policy to publish. They
describe the extension as merged, with all five cats: CoinMarketCat, Snipurr, Popcat, CashCat
and Crying Cat. Every row was checked against the merged code (the hosts are the bots' allow-list
in `bots/lib/verified.mjs`, the agent's and Snipurr's clients in `src/lib/`, and the user's RPC);
[permissions.md](permissions.md) lists each host with the cat that calls it.

The short version: the agency collects nothing. The extension has no server of its own to
report to, no analytics and no telemetry. Everything it keeps stays in the browser's storage for
the extension, and it talks only to the services the user sets it up with, each with the user's
own key.

## Single purpose

```
Trade and research Solana tokens from your own browser, with the agency's cats: an AI trading agent under hard limits, a pump.fun sniper, a cat-coin scanner, a coin launcher and a rug check, all run with your own keys.
```

A reviewer may read five cats as five purposes. The answer is that each is a part of one
thing, trading and checking Solana tokens, and they share one wallet, one RPC and one journal.

## Where data goes, and why

| Service | What the extension sends | Why | Whose credential |
|---|---|---|---|
| **Anthropic** (`api.anthropic.com`) | The user's API key (as the request's key header); the strategy the user wrote; the tokens on the user's list, with a snapshot of their prices and indicators; the agent's positions and limits. For CashCat: the trending topics it drafts from, and each draft (name, ticker, one line, topic) for the model's review. Never a wallet key, never the passphrase, never the Pinata JWT. | The agent's decisions, which code then checks against the user's limits; CashCat's drafts and reviews. | The user's own Anthropic API key |
| **Pinata** (`uploads.pinata.cloud` with the JWT; `gateway.pinata.cloud` without it) | The user's JWT, to the upload host only; the logo and metadata (name, symbol, description) of a coin the user launches with CashCat, which become public on IPFS, and a keyless read-back of that metadata. Popcat reads other coins' metadata by CID through the gateway, with nothing of the user's. | A pump.fun launch needs the coin's metadata on IPFS. | The user's own Pinata JWT |
| **The user's RPC** (any `https://` and `wss://` URL the user pastes: Helius, Triton, QuickNode or their own node) | The public addresses of the user's wallets; reads of balances, accounts and transactions, and of the mints the user checks with Crying Cat and the coins Popcat checks; simulations; signed transactions to send, CashCat's launches among them; a subscription to pump.fun's program logs. The URL may carry the provider's key, which is the user's. | Reading the chain and sending the user's transactions. | The user's own RPC URL |
| **The public Solana RPC** (`api.mainnet-beta.solana.com`), only when no RPC is set | Popcat's and Crying Cat's reads (the mint pasted into Crying Cat among them). It answers 403 to the extension, which then asks for an RPC. | The same reads, before the user has set an RPC. | None |
| **pump.fun** (`frontend-api-v3.pump.fun`, `pump.mypinata.cloud`) | Requests for public coin listings, a creator's launch count, and coin metadata by CID. No user data. | Popcat's scan. | None |
| **A new coin's metadata host** (usually an IPFS gateway), chosen by that coin's creator | One request for the coin's public metadata document. No user data. | Snipurr's socials check (on by default). | None |
| **Jupiter** (`api.jup.ag`, `lite-api.jup.ag`, `datapi.jup.ag`) | For a quote or a swap: the two tokens, the amount, the slippage and the user's public wallet address (Jupiter builds the transaction for that address). Price and pool lookups by token. The public verified-token list. | The agent's trades and prices; the xStock venue's pools; CashCat's ticker check. | None (the keyless tier) |
| **DexScreener** (`api.dexscreener.com`) | Public price and pool lookups by token address. No user data. | The agent's market snapshot; pool discovery. | None |
| **GeckoTerminal** (`api.geckoterminal.com`) | Public candle and new-pool lookups. No user data. | The agent's indicators; pool discovery. | None |
| **Google Trends** (`trends.google.com`) | A request for the public trending list. No user data. | What CashCat drafts from, when the user drafts from a trend or auto mode runs. | None |
| **CoinGecko** (`api.coingecko.com`) | A request for the public trending list. No user data. | The same. | None |
| **catintelligenceagency.com** (the console page) | Nothing is sent to it. The content script runs only on the console page, where Phantom lives, and passes messages between that tab and the extension. The page is static and makes no network call. | Phantom injects its provider into web pages only, so approvals happen in that tab. | None |

StonkFun is not in the extension: CashCat in the extension launches SOL-quoted pump.fun coins
only, and calls no StonkFun host.

Every request also carries what any web request carries (the user's IP address, the browser's
user agent) to that service. The extension adds nothing about the user to the requests above.

### What stays in the browser

In the extension's storage (`chrome.storage.local`): the settings, the strategy, the agent's
journal and book, Snipurr's book, Popcat's scan, CashCat's settings, draft and launch journal,
the user's API key and Pinata JWT, the RPC URL, and the autopilot wallet's key **encrypted under
a passphrase only the user knows**. The unlocked key is kept only in `chrome.storage.session`
(memory, trusted contexts only) for the unlock period the user picks. A CashCat launch's one-use
mint key lives in the service worker's memory for that launch and is never stored. The passphrase
itself is never stored. Removing the extension deletes all of it.

## The dashboard's answers

**Are you using remote code?** No. Every script the extension runs is in the package. What it
fetches is data (JSON prices, listings, model answers), which is never executed.

**What user data do you plan to collect?** The dashboard counts data the extension *handles*,
even when it only passes it to a service the user chose. Tick:

- **Authentication information:** the user's Anthropic API key and Pinata JWT, sent only to
  Anthropic and Pinata; the RPC URL, sent only to that RPC; the autopilot wallet's passphrase and
  key, which never leave the browser.
- **Financial and payment information:** the user's wallet addresses, balances and
  transactions, sent to the user's RPC and, for a swap, to Jupiter, to carry out the trades the
  user set up.

Leave unticked: personally identifiable information, health, personal communications, location,
web history, user activity, website content.

**Certify** (all three are true):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** required, because the extension handles authentication and financial
information. Publish the policy below at a URL of its own (for example a page on
`catintelligenceagency.com`) and paste that URL.

## A privacy policy to publish

```
CAT INTELLIGENCE AGENCY EXTENSION: PRIVACY POLICY

The agency collects nothing. The extension has no server of its own, no analytics and no
telemetry, and the agency never receives your data.

What the extension keeps, it keeps in your browser, in the extension's own storage: your
settings, your strategy, its journal, your API key and Pinata JWT, your RPC address, and the
key of any wallet it makes, encrypted under a passphrase only you know. Removing the extension
deletes all of it.

What it sends, it sends only to the services you set it up with, to do what you asked:
- Anthropic, with your own API key: your strategy, your token list with its prices and
  indicators, and the agent's positions and limits, for the agent's decisions; and CashCat's
  trending topics and drafts, for its drafts and reviews.
- Pinata, with your own JWT: the picture and metadata of a coin you launch, which become public.
- Your RPC provider: your wallets' public addresses, reads of the chain (the mints you check
  among them), and the transactions you sign. With no RPC set, the public Solana RPC gets
  Popcat's and Crying Cat's reads, and refuses them.
- Jupiter: the tokens, amount, slippage and your public wallet address for a quote or a swap.
- pump.fun, IPFS gateways, DexScreener, GeckoTerminal, Google Trends and CoinGecko: requests
  for public market data and coin metadata, with nothing about you.

The agency does not sell, share or use your data for anything else, and never for credit or
lending decisions.

Source: https://github.com/gtjvv976mb-netizen/Cat-Intelligence-Agency
Contact: https://github.com/gtjvv976mb-netizen/Cat-Intelligence-Agency/issues
```
