# Why each permission

A justification for every permission, host permission and page match in `manifest.json` as
merged with the five cats (version 0.1.0), for the dashboard's **Privacy → Permission
justification** fields. The merge added no permission, no host permission and no page match:
the manifest's name, description and icons changed, and nothing else. Every host the code calls
is listed below with the cat that calls it. `test-hawk-manifest.mjs` pins what the manifest may
ask for, so a new permission shows up there; recheck this file if it ever does.

## Permissions

| Permission | Justification |
|---|---|
| `storage` | Keeps everything the extension needs in the browser (`chrome.storage.local`): the user's settings and strategy, the agent's journal and book, Snipurr's book, Popcat's scan (the coins it checked and the queue), CashCat's settings, current draft and launch journal, the user's own Anthropic API key and Pinata JWT, and the autopilot wallet's key encrypted under the user's passphrase. The unlocked key is held only in `chrome.storage.session`, in memory, for the unlock period the user picks. A CashCat launch's one-use mint key is never stored at all. Nothing is stored anywhere else. |
| `alarms` | One half-minute alarm runs the agent on the schedule the user picks (every 15, 30 or 60 minutes), checks the user's protections (stop loss, take profit, the daily drawdown breaker), runs Popcat's scan if the user switched background scanning on (off by default), and runs CashCat's auto mode if the user armed it (off by default; at most two launches a UTC day). A second alarm locks the autopilot wallet again when its unlock period ends. A service worker cannot keep its own timers alive, so these need alarms. |
| `notifications` | Tells the user, outside the popup, when the agent buys or sells with real money, when a protection or the drawdown breaker acts, when CashCat's auto mode launched a coin, and when something needs them: the autopilot wallet locked itself, the agent paused, or a CashCat launch's outcome could not be read and must be checked before the next. |

## Host permissions

| Host permission | Justification |
|---|---|
| `https://*/*` | The Solana RPC is whatever provider the user chooses (Helius, Triton, QuickNode or their own node) and pastes as a URL, so its host cannot be listed in advance; every read of the chain and every transaction goes to it. Snipurr's socials check reads each new pump.fun coin's metadata document from the address its creator chose (usually an IPFS gateway), so that host cannot be listed either. The same permission covers the fixed hosts in the table below. It is used only for these requests: no content script runs on any page but the console page below. |
| `wss://*/*` | The same user-chosen RPC, over its websocket: one `logsSubscribe` on the pump.fun program, which is how Snipurr sees each new launch as it happens. |

### Every host the extension calls, and which cat calls it

| Host | Called by | Why |
|---|---|---|
| The user's RPC (any `https://` URL, and its `wss://` twin) | every cat | Reads of the chain, simulations and the user's own transactions; Snipurr's live feed over the websocket. Popcat, Crying Cat and CashCat need it: the public RPC refuses the extension. |
| `api.mainnet-beta.solana.com` | Popcat, Crying Cat | Tried only when no RPC is set, for reads. It answers 403 to the extension, and both cats then say to set an RPC. |
| `api.anthropic.com` | CoinMarketCat, CashCat | The model, with the user's own API key: the list of models, the agent's decisions, CashCat's drafts from a trend and its review of every draft. |
| `uploads.pinata.cloud` | CashCat | Pins the logo and metadata of the user's own coin, with the user's own Pinata JWT, which goes to this host only. |
| `gateway.pinata.cloud` | CashCat, Popcat | CashCat reads back what it pinned, with no key; Popcat reads a coin's metadata by its IPFS CID. |
| `pump.mypinata.cloud` | Popcat | pump.fun's gateway, for a coin's metadata by its IPFS CID (to see whether it names a social link; none is shown or followed). |
| `frontend-api-v3.pump.fun` | Popcat | pump.fun's list of its newest coins, and a creator's launch count. |
| `api.jup.ag` | CoinMarketCat, Snipurr | Quotes, swaps and fallback prices, keyless. |
| `lite-api.jup.ag` | CashCat | Jupiter's verified-token list: no draft may take a verified token's ticker. |
| `datapi.jup.ag` | Snipurr | Jupiter's newest launchpad pools, only if the user chooses that feed. |
| `api.dexscreener.com` | CoinMarketCat, Snipurr | Prices for the agent's tokens; new pools paired with a stock (off by default). |
| `api.geckoterminal.com` | CoinMarketCat, Snipurr | 15-minute candles for the agent; new pools paired with a stock (off by default). |
| `trends.google.com` | CashCat | Google Trends' US trending searches, when the user drafts from a trend or auto mode runs. |
| `api.coingecko.com` | CashCat | CoinGecko's trending categories, for the same. |
| A new coin's metadata host (usually an IPFS gateway) | Snipurr | Its socials check (on by default): one read of the document, with a deadline and a size cap; the links in it are never followed. |

pump.fun itself (`pump.fun`) and Solscan (`solscan.io`) are only links the user may open from the
popup, built from checked addresses; the extension never fetches them.

A reviewer may ask for narrower host permissions; broad ones also mean a longer, in-depth
review. The way to narrow them, if asked: list the fixed hosts in `host_permissions` and move the
RPC to `optional_host_permissions`, asking for the user's RPC origin at run time when they save
it. That is a code change (the options page and the worker) and a change to
`test-hawk-manifest.mjs`, which today pins exactly `https://*/*` and `wss://*/*` and no optional
permissions.

## The content script, and its matches

| Match | Justification |
|---|---|
| `https://catintelligenceagency.com/console/*`, `https://www.catintelligenceagency.com/console/*` | The console page, where Phantom lives. Phantom injects its wallet provider into web pages only, never into an extension, so every Phantom approval the extension needs (funding the autopilot wallet; Snipurr's buys and sells in Phantom mode) is asked for in that tab. The content script only passes messages between that page and the extension. It runs on no other page. |
| `https://gtjvv976mb-netizen.github.io/Cat-Intelligence-Agency/console/*` | The same console page, at the repository's GitHub Pages address. |
| `https://claudedotcompany.com/hawk*`, `https://www.claudedotcompany.com/hawk*` | An older console address the extension grew out of. **Consider removing it before submitting**: a reviewer will ask what it is, and the store build does not need it. |
| `http://localhost:4949/console/*`, `http://127.0.0.1:4949/console/*` | A console served on the developer's own machine, for development. **Consider removing both before submitting**: a local plain-http address in a store build invites the question, and users do not need it. |

## Web-accessible resources

| Resource | Justification |
|---|---|
| `injected.js`, to the console origins above only | The one script that runs in the console page's own context, where `window.phantom.solana` is. It asks Phantom to connect and to sign what the user approves, and hands the answer back to the content script. No other page can load it. |

## Also in the manifest (not permissions)

- `background.service_worker` (a module): the worker that runs the agent, Snipurr's lane,
  Popcat's scan, Crying Cat's check and CashCat's drafts and launches, and holds the autopilot
  wallet.
- `action.default_popup` and `options_page`: the popup and the options page.
- `minimum_chrome_version: 116`: the first Chrome in which websocket activity keeps an extension
  service worker alive, which Snipurr's live feed needs.
