# Why each permission

A justification for every permission, host permission and page match in `manifest.json` as it
is on main today (version 0.1.0), for the dashboard's **Privacy → Permission justification**
fields. **Recheck this file after the extension branch is merged**: diff the merged
`manifest.json` against the list below, and write a justification for anything added.
`test-hawk-manifest.mjs` pins what the manifest may ask for, so a new permission shows up there
too.

## Permissions

| Permission | Justification |
|---|---|
| `storage` | Keeps everything the extension needs in the browser: the user's settings and strategy, the agent's journal and book, the user's own API key, and the autopilot wallet's key encrypted under the user's passphrase (`chrome.storage.local`). The unlocked key is held only in `chrome.storage.session`, in memory, for the unlock period the user picks. Nothing is stored anywhere else. |
| `alarms` | Runs the agent on the schedule the user picks (every 15, 30 or 60 minutes) and checks the user's protections (stop loss, take profit, the daily drawdown breaker) every half minute, and locks the autopilot wallet again when its unlock period ends. A service worker cannot keep its own timers alive, so these need alarms. |
| `notifications` | Tells the user, outside the popup, when the agent buys or sells with real money, when a protection or the drawdown breaker acts, and when something needs them: the autopilot wallet locked itself, or the agent paused. |

## Host permissions

| Host permission | Justification |
|---|---|
| `https://*/*` | The Solana RPC is whatever provider the user chooses (Helius, Triton, QuickNode or their own node) and pastes as a URL, so its host cannot be listed in advance; every read of the chain and every transaction goes to it. The same permission covers the fixed services the extension calls with the user's own keys or for public market data: Anthropic (the agent's model, with the user's key), Jupiter (quotes and swaps), DexScreener and GeckoTerminal (prices, candles and pools), and, with the extension branch, Pinata (with the user's JWT), pump.fun, Google Trends and CoinGecko. It is used only for these requests: no content script runs on any page but the console page below. |
| `wss://*/*` | The same user-chosen RPC, over its websocket: one `logsSubscribe` on the pump.fun program, which is how Snipurr sees each new launch as it happens. |

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

- `background.service_worker` (a module): the worker that runs the agent and Snipurr's lane.
- `action.default_popup` and `options_page`: the popup and the options page.
- `minimum_chrome_version: 116`: the first Chrome in which websocket activity keeps an extension
  service worker alive, which Snipurr's live feed needs.
