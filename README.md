# Capitol-Gains

> *If Congress is trading it, maybe you should be too.*

Capitol-Gains is a self-hosted market intelligence and automated trading system that cross-references congressional stock disclosures with Reddit sentiment to surface asymmetric trade ideas — then acts on them. This document describes the theory, data pipeline, scoring model, execution layer, and our ongoing empirical study.

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

The STOCK Act (2012) requires members of Congress to publicly disclose stock trades within 45 days of execution. This creates a structural information asymmetry: politicians trade on material non-public information derived from legislative and regulatory processes, but disclose only after the fact. Prior academic work (Ziobrowski et al., 2004; 2011) found that U.S. Senators outperformed the market by ~8.5% annually and House members by ~6%, results consistent with privileged information access rather than skill.

Our central hypothesis is that even after the disclosure lag, congressional trade data retains predictive signal — particularly when combined with crowd sentiment as a contrarian indicator.

### The Three-Signal Framework

We decompose market information into two orthogonal sources:

- **Informed flow** — congressional trades, assumed to reflect structural information advantages
- **Crowd sentiment** — Reddit investing communities, assumed to reflect retail consensus (and its biases)

The divergence between these two sources is more informative than either alone. When they agree, the signal is confirmatory but potentially late. When they disagree, the smart money / dumb money divergence creates the most actionable setup.

---

## 2. Data Collection

A Raspberry Pi collects data four times daily (8:30am, 11am, 2pm, 10pm Central) across three sources:

| Source | What is captured | Update frequency |
|---|---|---|
| **CapitolTrades.com** | Buy/sell disclosures from 194 tracked members of Congress | 4× daily |
| **Reddit** | Ticker mentions + sentiment from r/wallstreetbets, r/investing, r/stocks, r/options | 4× daily |
| **News** | Headlines from Google News, Yahoo Finance, Motley Fool | 4× daily |

All data is stored in a SQLite database (`market_intel.db`) and synced to a Windows analysis machine via Samba share.

### Politician Trade Schema

Each disclosure record includes: `politician`, `ticker`, `transaction_type` (buy/sell), `amount_range` (e.g. "$15,001–$50,000"), `transaction_date`, `disclosure_date`, `traded_by` (self/spouse/child/blind trust), and committee membership.

### Reddit Article Schema

Each article/post record includes: `ticker_mentions[]`, `sentiment` (bullish/bearish/neutral), `sentiment_score` ([-1, +1]), `reasoning_score` ([0, 1] — see §3.2), `source`, and `timestamp`.

---

## 3. Signal Generation

### 3.1 Sub-Component Scores

Four sub-scores are computed per ticker over a configurable lookback window $d$ (default 14 days):

#### Sentiment Score $S_{sent}$

Rather than a naive average, sentiment is quality-weighted by post reasoning quality $q_i \in [0,1]$:

$$S_{sent} = \frac{\sum_i s_i \cdot (0.2 + 0.8 \cdot q_i)}{\sum_i (0.2 + 0.8 \cdot q_i)} \in [-1, +1]$$

The floor weight of 0.2 ensures every post has some influence; the 0.8 multiplier on quality means a high-conviction research post influences sentiment 5× more than a meme post ($q=0$ vs $q=1$).

#### Momentum Score $S_{mom}$

Momentum captures whether chatter is accelerating relative to baseline. Let $r_{recent}$ be the daily mention rate in the lookback window and $r_{base}$ be the daily rate in the prior $3d$ window:

$$S_{mom} = \text{clip}\!\left(\frac{r_{recent}}{r_{base}} - 1,\; -1,\; +1\right)$$

When $S_{sent} < 0$, momentum is sign-flipped — an accelerating spike in *bearish* chatter is a negative signal.

#### Politician Score $S_{pol}$

The politician score is a weighted net buy ratio. For each trade $i$, the weight $w_i$ is:

$$w_i = \underbrace{\frac{\log_{10}(\max(v_i, 1))}{\log_{10}(5{,}000{,}000)}}_{\text{size weight}} \times \underbrace{(1.0 + 0.2 \cdot c_i)}_{\text{committee boost}} \times \underbrace{\max\!\left(0.2,\; 1 - \frac{\delta_i}{90}\right)}_{\text{freshness}} \times \underbrace{\beta_i}_{\text{ownership}}$$

Where:
- $v_i$ = trade midpoint value in USD (log-scaled, $\$1\text{K} \to 0.5$, $\$1\text{M} \to 1.0$, capped at 1.0)
- $c_i \in [0,1]$ = committee relevance (politician's committee alignment with ticker's sector)
- $\delta_i$ = days since disclosure (freshness decays linearly to 0.2 over 90 days)
- $\beta_i$ = ownership discount: blind trust = 0.1, spouse = 0.6, child = 0.4, self = 1.0

