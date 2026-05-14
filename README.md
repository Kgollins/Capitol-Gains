# Capitol-Gains

> Congressional trades, Reddit vibes, and a risk manager sitting in the corner with a clipboard.

Capitol-Gains is an experimental market-intelligence project that asks a simple question:

**When politicians trade, the crowd talks, and prices move, is there a useful signal hiding in the mess?**

The system watches public congressional stock disclosures, Reddit investing chatter, and financial news. It turns that into plain signal labels like `S.BUY`, `BUY`, `HOLD`, `SELL`, and `S.SELL`, then uses a separate trading layer to paper-trade the strongest ideas with risk controls.

The public dashboard is here:

[https://kgollins.github.io/Capitol-Gains/](https://kgollins.github.io/Capitol-Gains/)

This repository is the explanation and dashboard surface. The private collection, scoring, and trading code is not published here. This is the showroom, not the wiring closet.

---

## The Big Idea

Members of Congress have to disclose stock trades under the STOCK Act. The catch is that disclosures can arrive 30 to 45 days after the trade happened.

That means Capitol-Gains is not saying:

> "A politician bought today, buy immediately!"

It is asking:

> "A politician disclosed a trade late, Reddit is reacting in some direction, news is noisy, and price action has done whatever price action does after three coffees. Is there still a useful clue?"

The project combines two very different information streams:

| Signal | Plain English |
|---|---|
| Congressional trades | "What did the people with oddly convenient timing disclose?" |
| Reddit sentiment | "What is the crowd yelling about today?" |

The interesting part is often the disagreement.

If politicians are buying while Reddit is miserable, that can be interesting. If Reddit is euphoric while politicians are absent or selling, that can also be interesting. If everyone agrees, the signal may be real, or it may already be so obvious that the market ate it for lunch.

---

## What It Watches

Capitol-Gains tracks:

| Source | What It Adds |
|---|---|
| STOCK Act disclosures | Public congressional stock trades |
| CapitolTrades data | Recent disclosures plus full histories for actively trading members |
| House/Senate fallback feeds | Backup coverage when the main feed misses something |
| Reddit | Ticker mentions and mood from investing communities |
| Financial news RSS | Headlines and context from major market sources |
| Price/market data | RSI, ATR, market cap tier, and execution context |

Current coverage includes all STOCK Act disclosures from filing members of Congress, plus full trade histories for 194 actively trading members.

---

## How The Score Works

Every ticker gets a score. Think of it like a report card, except the student is a stock and the teacher is suspicious.

Scores generally live around this range:

| Score Zone | Meaning |
|---|---|
| Positive | More buy-ish |
| Near zero | Meh |
| Negative | More sell-ish |

The final label is simple:

| Label | Meaning |
|---|---|
| `S.BUY` | Strong buy signal |
| `BUY` | Buy signal |
| `HOLD` | Not enough reason to act |
| `SELL` | Sell signal |
| `S.SELL` | Strong sell signal |

Under the hood, the system blends four main ingredients.

| Ingredient | Weight | ELI5 Version |
|---|---:|---|
| Crowd sentiment | 30% | Is Reddit bullish, bearish, or just typing loudly? |
| Chatter momentum | 25% | Is attention speeding up or cooling off? |
| Politician flow | 30% | Are disclosed trades mostly buys or sells? |
| Breadth | 15% | Is this ticker showing up broadly, or only in one hype corner? |

There is also a small-stock caution penalty. Tiny stocks can move fast, break faster, and attract "trust me bro" energy at industrial scale.

---

## Tiny Math Corner

The old README had a lot of equations. Here is the same idea without making your eyes file a complaint.

### 1. Reddit Mood

Each post gets a mood:

| Mood | Score |
|---|---:|
| Bullish | Positive |
| Neutral | Around zero |
| Bearish | Negative |

Better posts count more. A thoughtful writeup with risks, numbers, and a real thesis gets more weight than a post that is basically "number go up because I said so."

In kid-table math:

```text
reddit score = average mood, but smarter posts get a bigger vote
```

### 2. Chatter Speed

The system checks whether people are talking about a ticker more than usual.

```text
momentum = current chatter speed compared with recent normal chatter speed
```

If mentions jump from 10 per day to 15 per day, chatter is up 50%.

If the chatter is bullish, that helps. If the chatter is bearish, the same spike hurts. Loud panic is still loud.

### 3. Politician Flow

Not all disclosures count the same.

A trade gets more weight when:

| Factor | Why It Matters |
|---|---|
| Bigger disclosed amount | A larger trade may show more conviction |
| Relevant committee | A trade near the politician's policy lane gets a small bump |
| Recent disclosure | Fresher information matters more |
| Direct ownership | A self trade counts more than spouse, child, or blind trust activity |

In tiny math:

```text
trade weight = size + relevance + freshness + ownership
politician score = weighted buys minus weighted sells
```

Actual implementation uses multiplication and scaling, because computers enjoy chores. The idea is simple: a recent direct buy by a relevant politician matters more than an old tiny indirect trade.

### 4. Breadth

If five different sources are discussing a ticker, that is broader than one subreddit yelling into a paper cup.

```text
breadth = more independent sources means more confidence
```

Single-source hype gets a penalty. Wide discussion gets a boost.

### 5. Final Score

The simplified version:

```text
final score =
  30% Reddit mood
+ 25% chatter speed
+ 30% politician flow
+ 15% source breadth
+ small-stock caution
+ strategy bonuses
```

Then the score becomes a label like `S.BUY`, `BUY`, or `HOLD`.

No crystal ball. Just a structured way to stop staring at 19 tabs and calling it "research."

---

## Strategy Flavors

The dashboard may show a strategy tag. These are the three main ones.

| Strategy | What It Means |
|---|---|
| `S1` Smart Money Divergence | Politicians and Reddit disagree. This is the "hmm, interesting" bucket. |
| `S2` Politician Flow Momentum | Politician activity recently shifted toward buying or selling. |
| `S3` Contrarian Fade | Reddit is very emotional, but politician flow is weak or absent. |

These are not magic spells. They are labels for why the system liked or disliked a setup.

---

## Trust Score

Every ticker also gets a trust score from 0 to 100.

This is the system asking:

> "Is this real market interest, or is somebody trying to turn a comment section into a leaf blower?"

The trust score looks at:

| Check | What It Catches |
|---|---|
| Account quality | New or low-quality accounts pushing the same thing |
| Sentiment balance | Suspiciously one-sided hype |
| Price confirmation | Chatter spike with no price support |
| Reasoning quality | Lots of claims, no actual argument |
| Bias language | FOMO, overconfidence, and bagholder poetry |

Trust changes how much the system listens:

| Trust | Treatment |
|---|---|
| 60 to 100 | Accepted |
| 40 to 59 | Discounted |
| Below 40 | Ignored |

A low-trust ticker can have a loud score and still get benched. Volume is not the same thing as credibility. A blender is loud too.

---

## What The Dashboard Shows

The dashboard is a ranked snapshot of current signals.

Common fields:

| Field | Meaning |
|---|---|
| Rank | Where the ticker lands today |
| Action | `S.BUY`, `BUY`, `HOLD`, `SELL`, or `S.SELL` |
| Score | Combined signal strength |
| Strategy | Main reason the signal fired |
| Cap | Market cap bucket |
| RSI | Basic overbought/oversold check |
| Trust | Manipulation-risk filter |
| Sent | Reddit sentiment score |
| Pols | Politician trade score |
| Mentions | How much chatter exists |
| Rationale | Human-readable reason for the signal |
| Crowd stage | Whether discussion looks normal, manic, or distressed |

The dashboard is not a command center telling anyone what to buy. It is a research instrument with a scoreboard.

---

## Trading Layer, In Plain English

The project also includes a private paper-trading system connected to Alpaca.

It does not blindly buy every signal the instant it appears. That would be less "quant strategy" and more "shopping cart with a rocket taped to it."

Before entering a position, the system checks:

| Gate | Purpose |
|---|---|
| Signal strength | Only strong enough scores qualify |
| Trust | Low-trust names are blocked or discounted |
| Persistence | A signal usually has to survive multiple update cycles |
| RSI | Avoid chasing names that already look overheated |
| Market timing | Avoid entries at the messiest parts of the trading day |
| Stop cooldown | Prevent stop-sell-rebuy-repeat nonsense |

Positions are managed with:

| Control | Purpose |
|---|---|
| Two-tranche entries | Start partial, add only if conditions hold |
| Position caps | Keep one idea from becoming the whole portfolio |
| Sector caps | Avoid accidentally becoming an ETF with commitment issues |
| Cash reserve | Do not spend every dollar just because the spreadsheet is excited |
| ATR-based stops | Give volatile stocks more room, stable stocks less |
| Server-side stops | Protection still exists if the local machine goes offline |
| Trailing stops | Let winners run, but not into a wall |
| Profit-taking | Take partial gains at predefined levels |
| Drawdown pause | Stop opening new positions after large portfolio damage |

The collection system and trading system are separate. One gathers and scores data. The other decides whether a trade is allowed. Separation keeps one bad scrape from becoming one bad order.

---

## What Has Happened So Far

This is research, not a victory parade.

### Backtest Snapshot

An early backtest looked at 173 politician trades across 71 tickers.

Headline results:

| Horizon | Average Return | Excess vs SPY | Win Rate |
|---|---:|---:|---:|
| 30 days | +2.64% | +0.24% | 65.9% |
| 60 days | +3.91% | +0.05% | 60.1% |
| 90 days | +6.51% | +1.29% | 61.8% |

Important caveat:

Most of the backtest used the actual transaction date, not the public disclosure date. In real life, nobody sees the trade until the disclosure arrives later. That means the 30-day and 60-day numbers are especially noisy. The 90-day number is more useful, but still not proof of anything.

Translation: interesting enough to keep studying, not enough to tattoo on a brokerage account.

### Paper Trading Snapshot

The first 10 days of live paper trading were down about 1.4% during a risk-off market period.

That run was useful because it exposed real execution problems:

| Problem | Fix |
|---|---|
| Stop-loss churn | Added cooldown after stop exits |
| Weak ATR coverage | Switched to Alpaca market data |
| Slow stop checks | Added faster trade-loop checks and server-side stops |
| Sticky signals | Added price-aware score penalties for losing positions |

Losing money in paper trading is annoying. Finding broken assumptions before real money relies on them is the point.

---

## Current Research Track

The project is now focused on making the system less hand-wavy.

Current work includes:

| Area | Goal |
|---|---|
| Trade outcome tracking | Record every completed paper trade with entry signals and realized return |
| Daily mark-to-market | Track open-position pain and upside while trades are still alive |
| Parameter review | Test whether current weights and thresholds actually help |
| Stop tuning | Compare ATR stop sizes against real drawdowns |
| Trust validation | Check whether low-trust names really underperform |
| ML shadow mode | Let a model make predictions without controlling trades |

The ML layer is intentionally treated like an intern with a calculator: allowed to suggest things, not allowed to touch the steering wheel.

---

## What This Project Is

Capitol-Gains is:

- A public dashboard for congressional-trade-plus-sentiment signals
- A research project about disclosure lag, crowd behavior, and market reaction
- A private paper-trading experiment with strict risk controls
- A running notebook of what works, what breaks, and what needs more data

Capitol-Gains is not:

- Financial advice
- A guaranteed trading system
- A claim that Congress trades always beat the market
- A public release of the private data collection or trading code
- A reason to buy something because a table used a confident color

---

## Why The Name?

Because "A Reasonably Skeptical Multi-Source Disclosure-Lag Market Signal Explorer" was accurate, but nobody wants that on a dashboard.

---

## Disclaimer

This is an experimental research project. Nothing here is financial advice.

Congressional disclosures are delayed by law. Reddit sentiment is noisy. Backtests are small. Paper trading can look very different from live trading. Automated systems can lose money quickly, especially when they are wrong with confidence.

Do your own research. Keep position sizes boring. Never let a dashboard make decisions your future self has to explain.
