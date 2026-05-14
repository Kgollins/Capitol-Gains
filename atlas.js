/* MMAtlas: the atlas page. It reads the atlas files that sit beside the page and lays out one numbered plate per
   chart, grouped by the lens the chart belongs to: the chart's own notes under its description, the chart, the line
   that says how many cases it rests on and which years it shows, the page's notes on what the chart draws, and its
   numbers as a table. Everything except start() is pure, and node tests it.
   Text from the files reaches the page as text only (MMWorld.el and text nodes). */
var MMAtlas = (function () {
  "use strict";

  var World = typeof MMWorld !== "undefined" ? MMWorld : (typeof require === "function" ? require("./world.js") : null);
  var Charts = typeof MMCharts !== "undefined" ? MMCharts : (typeof require === "function" ? require("./charts.js") : null);

  var TWINS_NOTE = "Linked stocks minus look-alikes: similar stocks with no link.";
  var SHUFFLED_NOTE = "The real map against shuffled maps: the same stocks with their links shuffled.";
  var BAND_NOTE = "The shaded band shows how far the value could be off by chance: two standard errors either way, counted week by week.";
  // The same bounds drawn as a thin line through a bar or a point, where a chart has no band.
  var BAR_NOTE = "The thin line through each value shows how far it could be off by chance: two standard errors either way, counted week by week.";
  var RANGE_NOTE = "For the shuffled maps, the thin line runs from the lowest map to the highest.";
  // On a line chart MMCharts draws each set of shuffled maps as one hollow range in a strip at the right.
  var STRIP_NOTE = "At the right, each hollow bar is one set of shuffled maps: it runs from the lowest any of them reached on " +
                   "the chart to the highest, and its tick marks their average.";
  // The units in plain words, each said once, on the first plate whose words use it.
  var STOCK_DAY_NOTE = "A stock-day is one stock on one trading day.";
  var SWING_NOTE = "A usual daily swing is how far the stock's move beyond its sector usually runs in a day, over the " +
                   "previous 60 trading days: 1 is an ordinary day's move.";
  var UNIT_NOTES = [[/\bstock-days?\b/i, STOCK_DAY_NOTE], [/\busual (?:daily )?swings?\b/i, SWING_NOTE]];
  // What a case is on a plate where the word alone does not say.
  var SECTOR_CASE_NOTE = "Here a case is a loud stock-day, and the count is that of the busiest week.";
  var CASE_NOTES = { attention_share_by_sector: SECTOR_CASE_NOTE };
  // The mark that says data on the page is made up (a fixture, never the record), in its short form.
  var MADE_UP = "made-up data";

  var MINUS = "\u2212", DASH = "\u2013";
  var DATE_WORDS = /\b\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/;
  var DAY = /^\d{4}-\d{2}-\d{2}$/;

  function group(key, title, line, ids, lenses) {
    return Object.freeze({ key: key, title: title, line: line, ids: Object.freeze(ids), lenses: Object.freeze(lenses) });
  }
  var GROUPS = Object.freeze([
    group("echo", "The echo", "A catalyst is a stone dropped in water. The echo travels outward along the links.",
          ["same_day_pull", "follow_by_day", "follow_by_state", "follow_by_known", "follow_by_year", "wave_by_hop_day", "echo_vs_scrambled"],
          ["echo", "waves"]),
    group("aftershocks", "Aftershocks", "A catalyst is an earthquake. Linked stocks get aftershocks, often at first and then less and less.",
          ["activity_by_day", "cascade_sizes"], ["aftershocks"]),
    group("disease", "How attention spreads",
          "Quiet stocks can catch it. Loud stocks have it. Tired stocks have had it and are immune for a while.",
          ["attention_by_day", "state_shares"], ["disease"]),
    group("predator", "Predator and prey", "Price moves are the grass and attention is the grazers.",
          ["loud_spell_life", "loud_spell_attention", "attention_share_by_sector"], ["predator_prey"]),
    group("flock", "Flocking",
          "Each stock is a bird that follows three rules about the birds near it: head the way they head, drift toward their middle, and do not crowd.",
          ["flock_rules", "flock_alignment"], ["flocking"]),
    group("fractals", "The same shape at every size", "Big moves are rarer than small ones; this shows how much rarer.",
          ["move_sizes"], ["fractals"]),
    group("dials", "The dials over the years", "Six readings of the whole market, one value a week.",
          ["dial_in_step", "dial_contagion", "dial_attention_spread", "dial_follow", "dial_hurst", "dial_hot_spots"], []),
    group("more", "More charts", "", [], []),
  ]);
  // A group's title on a shelf: the live shelf's dials go back only to the first day recorded.
  var LIVE_TITLES = { dials: "The dials since recording began" };
  function groupTitle(key, shelf) {
    var g = GROUPS.filter(function (x) { return x.key === key; })[0];
    return shelf === "live" && LIVE_TITLES[key] ? LIVE_TITLES[key] : g ? g.title : "";
  }

  // The contracts' binding chart ids (Plan R may add more).
  var BINDING_IDS = Object.freeze(["same_day_pull", "follow_by_day", "follow_by_state", "follow_by_year", "follow_by_known",
    "activity_by_day", "attention_by_day", "wave_by_hop_day", "loud_spell_life", "cascade_sizes", "state_shares", "flock_rules",
    "flock_alignment", "attention_share_by_sector", "dial_in_step", "dial_contagion", "dial_attention_spread", "dial_follow",
    "dial_hurst", "dial_hot_spots"]);

  var TWINS_IDS = ["same_day_pull", "activity_by_day", "attention_by_day", "wave_by_hop_day"];   // and every follow_* chart
  // Day-axis charts that the live shelf draws on the explored shelf's y range, so a short live stretch is not blown up.
  var SHARED_SCALE_IDS = ["dial_in_step", "dial_contagion", "dial_attention_spread", "dial_follow", "dial_hurst", "dial_hot_spots",
                          "flock_alignment"];

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function str(v) { return typeof v === "string" ? v : ""; }
  function isChart(c) { return !!c && typeof c === "object" && !Array.isArray(c); }
  function idOf(c) { return isChart(c) && typeof c.id === "string" ? c.id : ""; }
  function isDay(s) { return typeof s === "string" && DAY.test(s); }
  function validRange(r) { return Array.isArray(r) && r.length === 2 && isDay(r[0]) && isDay(r[1]); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function yearsOf(a, b) { return a === b ? String(a) : a + " to " + b; }
  function list(s, key) { return isChart(s) && Array.isArray(s[key]) ? s[key] : []; }

  function isRealDay(s) {
    if (!isDay(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10), t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }
  function xsOf(chart) { return isChart(chart) && chart.x && Array.isArray(chart.x.values) ? chart.x.values : []; }
  function seriesOf(chart) { return isChart(chart) && Array.isArray(chart.series) ? chart.series.filter(isChart) : []; }
  // Whether MMCharts draws anything for the chart, or only its empty frame ("No readings yet.").
  function drawsReadings(chart) {
    var xs = xsOf(chart), S = seriesOf(chart);
    if (chart.kind === "area") return xs.some(function (_, j) { return S.length > 0 && S.every(function (s) { return isNum(list(s, "y")[j]); }); });
    if (chart.kind === "loglog") return S.some(function (s) { return list(s, "y").some(function (v, i) { return isNum(v) && v > 0 && xs[i] > 0; }); });
    return S.some(function (s) { return list(s, "y").some(isNum); });
  }

  // ---- captions ----

  // The years a chart's caption states: its own range (ruling 16), else the atlas range.
  function rangeOf(chart, atlas) {
    if (isChart(chart) && validRange(chart.range)) return chart.range;
    return isChart(atlas) && validRange(atlas.range) ? atlas.range : null;
  }

  // Whether the chart's points rest on different case counts (each series' n, point by point).
  function countsDiffer(chart) {
    var first = null, differ = false;
    seriesOf(chart).forEach(function (s) {
      list(s, "n").forEach(function (v) { if (isNum(v)) { if (first === null) first = v; else if (v !== first) differ = true; } });
    });
    return differ;
  }

  // Whether the per-point counts are in the caption's unit. The atlas format says so one way: the chart's cases equal
  // its largest per-point count. Where they do not (flock alignment counts weeks as cases and stocks as n), the counts
  // are not cases, and the page shows neither "up to" nor a Cases column.
  function countsAreCases(chart) {
    var most = null;
    seriesOf(chart).forEach(function (s) { list(s, "n").forEach(function (v) { if (isNum(v) && (most === null || v > most)) most = v; }); });
    return most !== null && isChart(chart) && isNum(chart.cases) && chart.cases === most;
  }

  // The unit of a chart's per-point counts (its n_label, such as "stock-days"), or null when the file names none.
  function countLabel(chart) {
    return isChart(chart) && typeof chart.n_label === "string" && chart.n_label.trim() ? chart.n_label.trim() : null;
  }

  // The cases-and-years line. Where the points rest on different counts of cases it says "up to" the largest; where
  // the count is the largest per-point count and the file names that count's unit, the unit is the line's noun. A
  // plate whose chart is missing carries none.
  function caption(chart, atlas) {
    if (!isChart(chart)) return "";
    var line = World.casesLine(chart.cases, rangeOf(chart, atlas), isChart(atlas) ? atlas.shelf : null), label = countLabel(chart);
    if (!countsAreCases(chart)) return line;
    if (countsDiffer(chart)) line = line.replace(/^Rests on (?=[\d,]+ cases?\b)/, "Rests on up to ");
    return label ? line.replace(/^(Rests on (?:up to )?[\d,]+ )cases?\b/, function (all, head) { return head + label; }) : line;
  }

  // A chart's own notes (its notes key): plain sentences from the file, blank and non-text entries left out.
  function chartNotes(chart) {
    if (!isChart(chart) || !Array.isArray(chart.notes)) return [];
    return chart.notes.filter(function (s) { return typeof s === "string" && s.trim(); }).map(function (s) { return s.trim(); });
  }
  var NOTES_OPEN = 2;   // a plate shows this many notes of its own; more wait behind "Notes on this plate"
  var RECHECK = /look-alike sets could not be re-checked/i;
  // The file's general note that some look-alike sets could not be re-checked (contracts ruling 20), or "": the page
  // shows it at the top, not only among the notes at the end.
  function recheckNote(atlas) {
    var notes = isChart(atlas) && Array.isArray(atlas.notes) ? atlas.notes : [];
    return notes.filter(function (s) { return typeof s === "string" && RECHECK.test(s); }).map(function (s) { return s.trim(); })[0] || "";
  }

  // On a day axis, the caption's days and the days the chart draws must agree. Where they do not, the plate says so:
  // a reading before the caption's first day or after its last, or caption years the axis does not reach (a weekly
  // point stands for the days of its week, so the axis is compared by years). null when they agree.
  function spanNote(chart, atlas) {
    if (!isChart(chart) || !chart.x || !Array.isArray(chart.x.values) || !chart.x.values.length) return null;
    var xs = chart.x.values, rng = rangeOf(chart, atlas);
    if (Charts.axisType(xs) !== "day" || !rng) return null;
    var year = function (d) { return +d.slice(0, 4); };
    var series = Array.isArray(chart.series) ? chart.series : [], first = -1, last = -1;
    for (var i = 0; i < xs.length; i++) {
      if (series.some(function (s) { return isNum(list(s, "y")[i]); })) { if (first < 0) first = i; last = i; }
    }
    if (first < 0) return null;
    var span = function (a, b) { return a === b ? "on " + World.fmtDay(a) : "from " + World.fmtDay(a) + " to " + World.fmtDay(b); };
    if (xs[first] < rng[0] || xs[last] > rng[1]) {
      return "The chart shows readings " + span(xs[first], xs[last]) + ", but its cases are " + span(rng[0], rng[1]) + ".";
    }
    var r0 = year(rng[0]), r1 = year(rng[1]), a0 = year(xs[0]), a1 = year(xs[xs.length - 1]);
    if (r0 < a0 || r1 > a1) return "The chart shows only " + yearsOf(a0, a1) + ", but its cases are from " + yearsOf(r0, r1) + ".";
    return null;
  }

  // ---- notes ----

  // Whether MMCharts draws the bounds of point i: on a line or a bar, whenever both are there; on a log-log chart, only
  // where the point and its upper bound sit on the log axis. Area and heat charts draw no bounds.
  function drawsBound(kind, s, i, x) {
    var lo = list(s, "lo")[i], hi = list(s, "hi")[i];
    if (!isNum(lo) || !isNum(hi)) return false;
    if (kind === "line" || kind === "bars") return true;
    return kind === "loglog" && isNum(x) && x > 0 && hi > 0;
  }

  // Which marks MMCharts draws for a series' bounds: a shaded band (a line's run of two or more bounded points) or a
  // thin line (a bar, a log-log point, a line's lone bounded point, every bound of a shuffled-maps series).
  function boundMarks(chart, s) {
    var kind = chart.kind, xs = xsOf(chart), n = list(s, "y").length, has = [], i;
    for (i = 0; i < n; i++) has.push(drawsBound(kind, s, i, xs[i]));
    var any = has.some(Boolean);
    if (kind !== "line") return { band: false, bar: any };
    if (Charts.isReference(s)) return { band: false, bar: any };
    var band = false, bar = false;
    for (i = 0; i < n;) {
      if (!has[i]) { i++; continue; }
      var j = i;
      while (j < n && has[j]) j++;
      if (j - i >= 2) band = true; else bar = true;
      i = j;
    }
    return { band: band, bar: bar };
  }

  // The shaded periods (ruling 16: [first_day, last_day, label], or Plan R's earlier {from, to, label}) that the chart
  // draws: a line or area chart, on a day axis, with readings to draw, and a period of real days that meets the axis.
  // The fall note and the numbers table both read this list, so they name only what the chart shows.
  function shadedPeriods(chart) {
    var xs = xsOf(chart);
    if (!isChart(chart) || !Array.isArray(chart.bands) || !xs.length || (chart.kind !== "line" && chart.kind !== "area")) return [];
    if (Charts.axisType(xs) !== "day" || Charts.problem(chart) || !drawsReadings(chart)) return [];
    var first = xs[0], last = xs[xs.length - 1], out = [];
    chart.bands.forEach(function (b) {
      var arr = Array.isArray(b), from = arr ? b[0] : b && b.from, to = arr ? b[1] : b && b.to, label = str(arr ? b[2] : b && b.label).trim();
      if (!isRealDay(from) || !isRealDay(to) || from > to || to < first || from > last) return;
      out.push({ from: from, to: to, label: label });
    });
    return out;
  }

  // Market falls in words, so that a guest knows what the darker stretches are. Labels are quoted as written.
  function fallsNote(chart) {
    var periods = shadedPeriods(chart), labels = [];
    if (!periods.length) return null;
    periods.forEach(function (p) {
      var l = p.label.replace(/[.!?]+$/, "");
      if (l && labels.indexOf(l) < 0) labels.push(l);
    });
    return "The shaded stretches are market falls." + labels.map(function (l) { return " " + l + "."; }).join("");
  }

  function notesFor(chart, atlas) {
    var out = [], id = idOf(chart), band = false, bar = false, spread = false;
    if (TWINS_IDS.indexOf(id) >= 0 || id.indexOf("follow_") === 0) out.push(TWINS_NOTE);
    // MMCharts.isReference alone says which series are shuffled maps, as it does where the chart draws them.
    var xs = xsOf(chart), shuffledDrawn = seriesOf(chart).some(function (s) {
      return Charts.isReference(s) && list(s, "y").some(function (v, i) { return isNum(v) && (chart.kind !== "loglog" || (v > 0 && xs[i] > 0)); });
    });
    if (shuffledDrawn) out.push(SHUFFLED_NOTE);
    var ranged = Charts.refsAsRanges(chart);
    seriesOf(chart).forEach(function (s) {
      var m = boundMarks(chart, s);
      if (Charts.isReference(s)) { if (!ranged && (m.band || m.bar)) spread = true; }
      else { band = band || m.band; bar = bar || m.bar; }
    });
    if (band) out.push(BAND_NOTE);
    if (bar) out.push(BAR_NOTE);
    if (spread) out.push(RANGE_NOTE);
    if (ranged && shuffledDrawn) out.push(STRIP_NOTE);
    var falls = fallsNote(chart);
    if (falls) out.push(falls);
    var span = spanNote(chart, atlas);
    if (span) out.push(span);
    return out;
  }

  // ---- plates ----

  function plateOf(chart, n, key, side) {
    var ok = isChart(chart), why = Charts.problem(chart);
    return {
      n: n, id: idOf(chart), group: key,
      title: ok && typeof chart.title === "string" && chart.title.trim() ? chart.title.trim() : "A chart with no title",
      what: ok && typeof chart.what === "string" ? chart.what.trim() : "",
      chart: chart, caption: caption(ok ? chart : null, side), notes: why ? [] : notesFor(chart, side), problem: why || null,
      madeUp: side.madeUp, chartNotes: chartNotes(chart),
    };
  }

  // The words a plate shows: its title, description, caption, axis names, count unit and own notes.
  function shownWords(p) {
    var c = isChart(p.chart) ? p.chart : {}, x = isChart(c.x) ? c.x.label : "", y = isChart(c.y) ? c.y.label : "";
    return [p.title, p.what, p.caption, str(x), str(y), str(c.n_label)].concat(p.chartNotes).join(" ");
  }
  // Each unit's plain words go first among the notes of the first plate that uses it; a plate's case words go first too.
  function explainUnits(list) {
    UNIT_NOTES.forEach(function (u) {
      for (var i = 0; i < list.length; i++) if (u[0].test(shownWords(list[i]))) { list[i].notes.unshift(u[1]); return; }
    });
    list.forEach(function (p) { if (CASE_NOTES[p.id] && !p.problem) p.notes.unshift(CASE_NOTES[p.id]); });
    return list;
  }

  // The plates of one atlas file, numbered from 1 in group order. A chart joins its group by id; a chart whose id no
  // group names joins the group of its lens, after the named ones, or More charts.
  function plates(atlas, shelf) {
    if (atlas == null) return { problem: "missing", plates: [], missing: [] };
    if (!isChart(atlas) || atlas.version !== 1 || !Array.isArray(atlas.charts) ||
        (shelf && typeof atlas.shelf === "string" && atlas.shelf !== shelf)) return { problem: "damaged", plates: [], missing: [] };
    var side = { range: atlas.range, shelf: shelf || atlas.shelf, madeUp: atlas.demo === true };
    var named = Object.create(null), byLens = Object.create(null), take = Object.create(null);
    GROUPS.forEach(function (g) {
      g.ids.forEach(function (id) { named[id] = g.key; });
      g.lenses.forEach(function (lens) { byLens[lens] = g.key; });
      take[g.key] = { byId: Object.create(null), joined: [] };
    });
    var have = Object.create(null);
    atlas.charts.forEach(function (c) {
      var id = idOf(c), key = named[id];
      have[id] = true;
      if (key) (take[key].byId[id] = take[key].byId[id] || []).push(c);
      else take[(isChart(c) && byLens[c.lens]) || "more"].joined.push(c);
    });
    var out = [];
    GROUPS.forEach(function (g) {
      var mine = [];
      g.ids.forEach(function (id) { mine = mine.concat(take[g.key].byId[id] || []); });
      mine.concat(take[g.key].joined).forEach(function (c) { out.push(plateOf(c, out.length + 1, g.key, side)); });
    });
    return { plates: explainUnits(out), missing: BINDING_IDS.filter(function (id) { return !have[id]; }) };
  }

  // What the page says when the address asks for the live shelf and there is none to show; "" otherwise. The shelf note
  // that follows it says the page shows the explored years.
  var LIVE_ABSENT = {
    missing: "The live record has not started yet.",
    damaged: "The live record could not be read.",
    offline: "The live record could not be loaded.",
  };
  function liveAbsentNote(hash, liveFile, liveOk) {
    var p = parseHash(hash);
    if (liveOk || !p || p.shelf !== "live") return "";
    var why = liveFile && liveFile.ok === false && LIVE_ABSENT[liveFile.why] ? liveFile.why : "missing";
    return LIVE_ABSENT[why];
  }

  function missingText(n) {
    return World.fmtInt(n) + " " + (n === 1 ? "plate is" : "plates are") + " not in this atlas yet.";
  }

  function shelfNote(atlas) {
    if (!isChart(atlas)) return "";
    var r = validRange(atlas.range) ? atlas.range : null;
    var stocks = isNum(atlas.stocks) && atlas.stocks > 0 ? ", for " + World.fmtInt(atlas.stocks) + " stocks" : "";
    if (atlas.shelf === "live") {
      var when = !r ? "" : r[0] === r[1] ? ", on " + World.fmtDay(r[0]) : ", from " + World.fmtDay(r[0]) + " to " + World.fmtDay(r[1]);
      return "Showing the days recorded live on the Pi" + when + stocks + ".";
    }
    if (atlas.shelf === "explored") return "Showing the explored years" + (r ? ", " + World.yearsText(r) : "") + stocks + ".";
    return "";
  }

  // ---- made-up data ----

  // Which parts of the page show made-up data, each by its own file's flag: the plates (the atlas file shown says
  // demo: true) and the scoreboard (scoreboard.json says so). A part whose file is real, or missing, is never marked:
  // the page with no atlas file shows the scoreboard as it is.
  function madeUp(atlas, board) {
    return { plates: isChart(atlas) && atlas.demo === true, scoreboard: isChart(board) && board.demo === true };
  }
  // The masthead's words for what is made up; "" when nothing is.
  function madeUpBadge(m) {
    if (m.plates && m.scoreboard) return "made-up data for building the page";
    if (m.plates) return "made-up data in the plates, for building the page";
    if (m.scoreboard) return "made-up data in the scoreboard, for building the page";
    return "";
  }
  // Whether the contents (the laptop rail and the phone's Contents bar) carry the made-up mark while the place with id
  // `place` is in view: at the scoreboard, the scoreboard's flag; at a plate or the notes, the plates'; above them all
  // (null), the flag of the first part below.
  function markAt(m, place, hasPlates) {
    var p = place ? parseHash("#" + place) : null, kind = p && p.target ? p.target.kind : null;
    if (kind === "scoreboard") return m.scoreboard;
    if (kind === "plate" || kind === "notes") return m.plates;
    return hasPlates ? m.plates : m.scoreboard;
  }

  // The place in view, by index: the last whose top has passed a line 30% down the window. At the end of the page the
  // last place is in view, since nothing below it can pass the line; -1 above them all.
  function placeInView(tops, line, atEnd) {
    if (atEnd && tops.length) return tops.length - 1;
    var at = -1;
    for (var i = 0; i < tops.length; i++) { if (tops[i] <= line) at = i; else break; }
    return at;
  }

  // ---- text in sentences ----

  // A sentence as runs of text and dates. Its figures stay in the sentence's own face (only ticks, tables and counts
  // are set in the sans); a date ("9 November 2026") is kept on one line; a minus before a number is a true minus.
  function sentenceRuns(s) {
    var t = World.trueMinus(str(s)), re = new RegExp(DATE_WORDS.source, "g"), at = 0, out = [], m;
    while ((m = re.exec(t))) {
      if (m.index > at) out.push({ kind: "text", text: t.slice(at, m.index) });
      out.push({ kind: "date", text: m[0] });
      at = m.index + m[0].length;
    }
    if (at < t.length) out.push({ kind: "text", text: t.slice(at) });
    return out;
  }
  // A plate's cases line as runs: its count of cases is a count, set in the sans; the rest is the sentence.
  function captionRuns(line) {
    var m = /^(Rests on (?:up to )?)([\d,]+)(?= )/.exec(str(line));
    if (!m) return sentenceRuns(line);
    return [{ kind: "text", text: m[1] }, { kind: "count", text: m[2] }].concat(sentenceRuns(line.slice(m[0].length)));
  }

  // ---- the numbers table ----

  // A figure with dec decimals, a true minus sign and thousands grouped; a figure that rounds to 0 is "0".
  function fixed(v, dec) {
    var s = Math.abs(v).toFixed(dec);
    if (+s === 0) return "0";
    var parts = s.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (v < 0 ? MINUS : "") + parts.join(".");
  }
  // Figures keep at most four decimals, the atlas file's own precision. Within that, each non-zero value keeps at
  // least two significant figures, so it never reads as a bare 0, and a value too small for four decimals says so.
  // Log-log values span decades, so each keeps three significant figures. Every other kind shares one count of
  // decimals per chart where it can, so that the column lines up: three significant figures of its largest value.
  var MOST_DECIMALS = 4;
  function decimalsFor(v, figures) { return figures - 1 - Math.floor(Math.log10(Math.abs(v)) + 1e-9); }
  function figure(v, dec) {
    if (v === 0) return "0";
    if (Math.abs(v) < 0.00005) return v < 0 ? ">" + MINUS + "0.0001" : "<0.0001";
    return fixed(v, clamp(dec, 0, MOST_DECIMALS));
  }
  function figureFormat(chart, series) {
    if (chart.kind === "loglog") return function (v) { return figure(v, v === 0 ? 0 : decimalsFor(v, 3)); };
    var xs = xsOf(chart), most = 0;
    series.forEach(function (s) {
      list(s, "y").forEach(function (v, i) {
        if (isNum(v)) most = Math.max(most, Math.abs(v));
        if (drawsBound(chart.kind, s, i, xs[i])) most = Math.max(most, Math.abs(list(s, "lo")[i]), Math.abs(list(s, "hi")[i]));
      });
    });
    var dec = most > 0 ? decimalsFor(most, 3) : 0;
    return function (v) { return figure(v, v === 0 ? 0 : Math.max(dec, decimalsFor(v, 2))); };
  }
  function xText(x) {
    if (isNum(x)) return (x < 0 ? MINUS : "") + String(Math.abs(x)).replace(/^\d+/, function (w) { return w.replace(/\B(?=(\d{3})+(?!\d))/g, ","); });
    if (isDay(x)) return World.fmtDay(x);
    return x == null ? "" : String(x);
  }
  function bandLines(chart) {
    return shadedPeriods(chart).map(function (p) {
      var when = World.fmtDay(p.from) + (p.from === p.to ? "" : " to " + World.fmtDay(p.to));
      return p.label ? when + ": " + p.label + (/[.!?]$/.test(p.label) ? "" : ".") : when + ".";
    });
  }
  function sameCounts(a, b, n) {
    for (var i = 0; i < n; i++) {
      var x = list(a, "n")[i], y = list(b, "n")[i];
      if ((isNum(x) ? x : null) !== (isNum(y) ? y : null)) return false;
    }
    return true;
  }

  // The chart as text: one row per x value, one column per series. A value whose bounds the chart draws carries them
  // in brackets; a missing value is a dash. Where the points carry their own counts the counts follow: one column when
  // every series shares them, else a column after each series that has them. They are headed "Cases" when they are in
  // the caption's unit (chart.cases is the largest of them), or by the unit the file names (n_label); with neither,
  // their unit is unknown and they are left out. bands lists the shaded periods the chart draws; ranges says whether
  // any figure carries brackets.
  function tableRows(chart) {
    var out = { head: [], rows: [], bands: [], ranges: false };
    if (!isChart(chart) || !chart.x || !Array.isArray(chart.x.values)) return out;
    var xs = chart.x.values, series = seriesOf(chart), fmt = figureFormat(chart, series), label = countLabel(chart);
    var counted = countsAreCases(chart) || label ? series.filter(function (s) { return list(s, "n").some(isNum); }) : [];
    var shared = counted.length > 0 && counted.length === series.length &&
                 counted.every(function (s) { return sameCounts(s, counted[0], xs.length); });
    var count = function (s, i) { var v = list(s, "n")[i]; return isNum(v) ? World.fmtInt(v) : DASH; };
    out.head = [str(chart.x.label)];
    series.forEach(function (s) {
      out.head.push(str(s.name));
      if (!shared && counted.indexOf(s) >= 0) out.head.push(str(s.name) + ", " + (label || "cases"));
    });
    if (shared) out.head.push(label ? label.charAt(0).toUpperCase() + label.slice(1) : "Cases");
    xs.forEach(function (x, i) {
      var row = [xText(x)];
      series.forEach(function (s) {
        var y = list(s, "y")[i];
        if (!isNum(y)) row.push(DASH);
        else if (drawsBound(chart.kind, s, i, x)) { out.ranges = true; row.push(fmt(y) + " (" + fmt(list(s, "lo")[i]) + " to " + fmt(list(s, "hi")[i]) + ")"); }
        else row.push(fmt(y));
        if (!shared && counted.indexOf(s) >= 0) row.push(count(s, i));
      });
      if (shared) row.push(count(counted[0], i));
      out.rows.push(row);
    });
    out.bands = bandLines(chart);
    return out;
  }

  // ---- the dials today ----

  function chartIn(atlas, id) {
    if (!isChart(atlas) || !Array.isArray(atlas.charts)) return null;
    return atlas.charts.filter(function (c) { return idOf(c) === id; })[0] || null;
  }
  // A dial chart's whole-market readings, found by the series' name and never by its place, so a sector's reading
  // is never worded against the whole market's scale (ruling 22); null when the chart has no such series.
  var WHOLE_MARKET = "Whole market";
  function wholeMarket(chart) {
    var s = chart && Array.isArray(chart.series) ? chart.series.filter(function (x) { return isChart(x) && x.name === WHOLE_MARKET; })[0] : null;
    return s && Array.isArray(s.y) ? s.y : null;
  }

  // The newest week the live dials reach: the latest real day among the last x values of the five dial charts.
  function dialsNewest(live) {
    var newest = null;
    World.DIALS.forEach(function (d) {
      var xs = xsOf(chartIn(live, "dial_" + d.key)), last = xs[xs.length - 1];
      if (isRealDay(last) && (newest === null || last > newest)) newest = last;
    });
    return newest;
  }
  // The explored spread a dial's word is measured against (null when the explored file does not hold it).
  function dialScale(explored, key) {
    var past = wholeMarket(chartIn(explored, "dial_" + key));
    return past ? World.scaleFromSeries(past) : null;
  }

  // Each dial's last live reading, in words, against the spread of its explored history. An older reading of the same
  // chart does not stand in for a missing last one. A dial whose chart ends before the others says so in when.
  function dialsToday(live, explored) {
    var newest = dialsNewest(live);
    return World.DIALS.map(function (d) {
      var c = chartIn(live, "dial_" + d.key), now = wholeMarket(c), xs = xsOf(c), last = xs[xs.length - 1];
      var value = now && now.length && isNum(now[now.length - 1]) ? now[now.length - 1] : null, when = "";
      if (newest && isRealDay(last) && last < newest) {
        var day = World.fmtDay(last);
        when = "week ending " + (last.slice(0, 4) === newest.slice(0, 4) ? day.replace(/ \d{4}$/, "") : day);   // the year only if it differs
      }
      return { name: d.name, word: World.dialWord(d.key, value, dialScale(explored, d.key)), when: when };
    });
  }

  // Whether any of the five dial charts in the live file holds a reading in its newest week. Charts with no points, or
  // with points only in older weeks, say no more than no charts at all, so all of them get the one sentence and no
  // dated line stands over five empty dials.
  function hasDials(live) {
    return World.DIALS.some(function (d) {
      var y = wholeMarket(chartIn(live, "dial_" + d.key));
      return !!y && y.length > 0 && isNum(y[y.length - 1]);
    });
  }
  var NO_DIALS = "The dials: " + World.dialWord("in_step", null, null) + ".";   // "The dials: not enough data yet."

  // The dials whose words compare with the explored years: all five (ruling 22 words hot spots against its history too).
  var COMPARED_DIALS = World.DIALS.map(function (d) { return d.key; });
  // The line over the dials on the live shelf. It dates the reading (the newest real week end of the live dial
  // charts), and says "against the explored years" only when the explored file holds every dial that compares. A live
  // file with no dial readings (no dial charts, or charts with no points) gets one plain sentence instead, and the page
  // lists no dials under it.
  function dialsLead(live, explored) {
    if (!hasDials(live)) return NO_DIALS;
    var newest = dialsNewest(live);
    var compared = COMPARED_DIALS.every(function (key) { return dialScale(explored, key) !== null; });
    return "The dials at the newest reading" + (newest ? ", week ending " + World.fmtDay(newest) : "") +
           (compared ? ", against the explored years" : "") + ":";
  }

  // The y range a live chart is drawn on: for the dials and flock alignment, the extent (values and bounds) of the same
  // chart in the explored atlas; null where there is none, and the chart keeps its own.
  function yRangeFor(id, explored) {
    var past = SHARED_SCALE_IDS.indexOf(id) < 0 ? null : chartIn(explored, id);
    if (!past || Charts.problem(past)) return null;                // a chart that cannot be drawn lends no range
    var lo = Infinity, hi = -Infinity;
    seriesOf(past).forEach(function (s) {
      ["y", "lo", "hi"].forEach(function (k) { list(s, k).forEach(function (v) { if (isNum(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    });
    return lo <= hi ? [lo, hi] : null;
  }

  // The chart's tree at this size. On the live shelf the dials and flock alignment take the explored chart's y range;
  // if that range is refused, the chart is drawn on its own. Only the chart's own faults leave as a ChartError.
  function treeFor(chart, width, height, shelf, explored) {
    var opts = { width: width, height: height, shelf: shelf }, yRange = shelf === "live" ? yRangeFor(idOf(chart), explored) : null;
    if (yRange) {
      try { return Charts.chartTree(chart, { width: width, height: height, shelf: shelf, yRange: yRange }); }
      catch (e) { if (!(e instanceof Charts.ChartError)) throw e; }
    }
    return Charts.chartTree(chart, opts);
  }

  // The address names the shelf and the place: "" and "#live", "#plate-7" and "#live-plate-7", "#notes",
  // "#live-notes", "#scoreboard", "#live-scoreboard". Any other "#live-..." is the live shelf's base form; any other
  // address is not this page's (null).
  function parseHash(hash) {
    var h = typeof hash === "string" ? hash.replace(/^#/, "") : "";
    if (h === "") return { shelf: "explored", target: null };
    if (h === "live") return { shelf: "live", target: null };
    var m = /^(live-)?(?:plate-([1-9]\d*)|(notes|scoreboard))$/.exec(h);
    if (!m) return /^live-/.test(h) ? { shelf: "live", target: null } : null;
    return { shelf: m[1] ? "live" : "explored", target: m[2] ? { kind: "plate", n: +m[2] } : { kind: m[3] } };
  }
  function hashFor(shelf, target) {
    var live = shelf === "live", place = !target ? "" : target.kind === "plate" ? "plate-" + target.n : target.kind;
    return place ? "#" + (live ? "live-" : "") + place : live ? "#live" : "";
  }
  // The address to write instead of this one, so that the address and the shelf on screen always agree; null when it
  // can stand. A live address with no live shelf becomes the explored one; a loose live form becomes its base form;
  // an address this page does not name, while the live shelf shows, becomes "#live".
  function settleHash(hash, liveOk, shown) {
    var h = hash === "#" ? "" : hash, p = parseHash(h);
    if (!p) return shown === "live" ? "#live" : null;
    if (p.shelf === "live" && !liveOk) return hashFor("explored", p.target);
    var plain = hashFor(p.shelf, p.target);
    return plain !== h ? plain : null;
  }

  // The Contents list below 1024px lies over the page while open. It closes when focus moves to something outside it
  // (Tab past its last row), so no control hidden under it ever takes focus; when a press lands outside it, whether or
  // not focus was inside (Safari does not focus a tapped bar); and on Escape, which returns focus to its bar. Focus
  // that goes nowhere (a press on a heading or a gap inside the list, or the window losing focus) leaves it open.
  function watchToc(toc, doc) {
    if (!toc) return;
    toc.addEventListener("focusout", function (e) {
      if (toc.open && e.relatedTarget && !toc.contains(e.relatedTarget)) toc.open = false;
    });
    doc.addEventListener("pointerdown", function (e) {
      if (toc.open && !toc.contains(e.target)) toc.open = false;
    });
    toc.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !toc.open) return;
      e.preventDefault();
      toc.open = false;
      var bar = toc.querySelector("summary");
      if (bar) bar.focus();
    });
  }

  // Whether a page of this site answers (a HEAD request). Never rejects and logs nothing.
  function pageExists(url) {
    return new Promise(function (resolve) {
      try {
        fetch(url, { method: "HEAD", cache: "no-cache" }).then(function (res) { resolve(!!res && res.ok === true); }, function () { resolve(false); });
      } catch (e) {
        resolve(false);
      }
    });
  }

  // ---- the page (browser only) ----

  var STATES = {
    missing: "The atlas has not been built yet.",
    damaged: "The atlas file could not be read.",
    offline: "The atlas could not be loaded. Check the connection and reload.",
  };
  var SCOREBOARD_STATES = {
    missing: "The scoreboard has not been published yet.",
    damaged: "The scoreboard file could not be read.",
    offline: "The scoreboard could not be loaded. Check the connection and reload.",
  };
  var WIDEST = 760;

  function start(doc) {
    var win = doc.defaultView, el = World.el;
    var main = doc.getElementById("atlas-main");
    if (!main) return;
    var rail = doc.getElementById("atlas-rail"), toc = doc.getElementById("atlas-toc"), tocNav = doc.getElementById("atlas-toc-nav");
    var note = doc.getElementById("atlas-shelf-note"), demo = doc.getElementById("atlas-demo"), shelfBox = doc.getElementById("atlas-shelf");
    var tocMark = doc.getElementById("atlas-toc-mark"), warn = doc.getElementById("atlas-shelf-warn");
    var state = { files: null, shelf: "explored", liveLoaded: false, liveOk: false, liveNote: "", entries: [], observer: null, buttons: null, today: null,
                  marks: [], current: null, made: { plates: false, scoreboard: false }, hasPlates: false, railMark: null };
    var byBox = new Map();

    function text(s) { return doc.createTextNode(s); }
    function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
    // Runs into a node: text as text, a date in a span that never breaks, a count in the sans.
    function fillRuns(node, runs) {
      runs.forEach(function (r) {
        node.appendChild(r.kind === "text" ? text(r.text) : el("span", { class: r.kind === "date" ? "date" : "fig" }, r.text));
      });
      return node;
    }
    function fillFigured(node, s) { return fillRuns(node, sentenceRuns(s)); }
    function figured(tag, attrs, s) { return fillFigured(el(tag, attrs), s); }
    function madeUpMark(tag, cls) {
      var box = el(tag, { class: cls });
      box.appendChild(el("span", { class: "quietbadge" }, MADE_UP));
      return box;
    }
    function problemLine(why) { return el("p", { class: "chart-problem" }, "This chart could not be drawn: " + why + "."); }
    // A place's id is its address on this shelf without the "#": plate-7 or live-plate-7, notes or live-notes.
    function placeId(target) { return hashFor(state.shelf, target).slice(1); }
    function exploredAtlas() { var f = state.files.explored; return f.ok && isChart(f.data) && Array.isArray(f.data.charts) ? f.data : null; }

    function chartHeight() { var w = win.innerWidth || 1024; return w >= 1024 ? 300 : w >= 640 ? 260 : 220; }
    // Room kept for a chart not drawn yet, near what it will take, so the page moves little as charts arrive.
    function roomFor(chart, h) {
      var n = Array.isArray(chart.series) ? chart.series.length : 1;
      if (chart.kind === "area" && n > 4) return n * 44 + 60;
      return h + (n > 1 ? 24 : 0);
    }

    function draw(entry) {
      var width = Math.min(WIDEST, Math.floor(entry.box.clientWidth)), height = chartHeight();
      if (!(width > 0) || (entry.drawn && entry.width === width && entry.height === height)) return;
      entry.drawn = true; entry.width = width; entry.height = height;
      try {
        var tree = treeFor(entry.plate.chart, width, height, state.shelf, exploredAtlas());
        var old = entry.box.querySelector(".chart-problem");
        if (old) entry.box.removeChild(old);
        Charts.mount(tree, entry.box);
      } catch (e) {
        clear(entry.box);
        entry.box.appendChild(problemLine(e instanceof Charts.ChartError ? e.message : "something in it could not be drawn"));
      }
      entry.box.classList.remove("pending");
      entry.box.style.minHeight = "";
    }

    // Charts are drawn as their plates near the screen; without an observer, all at once.
    function observe() {
      if (state.observer) state.observer.disconnect();
      state.observer = null;
      if (typeof win.IntersectionObserver !== "function") { state.entries.forEach(draw); return; }
      state.observer = new win.IntersectionObserver(function (seen) {
        seen.forEach(function (s) {
          var entry = byBox.get(s.target);
          if (!s.isIntersecting || !entry) return;
          state.observer.unobserve(s.target);
          draw(entry);
        });
      }, { rootMargin: "600px 0px" });
      state.entries.forEach(function (e) { state.observer.observe(e.box); });
    }

    function numbers(p) {
      var box = el("details", { class: "numbers" }), built = false;
      box.appendChild(el("summary", null, "The numbers"));
      box.addEventListener("toggle", function () {
        if (!box.open || built) return;
        built = true;
        var t = tableRows(p.chart);
        var wrap = el("div", { class: "tablewrap", role: "region", tabindex: "0", "aria-label": "The numbers of plate " + p.n });
        var table = el("table"), head = el("tr"), body = el("tbody");
        table.appendChild(el("caption", { class: "vh" }, p.title));
        t.head.forEach(function (h) { head.appendChild(el("th", { scope: "col" }, h)); });
        table.appendChild(el("thead")).appendChild(head);
        t.rows.forEach(function (r) {
          var tr = el("tr");
          r.forEach(function (cell, i) { tr.appendChild(i ? el("td", null, cell) : el("th", { scope: "row" }, cell)); });
          body.appendChild(tr);
        });
        table.appendChild(body);
        wrap.appendChild(table);
        box.appendChild(wrap);
        if (t.rows.some(function (r) { return r.indexOf(DASH, 1) > 0; })) box.appendChild(el("p", { class: "tablenote" }, "A dash means no reading."));
        if (t.ranges) {
          box.appendChild(el("p", { class: "tablenote" }, Charts.refsAsRanges(p.chart)
            ? "Figures in brackets give the range of each figure; the chart joins the shuffled maps' ranges into one bar each."
            : "Figures in brackets give the range drawn on the chart."));
        }
        if (t.bands.length) {
          box.appendChild(el("p", { class: "tablenote" }, "Shaded on the chart:"));
          var ul = el("ul", { class: "tablenote bands" });
          t.bands.forEach(function (b) { ul.appendChild(figured("li", null, b)); });
          box.appendChild(ul);
        }
      });
      return box;
    }

    function plateSection(p) {
      var id = placeId({ kind: "plate", n: p.n });
      var sec = el("section", { class: "atlas-plate", id: id, "aria-labelledby": id + "-title", tabindex: "-1" });
      state.marks.push(sec);
      var h = el("h3", { id: id + "-title" }), num = el("span", { class: "num" });
      num.appendChild(text("Plate "));
      num.appendChild(el("span", { class: "fig" }, String(p.n)));
      num.appendChild(text("."));
      h.appendChild(num);
      h.appendChild(text(" " + p.title));
      sec.appendChild(h);
      if (p.what) sec.appendChild(figured("p", { class: "what" }, p.what));
      if (p.chartNotes.length) sec.appendChild(plateNotes(p.chartNotes));
      var fig = el("figure", { class: "figure" }), box = el("div", { class: "chart" });
      fig.appendChild(box);
      if (p.caption) {
        var cap = fillRuns(el("figcaption", { class: "caption" }), captionRuns(p.caption));
        if (p.madeUp) { cap.appendChild(text(" ")); cap.appendChild(el("span", { class: "quietbadge" }, MADE_UP)); }
        fig.appendChild(cap);
      }
      sec.appendChild(fig);
      if (p.problem) box.appendChild(problemLine(p.problem));
      else {
        box.classList.add("pending");
        box.style.minHeight = roomFor(p.chart, chartHeight()) + "px";
        var entry = { plate: p, box: box, drawn: false };
        state.entries.push(entry);
        byBox.set(box, entry);
      }
      if (p.notes.length) {
        var ul = el("ul", { class: "notes" });
        p.notes.forEach(function (n) { ul.appendChild(figured("li", null, n)); });
        sec.appendChild(ul);
      }
      if (!p.problem) sec.appendChild(numbers(p));
      return sec;
    }

    // A plate's own notes under its description: one or two always in view, more behind a disclosure that opens.
    function plateNotes(notes) {
      var ul = el("ul", { class: "plate-notes" });
      notes.forEach(function (n) { ul.appendChild(figured("li", null, n)); });
      if (notes.length <= NOTES_OPEN) return ul;
      var box = el("details", { class: "plate-notes-box" });
      box.appendChild(el("summary", null, "Notes on this plate"));
      box.appendChild(ul);
      return box;
    }

    function groupsOf(list) {
      var out = [];
      list.forEach(function (p) {
        if (!out.length || out[out.length - 1].key !== p.group) {
          var g = GROUPS.filter(function (x) { return x.key === p.group; })[0];
          out.push({ key: g.key, title: groupTitle(g.key, state.shelf), line: g.line, plates: [] });
        }
        out[out.length - 1].plates.push(p);
      });
      return out;
    }

    function groupSection(g) {
      var sec = el("section", { class: "group", "aria-labelledby": "group-" + g.key });
      sec.appendChild(el("h2", { id: "group-" + g.key }, g.title));
      if (g.line) sec.appendChild(el("p", { class: "group-line" }, g.line));
      g.plates.forEach(function (p) { sec.appendChild(plateSection(p)); });
      return sec;
    }

    function notesSection(lines) {
      var sec = el("section", { class: "closing", id: placeId({ kind: "notes" }), "aria-labelledby": "notes-title", tabindex: "-1" });
      state.marks.push(sec);
      sec.appendChild(el("h2", { id: "notes-title" }, "Notes"));
      var ul = el("ul", { class: "closing-notes" });
      lines.forEach(function (s) { ul.appendChild(figured("li", null, s)); });
      sec.appendChild(ul);
      return sec;
    }

    function kindWord(kind) { return kind ? (/^[aeiou]/i.test(kind) ? "An " : "A ") + kind : ""; }
    function sentence(s) { s = s.trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".") : ""; }

    function scoreboardSection() {
      var sec = el("section", { class: "closing", id: placeId({ kind: "scoreboard" }), "aria-labelledby": "scoreboard-title", tabindex: "-1" });
      state.marks.push(sec);
      sec.appendChild(el("h2", { id: "scoreboard-title" }, "The scoreboard"));
      if (state.made.scoreboard) sec.appendChild(madeUpMark("p", "madeup-line"));
      sec.appendChild(el("p", { class: "closing-lede" },
        "Every lens (an idea of how the market behaves) and every card (a trading rule) written so far, and where each one stands."));
      var f = state.files.scoreboard, rows = f.ok ? World.scoreboardRows(f.data) : [];
      if (!rows.length) sec.appendChild(el("p", { class: "state" }, SCOREBOARD_STATES[f.ok ? "missing" : f.why] || SCOREBOARD_STATES.missing));
      else {
        var ol = el("ol", { class: "scoreboard" });
        rows.forEach(function (r) {
          var li = el("li", { class: "entry" }), h = el("h3", { class: "entry-name" });
          if (r.n != null) { h.appendChild(el("span", { class: "fig" }, World.fmtInt(r.n) + ".")); h.appendChild(text(" ")); }
          h.appendChild(text(r.name || "An entry with no name"));
          li.appendChild(h);
          var meta = sentence([kindWord(r.kind), r.written ? "written " + World.fmtDay(r.written) : ""].filter(Boolean).join(", "));
          var stage = sentence(r.stage);
          if (meta || stage) li.appendChild(figured("p", { class: "entry-meta" }, [meta, stage].filter(Boolean).join(" ")));
          if (r.summary) li.appendChild(figured("p", { class: "entry-summary" }, r.summary));
          if (r.report) li.appendChild(el("p", { class: "entry-link" })).appendChild(el("a", { href: r.report }, "Read the report"));
          ol.appendChild(li);
        });
        sec.appendChild(ol);
        var sn = World.scoreboardNote(f.data);
        if (sn) sec.appendChild(figured("p", { class: "closing-note" }, sn));
      }
      if (state.liveLoaded) sec.appendChild(el("p", { class: "closing-note" }, World.RUNIN_NOTE));
      return sec;
    }

    function contents(groups, hasNotes) {
      var ol = el("ol", { class: "contents" });
      groups.forEach(function (g) {
        var li = ol.appendChild(el("li", { class: "contents-group" }));
        li.appendChild(el("span", { class: "contents-title colony" }, g.title));
        var inner = li.appendChild(el("ol", { class: "contents-plates" }));
        g.plates.forEach(function (p) {
          var a = inner.appendChild(el("li")).appendChild(el("a", { href: hashFor(state.shelf, { kind: "plate", n: p.n }) }));
          a.appendChild(el("span", { class: "fig" }, String(p.n)));
          a.appendChild(el("span", { class: "contents-name" }, p.title));
        });
      });
      var end = ol.appendChild(el("li", { class: "contents-group contents-end" })).appendChild(el("ol", { class: "contents-plates" }));
      if (hasNotes) {
        end.appendChild(el("li")).appendChild(el("a", { href: hashFor(state.shelf, { kind: "notes" }) }))
          .appendChild(el("span", { class: "contents-name" }, "Notes"));
      }
      end.appendChild(el("li")).appendChild(el("a", { href: hashFor(state.shelf, { kind: "scoreboard" }) }))
        .appendChild(el("span", { class: "contents-name" }, "The scoreboard"));
      return ol;
    }

    function buildSwitch() {
      clear(shelfBox);
      if (!state.liveOk) { shelfBox.hidden = true; return; }
      var row = shelfBox.appendChild(el("div", { class: "switch", role: "group", "aria-label": "Which days the plates show" }));
      state.buttons = {};
      [["explored", "The explored years"], ["live", "Live on the Pi"]].forEach(function (b) {
        var btn = row.appendChild(el("button", { type: "button", class: "textbutton", "aria-pressed": "false" }, b[1]));
        btn.addEventListener("click", function () { setShelf(b[0]); });
        state.buttons[b[0]] = btn;
      });
      state.today = shelfBox.appendChild(el("div", { class: "today" }));
      shelfBox.hidden = false;
    }

    // The address follows the page. The switch adds a step to the history, so Back returns to the other shelf.
    function writeHash(hash, push) {
      var to = hash || win.location.pathname + win.location.search;
      try { win.history[push ? "pushState" : "replaceState"](null, "", to); }
      catch (e) { if (push) win.location.hash = hash; }
    }
    function setShelf(shelf) {
      if (shelf === state.shelf) return;
      state.shelf = shelf;
      writeHash(hashFor(shelf, null), true);
      render();
    }

    function render() {
      var f = state.files, file = state.shelf === "live" ? f.live : f.explored;
      var atlas = file.ok ? file.data : null;
      var out = file.ok ? plates(atlas, state.shelf) : { problem: STATES[file.why] ? file.why : "offline", plates: [], missing: [] };

      var sn = [state.shelf === "explored" ? state.liveNote : "", out.problem ? "" : shelfNote(atlas)].filter(Boolean).join(" ");
      clear(note);
      fillFigured(note, sn);
      note.hidden = !sn;
      var rc = out.problem ? "" : recheckNote(atlas);
      if (warn) { clear(warn); fillFigured(warn, rc); warn.hidden = !rc; }
      state.made = madeUp(out.problem ? null : atlas, f.scoreboard.ok ? f.scoreboard.data : null);
      state.hasPlates = out.plates.length > 0;
      demo.textContent = madeUpBadge(state.made);
      demo.hidden = !demo.textContent;
      if (state.buttons) {
        Object.keys(state.buttons).forEach(function (k) { state.buttons[k].setAttribute("aria-pressed", k === state.shelf ? "true" : "false"); });
        clear(state.today);
        state.today.hidden = state.shelf !== "live";
        if (state.shelf === "live") {
          state.today.appendChild(figured("p", { class: "today-lead" }, dialsLead(f.live.data, exploredAtlas())));
          var ul = hasDials(f.live.data) ? state.today.appendChild(el("ul", { class: "today-list" })) : null;
          (ul ? dialsToday(f.live.data, exploredAtlas()) : []).forEach(function (d) {
            var li = ul.appendChild(el("li"));
            li.appendChild(text(d.name + ": "));
            li.appendChild(el("em", null, d.word));
            if (d.when) li.appendChild(fillFigured(el("span", { class: "when" }), " (" + d.when + ")"));
          });
        }
      }

      if (state.observer) state.observer.disconnect();
      state.entries = [];
      state.marks = [];
      state.current = undefined;                   // so the contents and their made-up mark are set afresh below
      byBox.clear();
      clear(main);
      var groups = [];
      if (out.problem) main.appendChild(el("p", { class: "state" }, STATES[out.problem]));
      else {
        if (out.missing.length) main.appendChild(el("p", { class: "state" }, missingText(out.missing.length)));
        groups = groupsOf(out.plates);
        groups.forEach(function (g) { main.appendChild(groupSection(g)); });
      }
      var lines = !out.problem && Array.isArray(atlas.notes) ? atlas.notes.filter(function (s) { return typeof s === "string" && s.trim(); }) : [];
      if (lines.length) main.appendChild(notesSection(lines));
      main.appendChild(scoreboardSection());

      clear(rail);
      state.railMark = rail.appendChild(madeUpMark("p", "railmark"));   // kept in view at the rail's top while it scrolls
      rail.appendChild(contents(groups, lines.length > 0));
      clear(tocNav);
      tocNav.appendChild(contents(groups, lines.length > 0));
      toc.hidden = false;
      observe();
      markCurrent();
    }

    // The contents mark the place in view (aria-current), and the laptop rail keeps that row in sight.
    function markCurrent() {
      var h = win.innerHeight || 800, root = doc.documentElement;
      var atEnd = (win.scrollY || 0) + h >= root.scrollHeight - 2;
      var at = placeInView(state.marks.map(function (m) { return m.getBoundingClientRect().top; }), h * 0.3, atEnd);
      var now = at < 0 ? null : state.marks[at].id;
      if (now === state.current) return;
      state.current = now;
      var show = markAt(state.made, now, state.hasPlates);
      if (state.railMark) state.railMark.hidden = !show;
      if (tocMark) tocMark.hidden = !show;
      [rail, tocNav].forEach(function (nav) {
        Array.prototype.forEach.call(nav.querySelectorAll("a[aria-current]"), function (a) { a.removeAttribute("aria-current"); });
        var a = now ? nav.querySelector('a[href="#' + now + '"]') : null;
        if (!a) return;
        a.setAttribute("aria-current", "location");
        var box = nav.getBoundingClientRect(), row = a.getBoundingClientRect();
        if (nav !== rail || !box.height) return;
        if (row.top < box.top + 12) nav.scrollTop -= box.top + 12 - row.top;
        else if (row.bottom > box.bottom - 12) nav.scrollTop += row.bottom - (box.bottom - 12);
      });
    }

    // A place on the page: the charts above it are drawn first, so it stays where it lands.
    function goTo(target) {
      var place = doc.getElementById(placeId(target));
      if (!place) return;
      state.entries.forEach(function (e) { if (target.kind !== "plate" || e.plate.n <= target.n) draw(e); });
      place.scrollIntoView();
      place.focus({ preventScroll: true });
      markCurrent();
    }
    // The address decides the shelf and the place, on load, on a link, and on Back and Forward. A live address with no
    // live shelf is rewritten to the explored one. An address this page does not name (the skip link's) changes nothing.
    function applyHash() {
      var want = parseHash(win.location.hash), fix = settleHash(win.location.hash, state.liveOk, state.shelf);
      var said = liveAbsentNote(win.location.hash, state.files.live, state.liveOk), again = said !== state.liveNote;
      if (again) state.liveNote = said;   // the note follows the request: asking for the explored years clears it
      if (fix !== null) { writeHash(fix, false); want = parseHash(fix); }
      if (!want) { if (again) render(); return; }
      if (want.shelf !== state.shelf || again) { state.shelf = want.shelf; render(); }
      if (want.target) goTo(want.target);
    }

    tocNav.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("a")) toc.open = false; });
    watchToc(toc, doc);
    var timer = null;
    win.addEventListener("resize", function () {
      if (timer) win.clearTimeout(timer);
      timer = win.setTimeout(function () {
        timer = null;
        var h = chartHeight();
        state.entries.forEach(function (e) { if (e.drawn) draw(e); else e.box.style.minHeight = roomFor(e.plate.chart, h) + "px"; });
        state.current = null;
        markCurrent();
      }, 150);
    });
    var marking = false;
    win.addEventListener("scroll", function () {
      if (marking) return;
      marking = true;
      win.requestAnimationFrame(function () { marking = false; markCurrent(); });
    }, { passive: true });

    // The skip link moves focus to the plates without writing "#atlas-main", so the address keeps its shelf.
    var skip = doc.querySelector(".skip");
    if (skip) skip.addEventListener("click", function (e) { e.preventDefault(); main.focus(); main.scrollIntoView(); });

    // The ripple map ships after the atlas, so its link shows only once map.html answers.
    var mapLink = doc.getElementById("atlas-map-link");
    if (mapLink) pageExists("map.html").then(function (yes) { mapLink.hidden = !yes; });

    main.appendChild(el("p", { class: "state" }, "Loading the atlas."));
    Promise.all([World.loadJson("atlas-explored.json"), World.loadJson("atlas-live.json"), World.loadJson("scoreboard.json")]).then(function (r) {
      state.files = { explored: r[0], live: r[1], scoreboard: r[2] };
      var live = r[1].ok ? plates(r[1].data, "live") : null;
      state.liveLoaded = !!live && !live.problem;
      state.liveOk = state.liveLoaded && live.plates.length > 0;
      state.liveNote = liveAbsentNote(win.location.hash, r[1], state.liveOk);   // asked for live, and there is none yet
      var fix = settleHash(win.location.hash, state.liveOk);
      if (fix !== null) writeHash(fix, false);
      var first = parseHash(win.location.hash);
      state.shelf = first ? first.shelf : "explored";
      buildSwitch();
      render();
      win.addEventListener("hashchange", applyHash);
      win.addEventListener("popstate", applyHash);
      if (first && first.target) goTo(first.target);
    });
  }

  var MMAtlas = {
    GROUPS: GROUPS, BINDING_IDS: BINDING_IDS,
    TWINS_NOTE: TWINS_NOTE, SHUFFLED_NOTE: SHUFFLED_NOTE, BAND_NOTE: BAND_NOTE, BAR_NOTE: BAR_NOTE, RANGE_NOTE: RANGE_NOTE,
    STRIP_NOTE: STRIP_NOTE, STOCK_DAY_NOTE: STOCK_DAY_NOTE, SWING_NOTE: SWING_NOTE, SECTOR_CASE_NOTE: SECTOR_CASE_NOTE,
    liveAbsentNote: liveAbsentNote, MADE_UP: MADE_UP, madeUp: madeUp, madeUpBadge: madeUpBadge, markAt: markAt, placeInView: placeInView,
    sentenceRuns: sentenceRuns, captionRuns: captionRuns,
    plates: plates, caption: caption, spanNote: spanNote, tableRows: tableRows, shelfNote: shelfNote, missingText: missingText,
    chartNotes: chartNotes, recheckNote: recheckNote, NOTES_OPEN: NOTES_OPEN,
    shadedPeriods: shadedPeriods, groupTitle: groupTitle, dialsToday: dialsToday, dialsLead: dialsLead, yRangeFor: yRangeFor,
    parseHash: parseHash, hashFor: hashFor, settleHash: settleHash, pageExists: pageExists, treeFor: treeFor, hasDials: hasDials,
    watchToc: watchToc, start: start,
  };

  // The page starts itself: atlas.html carries no inline script.
  if (typeof document !== "undefined" && document && typeof document.getElementById === "function") {
    var boot = function () { if (document.getElementById("atlas-main")) start(document); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  }
  return MMAtlas;
})();
if (typeof module === "object" && module.exports) module.exports = MMAtlas;
