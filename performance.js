/* MMPerformance: the Performance page. It reads performance.json (written by pi_push from the lane's day marks and the
   QQQ closes, see marketmap/performance.py) and draws one chart of every lane, each indexed to 100 at its first close,
   with one lane picked out against the Nasdaq-100, and a table ranked by return. The lane buttons and the table's rows
   both pick the lane; before any choice the top-ranked lane is picked. The page is built from plain node descriptions ({tag, attrs, kids, text}) that only make() turns into DOM
   nodes; text reaches the page as text only. Everything except start() is pure, and node tests it. */
var MMPerformance = (function () {
  "use strict";

  var World = typeof MMWorld !== "undefined" ? MMWorld : (typeof require === "function" ? require("./world.js") : null);
  var SVG_NS = "http://www.w3.org/2000/svg";

  var WORDS = {
    reading: "Reading the performance file…",
    missing: "The performance file is not published yet.",
    damaged: "The performance file could not be read.",
    offline: "The performance file could not be loaded. Check the connection and reload.",
    empty: "No lane has a close on record yet.",
    notTraded: "not traded yet",
    noIndex: "The Nasdaq-100 line is not available.",
  };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // ---- numbers and words ----
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function isDay(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function parts(day) { return { y: +day.slice(0, 4), m: +day.slice(5, 7) - 1, d: +day.slice(8, 10) }; }
  function shortDay(day) { var p = parts(day); return p.d + " " + MONTHS[p.m].slice(0, 3); }
  function longDay(day) { var p = parts(day); return p.d + " " + MONTHS[p.m] + " " + p.y; }
  function span(a, b) {
    var p = parts(a), q = parts(b);
    if (a === b) return "on " + longDay(a);
    if (p.y === q.y && p.m === q.m) return "from " + p.d + " to " + longDay(b);
    if (p.y === q.y) return "from " + p.d + " " + MONTHS[p.m] + " to " + longDay(b);
    return "from " + longDay(a) + " to " + longDay(b);
  }
  // A signed figure with a true minus sign; 0.0 has no sign.
  function signed(v, places) {
    var t = Math.abs(v).toFixed(places);
    if (+t === 0) return (0).toFixed(places);
    return (v < 0 ? "−" : "+") + t;
  }
  // "2:40 pm" in Central time, for the time of today's live point; null for a bad stamp.
  function clock(iso) {
    var t = new Date(iso);
    if (typeof iso !== "string" || !isFinite(t.getTime())) return null;
    try {
      return t.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).replace("AM", "am").replace("PM", "pm");
    } catch (e) { return null; }
  }
  // "Last updated 23 Nov, 3:58 pm Central time" from the file's generated_at; null for a bad stamp.
  function updated(iso) {
    var t = new Date(iso), time = clock(iso);
    if (!time) return null;
    try {
      var day = t.toLocaleDateString("en-US", { timeZone: "America/Chicago", day: "numeric", month: "short" });   // "Nov 23"
      var p = day.split(" ");
      return "Last updated " + (p.length === 2 ? p[1] + " " + p[0] : day) + ", " + time + " Central time";
    } catch (e) { return null; }
  }
  function money(v) { return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fix(v) { return Math.round(v * 1000) / 1000; }

  // ---- the model ----
  function numsOrNull(a, n) { return Array.isArray(a) && a.length === n && a.every(function (v) { return v === null || isNum(v); }); }

  // {ok: false, why} or {ok: true, days, n, ndx, qqq, cards, ranked, scale, fixture, note, untraded}.
  function model(doc) {
    if (!doc || typeof doc !== "object" || !Array.isArray(doc.days) || !Array.isArray(doc.cards)) return { ok: false, why: "damaged" };
    var days = doc.days, n = days.length;
    if (!days.every(isDay)) return { ok: false, why: "damaged" };
    if (!n || !doc.cards.length) return { ok: false, why: "empty" };
    var ndx = numsOrNull(doc.ndx, n) && doc.ndx.every(isNum) ? doc.ndx : null;
    var qqq = ndx && numsOrNull(doc.qqq, n) && doc.qqq.every(isNum) ? doc.qqq : null;
    var cards = [];
    for (var k = 0; k < doc.cards.length; k++) {
      var c = doc.cards[k];
      if (!c || typeof c.id !== "string" || !numsOrNull(c.real, n)) return { ok: false, why: "damaged" };
      var first = c.real.findIndex(isNum);
      if (first < 0) continue;
      var real = c.real.map(function (v, i) { return i < first ? null : (isNum(v) ? v : null); });
      for (var i = first + 1; i < n; i++) if (real[i] === null) real[i] = real[i - 1];   // a missed day keeps its last mark
      var inv = numsOrNull(c.investedPct, n) ? c.investedPct : null;
      var idx = ndx ? ndx.map(function (v, i) { return i < first ? null : fix(v / ndx[first] * 100); }) : null;
      var last = real[n - 1];
      cards.push({
        id: c.id, name: typeof c.name === "string" && c.name ? c.name : c.id, first: first, real: real, index: idx,
        navEnd: isNum(c.navEnd) ? c.navEnd : null, start: isNum(c.start) ? c.start : null,
        invested: inv && isNum(inv[n - 1]) ? inv[n - 1] : null, traded: c.traded === true,
        ret: fix(last - 100), vs: idx ? fix(last - idx[n - 1]) : null,
      });
    }
    if (!cards.length) return { ok: false, why: "empty" };
    var all = [100];
    cards.forEach(function (c) { c.real.forEach(function (v) { if (v !== null) all.push(v); }); });
    if (ndx) ndx.forEach(function (v) { all.push(v); });
    var ranked = cards.slice().sort(function (a, b) { return b.ret - a.ret || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
    return {
      ok: true, days: days, n: n, ndx: ndx, qqq: qqq, cards: cards, ranked: ranked, scale: scale(Math.min.apply(null, all), Math.max.apply(null, all)),
      live: doc.live && typeof doc.live === "object" && doc.live.day === days[n - 1] && clock(doc.live.at) ? { day: doc.live.day, at: clock(doc.live.at) } : null,
      updated: updated(doc.generated_at),
      fixture: doc.fixture === true, note: typeof doc.benchmark_note === "string" ? doc.benchmark_note : (ndx ? null : WORDS.noIndex),
      untraded: cards.filter(function (c) { return !c.traded; }).length,
      resplits: (Array.isArray(doc.resplits) ? doc.resplits : []).filter(function (r) {
        return r && isDay(r.day) && isNum(r.from) && isNum(r.to) && r.from > 0 && r.to > 0 && r.from !== r.to;
      }),
    };
  }

  // A shared y-scale with round ticks, 100 always inside: {lo, hi, ticks}.
  function scale(min, max) {
    var range = Math.max(max - min, 0.5), steps = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100], step = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) if (range / steps[i] <= 4) { step = steps[i]; break; }
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    if (hi - lo < step) hi = lo + step;
    if (min - lo < step * 0.15) lo -= step / 2;
    if (hi - max < step * 0.15) hi += step / 2;
    var ticks = [];
    for (var t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) ticks.push(fix(t));
    return { lo: fix(lo), hi: fix(hi), ticks: ticks };
  }

  // ---- node descriptions ----
  function node(tag, attrs, kids, text) { return { tag: tag, attrs: attrs || {}, kids: kids || [], text: text == null ? null : String(text) }; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function pathOf(xs, ys) {
    var d = "", pen = false;
    for (var i = 0; i < xs.length; i++) {
      if (ys[i] === null) { pen = false; continue; }
      d += (pen ? "L" : "M") + r1(xs[i]) + "," + r1(ys[i]); pen = true;
    }
    return d;
  }

  // One chart: every lane faint, the picked lane in the accent colour, the Nasdaq-100 bold, end labels at the right.
  // `width` is the host's shown width (the chart is drawn at its real size, so its text stays its real size).
  function size(width) {
    var w = Math.max(300, Math.min(1200, Math.round(isNum(width) && width > 0 ? width : 640))), narrow = w < 560;
    return { w: w, h: narrow ? 280 : 360, l: 40, r: narrow ? 124 : 168, t: 14, b: 28, narrow: narrow, ch: narrow ? 6.5 : 7.4 };
  }
  function chart(m, pick, width) {
    var z = size(width), s = m.scale, c = m.cards[pick] || m.cards[0];
    var x = function (i) { return m.n < 2 ? (z.l + z.w - z.r) / 2 : z.l + i * (z.w - z.l - z.r) / (m.n - 1); };
    var y = function (v) { return z.t + (s.hi - v) / (s.hi - s.lo) * (z.h - z.t - z.b); };
    var xs = m.days.map(function (_, i) { return x(i); }), last = m.n - 1;
    var line = function (vals) { return pathOf(xs, vals.map(function (v) { return v === null ? null : y(v); })); };
    var kids = [node("title", null, null, label(m, c))];
    s.ticks.forEach(function (t) {
      kids.push(node("line", { class: t === 100 ? "pf-base" : "pf-grid", x1: z.l, x2: z.w - z.r, y1: r1(y(t)), y2: r1(y(t)) }));
      kids.push(node("text", { class: "pf-tick", x: z.l - 8, y: r1(y(t) + 4), "text-anchor": "end" }, null, String(t)));
    });
    var every = z.narrow ? Math.ceil(m.n / 3) : Math.ceil(m.n / 7);
    m.days.forEach(function (d, i) {
      if (i !== 0 && i !== last && i % every) return;
      if (i !== last && i !== 0 && last - i < every / 2) return;
      kids.push(node("text", { class: "pf-tick", x: r1(xs[i]), y: z.h - 8,
                               "text-anchor": m.n < 2 ? "middle" : i === 0 ? "start" : i === last ? "end" : "middle" }, null, shortDay(d)));
    });
    m.cards.forEach(function (o, k) { if (k !== pick) kids.push(node("path", { class: "pf-faint", d: line(o.real) })); });
    if (m.ndx) kids.push(node("path", { class: "pf-ndx", d: line(m.ndx) }));
    kids.push(node("path", { class: "pf-lane", d: line(c.real) }));
    if (m.ndx) kids.push(node("circle", { class: "pf-ndx-dot" + (m.live ? " pf-live" : ""), r: 3.6, cx: r1(xs[last]), cy: r1(y(m.ndx[last])) }));
    kids.push(node("circle", { class: "pf-lane-dot" + (m.live ? " pf-live" : ""), r: 4, cx: r1(xs[last]), cy: r1(y(c.real[last])) }));
    // An end label fits the right margin: the number always shows whole, the name is shortened first.
    var room = Math.floor((z.r - 12) / z.ch);
    var tag = function (name, v) { var num = v.toFixed(1); return clip(name, Math.max(4, room - num.length - 1)) + " " + num; };
    var tags = [{ v: c.real[last], t: tag(c.name, c.real[last]), cls: "pf-end-lane" }];
    if (m.ndx) tags.push({ v: m.ndx[last], t: tag("Nasdaq-100", m.ndx[last]), cls: "pf-end-ndx" });
    tags.sort(function (a, b) { return y(a.v) - y(b.v); });
    var at = -1e9;
    tags.forEach(function (g) {
      var ty = Math.max(y(g.v) + 4, at + 15); at = ty;
      kids.push(node("text", { class: g.cls, x: r1(xs[last] + 9), y: r1(ty) }, null, g.t));
    });
    return node("svg", { class: "pf-chart", width: z.w, height: z.h, viewBox: "0 0 " + z.w + " " + z.h, role: "img", "aria-label": label(m, c) }, kids);
  }
  function clip(s, n) { return s.length > n ? s.slice(0, n - 1).replace(/[ ,]+$/, "") + "\u2026" : s; }

  function label(m, c) {
    var end = shortDay(m.days[m.n - 1]), from = shortDay(m.days[c.first]);
    if (m.live) end += " so far";
    var s = "All " + m.cards.length + " lanes, each 100 at its first close. Picked: " + c.name + ", " + c.real[m.n - 1].toFixed(1) +
            " on " + end + ", from 100 on " + from + ".";
    if (m.ndx) s += " Nasdaq-100: " + m.ndx[m.n - 1].toFixed(1) + " on " + end + ", from 100 on " + shortDay(m.days[0]) + ".";
    if (!c.traded) s += " " + c.name + " has not traded yet and holds only cash.";
    return s;
  }

  // The lane buttons, in the Lanes page's order.
  function chips(m, pick) {
    return m.cards.map(function (c, k) {
      return node("button", { type: "button", class: "pf-chip", "data-k": k, "aria-pressed": k === pick ? "true" : "false" }, null, c.name);
    });
  }

  function row(m, c, rank, k, pick) {
    var name = [node("button", { type: "button", class: "pf-about", "data-about": k, "aria-haspopup": "dialog",
                                 "aria-label": c.name + ": about this lane" }, null, c.name)];
    if (!c.traded) name.push(node("span", { class: "pf-tag" }, null, WORDS.notTraded));
    return node("tr", { "data-k": k, tabindex: 0, class: k === pick ? "pf-sel" : null, "aria-current": k === pick ? "true" : null }, [
      node("td", null, null, String(rank)),
      node("th", { scope: "row" }, name),
      node("td", null, null, c.navEnd === null ? "–" : money(c.navEnd)),
      node("td", { class: c.ret < 0 ? "pf-neg" : c.ret > 0 ? "pf-pos" : "" }, null, signed(c.ret, 1) + "%"),
      node("td", { class: c.vs === null ? "" : c.vs < 0 ? "pf-neg" : c.vs > 0 ? "pf-pos" : "" }, null, c.vs === null ? "–" : signed(c.vs, 1) + " pts"),
      node("td", null, null, c.invested === null ? "–" : Math.round(c.invested) + "%"),
    ]);
  }
  function indexRow(m) {
    if (!m.ndx) return null;
    var ret = fix(m.ndx[m.n - 1] - 100);
    return node("tr", null, [
      node("td", null, null, ""),
      node("th", { scope: "row" }, null, "Nasdaq-100 (QQQ)"),
      node("td", null, null, m.qqq ? money(m.qqq[m.n - 1]) + " a share" : "–"),
      node("td", { class: ret < 0 ? "pf-neg" : ret > 0 ? "pf-pos" : "" }, null, signed(ret, 1) + "%"),
      node("td", null, null, ""), node("td", null, null, ""),
    ]);
  }

  function facts(m) {
    var a = m.days[0], b = m.days[m.n - 1], s = [];
    s.push("The record has " + m.n + " trading " + (m.n === 1 ? "day" : "days") + ", " + span(a, b) + ". That is too few to show skill.");
    if (m.ndx) {
      var r = m.ndx[m.n - 1] - 100;
      s.push("The Nasdaq-100 " + (Math.abs(r) < 0.05 ? "was flat" : (r < 0 ? "fell " : "rose ") + Math.abs(r).toFixed(1) + "%") + " over these days.");
    }
    if (m.untraded) s.push(m.untraded + " of the " + m.cards.length + " lanes " + (m.untraded === 1 ? "has" : "have") + " not traded yet and hold only cash.");
    if (m.live) s.push(liveNote(m));
    return s.join(" ");
  }
  function liveNote(m) {
    return "The last point, " + shortDay(m.live.day) + ", is the day so far, at prices from " + m.live.at +
           " Central time. It updates every 10 minutes, and the lane's mark of the close replaces it after the market closes.";
  }

  var ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];
  // The footnote under the table for each re-split the file says it restated, built from its numbers.
  function resplitNote(r) {
    var p = parts(r.day), when = "On " + p.d + " " + MONTHS[p.m] + " " + p.y;
    var why = isNum(r.parts) && ORDINALS[r.parts] ? " when the " + ORDINALS[r.parts] + " lane joined" : "";
    var verb = r.to < r.from ? "cut" : "raised", what = r.to < r.from ? "the cut" : "the rise";
    return when + " each lane's slice was " + verb + " from " + money(r.from) + " to " + money(r.to) + why + ". " +
           "This page restates the earlier values to the new size, so " + what + " does not read as a " + (r.to < r.from ? "loss" : "gain") + ".";
  }

  // ---- the page ----
  function make(doc, spec, inSvg) {
    var svg = inSvg || spec.tag === "svg", el = svg ? doc.createElementNS(SVG_NS, spec.tag) : doc.createElement(spec.tag);
    Object.keys(spec.attrs).forEach(function (k) {
      var v = spec.attrs[k];
      if (v == null || /^on/i.test(k)) return;
      if (k === "href" && World && World.safeUrl) { v = World.safeUrl(v) || (/^[a-z0-9_-]+\.html(#[A-Za-z0-9_-]+)?$/.test(v) ? v : null); if (!v) return; }
      el.setAttribute(k, String(v));
    });
    if (spec.text !== null) el.textContent = spec.text;
    spec.kids.forEach(function (k) { el.appendChild(make(doc, k, svg)); });
    return el;
  }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }

  // ---- the lane descriptions: read from lanes.html, the one place they are written ----
  var ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0", minus: "\u2212", rarr: "\u2192", times: "\u00d7" };
  function plain(html) {
    return String(html).replace(/<[^>]*>/g, "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (all, e) {
      if (e[0] === "#") { var n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : all; }
      return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : all;
    }).replace(/\s+/g, " ").trim();
  }
  // {id: {name, fig, isNew, claim, facts: [[term, text]]}} from the Lanes page's markup. "So far" is left out: the
  // Lanes page fills it from the scoreboard when it loads, so its markup holds only a placeholder.
  function laneTexts(html) {
    var out = {}, re = /<li class="lane[^"]*" id="([A-Za-z0-9_-]+)"[^>]*>([\s\S]*?)<\/li>\s*(?=<li class="lane|<\/ol>)/g, m;
    while ((m = re.exec(String(html || "")))) {
      var body = m[2], h3 = /<h3>([\s\S]*?)<\/h3>/.exec(body), claim = /<p class="lane-claim">([\s\S]*?)<\/p>/.exec(body);
      var dl = /<dl class="lane-facts">([\s\S]*?)<\/dl>/.exec(body);
      if (!h3) continue;
      var fig = /<span class="fig">([\s\S]*?)<\/span>/.exec(h3[1]), state = /<span class="lane-state">([\s\S]*?)<\/span>/.exec(h3[1]);
      var name = plain(h3[1].replace(/<span class="fig">[\s\S]*?<\/span>/, "").replace(/<span class="lane-state">[\s\S]*?<\/span>/, ""));
      var facts = [], f, fre = /<dt>([\s\S]*?)<\/dt>\s*<dd([^>]*)>([\s\S]*?)<\/dd>/g;
      while (dl && (f = fre.exec(dl[1]))) if (!/data-sofar/.test(f[2])) facts.push([plain(f[1]), plain(f[3])]);
      out[m[1]] = { name: name, fig: fig ? plain(fig[1]) : "", isNew: !!state, claim: claim ? plain(claim[1]) : "", facts: facts };
    }
    return out;
  }
  var ABOUT = { reading: "Reading the lane description\u2026", missing: "The lane description could not be loaded.",
                link: "Open on the Lanes page", here: "On this page" };
  // The popup's body for lane c: the Lanes page's own words, then its slice and status from this page's file.
  function aboutBody(m, c, texts) {
    var t = texts && texts[c.id], kids = [];
    if (texts === null) kids.push(node("p", { class: "pf-about-state" }, null, ABOUT.reading));
    else if (!t) kids.push(node("p", { class: "pf-about-state" }, null, ABOUT.missing));
    else {
      if (t.claim) kids.push(node("p", { class: "pf-about-claim" }, null, t.claim));
      if (t.facts.length) kids.push(node("dl", { class: "pf-about-facts" }, [].concat.apply([], t.facts.map(function (f) {
        return [node("dt", null, null, f[0]), node("dd", null, null, f[1])];
      }))));
    }
    var mine = [["Slice", c.start === null ? "\u2013" : money(c.start) + " at its first close" + (c.navEnd === null ? "" : ", " + money(c.navEnd) + " on " + shortDay(m.days[m.n - 1]))],
                ["Return", signed(c.ret, 1) + "%" + (c.vs === null ? "" : ", " + signed(c.vs, 1) + " points against the Nasdaq-100")],
                ["Status", c.traded ? "Trading on the paper account." + (c.invested === null ? "" : " " + Math.round(c.invested) + "% in stocks at the last close.") : "Not traded yet. It holds only cash."]];
    kids.push(node("h3", { class: "pf-about-sub" }, null, ABOUT.here));
    kids.push(node("dl", { class: "pf-about-facts" }, [].concat.apply([], mine.map(function (f) { return [node("dt", null, null, f[0]), node("dd", null, null, f[1])]; }))));
    kids.push(node("p", { class: "pf-about-link" }, [node("a", { href: "lanes.html#" + c.id }, null, ABOUT.link)]));
    return kids;
  }
  function aboutTitle(c, texts) {
    var t = texts && texts[c.id];
    return t && t.name ? t.name : c.name;
  }
  function fetchText(url) {
    return new Promise(function (resolve) {
      try {
        fetch(url, { cache: "no-cache" }).then(function (r) { return r.ok ? r.text() : null; }).then(resolve, function () { resolve(null); });
      } catch (e) { resolve(null); }
    });
  }

  // What the page says about the file: a model, or {ok: false, why}.
  function read(res) {
    if (!res || !res.ok) return { ok: false, why: res && WORDS[res.why] ? res.why : "offline" };
    try { return model(res.data); } catch (e) { return { ok: false, why: "damaged" }; }
  }

  // The pick before anyone chooses: the top-ranked lane that has traded (a tie of cash-only lanes never wins); the first
  // lane when none has traded.
  function topPick(m) {
    var c = m.ranked.find(function (x) { return x.traded; });
    return c ? m.cards.indexOf(c) : 0;
  }

  function fill(doc, m, win) {
    var $ = function (id) { return doc.getElementById(id); };
    var state = $("perf-state");
    ["perf-lanes", "perf-rank"].forEach(function (id) { if ($(id)) $(id).hidden = !m.ok; });
    if (state) { state.textContent = m.ok ? "" : WORDS[m.why]; state.hidden = m.ok; }
    if ($("perf-facts")) { $("perf-facts").textContent = m.ok ? facts(m) : ""; $("perf-facts").hidden = !m.ok; }
    if ($("perf-fixture")) $("perf-fixture").hidden = !(m.ok && m.fixture);
    if ($("perf-updated")) { $("perf-updated").textContent = m.ok && m.updated ? m.updated + "." : ""; $("perf-updated").hidden = !(m.ok && m.updated); }
    if (!m.ok) return null;
    if ($("perf-note")) { $("perf-note").textContent = m.note || ""; $("perf-note").hidden = !m.note; }
    if ($("perf-key-ndx")) $("perf-key-ndx").hidden = !m.ndx;
    if ($("perf-value-head")) $("perf-value-head").textContent = "Value, " + shortDay(m.days[m.n - 1]) + (m.live ? " so far" : "");
    var host = $("perf-chart"), chipBox = $("perf-chips"), rows = $("perf-rows"), foot = $("perf-foot"), pick = topPick(m);
    function draw() {
      if (host) { clear(host); host.appendChild(make(doc, chart(m, pick, host.clientWidth))); }
      if (chipBox) { clear(chipBox); chips(m, pick).forEach(function (b) { chipBox.appendChild(make(doc, b)); }); }
      if (rows) { clear(rows); m.ranked.forEach(function (c, i) { rows.appendChild(make(doc, row(m, c, i + 1, m.cards.indexOf(c), pick))); }); }
      if ($("perf-picked")) $("perf-picked").textContent = "Picked: " + m.cards[pick].name + ".";
    }
    function choose(k, focus) {
      if (!(k >= 0 && k < m.cards.length)) return;
      pick = k; draw();
      var again = focus && (focus === "chip" ? chipBox : rows) && (focus === "chip" ? chipBox : rows).querySelector('[data-k="' + k + '"]');
      if (again && again.focus) again.focus();
    }
    var keyOf = function (t, sel) { var e = t && t.closest ? t.closest(sel) : null; return e ? +e.getAttribute("data-k") : -1; };
    if (chipBox) chipBox.addEventListener("click", function (e) { var k = keyOf(e.target, "button[data-k]"); if (k >= 0) choose(k, "chip"); });
    if (rows) {
      rows.addEventListener("click", function (e) {
        var about = e.target && e.target.closest ? e.target.closest("button[data-about]") : null;
        var k = keyOf(e.target, "tr[data-k]");
        if (k < 0) return;
        if (about) { choose(k); open(k); return; }                                    // the name: picks the lane and tells about it
        choose(k, "row");
      });
      rows.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (e.target && e.target.tagName === "BUTTON") return;                        // the name button clicks itself
        var k = keyOf(e.target, "tr[data-k]"); if (k >= 0) { e.preventDefault(); choose(k, "row"); }
      });
    }
    // The popup: a native modal dialog. Esc (its cancel), the close button and a click on the backdrop close it, and the
    // focus goes back to the lane's name in the table.
    var dlg = $("perf-about"), dlgTitle = $("perf-about-title"), dlgBody = $("perf-about-body"), texts = null, shownFor = -1;
    function render(k) {
      if (dlgTitle) dlgTitle.textContent = aboutTitle(m.cards[k], texts);
      if (dlgBody) { clear(dlgBody); aboutBody(m, m.cards[k], texts).forEach(function (n) { dlgBody.appendChild(make(doc, n)); }); }
    }
    function open(k) {
      if (!dlg || !(k >= 0 && k < m.cards.length)) return;
      shownFor = k; render(k);
      if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
      var close = $("perf-about-close"); if (close && close.focus) close.focus();
    }
    function shut() {
      if (!dlg) return;
      if (typeof dlg.close === "function") { if (dlg.open) dlg.close(); } else dlg.removeAttribute("open");
    }
    if (dlg) {
      dlg.addEventListener("close", function () {
        var back = rows && rows.querySelector('button[data-about="' + shownFor + '"]');
        shownFor = -1;
        if (back && back.focus) back.focus();
      });
      dlg.addEventListener("click", function (e) { if (e.target === dlg) shut(); });     // a click on the backdrop
      var closeBtn = $("perf-about-close"); if (closeBtn) closeBtn.addEventListener("click", shut);
      lanesText().then(function (html) { texts = html ? laneTexts(html) : {}; if (shownFor >= 0) render(shownFor); });
    }
    if (foot) { clear(foot); var ix = indexRow(m); if (ix) foot.appendChild(make(doc, ix)); }
    var rs = $("perf-resplit");
    if (rs) { rs.textContent = m.resplits.map(resplitNote).join(" "); rs.hidden = !m.resplits.length; }
    draw();
    if (win && win.addEventListener && host) {
      var shown = host.clientWidth, timer = null;
      win.addEventListener("resize", function () {
        clearTimeout(timer);
        timer = setTimeout(function () { if (Math.abs(host.clientWidth - shown) > 8) { shown = host.clientWidth; draw(); } }, 150);
      });
    }
    return { choose: choose, pick: function () { return pick; }, open: open, close: shut, shownFor: function () { return shownFor; } };
  }

  // lanes.html, read once; the tests replace it.
  var lanesText = function () { return fetchText("lanes.html"); };
  function useLanesText(fn) { lanesText = fn; }

  function start(doc, win) {
    var d = doc || document, w = win || window;
    World.loadJson("performance.json").then(function (res) {
      try { fill(d, read(res), w); } catch (e) { fill(d, { ok: false, why: "damaged" }); }
    });
  }

  var MMPerformance = { WORDS: WORDS, model: model, scale: scale, signed: signed, span: span, shortDay: shortDay, facts: facts, liveNote: liveNote, clock: clock, updated: updated, resplitNote: resplitNote,
                        chart: chart, size: size, chips: chips, row: row, indexRow: indexRow, label: label, read: read, make: make,
                        topPick: topPick, fill: fill, start: start, plain: plain, laneTexts: laneTexts, aboutBody: aboutBody,
                        aboutTitle: aboutTitle, ABOUT: ABOUT, useLanesText: useLanesText };
  if (typeof document !== "undefined" && typeof window !== "undefined" && typeof fetch === "function") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { start(document, window); });
    else start(document, window);
  }
  return MMPerformance;
})();
if (typeof module === "object" && module.exports) module.exports = MMPerformance;
