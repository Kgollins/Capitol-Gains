/* MMLanes: the Lanes page's live parts. The lane descriptions are the page's own markup; this reads scoreboard.json
   (the published scoreboard: on the public site its card lines are words, with no figures) and writes each lane's
   "So far" line in plain words, then the full scoreboard, folded, at the end of the page. Text reaches the page as text
   only (MMWorld.el and textContent). Everything except start() is pure, and node tests it. */
var MMLanes = (function () {
  "use strict";

  var World = typeof MMWorld !== "undefined" ? MMWorld : (typeof require === "function" ? require("./world.js") : null);

  // How many lanes trade, as a word. This is the one place to change when a lane joins (the page's "ten lanes" and
  // "ten equal slices" are written from it; the markup's own word is only the fallback without script).
  var LANES_TRADING = "ten";

  var WORDS = {
    reading: "Reading the scoreboard…",
    missing: "The scoreboard is not published yet.",
    damaged: "The scoreboard file could not be read.",
    offline: "The scoreboard could not be loaded. Check the connection and reload.",
    empty: "The scoreboard has no entries yet.",
    noEntry: "Not on the scoreboard yet.",
    noSummary: "No result yet.",
    early: "Too early to say how it compares.",
    noTrades: "No closed trades yet.",
    lanes: "Lanes and trading cards",
    models: "Models (lenses)",
    weeklyNote: "Each nightly lane has a weekly twin that decides once a week and never trades. The weekly twins are left out here.",
    more: "Full text",
  };

  // The sentence every trading lane's scoreboard line starts with; the page explains the gates once, in the shared rules.
  var BYPASS = "Trades on the paper account by the owner's decision of 2026-11-15, before passing its gates.";

  // A summary as sentences. A full stop ends a sentence only before a space and a capital letter (or the end).
  function sentences(text) {
    var s = String(text || "").split(BYPASS).join(" ").replace(/\s+/g, " ").trim();
    return s ? s.split(/(?<=\.)\s+(?=[A-Z])/) : [];
  }
  var DROP = [/^Pretend account: days counted/, /^Pretend account: its days/, /^Against today's system/, /^Today's system/,
              /^Combining members that have no edge/, /^It is also the predator-prey member/, /^It has no random twins/,
              /fault check/i, /^Gate 1/, /^Held back/, /^Why gate 2/];
  var VERDICT = /^Against (its random twins|the S&P 500|its parent card \((.*)\)): (.*)\.$/;

  // A lane's results in plain words, from its scoreboard summary: the claim (said on the page) and the machine lines are
  // dropped; verdicts that all say "too early to say" become one sentence.
  function results(summary) {
    var out = [], verdicts = [], closed = null, s = sentences(summary);
    var at = s.findIndex(function (x) { return /^(?:Pretend account|Record):/.test(x); });
    if (at > 0) s = s.slice(at);                              // the claim comes first: the page already says it
    s.forEach(function (x) {
      var m = VERDICT.exec(x), t = /closed trades, ([a-z ]+?)\.?$/.exec(x), v = /^On the newest decision night, (.*) could vote\.$/.exec(x);
      if (m) { verdicts.push({ who: m[2] ? "its parent lane" : m[1], word: m[3] }); return; }
      if (t && /^Pretend account/.test(x)) { closed = t[1]; return; }
      if (v) { out.push("On the latest night, " + v[1].replace("members", "of its six voters") + " had their data."); return; }
      if (DROP.some(function (re) { return re.test(x); })) return;
      out.push(x);
    });
    var head = [];
    if (closed !== null) head.push(closed === "none yet" ? WORDS.noTrades : "Closed trades: " + closed + ".");
    if (verdicts.length) {
      var same = verdicts.every(function (d) { return d.word === verdicts[0].word; });
      if (same && verdicts[0].word === "too early to say") head.push(WORDS.early);
      else verdicts.forEach(function (d) { head.push("Against " + d.who + ": " + d.word + "."); });
    }
    return head.concat(out).join(" ");
  }

  var STAGE_WORDS = { "Trading (paper)": "Trading on paper.", live: "Running as a pretend account.", written: "Written, not running yet.",
                      retired: "Retired." };
  // The "So far" text of one lane: its stage, then its results.
  function soFar(row) {
    if (!row) return WORDS.noEntry;
    var stage = row.stage ? (STAGE_WORDS[row.stage] || row.stage.charAt(0).toUpperCase() + row.stage.slice(1) + ".") : "";
    var summary = results(row.summary) || WORDS.noSummary;
    return (stage ? stage + " " : "") + summary;
  }

  // {name: row} of the scoreboard's rows.
  function byName(rows) {
    var out = {};
    (rows || []).forEach(function (r) { if (r && r.name && !Object.prototype.hasOwnProperty.call(out, r.name)) out[r.name] = r; });
    return out;
  }

  // What the page says about the scoreboard file: {state, rows, demo}. state is a WORDS key, or null when there are rows.
  function readBoard(res) {
    if (!res || !res.ok) return { state: res && WORDS[res.why] ? res.why : "offline", rows: [], demo: false };
    var rows = World.scoreboardRows(res.data);
    return { state: rows.length ? null : "empty", rows: rows, demo: res.data.demo === true };
  }

  // The scoreboard as shown: lanes and cards first, then models; a weekly card whose nightly twin is listed is left out.
  function groups(rows) {
    var names = byName(rows), lanes = [], models = [];
    rows.forEach(function (r) {
      if (r.kind === "card") {
        var twin = r.name.replace(/ \(version (\d+)\)$/, " (nightly) (version $1)");
        if (twin !== r.name && names[twin]) return;
        lanes.push(r);
      } else models.push(r);
    });
    return { lanes: lanes, models: models };
  }

  // One entry: {title, meta, line, full}. line is the plain first screen; full is the scoreboard's own text.
  function entryParts(row) {
    var meta = [row.written ? "Written " + World.fmtDay(row.written) : "", row.stage ? row.stage.charAt(0).toUpperCase() + row.stage.slice(1) : ""]
      .filter(Boolean).join(" · ");
    var first = row.kind === "card" ? results(row.summary) : (sentences(row.summary)[0] || "");
    return { title: row.name.replace(/^Member: /, ""), meta: meta, line: first, full: row.summary };
  }

  function entry(row) {
    var p = entryParts(row), li = World.el("li");
    li.appendChild(World.el("h3", null, p.title));
    if (p.meta) li.appendChild(World.el("p", { class: "meta" }, p.meta));
    if (p.line) li.appendChild(World.el("p", { class: "summary" }, p.line));
    if (p.full && p.full !== p.line) {
      var d = World.el("details", { class: "more" });
      d.appendChild(World.el("summary", null, WORDS.more));
      d.appendChild(World.el("p", null, p.full));
      li.appendChild(d);
    }
    return li;
  }

  function fill(doc, board) {
    var names = byName(board.rows);
    var lanes = doc.querySelectorAll("[data-board]");
    for (var i = 0; i < lanes.length; i++) {
      var dd = lanes[i].querySelector("[data-sofar]");
      if (!dd) continue;
      dd.textContent = board.state && board.state !== "empty" ? WORDS[board.state] : soFar(names[lanes[i].getAttribute("data-board")]);
    }
    var state = doc.getElementById("board-state"), host = doc.getElementById("board"), box = doc.getElementById("board-box");
    if (state) { state.textContent = board.state ? WORDS[board.state] : ""; state.hidden = !board.state; }
    if (host) {
      while (host.firstChild) host.removeChild(host.firstChild);
      var g = groups(board.rows), shown = g.lanes.length + g.models.length;
      [[WORDS.lanes, g.lanes], [WORDS.models, g.models]].forEach(function (pair) {
        if (!pair[1].length) return;
        host.appendChild(World.el("h3", { class: "board-group" }, pair[0]));
        if (pair[1] === g.lanes) host.appendChild(World.el("p", { class: "board-note" }, WORDS.weeklyNote));
        var ol = World.el("ol", { class: "board" });
        pair[1].forEach(function (r) { ol.appendChild(entry(r)); });
        host.appendChild(ol);
      });
      var sum = doc.getElementById("board-summary");
      if (sum) sum.textContent = "Full scoreboard (" + shown + " entries)";
      if (box) box.hidden = shown === 0;
    }
    var demo = doc.getElementById("lanes-demo");
    if (demo) demo.hidden = !board.demo;
  }

  // The lane count's word, everywhere the page says it.
  function count(doc) {
    var spans = doc.querySelectorAll(".n-lanes");
    for (var i = 0; i < spans.length; i++) spans[i].textContent = LANES_TRADING;
  }
  // A link to #scoreboard (the map's footer) opens the folded scoreboard.
  function openFor(doc, hash) {
    var box = doc.getElementById("board-box");
    if (box && hash === "#scoreboard") box.open = true;
  }

  function start(doc, win) {
    var d = doc || document, w = win || window;
    count(d);
    var toc = d.getElementById("lanes-toc");
    if (toc && w.innerWidth < 1024) toc.open = false;
    openFor(d, w.location.hash);
    w.addEventListener("hashchange", function () { openFor(d, w.location.hash); });
    World.loadJson("scoreboard.json").then(function (res) {
      try { fill(d, readBoard(res)); openFor(d, w.location.hash); } catch (e) { var s = d.getElementById("board-state"); if (s) s.textContent = WORDS.damaged; }
    });
  }

  var MMLanes = { LANES_TRADING: LANES_TRADING, WORDS: WORDS, BYPASS: BYPASS, sentences: sentences, results: results, soFar: soFar,
                  byName: byName, readBoard: readBoard, groups: groups, entryParts: entryParts, fill: fill, count: count,
                  openFor: openFor, start: start };
  if (typeof document !== "undefined" && typeof window !== "undefined" && typeof fetch === "function") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { start(document, window); });
    else start(document, window);
  }
  return MMLanes;
})();
if (typeof module === "object" && module.exports) module.exports = MMLanes;
