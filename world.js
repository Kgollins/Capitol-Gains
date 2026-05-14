/* MMWorld: the helpers every page of the Market Map shares. Plain-word formats, the cases line under each chart,
   the dial words, safe links and the scoreboard rows. In a browser it also builds elements and loads data files. */
var MMWorld = (function () {
  "use strict";

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
                "November", "December"];
  var WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  // A scoreboard file with no `lucky` of its own: a try at the shuffled maps passes by luck 2 times in 21 (the chance the
  // scoreboard file counts per try for a map lens; a lens that does not use the map counts 0.05 in the file itself).
  var LUCK_PER_LOOK = 2 / 21;
  var LUCK_WORDS = "A try is one forecast tested on the closed years. Against shuffled maps it passes by luck 2 times in 21, " +
                   "and without the map, 1 time in 20.";

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function str(v) { return typeof v === "string" ? v : ""; }

  // ---- formats ----

  function fmtInt(n) {
    if (!isNum(n)) return "\u2013";   // an en dash, for a figure that is missing
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function fmtDay(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return day == null ? "" : String(day);
    return +m[3] + " " + MONTHS[+m[2] - 1] + " " + m[1];
  }

  function fmtTime(slot) {
    if (slot === "close") return "the close";
    var m = /^(\d{1,2}):(\d{2})$/.exec(slot);
    if (!m || +m[1] > 23 || +m[2] > 59) return slot == null ? "" : String(slot);
    var h = +m[1];
    return (h % 12 || 12) + ":" + m[2] + (h < 12 ? " am" : " pm");
  }

  function yearsText(range) {
    if (!Array.isArray(range) || range.length !== 2) return "";
    var y = range.map(function (d) { var m = /^(\d{4})-/.exec(d); return m ? m[1] : null; });
    if (!y[0] || !y[1]) return "";
    return y[0] === y[1] ? y[0] : y[0] + " to " + y[1];
  }

  function numberWord(n, capital) {
    if (!isNum(n)) return "";
    if (n % 1 !== 0) return String(n);
    if (n < 0 || n > 9) return fmtInt(n);
    var w = WORDS[n];
    return capital ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  }

  function plural(n, one, many) { return n === 1 ? one : many; }

  // Text with each hyphen that stands for a minus sign before a number written as a true minus (U+2212), as every
  // figure on these pages is written: "-0.7", "(-15.6%)" and "x = -3" change; "2015-2023", "look-alikes", "a - b" and a
  // lone "-" do not. (No lookbehind, which older Safari cannot parse.)
  var MINUS_SIGN = /(^|[^\w.\u2212-])-(?=\.?\d)/g;
  function trueMinus(s) { return typeof s === "string" ? s.replace(MINUS_SIGN, "$1\u2212") : s; }

  // "Rests on 41,203 cases, 2015 to 2023, the explored years."
  function casesLine(cases, range, shelf) {
    var n = isNum(cases) && cases >= 0 ? Math.round(cases) : null, count;   // the count as it is shown decides the noun
    if (n === null) count = "Rests on an unknown number of cases";
    else if (n === 0) count = "No cases yet";
    else count = "Rests on " + fmtInt(n) + " " + plural(n, "case", "cases");
    var where;
    if (shelf === "live") {
      var ok = Array.isArray(range) && range.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(range[0]) && /^\d{4}-\d{2}-\d{2}$/.test(range[1]);
      where = "recorded live on the Pi";
      if (ok) where += range[0] === range[1] ? " on " + fmtDay(range[0]) : " from " + fmtDay(range[0]) + " to " + fmtDay(range[1]);
    } else {
      where = [yearsText(range), shelf === "explored" ? "the explored years" : ""].filter(Boolean).join(", ");
    }
    return count + (where ? ", " + where : "") + ".";
  }

  // ---- dials ----

  var DIALS = Object.freeze([
    Object.freeze({ key: "in_step", name: "In step", index: 0 }),
    Object.freeze({ key: "contagion", name: "Contagion", index: 1 }),
    Object.freeze({ key: "attention_spread", name: "Attention spread", index: 2 }),
    Object.freeze({ key: "follow", name: "Follow or reverse", index: 3 }),
    Object.freeze({ key: "hot_spots", name: "Hot spots joined up", index: 5 }),
  ]);
  var HURST_INDEX = 4;

  // Round to 6 decimals, ties to even, as Python's round() does in the writer.
  function round6(v) {
    var s = v * 1e6, r = Math.round(s);
    if (Math.abs(s % 1) === 0.5 && r % 2 !== 0) r -= 1;
    return r / 1e6;
  }

  // Percentiles 5, 25, 50, 75 and 95 by linear interpolation (numpy's default), or null below 20 values.
  function scaleFromSeries(values) {
    if (!Array.isArray(values)) return null;
    var a = values.filter(isNum).sort(function (x, y) { return x - y; });
    if (a.length < 20) return null;
    return [5, 25, 50, 75, 95].map(function (p) {
      var at = p / 100 * (a.length - 1), lo = Math.floor(at), hi = Math.ceil(at);
      return round6(a[lo] + (a[hi] - a[lo]) * (at - lo));
    });
  }

  function isScale(s) { return Array.isArray(s) && s.length === 5 && s.every(isNum); }

  // A dial's word against its own history: the scale is the spread of the whole market's past readings (ruling 22:
  // hot spots too, never a fixed mark). Every scale on hand is the whole market's, so a reading of any other scope (a
  // sector) is never measured against it, and no dial words it by its sign alone either, which would make it sound
  // stronger than the market's: its in-step share, for one, has a floor that depends on how many stocks it holds.
  function wholeMarket(scope) { return scope == null || scope === "ALL"; }
  function dialWord(key, value, scale, scope) {
    if (!isNum(value)) return "not enough data yet";
    if (!wholeMarket(scope)) return "no history to compare";
    var s = isScale(scale) ? scale : null;
    if (!s) return "no history to compare";             // follow too: never worded by its sign alone
    if (key === "follow") {
      var half = (s[3] - s[1]) / 2;
      return value > half ? "mostly follow" : value < -half ? "mostly reverse" : "mixed";
    }
    return value < s[1] ? "lower than usual" : value > s[3] ? "higher than usual" : "usual";
  }

  // A dial's word on a run-in day (ruling 16): nothing is counted there, so it describes no reading. And the note
  // beside a dial on a 10-minute slot, which carries the last close's dials.
  var RUNIN_DIAL_WORD = "run-in day: not counted";
  var AT_LAST_CLOSE = "at the last close";

  // The Hurst number in words (ruling 22). From 0.40 to 0.60 it has no clear lean; only outside that band does the
  // sentence say moves tend to continue (above) or reverse (below), and always beside the dial's own history: with no
  // history (no scale, or a scope other than the whole market) it says so and nothing else. A reading below the band
  // also says that a change in volatility alone gives such a reading. The band is read on the figure as shown, so the
  // words never disagree with it. Null when there is no reading.
  // It is a second measure beside the follow dial (that dial reads what linked stocks did after a catalyst; this reads the
  // whole market's price memory), so it is named as such, and the two never read as one measure that contradicts itself.
  var HURST_NAME = "The market's price memory (Hurst)";
  var HURST_VOLATILITY_NOTE = "A change in volatility alone pulls this down.";
  var HURST_NO_HISTORY = HURST_NAME + ": there is no history to compare.";
  var HISTORY_SENTENCE = {
    "usual": "That is usual.", "lower than usual": "That is lower than usual.", "higher than usual": "That is higher than usual.",
    "no history to compare": "There is no history to compare.",
  };
  function hurstNote(value, scale, scope) {
    if (!isNum(value)) return null;
    if (!isScale(scale) || !wholeMarket(scope)) return HURST_NO_HISTORY;
    var shown = Math.round(value * 100) / 100;
    var lean = shown > 0.6 ? "moves tend to continue" : shown < 0.4 ? "moves tend to reverse" : "no clear lean";
    var out = HURST_NAME + " " + shown.toFixed(2) + ": " + lean + ". " + HISTORY_SENTENCE[dialWord("hurst", value, scale, scope)];
    return shown < 0.4 ? out + " " + HURST_VOLATILITY_NOTE : out;
  }

  // ---- links ----

  // An http(s) address with a host, no spaces, no control characters, no backslash and no user name; else null.
  var SAFE_URL = /^https?:\/\/[^\x00-\x20\x7f\\\/?#@]+(?:[\/?#][^\x00-\x20\x7f\\]*)?$/i;
  function safeUrl(s) { return typeof s === "string" && SAFE_URL.test(s) ? s : null; }

  // A page of this site with its query and its place on the page, each part optional: "./", "./map.html",
  // "map.html?x=1", "#plate-7", "map.html#day=2019-03-04&now=2026-11-11T14:40:00-05:00". The path is a bare file
  // name, so it leaves no room for a scheme ("javascript:", "data:") or a host after two slashes. Nothing anywhere may
  // be a space, a control character or a backslash.
  var LOCAL_HREF = /^(?:\.\/)?(?:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)?(?:\?[^\x00-\x20\x7f\\#]*)?(?:#[^\x00-\x20\x7f\\]*)?$/;
  function localHref(s) { return typeof s === "string" && s !== "" && LOCAL_HREF.test(s) ? s : null; }

  // ---- the scoreboard ----

  var RUNIN_NOTE = "The live map's first days are run-in days from the closed years. They are shown and never counted.";

  // A card's page (its rules) and its trades are for the private scoreboard only: the private file says `"private": true`
  // and carries them; a public file never says it (the publisher's guard refuses a public card line with a page or trades),
  // so under a public file these two fields are always empty, whatever the rows hold.
  // The stage word as the page shows it: a card that trades on the paper account reads "Trading (paper)"; every other stage
  // is shown as the file gives it.
  var STAGE_WORDS = { trading: "Trading (paper)" };
  function stageLabel(stage) { return typeof stage === "string" ? (STAGE_WORDS.hasOwnProperty(stage) ? STAGE_WORDS[stage] : stage) : ""; }

  var DAY = /^\d{4}-\d{2}-\d{2}$/;
  function points(list) {
    return Array.isArray(list) ? list.filter(function (p) { return Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && DAY.test(p[0]) && isNum(p[1]); })
                                   .map(function (p) { return [p[0], p[1]]; }) : [];
  }
  function objects(list, key) {
    return Array.isArray(list) ? list.filter(function (r) { return r && typeof r === "object" && typeof r[key] === "string"; }) : [];
  }
  // A trading card's real record (private scoreboard only): the sleeve's values, fills and skipped lines. A record that is
  // not an object with a list of values is none: nothing is guessed.
  function realOf(r) {
    if (!r || typeof r !== "object" || !Array.isArray(r.nav)) return null;
    return { since: str(r.since), days: isNum(r.days) ? r.days : 0, nav: points(r.nav), invested_share: isNum(r.invested_share) ? r.invested_share : null,
             fills: objects(r.fills, "ticker"), skipped: objects(r.skipped, "ticker"),
             per_dollar: r.per_dollar && typeof r.per_dollar === "object" ? r.per_dollar : null };
  }

  function scoreboardRows(sb) {
    if (!sb || typeof sb !== "object" || !Array.isArray(sb.entries)) return [];
    var priv = sb.private === true;
    return sb.entries.filter(function (e) { return e && typeof e === "object"; }).map(function (e) {
      return { n: isNum(e.n) ? e.n : null, kind: str(e.kind), name: str(e.name), written: str(e.written),
               stage: stageLabel(e.stage), summary: str(e.summary), report: localHref(e.report),
               page: priv && typeof e.page === "string" && e.page.trim() ? e.page : null, real: priv ? realOf(e.real) : null, pretend: priv && e.real ? points(e.pretend) : [],
               trades: priv && Array.isArray(e.trades) ? e.trades.filter(function (t) { return t && typeof t === "object"; }) : [] };
    });
  }

  // A card's page as blocks, heading or text, one per non-blank line (Markdown marks removed): plain text only.
  function pageBlocks(page) {
    if (typeof page !== "string") return [];
    var out = [];
    page.split(/\r?\n/).forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      var h = /^#{1,6}\s+(.*?)\s*#*$/.exec(t);
      var text = (h ? h[1] : t.replace(/^[-*+]\s+/, "\u2022 ")).replace(/\*\*|`/g, "");
      out.push({ heading: !!h, text: text });
    });
    return out;
  }

  function pctText(v) { return isNum(v) ? trueMinus((Math.round(v * 1000) / 10).toFixed(1)) + "%" : null; }

  // One private trade as a plain sentence: "ZQXT: bought 18 November 2026, still held. It made 2.0%; the S&P 500 made 1.0% over the same days."
  function tradeLine(t) {
    if (!t || typeof t !== "object" || typeof t.ticker !== "string") return "";
    var held = t.exit_day ? "sold " + fmtDay(t.exit_day) : "still held";
    var out = t.ticker + ": bought " + fmtDay(t.entry_day) + ", " + held + ".";
    var mine = pctText(t.ret), mkt = pctText(t.spx_ret);
    out += mine ? " It made " + mine + (mkt ? "; the S&P 500 made " + mkt + " over the same days." : ".") : " Its return is not worked out.";
    if (typeof t.reason === "string" && t.reason) out += " Sold because: " + t.reason + ".";
    if (typeof t.note === "string" && t.note) out += " Note: " + t.note + ".";
    return out;
  }

  // One real fill as a plain sentence: "ZQXT: bought 10 shares at $50.00 on 17 November 2026 (a broker fill)."
  var SOURCE_WORDS = { broker: "a broker fill", cross: "crossed between cards at the close" };
  function fillLine(f) {
    if (!f || typeof f !== "object" || typeof f.ticker !== "string") return "";
    var n = isNum(f.qty) ? f.qty : 0;
    var out = f.ticker + ": " + (f.side === "sell" ? "sold " : "bought ") + n + " " + plural(n, "share", "shares");
    if (isNum(f.price)) out += " at $" + f.price.toFixed(2);
    out += " on " + fmtDay(f.day);
    return SOURCE_WORDS.hasOwnProperty(f.source) ? out + " (" + SOURCE_WORDS[f.source] + ")." : out + ".";
  }
  function skipLine(s) {
    if (!s || typeof s !== "object" || typeof s.ticker !== "string") return "";
    return s.ticker + ": not bought or sold on " + fmtDay(s.day) + (typeof s.reason === "string" && s.reason ? ": " + s.reason : "") + ".";
  }

  // The two accounts of a trading card, each series labelled so the one is never read as the other.
  // One labelled account as a plain sentence: its change against its start, on its last day, over the days drawn.
  function seriesLine(s) {
    if (!s || typeof s !== "object" || typeof s.label !== "string" || !Array.isArray(s.points)) return "";
    if (!s.points.length) return s.label + ": no days yet.";
    var last = s.points[s.points.length - 1];
    return s.label + ": " + pctText(last[1] - 1) + " against its start, on " + fmtDay(last[0]) + ", over " + s.points.length + " " + plural(s.points.length, "day", "days") + ".";
  }

  var PRETEND_LABEL = "Pretend account (what the card would have made, per dollar invested)";
  var REAL_LABEL = "Real paper account (what the card's own share of the paper account made)";
  function recordSeries(pretend, real) {
    return [{ label: PRETEND_LABEL, points: points(pretend) }, { label: REAL_LABEL, points: points(real) }];
  }

  // What the private scoreboard draws under a trading card, as `{ title, lines }` (null for a card with no real record, and
  // so for every card of a public board, whose rows never carry one): the two labelled accounts, then the real fills, then
  // the lines skipped or not filled.
  function realBlocks(row) {
    if (!row || typeof row !== "object" || !row.real) return null;
    var lines = recordSeries(row.pretend, row.real.nav).map(seriesLine);
    row.real.fills.forEach(function (f) { lines.push(fillLine(f)); });
    row.real.skipped.forEach(function (s) { lines.push(skipLine(s)); });
    return { title: "Its real paper account (" + row.real.fills.length + " " + plural(row.real.fills.length, "fill", "fills") + ")",
             lines: lines.filter(Boolean) };
  }

  // A card (a trading rule in a pretend account) is not a look at the closed years, so it never adds to the looks, the tries
  // or the luck: with no count in the file, only the other entries are counted. A card's stage (written, live, retired) is
  // shown as the file gives it.
  function looksIn(rows) { return rows.filter(function (r) { return r.kind !== "card"; }).length; }

  function scoreboardNote(sb) {
    if (!sb || typeof sb !== "object") return "";
    var looks = Math.round(isNum(sb.looks) ? sb.looks : looksIn(scoreboardRows(sb)));
    var tries = isNum(sb.tries) ? Math.round(sb.tries) : looks;
    var lucky = isNum(sb.lucky) ? sb.lucky : Math.round(tries * LUCK_PER_LOOK * 100) / 100;
    return fmtInt(looks) + " " + plural(looks, "look", "looks") + " (" + fmtInt(tries) + " " + plural(tries, "try", "tries") +
           ") at the closed years so far. Luck alone would give at most " + String(lucky) + " " + plural(lucky, "pass", "passes") +
           " at that count. " + LUCK_WORDS;
  }

  // ---- browser only ----

  // Attributes that load or run something. href is checked; the rest are refused.
  var REFUSED_ATTR = /^(?:on.*|src|srcset|srcdoc|action|formaction|poster|xlink:href|data|ping|background|cite)$/i;

  // An element whose text goes in as text. An href is kept only when it is http(s) or a page of this site.
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (REFUSED_ATTR.test(k)) throw new Error("MMWorld.el refuses the attribute " + k);
      if (v == null || v === false) return;
      if (k.toLowerCase() === "href") { v = safeUrl(v) || localHref(v); if (!v) return; }
      node.setAttribute(k, v === true ? "" : String(v));
    });
    if (text != null) node.textContent = String(text);
    return node;
  }

  // Never rejects. "missing": the server has no such file; "damaged": it is not whole JSON;
  // "offline": the request or the server failed.
  function loadJson(url) {
    return new Promise(function (resolve) {
      function fail(why) { return function () { resolve({ ok: false, why: why }); }; }
      try {
        fetch(url, { cache: "no-cache" }).then(function (res) {
          if (!res.ok) return resolve({ ok: false, why: res.status === 404 || res.status === 410 ? "missing" : "offline" });
          return res.text().then(function (body) {
            var data;
            try { data = JSON.parse(body); } catch (e) { return resolve({ ok: false, why: "damaged" }); }
            resolve(data !== null && typeof data === "object" ? { ok: true, data: data } : { ok: false, why: "damaged" });
          }, fail("offline"));
        }).catch(fail("offline"));
      } catch (e) {
        resolve({ ok: false, why: "offline" });
      }
    });
  }

  var MMWorld = {
    fmtInt: fmtInt, fmtDay: fmtDay, fmtTime: fmtTime, yearsText: yearsText, numberWord: numberWord, plural: plural,
    trueMinus: trueMinus, casesLine: casesLine,
    DIALS: DIALS, HURST_INDEX: HURST_INDEX, scaleFromSeries: scaleFromSeries, dialWord: dialWord, hurstNote: hurstNote,
    HURST_NAME: HURST_NAME, HURST_VOLATILITY_NOTE: HURST_VOLATILITY_NOTE, RUNIN_DIAL_WORD: RUNIN_DIAL_WORD, AT_LAST_CLOSE: AT_LAST_CLOSE,
    safeUrl: safeUrl,
    stageLabel: stageLabel, fillLine: fillLine, skipLine: skipLine, recordSeries: recordSeries, seriesLine: seriesLine, realBlocks: realBlocks, PRETEND_LABEL: PRETEND_LABEL, REAL_LABEL: REAL_LABEL,
    scoreboardRows: scoreboardRows, pageBlocks: pageBlocks, tradeLine: tradeLine, scoreboardNote: scoreboardNote, LUCK_WORDS: LUCK_WORDS, RUNIN_NOTE: RUNIN_NOTE,
    el: el, loadJson: loadJson,
  };
  return MMWorld;
})();
if (typeof module === "object" && module.exports) module.exports = MMWorld;
