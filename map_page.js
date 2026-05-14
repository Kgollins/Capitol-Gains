/* map_page.js: the ripple map's page. It loads the map's files (the layout and the newest reading first, the recent days
   and, on the private page, the explored years' index after the first paint, and a month of the explored years only when
   the step shown or its look-back reaches it), builds the scene of the step shown with MapCore, draws it with MapDraw into
   layers, and writes the sentence, the key, the dials, the colony names, the captions and the soil core. The soil core
   drives time: play, speed, a pin to drag and the keys move through the record with MapCore's player, and the one motion
   is a step's pulses growing along their recorded threads (a forward step to the next entry; any other move is a cut, and
   with reduced motion every move is). Nothing moves otherwise: with no move running, no frame is drawn. While the page is
   visible it reads the newest reading again every two minutes. A tap or a click on a cap opens its record (and follows its
   newest catalyst), a caption follows its own catalyst and its cascade, the tools switch the kinds of link, keep the
   account's positions lit and find a stock, the wheel, a pinch, a drag and a double tap move the view, and the foot opens
   the scoreboard. Every word on the page comes from MapCore or MMWorld as they return it, or is this file's own plain copy
   below, and every text from a file reaches the page as text. When a file is missing or cannot be read, the page says so
   and shows what it has. It defines no global. */
