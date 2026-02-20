# Capitol-Gains

A market intelligence system that tracks congressional stock trades, Reddit sentiment, and financial news to generate buy/sell signals — then scores them for reliability before surfacing actionable plays.

## How it works

**Data collection** (runs on a Raspberry Pi, updated daily)
- Scrapes stock trades disclosed by 194 members of Congress from CapitolTrades.com
- Monitors Reddit (r/investing, r/wallstreetbets, etc.) for ticker mentions and sentiment
- Aggregates headlines from Google News, Yahoo Finance, and Motley Fool

**Signal generation**
Three backtested strategies combine to score each ticker:
- **S1 — Smart Money Divergence:** Politicians buying what the crowd hates (or vice versa)
- **S2 — Politician Flow Momentum:** Detect when congress members flip from selling to buying
- **S3 — Contrarian Fade:** Fade extreme Reddit sentiment when politicians aren't confirming it

**Trust scoring**
Each signal is filtered through a trust score (0–100) that penalizes pump-and-dump patterns, single-source hype, low-quality accounts, and price/chatter divergence. Low-trust signals are discounted before ranking.

**Output**
Tickers are ranked S.BUY / BUY / HOLD / SELL / S.SELL with composite scores, RSI, 30-day return vs SPY, sector, market cap, and politician trade details.

## Dashboard

Live signal dashboard: **https://kgollins.github.io/Capitol-Gains/**

Updated automatically after each analysis run.

## Disclaimer

This is an experimental research tool, not financial advice. Politician trade disclosures have a 30–45 day reporting lag. Past signal accuracy does not guarantee future results. Always do your own research.
