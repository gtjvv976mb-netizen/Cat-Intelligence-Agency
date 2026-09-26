# What CoinMarketCat learned from real money

CoinMarketCat has no trading record of its own yet. The agency's other traders do: HAWK-AI,
the Claude Co launch sniper, and the Claude Co desk. Both traded real SOL. This page lists
what their records show, what the published results for AI trading agents show, and which
lessons were built into CoinMarketCat and which were not.

Every figure below comes from those records. None of it shows that CoinMarketCat has an
edge. What it gives is the bar CoinMarketCat has to clear, and the mistakes it should not
repeat.

## 1. HAWK-AI: 64 real round trips on pump.fun launches

Source: Claude-Company `executor/README.md`, "What 58 real trades changed" and after. The
whole record was read back off mainnet on 2026-09-17.

| | |
|---|---|
| First 58 trades | 10 up, 48 down, **−1.58 SOL**. The average winner made +75%, the average loser lost −22% |
| Next 6 trades, after the fixes | 1 up, 5 down, −0.07 SOL. The win rate was unchanged at 17% |
| Held to the ten-minute clock | 18 positions, **none won** |
| Where the loss was | every SOL of it in tickets of 0.35 SOL or more |
| Entries under 3 s after launch | 9 trades, 0 won |
| Entries 10 s or more after launch | 10 trades, 40% won, +34% on average |
| Signals at entry that predicted the outcome | none (every rank correlation under 0.13) |

**Lesson:** exit rules only reduce the losses. Every exit ladder modelled on this record
still lost money. Any profit has to come from choosing what to buy, and bigger tickets in
thin markets lose more because the buy itself moves the price.

## 2. The Claude Co desk: 132 graded calls, 20 live trades