(function () {
  "use strict";

  var C = MapCore, D = MapDraw, W = MMWorld;
  var DPR_MAX = 2;                 // the canvases are never drawn finer than two pixels per CSS pixel
  var SETTLE_MS = 120;             // after a pan or zoom, the static layer is rebuilt this long after the last move
  var EDGE = 14;                   // no plate or name is placed closer than this to the screen's edge
  var NARROWEST = 360;             // the narrowest screen the map is composed for; narrower ones are told so (text alternative)
  var EDGE_MIN = 8;                // and the field keeps its mode's padding (MapCore.LAYOUT_MODES), never less than this
  var CLEAR = 12;                  // nor closer than this to the sentence, the dials, the core or the foot
  var GROUND_SEED = 1811;
  var MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
  var COPY = {
    loading: "Reading the map…",
    noLayout: "The map has no stocks placed yet.",
    damaged: "A map file could not be read; the rest is shown as it is.",
    noHistory: "The record of the recent days could not be read; the newest reading is shown alone.",
    runin: "run-in days: shown, never counted",
    closed: "closed years, kept shut",
    broken: "The map could not be drawn.",
    monthFailed: "This month could not be loaded.",
    nextMonthFailed: "The next month could not be loaded.",
    owedClose: "The newest close could not be read yet; the reading before it is shown.",
    owedReading: "The newest reading could not be read yet; the reading before it is shown.",
    linkDay: "The link asks for a day this map does not hold; the newest reading is shown.",
    noIndex: "The record of the explored years could not be read; the recent days are shown.",
    olderPrivate: "Older days are on the private page.",
    deeper: function (year) { return "Older days lie deeper. Drag back through them to " + year + "."; },
    reading: "loading",
    today: "today",
    narrow: "This screen is narrower than the map is made for (360 pixels wide or more): parts of it are cramped.",
    play: "Play through history",
    pause: "Pause",
    close: "Close",
    echoes: "Echoes",
    links: "Its strongest links",
    linksOf: function (month) { return "Its strongest links, " + month; },
    linkedBy: "Stocks it is a strong link for",
    linkedByOf: function (month) { return "Stocks it is a strong link for, " + month; },
    noEvidence: "What these links rest on could not be read.",
    readingEvidence: "Reading what these links rest on…",
    noPositions: "The account's positions could not be read.",
    heldUnknown: "the account's positions could not be read",
    offMap: function (t) { return t + " is not on the map."; },
    nothingFound: "No stock of the map has that ticker or name.",
    board: "The scoreboard",
    boardLede: "Every lens (an idea of how the market behaves) and every card (a trading rule) written so far, and where each one stands.",
    boardReading: "Reading the scoreboard…",
    boardMissing: "The scoreboard has not been published yet.",
    boardDamaged: "The scoreboard file could not be read.",
    boardOffline: "The scoreboard could not be loaded. Check the connection and reload.",
    boardReport: "the history-test report",
    cascadeOf: function (n, t, day) { return "Part of a cascade of " + n + " stocks that began at " + t + " on " + day + "."; },
    cascadeAtLeast: function (n, d, today) {
      return "Part of a cascade of at least " + n + " stocks that began at least " + d + (today ? " days ago." : " days before that day.");
    },
    cascadeSome: function (d, today) { return "Part of a cascade that began at least " + d + (today ? " days ago." : " days before that day."); },
    cascadeUnknown: function (n) { return "Part of a cascade of at least " + n + " stocks; where it began is not in this record."; },
  };
  var PLAY_D = "M4.5 2.5 L13 8 L4.5 13.5 Z", PAUSE_D = "M4 2.5 H7 V13.5 H4 Z M9 2.5 H12 V13.5 H9 Z";
  var SPEEDS = [1, 2, 4, 8];
  var POLL_MS = 120000;            // the newest reading is read again this often while the page is visible
  var CLOCK_MS = 60000;            // and the clock is checked for staleness this often
  var DRAG_WAIT_MS = 160;          // a month is fetched once a drag has rested on it this long
  var PREFETCH = 5;                // the next month is fetched when play comes within this many steps of its end
  var DIM_ALPHA = 0.25;             // a dimmed mark, as MapDraw dims a cap
  var RECORD_W = 320;              // the record's plate on a wide screen
  var LINKS_WIDE = 5, LINKS_PHONE = 3;     // the links its record lists each way, on a wide screen and on a phone
  var RECORD_H = 440;              // at most this tall (it scrolls inside)
  var FIND_ZOOM = 2.5;             // a stock found is shown at this many times the fitted zoom
  var TAP_MOVE = 8;                // a press that moves further than this is a drag, not a tap
  var TAP_MS = 500;                // nor is one held longer than this
  var DOUBLE_MS = 320, DOUBLE_GAP = 32;   // a second tap this soon and this near the first zooms in
  var WHEEL_RATE = 0.0016;         // the zoom per pixel of wheel
  // The longest sentence a step can be given (MapCore's longest head, an incomplete close; its longest sub, a day of the
  // explored years with ripples off the map), so the band the sentence takes is the same on every step and the field never
  // moves with the text. The notes line about a missing or damaged file is not held in reserve: it appears only when
  // something went wrong, and the field may then move once.
  var LONGEST = {
    head: "Nine catalysts that day. Too soon to say what spread: the earlier days are not all in this record.",
    sub: "The ripple map on 30 September 2015, at the close. Nine of the catalysts counted here cannot be drawn: they are on, or reached only, " +
         "stocks the map has not placed yet. " +
         "Attention readings start in 2016. The pale threads are this month's links; the coloured threads are that day's record.",
    // A phone shows the sub's first sentence (the longest is a stale reading's age),
    // with the lines it never cuts (the off-map line, the run-in line and the start of live recording).
    subShort: "The newest reading is from 30 September 2027, twenty-seven days ago. Nine of the catalysts counted here cannot be drawn: " +
              "they are on, or reached only, stocks the map has not placed yet. A run-in day: shown, never counted.",
  };

  function part(name) { return document.querySelector('[data-mm="' + name + '"]'); }
  function corePart(name) { return document.querySelector('[data-core="' + name + '"]'); }
  function tool(name) { return document.querySelector('[data-tool="' + name + '"]'); }
  var el = W.el;
  var ui = {
    field: part("field"), head: part("head"), sub: part("sub"), notes: part("empty"), key: part("key"), dials: part("dials"),
    labels: part("labels"), captions: part("captions"), alt: part("alt"), core: part("core"), foot: part("foot"),
    top: document.querySelector(".map-say"), bottom: document.querySelector(".map-bottom"),
    strip: corePart("strip"), years: corePart("years"), when: corePart("when"), recent: corePart("recent"), note: corePart("note"),
    time: corePart("time"), clock: corePart("clock"), play: corePart("play"), icon: corePart("icon"), range: corePart("range"),
    speed: corePart("speed"),
    demo: document.querySelector('[data-foot="demo"]'), held: document.querySelector('[data-k-label="held"]'),
    tools: part("tools"), record: part("record"), board: part("scoreboard"), boardLink: document.querySelector('[data-foot="scoreboard"]'),
    tNews: tool("news"), tComove: tool("comove"), tMine: tool("mine"), tFind: tool("find"), tReset: tool("reset"),
    findBox: tool("findbox"), q: tool("q"), found: tool("found"), toolNotes: tool("notes"),
    folds: { key: document.querySelector('[data-fold="key"]'), tools: document.querySelector('[data-fold="tools"]'),
             dials: document.querySelector('[data-fold="dials"]') },
    foldRow: document.querySelector(".map-folds"), topBand: document.querySelector(".map-top"),
  };
  var SANS = "sans-serif";

  // ---- what the page holds ----
  var S = {
    layout: null, L: null, ix: null, state: null, stateFrame: null, history: null, index: null, months: C.monthCache(6),
    binds: new WeakMap(), T: null, k: -1, scene: null, still: false, problems: [], refused: new Set(), when: null, loading: true,
    w: 0, h: 0, dpr: 1, view: null, pos: null, band: 0, fitKey: "", drawn: null, mode: null, sheetPan: null,
    A: null, Th: null, B: null, groundView: null, threadsView: null, threadsOf: null, builtView: null, settle: 0,
    caps: [], unplaced: [], trail: new Set(), labelsView: null, labelBoxes: [], u: 1, nowMs: NaN, today: null, hash: null,
    // time: the player's state, the step's move, the layers above the static one, the months being read
    P: null, raf: 0, timer: 0, poll: 0, clock: 0, polling: false, Pl: null, O: null, pulseU: 0, pulseView: null,
    aboveView: null, aboveFlush: null, inflight: new Map(), failed: new Set(), waitFailed: null, ensureT: 0, dragging: false,
    pendingK: null, inputRaf: 0, addr: null, addrT: 0, freeze: null, reduced: false, core: null, coreT: null, coreW: 0, corePub: null,
    owed: null, linkNote: null, threadsSplit: null, isoThreads: null,
    // what the viewer picked: MapCore's ui state {sel, cat, kinds, mine, query}, and what the page made of it on the step shown
    U: C.ui(null), back: [], read: [], catWhy: null, cascade: null, members: new Set(), mineSet: null, offMap: [], mineThreads: null,
    // the view's gestures, the plates and the files read on demand
    fit: null, grid: null, gridPos: null, pointers: new Map(), gesture: null, lastTap: null, pendingView: null, viewRaf: 0, moving: false,
    extras: null, evidence: null, evidenceFailed: false, positions: null, recordBox: null, opener: null,
    findOpen: false, found: [], boardOpen: false, boardFile: null, boardAsked: false,
  };

  function isObj(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function note(line) { if (S.problems.indexOf(line) < 0) S.problems.push(line); }
  function problem() { note(COPY.damaged); }
  // Frames a readable file holds but the decoder refused: each such day is said (once, however many of its slots were
  // refused), never skipped in silence.
  function refusedIn(file) {
    if (file && Array.isArray(file.refused)) file.refused.forEach(function (r) { S.refused.add(r && typeof r.day === "string" ? r.day : "?"); });
  }
  function refusedLine() {
    var n = S.refused.size;
    return n === 0 ? null : n === 1 ? "One day of the record could not be read." : W.numberWord(n, true) + " days of the record could not be read.";
  }

  // The clock: the address's `now` when it gives one (so a look at a stale or fresh reading never depends on the day it
  // is taken), else the machine's. Today is the New York date of that clock.
  var NY_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  function clockMs() { var n = C.nowMs(S.hash ? S.hash.now : null); return isNaN(n) ? Date.now() : n; }
  function nyDay(ms) { return NY_DAY.format(new Date(ms)); }

  // ---- reading the files ----

  // The layout keeps only the stocks it gives a place to; a stock without one is off the map, and the scene counts what
  // happens there as off-map (carry rule 5). With no placed stock at all, nothing is placed.
  function takeLayout(res) {
    if (!res.ok) { if (res.why !== "missing") problem(); return; }
    var L = res.data;
    if (!isObj(L) || !Array.isArray(L.nodes)) { problem(); return; }
    var nodes = L.nodes.filter(function (nd) { return isObj(nd) && typeof nd.t === "string" && isNum(nd.x) && isNum(nd.y); });
    if (!nodes.length) return;
    var copy = {}; Object.keys(L).forEach(function (key) { copy[key] = L[key]; });
    copy.nodes = nodes;
    S.layout = copy;
    S.ix = C.edgeIndex(copy);
  }
  function takeState(res) {
    if (!res.ok) { if (res.why !== "missing") problem(); return; }
    var st = res.data;
    if (!isObj(st)) { problem(); return; }
    S.state = st;
    if (isObj(st.frame) && Array.isArray(st.tickers)) {
      var got = C.decodeFrame(st.frame, st.tickers.length, st.public === true, st.sectors);
      if (got.ok) S.stateFrame = { f: got.f, tickers: st.tickers, sectors: Array.isArray(st.sectors) ? st.sectors : [] };
      else problem();
    } else problem();                                 // a state with no readable frame is not a reading
  }
  // Without the recent days the page stays on the newest reading, and says so when there is one to show alone.
  function noHistory() { if (S.stateFrame && S.layout) note(COPY.noHistory); }
  function takeHistory(res) {
    if (!res.ok) { noHistory(); if (res.why !== "missing") problem(); return; }
    var h = C.decodeFile(res.data);
    if (!h.ok) { noHistory(); problem(); return; }
    S.history = h;
    refusedIn(h);
  }
  function bindOf(file) {
    if (!S.layout || !file) return null;
    if (!S.binds.has(file)) S.binds.set(file, C.bind(S.layout, file.tickers));
    return S.binds.get(file);
  }
  // A month of the explored years, read once and held (six at most). The name comes from a timeline entry, never from the
  // address. A month that cannot be read is remembered as failed until it is asked for again.
  function loadMonth(m) {
    if (!MONTH.test(m) || S.months.has(m)) return Promise.resolve(true);
    if (S.inflight.has(m)) return S.inflight.get(m);
    S.failed.delete(m);
    var p = W.loadJson("frames/" + m + ".json").then(function (res) {
      var f = res.ok ? C.decodeFile(res.data) : null;
      if (f && f.ok) { S.months.put(m, f); refusedIn(f); return true; }
      S.failed.add(m);
      return false;
    }).then(function (ok) { S.inflight.delete(m); return ok; });
    S.inflight.set(m, p);
    return p;
  }
  // The months of the explored years step k needs: its own, those its look-back reaches, and the step before when the move
  // into k eases from it.
  function ownMonth(k) { var e = S.T && S.T.entries[k]; return e && e.seg === "deep" ? e.month : null; }
  function needs(k) {
    var out = [];
    if (!S.T || !S.T.entries[k]) return out;
    var items = S.T.lookback(k).items.slice();
    if (k > 0 && S.T.adjacent(k - 1, k)) items.push({ k: k - 1 });
    items.forEach(function (it) {
      var e = S.T.entries[it.k];
      if (e && e.seg === "deep" && out.indexOf(e.month) < 0) out.push(e.month);
    });
    return out;
  }
  // Every month step k needs is held, or could not be read (its own month excepted: a step whose own month failed is not
  // in hand, and play stays where it is).
  function inHandFor(k) {
    var own = ownMonth(k);
    return needs(k).every(function (m) { return S.months.has(m) || (S.failed.has(m) && m !== own); });
  }
  // A month step k needs is still being read, or not asked for yet.
  function waiting(k) {
    return needs(k).some(function (m) { return !S.months.has(m) && !S.failed.has(m); });
  }
  // Read the months step k needs. A month that failed before is asked for again only when it is the step's own month and
  // `again` is set (a move onto it), so a look-back into a missing month never asks over and over.
  function ensure(k, again) {
    var own = ownMonth(k);
    var want = needs(k).filter(function (m) { return !S.months.has(m) && (!S.failed.has(m) || (again && m === own)); });
    if (!want.length) return Promise.resolve();
    var all = Promise.all(want.map(loadMonth));
    guarded(drawCore);
    return all.then(function () { guarded(drawCore); });
  }

  // The frame of timeline entry k as {f, bind, file}, or null when it is not in hand (a month not loaded or refused).
  function frameAt(k) {
    var e = S.T && S.T.entries[k];
    if (!e) return null;
    if (e.seg !== "deep") {
      var f = S.history && e.fi >= 0 ? S.history.frames[e.fi] : null;
      return f ? { f: f, bind: bindOf(S.history), file: S.history } : null;
    }
    var file = S.months.get(e.month);
    if (!file) return null;
    for (var a = 0; a < file.frames.length; a++) {
      var g = file.frames[a];
      if (g.day === e.day && g.slot === e.slot) return { f: g, bind: bindOf(file), file: file };
    }
    return null;
  }

  // ---- the kind of screen ----

  // MapCore.layoutMode names the composition for the screen's size: desktop, tablet, phone, or a phone on its side. The body
  // carries it for the stylesheet; the page reads it for the captions, the dials' size, the field's padding, the record's
  // form, the sub's length and the folds. On a phone the key and the tools fold behind a switch each (one open at a time,
  // over the field, so the field never moves); on its side the dials fold too. Elsewhere every fold stands open.
  // A phone upright folds the dials too, their switch in the row with the other two (so the field runs from under the
  // sentence to the soil core); on its side the dials' switch stands beside the head line.
  var FOLDED = { "phone": { key: false, tools: false, dials: false }, "phone-landscape": { key: false, tools: false, dials: false } };
  function modeOf() { return C.LAYOUT_MODES[S.mode] || C.LAYOUT_MODES.desktop; }
  function folded() { return Object.prototype.hasOwnProperty.call(FOLDED, S.mode); }
  function dialsFolded() { return folded(); }
  function applyMode() {
    var m = C.layoutMode(S.w, S.h);
    if (m === S.mode) return false;
    S.mode = m;
    D.setMarkScale(modeOf().marks);
    document.body.setAttribute("data-mode", m);
    // The dials' fold lives in the phone's row of switches, and at the end of the top band everywhere else.
    var dials = ui.folds.dials, home = m === "phone" ? ui.foldRow : ui.topBand;
    if (dials && home && dials.parentNode !== home) { if (dials.parentNode) dials.parentNode.removeChild(dials); home.appendChild(dials); }
    Object.keys(ui.folds).forEach(function (k) { if (ui.folds[k]) ui.folds[k].open = FOLDED[m] ? FOLDED[m][k] : true; });
    if (S.findOpen && FOLDED[m] && ui.folds.tools) ui.folds.tools.open = true;
    return true;
  }
  // A fold opened on a folded screen closes the others.
  function onFold(k) {
    var d = ui.folds[k];
    if (!folded() || !d || !d.open) return;
    Object.keys(ui.folds).forEach(function (o) {
      var x = ui.folds[o];
      if (x && x !== d && x.open) x.open = false;
    });
  }
  function openTools() { if (folded() && ui.folds.tools && !ui.folds.tools.open) { ui.folds.tools.open = true; onFold("tools"); } }

  // ---- the field: where the layout is drawn ----

  // The band the sentence takes: measured once per screen size with the longest sentence and every key entry shown, then
  // held as the header's least height. The same stock sits in the same place on every step.
  function reserveBand() {
    var keep = { head: ui.head.textContent, sub: ui.sub.textContent, notes: ui.notes.textContent, hidden: ui.notes.hidden };
    var keys = Array.prototype.slice.call(ui.key.querySelectorAll("li")), was = keys.map(function (li) { return li.hidden; });
    ui.top.style.minHeight = "";
    ui.head.textContent = LONGEST.head; ui.sub.textContent = folded() ? LONGEST.subShort : LONGEST.sub; ui.notes.hidden = true;
    keys.forEach(function (li) { li.hidden = false; });
    S.band = Math.ceil(ui.top.getBoundingClientRect().height);
    ui.head.textContent = keep.head; ui.sub.textContent = keep.sub; ui.notes.textContent = keep.notes; ui.notes.hidden = keep.hidden;
    keys.forEach(function (li, q) { li.hidden = was[q]; });
    ui.top.style.minHeight = S.band + "px";
  }
  function rectOf(node) { var r = node.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
  // The rectangles the caps keep clear of: the sentence's band, the dials and the core with the foot.
  function overlays() {
    var out = [];
    if (ui.top && ui.top.offsetParent !== null) out.push(rectOf(ui.top));
    var d = rectOf(ui.dials);
    if (d.w > 0 && d.h > 0 && !dialsFolded()) out.push(d);        // folded, the dials open over the field and only their switch stays
    var sw = dialsFolded() && ui.folds.dials ? ui.folds.dials.querySelector("summary") : null, r = sw ? rectOf(sw) : null;
    if (r && r.w > 0 && r.h > 0) out.push(r);
    var b = rectOf(ui.bottom);
    if (b.w > 0) out.push(b);
    return out;
  }

  // The layout as drawn. Its nodes are fitted into the screen's free space, clear of the overlays and the screen's edges,
  // as large as they go, at one scale on both axes: nothing is stretched (Task 21 finish review). The fit may turn the layout
  // rigidly so its long axis lies along the screen's (MapCore.layoutTurn), when that gives a larger field; a turn distorts
  // nothing, so neighbours stay neighbours and every colony keeps its shape. Returns {L, view}: L is the layout with its nodes moved into the unit square, view places it.
  function fitField(layout, w, h, avoid, pad) {
    var edge = isNum(pad) ? pad : EDGE_MIN, nodes = layout.nodes, n = nodes.length;
    var rects = avoid.map(function (r) { return { x0: r.x - CLEAR, x1: r.x + r.w + CLEAR, y0: r.y - CLEAR, y1: r.y + r.h + CLEAR }; });
    var best = null;
    // The layout as it is, and turned so its long axis lies along the screen's: whichever gives the larger true field.
    [0, C.layoutTurn(nodes, w >= h)].forEach(function (turn, q) {
      if (q === 1 && Math.abs(turn) < 0.05) return;
      var xy = C.turnedXY(nodes, turn), xs = xy[0], ys = xy[1];
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      var xc = (x0 + x1) / 2, yc = (y0 + y1) / 2, bw = Math.max(x1 - x0, 1e-3), bh = Math.max(y1 - y0, 1e-3);
      function clearAt(k, cx, cy) {
        for (var i = 0; i < n; i++) {
          var X = cx + k * (xs[i] - xc), Y = cy + k * (ys[i] - yc);
          if (X < edge || X > w - edge || Y < edge || Y > h - edge) return false;
          for (var r = 0; r < rects.length; r++) { var R = rects[r]; if (X > R.x0 && X < R.x1 && Y > R.y0 && Y < R.y1) return false; }
        }
        return true;
      }
      function placeAt(k) {                          // a centre where the field at this size is clear, or null
        var cxLo = edge + k * bw / 2, cxHi = w - edge - k * bw / 2, cyLo = edge + k * bh / 2, cyHi = h - edge - k * bh / 2;
        if (cxLo > cxHi || cyLo > cyHi) return null;
        var cxs = [w / 2, (cxLo + cxHi) / 2, cxLo + (cxHi - cxLo) * 0.35, cxLo + (cxHi - cxLo) * 0.65];
        for (var b = 0; b <= 10; b++) {
          var cy = cyLo + (cyHi - cyLo) * [0.5, 0.6, 0.4, 0.7, 0.3, 0.8, 0.2, 0.9, 0.1, 1, 0][b];
          for (var c = 0; c < cxs.length; c++) {
            var cx = Math.min(cxHi, Math.max(cxLo, cxs[c]));
            if (clearAt(k, cx, cy)) return { cx: cx, cy: cy };
          }
        }
        return null;
      }
      var hi = Math.min((w - 2 * edge) / bw, (h - 2 * edge) / bh), lo = 0, spot = null;
      for (var it = 0; it < 16; it++) {
        var k = (lo + hi) / 2, got = placeAt(k);
        if (got) { lo = k; spot = got; } else hi = k;
      }
      if (!spot) return;
      if (!best || lo > best.k * 1.05) best = { k: lo, cx: spot.cx, cy: spot.cy, xs: xs, ys: ys, xc: xc, yc: yc, bw: bw, bh: bh };
    });
    if (!best) return { L: layout, view: C.fitView({ x: 0, y: 0, w: w, h: h }, edge), ok: false };
    // The display layout: x' = 0.5 + (x - xc) u and y' = 0.5 + (y - yc) u, one scale u keeping it inside the unit square.
    var u = 1 / Math.max(best.bw, best.bh), K = best.k / u;
    var moved = nodes.map(function (nd, i) {
      var o = {}; Object.keys(nd).forEach(function (key) { o[key] = nd[key]; });
      o.x = 0.5 + (best.xs[i] - best.xc) * u; o.y = 0.5 + (best.ys[i] - best.yc) * u;
      return o;
    });
    var L = {}; Object.keys(layout).forEach(function (key) { L[key] = layout[key]; });
    L.nodes = moved;
    return { L: L, view: { k: K, tx: best.cx - K * 0.5, ty: best.cy - K * 0.5, base: K }, ok: true };
  }

  // ---- the canvases and their layers ----

  // Canvas A, the ground: drawn on a resize only. The threads layer: drawn when the view or the kinds of link change. Canvas
  // B, the step's static layer, with the ground and the threads under it: drawn when the step, the view or a filter changes.
  // Above it, two layers made for the step: the pulse layer (Pl), grown frame by frame while the step's move runs, and the
  // layer of caps that sit above the pulses and do not ease (O), drawn at the start of the step and once more when the caps
  // a pulse reached take its tone. The screen shows B, Pl and O, then draws the few caps that ease at each frame.
  function canvas() { return document.createElement("canvas"); }
  function sizeCanvases() {
    var w = Math.max(1, ui.field.clientWidth), h = Math.max(1, ui.field.clientHeight), dpr = Math.min(DPR_MAX, Math.max(1, window.devicePixelRatio || 1));
    S.w = w; S.h = h; S.dpr = dpr;
    S.A = S.A || canvas(); S.Th = S.Th || canvas(); S.B = S.B || canvas(); S.Pl = S.Pl || canvas(); S.O = S.O || canvas();
    [ui.field, S.A, S.Th, S.B, S.Pl, S.O].forEach(function (c) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); });
    var g = S.A.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    D.ground(g, w, h, GROUND_SEED);
    S.groundView = null; S.threadsView = null; S.threadsOf = null; S.pulseView = null; S.aboveView = null;
  }
  function fresh(c) { var g = c.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); return g; }
  function rebuildStatic() {
    var opts = { layout: S.L, pos: S.pos, w: S.w, h: S.h, threads: false, trail: S.trail };
    var list = S.scene && S.scene.threads, split = isolatedThreads();
    if (S.threadsView !== S.view || S.threadsOf !== list || S.threadsSplit !== split) {
      var t = fresh(S.Th);
      if (S.scene && S.view && split) {
        // While a catalyst is isolated, the pale threads that touch no cap of its trail are drawn as dim as the caps are.
        t.globalAlpha = DIM_ALPHA; D.drawThreads(t, { threads: split.dim }, S.view, opts);
        t.globalAlpha = 1; D.drawThreads(t, { threads: split.lit }, S.view, opts);
      } else if (S.scene && S.view) D.drawThreads(t, S.scene, S.view, opts);
      S.threadsView = S.view; S.threadsOf = list; S.threadsSplit = split;
    }
    if (!S.groundView) S.groundView = S.view;
    var g = fresh(S.B);
    g.setTransform(1, 0, 0, 1, 0, 0);
    moved(g, S.A, S.groundView, S.view);
    moved(g, S.Th, S.threadsView, S.view);
    g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    S.drawn = S.scene && S.view ? D.drawStatic(g, S.scene, S.view, opts) : null;
    S.builtView = S.view;
    S.pulseView = null; S.aboveView = null;          // the layers above are made again for this step and view
  }
  // The pale threads of an isolated catalyst's step, split into those that touch a cap of its trail (the caps the scene keeps
  // lit: the catalyst, the stocks its rows reach or pass through, its cascade) and the rest; made once per scene's threads and
  // trail. null when no catalyst is isolated.
  function isolatedThreads() {
    var sc = S.scene;
    if (!sc || S.still || !sc.isolated || !Array.isArray(sc.threads)) return null;
    var lit = new Set();
    sc.caps.forEach(function (c) { if (!c.dim) lit.add(c.node); });
    S.members.forEach(function (n) { lit.add(n); });
    var key = Array.from(lit).sort(function (a, b) { return a - b; }).join(",");
    if (S.isoThreads && S.isoThreads.from === sc.threads && S.isoThreads.key === key) return S.isoThreads;
    var out = { from: sc.threads, key: key, lit: [], dim: [] };
    sc.threads.forEach(function (t) { (lit.has(t.a) || lit.has(t.b) ? out.lit : out.dim).push(t); });
    S.isoThreads = out;
    return out;
  }
  // Draw a layer built for view `from` as it sits under view `to` (a pan or zoom since it was built).
  function moved(g, layer, from, to) {
    if (!from || !to || (from.k === to.k && from.tx === to.tx && from.ty === to.ty)) { g.drawImage(layer, 0, 0); return; }
    var s = to.k / from.k, d = S.dpr;
    g.setTransform(s, 0, 0, s, (to.tx - s * from.tx) * d, (to.ty - s * from.ty) * d);
    g.drawImage(layer, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  function aboveOpts() { return { layout: S.L, pos: S.pos, w: S.w, h: S.h, font: SANS, trail: S.trail }; }
  // The pulse layer grown to u: on from where it stands, or from nothing when it was made for another step or view.
  function growPulses(u) {
    if (S.pulseView !== S.view || u < S.pulseU) { fresh(S.Pl); S.pulseU = 0; S.pulseView = S.view; }
    if (!(u > S.pulseU)) return;
    var g = S.Pl.getContext("2d"), o = aboveOpts();
    g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    o.layered = true;
    D.drawPulses(g, S.scene, S.view, S.pulseU, u, o);
    S.pulseU = u;
  }
  // The caps above the pulses that do not ease: drawn again only when the reached caps flush, or for another step or view.
  function drawAboveAt(u) {
    var flush = u >= D.FLUSH_AT;
    if (S.aboveView === S.view && S.aboveFlush === flush) return;
    D.drawAbove(fresh(S.O), S.scene, S.view, u, aboveOpts());
    S.aboveView = S.view; S.aboveFlush = flush;
  }
  // The screen at the step's progress S.u.
  function composite() {
    var g = ui.field.getContext("2d"), live = !!(S.scene && S.view), u = S.u;
    if (live) { growPulses(u); drawAboveAt(u); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (S.builtView !== S.view || !S.builtView) { g.fillStyle = D.PALETTE.peat; g.fillRect(0, 0, ui.field.width, ui.field.height); }
    moved(g, S.B, S.builtView, S.view);
    if (live) {
      moved(g, S.Pl, S.pulseView, S.view);
      // The pulses' tips at the true progress, straight on the screen: above the finished cells, under the caps.
      g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
      D.drawPulseTips(g, S.scene, S.view, u, aboveOpts());
      g.setTransform(1, 0, 0, 1, 0, 0);
      moved(g, S.O, S.aboveView, S.view);
    }
    g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    if (live) D.drawEased(g, S.scene, S.view, u, aboveOpts());
    if (live && S.members.size) drawRings(g, u);
    if (live && sheet() && !ui.record.hidden && recordOpen()) drawPicked(g, u);
    if (S.moving) return;
    for (var a = 0; a < S.caps.length; a++) {
      var c = S.caps[a], i = c.src;
      if (S.pos && isNum(S.pos[2 * i]) && isNum(S.pos[2 * i + 1])) D.leader(g, c.box, S.pos[2 * i], S.pos[2 * i + 1], c.r);
    }
    if (S.recordBox && !ui.record.hidden) D.stub(g, S.recordBox.box, S.recordBox.x, S.recordBox.y, S.recordBox.r);
  }
  // The isolated catalyst's cascade: a thin bone ring round each member's cap (outside a holding's moss ring).
  var RING_GAP = 3.4, RING_GAP_HELD = 7;
  function drawRings(g, u) {
    g.beginPath();
    S.members.forEach(function (i) {
      var x = S.pos ? S.pos[2 * i] : NaN, y = S.pos ? S.pos[2 * i + 1] : NaN, cap = S.scene.caps[i];
      if (!isNum(x) || !isNum(y) || !cap) return;
      var r = C.capAt(cap, u).r * D.markScale() + (cap.held ? RING_GAP_HELD : RING_GAP);
      g.moveTo(x + r, y); g.arc(x, y, r, 0, 2 * Math.PI);
    });
    g.globalAlpha = 0.85; g.strokeStyle = D.PALETTE.bone; g.lineWidth = 0.9; g.stroke(); g.globalAlpha = 1;
  }
  // On a phone the record is a sheet with no leader, so the stock it is about carries a bone ring of its own, a little outside
  // any other ring, while the sheet is open.
  function drawPicked(g, u) {
    var i = S.U.sel, x = S.pos ? S.pos[2 * i] : NaN, y = S.pos ? S.pos[2 * i + 1] : NaN, cap = S.scene.caps[i];
    if (!isNum(x) || !isNum(y) || !cap) return;
    var r = C.capAt(cap, u).r * D.markScale() + (cap.held ? RING_GAP_HELD : RING_GAP) + (S.members.has(i) ? 3 : 0) + 2;
    g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI);
    g.strokeStyle = D.PALETTE.bone; g.lineWidth = 1.5; g.stroke();
  }
  // A pan or zoom (a wheel, a pinch, a drag, a double tap, a stock found, reset view): the layers are drawn moved with the
  // view at once, and the record, the captions, the threads, the static layer and the colony names are placed again once the
  // moves stop. While the view moves, the captions and the colony names are hidden and the record keeps its place without
  // its leader. A, the ground, is rebuilt on a resize only.
  function setView(view) {
    S.view = view;
    S.pos = D.positions(S.L, view);
    S.moving = true;
    ui.captions.style.visibility = "hidden"; ui.labels.style.visibility = "hidden";
    composite();
    writeTools();
    clearTimeout(S.settle);
    S.settle = setTimeout(function () {
      guarded(function () {
        S.moving = false; ui.captions.style.visibility = ""; ui.labels.style.visibility = "";
        placeLabels(); placeRecord(); placeCaptions(); rebuildStatic(); writeKey(); composite();
      });
    }, SETTLE_MS);
  }

  // ---- the scene of a step ----

  // The still field: the layout's caps with no reading and its threads. Shown when the step's frame is not in hand, so
  // the field never looks like a calm day it has no record of.
  function stillScene() {
    var held = new Set(heldList()), nodes = S.layout.nodes;
    return {
      caps: nodes.map(function (nd, i) {
        return { node: i, form: "unknown", prevForm: "unknown", tone: null, level: 0, held: held.has(nd.t), queued: false,
                 catalyst: false, large: false, dim: false, zLevel: 127, tier: nd.tier };
      }),
      threads: S.ix.list.filter(function (t) { return S.U.kinds[t.sheet]; }), links: [], echoes: [], pulses: [], stubs: [], sources: [], counts: null,
    };
  }

  // The account's holdings and queued stocks as map-state.json gives them: none when it says they could not be read (no ring is
  // drawn then, and the key says so).
  function holdingsKnown() { return !(S.state && S.state.holdings_known === false); }
  function heldList() { return holdingsKnown() && S.state && Array.isArray(S.state.holdings) ? S.state.holdings.filter(function (t) { return typeof t === "string"; }) : []; }
  function queuedList() { return holdingsKnown() && S.state && Array.isArray(S.state.queued) ? S.state.queued.filter(function (t) { return typeof t === "string"; }) : []; }
  function sceneArgs(back, complete, prev, isPublic, cat) {
    return { layout: S.layout, ix: S.ix, back: back, complete: complete, prev: prev ? prev.f : null, prevBind: prev ? prev.bind : null,
             bind: back[0] && back[0].bind, isPublic: isPublic, ui: { sel: -1, cat: cat, kinds: S.U.kinds, mine: false },
             holdings: new Set(heldList()), queued: new Set(queuedList()) };
  }

  // The step to show, its look-back and the scene. Without the recent days, the newest reading alone. A picked catalyst is
  // isolated only when the step shows it (MapCore.selectionView, read against the look-back days as read here); otherwise the
  // overview is drawn and the reason is said. The isolated catalyst's cascade is found and its members marked before any
  // word says "and its cascade", and "my positions only" keeps the account's stocks and their links lit.
  function buildScene() {
    S.still = false; S.back = []; S.read = []; S.catWhy = null; S.cascade = null; S.members = new Set(); S.mineSet = null; S.offMap = [];
    if (!S.layout) { S.scene = null; return; }
    var make;
    if (!S.T || !S.T.entries.length) {
      if (!S.stateFrame) { S.scene = stillScene(); S.still = true; pickedCatalyst(); return; }
      var sf = S.stateFrame, b = C.bind(S.layout, sf.tickers), only = [{ f: sf.f, j: 0, bind: b, tickers: sf.tickers }];
      S.back = only; S.read = [{ day: sf.f.day, inHand: true }];
      make = function (cat) { return C.scene(sceneArgs(only, false, null, sf.f.isPublic, cat)); };
    } else {
      var lb = S.T.lookback(S.k), back = [];
      lb.items.forEach(function (it) {
        var got = frameAt(it.k);
        back.push(got ? { f: got.f, j: it.j, bind: got.bind, tickers: got.file.tickers } : null);
        S.read.push({ day: S.T.entries[it.k].day, inHand: !!got });
      });
      var prev = S.k > 0 && S.T.adjacent(S.k - 1, S.k) ? frameAt(S.k - 1) : null, top = back[0];
      S.back = back;
      make = function (cat) { return top ? C.scene(sceneArgs(back, lb.complete, prev, top.f.isPublic, cat)) : null; };
    }
    var cat = S.U.cat ? { node: S.U.cat.node, day: S.U.cat.day } : null;
    S.scene = make(cat);
    if (!S.scene) { S.scene = stillScene(); S.still = true; pickedCatalyst(); return; }
    if (cat && !pickedCatalyst()) S.scene = make(null) || S.scene;
    findCascade();
    keepMine();
  }
  // Whether the scene isolates the picked catalyst; when it does not, the reason in plain words (MapCore's, true in every case).
  function pickedCatalyst() {
    if (!S.U.cat) return true;
    var v = C.selectionView(S.U, S.still ? null : S.scene, S.read);
    if (v.cat && v.cat.shown) return true;
    S.catWhy = v.cat ? v.cat.why : null;
    return false;
  }
  function frameForCascade(kk) { var g = frameAt(kk); return g ? { f: g.f, tickers: g.file.tickers } : null; }
  // The isolated catalyst's cascade, asked for by the catalyst's own day; its members are found by ticker, never by index, and
  // they keep their light (they are part of what is isolated).
  function findCascade() {
    var iso = S.scene && S.scene.isolated, nodes = S.layout.nodes;
    if (!iso || !nodes[iso.src]) return;
    if (!S.T) { S.members.add(iso.src); return; }
    S.cascade = C.cascadeOf(S.T, frameForCascade, S.k, { t: nodes[iso.src].t, day: iso.day }, S.state && S.state.cascades);
    if (S.cascade) S.cascade.members.forEach(function (m) { var n = C.nodeOfTicker(S.layout, m.t); if (n >= 0) S.members.add(n); });
    S.members.add(iso.src);                           // the catalyst is always part of its own cascade
    S.members.forEach(function (n) { if (S.scene.caps[n]) S.scene.caps[n].dim = false; });
  }
  // "My positions only": the held and queued stocks and their five strongest links stay lit (MapCore.mineSet); every other cap
  // is dimmed, and only the threads, links and pulses that touch a lit stock are drawn. A holding the map has not placed is
  // named under the tools. When the account's positions could not be read, nothing is dimmed and the tools say so.
  function keepMine() {
    if (!S.U.mine || S.still || !holdingsKnown()) return;
    var held = heldList(), lit = C.mineSet(S.layout, held, queuedList(), S.U.kinds), sc = S.scene;
    S.mineSet = lit;
    S.offMap = held.filter(function (t, i) { return held.indexOf(t) === i && C.nodeOfTicker(S.layout, t) < 0; });
    function touches(r) { return lit.has(r.src) || lit.has(r.dst); }
    sc.caps.forEach(function (c) { if (!lit.has(c.node)) c.dim = true; });
    sc.pulses = sc.pulses.filter(touches); sc.echoes = sc.echoes.filter(touches); sc.links = sc.links.filter(touches); sc.stubs = sc.stubs.filter(touches);
    var key = Array.from(lit).sort(function (a, b) { return a - b; }).join(",");
    if (!S.mineThreads || S.mineThreads.from !== sc.threads || S.mineThreads.key !== key) {
      S.mineThreads = { from: sc.threads, key: key, list: sc.threads.filter(function (t) { return lit.has(t.a) || lit.has(t.b); }) };
    }
    sc.threads = S.mineThreads.list;
  }

  // ---- the words ----

  function whenOf() {
    if (S.T && S.T.entries.length && S.k >= 0) {
      var e = S.T.entries[S.k], newest = S.k === S.T.entries.length - 1;
      return { seg: e.seg, day: e.day, slot: e.slot, runin: e.runin, layoutMonth: S.layout ? S.layout.month : undefined,
               stale: newest ? C.staleness(S.state, S.nowMs) : undefined, liveNext: newest && C.liveNextOf(S.state) };
    }
    if (S.stateFrame) {
      var f = S.stateFrame.f;
      return { seg: f.day === S.today ? "today" : "recent", day: f.day, slot: f.slot, runin: f.runin,
               layoutMonth: S.layout ? S.layout.month : undefined, stale: C.staleness(S.state, S.nowMs), liveNext: C.liveNextOf(S.state) };
    }
    return null;
  }

  // The step's own month could not be read ("This month…"), or play could not go on into the next one ("The next month…"):
  // the sub says which, or null.
  function monthFailed() {
    var own = ownMonth(S.k);
    if (own && S.failed.has(own) && !S.inflight.has(own)) return COPY.monthFailed;
    return S.waitFailed !== null ? COPY.nextMonthFailed : null;
  }
  function writeWords() {
    var head, sub = "";
    if (!S.layout) head = COPY.noLayout;
    else if (S.loading || (S.T && S.k >= 0 && waiting(S.k))) head = COPY.loading;
    else {
      S.when = whenOf();
      var iso = !S.still && S.scene && S.scene.isolated ? S.layout.nodes[S.scene.isolated.src] : null;
      var said = C.sentence({ scene: S.still ? null : S.scene, when: S.when, isolated: iso ? iso.t : undefined });
      head = said.head; sub = monthFailed() || (folded() ? said.subShort : said.sub);
    }
    ui.head.textContent = head;
    ui.sub.textContent = sub;
    var notes = S.problems.slice(), refused = refusedLine();
    if (refused) notes.push(refused);
    if (S.owed) notes.push(S.owed.sf.f.slot === "close" ? COPY.owedClose : COPY.owedReading);
    if (S.linkNote) notes.push(S.linkNote);
    ui.notes.textContent = notes.join(" ");
    ui.notes.hidden = notes.length === 0;
    // The holding rings are today's holdings, whatever day is shown; when they could not be read, the key says so.
    var e = S.T && S.k >= 0 ? S.T.entries[S.k] : null;
    ui.held.textContent = !holdingsKnown() ? COPY.heldUnknown : !e || e.seg === "today" ? "held" : "held now";
    ui.demo.hidden = !((S.layout && S.layout.demo === true) || (S.state && S.state.demo === true));
  }

  // The text alternative: what the canvas shows, for a screen reader (the sentence itself is the heading above it), and the
  // words of any caption that found no place on the screen.
  function writeAlt() {
    var nodes = S.layout ? S.layout.nodes : [], sectors = S.layout && Array.isArray(S.layout.sectors) ? S.layout.sectors : [];
    var names = sectors.map(function (s) { return isObj(s) && typeof s.label === "string" ? s.label : null; }).filter(Boolean);
    var held = S.scene && S.scene.caps ? S.scene.caps.filter(function (c) { return c.held; }).map(function (c) { return nodes[c.node].t; }) : [];
    var label = "The market as one forest floor: " + W.fmtInt(nodes.length) + " " + W.plural(nodes.length, "stock", "stocks") + " in " +
                W.fmtInt(names.length) + " " + W.plural(names.length, "colony", "colonies") + (names.length ? " (" + names.join(", ") + ")" : "") + "." +
                (held.length ? " Held now: " + held.join(", ") + "." : "");
    if (S.w < NARROWEST) label += " " + COPY.narrow;
    ui.field.setAttribute("aria-label", label);
    clear(ui.alt);
    S.unplaced.forEach(function (c) { ui.alt.appendChild(el("p", null, c.head + " " + c.body)); });
  }

  // The key names what is on the screen, and nothing else: each kind of cap, the tone of a pulse, a trail of earlier days and
  // a holding only while such a mark is drawn.
  function writeKey() {
    var on = { quiet: false, loud: false, tired: false, "with": false, against: false, earlier: !!(S.drawn && S.drawn.trail > 0),
               died: !!(S.drawn && S.drawn.stubs > 0),
               catalyst: false, unknown: false, held: false };
    var sc = S.scene, pos = S.pos;
    function placed(i) { return !!pos && i >= 0 && isNum(pos[2 * i]) && isNum(pos[2 * i + 1]); }
    if (sc && pos) {
      D.growing(sc, S.trail).forEach(function (p) { if (placed(p.src) && placed(p.dst)) on[p.tone] = true; });
      (sc.caps || []).forEach(function (c) {
        if (!placed(c.node)) return;
        if (c.catalyst) on.catalyst = true;
        else if (c.form === "unknown") on.unknown = true;
        else if (c.form === "open") on.loud = true;
        else if (c.form === "dropped") on.tired = true;
        else if (c.form === "closed") on.quiet = true;
        if (c.held) on.held = true;
      });
    }
    if (!holdingsKnown()) on.held = true;              // said, with no ring beside it
    Object.keys(on).forEach(function (k) {
      var cv = ui.key.querySelector('canvas[data-k="' + k + '"]');
      if (cv) cv.parentNode.hidden = !on[k];
    });
    var heldMark = ui.key.querySelector('canvas[data-k="held"]');
    if (heldMark) heldMark.style.visibility = holdingsKnown() ? "" : "hidden";
  }

  // ---- the key and the dials ----

  function drawKey() {
    var dpr = Math.min(DPR_MAX, Math.max(1, window.devicePixelRatio || 1));
    ui.key.querySelectorAll("canvas[data-k]").forEach(function (cv) {
      var li = cv.parentNode, was = li.hidden;
      li.hidden = false;
      var w = cv.clientWidth || 22, h = cv.clientHeight || 22, g = cv.getContext("2d");
      li.hidden = was;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      D.specimen(g, cv.getAttribute("data-k"));
    });
  }

  // The close frames the dials read, oldest first, the last being the shown day (on a slot, the close before it).
  function dialFrames() {
    if (!S.T || !S.T.entries.length) return S.stateFrame && S.stateFrame.f.slot === "close" ? [S.stateFrame.f] : [];
    var e = S.T.entries[S.k], atSlot = e.slot !== "close", lb = S.T.lookback(S.k), byJ = {};
    lb.items.forEach(function (it) { byJ[it.j] = it.k; });
    var out = [];
    for (var j = atSlot ? 11 : 10; j >= (atSlot ? 1 : 0); j--) {
      var got = byJ[j] === undefined ? null : frameAt(byJ[j]);
      out.push(got ? got.f : null);
    }
    return out;
  }
  function writeDials() {
    var figs = Array.prototype.slice.call(ui.dials.querySelectorAll("figure")), had = figs.indexOf(document.activeElement);
    clear(ui.dials);
    if (S.loading) {                                 // names in place while the record is read, so nothing moves after
      var wait = el("div", { class: "map-dial-row" });
      W.DIALS.forEach(function (d) {
        var fig = el("figure", { class: "map-dial map-dial-bare" }), cap = el("figcaption");
        cap.appendChild(el("span", { class: "map-dial-name" }, d.name));
        cap.appendChild(el("span", { class: "map-dial-word" }, " "));
        fig.appendChild(el("canvas", { "aria-hidden": "true" })); fig.appendChild(cap); wait.appendChild(fig);
      });
      ui.dials.appendChild(wait);
      ui.dials.appendChild(el("p", { class: "map-dials-when" }, " "));
      return;
    }
    var e = S.T && S.T.entries.length ? S.T.entries[S.k] : null;
    var atSlot = e ? e.slot !== "close" : !!(S.stateFrame && S.stateFrame.f.slot !== "close");
    var scale = S.layout && isObj(S.layout.dial_scale) ? S.layout.dial_scale : {};
    var rows = C.dialModel(dialFrames(), scale, { atSlot: atSlot, scope: "ALL" });
    var row = el("div", { class: "map-dial-row" }), any = rows.some(D.hasRing), dpr = Math.min(DPR_MAX, Math.max(1, window.devicePixelRatio || 1));
    if (!any) row.classList.add("map-dial-none");
    ui.dials.appendChild(row);
    rows.forEach(function (d) {
      var title = d.name + ": " + d.word + "." + (D.hasRing(d) ? " The inner rings are past days; the outer ring is the day shown." : "") +
                  (Object.prototype.hasOwnProperty.call(scale, d.key) ? " Compared with 2015 to 2023." : "") + (d.note ? " " + d.note : "");
      var fig = el("figure", { class: "map-dial", title: title, tabindex: "0", "aria-label": title }), cv = el("canvas", { "aria-hidden": "true" });
      var cap = el("figcaption");
      cap.appendChild(el("span", { class: "map-dial-name" }, d.name));
      cap.appendChild(el("span", { class: "map-dial-word" }, d.word));
      fig.appendChild(cv); fig.appendChild(cap); row.appendChild(fig);
      if (!D.hasRing(d)) { fig.classList.add("map-dial-bare"); return; }
      var size = cv.clientWidth || modeOf().dial, g = cv.getContext("2d");    // a folded dial is drawn at its mode's size
      cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      D.dial(g, d, size);
    });
    // The line under the dials is always there (blank on a close), so the block keeps its size from step to step.
    var when = rows.length && rows[0].when ? rows[0].when : null;
    ui.dials.appendChild(el("p", { class: "map-dials-when" }, when ? "Dials " + when + "." : " "));
    var again = had >= 0 ? ui.dials.querySelectorAll("figure")[had] : null;   // a dial that had the focus keeps it from step to step
    if (again) try { again.focus(); } catch (e) { /* the focus stays */ }
  }

  // ---- marks, captions and colony names ----

  // The recorded marks on the screen in a grid of cells, so a box can ask whether it would cover any of them.
  var CELL = 24;
  function markGrid(points) {
    var cells = new Map();
    for (var a = 0; a + 2 < points.length; a += 3) {
      var key = Math.floor(points[a] / CELL) * 65536 + Math.floor(points[a + 1] / CELL);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(a);
    }
    return { pts: points, cells: cells };
  }
  function covers(G, box, pad) {
    if (!G) return false;
    var x0 = Math.floor((box.x - pad - 12) / CELL), x1 = Math.floor((box.x + box.w + pad + 12) / CELL);
    var y0 = Math.floor((box.y - pad - 12) / CELL), y1 = Math.floor((box.y + box.h + pad + 12) / CELL);
    for (var cx = x0; cx <= x1; cx++) for (var cy = y0; cy <= y1; cy++) {
      var list = G.cells.get(cx * 65536 + cy);
      if (!list) continue;
      for (var q = 0; q < list.length; q++) {
        var a = list[q], x = G.pts[a], y = G.pts[a + 1], r = G.pts[a + 2] + pad;
        if (x + r > box.x && x - r < box.x + box.w && y + r > box.y && y - r < box.y + box.h) return true;
      }
    }
    return false;
  }
  function hits(a, list) {
    for (var i = 0; i < list.length; i++) { var b = list[i]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return true; }
    return false;
  }
  // Whether a plate's leader (from the plate's nearest point toward its catalyst, as MapDraw.leader draws it) would cross a
  // colony name: points every 3 px along it, tested against each name's box with 2 px to spare.
  function leaderCrosses(box, x, y, rects) {
    if (!rects.length) return false;
    var px = Math.max(box.x, Math.min(box.x + box.w, x)), py = Math.max(box.y, Math.min(box.y + box.h, y));
    var d = Math.hypot(x - px, y - py), n = Math.ceil(d / 3);
    for (var i = 0; i <= n; i++) {
      var qx = px + (x - px) * i / Math.max(1, n), qy = py + (y - py) * i / Math.max(1, n);
      for (var a = 0; a < rects.length; a++) {
        var r = rects[a];
        if (qx > r.x - 2 && qx < r.x + r.w + 2 && qy > r.y - 2 && qy < r.y + r.h + 2) return true;
      }
    }
    return false;
  }
  function fieldMiddle() {
    var sx = 0, sy = 0, n = 0;
    for (var i = 0; S.pos && i + 1 < S.pos.length; i += 2) if (isNum(S.pos[i]) && isNum(S.pos[i + 1])) { sx += S.pos[i]; sy += S.pos[i + 1]; n++; }
    return n ? { x: sx / n, y: sy / n } : { x: S.w / 2, y: S.h / 2 };
  }

  // Plate captions beside at most three catalysts (two on a tablet, one on a phone, none on a phone on its side; one while a
  // catalyst is isolated). A plate never covers a recorded
  // mark: it is pushed out from the field's middle, past every cap, pulse and trail, with a leader back to its catalyst, and
  // a plate with no clear place is left out (its words stay in the text alternative). The captioned catalysts are the ones
  // whose trail of earlier days is drawn.
  // The plates open over the field (the record, the scoreboard): the captions keep off them.
  function platesOpen() {
    return [ui.record, ui.board].filter(function (b) { return !b.hidden; }).map(rectOf).filter(function (r) { return r.w > 0 && r.h > 0; });
  }
  function captionCount() { var n = modeOf().captions; return S.scene && S.scene.isolated ? Math.min(1, n) : n; }
  // The isolated catalyst's cascade in words: its size (the engine's own figure only on the newest step, and only when it is
  // not below what the record shows) and where it began; "at least" wherever the chain is not whole.
  function cascadeLine() {
    var cs = S.cascade;
    if (!cs || !S.T) return null;
    var newest = S.k === S.T.entries.length - 1, n = newest && cs.liveSize !== null && cs.liveSize >= cs.size ? cs.liveSize : cs.size;
    if (cs.complete) return n > 1 ? COPY.cascadeOf(W.numberWord(n), cs.rootTicker, W.fmtDay(cs.rootDay)) : null;
    var e = S.T.entries[S.k], iso = S.scene.isolated, k0 = S.T.at(iso.day, "close"), own = k0 >= 0 ? S.T.entries[k0] : e;
    var d = cs.daysBack + (e && own && typeof e.td === "number" && typeof own.td === "number" ? Math.max(0, e.td - own.td) : 0);
    var today = !!e && e.seg === "today";
    if (d < 1) return COPY.cascadeUnknown(W.numberWord(n));
    return n > 1 ? COPY.cascadeAtLeast(W.numberWord(n), W.numberWord(d), today) : COPY.cascadeSome(W.numberWord(d), today);
  }
  function isIsolated(c) { var iso = S.scene && S.scene.isolated; return !!iso && iso.src === c.src && iso.day === c.day; }
  // A caption follows its own catalyst and its cascade; pressed again, it lets go.
  function pressCaption(c) {
    if (isIsolated(c)) commit(Object.assign({}, S.U, { cat: null }));
    else act({ type: "tapCatalyst", node: c.src, day: c.day });
  }
  // The phone's caption strip (captionRoom), searched along its length for the clear place nearest the catalyst: the plate's
  // leader then runs down into the field.
  function inStrip(w, h, x, y, taken, G) {
    var room = captionRoom()[0], best = null;
    if (!room) return null;
    for (var top = room.y - CLEAR; top + h <= room.y + room.h + CLEAR * 2; top += 4) {
      for (var left = EDGE; left + w <= S.w - EDGE; left += 8) {
        var box = { x: left, y: top, w: w, h: h }, d = Math.hypot(left + w / 2 - x, top + h - y);
        if (best && d >= best.d) continue;
        if (hits(box, taken) || covers(G, box, 3) || leaderCrosses(box, x, y, S.labelBoxes)) continue;
        best = { x: left, y: top, w: w, h: h, d: d };
      }
    }
    return best ? { x: best.x, y: best.y, w: w, h: h } : null;
  }
  // The captions, then the catalysts whose pulses grow in full (MapCore.followedOf): the captioned ones, and when none of them
  // has a pulse on this step, the strongest catalyst that has one, so the step always shows one cascade travelling while the
  // rest lie still at the trail's weight. MapCore's captions put that catalyst first, so it is named whenever there is room.
  function placeCaptions() {
    placePlates();
    S.trail = C.followedOf(S.still ? null : S.scene, S.trail);
  }
  function placePlates() {
    var had = within(ui.captions, document.activeElement) ? document.activeElement.getAttribute("data-cat") : null;
    clear(ui.captions);
    S.caps = []; S.unplaced = []; S.trail = new Set();
    if (S.still || !S.scene || !S.pos || !S.layout) return;
    var e = S.T && S.k >= 0 ? S.T.entries[S.k] : null, got = e ? frameAt(S.k) : S.stateFrame;
    // A phone shows one caption: the first, in MapCore's order, that finds room in its strip (the first may be too long for it).
    var count = captionCount(), ask = S.mode === "phone" && !(S.scene && S.scene.isolated) ? Math.max(count, 3) : count;
    var list;
    if (!count) {                                     // no plates (a phone on its side): an isolated catalyst's words, its cascade
      if (!S.scene.isolated) return;                  // line with them, go to the text alternative
      list = C.captions({ scene: S.scene, layout: S.L, sectors: got && got.file ? got.file.sectors : got ? got.sectors : [],
                          holdings: S.state && S.state.holdings, events: S.state && S.state.events, max: 1, today: S.today });
      var said = cascadeLine();
      list.forEach(function (c) { if (said && isIsolated(c)) c.body += " " + said; S.unplaced.push(c); });
      return;
    }
    list = C.captions({ scene: S.scene, layout: S.L, sectors: got && got.file ? got.file.sectors : got ? got.sectors : [],
                            holdings: S.state && S.state.holdings, events: S.state && S.state.events, max: ask, today: S.today });
    var line = cascadeLine();
    list.forEach(function (c) { if (line && isIsolated(c)) c.body += " " + line; });
    var all = new Set(list.map(function (c) { return c.src; }));
    var G = markGrid(D.markPoints(S.scene, S.view, { layout: S.L, pos: S.pos, trail: all }));
    var taken = overlays().concat(S.labelBoxes).concat(platesOpen()), mid = fieldMiddle();
    var pulsingSrc = new Set(S.scene.pulses.map(function (p) { return p.src; })), named = false;
    function tryPlate(c, body) {
      var i = c.src;
      var plate = el("button", { class: "plate", type: "button", "aria-pressed": isIsolated(c) ? "true" : "false", "data-cat": c.src + "@" + c.day }), em = el("em");
      var m = /\d{1,2}:\d{2} (?:am|pm)/.exec(c.head);
      plate.addEventListener("click", function () { guarded(function () { pressCaption(c); }); });
      if (m) {
        em.appendChild(document.createTextNode(c.head.slice(0, m.index)));
        em.appendChild(el("span", { class: "fig" }, m[0]));
        em.appendChild(document.createTextNode(c.head.slice(m.index + m[0].length)));
      } else em.textContent = c.head;
      plate.appendChild(em);
      if (body) plate.appendChild(document.createTextNode(body));
      plate.style.visibility = "hidden";
      ui.captions.appendChild(plate);
      var r = plate.getBoundingClientRect(), w = Math.ceil(r.width), h = Math.ceil(r.height), x = S.pos[2 * i], y = S.pos[2 * i + 1];
      var base = Math.atan2(y - mid.y, x - mid.x), spot = null, reach = Math.hypot(S.w, S.h);
      [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75].some(function (turn) {
        var a = base + turn, dx = Math.cos(a), dy = Math.sin(a);
        for (var d = 24; d < reach; d += 12) {
          var px = x + dx * d, py = y + dy * d;
          var box = { x: dx > 0.3 ? px : dx < -0.3 ? px - w : px - w / 2, y: dy > 0.3 ? py : dy < -0.3 ? py - h : py - h / 2, w: w, h: h };
          if (box.x < EDGE || box.y < EDGE || box.x + w > S.w - EDGE || box.y + h > S.h - EDGE) { if (d > 60) break; continue; }
          if (hits(box, taken) || covers(G, box, 3) || leaderCrosses(box, x, y, S.labelBoxes)) continue;
          spot = box; return true;
        }
        return false;
      });
      if (!spot && S.mode === "phone") spot = inStrip(w, h, x, y, taken, G);
      if (!spot && c === list[0]) spot = freeSide(w, h, taken, G);
      if (!spot) { ui.captions.removeChild(plate); return null; }
      return { plate: plate, spot: spot, w: w, h: h };
    }
    // With a plate open on one side of a wide screen, the first caption (the followed catalyst's) may stand in the free column
    // on the other side, at the height nearest the field's middle where it covers no mark; its leader runs back to its cap.
    function freeSide(w, h, taken, G) {
      var open = platesOpen();
      if (!open.length || S.mode === "phone") return null;
      var plateLeft = open[0].x + open[0].w / 2 < S.w / 2, bx = plateLeft ? S.w - EDGE - w : EDGE, best = null;
      for (var by = EDGE; by + h <= S.h - EDGE; by += 6) {
        var box = { x: bx, y: by, w: w, h: h };
        if (hits(box, taken) || covers(G, box, 3)) continue;
        if (!best || Math.abs(by + h / 2 - S.h / 2) < Math.abs(best.y + h / 2 - S.h / 2)) best = box;
      }
      return best;
    }
    list.forEach(function (c) {
      var i = c.src;
      if (S.caps.length >= count) return;              // asked for only to find the phone one with room
      if (!isNum(S.pos[2 * i])) { S.unplaced.push(c); return; }
      // A plate for the catalyst, placed where it has room; the catalyst whose pulse grows (MapCore puts it first) may give up
      // its body and be named in one line when the whole plate finds no room, so a growing cascade is always named.
      var got = tryPlate(c, " " + c.body);
      if (!got && pulsingSrc.has(i) && !named) got = tryPlate(c, "");
      if (!got) { S.unplaced.push(c); return; }
      if (pulsingSrc.has(i)) named = true;
      var plate = got.plate, spot = got.spot, w = got.w, h = got.h;
      plate.style.left = Math.round(spot.x) + "px"; plate.style.top = Math.round(spot.y) + "px"; plate.style.visibility = "";
      taken.push(spot);
      var cap = S.scene.caps[i];
      S.caps.push({ src: i, r: cap ? C.capAt(cap, 1).r * D.markScale() : 6, box: { x: Math.round(spot.x), y: Math.round(spot.y), w: w, h: h } });
      S.trail.add(i);
    });
    // A caption that had the focus keeps it when the captions are placed again (a press, a new step).
    if (had !== null) { var again = ui.captions.querySelector('button[data-cat="' + had + '"]') || ui.captions.querySelector("button"); if (again) try { again.focus(); } catch (e) { /* the focus stays */ } }
  }

  // Each colony's name beside its own colony, on the side away from the field's middle: never on a cap (each stock's place
  // with room for its largest usual cap), on another name or on an overlay. A name with no such place beside its colony is
  // left out, not misplaced. Placed once per view, never per step, so the names stay put during play; plates keep off them.
  var LABEL_CAP_R = 6, LABEL_CLEAR = 18;
  function placeLabels() {
    if (S.labelsView === S.view && S.labelsView) return;
    S.labelsView = S.view; S.labelBoxes = [];
    clear(ui.labels);
    if (!S.layout || !Array.isArray(S.layout.sectors) || !S.pos) return;
    var pts = [];
    for (var p = 0; p + 1 < S.pos.length; p += 2) if (isNum(S.pos[p]) && isNum(S.pos[p + 1])) pts.push(S.pos[p], S.pos[p + 1], LABEL_CAP_R);
    // An open plate (the record, the scoreboard) is kept clear by LABEL_CLEAR px, so a name never stands against its edge.
    var G = markGrid(pts), nodes = S.L.nodes, mid = fieldMiddle();
    var taken = overlays().concat(platesOpen().map(function (r) { return { x: r.x - LABEL_CLEAR, y: r.y - LABEL_CLEAR, w: r.w + 2 * LABEL_CLEAR, h: r.h + 2 * LABEL_CLEAR }; }));
    S.layout.sectors.forEach(function (sec) {
      if (!isObj(sec) || typeof sec.label !== "string") return;
      var px = [], py = [];
      for (var i = 0; i < nodes.length; i++) {
        var nd = nodes[i];
        if ((nd.s === sec.id || nd.s === sec.label) && isNum(S.pos[2 * i])) { px.push(S.pos[2 * i]); py.push(S.pos[2 * i + 1]); }
      }
      if (px.length < 3) return;
      var cx = px.reduce(function (s, v) { return s + v; }, 0) / px.length, cy = py.reduce(function (s, v) { return s + v; }, 0) / py.length;
      var ds = px.map(function (x, q) { return Math.hypot(x - cx, py[q] - cy); }).sort(function (a, b) { return a - b; });
      var rad = ds[Math.floor(ds.length * 0.85)], base = Math.atan2(cy - mid.y, cx - mid.x);
      var span = el("span", { class: "colony" }, sec.label);
      ui.labels.appendChild(span);
      var sw = span.offsetWidth, sh = span.offsetHeight, spot = null;
      [6, 14, 24, 36, 50].some(function (gap) {
        return [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2].some(function (turn) {
          var a = base + turn, lx = cx + Math.cos(a) * (rad + gap), ly = cy + Math.sin(a) * (rad + gap), ca = Math.cos(a);
          var box = { x: ca > 0.35 ? lx : ca < -0.35 ? lx - sw : lx - sw / 2, y: ly - sh / 2, w: sw, h: sh };
          if (box.x < EDGE || box.y < EDGE || box.x + sw > S.w - EDGE || box.y + sh > S.h - EDGE) return false;
          if (hits(box, taken) || covers(G, box, 1)) return false;
          spot = box; return true;
        });
      });
      if (!spot) { ui.labels.removeChild(span); return; }
      span.style.left = Math.round(spot.x) + "px"; span.style.top = Math.round(spot.y) + "px";
      taken.push(spot); S.labelBoxes.push(spot);
    });
  }

  // A colony's name never shows half under an open plate (the record or the scoreboard): it waits until the plate closes.
  function labelsOffPlates() {
    var plates = [ui.record, ui.board].filter(function (p) { return p && !p.hidden; }).map(rectOf)
      .filter(function (r) { return r.w > 0 && r.h > 0; });
    Array.prototype.forEach.call(ui.labels.children, function (span) {
      var r = plates.length ? rectOf(span) : null;
      var under = !!r && plates.some(function (q) { return r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y; });
      span.style.visibility = under ? "hidden" : "";
    });
  }

  // ---- the soil core ----

  function corePublic() { return (S.state && S.state.public === true) || (S.history && S.history.isPublic === true); }
  // The strip's bands and the steps' places, made again only when the timeline, the width or the variant changes.
  function coreOf(w) {
    var pub = corePublic();
    if (!(S.core && S.coreT === S.T && S.coreW === w && S.corePub === pub)) {
      S.core = C.coreLayout(S.T, w, { isPublic: pub }); S.coreT = S.T; S.coreW = w; S.corePub = pub;
    }
    return S.core;
  }
  // The label beside the pin: the step's day and time ("today, 2:40 pm", "4 March 2019, at the close"). A stale newest
  // reading loses the live look and says when it was taken.
  function whenLabel(m) {
    var e = S.T && S.k >= 0 ? S.T.entries[S.k] : null, f = e || (S.stateFrame ? S.stateFrame.f : null);
    if (!f) return { text: "", stale: false };
    var newest = !e || S.k === S.T.entries.length - 1, st = newest ? C.staleness(S.state, S.nowMs) : { stale: false };
    var time = f.slot === "close" ? "at the close" : W.fmtTime(f.slot);
    if (st.stale) return { text: "last reading " + (f.day === S.today ? time : W.fmtDay(f.day) + ", " + time), stale: true };
    if (e) return { text: m.label(S.k), stale: false };
    return { text: (f.day === S.today ? "today, " : W.fmtDay(f.day) + ", ") + time, stale: false };
  }
  // A label on the row under the strip, starting at x (or centred on it), kept inside the strip, and left out when it would
  // cover one placed already.
  function rowLabel(text, x, w, cls, taken, centred) {
    var sp = el("span", cls ? { class: cls } : null, text);
    ui.years.appendChild(sp);
    var sw = sp.offsetWidth, left = Math.round(Math.max(0, Math.min(w - sw, centred ? x - sw / 2 : x)));
    var box = { x0: left - 6, x1: left + sw + 6 };
    if (taken.some(function (t) { return box.x0 < t.x1 && t.x0 < box.x1; })) { ui.years.removeChild(sp); return null; }
    sp.style.left = left + "px"; taken.push(box);
    return sp;
  }
  // The closed years' label, centred on its band, and the run-in note beside it (run-in days lie just past the closed years):
  // the note starts at its first layer or past the closed label, whichever is later, and when the strip's end leaves no room
  // both move left. The run-in note is never the one left out: when only one fits, it is the note (ruling 26: run-in days are
  // marked wherever they are shown).
  function closedAndRunin(m, w, taken, withClosed) {
    var runin = m.layers.filter(function (L) { return L.runin; }), cs = null, rs = null;
    function span(text) { var sp = el("span", { class: "map-core-closed" }, text); ui.years.appendChild(sp); return sp; }
    if (m.closed && withClosed) cs = span(COPY.closed);
    if (runin.length) rs = span(COPY.runin);
    var cw = cs ? cs.offsetWidth : 0, rw = rs ? rs.offsetWidth : 0, GAP = 12;
    var cl = cs ? Math.max(0, Math.min(w - cw, (m.closed.x0 + m.closed.x1) / 2 - cw / 2)) : 0, rl = 0;
    if (rs) {
      // A label already standing at the right of the row (a phone's "today") is a wall the note keeps clear of.
      var wall = taken.reduce(function (a, t) { return t.x0 > w / 2 ? Math.min(a, t.x0) : a; }, w);
      rl = Math.max(runin[0].x0, cs ? cl + cw + GAP : 0);
      if (rl + rw > wall) { rl = Math.max(0, wall - rw); if (cs) cl = rl - GAP - cw; }
      if (cs && cl < 0) { ui.years.removeChild(cs); cs = null; }
    }
    [[cs, cl, cw], [rs, rl, rw]].forEach(function (x) {
      if (!x[0]) return;
      x[0].style.left = Math.round(x[1]) + "px";
      taken.push({ x0: Math.round(x[1]) - 6, x1: Math.round(x[1]) + x[2] + 6 });
    });
  }
  function drawCore() {
    var none = !(S.T && S.T.entries.length) && !S.stateFrame;
    ui.core.hidden = none;                            // no record at all: no core to read
    ui.speed.hidden = none;                           // and no speed to set
    if (none) return;
    var cv = ui.strip, w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight), dpr = S.dpr || 1, top = 16, sh = 30;
    var m = coreOf(w), g = cv.getContext("2d"), loading = new Set(S.inflight.keys());
    var pin = S.T && S.k >= 0 ? m.xOf(S.k) : S.stateFrame ? w - 5 : null;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.translate(0, top);
    D.soilCore(g, { layers: m.layers, days: m.days, closed: m.closed, ticks: m.ticks, pin: isNum(pin) ? pin : null, loading: loading }, w, sh);

    // Under the strip: the closed years, the run-in days and any month being read come first; the years fill the gaps. On a
    // phone the row is cut to the first year, the years and "today" at the surface (the run-in days keep their note, ruling 26:
    // they are marked wherever they are shown; the sealed bands are stitched shut on the strip itself).
    var phone = S.mode === "phone";
    clear(ui.years);
    var taken = [];
    var firstYear = S.index && Array.isArray(S.index.months) && S.index.months.length && isObj(S.index.months[0]) && typeof S.index.months[0].m === "string" ? S.index.months[0].m.slice(0, 4) : null;
    var deep = m.layers.some(function (L) { return L.seg === "deep" || (L.seg === "bare" && typeof L.month === "string"); });
    if (phone && deep && firstYear) rowLabel(firstYear, 0, w, null, taken);
    if (phone && m.today) rowLabel(COPY.today, w, w, "map-core-today", taken);
    closedAndRunin(m, w, taken, !phone);
    m.layers.forEach(function (L) {
      if (typeof L.month === "string" && loading.has(L.month)) rowLabel(COPY.reading, (L.x0 + L.x1) / 2, w, "map-core-closed", taken, true);
    });

    // Over the strip: the note at the left, "last 30 days" over the recent layers, and the time beside the pin. A phone keeps
    // only the time; it stands on a row of its own above the pin's knob, so it never crosses the pin.
    var noteText = phone ? "" : m.sealed ? COPY.olderPrivate : deep && firstYear ? COPY.deeper(firstYear) : "";
    ui.note.textContent = noteText; ui.note.hidden = !noteText;
    ui.recent.hidden = !m.recent || phone;
    if (m.recent) ui.recent.style.left = Math.round(m.recent.x0) + "px";
    var lab = whenLabel(m);
    ui.time.textContent = lab.text;
    var linked = !!(S.hash && S.hash.now !== null);
    ui.clock.hidden = !linked;
    ui.when.classList.toggle("map-stale", lab.stale);
    var lw = ui.when.offsetWidth;
    if (linked && lw > w) {                           // too long for the strip: the clock's note goes under it, before the years
      ui.clock.hidden = true; lw = ui.when.offsetWidth;
      rowLabel(ui.clock.textContent, w - (phone && m.today ? 60 : 0), w, "map-core-closed", taken);
    }
    var px = isNum(pin) ? pin : w;                    // beside the pin: before it when there is room
    var wx = Math.round(Math.max(0, px - lw - 9 >= 0 ? px - lw - 9 : Math.min(w - lw, px + 9)));
    ui.when.style.left = wx + "px";
    m.years.forEach(function (y) { rowLabel(y.label, y.x, w, null, taken); });
    function covers(node) { return !node.hidden && node.offsetLeft < wx + lw + 12 && node.offsetLeft + node.offsetWidth + 12 > wx; }
    if (covers(ui.note)) ui.note.hidden = true;
    if (m.recent && !phone && (covers(ui.recent) || (!ui.note.hidden && ui.note.offsetLeft + ui.note.offsetWidth + 12 > ui.recent.offsetLeft))) {
      ui.recent.hidden = true;                        // the time stands over the recent days: their name goes under the strip
      rowLabel(ui.recent.textContent, (m.recent.x0 + m.recent.x1) / 2, w, "map-core-closed", taken, true);
    }
    syncRange();
  }
  // The range input over the strip: its value is the step's place, so the thumb sits under the pin.
  function syncRange() {
    var r = ui.range, ok = !!(S.P && S.core && S.T && S.T.entries.length);
    r.disabled = !ok; ui.play.disabled = !ok;
    if (!ok) { r.removeAttribute("aria-valuetext"); return; }
    r.max = String(S.core.max);
    r.value = String(S.core.value(S.k));
    r.setAttribute("aria-valuetext", S.core.label(S.k));
  }

  // ---- what the viewer picks: the record, the tools, the scoreboard ----

  // A new ui state: the step is drawn again when what it shows changes (the catalyst followed, the kinds of link, my positions),
  // else only the record and the tools are written again. The address follows. A move under way is cut.
  function sameCat(a, b) { return a === b || (!!a && !!b && a.node === b.node && a.day === b.day); }
  function commit(next) {
    var was = S.U;
    if (!next || next === was) return;
    S.U = next;
    if (next.sel >= 0 && next.sel !== was.sel) { S.boardOpen = false; loadExtras(); }
    if (!sameCat(was.cat, next.cat) || was.kinds.news !== next.kinds.news || was.kinds.comove !== next.kinds.comove || was.mine !== next.mine) {
      if (S.P && S.P.trans) { stopLoop(); S.P = Object.assign({}, S.P, { trans: null }); }
      guarded(render);
    } else {
      guarded(platesChanged);
    }
    writeAddressSoon();
  }
  // The record or the scoreboard opened, closed or changed: written again, and the captions placed again around them.
  function platesChanged() {
    writeRecord(); writeBoard();
    placeCaptions(); rebuildStatic(); writeKey(); writeAlt(); writeTools(); composite();
  }
  function act(action) { commit(C.ui(S.U, action)); }
  // A tap on a cap opens its record and follows its newest catalyst in the look-back, unless one of its catalysts is followed
  // already (an older one stays followed).
  function tapCap(i) {
    var cur = S.U.cat, src = cur && cur.node === i ? null : C.newestSource(S.scene, i);
    act(src ? { type: "tapCap", node: i, source: src } : { type: "tapCap", node: i });
  }
  // A tap on the ground closes the record, the scoreboard and the isolation.
  function tapGround() {
    var had = S.boardOpen;
    S.boardOpen = false;
    if (S.U.sel >= 0 || S.U.cat) act({ type: "tapGround" });
    else if (had) { guarded(platesChanged); writeAddressSoon(); }
  }

  // The evidence behind the links and the account's positions: read the first time a record opens, once. A positions file
  // that cannot be read says so, never "no positions" (contracts ruling 30).
  function loadExtras() {
    if (S.extras) return;
    S.extras = Promise.all([W.loadJson("map-evidence.json"), W.loadJson("map-positions.json")]).then(function (r) {
      S.evidence = r[0].ok && isObj(r[0].data) ? r[0].data : null; S.evidenceFailed = !S.evidence;
      S.positions = r[1].ok && isObj(r[1].data) ? r[1].data : { known: false };
      guarded(platesChanged);
    });
  }

  function plateHead(title, onClose, id) {
    var head = el("div", { class: "map-plate-head" }), h = el("h2", id ? { class: "map-plate-title", id: id } : { class: "map-plate-title" });
    if (typeof title === "string") h.textContent = title; else h.appendChild(title);
    var close = el("button", { class: "textbutton map-close", type: "button" }, COPY.close);
    close.addEventListener("click", function () { guarded(onClose); });
    head.appendChild(h); head.appendChild(close);
    return head;
  }
  function recordOpen() { return S.U.sel >= 0 && !!S.layout && S.U.sel < S.layout.nodes.length; }
  function closeRecord() { if (S.U.sel >= 0) { act({ type: "escape" }); giveFocusBack(); } }
  function giveFocusBack() {
    var o = S.opener; S.opener = null;
    if (o && typeof o.focus === "function" && o.isConnected !== false) try { o.focus(); } catch (e) { /* the focus stays */ }
  }
  function monthWords(m) { return MONTH.test(m) ? W.fmtDay(m + "-01").replace(/^1 /, "") : null; }

  // The record of the picked stock on the step shown: a plate of 320px beside its cap on a wide screen (placed as a caption
  // is, clear of the overlays and the captions, with a leader), a bottom sheet on a phone.
  function writeRecord() {
    var box = ui.record;
    S.recordBox = null;
    var r = recordOpen() ? C.record({ layout: S.layout, node: S.U.sel, back: S.back, timeline: S.T, k: S.k, evidence: S.evidence,
                                      positions: S.positions, state: S.state, isPublic: corePublic(), kinds: S.U.kinds, today: S.today,
                                      perList: sheet() ? LINKS_PHONE : LINKS_WIDE }) : null;
    var focused = within(box, document.activeElement);
    if (!r) { box.hidden = true; clear(box); hideCoveredLabels(); sheetClosed(); if (focused) giveFocusBack(); return; }
    clear(box);
    var title = el("span");
    title.appendChild(el("em", null, r.title));
    if (r.name) title.appendChild(el("span", { class: "map-record-name" }, " " + r.name));
    box.setAttribute("aria-label", "The record of " + r.title);
    box.appendChild(plateHead(title, closeRecord));
    if (r.sector) box.appendChild(el("p", { class: "colony map-record-sector" }, r.sector));
    r.lines.forEach(function (line) { box.appendChild(el("p", { class: "map-record-line" }, line)); });
    if (r.echoes.length) {
      box.appendChild(el("h3", { class: "colony map-record-part" }, COPY.echoes));
      r.echoes.forEach(function (line) { box.appendChild(el("p", { class: "map-record-line" }, line)); });
    }
    // Its links both ways, each list under its own name; what holds for every link is said once, under both.
    var month = monthWords(S.layout.links_month);
    function linkList(title, list) {
      if (!list.length) return;
      box.appendChild(el("h3", { class: "colony map-record-part" }, title));
      var ul = el("ul", { class: "map-record-links" });
      list.forEach(function (L) {
        var li = el("li");
        li.appendChild(el("p", { class: "map-record-line" }, L.line));
        if (L.stories.length) {
          var st = el("ul", { class: "map-record-stories" });
          L.stories.forEach(function (s) {
            var item = el("li");
            if (s.url) item.appendChild(el("a", { href: s.url, rel: "noopener noreferrer", target: "_blank" }, s.h)); else item.appendChild(el("span", null, s.h));
            if (s.day) item.appendChild(el("span", { class: "map-record-day" }, ", " + W.fmtDay(s.day)));
            st.appendChild(item);
          });
          li.appendChild(st);
        }
        if (L.note) li.appendChild(el("p", { class: "map-record-note" }, L.note));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    linkList(month ? COPY.linksOf(month) : COPY.links, r.links);
    linkList(month ? COPY.linkedByOf(month) : COPY.linkedBy, r.linkedBy);
    if (r.links.length || r.linkedBy.length) {
      r.notes.forEach(function (n) { box.appendChild(el("p", { class: "map-record-note" }, n)); });
      if (S.evidenceFailed) box.appendChild(el("p", { class: "map-record-note" }, COPY.noEvidence));
      else if (!S.evidence && S.extras) box.appendChild(el("p", { class: "map-record-note" }, COPY.readingEvidence));
    }
    box.hidden = false;
    placeRecord();
    if (focused) focusClose(box);                     // written again (a new step, the evidence read): the focus stays in it
  }
  function within(box, node) { for (var n = node; n; n = n.parentNode) if (n === box) return true; return false; }
  function focusClose(box) { var b = box.querySelector("button"); if (b && !box.hidden) try { b.focus(); } catch (e) { /* the focus stays */ } }
  function sheet() { return S.mode === "phone"; }
  // A colony name the record lies over is hidden while it does; the others show.
  function hideCoveredLabels() {
    var r = ui.record.hidden ? null : rectOf(ui.record);
    ui.labels.querySelectorAll("span").forEach(function (sp) {
      var b = { x: parseFloat(sp.style.left) || 0, y: parseFloat(sp.style.top) || 0, w: sp.offsetWidth, h: sp.offsetHeight };
      sp.style.visibility = r && r.w > 0 && hits(b, [r]) ? "hidden" : "";
    });
  }
  function placeRecord() {
    try { placeRecordBox(); } finally {
      var avoid = !ui.record.hidden && !sheet();       // the names find room clear of the open plate, and take it back after
      if (avoid || S.labelsAvoid) { S.labelsView = null; S.labelsAvoid = avoid; placeLabels(); }
      hideCoveredLabels();
    }
  }
  function placeRecordBox() {
    var box = ui.record, i = S.U.sel;
    S.recordBox = null;
    if (box.hidden) return;
    box.classList.toggle("map-sheet", sheet());
    document.body.classList.toggle("map-sheet-open", sheet());
    if (sheet()) { box.style.left = ""; box.style.top = ""; box.style.maxHeight = ""; capAboveSheet(i); return; }
    var ov = overlays(), topY = EDGE, botY = S.h - EDGE;
    ov.forEach(function (r) { if (r.y + r.h < S.h / 2) topY = Math.max(topY, r.y + r.h + CLEAR); else if (r.y > S.h / 2) botY = Math.min(botY, r.y - CLEAR); });
    box.style.maxHeight = Math.max(160, Math.min(RECORD_H, Math.round(botY - topY))) + "px";
    box.style.visibility = "hidden"; box.style.left = "0px"; box.style.top = "0px";
    var rr = box.getBoundingClientRect(), w = Math.ceil(rr.width) || RECORD_W, h = Math.ceil(rr.height);
    var x = S.pos && isNum(S.pos[2 * i]) ? S.pos[2 * i] : NaN, y = S.pos && isNum(S.pos[2 * i + 1]) ? S.pos[2 * i + 1] : NaN, spot = null;
    if (isNum(x) && isNum(y)) {
      // On the side of the screen away from the cap, at its height where the overlays allow, so the cap's neighbourhood (its
      // threads, its ripples, a holding's ticker) stays in view; the leader joins the two.
      // Of the heights the overlays allow, the one whose plate lies over the fewest caps (none, where the field leaves the side
      // free), nearest the cap's own height: a plate edge never slices through a cap it could have cleared.
      var east = x < S.w / 2, bx = east ? S.w - EDGE - w : EDGE, bestY = null, bestN = Infinity, want = y - h / 2;
      for (var ty = topY; ty <= Math.max(topY, botY - h) + 0.01; ty += 8) {
        var under = capsUnder({ x: bx, y: ty, w: w, h: h });
        if (under < bestN || (under === bestN && Math.abs(ty - want) < Math.abs(bestY - want))) { bestN = under; bestY = ty; }
      }
      spot = { x: bx, y: bestY === null ? topY : bestY };
    } else {                                            // the stock has no place on the screen: the right side, under the dials
      spot = { x: S.w - EDGE - w, y: topY };
    }
    box.style.left = Math.round(spot.x) + "px"; box.style.top = Math.round(spot.y) + "px"; box.style.visibility = "";
    if (isNum(x) && isNum(y)) S.recordBox = { box: { x: Math.round(spot.x), y: Math.round(spot.y), w: w, h: h }, x: x, y: y, r: S.scene && S.scene.caps[i] ? C.capAt(S.scene.caps[i], 1).r * D.markScale() : 6 };
  }

  // How many placed caps a box lies over or touches (each with the largest cap's room).
  function capsUnder(box) {
    var n = 0, m = 7 * D.markScale();
    for (var p = 0; S.pos && p + 1 < S.pos.length; p += 2) {
      var X = S.pos[p], Y = S.pos[p + 1];
      if (X > box.x - m && X < box.x + box.w + m && Y > box.y - m && Y < box.y + box.h + m) n++;
    }
    return n;
  }
  // On a phone the record is a sheet over the lower field, and the dials give their place to the field above it. The tapped
  // cap stays in view: when it lies under the sheet or the sentence, the view moves at the same zoom, as little as brings the
  // cap into the field left between them. The view before is given back when the record closes, unless the viewer moved it.
  var SHEET_CAP_ROOM = 14;
  function capAboveSheet(i) {
    if (!S.view || !S.pos || !isNum(S.pos[2 * i]) || !isNum(S.pos[2 * i + 1])) return;
    var row = rectOf(ui.foldRow && ui.foldRow.offsetParent !== null ? ui.foldRow : ui.top), sheetTop = rectOf(ui.record).y;
    var lo = row.y + row.h + CLEAR, hi = sheetTop - CLEAR, x = S.pos[2 * i], y = S.pos[2 * i + 1], m = SHEET_CAP_ROOM;
    if (!(hi - lo > 2 * m)) return;                   // no field left above the sheet: the record alone is shown
    var inX = x >= EDGE + m && x <= S.w - EDGE - m, inY = y >= lo + m && y <= hi - m;
    if (inX && inY) return;
    var tx = Math.max(EDGE + m, Math.min(S.w - EDGE - m, x)), ty = Math.max(lo + m, Math.min(hi - m, y));
    var v = { k: S.view.k, tx: S.view.tx + tx - x, ty: S.view.ty + ty - y, base: S.view.base };
    S.sheetPan = { from: S.sheetPan ? S.sheetPan.from : S.view, to: v };
    setView(v);
  }
  function sheetClosed() {
    document.body.classList.remove("map-sheet-open");
    var sp = S.sheetPan;
    S.sheetPan = null;
    if (sp && S.view === sp.to) setView(sp.from);
  }

  // The tools under the key: the kinds of link, my positions, find a stock, and reset view while zoomed in. Under them, on a
  // layer of their own (so the field never moves): the search and its results, a holding the map has not placed, and why a
  // catalyst the address or a caption asked for is not drawn on this step.
  function zoomed() { return !!(S.view && S.fit && S.view.k > S.fit.k * 1.0005); }
  function writeTools() {
    if (ui.folds.tools) ui.folds.tools.hidden = !S.layout;     // nothing placed: nothing to show or find
    ui.tNews.setAttribute("aria-pressed", S.U.kinds.news ? "true" : "false");
    ui.tComove.setAttribute("aria-pressed", S.U.kinds.comove ? "true" : "false");
    ui.tMine.setAttribute("aria-pressed", S.U.mine ? "true" : "false");
    ui.tFind.setAttribute("aria-pressed", S.findOpen ? "true" : "false");
    ui.tReset.classList.toggle("map-on", zoomed());
    ui.tReset.disabled = !zoomed();
    ui.findBox.hidden = !S.findOpen;
    if (ui.q.value !== S.U.query) ui.q.value = S.U.query;
    writeFound();
    clear(ui.toolNotes);
    var notes = [];
    if (S.U.mine && !holdingsKnown()) notes.push(COPY.noPositions);
    if (S.U.mine) S.offMap.forEach(function (t) { notes.push(COPY.offMap(t)); });
    if (S.catWhy) notes.push(S.catWhy);
    notes.forEach(function (n) { ui.toolNotes.appendChild(el("p", null, n)); });
    // On a folded screen a new note (why a catalyst is not drawn, a holding off the map) opens the tools, so it is read.
    var said = notes.join("|");
    if (said && said !== S.toolSaid) openTools();
    S.toolSaid = said;
    ui.toolNotes.hidden = notes.length === 0;
  }
  function writeFound() {
    clear(ui.found);
    S.found = S.findOpen && S.layout ? C.search(S.layout, S.U.query) : [];
    if (S.findOpen && S.U.query.trim() !== "" && !S.found.length) ui.found.appendChild(el("li", { class: "map-found-none" }, COPY.nothingFound));
    S.found.forEach(function (f) {
      var b = el("button", { type: "button", class: "map-found-item" });
      b.appendChild(el("span", { class: "fig" }, f.t));
      if (f.n && f.n !== f.t) b.appendChild(el("span", { class: "map-found-name" }, " " + f.n));
      b.addEventListener("click", function () { guarded(function () { pick(f.node, ui.tFind); }); });
      ui.found.appendChild(el("li")).appendChild(b);
    });
    ui.found.hidden = !S.found.length && !(S.findOpen && S.U.query.trim() !== "");
  }
  function setFind(on) {
    S.findOpen = on;
    if (on) openTools();
    if (!on) S.U = C.ui(S.U, { type: "search", q: "" });
    writeTools(); writeAddressSoon();
    if (on) try { ui.q.focus(); } catch (e) { /* the focus stays */ }
  }
  // A stock found: centred at 2.5 times the fitted zoom, its record opened; the search is cleared.
  function pick(node, opener) {
    S.findOpen = false; S.U = C.ui(S.U, { type: "search", q: "" });
    centreOn(node);
    S.opener = opener || null;
    commit(C.ui(S.U, { type: "tapCap", node: node }));
    guarded(writeTools);
    focusClose(ui.record);
  }
  // The middle of the free field: between the overlays above and below, across the screen.
  function freeMiddle() {
    var topY = 0, botY = S.h;
    overlays().forEach(function (r) { if (r.y + r.h < S.h / 2) topY = Math.max(topY, r.y + r.h); else if (r.y > S.h / 2) botY = Math.min(botY, r.y); });
    return { x: S.w / 2, y: (topY + botY) / 2 };
  }
  function centreOn(node) {
    var nd = S.L && S.L.nodes[node];
    if (!nd || !S.fit) return;
    var k = FIND_ZOOM * S.fit.k, mid = freeMiddle();
    setView(bounded(C.panBy({ k: k, tx: mid.x - k * nd.x, ty: mid.y - k * nd.y, base: S.fit.base }, 0, 0, fieldBox())));
  }

  // The scoreboard: a plate over the field, read when it is first opened. Its run-in note shows when a loaded frame is a run-in
  // day (they lie among the recent days, never in a month of the explored years).
  function anyRunin() {
    var h = S.history && Array.isArray(S.history.frames) ? S.history.frames : [];
    return h.some(function (f) { return f && f.runin === 1; }) || !!(S.stateFrame && S.stateFrame.f.runin === 1);
  }
  function openBoard() {
    S.boardOpen = true;
    if (S.U.sel >= 0) S.U = C.ui(S.U, { type: "escape" });
    guarded(platesChanged);
    writeAddressSoon();
    focusClose(ui.board);
  }
  function closeBoard() { S.boardOpen = false; guarded(platesChanged); writeAddressSoon(); try { ui.boardLink.focus(); } catch (e) { /* the focus stays */ } }
  function writeBoard() {
    var box = ui.board;
    clear(box);
    if (!S.boardOpen) { box.hidden = true; return; }
    if (!S.boardAsked) {
      S.boardAsked = true;
      W.loadJson("scoreboard.json").then(function (res) { S.boardFile = res; guarded(writeBoard); });
    }
    box.appendChild(plateHead(COPY.board, closeBoard, "map-board-title"));
    box.appendChild(el("p", { class: "map-board-lede" }, COPY.boardLede));
    var f = S.boardFile, rows = f && f.ok ? W.scoreboardRows(f.data) : [];
    if (!f) box.appendChild(el("p", { class: "map-record-note" }, COPY.boardReading));
    else if (!rows.length) box.appendChild(el("p", { class: "map-record-note" }, !f.ok && f.why === "damaged" ? COPY.boardDamaged : !f.ok && f.why === "offline" ? COPY.boardOffline : COPY.boardMissing));
    else {
      var ol = el("ol", { class: "map-board-list" });
      rows.forEach(function (r) {
        var li = el("li"), h = el("h3", { class: "map-board-name" });
        if (r.n !== null) { h.appendChild(el("span", { class: "fig" }, W.fmtInt(r.n) + ".")); h.appendChild(document.createTextNode(" ")); }
        h.appendChild(document.createTextNode(r.name || "An entry with no name"));
        li.appendChild(h);
        var meta = [r.kind ? (/^[aeiou]/i.test(r.kind) ? "An " : "A ") + r.kind : "", r.written ? "written " + W.fmtDay(r.written) : ""].filter(Boolean).join(", ");
        var stage = r.stage ? r.stage.charAt(0).toUpperCase() + r.stage.slice(1) + (/[.!?]$/.test(r.stage) ? "" : ".") : "";
        var said = [meta ? meta.charAt(0).toUpperCase() + meta.slice(1) + "." : "", stage].filter(Boolean).join(" ");
        if (said) li.appendChild(el("p", { class: "map-board-meta" }, said));
        if (r.summary) li.appendChild(el("p", null, r.summary));
        ol.appendChild(li);
      });
      box.appendChild(ol);
      var note = W.scoreboardNote(f.data);
      if (note) box.appendChild(el("p", { class: "map-board-note" }, note));
    }
    box.appendChild(el("p", { class: "map-board-report" })).appendChild(el("a", { href: "map-report.html" }, COPY.boardReport));
    if (anyRunin()) box.appendChild(el("p", { class: "map-board-note" }, W.RUNIN_NOTE));
    box.classList.toggle("map-sheet", sheet());
    box.style.bottom = sheet() ? "" : Math.round(S.h - rectOf(ui.bottom).y + CLEAR) + "px";
    box.hidden = false;
  }

  // ---- the view's gestures: tap, drag, pinch, wheel, double tap ----

  function fieldBox() { return { x: 0, y: 0, w: S.w, h: S.h }; }
  function pointOf(e) { var r = ui.field.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function gridNow() { if (S.gridPos !== S.pos) { S.grid = C.grid(S.pos || [], 24); S.gridPos = S.pos; } return S.grid; }
  // A view asked for by a gesture: back at the fitted zoom it is the fitted view; drawn at most once a frame.
  // The pan's bound by the caps themselves: some cap always lies within a quarter of the screen's smaller side of its middle
  // (when none does, the view is drawn back toward the nearest cap until one does), so the zoomed field can never be dragged
  // off the screen. A bound on the caps' outer box alone is not enough: the screen could rest on an empty corner of it.
  function bounded(v) {
    var nodes = S.L ? S.L.nodes : null;
    if (!v || !nodes || !nodes.length) return v;
    var cx = S.w / 2, cy = S.h / 2, best = Infinity, bx = 0, by = 0;
    for (var a = 0; a < nodes.length; a++) {
      var px = v.tx + v.k * nodes[a].x, py = v.ty + v.k * nodes[a].y, d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d < best) { best = d; bx = px; by = py; }
    }
    var dist = Math.sqrt(best), reach = Math.min(S.w, S.h) / 4;
    if (dist <= reach) return v;
    var f = (dist - reach) / dist;
    return { k: v.k, tx: v.tx + (cx - bx) * f, ty: v.ty + (cy - by) * f, base: v.base };
  }
  function viewTo(v) {
    if (!v || !S.fit) return;
    S.sheetPan = null;                                // the viewer moved the view: it is not given back
    if (v.k <= S.fit.k * 1.0005) v = S.fit; else v = bounded(v);
    if (S.view && v.k === S.view.k && v.tx === S.view.tx && v.ty === S.view.ty) return;
    S.pendingView = v;
    if (!S.viewRaf) S.viewRaf = requestAnimationFrame(function () { S.viewRaf = 0; var pv = S.pendingView; S.pendingView = null; if (pv) guarded(function () { setView(pv); }); });
  }
  function pinchOf() {
    var p = Array.from(S.pointers.values());
    return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.max(1, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)) };
  }
  function baseOf() { return S.pendingView || S.view; }
  function onDown(e) {
    if (!S.view || (e.pointerType === "mouse" && e.button !== 0)) return;
    var p = pointOf(e);
    S.pointers.set(e.pointerId, p);
    if (typeof ui.field.setPointerCapture === "function") try { ui.field.setPointerCapture(e.pointerId); } catch (err) { /* not captured */ }
    if (S.pointers.size === 1) S.gesture = { start: p, last: p, t: performance.now(), moved: false };
    else if (S.pointers.size === 2) S.gesture = { pinch: pinchOf(), moved: true };
  }
  function onMove(e) {
    if (!S.pointers.has(e.pointerId)) return;
    var p = pointOf(e), g = S.gesture;
    S.pointers.set(e.pointerId, p);
    if (!g) return;
    if (g.pinch && S.pointers.size >= 2) {
      var now = pinchOf(), v = C.zoomAt(baseOf(), now.x, now.y, now.d / g.pinch.d);
      viewTo(C.panBy(v, now.x - g.pinch.x, now.y - g.pinch.y, fieldBox()));
      g.pinch = now;
      return;
    }
    if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) > TAP_MOVE) g.moved = true;
    if (g.moved && zoomed()) viewTo(C.panBy(baseOf(), p.x - g.last.x, p.y - g.last.y, fieldBox()));
    g.last = p;
  }
  function onUp(e) {
    if (!S.pointers.has(e.pointerId)) return;
    var p = pointOf(e), g = S.gesture;
    S.pointers.delete(e.pointerId);
    if (S.pointers.size === 1 && g && g.pinch) {      // one finger stays down: it drags on from where it is, never a tap
      var rest = S.pointers.values().next().value;
      S.gesture = { start: rest, last: rest, t: 0, moved: true };
      return;
    }
    if (S.pointers.size > 0) return;
    S.gesture = null;
    if (!g || g.moved || g.pinch || e.type === "pointercancel" || performance.now() - g.t > TAP_MS) return;
    tapAt(p, e.pointerType);
  }
  var coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  // A tap picks the cap nearest the finger within the tap radius (coarse or fine), else the ground. A second tap soon after
  // and near the first zooms two times at that point.
  function tapAt(p, type) {
    var t = performance.now(), last = S.lastTap;
    if (last && t - last.t < DOUBLE_MS && Math.hypot(p.x - last.x, p.y - last.y) < DOUBLE_GAP) {
      S.lastTap = null;
      viewTo(C.panBy(C.zoomAt(baseOf(), p.x, p.y, 2), 0, 0, fieldBox()));
      return;
    }
    S.lastTap = { t: t, x: p.x, y: p.y };
    var radius = C.TAP_RADIUS[coarse || type === "touch" || type === "pen" ? "coarse" : "fine"];
    var i = S.scene && !S.loading ? C.hit(gridNow(), p.x, p.y, radius) : -1;
    S.opener = null;
    if (i >= 0) tapCap(i); else tapGround();
  }
  function onWheel(e) {
    if (!S.view) return;
    if (typeof e.preventDefault === "function") e.preventDefault();
    var p = pointOf(e), unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    viewTo(C.panBy(C.zoomAt(baseOf(), p.x, p.y, Math.exp(-e.deltaY * unit * WHEEL_RATE)), 0, 0, fieldBox()));
  }
  function resetView() { if (S.fit) guarded(function () { S.sheetPan = null; setView(S.fit); }); }

  // Esc closes the scoreboard, then the search, then the record, then lets the catalyst go.
  function onEscape(e) {
    if (e.key !== "Escape" && e.key !== "Esc") return false;
    if (S.boardOpen) closeBoard();
    else if (S.findOpen) { setFind(false); try { ui.tFind.focus(); } catch (err) { /* the focus stays */ } }
    else if (S.U.sel >= 0) closeRecord();
    else if (S.U.cat) act({ type: "escape" });
    else return false;
    if (typeof e.preventDefault === "function") e.preventDefault();
    return true;
  }

  // ---- putting it on the screen ----

  // A phone's one caption needs room the field would otherwise fill edge to edge: the field leaves a strip for it under the
  // dials, as tall as a plate of two lines. Elsewhere the field leaves room beside it.
  var CAPTION_ROOM = 46;
  function captionRoom() {
    if (S.mode !== "phone") return [];
    var top = 0;
    overlays().forEach(function (r) { if (r.y + r.h < S.h / 2) top = Math.max(top, r.y + r.h); });
    return [{ x: 0, y: top + CLEAR, w: S.w, h: CAPTION_ROOM - CLEAR }];
  }
  // Every cap is drawn at its recorded radius times one factor set by the fitted field's size (its longer side, in px): a field
  // as small as a phone's draws its marks at the phone's 0.7, one of FIELD_FULL px or more at 1, and sizes between go smoothly,
  // so a small field on a laptop does not drown its threads and pulses under full-size caps.
  var FIELD_SMALL = 360, FIELD_FULL = 760, MARKS_SMALL = 0.7;
  function markScaleFor(size) {
    if (!isNum(size) || size <= 0) return modeOf().marks;
    var t = Math.max(0, Math.min(1, (size - FIELD_SMALL) / (FIELD_FULL - FIELD_SMALL)));
    return Math.round((MARKS_SMALL + (1 - MARKS_SMALL) * t) * 1000) / 1000;
  }
  // Fit the field when the screen size or the overlays' band changed (never with the words of a step).
  function layoutField() {
    if (!S.layout) { S.L = null; S.view = null; S.pos = null; return; }
    var avoid = overlays().concat(captionRoom()), key = S.mode + ":" + S.w + "x" + S.h + ":" + avoid.map(function (r) { return [r.x, r.y, r.w, r.h].map(Math.round).join(","); }).join("|");
    if (key === S.fitKey && S.view) return;
    S.fitKey = key; S.sheetPan = null;
    var fit = fitField(S.layout, S.w, S.h, avoid, modeOf().pad);
    if (!fit.ok && avoid.length > overlays().length) fit = fitField(S.layout, S.w, S.h, overlays(), modeOf().pad);   // no room: the strip goes
    S.L = fit.L; S.fit = fit.view; S.view = C.panBy(fit.view, 0, 0, fieldBox()); S.pos = D.positions(S.L, S.view);
    D.setMarkScale(markScaleFor(fit.ok ? fit.view.k : NaN));
    S.groundView = S.view;
  }
  // The step shown, built whole. When the move into it eases (the player's forward step to the next entry), the move starts
  // once the step is built, so all of it is seen, and frames are drawn only while it runs; otherwise the step is drawn once,
  // at its end (or at the moment the address's `ease` freezes).
  function render() {
    buildScene();
    writeWords();
    writeDials();
    layoutField();
    placeLabels();
    writeRecord();
    writeBoard();
    placeCaptions();
    labelsOffPlates();
    rebuildStatic();
    writeKey();
    writeAlt();
    writeTools();
    drawCore();
    var t = performance.now();
    // A step in which nothing changes (no pulse, no cap whose recorded form differs) is a cut: no frame is drawn for it.
    if (S.P && S.P.trans && C.needsFrames(S.P, t) && !S.still && S.scene && S.scene.still !== true) {
      S.P = Object.assign({}, S.P, { trans: Object.assign({}, S.P.trans, { start: t }) });
      S.u = 0;
      composite();
      startLoop();
    } else {
      S.u = S.freeze !== null ? S.freeze : 1;
      composite();
    }
    writePlay();
  }
  // A fault in the page's own code: say so, and leave no word of the step it could not finish under it.
  function guarded(f) {
    try { f(); } catch (err) {
      if (typeof console === "object") console.error(err);
      ui.head.textContent = COPY.broken; ui.sub.textContent = ""; clear(ui.dials); clear(ui.captions); clear(ui.labels); S.labelsView = null;
    }
  }

  var resizing = 0;
  function onResize() {
    cancelAnimationFrame(resizing);
    resizing = requestAnimationFrame(function () {
      guarded(function () {
        sizeCanvases();
        applyMode();
        S.fitKey = "";
        drawKey();
        reserveBand();
        render();
      });
    });
  }

  function afterPaint() { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); }

  // ---- time: the player, the one motion, play, the keys and the drag ----

  // Frames are drawn only while a step's move runs; then the loop stops and the field is still.
  function loop() {
    S.raf = 0;
    if (!S.P) return;
    var t = performance.now();
    S.u = C.progress(S.P.trans, t);
    guarded(composite);
    if (C.needsFrames(S.P, t)) S.raf = requestAnimationFrame(loop);
  }
  function startLoop() { if (!S.raf && !document.hidden) S.raf = requestAnimationFrame(loop); }
  function stopLoop() { if (S.raf) cancelAnimationFrame(S.raf); S.raf = 0; }

  function newPlayer(k) {
    return { k: k, last: S.T.entries.length - 1, playing: false, speed: S.P ? S.P.speed : 1, reduced: S.reduced, trans: null, nextAt: 0,
             wait: null, T: S.T, monthOf: function (kk) { var e = S.T && S.T.entries[kk]; return e ? e.month : String(kk); } };
  }
  function writePlay() {
    var on = !!(S.P && S.P.playing);
    ui.play.setAttribute("aria-pressed", on ? "true" : "false");
    ui.play.setAttribute("aria-label", on ? COPY.pause : COPY.play);
    ui.icon.setAttribute("d", on ? PAUSE_D : PLAY_D);
    var sp = (S.P ? S.P.speed : 1) + "x";             // a phone shows only the figure; its name stays for a screen reader
    ui.speed.textContent = S.mode === "phone" ? sp : "speed " + sp;
    if (S.mode === "phone") ui.speed.setAttribute("aria-label", "speed " + sp); else ui.speed.removeAttribute("aria-label");
    ui.speed.disabled = !S.P;
  }

  // The player moved to another step: show it, and read the months it needs (after a drag has rested, so a fast drag
  // through the years does not fetch every month it passes).
  function stepTo() {
    S.k = S.P.k; S.freeze = null; S.waitFailed = null; S.linkNote = null;
    var k = S.k;
    if (!inHandFor(k) || waiting(k)) {
      clearTimeout(S.ensureT);
      S.ensureT = setTimeout(function () {
        ensure(k, true).then(function () { if (S.k === k) guarded(render); });
      }, S.dragging ? DRAG_WAIT_MS : 0);
    }
    render();
    writeAddressSoon();
  }
  function seek(k) {
    if (!S.P || !isNum(k)) return;
    var to = Math.max(0, Math.min(S.P.last, k));
    if (to === S.P.k) return;
    var was = S.P;
    stopLoop();
    S.P = C.player(was, { type: "seek", k: to, now: performance.now() });
    if (S.P.k !== was.k) guarded(stepTo);
    schedule();
  }
  function setPlaying(on) {
    if (!S.P || on === S.P.playing) return;
    S.P = C.player(S.P, { type: on ? "play" : "pause", now: performance.now() });
    S.waitFailed = null;
    if (!on) guarded(writeWords);
    writePlay();
    schedule();
  }
  function cycleSpeed() {
    if (!S.P) return;
    S.P = C.player(S.P, { type: "speed", value: SPEEDS[(SPEEDS.indexOf(S.P.speed) + 1) % SPEEDS.length] });
    writePlay();
    schedule();
  }

  // Play: a timer waits out the step (and the move, when it runs longer), then the player takes the next step. A step whose
  // months are not held waits for them; a step whose own month cannot be read stops play where it is.
  function schedule() {
    clearTimeout(S.timer); S.timer = 0;
    if (!S.P || !S.P.playing || S.P.wait !== null || document.hidden) return;
    var t = performance.now(), end = S.P.trans ? S.P.trans.start + S.P.trans.dur : 0;
    S.timer = setTimeout(function () { guarded(tick); }, Math.max(0, Math.max(S.P.nextAt || 0, end) - t));
  }
  function tick() {
    S.timer = 0;
    if (!S.P || !S.P.playing) return;
    var was = S.P;
    S.P = C.player(was, { type: "tick", now: performance.now(), loaded: inHandFor });
    if (S.P.wait !== null && S.P.wait !== was.wait) waitFor(S.P.k + 1);
    if (S.P.k !== was.k) stepTo();
    prefetch();
    writePlay();
    schedule();
  }
  function waitFor(next) {
    ensure(next, true).then(function () {
      if (!S.P || !S.P.playing || S.P.wait === null) return;
      var own = ownMonth(next);
      if (own && S.failed.has(own)) {                // the player stays where it is, and says why
        S.P = C.player(S.P, { type: "pause" });
        S.waitFailed = own;
        guarded(writeWords); writePlay();
        return;
      }
      S.P = C.player(S.P, { type: "loaded", m: S.P.wait, now: performance.now() });
      schedule();
    });
  }
  // While playing, the next month is read before play reaches it.
  function prefetch() {
    if (!S.P || !S.P.playing || !S.T) return;
    var here = S.T.entries[S.P.k];
    for (var q = S.P.k + 1; q <= Math.min(S.P.last, S.P.k + PREFETCH); q++) {
      var e = S.T.entries[q];
      if (e.month !== here.month) { if (e.seg === "deep") ensure(q, false); return; }
    }
  }

  // One month on or back: the step nearest the same date a month away, and at least one step in that direction.
  function monthStep(dir) {
    var e = S.T.entries[S.P.k];
    if (!e) return S.P.k;
    var y = +e.day.slice(0, 4), mo = +e.day.slice(5, 7) + dir, d = +e.day.slice(8, 10);
    if (mo < 1) { mo = 12; y--; } else if (mo > 12) { mo = 1; y++; }
    var len = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    var k = S.T.nearest(y + "-" + (mo < 10 ? "0" : "") + mo + "-" + (Math.min(d, len) < 10 ? "0" : "") + Math.min(d, len));
    if (k < 0) return S.P.k;
    if (dir > 0 && k <= S.P.k) k = S.P.k + 1;
    if (dir < 0 && k >= S.P.k) k = S.P.k - 1;
    return k;
  }
  // Left and right move one step (forward eases), Shift with them one month, Home and End to the ends, Space plays or
  // pauses; on the slider also up and down (one step) and the page keys (one month). Keys typed into a text field, and Space on a button or link (which presses it), are left alone.
  function onKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !S.P) return;
    var t = e.target, tag = t && t.tagName ? t.tagName.toLowerCase() : "";
    if ((tag === "input" && t.type !== "range") || tag === "textarea" || tag === "select" || (t && t.isContentEditable)) return;
    var to, slider = tag === "input" && t.type === "range";
    switch (e.key) {
      // On the focused slider, up and down are one step and the page keys one month, as a slider's keys are.
      case "ArrowUp": if (!slider) return; to = S.P.k + 1; break;
      case "ArrowDown": if (!slider) return; to = S.P.k - 1; break;
      case "PageUp": if (!slider) return; to = monthStep(1); break;
      case "PageDown": if (!slider) return; to = monthStep(-1); break;
      case "ArrowRight": to = e.shiftKey ? monthStep(1) : S.P.k + 1; break;
      case "ArrowLeft": to = e.shiftKey ? monthStep(-1) : S.P.k - 1; break;
      case "Home": to = 0; break;
      case "End": to = S.P.last; break;
      case " ": case "Spacebar":
        if (tag === "button" || tag === "a") return;
        e.preventDefault(); setPlaying(!S.P.playing); return;
      default: return;
    }
    e.preventDefault();
    seek(to);
  }
  // The drag: the range's value is a place on the strip; the nearest step to it is shown (a place in a band with no step
  // lands on the step at its edge), at most once a frame.
  function onRange() {
    if (!S.core) return;
    S.dragging = true;
    S.pendingK = S.core.kOfValue(+ui.range.value);
    if (S.inputRaf) return;
    S.inputRaf = requestAnimationFrame(function () {
      S.inputRaf = 0;
      if (S.pendingK !== null) seek(S.pendingK);
      S.pendingK = null;
      guarded(syncRange);
    });
  }
  function endDrag() { S.dragging = false; }

  // ---- the newest reading, read again; the clock ----

  function sameNames(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  // A newer reading: a close, or a day after the newest recent day, means the record of the recent days was rewritten (a
  // close rewrites the frames of the last 20 days), so it is read again before the new step is shown; a new 10-minute slot
  // of the same day joins the recent days as it is. While that read fails, the reading stays owed: the page keeps showing
  // the reading before it, says so, and tries again at every poll.
  function readState(st) {
    if (!isObj(st) || !isObj(st.frame) || !Array.isArray(st.tickers)) return null;
    var got = C.decodeFrame(st.frame, st.tickers.length, st.public === true, st.sectors);
    return got.ok ? { st: st, sf: { f: got.f, tickers: st.tickers, sectors: Array.isArray(st.sectors) ? st.sectors : [] } } : null;
  }
  function needsHistory(r) {
    var f = r.sf.f, days = S.history ? S.history.days : [], newest = days.length ? days[days.length - 1] : null;
    return !S.history || f.slot === "close" || newest === null || f.day > newest || days.indexOf(f.day) < 0 || !sameNames(r.st.tickers, S.history.tickers);
  }
  function poll() {
    if (S.polling || document.hidden) return;
    S.polling = true;
    W.loadJson("map-state.json").then(function (res) {
      var got = res.ok ? readState(res.data) : null;
      var take = got && (!S.state || got.st.asof !== S.state.asof) ? got : S.owed;
      if (!take) return null;
      if (S.owed || needsHistory(take)) {
        return W.loadJson("map-history.json").then(function (h) {
          var dec = h.ok ? C.decodeFile(h.data) : null;
          if (!(dec && dec.ok)) { S.owed = take; guarded(writeWords); return; }
          S.owed = null; S.history = dec; refusedIn(dec);
          S.state = take.st; S.stateFrame = take.sf;
          rebuild();
        });
      }
      S.state = take.st; S.stateFrame = take.sf;
      var f = take.sf.f;
      if (!S.history.frames.some(function (g) { return g.day === f.day && g.slot === f.slot; })) {
        S.history = Object.assign({}, S.history, { frames: S.history.frames.concat([f]) });
      }
      rebuild();
      return null;
    }).then(function () { S.polling = false; }, function (err) { S.polling = false; if (typeof console === "object") console.error(err); });
  }
  // The timeline made again (after a reload, an append or a new day), with the pin on the same step, or following the
  // newest when it was there.
  function rebuild() {
    if (!S.history) return;
    S.nowMs = clockMs(); S.today = nyDay(S.nowMs);
    var T = C.timeline({ index: S.index, history: S.history, today: S.today });
    if (!T.ok && S.index) { indexBroken(); T = C.timeline({ index: null, history: S.history, today: S.today }); }
    if (!T.ok || !T.entries.length) return;
    var P = S.P, oldE = S.T && P ? S.T.entries[P.k] : null, atEnd = !!P && P.k === P.last, last = T.entries.length - 1;
    var k = oldE ? T.at(oldE.day, oldE.slot) : -1;
    if (k < 0 && oldE) k = T.nearest(oldE.day);
    if (k < 0) k = last;
    stopLoop();
    S.T = T;
    if (!P) { S.P = newPlayer(atEnd ? last : k); S.k = S.P.k; guarded(render); return; }
    var base = Object.assign({}, P, { T: T, trans: null, wait: null });
    if (atEnd && k === last - 1) S.P = C.player(Object.assign(base, { k: k, last: last - 1 }), { type: "append", follow: true, now: performance.now() });
    else S.P = Object.assign(base, atEnd ? { k: last, last: last } : { k: k, last: last });
    if (S.P.k !== S.k) S.freeze = null;
    S.k = S.P.k;
    guarded(render);
    writeAddressSoon();
    schedule();
  }
  function indexBroken() { note(COPY.noIndex); S.index = null; }
  // The clock is checked once a minute: a new day makes the timeline again, and a reading going stale changes the words.
  function checkClock() {
    var wasDay = S.today, wasStale = !!C.staleness(S.state, S.nowMs).stale;
    S.nowMs = clockMs(); S.today = nyDay(S.nowMs);
    if (S.today !== wasDay && S.history) { rebuild(); return; }
    if (!!C.staleness(S.state, S.nowMs).stale !== wasStale) { writeWords(); drawCore(); }
  }
  function startTimers() {
    stopTimers();
    S.poll = setInterval(function () { guarded(poll); }, POLL_MS);
    S.clock = setInterval(function () { guarded(checkClock); }, CLOCK_MS);
  }
  function stopTimers() { clearInterval(S.poll); clearInterval(S.clock); S.poll = 0; S.clock = 0; }
  // A hidden page pauses play and stops reading; shown again, it reads the clock and draws the step as it stands.
  function onVisibility() {
    if (document.hidden) {
      setPlaying(false); stopTimers(); stopLoop(); clearTimeout(S.timer); S.timer = 0;
      return;
    }
    startTimers();
    guarded(checkClock);
    guarded(poll);                                   // a page shown again reads the newest reading at once
    if (S.P && C.needsFrames(S.P, performance.now())) startLoop();
    else { S.u = S.freeze !== null ? S.freeze : 1; guarded(composite); }
  }

  // ---- the address ----

  // The step in the address: the day of a close, or the day and time of a slot; nothing for the newest step (a link with
  // no step opens at the newest).
  function atOf(k) {
    var e = S.T && S.T.entries[k];
    if (!e || k === S.T.entries.length - 1) return null;
    return e.slot === "close" ? e.day : e.day + "T" + e.slot;
  }
  // Written only after the pass with the data (S.addr), never before: parts read before then would be lost. What it writes is
  // what the viewer has picked (S.U), the step and the clock.
  function writeAddress() {
    if (!S.addr || !window.history || typeof window.history.replaceState !== "function") return;
    var nodes = S.layout ? S.layout.nodes : [], sel = S.U.sel >= 0 && nodes[S.U.sel] ? nodes[S.U.sel].t : null;
    var cat = S.U.cat && nodes[S.U.cat.node] ? { t: nodes[S.U.cat.node].t, day: S.U.cat.day } : null;
    var text = C.formatHash({ at: atOf(S.k), sel: sel, cat: cat, kinds: S.U.kinds, mine: S.U.mine, ease: S.freeze, q: S.findOpen ? S.U.query : "",
                              scoreboard: S.boardOpen, now: S.hash ? S.hash.now : null });
    if (location.hash === text || (text === "" && location.hash === "")) return;
    try { window.history.replaceState(null, "", location.pathname + location.search + text); } catch (e) { /* the address stays as it was */ }
  }
  function writeAddressSoon() { clearTimeout(S.addrT); S.addrT = setTimeout(function () { guarded(writeAddress); }, 250); }

  // ---- boot ----

  function boot() {
    // The address is read in two passes. This first one, before any data, uses only the parts that need none (the clock,
    // `ease` and the switches); the step and the names wait for the timeline and the layout.
    S.hash = C.parseHash(location.hash);
    S.nowMs = clockMs(); S.today = nyDay(S.nowMs);
    S.U = C.ui({ sel: -1, cat: null, kinds: S.hash.kinds, mine: S.hash.mine, query: S.hash.q });
    S.findOpen = S.hash.q !== ""; S.boardOpen = S.hash.scoreboard;
    ui.tools.hidden = false;
    var rm = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    S.reduced = !!(rm && rm.matches);
    if (rm && typeof rm.addEventListener === "function") rm.addEventListener("change", function () {
      S.reduced = rm.matches;
      if (S.P) S.P = Object.assign({}, S.P, { reduced: S.reduced });
    });
    SANS = getComputedStyle(document.documentElement).getPropertyValue("--sans").trim() || SANS;
    sizeCanvases();
    applyMode();
    Object.keys(ui.folds).forEach(function (k) { if (ui.folds[k]) ui.folds[k].addEventListener("toggle", function () { guarded(function () { onFold(k); }); }); });
    drawKey();
    writeDials();                                    // the waiting dials take their place first: the band is measured beside them
    reserveBand();
    writePlay();
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", function (e) { guarded(function () { if (!onEscape(e)) onKey(e); }); });
    ui.field.addEventListener("pointerdown", function (e) { guarded(function () { onDown(e); }); });
    ui.field.addEventListener("pointermove", function (e) { guarded(function () { onMove(e); }); });
    ui.field.addEventListener("pointerup", function (e) { guarded(function () { onUp(e); }); });
    ui.field.addEventListener("pointercancel", function (e) { guarded(function () { onUp(e); }); });
    ui.field.addEventListener("wheel", function (e) { guarded(function () { onWheel(e); }); }, { passive: false });
    ui.tNews.addEventListener("click", function () { act({ type: "toggleKind", kind: "news" }); });
    ui.tComove.addEventListener("click", function () { act({ type: "toggleKind", kind: "comove" }); });
    ui.tMine.addEventListener("click", function () { act({ type: "toggleMine" }); });
    ui.tFind.addEventListener("click", function () { guarded(function () { setFind(!S.findOpen); }); });
    ui.tReset.addEventListener("click", resetView);
    ui.q.addEventListener("input", function () { S.U = C.ui(S.U, { type: "search", q: ui.q.value }); guarded(writeFound); writeAddressSoon(); });
    ui.q.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      if (typeof e.preventDefault === "function") e.preventDefault();
      if (S.found.length) guarded(function () { pick(S.found[0].node, ui.tFind); });
    });
    ui.boardLink.addEventListener("click", function (e) { if (typeof e.preventDefault === "function") e.preventDefault(); openBoard(); });
    document.addEventListener("visibilitychange", onVisibility);
    ui.play.addEventListener("click", function () { if (S.P) setPlaying(!S.P.playing); });
    ui.speed.addEventListener("click", cycleSpeed);
    ui.range.addEventListener("input", onRange);
    ui.range.addEventListener("change", endDrag);
    ui.range.addEventListener("pointerup", endDrag);
    ui.range.addEventListener("pointercancel", endDrag);
    Promise.all([W.loadJson("map-layout.json"), W.loadJson("map-state.json")]).then(function (r) {
      takeLayout(r[0]); takeState(r[1]);
      if (!S.state) S.loading = false;              // no reading: say so now, over the still field
      guarded(render);                               // the first paint: the field from the layout and the newest reading
      return afterPaint().then(function () { return W.loadJson("map-history.json"); });
    }).then(function (res) {
      takeHistory(res);
      // The explored years' index: the private page's only, and only of use beside the recent days.
      if (!S.history || corePublic()) return null;
      return W.loadJson("frames/index.json").then(function (ix) {
        if (ix.ok) S.index = ix.data; else if (ix.why !== "missing") indexBroken();
      });
    }).then(function () {
      // Without a readable record of the recent days the page stays on the newest reading: it never jumps to a day of the
      // explored years instead.
      if (!S.history) return null;
      S.T = C.timeline({ index: S.index, history: S.history, today: S.today });
      if (!S.T.ok && S.index) { indexBroken(); S.T = C.timeline({ index: null, history: S.history, today: S.today }); }
      if (!S.T.ok || !S.T.entries.length) { S.T = null; noHistory(); return null; }
      // The second pass, with the data: the step, the selection and the catalyst.
      S.addr = C.parseHash(location.hash, { layout: S.layout, timeline: S.T, today: S.today });
      var selNode = S.addr.sel ? C.nodeOfTicker(S.layout, S.addr.sel) : -1, catNode = S.addr.cat ? C.nodeOfTicker(S.layout, S.addr.cat.t) : -1;
      S.U = C.ui(Object.assign({}, S.U, { sel: selNode, cat: catNode >= 0 ? { node: catNode, day: S.addr.cat.day } : null }));
      if (S.U.sel >= 0) loadExtras();
      var k = S.addr.at ? C.addressEntry(S.T, S.addr.at, S.today) : -1;
      // A day the map does not hold (the closed years included, never named) is said once, until the first move.
      if (S.addr.ignored.indexOf("at") >= 0) S.linkNote = COPY.linkDay;
      S.P = newPlayer(k >= 0 ? k : S.T.entries.length - 1);
      S.k = S.P.k;
      // `ease` freezes the move into the step from the one before, at that progress: still, for a close look or a shared link.
      if (S.hash.ease !== null && S.k > 0 && S.T.adjacent(S.k - 1, S.k)) S.freeze = S.hash.ease;
      return ensure(S.k, true);
    }).then(function () {
      S.loading = false;
      guarded(render);
      guarded(writeAddress);
      startTimers();
    }).catch(function (err) {
      S.loading = false;
      if (typeof console === "object") console.error(err);
      guarded(render);
    });
  }

  boot();
})();
