# Capitol-Gains 📈

> **If Congress is trading it, maybe you should be too.**

Capitol-Gains is a self-hosted market intelligence system that cross-references congressional stock disclosures with Reddit sentiment and financial news to surface asymmetric trade ideas — before they become obvious.

---

## The Thesis

Members of Congress trade stocks. They disclose those trades publicly — but with a 30–45 day lag. When you combine that disclosure data with real-time sentiment signals, a pattern emerges: politicians often move before the crowd catches on.

Capitol-Gains automates that analysis across **194 tracked members of Congress**, scores the signals for reliability, and ranks the results daily.

---

## How It Works

### 1. Data Collection
A Raspberry Pi runs daily collection across three sources:

| Source | What it captures |
|--------|-----------------|
| **CapitolTrades.com** | Buy/sell disclosures from 194 members of Congress |
| **Reddit** | Ticker mentions + sentiment from investing communities |
| **News** | Headlines from Google News, Yahoo Finance, Motley Fool |

### 2. Signal Generation
Three strategies combine into a composite score for each ticker:

**S1 — Smart Money Divergence**
Politicians buying what Reddit hates (or selling what Reddit loves). When the crowd and Congress disagree, follow Congress.

**S2 — Politician Flow Momentum**
Detects when members flip from net selling to net buying — or vice versa. A flip is a stronger signal than a single trade.

**S3 — Contrarian Fade**
When Reddit sentiment is extreme but politicians aren't confirming it, fade the crowd. Hype without smart money backing tends to mean revert.

### 3. Trust Scoring
Every signal gets a trust score (0–100) before it's ranked. Signals are penalized for:
- Single-source chatter (one Reddit thread doesn't make a trend)
- Price/chatter divergence (pump patterns)
- Low account quality
- One-sided sentiment with no counterweight

Low-trust signals are discounted. Only high-conviction, multi-source signals reach the top.

### 4. Output
Tickers are ranked **S.BUY → BUY → HOLD → SELL → S.SELL** with:
- Composite score + trust-adjusted score
- RSI (14-day) and overbought/oversold label
- 30-day return vs SPY
- Sector and market cap
- Politician trade history with party and transaction size

---

## Live Dashboard

**[https://kgollins.github.io/Capitol-Gains/](https://kgollins.github.io/Capitol-Gains/)**

Updated automatically after each analysis run.

---

## Stack

- **Data layer:** Python, SQLite, Raspberry Pi (always-on collection)
- **Sources:** CapitolTrades scraper, Reddit API, RSS news feeds, yfinance
- **Analysis:** Composite scoring engine with strategy overlays + trust filter
- **Dashboard:** React + Tailwind, bundled to a single HTML file, deployed via GitHub Pages

---

## Disclaimer

This is an experimental research project, not financial advice. Congressional trade disclosures carry a 30–45 day reporting lag by law. Signal accuracy is not guaranteed. Do your own research before making any investment decisions.