Source: Claude-Company commit `5966ad6` (#29), 2026-09-16.

| | |
|---|---|
| 132 closed calls | 43% won, +0.4% on average on paper, median −4.3%. No edge |
| First 20 live trades | 2 won, **−1.15 SOL**. Each trade did 3.2 points worse than the desk's paper figure for the same call |
| Calls with a conviction score under 30 | 51 calls, 39% of the record and **all of its loss** |
| Calls with a conviction score of 30 or more | 81 calls, over half won, +2.5% to +8.8% on average |
| Which analysts predicted the next day | technical ρ +0.23 and flow +0.12 did. Narrative (+0.03) and forensics (−0.03) did not |
| Stops | tighter than 8% were hit by ordinary price swings. Wider than 25% lost |

**Lesson:** filter out low-conviction calls, trust price action and flow over the story,
and expect real fills to come in worse than paper.

## 3. Published results for AI trading models

A research pass on 2026-09-25. Unaudited sources are marked.

- **StockBench** (arXiv 2510.02209, 2025), a benchmark built so the models could not have
  seen the test data: most LLM agents *did not beat buy-and-hold*, and scores on finance
  quizzes did not predict trading results.
- **Nof1 Alpha Arena, season 1** (Oct–Nov 2025): each model got $10k of real money to trade
  leveraged perpetuals on Hyperliquid. Only 2 of 6 made money: Qwen3 Max +22% and DeepSeek
  +5%. The others lost between 31% and 63%. These are press figures and were not audited.
  Commentary says the winners traded less and paid less in fees. With six entrants over
  two weeks, the ranking is luck as much as skill.
- **CLQT** (arXiv 2606.29771, 2026) found that results which leave out trading costs
  overstate how well LLM agents do.
- **pump.fun wallets** (Dune data via Cointelegraph; CoinGecko Research): 99.6% of wallets
  never realised more than $10k. Profitable months usually had fewer than half of wallets
  in profit.
- **CoinMarketCap** has announced agent infrastructure (Agent Hub, an MCP data feed) and
  published no performance figures.

**No model online has shown, with audited results, that it is reliably profitable.**
The honest comparison for CoinMarketCat is buy-and-hold, not another bot's headline.

## 4. How cat coins themselves have performed

CoinMarketCat trades cat coins only, so these are the markets it trades in. The figures are
daily closes from each coin's most liquid GeckoTerminal pool, up to the close on 2026-09-24.
The one-year window starts on 2025-09-27, because GeckoTerminal's free API serves about a
year of history. KITTY's data starts on 2025-10-02, when its pool was created.

CoinGecko's daily series was not used for prices. From January to March 2026 it sat up to
+132% above the on-chain pool prices for MEW and POPCAT; POPCAT's USDC pool matched its SOL
pool on those days. CoinGecko supplied only the all-time highs.

"vs SOL" means the return measured in SOL.

| Coin | 90 days | 1 year | 1 year vs SOL | Volatility (1 year) | Worst drop in the year | Below all-time high | Liquidity (2026-09-25) |
|---|---|---|---|---|---|---|---|
| MEW | +34.9% | −81.0% | −66.8% | 91% | −89.0% | −96.1% | $10.6M |
| POPCAT | +25.7% | −74.0% | −54.7% | 107% | −84.3% | −97.2% | $5.0M |
| KITTY | +1,598% | +40.8% (from 2025-10-02) | +182.6% | 357% | −98.2% | −60.9% (its pool's own high) | $221k |
| GRUMPY | +15.4% | −87.6% | −78.3% | 157% | −95.5% | −99.7% | $29k |
| KWIF | +34.9% | +82.3% | +218.1% | 299% | −80.2% | −94.5% | $42k |
| KHAI | +45.2% | −90.9% | −84.1% | 176% | −96.4% | −99.9% | $23k |
| *SOL* | +63.0% | −42.7% | – | 69% | −73.5% | −59.7% | – |
| *BONK* | −10.0% | −80.2% | −65.5% | 102% | −89.8% | −93.6% | $5.6M |
| *WIF* | +52.5% | −68.2% | −44.5% | 109% | −83.3% | −95.1% | $7.0M |

**What the figures show:**

- **Holding MEW and POPCAT half each lost 77.5% over the year.** SOL lost 42.7% over the
  same year. Over the last 90 days the pair made +30.3% while SOL made +63.0%.
- **Every cat coin fell 80–98% at some point in the year.** SOL's worst fall was 73.5%.
  Five of the six are 94–99.9% below their all-time highs.
- **Only KITTY and KWIF beat SOL over the year, each on one burst.** KWIF rose 726% on one
  day, 2026-02-06, on $72k of pool volume. KITTY rose 173% on 2026-07-02.
- **The small cat coins swing 2–5 times as much as SOL.** KHAI traded $184 in a day, so its
  daily moves come from very little trading.
- **Big falls hit together.** MEW, POPCAT, BONK and WIF all had their worst day on
  2025-10-10, falling 25–34%. Holding several cat coins does not spread the risk much.

**What this means for CoinMarketCat:** simply holding cat coins lost most of its value over
the past year, and a buy-and-hold comparison against cat coins is a low bar in a falling
market. Report the result in SOL terms as well as in dollars, and keep the stop loss and the
daily drawdown breaker on.

## 5. How often a new cat coin reaches each market cap

Measured on pump.fun on 24–25 Sep 2026. Launches in pump.fun's "Mayhem mode" (about a third
of launches) are left out: in 578 of 585 we read, the market cap shown was not backed by the
SOL the curve held. A coin starts at about $3.3k and graduates from pump.fun's curve at about
411 SOL (about $49k at the time).

| Peak market cap | Cat coins | Other coins | From |
|---|---|---|---|
| $10k | 13% (7 of 53) | 9.5% | every launch, 09:40–11:16 UTC on 25 Sep, peak read at 1 hour |
| $20k | 9% (5 of 53) | 5.9% | same |
| $50k (about graduation) | 2.4% (about 1 in 42) | 3.6% | every coin that graduated from the 34,405 launches in the 24 hours to 10:35 UTC on 25 Sep |
| $100k | 1.8% (about 1 in 55) | 2.7% | same |
| $500k | 0.7% (about 1 in 145) | 1.7% | same |
| $1M | 0.3% (about 1 in 320) | 0.9% | same |
| $10M | about 1 in 50,000–100,000 | about 1 in 100,000 (Aug 2024) | known pump.fun cat coins' all-time highs over the estimated number of cat launches since Jan 2024 |
| $100M | about 1 in 180,000–370,000 | – | same |
| $1B | none born on pump.fun | at least 3 (Fartcoin, PNUT, GOAT) | same |

- **Cat coins are not luckier than other coins.** At $10k–$20k they look slightly ahead,
  but on 7 and 5 coins, three of them one ticker relaunched five times. Counting each
  wallet's first launch only, cats and other coins are level (14.6% against 14.1% at $10k).
  From $50k up, cats reached each level 0.35–0.7 times as often as other coins; the gap is
  larger than chance only at $500k and $1M.
- **Most big peaks lasted seconds.** Of the 29 cat coins that reached $100k, 25 filled their
  curve within their first minute, and 24 of the 29 were back near $2–3k when read.
- **Today's market is unusually easy.** pump.fun's graduation rate was about 2.8% in August
  2026, against about 0.6% in September 2025 (The Block).
- **What these figures leave out:** one day and one launchpad; few cat coins at each level;
  a word-based cat detector that misses cats with other names (MOG, TOSHI). The $10M and
  $100M odds rest on an estimated count of cat launches.

## What changed in CoinMarketCat

| Lesson | Change | Where |
|---|---|---|
| Low-conviction calls were all of the desk's loss | New limit **Least confidence for a buy** (default 0.6, 0 turns it off). A buy the model rates lower is refused at `below_min_confidence`. A sell never is | `agent-strategy.mjs`, `agent-risk.mjs` |
| Most agents do not beat holding | **vs buy and hold**: the agent's return since it started, set beside the same vault split equally across its tokens and never traded. The model sees it, and the popup shows it | `agent-runner.mjs`, popup |
| Trade rarely, friction is real, trust technicals and flow, don't chase, stay small in thin markets | The model is told these facts, with their numbers, in every system prompt | `agent-brain.mjs` (`AGENT_LESSONS`) |

What was already in place: a stop loss (8% by default, inside the band that worked for the
desk), 6 trades a day, a 2% price-impact cap on buys, and paper trading first.

**Not changed, and why:**

- **HAWK-AI's stall exit and time stop.** They were measured on launches that must move
  within seconds. CoinMarketCat trades established cat coins, not new launches, on a 15
  to 60 minute schedule.
- **The 0.6 confidence floor is not calibrated.** The model's 0–1 confidence is a different
  number from the desk's conviction score. The journal records the confidence of every buy,
  so the floor can be graded once there is a record.

## How to use this on X

Post only what the journal and the popup show:

- each decision with its reason and its fill;
- losses as well as wins;
- the **vs buy and hold** line;
- whether the trade was **paper** or **live**.

A claim that "it works" means beating that line over months, net of fees. A good week is
not proof.

## 26 Sep 2026: the 24-hour cohort read did not happen

**Method.** A read-only recorder polled pump.fun's public API
(`frontend-api-v3.pump.fun`: the newest-first `/coins` listing, then `/coins/{mint}`). It
logged every launch it saw. It re-read `ath_market_cap` at ages 1 h, 6 h and 24 h for three
groups: every cat coin, a fixed 10% hashed control sample of non-cats, and a 20% hashed
sample of all launches. A coin counts as a cat when the repo's `detectCat` matches its name
or ticker. The control group is the non-cats in the 10% sample (hashed on mint). Mayhem-mode
launches are left out. Peaks were checked with validation rule R1:
ath ≤ 1.02 × the highest pump.fun 1-minute candle high × 1e9 supply, using candles up to
the time of the read. A coin that fails R1 is counted at its candle peak instead.

**What was recorded.** The recorder ran from 10:31 UTC on 25 Sep. It backfilled launches
from about 09:40 UTC. Its last log line is at 22:22 UTC on 25 Sep. The environment then
restarted, and the recorder was not running on 26 Sep. That left 20,146 launches logged,
18,503 1-hour reads and 3,218 6-hour reads. **No 24-hour read was taken.** The earliest one
was due at about 09:40 UTC on 26 Sep, eleven hours after the recorder stopped.

| Peak market cap | Cats at 24 h | Controls at 24 h | Cats at 6 h (normal launches) | Controls at 6 h (normal launches) |
|---|---|---|---|---|
| Coins read | 0 | 0 | 31 | 62 |
| $10k | – | – | 7 (22.6%) | 5 (8.1%) |
| $20k | – | – | 5 (16.1%) | 5 (8.1%) |
| $50k | – | – | 4 (12.9%) | 2 (3.2%) |
| $100k | – | – | 3 (9.7%) | 2 (3.2%) |
| $200k | – | – | 3 (9.7%) | 2 (3.2%) |
| $500k | – | – | 1 (3.2%) | 2 (3.2%) |
| $1M | – | – | 1 (3.2%) | 2 (3.2%) |

The 6-hour columns are from the snapshot analysed at 16:45 UTC on 25 Sep. They cover
launches from 09:40 to 10:40 UTC. They come from a different read and are not a stand-in for
the 24-hour result.

- **There is no 24-hour result.** No 24-hour funnel exists for cats or controls.
- **The 6-hour gap is not reliable.** Cats lead at $10k–$100k, but on only 31 cat coins.
  Three of the 7 cats that reached $10k are one ticker (GTAK) relaunched. Every confidence
  interval overlaps the controls.
- **Across the 414 coins read at both 1 h and 6 h, no peak of $10k or more grew by more than
  5% after the first hour.** So a 24-hour read would probably change little for these coins.
  That was measured on one hour of launches.
- **Lesson for the recorder:** it runs as an unsupervised process, and a restart ends it
  without any warning. A later run needs a supervisor or a resume step. It also needs a
  check that the 24-hour reads are arriving.
