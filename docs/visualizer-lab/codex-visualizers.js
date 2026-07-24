// codex-visualizers.js
// Five Web Audio canvas-2D visualizer styles for the Prism visualizer lab.
// Pure canvas drawing, no imports/exports, no external libraries.
//
// Interface contract (see visualizer-lab host):
//   window.CODEX_VIZ = [{ id, name, blurb, trails, init(state,W,H), draw(ctx,W,H,d,o,state) }, ...]

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Shared helpers (module-private; not part of the exported interface)
  // ---------------------------------------------------------------------

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function hexToRgb(hex) {
    var h = String(hex || '#5b5bd6').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16) || 0;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToCss(rgb, a) {
    var alpha = a == null ? 1 : clamp(a, 0, 1);
    return 'rgba(' + (rgb.r | 0) + ',' + (rgb.g | 0) + ',' + (rgb.b | 0) + ',' + alpha + ')';
  }

  function lerpRgb(c0, c1, t) {
    return { r: lerp(c0.r, c1.r, t), g: lerp(c0.g, c1.g, t), b: lerp(c0.b, c1.b, t) };
  }

  // Palette with a guaranteed fallback so a visualizer never has to special-case
  // a missing o.palette.
  function safePalette(o) {
    if (o && o.palette && o.palette.length) return o.palette;
    if (o && o.accent) return [o.accent];
    return ['#5b5bd6', '#9a6cff', '#ff9a8b'];
  }

  // Sample a multi-stop hex palette at t in [0,1].
  function paletteAt(palette, t) {
    if (palette.length === 1) return hexToRgb(palette[0]);
    var tt = clamp(t, 0, 1) * (palette.length - 1);
    var i0 = Math.floor(tt);
    var i1 = Math.min(i0 + 1, palette.length - 1);
    return lerpRgb(hexToRgb(palette[i0]), hexToRgb(palette[i1]), tt - i0);
  }

  // Build a logarithmically-spaced spectrum of `buckets` values from the linear
  // Uint8Array freq buffer, so the low end gets far more resolution than an
  // even linear slice would (bins 0-1 are DC / sub-bass and are skipped so
  // they don't dominate every bucket).
  function logSpectrum(freq, buckets, out) {
    var n = freq.length;
    var minBin = 2;
    var maxBin = n - 1;
    var ratio = maxBin / minBin;
    for (var i = 0; i < buckets; i++) {
      var lo = Math.floor(minBin * Math.pow(ratio, i / buckets));
      var hi = Math.floor(minBin * Math.pow(ratio, (i + 1) / buckets));
      if (hi <= lo) hi = lo + 1;
      if (hi > maxBin) hi = maxBin;
      var sum = 0, cnt = 0;
      for (var b = lo; b < hi; b++) { sum += freq[b]; cnt++; }
      out[i] = cnt > 0 ? (sum / cnt) / 255 : 0;
    }
    return out;
  }

  // Single-sample log-spaced bin index, for visualizers that only need a
  // handful of spectrum taps rather than a full bucketed spectrum.
  function logBinIndex(i, buckets, n) {
    var minBin = 2;
    var maxBin = n - 1;
    var ratio = maxBin / minBin;
    var t = (i + 0.5) / buckets;
    return Math.min(maxBin, Math.floor(minBin * Math.pow(ratio, t)));
  }

  // Frame-rate-independent delta in ms, clamped so a tab-switch stall doesn't
  // cause a huge jump. Every visualizer below drives motion off this instead
  // of a per-frame constant increment.
  function tickDt(state, d) {
    var dt = clamp(d.t - (state.lastT == null ? d.t : state.lastT), 0, 100);
    state.lastT = d.t;
    return dt;
  }

  var VIZ = [];

  // -----------------------------------------------------------------------
  // 1. Tunnel — concentric polygons rushing toward the viewer, perspective-
  //    scaled and faded with depth. Motion blur comes from the host's trail
  //    fade; spectrum shapes each ring's vertices.
  // -----------------------------------------------------------------------
  VIZ.push({
    id: 'tunnel',
    name: 'Tunnel',
    blurb: 'Perspective rings rushing toward the beat.',
    trails: true,
    init: function (state, W, H) {
      state.sides = 8;
      state.numRings = 18;
      state.spec = new Float32Array(state.sides);
      state.specSm = new Float32Array(state.sides);
      state.z = 0;
      state.rot = 0;
      state.lastT = 0;
    },
    draw: function (ctx, W, H, d, o, state) {
      if (W <= 0 || H <= 0) return;
      var sens = o.sensitivity || 1;
      var palette = safePalette(o);
      var accent = hexToRgb(o.accent);
      var dt = tickDt(state, d);

      logSpectrum(d.freq, state.sides, state.spec);
      for (var i = 0; i < state.sides; i++) {
        state.specSm[i] = lerp(state.specSm[i], state.spec[i], 0.25);
      }

      state.z += dt * 0.00004 * (1 + d.bass * 3 * sens + d.beat * 6);
      if (state.z > 1) state.z -= Math.floor(state.z);
      state.rot += dt * (0.0006 + d.treble * 0.004 * sens);

      var cx = W / 2, cy = H / 2;
      var maxR = Math.min(W, H) * 0.62;
      var rings = state.numRings;

      for (var r = rings - 1; r >= 0; r--) {
        var z = (r / rings + state.z) % 1;
        var persp = 1 / (0.08 + z * 1.15);
        var radius = maxR * 0.11 * persp;
        if (radius > maxR * 1.35) continue;
        var alpha = clamp((1 - z) * 1.3, 0, 1) * clamp(z * 3, 0, 1);
        if (alpha <= 0.01) continue;

        var rot = state.rot * (r % 2 ? 1 : -1);
        ctx.beginPath();
        for (var s = 0; s <= state.sides; s++) {
          var ang = (s / state.sides) * Math.PI * 2 + rot;
          var amp = 1 + state.specSm[s % state.sides] * 0.38 * sens;
          var rad = radius * amp;
          var x = cx + Math.cos(ang) * rad;
          var y = cy + Math.sin(ang) * rad;
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        var col = paletteAt(palette, z);
        ctx.strokeStyle = rgbToCss(col, alpha * 0.9);
        ctx.lineWidth = Math.max(1, Math.min(W, H) * 0.004 * (0.5 + (1 - z)));
        ctx.stroke();
      }

      var glowR = Math.min(W, H) * 0.05 * (1 + d.beat * 1.5);
      var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, glowR));
      grad.addColorStop(0, rgbToCss(accent, 0.5 + d.level * 0.4));
      grad.addColorStop(1, rgbToCss(accent, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, glowR), 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // -----------------------------------------------------------------------
  // 2. Liquid Blob — an organic metaball-like shape whose control points
  //    glide toward audio-driven targets (bass = size, treble = spikiness,
  //    mid = wobble speed), smoothed into a soft closed curve.
  // -----------------------------------------------------------------------
  VIZ.push({
    id: 'liquid-blob',
    name: 'Liquid Blob',
    blurb: 'A soft metaball breathing with bass and treble.',
    trails: false,
    init: function (state, W, H) {
      state.n = 14;
      state.phase = new Float32Array(state.n);
      for (var i = 0; i < state.n; i++) state.phase[i] = Math.random() * Math.PI * 2;
      state.radii = new Float32Array(state.n).fill(1);
      state.rot = 0;
      state.lastT = 0;
    },
    draw: function (ctx, W, H, d, o, state) {
      if (W <= 0 || H <= 0) return;
      var sens = o.sensitivity || 1;
      var palette = safePalette(o);
      var accent = hexToRgb(o.accent);
      var dt = tickDt(state, d);
      var cx = W / 2, cy = H / 2;
      var minWH = Math.min(W, H);
      var baseR = minWH * 0.22;

      state.rot += dt * 0.00005 * (1 + d.mid * sens);

      var n = state.n;
      var pts = [];
      for (var i = 0; i < n; i++) {
        var ang = (i / n) * Math.PI * 2;
        var wob = Math.sin(d.t * 0.0011 + state.phase[i]) * 0.15 * (0.3 + d.mid * sens);
        var spike = Math.sin(ang * 3 + d.t * 0.0006) * d.treble * 0.5 * sens;
        var target = 1 + wob + spike + d.bass * 0.26 * sens + d.beat * 0.14 * sens;
        state.radii[i] = lerp(state.radii[i], target, 0.12);
        var r = baseR * Math.max(0.15, state.radii[i]);
        pts.push([Math.cos(ang) * r, Math.sin(ang) * r]);
      }

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(state.rot);

      ctx.beginPath();
      var first = [(pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2];
      ctx.moveTo(first[0], first[1]);
      for (i = 0; i < n; i++) {
        var p0 = pts[i], p1 = pts[(i + 1) % n];
        var mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
        ctx.quadraticCurveTo(p0[0], p0[1], mx, my);
      }
      ctx.closePath();

      var grad = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, baseR * 1.6));
      var c0 = paletteAt(palette, 0.15 + d.level * 0.3);
      var c1 = paletteAt(palette, 0.85);
      grad.addColorStop(0, rgbToCss(c0, 0.3));
      grad.addColorStop(1, rgbToCss(c1, 0.05));
      ctx.fillStyle = grad;
      ctx.shadowColor = rgbToCss(accent, 0.6);
      ctx.shadowBlur = minWH * 0.06 * (1 + d.beat);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.lineWidth = Math.max(1.5, minWH * 0.006);
      ctx.strokeStyle = rgbToCss(paletteAt(palette, 0.5), 0.95);
      ctx.stroke();
      ctx.restore();
    }
  });

  // -----------------------------------------------------------------------
  // 3. Lissajous Rose — a harmonograph-style curve traced by two smoothly
  //    drifting oscillators (mid controls one axis frequency, treble the
  //    other), drawn incrementally so the host's trail fade builds a glowing
  //    persistence-of-vision figure.
  // -----------------------------------------------------------------------
  VIZ.push({
    id: 'lissajous-rose',
    name: 'Lissajous Rose',
    blurb: 'A glowing harmonograph curve steered by mid and treble.',
    trails: true,
    init: function (state, W, H) {
      state.phase = 0;
      state.fa = 3;
      state.fb = 2;
      state.rot = 0;
      state.lastT = 0;
      state.px = null;
      state.py = null;
    },
    draw: function (ctx, W, H, d, o, state) {
      if (W <= 0 || H <= 0) return;
      var sens = o.sensitivity || 1;
      var palette = safePalette(o);
      var accent = hexToRgb(o.accent);
      var minWH = Math.min(W, H);
      var cx = W / 2, cy = H / 2;
      var R = minWH * 0.36;
      var dt = tickDt(state, d);

      var targetA = 2 + d.mid * 3.2 * sens;
      var targetB = 3 + d.treble * 3.2 * sens;
      state.fa = lerp(state.fa, targetA, 0.02);
      state.fb = lerp(state.fb, targetB, 0.02);
      state.rot += dt * 0.00008;

      var steps = 6;
      ctx.lineCap = 'round';
      var amp = 0.55 + d.level * 0.26 * sens + d.beat * 0.09;

      for (var s = 0; s < steps; s++) {
        state.phase += (dt / steps) * 0.0022;
        var t = state.phase;
        var x = cx + Math.sin(t * state.fa + state.rot) * R * amp;
        var y = cy + Math.sin(t * state.fb) * R * amp;

        if (state.px != null) {
          var col = paletteAt(palette, (Math.sin(t * 0.5) + 1) / 2);
          ctx.strokeStyle = rgbToCss(col, 0.85);
          ctx.lineWidth = Math.max(1, minWH * 0.0035 * (1 + d.beat * 0.6));
          ctx.beginPath();
          ctx.moveTo(state.px, state.py);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        state.px = x;
        state.py = y;
      }

      ctx.fillStyle = rgbToCss(accent, 0.9);
      ctx.beginPath();
      ctx.arc(state.px, state.py, Math.max(1, minWH * 0.008 * (1 + d.beat)), 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // -----------------------------------------------------------------------
  // 4. Ridge Terrain — three parallax mountain-silhouette layers scrolling
  //    at different speeds, each fed by a different frequency band (bass /
  //    mid / treble) so the terrain's shape reacts to the mix, not just the
  //    overall level.
  // -----------------------------------------------------------------------
  VIZ.push({
    id: 'ridge-terrain',
    name: 'Ridge Terrain',
    blurb: 'Parallax mountain ridges scrolling to bass, mid and treble.',
    trails: false,
    init: function (state, W, H) {
      state.cols = 96;
      state.layers = [
        { h: new Float32Array(state.cols).fill(0.15), speed: 0.35, band: 'low', t: 0.12 },
        { h: new Float32Array(state.cols).fill(0.15), speed: 0.7, band: 'mid', t: 0.55 },
        { h: new Float32Array(state.cols).fill(0.15), speed: 1.3, band: 'high', t: 0.92 }
      ];
      state.scrollAcc = [0, 0, 0];
      state.lastT = 0;
    },
    draw: function (ctx, W, H, d, o, state) {
      if (W <= 0 || H <= 0) return;
      var sens = o.sensitivity || 1;
      var palette = safePalette(o);
      var dt = tickDt(state, d);
      var horizon = H * 0.62;
      var bands = { low: d.bass, mid: d.mid, high: d.treble };

      for (var L = 0; L < state.layers.length; L++) {
        var layer = state.layers[L];
        state.scrollAcc[L] += dt * 0.0011 * layer.speed;
        var guard = 0;
        while (state.scrollAcc[L] >= 1 && guard < 8) {
          state.scrollAcc[L] -= 1;
          guard++;
          var h = layer.h;
          for (var i = 0; i < h.length - 1; i++) h[i] = h[i + 1];
          var band = bands[layer.band];
          var noise = Math.sin(d.t * 0.003 + L * 13.1) * 0.08;
          h[h.length - 1] = clamp(0.12 + band * 0.85 * sens + noise + d.beat * (L === 0 ? 0.25 : 0), 0, 1.3);
        }
      }

      for (var L2 = 0; L2 < state.layers.length; L2++) {
        var lyr = state.layers[L2];
        var n = lyr.h.length;
        var stepX = W / (n - 1);
        var col = paletteAt(palette, lyr.t);
        var depthFade = 0.35 + 0.25 * L2;

        ctx.beginPath();
        ctx.moveTo(0, H);
        for (var i2 = 0; i2 < n; i2++) {
          var y = horizon - lyr.h[i2] * H * 0.4 * (1 - L2 * 0.12);
          ctx.lineTo(i2 * stepX, y);
        }
        ctx.lineTo(W, H);
        ctx.closePath();

        var grad = ctx.createLinearGradient(0, horizon - H * 0.4, 0, H);
        grad.addColorStop(0, rgbToCss(col, 0.85 * depthFade + 0.15));
        grad.addColorStop(1, rgbToCss(col, 0.08));
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }
  });

  // -----------------------------------------------------------------------
  // 5. Aurora Field — flowing horizontal light ribbons blended additively,
  //    each ribbon tapping a different log-spaced frequency bin so the bands
  //    ripple independently instead of moving in lockstep.
  // -----------------------------------------------------------------------
  VIZ.push({
    id: 'aurora-field',
    name: 'Aurora Field',
    blurb: 'Additive light ribbons drifting like the northern lights.',
    trails: true,
    init: function (state, W, H) {
      state.bands = 4;
      state.phase = new Float32Array(state.bands);
      for (var i = 0; i < state.bands; i++) state.phase[i] = Math.random() * Math.PI * 2;
      state.drift = 0;
      state.lastT = 0;
    },
    draw: function (ctx, W, H, d, o, state) {
      if (W <= 0 || H <= 0) return;
      var sens = o.sensitivity || 1;
      var palette = safePalette(o);
      var dt = tickDt(state, d);
      var minWH = Math.min(W, H);

      state.drift += dt * 0.00006 * (1 + d.mid * sens);

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      for (var b = 0; b < state.bands; b++) {
        var freqIdx = logBinIndex(b, state.bands, d.freq.length);
        var bandVal = d.freq[freqIdx] / 255;
        var baseY = H * (0.22 + b * (0.55 / state.bands));
        var amp = minWH * 0.05 * (0.6 + bandVal * 1.4 * sens) + d.bass * minWH * 0.03 * sens;
        var thickness = H * 0.16 * (0.6 + bandVal * 0.8);
        var col = paletteAt(palette, state.bands > 1 ? b / (state.bands - 1) : 0.5);
        var steps = 48;

        ctx.beginPath();
        for (var i = 0; i <= steps; i++) {
          var f = i / steps;
          var x = f * W;
          var y = baseY
            + Math.sin(f * Math.PI * 2.4 + state.drift * 6 + state.phase[b]) * amp
            + Math.sin(f * Math.PI * 7 + state.drift * 11) * amp * 0.25 * d.treble * sens;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        for (var j = steps; j >= 0; j--) {
          var f2 = j / steps;
          var x2 = f2 * W;
          var y2 = baseY + thickness
            + Math.sin(f2 * Math.PI * 2.4 + state.drift * 6 + state.phase[b]) * amp * 0.7;
          ctx.lineTo(x2, y2);
        }
        ctx.closePath();

        var grad = ctx.createLinearGradient(0, baseY - amp, 0, baseY + thickness + amp);
        grad.addColorStop(0, rgbToCss(col, 0));
        grad.addColorStop(0.5, rgbToCss(col, 0.35 + bandVal * 0.35 * sens));
        grad.addColorStop(1, rgbToCss(col, 0));
        ctx.fillStyle = grad;
        ctx.fill();
      }

      ctx.restore();
    }
  });

  window.CODEX_VIZ = VIZ;
})();
