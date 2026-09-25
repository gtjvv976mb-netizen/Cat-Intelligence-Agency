# Agency HQ — the public API contract

Agency HQ is the agency's own server (`services/hq/`). It runs the agency's cat agents 24/7:
each agent is a cat with its own Solana wallet, a strategy, hard limits and a public record.
Only the agency's own coins get agents (a coin CashCat launched, or one the owner registers),
and only the agency's money is traded: HQ holds no one else's funds.

The website reads HQ through this API. Both sides are built against this file; change it here
first. Every number in a response is computed from the agent wallets' own on-chain
transactions (indexed by HQ), never typed in; every trade, claim, buyback and transfer carries
its transaction signature. Amounts are strings of decimal SOL or token units (never floats in
JSON); times are ISO-8601 UTC.

Formats, exactly (the server's `services/hq/contract/schemas.mjs` holds them as JSON Schema,
and both sides test against it):

- SOL: `^-?(0|[1-9]\d*)(\.\d{1,9})?$`. Token units, prices and percentages:
  `^-?(0|[1-9]\d*)(\.\d+)?$`. No leading zeros, no exponent, no `+`.
- Times: `YYYY-MM-DDTHH:MM:SS(.sss)Z`. Addresses: base58, 32–44 characters. Signatures:
  base58, 64–90 characters.
- Sprite and skin ids (`cat`, `skin`): `^[a-z0-9][a-z0-9-]{0,31}$`. Agent `id`: an integer
  1–999; its `number` is the id as exactly three digits (`^\d{3}$`).
- Desk item `id`: `^[A-Za-z0-9_-]{1,64}$`. The desk cursor (`next`, `before`) is opaque:
  `^[A-Za-z0-9_-]{1,128}$`. A perks `nonce`: `^[A-Za-z0-9_-]{16,128}$`.
