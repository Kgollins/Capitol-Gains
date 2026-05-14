/* MapCore: the pure core of the ripple map. Part 1 decodes the recorded frames (one per trading day, and one per
   10-minute slot today) and runs the time model the slider stands on. Part 2 builds the scene of one step (which caps
   stand open, which threads carry a ripple, with or against the shock), the plain sentence that says what is
   happening, the captions and the dials. Part 3 holds the view (pan and zoom as plain numbers), hit testing, selection,
   search, a catalyst's cascade and the address that restores a view. It draws nothing and reaches for nothing outside
   itself: the caller passes the time in.

   Honesty rules, kept here at the root:
   - A value the frame does not hold is null (or NaN in a figure array, 127 in a level array), never 0.
   - A frame the decoder cannot read is refused, whole, with a reason in plain words. A frame is read whole or not at
     all: one bad catalyst row, echo entry or echo row refuses it, and nothing is dropped, repaired or guessed. (A
     dropped row would be a ripple that happened and is not shown.) Only a dial value that cannot be read reads as
     "no reading".
   - A day keeps its place in time. Every file lists its trading days, with or without a frame, and a day's step is
     its position in that list; a day whose close frame is missing or refused is a hole, never skipped over.
   - A public frame carries coarse levels only. The decoder makes no figure for it: `z` is null.
   - Nothing here throws for bad data. Every refusal is a returned reason.
   - The scene draws only what a frame records, and the sentence claims no more than the record holds: "nothing is
     spreading" is said only of a close whose whole look-back is in hand. Where the map cannot tell, it says so. */