$$S_{pol} = \frac{\sum_{i \in \text{buy}} w_i - \sum_{i \in \text{sell}} w_i}{\sum_i w_i} \in [-1, +1]$$

**Note on committee weighting:** Initial committee boost was 1.5× at full relevance. Backtest analysis (173 trades, Run 1) found large trades underperformed small trades by -1.32% alpha — the opposite of the assumed signal strength. The boost was subsequently reduced to 1.2× maximum.

#### Breadth Score $S_{brd}$

Source diversity as a normalized count of distinct platforms mentioning the ticker:

$$S_{brd} = \min\!\left(1.0,\; \frac{N_{sources} - 2}{3}\right) \in [-0.67, +1]$$

Single-source coverage ($N=1$) produces $S_{brd} = -0.33$ — a mild penalty for potentially coordinated pumping.

### 3.2 Reasoning Quality Score

Each Reddit post is scored on five heuristic dimensions (0–1 each), averaged to produce $q \in [0,1]$:

| Dimension | What it measures |
|---|---|
| **Thesis clarity** | Structured argument, directional claim, multi-paragraph development |
| **Risk acknowledgment** | Explicit downside / bear case language |
| **Data quality** | Financial terms (P/E, EPS, margins), concrete numbers ($, %, ×) |
| **Specificity** | Timeframes, catalysts, price targets |
| **Original thinking** | Penalizes meme phrases and rocket emoji; rewards "my analysis" framing |

Distribution across 11,900 scored articles: 2.3% high ($q \geq 0.55$), 14% moderate, 84% low ($q < 0.25$). The long tail of low-quality posts is expected and handled by the weighting floor.

### 3.3 Base Composite Score

$$C_{base} = 0.30 \cdot S_{sent} + 0.25 \cdot S_{mom} + 0.30 \cdot S_{pol} + 0.15 \cdot S_{brd} + \kappa_{cap}$$

Where $\kappa_{cap} \in \{-0.15, -0.10, 0\}$ is a cap-tier penalty (micro/small caps carry elevated pump risk).

### 3.4 Strategy Overlays

Three named strategies produce additive overlay scores:

#### S1 — Smart Money Divergence (weight 40%)

When politicians buy what Reddit hates (or sell what Reddit loves):

$$D_{S1} = S_{pol} \cdot (-S_{sent}) \cdot \min\!\left(1, \frac{N_{mentions}}{5}\right)$$

The breadth weight dampens the signal when mention counts are low (single-post divergence is noise).

#### S2 — Politician Flow Momentum (weight 35%)

Detects a flip from net selling to net buying across consecutive 90-day windows:

$$D_{S2} = (\rho_{current} - \rho_{prev}) \cdot \min\!\left(1,\; \frac{N_{pols}}{2}\right)$$

Where $\rho = (B - S)/(B + S)$ is the net buy ratio for each period and $N_{pols}$ is the number of unique politicians in the current window. Requires at least 2 politicians for full weight (single-politician flips are noisy).

#### S3 — Contrarian Fade (weight 25%)

When Reddit has extreme sentiment but politicians actively disagree:

$$D_{S3} = -S_{sent} \cdot \min\!\left(1,\; \frac{N_{mentions}}{5}\right) \cdot (1 - |S_{pol}|) \quad \text{if } |S_{sent}| > 0.20 \text{ and } N_{pol\_trades} > 0$$

The $(1 - |S_{pol}|)$ term ensures the contrarian score only fires when politicians are *absent* from the direction the crowd is running — not when politicians are actively confirming it. Requires prior politician activity so that absence of pol data doesn't generate spurious fade signals.

#### Final Composite

$$C = C_{base} + 0.5 \cdot (0.40 \cdot D_{S1} + 0.35 \cdot D_{S2} + 0.25 \cdot D_{S3})$$

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

Every signal is assigned a trust score $T \in [0, 100]$ derived from five sub-signals:

| Sub-signal | Weight | What it detects |
|---|---|---|
| Account Quality | 27% | % of bullish mentions from new or low-karma accounts |
| Sentiment Balance | 22% | Suspiciously one-sided sentiment (>85% bullish) |
| Price-Chatter Alignment | 18% | Chatter spike without price confirmation = pump pattern |
| Reasoning Quality | 18% | Low-quality hype without substance |
| Bias Concentration | 15% | FOMO/overconfidence language clustering |

The reasoning sub-signal uses the *lower* of the overall average reasoning score and the bullish-specific average — a post pool that is broadly reasonable but specifically low-quality on the bullish side is penalized.

Trust adjusts the composite score:

$$C_{adj} = \begin{cases} C & T \geq 60 \\ C \cdot \frac{T}{100} & 40 \leq T < 60 \\ \text{ignored} & T < 40 \end{cases}$$