- Text is plain: no control, zero-width or bidirectional-override characters. Agent `name`
  at most 48 characters; a coin or trade `symbol` at most 16; a coin `name` at most 64; a
  decision `reason` and a rug check's `detail` at most 500; a perk at most 120; a buyback
  `schedule` at most 120. Text HQ did not write itself (a coin's symbol and name from its
  metadata, a model's reason) is cleaned of those characters and cut to length by HQ before it
  is stored.
- Every object lists all its fields; a field the contract does not name is an error on both
  sides. A field is null only where this file says it may be.

Base URL: `https://api.catintelligenceagency.com` (set in `site/assets/config.js` as `hqApi`;
empty means HQ is not online yet and the site shows an honest "HQ offline" state, never
sample data). CORS allows only the site's own origins (and localhost in development). All
public endpoints are read-only GETs, except `POST /v1/perks/verify`.

## Modes

Every agent and every response says which mode it is in, and the site shows it on every
number: `paper` (trades simulated from live quotes, nothing signed, no money) or `live` (real
SOL). HQ starts in paper; live needs the owner's explicit switch, per agent.

## Ranks

An agent's rank follows its career realized trading profit (SOL, fees excluded), and is only
ever cosmetic: it unlocks a look, never more money or risk.

| Rank | id | Career realized profit |
|---|---|---|
| Recruit | `recruit` | < 0.25 SOL |
| Field Agent | `field` | ≥ 0.25 SOL |
| Special Agent | `special` | ≥ 1 SOL |
| Senior Agent | `senior` | ≥ 5 SOL |
| Director's Office | `director` | ≥ 25 SOL |

A loss never demotes; a paper agent's rank is marked paper.

## Strategies

| id | Cat | What it does |
|---|---|---|
| `snipurr` | Snipurr | pump.fun sniping by rule: wait, watch, buy only what others followed, strict exits |
| `coinmarketcat` | CoinMarketCat | the owner's plain-English strategy, decided by a model, limits enforced by code |
| `popcat-scout` | Popcat | buys only new cat coins that pass all of Popcat's checks |
| `crying-cat-safe` | Crying Cat | conservative: established tokens only, every buy rug-checked first |

Every strategy runs behind the same code-enforced limits: max per trade, max open positions,
stop loss, take profit, trailing stop, daily loss limit, and a Crying Cat rug check on every
buy (mint and freeze authority, holders, creator share). An agent never buys its own coin or
another agency coin.

## Endpoints

### `GET /v1/summary`
```json
{ "updatedAt": "…",
  "live":  ModeSummary,
  "paper": ModeSummary,
  "creatorFeesClaimedSol": "0",
  "buybacks": { "count": 0, "solSpent": "0", "ciaBought": "0" },
  "treasury": { "address": "…|null", "sol": "0", "cia": "0" } }
```
where ModeSummary is, over that mode's agents only:
```json
{ "agents": { "active": 0, "total": 0 },
  "trades24h": { "count": 0, "volumeSol": "0" },
  "solInAgentWallets": "0",
  "tradingPnlSol": { "realized": "0", "unrealized": "0" },
  "wins": 0, "losses": 0,
  "maxDrawdownPct": "0|null" }
```
Paper and live are never added together, here or anywhere. `maxDrawdownPct` is the worst single
agent's drawdown in that mode (null with no agents), never a sum. `wins` and `losses` count
closed trades. Trading P&L never includes creator fees; fees are their own line.
`treasury.address` is null only while no treasury is configured (buybacks are then off).

### `GET /v1/agents`
`{ "agents": [Agent] }`, where Agent is:
```json
{ "id": 1, "number": "001", "name": "…", "cat": "sprite id", "skin": "skin id",
  "rank": "recruit|field|special|senior|director", "strategy": "snipurr|coinmarketcat|popcat-scout|crying-cat-safe",
  "mode": "paper|live", "status": "active|paused|retired",
  "coin": { "mint": "…", "symbol": "…", "name": "…" } ,
  "wallet": "…", "hiredAt": "…",
  "stats": { "balanceSol": "0", "portfolioSol": "0",
             "realizedPnlSol": "0", "unrealizedPnlSol": "0", "careerRealizedSol": "0",
             "feesClaimedSol": "0", "depositedSol": "0", "withdrawnSol": "0",
             "trades": 0, "wins": 0, "losses": 0, "maxDrawdownPct": "0",
             "roiPct": "0" } }
```
`coin` may be null (an agent with no coin of its own); its `symbol` and `name` are null while
the coin's metadata cannot be read. `roiPct` is realized + unrealized trading P&L over the SOL
ever deposited (`depositedSol`, gross: a withdrawal or a profit sweep does not change it), and is
null when nothing is deposited. Creator fees and anything else that arrives without a trade
never count as return. `maxDrawdownPct` is the largest peak-to-trough fall of the agent's
trading value per SOL deposited, with open positions valued at their latest quote, and with
deposits, withdrawals and creator fees neutral (they neither make nor hide a drawdown). `careerRealizedSol` is the realized trading
profit the rank counts, so it is never negative: a net loss counts as 0 there, and
`realizedPnlSol` shows the loss as it is.

### `GET /v1/agents/:id`
The Agent plus:
```json
{ "limits": { "maxPerTradeSol": "…", "maxOpenPositions": 0, "stopLossPct": "…", "takeProfitPct": "…",
              "trailingStopPct": "…|null", "dailyLossLimitSol": "…" },
  "positions": [ { "mint": "…", "symbol": "…", "costSol": "…", "valueSol": "…", "entryPrice": "…",
                   "price": "…|null", "pnlSol": "…", "pnlPct": "…|null", "openedAt": "…" } ],
  "decisions": [ Decision ], "trades": [ Trade ],
  "equity": [ { "t": "…", "portfolioSol": "…" } ],
  "fees": [ { "t": "…", "sol": "…", "tx": "…" } ],
  "transfers": [ { "t": "…", "kind": "deposit|withdrawal", "sol": "…", "tx": "…|null" } ],
  "promotions": [ { "t": "…", "from": "…", "to": "…" } ] }
```
A position's `price` and `pnlPct` are null while no quote can be had (its `valueSol` is then its
last quoted value). A transfer's `tx` is null only for a paper agent, whose deposits are book
entries.

### `GET /v1/desk?limit=50&before=<cursor>`
The live trading desk across all agents, newest first: `{ "items": [Decision|Trade], "next": "cursor|null" }`.

Decision: `{ "kind": "decision", "id": "…", "t": "…", "agentId": 1, "action": "buy|sell|hold", "mint": "…|null", "symbol": "…|null", "reason": "…", "rugCheck": RugCheck|null, "mode": "…" }`

Trade: `{ "kind": "trade", "id": "…", "t": "…", "agentId": 1, "side": "buy|sell", "mint": "…", "symbol": "…",
          "sol": "…", "tokens": "…", "price": "…", "pnlSol": "…|null", "pnlPct": "…|null",
          "trigger": "strategy|stop_loss|take_profit|trailing_stop|daily_limit|manual", "rugCheck": RugCheck|null, "tx": "…|null", "mode": "…" }`
(`tx` is null only in paper mode, and never null in live mode.)

RugCheck is Crying Cat's check of that coin, made before the buy:
`{ "passed": true, "checks": [ { "id": "mint_authority|freeze_authority|holders|creator_share", "pass": true, "detail": "…" } ] }`.
`checks` has exactly four entries, one per id, in that order, and `passed` is true exactly when
all four pass. The check only reads the chain, so paper and live alike run it: every buy
Trade, paper or live, carries it, and so does a buy Decision once the check ran (a buy decision
the check refused has `passed: false`, and no trade follows). Sells, holds and a decision made
before any check carry null.

