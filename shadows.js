/* MMShadows: the Shadows page. It reads shadows.json (written by pi_push from each shadow's own record, see
   marketmap/shadows.py) and draws one plate per shadow, in the file's order: its name, what it does, when it runs, its
   status, its last record, what it recorded then (counts only), when a result is due and what it can show. The page is
   built from plain node descriptions ({tag, attrs, kids, text}) that only make() turns into DOM nodes; text reaches the
   page as text only. Everything except start() is pure, and node tests it. */
var MMShadows = (function () {
  "use strict";

  var WORDS = {
    reading: "Reading the shadows file…",
    missing: "The shadows file is not published yet.",
    damaged: "The shadows file could not be read.",
    offline: "The shadows file could not be loaded. Check the connection and reload.",
    empty: "The shadows file lists no shadow.",
  };
  var STATUS = {
    running: "Running",
    late: "Late: missed a weekday",
    waiting: "Waiting for data",
    not_run: "Not run yet",
    unknown: "Unknown",
  };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // ---- numbers and words ----
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function isDay(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var m = +s.slice(5, 7), d = +s.slice(8, 10);
    return m >= 1 && m <= 12 && d >= 1 && d <= 31;
  }
  function text(v) { return typeof v === "string" ? v : ""; }
  function longDay(day) { return +day.slice(8, 10) + " " + MONTHS[+day.slice(5, 7) - 1] + " " + day.slice(0, 4); }
  function count(v) { return Math.round(v).toLocaleString("en-US"); }
  // "22 November 2026 at 05:21 Central time" from an ISO time; null when it cannot be read.
  function stamp(iso) {
    if (typeof iso !== "string") return null;
    var t = new Date(iso);
    if (!isFinite(t.getTime())) return null;
    try {
      var p = {};
      new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
                                         hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(t).forEach(function (x) { p[x.type] = x.value; });
      return longDay(p.year + "-" + p.month + "-" + p.day) + " at " + p.hour + ":" + p.minute + " Central time";
    } catch (e) { return null; }
  }

  // ---- the model ----
  // {ok: false, why} or {ok: true, items, fixture, updated}. An item with a broken part keeps its other parts.
  function model(doc) {
    if (!doc || typeof doc !== "object" || doc.kind !== "shadows" || !Array.isArray(doc.items)) return { ok: false, why: "damaged" };
    var items = [];
    doc.items.forEach(function (it) {
      if (!it || typeof it !== "object" || !text(it.name)) return;
      var recorded = (Array.isArray(it.recorded) ? it.recorded : []).filter(function (r) {
        return r && text(r.label) && (isNum(r.value) || isDay(r.day));
      }).map(function (r) {
        return { label: r.label, value: isNum(r.value) ? r.value : null, of: isNum(r.of) && r.of > 0 ? r.of : null, day: isDay(r.day) ? r.day : null };
      });
      var days = (Array.isArray(it.days) ? it.days : []).filter(function (d) { return d && isDay(d.day) && isNum(d.rows) && isNum(d.stocks); });
      var due = it.due && typeof it.due === "object" ? it.due : {};
      items.push({
        id: text(it.id), name: it.name, what: text(it.what), runs: text(it.runs), canShow: text(it.can_show), note: text(it.note),
        status: Object.prototype.hasOwnProperty.call(STATUS, it.status) ? it.status : "unknown",
        lastRun: isDay(it.last_run) ? it.last_run : null, recordedOn: isDay(it.recorded_on) ? it.recorded_on : null,
        recorded: recorded, days: days, reportOnly: it.report_only === true,
        due: { what: text(due.what), day: isDay(due.day) ? due.day : null, rule: text(due.rule) },
      });
    });
    if (!items.length) return { ok: false, why: doc.items.length ? "damaged" : "empty" };
    return { ok: true, items: items, fixture: doc.fixture === true, updated: stamp(doc.generated_at) };
  }

  // ---- the plates ----
  function node(tag, attrs, kids, txt) { return { tag: tag, attrs: attrs || {}, kids: kids || [], text: txt == null ? null : String(txt) }; }
  function slug(it, k) { return "sh-" + (/^[a-z0-9_-]+$/i.test(it.id) ? it.id : String(k)); }

  function countText(r) {
    if (r.day) return longDay(r.day);
    return count(r.value) + (r.of !== null ? " of " + count(r.of) : "");
  }
  function dueText(it) {
    var d = it.due, head = d.what || "Result";
    if (d.day) return head + ": " + (/done/i.test(head) ? "" : "about ") + longDay(d.day) + ".";
    return head + ".";
  }

  function status(code) { return node("span", { class: "sh-status", "data-status": code }, null, STATUS[code]); }

  function plate(it, k) {
    var id = slug(it, k);
    var head = [node("h3", { id: id + "-name" }, null, it.name), status(it.status)];
    if (it.reportOnly) head.push(node("span", { class: "quietbadge" }, null, "Report only"));
    var left = [node("p", { class: "sh-what" }, null, it.what)];
    if (it.canShow) left.push(node("p", { class: "sh-can" }, [node("b", null, null, "What it can show"), node("span", null, null, it.canShow)]));
    if (it.note) left.push(node("p", { class: "sh-note" }, null, it.note));

    var facts = [
      node("dt", null, null, "Runs"), node("dd", null, null, it.runs || "Not stated."),
      node("dt", null, null, "Last record"), node("dd", null, null, it.lastRun ? longDay(it.lastRun) : "None yet."),
      node("dt", null, null, "Result"),
      node("dd", null, [node("span", null, null, dueText(it))].concat(it.due.rule ? [node("span", { class: "sh-sub" }, null, it.due.rule)] : [])),
    ];
    var right = [node("dl", { class: "sh-facts" }, facts)];
    if (it.recorded.length) {
      right.push(node("p", { class: "sh-counts-title" }, null, it.recordedOn ? "What it recorded on " + longDay(it.recordedOn) : "What it recorded last"));
      right.push(node("dl", { class: "sh-facts sh-counts" }, [].concat.apply([], it.recorded.map(function (r) {
        return [node("dt", null, null, r.label), node("dd", { class: r.day ? null : "sh-num" }, null, countText(r))];
      }))));
    }
    if (it.days.length) {
      right.push(node("table", { class: "sh-days" }, [
        node("caption", null, null, "The last " + (it.days.length === 1 ? "day" : it.days.length + " days")),
        node("thead", null, [node("tr", null, [node("th", { scope: "col" }, null, "Day"), node("th", { scope: "col" }, null, "Stocks"),
                                              node("th", { scope: "col" }, null, "Option prices")])]),
        node("tbody", null, it.days.map(function (d) {
          return node("tr", null, [node("th", { scope: "row" }, null, longDay(d.day)), node("td", { class: "sh-num" }, null, count(d.stocks)),
                                   node("td", { class: "sh-num" }, null, count(d.rows))]);
        })),
      ]));
    }
    return node("li", null, [node("article", { class: "sh-plate", id: id, "aria-labelledby": id + "-name" }, [
      node("div", { class: "sh-head" }, head), node("div", { class: "sh-left" }, left), node("div", { class: "sh-right" }, right),
    ])]);
  }

  function facts(m) {
    var n = m.items.length, late = m.items.filter(function (i) { return i.status === "late"; }).length;
    var line = (n === 1 ? "One shadow" : n + " shadows") + " on record";
    line += late ? ", " + late + " late." : ", none late.";
    if (m.updated) line += " Updated " + m.updated + ".";
    return line;
  }

  // ---- the page ----
  function make(doc, spec) {
    var el = doc.createElement(spec.tag);
    Object.keys(spec.attrs).forEach(function (k) {
      var v = spec.attrs[k];
      if (v == null || /^on/i.test(k) || k === "href" || k === "src" || k === "style") return;
      el.setAttribute(k, String(v));
    });
    if (spec.text !== null) el.textContent = spec.text;
    spec.kids.forEach(function (c) { el.appendChild(make(doc, c)); });
    return el;
  }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }

  function read(res) {
    if (!res || !res.ok) return { ok: false, why: res && WORDS[res.why] ? res.why : "offline" };
    try { return model(res.data); } catch (e) { return { ok: false, why: "damaged" }; }
  }

  function fill(doc, m) {
    var $ = function (id) { return doc.getElementById(id); };
    var state = $("sh-state");
    if (state) { state.textContent = m.ok ? "" : WORDS[m.why] || WORDS.damaged; state.hidden = m.ok; }
    if ($("sh-items")) $("sh-items").hidden = !m.ok;
    if ($("sh-facts")) { $("sh-facts").textContent = m.ok ? facts(m) : ""; $("sh-facts").hidden = !m.ok; }
    if ($("sh-fixture")) $("sh-fixture").hidden = !(m.ok && m.fixture);
    var list = $("sh-list");
    if (list) { clear(list); if (m.ok) m.items.forEach(function (it, k) { list.appendChild(make(doc, plate(it, k))); }); }
    return m;
  }

  function start(doc) {
    var d = doc || document;
    var World = typeof MMWorld !== "undefined" ? MMWorld : null;
    if (!World || !World.loadJson) { fill(d, { ok: false, why: "offline" }); return; }
    World.loadJson("shadows.json").then(function (res) {
      try { fill(d, read(res)); } catch (e) { fill(d, { ok: false, why: "damaged" }); }
    });
  }

  var MMShadows = { WORDS: WORDS, STATUS: STATUS, model: model, plate: plate, facts: facts, stamp: stamp, dueText: dueText,
                    countText: countText, read: read, make: make, fill: fill, start: start };
  if (typeof document !== "undefined" && typeof window !== "undefined" && typeof fetch === "function") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { start(document); });
    else start(document);
  }
  return MMShadows;
})();
if (typeof module === "object" && module.exports) module.exports = MMShadows;