Crowd stage is separately classified: **MANIC** (≥20% of posts show FOMO/overconfidence language), **DISTRESSED** (≥20% show loss-aversion/sunk-cost language), or **NORMAL**.

---

## 5. Execution Layer

The execution layer translates signals into orders via Alpaca's API. It is deliberately decoupled from data collection: the collection pipeline writes signals to a database; an independent trade loop reads those signals every 5 minutes during market hours.

### 5.1 Architecture

```
COLLECTION (4× daily)              TRADE LOOP (every 5 min, market hours)
──────────────────────             ────────────────────────────────────────
8:30am, 11am, 2pm, 10pm CT         9:35am → 3:55pm ET

collect() → generate_report()      read signal_history
record signals → signal_history    enforce stops
push dashboard                     manage trailing stops
                                   partial profit-taking
Does NOT trade.                    new entries (if signals fresh)
```

### 5.2 Entry Logic

New positions require:
1. $C \geq 0.25$ (S.BUY) with $T \geq 60$
2. Signal persistence: IMMEDIATE tier (1 collection), STANDARD (2), PATIENT (3)
3. Not in stop cooldown (blocked for ~8h after a stop-loss exit)
4. RSI gate: blocked if RSI > 70; half-sized if RSI > 65
5. Not in first 30 min or last 15 min of market session (volatility avoidance)

Capital is deployed in two tranches:
- **Tranche 1:** 60% of allocation at a limit order (0.1–0.5% below ask depending on conviction)
- **Tranche 2:** 40% queued, filled on either a 2% dip or additional signal persistence

Portfolio constraints: max 40 positions, 80% deployed (40% in risk-off), 5% per position, $5,000 cash reserve, max 3 new entries per day.

### 5.3 Stop-Loss Sizing

Stop distance is ATR-based, varying by market cap:

$$\text{stop} = P_{entry} \times \left(1 - \text{clip}\!\left(\text{ATR\%} \times m_{cap},\; 3\%,\; 15\%\right)\right)$$

| Cap tier | Multiplier $m_{cap}$ | Rationale |
|---|---|---|
| Mega | 1.5× | Lower volatility; tight stops |
| Large | 2.0× | |
| Mid | 2.5× | |
| Small / Micro | 3.0× | Higher volatility; room to breathe |

When ATR data is unavailable, an 8% flat fallback is used. ATR is fetched from Alpaca's IEX daily bar feed (replacing a prior yfinance dependency that failed on the Pi).

Stop orders are submitted both in code (checked every 5 minutes) and as server-side Alpaca stop orders — belt-and-suspenders protection that fires in real time even if the Pi goes offline.

### 5.4 Trailing Stops & Profit-Taking

Once a position gains $\geq 1 \times \text{ATR}$ above entry, a trailing stop is activated at $1.5 \times \text{ATR}$ trail distance. Partial profit-taking fires at discrete ATR multiples:

| Trigger | Action |
|---|---|
| $+2 \times \text{ATR}$ | Sell 33% of position |
| $+4 \times \text{ATR}$ | Sell another 33% of position |

### 5.5 Exit Logic

Positions exit on any of four conditions:

1. **Stop-loss** — price breaches the ATR-based stop (server-side or code-side)
2. **Time-based** — held 14 days with <2% gain and weakening signal; or underwater 7 days below S.BUY threshold
3. **Signal exit** — composite drops below S.BUY and grace period (2 collections) expires
4. **Price-aware discount** — if position is down >5% for >5 days, the effective score is penalized by $\min(|P\&L|,\; 0.30)$, allowing time-based exits to fire even when the raw signal remains strong

### 5.6 Portfolio Risk Management

- **Drawdown circuit breaker:** New entries paused if portfolio drops >10% from peak. Resumes at >−5%.
- **Sector cap:** Maximum 3 positions per sector.
- **Risk-off mode:** When `weekly_picks.json` sets `risk_off=true`, max deployment drops to 40% and sector vetoes are enforced.
- **Stop cooldown:** After a stop-loss exit, the ticker is blocked from re-entry for ~8 hours (~4 collection cycles). Prevents stop-sell-rebuy churn without disabling the stop mechanism.

---

## 6. Empirical Study

### 6.1 Backtest Results (Run 1 — March 2026)

**Data:** 173 politician trades, 71 tickers, using transaction date (minimal look-ahead bias — only 15/338 trades had disclosure date).

| Horizon | Avg Return | Alpha vs SPY | Win Rate |
|---|---|---|---|
| 30 days | +2.64% | +0.24% | 65.9% |
| 60 days | +3.91% | +0.05% | 60.1% |
| 90 days | +6.51% | +1.29% | 61.8% |

Train/test split at May 2025 (50/50 by time): win rates held stable across both halves — the signal appears to generalize out-of-sample.

