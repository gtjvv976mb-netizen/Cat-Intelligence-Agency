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
- Sprite and skin ids (`cat`, `skin`): `^[a-z0-9][a-z0-9-]{0,31}$`.
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
the coin's metadata cannot be read. `roiPct` is realized + unrealized trading P&L over net
deposits, and is null when nothing is deposited.

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
Every buy Trade carries it, and so does a buy Decision once the check ran (a buy decision the
check refused has `passed: false`, and no trade follows). Sells, holds and a decision made
before any check carry null.

### `GET /v1/leaderboard?by=roi|pnl&period=7d|30d|all`
`{ "period": "…", "by": "…", "rows": [ { "agentId": 1, "value": "…", "rank": "…", "mode": "…" } ] }`.
Paper and live agents are ranked separately; the site never mixes them in one board.

### `GET /v1/buybacks?limit=50`
`{ "policy": { "sharePct": "…", "sources": ["creator_fees","trading_profit"], "schedule": "…", "destination": "burn|treasury" },
   "items": [ { "t": "…", "solSpent": "…", "ciaBought": "…", "price": "…", "tx": "…", "burnTx": "…|null" } ] }`

A buyback is always a real transaction: `tx` and `price` (SOL per $CIA) are never null; only
`burnTx` is null (destination `treasury`, or a burn not yet made).

### `GET /v1/treasury`
`{ "address": "…|null", "sol": "…", "cia": "…", "flows": [ { "t": "…", "kind": "fee_in|profit_in|buyback|funding_out|funding_in", "sol": "…", "tx": "…" } ] }`.
A flow's `sol` is never negative; its direction is its kind (`fee_in`, `profit_in`,
`funding_in` come in; `buyback`, `funding_out` go out).

### `GET /v1/stream` (Server-Sent Events)
Events: `trade`, `decision`, `promotion`, `buyback`, `fee`, `summary` — each `data:` is the
same JSON object the endpoints above return for that kind (a Trade, a Decision, a buyback item,
the summary), except that `promotion` and `fee`, which the dossier lists under one agent, say
whose they are: `promotion` is `{ "agentId": 1, "mode": "…", "t": "…", "from": "…", "to": "…" }`
and `fee` is `{ "agentId": 1, "t": "…", "sol": "…", "tx": "…" }`. A client reconnects with
`Last-Event-ID`.

### `GET /v1/perks`
`{ "tiers": [ { "id": "holder|agent|director", "minCia": "…", "perks": ["…"] } ] }`: the tiers,
lowest first, with the $CIA a wallet must hold for each. The owner sets them; the site shows
them as HQ sends them and never hard-codes a threshold.

### `GET /v1/perks/challenge?wallet=…`
`{ "wallet": "…", "nonce": "…", "message": "…", "expiresAt": "…" }`. The message is plain text
that names the site (`catintelligenceagency.com`), the wallet, the nonce and the expiry, and
says that signing it moves nothing. It is single use and expires in five minutes.

### `POST /v1/perks/verify`
Body: `{ "wallet": "…", "message": "…", "signature": "base58" }`, with the message exactly as the
challenge gave it. HQ checks the signature and the wallet's $CIA balance on chain, and answers
`{ "holder": true, "balance": "…", "tier": "none|holder|agent|director", "perks": ["…"], "expiresAt": "…" }`.
Perks are cosmetic or a say: agent skins, votes on the next agent's name and strategy. Never
early access to a pick or a trade (that would let holders trade ahead of the public). Voting
has no endpoint in v1; the site shows it as coming.

### Errors
Any failure answers a 4xx or 5xx status with `{ "error": "code", "message": "…" }`.

## What HQ never does

- Hold anyone's funds but the agency's own. Withdrawals go only to the agency treasury address.
- Show a number it did not compute from the chain, or mix paper and live numbers.
- Promise returns. Every page carries: past results do not predict future results; not
  financial advice.
