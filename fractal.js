/* MMFractal: the site's fractal plates and rules. They are decoration around the map and on the Lanes page, never the map's
   record. Two kinds:
   - real data: the S&P 500's volatility drawn as a delay-embedding attractor and as a recurrence plot, from the series at
     the end of this file (the long-history store's discovery window, 1928 to 2020; testdata/make_plates.py wrote them);
   - generated: Julia sets, a lane's sigil seeded by a hash of its name, and the Mandelbrot slices used as rules.
   Every picture is computed once when the page loads (and again only when its size changes by more than a sixth). Only the
   map's scene moves: its colours drift slowly on a desktop (see start()). Pixel budgets and iteration counts are lower on a phone, a slow device or with Save-Data.
   Every function except start() is pure or draws only into the canvas it is given; node tests them. */
var MMFractal = (function () {
  "use strict";

  // The spectrum, from the void out to the boundary: void, indigo, ultraviolet, cyan, acid lime, magenta, near white.
  var STOPS = [[0, "#0b0820"], [0.16, "#1d1252"], [0.34, "#7b5cff"], [0.52, "#3ef0ff"], [0.66, "#c8ff3a"],
               [0.82, "#ff3fb4"], [1, "#f3eaff"]];
  var INSIDE = [7, 5, 26], VOID = [11, 8, 32];           // a point that never escapes: deeper than the ground
  var LUT_N = 512;

  function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  // A table of LUT_N colours along the stops, as one flat Uint8Array (r, g, b per entry).
  function lut(stops) {
    var s = stops || STOPS, out = new Uint8Array(LUT_N * 3), k = 0;
    for (var i = 0; i < LUT_N; i++) {
      var t = i / (LUT_N - 1);
      while (k < s.length - 2 && t > s[k + 1][0]) k++;
      var a = s[k], b = s[k + 1], u = (t - a[0]) / Math.max(1e-9, b[0] - a[0]), A = hexRgb(a[1]), B = hexRgb(b[1]);
      for (var c = 0; c < 3; c++) out[i * 3 + c] = Math.round(A[c] + (B[c] - A[c]) * Math.max(0, Math.min(1, u)));
    }
    return out;
  }
  var LUT = lut(STOPS);

  // FNV-1a over the text: the same name gives the same sigil on every visit and every machine.
  function hash(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  // A lane's Julia parameter from its name: a point just outside the edge of the Mandelbrot set's main cardioid,
  // c = r (e^(i theta) / 2 - e^(2 i theta) / 4), where Julia sets break into their most ornate dust and filaments. theta and r come from
  // the name's hash. Returns {re, im, theta, r}.
  function seedC(name) {
    var h = hash(String(name));
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0; h = (h ^ (h >>> 16)) >>> 0;
    var theta = 0.35 + (2 * Math.PI - 0.7) * ((h % 100003) / 100003);
    var r = 1.015 + 0.035 * (((h >>> 17) % 1000) / 1000);
    var re = r * (Math.cos(theta) / 2 - Math.cos(2 * theta) / 4), im = r * (Math.sin(theta) / 2 - Math.sin(2 * theta) / 4);
    return { re: re, im: im, theta: theta, r: r };
  }

  // Escape time with a smooth count: 0 inside, else a value in (0, 1].
  function escape(zr, zi, cr, ci, max) {
    var n = 0, r2 = 0;
    while (n < max) {
      var t = zr * zr - zi * zi + cr;
      zi = 2 * zr * zi + ci; zr = t; n++;
      r2 = zr * zr + zi * zi;
      if (r2 > 256) break;
    }
    if (n >= max) return 0;
    var nu = n + 1 - Math.log(Math.log(r2) / 2 / Math.LN2) / Math.LN2;
    return nu > 0 ? Math.max(1e-6, Math.min(1, Math.sqrt(nu / max))) : 1e-6;
  }

  // Fills an RGBA buffer w x h for the box {x0, x1, y0, y1} of the plane. kind "julia" (c given) or "mandel".
  // ss: samples per side (1 or 2); with 2, each pixel is the mean of four samples, which calms the speckle at the edge.
  // turn: the picture's across runs along the plane's imaginary axis (box.x is then the imaginary range, box.y the real).
  function field(buf, w, h, box, kind, c, max, ss, turn) {
    var dx = (box.x1 - box.x0) / w, dy = (box.y1 - box.y0) / h, S = ss === 2 ? 2 : 1, N = S * S;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var R = 0, G = 0, B = 0;
        for (var sy = 0; sy < S; sy++) for (var sx = 0; sx < S; sx++) {
          var a = box.x0 + (x + (sx + 0.5) / S) * dx, q = box.y0 + (y + (sy + 0.5) / S) * dy, re = turn ? q : a, im = turn ? a : q;
          var v = kind === "julia" ? escape(re, im, c.re, c.im, max) : escape(0, 0, re, im, max);
          if (v === 0) { R += INSIDE[0]; G += INSIDE[1]; B += INSIDE[2]; }
          else { var j = Math.min(LUT_N - 1, Math.floor(v * (LUT_N - 1))) * 3; R += LUT[j]; G += LUT[j + 1]; B += LUT[j + 2]; }
        }
        var o = (y * w + x) * 4;
        buf[o] = R / N; buf[o + 1] = G / N; buf[o + 2] = B / N; buf[o + 3] = 255;
      }
    }
    return buf;
  }

  // ---- the real-data plates ----

  function decode(b64) {
    var bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // A series of PLATES as plain numbers (the logs of annualized volatility), from its 0..255 steps.
  function series(key) {
    var s = PLATES[key], q = decode(s.b64), out = new Float64Array(q.length);
    for (var i = 0; i < q.length; i++) out[i] = s.lo + (s.hi - s.lo) * q[i] / 255;
    return out;
  }

  // The attractor: each point pairs x[t] with x[t + lag]; consecutive points are joined. The segments are added into a
  // grid, so a stretch the market visits often is brighter. Returns the grid's largest count (for tests).
  // The pair is drawn turned by 45 degrees: across, the level (x[t] + x[t + lag]); up, the change (x[t + lag] - x[t]) on a square-root scale,
  // each axis scaled to fill the picture, so the loops spread over the whole plate instead of one diagonal.
  function attractor(buf, w, h, xs, lag) {
    var n = xs.length - lag, i, U = new Float64Array(n), V = new Float64Array(n);
    var u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (i = 0; i < n; i++) {
      U[i] = xs[i] + xs[i + lag]; V[i] = xs[i + lag] - xs[i];
      if (U[i] < u0) u0 = U[i]; if (U[i] > u1) u1 = U[i]; if (V[i] < v0) v0 = V[i]; if (V[i] > v1) v1 = V[i];
    }
    var vm = Math.max(Math.abs(v0), Math.abs(v1)) || 1, pad = 0.05, grid = new Float32Array(w * h);
    var px0 = null, py0 = null;
    for (i = 0; i < n; i++) {
      var X = (pad + (1 - 2 * pad) * (U[i] - u0) / ((u1 - u0) || 1)) * (w - 1);
      var sv = V[i] / vm, Y = (0.5 - (0.5 - pad) * (sv < 0 ? -Math.sqrt(-sv) : Math.sqrt(sv))) * (h - 1);
      if (px0 !== null) {
        var steps = Math.max(1, Math.ceil(Math.max(Math.abs(X - px0), Math.abs(Y - py0))));
        for (var k = 1; k <= steps; k++) {
          var gx = Math.round(px0 + (X - px0) * k / steps), gy = Math.round(py0 + (Y - py0) * k / steps);
          grid[gy * w + gx] += 1 / steps + 0.15;
        }
      }
      px0 = X; py0 = Y;
    }
    var top = 0;
    for (i = 0; i < grid.length; i++) if (grid[i] > top) top = grid[i];
    var L = Math.log(1 + top);
    for (i = 0; i < grid.length; i++) {
      var o = i * 4, g = grid[i];
      if (g <= 0) { buf[o] = 11; buf[o + 1] = 8; buf[o + 2] = 32; buf[o + 3] = 255; continue; }
      var t = 0.2 + 0.8 * Math.log(1 + g) / L, j = Math.min(LUT_N - 1, Math.floor(t * (LUT_N - 1))) * 3;
      buf[o] = LUT[j]; buf[o + 1] = LUT[j + 1]; buf[o + 2] = LUT[j + 2]; buf[o + 3] = 255;
    }
    return top;
  }

  // The recurrence plot: pixel (i, j) is how far apart months i and j were, |x_i - x_j|, folded into bands of `bands`
  // turns of the spectrum, so months alike share a colour. Months run left to right and top to bottom.
  function recurrence(buf, w, h, xs, bands) {
    var n = xs.length, lo = Infinity, hi = -Infinity, i;
    for (i = 0; i < n; i++) { if (xs[i] < lo) lo = xs[i]; if (xs[i] > hi) hi = xs[i]; }
    var span = hi - lo || 1, B = bands || 3;
    for (var y = 0; y < h; y++) {
      var a = xs[Math.min(n - 1, Math.floor(y * n / h))];
      for (var x = 0; x < w; x++) {
        var d = Math.abs(a - xs[Math.min(n - 1, Math.floor(x * n / w))]) / span;
        var t = (d * B) % 1, near = 1 - Math.min(1, d * 2.2);
        var j = Math.min(LUT_N - 1, Math.floor((0.12 + 0.88 * t * near + 0.88 * near * near * (1 - t)) * (LUT_N - 1))) * 3;
        var o = (y * w + x) * 4;
        buf[o] = LUT[j]; buf[o + 1] = LUT[j + 1]; buf[o + 2] = LUT[j + 2]; buf[o + 3] = 255;
      }
    }
    return buf;
  }

  // A rule: a band that follows the edge of the Mandelbrot set's main cardioid, just outside it, all the way round.
  // Along the rule, t runs once round the cardioid, c = s (e^(it) / 2 - e^(2it) / 4); across it, s runs from 1.012 to
  // 1.05. Every point escapes, so the band is continuous colour with a beat at each bulb, never a hole.
  function rule(buf, w, h, max) {
    var along = w >= h, L = along ? w : h, T = along ? h : w;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var R = 0, G = 0, B = 0;
        for (var k = 0; k < 4; k++) {
          var u = ((along ? x : y) + (k % 2 ? 0.75 : 0.25)) / L, v = ((along ? y : x) + (k < 2 ? 0.25 : 0.75)) / T;
          var t = 0.18 + u * (2 * Math.PI - 0.36), sc = 1.012 + 0.038 * v;
          var cr = sc * (Math.cos(t) / 2 - Math.cos(2 * t) / 4), ci = sc * (Math.sin(t) / 2 - Math.sin(2 * t) / 4);
          var e = escape(0, 0, cr, ci, max), j = Math.min(LUT_N - 1, Math.floor((0.3 + 0.7 * Math.min(1, e * 1.8)) * (LUT_N - 1))) * 3;
          R += LUT[j]; G += LUT[j + 1]; B += LUT[j + 2];
        }
        var o = (y * w + x) * 4;
        buf[o] = R / 4; buf[o + 1] = G / 4; buf[o + 2] = B / 4; buf[o + 3] = 255;
      }
    }
    return buf;
  }

  // The scene behind the map: a Julia set's escape times, kept so the colours can be laid again with a phase. The colours run
  // round the spectrum (a cosine of the escape time plus the phase) and are dimmed to `dim`, so plates and text over it stay
  // the brightest things on the page. Returns the escape values (0 inside).
  var SCENE_C = { re: -0.7269, im: 0.1889 }, SCENE_DIM = 0.46;
  function sceneEscapes(w, h, max) {
    var box = boxFor(w, h, 0, 0, 1.55), out = new Float32Array(w * h), dx = (box.x1 - box.x0) / w, dy = (box.y1 - box.y0) / h;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++)
      out[y * w + x] = escape(box.x0 + (x + 0.5) * dx, box.y0 + (y + 0.5) * dy, SCENE_C.re, SCENE_C.im, max);
    return out;
  }
  function sceneColour(buf, esc, phase, dim, mist) {
    if (mist) return mistColour(buf, esc, phase, mist);
    for (var i = 0; i < esc.length; i++) {
      var v = esc[i], o = i * 4;
      if (v === 0) { buf[o] = INSIDE[0]; buf[o + 1] = INSIDE[1]; buf[o + 2] = INSIDE[2]; buf[o + 3] = 255; continue; }
      var t = 0.5 - 0.5 * Math.cos(2 * Math.PI * (v * 1.35 + phase)), k = dim * Math.min(1, v * 3.2);
      var j = Math.min(LUT_N - 1, Math.floor((0.08 + 0.92 * t) * (LUT_N - 1))) * 3;
      buf[o] = VOID[0] + (LUT[j] - VOID[0]) * k; buf[o + 1] = VOID[1] + (LUT[j + 1] - VOID[1]) * k; buf[o + 2] = VOID[2] + (LUT[j + 2] - VOID[2]) * k; buf[o + 3] = 255;
    }
    return buf;
  }

  // The mist schemes' ground: the same Julia escape times, laid at low contrast and pulled toward the haze colour, so the
  // fractal reads as weather, not as pattern. A few broad pools of light (MIST.lights, in shares of the picture) are added on
  // top, each a slow Gaussian fall with no edge; `breath` (0..1) swells them a little. The picture is small (a tenth of the
  // screen or less) and the browser stretches it, which is what softens it: no filter is used. Plain pixel arithmetic.
  // w, h: the picture's size (the lights need it). mist: {haze [r,g,b], contrast, dim, lights, breath, w, h}.
  function mistLight(w, h, lights) {
    var out = new Float32Array(w * h * 3), L = lights || [];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var o = (y * w + x) * 3, R = 0, G = 0, B = 0;
      for (var k = 0; k < L.length; k++) {
        var l = L[k], dx = (x + 0.5) / w - l[0], dy = ((y + 0.5) / h - l[1]) * (h / w), f = l[4] * Math.exp(-(dx * dx + dy * dy) / (l[2] * l[2]));
        R += l[3][0] * f; G += l[3][1] * f; B += l[3][2] * f;
      }
      out[o] = R; out[o + 1] = G; out[o + 2] = B;
    }
    return out;
  }
  // The mist's escape field: each pixel the mean of S x S samples, then three passes of a three-tap box (plain arithmetic), so
  // the small picture has no speckle left for the stretch to turn into blocks.
  function mistEscapes(w, h, max, S) {
    var box = boxFor(w, h, 0, 0, 1.55), out = new Float32Array(w * h), dx = (box.x1 - box.x0) / w, dy = (box.y1 - box.y0) / h, x, y, i;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var sum = 0;
      for (var sy = 0; sy < S; sy++) for (var sx = 0; sx < S; sx++)
        sum += escape(box.x0 + (x + (sx + 0.5) / S) * dx, box.y0 + (y + (sy + 0.5) / S) * dy, SCENE_C.re, SCENE_C.im, max);
      out[y * w + x] = sum / (S * S);
    }
    var tmp = new Float32Array(w * h);
    for (var pass = 0; pass < 3; pass++) {
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = y * w + x; tmp[i] = (out[i - (x > 0 ? 1 : 0)] + out[i] + out[i + (x < w - 1 ? 1 : 0)]) / 3; }
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = y * w + x; out[i] = (tmp[i - (y > 0 ? w : 0)] + tmp[i] + tmp[i + (y < h - 1 ? w : 0)]) / 3; }
    }
    for (i = 0; i < out.length; i++) if (out[i] === 0) out[i] = 1e-6;   // a softened field has no hard inside: every pixel takes the haze
    return out;
  }
  function mistOf(w, h) {
    return { haze: MIST.haze, contrast: MIST.contrast, dim: MIST.dim, breath: MIST.breath, light: mistLight(w, h, MIST.lights) };
  }
  function mistColour(buf, esc, phase, m) {
    var hz = m.haze, ct = m.contrast, dim = m.dim, lit = m.light, sw = 1 + (m.breath || 0) * 0.2 * Math.sin(2 * Math.PI * phase * 24);
    for (var i = 0; i < esc.length; i++) {
      var v = esc[i], o = i * 4, r, g, b;
      if (v === 0) { r = INSIDE[0]; g = INSIDE[1]; b = INSIDE[2]; }
      else {
        var t = 0.5 - 0.5 * Math.cos(2 * Math.PI * (v * 1.1 + phase)), k = dim * Math.min(1, v * 2.4);
        var j = Math.min(LUT_N - 1, Math.floor((0.1 + 0.85 * t) * (LUT_N - 1))) * 3;
        r = hz[0] + (LUT[j] - hz[0]) * k; g = hz[1] + (LUT[j + 1] - hz[1]) * k; b = hz[2] + (LUT[j + 2] - hz[2]) * k;   // the set melts into the haze
      }
      r = hz[0] + (r - hz[0]) * ct; g = hz[1] + (g - hz[1]) * ct; b = hz[2] + (b - hz[2]) * ct;
      if (lit) { r += lit[i * 3] * sw; g += lit[i * 3 + 1] * sw; b += lit[i * 3 + 2] * sw; }
      buf[o] = r < 0 ? 0 : r > 255 ? 255 : r; buf[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g; buf[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b; buf[o + 3] = 255;
    }
    return buf;
  }

  // A cap's halo: a small patch of a Julia set in the colours of the cap's kind, as a canvas px wide. The cap sits on its
  // middle, so the patch is solid close in and fades to nothing at the rim: a smooth radial fall, never a hard edge. The
  // map draws one of each kind once and stamps it under every cap of that kind. Returns null where there is no canvas.
  var HALOS = {
    "with":   { c: [-0.7269, 0.1889], at: [0.12, 0.05],  span: 0.5, ramp: [[0, "#0b0820"], [0.35, "#0c2f5c"], [0.7, "#13819f"], [1, "#4cc6dd"]] },
    against: { c: [-0.4, 0.6],        at: [-0.05, 0.1],  span: 0.55, ramp: [[0, "#0b0820"], [0.35, "#40115a"], [0.7, "#9a1f74"], [1, "#e458b4"]] },
    loud:    { c: [0.285, 0.01],      at: [0.1, 0.12],   span: 0.55, ramp: [[0, "#0b0820"], [0.35, "#241c5c"], [0.7, "#4a38b0"], [1, "#8a78e6"]] },
    quiet:   { c: [-0.8, 0.156],      at: [0.0, 0.1],    span: 0.6, ramp: [[0, "#0b0820"], [0.3, "#1a1450"], [0.62, "#4a3ab0"], [1, "#8f82f0"]] },
  };

  // Colour schemes (the map page reads ?scheme=name; the default is "acid", the spectrum above). A scheme sets the scene's
  // ramp, its void and interior, and the four halo ramps; map_draw.js holds the matching inks for the caps and threads.
  function ramp4(v, a, b, c) { return [[0, v], [0.35, a], [0.7, b], [1, c]]; }
  var SCHEMES = {
    acid: null,
    ink: { void: [7, 8, 10], inside: [4, 5, 7],
           stops: [[0, "#07080a"], [0.16, "#14161b"], [0.34, "#3a3f4a"], [0.52, "#9aa3b2"], [0.66, "#ff4d2e"], [0.82, "#f2f4f8"], [1, "#ffffff"]],
           halos: { "with": ramp4("#07080a", "#2a2f3a", "#7c8596", "#d9dee8"), against: ramp4("#07080a", "#4a140c", "#b2331b", "#ff6a4a"),
                    loud: ramp4("#07080a", "#23262e", "#4b5160", "#8a93a3"), quiet: ramp4("#07080a", "#1a1c22", "#3a3f4a", "#6b7380") } },
    ember: { void: [20, 8, 6], inside: [10, 4, 3],
             stops: [[0, "#140806"], [0.16, "#3a0f0a"], [0.34, "#b83a0c"], [0.52, "#ff8a1f"], [0.66, "#ffd23f"], [0.82, "#ff2e7e"], [1, "#fff1d6"]],
             halos: { "with": ramp4("#140806", "#4a2a06", "#b8790f", "#f5c23a"), against: ramp4("#140806", "#4a0c26", "#a8174f", "#ee4f8c"),
                      loud: ramp4("#140806", "#3a2418", "#7a5a44", "#c4a284"), quiet: ramp4("#140806", "#2a1510", "#5a3a2a", "#8a6a58") } },
    paper: { void: [239, 232, 220], inside: [226, 217, 202],
             stops: [[0, "#efe8dc"], [0.16, "#d9cdf0"], [0.34, "#9d86ff"], [0.52, "#2bb3c9"], [0.66, "#a8d400"], [0.82, "#e0307f"], [1, "#2a1f4a"]],
             halos: { "with": ramp4("#efe8dc", "#bfe3ea", "#4fb6c8", "#0a7f96"), against: ramp4("#efe8dc", "#f0c4d6", "#e0709f", "#b01c5c"),
                      loud: ramp4("#efe8dc", "#d8d0e8", "#9a8cc8", "#5a4a98"), quiet: ramp4("#efe8dc", "#e0d8ea", "#b8aed6", "#8a7cc0") } },
    dusk: { void: [13, 12, 28], inside: [9, 8, 22],
            stops: [[0, "#0d0c1c"], [0.16, "#1a1838"], [0.34, "#4a4a8a"], [0.52, "#4f9fae"], [0.66, "#9aae5a"], [0.82, "#a8567e"], [1, "#e4e0f0"]],
            halos: { "with": ramp4("#0d0c1c", "#4a3410", "#a8761c", "#e8b04a"), against: ramp4("#0d0c1c", "#4a1636", "#a82a68", "#f06aa4"),
                     loud: ramp4("#0d0c1c", "#2a2c50", "#6a7098", "#b8c4e0"), quiet: ramp4("#0d0c1c", "#1a1a40", "#3a3a80", "#6a6ab8") } },
    // The two mist schemes: the ground is weather. `mist` holds the haze, its contrast, the pools of light ([x, y, radius,
    // [r, g, b], strength], x and y as shares of the picture, radius as a share of its width), `soft` (the picture's size as
    // a share of the screen's: the stretch is the softness) and `breath` (how much the light swells while it drifts).
    mist: { void: [15, 15, 36], inside: [12, 12, 31],
            stops: [[0, "#0f0f24"], [0.2, "#1b1c44"], [0.42, "#35396c"], [0.62, "#587f94"], [0.8, "#9c8ba9"], [1, "#dcd8ee"]],
            halos: { "with": ramp4("#0f0f24", "#4a3a22", "#b08a52", "#f3cf8e"), against: ramp4("#0f0f24", "#4a2240", "#b0507e", "#f497bf"),
                     loud: ramp4("#0f0f24", "#2a2c50", "#7a80a8", "#d8dcf0"), quiet: ramp4("#0f0f24", "#1a1a40", "#3e3e7e", "#7070b0") },
            mist: { haze: [28, 28, 62], contrast: 0.3, dim: 0.62, soft: 0.1, breath: 1,
                    lights: [[0.08, 0.12, 0.36, [62, 126, 136], 0.68], [0.9, 0.9, 0.34, [158, 104, 96], 0.6],
                             [0.84, 0.06, 0.26, [96, 84, 156], 0.55], [0.5, 1.04, 0.36, [70, 72, 120], 0.4]] } },
    pearl: { void: [238, 238, 245], inside: [230, 229, 241],
             stops: [[0, "#eeeef5"], [0.25, "#dedaf0"], [0.5, "#c9dce5"], [0.75, "#ecd5da"], [1, "#beb6dc"]],
             halos: { "with": ramp4("#eeeef5", "#ecdcc0", "#c09048", "#8a5a10"), against: ramp4("#eeeef5", "#f0cfdc", "#d0628f", "#a4235a"),
                      loud: ramp4("#eeeef5", "#d8d4ea", "#8e88b8", "#45407a"), quiet: ramp4("#eeeef5", "#e2def0", "#bab2d8", "#8a80bc") },
             mist: { haze: [236, 236, 244], contrast: 0.62, dim: 0.95, soft: 0.1, breath: 1,
                     lights: [[0.08, 0.16, 0.34, [-34, -8, -4], 0.7], [0.9, 0.88, 0.32, [-4, -26, -18], 0.7],
                              [0.84, 0.06, 0.26, [-16, -18, 0], 0.6], [0.45, 1.05, 0.36, [-10, -4, -14], 0.45]] } },
  };
  var ACID = { stops: STOPS, void: VOID.slice(), inside: INSIDE.slice(), halos: null }, SCHEME = "acid", MIST = null;
  function setScheme(name) {
    var sc = SCHEMES[name] || ACID;
    SCHEME = SCHEMES[name] ? name : "acid"; MIST = sc.mist || null;
    LUT = lut(sc.stops); VOID = sc.void.slice(); INSIDE = sc.inside.slice();
    if (!ACID.halos) { ACID.halos = {}; Object.keys(HALOS).forEach(function (k) { ACID.halos[k] = HALOS[k].ramp; }); }
    Object.keys(HALOS).forEach(function (k) { HALOS[k].ramp = (sc.halos || ACID.halos)[k]; });
    return SCHEME;
  }
  function haloSprite(kind, px, doc) {
    var d = doc || (typeof document !== "undefined" ? document : null), H = HALOS[kind] || HALOS.quiet;
    if (!d || typeof d.createElement !== "function") return null;
    var cv = d.createElement("canvas"), g = cv.getContext ? cv.getContext("2d") : null;
    if (!g || typeof g.createImageData !== "function") return null;
    cv.width = px; cv.height = px;
    var img = g.createImageData(px, px), buf = img.data, rl = lut(H.ramp), half = px / 2, y, x, sy, sx;
    for (y = 0; y < px; y++) for (x = 0; x < px; x++) {
      var dx = (x + 0.5 - half) / half, dy = (y + 0.5 - half) / half, rr = Math.sqrt(dx * dx + dy * dy), o = (y * px + x) * 4;
      if (rr >= 1) { buf[o + 3] = 0; continue; }
      // the fall: full to 0.45 of the way out, then a smoothstep to nothing at the rim
      var q = rr <= 0.45 ? 0 : (rr - 0.45) / 0.55, f = 1 - q * q * (3 - 2 * q), R = 0, G = 0, B = 0, A = 0;
      // four samples a pixel: the filaments come out as lines, not as grit
      for (sy = 0; sy < 2; sy++) for (sx = 0; sx < 2; sx++) {
        var px_ = dx + (sx - 0.5) / px, py_ = dy + (sy - 0.5) / px;
        var v = escape(H.at[0] + px_ * H.span, H.at[1] + py_ * H.span, H.c[0], H.c[1], 80), body, j;
        if (v === 0) { body = 0.5; j = Math.floor(0.3 * (LUT_N - 1)) * 3; }
        else { body = 0.55 + 0.45 * Math.min(1, v * 2.4); j = Math.min(LUT_N - 1, Math.floor(Math.min(1, v * 1.7) * (LUT_N - 1))) * 3; }
        R += rl[j] * body; G += rl[j + 1] * body; B += rl[j + 2] * body; A += body;
      }
      buf[o] = R / A; buf[o + 1] = G / A; buf[o + 2] = B / A; buf[o + 3] = Math.round(255 * f * A / 4);
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  // The spectrum's colour at t in [0, 1], as "#rrggbb" (the time core takes its days from it).
  function color(t) {
    var j = Math.min(LUT_N - 1, Math.max(0, Math.floor(t * (LUT_N - 1)))) * 3, h = function (v) { return (v < 16 ? "0" : "") + v.toString(16); };
    return "#" + h(LUT[j]) + h(LUT[j + 1]) + h(LUT[j + 2]);
  }

  // ---- drawing into the page ----

  // How hard the page may work: a phone, few cores or Save-Data get smaller pictures and fewer iterations.
  function budget(env) {
    var e = env || {}, small = (e.width || 1024) < 640, slow = (e.cores || 8) <= 4 || !!e.saveData;
    return { dpr: Math.min(e.dpr || 1, small || slow ? 1.5 : 2), pixels: small || slow ? 140000 : 420000, iter: small || slow ? 110 : 220 };
  }
  // The canvas's backing size for its shown size, inside the budget.
  function backing(cssW, cssH, b) {
    var w = Math.max(1, Math.round(cssW * b.dpr)), h = Math.max(1, Math.round(cssH * b.dpr)), k = Math.sqrt(b.pixels / (w * h));
    if (k < 1) { w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k)); }
    return { w: w, h: h };
  }
  // A box of the plane with the canvas's aspect, centred on (cx, cy), `span` wide or tall, whichever is the shorter side.
  function boxFor(w, h, cx, cy, span) {
    var a = w / h, sx = a >= 1 ? span * a : span, sy = a >= 1 ? span : span / a;
    return { x0: cx - sx / 2, x1: cx + sx / 2, y0: cy - sy / 2, y1: cy + sy / 2 };
  }

  function paint(cv, b) {
    var kind = cv.getAttribute("data-fractal"), r = cv.getBoundingClientRect(), cssW = r.width, cssH = r.height;
    if (!(cssW > 0 && cssH > 0) || !cv.getContext) return false;
    var size = kind === "scene" && MIST ? { w: Math.max(8, Math.round(cssW * MIST.soft)), h: Math.max(8, Math.round(cssH * MIST.soft)) }
                                        : backing(cssW, cssH, b), ctx = cv.getContext("2d");
    if (!ctx) return false;
    cv.width = size.w; cv.height = size.h;
    var img = ctx.createImageData(size.w, size.h), buf = img.data;
    if (kind === "attractor") attractor(buf, size.w, size.h, series("daily"), 10);
    else if (kind === "recurrence") recurrence(buf, size.w, size.h, series("monthly"), 3);
    else if (kind === "julia") {
      var given = /^(-?\d*\.?\d+),(-?\d*\.?\d+)$/.exec(cv.getAttribute("data-c") || ""), span = Number(cv.getAttribute("data-span")) || 3.1;
      var c = given ? { re: Number(given[1]), im: Number(given[2]) } : seedC(cv.getAttribute("data-seed") || "");
      field(buf, size.w, size.h, boxFor(size.w, size.h, 0, 0, span), "julia", c, b.iter, size.w * size.h * 4 <= b.pixels * 1.5 ? 2 : 1);
    } else if (kind === "mandel") {
      // data-centre "re,im", data-span and data-iter zoom in; without them, the whole set.
      // data-turn: the picture's across runs along the imaginary axis.
      var at = /^(-?\d*\.?\d+),(-?\d*\.?\d+)$/.exec(cv.getAttribute("data-centre") || ""), zs = Number(cv.getAttribute("data-span")) || 2.6;
      var it = Math.min(Number(cv.getAttribute("data-iter")) || b.iter, b.iter * 3), turn = cv.hasAttribute("data-turn");
      var cr = at ? Number(at[1]) : -0.62, ci = at ? Number(at[2]) : 0;
      field(buf, size.w, size.h, boxFor(size.w, size.h, turn ? ci : cr, turn ? cr : ci, zs), "mandel", null, it,
            size.w * size.h * 4 <= b.pixels * 1.5 ? 2 : 1, turn);
    } else if (kind === "scene") {
      var esc = MIST ? mistEscapes(size.w, size.h, b.iter, 4) : sceneEscapes(size.w, size.h, b.iter), mist = MIST ? mistOf(size.w, size.h) : null;
      sceneColour(buf, esc, 0, SCENE_DIM, mist);
      cv._scene = { esc: esc, img: img, ctx: ctx, mist: mist };
    } else if (kind === "rule") {
      rule(buf, size.w, size.h, Math.round(b.iter * 0.8));
    } else return false;
    ctx.putImageData(img, 0, 0);
    cv.setAttribute("data-drawn", String(size.w));
    return true;
  }

  // Paints every canvas[data-fractal] once, and again when its shown size changes by more than a sixth.
  function start(doc, win) {
    try {
      var m = /[?&]scheme=([a-z]+)/.exec((win.location && win.location.search) || ""), dflt = doc.documentElement.getAttribute("data-scheme-default"),
          pick = m && m[1] in SCHEMES ? m[1] : dflt && SCHEMES[dflt] ? dflt : null;
      if (pick) { setScheme(pick); doc.documentElement.setAttribute("data-scheme", pick); }
    } catch (e) { /* the default scheme stays */ }
    var d = doc || (typeof document !== "undefined" ? document : null), w = win || (typeof window !== "undefined" ? window : null);
    if (!d || !w) return;
    var nav = w.navigator || {}, b = budget({ width: w.innerWidth, dpr: w.devicePixelRatio || 1, cores: nav.hardwareConcurrency,
                                             saveData: nav.connection && nav.connection.saveData });
    var shown = {};
    // The scene's colours drift round the spectrum, one turn in about four minutes, on a desktop only: never with reduced
    // motion, on a phone, on few cores or with Save-Data, and never while the page is hidden. It is the page's chrome and
    // shows nothing that happened.
    var still = !(w.matchMedia && w.matchMedia("(prefers-reduced-motion: no-preference)").matches) || w.innerWidth < 1024 ||
                (nav.hardwareConcurrency || 8) <= 4 || !!(nav.connection && nav.connection.saveData);
    var phase = 0;
    function drift() {
      if (!d.hidden) {
        phase = (phase + (MIST ? 0.00028 : 0.0006)) % 1;   // the mist drifts at half the pace, and its light breathes about every 25 s
        var list = d.querySelectorAll('canvas[data-fractal="scene"]');
        for (var i = 0; i < list.length; i++) {
          var sc = list[i]._scene;
          if (sc) { sceneColour(sc.img.data, sc.esc, phase, SCENE_DIM, sc.mist); sc.ctx.putImageData(sc.img, 0, 0); }
        }
      }
      w.setTimeout(drift, 150);
    }
    if (!still) w.setTimeout(drift, 1500);
    function all(force) {
      var list = d.querySelectorAll("canvas[data-fractal]");
      for (var i = 0; i < list.length; i++) {
        var cv = list[i], r = cv.getBoundingClientRect(), was = shown[i];
        if (!force && was && Math.abs(r.width - was.w) / was.w < 1 / 6 && Math.abs(r.height - was.h) / was.h < 1 / 6) continue;
        try { if (paint(cv, b)) shown[i] = { w: r.width, h: r.height }; } catch (e) { /* a picture that fails leaves its ground */ }
      }
    }
    var timer = null;
    function later() { if (timer) w.clearTimeout(timer); timer = w.setTimeout(function () { timer = null; all(false); }, 240); }
    if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", function () { all(true); });
    else all(true);
    w.addEventListener("resize", later);
    // A page that lays itself out after load (the map sets its kind of screen) moves and resizes some canvases: each is
    // painted again once its new size settles.
    if (typeof w.ResizeObserver === "function") {
      var ro = new w.ResizeObserver(later), list = d.querySelectorAll("canvas[data-fractal]");
      for (var i = 0; i < list.length; i++) ro.observe(list[i]);
    }
  }

  // The real series (written by testdata/make_plates.py from the long-history store; do not edit by hand).
  // <<: plates data
  var PLATES = {"daily":{"first":"1928-01-31","last":"2020-12-31","n":11671,"step":2,"lo":-3.70024,"hi":0.05005,"b64":"bGxuamleamtnY2BoY2tsa2xZW2Fjd3R0eXt9fYN/gHxydHRvaXByfHuBgoGAkJqbnJuXmJeYmZiOhn99fXx6eHF0ZmJmY2dna2tsamJmYVtgXFNdYFxaVllbVFlYYWdqbWttbXFxeHhvdHOTlZSUlZSTlZiVjIN9g4GBgYN/fG2BiYaJioqIi4yPkIWFfH2UnKCgoaGhnp2enY5/dGpmZHp8e4eZoqKlpaWkoaOekIxrbWZkXV1dVF1lZHBvdHeOlpaYlpaSkZCWmYaIiIeIjJSRnq2srKuxt8DC4/L39fb8/v///vbn49bVybO3s7W0sK+trZiWj354emprbmtraml3enl4d3NvcXR2Zl1he5eXmJeXmJubmp2DkZubn6GjoaKgoJWFnKSjuMHCw8THyMjFx7axrqmop6akpaqmqaKenp6amJiJfYN3f4iLkaKjp6qvsbi4vb27trK3tbi1sbGtsK+rqaShrautr7G0tMrKysfEwsLCwb6vnJiSk5OVlZqdpKSan52fmJqbnJaRlJCNkpKZlKuvrrOysrW0t7WpqcLAwsK9vtHS0s3FxMfGyMrJsamlp6WenZ+fn5ycmZKUlZeelZqdrL7JysrV5+3t7u7t5+fl5cvCvcDBvrm8u7u8srO2s8jLycrQ1tfW1tjP0M7Nz8a9uMPLy9DOzs/NzcrNvbi1paq2rbGtr7q+vcTGyMTCzMrMx8TBv7/K0dfU3Nze4eHg3tjT0M7IxsDBx8LDxs3Pz9zc3d7c3N3U1NDY0dLV4OLi4+Hk6evr7OLh4eDh3+HZ1NXS0NDR0tTKvLe0triytLCwqKmpq6yqpaWhnJmSmKSnqrjBw+Xm6Ojm5+bk3+Lhw8jU2Nfa19fc2tzbzsXEx77AuLK6xM/O0dDO0tLS0M/CzuDf3+Le3eHg4OHMv8C3tLe0tLOzqLm6ubq6w8XAys3Sz9HS08/R0M7IvLy4urCxrauqqaOdp6WlpqGmpLGsq6ijoKKiqq2en52hqqmsrKinpKeqrKeoo6OcmpubjoeDeYOHm5+hpKGmqKmnqK2cpKKko6GkpaWioZCPkY6Sm7S5vLu7wMPCwb2+o6SgnaCZkpedmJyboKCemp+cnJiXl5WOkpGNjJCQkpGNkZCOjo2DhIVziYeGh4WMj46PjoCBgYCHgXiHiI2KipCSl5WakpiXmJmRlpGNiNDQ0NDQ0NHR0NDExMPCw8PExMPDxISCiI2FgXl6enp5enRxdHl8gH+DgrTCwsLDwsHCwcHCg5GUiIiVlZWXl5mWlZSUlIOFhISGfHN/g4mQj5GRmqGfnZuclZiXlJFocXp7eXx4dnZ4eHNueYGCgH+Vm6CioqGfnZ6ekpGIfImMlJuinp+goKOjoZqTiYaEgISGg3h4ent6enV1dnRzcm1sb3J2dHNubnRxcYmEioiIiYmJpLOvrq6ur7Cvrq5xcHJ+fX16foGDhYiNh4WEgH99e3Z8fXh4eXqBgH5+fnJ4eHRsaW1wdXR8fHZ6fn18fXqBjYmNjIySkpOSjoeImpqgopyfo6WnqaCZlZOUkJKSkYqJiY+Qm5ubjoyOjY2FhId3eXV2cXR1dn17hJufqrCzuLnAwL/Ewb25x9TV09PU1tLX1tbNwsfJx8PEwr28va+rqaqmrcHCw8PCwsDBwb6xqampqauxqqqqpaOcpK2vrbK5t8bIzM7JysfJxLy5tLexsrGvrKqnq6agoKSjo7Gyq6+wrK6vq62mo6SrpKGin6GimZuck6Wlqaips7a4ury9v8LCwtbS0NDPysnGxcS1jJWUk5qenp+flpqUkZGSiYGCiYuLjYqqqLCxs7Szs7CwsZ6UiIaDf3yKlp6hnaOur7C0s7SzsK+woZ+Tko2QjI6SkZGNjouNjYqLiYaHjJKQkJSdnqGhnZOTlpaWmIyNkpedo6TKysrKzczJyMnIoqGcmqB5eXt7dXN2enl7bG5xaW1ucnFvdG5vb2poa2xpbG9wcHF2dG5pbHFbWVlWUUxMTlBLPkpQUE9ZWmFhZ2pra2xuaWtwaGVhmrS7wsLFxcTFx87Gx8CytrO0srGpi35+fnhfbWppbW+Kio2Rk5KOkZSdnJKPj5ORlJOPjoaDgoGCdHRsbWybnZ2go6OkpKOim3JubWtaW1RYa2ppam5sb29veWt2dHiGiY6PkI2Mj5CRjHp5dnN1bnFqb29ucG90c3V0d21tbXN1dXZ3c3Zve3lwcXB1cHJwdnZycnN6b29xcXFeY2VlallYU1NUVldQVU5dYWNnaWdmamlqXmhna2pqcW93enZ2dHNwfnuUmJWVk5OUo6OmnpaWl5OUlZaDcHFza2txbm9sd3uChISNiouMjImGe354eG9zenqCg4GEhISGgoV4eXZ1d3d3b21yenpycnh4fn6AfHx0eXl9eHhjYl5eYVhdWVdWUFVZWE5TV01PUlxaV1dkZmZlbWxrbW5sb29wcW9tZ2hbWlldWlBVVl9dXV5fWWBkX11XW11dYGFmaWdrbGpsbW1rZFZnbWdoa4uLjIyNiYSFiYeKaXNyc3JzcmtsZ2BqXldYWWtpaGdmZlpbXFt3e4yTk5OTlJWVlo6Ga2pnZmJiaFNYWlZYYGFhZF9cW1pbX2FydnVzd3V4en19bWtmZGFhW1RdYmJgYmJhYWFhVFRFSU5PUFNWWlpaWlJQVFVSU1hWWFlaVVVOS1hbW1tdXmBfXV9OSTk5Nzg6Oz1aWlxdX15hYWBdSEpWV2FiYmNeYV9jYF5ST1JQT0hmZGZpa2psbGxsUVJSSEVDWFhXVlZWU1xaWUxPTE1QTlNPRElNTlVbXF5eXmBdZWZmYVxgXVxkZF5TV1VVVXR3cXB0dIB/goF+d3l/fnxnaGhpZGttXltYVlhgYV9gU1NUUVFMNFtgZWhoaXV1dn57d3Z3fH52eX+Denp5fHZyfHl7dXJ5eHV2dnRUWGZmaGtrbm5wc3d4dXJxbmxzcnx6f35+eYGEhX90h4eIiYiIgoeIjZSkp6Gio6OkpKObmH13dHd3eG9wbW5qaWlkamJsbGhoZmZrbGdiXFtXYXJzcXNxcXJxdnNleHp1eHh5enR2d19je3i5wcXJysrLztHQ0Li0qaitqqGclpiho62opp6dnqCen5aRkJGQkIuMi4iHiG18fIN+gICBgX+CZm5lamtycXByg399gYGDhIOFgnVxiouJkZCLjo+Pjo+AhXuBhYiHiYmKiIh9en5+e3l3eXJwc3JyZXh4eXl4dXd1dXFzZ2BgZ2ZiZGppbG1xcW1mZWtlaV1kY2VnZ2RbXlZXUFdWXGJhZmZkZGVnZ2VXW2NeYmRjZ2VkiouRk5OSkpKRkXh1VGFdenl4enp4dnZ2a2RIXFdQU1ZYWGp0dHNra2lrcHBwW09XW2FiZWJXWGV+hISHhYeJiYuLhnFxc3Bsb2lvcHNwd3NygIOFhHx9fHxzdlpYjZ6kpKSkpKOipaSXgW1oaGhnWl9UXXBycHN0dIWKiIWEhIWHhYaGbnd4dnZpZGdmZ2hiZWtmZmNhYWFkZVFPVVdXV1lXSFFQZWJhZWZveX59fX53d3JyYVhXVFJTS0pCUVhXWVpbYmJnaGBZW2BfcXJzcnN0c3NvcnFWVVFRV1dXV2VlZWZlZGViYWNKS0RIRUZQTVBiY2VkYmNoZGNjY1RSV1dSU0tHSUhTS0NER0lPWVlYWldZW15eX15iYFpdXVtZWFdJSFRZW2RkZmeXoaKhoaKkqKuqm5yQj4+LgXxyb2NqZ2VmYWJmZ2RnZmxqbHBzcnJzcnF4d3RwfH1+fHyAgYiJlpGRkJGXl5aPj316fn96cHN0b3Vxc3RpaGhtampZW1ZPW1xoYmVoaWlwb2xpYWFgXFpTUlFPVWJmb3Fub29vcnNyb2FiaGZoaHBxcHFxcHNwaWtmZmhnYF9eVFNMQD88PTo9PUBAQ0FIR0hFSEhsbm9vcXBzeHd3c2RmZ2NlWFRUVFFFR0Y/PDMyOztARkM/U1hYWFlYYVxdX1lkY2NiYmFHS05SSUpQUl1dYGFhWlZmZGNgWldTU1NOLzg6PTo4Nzc2MzMyMCwxMD8/QUJBPTs4Mzs6Pjw5Ozk+PkVES0ZHSUhHRkRDPT5PWF1eXl1nZ2ZnWFlYTk5ORUZHQ0QzMDMvMzQ9Q0xMTU5LS0RLR1l1dHR0dXZ1dXVzPj09N0BAUVhrb2tra25vb3Nucl1bXFxWWUxOUl1WWGJmZm1na2poX15eSk9JQEI+QURRUlNSSUxIS1NTSE9UU1dja2tycHFpaWpsZFRWUUdKT0tNSVZXUFFTVFROSkk6Ojk5QUFIR0pMT1FQVU9OR0dGR0BCPD09PUJDQT48PD4uLzw+NkNCS1BPUVVSTlJYV1FOUlVRUlNSSUlKY2ZlZmZlZWJlamxNTUxMUFNSUkw8UFZcX11aXmBibHBpY2ZjZWViYUhHRkhQWlhYVFFPUGdqaGhfYmBiY2deWVtaXnR7eHp5fomMjY2QhIaFhYZ/cHFzc2VlY2FhXmBpbICBgYWFhYWFgH5iUVROS01TVVVTWVxbYWNiXltbeoJ/e3p7eHh6enx4dnt7fH1+foKBaW5tbW5rampqZVlXR05LSkpCoqSoqKirrKutrZKJiHyGc2t1ent7eXl5c25wU1FOYGJgZGJpampucWVra2tscGxsaW1tampqaWZkW1xWSFtcYWBiY2prZWJbVllgYF5eXl1iaG9vaHd6eoCEgn9+eXdoZ2poT0dIREQ9REZCT05PWGltcHRzcXh0dXN8fXx5fHyBhYWHgXd0c25vZ2xydnR0c3Z5enmBend1d3Vzcm9qal5UUVpWXF9eYF5YX15la21tamlrbWdoWUxFRERFQzU1NTg0LjMyMTM1ODsxNTk6NztESUZGTEtGRUtPVlJKV1JSVFZXUkdGUEo/Tk1QVmNpbHd3gH59fn9/eIJ+enR0eHZ4foCHmZmZmZqZlZaamJF6j5COjo6LjouNiYBtc3Vzc3VjYV1dWldTVVRaW1tcWFtbXF5aVVRTU1JRTU1QREBFTlNTVFRaU09QVltXVVZST0tLSUlEMDtTVFVWVVZYWl9gVFJSVFJWWVlSUVpTVFJSUkxHSEVFP0FER0NDS0tJS1leXFxfYmFfYWFUUE5dcXJycHBxcXFycWNWVGBhX15fXltTVVRUSF1dYGBvb2xvbm1hW2BfTU1PTk5NTk5HS0xJSUlIRFBZWFdTUU9OTlJYVl1aXGBgYWJjZWBQTkpCSUlJSEVCQl9kZGZrbGprbnF1ZmlpaGR1dHd1cmxra2xkY11cVlVWVVVZW1lOSFFRUFRVUEM7Pj06ND5CTlJVWFpdXl1mZmpqampycHFsamtubG1rZGRjY2JXW1dXVFlgYWFkampYWl9fVlZOR0IxQTk7P0BERUlOTkQ1R0dHRktPVGRmamlmaGZiWllOUE1ZWVhaam5obG12eHh2d3hraW11bm9vb3l5eHdsYWBfXl9PQ0lHSklHSlJST09NSUZESVE6REhSVVhZWVtRUVZRTEFGTk9QUVJTTE9Qc4uKkZGRkZGQkJBjY01FR0I/Y2VmZ2ppa2pqbWJWVllVUVFUVFhYWFVSSEhITUQ+NztBT1BQZWRpbWxucnRycWZjV1RUVFFBQ0JAQDc1Nj8/PS4tNDw9PUZJSFVTVFNXWVtUVl1VU1FRQkNARUE5LjYxNDUzMTc2OkBGQkNBRU1MVF5kZmhrcXt5fH+ktLa4t7i3u7u7uqeln5+gmZKTi4aGd3Fua2drWFhZWl5ZX15eX1hXV2RrbHJzdHNzc3R1jIqPj4+QkpOSj35sYmNkY2hkYGFfWldZX15VVVhWVFJQVD8/OT8+MTY6PklNTU9QUFFUU09MPDk8PkI9OTQzNDIxNTg4NTU3NjY3PTw1MDQxMy8xPD1FS1BNTUxOTlFOTkRGRUdDOi8vLTUyMS0xMjA1NjtEQ0ZIR01NUlBQTk9QTlVPUFFTWHWMjo2OjY2Mi4uIRjc2MjAvMC0qGhoqIiMjIyYkIhoaHxIRDw8ODAoZHB0aIR8jHiAfIxorNjc9Pj4/QEFGRz86Mjg8RERJR0VHRkVDLyMkJSIrJSwtJTpCRkhGREVFRklLPSoqKi01MygkIiIkJSMiLSgqKi0tKiorKyQfHSInP0FCRkVEQ0VFREE7OzszMS8sLSokHQAJFj1BQkRISEhJSUdBKSUkHiMiIiEhKywsLTEvGxscGhoVGiQrNDpCWVhbXmFoamprcX16enh3c3B0dG5iT0xGRUZHMCcoJhITGxgXHSYiJCwzODY4ODs2MzEqKygpIyQeJCUoMC4mJCU7Ozs4Nzo1Oz09OC4tLzAtLR4fJzMzNDg5OTs9QUxQVldUV11iYmJiWV9VUkZAQ0JBQ0NKUlxiZGZxdXh4e3l2b29oWVlTVE9WXVpWWVhfXmlqbm1oaGZkZ2locH6JhoaHj5GPj42GfH5+gH6IiIuIiIeFfHhvWVtUX2FgXl1eY2NiZWJYVldWXltdW1ZVUlZPTE5JS0xKREhHTFFRT05LUFNSUVFFTU9SXV5dX19eYF5WVUxMTUhLTFlUZmp4eHl3d3ZycGhiOjMyLDY2NT47NTY4NjxAOz49NzYyODg4QkFDPTc/QUJCQ0tGSktHP0JSUkxNUVFYaGlpamFdW1tXV0s0ODs6PD89PUBATE1JR0k7RktaXF5fYGFkcHRtc3RxcXNyeXV6em1scnFyc2ZmZFtZW1ZJSERFUFJRUllcYGBhZWFfXWFlaF1fYF9aXF1cUkZEREJCOTIxMTEvLywpKC05PT08PUFAPz8/NTUwMTI3O0RFST9PUlBZW1lYWFRVRjAsHDNEUFJSWVxdXF1eXVdOTlJRTk9JT1FOUE5RTklERT5KTU1SSkpHS1VPTkpDU1VYYGZqaW1vc292gYWFg4B/fnh4b2xUWF1oaGdmZmFjYmViXUxYWlpdW1RVU1JQTEZIRElKTU5UUktQUWJmZ2ppaGpmaGhtYmFfY19lZ2xvbm9wcG5kYGVjXGJiXG5nZmZmYmRhY2RoVG1rdn19f4mLkJSoraysra2sraempI+BgH6MiYmJioKAfHx6bXBxa2VqeHh5dnl5dHB0cW1eaWdmZmtxbW1xcW5paF5dVU5YTU9VVWBjYmNjX1dOT09QR09NTE9LS0pMUU0+Ozk0MzpLUlNPSlZWVlpaVUdLSkpDPT1CNDY3KCwuQEFCPz9QT09RTFBSUlNUV0lbXVthYmJgYGRjWlNTVlRXV1RaZYGEhYWChH6Af31pXFxUVVBTREdHRktKUlJVVFpoZ2hrb2xub3t7eHl5b3BxbGhjYV1XV1dZUUhETE1NTUZHSktNTUFDOT1APT5HRERKT01PT1FRSElJRENLSk9FRVJVV1xiW1pYVVxTUlRTSERFRUJCRElLTE1QWVZWXFpXUVBMTENPUk1HSkpLSUlHQjhPTk1VVFJaX2NmX15kYGFgWVFPSEtLSEM+NjwzRklKUFVUU1RaW1NSV1ZPTUxbYWdnaGhtcnR0c2tmaHBwcnV2cXh7enh2dnR1dXp6dX1/gYOMiY2Hi4+PjI+LjIOCgn57hYODgH16eXt4d3ZsZGNhXVtkY2RlZWBgX2hiYWJiY2Zkam5kZmZnbnFxcnJvdYaLkJSUlp2hpKWmoKCjoZ+eoJ6Ym5uak4+RkIyChH53fX1/foB5e2xudHFtcHh5cXJua3Z3e314gH98foN9f353en9/gYaBgISAgYGDg32Af5eYmZmamZqZmpqZjI2Ojo2Ojpujn5+hp62srK6ppqqxsrKzsLKxsLCvraKhnaWjoKCRlo+RmZiajZCRkJORiomLiIqKhY2QjI6Kh4iDgIaGhIKBfYF/goSKhIR/gIGJjIiIiIB8gH2Aenp4fXl5fHt8eXJ2dHR0d3Zzb2xubWpobGZpZmZoaGpcYV9lb3R5g4aEhYiFhYmKiIaCgouKiImHf32CfnpxcGxnbWxsa2hfaXBxdGxwb25xcHBlXl9lbG5tbG5xcmx4dW9xc3NwdW9ybmxwdHJqc2xtbWxucGxqcGxoaWdpZGRgYF5WY2JlZGViX2ppcG9jZGJlX2FdW1JSTk5OTE5QSUlEQVJUWFleXV9dXmJeXlxiYmJhZWhxa2Nlamlsb3ZzcG5ycHBva2lgVlFOUk5JUEtNWlldYWFgYVpZVFBMS0dGSURCQEhIR0xJTEpJTU9RVFpZWF5fYWJqbGZmYmRfW1xdXFlXWVtcXFtgX15TTU1LRkRFO0VESVhWV1hYXV9aVVZTSVFRU1RQUVFTVlBJTU1ORE5NSlBSXFtaWmJjb3FubWppcWtycWdgXV9gY1dgYmJfYF9iYVZXXFxUVFVZV1dVWlhVV1NYWVhdXV1VWltZVVlucWxuc3J1dnh5cmdtbW9pZ21sbGdoaGdhZ2dlUVddZmFjYlpbW2JjY2hlXGFgYGVPUVNWWGFkY2FkZWVhXmJca21xb3R4kZKSkZCSkpKQkXx8dXZvb3d2fn55dnR0dHhpaGJcXWBmZmdkX2FhW2FgZWRgX2BiYV5WWF9fXGJmZGFiWVlVTllbWFdhYmBgY2NcXVpbU1NRVVBWTVVWVltaWV1aW1dPVVFSS0pIRkdGXVxdWVpda21sbnJlbIGBgIB8fHyEhIBydnx9dnR6e3R1cWxfYGRiY1BPY2VvcHFvbXNzdm1sZWhrc3h9fH5+fYaFhIGPipCOlpeXlpmYkY2ZkI+IiYKAgoN/fGNocnF3dmtra2x1b3JxcG5vbnZ5dHNzc2xnZ2hjaW9ydXV5e4GBgH98eXZ3f4iFiIaHiImJiIqAfX+Dg4uLioqHgoyJio6Ph4yKi4uLhYeDfXl4fHZ1dnV7dXR1dHZycnV3bmxseHd3cnZ7fHt7fXxzcnJwZ2RgZmJkbGtoZWVoZGpiY1lcX2doaGZnZ2dqZWZfYV5naGZgYmRoamdje3d5eXh7fYKBgoN5iIiOiYmFiIWEg310fX17e3t3e3p5e3xvcW9ud3Bvb2hlYm1odHV0dnV1doaMiI2Jh4WEhop+dnR9dXV1eX14e3p5b2xpaWZhZ2ZtZWFjaGtubmlhYV5cXVZjZGVkc3FzdXFxdW5taGZfZGVtdXRydZSUoqOioZ+enJ2ckouFgYKAdYmPkJSWlaOjoaGko6OioaGkmpmfkZaUkpKQk42QhomJjo2JhYKFjY+PioaFiIiJiHx/gn19gYF9fn57dXJramRnZ2JlaGhubXRvcXBvcm9wZ2djZWRnbGxvbWltcG92cHdzb4B+f4GDgoGEg4OFent2bnFraGhsa2hsZWhqaGBobW1pbWtrampsYlhfZV9fYF1cYF1aUktTU1VTWVFfZGVlYFtdXl1eXk9cZWlsbWx3fn+Ae3V4dXl4fHBxcGtvanNwbmttaGtpZmdqYWJiXlxdZ2ZnbGptdnp2d3hwbnBxb2VbXWJhcoaGhoaKh4eGiId7cHJibWlsZWVkZ2ZjYmNYV21qampsa21wcG9eYWlqaGVkXl9dYXN0bm1wcG52enlpcnJxcmxra2hoa11cYF1jYmNiYVZhYWFeWltXWlZRRERCR0xQTk1WV1hfYGFaVVVVWVZhXVVfXmBdXlxeUFBST1BbW11kY2NdWl9gYFhUVEhIUVFTUlxfa2ttbGttbGtmX2BTU01PV1lZWVtbXWBnaWFlZmhra2trZH1+fXh3enp7e316YmNiZ2plZWZmYmJtb3JpbnBudH6Ef3+AgIB/fYJ/fHVycmxud3t6cXBvfHx9fX56d3d1hX9+goOCf3+CgoNycXNpaWxra2hydX16l5eYl5eVlpWSk3BjaW9rY15fYF9dXGBidHx8e39/gIKEgXNwa21ueXp5dnh1dH1/e3Zxcnl6gYB7dXJydXRzb25jamVvfXmBhIeSlZiZm5eYl5SSjYmPhIiIhoqFhoaHfGZpW1xlXVlaWlthYmFfW1lZXWhoaGhqb3R5gYB8foF/fIqIh4WEi42Ol+/29vn7+/v7/Pz708SurqepqausrK6urrCnrKO3tbOzsrO1s7Ovro+RjIuDfHx8e3ZzdnZ3dXB+dnd7hoODl5aWlZKSkYmHiWpwdXBwcYqJiI6KiYeIiI6Cf4V8fXx4eXd4dH14dHd7fH16eX1wcH9/d3dxdW9qaWtkTWBgaWVpc3N5d3Z5cW13eGxsb25xdXNyY2VaW1tYVmJaWFlYWVRfX19WT1ZdZmhmb3JvcHR0cWxuenp1bm5saGlncWFcXWBiYmFhYWxnYmFkZGdobmxtYWZiXmlocm1tb25pbm9pb11eYGRnbWxnbXRzcHFtbGlsbWRhT1NUWVRTUZ+foaChoaKhoqOAc2xsbmVhY1lVVFVlZGVkZWhtcXJ9gXyFhYOChIOFfXp6cHBycGpubG5qbGVqZmdmaGVkYl1jZWVjZl9iY3JzbmlfaGZmaW1zaWtzcndwcW1ycHJybXBycXBvdoOCgYGGiI6dnqCZmpmZlZSRi3+Mi4qQk5eXnpuamZKVlo+QjYqHh4B/goB3cmxpbGZnaWRoa3Bsb4iJi4qMiIOChoZ/gn+ChIOEgIJ4cnRyeHF8dHh7e396f398fnh1cHl7dnR1dXNyc3NybWhoaXJtbHR1dnV0cHByaWldVVxbW1lZb35/fn6AfX5+gHNSUVFNSVJUWVxhYWNkampnZGFfVn6BgYJ/hISEgoOEZmJucHRxbm5xc3N4cGtgYWVlZ2FiZmVkamVmZGRjYFxSUURLTEtha21zeHh4dnd4dmljXF1WWVhcXllZW1xYWlxaUVteZGVjZFlYW1thXFtWU1FST1BaT0NFRkdPWF9fYl5iYmhpa3FnaWllZGRkXl5RTU1MUFNQUEg9P0RBP0pJR0hNTUxNTlFNQEdISEhPRkpMaWlobGxvbXV1d2ZnaGNmYG1fXmVkYGFlaGZnWFdKU1NgYl1dYWFjZWVfX1hST1RQVlxcXV9ZWldSVlRMQEBAOz42PTkzNTw8QUNDS0hOTk9OS0RCS0dCRDw9PFRUV1JTU1VWVFNMPUA7Ojo4LzQ2Ojg8RkNFQUBBSEVIZmFjYmNkZmtpZ2hSVVJSU0xIVl90dHZ1c3N6fHtya15jZWVpamRfXVxdUEBCPDxEVVtdXV5fX2FfW1g+RD1EREM/RUNESlJNUE1OVlRdZmZjXl5lZWZtaGdfY2NrbWVqYWFjYmJqal5kX2JlZ2loWlpaVE9OO0A6Ozs8ODk6R0dIQEA9PklKSkNBTlBSTk1TSUlLRDU2ODk7OTg2PzxBPz84T1JSWGVjYmVpaGJhZGVZWV5cXFpeZF9bXF1dVlVPUj8+NTIwLTo6OC4zMjs4Nz5CPEFBPEFCQkdLTVNUVlRVWFdYS0xMUFBNTU5fY2NgYV9dbW5ybWlrbW9wcGlXVFlkbHBxcHJxg4KChYJ9e3p7eWhrb2ZnaWlnYGpgW2NhYGFjZ2leX2BdU1RQTk1KTElfYGh3fn9+gYKGhYSAdHJrY2ViZ1FUYGBkZWVkYWBSVE1OUkdFRkhOUlJIWFRTVFNRTkxMV1dZXmdqdXVyc3l7fHp0cHBpcHFtZm1tbnJ0eHZ0eHV5d3d4dnR0cH1+fX16goeIjYyIiouOkISFiIeFhHx7b25tbG5nZnp9fH6AgYF9gIOBenl5dnV7fnuEgoWGhJCQjo2OjouFhoeFeHl9dnNkbHN6srK2tbW1t7i3tp+Mi4SFg4F/enh3fXt7e4iKio6Oi4yGi4mIdXRwaGVkY1JoaWhqaGdpZWZnX1pcXF9kYWdxd3Z4eXl5dHZ0bm1iaW1qb3l/fn9/f396fXVpYWx1cnd/jo6OkI+XlpSTm7ezvL3AwMDAxMG0tLSpp6SqqqShopOOiYOEaWlpbm18e4eHiY6QkpOSlI2JiImMjIuPjZCPkY6TlZaTlpeVkZOUlI6DgYSHh4yNiouLjo6Rj42KiImMi4uOh4CAh42KjIyLioyMjYeAgYJ8eHNzbHl7ent1dXd2fYSBgYWJiYmRkIuHiIiIioiIioSHiYyRlJGSm5ybmJiQg4eDhIFxcHZ5d3dxbXBwbmaEgoyOj5CPlJSfn5WQkZOTmpWWk4yRl5iXqKekpKOlo52ampuqq6mvr6+wsbKyoZial5aenp2dmJaVkZCNgX58f356e3l8d3qBfnx6en17e3dwXmBgZGVhWV9kYmRzdHR3eIKSkZ2doJ6hoZ6elpiPkZKRjI2dn5uYm6CioqKvrKuqqqemoJ2dlXxtcnN0e3uCgoCAgpebnaGgpamprbW0sK6xra6sqaiilJCPlIWCgYKEgYKDhIl7d3l2dXZzfH2GhYWGi42LioOEe3h3fHZ2en1+goSYnamorautrK+tn6CTh4aPj5CQioyHhoaFg316fIODgYSDgIB7e29uaWJsbW1tf4GGho2Ni4+RlIuRi4qIiIiEfX1+dm5na3eAgH99fYGBhpaUmpaYl5mXlpqbjIeAi4yLjJGTnqClpJ+mqrnCwsPExcXIx8G3ubOvsK6qq6GfoZ2lqKyrq7O4v72+vLm0sqyqpJaRkJWRmZiYmZmVl5eWkZCGkZWUk5OQkZibnZaRkIuKlpSWj4+KiZGQmZ6cpaSipaaloZuVmJeKj4mDg4aFgn6HgoF+gH9+fn2Fdn2BgH6BhIKDgnx/fYF/fnx6eXh5dW1vZmVmU1pmYmhrcXh6fIGCgH19enp6cXNiYWJiYmVlaWNrZGhmaWlpamdhWl5aXllZV1ZWVFppZmVjaGhoamlpYFpcV1ZmbG9xdHp+fH19eXZwbWxvam1va3Byb3BsZG1pZmVsY2dnYWJkXl1iYllTTExYVVxdWVhnbXB1eHVzcnNybmZhWFZRXFteW2BfZGRmZ2dkam1nam1raWZkamVbX2VZYGFeXF5ZWltPW1ZUUlddXFxbX2BeXmBdWFNdYGNgYmRjZGZkYFxhYF1fXWBpa3d5ent7fXx+fHl1bGdhYl9fWFBIQEBLS09NU1paWlxdYFdVVVNXUVRWWlZUVVRXVVpcW1NZX15cXVleX1xbXGdrc3V7e3Z1dHRxZF1ZS1NQUlFPTk5LSktKU1dVWVhZZmZmZl9gYWBkZVRYVlxcWFZVWVRUU1JQTUtMUE1LXFlaWVdYW1RbYV9hYWZuc3l2dnaAfX5+fIB+enp5enB4e3x8dHJxcWlsZV9UUktHSVFPU0VFSUxOT05NTEdLTUpGP0lGQktLR0pISEZUVFFUUE1NT1BSU0ZDPz5AQTs+RU1KTU1ITk9SUU4+d3d8fn6EgoWJiXd2cWxrW15YTU5PT1BMTVhbWltXWVpYV11sZ25tcXZ0dHZ2a29vbm9tdIGFhJKTlpiZnpyam52Zlo6Qio2OjYt9fXlycHF0WnBxdXKCgIyNlpeVlZyioZ2gmZyXmJWTjYWGioyHjpOSlZmYnJ+enJyZko6Mio+MhpaWlqapqKmrq6inop+WjY2KiXx8g4J7dG10d3h4dHuFhYmHh4iGjY6QhoyKkJKRlpGYl52anJyXmpmYkZGQkZaYpa+8v8DO09TX3Ojs6+vt7e7v7/Dt5uPh5Ori6Oro5+fh4d7Uz824s66vsKO2tba8u7i5v77AubW7trm9vMXGyMXOysvHx8K8vL67wLKxqqmqqKepqaKipKanpKOem5mSkpiTkYqQkpKZmpuRlZKShn1/fnODg4GBgIGFiIeEgnd3dHh9f4GBgICBg4SFgo2Pi46SkZKRkY+OfX96dHRzcXBra19oZF1iYmp0fHx/hIuLjo6Rj4eIh4OCamFfVFdYTEtKTkhJSUxeXltxdX2GkqGio6Kqqq6trq+lqquqoaGioJqRmJCTlZaamJmOkIiIkJGIiICAhX+NkJCIiIaDgYV9cHdyc3FydXZqaGdlYmJma3Ftbnh5gYN9fHx5cm5lW1c4OTw6Qj5LS0tfaWZmZmVkYHBwc3BydXt9goWJhIOAe3l4bmtSUFhYV1ZZXmBjZ2RgZF9kcnRyc3d7enx+gnp8eoF+dnx8e4B9gJetu8LExsXJyszLyLmura6hp6ilqKuqrKyrrqump6iop6aqq6ipqKilrKemp6KgnqOgnJmMi4uCfHl0YGFZVVRTUFZXVldVUVNTWl5mZmFiZGpqamVncXF2dnd3d3h4e3NtbWlycWdweXeChYaIhYmNjZCHhIWBgoKDfHt/dnx6eHNycmxrWFZWPllcZGRlZGVpZ2dZXV5TWmVraGRqanl4e3Z/f3x9e3lqZWZhW2FcXnd2d3h4dnFva2peTVBQTk5PW2twb25nZ2doaWZkUkxVU1Rbbnd5eXh4enp5d3djVlZaWl1hZmxuc3R3gYSFg4KAfn15eFhOSEdOSk1CQlJRVFljZFxgY2ZlXV9gYFJWWV9fb3BycXFxb3BsYWFhWVhZWlpXV1hRUk9PXVtbW19fWlleXlJWZ2pvenyAgH5/f3V0cF1cVFlcX11eYGJXX2RzdHRzc3NzcHBraE9UT1RVUVJRS0pHSj86Njw6Pj9DR0FCUlRQUVJjZmRqa2ZmZWVkTktBOjk7OTlDWFxiZ2x8gH+CiouIiYmIgHJnYl5KQTU9My03UmBwfHx8fH2CiYeDhXV6fYGEg4F9fXl3c3JlXE5WYmVobW90dHh4dW1rZGNjYlhSWF5fZWVoYF9jZmNeWlFYVVZdXlhoamhwcHNzcG9ydmtraWJhYF9hgZGioqiprKytra2gk5OOkIeFhYaBf4Jybm9oZmtvc3hyb2tucnx8gn+DhIeHiYqDiYqQj42RkpiamZeXlpSSko+OjomGgX95dHFubFdZYmNdX19fXl5fYWFVW1dfX2FoamZhYGBbWlFSUHuFi4yMjoyMjIyLZVJOSDo1NTo4NDc3OzQtLWZsb29zdXZ5eXlqYV1fWVdRSkZFY2FhYmJjYmNjXltLR09NTEtLT1JSSUdEPD5BRkNAOzs8PT06OzIzQ0VFRUVIR1BQU0ZDQ0NCPUY9SUpIR0ZGRkU6V1ZPUE9TU1NTUiw5NzRFR0ZPT1JSUExNRjY3JCE+RkZUWlpbXF1gYFtWQkE4OTo3Ki4ZGhgYFxwjLy4qKCwrMjw8ODxAQUNFQ0VCQ0FBPUA/P0FGRERDSFpWio2cnJ6enqGhoaCQfHp3eIKOjZKTl5eYmJiZkIaEenpuamhlZGNbXmNjYF5bWVlYWWFZUFVZXF5fXlxTUlVTTkpFSlFQT0xHSkhKSkQ6PEBCOzg2Pj9xfYWHhY6Vl5qbn5OVkpOVi42KlZiUkZeWlqqppq2rqamopqSZh4l8Z2ttamxfYFpTUldcXVdSWGZpamxpZWJiYWFFREA7RFlXbW9ydXV1dXeBgIBzcHBwb2phUFJNTE1OTE9LS1Zyd36EjZGSl5eZmJGOi3p4c3NaW11maHF0dnZ3dXV0ZF9LRj81NTM1NjpBQ0pKTk5PTUtOSEdFRkVGSEZeYWtvcXJxcXF0kJyqs7XJ1+zw8Pb5+fj39/br2tfUysC/uqunqKSlnpybl4yNkZKoqaSjpqmrqqiojo6Lio2DdnRwa2dmZWNkWldQUYGMk5OTlJaZnZ2blo6MjYuLgYWRk5SWlpSWlJaXlIJ9dG5ua2dgX1NXUA=="},"monthly":{"first":"1928-01","last":"2020-12","n":1116,"lo":-3.48948,"hi":-0.02898,"b64":"ZltgeXyUdGRSYGCUeoqbfZ9ma42P8++zaXN2lJ7JpJeLu6+xwZKcpqjSpJHM6bvK0NK1xcvZw93m5dSxnsjs2MfO5rS81LGkn6umgqSjuKCckI2HeomV0sN/csGGj4aZdnuZoIJzbYStd4JxcHWInZGOf3vA2Mqlwqy1vKaupKHCyJ9+sYmnooyJkp7LcGZebENTZMS1ZoyQaKVMc4lvb21sakpiYW+ffmqFfnBrd05GZmtNV2RlgG1ke4JOU3VWTFNOVi5YXEVnTkVVV016YllUdXVwZmp7hKVyYWNtcXHUnJaIe26AioJ1dVhqXEhfXpF0RWVZgmN+T6RWhHVfRl5wRF1tSl88YEdCVE2fjV9kcoaLb1ZiUGlhZUIxa144SVRJTkUpNS4/Xj4mQHRPZ0pgRUZjQ0g9PDsxUEFcQ2I+Rl5yglZ+TFNze2GihHVbZGRZWXBiPG51bXZhWGM5J0BCRXhtlJBmT1VEUkBOSEo5V3FOTGlGP0VaPmVxTEouUmdaXjtEX0txaFs4SEpGjz1hTTloSjQ7UzEvWLKgclRmillQSz00JzEtRyc4Ro8sGAAMLC87IEAVICs4EUITDjl3RwMtGxkyGjlZOXZEYoRxgVhPQ0Q/V1RgKS82SFstPF1sbzxeXTsqNR4xS0pHSEFOfFpbTkZiWWBeZayBdXRgX1o8RUc+LkVYTH5ITHdYRC9IP1Q3T0ZGWD9LR2pvb4d8dV5eZ5Gfi3tzc3mAl5WqrY+Ri32Ae3RoX39+dltpa2tkYF9aRVNaaGZBSzlNYU5DUEdET2tPVFNLbmFfVVtgcop0XFlPUlpGUzlsfW5Fc3mUg21rZHSEeX2Gb3N4WF9eYnODd29ZhHhyZllsXZ58n55/i3tsZ2NogGhiZFlIV3ppY1RyWoBhZWBnallYQ1FWUk1cVlZkd11pf2hxfWGTV3hmdG53lYNdUnSC/6ektHlukIJ8emdkcWtOVGlnW15rUmhMn1leg2ReX15rapt7lH5YiIFteW5kX3hFYHtuWGBBclRTVzlbXEVCO2lcX1lKTihEM0stPGRVb1VUM0NWZVZTLkI/K1xQViI2RERaaWp1X2JAfWJLSERzZXJ6hXZ3c3+BsIZ8g1tfcmB4fK+zmHeIj5GHhIt8cYOEmWtenougsZt9fVhvnYifmn6mqoBuh3e0iHh3fYZ6epKPwrGptZeBnIajhXt5eF53ZWBVYFF1Z2FWVGxTZ1dQWVxYdlhITk9QdkVBYFRGUGh5bz5HPUw7RHNvR05ugJl5cJ+BmY2lg3KKlY3V8ejOvbfMqKWMjHx3kHhbfINCdq2dioJ5YHROXGR8T119eMqmp6uFTEtidGiNcFBkXXhjV2xCcV6APFtOZ09UaGlbbEkvXEVUhBV3f1RyS11gY6CTaGaEmYVhWV+FQS1zOVtHOB9IQUVALVItIjYtT6KLgFpPTT4tk4aohUljNHBbSpROay9EZJv9v5WobEibjnpM"}};
  // :>> plates data

  var MMFractal = { setScheme: setScheme, scheme: function () { return SCHEME; }, schemes: function () { return Object.keys(SCHEMES); }, STOPS: STOPS, lut: lut, hash: hash, seedC: seedC, escape: escape, field: field, attractor: attractor,
                    recurrence: recurrence, rule: rule, color: color, haloSprite: haloSprite, sceneEscapes: sceneEscapes, mistEscapes: mistEscapes, sceneColour: sceneColour, series: series, budget: budget, backing: backing, boxFor: boxFor, paint: paint,
                    start: start, PLATES: PLATES };
  if (typeof document !== "undefined" && typeof window !== "undefined") start(document, window);
  return MMFractal;
})();
if (typeof module === "object" && module.exports) module.exports = MMFractal;
