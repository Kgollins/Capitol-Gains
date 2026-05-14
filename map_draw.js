/* MapDraw: the ripple map's drawing on canvas. The ground, a cap for each stock, the threads between linked stocks, the
   hyphae that carry an echo, the dials as growth rings and the soil core. It draws what the scene says and nothing else:
   every mark, colour, size and motion here is read from a field of the scene (which comes from the record) or from the
   layout. The ground is the one exception, and it carries no meaning: it is seeded, static, fainter than the faintest
   real thread, and it never moves.

   Nothing here touches the page when the file is loaded; every function draws into a context it is given. Sizes are in
   CSS pixels: the caller scales the context for the screen's pixel ratio. The marks are matte: no blur or shadow anywhere,
   and light (a soft additive glow) is drawn in one place only, the living light at the end of this file, where every light
   is a recorded move replayed: a pulse travelling its recorded row, the stock it reached flaring, a loud cap breathing at
   its recorded level, a catalyst's hit. */
var MapDraw = (function () {
  "use strict";

  var TAU = Math.PI * 2;
  // The sketch's colours, and the spore print of a dropped cap. Two sets: the earthy one (the dashboard's Map tab, and the
  // tokens of world.css) and the spectrum (the site's map page, which calls useSpectrum()): void for the ground, cyan for
  // "moved with it", magenta for "against", acid lime for a holding's ring, near white for a loud cap. Same names, other inks.
  var EARTH = Object.freeze({
    peat: "#231a14", bone: "#e9dfc8", ch: "#f2a03d", chG: "#a9611c", chS: "#d9862a", am: "#7d5ba6", amG: "#4b336c",
    amS: "#664890", moss: "#6f8f4e", ash: "#6b5a4a", print: "#3a2c22", printGill: "#4a392c",
  });
  var SPECTRUM = Object.freeze({
    peat: "#0b0820", bone: "#f3eaff", ch: "#3ef0ff", chG: "#157d99", chS: "#8af3ff", am: "#ff3fb4", amG: "#8f1a66",
    amS: "#d92b97", moss: "#c8ff3a", ash: "#6f6aa8", print: "#17113a", printGill: "#2d2766",
  });
  var EXTRA = {
    earth: { bone: "233,223,200", gill: "#8c7c61", stipe: "#c4b38e", label: "#ddd1b6", leader: "#b8ab92", mix: [[233, 35], [223, 26], [200, 20]] },
    spectrum: { thread: "104,96,214", bone: "243,234,255", gill: "#8f86d6", stipe: "#c9c4f2", label: "#cfd2f5", leader: "#a7abdf", mix: [[243, 24], [234, 18], [255, 70]] },
  };
  var PALETTE = EARTH;                      // what the module exports: the default, and what world.css's tokens match
  var PAL = EARTH, EX = EXTRA.earth, SPEC = false;   // the set in use
  var BONE = EX.bone, THREAD = EX.thread || EX.bone, LABEL_INK = EX.label, LEADER_INK = EX.leader;
  var CAP_INKS = {}, TONE_INK = {};
  function capInks() {
    CAP_INKS.loud = [PAL.bone, EX.gill, EX.stipe]; CAP_INKS["with"] = [PAL.ch, PAL.chG, PAL.chS];
    CAP_INKS.catalyst = [PAL.ch, PAL.chG, PAL.chS]; CAP_INKS.against = [PAL.am, PAL.amG, PAL.amS];
    TONE_INK["with"] = PAL.ch; TONE_INK.against = PAL.am;
    BONE = EX.bone; THREAD = EX.thread || EX.bone; LABEL_INK = EX.label; LEADER_INK = EX.leader;
  }
  // What the overview lights (contracts ruling 31, narrowed by the Task 21 finish review): the pulses of the followed
  // catalysts (the captioned ones, or the isolated one) grow in full tone and light the caps they reach. The step's other
  // pulses, and earlier days' echoes on the trail of a followed catalyst, lie still in the same ink at one fixed alpha over
  // the peat, for the thread and the cap alike.
  var TRAIL_ALPHA = 0.5;
  // The step's pulses of catalysts nobody follows lie further back still (REST_ALPHA, the thread only; the cap each reached
  // keeps the trail's alpha), so the followed ripples and the travelling light read first and the rest is texture.
  var REST_ALPHA = 0.09;
  function stubInk() { return SPEC ? "rgba(" + THREAD + ",0.07)" : "rgba(" + BONE + "," + STUB[1] + ")"; }   // the spectrum page lays the dead ends back: on a busy day they were a white mat
  var STUB = [1.2, 0.32];                              // a died catalyst's stubs: width at the catalyst, alpha
  var FLUSH_AT = 0.7;                                  // a reached cap takes its tone over the last 30% of a pulse's growth
  var LINK_OVERVIEW = [0.07, 0.5], LINK_FOLLOWED = [0.46, 0.9]; var LINK_SPEC = [0.08, 0.5];   // a day's links not moved yet: alpha, width (the overview's lie back: a busy day has thousands)

  // A quiet cap is a dot of bone mixed into peat, one tint per size tier: the larger the company, the lighter the dot.
  // Brightness has to record something, so it is never drawn from a hash. A tier the file does not name is drawn as mid.
  var QUIET_MIX = { small: 0.46, mid: 0.52, large: 0.58, mega: 0.64 };
  function mixInk(k) {
    function m(q) { return Math.round(q[1] + (q[0] - q[1]) * k); }
    return "rgb(" + m(EX.mix[0]) + "," + m(EX.mix[1]) + "," + m(EX.mix[2]) + ")";
  }
  var QUIET_INK = {};
  function inks() { capInks(); Object.keys(QUIET_MIX).forEach(function (t) { QUIET_INK[t] = mixInk(QUIET_MIX[t]); }); }
  inks();
  // The page asks for the spectrum once, before it draws anything (the halos round the caps come with it).
  function useSpectrum(on, name) {
    var set = SPEC_SETS[name] || SPEC_SETS.acid;
    SPEC = on !== false; PAL = SPEC ? set.pal : EARTH; EX = SPEC ? set.ex : EXTRA.earth; LIGHT = SPEC ? set.light : LIGHT_INK;
    LIGHT_GROUND = SPEC && set.ground === "light";
    // The site's map draws catalysts smaller, with a thinner cut of ground round them: a busy day has a hundred.
    CATALYST_SCALE = SPEC ? 0.62 : 0.8; PEAT_RING = SPEC ? 1.4 : 2.2;
    HALO_ON = false; SPRITES = {}; inks();   // no fractal halos round the caps: they hid the dots (setHalo(true) brings them back)
  }
  function palette() { return PAL; }
  function quietInk(tier) { return Object.prototype.hasOwnProperty.call(QUIET_INK, tier) ? QUIET_INK[tier] : QUIET_INK.mid; }

  // The thread weights (see drawThreads for which are drawn at which zoom). Each cap keeps its STRONG strongest links (by the layout's rank, which is the cap's own order of its
  // links on each sheet; the sheets interleaved rank by rank) as bone threads, the strongest the brightest and widest
  // (THREAD_TIERS: alpha, width); a link two caps share takes the stronger of its places. Every other link is left out at
  // the fitted zoom and drawn close to the ground (FAINT_THREAD) when zoomed in, still above the ground's own filaments.
  var STRONG = 2, THREAD_GAIN = 1;                   // the spectrum page lays the weave well back: dots and ripples read over it
  var THREAD_TIERS = [[0.26, 0.75], [0.1, 0.5]];
  var FAINT_THREAD = [0.065, 0.45];
  var THREAD_ALPHA = [THREAD_TIERS[0][0], FAINT_THREAD[0]];
  var CORD_WIDTH = 0.4, CORD_SHARE = 0.6;              // a cord's three strands together carry about one thread's ink
  var HELD_RING = 1.7, PEAT_RING = 2.2, DIM_ALPHA = 0.25;

  // MapCore: the page's global, or the module beside this file in Node (read only when a drawing needs it).
  function core() { return typeof MapCore !== "undefined" ? MapCore : require("./map_core.js"); }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function hashText(s) {
    var h = 2166136261;
    for (var a = 0; a < s.length; a++) h = Math.imul(h ^ s.charCodeAt(a), 16777619) >>> 0;
    return h >>> 0;
  }

  // ---- curves ----

  // The control points of a thread from a to b with the bend [o0, o1] (shares of its length, across it).
  function ctrl(a, b, o) {
    var dx = b.x - a.x, dy = b.y - a.y;
    return [{ x: a.x + dx / 3 - dy * o[0], y: a.y + dy / 3 + dx * o[0] }, { x: a.x + 2 * dx / 3 - dy * o[1], y: a.y + 2 * dy / 3 + dx * o[1] }];
  }
  function point(a, c, b, t) {
    var u = 1 - t;
    return { x: u * u * u * a.x + 3 * u * u * t * c[0].x + 3 * u * t * t * c[1].x + t * t * t * b.x,
             y: u * u * u * a.y + 3 * u * u * t * c[0].y + 3 * u * t * t * c[1].y + t * t * t * b.y };
  }
  function slope(a, c, b, t) {
    var u = 1 - t;
    return { x: 3 * u * u * (c[0].x - a.x) + 6 * u * t * (c[1].x - c[0].x) + 3 * t * t * (b.x - c[1].x),
             y: 3 * u * u * (c[0].y - a.y) + 6 * u * t * (c[1].y - c[0].y) + 3 * t * t * (b.y - c[1].y) };
  }

  // A thread: the curve from a to b added to the current path (the caller strokes many at once).
  function thread(ctx, a, b, bend) {
    var c = ctrl(a, b, bend);
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(c[0].x, c[0].y, c[1].x, c[1].y, b.x, b.y);
  }

  // A cord between two colonies: three strands laid side by side, added to the current path.
  function cord(ctx, a, b, bend) {
    var o = bend.length === 2 ? bend : [0, 0];
    for (var k = -1; k <= 1; k++) thread(ctx, a, b, [o[0] * 0.5 + k * 0.03, o[1] * 0.5 - k * 0.02]);
  }

  // A tapered hypha along the thread from a to b, w0 wide at a and w1 wide at b, drawn from t0 to t1 of the way (the
  // growth of a pulse is t1 below 1). Added to the current path; `taper` fills it at once.
  function taperPath(ctx, a, b, bend, w0, w1, t0, t1) {
    if (!(t1 > t0)) return;
    var c = ctrl(a, b, bend), len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    var n = Math.max(5, Math.min(16, Math.round(len * (t1 - t0) / 10))), left = [], right = [], i;
    for (i = 0; i <= n; i++) {
      var f = i / n, t = t0 + (t1 - t0) * f, p = point(a, c, b, t), d = slope(a, c, b, t);
      var l = Math.sqrt(d.x * d.x + d.y * d.y) || 1, w = (w0 + (w1 - w0) * t) / 2;
      left.push(p.x - d.y / l * w, p.y + d.x / l * w);
      right.push(p.x + d.y / l * w, p.y - d.x / l * w);
    }
    ctx.moveTo(left[0], left[1]);
    for (i = 2; i < left.length; i += 2) ctx.lineTo(left[i], left[i + 1]);
    for (i = right.length - 2; i >= 0; i -= 2) ctx.lineTo(right[i], right[i + 1]);
    ctx.closePath();
  }
  // The part of the curve from t0 to t1, as its own four points (de Casteljau).
  function lerp(p, q, t) { return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }; }
  function split(p0, p1, p2, p3, t) {
    var a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t), d = lerp(a, b, t), e = lerp(b, c, t), f = lerp(d, e, t);
    return [[p0, a, d, f], [f, e, c, p3]];
  }
  function part(a, c, b, t0, t1) {
    var left = split(a, c[0], c[1], b, t1)[0];
    return t0 > 0 ? split(left[0], left[1], left[2], left[3], t0 / t1)[1] : left;
  }
  // A thin taper as `parts` stroked pieces of the curve, each the width of the taper at its middle, gathered by width
  // into `buckets` so thousands are stroked in a few calls. At the width of a settled echo it reads as the filled taper.
  function taperPieces(buckets, a, b, bend, w0, w1, t0, t1, parts) {
    if (!(t1 > t0)) return;
    var c = ctrl(a, b, bend);
    for (var k = 0; k < parts; k++) {
      var s0 = t0 + (t1 - t0) * k / parts, s1 = t0 + (t1 - t0) * (k + 1) / parts, w = Math.round((w0 + (w1 - w0) * (s0 + s1) / 2) * 10) / 10;
      (buckets[w] = buckets[w] || []).push(part(a, c, b, s0, s1));
    }
  }
  function strokePieces(ctx, buckets) {
    Object.keys(buckets).forEach(function (w) {
      var list = buckets[w];
      ctx.beginPath();
      for (var q = 0; q < list.length; q++) { var p = list[q]; ctx.moveTo(p[0].x, p[0].y); ctx.bezierCurveTo(p[1].x, p[1].y, p[2].x, p[2].y, p[3].x, p[3].y); }
      ctx.lineWidth = +w; ctx.stroke();
    });
  }
  function taper(ctx, a, b, bend, w0, w1, t0, t1, colour) {
    ctx.beginPath();
    taperPath(ctx, a, b, bend, w0, w1, t0, t1);
    ctx.fillStyle = colour;
    ctx.fill();
  }

  // ---- the marks of a stock ----

  // A cap seen from below: gills radiating from the stem. tone: loud (bone), with, against or catalyst.
  function cap(ctx, x, y, r, tone, rot) {
    var ink = CAP_INKS[tone] || CAP_INKS.loud, n, i;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = ink[0]; ctx.fill();
    if (r < 3.2) return;                                  // too small for gills to read
    n = Math.max(12, Math.round(r * 3.2));
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      var a = rot + i / n * TAU, r0 = (i % 2 ? 0.5 : 0.3) * r;
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92);
    }
    ctx.strokeStyle = ink[1]; ctx.lineWidth = Math.max(0.5, r * 0.075); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * 0.24, 0, TAU); ctx.fillStyle = ink[2]; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r - 0.35, 0, TAU); ctx.lineWidth = 0.7; ctx.strokeStyle = ink[1]; ctx.stroke();
  }

  // A closed cap: a dot. shade is the size tier (one tint each) or, for a quiet stock an echo reached, its tone.
  function closedCap(ctx, x, y, r, shade) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = TONE_INK[shade] || quietInk(shade);
    ctx.fill();
  }

  // A dropped cap: the print its gills left on the ground, and the small cap set off it (ash, or its tone when an echo
  // reached it). The print's size follows the cap's; only the direction of the offset comes from the stock's name.
  function sporePrint(ctx, x, y, r, rot) {
    var p = r * 2.6, i;
    ctx.beginPath(); ctx.arc(x, y, p, 0, TAU); ctx.fillStyle = PAL.print; ctx.fill();
    ctx.beginPath();
    for (i = 0; i < 18; i++) {
      var a = rot + i / 18 * TAU;
      ctx.moveTo(x + Math.cos(a) * p * 0.28, y + Math.sin(a) * p * 0.28);
      ctx.lineTo(x + Math.cos(a) * p * 0.95, y + Math.sin(a) * p * 0.95);
    }
    ctx.strokeStyle = PAL.printGill; ctx.lineWidth = 0.55; ctx.stroke();
  }
  function fallenCap(ctx, x, y, r, rot, tone) {
    ctx.beginPath(); ctx.arc(x + Math.cos(rot) * r * 0.45, y + Math.sin(rot) * r * 0.45, r, 0, TAU);
    ctx.fillStyle = TONE_INK[tone] || PAL.ash; ctx.fill();
  }
  function droppedCap(ctx, x, y, r, rot, tone) {
    sporePrint(ctx, x, y, r, rot);
    fallenCap(ctx, x, y, r, rot, tone);
  }

  // A stock with no reading: a hollow ring where its cap would be; in its tone's ink when a pulse reached it (or on a trail),
  // never a filled dot. Unknown is drawn as unknown.
  var NO_READING_R = 2.0;
  function noReading(ctx, x, y, tone) {
    ctx.beginPath(); ctx.arc(x, y, NO_READING_R, 0, TAU);
    ctx.strokeStyle = TONE_INK[tone] || "rgba(" + BONE + ",0.42)"; ctx.lineWidth = TONE_INK[tone] ? 1.1 : 0.8; ctx.stroke();
  }

  // ---- the ground ----

  // Peat with grains of humus, patches, leaf litter and loose filaments, from a seed. It records nothing, so it stays
  // matte and faint: its filaments are drawn at alpha .055 or less, below the faintest real thread (.065).
  var FILAMENT_ALPHA = [0.025, 0.055];
  function ground(ctx, w, h, seed) {
    if (SPEC) { ctx.clearRect(0, 0, w, h); return; }   // the spectrum's page paints its own veil over the scene (map_page.js)
    var R = mulberry32(isNum(seed) ? seed : 7), area = Math.max(0.05, w * h / (1440 * 900)), i, k;
    function gauss() { var u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * R()); }
    ctx.fillStyle = PAL.peat; ctx.fillRect(0, 0, w, h);
    var grains = ["#2b2019", "#1c140f", "#2f241c", "#1f1611", "#33271e"];
    for (i = 0; i < 14000 * area; i++) {
      var gx = R() * w, gy = R() * h, s = R() < 0.85 ? 1 : 1.6 + R() * 1.2;
      ctx.fillStyle = grains[Math.floor(R() * grains.length)];
      ctx.fillRect(gx, gy, s, s * (0.6 + R() * 0.6));
    }
    for (i = 0; i < 70 * area; i++) {
      var cx = R() * w, cy = R() * h, rr = 40 + R() * 140, pts = [];
      for (k = 0; k < 12; k++) { var a = k / 12 * TAU, q = rr * (0.65 + R() * 0.55); pts.push([cx + Math.cos(a) * q, cy + Math.sin(a) * q * 0.75]); }
      ctx.beginPath(); ctx.moveTo((pts[0][0] + pts[11][0]) / 2, (pts[0][1] + pts[11][1]) / 2);
      for (k = 0; k < 12; k++) { var p0 = pts[k], p1 = pts[(k + 1) % 12]; ctx.quadraticCurveTo(p0[0], p0[1], (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2); }
      ctx.fillStyle = R() < 0.5 ? "rgba(56,42,31,0.12)" : "rgba(18,12,8,0.14)"; ctx.fill();
    }
    for (i = 0; i < 140 * area; i++) {
      ctx.beginPath(); ctx.ellipse(R() * w, R() * h, 1.2 + R() * 2.2, 0.8 + R() * 1.4, R() * TAU, 0, TAU);
      ctx.fillStyle = R() < 0.5 ? "#2c2119" : "#30251c"; ctx.fill();
    }
    for (i = 0; i < 26 * area; i++) leaf(ctx, R() * w, R() * h, 24 + R() * 44, R() * TAU);
    ctx.lineWidth = 0.5;
    for (i = 0; i < 520 * area; i++) filament(ctx, R, gauss, R() * w, R() * h, R() * TAU, 10 + Math.floor(R() * 28),
                                              FILAMENT_ALPHA[0] + R() * (FILAMENT_ALPHA[1] - FILAMENT_ALPHA[0]), 0);
  }
  function leaf(ctx, x, y, len, a) {
    var w = len * 0.3, k;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.quadraticCurveTo(0, -w, len / 2, 0); ctx.quadraticCurveTo(0, w, -len / 2, 0);
    ctx.fillStyle = "#291f17"; ctx.fill();
    ctx.beginPath(); ctx.moveTo(-len / 2 - len * 0.14, 0); ctx.lineTo(len / 2, 0);
    for (k = 1; k < 6; k++) {
      var xx = -len / 2 + k * len / 6, hh = w * 0.5 * (1 - Math.abs(xx) / (len / 2));
      ctx.moveTo(xx, 0); ctx.lineTo(xx + len * 0.09, -hh); ctx.moveTo(xx, 0); ctx.lineTo(xx + len * 0.09, hh);
    }
    ctx.strokeStyle = "#312519"; ctx.lineWidth = 0.7; ctx.stroke(); ctx.restore();
  }
  function filament(ctx, R, gauss, x, y, ang, steps, alpha, depth) {
    ctx.beginPath(); ctx.moveTo(x, y);
    for (var s = 0; s < steps; s++) {
      ang += gauss() * 0.2; x += Math.cos(ang) * 3.1; y += Math.sin(ang) * 3.1; ctx.lineTo(x, y);
      if (depth < 2 && R() < 0.035) filament(ctx, R, gauss, x, y, ang + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.6), Math.floor(steps * 0.5), alpha * 0.85, depth + 1);
    }
    ctx.strokeStyle = "rgba(" + BONE + "," + alpha.toFixed(3) + ")"; ctx.lineWidth = 0.5; ctx.stroke();
  }

  // ---- reading the scene ----

  // Screen positions of the layout's nodes, [x0, y0, x1, y1, ...], for a view; NaN for a node with no usable place.
  function positions(layout, view) {
    var nodes = layout && Array.isArray(layout.nodes) ? layout.nodes : [], out = new Float32Array(2 * nodes.length), C = core();
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i] || {}, p = isNum(n.x) && isNum(n.y) ? C.toScreen(view, n.x, n.y) : [NaN, NaN];
      out[2 * i] = p[0]; out[2 * i + 1] = p[1];
    }
    return out;
  }
  function placed(pos, i) { return i >= 0 && 2 * i + 1 < pos.length && pos[2 * i] === pos[2 * i] && pos[2 * i + 1] === pos[2 * i + 1]; }
  function at(pos, i) { return { x: pos[2 * i], y: pos[2 * i + 1] }; }
  // The stocks' names and the threads' bends, worked out once per layout (not on every frame).
  var NAMES = new WeakMap(), BENDS = new WeakMap();
  function names(layout) {
    var nodes = layout && Array.isArray(layout.nodes) ? layout.nodes : [];
    if (layout && typeof layout === "object" && NAMES.has(layout)) return NAMES.get(layout);
    var out = nodes.map(function (n, i) { return n && typeof n.t === "string" ? n.t : "#" + i; });
    if (layout && typeof layout === "object") NAMES.set(layout, out);
    return out;
  }
  function bendOf(nm, i, j) {
    var memo = BENDS.get(nm);
    if (!memo) { memo = new Map(); BENDS.set(nm, memo); }
    var key = i * 1048576 + j, got = memo.get(key);
    if (!got) { got = core().bend(nm[i], nm[j]); memo.set(key, got); }
    return got;
  }
  // The orientation of a cap's gills and of a dropped cap's offset: from the stock's name, so it never changes.
  function turn(name) { return (hashText(name) % 6283) / 1000; }
  function level(v) { return core().isKnownLevel(v) && v !== 0 ? Math.abs(v) : 1; }

  // ---- what the overview lights ----

  // The marks of one step that the two layers share, worked out once per scene and trail. The pulses that grow, in full tone:
  // those of the followed catalysts (opts.trail, a set of their nodes: the captioned ones, strongest first), or every pulse
  // when a catalyst is isolated or no trail is given. The other pulses of the step (ripples of catalysts nobody follows) lie
  // still at the trail's thin weight, with the earlier days. Then the caps a growing pulse reaches (with its tone), the caps
  // a growing pulse leaves from or passes through (drawn above the pulse, so on the moving layer), and the trail: every
  // settled echo when a catalyst is isolated, else those of the followed catalysts, with the still pulses, the caps they
  // reached and the tone that reached them.
  var MARKS = new WeakMap();
  function marksOf(scene, trail) {
    var given = trail instanceof Set, key = given ? Array.from(trail).sort(function (x, y) { return x - y; }).join(",") : "*";
    var memo = MARKS.get(scene);
    if (memo && memo.key === key) return memo.marks;
    var lit = new Map(), touched = new Set(), pulses = Array.isArray(scene.pulses) ? scene.pulses : [], grow = [], still = [], a;
    var iso = !!scene.isolated, all = iso || !given;
    for (a = 0; a < pulses.length; a++) {
      var p = pulses[a];
      if (!all && !trail.has(p.src)) { still.push(p); continue; }
      grow.push(p);
      if (!lit.has(p.dst)) lit.set(p.dst, p.tone);
      touched.add(p.src); if (p.via >= 0) touched.add(p.via);
    }
    // An isolated catalyst's scene holds its rows in full; a captioned one's rows come whole from trailRows, never cut by the
    // overview's cap on threads.
    var C = core(), reached = new Map();
    var echoes = iso ? (Array.isArray(scene.echoes) ? scene.echoes : [])
                     : typeof C.trailRows === "function" && scene.settled ? C.trailRows(scene, trail)
                     : (Array.isArray(scene.echoes) ? scene.echoes : []).filter(function (e) { return given && trail.has(e.src); });
    for (a = 0; a < echoes.length; a++) if (!reached.has(echoes[a].dst)) reached.set(echoes[a].dst, echoes[a].tone);
    for (a = 0; a < still.length; a++) if (!reached.has(still[a].dst)) reached.set(still[a].dst, still[a].tone);
    var marks = { lit: lit, touched: touched, grow: grow, still: still, trail: echoes, reached: reached, followed: iso ? null : given ? trail : new Set() };
    MARKS.set(scene, { key: key, marks: marks });
    return marks;
  }

  // Every cap is drawn at its recorded radius times one factor for the kind of screen (MapCore.LAYOUT_MODES marks): a phone's
  // field is small, so its marks are scaled down together and a loud cap does not cover its quiet neighbours. The page sets it.
  var MARK_SCALE = 1;
  function setMarkScale(f) { MARK_SCALE = isNum(f) && f > 0 ? f : 1; }
  function markScale() { return MARK_SCALE; }
  // A catalyst's cap is drawn at CATALYST_SCALE of its recorded radius: a busy day has eighty of them, and at full size they
  // hide the ripples they are there to explain. They stay the largest caps on the field, a large company's larger still.
  var CATALYST_SCALE = 0.8;
  // A cap's radius on the screen at progress u of a step: eased between its two recorded looks (MapCore.capAt), each at its
  // own scale. The page reads every ring and leader from here, so they sit on the cap as drawn.
  function radiusAt(c, u) {
    var C = core(), t = isNum(u) ? Math.min(1, Math.max(0, u)) : 1, r0 = C.capAt(c, 0).r, r1 = C.capAt(c, 1).r;
    var was = c && (c.prevCatalyst === undefined ? c.catalyst : c.prevCatalyst) === true, is = !!c && c.catalyst === true;
    r0 *= was ? CATALYST_SCALE : 1; r1 *= is ? CATALYST_SCALE : 1;
    return (r0 + (r1 - r0) * t) * MARK_SCALE;
  }

  // A cap's look at progress u of a step, by the overview's rule: its own recorded state (radius and form from capAt, the
  // tone left out), in full tone once a pulse of this step has reached it, or in its trail tone at TRAIL_ALPHA when it lies on
  // a followed catalyst's trail. A catalyst is always a catalyst.
  function lookOf(c, u, M) {
    var C = core(), own = c.tone === null || c.tone === undefined ? c : plainCap(c), look = C.capAt(own, u), tone = null, alpha = 1;
    if (look.colour !== "catalyst") {
      if (M.lit.has(c.node)) { if (u >= FLUSH_AT) tone = c.tone === "with" || c.tone === "against" ? c.tone : M.lit.get(c.node); }
      else if (M.reached.has(c.node)) { tone = M.reached.get(c.node); alpha = TRAIL_ALPHA; }
    }
    return { r: radiusAt(own, u), colour: look.colour, form: formAt(c, u), tone: tone, alpha: alpha };
  }
  function plainCap(c) { var o = {}; for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) o[k] = c[k]; o.tone = null; return o; }

  // A cap goes on the static layer when nothing about it changes within the step: not held (the ring and ticker are drawn on
  // top), not reached by a pulse of this step (it flushes to its tone), not where a pulse starts or turns, and the same look
  // at both ends of the step.
  function isStaticCap(c, M) {
    if (!c || c.held || c.prevHeld) return false;
    if (M && (M.lit.has(c.node) || M.touched.has(c.node))) return false;
    var C = core(), own = c.tone === null || c.tone === undefined ? c : plainCap(c), u0 = C.capAt(own, 0), u1 = C.capAt(own, 1);
    return u0.r === u1.r && u0.colour === u1.colour;
  }
  // The form a cap shows at progress u: its recorded form after the halfway point, its previous one before.
  function formAt(c, u) { return u >= 0.5 || c.prevForm === undefined ? c.form : c.prevForm; }

  // A ring of void round a cap that has a halo: the clean edge between the dot and the pattern behind it.
  function voidRing(ctx, x, y, r, L, pass) {
    if (!haloOf(L, pass) || !haloSprite(haloOf(L, pass).key)) return;
    ctx.beginPath(); ctx.arc(x, y, r + 1.5, 0, TAU); ctx.fillStyle = PAL.peat; ctx.fill();
  }
  function drawCap(ctx, c, pos, nm, u, pass, M) {
    var i = c.node, L = lookOf(c, u, M), p = at(pos, i), rot = turn(nm[i]), col = L.colour, tone = L.tone, base = c.dim ? DIM_ALPHA : 1;
    ctx.globalAlpha = base * (tone ? L.alpha : 1);
    if (pass === "print") { if (L.form === "dropped") { ctx.globalAlpha = base; sporePrint(ctx, p.x, p.y, L.r, rot); } }
    else if (L.form === "dropped") { if (pass === "small") fallenCap(ctx, p.x, p.y, L.r, rot, tone); }
    else if (col === "catalyst") {
      if (pass === "catalyst") {
        ctx.beginPath(); ctx.arc(p.x, p.y, L.r + PEAT_RING, 0, TAU); ctx.fillStyle = PAL.peat; ctx.fill();
        cap(ctx, p.x, p.y, L.r, "catalyst", rot);
      }
    } else if (L.form === "unknown" || col === "unknown") { if (pass === (tone ? "toned" : "small")) noReading(ctx, p.x, p.y, tone); }
    else if (tone) {
      if (pass === "toned") {
        voidRing(ctx, p.x, p.y, L.r, L, pass);
        if (L.form === "open") cap(ctx, p.x, p.y, L.r, tone, rot); else closedCap(ctx, p.x, p.y, L.r, tone);
      }
    } else if (col.indexOf("quiet-") === 0) { if (pass === "small") { voidRing(ctx, p.x, p.y, L.r, L, pass); closedCap(ctx, p.x, p.y, L.r, col.slice(6)); } }
    else if (pass === "open") { voidRing(ctx, p.x, p.y, L.r, L, pass); cap(ctx, p.x, p.y, L.r, "loud", rot); }   // open: a loud cap
    ctx.globalAlpha = 1;
    return L;
  }
  var PASSES = ["print", "small", "open", "toned", "catalyst"];

  // The halo of a cap: a patch of fractal in the cap's kind, stamped under the cap and fading to nothing (MMFractal.haloSprite).
  // A cap is ringed in void first, so its dot always reads against the pattern. A page without MMFractal (a test) has none.
  var HALO_PX = 96, HALOS = {}, HALO_ON = false;
  function setHalo(on) { HALO_ON = on !== false; }
  function haloSprite(key) {
    if (Object.prototype.hasOwnProperty.call(HALOS, key)) return HALOS[key];
    var F = typeof MMFractal !== "undefined" ? MMFractal : null, s = null;
    try { s = F && typeof F.haloSprite === "function" ? F.haloSprite(key, HALO_PX) : null; } catch (e) { s = null; }
    HALOS[key] = s;
    return s;
  }
  // Which halo a cap has in a pass, if the pass is the one that draws the cap (the same branches as drawCap).
  var HALO_BY_KIND = { "with": 1, against: 1, loud: 1, quiet: 1 };
  function haloOf(L, pass) {
    if (!HALO_ON || L.form === "dropped") return null;
    if (L.colour === "catalyst") return pass === "catalyst" ? { key: "with", reach: 2.9, a: 1 } : null;
    if (L.form === "unknown" || L.colour === "unknown") return null;
    if (L.tone) return pass === "toned" && HALO_BY_KIND[L.tone] ? { key: L.tone, reach: 2.8, a: 0.9 } : null;
    if (typeof L.colour === "string" && L.colour.indexOf("quiet-") === 0) return null;                      // quiet dots stay plain: a halo on every one is what hid the ones that matter
    return pass === "open" ? { key: "loud", reach: 2.3, a: 0.5 } : null;
  }
  function drawHalo(ctx, c, pos, u, pass, M) {
    var L = lookOf(c, u, M), h = haloOf(L, pass), s = h ? haloSprite(h.key) : null;
    if (!s) return;
    var p = at(pos, c.node), R = L.r * h.reach + 6;
    ctx.globalAlpha = (c.dim ? DIM_ALPHA : 1) * (L.tone ? L.alpha : 1) * h.a;
    ctx.drawImage(s, p.x - R, p.y - R, 2 * R, 2 * R);
    ctx.globalAlpha = 1;
  }
  function drawCaps(ctx, list, pos, nm, u, M) {
    for (var q = 0; q < PASSES.length; q++) {
      var pass = PASSES[q], a;
      if (HALO_ON && pass !== "print") for (a = 0; a < list.length; a++) if (placed(pos, list[a].node)) drawHalo(ctx, list[a], pos, u, pass, M);
      for (a = 0; a < list.length; a++) if (placed(pos, list[a].node)) drawCap(ctx, list[a], pos, nm, u, pass, M);
    }
  }

  // The path of an echo row: from its source, through its recorded middle stock when that stock is placed, to its stock.
  function legs(pos, nm, src, via, dst) {
    if (via >= 0 && placed(pos, via) && via !== src && via !== dst) {
      return [{ a: at(pos, src), b: at(pos, via), o: bendOf(nm, src, via) }, { a: at(pos, via), b: at(pos, dst), o: bendOf(nm, via, dst) }];
    }
    return [{ a: at(pos, src), b: at(pos, dst), o: bendOf(nm, src, dst) }];
  }
  function onScreen(p, w, h, m) { return p.x > -m && p.y > -m && p.x < w + m && p.y < h + m; }

  // ---- the layers ----

  // Each link's place among its cap's links: a Map from the pair (lo * 2^20 + hi) to {a, b, tier, cord}, tier 0 to STRONG - 1
  // for a cap's strongest links and STRONG for the rest. Worked out once per list of threads (a scene's list is frozen and
  // shared; the page's filtered lists are made once per filter).
  var TIERS = new WeakMap();
  function tiersOf(list) {
    if (TIERS.has(list)) return TIERS.get(list);
    var byCap = new Map(), out = new Map(), a;
    for (a = 0; a < list.length; a++) {
      var t = list[a];
      if (!t || !(t.r >= 1) || t.a === t.b) continue;
      if (!byCap.has(t.b)) byCap.set(t.b, []);
      byCap.get(t.b).push({ t: t, at: a });
    }
    byCap.forEach(function (mine) {
      mine.sort(function (x, y) { return x.t.r - y.t.r || x.at - y.at; });
      for (var q = 0; q < mine.length; q++) {
        var t = mine[q].t, lo = Math.min(t.a, t.b), hi = Math.max(t.a, t.b), key = lo * 1048576 + hi, tier = Math.min(q, STRONG), had = out.get(key);
        // rLo / rHi: the pair's best rank as each cap ranks it (a link's rank is its place among its destination's links);
        // m, the larger of the two, says how mutual the pair is (m <= 2: each is in the other's first two).
        var side = t.b === lo ? "rLo" : "rHi";
        if (!had) { had = { a: lo, b: hi, tier: tier, r: t.r, cord: !!t.cord, rLo: Infinity, rHi: Infinity, m: Infinity }; out.set(key, had); }
        else { if (tier < had.tier) had.tier = tier; if (t.r < had.r) had.r = t.r; if (t.cord) had.cord = true; }
        if (t.r < had[side]) had[side] = t.r;
        had.m = Math.max(had.rLo, had.rHi);
      }
    });
    TIERS.set(list, out);
    return out;
  }

  // The threads: each cap's strongest links as bone threads, weighted by their place (THREAD_TIERS): at the fitted zoom only
  // its first, and every thread fades with its length on the screen (FADE: from FADE_NEAR px to FADE_FAR px it falls to the
  // last step), so links that span the cloud recede and the near weave reads; when zoomed in (maxRank above the fitted
  // view's) its second too, and the other links up to maxRank close to the ground. Three-strand cords between colonies.
  // They change only with the view or the kinds switch, so the page draws them into a layer of their own, once per view.
  // opts: {layout, pos?, maxRank?, w, h}. Returns how many it drew.
  var FADE = [1, 0.7, 0.45, 0.28], FADE_NEAR = 36, FADE_FAR = 180;
  // The site's map lets a long thread fall away faster: the near weave (a colony's own links) reads and the lines that span
  // the cloud, which made it a hairball, stay as a trace.
  var FADE_SPEC = [1, 0.8, 0.55, 0.3];
  // The site's map at the fitted zoom draws only mutual pairs (each stock in the other's first MUTUAL links): about 580 of the
  // layout's 18,000 links. About 220 stocks then have no line at rest; the key says so ("pale threads: ...; the rest show on
  // hover or zoom"), a hovered stock shows its links (drawHover in map_page.js) and zooming in draws the rest as before.
  // THREAD_TIERS_SPEC: alpha and width of a mutual-first and a mutual-second pair.
  var MUTUAL = 2, THREAD_TIERS_SPEC = [[0.30, 0.8], [0.14, 0.6]];
  function fadeStep(a, b) {
    var len = Math.hypot(b.x - a.x, b.y - a.y), t = (len - FADE_NEAR) / (FADE_FAR - FADE_NEAR);
    return t <= 0 ? 0 : t >= 1 ? FADE.length - 1 : Math.min(FADE.length - 1, 1 + Math.floor(t * (FADE.length - 2)));
  }
  function across(layout, a, b) {
    var n = layout && Array.isArray(layout.nodes) ? layout.nodes : null;
    return !!n && !!n[a] && !!n[b] && typeof n[a].s === "string" && n[a].s !== n[b].s;
  }
  function drawThreads(ctx, scene, view, opts) {
    var o = opts || {}, C = core(), pos = o.pos || positions(o.layout, view), nm = names(o.layout), drawn = 0, b;
    var w = isNum(o.w) ? o.w : Infinity, h = isNum(o.h) ? o.h : Infinity;
    if (!scene) return 0;
    var maxRank = isNum(o.maxRank) ? o.maxRank : C.edgeRankAt(view), faint = maxRank > C.edgeRankAt(null), keep = faint ? STRONG : 1;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    var groups = {}, list = Array.isArray(scene.threads) ? scene.threads : [];
    var mutual = SPEC && !faint;
    tiersOf(list).forEach(function (e) {
      if (mutual) { if (!(e.m <= MUTUAL)) return; }
      else if (e.tier >= keep && !(faint && e.r <= maxRank)) return;
      if (!placed(pos, e.a) || !placed(pos, e.b)) return;
      var A = at(pos, e.a), B = at(pos, e.b);
      if (!onScreen(A, w, h, 40) && !onScreen(B, w, h, 40)) return;
      // The site's map lays a link between two colonies (sectors) back one step, so the colonies read as clumps.
      var tier = mutual ? e.m - 1 : e.tier >= keep ? STRONG : e.tier, key = tier * 10 + Math.min(FADE.length - 1, fadeStep(A, B) + (SPEC && across(o.layout, e.a, e.b) ? 1 : 0));
      (groups[key] = groups[key] || []).push(e);
    });
    Object.keys(groups).map(Number).sort(function (x, y) { return y - x; }).forEach(function (key) {
      var group = groups[key], tier = Math.floor(key / 10), f = (SPEC ? FADE_SPEC : FADE)[key % 10];
      // On a small field (the marks' scale under 1) the links are short on the screen and would all be drawn at their
      // brightest: they are laid back by the same measure, so the ripples stay above the weave.
      var look = mutual ? THREAD_TIERS_SPEC[tier] : tier < STRONG ? THREAD_TIERS[tier] : FAINT_THREAD, small = Math.max(0, Math.min(1, (1 - MARK_SCALE) / 0.3));
      var alpha = Math.max(FAINT_THREAD[0], look[0] * f * (1 - 0.45 * small)) * (SPEC ? THREAD_GAIN : 1);
      ctx.beginPath();
      for (b = 0; b < group.length; b++) if (mutual || !group[b].cord) { thread(ctx, at(pos, group[b].a), at(pos, group[b].b), bendOf(nm, group[b].a, group[b].b)); drawn++; }
      ctx.strokeStyle = "rgba(" + THREAD + "," + alpha.toFixed(3) + ")"; ctx.lineWidth = look[1]; ctx.stroke();
      ctx.beginPath();
      for (b = 0; b < group.length; b++) if (!mutual && group[b].cord) { cord(ctx, at(pos, group[b].a), at(pos, group[b].b), bendOf(nm, group[b].a, group[b].b)); drawn++; }
      ctx.strokeStyle = "rgba(" + THREAD + "," + (alpha * CORD_SHARE).toFixed(3) + ")"; ctx.lineWidth = Math.min(CORD_WIDTH, look[1]); ctx.stroke();
    });
    return drawn;
  }

  // A hovered stock's links: every pale thread touching it up to rank HOVER_RANK, at the first tier's weight (the rest of the
  // layout's links for one stock, which the mutual cut leaves out at rest). The list is made once per thread list and stock.
  var HOVER_RANK = 8, LINKS_OF = new WeakMap();
  function linksOf(list, node) {
    var memo = LINKS_OF.get(list);
    if (!memo) { memo = new Map(); LINKS_OF.set(list, memo); }
    if (memo.has(node)) return memo.get(node);
    var seen = new Set(), out = [];
    for (var a = 0; a < list.length; a++) {
      var t = list[a];
      if (!t || t.a === t.b || !(t.r >= 1 && t.r <= HOVER_RANK) || (t.a !== node && t.b !== node)) continue;
      var other = t.a === node ? t.b : t.a;
      if (!seen.has(other)) { seen.add(other); out.push({ a: node, b: other }); }
    }
    memo.set(node, out);
    return out;
  }
  // opts: {layout, pos}. Returns how many it drew.
  function drawLinksOf(ctx, scene, view, node, opts) {
    var o = opts || {}, pos = o.pos || positions(o.layout, view), nm = names(o.layout), list = scene && Array.isArray(scene.threads) ? scene.threads : [];
    if (!placed(pos, node)) return 0;
    var look = SPEC ? THREAD_TIERS_SPEC[0] : THREAD_TIERS[0], n = 0, ls = linksOf(list, node);
    ctx.save(); ctx.lineCap = "round"; ctx.beginPath();
    for (var a = 0; a < ls.length; a++) if (placed(pos, ls[a].b)) { thread(ctx, at(pos, node), at(pos, ls[a].b), bendOf(nm, node, ls[a].b)); n++; }
    ctx.strokeStyle = "rgba(" + THREAD + "," + Math.min(1, look[0] * 1.6).toFixed(3) + ")"; ctx.lineWidth = look[1]; ctx.stroke();
    ctx.restore();
    return n;
  }

  // The static layer of a step: the pale threads (unless opts.threads is false: the page keeps them in their own layer), the
  // day's links that have not moved yet (thread weight in the overview, brighter for a followed catalyst), the trail of
  // earlier days for an isolated or captioned catalyst (opts.trail: their nodes) at TRAIL_ALPHA, the stubs of catalysts that
  // died, and every cap that does not change within the step. opts: {layout, pos?, maxRank?, w, h, threads, trail}.
  // Returns what it drew, by kind; `trail` counts the earlier-day marks (threads and caps), so the key can name them.
  function drawStatic(ctx, scene, view, opts) {
    var o = opts || {}, pos = o.pos || positions(o.layout, view), nm = names(o.layout), a, b;
    var w = isNum(o.w) ? o.w : Infinity, h = isNum(o.h) ? o.h : Infinity;
    var drawn = { threads: 0, echoes: 0, still: 0, links: 0, stubs: 0, caps: 0, trail: 0, waiting: 0 };
    if (!scene) return drawn;
    var M = marksOf(scene, o.trail);
    if (o.threads !== false) drawn.threads = drawThreads(ctx, scene, view, o);
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    // The day's recorded rows that have not moved yet: plain bone threads, no tone.
    // On the site's map (the spectrum) the overview leaves out the rows of catalysts nobody follows: on a busy day they were
    // thousands of lines and hid the weave. They are counted (drawn.waiting), the key says so, and picking a catalyst
    // (isolating it) draws its rows in full. The followed catalysts' rows are always drawn.
    var links = Array.isArray(scene.links) ? scene.links : [];
    drawn.waiting = 0;
    [false, true].forEach(function (followed) {
      ctx.beginPath();
      for (var q = 0; q < links.length; q++) {
        var k = links[q], f = M.followed === null || M.followed.has(k.src);
        if (f !== followed || !placed(pos, k.src) || !placed(pos, k.dst)) continue;
        if (SPEC && !followed) { drawn.waiting++; continue; }
        var L = legs(pos, nm, k.src, k.via, k.dst);
        for (var z = 0; z < L.length; z++) thread(ctx, L[z].a, L[z].b, L[z].o);
        drawn.links++;
      }
      var look = followed ? LINK_FOLLOWED : LINK_OVERVIEW;
      // The site's map draws a followed catalyst's waiting rows as a light trace (LINK_SPEC): its ripple, when it comes, is the
      // bright thing.
      ctx.strokeStyle = "rgba(" + THREAD + "," + (SPEC ? LINK_SPEC[0] : look[0]).toFixed(3) + ")"; ctx.lineWidth = SPEC ? LINK_SPEC[1] : look[1]; ctx.stroke();
    });

    // The still pulses of the catalysts nobody follows (REST_ALPHA, laid first), then the trail of the followed catalysts'
    // earlier days (TRAIL_ALPHA): thin hyphae in their tone along the recorded path, thick at the source. Each tone of each
    // is stroked as one layer, so where they cross they do not add up to a brighter mark.
    ctx.lineCap = "butt";
    [[M.still, 1], [M.trail, 0]].forEach(function (pair) { ["against", "with"].forEach(function (tone) {
      var buckets = {}, any = false, isStill = pair[1];
      [pair[0]].forEach(function (rows) {
        for (var q = 0; q < rows.length; q++) {
          var e = rows[q];
          if (e.tone !== tone || !placed(pos, e.src) || !placed(pos, e.dst)) continue;
          var Ls = legs(pos, nm, e.src, e.via, e.dst), w0 = 0.7 + 0.35 * level(e.level), w1 = 0.35;
          if (!onScreen(Ls[0].a, w, h, 60) && !onScreen(Ls[Ls.length - 1].b, w, h, 60)) continue;
          if (Ls.length === 1) taperPieces(buckets, Ls[0].a, Ls[0].b, Ls[0].o, w0, w1, 0, 1, 3);
          else { taperPieces(buckets, Ls[0].a, Ls[0].b, Ls[0].o, w0, (w0 + w1) / 2, 0, 1, 2); taperPieces(buckets, Ls[1].a, Ls[1].b, Ls[1].o, (w0 + w1) / 2, w1, 0, 1, 2); }
          any = true;
          if (isStill) drawn.still++; else drawn.echoes++;
        }
      });
      if (!any) return;
      ctx.globalAlpha = isStill ? REST_ALPHA : TRAIL_ALPHA; ctx.strokeStyle = TONE_INK[tone]; strokePieces(ctx, buckets); ctx.globalAlpha = 1;
    }); });
    ctx.lineCap = "round";

    // A catalyst that died: short stubs on its one-link threads, STUB[0] wide at the catalyst and thinning to nothing over the
    // first 40% of the thread, in bone at STUB[1]: lighter than a growing pulse, so a dead end never reads as a ripple.
    var stubs = Array.isArray(scene.stubs) ? scene.stubs : [];
    ctx.beginPath();
    for (a = 0; a < stubs.length; a++) {
      var s = stubs[a];
      if (!placed(pos, s.src) || !placed(pos, s.dst)) continue;
      // The site's map leaves out the stubs of catalysts nobody follows (on 20 Nov, about 18,000: some 180 a catalyst) and
      // counts them with the rows the key says are drawn when a catalyst is picked.
      if (SPEC && M.followed !== null && !M.followed.has(s.src)) { drawn.waiting++; continue; }
      taperPath(ctx, at(pos, s.src), at(pos, s.dst), bendOf(nm, s.src, s.dst), STUB[0], -1.5 * STUB[0], 0, 0.4);
      drawn.stubs++;
    }
    ctx.fillStyle = stubInk(); ctx.fill();

    var caps = Array.isArray(scene.caps) ? scene.caps : [], still = [];
    for (a = 0; a < caps.length; a++) if (isStaticCap(caps[a], M)) still.push(caps[a]);
    drawCaps(ctx, still, pos, nm, 1, M);
    for (b = 0; b < still.length; b++) if (M.reached.has(still[b].node) && still[b].catalyst !== true && placed(pos, still[b].node)) drawn.trail++;
    drawn.caps = still.length;
    drawn.trail += drawn.echoes + drawn.still;
    return drawn;
  }

  // ---- the marks above the static layer, in three parts the page caches apart ----
  //   the pulses (drawPulses): grown along their recorded threads from one progress to another; they are opaque and only grow,
  //     so a layer of them can be grown frame by frame and is the same as one drawn whole;
  //   the caps above them that do not ease (drawAbove): where a pulse starts or turns, the caps a pulse reaches, and held caps,
  //     each in its own recorded look; within a step only a reached cap changes, once, when it flushes at FLUSH_AT;
  //   the caps that ease (drawEased): a cap whose two recorded looks differ, eased between them by capAt at every frame, and
  //     then the holdings' rings and tickers.
  // The tip of each growing pulse (drawPulseTips) is drawn on the screen at every frame, over the pulse layer.
  // drawDynamic draws all of it at once, for one progress.

  // Which non-static caps ease within the step and which do not, worked out once per scene and trail.
  function capsAbove(scene, M) {
    if (M.above) return M.above;
    var caps = Array.isArray(scene.caps) ? scene.caps : [], still = [], eased = [], C = core();
    for (var a = 0; a < caps.length; a++) {
      var c = caps[a];
      if (isStaticCap(c, M)) continue;
      var own = c.tone === null || c.tone === undefined ? c : plainCap(c), u0 = C.capAt(own, 0), u1 = C.capAt(own, 1);
      (u0.r === u1.r && u0.colour === u1.colour ? still : eased).push(c);
    }
    M.above = { still: still, eased: eased };
    return M.above;
  }

  // The growing pulses of the step (marksOf: the followed catalysts', or all when no trail is given) grown from progress
  // `from` to `to` (0 to 1): each a tapered hypha from its source toward its
  // stock (1.7 to 2.4 px at the source, by its level, down to 0.5), a two-link pulse through its recorded middle stock over
  // the first half and on to its stock over the second. A pulse is cut into a fixed grid of PULSE_CELLS cells of progress (half
  // of them on each leg of a two-link path); a cell is drawn once progress has passed its end, as one stroked piece of the
  // curve, the hypha's width at the cell's middle, with round ends. Each cell of a tone is stroked on its own (every pulse's
  // piece of that cell together), the cells in order, so the strokes are the same whether a step is reached by an ease, frame
  // by frame, or by a cut: a layer grown in steps is the one drawn whole. With opts.layered the pulses grow onto a layer that
  // holds only pulses: an against cell goes under what is there and a with cell over it, so with lies on top of against, as
  // in the whole draw (against first, with on top). Returns how many pulses it drew a cell of.
  var PULSE_CELLS = 16;
  var PULSE_W = [0.7, 0.5, 0.4];                       // a growing pulse: its width at the source is [0] + [1] x level, at its stock [2]
  function drawPulses(ctx, scene, view, from, to, opts) {
    var o = opts || {}, pos = o.pos || positions(o.layout, view), nm = names(o.layout), n = 0;
    var g0 = isNum(from) ? Math.max(0, Math.min(1, from)) : 0, g1 = isNum(to) ? Math.max(0, Math.min(1, to)) : 1;
    var c0 = Math.floor(g0 * PULSE_CELLS + 1e-9), c1 = Math.floor(g1 * PULSE_CELLS + 1e-9), half = PULSE_CELLS / 2;
    var pulses = scene ? marksOf(scene, o.trail).grow : [];
    if (!(c1 > c0) || !pulses.length) return 0;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ["against", "with"].forEach(function (tone) {
      var list = [];
      for (var q = 0; q < pulses.length; q++) {
        var p = pulses[q];
        if (p.tone !== tone || !placed(pos, p.src) || !placed(pos, p.dst)) continue;
        var w0 = PULSE_W[0] + PULSE_W[1] * level(p.level), w1 = PULSE_W[2];
        list.push({ L: legs(pos, nm, p.src, p.via, p.dst), w0: w0, w1: w1, wm: (w0 + w1) / 2 });
      }
      if (!list.length) return;
      n += list.length;
      ctx.globalCompositeOperation = o.layered && tone === "against" ? "destination-over" : "source-over";
      ctx.strokeStyle = TONE_INK[tone];
      for (var c = c0; c < c1; c++) {
        var buckets = {};
        for (var a = 0; a < list.length; a++) {
          var P = list[a];
          if (P.L.length === 1) taperPiecesOn(buckets, P.L[0], P.w0, P.w1, c / PULSE_CELLS, (c + 1) / PULSE_CELLS, 1);
          else if (c < half) taperPiecesOn(buckets, P.L[0], P.w0, P.wm, c / half, (c + 1) / half, 1);
          else taperPiecesOn(buckets, P.L[1], P.wm, P.w1, (c - half) / half, (c - half + 1) / half, 1);
        }
        strokePieces(ctx, buckets);
      }
      ctx.globalCompositeOperation = "source-over";
    });
    return n;
  }
  // The tip of each pulse at the true progress u: the part of the cell u lies in, from the cell's start to u, at the cell's own
  // width (so when the cell is finished and drawn on the pulse layer it covers the tip exactly). The page draws it straight on
  // the screen at every frame, above the pulse layer and under the caps, so the pulse grows on every frame and reaches its
  // stock exactly at u = 1, while the cached layer holds only finished cells and stays the same as a cut. Nothing at a cell's
  // end (u = 1 included). Returns how many tips it drew.
  function drawPulseTips(ctx, scene, view, u, opts) {
    var o = opts || {}, pos = o.pos || positions(o.layout, view), nm = names(o.layout), n = 0, half = PULSE_CELLS / 2;
    var g = isNum(u) ? Math.max(0, Math.min(1, u)) : 1, c = Math.floor(g * PULSE_CELLS + 1e-9), f = g * PULSE_CELLS - c;
    var pulses = scene ? marksOf(scene, o.trail).grow : [];
    if (c >= PULSE_CELLS || !(f > 1e-9) || !pulses.length) return 0;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ["against", "with"].forEach(function (tone) {
      var buckets = {}, any = false;
      for (var q = 0; q < pulses.length; q++) {
        var p = pulses[q];
        if (p.tone !== tone || !placed(pos, p.src) || !placed(pos, p.dst)) continue;
        var L = legs(pos, nm, p.src, p.via, p.dst), w0 = PULSE_W[0] + PULSE_W[1] * level(p.level), w1 = PULSE_W[2], wm = (w0 + w1) / 2, leg, a0, a1, t0, t1;
        if (L.length === 1) { leg = L[0]; a0 = w0; a1 = w1; t0 = c / PULSE_CELLS; t1 = (c + 1) / PULSE_CELLS; }
        else if (c < half) { leg = L[0]; a0 = w0; a1 = wm; t0 = c / half; t1 = (c + 1) / half; }
        else { leg = L[1]; a0 = wm; a1 = w1; t0 = (c - half) / half; t1 = (c - half + 1) / half; }
        var w = Math.round((a0 + (a1 - a0) * (t0 + t1) / 2) * 10) / 10, cc = ctrl(leg.a, leg.b, leg.o);
        (buckets[w] = buckets[w] || []).push(part(leg.a, cc, leg.b, t0, t0 + (t1 - t0) * f));
        any = true; n++;
      }
      if (!any) return;
      ctx.strokeStyle = TONE_INK[tone]; strokePieces(ctx, buckets);
    });
    return n;
  }
  function taperPiecesOn(buckets, leg, w0, w1, t0, t1, parts) { taperPieces(buckets, leg.a, leg.b, leg.o, w0, w1, t0, t1, parts); }

  // How much of a holding's ring shows at progress u: a stock held on both days in full, one bought on the shown day fades
  // in over the step, one sold on it fades out (gone at u = 1, so a cut shows only the shown day's holdings).
  function heldAlpha(c, u) {
    var was = c.prevHeld === undefined ? !!c.held : !!c.prevHeld;
    if (c.held && was) return 1;
    if (c.held) return u;
    if (was) return 1 - u;
    return 0;
  }
  // Holdings: a ring of moss round the cap, and the ticker beside it on a patch of peat. Every ring is drawn. The tickers are
  // placed greedily, holdings that are catalysts first, each only where it overlaps no ticker already placed, and at most
  // o.heldLabels of them (the site's map: 14 on a desktop, 8 on a phone); a holding without its ticker shows it on hover.
  function drawHeld(ctx, list, pos, u, o) {
    var nodes = o.layout && Array.isArray(o.layout.nodes) ? o.layout.nodes : [], n = 0, labels = [];
    ctx.font = "600 10.5px " + (o.font || "sans-serif");
    ctx.textBaseline = "middle";
    for (var a = 0; a < list.length; a++) {
      var c = list[a], fade = heldAlpha(c, u);
      if (!(fade > 0) || !placed(pos, c.node)) continue;
      var P = at(pos, c.node), form = formAt(c, u), lr = radiusAt(c, u);
      var rr = (form === "dropped" ? Math.max(lr * 1.45 + 0.6, 4.2 * MARK_SCALE) : lr) + 3.6, alpha = (c.dim ? DIM_ALPHA : 1) * fade;
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(P.x, P.y, rr, 0, TAU); ctx.strokeStyle = PAL.moss; ctx.lineWidth = HELD_RING; ctx.stroke();
      var name = nodes[c.node] && typeof nodes[c.node].t === "string" ? nodes[c.node].t : "";
      if (name) labels.push({ P: P, rr: rr, name: name, alpha: alpha, cat: c.catalyst === true ? 1 : 0, at: labels.length });
      ctx.globalAlpha = 1;
      n++;
    }
    labels.sort(function (x, y) { return y.cat - x.cat || x.at - y.at; });
    var most = isNum(o.heldLabels) ? o.heldLabels : Infinity, boxes = [];
    for (var q = 0; q < labels.length && boxes.length < most; q++) {
      var L = labels[q], tw = ctx.measureText(L.name).width, left = isNum(o.w) && L.P.x + L.rr + 9 + tw > o.w - 8;
      var tx = left ? L.P.x - L.rr - 5 : L.P.x + L.rr + 5, ty = L.P.y + 0.5, bx = left ? tx - tw - 2 : tx - 2, box = [bx, ty - 7, bx + tw + 4, ty + 7];
      if (isNum(o.heldLabels) && boxes.some(function (k) { return box[0] < k[2] && k[0] < box[2] && box[1] < k[3] && k[1] < box[3]; })) continue;
      boxes.push(box);
      ctx.globalAlpha = L.alpha;
      ctx.fillStyle = PAL.peat; ctx.fillRect(bx, ty - 7, tw + 4, 14);
      ctx.textAlign = left ? "right" : "left"; ctx.fillStyle = LABEL_INK; ctx.fillText(L.name, tx, ty);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "left";
    return n;
  }

  // The caps above the pulses that do not ease, at progress u (their look changes only when a reached cap flushes, at
  // FLUSH_AT). opts: {layout, pos?, w, h, font, trail}. Returns how many caps it drew.
  function drawAbove(ctx, scene, view, u, opts) {
    var o = opts || {}, pos = o.pos || positions(o.layout, view), g = isNum(u) ? Math.max(0, Math.min(1, u)) : 1;
    if (!scene) return 0;
    var list = capsAbove(scene, marksOf(scene, o.trail)).still;
    drawCaps(ctx, list, pos, names(o.layout), g, marksOf(scene, o.trail));
    return list.length;
  }
  // The caps that ease between their two recorded looks, at progress u, then every holding's ring and ticker on top (a few;
  // drawn last, so no cap covers a ticker). Returns {caps, held}.
  function drawEased(ctx, scene, view, u, opts) {
    var o = opts || {}, pos = o.pos || positions(o.layout, view), g = isNum(u) ? Math.max(0, Math.min(1, u)) : 1;
    if (!scene) return { caps: 0, held: 0 };
    var M = marksOf(scene, o.trail), A = capsAbove(scene, M);
    drawCaps(ctx, A.eased, pos, names(o.layout), g, M);
    return { caps: A.eased.length, held: drawHeld(ctx, A.still.concat(A.eased), pos, g, o) };   // one pass, so the ticker limit is the page's
  }

  // The moving layer at progress u (0 to 1) of a step, drawn whole: the pulses grown to u, the caps above them, and the caps
  // that ease. At u = 1 it is the recorded present. opts: {layout, pos?, w, h, font, trail}. Returns what it drew: `lit`
  // counts the caps shown in a pulse's tone.
  function drawDynamic(ctx, scene, view, u, opts) {
    var o = opts || {}, pos = o.pos || positions(o.layout, view), g = isNum(u) ? Math.max(0, Math.min(1, u)) : 1;
    var drawn = { pulses: 0, caps: 0, held: 0, lit: 0 };
    if (!scene) return drawn;
    var oo = {}; Object.keys(o).forEach(function (k) { oo[k] = o[k]; }); oo.pos = pos; oo.layered = false;
    drawn.pulses = drawPulses(ctx, scene, view, 0, g, oo);
    drawPulseTips(ctx, scene, view, g, oo);
    var A = drawAbove(ctx, scene, view, g, oo), E = drawEased(ctx, scene, view, g, oo), M = marksOf(scene, o.trail), caps = Array.isArray(scene.caps) ? scene.caps : [];
    drawn.caps = A + E.caps; drawn.held = E.held;
    if (g >= FLUSH_AT) M.lit.forEach(function (tone, node) { if (placed(pos, node) && caps[node] && caps[node].catalyst !== true) drawn.lit++; });
    return drawn;
  }


  // ---- the living light ----
  //
  // The one place light is drawn, and it plays once (owner, 2026-11-18: "real time (sort of) and not replayed or exaggerated").
  // When a step is shown every catalyst of the step is hit (a ring leaves its cap), and each ripple arriving on the step sends a
  // light down its recorded link to the stock that reacted, which flares as the light arrives. Then the field is still until the
  // next step. Nothing loops, nothing from an earlier day travels again, and nothing is drawn from a hash, a random number or the clock.
  var LIFE = Object.freeze({
    stagger: 1400,           // the catalysts of a step leave one after another across this long
    travel: 3400,            // a catalyst's longest row takes this long; shorter rows arrive sooner
    flare: 2200,             // a reached stock's flare
    ring: 1800,              // a catalyst's hit, and the ring a source sends as its pulses leave
    budget: 360,             // travelling lights at most, unless the caller gives its own
    tail: 0.38,              // a travelling light's tail, as a share of its row
  });
  var LIFE_PLANS = new WeakMap();
  function trailKey(trail) { return trail instanceof Set ? Array.from(trail).sort(function (x, y) { return x - y; }).join(",") : "*"; }

  // What the light replays for a scene: the travelling rows, the sources they leave, the catalysts hit and the loud caps.
  // Worked out once per scene, trail and budget; nothing in it depends on the view or the time.
  function lifeOf(scene, trail, layout, budget) {
    if (!scene || !Array.isArray(scene.caps)) return { rows: [], sources: [], hits: [], hitAt: [], origins: [], alive: false, end: 0 };
    var B = isNum(budget) && budget >= 0 ? Math.floor(budget) : LIFE.budget, key = trailKey(trail) + "|" + B, memo = LIFE_PLANS.get(scene);
    if (memo && memo.key === key && memo.layout === layout) return memo.plan;
    var M = marksOf(scene, trail), caps = scene.caps, nodes = layout && Array.isArray(layout.nodes) ? layout.nodes : [], a;
    function xy(i) { var n = nodes[i]; return n && isNum(n.x) && isNum(n.y) ? n : null; }
    function span(i, j) { var p = xy(i), q = xy(j); return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : NaN; }
    function lengthOf(r) { return r.via >= 0 && r.via !== r.src && r.via !== r.dst && xy(r.via) ? span(r.src, r.via) + span(r.via, r.dst) : span(r.src, r.dst); }
    function lit(r) { return !(caps[r.src] && caps[r.src].dim) || !(caps[r.dst] && caps[r.dst].dim); }
    // Only what arrives on this step travels.
    var picked = [], rows = [];
    M.grow.forEach(function (r, q) { var len = lengthOf(r); if (len > 0 && lit(r)) rows.push({ r: r, len: len, at: q }); });
    rows.sort(function (x, y) { return level(y.r.level) - level(x.r.level) || x.at - y.at; });
    rows.slice(0, B).forEach(function (o) {
      picked.push({ src: o.r.src, via: o.r.via, dst: o.r.dst, tone: o.r.tone === "against" ? "against" : "with", level: level(o.r.level), rank: 0, age: 0, len: o.len, bright: 1, t0: 0, dur: 0 });
    });
    // The sources, in the order they leave: the followed (rank 0) first, then by rows travelling, then by node.
    var bySrc = new Map();
    picked.forEach(function (t) {
      var s = bySrc.get(t.src);
      if (!s) { s = { node: t.src, rank: t.rank, n: 0, longest: 0, t0: 0 }; bySrc.set(t.src, s); }
      s.n++; if (t.rank < s.rank) s.rank = t.rank; if (t.len > s.longest) s.longest = t.len;
    });
    var sources = Array.from(bySrc.values()).sort(function (x, y) { return y.n - x.n || x.node - y.node; });
    sources.forEach(function (s, q) { s.t0 = sources.length > 1 ? LIFE.stagger * q / (sources.length - 1) : 0; });
    picked.forEach(function (t) { var s = bySrc.get(t.src); t.t0 = s.t0; t.dur = LIFE.travel * (0.4 + 0.6 * t.len / s.longest); });
    var hits = [], hitAt = [];
    for (a = 0; a < caps.length; a++) if (caps[a] && !caps[a].dim && caps[a].catalyst === true) hits.push(caps[a].node);
    // Each catalyst is hit at its own moment: a source as its pulses leave, the rest one after another.
    var others = hits.filter(function (n) { return !bySrc.has(n); });
    hits.forEach(function (n) { var s = bySrc.get(n); hitAt.push(s ? s.t0 : LIFE.stagger * others.indexOf(n) / Math.max(1, others.length)); });
    var end = 0;
    picked.forEach(function (t) { end = Math.max(end, t.t0 + t.dur + LIFE.flare); });
    sources.forEach(function (s) { end = Math.max(end, s.t0 + LIFE.ring); });
    hitAt.forEach(function (t) { end = Math.max(end, t + LIFE.ring); });
    var plan = { rows: picked, sources: sources, hits: hits, hitAt: hitAt, origins: sources.map(function (s) { return s.node; }),
                 alive: picked.length + hits.length > 0, end: end };
    LIFE_PLANS.set(scene, { key: key, layout: layout, plan: plan });
    return plan;
  }

  // A soft round light in one ink: bright at the middle, nothing at the rim. Made once per ink, on a small canvas of its own
  // (the page's document makes it; where there is none, as in a test without one, no glow is drawn and the rest still is).
  var SPRITES = {}, SPRITE_PX = 64, canvasMaker = null;
  function setCanvasMaker(f) { canvasMaker = typeof f === "function" ? f : null; SPRITES = {}; }
  function rgbOf(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
  var LIGHT_INK = Object.freeze({ "with": EARTH.ch, against: "#9a74c8", bone: EARTH.bone });   // amethyst is lifted a step as light: it must read on peat
  var LIGHT_SPEC = Object.freeze({ "with": SPECTRUM.ch, against: "#ff7ac8", bone: SPECTRUM.bone });   // magenta is lifted a step as light
  var LIGHT = LIGHT_INK;
  // The page's colour schemes (the page names one with ?scheme=; "acid" is the spectrum above). Each is the cap and thread
  // inks, the labels' inks, the quiet dots' mix (high to low, per channel) and the light the pulses carry.
  var SPEC_SETS = {
    acid: { pal: SPECTRUM, ex: EXTRA.spectrum, light: LIGHT_SPEC },
    ink: {
      pal: Object.freeze({ peat: "#07080a", bone: "#8d96a6", ch: "#ffffff", chG: "#6b7380", chS: "#d7dce5", am: "#ff4d2e", amG: "#8f2a18",
                           amS: "#d93c22", moss: "#ffd23f", ash: "#5a606c", print: "#14161b", printGill: "#2a2e36" }),
      ex: { thread: "104,112,130", bone: "245,247,250", gill: "#8d96a6", stipe: "#c5ccd8", label: "#e8ebf0", leader: "#9aa3b2", mix: [[245, 22], [247, 24], [250, 30]] },
      light: Object.freeze({ "with": "#ffffff", against: "#ff7a5c", bone: "#ffffff" }) },
    ember: {
      pal: Object.freeze({ peat: "#140806", bone: "#fff1d6", ch: "#ffd23f", chG: "#a67c0c", chS: "#ffe27a", am: "#ff2e7e", amG: "#8c1648",
                           amS: "#d41f66", moss: "#7dffb0", ash: "#8a6a58", print: "#2a120c", printGill: "#4a2316" }),
      ex: { thread: "176,92,58", bone: "255,241,214", gill: "#b08a6c", stipe: "#e8cfa8", label: "#ffe9c8", leader: "#c9a07c", mix: [[255, 24], [241, 10], [214, 6]] },
      light: Object.freeze({ "with": "#ffd23f", against: "#ff6fa3", bone: "#fff1d6" }) },
    paper: {
      pal: Object.freeze({ peat: "#efe8dc", bone: "#2a2540", ch: "#0a8fa8", chG: "#066478", chS: "#37b5cb", am: "#d6246e", amG: "#8f1a48",
                           amS: "#e8548f", moss: "#5f8a00", ash: "#8a8296", print: "#d9cfbf", printGill: "#bfb3a0" }),
      ex: { thread: "110,92,190", bone: "42,37,64", gill: "#6f6890", stipe: "#4a4468", label: "#2a2540", leader: "#6f6890", mix: [[40, 214], [34, 206], [80, 222]] },
      light: Object.freeze({ "with": "#0a8fa8", against: "#d6246e", bone: "#2a2540" }) },
    dusk: {
      pal: Object.freeze({ peat: "#0d0c1c", bone: "#f2f6ff", ch: "#f2b84b", chG: "#8a6420", chS: "#ffd98a", am: "#ff5f9e", amG: "#8f2c5a",
                           amS: "#d94a86", moss: "#5ff0e0", ash: "#6a6a98", print: "#1a1838", printGill: "#2a2860" }),
      ex: { thread: "92,92,140", bone: "242,246,255", gill: "#8a86c0", stipe: "#c0bcdc", label: "#d8d6ee", leader: "#9a98cc", mix: [[242, 22], [246, 18], [255, 60]] },
      light: Object.freeze({ "with": "#ffd070", against: "#ff8ab8", bone: "#f2f6ff" }) },
    // mist: deep indigo weather; the marks keep their meanings in soft luminous inks (champagne with, rose against, aqua held,
    // pearl loud) and the links are lavender hairlines.
    mist: {
      pal: Object.freeze({ peat: "#0f0f24", bone: "#f4f2ff", ch: "#f2c879", chG: "#8e6c34", chS: "#ffe2a8", am: "#f58cbc", amG: "#8c3c64",
                           amS: "#e06aa2", moss: "#86ece0", ash: "#6e6f9e", print: "#1b1c3e", printGill: "#2c2d5e", veil: 0.8 }),
      ex: { thread: "168,170,216", bone: "244,242,255", gill: "#9a98cc", stipe: "#cfcdea", label: "#dedcf2", leader: "#a8a6d4", mix: [[204, 30], [202, 30], [232, 66]] },
      light: Object.freeze({ "with": "#f2d29a", against: "#f0a6c8", bone: "#aeaadc" }) },
    // pearl: a pale ground of mist; the marks are deep inks of the same meanings, and the living light darkens instead of
    // adding (ground: "light"), so a pulse reads on pale paper as it does on the dark.
    pearl: {
      pal: Object.freeze({ peat: "#eeeef5", bone: "#2e2a5c", ch: "#a8682a", chG: "#dcb98c", chS: "#c88c4c", am: "#b4286a", amG: "#e4a6c2",
                           amS: "#d0588e", moss: "#08787e", ash: "#9c98bc", print: "#dcdaea", printGill: "#c8c4de", veil: 0.72 }),
      ex: { thread: "166,160,214", bone: "46,42,92", gill: "#7c78a8", stipe: "#4c4880", label: "#2e2a5c", leader: "#7c78a8", mix: [[24, 238], [20, 238], [74, 245]] },
      light: Object.freeze({ "with": "#e6b06c", against: "#e486b4", bone: "#9a96c4" }), ground: "light" },
  };
  function sprite(tone) {
    if (Object.prototype.hasOwnProperty.call(SPRITES, tone)) return SPRITES[tone];
    var c = null;
    try { c = canvasMaker ? canvasMaker() : typeof document === "object" && document && typeof document.createElement === "function" ? document.createElement("canvas") : null; } catch (e) { c = null; }
    var g = c && typeof c.getContext === "function" ? c.getContext("2d") : null;
    if (!g || typeof g.createRadialGradient !== "function") { SPRITES[tone] = null; return null; }
    c.width = SPRITE_PX; c.height = SPRITE_PX;
    var h = SPRITE_PX / 2, k = rgbOf(LIGHT[tone] || LIGHT["with"]), ink = k.join(","), hot = k.map(function (v) { return Math.round(v + (255 - v) * 0.3); }).join(",");
    var grad = g.createRadialGradient(h, h, 0, h, h, h);
    if (grad && typeof grad.addColorStop === "function") {
      grad.addColorStop(0, "rgba(" + hot + ",0.95)"); grad.addColorStop(0.14, "rgba(" + ink + ",0.7)");
      grad.addColorStop(0.42, "rgba(" + ink + ",0.2)"); grad.addColorStop(1, "rgba(" + ink + ",0)");
      g.fillStyle = grad; g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
    }
    SPRITES[tone] = c;
    return c;
  }
  var LIGHT_GROUND = false;      // a pale ground (useSpectrum sets it from the scheme)
  var LIGHT_MUL = 1;             // the fade of the step being drawn (drawLife sets it from opts.fade, and puts it back)
  function light(ctx, tone, x, y, r, alpha) {
    var s = sprite(tone);
    alpha *= LIGHT_MUL;
    if (!s || !(alpha > 0.004) || !(r > 0)) return;
    ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    ctx.drawImage(s, x - r, y - r, 2 * r, 2 * r);
  }

  // A point at share q (0 to 1) of an echo row's path: the first half runs to its recorded middle stock, the second on.
  function onPath(L, q) {
    var leg, t;
    if (L.length === 1) { leg = L[0]; t = q; } else if (q < 0.5) { leg = L[0]; t = q * 2; } else { leg = L[1]; t = (q - 0.5) * 2; }
    return point(leg.a, ctrl(leg.a, leg.b, leg.o), leg.b, t < 0 ? 0 : t > 1 ? 1 : t);
  }
  function capRadiusNow(cap) { return cap ? radiusAt(cap, 1) : 3 * MARK_SCALE; }

  // The living light of a step at time t (ms since the step was shown; it plays once) drawn over the caps.
  // opts: {layout, pos?, trail, budget, w, h, now (ms on any steady clock: the breath's phase), still}. With opts.still (reduced
  // motion) nothing travels and nothing depends on a time: the followed rows' stocks keep a steady afterglow by their level,
  // the followed sources their ring and the loud caps a steady light. Returns what it drew, by kind.
  function drawLife(ctx, scene, view, t, opts) {
    var o = opts || {}, pos = o.pos || positions(o.layout, view), nm = names(o.layout);
    var drawn = { travellers: 0, flares: 0, hits: 0, rings: 0, origins: 0 };
    if (!scene) return drawn;
    var P = lifeOf(scene, o.trail, o.layout, o.budget), caps = scene.caps, still = o.still === true;
    var tc = isNum(t) && t >= 0 ? t : 0;
    if (!P.alive || (!still && tc >= P.end)) return drawn;              // played once: the field is still
    var w = isNum(o.w) ? o.w : Infinity, h = isNum(o.h) ? o.h : Infinity, a, k;
    var sc = 0.3 + 0.7 * MARK_SCALE * MARK_SCALE;   // a small field's lights are smaller, as its caps are
    var mul = isNum(o.fade) ? Math.max(0, Math.min(1, o.fade)) : 1;
    if (!(mul > 0)) return drawn;
    LIGHT_MUL = mul;
    function since(t0) { return tc - t0; }
    var wasOp = ctx.globalCompositeOperation;
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    // The followed sources keep a thin ring, so where a ripple began is always marked (matte: an ordinary stroke).
    ctx.beginPath();
    for (a = 0; a < P.origins.length; a++) {
      var on = P.origins[a];
      if (!placed(pos, on)) continue;
      var orr = capRadiusNow(caps[on]) + (caps[on] && caps[on].catalyst ? PEAT_RING + 2.4 : 4.2);
      ctx.moveTo(pos[2 * on] + orr, pos[2 * on + 1]); ctx.arc(pos[2 * on], pos[2 * on + 1], orr, 0, TAU);
      drawn.origins++;
    }
    if (drawn.origins) { ctx.globalAlpha = 0.9 * mul; ctx.strokeStyle = PAL.ch; ctx.lineWidth = 1.3; ctx.stroke(); }

    ctx.globalCompositeOperation = "lighter";
    if (LIGHT_GROUND) ctx.globalCompositeOperation = "multiply";   // on a pale ground light darkens: adding would wash it out

    // Rings are gathered by ink and by a few steps of alpha, and stroked together.
    var rings = {};
    function ring(tone, x, y, r, alpha, width) {
      var q = Math.round(alpha * 6);
      if (q <= 0 || !(r > 0)) return;
      var key = tone + "|" + q + "|" + width, g = rings[key] || (rings[key] = { tone: tone, alpha: q / 6, width: width, at: [] });
      g.at.push(x, y, r);
    }

    if (still) {
      for (a = 0; a < P.rows.length; a++) {
        var sr = P.rows[a];
        if (sr.rank !== 0 || !placed(pos, sr.dst)) continue;
        light(ctx, sr.tone, pos[2 * sr.dst], pos[2 * sr.dst + 1], (sr.level === 2 ? 17 : 12) * sc, sr.level === 2 ? 0.62 : 0.4);
        drawn.flares++;
      }
    } else {
      // Each catalyst of the step is hit at its own moment of the replay (a source as its pulses leave).
      for (a = 0; a < P.hits.length; a++) {
        var hn = P.hits[a], hx = since(P.hitAt[a] || 0) / LIFE.ring;
        if (hx < 0 || hx >= 1 || !placed(pos, hn) || !onScreen(at(pos, hn), w, h, 30)) continue;
        var he = 1 - Math.pow(1 - hx, 3), hf = (1 - hx) * (1 - hx), hr = capRadiusNow(caps[hn]);
        ring("with", pos[2 * hn], pos[2 * hn + 1], hr + PEAT_RING + 1 + 9 * sc * he, 0.5 * hf, 1.1);
        light(ctx, "with", pos[2 * hn], pos[2 * hn + 1], hr * 2.2 + 5, 0.22 * hf * Math.min(1, hx / 0.15));
        drawn.hits++;
      }
      // A source sends a ring as its pulses leave.
      for (a = 0; a < P.sources.length; a++) {
        var so = P.sources[a], sx = since(so.t0) / LIFE.ring;
        if (sx < 0 || sx >= 1 || !placed(pos, so.node)) continue;
        var lead = so.rank === 0, se = 1 - Math.pow(1 - sx, 3), sf = (1 - sx) * (1 - sx);
        ring("with", pos[2 * so.node], pos[2 * so.node + 1], capRadiusNow(caps[so.node]) + 2 + (lead ? 26 : 12) * sc * se, (lead ? 0.95 : 0.4) * sf, lead ? 1.6 : 1);
        if (lead) light(ctx, "with", pos[2 * so.node], pos[2 * so.node + 1], 26 * sc, 0.4 * sf * Math.min(1, sx / 0.15));
        drawn.rings++;
      }
      // The travelling lights: a tail in three pieces along the recorded path, then the head; the flare on arrival.
      var tails = {};
      for (a = 0; a < P.rows.length; a++) {
        var r = P.rows[a], x = since(r.t0) / r.dur;
        if (x < 0 || !placed(pos, r.src) || !placed(pos, r.dst)) continue;
        if (x < 1) {
          // eased in and out: the light gathers, glides and settles into the stock it reached
          var Lg = legs(pos, nm, r.src, r.via, r.dst), q1 = 0.5 - 0.5 * Math.cos(Math.PI * x), head = onPath(Lg, q1);
          if (!onScreen(head, w, h, 40)) continue;
          var q0 = Math.max(0, q1 - LIFE.tail), wd = (r.level === 2 ? 2.6 : 1.8) * (0.6 + 0.4 * r.bright) * sc;
          for (k = 0; k < 3; k++) {
            var s0 = q0 + (q1 - q0) * k / 3, s1 = q0 + (q1 - q0) * (k + 1) / 3;
            if (!(s1 > s0)) continue;
            var tk = r.tone + "|" + k + "|" + Math.round(r.bright * 4) + "|" + r.level;
            var tg = tails[tk] || (tails[tk] = { tone: r.tone, alpha: [0.14, 0.36, 0.78][k] * r.bright, width: wd * [0.55, 0.8, 1][k], pts: [] });
            var p0 = onPath(Lg, s0), pm = onPath(Lg, (s0 + s1) / 2), p1 = onPath(Lg, s1);
            tg.pts.push(p0.x, p0.y, pm.x, pm.y, p1.x, p1.y);
          }
          // The head comes up over the first eighth of its row, so the rows leaving one catalyst do not add up to a white blot.
          light(ctx, r.tone, head.x, head.y, (r.level === 2 ? 12 : 8.5) * (0.6 + 0.4 * r.bright) * sc, 0.9 * r.bright * Math.min(1, x / 0.2));
          drawn.travellers++;
        } else {
          var fx = (since(r.t0) - r.dur) / LIFE.flare;
          if (fx >= 1) continue;
          var dx = pos[2 * r.dst], dy = pos[2 * r.dst + 1], fr = (r.level === 2 ? 24 : 15) * (0.55 + 0.45 * r.bright) * sc, fe = 1 - Math.pow(1 - fx, 3);
          // the tail draws itself in to the stock it reached, so the ray never vanishes all at once
          var tin = fx / 0.4;
          if (tin < 1) {
            var Lt = legs(pos, nm, r.src, r.via, r.dst), t0q = 1 - LIFE.tail * (1 - tin), wd2 = (r.level === 2 ? 2.6 : 1.8) * (0.6 + 0.4 * r.bright) * sc;
            var ttk = r.tone + "|in|" + Math.round(r.bright * 4) + "|" + r.level + "|" + Math.round((1 - tin) * 4);
            var ttg = tails[ttk] || (tails[ttk] = { tone: r.tone, alpha: 0.5 * r.bright * Math.round((1 - tin) * 4) / 4, width: wd2 * 0.8, pts: [] });
            var pa = onPath(Lt, t0q), pb = onPath(Lt, (t0q + 1) / 2), pc = onPath(Lt, 1);
            ttg.pts.push(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y);
          }
          light(ctx, r.tone, dx, dy, fr * (0.7 + 0.3 * fe), 0.85 * r.bright * (1 - fx) * (1 - fx));
          if (r.rank === 0 || r.level === 2) ring(r.tone, dx, dy, capRadiusNow(caps[r.dst]) + 1.5 + fr * 0.6 * fe, 0.7 * r.bright * (1 - fx), r.level === 2 ? 1.4 : 1);
          drawn.flares++;
        }
      }
      Object.keys(tails).forEach(function (key) {
        var g = tails[key];
        ctx.beginPath();
        for (var q = 0; q < g.pts.length; q += 6) { ctx.moveTo(g.pts[q], g.pts[q + 1]); ctx.quadraticCurveTo(g.pts[q + 2], g.pts[q + 3], g.pts[q + 4], g.pts[q + 5]); }
        ctx.globalAlpha = g.alpha * mul; ctx.strokeStyle = LIGHT[g.tone]; ctx.lineWidth = g.width; ctx.stroke();
      });
    }
    Object.keys(rings).forEach(function (key) {
      var g = rings[key];
      ctx.beginPath();
      for (var q = 0; q < g.at.length; q += 3) { ctx.moveTo(g.at[q] + g.at[q + 2], g.at[q + 1]); ctx.arc(g.at[q], g.at[q + 1], g.at[q + 2], 0, TAU); }
      ctx.globalAlpha = g.alpha * mul; ctx.strokeStyle = LIGHT[g.tone]; ctx.lineWidth = g.width; ctx.stroke();
    });
    ctx.restore();
    LIGHT_MUL = 1;
    ctx.globalCompositeOperation = wasOp || "source-over"; ctx.globalAlpha = 1;
    return drawn;
  }
  // ---- end of the living light ----


  // Where the recorded marks of a step lie on the screen, as [x, y, r] triples: every placed cap (its radius, the spore print's
  // for a dropped one, the ring's for a holding), and points every few pixels along each pulse, each trail echo of opts.trail
  // and each stub. The page keeps plates and colony names off them.
  function markPoints(scene, view, opts) {
    var o = opts || {}, pos = o.pos || positions(o.layout, view), nm = names(o.layout), out = [], a;
    if (!scene) return out;
    var M = marksOf(scene, o.trail), caps = Array.isArray(scene.caps) ? scene.caps : [];
    for (a = 0; a < caps.length; a++) {
      var c = caps[a];
      if (!placed(pos, c.node)) continue;
      var L = lookOf(c, 1, M), r = L.form === "dropped" ? L.r * 2.6 : L.colour === "catalyst" ? L.r + PEAT_RING : Math.max(L.r, NO_READING_R);
      out.push(pos[2 * c.node], pos[2 * c.node + 1], c.held ? r + 5.4 : r);
    }
    function along(src, via, dst, r) {
      if (!placed(pos, src) || !placed(pos, dst)) return;
      legs(pos, nm, src, via, dst).forEach(function (g) {
        var c2 = ctrl(g.a, g.b, g.o), len = Math.abs(g.b.x - g.a.x) + Math.abs(g.b.y - g.a.y), n = Math.max(2, Math.ceil(len / 6));
        for (var k = 0; k <= n; k++) { var p = point(g.a, c2, g.b, k / n); out.push(p.x, p.y, r); }
      });
    }
    (Array.isArray(scene.pulses) ? scene.pulses : []).forEach(function (p) { along(p.src, p.via, p.dst, 2); });
    M.trail.forEach(function (e) { along(e.src, e.via, e.dst, 1); });
    (Array.isArray(scene.stubs) ? scene.stubs : []).forEach(function (st) { along(st.src, -1, st.dst, 1); });
    return out;
  }

  // A caption's leader: from the nearest point of its plate to just short of its catalyst's cap.
  function leader(ctx, box, x, y, r) {
    var px = Math.max(box.x, Math.min(box.x + box.w, x)), py = Math.max(box.y, Math.min(box.y + box.h, y));
    var dx = x - px, dy = y - py, d = Math.sqrt(dx * dx + dy * dy), stop = (isNum(r) ? r : 6) + 6;
    if (d <= stop + 2) return;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x - dx / d * stop, y - dy / d * stop);
    ctx.strokeStyle = LEADER_INK; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py, 1.6, 0, TAU); ctx.fillStyle = LEADER_INK; ctx.fill();
  }

  // The record's mark at its cap: a short stub from just outside the cap toward the record (its plate stands on the far side of
  // the screen, so a full leader would cross the field), with a dot at its outer end.
  var STUB_LEN = 22;
  function stub(ctx, box, x, y, r) {
    var tx = box.x + box.w / 2, ty = box.y + box.h / 2, dx = tx - x, dy = ty - y, d = Math.sqrt(dx * dx + dy * dy);
    if (!(d > 0)) return;
    var r0 = (isNum(r) ? r : 6) + 7, ux = dx / d, uy = dy / d;          // clear of a holding's moss ring
    ctx.beginPath(); ctx.moveTo(x + ux * r0, y + uy * r0); ctx.lineTo(x + ux * (r0 + STUB_LEN), y + uy * (r0 + STUB_LEN));
    ctx.strokeStyle = LEADER_INK; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x + ux * (r0 + STUB_LEN), y + uy * (r0 + STUB_LEN), 2, 0, TAU); ctx.fillStyle = LEADER_INK; ctx.fill();
  }

  // ---- the dials ----

  function mixHex(a, b, t) {
    function p(x) { return [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)]; }
    var A = p(a), B = p(b), k = Math.max(0, Math.min(1, t));
    return "rgb(" + A.map(function (v, i) { return Math.round(v + (B[i] - v) * k); }).join(",") + ")";
  }
  function hasRing(row) { return !!row && Array.isArray(row.rings) && row.rings.some(isNum); }

  // A dial as a cut stem, size px wide: the inner rings are past days, the outer ring is the shown day. A ring's weight and
  // light are its reading's place against the dial's own history; a day with no reading (a run-in day included) leaves its
  // ring out. The arc and the mark on the rim are the shown day's place. A dial with no ring at all draws nothing.
  // The dial's inks. A page may pass its own set (the same keys) as `ink`; without one the dial keeps these.
  var DIAL_INK = Object.freeze({ bed: "#3a2c21", base: "#2e231b", today: "#e3d7bc", past: "#c8b998", pith: "#1c140f",
                                 rim: "#5a4535", track: "#4a392c", arc: "#e9dfc8" });
  function dial(ctx, dialRow, size, ink) {
    if (!hasRing(dialRow)) return false;
    var K = ink || DIAL_INK;
    var s = (isNum(size) && size > 0 ? size : 76) / 76, rings = dialRow.rings, n = rings.length, i;
    var h = hashText(String(dialRow.key)), ph1 = (h % 628) / 100, ph2 = ((h >>> 10) % 628) / 100;
    var inner = 4.6, outer = 27.4, step = n > 1 ? (outer - inner) / (n - 1) : 0, TR = 31.5;
    ctx.save(); ctx.scale(s, s);
    ctx.beginPath(); ctx.arc(38, 38, outer + 1.6, 0, TAU); ctx.fillStyle = K.bed; ctx.fill();
    for (i = 0; i < n; i++) {
      var v = rings[i];
      if (!isNum(v)) continue;
      var r = inner + step * i, last = i === n - 1;
      ctx.beginPath();
      for (var q = 0; q <= 48; q++) {
        var a = q / 48 * TAU, rr = r * (1 + 0.035 * Math.sin(3 * a + ph1) + 0.02 * Math.sin(5 * a + ph2));
        if (q) ctx.lineTo(38 + Math.cos(a) * rr, 38 + Math.sin(a) * rr); else ctx.moveTo(38 + Math.cos(a) * rr, 38 + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.strokeStyle = last ? mixHex(K.base, K.today, v + 0.08) : mixHex(K.base, K.past, v * 0.92);
      ctx.lineWidth = last ? 1.9 : 0.7 + v * 0.9;
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(38, 38, 1.4, 0, TAU); ctx.fillStyle = K.pith; ctx.fill();
    ctx.beginPath(); ctx.arc(38, 38, outer + 2.5, 0, TAU); ctx.strokeStyle = K.rim; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath(); ctx.arc(38, 38, TR, 0, TAU); ctx.strokeStyle = K.track; ctx.lineWidth = 2.2; ctx.stroke();
    var today = rings[n - 1];
    if (isNum(today)) {
      var end = -Math.PI / 2 + today * TAU;
      ctx.beginPath(); ctx.arc(38, 38, TR, -Math.PI / 2, end); ctx.strokeStyle = K.arc; ctx.lineWidth = 2.4; ctx.lineCap = "butt"; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(38 + Math.cos(end) * (TR - 3.6), 38 + Math.sin(end) * (TR - 3.6)); ctx.lineTo(38 + Math.cos(end) * (TR + 3.6), 38 + Math.sin(end) * (TR + 3.6));
      ctx.lineWidth = 1.6; ctx.stroke();
    }
    ctx.restore();
    return true;
  }

  // ---- the key ----

  // A specimen of each mark for the key, in a 22 x 22 box (34 x 22 for with and against).
  var SPECIMENS = ["quiet", "loud", "tired", "held", "unknown", "catalyst", "with", "against", "earlier", "died", "waiting", "pale"];
  function specimen(ctx, kind) {
    var cy = 11, cx = 23;
    switch (kind) {
      case "quiet": closedCap(ctx, 11, cy, 2.3, "mid"); break;
      case "loud": cap(ctx, 11, cy, 6.6, "loud", 0.2); break;
      case "tired": droppedCap(ctx, 11, cy, 2.6, 0.5); break;
      case "held":
        closedCap(ctx, 11, cy, 2.4, "mid");
        ctx.beginPath(); ctx.arc(11, cy, 6.2, 0, TAU); ctx.strokeStyle = PAL.moss; ctx.lineWidth = HELD_RING; ctx.stroke();
        break;
      case "unknown": noReading(ctx, 11, cy); break;
      case "catalyst": cap(ctx, 11, cy, 8.6, "catalyst", 0.3); break;
      case "with":
      case "against":
        taper(ctx, { x: 1, y: 15 }, { x: cx, y: cy }, [0.18, -0.06], kind === "with" ? 2.4 : 2.0, kind === "with" ? 1 : 0.9, 0, 1, TONE_INK[kind]);
        cap(ctx, cx, cy, 5, kind, 0.4);
        break;
      case "died":                                      // a catalyst whose echo died: its stubs, thinning to nothing
        ctx.beginPath();
        for (var q = -1; q <= 1; q++) taperPath(ctx, { x: 4, y: cy }, { x: 4 + 70, y: cy + q * 18 }, [0.04 * q, 0], STUB[0], -1.5 * STUB[0], 0, 0.4);
        ctx.fillStyle = stubInk(); ctx.fill();
        ctx.beginPath(); ctx.arc(4, cy, 2.4, 0, TAU); ctx.fillStyle = "rgba(" + BONE + ",0.6)"; ctx.fill();
        break;
      case "earlier":                                   // other catalysts and earlier days: the trail's one alpha, thread and cap
        ctx.globalAlpha = TRAIL_ALPHA;
        taper(ctx, { x: 1, y: 15 }, { x: cx, y: cy }, [0.18, -0.06], 1.4, 0.4, 0, 1, PAL.ch);
        closedCap(ctx, cx, cy, 2.6, "with");
        ctx.globalAlpha = 1;
        break;
      case "pale":                                      // a pale thread of the weave
        ctx.beginPath(); thread(ctx, { x: 3, y: 15 }, { x: 33, y: 7 }, [0.12, -0.05]);
        ctx.strokeStyle = "rgba(" + THREAD + "," + (SPEC ? THREAD_TIERS_SPEC[0][0] * 2 : THREAD_TIERS[0][0] * 2).toFixed(3) + ")"; ctx.lineWidth = 1; ctx.stroke();
        break;
      case "waiting":                                   // a day's rows of catalysts nobody follows: left out until one is picked
        ctx.beginPath(); thread(ctx, { x: 3, y: 15 }, { x: 33, y: 7 }, [0.12, -0.05]);
        if (typeof ctx.setLineDash === "function") ctx.setLineDash([2, 3]);
        ctx.strokeStyle = "rgba(" + THREAD + ",0.9)"; ctx.lineWidth = 1; ctx.stroke();
        if (typeof ctx.setLineDash === "function") ctx.setLineDash([]);
        break;
      default: return false;
    }
    return true;
  }

  // ---- the soil core ----

  // The core as a strip w x h (MapCore.coreLayout gives its bands): the deep years as strata, one per recorded day at its
  // calendar place, each trading week laid down as one band of soil (a stretch with no recorded day stays bare, and a month
  // being read is bare with a dotted seam), the closed years sealed, on the public page the older days sealed too, the recent
  // days as thin fresh layers (run-in days hatched), and today as humus at the surface; the pin marks the step shown.
  // model: {layers: [{seg: "deep" | "bare" | "sealed" | "recent" | "today", x0, x1, month?, runin?}], days: [{x0, x1, week,
  // month}], closed: {x0, x1} | null, ticks: [{x, major}], pin: x | null, loading: Set of months}.
  var STRATA = ["#5e4a37", "#4f3d2e", "#584533", "#4a3a2c"], DEEP_BED = "#2e2219";   // the strata in the recent days' tones
  var FRESH = ["#4f3d2e", "#584533", "#4a3a2c", "#5e4a37"];
  var SEALED = "#17110c", SEAM = "#5a4535", BARE = "#2a1f18";
  // The core's inks. A page may pass its own set (the same keys) as `ink`; without one the core keeps these. A set may add
  // ramp(x, n, recent): the colour of a day or a recent layer from its place along the strip (0 left, 1 right).
  var CORE_INK = Object.freeze({ strata: STRATA, deep: DEEP_BED, fresh: FRESH, sealed: SEALED, seam: SEAM, bare: BARE,
                                 today: "#1e1610", litter: "#6b5a4a", tick: "#7d6e5b", pin: PAL.bone, mark: BONE });
  function seal(ctx, c0, c1, h, K) {
    K = K || CORE_INK;
    ctx.fillStyle = K.sealed; ctx.fillRect(c0, 0, c1 - c0, h);
    ctx.beginPath(); ctx.moveTo(c0 + 0.5, 0); ctx.lineTo(c0 + 0.5, h); ctx.moveTo(c1 - 0.5, 0); ctx.lineTo(c1 - 0.5, h);
    ctx.moveTo(c0 + 3.5, h / 2); ctx.lineTo(c1 - 3.5, h / 2);
    for (var x = c0 + 6.5; x < c1 - 5; x += 6) { ctx.moveTo(x, h / 2 - 3); ctx.lineTo(x, h / 2 + 3); }   // stitched shut
    ctx.strokeStyle = K.seam; ctx.lineWidth = 1; ctx.stroke();
  }
  function soilCore(ctx, model, w, h, ink) {
    var K = ink || CORE_INK, MARK = K.mark;
    var m = model || {}, layers = Array.isArray(m.layers) ? m.layers : [], i, R = mulberry32(77);
    var loading = m.loading instanceof Set ? m.loading : new Set();
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    ctx.fillStyle = K.bare; ctx.fillRect(0, 0, w, h);
    for (i = 0; i < layers.length; i++) {
      var L = layers[i], x0 = L.x0, x1 = Math.max(L.x1, L.x0 + 0.6), reading = typeof L.month === "string" && loading.has(L.month);
      if (L.seg === "sealed") { seal(ctx, x0, x1, h, K); continue; }
      if (reading) ctx.fillStyle = K.bare;
      else if (L.seg === "deep") ctx.fillStyle = K.deep;
      else if (L.seg === "recent") ctx.fillStyle = K.ramp ? K.ramp(x0 / w, i, true) : K.fresh[i % K.fresh.length];
      else if (L.seg === "today") ctx.fillStyle = K.today;
      else ctx.fillStyle = K.bare;
      ctx.fillRect(x0, 0, x1 - x0 + 0.3, h);
      if (L.seg === "recent") { ctx.fillStyle = K.bare; ctx.fillRect(x0, 0, 0.6, h); }
      if (reading) {                                      // a month being read: a dotted seam, still
        ctx.fillStyle = "rgba(" + MARK + ",0.45)";
        for (var dx = x0 + 1.5; dx < x1 - 0.5; dx += 3) ctx.fillRect(dx, h / 2 - 0.5, 1, 1);
      }
      if (L.runin) {                                      // a run-in day: shown, never counted
        ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, h); ctx.clip();
        ctx.beginPath();
        for (var x = x0 - h; x < x1; x += 3) { ctx.moveTo(x, h); ctx.lineTo(x + h, 0); }
        ctx.strokeStyle = "rgba(" + MARK + ",0.22)"; ctx.lineWidth = 0.6; ctx.stroke(); ctx.restore();
      }
      if (L.seg === "today") {
        ctx.beginPath();
        for (var k = 0; k < 16; k++) {
          var lx = x0 + 2 + R() * Math.max(1, x1 - x0 - 4), ly = 2 + R() * (h - 4), a = R() * TAU, l = 2 + R() * 4;
          ctx.moveTo(lx, ly); ctx.lineTo(lx + Math.cos(a) * l, ly + Math.sin(a) * l);
        }
        ctx.strokeStyle = K.litter; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    var days = Array.isArray(m.days) ? m.days : [];
    for (i = 0; i < days.length; i++) {
      var dd = days[i];
      if (!isNum(dd.x0) || !isNum(dd.x1) || (typeof dd.month === "string" && loading.has(dd.month))) continue;
      ctx.fillStyle = K.ramp ? K.ramp(dd.x0 / w, isNum(dd.week) ? dd.week : 0, false) : K.strata[(isNum(dd.week) ? dd.week : 0) % K.strata.length];
      ctx.fillRect(dd.x0, 0, Math.max(0.35, dd.x1 - dd.x0), h);
    }
    if (m.closed && isNum(m.closed.x0) && isNum(m.closed.x1)) seal(ctx, m.closed.x0, m.closed.x1, h, K);
    ctx.restore();
    ctx.strokeStyle = K.seam; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    var ticks = Array.isArray(m.ticks) ? m.ticks : [];
    ctx.beginPath();
    for (i = 0; i < ticks.length; i++) { ctx.moveTo(ticks[i].x, h + 2); ctx.lineTo(ticks[i].x, h + (ticks[i].major ? 7 : 4)); }
    ctx.strokeStyle = K.tick; ctx.lineWidth = 0.8; ctx.stroke();
    if (isNum(m.pin)) {
      ctx.beginPath(); ctx.moveTo(m.pin, -10); ctx.lineTo(m.pin, h + 4); ctx.strokeStyle = K.pin; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(m.pin, -11, 3.6, 0, TAU); ctx.fillStyle = K.pin; ctx.fill();
    }
  }

  var MapDraw = {
    PALETTE: PALETTE, SPECIMENS: SPECIMENS, NO_READING_R: NO_READING_R, FILAMENT_ALPHA: FILAMENT_ALPHA, THREAD_ALPHA: THREAD_ALPHA,
    THREAD_TIERS: THREAD_TIERS, FAINT_THREAD: FAINT_THREAD, STRONG: STRONG, FADE: FADE, FADE_NEAR: FADE_NEAR, FADE_FAR: FADE_FAR,
    quietInk: quietInk, useSpectrum: useSpectrum, palette: palette, setHalo: setHalo, setMarkScale: setMarkScale, markScale: markScale, radiusAt: radiusAt, get CATALYST_SCALE() { return CATALYST_SCALE; },
    ground: ground, cap: cap, closedCap: closedCap, droppedCap: droppedCap, noReading: noReading,
    taper: taper, thread: thread, cord: cord, drawLinksOf: drawLinksOf, HOVER_RANK: HOVER_RANK,
    STUB: STUB, TRAIL_ALPHA: TRAIL_ALPHA, REST_ALPHA: REST_ALPHA, FLUSH_AT: FLUSH_AT, PULSE_CELLS: PULSE_CELLS,
    LIFE: LIFE, LIGHT_INK: LIGHT_INK, lifeOf: lifeOf, drawLife: drawLife, setCanvasMaker: setCanvasMaker,
    growing: function (scene, trail) { return scene ? marksOf(scene, trail).grow : []; },
    positions: positions, heldAlpha: heldAlpha, isStaticCap: function (c, scene, trail) { return isStaticCap(c, scene ? marksOf(scene, trail) : null); },
    drawThreads: drawThreads, drawStatic: drawStatic, drawDynamic: drawDynamic, drawPulses: drawPulses, drawPulseTips: drawPulseTips, drawAbove: drawAbove,
    drawEased: drawEased, markPoints: markPoints, leader: leader, stub: stub,
    dial: dial, hasRing: hasRing, specimen: specimen, soilCore: soilCore, DIAL_INK: DIAL_INK, CORE_INK: CORE_INK,
  };
  return MapDraw;
})();
if (typeof module === "object" && module.exports) module.exports = MapDraw;