### `GET /v1/leaderboard?by=roi|pnl&period=7d|30d|all`
`{ "period": "…", "by": "…", "rows": [ { "agentId": 1, "value": "…", "rank": "…", "mode": "…" } ] }`,
best first; a row's place on the board is its position in `rows`. `value` is the agent's return
over the period in percent for `by=roi` (the realized trading P&L in the period plus the change
in unrealized over it, over `depositedSol`; creator fees never count), and its realized
trading profit over the period in SOL for `by=pnl`. `rank` is the agent's rank id
(`recruit`…`director`), not its place. Paper and live agents are ranked separately; the site
never mixes them in one board.

### `GET /v1/buybacks?limit=50`
`{ "policy": { "sharePct": "…", "sources": ["creator_fees","trading_profit"], "schedule": "…", "destination": "burn|treasury" },
   "items": [ { "t": "…", "solSpent": "…", "ciaBought": "…", "price": "…", "tx": "…", "burnTx": "…|null" } ] }`

A buyback is always a real transaction: `tx` and `price` (SOL per $CIA) are never null; only
`burnTx` is null (destination `treasury`, or a burn not yet made). `solSpent` is the SOL that
left the treasury for it, read from the chain, network fees included. $CIA's curve is quoted in
HYPE, so a buyback is two swaps (SOL → HYPE → $CIA); one that stopped between them is finished
first by the next run, and is listed here, in the summary and in the treasury's flows once, when
its $CIA is bought. `tx` is the $CIA leg.

### `GET /v1/treasury`
`{ "address": "…|null", "sol": "…", "cia": "…", "flows": [ { "t": "…", "kind": "fee_in|profit_in|buyback|funding_out|funding_in", "sol": "…", "tx": "…" } ] }`.
A flow's `sol` is never negative; its direction is its kind (`fee_in`, `profit_in`,
`funding_in` come in; `buyback`, `funding_out` go out).

### `GET /v1/stream` (Server-Sent Events)
Events: `trade`, `decision`, `promotion`, `buyback`, `fee`, `summary` — each `data:` is the
same JSON object the endpoints above return for that kind (a Trade, a Decision, a buyback item,
the summary), except that `promotion` and `fee`, which the dossier lists under one agent, say
whose they are: `promotion` is `{ "agentId": 1, "mode": "…", "t": "…", "from": "…", "to": "…" }`
and `fee` is `{ "agentId": 1, "t": "…", "sol": "…", "tx": "…" }`. Each event is sent once. HQ
ends a stream after at most five minutes, and caps streams per client network; a client
reconnects with `Last-Event-ID` and misses nothing.

### `GET /v1/perks`
`{ "tiers": [ { "id": "holder|agent|director", "minCia": "…", "perks": ["…"] } ] }`: the tiers,
lowest first, with the $CIA a wallet must hold for each. The owner sets them; the site shows
them as HQ sends them and never hard-codes a threshold.

### `GET /v1/perks/challenge?wallet=…`
`{ "wallet": "…", "nonce": "…", "message": "…", "expiresAt": "…" }`. The message is exactly these
six lines (joined by `\n`, no trailing newline), and the site refuses to ask a wallet to sign
anything else:
```
catintelligenceagency.com asks you to prove you hold this wallet, to show your $CIA holder perks.
Wallet: <wallet>
Nonce: <nonce>
Issued: <ISO time>
Expires: <ISO time, expiresAt>
Signing this message moves nothing: no SOL, no tokens, no approval, and it costs nothing.
```
It is single use and expires in five minutes; a wallet's newer challenge replaces its older
unused one.

### `POST /v1/perks/verify`
Body: `{ "wallet": "…", "message": "…", "signature": "base58" }`, with the message exactly as the
challenge gave it. HQ checks the signature and the wallet's $CIA balance on chain, and answers
`{ "holder": true, "balance": "…", "tier": "none|holder|agent|director", "perks": ["…"], "expiresAt": "…" }`,
where `holder` is true exactly when `tier` is not `none`. A public key of small order (one no one
holds a private key for) is refused before any signature check.
Perks are cosmetic or a say: agent skins, votes on the next agent's name and strategy. Never
early access to a pick or a trade (that would let holders trade ahead of the public). Voting
has no endpoint in v1; the site shows it as coming.

### Errors
Any failure answers a 4xx or 5xx status with `{ "error": "code", "message": "…" }`. The message is
HQ's own fixed wording, never text from an upstream service (an RPC's error can carry its URL
and key).

### Outside the site's contract
- `GET /health`: HQ's own status for Railway's health check (`ok`, uptime, which switches are
  on, and an ok/error state for the indexer, the feed and each job). No key, balance, trading
  figure or upstream error text.
- `POST /v1/admin`: the owner's commands (hire, pause, set limits, switch an agent's mode, the
  kill switch), each a request signed by `HQ_OWNER_WALLET` and refused without it. The site never
  calls it; the owner uses `services/hq/admin-client.mjs` or the console (docs/hq/DEPLOY.md).

## What HQ never does

- Hold anyone's funds but the agency's own. Withdrawals go only to the agency treasury address.
- Show a number it did not compute from the chain, or mix paper and live numbers.
- Promise returns. Every page carries: past results do not predict future results; not
  financial advice.
