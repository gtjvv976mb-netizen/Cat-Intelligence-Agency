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
