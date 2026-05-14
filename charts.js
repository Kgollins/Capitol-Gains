/* MMCharts: the atlas's charts, drawn as plain trees of SVG parts ({t: tag, a: attributes, c: children, x: text}),
   and the one function that mounts a tree into the page. A tree carries classes only. world.css owns every colour,
   so the live shelf, the market falls and the heat levels change colour there and nowhere else. Everything here
   except mount is pure geometry.
   Nothing is ever written over a plot: a break in a line means "no reading", so a name cut into a line would read
   as a reading that is not there. Series are named in a key above the plot instead, and they differ by form as well
   as by tone, so that the key can tell them apart. A series that is an attention state (quiet, loud, tired) is keyed
   by its state, the same on every chart, with the map's own cap form as its mark. */
var MMCharts = (function () {
  "use strict";

  var World = typeof MMWorld !== "undefined" ? MMWorld : (typeof require === "function" ? require("./world.js") : null);

  var NS = "http://www.w3.org/2000/svg";
  var KINDS = ["line", "bars", "loglog", "heat", "area"];
  var MARGIN = { left: 44, right: 12, top: 18, bottom: 34 };
  // The type sizes world.css gives the chart text. They are used here only to estimate how much room a label takes,
  // so the estimates lean wide: a label given too much room looks the same, a label given too little collides.
  var TICK_PX = 11, LABEL_PX = 12.5, CAT_PX = 12, SANS_EM = 0.58, SERIF_EM = 0.53, ITALIC_EM = 0.47;
  // The boxes text takes, measured in the browser: an 11px figure rises 11px above its baseline, and a 12.5px italic
  // name falls 4px below its own. A figure's baseline sits 3.8px under its gridline.
  var FIG_UP = 11, NAME_DOWN = 4, FIG_DROP = 3.8;
  var KEY_ROW = 17;           // the height of one row of the key
  var CAP_SW = 19;            // the room an attention state's cap mark takes in the key, its gap to the name included
  var RANGE_PITCH = 12;       // the distance between two shuffled-maps ranges in the strip at the right of a line chart
  var RANGE_STRIP = 56;       // that strip's least width, so its name fits under it
  var LONE_INSET = 26;        // how far a chart's single reading stands in from the plot's edge
  var DAY_GAP = 60;           // the least distance between two day labels
  var LINE_STEP = 13;         // the distance between two lines of one name
  var YNAME_STEP = 15;        // the distance between two lines of the y axis's name (12.5px italic)
  var BAR_PITCH = 8;          // a horizontal bar and the gap under it: bars are at least 6px thick
  // A value further from 0 than BIGGEST is refused. A value nearer to 0 than TINY is read as 0 wherever values are
  // read: such a value is float noise (5.6e-17 for 0.3 - 0.1 * 3), and on a log axis it would stand decades below the rest.
  var BIGGEST = 1e12, TINY = 1e-12;
  var MOST_POINTS = 400000, MOST_CATEGORIES = 2000, MOST_SERIES = 60, MOST_TICKS = 10000;
  var NARROWEST = 120, WIDEST = 4000, LOWEST = 80, HIGHEST = 4000;
  var ROWS_ABOVE = 4;         // an area of more series than this is drawn as rows, one strip per series
  // A row of the rows chart: 28px from its base to its drawn ceiling (a full row). In the name column the next row's
  // ceiling stands 8px under this row's base. With names above, a name's baseline stands 5px over its own ceiling,
  // and its capitals (9px tall) keep 10px from the base of the row above, so a name reads with the strip under it.
  var ROW_STRIP = 28, ROW_GAP = 8, NAME_LIFT = 5, NAME_CAP = 9, NAME_CLEAR = 10;
  var SHAPES = ["circle", "square", "up", "diamond", "down", "cross"];
  var STATES = ["quiet", "loud", "tired"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
  // Plan R names a shuffled-maps series "Shuffled maps (average of 20)" or "Alignment, shuffled maps (average of 20)".
  // The atlas format carries no other mark of one, so the name is read, whole words only, in any case.
  var REFERENCE = /(?:^|,\s*)(?:shuffled|scrambled) maps?(?=\s*(?:\(|,|$))/i;
  var PART = { y: "values", lo: "lower bounds", hi: "upper bounds", n: "case counts" };
  var ONE = { y: "a value", lo: "a lower bound", hi: "an upper bound", n: "a case count" };
  var MINUS = "\u2212", ELLIPSIS = "\u2026";
  var NO_READINGS = "No readings yet.";
  var TAGS = /^(?:svg|g|path|line|rect|circle|text)$/;
  var ATTRS = /^(?:class|role|aria-label|viewBox|width|height|x|y|x1|y1|x2|y2|cx|cy|r|d|text-anchor)$/;

  class ChartError extends Error {
    constructor(message) { super(message); this.name = "ChartError"; }
  }

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function str(v) { return typeof v === "string" ? v : ""; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] || 0; return s; }
  function minOf(a) { var m = Infinity; for (var i = 0; i < a.length; i++) if (a[i] < m) m = a[i]; return m; }
  function maxOf(a) { var m = -Infinity; for (var i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }
  function count(n, one) { return n + " " + one + (n === 1 ? "" : "s"); }
  function snap(v) { return Math.abs(v) < TINY ? 0 : v; }

  // ---- the parts of a tree ----

  function node(t, a, c, x) {
    var n = { t: t, a: a };
    if (c && c.length) n.c = c;
    if (x != null) n.x = String(x);
    return n;
  }
  function seg(cls, x1, y1, x2, y2) { return node("line", { class: cls, x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2) }); }
  function path(cls, d) { return node("path", { class: cls, d: d }); }
  function box(cls, x, y, w, h) {
    return node("rect", { class: cls, x: r1(x), y: r1(y), width: r1(Math.max(0, w)), height: r1(Math.max(0, h)) });
  }
  function label(cls, x, y, s, anchor) {
    var a = { class: cls, x: r1(x), y: r1(y) };
    if (anchor && anchor !== "start") a["text-anchor"] = anchor;
    return node("text", a, null, s);
  }
  function poly(pts) { return pts.map(function (p, k) { return (k ? "L" : "M") + r1(p[0]) + " " + r1(p[1]); }).join(" ") + " Z"; }
  function trace(pts) { return pts.map(function (p, k) { return (k ? "L" : "M") + r1(p[0]) + " " + r1(p[1]); }).join(" "); }

  // A point's mark. Each real series has its own shape; a shuffled-maps series takes its partner's, hollow (by class).
  // The triangles are a little larger than the other shapes: a point of the same area reads smaller, and the peat rim
  // takes more of a small triangle than of a square, so at 1x they would read as a speck.
  function marker(cls, shape, x, y) {
    if (shape === "circle") return node("circle", { class: cls, cx: r1(x), cy: r1(y), r: 2.7 });
    var pts;
    if (shape === "square") pts = [[x - 2.4, y - 2.4], [x + 2.4, y - 2.4], [x + 2.4, y + 2.4], [x - 2.4, y + 2.4]];
    else if (shape === "up") pts = [[x, y - 4.1], [x + 3.9, y + 2.6], [x - 3.9, y + 2.6]];
    else if (shape === "down") pts = [[x, y + 4.1], [x + 3.9, y - 2.6], [x - 3.9, y - 2.6]];
    else if (shape === "diamond") pts = [[x, y - 3.4], [x + 3.4, y], [x, y + 3.4], [x - 3.4, y]];
    else return path(cls, "M" + r1(x - 3) + " " + r1(y - 3) + " L" + r1(x + 3) + " " + r1(y + 3) +
                          " M" + r1(x - 3) + " " + r1(y + 3) + " L" + r1(x + 3) + " " + r1(y - 3));   // a cross
    return path(cls, poly(pts));
  }

  // Spokes round a centre, starting alternately at starts[0] and starts[1] and all ending at end: a cap's gills.
  function gills(cx, cy, n, starts, end, turn) {
    var d = [];
    for (var k = 0; k < n; k++) {
      var a = turn + k / n * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a), from = starts[k % 2];
      d.push("M" + r1(cx + c * from) + " " + r1(cy + s * from) + " L" + r1(cx + c * end) + " " + r1(cy + s * end));
    }
    return d.join(" ");
  }
  // The key's mark for an attention state: the map's cap forms, small (world.css colours them). Quiet is a closed cap,
  // a plain dim disc; loud an open cap, the lightest disc with its gills and stem; tired a dropped cap of ash beside the
  // print its gills left on the ground.
  function capMark(state, cx, cy) {
    var at = function (cls, x, y, r) { return node("circle", { class: cls, cx: r1(x), cy: r1(y), r: r }); };
    var parts;
    if (state === "quiet") parts = [at("cap-body", cx, cy, 3.4)];
    else if (state === "loud") parts = [at("cap-body", cx, cy, 6.3), path("cap-gill", gills(cx, cy, 12, [1.9, 3.1], 5.7, 0.2)), at("cap-stem", cx, cy, 1.6)];
    else parts = [at("cap-print", cx, cy, 6.4), path("cap-print-gill", gills(cx, cy, 14, [1.8, 2.6], 6, 0.1)), at("cap-body", cx + 1.6, cy + 1.2, 3)];
    return node("g", { class: "cap " + state }, parts);
  }
  // The key's mark for a set of shuffled maps drawn as one range: a small hollow bar with its average tick.
  function rangeKey(s, x, mid) {
    return node("g", { class: "krange" }, [box("krng " + s.cls, x + 7, mid - 5.5, 6, 11), seg("krng-mean " + s.cls, x + 5, mid, x + 15, mid)]);
  }

  function sansWidth(s) { return String(s).length * TICK_PX * SANS_EM; }
  function serifWidth(s, px) { return String(s).length * (px || LABEL_PX) * SERIF_EM; }
  function italicWidth(s) { return String(s).length * LABEL_PX * ITALIC_EM; }
  function catWidth(s) { return serifWidth(s, CAT_PX); }

  // ---- numbers ----

  function fmtInt(v) { return World ? World.fmtInt(v) : String(Math.round(v)); }
  function decimals(step) { return Math.max(0, -Math.floor(Math.log10(step) + 1e-9)); }
  function ownDecimals(v, most) {
    var d = Math.abs(v).toFixed(12).replace(/0+$/, "").split(".")[1] || "";
    return Math.min(most, d.length);
  }
  // A figure with dec decimals, a true minus sign, and thousands grouped.
  function fmtFixed(v, dec) {
    var a = Math.abs(v), s = dec === 0 && a >= 1000 ? fmtInt(a) : a.toFixed(dec);
    if (+s.replace(/,/g, "") === 0) return "0";
    return (v < 0 ? MINUS : "") + s;
  }
  function fmtTick(v, step) { return fmtFixed(v, isNum(step) && step > 0 ? decimals(step) : 2); }
  function fmtLog(v) { return v >= 1000 ? fmtInt(v) : fmtFixed(v, ownDecimals(v, 12)); }

  // ---- axes and scales ----

  function axisType(values) {
    var v = Array.isArray(values) ? values : [];
    if (!v.length) return "category";
    if (v.every(function (x) { return typeof x === "string" && DAY.test(x); })) return "day";
    if (v.every(isNum)) return "number";
    return "category";
  }

  function scale(domain, range, type) {
    var f = type === "log" ? Math.log10 : function (v) { return v; };
    var d0 = f(domain[0]), d1 = f(domain[1]), r0 = range[0], r1_ = range[1];
    return function (v) { return d1 === d0 ? (r0 + r1_) / 2 : r0 + (f(v) - d0) / (d1 - d0) * (r1_ - r0); };
  }

  // A step of 1, 2 or 5 times a power of ten, the one nearest to cutting the span into count parts.
  function niceStep(span, count) {
    var raw = span / Math.max(1, count), step = Math.pow(10, Math.floor(Math.log10(raw))), err = raw / step;
    if (err >= Math.sqrt(50)) step *= 10;
    else if (err >= Math.sqrt(10)) step *= 5;
    else if (err >= Math.sqrt(2)) step *= 2;
    return step;
  }

  // The first tick is at or below min and the last at or above max, always: each is checked as it will be written.
  function niceScale(min, max, count) {
    if (!isNum(min) || !isNum(max)) return { ticks: [], step: 1 };
    if (min > max) { var t = min; min = max; max = t; }
    // Values a float step apart (0.3 and 0.30000000000000004) are one value: a span that small is flat.
    if (max - min <= 1e-9 * Math.max(Math.abs(min), Math.abs(max))) { var pad = min === 0 ? 1 : Math.abs(min) / 2; min -= pad; max += pad; }
    var step = niceStep(max - min, count), dec = decimals(step), ticks = [];
    var at = function (k) { var v = +(k * step).toFixed(dec); return v === 0 ? 0 : v; };
    var lo = Math.floor(min / step), hi = Math.ceil(max / step);
    if (!(hi - lo <= MOST_TICKS)) throw new ChartError("its values could not be given a readable axis");
    if (at(lo + 1) <= min) lo++;
    if (at(hi - 1) >= max) hi--;
    for (var guard = 0; at(lo) > min && guard < 4; guard++) lo--;
    for (guard = 0; at(hi) < max && guard < 4; guard++) hi++;
    if (at(lo) > min || at(hi) < max) throw new ChartError("its values could not be given a readable axis");
    for (var k = lo; k <= hi; k++) ticks.push(at(k));
    return { ticks: ticks, step: step };
  }
  function niceTicks(min, max, count) { return niceScale(min, max, count).ticks; }

  function logTicks(min, max) {
    if (!isNum(min) || !isNum(max) || min <= 0 || max <= 0) return [];
    var out = [];
    for (var k = Math.floor(Math.log10(Math.min(min, max)) + 1e-9); k <= Math.ceil(Math.log10(Math.max(min, max)) - 1e-9); k++) out.push(+("1e" + k));
    return out;
  }

  // A log axis for drawing: it ends on 1, 2 or 5 times a power of ten, so the data fills it, and it labels the powers
  // of ten inside it, with 2 and 5 between them when it spans fewer than two decades.
  function step125(v, up) {
    var e = Math.floor(Math.log10(v) + 1e-9), m = v / Math.pow(10, e), pick;
    if (up) pick = m <= 1 + 1e-9 ? 1 : m <= 2 + 1e-9 ? 2 : m <= 5 + 1e-9 ? 5 : 10;
    else pick = m >= 5 - 1e-9 ? 5 : m >= 2 - 1e-9 ? 2 : 1;
    return +(pick + "e" + e);
  }
  function logAxis(min, max) {
    var lo = step125(min, false), hi = step125(max, true);
    if (hi <= lo) { lo = step125(lo / 1.5, false); hi = step125(hi * 1.5, true); }
    var fine = Math.log10(hi / lo) < 2, ticks = [];
    logTicks(lo, hi).forEach(function (p) {
      (fine ? [1, 2, 5] : [1]).forEach(function (m) {
        var v = +(m * p).toPrecision(12);
        if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) ticks.push(v);
      });
    });
    return { domain: [lo, hi], ticks: ticks };
  }

  function tickCount(width) { return Math.max(2, Math.floor(width / 110)); }

  // ---- days ----

  // A real calendar day as {y, m, d, t}, where t counts days; anything else is null.
  function parseDay(s) {
    var m = typeof s === "string" ? DAY.exec(s) : null;
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3], leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if (mo < 1 || mo > 12 || d < 1 || d > (mo === 2 && leap ? 29 : MONTH_DAYS[mo - 1])) return null;
    return { y: y, m: mo, d: d, t: Date.UTC(y, mo - 1, d) / 864e5 };
  }

  // Which unit a day axis is labelled in, and the indexes of its labels, at most count of them.
  function dayTickInfo(days, count) {
    var p = Array.isArray(days) ? days.map(parseDay) : [];
    if (!p.length || p.some(function (d) { return !d; })) return { unit: "day", idx: [] };
    var max = Math.max(1, Math.floor(count) || 1), byYear = p[p.length - 1].t - p[0].t > 2 * 365.25, starts = [];
    for (var i = 0; i < p.length; i++) {
      var start = i === 0 ? (byYear ? p[0].m === 1 && p[0].d <= 14 : p[0].d <= 7)
                          : byYear ? p[i].y !== p[i - 1].y : p[i].m !== p[i - 1].m || p[i].y !== p[i - 1].y;
      if (start) starts.push(i);
    }
    if (!starts.length) {                                    // under a month: a few days, evenly spaced
      var k = Math.min(max, p.length), idx = [];
      for (var j = 0; j < k; j++) idx.push(k === 1 ? 0 : Math.round(j * (p.length - 1) / (k - 1)));
      return { unit: "day", idx: idx };
    }
    var steps = byYear ? [1, 2, 5, 10, 20, 50, 100] : [1, 2, 3, 4, 6, 12];
    for (var s = 0; s < steps.length; s++) {
      var kept = starts.filter(function (i) { return (byYear ? p[i].y : p[i].m - 1) % steps[s] === 0; });
      if (kept.length && kept.length <= max) return { unit: byYear ? "year" : "month", idx: kept };
    }
    var every = Math.ceil(starts.length / max);
    return { unit: byYear ? "year" : "month", idx: starts.filter(function (_, i) { return i % every === 0; }) };
  }
  function dayTicks(days, count) { return dayTickInfo(days, count).idx; }

  function dayLabel(day, unit, first) {
    var d = parseDay(day);
    if (unit === "year") return String(d.y);
    if (unit === "month") return MONTHS[d.m - 1] + (d.m === 1 || first ? " " + d.y : "");
    return d.d + " " + MONTHS[d.m - 1];
  }

  // ---- checks ----

  function quoted(s) { return "\u201c" + String(s).slice(0, 60) + "\u201d"; }
  function sizeOk(v) { return Math.abs(v) <= BIGGEST; }

  function xProblem(xs, kind) {
    var kinds = {}, seen = Object.create(null), i;
    for (i = 0; i < xs.length; i++) {
      var v = xs[i], at = "x value " + (i + 1), k;
      if (v === null || v === undefined) return at + " is missing";
      if (typeof v === "number") {
        if (!isFinite(v)) return at + " is not a finite number";
        if (!sizeOk(v)) return at + " is too large to draw";
        k = "number"; v = snap(v);
      } else if (typeof v === "string") {
        if (!v.trim()) return at + " is empty";
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { if (!parseDay(v)) return "the x value " + quoted(v) + " is not a real day"; k = "day"; }
        else k = "name";
      } else return at + " is neither a number, a day nor a name";
      kinds[k] = true;
      if (seen[k + ":" + v]) return "the x value " + quoted(v) + " appears more than once";
      seen[k + ":" + v] = true;
    }
    var found = ["number", "day", "name"].filter(function (k) { return kinds[k]; });
    if (found.length > 1) {
      var words = found.map(function (k) { return k + "s"; });
      return "the x values mix " + words.slice(0, -1).join(", ") + " and " + words[words.length - 1];
    }
    if (found[0] === "day" || (found[0] === "number" && kind !== "bars" && kind !== "heat")) {
      var key = function (v) { return typeof v === "number" ? snap(v) : v; };
      for (i = 1; i < xs.length; i++) {
        if (key(xs[i]) < key(xs[i - 1])) {
          return (found[0] === "day" ? "the days on the x axis are out of order (" : "the x values are out of order (") +
                 quoted(xs[i - 1]) + " comes before " + quoted(xs[i]) + ")";
        }
      }
    }
    return null;
  }

  function problem(chart) {
    if (!chart || typeof chart !== "object" || Array.isArray(chart)) return "the chart is missing";
    if (KINDS.indexOf(chart.kind) < 0) {
      return typeof chart.kind === "string" ? "its kind " + quoted(chart.kind) + " is not one this page can draw" : "it names no kind of chart";
    }
    var xs = chart.x && Array.isArray(chart.x.values) ? chart.x.values : null;
    if (!xs || !xs.length) return "it has no x values";
    if (xs.length > MOST_POINTS) return "it has more than " + fmtInt(MOST_POINTS) + " points, more than a page can draw";
    if ((chart.kind === "bars" || chart.kind === "heat" || axisType(xs) === "category") && xs.length > MOST_CATEGORIES) {
      return "it has more than " + fmtInt(MOST_CATEGORIES) + " categories, more than a page can draw";
    }
    var bad = xProblem(xs, chart.kind);
    if (bad) return bad;
    if (!Array.isArray(chart.series) || !chart.series.length) return "it has no series";
    if (chart.series.length > MOST_SERIES) return "it has more than " + MOST_SERIES + " series, more than a chart can show";
    for (var i = 0; i < chart.series.length; i++) {
      var s = chart.series[i];
      if (!s || typeof s !== "object" || !Array.isArray(s.y)) return "series " + (i + 1) + " has no values";
      if (typeof s.name !== "string" || !s.name.trim()) return "series " + (i + 1) + " has no name";
      var name = "the series " + quoted(s.name);
      var keys = ["y", "lo", "hi", "n"];
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k], v = s[key];
        if (v == null && key !== "y") continue;
        if (!Array.isArray(v)) return name + " has " + PART[key] + " that are not a list";
        if (v.length !== xs.length) {
          return key === "y" ? name + " has the wrong length (" + count(v.length, "value") + " for " + count(xs.length, "point") + " on the x axis)"
                             : name + " has " + PART[key] + " of the wrong length (" + v.length + " for " + count(xs.length, "point") + " on the x axis)";
        }
        for (var j = 0; j < v.length; j++) {
          var e = v[j];
          if (e === null) continue;
          if (typeof e !== "number") return name + " holds " + ONE[key] + " that is not a number";
          if (!isFinite(e)) return name + " holds " + ONE[key] + " that is not a finite number";
          if (!sizeOk(e)) return name + " holds " + ONE[key] + " too large to draw";
        }
      }
    }
    if (chart.kind === "loglog" && axisType(xs) !== "number") return "a log-log chart needs numbers along its x axis";
    return null;
  }

  // A shuffled-maps series: the real map's reference, drawn in its real partner's tone, dashed or hollow.
  function isReference(series) {
    var name = typeof series === "string" ? series : series && typeof series === "object" ? series.name : null;
    return typeof name === "string" && REFERENCE.test(name);
  }

  // On a line chart the shuffled maps are not drawn point by point, where their marks would pile up on one another
  // and on the real series: each set is one hollow range in a strip at the right of the plot (drawLine).
  function refsAsRanges(chart) {
    return !!chart && chart.kind === "line" && Array.isArray(chart.series) && chart.series.some(isReference);
  }

  // ---- series and their forms ----

  function list(s, key, n) {
    var a = Array.isArray(s[key]) ? s[key] : [], out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = isNum(a[i]) ? snap(a[i]) : null;
    return out;
  }
  // Real series take the tones bone, bone-3, bone-4, bone-3 ... and the shapes in order. A shuffled-maps series takes
  // the tone and shape of the real series whose name begins the same way ("Alignment, ..."), or of the first real one.
  // A real series named for an attention state also carries that state, whatever its place (world.css: loud the
  // lightest, quiet dim, tired ash umber).
  function stateOf(name, ref) {
    var k = str(name).trim().toLowerCase();
    return !ref && STATES.indexOf(k) >= 0 ? k : null;
  }
  function prepare(chart) {
    var n = chart.x.values.length;
    var S = chart.series.map(function (s, i) {
      var ref = isReference(s);
      return { i: i, name: str(s.name), ref: ref, state: stateOf(s.name, ref), y: list(s, "y", n), lo: list(s, "lo", n), hi: list(s, "hi", n) };
    });
    var head = function (s) { return s.name.split(",")[0].trim().toLowerCase(); };
    var reals = S.filter(function (s) { return !s.ref; });
    (reals.length ? reals : S).forEach(function (s, r) { s.tone = r === 0 ? 0 : r % 2 ? 1 : 2; s.shape = SHAPES[r % SHAPES.length]; });
    S.forEach(function (s) {
      if (s.tone != null) return;
      var partner = reals.filter(function (r) { return head(r) === head(s); })[0] || reals[0];
      s.tone = partner.tone; s.shape = partner.shape;
      partner.twins = (partner.twins || 0) + 1;
      s.second = partner.twins > 1;            // a second shuffled series of one partner takes a second dash
    });
    S.forEach(function (s) {
      s.cls = "ln-" + s.i + " tone-" + s.tone + " mk-" + s.shape + (s.ref ? " ref" : "") + (s.second ? " ref-2" : "") + (s.state ? " st-" + s.state : "");
    });
    return S;
  }
  function finite(series, keys, ok) {
    var out = [];
    series.forEach(function (s) { keys.forEach(function (k) { s[k].forEach(function (v) { if (v !== null && (!ok || ok(v))) out.push(v); }); }); });
    return out;
  }
  function runs(ok, n) {
    var out = [], cur = null;
    for (var i = 0; i < n; i++) {
      if (ok(i)) { if (!cur) out.push(cur = []); cur.push(i); } else cur = null;
    }
    return out;
  }
  // A range mark from y0 up to y1, capped at both ends, or at the top only when it is open below.
  function errMark(x, y0, y1, cap, open) {
    return "M" + r1(x) + " " + r1(y0) + " V" + r1(y1) + " M" + r1(x - cap) + " " + r1(y1) + " H" + r1(x + cap) +
           (open ? "" : " M" + r1(x - cap) + " " + r1(y0) + " H" + r1(x + cap));
  }
  // Series whose range marks would stand on one x are drawn a few px apart, each whole (line, points and marks), so
  // that the marks never pile up and every point stays on its own mark.
  // How far the plot's ends move in, so that a dodged series' first and last marks (3.5px caps) stay inside it.
  function inset(S, shift) {
    var most = maxOf(S.map(function (s) { return Math.abs(shift(s)); }));
    return most > 0 ? most + 4 : 0;
  }
  function dodge(S, which) {
    var moved = S.filter(function (s) { return which(s) && s.lo.some(function (v, i) { return v !== null && s.hi[i] !== null; }); });
    return function (s) { var k = moved.indexOf(s); return k < 0 || moved.length < 2 ? 0 : (k - (moved.length - 1) / 2) * 5; };
  }

  // ---- the frame ----

  // The key: each series' exact form and its name, on the y label's line when they fit beside it, else in rows under.
  // An attention state is keyed by its cap form; on a line chart whose shuffled maps are ranges, each set by its range.
  function layKey(S, form, chart, w, ranged) {
    var gap = 16, right = w - MARGIN.right, yl = str(chart.y && chart.y.label), yLines = yNameLines(chart, w);
    var items = S.map(function (s) {
      var sw = s.state ? CAP_SW : form === "line" ? 26 : 14, most = right - 1 - sw;
      var t = s.name, lines = italicWidth(t) <= most ? [t] : twoLines(t, most, italicWidth);
      return { s: s, text: t, lines: lines, sw: sw, w: sw + maxOf(lines.map(italicWidth)) };
    });
    var total = sum(items.map(function (it) { return it.w; })) + gap * (items.length - 1);
    var single = items.every(function (it) { return it.lines.length === 1; });
    var beside = single && yLines.length <= 1 && (yl ? italicWidth(yl) + 25 : 0) + total <= right, x = beside ? right - total : 1;
    var y = beside || !yl ? 11 : yNameBottom(chart, w) + KEY_ROW, tall = 1, kids = [];
    items.forEach(function (it) {
      if (!beside && x > 1 && (x + it.w > right || it.lines.length > 1)) { x = 1; y += KEY_ROW + (tall - 1) * (KEY_ROW - 2); tall = 1; }
      var s = it.s, mid = y - 4;
      if (s.state) kids.push(capMark(s.state, x + 7, mid));
      else if (form === "line" && s.ref && ranged) kids.push(rangeKey(s, x, mid));
      else if (form === "line") kids.push(seg("kline " + s.cls, x, mid, x + 20, mid), marker("kmark " + s.cls, s.shape, x + 10, mid));
      else if (form === "area") kids.push(box("aswatch" + (s.i % 2 ? " alt" : ""), x, y - 8.5, 9, 9));
      else kids.push(box("swatch " + s.cls, x, y - 8.5, 9, 9));
      it.lines.forEach(function (l, k) {
        var t = label("lbl", x + it.sw, y + k * (KEY_ROW - 2), l);
        if (k === 0 && it.lines.length > 1) t.a["aria-label"] = it.text;   // wrapped or cut: the whole name stays here
        kids.push(t);
      });
      tall = Math.max(tall, it.lines.length);
      x = it.lines.length > 1 ? right + 1 : x + it.w + gap;      // a two-line name stands alone in its row
    });
    return { node: node("g", { class: "key" }, kids), last: y + (tall - 1) * (KEY_ROW - 2) };
  }

  // The y axis's name in lines that fit the chart's width (one line when it fits), and the baseline of its last line.
  function yNameLines(chart, w) {
    var yl = str(chart.y && chart.y.label), most = w - MARGIN.right - 1;
    if (!yl) return [];
    return italicWidth(yl) <= most ? [yl] : wrap(yl, most, italicWidth);
  }
  function yNameBottom(chart, w) { return 11 + Math.max(0, yNameLines(chart, w).length - 1) * YNAME_STEP; }

  // The plot starts far enough under the y label (or the key's last row) that its top figure never touches either.
  function topFor(chart, key, w) {
    var last = key ? key.last : str(chart.y && chart.y.label) ? yNameBottom(chart, w) : null;
    return last == null ? MARGIN.top : Math.max(MARGIN.top, Math.ceil(last + NAME_DOWN + FIG_UP - FIG_DROP + 1));
  }
  function plotHeight(E) { return Math.max(40, E.h0 - MARGIN.top - MARGIN.bottom); }
  // The left margin grows to hold the widest figure.
  function leftFor(figs) { return Math.max(MARGIN.left, Math.ceil(maxOf(figs.map(sansWidth).concat([0])) + 8)); }
  function plotFrame(E, top, figs) {
    var t = top, l = leftFor(figs);
    return { l: l, r: E.w - MARGIN.right, t: t, b: t + plotHeight(E) };
  }

  function axisNames(E, h, xName) {
    var out = [], yl = str(E.chart.y && E.chart.y.label), xl = xName === false ? "" : str(E.chart.x && E.chart.x.label);
    if (yl) yNameLines(E.chart, E.w).forEach(function (l, k) { out.push(label("ylab", 1, 11 + k * YNAME_STEP, l)); });
    if (xl) out.push(label("xlab", E.w - MARGIN.right, h - 4, xl, "end"));
    return out;
  }

  function yTicks(lo, hi, E) {
    var sc = niceScale(lo, hi, Math.max(2, Math.floor(plotHeight(E) / 56)));
    return { ticks: sc.ticks, figs: sc.ticks.map(function (v) { return fmtTick(v, sc.step); }) };
  }
  // Horizontal gridlines and their figures, and the zero line when zero is inside the axis.
  function yAxis(P, T) {
    var t = T.ticks, y = scale([t[0], t[t.length - 1]], [P.b, P.t]), grid = [], figs = [];
    var zero = t[0] <= 0 && t[t.length - 1] >= 0;
    t.forEach(function (v, k) {
      var at = y(v);
      if (!(zero && v === 0) && Math.abs(at - P.b) > 0.5) grid.push(seg("tick", P.l, at, P.r, at));
      figs.push(label("tick", P.l - 6, at + FIG_DROP, T.figs[k], "end"));
    });
    return { y: y, grid: grid, figs: figs, zero: zero ? [seg("zero", P.l, y(0), P.r, y(0))] : [] };
  }

  // Keep labels at least gap px apart and inside the chart, and never left of minLeft (the y figures end there).
  function spaced(items, gap, minLeft, w) {
    var out = [], last = -Infinity;
    items.forEach(function (it) {
      if (it.px - last < gap) return;
      last = it.px;
      var half = it.w / 2;
      out.push(label(it.cls, clamp(it.px, Math.max(minLeft + half, half + 1), w - half - 1), it.y, it.text, "middle"));
    });
    return out;
  }

  // Where each x value sits, and the labels and tick marks of the x axis. Slots: each value owns an equal slot
  // (bars, heat, categories). Otherwise days sit by index from edge to edge, and numbers on a linear scale.
  function xAxis(E, P, slots, labelY) {
    var xs = E.xs, n = xs.length, type = E.type, width = P.r - P.l, at, val = null, items = [], zero = [];
    var minLeft = P.l - 5, y = labelY == null ? P.b + 15 : labelY;
    if (slots || type === "category") at = function (i) { return P.l + (i + 0.5) * width / n; };
    else if (type === "day") at = function (i) { return n === 1 ? P.l + width / 2 : P.l + i / (n - 1) * width; };
    else {
      val = scale([minOf(xs), maxOf(xs)], [P.l, P.r]);
      at = function (i) { return val(xs[i]); };
    }
    if (type === "day") {
      var info = dayTickInfo(xs, Math.floor(width / DAY_GAP));
      info.idx.forEach(function (i, k) {
        var t = dayLabel(xs[i], info.unit, k === 0);
        items.push({ px: at(i), text: t, w: sansWidth(t), y: y, cls: "tick" });
      });
      return { at: at, labels: spaced(items, DAY_GAP, minLeft, E.w), marks: items.map(function (it) { return it.px; }), zero: zero };
    }
    if (type === "number") {
      var lo = minOf(xs), hi = maxOf(xs), sc = niceScale(lo, hi, tickCount(E.w)), dec = decimals(sc.step), eps = sc.step * 1e-6;
      var vals = sc.ticks.filter(function (v) { return v >= lo - eps && v <= hi + eps; }).map(function (v) { return [v, dec]; });
      // An end that lies far from every tick gets a tick of its own, written with the decimals it needs.
      if (!vals.length || vals[0][0] - lo >= 0.45 * sc.step) vals.unshift([lo, Math.max(dec, ownDecimals(lo, 6))]);
      if (hi - vals[vals.length - 1][0] >= 0.45 * sc.step) vals.push([hi, Math.max(dec, ownDecimals(hi, 6))]);
      vals.forEach(function (p) {
        var px;
        if (val) px = val(p[0]);
        else { var i = xs.indexOf(p[0]); if (i < 0) return; px = at(i); }
        var t = fmtFixed(p[0], p[1]);
        items.push({ px: px, text: t, w: sansWidth(t), y: y, cls: "tick" });
      });
      if (val && lo < 0 && hi > 0) zero.push(seg("zero", val(0), P.t, val(0), P.b));
      return { at: at, labels: spaced(items, 28, minLeft, E.w), marks: items.map(function (it) { return it.px; }), zero: zero };
    }
    var words = !xs.every(function (v) { return /^\d+$/.test(String(v)); });
    var widthOf = words ? catWidth : sansWidth;
    var widest = maxOf(xs.map(function (v) { return widthOf(String(v)); }));
    var every = Math.max(1, Math.ceil((widest + 10) / (width / n)));
    xs.forEach(function (v, i) {
      if (i % every) return;
      items.push({ px: at(i), text: String(v), w: widthOf(String(v)), y: y, cls: words ? "tick cat" : "tick" });
    });
    return { at: at, labels: spaced(items, 0, minLeft, E.w), marks: [], zero: zero };
  }

  function baseline(P, marks) {
    return path("axis", "M" + r1(P.l) + " " + r1(P.b) + " H" + r1(P.r) +
                marks.map(function (m) { return " M" + r1(m) + " " + r1(P.b) + " v4"; }).join(""));
  }

  // One shaded period per market fall, on a day axis only. A period covers its days and half a step either side; a
  // period that falls between two days of the axis is drawn where it falls, at least 2px wide.
  function falls(E, P, at) {
    if (E.type !== "day" || !Array.isArray(E.chart.bands)) return [];
    var t = E.days, n = t.length, half = n > 1 ? (at(1) - at(0)) / 2 : (P.r - P.l) / 2, out = [];
    var frac = function (d) {
      var k = 0;
      while (k < n - 1 && t[k + 1] <= d) k++;
      return k >= n - 1 ? n - 1 : k + (d - t[k]) / (t[k + 1] - t[k]);
    };
    E.chart.bands.forEach(function (b) {
      var from = parseDay(Array.isArray(b) ? b[0] : b && b.from), to = parseDay(Array.isArray(b) ? b[1] : b && b.to);
      if (!from || !to || from.t > to.t || to.t < t[0] || from.t > t[n - 1]) return;
      var i0 = -1, i1 = -1;
      for (var i = 0; i < n; i++) { if (i0 < 0 && t[i] >= from.t) i0 = i; if (t[i] <= to.t) i1 = i; }
      var holds = i0 >= 0 && i1 >= i0;
      var x0 = clamp(holds ? at(i0) - half : at(frac(from.t)), P.l, P.r), x1 = clamp(holds ? at(i1) + half : at(frac(to.t)), P.l, P.r);
      if (x1 - x0 < 2) { x0 = clamp((x0 + x1) / 2 - 1, P.l, P.r - 2); x1 = x0 + 2; }
      out.push(box("fall", x0, P.t, x1 - x0, P.b - P.t));
    });
    return out;
  }

  // Which points of a line carry its marker: a point standing alone always; with two or more series, every point of
  // a short line, or about eight along a long one, staggered so that the series' marks do not stand on one x.
  function markedPoints(s, parts, E, multi, nSeries) {
    var n = E.xs.length, out = [], seen = {};
    var add = function (i) { if (!seen[i] && s.y[i] !== null) { seen[i] = true; out.push(i); } };
    parts.forEach(function (run) { if (run.length === 1) add(run[0]); });
    var all = multi ? n <= 12 || (E.type === "category" && n <= 24) : E.type === "category" && n <= 24;
    if (all) for (var i = 0; i < n; i++) add(i);
    else if (multi) {
      var step = Math.ceil(n / 8);
      for (var j = Math.floor(step * s.i / nSeries); j < n; j += step) add(j);
    }
    return out;
  }

  // ---- the kinds ----

  // Each set of shuffled maps drawn as one range: from the lowest value or bound it reaches anywhere on the chart to
  // the highest, with a tick at the average of its values. A set with no value draws nothing.
  function rangesOf(S) {
    return S.filter(function (s) { return s.ref; }).map(function (s) {
      var ys = s.y.filter(function (v) { return v !== null; }), all = finite([s], ["y", "lo", "hi"]);
      return ys.length ? { s: s, lo: minOf(all), hi: maxOf(all), mean: sum(ys) / ys.length } : null;
    }).filter(Boolean);
  }

  function drawLine(E) {
    var ranged = refsAsRanges(E.chart), real = ranged ? E.series.filter(function (s) { return !s.ref; }) : E.series;
    // A shuffled set drawn as a range but with no value draws nothing, so the key leaves it out (the table keeps it).
    var keyed = ranged ? E.series.filter(function (s) { return !s.ref || s.y.some(function (v) { return v !== null; }); }) : E.series;
    var S = E.series, n = E.xs.length, multi = S.length > 1, K = keyed.length > 1 ? layKey(keyed, "line", E.chart, E.w, ranged) : null;
    var vals = finite(S, ["y", "lo", "hi"]).concat(E.yRange || []), T = yTicks(minOf(vals), maxOf(vals), E);
    var P = plotFrame(E, topFor(E.chart, K, E.w), T.figs), Y = yAxis(P, T);
    var spans = ranged ? rangesOf(S) : [], strip = spans.length ? Math.max(RANGE_STRIP, spans.length * RANGE_PITCH + 22) : 0;
    // A chart with one reading in all draws it larger, in from the edge, with its value beside it: a small point on the
    // plot's edge reads as an empty chart.
    var points = [];
    real.forEach(function (s) { s.y.forEach(function (v, i) { if (v !== null) points.push({ s: s, i: i }); }); });
    var lone = !spans.length && points.length === 1 ? points[0] : null;
    var pad = E.type === "category" || !lone ? 0 : LONE_INSET;
    var X = xAxis(E, pad || strip ? { l: P.l + pad, r: P.r - pad - strip, t: P.t, b: P.b } : P, false);
    var bands = [], lines = [], errs = [], marks = [], extra = [];
    real.forEach(function (s) {
      var band = [];
      runs(function (i) { return s.lo[i] !== null && s.hi[i] !== null; }, n).forEach(function (run) {
        if (run.length === 1) {
          run.forEach(function (i) { errs.push(path("err " + s.cls, errMark(X.at(i), Y.y(s.lo[i]), Y.y(s.hi[i]), 3.5))); });
        } else {
          band.push(poly(run.map(function (i) { return [X.at(i), Y.y(s.hi[i])]; })
            .concat(run.slice().reverse().map(function (i) { return [X.at(i), Y.y(s.lo[i])]; }))));
        }
      });
      if (band.length) bands.push(path("band", band.join(" ")));
      var parts = runs(function (i) { return s.y[i] !== null; }, n);
      if (!parts.length) return;
      lines.push(path("ln " + s.cls, parts.map(function (run) {
        return trace(run.map(function (i) { return [X.at(i), Y.y(s.y[i])]; }));
      }).join(" ")));
      if (!lone) markedPoints(s, parts, E, multi, S.length).forEach(function (i) {
        marks.push(marker("dot " + s.cls, multi ? s.shape : "circle", X.at(i), Y.y(s.y[i])));
      });
    });
    if (lone) {
      var lx = X.at(lone.i), ly = Y.y(lone.s.y[lone.i]), v = lone.s.y[lone.i], left = lx > (P.l + P.r) / 2;
      marks.push(node("circle", { class: "dot lone " + lone.s.cls, cx: r1(lx), cy: r1(ly), r: 4.5 }));
      extra.push(label("lone-val", left ? lx - 10 : lx + 10, ly + 4, fmtFixed(v, ownDecimals(v, 4)), left ? "end" : "start"));
    }
    if (spans.length) {
      var x0 = P.r - strip + (strip - (spans.length * RANGE_PITCH - (RANGE_PITCH - 7))) / 2;
      spans.forEach(function (sp, k) {
        var cx = x0 + k * RANGE_PITCH + 3.5, top = Y.y(sp.hi), h = Math.max(2, Y.y(sp.lo) - top);
        extra.push(box("rng " + sp.s.cls, cx - 3.5, h > 2 ? top : (top + Y.y(sp.lo)) / 2 - 1, 7, h),
                   seg("rng-mean " + sp.s.cls, cx - 5.5, Y.y(sp.mean), cx + 5.5, Y.y(sp.mean)));
      });
      extra.push(label("strip", P.r - strip / 2, P.b + 15, "shuffled", "middle"));
    }
    var h = P.b + MARGIN.bottom;
    return { h: h, parts: [].concat(falls(E, P, X.at), Y.grid, [baseline(P, X.marks)], Y.zero, X.zero, bands, lines, errs, marks, extra,
                                    Y.figs, X.labels, K ? [K.node] : [], axisNames(E, h)) };
  }

  function wrap(s, maxw, widthOf) {
    var lines = [], cur = "";
    s.split(/\s+/).filter(Boolean).forEach(function (word) {
      var next = cur ? cur + " " + word : word;
      if (!cur || widthOf(next) <= maxw) cur = next;
      else { lines.push(cur); cur = word; }
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function trimTo(s, maxw, widthOf) {
    if (widthOf(s) <= maxw) return s;
    while (s.length > 1 && widthOf(s + ELLIPSIS) > maxw) s = s.slice(0, -1);
    return s.replace(/[\s,.;:]+$/, "") + ELLIPSIS;
  }
  // A name in at most two lines of maxw; what does not fit is cut with an ellipsis (the table holds it whole).
  function twoLines(s, maxw, widthOf) {
    var ls = wrap(s, maxw, widthOf);
    if (ls.length > 2) ls = [ls[0], ls.slice(1).join(" ")];
    return ls.map(function (l) { return trimTo(l, maxw, widthOf); });
  }
  function nameLines(s, maxw) { return twoLines(s, maxw, catWidth); }

  function drawBars(E) {
    var S = E.series, n = E.xs.length, names = E.xs.map(String), K = S.length > 1 ? layKey(S, "bar", E.chart, E.w) : null;
    var vals = finite(S, ["y", "lo", "hi"]).concat([0], E.yRange || []), lo = minOf(vals), hi = maxOf(vals), top = topFor(E.chart, K, E.w);
    var words = !names.every(function (v) { return /^\d+$/.test(v); }), widthOf = words ? catWidth : sansWidth;
    var catCls = words ? "tick cat" : "tick", T = yTicks(lo, hi, E), P = plotFrame(E, top, T.figs);
    var slot = (P.r - P.l) / n;
    var wrapped = names.map(function (s) { return wrap(s, slot - 8, widthOf); });
    var upright = wrapped.every(function (ls) { return ls.length <= 2 && ls.every(function (l) { return widthOf(l) <= slot - 8; }); });
    var bars = [], errs = [], out, h;

    if (upright) {
      var two = wrapped.some(function (ls) { return ls.length > 1; }), xName = str(E.chart.x && E.chart.x.label);
      var Y = yAxis(P, T), group = slot * 0.7, bw = group / S.length, y0 = Y.y(0), cats = [];
      S.forEach(function (s, j) {
        for (var c = 0; c < n; c++) {
          var x = P.l + c * slot + (slot - group) / 2 + j * bw, cx = x + bw / 2;
          if (s.y[c] !== null) {
            var y1 = Y.y(s.y[c]);
            bars.push(box("bar " + s.cls, x + 1, Math.min(y0, y1), Math.max(1, bw - 2), Math.max(0.5, Math.abs(y1 - y0))));
          }
          if (s.lo[c] !== null && s.hi[c] !== null) {
            errs.push(path("err " + s.cls, errMark(cx, Y.y(s.lo[c]), Y.y(s.hi[c]), Math.min(4, Math.max(1.5, (bw - 2) * 0.3)))));
          }
        }
      });
      wrapped.forEach(function (ls, c) {
        var cx = P.l + (c + 0.5) * slot;
        ls.forEach(function (l, k) { cats.push(label(catCls, cx, P.b + 15 + k * LINE_STEP, l, "middle")); });
      });
      h = P.b + MARGIN.bottom + (two && xName ? LINE_STEP : 0);
      out = [].concat(Y.grid, [baseline(P, [])], Y.zero, bars, errs, Y.figs, cats);
    } else {
      // Names too long to stand under their bars: each category takes a row, its name in a column at the left. A row
      // is at least as tall as its name and its bars (each at least 6px thick), and the chart grows to hold every row.
      var lines = names.map(function (s) { return nameLines(s, Math.round(E.w * 0.45)); });
      var nameW = maxOf(lines.map(function (ls) { return maxOf(ls.map(catWidth)); }));
      var rowMin = Math.max(S.length * BAR_PITCH + 8, maxOf(lines.map(function (ls) { return ls.length; })) * LINE_STEP + 6);
      var rowH = Math.max(rowMin, plotHeight(E) / n), pitch = clamp((rowH - 8) / S.length, BAR_PITCH, 14);
      var H = { l: Math.ceil(nameW + 14), r: E.w - MARGIN.right, t: top, b: top + n * rowH };
      var sc = niceScale(lo, hi, tickCount(E.w - H.l + MARGIN.left)), t = sc.ticks, figs = [], rows = [];
      var x = scale([t[0], t[t.length - 1]], [H.l, H.r]), x0 = x(0);
      var grid = t.filter(function (v) { return v !== 0; }).map(function (v) { return seg("tick", x(v), H.t, x(v), H.b); });
      t.forEach(function (v) { var f = fmtTick(v, sc.step); figs.push({ px: x(v), text: f, w: sansWidth(f), y: H.b + 15, cls: "tick" }); });
      lines.forEach(function (ls, c) {
        var mid = H.t + (c + 0.5) * rowH, gTop = mid - pitch * S.length / 2;
        ls.forEach(function (l, k) { rows.push(label(catCls, H.l - 8, mid + 4 + (k - (ls.length - 1) / 2) * LINE_STEP, l, "end")); });
        S.forEach(function (s, j) {
          var y = gTop + j * pitch, cy = y + pitch / 2;
          if (s.y[c] !== null) bars.push(box("bar " + s.cls, Math.min(x0, x(s.y[c])), y + 1, Math.max(0.5, Math.abs(x(s.y[c]) - x0)), pitch - 2));
          if (s.lo[c] !== null && s.hi[c] !== null) {
            var cap = Math.min(3.5, (pitch - 2) / 2), a = x(s.lo[c]), b = x(s.hi[c]);
            errs.push(path("err " + s.cls, "M" + r1(a) + " " + r1(cy) + " H" + r1(b) + " M" + r1(a) + " " + r1(cy - cap) + " V" + r1(cy + cap) +
                                            " M" + r1(b) + " " + r1(cy - cap) + " V" + r1(cy + cap)));
          }
        });
      });
      h = H.b + MARGIN.bottom;
      out = [].concat(grid, [baseline(H, t.map(x))], [seg("zero", x0, H.t, x0, H.b)], bars, errs, spaced(figs, 24, H.l - 5, E.w), rows);
    }
    return { h: h, parts: out.concat(K ? [K.node] : [], axisNames(E, h, upright ? undefined : false)) };
  }

  function drawLogLog(E) {
    var S = E.series, xs = E.xs, n = xs.length, multi = S.length > 1, K = multi ? layKey(S, "line", E.chart, E.w) : null;
    var pos = function (v) { return v !== null && v > 0; };
    var xv = xs.filter(pos), yv = finite(S, ["y", "lo", "hi"], function (v) { return v > 0; });
    var XA = logAxis(minOf(xv), maxOf(xv)), YA = logAxis(minOf(yv), maxOf(yv)), figs = YA.ticks.map(fmtLog);
    var P = plotFrame(E, topFor(E.chart, K, E.w), figs), shift = dodge(S, function () { return true; }), pad = inset(S, shift);
    var sx = scale(XA.domain, [P.l + pad, P.r - pad], "log"), sy = scale(YA.domain, [P.b, P.t], "log");
    var grid = [], figNodes = [], xl = [], lines = [], errs = [], pts = [];
    YA.ticks.forEach(function (v, k) {
      if (Math.abs(sy(v) - P.b) > 0.5) grid.push(seg("tick", P.l, sy(v), P.r, sy(v)));
      figNodes.push(label("tick", P.l - 6, sy(v) + FIG_DROP, figs[k], "end"));
    });
    XA.ticks.forEach(function (v) { xl.push({ px: sx(v), text: fmtLog(v), w: sansWidth(fmtLog(v)), y: P.b + 15, cls: "tick" }); });
    S.forEach(function (s) {
      var ok = function (i) { return pos(xs[i]) && pos(s.y[i]); };
      var parts = runs(ok, n);
      if (!parts.length) return;
      var d = shift(s);
      lines.push(path("ln " + s.cls, parts.map(function (run) {
        return trace(run.map(function (i) { return [sx(xs[i]) + d, sy(s.y[i])]; }));
      }).join(" ")));
      for (var i = 0; i < n; i++) {
        if (ok(i)) pts.push(marker("pt " + s.cls, multi ? s.shape : "circle", sx(xs[i]) + d, sy(s.y[i])));
        // A lower bound at or below 0 has no place on a log axis: the mark runs open to the floor, with no bottom cap.
        if (pos(xs[i]) && pos(s.hi[i]) && s.lo[i] !== null) {
          var open = s.lo[i] <= 0;
          errs.push(path("err " + s.cls, errMark(sx(xs[i]) + d, open ? P.b : sy(s.lo[i]), sy(s.hi[i]), 3.5, open)));
        }
      }
    });
    var h = P.b + MARGIN.bottom;
    return { h: h, parts: [].concat(grid, [baseline(P, xl.map(function (it) { return it.px; }))], lines, errs, pts,
                                    figNodes, spaced(xl, 28, P.l - 5, E.w), K ? [K.node] : [], axisNames(E, h)) };
  }

  // A heat chart is as tall as its rows: cells about square, 20 to 36px high, whatever height the page offered.
  function drawHeat(E) {
    var S = E.series, n = E.xs.length;
    var widest = maxOf(S.map(function (s) { return serifWidth(s.name); }));
    var left = clamp(widest + 12, MARGIN.left, Math.round(E.w * 0.42));
    var fit = Math.max(4, Math.floor((left - 12) / (LABEL_PX * SERIF_EM)));
    var top = topFor(E.chart, null, E.w), cw = (E.w - MARGIN.right - left) / n, ch = clamp(cw, 20, 36);
    var P = { l: left, r: E.w - MARGIN.right, t: top, b: top + S.length * ch };
    var most = maxOf(finite(S, ["y"]).map(Math.abs)), cells = [], rows = [];
    S.forEach(function (s, r) {
      var y = P.t + r * ch;
      s.y.forEach(function (v, c) {
        // Levels are symmetric: a tie rounds away from 0 on both sides.
        var lv = v === null ? null : most > 0 ? (v < 0 ? -1 : 1) * Math.min(2, Math.round(Math.abs(v) / most * 2)) : 0;
        cells.push(box(lv === null ? "cell nil" : "cell lv" + (lv === 0 ? 0 : lv), P.l + c * cw, y, cw, ch));
      });
      var name = s.name.length > fit ? s.name.slice(0, fit - 1) + ELLIPSIS : s.name;
      rows.push(label("row", P.l - 8, y + ch / 2 + 4.3, name, "end"));
    });
    var X = xAxis(E, P, true, P.b + 15), h = P.b + (str(E.chart.x && E.chart.x.label) ? MARGIN.bottom : 22);
    return { h: h, parts: [].concat(cells, rows, X.labels, axisNames(E, h)) };
  }

  // A name inside its band, where the whole name, with 3px to spare, stays inside the band; else null.
  function insideName(s, cum, floor, parts, X, Y) {
    var i = s.i, half = italicWidth(s.name) / 2 + 3, thick = function (k) { return Y.y(floor(i, k)) - Y.y(cum[i][k]); };
    for (var p = 0; p < parts.length; p++) {
      var run = parts[p], x0 = X.at(run[0]), x1 = X.at(run[run.length - 1]);
      if (run.length < 2 || x1 - x0 < 2 * half) continue;
      var order = run.slice().sort(function (a, b) { return thick(b) - thick(a); }).slice(0, 40);
      for (var o = 0; o < order.length; o++) {
        var k = order[o], cx = clamp(X.at(k), x0 + half, x1 - half), mid = (Y.y(floor(i, k)) + Y.y(cum[i][k])) / 2, fits = true;
        for (var r = 0; r < run.length && fits; r++) {
          var q = run[r], next = r + 1 < run.length ? X.at(run[r + 1]) : X.at(q), prev = r ? X.at(run[r - 1]) : X.at(q);
          if (next < cx - half || prev > cx + half) continue;           // the band's stretches round this point miss the name
          if (Y.y(cum[i][q]) > mid - 7 || Y.y(floor(i, q)) < mid + 7) fits = false;
        }
        if (fits) return label("lbl", cx, mid + 4.3, s.name, "middle");
      }
    }
    return null;
  }

  // The value a full row stands for: the smallest of 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 x 10^k at or above the largest
  // value, so the tallest strip nearly fills its row (0.26 gives 0.3, 0.32 gives 0.4, 0.031 gives 0.04).
  function fullRow(most) {
    var e = Math.floor(Math.log10(most) + 1e-9), m = most / Math.pow(10, e);
    var pick = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].filter(function (q) { return q >= m - 1e-9; })[0];
    return +(pick * Math.pow(10, e)).toPrecision(12);
  }

  // An area of more than four series is drawn as rows: one strip per series, every strip on one shared scale so that
  // heights compare across rows, in the order the series are given. Names stand in a column at the left, or above
  // each strip when a column would take more than a third of the width. An x where any series has no reading is a
  // gap through every row. The chart is as tall as its rows.
  function drawRows(E) {
    var S = E.series, n = E.xs.length, right = E.w - MARGIN.right, defined = [], vals = [];
    for (var j = 0; j < n; j++) defined.push(S.every(function (s) { return s.y[j] !== null; }));
    S.forEach(function (s) { s.y.forEach(function (v, k) { if (defined[k]) vals.push(v); }); });
    var most = Math.max(0, maxOf(vals)), full = most > 0 ? fullRow(most) : 1;
    var note = "A full row is " + fmtFixed(full, ownDecimals(full, 12)) + ".", yl = str(E.chart.y && E.chart.y.label);
    var beside = !yl || (yNameLines(E.chart, E.w).length === 1 && italicWidth(yl) + 24 + italicWidth(note) <= right);
    var noteY = beside ? 11 : yNameBottom(E.chart, E.w) + KEY_ROW;
    var names = S.map(function (s) { return s.name; });
    var lines = names.map(function (t) { return nameLines(t, Math.round(E.w * 0.45)); });
    var nameW = maxOf(lines.map(function (ls) { return maxOf(ls.map(catWidth)); }));
    var column = nameW + 14 <= E.w / 3;
    if (!column) lines = names.map(function (t) { return [trimTo(t, right - 2, catWidth)]; });
    var pitch = column ? Math.max(ROW_STRIP + ROW_GAP, maxOf(lines.map(function (ls) { return ls.length; })) * LINE_STEP + 4)
                       : NAME_CLEAR + NAME_CAP + NAME_LIFT + ROW_STRIP;
    var top = noteY + NAME_DOWN + 6, first = top + (column ? 0 : NAME_CAP + NAME_LIFT);      // the first row's ceiling
    var P = { l: column ? Math.ceil(nameW + 14) : 1, r: right, t: top, b: first + (S.length - 1) * pitch + ROW_STRIP };
    var X = xAxis(E, P, false), parts = runs(function (k) { return defined[k]; }, n);
    var spacing = n > 1 ? Math.abs(X.at(1) - X.at(0)) : P.r - P.l, hw = clamp(spacing * 0.3, 2, 8);
    var strips = [], ridges = [], bases = [], ceilings = [], labels = [];
    S.forEach(function (s, i) {
      var ceiling = first + i * pitch, base = ceiling + ROW_STRIP;
      var y = function (k) { return base - Math.max(0, s.y[k]) / full * ROW_STRIP; };
      ceilings.push(seg("tick", P.l, ceiling, P.r, ceiling));
      strips.push(path("area area-" + i + " strip", parts.map(function (run) {
        if (run.length === 1) { var x = X.at(run[0]); return poly([[x - hw, y(run[0])], [x + hw, y(run[0])], [x + hw, base], [x - hw, base]]); }
        return poly(run.map(function (k) { return [X.at(k), y(k)]; }).concat([[X.at(run[run.length - 1]), base], [X.at(run[0]), base]]));
      }).join(" ")));
      var ridge = parts.filter(function (run) { return run.length > 1; })
        .map(function (run) { return trace(run.map(function (k) { return [X.at(k), y(k)]; })); }).join(" ");
      if (ridge) ridges.push(path("ridge", ridge));
      if (i < S.length - 1) bases.push(seg("rowbase", P.l, base, P.r, base));
      var mid = base - ROW_STRIP / 2;
      if (column) lines[i].forEach(function (l, k) { labels.push(label("tick cat", P.l - 8, mid + 4 + (k - (lines[i].length - 1) / 2) * LINE_STEP, l, "end")); });
      else labels.push(label("tick cat", 1, ceiling - NAME_LIFT, lines[i][0]));
    });
    var h = P.b + (str(E.chart.x && E.chart.x.label) ? MARGIN.bottom : 22);
    return { h: h, parts: [].concat(falls(E, P, X.at), ceilings, bases, strips, ridges, [baseline(P, X.marks)], X.labels, labels,
                                    [label("note", beside ? right : 1, noteY, note, beside ? "end" : "start")], axisNames(E, h)) };
  }

  function drawArea(E) {
    if (E.series.length > ROWS_ABOVE) return drawRows(E);
    var S = E.series, n = E.xs.length, cum = S.map(function () { return new Array(n); }), defined = [];
    // An x where any series has no reading is a gap in the whole stack: nothing is filled with 0, nothing slopes into it.
    for (var j = 0; j < n; j++) {
      var acc = 0, ok = S.every(function (s) { return s.y[j] !== null; });
      S.forEach(function (s, i) { acc += ok ? s.y[j] : 0; cum[i][j] = acc; });
      defined.push(ok);
    }
    var tops = [0];
    cum.forEach(function (c) { c.forEach(function (v, k) { if (defined[k]) tops.push(v); }); });
    // Shares written to four decimals can sum to 1.0001: the axis is chosen from the stack rounded to 3 decimals.
    var yr = E.yRange || [Infinity, -Infinity];
    var T = yTicks(Math.min(yr[0], Math.round(minOf(tops) * 1000) / 1000), Math.max(yr[1], Math.round(maxOf(tops) * 1000) / 1000), E);
    var floor = function (i, k) { return i ? cum[i - 1][k] : 0; }, parts = runs(function (k) { return defined[k]; }, n);
    var frame = function (K) {
      var P = plotFrame(E, topFor(E.chart, K, E.w), T.figs);
      return { P: P, Y: yAxis(P, T), X: xAxis(E, P, false) };
    };
    // The three largest series are named inside their own bands when every one of those names fits there whole and
    // reads at full contrast (on the dark bands); otherwise every series is named in the key.
    var largest = S.map(function (s) { return { s: s, total: sum(s.y) }; })
      .sort(function (a, b) { return b.total - a.total; }).slice(0, 3).map(function (it) { return it.s; });
    var L = frame(null), names = null, K = null;
    if (largest.every(function (s) { return s.i % 2 === 1 && s.name; }) && !S.some(function (s) { return s.state; })) {
      names = largest.map(function (s) { return insideName(s, cum, floor, parts, L.X, L.Y); });
      if (!names.every(Boolean)) names = null;
    }
    // The key lists the top band first, so that it reads in the order the bands stand. One series needs no key.
    if (!names && S.length > 1) { K = layKey(S.slice().reverse(), "area", E.chart, E.w); L = frame(K); }
    var P = L.P, X = L.X, Y = L.Y;
    var spacing = n > 1 ? Math.abs(X.at(1) - X.at(0)) : P.r - P.l, hw = clamp(spacing * 0.3, 2, 8);
    var areas = S.map(function (s, i) {
      return path("area area-" + i + (s.state ? " st-" + s.state : i % 2 ? " alt" : ""), parts.map(function (run) {
        if (run.length === 1) {                 // a lone reading is a narrow stacked column
          var k = run[0], x = X.at(k);
          return poly([[x - hw, Y.y(cum[i][k])], [x + hw, Y.y(cum[i][k])], [x + hw, Y.y(floor(i, k))], [x - hw, Y.y(floor(i, k))]]);
        }
        return poly(run.map(function (k) { return [X.at(k), Y.y(cum[i][k])]; })
          .concat(run.slice().reverse().map(function (k) { return [X.at(k), Y.y(floor(i, k))]; })));
      }).join(" "));
    });
    var h = P.b + MARGIN.bottom;
    return { h: h, parts: [].concat(falls(E, P, X.at), Y.grid, areas, [baseline(P, X.marks)], Y.zero, Y.figs, X.labels,
                                    names || [], K ? [K.node] : [], axisNames(E, h)) };
  }

  // A chart with nothing to draw yet (a first live day, a dial with no reading) keeps its frame and says so.
  function drawEmpty(E) {
    var P = plotFrame(E, topFor(E.chart, null, E.w), []), h = P.b + MARGIN.bottom;
    return { h: h, parts: [baseline(P, []), label("empty", (P.l + P.r) / 2, (P.t + P.b) / 2 + 4, NO_READINGS, "middle")]
      .concat(axisNames(E, h)) };
  }

  var DRAW = { line: drawLine, bars: drawBars, loglog: drawLogLog, heat: drawHeat, area: drawArea };

  function drawable(E) {
    var S = E.series, xs = E.xs;
    if (E.chart.kind === "loglog") return S.some(function (s) { return s.y.some(function (v, i) { return v !== null && v > 0 && xs[i] > 0; }); });
    if (E.chart.kind === "area") return xs.some(function (_, j) { return S.every(function (s) { return s.y[j] !== null; }); });
    return S.some(function (s) { return s.y.some(function (v) { return v !== null; }); });
  }

  function ariaLabel(chart) {
    var title = str(chart.title).trim(), what = str(chart.what).trim();
    if (title && !/[.!?]$/.test(title)) title += ".";
    return [title, what].filter(Boolean).join(" ");
  }

  // opts.yRange: [lo, hi], two finite numbers, the lowest first, or nothing. The y axis then covers at least that range,
  // widened to hold any value or bound of the chart outside it, so that charts drawn on one shared range compare. Line,
  // bars and stacked area charts read it; log-log, heat and rows charts keep their own scale. A bad range is refused.
  function yRangeOf(r) {
    if (r == null) return null;
    if (!Array.isArray(r) || r.length !== 2 || !r.every(isNum)) throw new ChartError("its y range is not two finite numbers");
    if (r[0] > r[1]) throw new ChartError("its y range starts above where it ends");
    if (!r.every(sizeOk)) throw new ChartError("its y range is too large to draw");
    return [snap(r[0]), snap(r[1])];
  }

  // The chart as a tree. opts.width is its width, from 120 to 4,000 px. opts.height, from 80 to 4,000 px, is the
  // height most charts take, but not all: a key above the plot adds its rows; horizontal bars are as tall as their rows,
  // so they may be taller; a rows chart (an area of more than four series) and a heat chart are as tall as their rows,
  // so they may be shorter or taller. The root's height and viewBox carry the real height, and a page lays its charts
  // out by them. Only ChartError is thrown.
  function chartTree(chart, opts) {
    var why = problem(chart);
    if (why) throw new ChartError(why);
    var o = opts || {}, w = Math.round(o.width), h0 = Math.round(o.height), out;
    if (!(isNum(w) && w > 0 && isNum(h0) && h0 > 0)) throw new ChartError("it was given no room to draw in");
    if (w < NARROWEST || w > WIDEST) {
      throw new ChartError("it was given " + fmtInt(w) + " px, and a chart is drawn " + NARROWEST + " to " + fmtInt(WIDEST) + " px wide");
    }
    if (h0 < LOWEST || h0 > HIGHEST) {
      throw new ChartError("it was given a height of " + fmtInt(h0) + " px, and a chart is drawn " + LOWEST + " to " + fmtInt(HIGHEST) + " px high");
    }
    var yRange = yRangeOf(o.yRange);
    try {
      var type = axisType(chart.x.values);
      var E = { chart: chart, w: w, h0: h0, xs: type === "number" ? chart.x.values.map(snap) : chart.x.values, type: type, series: prepare(chart),
                days: type === "day" ? chart.x.values.map(function (d) { return parseDay(d).t; }) : null, yRange: yRange };
      out = (drawable(E) ? DRAW[chart.kind] : drawEmpty)(E);
    } catch (e) {
      if (e instanceof ChartError) throw e;
      throw new ChartError("something in it could not be drawn");
    }
    var h = Math.ceil(out.h);
    return node("svg", { class: "mmc" + (o.shelf === "live" ? " live" : ""), role: "img", "aria-label": ariaLabel(chart),
                         viewBox: "0 0 " + w + " " + h, width: w, height: h }, out.parts);
  }

  // ---- the page ----

  function build(n, doc) {
    if (!n || typeof n.t !== "string" || !TAGS.test(n.t)) throw new ChartError("a chart part is not one a chart is made of");
    var el = doc.createElementNS(NS, n.t);
    Object.keys(n.a || {}).forEach(function (k) {
      if (!ATTRS.test(k)) throw new ChartError("a chart part carries an attribute it never should: " + k);
      el.setAttribute(k, String(n.a[k]));
    });
    if (n.x != null) el.textContent = n.x;
    (n.c || []).forEach(function (k) { el.appendChild(build(k, doc)); });
    return el;
  }

  // Puts the chart into parent, in place of the chart mounted there before, if any.
  function mount(tree, parent) {
    var svg = build(tree, parent.ownerDocument);
    var old = null;
    for (var k = parent.firstElementChild; k; k = k.nextElementSibling) {
      if (k.namespaceURI === NS && k.localName === "svg" && /(?:^|\s)mmc(?:\s|$)/.test(k.getAttribute("class") || "")) { old = k; break; }
    }
    if (old) parent.replaceChild(svg, old); else parent.appendChild(svg);
    return svg;
  }

  var MMCharts = {
    ChartError: ChartError, problem: problem, isReference: isReference, refsAsRanges: refsAsRanges,
    axisType: axisType, scale: scale, niceTicks: niceTicks, logTicks: logTicks, dayTicks: dayTicks, tickCount: tickCount,
    chartTree: chartTree, mount: mount,
  };
  return MMCharts;
})();
if (typeof module === "object" && module.exports) module.exports = MMCharts;
