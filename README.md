# Capitol-Gains

> *If Congress is trading it, maybe you should be too.*

Capitol-Gains is a self-hosted market intelligence and automated trading system that cross-references congressional stock disclosures with Reddit sentiment to surface asymmetric trade ideas — and then acts on them automatically. This document covers the theory, data pipeline, scoring model, execution layer, and an ongoing empirical study of the system's performance.

> **Coverage:** All STOCK Act disclosures from every filing member of Congress, plus full trade histories for 194 actively trading members.

**Live dashboard:** [https://kgollins.github.io/Capitol-Gains/](https://kgollins.github.io/Capitol-Gains/)

---

## Table of Contents

1. [Theoretical Foundation](#1-theoretical-foundation)
2. [Data Collection](#2-data-collection)
3. [Signal Generation](#3-signal-generation)
4. [Trust & Manipulation Detection](#4-trust--manipulation-detection)
5. [Execution Layer](#5-execution-layer)
6. [Empirical Study](#6-empirical-study)
7. [Stack](#7-stack)
8. [Disclaimer](#disclaimer)

---

## 1. Theoretical Foundation

### The Disclosure Lag Hypothesis

The STOCK Act (2012) requires members of Congress to disclose stock trades within 30–45 calendar days of execution. This creates a structural timing problem: by the time a disclosure is public, the underlying trade may be six weeks old. Prior academic work (Ziobrowski et al., 2004; 2011) found evidence of abnormal returns in congressional portfolios consistent with information advantages — the Senate study estimated approximately +8.5% annual abnormal return relative to a market benchmark, the House study approximately +6%, both using a calendar-time portfolio methodology with multi-factor risk adjustment.

Three caveats from that literature apply directly here. First, those sample periods (1993–2004) predate the STOCK Act; the passage of the Act was partly a policy response to those findings, and post-STOCK Act outperformance is likely reduced. Second, Eggers & Hainmueller (2013) challenged the Senate result, finding that outperformance was concentrated in a small number of members and partially explained by home-state industry exposure — structural, not privileged, information. Third, the 194 "actively trading" politicians tracked here are identified using the complete historical record, introducing a look-ahead selection bias that a live system in 2012 could not have replicated.

Our central hypothesis is that congressional trade disclosures retain predictive signal even net of the disclosure lag — and that combining them with retail sentiment as a contrarian indicator surfaces setups where the informed/uninformed divergence is widest.

**A note on the observation problem.** The backtest uses `transaction_date` for 158 of 173 analyzed trades because `disclosure_date` was available for only 15. A live trader cannot observe `transaction_date` until the disclosure arrives, 30–45 days later. The 30- and 60-day returns measured from `transaction_date` therefore largely capture price movement that occurred before any public disclosure was available. The 90-day horizon is the most meaningful figure: it spans far enough forward that a significant portion of the return window falls after a realistic observation date. All performance figures in §6.1 should be interpreted with this in mind.

### The Two-Source Framework

We decompose market information into two independent sources:

- **Informed flow** — congressional trades, assumed to reflect structural information advantages
- **Crowd sentiment** — Reddit investing communities, assumed to reflect retail consensus and its well-documented biases

The divergence between these two sources is more informative than either alone. When they agree, the signal is confirmatory but potentially late. When they disagree, the gap between smart money and crowd consensus creates the most actionable setup.

---

## 2. Data Collection

A Raspberry Pi collects data four times daily (8:30am, 11am, 2pm, and 10pm Central) across three source categories:

| Source | What is captured | Update frequency |
|---|---|---|
| **CapitolTrades.com** (main feed) | All recent STOCK Act disclosures across every filing member | 4× daily |
| **CapitolTrades.com** (individual profiles) | Full trade history for 194 actively trading members | 4× daily |
| **House/Senate Stock Watcher APIs** | Bulk fallback covering all 535 members if the primary source is unavailable | On failure |
| **Reddit** | Ticker mentions and sentiment from 11 subreddits: r/wallstreetbets, r/stocks, r/investing, r/stockmarket, r/options, r/SecurityAnalysis, r/ValueInvesting, r/Dividends, r/thetagang, r/biotech, r/ETFs | 4× daily |
| **News RSS** | Headlines from 16 sources: Bloomberg, WSJ, FT, The Economist (×2), Reuters, CNBC, AP Business, Barron's, Benzinga, MarketWatch, Seeking Alpha, Motley Fool, Yahoo Finance, Google News, HBR | 4× daily |

The 194 individually tracked politicians are those with active trading histories on CapitolTrades. The remaining ~341 members either file no disclosures, hold only index funds, or trade through blind trusts — but any disclosures they do file are still captured through the main feed.

All data is stored in a SQLite database (`market_intel.db`) and synced to a Windows analysis machine via Samba share.

### Politician Trade Schema

| Field | Type | Notes |
|---|---|---|
| `politician` | string | Full name as reported on the disclosure |
| `ticker` | string | Equity ticker symbol |
| `transaction_type` | enum | `buy` or `sell` |
| `transaction_date` | date | Date the trade actually occurred (30–45 day lag from filing) |
| `disclosure_date` | date | Date STOCK Act filing was submitted |
| `amount_range` | string | Raw range string, e.g. `"$15,001–$50,000"` |
| `amount_midpoint` | float | Numeric midpoint of the range; used as trade size weight $v_i$ in the politician score |
| `traded_by` | enum | `self`, `spouse`, `child`, `blind_trust` |
| `committee` | string | Committee membership at time of trade, if known |
| `committee_relevant` | bool | `true` if the committee aligns with the ticker's sector; activates the 1.2× committee boost |

Records are keyed on `(politician, ticker, transaction_date, transaction_type)` — re-scraped filings for the same trade do not produce duplicates.

### Reddit Article Schema

One row is written per article or post. If a post mentions three tickers, it contributes to all three tickers' aggregated signals but occupies one row in the database, with all mentioned tickers stored in `ticker_mentions`.

| Field | Type | Notes |
|---|---|---|
| `source` | string | Subreddit name, e.g. `r/wallstreetbets` |
| `timestamp` | datetime | UTC post time |
| `ticker_mentions` | string[] | All tickers detected via regex and dictionary lookup |
| `sentiment` | enum | `bullish`, `bearish`, or `neutral` — label assigned by the collector |
| `sentiment_score` | float | Numeric encoding of sentiment, intensity-adjusted; range [-1, +1]. Derived from the label; not redundant with it. |
| `reasoning_score` | float | Heuristic quality score [0, 1] across five dimensions — see §3.2 |

---

## 3. Signal Generation

Signals are computed per-ticker from four sub-scores, combined into a base composite, then adjusted by three named strategy overlays.

### 3.1 Sub-Component Scores

Four sub-scores are computed per ticker over a configurable lookback window $d$ (default 14 days):

#### Sentiment Score $S_{sent}$

Sentiment is quality-weighted by post reasoning score $q_i \in [0, 1]$, so that a well-reasoned research post influences the score more than a meme post. The weight assigned to post $i$ is $(0.2 + 0.8 \cdot q_i)$, producing a floor of 0.2 (every post contributes something) and a ceiling of 1.0 at maximum quality. The ratio between them is exactly 5: a high-quality post is weighted five times more heavily than a low-quality one.

The quality-weighted sentiment score is the weighted mean of individual post scores $s_i \in [-1, +1]$:

$$S_{sent} = \frac{\displaystyle\sum_i s_i \cdot (0.2 + 0.8 \cdot q_i)}{\displaystyle\sum_i (0.2 + 0.8 \cdot q_i)} \in [-1, +1]$$

The range $[-1, +1]$ is guaranteed because $S_{sent}$ is a weighted average of the $s_i$ values — all weights are positive and the denominator is their sum.

#### Momentum Score $S_{mom}$

Momentum captures whether attention to a ticker is accelerating or fading. Let $r_{recent}$ be the average daily mention rate over the current lookback window and $r_{base}$ be the average daily rate over the prior three days. The ratio $r_{recent}/r_{base}$ measures how much faster (or slower) chatter is arriving now. Subtracting 1 centers the scale so that 0 means no change, positive means acceleration, and negative means deceleration. The `clip` prevents outlier ratios from dominating:

$$S_{mom} = \max\!\left(-1,\;\min\!\left(+1,\;\frac{r_{recent}}{r_{base}} - 1\right)\right)$$

*Example:* $r_{recent} = 15$ mentions/day, $r_{base} = 10$ mentions/day → $S_{mom} = \max(-1, \min(1, 0.5)) = 0.5$.

When the concurrent sentiment score $S_{sent} < 0$, the momentum score is sign-flipped before entering the composite: an accelerating spike in bearish chatter is treated as a negative signal, not a positive one. If $r_{base} = 0$ (no prior baseline), $S_{mom} = 0$.

#### Politician Score $S_{pol}$

The politician score measures the aggregate conviction of insider trading disclosures, weighted by four factors: trade size, committee relevance, disclosure freshness, and ownership type. A raw count of buys vs. sells would overweight frequent small trades and ignore that a senator on the Armed Services Committee buying a defense contractor carries more information than a routine trade.

**Step 1 — Compute the weight for each trade.** For trade $i$, the weight $w_i$ is a product of four independent factors:

$$w_i = \underbrace{\frac{\log_{10}(\max(v_i, 1))}{\log_{10}(5{,}000{,}000)}}_{\text{(a) size}} \;\times\; \underbrace{(1.0 + 0.2 \cdot c_i)}_{\text{(b) committee}} \;\times\; \underbrace{\max\!\left(0.2,\; 1 - \frac{\delta_i}{90}\right)}_{\text{(c) freshness}} \;\times\; \underbrace{\beta_i}_{\text{(d) ownership}}$$

**(a) Size** — Log-scales the trade midpoint value $v_i$ (in USD) against a $5M reference, so that larger trades carry more weight but not proportionally more:

| Disclosed value $v_i$ | Size weight |
|---|---|
| $1,000 | 0.45 |
| $50,000 | 0.78 |
| $1,000,000 | 0.90 |
| $5,000,000 | 1.00 (reference point) |

Trades above $5M produce a size weight above 1.0 — no explicit cap is applied in the formula.

**(b) Committee boost** — $c_i \in [0, 1]$ measures how closely the politician's committee assignments align with the ticker's industry sector. The multiplier ranges from $1.0$ (no relevant committee) to $1.2$ (full alignment). An earlier version used a 1.5× boost; it was reduced to 1.2× after backtest analysis showed large trades *underperforming*, suggesting committee-adjacent trades were not carrying additional predictive signal.

**(c) Freshness** — $\delta_i$ is days elapsed since disclosure. Weight decays linearly from 1.0 at disclosure to a floor of 0.2 at 72 days, then holds flat:

| Days since disclosure | Freshness weight |
|---|---|
| 0 | 1.00 |
| 45 | 0.50 |
| 72 | 0.20 (floor) |
| 90+ | 0.20 |

**(d) Ownership** — Discounts trades executed at arm's length from the politician:

| Ownership type | $\beta_i$ |
|---|---|
| Self (direct) | 1.0 |
| Spouse | 0.6 |
| Dependent child | 0.4 |
| Blind trust | 0.1 |

**Worked example:** A senator on the Energy Committee ($c_i = 0.8$) self-discloses a $250,000 buy in an oil company 30 days ago:

- Size: $\log_{10}(250{,}000) / \log_{10}(5{,}000{,}000) = 5.398 / 6.699 \approx 0.806$
- Committee: $1.0 + 0.2 \times 0.8 = 1.16$
- Freshness: $\max(0.2,\; 1 - 30/90) = 0.667$
- Ownership: $1.0$ (self)
- **Combined:** $0.806 \times 1.16 \times 0.667 \times 1.0 \approx 0.624$

**Step 2 — Compute the net buy ratio** across all trades for the ticker in the lookback window:

$$S_{pol} = \frac{\displaystyle\sum_{i \in \text{buys}} w_i \;-\; \displaystyle\sum_{i \in \text{sells}} w_i}{\displaystyle\sum_{i} w_i} \in [-1, +1]$$

The range $[-1, +1]$ is guaranteed: the numerator is bounded in magnitude by the denominator (total weight).

#### Breadth Score $S_{brd}$

Breadth measures how many distinct platforms are discussing the ticker. Coverage concentrated on a single source is a mild red flag for coordinated promotion. Let $N_{sources}$ be the count of distinct platforms with at least one mention in the lookback window:

$$S_{brd} = \min\!\left(1.0,\; \frac{N_{sources} - 2}{3}\right)$$

The formula is calibrated so that $N_{sources} = 5$ reaches the ceiling of $1.0$ and $N_{sources} = 2$ produces $0.0$ (neutral). Source counts above 5 are capped.

| $N_{sources}$ | $S_{brd}$ | Interpretation |
|---|---|---|
| 1 | $-0.33$ | Single-source — mild pump penalty |
| 2 | $0.00$ | Neutral |
| 3 | $+0.33$ | Moderate breadth |
| 4 | $+0.67$ | Good breadth |
| $\geq 5$ | $+1.00$ | Full breadth |

The practical range is $[-0.33, +1]$ — reaching $-0.67$ would require $N_{sources} = 0$, which cannot occur.

### 3.2 Reasoning Quality Score

Each Reddit post is scored on five heuristic dimensions, each ranging from 0 to 1, averaged to produce a quality score $q \in [0, 1]$:

| Dimension | What it measures |
|---|---|
| **Thesis clarity** | Structured argument, directional claim, multi-paragraph development |
| **Risk acknowledgment** | Explicit downside or bear-case language |
| **Data quality** | Financial terms (P/E, EPS, margins) and concrete numbers ($, %, ×) |
| **Specificity** | Timeframes, catalysts, price targets |
| **Original thinking** | Penalizes meme phrases and rocket emoji; rewards "my analysis" framing |

Distribution across 11,900 scored articles: 2.3% high ($q \geq 0.55$), 14% moderate, 84% low ($q < 0.25$). The weighting floor in $S_{sent}$ ensures the predominant low-quality tail still contributes to the signal — at reduced influence.

### 3.3 Base Composite Score

The four sub-scores are combined as a weighted sum with a cap-tier penalty adjustment:

$$C_{base} = 0.30 \cdot S_{sent} + 0.25 \cdot S_{mom} + 0.30 \cdot S_{pol} + 0.15 \cdot S_{brd} + \kappa_{cap}$$

The weights sum to 1.0. Sentiment and politician flow are weighted equally (0.30 each) as the strongest predictors; momentum is secondary (0.25); breadth is a minor modifier (0.15).

The term $\kappa_{cap}$ is a cap-tier penalty that accounts for elevated pump risk in smaller tickers:

| Market cap tier | $\kappa_{cap}$ |
|---|---|
| Mid/large/mega cap | $0$ |
| Small cap | $-0.10$ |
| Micro cap | $-0.15$ |

### 3.4 Strategy Overlays

Three named strategies produce additive overlay scores on top of the base composite, each isolating a distinct market dynamic:

#### S1 — Smart Money Divergence (weight 40%)

Fires when politicians are positioned opposite to the Reddit crowd — buying while the crowd is bearish, or selling while the crowd is bullish:

$$D_{S1} = S_{pol} \cdot (-S_{sent}) \cdot \min\!\left(1, \frac{N_{mentions}}{5}\right)$$

The term $-S_{sent}$ converts crowd bearishness into a positive signal when $S_{pol} > 0$. The final factor is a mention-volume confidence weight: the overlay is dampened below 5 mentions, where a single post can drive apparent sentiment, and reaches full weight at 5 or more. (This is a mention-count scale, not the same as the source-diversity breadth score $S_{brd}$.)

#### S2 — Politician Flow Momentum (weight 35%)

Detects a reversal in politician positioning from one 90-day window to the next. For a given window, define the net buy ratio $\rho = (B - S)/(B + S)$, where $B$ is buy count and $S$ is sell count. The overlay score is:

$$D_{S2} = (\rho_{current} - \rho_{prev}) \cdot \min\!\left(1,\; \frac{N_{pols}}{2}\right)$$

Here $N_{pols}$ is the number of distinct politicians active in the current window. Full weight requires at least two politicians; a single-politician flip is given half weight.

The "current" window spans the past 90 days; the "previous" window spans 180–90 days ago. In practice, $\rho_{prev}$ is computed from raw trade counts while $\rho_{current}$ uses the size- and freshness-weighted politician score — an asymmetry that makes the signal most sensitive to tickers where a single large recent trade dominates. Tickers where S2 is the primary driver should be cross-checked against the raw trade log.

#### S3 — Contrarian Fade (weight 25%)

Fires when Reddit sentiment is extreme but politicians have no strong directional position in the same ticker. Outside the stated condition, $D_{S3} = 0$.

$$D_{S3} = -S_{sent} \cdot \min\!\left(1,\; \frac{N_{mentions}}{5}\right) \cdot (1 - |S_{pol}|) \quad \text{when } |S_{sent}| > 0.20 \text{ and } N_{pol\_trades} > 0$$

The term $(1 - |S_{pol}|)$ approaches zero when politicians have a strong position in either direction, and approaches one when they are absent or neutral. This strategy is best understood as "fade the crowd when smart money is on the sidelines" — it fires on politician *absence*, not active opposition.

The guard $N_{pol\_trades} > 0$ requires at least one politician trade in the dataset for this ticker, preventing tickers with zero politician coverage from generating spurious fade signals based on Reddit alone. (Note: $N_{pol\_trades}$ counts individual trade disclosures; $N_{pols}$ in S2 counts unique politicians — these are different quantities.)

#### Final Composite

The three overlays are blended with fixed weights summing to 1.0, then scaled by 0.5 before being added to the base composite. The 0.5 scalar prevents the overlays from overwhelming the base signal:

$$C = C_{base} + 0.5 \cdot (0.40 \cdot D_{S1} + 0.35 \cdot D_{S2} + 0.25 \cdot D_{S3})$$

The overlay weights reflect decreasing confidence in each strategy's signal strength: S1 has the most empirical support, S2 is second, and S3 is the most condition-dependent.

Action labels are assigned by threshold:

| Score | Label |
|---|---|
| $C > 0.25$ | **S.BUY** |
| $0.10 < C \leq 0.25$ | BUY |
| $-0.10 \leq C \leq 0.10$ | HOLD |
| $-0.25 \leq C < -0.10$ | SELL |
| $C < -0.25$ | **S.SELL** |

---

## 4. Trust & Manipulation Detection

Not all signals are equally reliable. Every ticker is assigned a trust score $T \in [0, 100]$ that estimates the likelihood the Reddit signal reflects genuine sentiment rather than coordinated promotion. It is derived from five sub-signals:

| Sub-signal | Weight | What it detects |
|---|---|---|
| Account Quality | 27% | % of bullish mentions from new or low-karma accounts |
| Sentiment Balance | 22% | Suspiciously one-sided sentiment (>85% bullish) |
| Price-Chatter Alignment | 18% | Chatter spike without price confirmation — a classic pump pattern |
| Reasoning Quality | 18% | Low-quality hype without analytical substance |
| Bias Concentration | 15% | FOMO and overconfidence language clustering |

The reasoning sub-signal uses the *lower* of the overall average reasoning score and the bullish-post-specific average. This catches cases where the broader discussion looks reasonable but the bullish posts themselves lack substance.

Trust adjusts the composite score according to three regimes:

$$C_{adj} = \begin{cases} C & T \geq 60 \\ C \cdot \dfrac{T}{100} & 40 \leq T < 60 \\ \text{(ignored)} & T < 40 \end{cases}$$

- **$T \geq 60$:** Signal accepted at face value.
- **$40 \leq T < 60$:** Score scaled linearly. At $T = 50$ the score is halved; at $T = 40$ it is reduced to 40% of its raw value.
- **$T < 40$:** Ticker excluded from analysis regardless of composite score.

Note: there is an intentional discontinuity at $T = 60$. A score of 59 applies the discount formula (yielding $0.59C$) while a score of 60 applies no discount at all. This binary "trusted enough" threshold is by design.

Separately, each ticker is assigned a crowd stage label based on its post language profile: **MANIC** (≥20% of posts show FOMO or overconfidence language), **DISTRESSED** (≥20% show loss-aversion or sunk-cost language), or **NORMAL**. These labels appear in the dashboard as **PUMP** and **DIST** badges and feed into the trust score but do not directly block trades.

---

## 5. Execution Layer

The execution layer translates signals into orders through Alpaca's API. Collection and trading are intentionally separated: the collection pipeline writes signals to the database on its own schedule; an independent trade loop reads those signals every 5 minutes during market hours. This means a Pi reboot or collection failure never directly interrupts an open position.

### 5.1 Architecture

The two processes share no direct connection. The SQLite database is the only interface between them.

```
COLLECTION SIDE (4× daily)              SHARED STATE (SQLite DB)
────────────────────────────────        ─────────────────────────────────
8:30am, 11am, 2pm, 10pm CT
                                        articles
collect()                               politician_trades
  ├─ CapitolTrades scraper     ──────▶  reddit_mentions
  ├─ Reddit collector
  └─ RSS news collector                 ▼

generate_report()              ──────▶  signal_history
  └─ scores all tickers                 pending_tranches
                                        position_state
push_dashboard()
  └─ injects signals into HTML                   ▼
     → GitHub Pages
                                TRADE LOOP SIDE (every 5 min, 9:35–3:55 ET)
Does NOT trade.                 ─────────────────────────────────────────────

                                read signal_history  ◀── check freshness + trust
                                enforce ATR stops    ──▶ write position_state
                                manage trailing stops
                                partial profit-taking
                                new entries          ──▶ write pending_tranches
                                                         submit orders → Alpaca
```

### 5.2 Entry Logic

New positions require all of the following:

1. $C \geq 0.25$ (S.BUY) with $T \geq 60$
2. **Signal persistence** — the ticker must hold S.BUY across consecutive collection cycles. Each cycle is approximately 2.5–4 hours.

| Tier | Consecutive S.BUY cycles required | Applied when |
|---|---|---|
| **IMMEDIATE** | 1 cycle | Trust ≥ 80 and composite ≥ 0.40 |
| **STANDARD** | 2 cycles (~4–8 hours) | Default for most S.BUY signals |
| **PATIENT** | 3 cycles (~8–16 hours) | Trust 60–70 or composite near the 0.25 threshold |

Persistence resets to zero if the signal drops below S.BUY in any cycle — a signal that oscillates across the threshold does not accumulate across the gap.

3. Not in stop cooldown (blocked ~8 hours after a stop-loss exit on the same ticker)
4. RSI gate: blocked if RSI > 70; half-sized if RSI > 65
5. Not in the first 30 minutes or last 15 minutes of the market session

Capital is deployed in two tranches:

- **Tranche 1:** 60% of the allocation at a limit order (0.1–0.5% below ask, scaled to conviction)
- **Tranche 2:** Remaining 40%, triggered by whichever arrives first: a 2% pullback or one additional signal persistence cycle

Portfolio constraints: max 40 positions, 80% deployed (40% in risk-off mode), 5% per position, $5,000 cash reserve, cap of 3 new entries per day.

### 5.3 Stop-Loss Sizing

Stop distance is ATR-based and scaled by market cap tier, giving smaller and more volatile stocks more room to breathe:

$$\text{stop} = P_{entry} \times \left(1 - \max\!\left(3\%,\;\min\!\left(15\%,\;\text{ATR\%} \times m_{cap}\right)\right)\right)$$

The `clip` enforces a 3% floor (stops are never so tight that normal intraday noise triggers them) and a 15% ceiling (no position held through more than a 15% drawdown).

| Cap tier | Multiplier $m_{cap}$ | Rationale |
|---|---|---|
| Mega | 1.5× | Lower volatility; tighter stops appropriate |
| Large | 2.0× | |
| Mid | 2.5× | |
| Small / Micro | 3.0× | Higher volatility; stops need room to breathe |

*Example:* $P_{entry} = \$100$, ATR% = 4%, mega cap ($m_{cap} = 1.5$): raw margin = 6%, stop = $\$94$.

When ATR data is unavailable, an 8% flat stop is used as a fallback. ATR is sourced from Alpaca's IEX daily bar feed, replacing an earlier yfinance dependency that was unreliable on the Pi.

Stop orders are enforced both in code (polled every 5 minutes) and as server-side Alpaca stop orders. The server-side layer fires in real time even if the Pi goes offline — a second line of defense independent of the trade loop.

### 5.4 Trailing Stops & Profit-Taking

Once a position gains $\geq 1 \times \text{ATR}$ above entry, a trailing stop is activated at $1.5 \times \text{ATR}$ trail distance. Partial profit-taking fires at discrete ATR multiples:

| Trigger | Action |
|---|---|
| $+2 \times \text{ATR}$ | Sell 33% of position |
| $+4 \times \text{ATR}$ | Sell another 33% |

### 5.5 Exit Logic

A position exits on any of four conditions:

1. **Stop-loss** — price breaches the ATR-based stop (server-side or code-side)
2. **Time-based** — held 14 days with less than 2% gain and a weakening signal; or underwater for 7 days below the S.BUY threshold
3. **Signal exit** — composite drops below S.BUY and a grace period of 2 collection cycles expires
4. **Price-aware discount** — if a position is down more than 5% for more than 5 days, the effective composite is penalized by $\min(|P\&L|,\; 0.30)$, allowing time-based exits to fire even when the raw signal remains strong

### 5.6 Portfolio Risk Management

- **Drawdown circuit breaker:** New entries are paused if the portfolio drops more than 10% from its peak, and resume once it recovers to within 5%.
- **Sector cap:** Maximum 3 positions per sector at any time.
- **Risk-off mode:** When `weekly_picks.json` sets `risk_off=true`, maximum deployment drops to 40% and sector vetoes are enforced.
- **Stop cooldown:** After a stop-loss exit, the ticker is blocked from re-entry for approximately 8 hours (~4 collection cycles), preventing stop-sell-rebuy churn without disabling the stop mechanism itself.

---

## 6. Empirical Study

This section documents what the system has done in practice, what broke, what was fixed, and what is being studied next.

### 6.1 Backtest Results (Run 1 — March 2026)

**Data:** 173 politician trades across 71 tickers. Transaction date used as the signal observation date for 158 trades; disclosure date available for only 15.

**Look-ahead bias:** Transaction date is not observable in real time — a live trader cannot see it until the disclosure arrives, 30–45 days later. Returns measured from transaction date at the 30- and 60-day horizons therefore largely capture price movement that occurred *before* any public disclosure was available. The 90-day horizon is the most meaningful, as it begins to overlap with the post-disclosure observation window.

| Horizon | Avg Return | Excess Return vs SPY | Win Rate |
|---|---|---|---|
| 30 days | +2.64% | +0.24% | 65.9% |
| 60 days | +3.91% | +0.05% | 60.1% |
| 90 days | +6.51% | +1.29% | 61.8% |

"Excess Return vs SPY" is the simple difference in holding-period returns (ticker minus SPY over the same window) — not risk-adjusted alpha, and not controlling for beta, size, or momentum exposures. "Win rate" is the fraction of trades where the ticker produced a positive *absolute* return — not the fraction that beat SPY.

**Train/test split at May 2025 (~89 train, 84 test trades):**

| Split | 30d Win | 60d Win | 90d Win |
|---|---|---|---|
| Train (pre-May 2025) | 69.7% | 56.2% | 64.0% |
| Test (post-May 2025) | 61.9% | 64.3% | 59.5% |

Win rates are directionally consistent across splits. However, at n=84 the 95% confidence interval on a binomial proportion is approximately ±10 percentage points — the observed differences are within sampling noise. This split provides weak evidence against severe overfitting, not a robust out-of-sample validation. A minimum of 200–300 trades per split, spanning multiple market regimes, would be needed for stronger claims.

**Key anomaly:** Large trades (≥$50K) *underperformed* the full sample by −1.32% excess return at 60 days, directly contradicting the committee-weighting assumption. The committee boost in `report.py` was reduced from 1.5× to 1.2× in response. This finding is based on n=47 large trades — sufficient to flag the direction, not to size the effect precisely.

### 6.2 Live Paper Trading (Run 2 — First 10 Days)

The account started at approximately $97,358 and ended the period at $96,034 (−1.4%), during a risk-off macro environment (Hormuz escalation, Nasdaq correction). Deployment held at 41% against a 40% target — within tolerance. Four issues were identified and resolved:

| Issue | Finding | Resolution |
|---|---|---|
| **Stop churn** | 8 stop-sell-rebuy cycles in 10 days | Added 8-hour stop cooldown |
| **ATR coverage** | Only 2/6 positions had ATR data (yfinance unavailable on Pi) | Switched to Alpaca bars API |
| **Stop latency** | Stops checked only 4×/day; positions breached for hours | Added 5-min trade loop + server-side stop orders |
| **Signal stickiness** | 5 underwater positions (−6% to −9%) maintained S.BUY > 0.65 | Added price-aware score discount |

### 6.3 ML Parameter Optimization Study (Ongoing)

The execution layer contains approximately 20 hardcoded parameters — stop multipliers, composite weights, entry thresholds, trailing activation levels — currently set by intuition and domain knowledge. As live trade data accumulates, a phased optimization program is underway. Risk management parameters (position sizing caps, max deployment, drawdown circuit breaker) are treated as inviolable constraints and excluded from optimization.

**Instrumentation (deployed March 2026):**

- **`trade_outcomes`** — one row per completed round-trip: entry/exit prices, hold duration, realized return, and all sub-scores captured at entry time
- **`daily_mtm`** — daily mark-to-market per open position, with running max adverse excursion (MAE) and max favorable excursion (MFE); used to tune stop distances and trailing thresholds

All parameters are externalized to `params.py`. The Pi reads `tuned_params.json` if present, otherwise falls back to defaults — allowing parameter updates without redeploying code.

**Phase 1 — Sensitivity Analysis** (target: ~4 weeks after instrumentation)

The marginal predictive power of each sub-score is estimated by OLS regression against forward returns:

$$r_{i,\,t+N} = \alpha + \beta_1 S_{sent,i,t} + \beta_2 S_{mom,i,t} + \beta_3 S_{pol,i,t} + \beta_4 S_{brd,i,t} + \varepsilon_{i,t}$$

Here $r_{i,t+N}$ is the $N$-day forward return for ticker $i$ observed at time $t$, and $\beta_1,\ldots,\beta_4$ are the estimated predictive weights. Once fit, these can replace the fixed composite weights with empirically calibrated ones.

Note: signal observations for the same ticker across consecutive collection cycles are serially correlated. Standard errors in this regression should be clustered by ticker rather than treated as independent observations.

Additional Phase 1 analyses: composite calibration curve (score decile vs average forward return), trust threshold validation, lookback window sweep (7/14/21/30 days), and MAE/MFE distributions by cap tier compared against current ATR stop distances.

**Phase 2 — Bayesian Optimization** (target: ~50 completed round-trips)

Optuna (TPE sampler) optimizes 4–6 parameters over expanding walk-forward windows, with Sortino ratio as the objective. An L2 regularization penalty toward current parameter values prevents overfitting to the training sample:

$$\text{objective}(\theta) = \text{Sortino}(\theta) - \lambda \sum_k (\theta_k - \theta_k^0)^2$$

Here $\theta^0$ are the current hand-tuned values, serving as the regularization anchor. The L2 term asks: *how much can we improve risk-adjusted performance by departing from the current weights, penalized by how far we depart?* Parameter movement is additionally capped at ±50% of current values per optimization run, preventing extreme configurations that fit a small, single-regime dataset.

Note: Sortino ratio requires a reliable estimate of downside return deviation. At 50 trades in a single macro regime, this estimate will be noisy. Phase 2 output should be treated as directional until data spans at least two distinct market environments.

**Phase 3 — ML Signal Enhancement** (target: ~100 completed round-trips)

A LightGBM model (initial config: max_depth=3, n_estimators=50 — not yet tuned) is trained to produce a correction factor on composite scores. Features include all sub-scores, trust score, RSI, ATR, signal persistence tier, sector, and days since most recent politician disclosure. The model runs in shadow mode for a minimum of 30 days — predictions logged without influencing any orders.

Activation requires Spearman rank correlation $\rho > 0.1$ between shadow predictions and realized forward returns over at least 50 completed trades. This is a "better than noise" gate, not a quality bar — the primary safety constraint is that the correction is bounded to ±20% of composite magnitude, and cannot flip a signal's direction.

### 6.4 Optimization Guardrails

The following parameters are excluded from optimization — they are survival constraints that define the outer limits within which any optimization must operate, not levers for squeezing out additional return:

| Parameter | Value | Rationale |
|---|---|---|
| `MAX_POSITION_PCT` | 5% | Kelly-optimal sizing at 62% win rate |
| `MAX_DEPLOYED_PCT` | 80% | Cash reserve for opportunities and drawdowns |
| `MAX_DAILY_ENTRIES` | 3 | Circuit breaker, not a performance lever |
| `DRAWDOWN_PAUSE_PCT` | 10% | Ruin prevention |

---

## 7. Stack

| Layer | Technology | Notes |
|---|---|---|
| **Always-on collection** | Raspberry Pi 4, Python 3.9, cron | 4 windows/day: 8:30am, 11am, 2pm, 10pm CT |
| **Database** | SQLite (WAL mode) | WAL enables concurrent reads alongside writes; single writer only. Pi writes; Windows reads over Samba. |
| **Network file sync** | Samba (SMB share) | Pi DB mounted as `Z:` on Windows; analysis machine reads live data with no copy step |
| **Pi deployment** | SSH + SCP via ed25519 key | Scripts updated by `scp` from Windows; service restarted via `ssh pi@192.168.86.27 "sudo systemctl restart market-intel"` |
| **Scoring engine** | Pure Python — `report.py`, `integrity.py`, `reasoning_quality.py` | No ML dependencies; fully deterministic. Runs on Pi at collection time and on Windows for analysis. |
| **Trade execution** | `alpaca-py` SDK | Paper/live toggled by `ALPACA_PAPER` flag. Submits both code-side stop checks (5-min loop) and server-side Alpaca stop orders for redundancy. |
| **Dashboard build** | React, Tailwind CSS, Vite, pnpm | Compiled to a single self-contained HTML file via `html-inline`; no CDN dependencies at runtime. |
| **Dashboard deploy** | `push_dashboard.py`, `gh` CLI, GitHub Pages | Injects live signal JSON into the bundle template, commits, and pushes to GitHub Pages. |
| **Analysis environment** | Windows desktop, Python 3.11+, Jupyter | Reads DB over Samba. Runs `run_analysis.py`, `refresh.py`. |
| **Parameter optimization** | Optuna | Planned Phase 2; TPE sampler over walk-forward windows. |
| **ML signal enhancement** | LightGBM | Shadow mode active as of March 2026 — predictions logged but not influencing orders. Activation gated on Spearman ρ > 0.1. |

---

## Disclaimer

This is an experimental research project. Nothing here is financial advice. Congressional trade disclosures carry a 30–45 day reporting lag by law, and the backtest covers only 173 trades — a thin basis for strong conclusions. Signal accuracy is not guaranteed. Past performance does not predict future results. Do your own research before making any investment decisions.