var MapCore = (function () {
  "use strict";

  var CLOSED = ["2024-01-01", "2026-11-06"];            // the closed years: no frame of these days is ever shown (ruling 40)
  var LOOKBACK = 20;                                    // trading days read back from an entry (G1)
  var KIND = { e: "earnings", n: "news_burst", j: "price_jump" };
  var STEP_MS = { 1: 1000, 2: 500, 4: 250, 8: 125 };
  var SIDE = 100000;                                    // history days count from here, so they never meet the deep years
  var UNKNOWN_LEVEL = 127;

  // The decoder's own error type. It is thrown inside the decoder only and always caught at its edge.
  function DecodeError(why) { this.name = "MapCoreError"; this.why = why; this.message = why; }
  DecodeError.prototype = Object.create(Error.prototype);
  DecodeError.prototype.constructor = DecodeError;
  function refuse(why) { throw new DecodeError(why); }

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function isIndex(v, n) { return typeof v === "number" && v >= 0 && v < n && Math.floor(v) === v; }
  function isObject(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }
  function isNumOrNull(v) { return v === null || (typeof v === "number" && isFinite(v)); }

  // ---- days ----

  // Days from 1970-01-01 for a calendar day (the usual civil-day count), or NaN for a string that is not a day.
  function dayNumber(s) {
    var m = typeof s === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
    if (!m) return NaN;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return NaN;
    var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    var len = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
    if (d > len) return NaN;
    var yy = mo <= 2 ? y - 1 : y;
    var era = Math.floor(yy / 400);
    var yoe = yy - era * 400;
    var doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }
  function isDay(s) { return !isNaN(dayNumber(s)); }
  function inClosedYears(day) { return day >= CLOSED[0] && day <= CLOSED[1]; }
  function isSlot(s) { return s === "close" || (typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)); }

  // ---- figures and levels ----

  // Two base-36 digits (given as char codes) to 0..1295, or -1 when either is not a lowercase digit or letter.
  function pairIndex(a, b) {
    var da = a >= 48 && a <= 57 ? a - 48 : a >= 97 && a <= 122 ? a - 87 : -1;
    var db = b >= 48 && b <= 57 ? b - 48 : b >= 97 && b <= 122 ? b - 87 : -1;
    return da < 0 || db < 0 ? -1 : da * 36 + db;
  }

  // The private figure of two base-36 digits: (i - 129) / 10, so "3x" is 1.2. "zz", a pair beyond 12.9 and anything
  // unreadable is NaN.
  function zFromPair(pair) {
    if (typeof pair !== "string" || pair.length !== 2) return NaN;
    var i = pairIndex(pair.charCodeAt(0), pair.charCodeAt(1));
    return i < 0 || i > 258 ? NaN : (i - 129) / 10;      // 1295 is "zz"; 259 and above lie beyond 12.9
  }

  // Five levels of a figure. 127 for a figure that is not a number.
  function levelOfZ(z) {
    if (typeof z !== "number" || !isFinite(z)) return UNKNOWN_LEVEL;
    if (z < -2) return -2;
    if (z < -1) return -1;
    if (z <= 1) return 0;
    if (z <= 2) return 1;
    return 2;
  }

  // A level that is a reading: a whole number from -2 to 2. 127 ("no reading") and anything else is not.
  function isKnownLevel(v) { return typeof v === "number" && isInt(v) && v >= -2 && v <= 2; }

  // The public letter a..e is -2..2. Anything else, "-" included, is 127: no reading.
  function levelOfLetter(ch) {
    return typeof ch === "string" && ch.length === 1 && ch >= "a" && ch <= "e" ? ch.charCodeAt(0) - 99 : UNKNOWN_LEVEL;
  }

  // The level of an echo's follow value. A public value is already a level. A private value is round(10 * follow).
  // null stays null, and so does a value out of range: no level is made up.
  function lvLevel(lv, isPublic) {
    if (typeof lv !== "number" || !isFinite(lv)) return null;
    if (isPublic) return isKnownLevel(lv) ? lv : null;
    if (lv < -10) return -2;
    if (lv < -5) return -1;
    if (lv <= 5) return 0;
    if (lv <= 10) return 1;
    return 2;
  }

  // ---- one frame ----

  var STATE_OF = { q: 1, l: 2, t: 3, "-": 0 };

  // The kind named by a catalyst code (e, n or j), or undefined for any other value.
  function kindOf(code) { return typeof code === "string" && Object.prototype.hasOwnProperty.call(KIND, code) ? KIND[code] : undefined; }

  // Every part of a frame is checked and the first bad one refuses the frame, with its place in the reason.
  function decodeCats(list, n) {
    var cats = [];
    for (var a = 0; a < list.length; a++) {
      var r = list[a], at = "catalyst row " + a + " ";
      if (!Array.isArray(r) || r.length !== 6) refuse(at + "does not have six items");
      var kind = kindOf(r[1]);
      if (kind === undefined) refuse(at + "has an unknown kind code");
      if (!isIndex(r[0], n)) refuse(at + "names a stock that is not in the file");
      var letter = r[2];
      if (typeof letter !== "string" || letter.length !== 1 || "abcde-".indexOf(letter) < 0) refuse(at + "has an unknown level letter");
      var large = r[3] === 1 || r[3] === true ? true : r[3] === 0 || r[3] === false ? false : null;
      if (large === null) refuse(at + "has a size that is not 0 or 1");
      var parent = r[4], back = r[5];
      if (parent !== -1 && !isIndex(parent, n)) refuse(at + "has a parent that is not in the file");
      if (back !== null && !(isInt(back) && back >= 0)) refuse(at + "has days back that are not a whole number");
      // A parent given with 0 days back (Plan R writes 0 when it has no day count) keeps its row; the days back are unknown.
      cats.push({ i: r[0], kind: kind, zLevel: levelOfLetter(letter), large: large,
                  parent: parent === -1 ? null : parent, parentBack: parent === -1 || back === 0 ? null : back });
    }
    return cats;
  }

  // A follow value in a row: null, a level -2..2 (public) or a whole number of tenths (private).
  function lvValue(v, isPublic, at) {
    if (v === null) return null;
    if (isPublic) { if (!isKnownLevel(v)) refuse(at + "has a follow value that is not a level"); }
    else if (!isInt(v)) refuse(at + "has a follow value that is not a whole number of tenths");
    return v;
  }

  function decodeRow(r, n, isPublic, a, e) {
    var at = "echo row " + a + " of entry " + e + " ";
    if (!Array.isArray(r) || r.length !== 8) refuse(at + "does not have eight items");
    var dst = r[0], hops = r[1], ring = r[2], via = r[6], sheet = r[7];
    if (!isIndex(dst, n)) refuse(at + "names a stock that is not in the file");
    if (hops !== 1 && hops !== 2) refuse(at + "has hops that are not 1 or 2");
    if (!isInt(ring) || ring < -LOOKBACK || ring > LOOKBACK) refuse(at + "has a ring that is not a whole number from -20 to 20");
    if (via !== -1 && !isIndex(via, n)) refuse(at + "names a middle stock that is not in the file");
    if (sheet !== "n" && sheet !== "c") refuse(at + "has an unknown sheet code");
    return { dst: dst, hops: hops, ring: ring, lv: [lvValue(r[3], isPublic, at), lvValue(r[4], isPublic, at), lvValue(r[5], isPublic, at)],
             via: via, sheet: sheet === "n" ? "news" : "comove" };
  }

  function decodeEchoes(list, n, isPublic) {
    var echoes = [];
    for (var a = 0; a < list.length; a++) {
      var en = list[a], at = "echo entry " + a + " ";
      if (!Array.isArray(en) || en.length !== 3 || !Array.isArray(en[2])) refuse(at + "is not a list of three items");
      if (!isIndex(en[0], n)) refuse(at + "names a stock that is not in the file");
      var code = en[1], onset = code === "o";
      if (!onset && kindOf(code) === undefined) refuse(at + "has an unknown kind code");
      var rows = [], raw = en[2];
      for (var b = 0; b < raw.length; b++) rows.push(decodeRow(raw[b], n, isPublic, b, a));
      echoes.push({ src: en[0], type: onset ? "onset" : "catalyst", kind: onset ? null : kindOf(code), rows: rows });
    }
    return echoes;
  }

  // The dials of a frame: ALL and the file's own sectors only, on an object with no prototype. A value that is not six
  // numbers or nulls is left out: no reading. A run-in day has none (ruling 16).
  function decodeDials(d, sectors, runin) {
    var out = Object.create(null);
    if (runin === 1) return out;
    var allowed = Object.create(null);
    allowed.ALL = true;
    if (Array.isArray(sectors)) for (var s = 0; s < sectors.length; s++) if (typeof sectors[s] === "string" && sectors[s] !== "__proto__") allowed[sectors[s]] = true;
    var keys = Object.keys(d);
    for (var a = 0; a < keys.length; a++) {
      if (allowed[keys[a]] !== true) continue;
      var v = d[keys[a]], good = Array.isArray(v) && v.length === 6;
      for (var b = 0; good && b < 6; b++) good = isNumOrNull(v[b]);
      if (good) out[keys[a]] = v.slice();
    }
    return out;
  }

  function decodeFrameCore(frame, nTickers, isPublic, sectors) {
    if (!isInt(nTickers) || nTickers < 0) refuse("the ticker count is not a whole number");
    var n = nTickers;
    if (!isObject(frame)) refuse("the frame is not an object");
    if (!isDay(frame.day)) refuse("the day is missing or is not a date");
    if (!isSlot(frame.slot)) refuse("the slot is not the close or a clock time");
    var runin = frame.runin === 1 || frame.runin === true ? 1 : frame.runin === 0 || frame.runin === false ? 0 : -1;
    if (runin < 0) refuse("the run-in flag is not 0 or 1");
    if (inClosedYears(frame.day)) refuse("closed years");              // ruling 40: never shown, run-in or not

    var s = frame.s;
    if (typeof s !== "string") refuse("the state string is missing");
    if (s.length !== n) refuse("state string has the wrong length");
    var state = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var code = STATE_OF[s.charAt(i)];
      if (code === undefined) refuse("the state string has an unknown letter");
      state[i] = code;
    }

    var zs = frame.z, z = null, zLevel = new Int8Array(n);
    if (typeof zs !== "string") refuse("the figures string is missing");
    if (zs.length !== (isPublic ? n : 2 * n)) refuse("figures string has the wrong length");
    if (isPublic) {
      for (i = 0; i < n; i++) {
        var ch = zs.charAt(i);
        if (ch !== "-" && !(ch >= "a" && ch <= "e")) refuse("the figures string has an unknown letter");
        zLevel[i] = levelOfLetter(ch);
      }
    } else {
      z = new Float32Array(n);
      for (i = 0; i < n; i++) {
        var p = pairIndex(zs.charCodeAt(2 * i), zs.charCodeAt(2 * i + 1));
        if (p < 0) refuse("the figures string has an unknown letter");
        if (p === 1295) { z[i] = NaN; zLevel[i] = UNKNOWN_LEVEL; continue; }
        if (p > 258) refuse("a figure is out of range");
        var v = (p - 129) / 10;
        z[i] = v; zLevel[i] = levelOfZ(v);
      }
    }

    if (!Array.isArray(frame.c)) refuse("the catalyst list is missing");
    if (!Array.isArray(frame.e)) refuse("the echo list is missing");
    if (frame.d !== undefined && !isObject(frame.d)) refuse("the dials are not an object");
    var cats = decodeCats(frame.c, n);
    var echoes = decodeEchoes(frame.e, n, isPublic);
    return { day: frame.day, slot: frame.slot, runin: runin, isPublic: isPublic, n: n, state: state, z: z,
             zLevel: zLevel, cats: cats, echoes: echoes,
             dials: frame.d === undefined ? Object.create(null) : decodeDials(frame.d, sectors, runin) };
  }

  // `sectors` (optional) are the file's sector names: the only dial names read besides ALL.
  // -> {ok: true, f} or {ok: false, why}. Never throws.
  function decodeFrame(frame, nTickers, isPublic, sectors) {
    try { return { ok: true, f: decodeFrameCore(frame, nTickers, !!isPublic, sectors) }; }
    catch (e) { return { ok: false, why: e instanceof DecodeError ? e.why : "the frame could not be read" }; }
  }

  // ---- a file of frames ----

  function emptyFile(why) { return { ok: false, why: why, tickers: [], sectors: [], isPublic: false, days: [], frames: [], refused: [] }; }

  function isNameList(v) {
    if (!Array.isArray(v)) return false;
    for (var a = 0; a < v.length; a++) if (typeof v[a] !== "string") return false;
    return true;
  }

  // null when a list of days is all real dates in strict order, else "date" or "order".
  function dayListFault(list) {
    var a;
    for (a = 0; a < list.length; a++) if (!isDay(list[a])) return "date";
    for (a = 1; a < list.length; a++) if (!(list[a - 1] < list[a])) return "order";
    return null;
  }

  // -> {ok, why?, tickers, sectors, isPublic, days, frames: [decoded], refused: [{day, slot, why}]}. Never throws.
  // `days` is every trading day of the file's span, in order, with or without a frame (ruling 25).
  function decodeFile(file) {
    try {
      if (!isObject(file)) return emptyFile("the file is not an object");
      if (file.version !== 2) return emptyFile("the file is not version 2");
      if (!isNameList(file.tickers)) return emptyFile("the tickers are not a list of names");
      if (!isNameList(file.sectors) || file.sectors.length !== file.tickers.length) return emptyFile("the sectors do not line up with the tickers");
      if (typeof file.public !== "boolean") return emptyFile("the file does not say whether it is public");
      if (!Array.isArray(file.days)) return emptyFile("the file has no list of days");
      var fault = dayListFault(file.days);
      if (fault === "date") return emptyFile("the list of days has something that is not a date");
      if (fault === "order") return emptyFile("the list of days is not in order");
      if (!Array.isArray(file.frames)) return emptyFile("the frames are not a list");
      var frames = [], refused = [], seen = {}, listed = {}, n = file.tickers.length, a;
      for (a = 0; a < file.days.length; a++) listed[file.days[a]] = true;
      for (a = 0; a < file.frames.length; a++) {
        var raw = file.frames[a], res = decodeFrame(raw, n, file.public, file.sectors);
        var day = isObject(raw) && typeof raw.day === "string" ? raw.day : null;
        var slot = isObject(raw) && typeof raw.slot === "string" ? raw.slot : null;
        if (!res.ok) { refused.push({ day: day, slot: slot, why: res.why }); continue; }
        if (listed[res.f.day] !== true) { refused.push({ day: day, slot: slot, why: "the frame's day is not in the file's list of days" }); continue; }
        var key = res.f.day + "|" + res.f.slot;
        if (seen[key] === true) { refused.push({ day: day, slot: slot, why: "a second frame for the same day and slot" }); continue; }
        seen[key] = true;
        frames.push(res.f);
      }
      return { ok: true, tickers: file.tickers.slice(), sectors: file.sectors.slice(), isPublic: file.public, days: file.days.slice(),
               frames: frames, refused: refused };
    } catch (e) {
      return emptyFile("the file could not be read");
    }
  }

  // ---- the timeline ----

  var MONTH_LABEL = /^\d{4}-(0[1-9]|1[0-2])$/;
  var BREAK_DAYS = 5;                                   // neighbouring listed days further apart than this are not neighbours

  function slotOrder(slot) { return slot === "close" ? "99:99" : slot; }

  // Block numbers of a list of days: they change wherever two listed days lie more than BREAK_DAYS apart.
  function blocksOf(days) {
    var out = [], block = 0;
    for (var a = 0; a < days.length; a++) {
      if (a > 0 && dayNumber(days[a]) - dayNumber(days[a - 1]) > BREAK_DAYS) block++;
      out.push(block);
    }
    return out;
  }

  // The index (frames/index.json): `days` is every trading day of the deep years; each month lists its trading days in `days`
  // and, in `framed`, the days that have a frame (a subset of its `days`, in order; ruling 25). A listed day that is not framed
  // is a hole: it gets no entry. A month without `framed` (an older index) cannot say which of its days have a frame: its days
  // are entries, marked `framed: null`, and only the month file, once loaded, can show the frame (a frame its file does not
  // hold is not in hand, and the scene of any look-back over it is incomplete).
  // -> {why} or {days, month: {day: label}, framed: {day: true | null}}.
  function readIndex(index) {
    if (!isObject(index)) return { why: "the index is not an object" };
    if (!Array.isArray(index.days)) return { why: "the index has no list of days" };
    var fault = dayListFault(index.days), a, b;
    if (fault === "date") return { why: "the index's days have something that is not a date" };
    for (a = 0; a < index.days.length; a++) if (inClosedYears(index.days[a])) return { why: "the index lists a day of the closed years" };
    if (fault === "order") return { why: "the index's days are not in order" };
    if (!Array.isArray(index.months)) return { why: "the index has no list of months" };
    var inIndex = {}, month = {}, framed = {};
    for (a = 0; a < index.days.length; a++) inIndex[index.days[a]] = true;
    for (a = 0; a < index.months.length; a++) {
      var mo = index.months[a];
      if (!isObject(mo)) return { why: "a month of the index is not an object" };
      if (typeof mo.m !== "string" || !MONTH_LABEL.test(mo.m)) return { why: "a month of the index has a label that is not YYYY-MM" };
      if (!Array.isArray(mo.days)) return { why: "a month of the index has no list of days" };
      var mf = dayListFault(mo.days);
      if (mf === "date") return { why: "a month of the index has something that is not a date" };
      if (mf === "order") return { why: "a month of the index lists its days out of order" };
      for (b = 0; b < mo.days.length; b++) {
        var d = mo.days[b];
        if (d.slice(0, 7) !== mo.m) return { why: "a month of the index lists a day of another month" };
        if (inIndex[d] !== true) return { why: "a month of the index lists a day that the index does not" };
        if (month[d] !== undefined) return { why: "the index lists a day under two months" };
        month[d] = mo.m;
      }
      if (mo.framed === undefined) { for (b = 0; b < mo.days.length; b++) framed[mo.days[b]] = null; continue; }
      if (!isNameList(mo.framed)) return { why: "a month of the index has framed days that are not a list" };
      var ff = dayListFault(mo.framed), listed = {};
      if (ff === "date") return { why: "a month of the index has framed days that are not a list" };
      if (ff === "order") return { why: "a month of the index lists its framed days out of order" };
      for (b = 0; b < mo.days.length; b++) listed[mo.days[b]] = true;
      for (b = 0; b < mo.framed.length; b++) {
        if (listed[mo.framed[b]] !== true) return { why: "a month of the index has a framed day that it does not list" };
        framed[mo.framed[b]] = true;
      }
    }
    return { days: index.days, month: month, framed: framed };
  }

  // A decodeFile result with its frames in a list the timeline can trust, or false.
  function historyReadable(h) {
    if (!isObject(h) || h.ok !== true || !Array.isArray(h.frames) || !Array.isArray(h.days) || dayListFault(h.days) !== null) return false;
    var pos = Object.create(null), a;                     // no prototype: a day named toString or __proto__ is no day
    for (a = 0; a < h.days.length; a++) pos[h.days[a]] = a;
    for (a = 0; a < h.frames.length; a++) {
      var f = h.frames[a];
      if (!isObject(f) || typeof f.day !== "string" || typeof f.slot !== "string" || pos[f.day] === undefined) return false;
    }
    return true;
  }

  // index: the frames/index.json object or null. history: a decodeFile result or null. today: the New York date of the
  // clock, passed in. Entries: the deep days that have a frame (td = position in the index's days), then the history
  // frames (td = SIDE + position in the file's days). A listed day with no readable close frame has no close entry. Each
  // entry's `framed` is true when the record says the frame exists, or null for a deep day of an older index (readIndex).
  // -> {ok, why?, entries, adjacent, lookback, at, nearest}; a source that cannot be read gives ok false and no entries.
  function timeline(args) {
    var a0 = isObject(args) ? args : {}, index = a0.index, history = a0.history, today = a0.today;
    var none = index === null || index === undefined, deepDays = [], deepMonth = {}, deepFramed = {}, histDays = [];
    if (!none) {
      var ri = readIndex(index);
      if (ri.why !== undefined) return refusedTimeline(ri.why);
      deepDays = ri.days; deepMonth = ri.month; deepFramed = ri.framed;
    }
    var hasHistory = history !== null && history !== undefined;
    if (hasHistory) {
      if (!historyReadable(history)) return refusedTimeline("the history is not a decoded frame file");
      histDays = history.days;
      var inHistory = Object.create(null);
      for (var h = 0; h < histDays.length; h++) inHistory[histDays[h]] = true;
      for (h = 0; h < deepDays.length; h++) if (inHistory[deepDays[h]] === true) return refusedTimeline("the index lists a day that the recent days list too");
    }
    var entries = [], a;

    // A deep day is an entry when a month lists it and does not say it has no frame (`framed`: true, or null for an older index).
    for (a = 0; a < deepDays.length; a++) {
      var dd = deepDays[a], fr = deepFramed[dd];
      if (deepMonth[dd] !== undefined && (fr === true || fr === null)) {
        entries.push({ k: entries.length, day: dd, slot: "close", seg: "deep", month: deepMonth[dd], td: a, runin: 0, fi: -1, framed: fr });
      }
    }

    // History frames, in order of day, then slot (the close last). A trading day counts once, however many slots it has.
    if (hasHistory) {
      var pos = Object.create(null);
      for (a = 0; a < histDays.length; a++) pos[histDays[a]] = a;
      var order = history.frames.map(function (f, i) { return i; });
      order.sort(function (x, y) {
        var fx = history.frames[x], fy = history.frames[y];
        if (fx.day !== fy.day) return pos[fx.day] - pos[fy.day];
        var sx = slotOrder(fx.slot), sy = slotOrder(fy.slot);
        return sx < sy ? -1 : sx > sy ? 1 : x - y;
      });
      var newest = order.length ? history.frames[order[order.length - 1]].day : null;
      for (a = 0; a < order.length; a++) {
        var f = history.frames[order[a]];
        entries.push({ k: entries.length, day: f.day, slot: f.slot, seg: f.day === newest && newest === today ? "today" : "recent",
                       month: f.day.slice(0, 7), td: SIDE + pos[f.day], runin: f.runin === 1 ? 1 : 0, fi: order[a], framed: true });
      }
    }
    return buildTimeline(entries, blocksOf(deepDays), blocksOf(histDays), { deep: deepDays.slice(), recent: histDays.slice() });
  }

  function refusedTimeline(why) {
    var T = buildTimeline([], [], [], { deep: [], recent: [] });
    T.ok = false; T.why = why;
    return T;
  }

  // `days`: the calendar the entries stand on, with or without frames: the index's deep days and the history's days.
  function buildTimeline(entries, deepBlocks, histBlocks, days) {
    var bySlot = {}, closeByTd = {}, ordinals = [], a;
    for (a = 0; a < entries.length; a++) {
      var e = entries[a], key = e.day + "|" + e.slot;
      if (bySlot[key] === undefined) bySlot[key] = e.k;
      if (e.slot === "close") closeByTd[e.td] = e.k;
      ordinals.push(dayNumber(e.day));
    }
    // The block of a step: deep blocks and history blocks never match, and a step outside a list has none.
    function blockOf(td) { return td >= SIDE ? (histBlocks[td - SIDE] === undefined ? undefined : 1e6 + histBlocks[td - SIDE]) : deepBlocks[td]; }
    function entryAt(k) { return isInt(k) && k >= 0 ? entries[k] : undefined; }

    // The next entry, on the same side of every break, on the same trading day or the next one. A step over a hole
    // (a listed day with no frame) is not adjacent.
    function adjacent(k1, k2) {
      var x = entryAt(k1), y = entryAt(k2);
      return !!x && !!y && k2 === k1 + 1 && blockOf(x.td) === blockOf(y.td) && (y.td === x.td || y.td === x.td + 1);
    }

    // The entry as j = 0, then the close of each of the 20 trading days before it, where one exists on the same side of
    // every break. Only closes count: a day with slot frames and no close is a hole.
    function lookback(k) {
      var e = entryAt(k), items = [], have = 0;
      if (!e) return { items: items, complete: false };
      items.push({ k: k, j: 0 });
      var block = blockOf(e.td);
      for (var j = 1; j <= LOOKBACK; j++) {
        var td = e.td - j, ck = closeByTd[td];
        if (ck !== undefined && blockOf(td) === block) { items.push({ k: ck, j: j }); have++; }
      }
      return { items: items, complete: have === LOOKBACK };
    }

    function at(day, slot) {
      if (typeof day !== "string" || typeof slot !== "string") return -1;
      var k = bySlot[day + "|" + slot];
      return k === undefined ? -1 : k;
    }

    // The closest entry to a day: the nearest date (the earlier on a tie), its close if it has one, else its last entry.
    function nearest(day) {
      var target = dayNumber(day);
      if (isNaN(target)) return -1;
      var bestDay = NaN, q;
      for (q = 0; q < entries.length; q++) {
        var dist = Math.abs(ordinals[q] - target);
        if (isNaN(bestDay) || dist < Math.abs(bestDay - target) || (dist === Math.abs(bestDay - target) && ordinals[q] < bestDay)) bestDay = ordinals[q];
      }
      if (isNaN(bestDay)) return -1;
      var pick = -1;
      for (q = 0; q < entries.length; q++) {
        if (ordinals[q] === bestDay && (pick < 0 || entries[q].slot === "close" || entries[pick].slot !== "close")) pick = q;
      }
      return pick;
    }

    return { ok: true, entries: entries, days: days, adjacent: adjacent, lookback: lookback, at: at, nearest: nearest };
  }

  // ---- months held ----

  // The most recently used `limit` months. get and put count as use; has and keys do not.
  function monthCache(limit) {
    var cap = isInt(limit) && limit >= 1 ? limit : 6, held = new Map();
    return {
      get: function (m) {
        if (!held.has(m)) return undefined;
        var v = held.get(m);
        held.delete(m); held.set(m, v);
        return v;
      },
      put: function (m, file) {
        held.delete(m); held.set(m, file);
        while (held.size > cap) held.delete(held.keys().next().value);
      },
      has: function (m) { return held.has(m); },
      keys: function () { return Array.from(held.keys()); },
    };
  }

  // ---- time: easing and the player ----

  function isSpeed(v) { return typeof v === "number" && Object.prototype.hasOwnProperty.call(STEP_MS, v); }
  function stepMs(speed) { return isSpeed(speed) ? STEP_MS[speed] : STEP_MS[1]; }
  // The wait between two steps of play: the speed's step, but never under a second with reduced motion (every move is then a
  // cut, and cuts faster than that would flash).
  function stepFor(s) { var m = stepMs(s.speed); return s.reduced ? Math.max(m, STEP_MS[1]) : m; }

  // The length of an eased move in ms: none when motion is reduced, else 70% of a step, at most 700.
  function easeDur(speed, reduced) { return reduced ? 0 : Math.min(700, 0.7 * stepMs(speed)); }

  // Ease out: fast at first, settling at the end.
  function isMove(trans) { return isObject(trans) && typeof trans.start === "number" && typeof trans.dur === "number"; }
  function progress(trans, now) {
    if (!isMove(trans) || !(trans.dur > 0)) return 1;                   // the types are checked before any arithmetic
    if (typeof now !== "number") return 0;
    var t = (now - trans.start) / trans.dur;
    if (isNaN(t)) return 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return 1 - Math.pow(1 - t, 3);
  }

  function running(s, now) { return typeof now === "number" && isMove(s.trans) && now < s.trans.start + s.trans.dur; }
  function needsFrames(s, now) { return isObject(s) && running(s, now); }

  // A copy of the state with some keys changed. A key named __proto__ or constructor is never copied.
  function patch(s, p) {
    var o = {}, keys = Object.keys(s).concat(Object.keys(p)), key;
    for (var a = 0; a < keys.length; a++) {
      key = keys[a];
      if (key === "__proto__" || key === "constructor") continue;
      o[key] = Object.prototype.hasOwnProperty.call(p, key) ? p[key] : s[key];
    }
    return o;
  }

  function adjacentFor(s, from, to) {
    return s.T && typeof s.T.adjacent === "function" ? !!s.T.adjacent(from, to) : to === from + 1;
  }

  // The move to entry `to`: eased when it is the next entry on the same side and motion is not reduced, else a cut.
  function moveTo(s, to, now, easeAllowed) {
    var dur = easeDur(s.speed, s.reduced);
    var ease = easeAllowed && dur > 0;
    return { k: to, trans: ease ? { from: s.k, to: to, start: now, dur: dur } : null };
  }

  function waitKey(s, k) {
    if (typeof s.monthOf === "function") return s.monthOf(k);
    if (s.T && s.T.entries && s.T.entries[k]) return s.T.entries[k].month;
    return String(k);
  }

  // state: {k, last, playing, speed, reduced, trans: {from, to, start, dur} | null, nextAt, wait: month | null, T, monthOf}.
  // Returns a new state. An action it does not know, or one with a bad value, leaves the state as it is.
  function player(state, action) {
    var s = state;
    if (!isObject(s) || !isObject(action)) return state;
    var now = typeof action.now === "number" && isFinite(action.now) ? action.now : 0;
    switch (action.type) {
      case "play":
        return patch(s, { playing: true, nextAt: now, wait: null });
      case "pause":
        return patch(s, { playing: false, wait: null });
      case "speed":
        return isSpeed(action.value) ? patch(s, { speed: action.value }) : s;
      case "seek": {
        var k = action.k;
        if (!isInt(k) || k < 0 || (typeof s.last === "number" && k > s.last)) return s;
        if (k === s.k) return s;
        var mv = moveTo(s, k, now, adjacentFor(s, s.k, k));
        return patch(s, { k: mv.k, trans: mv.trans, wait: null, nextAt: now + stepFor(s) });
      }
      case "tick": {
        // A finished move is cleared (a change); otherwise a tick that does nothing returns the very same state.
        var cur = s.trans && !running(s, now) ? patch(s, { trans: null }) : s;
        if (!cur.playing || running(cur, now) || (typeof cur.nextAt === "number" && now < cur.nextAt)) return cur;
        if (cur.k >= cur.last) return patch(cur, { playing: false, wait: null });
        var next = cur.k + 1;
        if (typeof action.loaded === "function" && !action.loaded(next)) {
          var key = waitKey(cur, next);
          return cur.wait === key ? cur : patch(cur, { wait: key });
        }
        var go = moveTo(cur, next, now, adjacentFor(cur, cur.k, next));
        return patch(cur, { k: go.k, trans: go.trans, wait: null, nextAt: now + stepFor(cur) });
      }
      case "loaded":
        return s.wait !== null && s.wait === action.m ? patch(s, { wait: null, nextAt: now }) : s;
      case "append": {
        var was = s.last;
        if (!isInt(was)) return s;
        var p = { last: was + 1 };
        if (action.follow) {
          // The old end is one step behind the new entry, so a follower at the old end eases there.
          var fm = moveTo(s, was + 1, now, s.k === was);
          p.k = fm.k; p.trans = fm.trans; p.wait = null;
        }
        return patch(s, p);
      }
      default:
        return s;
    }
  }

  // ---- the soil core: where each step lies on the time strip ----

  var CORE_TODAY_W = 30;                // the surface (today) at the right end, in px
  var CORE_UNITS = 16;                  // range-input units per px, so every step has a value of its own

  function clampTo(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // The strip of the soil core, `width` px wide, from a timeline. Left to right: on the public page a sealed band for the
  // older days (they are on the private page); on the private page the deep years, each month a layer whose width follows the
  // calendar (so each year is as wide as its days); the closed years as a sealed band with no entry; the recent days as thin
  // equal layers (a day with no close frame is bare; a run-in day says so); and today as the surface at the right end. A
  // step's place is its day's place: a deep day by its calendar date, a recent day's steps spread over its layer, today's
  // slots by the clock across the surface. `value(k)` is the step's value on a range input of `max` units laid over the
  // strip (strictly increasing with k, so each step has its own), and `kOfValue` and `kAt` give the nearest step to a
  // value or a point: a point in a band with no entry lands on the step at its nearer edge. `label(k)` names the step
  // ("4 March 2019, at the close", "today, 2:40 pm"). Never throws; a timeline without entries gives the bands and no step.
  function coreLayout(T, width, opts) {
    var Wd = isNum(width) && width > 0 ? width : 1, pub = isObject(opts) && opts.isPublic === true;
    var entries = isObject(T) && Array.isArray(T.entries) ? T.entries : [];
    var cal = isObject(T) && isObject(T.days) ? T.days : {};
    var deepDays = !pub && Array.isArray(cal.deep) ? cal.deep : [], histDays = Array.isArray(cal.recent) ? cal.recent : [];
    var lastE = entries.length ? entries[entries.length - 1] : null, todayDay = lastE && lastE.seg === "today" ? lastE.day : null;
    var recentDays = histDays.filter(function (d) { return d !== todayDay; });
    var deep = deepDays.length > 0, a;
    var todayW = Math.min(CORE_TODAY_W, Wd * 0.2);
    var closedW = deep || pub ? clampTo(Math.round(Wd * 0.05), 28, 64) : 0;
    var sealedW = pub ? clampTo(Math.round(Wd * 0.14), 44, 180) : 0;
    var rest = Math.max(0, Wd - todayW - closedW - sealedW);
    var recentW = recentDays.length ? (deep ? Math.min(rest, Math.max(120, Math.round(Wd * 0.15))) : rest) : 0;
    var deepW = deep ? rest - recentW : 0, x = 0;
    var out = { layers: [], days: [], closed: null, sealed: null, recent: null, today: null, years: [], ticks: [], max: Math.round(Wd * CORE_UNITS) };

    if (pub) { out.sealed = { x0: 0, x1: sealedW }; out.layers.push({ seg: "sealed", x0: 0, x1: sealedW }); x = sealedW; }
    // The deep years run from 1 January of the first explored year to the day before the closed years, whatever part of them
    // the record holds (the rest stays bare), so each explored year has its tick.
    var d0 = deep ? dayNumber(deepDays[0].slice(0, 4) + "-01-01") : 0;
    var dEnd = deep ? Math.max(dayNumber(deepDays[deepDays.length - 1]) + 1, dayNumber(CLOSED[0])) : 1, span = deep ? Math.max(1, dEnd - d0) : 1;
    var dayW = deepW / span, deepX0 = x;
    function xDeep(n) { return deepX0 + clampTo(n - d0, 0, span) * dayW; }
    if (deep) {
      var hasEntry = {};
      for (a = 0; a < entries.length; a++) if (entries[a].seg === "deep") hasEntry[entries[a].month] = true;
      var seen = {};
      for (a = 0; a < deepDays.length; a++) {
        var m = deepDays[a].slice(0, 7);
        if (seen[m]) continue;
        seen[m] = true;
        var y = +m.slice(0, 4), mo = +m.slice(5, 7), next = mo === 12 ? (y + 1) + "-01-01" : y + "-" + (mo < 9 ? "0" : "") + (mo + 1) + "-01";
        out.layers.push({ seg: hasEntry[m] ? "deep" : "bare", x0: xDeep(dayNumber(m + "-01")), x1: xDeep(dayNumber(next)), month: m });
      }
      for (var yr = +deepDays[0].slice(0, 4); dayNumber(yr + "-01-01") < dEnd; yr++) {
        var yx = xDeep(dayNumber(yr + "-01-01"));
        out.years.push({ x: yx, label: String(yr) }); out.ticks.push({ x: yx, major: true });
      }
      // One stratum per recorded day, at its calendar place; `week` (the day's week since 1970) lets the drawing lay down each
      // trading week as one band of soil, so the strata show where the record is and how it runs.
      out.days = [];
      for (a = 0; a < entries.length; a++) {
        if (entries[a].seg !== "deep") continue;
        var dn = dayNumber(entries[a].day);
        if (out.days.length && out.days[out.days.length - 1].n === dn) continue;
        out.days.push({ n: dn, x0: xDeep(dn), x1: xDeep(dn + 1), week: Math.floor((dn + 3) / 7), month: entries[a].month });
      }
      x = deepX0 + deepW;
    }
    if (closedW) { out.closed = { x0: x, x1: x + closedW }; x += closedW; }
    var lw = recentDays.length ? recentW / recentDays.length : 0, recentX0 = x, place = {};
    if (recentDays.length) out.recent = { x0: x, x1: x + recentW };
    for (a = 0; a < recentDays.length; a++) {
      place[recentDays[a]] = a;
      var close = isObject(T) && typeof T.at === "function" ? T.at(recentDays[a], "close") : -1;
      out.layers.push({ seg: close >= 0 ? "recent" : "bare", x0: x + a * lw, x1: x + (a + 1) * lw, runin: close >= 0 && entries[close].runin === 1, day: recentDays[a] });
    }
    x += recentW;
    if (x < Wd - todayW - 0.01) { out.layers.push({ seg: "bare", x0: x, x1: Wd - todayW }); x = Wd - todayW; }   // no record of the days before
    out.today = { x0: x, x1: Wd };
    out.layers.push({ seg: "today", x0: x, x1: Wd });

    // Each step's place, then its value: strictly increasing, so no two steps share one.
    // A public strip seals the older days: a timeline that still holds deep steps (an index given to a public page) has them
    // spread inside the sealed band, never on the closed years.
    var nDeep = 0, deepAt = 0;
    if (pub) for (var dk = 0; dk < entries.length; dk++) if (entries[dk].seg === "deep") nDeep++;
    var xs = new Array(entries.length), vals = new Array(entries.length), k = 0;
    while (k < entries.length) {
      var e = entries[k], k1 = k;
      while (k1 + 1 < entries.length && entries[k1 + 1].day === e.day && entries[k1 + 1].seg === e.seg) k1++;
      for (var q = k; q <= k1; q++) {
        var g = entries[q];
        if (g.seg === "deep") xs[q] = pub ? (deepAt++ + 0.5) / nDeep * sealedW : xDeep(dayNumber(g.day)) + dayW / 2;
        else if (g.seg === "today") {
          var mins = g.slot === "close" ? 390 : (+g.slot.slice(0, 2) * 60 + +g.slot.slice(3)) - 570;
          xs[q] = out.today.x0 + 3 + clampTo(mins / 390, 0, 1) * Math.max(0, out.today.x1 - out.today.x0 - 6);
        } else {
          var at = place[g.day] === undefined ? recentDays.length : place[g.day];
          xs[q] = recentX0 + (at + (q - k + 0.5) / (k1 - k + 1)) * lw;
        }
      }
      k = k1 + 1;
    }
    for (k = 0; k < entries.length; k++) {
      vals[k] = Math.round(xs[k] * CORE_UNITS);
      if (k > 0 && vals[k] <= vals[k - 1]) vals[k] = vals[k - 1] + 1;
    }
    if (vals.length && vals[vals.length - 1] > out.max) out.max = vals[vals.length - 1];
    function nearest(list, v) {
      if (!list.length || !isNum(v)) return null;
      var lo = 0, hi = list.length - 1;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (list[mid] < v) lo = mid + 1; else hi = mid; }
      return lo > 0 && v - list[lo - 1] <= list[lo] - v ? lo - 1 : lo;
    }
    function okK(kk) { return isInt(kk) && kk >= 0 && kk < entries.length; }
    out.xOf = function (kk) { return okK(kk) ? xs[kk] : NaN; };
    out.kAt = function (px) { return nearest(xs, px); };
    out.value = function (kk) { return okK(kk) ? vals[kk] : NaN; };
    out.kOfValue = function (v) { return nearest(vals, v); };
    out.label = function (kk) {
      if (!okK(kk)) return "";
      var ent = entries[kk], Wl = mmWorld();
      if (!Wl) return ent.day + ", " + ent.slot;
      return (ent.seg === "today" ? "today" : Wl.fmtDay(ent.day)) + ", " + (ent.slot === "close" ? "at " + Wl.fmtTime("close") : Wl.fmtTime(ent.slot));
    };
    return out;
  }

  // ===================================================================================================================
  // Part 2: the scene, the honesty rules, the sentence, the captions and the dials.
  // ===================================================================================================================

  var MAX_THREADS = 4000;               // settled echo rows drawn at most, unless one catalyst is isolated (D1)
  var DIED_AFTER = 5;                   // trading days after which a catalyst with nothing rung has died (D1)
  var ATTENTION_FROM = "2016-01-04";    // the first day of attention readings
  var HORIZONS = [1, 5, 20];            // the follow values lv1, lv5 and lv20 are measured this many trading days on
  var RINGS = 11;                       // dial rings: the last eleven closes, the innermost first
  var STALE_AFTER_MS = 96 * 3600 * 1000;
  var CLOSED_R = { small: 1.6, mid: 2.2, large: 2.8, mega: 3.4 };   // the universe's four size tiers, 0.6 apart
  var NO_READING_DAY = "no reading for this day";      // a dial's word when the shown day is missing (approved copy)
  var LINKS_NOTE = "Each cap is a stock seen from below; the pale threads are its links.";
  var TOO_SOON_INCOMPLETE = "Too soon to say what spread: the earlier days are not all in this record.";

  // MMWorld: the page's global, or the module beside this file in Node; null when neither is there (the words then say
  // there is no reading, and nothing throws).
  function mmWorld() {
    if (typeof MMWorld !== "undefined") return MMWorld;
    try { return typeof require === "function" ? require("./world.js") : null; } catch (e) { return null; }
  }

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function isCount(v) { return isInt(v) && v >= 0; }
  function layoutNodes(layout) { return isObject(layout) && Array.isArray(layout.nodes) ? layout.nodes : []; }
  function nodeAt(nodes, i) { return isObject(nodes[i]) ? nodes[i] : {}; }
  function tierName(t) { return t === "small" || t === "mid" || t === "large" || t === "mega" ? t : null; }
  function setOf(v) { return v instanceof Set ? v : new Set(Array.isArray(v) ? v : []); }
  function kindsOf(k) { return { news: !isObject(k) || k.news !== false, comove: !isObject(k) || k.comove !== false }; }
  function sheetName(s) { return s === "news" || s === "n" ? "news" : s === "comove" || s === "c" ? "comove" : null; }
  // A ticker-to-node list fits a frame when it has one place per ticker of the frame's file.
  function fitsBind(b, n) { return !!b && typeof b.length === "number" && b.length === n; }
  // A frame as decodeFrame returns it; anything else is treated as a frame not in hand.
  function isDecoded(f) {
    return isObject(f) && isInt(f.n) && isDay(f.day) && isSlot(f.slot) && Array.isArray(f.cats) && Array.isArray(f.echoes) &&
           !!f.state && f.state.length === f.n && !!f.zLevel && f.zLevel.length === f.n;
  }
  // A frame in which no stock has a reading is not a measured day: it counts as a frame not in hand.
  function isBlind(f) {
    for (var i = 0; i < f.n; i++) if (f.state[i] !== 0) return false;
    return true;
  }
  function inHand(f) { return isDecoded(f) && !isBlind(f); }

  // ---- binding the record to the map ----

  // Ticker index -> node index of the layout, or -1 for a stock the map has not placed.
  function bind(layout, tickers) {
    var list = Array.isArray(tickers) ? tickers : [], out = new Int32Array(list.length).fill(-1);
    var nodes = layoutNodes(layout), at = new Map(), a;
    for (a = 0; a < nodes.length; a++) { var t = nodeAt(nodes, a).t; if (typeof t === "string" && !at.has(t)) at.set(t, a); }
    for (a = 0; a < list.length; a++) if (at.has(list[a])) out[a] = at.get(list[a]);
    return out;
  }

  // The layout's links by node: byPair "a|b" -> [{sheet, r}], out a -> [b], inc b -> [a], and list, one entry per link
  // drawn ({a, b, sheet, r, cord}; a cord joins two colonies). Links naming a stock the map has not placed are left out.
  function edgeIndex(layout) {
    var nodes = layoutNodes(layout), edges = isObject(layout) && Array.isArray(layout.edges) ? layout.edges : [];
    var at = new Map(), byPair = new Map(), out = new Map(), inc = new Map(), list = [], a;
    for (a = 0; a < nodes.length; a++) { var t = nodeAt(nodes, a).t; if (typeof t === "string" && !at.has(t)) at.set(t, a); }
    for (a = 0; a < edges.length; a++) {
      var e = isObject(edges[a]) ? edges[a] : {}, x = at.get(e.a), y = at.get(e.b), sheet = sheetName(e.s);
      if (x === undefined || y === undefined || x === y || sheet === null) continue;
      var key = x + "|" + y, r = isInt(e.r) ? e.r : null;
      if (!byPair.has(key)) {
        byPair.set(key, []);
        if (!out.has(x)) out.set(x, []);
        if (!inc.has(y)) inc.set(y, []);
        out.get(x).push(y); inc.get(y).push(x);
      }
      byPair.get(key).push({ sheet: sheet, r: r });
      var sx = nodeAt(nodes, x).s, sy = nodeAt(nodes, y).s;
      list.push({ a: x, b: y, sheet: sheet, r: r, cord: typeof sx === "string" && typeof sy === "string" && sx !== sy });
    }
    return { byPair: byPair, out: out, inc: inc, list: list };
  }

  // ---- the echo rule (D1, on G1's look-back) ----

  // A cap's form (D2): open when loud or a catalyst, dropped when tired, closed when quiet, unknown with no reading.
  function capForm(stateCode, isCatalyst) {
    if (isCatalyst) return "open";
    return stateCode === 2 ? "open" : stateCode === 3 ? "dropped" : stateCode === 1 ? "closed" : "unknown";
  }

  // What an echo row of a source frame j trading days back shows on the entry. On a close entry a row has rung when
  // 0 < |ring| <= j and rings that day (a pulse) when |ring| == j; lvH counts when H <= j. A slot entry is read as of the
  // close before: a row has rung when 0 < |ring| < j, none rings, and lvH counts when H < j. Tone: the sign of the newest
  // countable follow level when it is not 0, else of the ring. Brightness: that level's size, at least 1 once rung.
  // As a small code, so the scene reads every row without making an object for it: 0 when the row is not drawn, else 1,
  // plus 2 for a pulse, 4 when against, and 8 at level 2. echoState spells the same code out.
  function echoCode(row, j, isPublic, atClose) {
    if (!isObject(row) || !isInt(row.ring) || row.ring === 0 || !isInt(j) || j < 0) return 0;
    var at = Math.abs(row.ring);
    if (!(atClose ? at <= j : at < j)) return 0;
    var lv = Array.isArray(row.lv) ? row.lv : [], level = null;
    for (var h = HORIZONS.length - 1; h >= 0 && level === null; h--) {
      if (atClose ? HORIZONS[h] <= j : HORIZONS[h] < j) level = lvLevel(lv[h], isPublic);
    }
    var sign = level !== null && level !== 0 ? level : row.ring;
    return 1 | (atClose && at === j ? 2 : 0) | (sign > 0 ? 0 : 4) | (level === 2 || level === -2 ? 8 : 0);
  }
  function echoState(row, j, isPublic, atClose) {
    var c = echoCode(row, j, isPublic, atClose);
    if (c === 0) return { drawn: false, pulse: false, tone: null, level: 0 };
    return { drawn: true, pulse: (c & 2) !== 0, tone: c & 4 ? "against" : "with", level: c & 8 ? 2 : 1 };
  }

  // ---- the scene ----

  // Node -> ticker index of a frame's file, from its ticker-to-node list: -1 for a node the file does not hold.
  function nodeTickers(b, n) {
    var out = new Int32Array(n).fill(-1);
    for (var t = 0; t < b.length; t++) { var k = b[t]; if (typeof k === "number" && k >= 0 && k < n && Math.floor(k) === k && out[k] < 0) out[k] = t; }
    return out;
  }
  function catalystsOf(f) {
    var m = new Map();
    for (var c = 0; c < f.cats.length; c++) if (!m.has(f.cats[c].i)) m.set(f.cats[c].i, f.cats[c]);
    return m;
  }

  // The pale threads for one setting of the kinds switch: made once per edge index and setting, frozen, and shared by
  // every scene drawn from that index (an edge index is never changed once made).
  var threadMemo = new WeakMap();
  function threadsFor(ix, kinds) {
    var key = (kinds.news ? 1 : 0) + (kinds.comove ? 2 : 0), memo = threadMemo.get(ix);
    if (memo && memo[key]) return memo[key];
    var out = [];
    for (var a = 0; a < ix.list.length; a++) {
      var ed = ix.list[a];
      if (kinds[ed.sheet]) out.push(Object.freeze({ a: ed.a, b: ed.b, sheet: ed.sheet, r: ed.r, cord: ed.cord }));
    }
    Object.freeze(out);
    if (!memo) { memo = []; threadMemo.set(ix, memo); }
    memo[key] = out;
    return out;
  }

  // Whether a cap changes between the step's two recorded looks (capAt at 0 and at 1 differ), without making either look.
  function capMoves(c) {
    return capRadiusOf(c.prevForm, c.prevCatalyst, c.prevLarge, c.prevZLevel, c.tier) !== capRadiusOf(c.form, c.catalyst, c.large, c.zLevel, c.tier) ||
           capColour(c.prevForm, c.prevCatalyst, c.tone, c.tier) !== capColour(c.form, c.catalyst, c.tone, c.tier);
  }

  // What one step draws. args: {layout, bind, ix, back: [{f, j, bind?}], complete, prev, prevBind?, ui, holdings, queued}.
  // back[0] is the shown entry (j = 0), then the closes of the look-back; a frame not in hand is null, and a frame in which
  // no stock has a reading counts as not in hand. An item may carry its own ticker-to-node list when its file lists other
  // tickers; a frame that fits no list is left out. Each frame's own public flag decides how its follow values read (a
  // caller's isPublic is ignored). Returns null when the shown frame itself is not in hand. The counts are the record's
  // (before the kinds switch, isolation, the cap on threads or placement); the marks are what is drawn. Each source carries
  // counts only (rows is how many rows it has); its rows stay in its frame, out of the scene's own fields (rowRefs).
  function scene(args) {
    var A = isObject(args) ? args : {};
    var back = Array.isArray(A.back) ? A.back : [];
    var top = isObject(back[0]) ? back[0] : null, f0 = top && inHand(top.f) ? top.f : null;
    var bind0 = top && top.bind ? top.bind : A.bind;
    if (!f0 || !fitsBind(bind0, f0.n)) return null;
    var layout = A.layout, nodes = layoutNodes(layout), N = nodes.length;
    var ix = isObject(A.ix) && Array.isArray(A.ix.list) && A.ix.out instanceof Map && A.ix.byPair instanceof Map ? A.ix : edgeIndex(layout);
    var ui = isObject(A.ui) ? A.ui : {}, kinds = kindsOf(ui.kinds);
    var cat = isObject(ui.cat) && isInt(ui.cat.node) && typeof ui.cat.day === "string" ? ui.cat : null;
    var atClose = f0.slot === "close";                                     // each frame says itself whether it is public
    var holdings = setOf(A.holdings), queued = setOf(A.queued);
    var month = isObject(layout) && typeof layout.month === "string" ? layout.month : null;
    // Whole only when the time model says the look-back is whole and every frame of it is in hand and readable.
    var incomplete = A.complete !== true;
    var sources = [], refs = [], pulses = [], links = [], stubs = [], linked = new Set(), isolated = null, spreadOffMap = 0, a, n, r;
    // A ticker's place on the map: an integer from 0 to N - 1, or -1 (not placed). Anything else a list holds (a huge or
    // broken index, a string) is not a place: its rows cannot be drawn, and nothing is ever sized by it.
    function nodeOf(v) { return typeof v === "number" && v >= 0 && v < N && Math.floor(v) === v ? v : -1; }
    if (cat) linked.add(cat.node);
    // Settled rows are gathered as numbers; only those drawn become objects (the cap on threads).
    var sSrc = [], sVia = [], sDst = [], sCode = [], sHops = [];
    // Each cap's tint: the row that rang latest (age), then the larger level, then the smaller source. Tone 0 is none.
    var tAge = new Int32Array(N), tLevel = new Int8Array(N), tSrc = new Int32Array(N), tTone = new Int8Array(N);

    function sheetOn(list) {
      for (var q = 0; list && q < list.length; q++) if (kinds[list[q].sheet]) return true;
      return false;
    }
    function tintCap(node, age, level, src, against) {
      if (!(node < N)) return;
      if (tTone[node] === 0 || age < tAge[node] || (age === tAge[node] && (level > tLevel[node] || (level === tLevel[node] && src < tSrc[node])))) {
        tAge[node] = age; tLevel[node] = level; tSrc[node] = src; tTone[node] = against ? 2 : 1;
      }
    }
    function readSource(f, j, B, ti, kind, c, rows) {
      var src = nodeOf(B[ti]), list = rows || [], isPublic = f.isPublic === true, drawable = false, q;
      var s = { src: src, ti: ti, day: f.day, j: j, kind: kind, zLevel: c ? c.zLevel : UNKNOWN_LEVEL, large: c ? c.large : false,
                withN: 0, againstN: 0, pulseN: 0, oneLink: 0, offMap: 0, rows: list.length, died: false, soon: false, isolated: false };
      s.isolated = !!cat && src >= 0 && src === cat.node && f.day === cat.day;
      if (s.isolated) { isolated = s; linked.add(src); }
      var shown = !cat || s.isolated;
      for (q = 0; q < list.length; q++) {
        var row = list[q], code = echoCode(row, j, isPublic, atClose);
        var dst = nodeOf(B[row.dst]), via = row.via >= 0 ? nodeOf(B[row.via]) : -1;
        if (row.hops === 1) s.oneLink++;
        if (code !== 0) {
          if (code & 4) s.againstN++; else s.withN++;
          if (src < 0 || dst < 0) s.offMap++;                                 // rung at, or from, a stock the map has not placed
          if (code & 2) { s.pulseN++; if (src >= 0 && dst >= 0) drawable = true; }
        }
        if (s.isolated) { if (dst >= 0) linked.add(dst); if (via >= 0) linked.add(via); }
        if (!shown || src < 0 || dst < 0 || !kinds[row.sheet]) continue;
        if (code !== 0) {
          if (code & 2) pulses.push({ src: src, via: via, dst: dst, tone: code & 4 ? "against" : "with", level: code & 8 ? 2 : 1 });
          else { sSrc.push(src); sVia.push(via); sDst.push(dst); sCode.push(code); sHops.push(row.hops === 2 ? 2 : 1); }
          tintCap(dst, j - Math.abs(row.ring), code & 8 ? 2 : 1, src, (code & 4) !== 0);
        } else if (j === 0 || s.isolated) {
          links.push({ src: src, via: via, dst: dst, hops: row.hops });       // recorded rows, not moved yet: plain threads
        }
      }
      // Died: a close at least DIED_AFTER days on, a one-link row, and nothing rung. Too soon: nothing rung yet, with
      // rows still open (or the catalyst's own day).
      var rung = s.withN + s.againstN, measured = atClose && j >= DIED_AFTER;
      s.died = measured && rung === 0 && s.oneLink > 0;
      s.soon = rung === 0 && !(measured && list.length > 0) && (list.length > 0 || j === 0);
      if (s.pulseN > 0 && !drawable) spreadOffMap++;                          // spreading, with no ring the map can draw
      if (s.died && shown && src >= 0) {
        for (q = 0; q < list.length; q++) if (list[q].hops === 1 && nodeOf(B[list[q].dst]) >= 0 && kinds[list[q].sheet]) stubs.push({ src: src, dst: B[list[q].dst] });
      }
      // A slot frame carries no echo rows (G5): its catalysts draw their links from the layout, when it is that month's.
      if (rows === null && j === 0 && f.slot !== "close" && shown && src >= 0 && month === f.day.slice(0, 7)) {
        var outs = ix.out.get(src) || [];
        for (q = 0; q < outs.length; q++) {
          if (!sheetOn(ix.byPair.get(src + "|" + outs[q]))) continue;
          links.push({ src: src, via: -1, dst: outs[q], hops: 1 });
          if (s.isolated) linked.add(outs[q]);
        }
      }
      sources.push(s);
      refs.push({ rows: list, bind: B, isPublic: isPublic });
    }
    function readFrame(f, j, B) {
      var cats = catalystsOf(f), withRows = new Set();
      for (var e = 0; e < f.echoes.length; e++) {
        var en = f.echoes[e];
        if (en.type !== "catalyst") continue;                                 // onsets are never drawn
        withRows.add(en.src);
        readSource(f, j, B, en.src, en.kind, cats.get(en.src), en.rows);
      }
      cats.forEach(function (c, ti) { if (!withRows.has(ti)) readSource(f, j, B, ti, c.kind, c, null); });
    }

    for (a = 0; a < back.length; a++) {
      var item = back[a];
      if (!isObject(item) || !inHand(item.f) || !isInt(item.j) || item.j < 0 || item.j > LOOKBACK) { incomplete = true; continue; }
      var B = a === 0 ? bind0 : item.bind || A.bind;
      if (!fitsBind(B, item.f.n)) { incomplete = true; continue; }          // indexed to another ticker list: never misplaced
      readFrame(item.f, item.j, B);
    }

    // The cap on threads: one-link rows first, then the brighter, then by source, in the order read (a stable counting
    // sort over those three keys); only the first MAX_THREADS are placed, unless one catalyst is isolated.
    var total = sSrc.length, keep = !cat && total > MAX_THREADS ? MAX_THREADS : total, echoes = new Array(keep);
    if (total > 0) {
      var width = N, start = new Int32Array(4 * width + 1), keys = new Int32Array(total);      // every source here is a node below N
      for (r = 0; r < total; r++) { var key = ((sHops[r] - 1) * 2 + (sCode[r] & 8 ? 0 : 1)) * width + sSrc[r]; keys[r] = key; start[key + 1]++; }
      for (r = 1; r < start.length; r++) start[r] += start[r - 1];
      for (r = 0; r < total; r++) {
        var at = start[keys[r]]++;
        if (at < keep) echoes[at] = { src: sSrc[r], via: sVia[r], dst: sDst[r], tone: sCode[r] & 4 ? "against" : "with", level: sCode[r] & 8 ? 2 : 1, hops: sHops[r] };
      }
    }

    var tiOf = nodeTickers(bind0, N), cats0 = catalystsOf(f0);
    var prev = inHand(A.prev) ? A.prev : null, prevBind = A.prevBind || bind0;
    if (prev && !fitsBind(prevBind, prev.n)) prev = null;                    // nothing to ease from
    var prevTi = prev ? nodeTickers(prevBind, N) : null, catsP = prev ? catalystsOf(prev) : null;
    var caps = new Array(N), still = pulses.length === 0;
    for (n = 0; n < N; n++) {
      var node = nodeAt(nodes, n), ti = tiOf[n], c0 = ti >= 0 ? cats0.get(ti) : undefined;
      var form = ti >= 0 ? capForm(f0.state[ti], !!c0) : "unknown", zl = ti >= 0 ? f0.zLevel[ti] : UNKNOWN_LEVEL;
      var pForm = form, pZ = zl, pCat = !!c0, pLarge = c0 ? c0.large : false;
      if (prev) {
        var pti = prevTi[n], pc = pti >= 0 ? catsP.get(pti) : undefined;
        pForm = pti >= 0 ? capForm(prev.state[pti], !!pc) : "unknown";
        pZ = pti >= 0 ? prev.zLevel[pti] : UNKNOWN_LEVEL; pCat = !!pc; pLarge = pc ? pc.large : false;
      }
      var tone = tTone[n] === 0 ? null : tTone[n] === 2 ? "against" : "with", held = holdings.has(node.t), q = queued.has(node.t);
      caps[n] = { node: n, form: form, prevForm: pForm, tone: tone, level: tone === null ? 0 : tLevel[n], held: held, queued: q,
                  catalyst: !!c0, large: c0 ? c0.large : false, dim: (!!cat && !linked.has(n)) || (ui.mine === true && !held && !q),
                  zLevel: zl, tier: tierName(node.tier), prevZLevel: pZ, prevCatalyst: pCat, prevLarge: pLarge };
      if (still && capMoves(caps[n])) still = false;
    }

    // The counts are the record's. offMap: how many of the catalysts the sentence counts (the shown day's, and the earlier
    // ones spreading) the map cannot show: on a stock it has not placed, or spreading only at such stocks.
    var counts = { hits: f0.cats.length, spreading: 0, died: 0, soon: 0, offMap: 0 };
    cats0.forEach(function (c, ti) { if (nodeOf(bind0[ti]) < 0) counts.offMap++; });
    for (r = 0; r < sources.length; r++) {
      if (sources[r].pulseN > 0) counts.spreading++;
      if (sources[r].died) counts.died++;
      if (sources[r].soon) counts.soon++;
    }
    counts.offMap += spreadOffMap;
    var out = { day: f0.day, slot: f0.slot, runin: f0.runin, caps: caps, threads: threadsFor(ix, kinds), links: links, echoes: echoes, pulses: pulses,
                stubs: stubs, still: still, incomplete: incomplete, atClose: atClose, counts: counts, sources: sources, isolated: isolated };
    // Each source's recorded rows, for the few a caption words (out of the scene's own fields, which hold counts only).
    Object.defineProperty(out, "rowRefs", { value: refs });
    // Every settled row, before the cap on threads, so the trail of a followed catalyst is drawn whole (trailRows).
    Object.defineProperty(out, "settled", { value: { src: sSrc, via: sVia, dst: sDst, code: sCode, hops: sHops } });
    return out;
  }

  // The settled rows of the followed catalysts (`nodes`, a Set of their nodes), every one of them: the cap on threads
  // (MAX_THREADS) is for an overview that would draw every row, and the overview draws only followed rows (contracts ruling
  // 31). In the scene's own order (one-link rows first, then the brighter, then by source). [] for anything else.
  function trailRows(scene, nodes) {
    var S = isObject(scene) && isObject(scene.settled) ? scene.settled : null, out = [];
    if (!S || !(nodes instanceof Set) || nodes.size === 0) return out;
    for (var pass = 0; pass < 4; pass++) {
      for (var r = 0; r < S.src.length; r++) {
        var code = S.code[r], key = (S.hops[r] - 1) * 2 + (code & 8 ? 0 : 1);
        if (key !== pass || !nodes.has(S.src[r])) continue;
        out.push({ src: S.src[r], via: S.via[r], dst: S.dst[r], tone: code & 4 ? "against" : "with", level: code & 8 ? 2 : 1, hops: S.hops[r] });
      }
    }
    return out;
  }

  // The catalysts whose pulses grow in full on a step: the captioned ones (`captioned`, a Set of their nodes), and when none of
  // them has a pulse the map draws, the strongest that has one (the most rows rung, then the newest, then the smaller node),
  // so one cascade always travels. An isolated scene grows all its pulses (MapDraw); a scene with no pulse adds nothing.
  function followedOf(scene, captioned) {
    var out = new Set(captioned instanceof Set ? captioned : []);
    var sc = isObject(scene) ? scene : null, pulses = sc && Array.isArray(sc.pulses) ? sc.pulses : [];
    if (!sc || sc.isolated || !pulses.length) return out;
    var pulsing = new Set(pulses.map(function (p) { return p.src; })), best = null;
    if (Array.from(out).some(function (i) { return pulsing.has(i); })) return out;
    (Array.isArray(sc.sources) ? sc.sources : []).forEach(function (s) {
      if (!isObject(s) || !pulsing.has(s.src)) return;
      var r = s.withN + s.againstN, b = best ? best.withN + best.againstN : -1;
      if (!best || r > b || (r === b && (s.j < best.j || (s.j === best.j && s.src < best.src)))) best = s;
    });
    if (best) out.add(best.src);
    return out;
  }

  // ---- caps between two recorded states (D2) ----

  function capRadiusOf(form, catalyst, large, zLevel, tier) {
    var r;
    if (catalyst) r = large ? 11 : 9.6;
    else if (form === "open") r = 5.6 + 0.9 * (isKnownLevel(zLevel) ? Math.abs(zLevel) : 0);
    else if (form === "dropped") r = 2.5;
    else if (form === "closed") r = CLOSED_R[tier] || CLOSED_R.mid;
    else r = 2.0;
    return Math.round(r * 100) / 100;
  }
  // The radius of a cap's recorded look (D2), rounded to 2 decimals: a catalyst by its size, an open cap by its level, a
  // dropped cap fixed, a closed cap by its size tier, and a stock with no reading as the small hollow mark. capAt eases
  // between two of these; the renderer reads every radius here.
  function capRadius(cap) {
    var c = isObject(cap) ? cap : {};
    return capRadiusOf(c.form, !!c.catalyst, !!c.large, c.zLevel, tierName(c.tier));
  }
  // The colour key: catalyst, with, against, open, dropped, unknown, or quiet-<tier> (one tint per size tier).
  function capColour(form, catalyst, tone, tier) {
    if (catalyst) return "catalyst";
    if (tone === "with" || tone === "against") return tone;
    if (form === "closed") return "quiet-" + (tier || "mid");
    return form === "open" || form === "dropped" ? form : "unknown";
  }
  // A cap at progress u of a step: the radius eases linearly from the recorded previous look to the recorded present one,
  // and the colour switches halfway. With no change there is no motion.
  function capAt(cap, u) {
    var c = isObject(cap) ? cap : {}, t = isNum(u) ? Math.min(1, Math.max(0, u)) : 1, tier = tierName(c.tier);
    function was(key, prevKey) { return c[prevKey] === undefined ? c[key] : c[prevKey]; }
    var r0 = capRadius({ form: was("form", "prevForm"), catalyst: was("catalyst", "prevCatalyst"), large: was("large", "prevLarge"),
                         zLevel: was("zLevel", "prevZLevel"), tier: tier });
    var r1 = capRadius(c);
    var colour = t >= 0.5 ? capColour(c.form, !!c.catalyst, c.tone, tier)
                          : capColour(was("form", "prevForm"), !!was("catalyst", "prevCatalyst"), was("tone", "prevTone"), tier);
    return { r: r0 + (r1 - r0) * t, colour: colour };
  }

  // ---- the curve of a thread ----

  // FNV-1a over the character codes of a text: the same text, the same number, on every machine.
  function hashText(s) {
    var h = 2166136261;
    for (var a = 0; a < s.length; a++) h = Math.imul(h ^ s.charCodeAt(a), 16777619) >>> 0;
    return h >>> 0;
  }
  // The bend of the thread between two stocks: the offsets of its two control points, each a share of the thread's length
  // (the first at most 0.35 either way, the second 0.385), from a hash of the two tickers. A thread keeps its shape from frame to frame, and nothing
  // about it is random. The pair is read in name order, so bend(b, a) is the same curve walked from the other end.
  function bend(a, b) {
    var x = String(a), y = String(b), flip = y < x, h = hashText(flip ? y + "\u0000" + x : x + "\u0000" + y);
    var u = (h & 0xffff) / 65535 - 0.5, v = (h >>> 16) / 65535;
    var o0 = Math.round(u * 0.7 * 1e4) / 1e4, o1 = Math.round(-o0 * (0.2 + 0.9 * v) * 1e4) / 1e4;
    return flip ? [0 - o1, 0 - o0] : [o0 + 0, o1 + 0];
  }

  // ---- staleness: the clock decides, never the file ----

  var nyFormat = null;
  function nyClock(ms) {
    if (nyFormat === null) {
      nyFormat = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", weekday: "short", year: "numeric",
                                                    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
    var p = {}, parts = nyFormat.formatToParts(new Date(ms));
    for (var a = 0; a < parts.length; a++) p[parts[a].type] = parts[a].value;
    return { day: p.year + "-" + p.month + "-" + p.day, weekday: ["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(p.weekday) >= 0,
             minutes: (+p.hour % 24) * 60 + +p.minute };
  }

  // Stale when the newest reading is more than stale_minutes old during a session (a weekday in New York from 09:30 +
  // stale_minutes to 16:00 + stale_minutes), or more than 96 hours old at any time. A time that cannot be read is stale.
  function staleness(state, nowMs) {
    var s = isObject(state) ? state : {};
    var m = isNum(s.stale_minutes) && s.stale_minutes > 0 ? s.stale_minutes : 30;
    var asof = typeof s.asof === "string" ? Date.parse(s.asof) : NaN;
    if (!isNum(nowMs) || isNaN(asof)) return { stale: true };
    var age = nowMs - asof, now = nyClock(nowMs);
    var inSession = now.weekday && now.minutes >= 570 + m && now.minutes <= 960 + m;
    if (!((age > m * 60000 && inSession) || age > STALE_AFTER_MS)) return { stale: false };
    var then = nyClock(asof);
    return then.day === now.day ? { stale: true, minutesOld: Math.max(0, Math.round(age / 60000)) }
                                : { stale: true, daysOld: dayNumber(now.day) - dayNumber(then.day) };
  }

  // ---- the plain sentence ----

  // subShort is what a phone shows: the sub's first sentence, then any of `keep` the sub holds (the off-map line and the run-in
  // line, ruling 26), which are never cut.
  function said(head, sub, keep) {
    var short = [sub[0]].concat((keep || []).filter(function (k) { return k && k !== sub[0] && sub.indexOf(k) >= 0; }));
    return { head: head.join(" "), headShort: head[0], sub: sub.join(" "), subShort: short.join(" ") };
  }

  // The head, as a list of sentences. A null ("nothing", "a quiet day") only on a close whose look-back is whole.
  function headWords(Wd, n, s, atClose, complete, today, time) {
    function cats(k, cap) { return Wd.numberWord(k, cap) + " " + Wd.plural(k, "catalyst", "catalysts"); }
    // The ripples still travelling on the shown day all come from earlier catalysts (an echo rings one day on at the soonest).
    function ripples(k, atLeast) { return "Ripples from " + (atLeast ? "at least " : "") + Wd.numberWord(k) + " earlier " + Wd.plural(k, "catalyst", "catalysts"); }
    if (!atClose) {
      if (today) return [n ? cats(n, true) + " so far today." : "No catalysts yet today.", "Too soon to say what is spreading."];
      return [(n ? cats(n, true) : "No catalysts") + " by " + time + " that day.", "It was too soon then to say what was spreading."];
    }
    var day = today ? "today" : "that day", verb = today ? " are still spreading." : " were still spreading.";
    if (complete) {
      if (!n && !s) return ["A quiet day.", "Nothing hit and nothing spread."];
      var first = n ? cats(n, true) + " " + day + "." : today ? "No new catalysts." : "No new catalysts that day.";
      return [first, s ? ripples(s, false) + verb : today ? "Nothing is spreading." : "Nothing spread."];
    }
    return [(n ? cats(n, true) : "No catalysts") + " " + day + ".", s ? ripples(s, true) + verb : TOO_SOON_INCOMPLETE];
  }

  function staleWords(Wd, when) {
    var st = when.stale;
    if (isCount(st.minutesOld)) return "The newest reading is from " + Wd.fmtTime(when.slot) + ", " + Wd.numberWord(st.minutesOld) + " " + Wd.plural(st.minutesOld, "minute", "minutes") + " ago.";
    if (isCount(st.daysOld)) return "The newest reading is from " + Wd.fmtDay(when.day) + ", " + Wd.numberWord(st.daysOld) + " " + Wd.plural(st.daysOld, "day", "days") + " ago.";
    return "The time of the newest reading cannot be read.";
  }

  // args: {scene, when: {seg, day, slot, runin, stale, layoutMonth, liveNext}, isolated: the isolated catalyst's name}. The caller
  // passes `stale` (from staleness) only with the newest entry, and `liveNext` (from liveNextOf) only with the newest entry
  // when the state says no live day exists yet. -> {head, headShort, sub, subShort}.
  var LIVE_NEXT = "Live recording starts on the next trading day.";
  // True when the state is readable and says plainly that no day is live yet (first_live_day null): the run-in days are
  // all there is, and live recording starts on the next trading day.
  function liveNextOf(state) { return isObject(state) && state.first_live_day === null; }
  function sentence(args) {
    var A = isObject(args) ? args : {}, sc = isObject(A.scene) ? A.scene : null, when = isObject(A.when) ? A.when : null;
    var Wd = mmWorld();
    if (!Wd || !when || !isDay(when.day) || !isSlot(when.slot)) return said(["No reading yet."], ["The map fills in after the recorder's first close."]);
    // A scene of another day or slot is never worded as this one's.
    var counts = sc && isObject(sc.counts) && sc.day === when.day && sc.slot === when.slot ? sc.counts : null;
    if (!counts || !isCount(counts.hits) || !isCount(counts.spreading)) {
      return said(["No reading for this day."], ["The map has no readable record of " + Wd.fmtDay(when.day) + "."]);
    }
    var today = when.seg === "today", slot = when.slot !== "close", time = Wd.fmtTime(when.slot);
    var atClose = !slot && sc.atClose !== false, complete = sc.incomplete === false;
    var head = headWords(Wd, counts.hits, counts.spreading, atClose, complete, today, time);
    var stale = isObject(when.stale) && when.stale.stale === true ? staleWords(Wd, when) : null;
    var sub = [];
    if (typeof A.isolated === "string" && A.isolated !== "") {
      if (stale) sub.push(stale);
      sub.push("Only the ripples of the catalyst in " + A.isolated + " and its cascade.", "Tap the ground to see everything.");
      return said(head, sub);
    }
    if (today && slot) sub.push("The ripple map at " + time + ".", "Today's ripples are counted at the close.", LINKS_NOTE);
    else if (today) sub.push("The ripple map at the close, " + Wd.fmtDay(when.day) + ".", LINKS_NOTE);
    else if (slot) sub.push("The ripple map on " + Wd.fmtDay(when.day) + ", at " + time + ".", "That day's ripples are counted at the close.");
    else sub.push("The ripple map on " + Wd.fmtDay(when.day) + ", at the close.");
    if (stale) sub[0] = stale;
    // Of the catalysts the head counts, those the map cannot show (ruling 6); said right after the first sentence.
    var offMap = null, runin = null;
    if (isCount(counts.offMap) && counts.offMap > 0) {
      offMap = counts.offMap === 1 ? "One of the catalysts counted here cannot be drawn: it is on, or reached only, stocks the map has not placed yet."
                                   : Wd.numberWord(counts.offMap, true) + " of the catalysts counted here cannot be drawn: they are on, or reached only, stocks the map has not placed yet.";
      sub.splice(1, 0, offMap);
    }
    if (when.day < ATTENTION_FROM) sub.push("Attention readings start in 2016.");
    if (typeof when.layoutMonth === "string" && when.day.slice(0, 7) !== when.layoutMonth) {
      sub.push("The pale threads are this month's links; the coloured threads are that day's record.");
    }
    var liveNext = null;
    if (when.runin === 1 || when.runin === true) {
      runin = "A run-in day: shown, never counted."; sub.push(runin);
      // The newest step of a record with no live day yet (the map right after Go-live B): say when counting starts.
      if (when.liveNext === true) { liveNext = LIVE_NEXT; sub.push(liveNext); }
    }
    return said(head, sub, [offMap, runin, liveNext]);
  }

  // ---- captions ----

  var EVENT_TIME = /^\d{1,2}:\d{2}$/;

  // Plate captions for at most `max` catalysts: the isolated one, the one with the most rung rows, the died one with the
  // most one-link rows, the shown day's largest, then more spreading ones. Each states the catalyst's own record; a
  // stock is named only when the account holds it. args: {scene, layout, sectors, holdings, events, max, today}.
  function captions(args) {
    var A = isObject(args) ? args : {}, sc = isObject(A.scene) ? A.scene : null;
    var Wd = mmWorld();
    if (!Wd || !sc || !Array.isArray(sc.sources)) return [];
    var nodes = layoutNodes(A.layout), held = setOf(A.holdings);
    var sectors = Array.isArray(A.sectors) ? A.sectors : [], events = Array.isArray(A.events) ? A.events : [];
    var max = isCount(A.max) ? A.max : 3;
    function sectorOf(ti, node) {
      var s = node >= 0 ? nodeAt(nodes, node).s : undefined;
      if (typeof s !== "string" || s === "") s = sectors[ti];
      return typeof s === "string" && s !== "" ? s : null;
    }
    function rung(s) { return s.withN + s.againstN; }
    function size(s) { return isKnownLevel(s.zLevel) ? Math.abs(s.zLevel) : -1; }
    function newer(x, y) { return x.j < y.j || (x.j === y.j && x.src < y.src); }
    function moreRung(x, y) { return rung(x) > rung(y) || (rung(x) === rung(y) && newer(x, y)); }
    function best(list, before) { var b = null; for (var i = 0; i < list.length; i++) if (!b || before(list[i], b)) b = list[i]; return b; }
    var refs = Array.isArray(sc.rowRefs) ? sc.rowRefs : [];
    var pool = sc.sources.filter(function (s) {
      return isObject(s) && isCount(s.rows) && s.src >= 0 && s.src < nodes.length && (s.rows > 0 || s.j === 0);
    });
    // The rows a source's echo rang at by the shown entry, read again from its record: [{ti, dst}].
    function rungRows(s) {
      var ref = refs[sc.sources.indexOf(s)], out = [];
      if (!isObject(ref) || !Array.isArray(ref.rows)) return out;
      for (var q = 0; q < ref.rows.length; q++) {
        var row = ref.rows[q];
        if (echoCode(row, s.j, ref.isPublic, sc.atClose === true) !== 0) out.push({ ti: row.dst, dst: ref.bind[row.dst] });
      }
      return out;
    }
    var picked = [], used = new Set();
    function take(s) {
      if (!s || picked.length >= max || used.has(s.src + "|" + s.day)) return;
      used.add(s.src + "|" + s.day); picked.push(s);
    }
    // The strongest catalyst whose pulse the map draws on this step comes first after an isolated one: the map grows only the
    // captioned catalysts' pulses in full, so the one that travels is always named (a phone shows the first that fits).
    var drawn = new Set((Array.isArray(sc.pulses) ? sc.pulses : []).map(function (p) { return p.src; }));
    take(best(pool.filter(function (s) { return s.isolated === true; }), function () { return false; }));
    take(best(pool.filter(function (s) { return drawn.has(s.src) && s.pulseN > 0; }), moreRung));
    take(best(pool.filter(function (s) { return rung(s) > 0; }), moreRung));
    take(best(pool.filter(function (s) { return s.died === true; }), function (x, y) { return x.oneLink > y.oneLink || (x.oneLink === y.oneLink && newer(x, y)); }));
    take(best(pool.filter(function (s) { return s.j === 0; }), function (x, y) {
      return (x.large && !y.large) || (x.large === y.large && (size(x) > size(y) || (size(x) === size(y) && x.src < y.src)));
    }));
    pool.filter(function (s) { return s.pulseN > 0; }).sort(function (x, y) { return moreRung(x, y) ? -1 : moreRung(y, x) ? 1 : 0; }).forEach(take);

    function eventTime(s) {
      var t = nodeAt(nodes, s.src).t;
      for (var e = 0; e < events.length; e++) {
        var ev = events[e];
        if (isObject(ev) && ev.t === t && ev.day === s.day && typeof ev.time === "string" && EVENT_TIME.test(ev.time)) return Wd.fmtTime(ev.time);
      }
      return null;
    }
    // "Reached" counts every linked stock the echo rang at, with or against; those that moved against are among them, so
    // the second number is never the larger. The holdings and the crossing are read over the same stocks.
    function bodyOf(s) {
      var w = s.withN, against = s.againstN, reached = w + against;
      if (w > 0) {
        var home = sectorOf(s.ti, s.src), holds = [], bySector = new Map(), rung = rungRows(s);
        for (var q = 0; q < rung.length; q++) {
          var row = rung[q];
          var t = row.dst >= 0 ? nodeAt(nodes, row.dst).t : undefined;
          if (typeof t === "string" && held.has(t) && holds.indexOf(t) < 0) holds.push(t);
          var sec = sectorOf(row.ti, row.dst);
          if (sec && home && sec !== home) bySector.set(sec, (bySector.get(sec) || 0) + 1);
        }
        var text = "The echo has reached " + Wd.numberWord(reached) + " " + Wd.plural(reached, "linked stock", "linked stocks");
        if (holds.length === 1) text += ", the holding " + holds[0] + (reached > 1 ? " among them" : "");
        else if (holds.length > 1) text += ", " + Wd.numberWord(holds.length) + " holdings among them";
        var cross = null, most = 0;
        bySector.forEach(function (k, name) { if (k > most || (k === most && name < cross)) { cross = name; most = k; } });
        if (cross) text += ", and crossed into " + cross;
        text += ".";
        if (against > 0) text += " " + Wd.numberWord(against, true) + " moved against it.";
        return text;
      }
      if (against > 0) return Wd.numberWord(against, true) + " " + Wd.plural(against, "linked stock", "linked stocks") + " moved against it, none with it.";
      // Nothing rung: final only once all twenty days are in and the look-back is whole (ruling 7).
      if (sc.atClose === true && s.j >= DIED_AFTER && s.rows > 0) {
        return s.j >= LOOKBACK && sc.incomplete === false ? "Nothing passed along. None of its linked stocks moved more than usual." : "Nothing passed along so far.";
      }
      return "Too soon to say.";
    }
    return picked.map(function (s) {
      var node = nodeAt(nodes, s.src), sector = sectorOf(s.ti, s.src);
      var at = s.j === 0 && typeof A.today === "string" && s.day === A.today ? eventTime(s) || "today" : Wd.fmtDay(s.day);
      return { src: s.src, day: s.day, j: s.j, head: "Catalyst" + (sector ? " in " + sector : "") + ", " + at + ".", body: bodyOf(s), x: node.x, y: node.y };
    });
  }

  // Caption boxes beside their catalysts, inside the field, clear of the avoided areas and of each other. Sides are tried
  // near first, then further out; an item with no room gets null. items: [{x, y (the catalyst), w, h}].
  var SIDES = ["NE", "SE", "NW", "SW", "E", "W", "N", "S"], GAPS = [12, 36, 72, 120, 180];
  function isRect(r) { return isObject(r) && isNum(r.x) && isNum(r.y) && isNum(r.w) && isNum(r.h) && r.w >= 0 && r.h >= 0; }
  function overlaps(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
  function boxAt(it, side, gap) {
    var x = side.indexOf("E") >= 0 ? it.x + gap : side.indexOf("W") >= 0 ? it.x - gap - it.w : it.x - it.w / 2;
    var y = side.indexOf("N") >= 0 ? it.y - gap - it.h : side.indexOf("S") >= 0 ? it.y + gap : it.y - it.h / 2;
    return { x: x, y: y, w: it.w, h: it.h };
  }
  function placeCaptions(items, avoid, field) {
    var F = isRect(field) ? field : null, taken = [], out = [], list = Array.isArray(items) ? items : [], a;
    if (Array.isArray(avoid)) for (a = 0; a < avoid.length; a++) if (isRect(avoid[a])) taken.push(avoid[a]);
    for (a = 0; a < list.length; a++) {
      var it = list[a], spot = null;
      for (var g = 0; F && isRect(it) && !spot && g < GAPS.length; g++) {
        for (var s = 0; !spot && s < SIDES.length; s++) {
          var b = boxAt(it, SIDES[s], GAPS[g]);
          if (b.x < F.x || b.y < F.y || b.x + b.w > F.x + F.w || b.y + b.h > F.y + F.h) continue;
          var clear = true;
          for (var k = 0; clear && k < taken.length; k++) if (overlaps(b, taken[k])) clear = false;
          if (clear) { spot = { x: b.x, y: b.y, side: SIDES[s] }; taken.push(b); }
        }
      }
      out.push(spot);
    }
    return out;
  }

  // ---- the dials ----

  var FRAC_AT = [0.05, 0.25, 0.5, 0.75, 0.95];
  function isScaleRow(row) {
    if (!Array.isArray(row) || row.length !== 5) return false;
    for (var a = 0; a < 5; a++) if (!isNum(row[a]) || (a > 0 && row[a] < row[a - 1])) return false;
    return true;
  }
  // The place of a reading on its dial's arc: its own history's p05..p95 map piecewise-linearly onto 0.05..0.95,
  // clipped to 0.02..0.98. No history to place it on, no place: null (hot spots too, never a fixed level; ruling 22).
  function dialFrac(value, row) {
    if (!isNum(value) || !isScaleRow(row)) return null;
    var f, a;
    if (value <= row[0]) f = row[1] > row[0] ? FRAC_AT[0] - (row[0] - value) * (FRAC_AT[1] - FRAC_AT[0]) / (row[1] - row[0]) : value < row[0] ? 0 : FRAC_AT[0];
    else if (value >= row[4]) f = row[4] > row[3] ? FRAC_AT[4] + (value - row[4]) * (FRAC_AT[4] - FRAC_AT[3]) / (row[4] - row[3]) : value > row[4] ? 1 : FRAC_AT[4];
    else {
      for (a = 0; a < 3 && value >= row[a + 1]; a++) { /* the segment that holds the value */ }
      f = FRAC_AT[a] + (value - row[a]) / (row[a + 1] - row[a]) * (FRAC_AT[a + 1] - FRAC_AT[a]);
    }
    return Math.min(0.98, Math.max(0.02, f));
  }

  function dialReading(f, scope, index) {
    if (!inHand(f) || f.runin === 1 || !isObject(f.dials)) return null;
    var row = f.dials[scope];
    return Array.isArray(row) && isNum(row[index]) ? row[index] : null;
  }
  function scaleOf(sc, key) { return Object.prototype.hasOwnProperty.call(sc, key) ? sc[key] : undefined; }

  // The five dials from the close frames (oldest first; a missing one is null), the last being the shown day. Rings are
  // the last eleven, inner to today; a run-in day is no reading, and only the whole market's dials have rings (a sector's
  // reading is never placed on the whole market's scale; ruling 22). Words and the Hurst note are MMWorld's, always with
  // the scope (opts.scope, "ALL" by default); a shown day that is missing, or has no reading at all, is "no reading for
  // this day". opts.atSlot: a slot carries the last close's dials, and says so.
  function dialModel(closeFrames, scale, opts) {
    var Wd = mmWorld();
    if (!Wd) return [];
    var o = isObject(opts) ? opts : {}, scope = typeof o.scope === "string" ? o.scope : "ALL", ringed = scope === "ALL";
    var sc = isObject(scale) ? scale : {}, frames = Array.isArray(closeFrames) ? closeFrames.slice(-RINGS) : [];
    var shown = frames.length ? frames[frames.length - 1] : null, missing = frames.length > 0 && !inHand(shown);
    var runin = !missing && shown !== null && shown.runin === 1, out = [];
    for (var d = 0; d < Wd.DIALS.length; d++) {
      var dial = Wd.DIALS[d], row = scaleOf(sc, dial.key), rings = [], a;
      for (a = frames.length; a < RINGS; a++) rings.push(null);
      for (a = 0; a < frames.length; a++) rings.push(ringed ? dialFrac(dialReading(frames[a], scope, dial.index), row) : null);
      var value = runin || missing ? null : dialReading(shown, scope, dial.index);
      var note = dial.key === "follow" && !runin && !missing ? Wd.hurstNote(dialReading(shown, scope, Wd.HURST_INDEX), scaleOf(sc, "hurst"), scope) : null;
      var word = missing ? NO_READING_DAY : runin ? Wd.RUNIN_DIAL_WORD : Wd.dialWord(dial.key, value, row, scope);
      out.push({ key: dial.key, name: dial.name, rings: rings, value: value, word: word, note: note, when: o.atSlot ? Wd.AT_LAST_CLOSE : null });
    }
    return out;
  }

  // ===================================================================================================================
  // Part 3: the view, hit testing, selection, search, cascades and the address that restores a view.
  // Everything here is a pure function of plain numbers, the scene and the layout. The address is text anyone can type or
  // send: it is parsed strictly, never throws, and a name or day that is not really there is dropped, never replaced.
  // ===================================================================================================================

  // ---- the screen: which composition a viewport gets ----

  // The page is composed again for each kind of screen, not scaled (Task 16). A phone (under 640 wide) stacks the sentence, a
  // row of small dials, the field and the core, with the key and the tools folded away; a phone on its side (under 500 high and
  // 1024 wide) keeps only the head line and the core, the dials folded behind a switch; a tablet (under 1024 wide) puts the dials
  // under the sentence; a desktop has them beside it. Each mode decides how many plate captions are drawn, the dials' size in
  // CSS px, the room (px) the field keeps from the screen's edges and the overlays, and the one factor every cap's radius is
  // drawn at (a phone's field is small). A size that cannot be read is a desktop.
  var LAYOUT_MODES = {
    "desktop": { captions: 3, dial: 76, pad: 14, marks: 1 },
    "tablet": { captions: 2, dial: 64, pad: 12, marks: 1 },
    "phone": { captions: 1, dial: 56, pad: 10, marks: 0.7 },
    "phone-landscape": { captions: 0, dial: 44, pad: 8, marks: 0.8 },
  };
  function layoutMode(w, h) {
    if (!isNum(w) || w <= 0) return "desktop";
    if (w < 640) return "phone";
    if (isNum(h) && h > 0 && h < 500 && w < 1024) return "phone-landscape";
    return w < 1024 ? "tablet" : "desktop";
  }

  // ---- the view: pan and zoom as plain numbers ----

  var ZOOM_MAX = 6;                                     // the most zoomed-in view is this many times the fitted one
  var TAP_RADIUS = { coarse: 22, fine: 12 };            // how far from a star's centre a tap still picks it
  var EDGE_RANK_NEAR = 3, EDGE_RANK_FAR = 8, EDGE_ZOOM = 2.5;
  var COORD_LIMIT = 1e7;                                // a position beyond this is not on any screen

  function fieldOf(f) {
    var F = isObject(f) ? f : {};
    return { x: isNum(F.x) ? F.x : 0, y: isNum(F.y) ? F.y : 0, w: isNum(F.w) && F.w > 0 ? F.w : 1, h: isNum(F.h) && F.h > 0 ? F.h : 1 };
  }
  function isView(v) { return isObject(v) && isNum(v.k) && v.k > 0 && isNum(v.tx) && isNum(v.ty) && isNum(v.base) && v.base > 0; }

  // The unit square, centred in the field with `pad` to spare. -> {k, tx, ty, base}: a point (x, y) of the unit square is
  // at (tx + k x, ty + k y) on the screen, and `base` is the fitted k (the least zoom).
  function fitView(field, pad) {
    var F = fieldOf(field), p = isNum(pad) && pad > 0 && 2 * pad < Math.min(F.w, F.h) ? pad : 0;
    var k = Math.min(F.w, F.h) - 2 * p;
    return { k: k, tx: F.x + F.w / 2 - k / 2, ty: F.y + F.h / 2 - k / 2, base: k };
  }
  // A coordinate that is not a number (a BigInt, a symbol, an object) gives NaN, the module's mark for "no place".
  function toScreen(view, x, y) { return isView(view) && typeof x === "number" && typeof y === "number" ? [view.tx + view.k * x, view.ty + view.k * y] : [NaN, NaN]; }
  function toWorld(view, sx, sy) { return isView(view) && typeof sx === "number" && typeof sy === "number" ? [(sx - view.tx) / view.k, (sy - view.ty) / view.k] : [NaN, NaN]; }

  // Zoom by `factor` about a screen point: the point of the map under it stays under it. k stays within base .. 6 base.
  function zoomAt(view, sx, sy, factor) {
    if (!isView(view) || !isNum(sx) || !isNum(sy) || !isNum(factor) || factor <= 0) return view;
    var k = Math.min(ZOOM_MAX * view.base, Math.max(view.base, view.k * factor)), ratio = k / view.k;
    return { k: k, tx: sx - (sx - view.tx) * ratio, ty: sy - (sy - view.ty) * ratio, base: view.base };
  }

  // Pan by (dx, dy) pixels; at least a quarter of the unit square's width and of its height stays inside the field (all of
  // it when the field is narrower than that).
  function panBy(view, dx, dy, field) {
    if (!isView(view)) return view;
    var F = fieldOf(field), mx = Math.min(0.25 * view.k, F.w), my = Math.min(0.25 * view.k, F.h);
    var tx = view.tx + (isNum(dx) ? dx : 0), ty = view.ty + (isNum(dy) ? dy : 0);
    tx = Math.min(F.x + F.w - mx, Math.max(F.x + mx - view.k, tx));
    ty = Math.min(F.y + F.h - my, Math.max(F.y + my - view.k, ty));
    return { k: view.k, tx: tx, ty: ty, base: view.base };
  }

  // A rigid turn of the layout (one scale on both axes, nothing distorted): the angle, in radians, that lays the layout's long
  // axis (its nodes' principal axis) along the screen's long axis: across when `wide`, upright when not. 0 for fewer than two
  // usable nodes. turnedXY gives the nodes' places turned by an angle about their middle, as [xs, ys].
  function layoutTurn(nodes, wide) {
    var list = Array.isArray(nodes) ? nodes.filter(function (n) { return isObject(n) && isNum(n.x) && isNum(n.y); }) : [];
    if (list.length < 2) return 0;
    var mx = 0, my = 0, sxx = 0, syy = 0, sxy = 0, a;
    for (a = 0; a < list.length; a++) { mx += list[a].x; my += list[a].y; }
    mx /= list.length; my /= list.length;
    for (a = 0; a < list.length; a++) { var dx = list[a].x - mx, dy = list[a].y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    var theta = 0.5 * Math.atan2(2 * sxy, sxx - syy), turn = (wide ? 0 : Math.PI / 2) - theta;
    while (turn > Math.PI / 2) turn -= Math.PI;
    while (turn <= -Math.PI / 2) turn += Math.PI;
    return turn;
  }
  function turnedXY(nodes, angle) {
    var xs = [], ys = [], mx = 0, my = 0, n = nodes.length, a, c = Math.cos(angle || 0), s = Math.sin(angle || 0);
    for (a = 0; a < n; a++) { mx += nodes[a].x; my += nodes[a].y; }
    mx /= n || 1; my /= n || 1;
    for (a = 0; a < n; a++) { var dx = nodes[a].x - mx, dy = nodes[a].y - my; xs.push(mx + c * dx - s * dy); ys.push(my + s * dx + c * dy); }
    return [xs, ys];
  }

  // How many links of each stock to draw: the top 3 at a distance, the top 8 from 2.5 times the fitted zoom.
  function edgeRankAt(view) { return isView(view) && view.k >= EDGE_ZOOM * view.base ? EDGE_RANK_FAR : EDGE_RANK_NEAR; }

  // ---- hit testing ----

  // A grid over screen positions `xy` (x0, y0, x1, y1, ...), `cell` pixels wide. A position that is not a usable number
  // is a star nobody can hit. The positions are copied: later changes to `xy` do not reach the grid.
  function grid(xy, cell) {
    var size = isNum(cell) && cell >= 0.001 ? cell : 24, n = xy && typeof xy.length === "number" ? Math.floor(xy.length / 2) : 0;
    var pts = new Float64Array(2 * n), cells = new Map(), a;
    for (a = 0; a < n; a++) {
      var x = xy[2 * a], y = xy[2 * a + 1];
      if (!isNum(x) || !isNum(y) || Math.abs(x) > COORD_LIMIT || Math.abs(y) > COORD_LIMIT) { pts[2 * a] = NaN; pts[2 * a + 1] = NaN; continue; }
      pts[2 * a] = x; pts[2 * a + 1] = y;
      var key = Math.floor(x / size) + "|" + Math.floor(y / size);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(a);
    }
    return { pts: pts, n: n, size: size, cells: cells };
  }

  // The star nearest to a screen point within `radius`, or -1. A tie goes to the smaller index. Pure: same grid, same point,
  // same answer. A point beyond the screen limit (as far out as a star may be) is no point: -1, as for any non-number.
  function hit(G, sx, sy, radius) {
    if (!isObject(G) || !(G.pts instanceof Float64Array) || !(G.cells instanceof Map) || !isNum(G.size) || G.size <= 0 || !isCount(G.n)) return -1;
    if (!isNum(sx) || !isNum(sy) || !isNum(radius) || radius <= 0 || Math.abs(sx) > COORD_LIMIT || Math.abs(sy) > COORD_LIMIT) return -1;
    var best = -1, bd = radius * radius + 1e-9, pts = G.pts, n = Math.min(G.n, pts.length >> 1);
    function visit(i) {
      var d = (pts[2 * i] - sx) ** 2 + (pts[2 * i + 1] - sy) ** 2;
      if (d < bd) { bd = d; best = i; }
      else if (d === bd && best >= 0 && i < best) best = i;
    }
    // The cells to look in reach as far as the test itself does (the radius and its hair), so a star on a cell's edge is found.
    var reach = Math.sqrt(bd) * (1 + 1e-12) + 1e-9, i, c, r;
    var cx0 = Math.floor((sx - reach) / G.size), cx1 = Math.floor((sx + reach) / G.size);
    var cy0 = Math.floor((sy - reach) / G.size), cy1 = Math.floor((sy + reach) / G.size);
    if (!((cx1 - cx0 + 1) * (cy1 - cy0 + 1) <= 4 * G.cells.size + 16)) {          // a huge radius, or none of the cells make sense: every star
      for (i = 0; i < n; i++) if (pts[2 * i] === pts[2 * i]) visit(i);
      return best;
    }
    for (c = cx0; c <= cx1; c++) for (r = cy0; r <= cy1; r++) {
      var list = G.cells.get(c + "|" + r);
      if (list) for (i = 0; i < list.length; i++) if (list[i] < n) visit(list[i]);
    }
    return best;
  }

  // ---- links to draw, and "my positions" ----

  // The layout's links worth drawing at this zoom: the indexes into layout.edges whose kind is on and whose rank is known and
  // at most maxRank (3 at the fitted zoom, 8 from 2.5 times it; see edgeRankAt). A link with no rank, or one that names a
  // stock the map has not placed, is not drawn.
  function visibleEdges(layout, opts) {
    var nodes = layoutNodes(layout), edges = isObject(layout) && Array.isArray(layout.edges) ? layout.edges : [];
    var o = isObject(opts) ? opts : {}, kinds = kindsOf(o.kinds), maxRank = isNum(o.maxRank) ? o.maxRank : EDGE_RANK_NEAR;
    var placed = new Set(), out = [], a;
    for (a = 0; a < nodes.length; a++) if (typeof nodeAt(nodes, a).t === "string") placed.add(nodeAt(nodes, a).t);
    for (a = 0; a < edges.length; a++) {
      var e = isObject(edges[a]) ? edges[a] : {}, sheet = sheetName(e.s);
      if (sheet === null || !kinds[sheet] || !isInt(e.r) || e.r < 1 || e.r > maxRank) continue;
      if (typeof e.a !== "string" || typeof e.b !== "string" || e.a === e.b || !placed.has(e.a) || !placed.has(e.b)) continue;
      out.push(a);
    }
    return out;
  }

  // The stocks "my positions only" keeps lit: each held and queued stock on the map, and its five strongest links (its own
  // links, best rank first, on the kinds that are on; a stock linked on both kinds counts once). A ticker the map has not
  // placed adds nothing.
  function mineSet(layout, holdings, queued, kinds) {
    var nodes = layoutNodes(layout), edges = isObject(layout) && Array.isArray(layout.edges) ? layout.edges : [];
    var kk = kindsOf(kinds), at = new Map(), starts = new Set(), out = new Set(), a;
    for (a = 0; a < nodes.length; a++) { var t = nodeAt(nodes, a).t; if (typeof t === "string" && !at.has(t)) at.set(t, a); }
    [holdings, queued].forEach(function (list) { setOf(list).forEach(function (tk) { if (typeof tk === "string" && at.has(tk)) starts.add(at.get(tk)); }); });
    var links = new Map();
    for (a = 0; a < edges.length; a++) {
      var e = isObject(edges[a]) ? edges[a] : {}, sheet = sheetName(e.s), x = at.get(e.a), y = at.get(e.b);
      if (sheet === null || !kk[sheet] || !isInt(e.r) || e.r < 1 || x === undefined || y === undefined || x === y || !starts.has(x)) continue;
      if (!links.has(x)) links.set(x, []);
      links.get(x).push({ b: y, r: e.r });
    }
    starts.forEach(function (s) {
      out.add(s);
      var list = (links.get(s) || []).sort(function (p, q) { return p.r - q.r || p.b - q.b; }), seen = new Set();
      for (var i = 0; i < list.length && seen.size < 5; i++) seen.add(list[i].b);
      seen.forEach(function (b) { out.add(b); });
    });
    return out;
  }

  // ---- search ----

  var MAX_QUERY = 60, MAX_RESULTS = 8;
  var WORD_CHAR = /[\p{L}\p{N}]/u;

  // True when `needle` starts a word of `low` (both lower case).
  function startsWord(low, needle) {
    for (var at = low.indexOf(needle); at >= 0; at = low.indexOf(needle, at + 1)) {
      if (at === 0 || !WORD_CHAR.test(low.slice(at - 1, at))) return true;
    }
    return false;
  }

  // Up to eight stocks of the layout: the exact ticker first (so "f" finds F before nine other F-tickers), then ticker prefix,
  // then a word of the name that starts with the text, then the text anywhere in a ticker or name. Case-insensitive; inside a
  // group, the layout's own order. It reads the layout's tickers
  // and names only: no figure, headline or price is ever part of a result.
  function search(layout, q) {
    var needle = typeof q === "string" ? q.trim().toLowerCase() : "";
    if (needle === "" || needle.length > MAX_QUERY) return [];
    var nodes = layoutNodes(layout), groups = [[], [], [], []], a;
    for (a = 0; a < nodes.length; a++) {
      var node = nodeAt(nodes, a);
      if (typeof node.t !== "string" || node.t === "") continue;
      var t = node.t.toLowerCase(), n = typeof node.n === "string" ? node.n.toLowerCase() : "";
      var g = t === needle ? 0 : t.indexOf(needle) === 0 ? 1 : startsWord(n, needle) ? 2 : t.indexOf(needle) >= 0 || n.indexOf(needle) >= 0 ? 3 : -1;
      if (g >= 0) groups[g].push({ node: a, t: node.t, n: typeof node.n === "string" ? node.n : "" });
    }
    return groups[0].concat(groups[1], groups[2], groups[3]).slice(0, MAX_RESULTS);
  }

  // ---- selection ----

  var KIND_NAMES = ["news", "comove"];
  function isNode(v) { return isInt(v) && v >= 0; }
  // The kinds switch of a state: never both off.
  function kindsOn(k) { var r = kindsOf(k); return r.news || r.comove ? r : { news: true, comove: true }; }
  function uiOf(s) {
    var o = isObject(s) ? s : {};
    return { sel: isNode(o.sel) ? o.sel : -1, cat: isObject(o.cat) && isNode(o.cat.node) && isDay(o.cat.day) ? { node: o.cat.node, day: o.cat.day } : null,
             kinds: kindsOn(o.kinds), mine: o.mine === true, query: typeof o.query === "string" ? o.query : "" };
  }

  // state {sel: node | -1, cat: {node, day} | null, kinds, mine, query}. A catalyst is a stock on a day. Returns a new state;
  // an action it does not know, or one with a bad value, leaves the state as it is. A tap with a source replaces an isolated
  // older catalyst of the same stock: what the page passes as the source is the page's choice (newestSource gives the newest).
  function ui(state, action) {
    if (!isObject(state)) return uiOf(state);
    if (!isObject(action)) return state;
    var s = uiOf(state);
    switch (action.type) {
      case "tapCap": {
        if (!isNode(action.node)) return state;
        var src = action.source;
        // The newest catalyst of the cap, named by the scene; a source that names another stock is not this cap's.
        if (isObject(src) && src.node === action.node && isDay(src.day)) s.cat = { node: action.node, day: src.day };
        s.sel = action.node;
        return s;
      }
      case "tapCatalyst":
        if (!isNode(action.node) || !isDay(action.day)) return state;
        s.cat = { node: action.node, day: action.day };
        return s;
      case "tapGround":
        s.sel = -1; s.cat = null;
        return s;
      case "escape":
        if (s.sel >= 0) s.sel = -1; else if (s.cat !== null) s.cat = null; else return state;
        return s;
      case "toggleKind": {
        if (KIND_NAMES.indexOf(action.kind) < 0) return state;
        var other = action.kind === "news" ? "comove" : "news";
        if (s.kinds[action.kind] && !s.kinds[other]) return state;               // the last kind left on stays on
        s.kinds[action.kind] = !s.kinds[action.kind];
        return s;
      }
      case "toggleMine":
        s.mine = !s.mine;
        return s;
      case "search":
        if (typeof action.q !== "string") return state;
        s.query = action.q.length > MAX_QUERY ? action.q.slice(0, MAX_QUERY) : action.q;
        return s;
      default:
        return state;
    }
  }

  // A cap's newest catalyst in the scene, as {node, day}, or null when the cap is not a catalyst source there. "Newest" is
  // the fewest trading days back; the scene lists a source once per day.
  function newestSource(scene, node) {
    if (!isObject(scene) || !Array.isArray(scene.sources) || !isNode(node)) return null;
    var best = null;
    for (var a = 0; a < scene.sources.length; a++) {
      var s = scene.sources[a];
      if (isObject(s) && s.src === node && isInt(s.j) && typeof s.day === "string" && (best === null || s.j < best.j)) best = s;
    }
    return best === null ? null : { node: node, day: best.day };
  }

  // What the selection means on the shown step. The selection itself is never changed or replaced: a catalyst that is not the
  // scene's isolated one comes back `shown: false`, with a reason in plain words that is true in every case it is given:
  // - no scene: the record of this step cannot be read;
  // - a later day than the step: so it says;
  // - the asked day lies inside the step's look-back and its frame is not in hand: that day's record cannot be read. This is
  //   decided from `read`, the days of the step's look-back as the caller read them ([{day, inHand}]), never from the
  //   scene's incomplete flag (which a hole anywhere in the look-back sets);
  // - the catalyst is on the step but the scene isolates another (the caller's two states disagree): so it says;
  // - otherwise the stock was no catalyst on any day the step shows, or, when it was one on another of those days, this
  //   catalyst is not on any of them.
  // -> {sel: {node, shown} | null, cat: {node, day, shown, why} | null}
  function selectionView(state, scene, read) {
    var s = uiOf(state), sc = isObject(scene) && Array.isArray(scene.caps) ? scene : null, out = { sel: null, cat: null };
    if (s.sel >= 0) out.sel = { node: s.sel, shown: !!sc && s.sel < sc.caps.length };
    if (s.cat) {
      var iso = sc && isObject(sc.isolated) ? sc.isolated : null, shown = !!iso && iso.src === s.cat.node && iso.day === s.cat.day, why = null;
      if (!shown) {
        var srcs = sc && Array.isArray(sc.sources) ? sc.sources : [], here = false, elsewhere = false, unread = false, a;
        for (a = 0; a < srcs.length; a++) {
          if (!isObject(srcs[a]) || srcs[a].src !== s.cat.node) continue;
          if (srcs[a].day === s.cat.day) here = true; else elsewhere = true;
        }
        if (Array.isArray(read)) for (a = 0; a < read.length; a++) if (isObject(read[a]) && read[a].day === s.cat.day && read[a].inHand !== true) unread = true;
        if (!sc) why = "The record of this step cannot be read.";
        else if (typeof sc.day === "string" && s.cat.day > sc.day) why = "That catalyst is of a later day than the one shown.";
        else if (unread) why = "The record of that catalyst's day cannot be read for this step.";
        else if (here) why = "That catalyst is on this step but is not the one picked.";
        else if (elsewhere) why = "That catalyst is not on any day this step shows.";
        else why = "That stock was not a catalyst on any day this step shows.";
      }
      out.cat = { node: s.cat.node, day: s.cat.day, shown: shown, why: why };
    }
    return out;
  }

  // ---- the record of one stock ----

  var KIND_WORDS = { earnings: "earnings", news_burst: "a burst of news", price_jump: "a price jump" };
  var MOVE_WORDS = { "2": "A big move up", "1": "A move up", "-1": "A move down", "-2": "A big move down" };
  var STRENGTH_WORDS = [null, "weakly", "moderately", "strongly"];
  var RECORD_LINKS = 5;                                 // the links listed each way, unless the caller asks for fewer (a phone: 3)
  var WINDOW_MAX = 2000;                                // a moves-together span longer than this many trading days is not one
  // The most stories the writer lists for one link (view_data.EVIDENCE_IDS_MAX, newest first, never one dated before the first
  // live day unless the owner said yes). With fewer listed than this, every story left unlisted is one from before that day.
  // It follows the two caps upstream: the engine stores the newest 5 stories of a link (monthly.py EVIDENCE_STORIES), and the
  // view writer lists at most 3 of those (view_data.py EVIDENCE_IDS_MAX). If the writer's cap changes, this changes with it:
  // a value above the writer's would make the "from before the map went live" line claim a cause it cannot know.
  var STORIES_LISTED_MAX = 3;
  var BEFORE_LIVE = "Its stories from before 7 November 2026 are not shown.";      // ruling 41: the closed years
  var STORIES_PRIVATE = "Stories are listed on the private page.";
  var FIGURE_BEFORE_LIVE = "Its strength reaches back before 7 November 2026 and is not shown.";
  function moreBeforeLive(k, Wd) {
    return Wd.fmtInt(k) + " more " + Wd.plural(k, "story", "stories") + " from before 7 November 2026 " + Wd.plural(k, "is", "are") + " not shown.";
  }
  function moreUnlisted(k, Wd) { return Wd.fmtInt(k) + " more " + Wd.plural(k, "story is", "stories are") + " not listed."; }

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  // A figure with its sign, as the record writes it: +1.8, −1.8, 0.0.
  // A move against the stock's usual daily swing, in plain words: "Moved up 1.8 times its usual daily swing today."
  function swingLine(z, when) {
    var s = Math.abs(z).toFixed(1);
    if (Number(s) === 0) return "Hardly moved " + when + ": less than a tenth of its usual daily swing.";
    return "Moved " + (z < 0 ? "down " : "up ") + s + " times its usual daily swing " + when + ".";
  }
  function plainFigure(v, digits) { var s = Math.abs(v).toFixed(digits); return (Number(s) !== 0 && v < 0 ? "−" : "") + s; }
  // The ticker index of a node in one look-back item's file, or -1.
  function tickerOf(item, node) {
    var B = item.bind;
    for (var t = 0; t < B.length; t++) if (B[t] === node) return t;
    return -1;
  }

  // What one stock's record says on the shown step, in fixed copy. Every line is read from the record as it stands at that
  // step: on an entry of today it says "now" and "today", on any other "that day". args {layout, node, back, timeline, k,
  // evidence, positions, state, isPublic, kinds, today?}:
  //   back       the step's look-back as the scene reads it, [{f, j, bind, tickers?}] (back[0] the shown entry; null when not in
  //              hand); `tickers` names the stocks of the item's file, so a source the map has not placed is still named
  //   timeline,k the shown entry (`today`, a day, decides it when there is no timeline)
  //   evidence   map-evidence.json or null, in contracts ruling 30's shapes: private news {n, ids} with `stories`, moves-together
  //              {v, w, through}; public news {n, newest}, moves-together {lv, w}. A field that is missing, null or not what it
  //              should be is left out of the line; a file of another month than the layout's is not read at all, nor, on the
  //              public page, a file that does not say it is public
  //   positions  map-positions.json or null; `known: false` says the account's positions could not be read
  //   isPublic   the page's variant: no figure and no story is listed on the public page unless its file carries it (a frame
  //              that is public is read as public whatever the caller says)
  //   kinds      the kinds switch: a kind switched off lists no links
  //   perList    how many links each way (5 when not given)
  // `state` (map-state.json) is accepted and not read: the account's place comes from map-positions.json.
  // -> {title, name, sector, lines: [string], echoes: [string], links, linkedBy, notes: [string]}, or null for a node the layout
  //    does not hold. Both link lists are [{t, sheet, line, stories: [{day, h, url}], note}], best rank first (a tie: shared news
  //    first, then the ticker), on the kinds switched on. A rank is the writer's, rank(i <- j): j's place among i's incoming
  //    links. `links` ("its strongest links") are the stock's incoming links, ranked by the stock itself; `linkedBy` ("stocks
  //    it is a strong link for") are its outgoing links, the ones its catalysts' echoes run along, by the rank each linked
  //    stock gives it. `notes` say once what holds for every link listed ("Stories are listed on the private page.").
  function record(args) {
    var A = isObject(args) ? args : {}, Wd = mmWorld(), nodes = layoutNodes(A.layout);
    if (!Wd || !isNode(A.node) || A.node >= nodes.length) return null;
    var node = nodeAt(nodes, A.node), t = node.t;
    if (typeof t !== "string" || t === "") return null;
    var back = Array.isArray(A.back) ? A.back : [];
    function usable(it) { return isObject(it) && inHand(it.f) && isInt(it.j) && it.j >= 0 && it.j <= LOOKBACK && fitsBind(it.bind, it.f.n); }
    var top = usable(back[0]) && back[0].j === 0 ? back[0] : null;
    var T = isObject(A.timeline) && Array.isArray(A.timeline.entries) ? A.timeline : null, e = T && isNode(A.k) ? T.entries[A.k] : null;
    var today = isObject(e) ? e.seg === "today" : !!top && typeof A.today === "string" && top.f.day === A.today;
    var isPublic = A.isPublic === true || (!!top && top.f.isPublic === true);
    var when = today ? "today" : "that day", lines = [], echoes = [];

    // Its state, from the shown entry's own frame.
    var ti = top ? tickerOf(top, A.node) : -1, st = ti >= 0 ? top.f.state[ti] : 0;
    if (st === 1) lines.push(today ? "Quiet now." : "Quiet that day.");
    else if (st === 2) lines.push(today ? "Loud now: attention is rising sharply." : "Loud that day: attention was rising sharply.");
    else if (st === 3) lines.push(today ? "Tired now: attention rose and is fading." : "Tired that day: attention had risen and was fading.");
    else lines.push("No reading " + when + ".");

    // Its place in the account: what map-positions.json says now, whatever day is shown.
    // On a step that is not today it says that this is the account now.
    var P = isObject(A.positions) ? A.positions : null;
    if (P && P.known === false) lines.push("The account's positions could not be read.");
    else if (P && isObject(P.positions) && hasOwn(P.positions, t) && isObject(P.positions[t])) {
      var pos = P.positions[t], nowWord = today ? "" : " now";
      if (pos.status === "held") lines.push("Held by the account" + nowWord + (isDay(pos.since) ? (today ? " since " : ", since ") + Wd.fmtDay(pos.since) : "") + ".");
      else if (pos.status === "queued") lines.push("Waiting for the committee" + nowWord + ".");
    }

    // Its move on the shown entry: the figure on the private page, the level in words on the public one.
    if (ti >= 0) {
      if (!isPublic) {
        if (top.f.z && isNum(top.f.z[ti])) lines.push(swingLine(top.f.z[ti], when));
      } else {
        var lvl = top.f.zLevel[ti];
        if (isKnownLevel(lvl)) lines.push(lvl === 0 ? "About a usual day." : MOVE_WORDS[String(lvl)] + " " + when + ".");
      }
    }

    // Its catalysts in the look-back, the echoes they sent and the echoes that reached it, newest first.
    var atClose = !!top && top.f.slot === "close", cats = [], sent = [], got = [], b, q;
    function nameIn(it, tix) {
      if (isNameList(it.tickers) && it.tickers.length === it.f.n) return it.tickers[tix];
      var nd = typeof it.bind[tix] === "number" && it.bind[tix] >= 0 && it.bind[tix] < nodes.length ? nodeAt(nodes, it.bind[tix]).t : undefined;
      return typeof nd === "string" ? nd : null;
    }
    for (b = 0; b < back.length; b++) {
      var it = back[b];
      if (!usable(it)) continue;
      var f = it.f, B = it.bind, pub = f.isPublic === true;
      for (q = 0; q < f.cats.length; q++) if (B[f.cats[q].i] === A.node) cats.push({ j: it.j, day: f.day, kind: f.cats[q].kind });
      for (q = 0; q < f.echoes.length; q++) {
        var en = f.echoes[q];
        if (en.type !== "catalyst" || !Array.isArray(en.rows)) continue;
        var own = B[en.src] === A.node, reached = 0, against = 0;
        for (var r = 0; r < en.rows.length; r++) {
          var row = en.rows[r], code = echoCode(row, it.j, pub, atClose);
          if (code === 0) continue;
          if (own) { reached++; if (code & 4) against++; }
          else if (B[row.dst] === A.node) got.push({ j: it.j, day: f.day, src: nameIn(it, en.src), against: (code & 4) !== 0 });
        }
        if (own && reached > 0) sent.push({ j: it.j, day: f.day, reached: reached, against: against });
      }
    }
    function newestFirst(x, y) { return x.j - y.j; }
    cats.sort(newestFirst).forEach(function (c) {
      lines.push("A catalyst on " + Wd.fmtDay(c.day) + (hasOwn(KIND_WORDS, c.kind) ? ": " + KIND_WORDS[c.kind] : "") + ".");
    });
    sent.sort(newestFirst).forEach(function (s) {
      echoes.push("Its catalyst on " + Wd.fmtDay(s.day) + " reached " + Wd.numberWord(s.reached) + " " + Wd.plural(s.reached, "linked stock", "linked stocks") +
                  "; " + (s.against > 0 ? Wd.numberWord(s.against) : "none") + " moved against it.");
    });
    got.sort(function (x, y) { return x.j - y.j || (x.src === y.src ? 0 : x.src === null ? 1 : y.src === null ? -1 : x.src < y.src ? -1 : 1); }).forEach(function (g) {
      echoes.push("Moved " + (g.against ? "against" : "with") + " the catalyst in " + (g.src === null ? "a stock off the map" : g.src) + " (" + Wd.fmtDay(g.day) + ").");
    });

    // Its links both ways on the kinds switched on, with what each rests on.
    var kk = kindsOn(A.kinds), EV = isObject(A.evidence) && isObject(A.evidence.links) ? A.evidence : null, L = isObject(A.layout) ? A.layout : {};
    if (EV && isPublic && EV.public !== true) EV = null;    // a public page reads only a public evidence file
    if (EV && ((typeof EV.month === "string" && typeof L.month === "string" && EV.month !== L.month) ||
               (typeof EV.links_month === "string" && typeof L.links_month === "string" && EV.links_month !== L.links_month))) EV = null;
    var edges = Array.isArray(L.edges) ? L.edges : [], notes = [], perList = isInt(A.perList) && A.perList >= 1 ? A.perList : RECORD_LINKS;
    var past = !!EV && EV.past_evidence === true;
    function entryOf(sheet, src, dst) { var key = sheet + "|" + src + "|" + dst; return EV && hasOwn(EV.links, key) && isObject(EV.links[key]) ? EV.links[key] : null; }
    function windowOf(v) { return isInt(v) && v >= 1 && v <= WINDOW_MAX ? v : null; }
    function note(text) { if (notes.indexOf(text) < 0) notes.push(text); }
    function newsLink(other, en) {
      var out = { t: other, sheet: "news", line: other + ": shared news.", stories: [], note: null };
      if (!en) return out;
      var n = isCount(en.n) ? en.n : null, listed = Array.isArray(en.ids), newest = null;
      if (listed && isObject(EV.stories)) {
        for (var s = 0; s < en.ids.length; s++) {
          var id = String(en.ids[s]), sto = hasOwn(EV.stories, id) ? EV.stories[id] : null;
          if (!isObject(sto) || typeof sto.h !== "string" || sto.h === "") continue;   // a story with no headline is never listed
          var day = isDay(sto.day) ? sto.day : null;
          out.stories.push({ day: day, h: sto.h, url: Wd.safeUrl(sto.url) });
          if (day && (newest === null || day > newest)) newest = day;
        }
      } else if (!listed && isDay(en.newest)) newest = en.newest;
      if (n !== null) {
        out.line = other + ": shared news, " + Wd.fmtInt(n) + " " + Wd.plural(n, "story", "stories") + " together" +
                   (newest ? ", the newest on " + Wd.fmtDay(newest) : "") + ".";
      }
      var k = out.stories.length, rest = n !== null ? n - k : 0;
      if (isPublic && !listed) { if (n !== null && n > 0) note(STORIES_PRIVATE); }
      else if (rest > 0 && k === 0 && !past) out.note = BEFORE_LIVE;
      else if (rest > 0 && k < STORIES_LISTED_MAX && !past) out.note = moreBeforeLive(rest, Wd);
      else if (rest > 0) out.note = moreUnlisted(rest, Wd);
      return out;
    }
    function comoveLink(other, en) {
      var out = { t: other, sheet: "comove", line: other + ": moves together.", stories: [], note: null };
      if (!en) return out;
      var w = windowOf(en.w), over = w !== null ? " over " + Wd.fmtInt(w) + " trading days" : "";
      if (isPublic || hasOwn(en, "lv")) {                     // the public level, never a figure
        var word = isInt(en.lv) && en.lv >= 1 && en.lv <= 3 ? STRENGTH_WORDS[en.lv] : null;
        out.line = other + ": moves together" + (word ? ", " + word + (w !== null ? "," : "") : "") + over + ".";
        if (hasOwn(en, "lv") && en.lv === null && !past) out.note = FIGURE_BEFORE_LIVE;      // withheld by the writer
      } else {
        var v = isNum(en.v) && Math.abs(en.v) <= 1 ? en.v : null, through = w !== null && isDay(en.through) ? en.through : null;
        out.line = other + ": moves together" + (v !== null ? ", strength " + plainFigure(v, 2) : "") + over + (through ? " to " + Wd.fmtDay(through) : "") + ".";
        if (hasOwn(en, "v") && en.v === null && !past) out.note = FIGURE_BEFORE_LIVE;
      }
      return out;
    }
    // One list: the links whose `mine` end is the stock, each other stock once per kind at its best rank.
    function listOf(mineEnd) {
      var best = new Map();
      for (var a = 0; a < edges.length; a++) {
        var ed = edges[a];
        if (!isObject(ed) || !isInt(ed.r) || ed.r < 1 || typeof ed.a !== "string" || typeof ed.b !== "string" || ed.a === "" || ed.b === "" || ed.a === ed.b) continue;
        var sheet = sheetName(ed.s);
        if (sheet === null || !kk[sheet] || ed[mineEnd] !== t) continue;
        var other = mineEnd === "a" ? ed.b : ed.a, key = sheet + "|" + other;
        if (!best.has(key) || ed.r < best.get(key).r) best.set(key, { sheet: sheet, other: other, r: ed.r });
      }
      return Array.from(best.values()).sort(function (x, y) {
        return x.r - y.r || (x.sheet === y.sheet ? 0 : x.sheet === "news" ? -1 : 1) || (x.other < y.other ? -1 : x.other > y.other ? 1 : 0);
      }).slice(0, perList).map(function (l) {
        var en = mineEnd === "a" ? entryOf(l.sheet, t, l.other) : entryOf(l.sheet, l.other, t);
        return l.sheet === "news" ? newsLink(l.other, en) : comoveLink(l.other, en);
      });
    }
    var links = listOf("b"), linkedBy = listOf("a");
    return { title: t, name: typeof node.n === "string" && node.n !== "" && node.n !== t ? node.n : null,
             sector: typeof node.s === "string" && node.s !== "" ? node.s : null, lines: lines, echoes: echoes, links: links, linkedBy: linkedBy, notes: notes };
  }

  // ---- cascades ----

  // The frame of entry kk as the caller holds it: {f, tickers} with f a decoded frame and tickers the names of its file.
  function frameOfEntry(frameAt, kk) {
    var r;
    try { r = frameAt(kk); } catch (e) { return null; }
    if (!isObject(r) || !isDecoded(r.f) || !isNameList(r.tickers) || r.tickers.length !== r.f.n) return null;
    var at = new Map();
    for (var a = 0; a < r.tickers.length; a++) if (!at.has(r.tickers[a])) at.set(r.tickers[a], a);
    return { f: r.f, tickers: r.tickers, at: at, cats: catalystsOf(r.f) };
  }

  function lookbackItem(T, kk, j) {
    var items = T.lookback(kk).items;
    for (var a = 0; a < items.length; a++) if (items[a].j === j) return items[a];
    return null;
  }

  // The cascade of one catalyst, `{t, day}`: a stock on a day, never mixed with the same stock's other catalysts. It goes UP from
  // that catalyst's own day through the parent links of the `c` rows (`parentBack` trading days back, read through the
  // timeline's look-back) to the root, then collects DOWN, over the days from the root to the shown step k, every catalyst whose
  // own chain reaches that root. So a catalyst of an earlier day than k gets its own cascade (the stock may be a catalyst again on
  // a later day: that is another cascade) with the members found up to k. Nothing is guessed: a chain stops where the record stops
  // (days back not recorded, a day with no entry, a day whose record cannot be read, an earlier catalyst its own day does not
  // list) and the result is `complete: false` with the reason in plain words. frameAt(kk) -> {f, tickers} | null.
  // -> null when the catalyst's day is not a step of the timeline at or before k, its record cannot be read, or the stock was no
  //    catalyst that day; else {rootTicker, rootDay, members: [{i, t, day}], complete, size, atLeast, liveSize, daysBack, why}.
  // `members` are the catalysts found from the root's day to step k, the root first, then by day and ticker; `i` is the ticker's
  // index in its own record's file, or null for a root whose record cannot be read (the child's index would be another star).
  // `size` is always members.length, and `atLeast` says it may be more (the result is incomplete). `liveSize` is the
  // engine's own size for this root and day (liveCascades, the cascades of map-state.json), or null when it does not list them;
  // it never replaces `size`. The page may show `liveSize` only when the shown step is the newest and `liveSize` is not below
  // `size`. `daysBack` is the trading days from the root to the asked catalyst (at least that, when incomplete). Left as it is:
  // `complete` can be false where a slower reading says true, when a catalyst's named parent joins the cascade on the same day
  // later in the row order; that is always the cautious side.
  function cascadeOf(T, frameAt, k, catalyst, liveCascades) {
    try { return cascadeCore(T, frameAt, k, catalyst, liveCascades); } catch (e) { return null; }
  }

  function cascadeCore(T, frameAt, k, catalyst, liveCascades) {
    var entries = isObject(T) && Array.isArray(T.entries) && typeof T.lookback === "function" ? T.entries : null;
    if (!entries || typeof frameAt !== "function" || !isNode(k) || !isObject(entries[k]) || !isObject(catalyst)) return null;
    var srcTicker = catalyst.t, srcDay = catalyst.day;
    if (typeof srcTicker !== "string" || !isDay(srcDay) || srcDay > entries[k].day) return null;
    // The entry of the catalyst's own day: the shown step when it is that day, else that day's close.
    var kc = entries[k].day === srcDay ? k : T.at(srcDay, "close");
    if (!isNode(kc) || kc > k || !isObject(entries[kc]) || entries[kc].day !== srcDay) return null;
    var memo = new Map();
    function frame(kk) { if (!memo.has(kk)) memo.set(kk, frameOfEntry(frameAt, kk)); return memo.get(kk); }
    var g0 = frame(kc);
    if (!g0) return null;
    var i0 = g0.at.get(srcTicker), c0 = i0 === undefined ? undefined : g0.cats.get(i0);
    if (!c0) return null;

    var why = null, complete = true;
    function stop(reason) { if (complete) { complete = false; why = reason; } }

    // Up: the chain of parents, newest first. A parent is named by its ticker and its day; it is a member only as far as the
    // record names it.
    var chain = [{ t: srcTicker, i: i0, kk: kc, day: srcDay, g: g0, cat: c0 }], daysBack = 0;
    for (var guard = 0; guard <= entries.length; guard++) {
      var cur = chain[chain.length - 1], c = cur.cat;
      if (c.parent === null) break;                                              // it began the cascade
      if (c.parentBack === null) { stop("How many days back the earlier catalyst was is not recorded."); break; }
      var item = lookbackItem(T, cur.kk, c.parentBack);
      if (!item || !isObject(entries[item.k])) { stop("The record has no entry for the day of the earlier catalyst."); break; }
      var pname = cur.g.tickers[c.parent], pg = frame(item.k);
      if (!pg) {
        daysBack += c.parentBack;
        chain.push({ t: pname, i: null, kk: item.k, day: entries[item.k].day, g: null, cat: null });
        stop("The record of an earlier day of this cascade cannot be read.");
        break;
      }
      var pi = pg.at.get(pname), pc = pi === undefined ? undefined : pg.cats.get(pi);
      if (!pc) { stop("The earlier catalyst is not listed on its own day."); break; }
      daysBack += c.parentBack;
      chain.push({ t: pname, i: pi, kk: item.k, day: entries[item.k].day, g: pg, cat: pc });
    }
    var root = chain[chain.length - 1];

    // Down: every catalyst from the root's day to step k whose chain reaches the root. The days are the trading days between,
    // in the timeline's own steps: a day with no entry or no readable record might hold a member, so it makes the result partial.
    var inSet = new Map([[root.t + "|" + root.day, true]]), names = new Set([root.t]);
    var members = [{ i: root.i, t: root.t, day: root.day, td: entries[root.kk].td }];
    var byTd = new Map(), kk, rootTd = entries[root.kk].td, kTd = entries[k].td;
    for (kk = root.kk; kk <= k; kk++) {
      var e = entries[kk];
      if (isObject(e) && (e.slot === "close" || kk === k) && !byTd.has(e.td)) byTd.set(e.td, kk);
    }
    for (var td = rootTd + 1; td <= kTd; td++) {
      var dk = byTd.get(td);
      if (dk === undefined) { stop("A day between the start of this cascade and this step is missing from the record."); continue; }
      var dg = frame(dk);
      if (!dg) { stop("The record of a day between the start of this cascade and this step cannot be read."); continue; }
      var day = entries[dk].day;
      dg.cats.forEach(function (cat, ti) {
        if (cat.parent === null) return;
        var pn = dg.tickers[cat.parent], pit = cat.parentBack === null ? null : lookbackItem(T, dk, cat.parentBack);
        if (!pit || !isObject(entries[pit.k])) {
          if (names.has(pn)) stop("A catalyst names an earlier catalyst of this cascade without saying which day.");   // it could belong; it is not guessed
          return;
        }
        if (!inSet.has(pn + "|" + entries[pit.k].day)) return;
        var me = dg.tickers[ti] + "|" + day;
        if (inSet.has(me)) return;
        inSet.set(me, true); names.add(dg.tickers[ti]);
        members.push({ i: ti, t: dg.tickers[ti], day: day, td: td });
      });
    }
    members.sort(function (x, y) { return x.td - y.td || (x.t < y.t ? -1 : x.t > y.t ? 1 : 0); });
    members = members.map(function (m) { return { i: m.i, t: m.t, day: m.day }; });

    var liveSize = null, lc = Array.isArray(liveCascades) ? liveCascades : [];
    for (var a = 0; a < lc.length; a++) {
      var L = lc[a];
      if (isObject(L) && L.root === root.t && L.root_day === root.day && isInt(L.size) && L.size >= 1) { liveSize = L.size; break; }
    }
    return { rootTicker: root.t, rootDay: root.day, members: members, complete: complete, size: members.length, atLeast: !complete, liveSize: liveSize,
             daysBack: daysBack, why: why };
  }

  // ---- the address ----

  var TICKER_RE = /^[A-Za-z0-9][A-Za-z0-9.\-]{0,11}$/;
  var AT_RE = /^(\d{4}-\d{2}-\d{2})(?:T([01]\d|2[0-3]):([0-5]\d))?$/;
  var NOW_RE = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  var NUMBER_RE = /^-?\d{1,6}(?:\.\d{1,6})?$/;
  var CONTROL_RE = /[\u0000-\u001f\u007f]/;
  var MAX_ADDRESS = 2000, MAX_PARTS = 40;
  var ADDRESS_PARTS = ["at", "sel", "cat", "kinds", "mine", "ease", "q", "scoreboard", "now"], TOO_LONG = "too long";

  function validTicker(t) { return typeof t === "string" && TICKER_RE.test(t); }
  // The ISO time of an address's `now`: a real day, a real time, and a zone (so the clock never depends on the machine), or NaN.
  function nowMs(s) {
    var m = typeof s === "string" ? NOW_RE.exec(s) : null;
    return m && isDay(m[1]) ? Date.parse(s) : NaN;
  }
  function validNow(s) { return !isNaN(nowMs(s)); }
  function validQuery(q) {
    if (typeof q !== "string" || q.length > MAX_QUERY || CONTROL_RE.test(q)) return false;
    try { encodeURIComponent(q); } catch (e) { return false; }                  // a lone surrogate cannot be written in an address
    return true;
  }
  // `at` is `today`, a day or a day and a time. `closedOk` lets a day of the closed years through (the timeline decides then).
  function validAt(at, closedOk) {
    if (at === "today") return true;
    var m = typeof at === "string" ? AT_RE.exec(at) : null;
    return !!m && isDay(m[1]) && (closedOk || !inClosedYears(m[1]));
  }
  function easeOf(v) { return v < 0 ? 0 : v > 1 ? 1 : v + 0; }

  // The node of a ticker in the layout (the first, as bind reads it), or -1.
  function nodeOfTicker(layout, t) {
    var nodes = layoutNodes(layout);
    if (typeof t !== "string") return -1;
    for (var a = 0; a < nodes.length; a++) if (nodeAt(nodes, a).t === t) return a;
    return -1;
  }

  // The entry an address's `at` names, or -1. Exact, never the nearest: a day with a close is its close, a day without one is
  // its last entry; a day and a time is that slot and no other; `today` is the clock's day (the argument) and, when that day has
  // no entry (a weekend, before the first reading), the newest entry. A day the timeline does not hold is -1.
  function addressEntry(T, at, today) {
    try {
      if (!isObject(T) || !Array.isArray(T.entries) || typeof T.at !== "function") return -1;
      var m = at === "today" ? [null, isDay(today) ? today : null] : typeof at === "string" ? AT_RE.exec(at) : null;
      if (!m) return -1;
      if (at === "today" && m[1] === null) return T.entries.length - 1;
      var day = m[1];
      if (m[2] !== undefined && m[2] !== null) { var one = T.at(day, m[2] + ":" + m[3]); return isInt(one) && one < T.entries.length ? one : -1; }
      var k = T.at(day, "close");
      for (var a = T.entries.length - 1; k < 0 && a >= 0; a--) if (isObject(T.entries[a]) && T.entries[a].day === day) k = a;
      if (at === "today" && k < 0) k = T.entries.length - 1;
      return isInt(k) && k < T.entries.length ? k : -1;
    } catch (e) {
      return -1;
    }
  }

  // An entry the address may name: it exists, and it is not a day of the closed years (ruling 40: never shown).
  function addressOk(T, at, today) {
    var k = addressEntry(T, at, today), e = k >= 0 ? T.entries[k] : null;
    return !!e && isObject(e) && typeof e.day === "string" && !inClosedYears(e.day);
  }
  function usableTimeline(t) { return isObject(t) && Array.isArray(t.entries) && typeof t.at === "function" ? t : null; }
  function usableLayout(l) { return isObject(l) && Array.isArray(l.nodes) ? l : null; }

  // Parse the page's hash: #at=2019-05-03&sel=AAPL&cat=NVDA@2019-04-30&kinds=news&mine=1&ease=0.5&q=acme&scoreboard=1&now=<ISO>.
  // The view's zoom is not in the address: a shared link opens at the default view.
  //
  // Never throws, whatever the text. Unknown keys, repeated keys, broken values and values that are not really there are
  // ignored (the default stays). The address is read in two passes, because what a day or a ticker means is only known with the
  // data: `ctx` is {layout, timeline, today}, each part optional. Without a timeline `at` and `cat` come back null, and without
  // a layout `sel` and `cat` too, and no day or ticker is validated or returned; those keys are listed in `pending` (not in
  // `ignored`), to be read again once the data is in. With the data, a ticker must be on the layout and a day must be an entry of
  // the timeline (`addressEntry`); a day of the closed years passes only for an entry that itself says it is a run-in day.
  // The result has the plain keys of the example and, out of its keys, two lists: `ignored`, the parts that are junk for good
  // (fixed names only, never the text; "too long" for an address or a part count over the limit), and `pending`.
  // The rule for `formatHash` of a result that has `pending` parts: do not write it into the address; see formatHash.
  function parseHash(hash, ctx) {
    var out = { at: null, sel: null, cat: null, kinds: { news: true, comove: true }, mine: false, ease: null, q: "", scoreboard: false, now: null };
    var ignored = [], pending = [], pendingText = Object.create(null);
    var C = isObject(ctx) ? ctx : {}, T = usableTimeline(C.timeline), L = usableLayout(C.layout);
    try {
      var text = typeof hash === "string" ? hash : "";
      if (text.charAt(0) === "#") text = text.slice(1);
      var tooLong = text.length > MAX_ADDRESS;
      if (tooLong) text = "";
      var parts = text === "" ? [] : text.split("&");
      if (parts.length > MAX_PARTS) { parts = parts.slice(0, MAX_PARTS); tooLong = true; }
      var seen = Object.create(null), dup = Object.create(null), raw = Object.create(null);
      for (var a = 0; a < parts.length; a++) {
        var eq = parts[a].indexOf("="), key = eq < 0 ? parts[a] : parts[a].slice(0, eq);
        if (ADDRESS_PARTS.indexOf(key) < 0) continue;                                // an unknown key is skipped, never named
        if (seen[key] === true) { dup[key] = true; continue; }
        seen[key] = true;
        raw[key] = eq < 0 ? "" : parts[a].slice(eq + 1);
      }
      var vals = Object.create(null);
      ADDRESS_PARTS.forEach(function (key) {
        if (seen[key] !== true) return;
        var v = null;
        if (dup[key] !== true) { try { v = decodeURIComponent(raw[key]); } catch (e) { v = null; } }
        if (v === null || (key !== "q" && CONTROL_RE.test(v))) { ignored.push(key); return; }
        vals[key] = v;
      });
      function bad(key) { ignored.push(key); }
      function wait(key) { pending.push(key); pendingText[key] = raw[key]; }

      if (vals.at !== undefined) {
        if (T === null) wait("at");
        else if (validAt(vals.at, true) && addressOk(T, vals.at, C.today)) out.at = vals.at; else bad("at");
      }
      if (vals.sel !== undefined) {
        if (L === null) wait("sel");
        else if (validTicker(vals.sel) && nodeOfTicker(L, vals.sel) >= 0) out.sel = vals.sel; else bad("sel");
      }
      if (vals.cat !== undefined) {
        if (T === null || L === null) wait("cat");
        else {
          var cut = vals.cat.lastIndexOf("@"), ct = cut < 0 ? "" : vals.cat.slice(0, cut), cd = cut < 0 ? "" : vals.cat.slice(cut + 1);
          if (validTicker(ct) && isDay(cd) && addressOk(T, cd, C.today) && nodeOfTicker(L, ct) >= 0) out.cat = { t: ct, day: cd }; else bad("cat");
        }
      }
      if (vals.kinds !== undefined) {
        var toks = vals.kinds.split(","), ks = { news: false, comove: false }, good = true;
        for (var q = 0; q < toks.length; q++) { if (KIND_NAMES.indexOf(toks[q]) < 0) good = false; else ks[toks[q]] = true; }
        if (good) out.kinds = ks; else bad("kinds");
      }
      if (vals.mine !== undefined) { if (vals.mine === "1" || vals.mine === "0") out.mine = vals.mine === "1"; else bad("mine"); }
      if (vals.ease !== undefined) { if (NUMBER_RE.test(vals.ease)) out.ease = easeOf(Number(vals.ease)); else bad("ease"); }
      if (vals.q !== undefined) {
        var qt = vals.q.trim();
        if (validQuery(qt)) out.q = qt; else bad("q");
      }
      if (vals.scoreboard !== undefined) { if (vals.scoreboard === "1" || vals.scoreboard === "0") out.scoreboard = vals.scoreboard === "1"; else bad("scoreboard"); }
      if (vals.now !== undefined) { if (validNow(vals.now)) out.now = vals.now; else bad("now"); }
      if (tooLong) ignored.push(TOO_LONG);
    } catch (e) {
      // Nothing above throws; if something did, the address is read as empty rather than half read.
      out = { at: null, sel: null, cat: null, kinds: { news: true, comove: true }, mine: false, ease: null, q: "", scoreboard: false, now: null };
      ignored = ADDRESS_PARTS.slice(); pending = []; pendingText = Object.create(null);
    }
    Object.defineProperty(out, "ignored", { value: ignored, enumerable: false });
    Object.defineProperty(out, "pending", { value: pending, enumerable: false });
    Object.defineProperty(out, "pendingText", { value: pendingText, enumerable: false });
    return out;
  }

  function enc(v) { return encodeURIComponent(v).replace(/%40/g, "@").replace(/%3A/gi, ":").replace(/%2C/gi, ","); }

  var SAFE_RAW = /^[A-Za-z0-9._~%@:,!*'()+\-]*$/;

  // The address of a state shaped like parseHash's result. Only values that parse would accept are written, so what is
  // written reads back as itself; anything else is left out. Never throws. "" when there is nothing to write.
  // THE RULE for a result that has `pending` parts (read before the data was in): its address must not be rewritten from the
  // result, because those parts are null in it and a rewrite would erase them. The page writes the address only after the pass
  // with data. If it is called anyway, formatHash returns the pending parts as they were written (their own text, only when it
  // is made of address characters), in their place, so that nothing the reader sent is lost.
  function formatHash(state) {
    try {
      var s = isObject(state) ? state : {}, parts = [];
      var waiting = Array.isArray(s.pending) && isObject(s.pendingText) ? s.pending : [];
      function kept(key) {
        var v = waiting.indexOf(key) >= 0 && Object.prototype.hasOwnProperty.call(s.pendingText, key) ? s.pendingText[key] : null;
        return typeof v === "string" && v.length <= MAX_ADDRESS && SAFE_RAW.test(v) ? key + "=" + v : null;
      }
      var k;
      if (validAt(s.at, true)) parts.push("at=" + enc(s.at)); else if ((k = kept("at")) !== null) parts.push(k);
      if (validTicker(s.sel)) parts.push("sel=" + enc(s.sel)); else if ((k = kept("sel")) !== null) parts.push(k);
      if (isObject(s.cat) && validTicker(s.cat.t) && isDay(s.cat.day)) parts.push("cat=" + enc(s.cat.t + "@" + s.cat.day)); else if ((k = kept("cat")) !== null) parts.push(k);
      var ks = kindsOn(s.kinds);
      if (!(ks.news && ks.comove)) parts.push("kinds=" + (ks.news ? "news" : "comove"));
      if (s.mine === true) parts.push("mine=1");
      if (isNum(s.ease)) parts.push("ease=" + String(easeOf(Math.round(s.ease * 1e6) / 1e6)));
      if (typeof s.q === "string" && validQuery(s.q.trim()) && s.q.trim() !== "") parts.push("q=" + enc(s.q.trim()));
      if (s.scoreboard === true) parts.push("scoreboard=1");
      if (validNow(s.now)) parts.push("now=" + enc(s.now));
      return parts.length ? "#" + parts.join("&") : "";
    } catch (e) {
      return "";
    }
  }

  var MapCore = {
    CLOSED: CLOSED, LOOKBACK: LOOKBACK, KIND: KIND, STEP_MS: STEP_MS, DecodeError: DecodeError,
    zFromPair: zFromPair, levelOfZ: levelOfZ, levelOfLetter: levelOfLetter, lvLevel: lvLevel, isKnownLevel: isKnownLevel,
    decodeFrame: decodeFrame, decodeFile: decodeFile,
    dayNumber: dayNumber, timeline: timeline, monthCache: monthCache,
    easeDur: easeDur, player: player, progress: progress, needsFrames: needsFrames, coreLayout: coreLayout,
    MAX_THREADS: MAX_THREADS, DIED_AFTER: DIED_AFTER, ATTENTION_FROM: ATTENTION_FROM,
    bind: bind, edgeIndex: edgeIndex, capForm: capForm, echoState: echoState, scene: scene, trailRows: trailRows, followedOf: followedOf, capAt: capAt, capRadius: capRadius, bend: bend,
    staleness: staleness, sentence: sentence, liveNextOf: liveNextOf, captions: captions, placeCaptions: placeCaptions,
    dialModel: dialModel, dialFrac: dialFrac,
    TAP_RADIUS: TAP_RADIUS, ZOOM_MAX: ZOOM_MAX, MAX_QUERY: MAX_QUERY, LAYOUT_MODES: LAYOUT_MODES, layoutMode: layoutMode,
    fitView: fitView, toScreen: toScreen, toWorld: toWorld, zoomAt: zoomAt, panBy: panBy, edgeRankAt: edgeRankAt, layoutTurn: layoutTurn, turnedXY: turnedXY,
    grid: grid, hit: hit, visibleEdges: visibleEdges, mineSet: mineSet, search: search,
    ui: ui, newestSource: newestSource, selectionView: selectionView, cascadeOf: cascadeOf, record: record,
    parseHash: parseHash, formatHash: formatHash, addressEntry: addressEntry, nodeOfTicker: nodeOfTicker, nowMs: nowMs,
  };
  return MapCore;
})();
if (typeof module === "object" && module.exports) module.exports = MapCore;
