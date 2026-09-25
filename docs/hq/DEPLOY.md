# Putting Agency HQ online — the owner's guide

Agency HQ is the agency's own server (`services/hq/`). It runs the agency's cat agents around the
clock, keeps their records from the chain, buys back $CIA by the policy you set, and answers the
website at `https://api.catintelligenceagency.com` (the contract is [API.md](API.md)).

This guide is written for you, the owner, step by step. You will click through three websites
(Railway, Helius, Namecheap), run two commands on your own computer, and paste a few values. It
takes about an hour. **HQ starts in paper mode: nothing is signed and no SOL moves until you
switch an agent live yourself (step 8).**

What you need:

| Account | Why | Cost |
|---|---|---|
| GitHub (you have it) | Railway deploys HQ from the repository | free |
| [Railway](https://railway.com) (sign in with GitHub) | runs HQ 24/7 with a disk for its database | Hobby plan, $5/month minimum (see "What it costs") |
| [Helius](https://www.helius.dev) | HQ's own Solana RPC (`HQ_RPC_URL`); live trading refuses the public endpoint | Free plan to start; Developer ($49/month) once Snipurr runs |
| Namecheap (you have the domain) | `api.catintelligenceagency.com` points at HQ | nothing extra |
| Phantom (you have it) | the treasury wallet, and checking agent wallets | free |
| Anthropic API key (optional) | only CoinMarketCat asks a model; without a key it holds | pay per use |

## 1. Make HQ's secrets on your own computer

HQ needs two secrets. They are made **on your computer**, shown **once** in your terminal, and
never saved to a file:

- `HQ_MASTER_SEED` — a new 24-word recovery phrase. Every agent wallet comes from it: agent *N*
  is the account at `m/44'/501'/N'/0'`, which is the wallet Phantom shows as account *N* when you
  import the phrase (agent 1 = Phantom's account 1; account 0 is never used by HQ).
- `HQ_TREASURY_SECRET` and `HQ_TREASURY_ADDRESS` — a new treasury wallet. It funds agents,
  receives their fees and profits, and (only if you turn buybacks on) buys back $CIA.

On your computer (Node 22 installed, from [nodejs.org](https://nodejs.org)), in a terminal:

```bash
git clone https://github.com/gtjvv976mb-netizen/Cat-Intelligence-Agency.git
cd Cat-Intelligence-Agency
npm ci --prefix services/hq
node services/hq/keygen.mjs
```

`keygen.mjs` refuses to run on a server, in CI, or when its output is piped into a file, so the
secrets only ever appear in your terminal window. Then:

1. **Write the 24 words on paper** and keep the paper somewhere safe. Anyone with them controls
   every agent wallet. If you lose them and the server, the agents' SOL is lost.
2. Import `HQ_TREASURY_SECRET` into Phantom ("Add / Connect Wallet" → "Import Private Key") —
   that is how you fund agents.
3. Keep the terminal open until you have pasted the values into Railway (step 4), then close it.

**Never paste a secret into a chat, an email, a screenshot, an issue, a commit or any file in
the repository.** Railway's variables are the only place the server reads them from.

## 2. Get an RPC from Helius

1. Sign up at [helius.dev](https://www.helius.dev) (the Free plan is enough to start).
2. In the dashboard, open **RPCs** (or **Endpoints**) and copy the **mainnet** URL. It looks like
   `https://mainnet.helius-rpc.com/?api-key=…`.
3. That whole URL is your `HQ_RPC_URL`. Treat it as a secret. HQ makes the websocket address
   from it (`wss://…`) by itself.

## 3. Create the Railway service from GitHub

1. Sign in at [railway.com](https://railway.com) with GitHub and choose the **Hobby** plan
   (Settings → Plans). HQ must run all the time; the free trial stops.
2. **New Project → Deploy from GitHub repo →** `Cat-Intelligence-Agency`. Railway creates a
   service; open it and go to **Settings**:
   - **Source**: branch `main`. **Root Directory**: leave it empty (HQ is built from the
     repository root, because it uses the extension's and the bots' own code).
   - Turn on **Wait for CI**, so Railway deploys only after the `HQ` GitHub check passes.
   - **Watch Paths** (Build section): paste these, one per line, so a change to the website or
     the extension does not redeploy HQ:

     ```text
     # Watch Paths
     /services/hq/**
     /src/lib/**
     /src/shims/**
     /vendor/executor/**
     /bots/lib/**
     /bots/popcat/**
     /bots/cashcat/**
     ```
   - **Healthcheck Path** (Deploy section): `/health`.
   - **Restart Policy**: `Always`.
3. **Add a volume** (the database's disk): on the project canvas, right-click the service (or
   press ⌘K / Ctrl-K) → **Attach Volume**. Mount path: `/data`. HQ keeps `hq.sqlite` there, so
   its records survive every redeploy. HQ finds the volume itself (Railway tells it the mount
   path in `RAILWAY_VOLUME_MOUNT_PATH`).
4. Railway will try a first build now and fail until step 4 is done; that is expected.

(Railway's older `railway.json` "Config as Code" file is deprecated and new services cannot use
it, so HQ's settings are these few fields instead.)

## 4. Set the variables

Service → **Variables** → **New Variable**. For each secret, open the ⋮ menu and choose
**Seal**: a sealed value is given to HQ but can never be shown again in Railway's screens.

Required to start:

| Variable | Value | Secret? |
|---|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `services/hq/Dockerfile` | no |
| `HQ_MASTER_SEED` | the 24 words from step 1, separated by single spaces | **yes, seal it** |
| `HQ_RPC_URL` | the Helius URL from step 2 | **yes, seal it** |
| `HQ_TREASURY_ADDRESS` | the treasury address from step 1 | no |
| `HQ_TRUST_PROXY` | `1` (HQ is behind Railway's edge; rate limits use the `X-Real-IP` it sets) | no |
| `HQ_CASHCAT_WALLET_ADDRESS` | CashCat's wallet address, so no agent ever buys a coin CashCat made | no |

Optional, when you want them:

| Variable | Value | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic key, for CoinMarketCat (**seal it**) | none: CoinMarketCat holds |
| `HQ_MODEL` | a model id your key lists; empty = the first one it lists | empty |
| `HQ_OWNER_WALLET` | your own admin wallet's address, to send signed commands from your computer (step 10) | empty: admin only through the console |
| `HQ_LIVE` | `1` to let agents in **live** mode trade real SOL | off |
| `HQ_KILL` | `1` = the kill switch (step 9) | off |
| `HQ_SWEEP` | `1` = live agents send claimed fees and realized profit to the treasury | off |
| `HQ_BUYBACK_LIVE` | `1` = the treasury buys back $CIA by the policy below (also needs `HQ_TREASURY_SECRET`) | off |
| `HQ_TREASURY_SECRET` | the treasury's secret from step 1, **only** if you turn buybacks on (**seal it**) | none: buybacks off |
| `HQ_BUYBACK_SHARE_PCT` | % of new agency revenue (fees + profit swept to the treasury) spent on $CIA | `0` |
| `HQ_BUYBACK_CRON` | when buybacks run (UTC, cron) | `17 */6 * * *` |
| `HQ_BUYBACK_MAX_SOL` | most one buyback run spends | `0.05` |
| `HQ_BUYBACK_MIN_SOL` | smallest buyback worth its fees | `0.002` |
| `HQ_BUYBACK_DESTINATION` | `burn` (bought $CIA is burned) or `treasury` (kept) | `treasury` |
| `HQ_BUYBACK_SLIPPAGE_BPS` | slippage per buyback leg, in basis points | `100` |
| `HQ_BUYBACK_MAX_IMPACT_PCT` | a buyback leg with more price impact is refused | `3` |
| `HQ_TREASURY_RESERVE_SOL` | SOL the treasury always keeps | `0.05` |
| `HQ_PAPER_BANKROLL_SOL` | pretend SOL a new paper agent starts with | `1` |
| `HQ_AGENT_RESERVE_SOL` | SOL an agent never trades (fees, rent) | `0.01` |
| `HQ_FEE_CLAIM_CRON` / `HQ_FEE_CLAIM_MIN_SOL` | when live agents claim their pump.fun creator fees, and the least worth claiming | `37 */6 * * *` / `0.01` |
| `HQ_SWEEP_CRON` / `HQ_SWEEP_MIN_SOL` | when sweeps run, and the least worth sending | `7 0 * * *` / `0.005` |
| `HQ_PERK_TIERS` | $CIA needed per holder tier | `holder:1,agent:1000000,director:10000000` |
| `HQ_PERKS_TTL_HOURS` / `HQ_CHALLENGE_TTL_SECONDS` | how long a verified tier lasts / a sign-in message lasts | `24` / `300` |
| `HQ_INDEX_INTERVAL_SECONDS` / `HQ_MAX_HISTORY_PAGES` | how often wallets are re-read / how far back a wallet's history is read | `60` / `20` |
| `HQ_AGENCY_LAUNCHES_URL` | the site's list of CashCat launches (never bought) | the site's `launches.json` |
| `HQ_RATE_READ_PER_MIN`, `HQ_RATE_PERKS_PER_MIN`, `HQ_RATE_ADMIN_PER_MIN` | per-visitor limits a minute | `240`, `12`, `12` |
| `HQ_STREAMS_PER_NETWORK`, `HQ_STREAMS_TOTAL` | live streams open at once per visitor network (an IPv4 /24, an IPv6 /64), and in all | `8`, `300` |
| `HQ_STREAM_MAX_SECONDS` | a live stream ends after this long and the page reconnects where it was (10 to 300) | `300` |
| `HQ_SERVER_ID` | the name your signed commands are for (step 10); set it only for a second HQ, such as a test copy, to that copy's API host | `api.catintelligenceagency.com` |
| `HQ_ADMIN_MAX_SKEW_SECONDS` | how old a signed admin command may be | `300` |
| `HQ_RPC_WS_URL` | only if your RPC's websocket is not the `wss://` form of `HQ_RPC_URL` | derived |
| `HQ_DATA_DIR` / `HQ_DB_PATH` | where the database lives; leave empty on Railway (the volume is used) | the volume |
| `HQ_HOST` / `PORT` | leave them: Railway sets `PORT`, HQ listens on it | `0.0.0.0` / `8787` |

Railway redeploys after you save variables. Open **Deployments**: the new one should turn green
("Active") once `/health` answers.

## 5. Point api.catintelligenceagency.com at HQ

1. Railway → service → **Settings → Networking → Custom Domain** → enter
   `api.catintelligenceagency.com` (port: the one Railway suggests, 8787 if asked).
2. Railway shows **two records**: a `CNAME` (something like `xxxx.up.railway.app`) and a `TXT`
   record that proves you own the domain. **Both are required.**
3. Namecheap → Domain List → `catintelligenceagency.com` → **Advanced DNS → Add New Record**:
   - Type `CNAME Record`, Host `api`, Value: the CNAME target Railway showed, TTL Automatic.
   - Type `TXT Record`, Host and Value exactly as Railway showed.
4. Wait until Railway shows the domain as verified (minutes to an hour; the certificate follows).
   Then `https://api.catintelligenceagency.com/health` answers, and the website's HQ pages come
   alive (the site reads `hqApi` in `site/assets/config.js`).

## 6. Hire the first agents, on paper

Agents are made only by you, from HQ's console. Install the Railway CLI on your computer
(`npm i -g @railway/cli`), then in the repository folder:

```bash
railway login
railway link        # choose the project and the HQ service
railway ssh         # a shell on the running server
```

Inside that shell (first `cd /app`, where HQ lives in the image):

```bash
cd /app
node services/hq/cli.mjs status
node services/hq/cli.mjs agent create --name "Agent Snips" --strategy snipurr
node services/hq/cli.mjs agent create --name "Agent Tears" --strategy crying-cat-safe
node services/hq/cli.mjs agent create --name "Agent Scout" --strategy popcat-scout
node services/hq/cli.mjs agent create --name "Agent Market" --strategy coinmarketcat \
  --settings '{"strategy":"Buy the strongest major when its trend is up; sell half up 10%."}'
node services/hq/cli.mjs agent list
```

Each agent starts in **paper** mode with a pretend bankroll, its own wallet (shown by
`agent list`), and its strategy's safe default limits. Other useful lines:

```bash
node services/hq/cli.mjs agent show 1
node services/hq/cli.mjs agent limits 1 '{"maxPerTradeSol":"0.02","stopLossPct":20}'
node services/hq/cli.mjs agent pause 1          # and: agent resume 1, agent retire 1
node services/hq/cli.mjs coin register <mint> --agent 1   # the agent's own coin (never traded)
```

Let them run on paper for a while and read the desk on the site. **Paper results are not
evidence of an edge.** HAWK-AI's live record, which Snipurr's rules come from, lost money.

## 7. Fund an agent

1. `node services/hq/cli.mjs agent list` shows each agent's wallet address.
2. In Phantom, from the **treasury** wallet, send SOL to that address (start small: 0.1 SOL).
3. Within a minute HQ reads the deposit from the chain; it shows on the agent's page under
   transfers. The agent's live numbers come only from its wallet's own transactions.

## 8. Switch an agent live

Both switches are needed; either one off means nothing is signed.

1. Railway → Variables → set `HQ_LIVE` to `1` (Railway redeploys).
2. In `railway ssh`:
   ```bash
   node services/hq/cli.mjs agent mode 1 live --confirm <agent 1's wallet address, typed>
   ```
   Typing the wallet back is the confirmation. From then on agent 1 trades that wallet's SOL,
   inside its limits: max per trade, max open positions, stop loss, take profit, trailing stop,
   daily loss limit, Crying Cat's rug check before every buy, and never an agency coin.

Back to paper any time: `agent mode 1 paper`. Money home:
`node services/hq/cli.mjs agent withdraw 1 all` (or an amount) — it can only ever go to
`HQ_TREASURY_ADDRESS`.

## 9. Stop everything

From the fastest to the most final:

- **Kill switch, from the console**: `node services/hq/cli.mjs kill on` (and `kill off`). No
  agent buys anything, no sweep, no buyback, no fee claim. Stop losses, take profits and the
  daily limit **keep selling**, so nothing held is left unwatched.
- **Kill switch, from Railway**: set `HQ_KILL` to `1`. Same effect; it wins while it is set.
- **One agent**: `agent pause N` (its protections still sell) or `agent liquidate N` (sell
  everything it holds now).
- **Live off**: remove `HQ_LIVE` — live agents then do nothing at all (not even protective
  sells), so liquidate first if they hold coins.
- **Take the SOL out**: `agent withdraw N all` for each agent, to the treasury.
- **Turn HQ off**: Railway → Deployments → ⋮ → Remove. Nothing runs; the volume keeps the
  records. The agent wallets are still yours: import the 24 words into Phantom and agent *N* is
  account *N*.

## 10. Optional: signed commands from your computer

Instead of `railway ssh`, you can send the same commands signed by your own admin wallet:

1. Make an admin wallet in Phantom (a separate account), and export its private key into a
   file on your computer only (for example `~/cia-owner.key`).
2. Set `HQ_OWNER_WALLET` in Railway to that wallet's address.
3. On your computer:
   ```bash
   node services/hq/admin-client.mjs --keypair ~/cia-owner.key \
     --url https://api.catintelligenceagency.com --command '{"op":"kill","on":true}'
   ```
   The key signs one message on your computer; only the signature is sent. Each command has a
   fresh nonce and expires after `HQ_ADMIN_MAX_SKEW_SECONDS`.

## 11. Buybacks, when you are ready

$CIA buybacks are off until you set **all** of: `HQ_BUYBACK_LIVE=1`, `HQ_TREASURY_SECRET` (the
treasury's own key, sealed), and `HQ_BUYBACK_SHARE_PCT` above 0. Revenue is what live agents
send the treasury with HQ's memos (`HQ_SWEEP=1`): claimed creator fees and realized trading
profit. Each run spends at most `HQ_BUYBACK_MAX_SOL`. $CIA's bonding curve is quoted in HYPE, so a
buyback is two Jupiter swaps, SOL → HYPE → $CIA, each checked against an allowlist of exactly
those two pairs before the treasury signs. Every transaction is shown on the site.

## 12. Updates

Every push to `main` that touches HQ runs the `HQ` GitHub check (tests, the image built and
started); with **Wait for CI** on, Railway deploys only after it passes. A redeploy restarts HQ:
anything it was sending is looked up on chain before any agent trades again, so a restart never
buys or sells twice.

## What it costs (checked 2026-09-25)

Measured, not guessed: HQ was run in paper mode against mainnet (the public endpoint) with all
four strategies for 14 minutes — Snipurr watching every pump.fun launch — counting every request
and the websocket's bytes.

| Measured over 14 minutes | Per month (×3,080) |
|---|---|
| CPU: 11.8 s of one core (0.014 of a vCPU on average) | about 0.014 vCPU |
| Memory: 170 MB at most | 0.17 GB |
| RPC calls: 1,155 `getMultipleAccounts`, 56 `getSignaturesForAddress`, 15 `getProgramAccounts` (1,361 Helius credits) | about 4.2 million credits |
| Launch feed websocket: 875 messages, 6.35 MB (127 Helius credits at 2 per 0.1 MB) | about 0.4 million credits |
| The public stream to one viewer: 101 KB | about 0.3 GB per viewer watching around the clock |

And one CoinMarketCat turn, built from live market data for the default eight tokens, is about
7,300 characters (about 1,800 input tokens); at its default schedule (every 30 minutes) that is
about 1,440 turns and 2.6 million input tokens a month, plus the model's answers (a few hundred
tokens each; the decision format caps the rationale at 2,000 characters).

| Item | Monthly cost |
|---|---|
| Railway Hobby plan | **$5** — it includes $5 of usage, and HQ's measured usage is about $2.20 (0.17 GB of memory ≈ $1.70, 0.014 vCPU ≈ $0.28, a 1 GB volume ≈ $0.16, a few GB of egress ≈ $0.10–$0.50), so nothing more |
| Helius | **$0** on the Free plan (1 million credits) while only Crying Cat and CoinMarketCat run; **$49** (Developer, 10 million credits) once Snipurr or Popcat runs: all four together need about 4.6 million credits a month, most of it Snipurr reading every launch |
| Anthropic (only if CoinMarketCat has a key) | about **$5 to $85**, depending on the model the key lists first (list prices from $1 to $10 per million input tokens and $5 to $50 per million output tokens); a 60-minute schedule halves it |
| Domain | nothing new (you have it) |
| **Total** | **about $54 a month** with all four cats and no CoinMarketCat key; **$59 to $139** with one, depending on the model; **$5** for a light start (Crying Cat and CoinMarketCat on Helius Free, no key) |

Trading itself costs network fees per transaction (the signature fee and HQ's priority fee of
50,000 lamports a trade), paid from each agent's own SOL and counted in its P&L.

Sources, read 2026-09-25: Railway pricing, https://railway.com/pricing (Hobby: $5 minimum a
month including $5 of usage; memory $0.00000386 per GB-second, CPU $0.00000772 per vCPU-second,
volumes $0.00000006 per GB-second, egress $0.05 per GB) and https://docs.railway.com/volumes;
Helius plans and credits, https://www.helius.dev/pricing and
https://www.helius.dev/docs/billing/credits (Free: 1M credits a month, 10 requests a second;
Developer: $49 a month, 10M credits, 50 requests a second; a standard RPC call is 1 credit,
`getProgramAccounts` 10, websocket data 2 credits per 0.1 MB). Anthropic's per-token prices:
https://www.anthropic.com/pricing.