**Key anomaly:** Large trades (≥$50K) *underperformed* the full sample by −1.32% alpha at 60 days, directly contradicting the committee-weighting assumption. The size boost was reduced in response (§3.1).

### 6.2 Live Paper Trading (Run 2 — First 10 Days)

Account started at ~$97,358, ended at $96,034 (−1.4%) during a risk-off macro period (Hormuz escalation, Nasdaq correction). Deployment held at 41% vs 40% target — risk controls functioned as designed. Primary findings:

- **Stop churn:** 8 stop-sell-rebuy cycles in 10 days — resolved by adding stop cooldown
- **ATR coverage:** Only 2/6 oldest positions had ATR data (yfinance unavailable on Pi) — resolved by switching to Alpaca bars API
- **Stop latency:** Stops checked only 4×/day; positions breached for hours — resolved by 5-min trade loop + server-side stops
- **Signal stickiness:** All 5 underwater positions (−6% to −9%) maintained S.BUY composites above 0.65 — resolved by price-aware score discount

### 6.3 ML Parameter Optimization Study (Ongoing)

As live trade data accumulates, a phased parameter optimization program is underway. All execution parameters are externalized to a `params.py` config loader — the Pi reads `tuned_params.json` if present, otherwise falls back to current defaults.

**Instrumentation (deployed March 2026):**
- `trade_outcomes` table — records entry/exit prices, hold time, return, and all sub-scores ($S_{sent}, S_{mom}, S_{pol}, S_{brd}$) at time of entry
- `daily_mtm` table — daily mark-to-market with running max adverse excursion (MAE) and max favorable excursion (MFE) per position

**Phase 1 — Sensitivity Analysis** (target: ~4 weeks after instrumentation)

For each signal observation, 5/10/20-day forward returns are fetched from Alpaca. The marginal predictive power of each sub-score is estimated by OLS regression:

$$r_{i,t+N} = \alpha + \beta_1 S_{sent,i,t} + \beta_2 S_{mom,i,t} + \beta_3 S_{pol,i,t} + \beta_4 S_{brd,i,t} + \varepsilon_i$$

A monotonic composite calibration curve (score decile vs average forward return) validates whether the threshold structure is well-ordered. MAE/MFE distributions by cap tier are compared to current ATR stop distances to detect systematic over- or under-tightness.

**Phase 2 — Bayesian Optimization** (target: ~50 completed round-trips)

Optuna (TPE sampler) optimizes 4–6 parameters over expanding walk-forward windows. The objective is Sortino ratio (downside-penalized return). An L2 regularization penalty toward current parameter values prevents corner-case overfitting:

$$\text{objective} = \text{Sortino}(\theta) - \lambda \sum_k (\theta_k - \theta_k^0)^2$$

Maximum parameter movement is capped at ±50% of current values per optimization run. Outputs are written to `tuned_params.json` and SCPed to the Pi.

**Phase 3 — ML Signal Enhancement** (target: ~100 completed round-trips)

A LightGBM model (max_depth=3, 50 estimators) is trained to produce a correction factor on the composite score. It runs in shadow mode for 30 days before activation — predictions are logged without influencing orders. Activation requires Spearman $\rho > 0.1$ between shadow predictions and realized forward returns. The adjustment is bounded: it cannot flip a signal direction, only modulate magnitude by ±20%.

### 6.4 Optimization Guardrails

The following parameters are explicitly excluded from optimization — they are survival constraints, not return optimizers:

| Parameter | Value | Rationale |
|---|---|---|
| `MAX_POSITION_PCT` | 5% | Kelly-optimal sizing at 62% win rate |
| `MAX_DEPLOYED_PCT` | 80% | Cash reserve for opportunities |
| `MAX_DAILY_ENTRIES` | 3 | Circuit breaker, not a performance lever |
| `DRAWDOWN_PAUSE_PCT` | 10% | Ruin prevention |

---

## 7. Stack

| Layer | Technology |
|---|---|
| **Always-on collection** | Raspberry Pi 4, Python 3.9, cron (4×/day) |
| **Database** | SQLite with WAL mode (concurrent read/write safe) |
| **Scoring engine** | Pure Python — `report.py`, `integrity.py`, `reasoning_quality.py` |
| **Trade execution** | `alpaca-py` SDK, Alpaca paper/live API |
| **Dashboard** | React + Tailwind CSS, bundled to single HTML, GitHub Pages |
| **Analysis / optimization** | Windows desktop, Jupyter, Optuna (planned), LightGBM (planned) |

---

## Disclaimer

This is an experimental research project, not financial advice. Congressional trade disclosures carry a 30–45 day reporting lag by law. Backtest results are based on 173 trades and should not be extrapolated. Signal accuracy is not guaranteed. Past performance does not predict future results. Do your own research before making any investment decisions.
