(function () {
  var sections = [
    {
      title: "What The Agents Do",
      rows: [
        ["Signal scorer", "Reads congressional disclosures, Reddit mood, chatter speed, source breadth, trust checks, and market context. It turns the soup into S.BUY, BUY, HOLD, SELL, or S.SELL.", "text-emerald-500"],
        ["Weekly advisor", "Ranks the best setups and adds approvals like buy, hold_only, size_mult, options_ok, max RSI, sector, cap tier, and risk tags.", "text-amber-500"],
        ["Macro agent", "Checks market regime, risk_off, sector tailwinds, sector vetoes, and big themes. If the market is walking near a rake, this points at the rake.", "text-sky-500"],
        ["Execution agent", "Looks at candidates and open positions. It can suggest entries, early exits, and options, but hard stops, caps, and drawdown rules are enforced by code first.", "text-violet-400"],
        ["Committee panel", "Five specialist agents vote on pending intents: Narrative, Risk, Quant, Macro, and Contrarian. They vote YES, NO, or ABSTAIN and can propose ideas for the next round.", "text-zinc-300"],
        ["Judge", "Final reviewer for committee decisions. It can EXECUTE, REJECT, or override the panel when the data justifies it. Cash is an acceptable answer.", "text-red-400"]
      ]
    },
    {
      title: "The Five Committee Voices",
      rows: [
        ["Narrative", "Checks whether the story is early, real, and backed by a why-now catalyst instead of pure hype.", "text-zinc-300"],
        ["Risk", "Owns churn, stop-outs, drawdown, sizing, rebuy discipline, and whether a pretty trade has an ugly path.", "text-zinc-300"],
        ["Quant", "Leans on composite score, trust, RSI, sub-scores, persistence, policy score, and measured edge before story text.", "text-zinc-300"],
        ["Macro", "Checks sector crowding, risk_off, market regime, sector vetoes, buying power, and portfolio overlap.", "text-zinc-300"],
        ["Contrarian", "Focuses on S1 divergence: informed flow against crowd mood. Skeptical by default, which is a feature.", "text-zinc-300"]
      ]
    },
    {
      title: "Signal Actions",
      rows: [
        ["S.BUY", "Strong buy signal: composite above +0.25. It can qualify for entry only after trust, persistence, RSI, cooldown, timing, and portfolio gates pass.", "text-emerald-400"],
        ["BUY", "Positive signal, but not strong enough for automatic entry. Goes on the watch list.", "text-emerald-600"],
        ["HOLD", "No clear directional edge. Doing nothing is allowed. Doing nothing is underrated.", "text-zinc-400"],
        ["SELL", "Negative signal. Existing positions get reviewed against stops, time rules, signal decay, and agent judgment.", "text-red-500"],
        ["S.SELL", "Strong negative signal. High-priority bearish warning, not a decorative red sticker.", "text-red-400"]
      ]
    },
    {
      title: "Score Ingredients",
      rows: [
        ["Sentiment 30%", "Quality-weighted Reddit mood. Better reasoning gets a bigger vote than empty hype.", "text-amber-500"],
        ["Momentum 25%", "How much ticker chatter is speeding up versus baseline. Bullish acceleration helps; bearish acceleration hurts.", "text-amber-500"],
        ["Politician 30%", "Weighted buy-minus-sell flow from disclosures. Size, committee relevance, freshness, and ownership all matter.", "text-amber-500"],
        ["Breadth 15%", "How many independent sources mention the ticker. One noisy corner gets less credit than broad discussion.", "text-amber-500"],
        ["Cap caution", "Small and micro caps get extra skepticism because tiny tickers can turn hype into confetti very quickly.", "text-amber-500"]
      ]
    },
    {
      title: "Strategy Tags",
      rows: [
        ["S1 DIV", "Smart Money Divergence. Politician flow and Reddit mood disagree. The rationale tells you which side is doing what.", "text-violet-400"],
        ["S2 FLOW", "Politician Flow Momentum. The recent politician window shifted versus the prior window, usually toward buying or selling pressure.", "text-sky-500"],
        ["S3 FADE", "Contrarian Fade. Reddit is very emotional while politician flow is weak or absent, so the crowd may be late.", "text-violet-400"]
      ]
    },
    {
      title: "Trust And Crowd Labels",
      rows: [
        ["Trust 60+", "Accepted at face value after normal gates.", "text-emerald-500"],
        ["Trust 40-59", "Discounted. The signal may matter, but it has to drag a credibility backpack.", "text-amber-500"],
        ["Trust <40", "Ignored. Loud is not the same as useful.", "text-red-400"],
        ["MANIC", "FOMO or overconfidence language is concentrated. The crowd may be late-cycle excited.", "text-red-400"],
        ["DIST", "Distressed language is concentrated. Could be capitulation, could be a very expensive support group.", "text-amber-400"],
        ["PUMP", "Trust model sees possible coordination: low-quality bullish posts, one-sided sentiment, or chatter without price support.", "text-red-400"]
      ]
    },
    {
      title: "Jargon Decoder",
      rows: [
        ["Intent", "A proposed action waiting for review: buy, sell, add, hold review, call, or put.", "text-zinc-300"],
        ["Candidate", "A ticker strong enough to be considered before gates, agents, and risk checks say yes or no.", "text-zinc-300"],
        ["Persistence", "The signal has to survive more than one update cycle unless it is unusually strong and trusted.", "text-zinc-300"],
        ["Tranche", "A partial entry. Start with some, add later only if the setup behaves.", "text-zinc-300"],
        ["ATR", "Average True Range. A volatility ruler used for stops and trails so jumpy stocks get more room.", "text-zinc-300"],
        ["RSI", "Relative Strength Index. High can mean overheated; low can mean washed out. It is a warning light, not a prophecy.", "text-zinc-300"],
        ["Cooldown", "Temporary block after a stop exit so the system does not immediately rebuy the same headache.", "text-zinc-300"],
        ["risk_off", "Portfolio posture that cuts deployment and rejects weaker trades when macro risk is high.", "text-zinc-300"],
        ["Sector veto", "No new buys in a blocked sector for the current advisor window.", "text-zinc-300"],
        ["size_mult", "Advisor sizing multiplier from 0 to 1. Lower means smaller position; 0 means no buy.", "text-zinc-300"],
        ["hold_only", "Advisor likes the thesis enough to keep watching but does not allow a fresh buy.", "text-zinc-300"],
        ["options_ok", "Whether the advisor allows option ideas for that ticker. False means equity-only or skip.", "text-zinc-300"],
        ["BUY_CALL", "Bullish options intent. Needs strong score, high trust, RSI below the gate, and enough time before earnings.", "text-zinc-300"],
        ["BUY_PUT", "Bearish options intent. Same idea in the negative direction.", "text-zinc-300"],
        ["HOLD_REVIEW", "An open position needs a decision: extend, sell, or leave unchanged.", "text-zinc-300"],
        ["ADD_REVIEW", "A request to add to an underwater position only if the thesis is intact or improving. Not a license to average down a broken idea.", "text-zinc-300"],
        ["edge_memory", "Recent record of whether agents and signals have been useful. Tiny samples are trivia, not truth.", "text-zinc-300"],
        ["pol_reliability", "Historical quality score for politician flow. Some disclosed trades have been more useful than others.", "text-zinc-300"]
      ]
    }
  ];

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function row(data) {
    return '<div class="flex gap-3 text-xs">' +
      '<span class="font-mono font-semibold w-36 flex-shrink-0 ' + data[2] + '">' + esc(data[0]) + '</span>' +
      '<span class="text-zinc-500 leading-relaxed">' + esc(data[1]) + '</span>' +
      '</div>';
  }

  function section(data) {
    return '<section>' +
      '<h3 class="text-zinc-300 text-xs font-semibold uppercase tracking-widest mb-2 border-b border-zinc-800 pb-1">' + esc(data.title) + '</h3>' +
      '<div class="space-y-1.5">' + data.rows.map(row).join("") + '</div>' +
      '</section>';
  }

  function guideHtml() {
    return '<p class="text-zinc-600 text-xs mb-4">Current field guide for the dashboard, the private agents behind it, and the jargon they leave on the table like tiny finance receipts.</p>' +
      '<div class="space-y-5">' + sections.map(section).join("") + '</div>';
  }

  function patchGuide() {
    var marker = Array.prototype.find.call(
      document.querySelectorAll("p"),
      function (el) {
        return (el.textContent || "").trim() === "Reference guide for all signals, scores, and strategy terms used in this system.";
      }
    );
    if (!marker) return false;

    var panel = marker.closest('[role="tabpanel"]') || marker.parentElement;
    if (!panel || panel.getAttribute("data-cg-guide-current") === "1") return true;

    panel.innerHTML = guideHtml();
    panel.setAttribute("data-cg-guide-current", "1");
    return true;
  }

  function patchFooter() {
    Array.prototype.forEach.call(document.querySelectorAll("span,div"), function (el) {
      var text = (el.textContent || "").trim();
      if (el.children.length === 0 && text === "Run /invest + /macro for full analysis") {
        el.textContent = "Private advisor and macro scans feed this dashboard";
      }
      if (el.children.length === 0 && text.indexOf("59-65% historical accuracy") !== -1) {
        el.textContent = "Not financial advice. Research dashboard only. Disclosure lag, small samples, and market regime changes all matter. Past performance does not guarantee future results.";
      }
    });
  }

  function wire() {
    patchFooter();
    patchGuide();
    var guideButton = Array.prototype.find.call(
      document.querySelectorAll('button,[role="tab"]'),
      function (el) { return (el.textContent || "").trim() === "Guide"; }
    );
    if (guideButton && guideButton.getAttribute("data-cg-guide-wire") !== "1") {
      guideButton.setAttribute("data-cg-guide-wire", "1");
      guideButton.addEventListener("click", function () {
        setTimeout(function () {
          patchFooter();
          patchGuide();
        }, 0);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    setTimeout(wire, 0);
  }

  var observer = new MutationObserver(wire);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true
  });

  setTimeout(wire, 100);
  setTimeout(wire, 500);
  setTimeout(wire, 1500);
})();
