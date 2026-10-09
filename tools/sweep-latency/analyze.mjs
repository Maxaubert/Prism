// Turns sweep-latency's recordings into the spike's gate numbers (#338, task 1
// step 5). Dev-only.
//
//   node tools/sweep-latency/analyze.mjs <runDir> [<runDir> ...] [--tol 60]
//        [--edge r,g,b] [--pointer dda|poll] [--out <file.json>]
//
// A run directory holds the tool's meta.json, frames.csv, mouse.csv, poll.csv
// and strips.bin, and the spike Prism's spike-info.json, spike-events.jsonl and
// native-frames.csv (measure.mjs puts them together). The mode (native, dom,
// both) comes from spike-info.json.
//
// LAG. For each image frame (present time T) the box's FAR edge is found in the
// strip through the box's middle (the column for a vertical move, the row for a
// horizontal one), and the pointer's track is searched backwards for the
// moment t it was where that edge is drawn: lag = (T - t) / frame period, in
// frames. The edge's constant offset from the pointer (where the outer pixel
// sits against the hotspot) is taken from the frames where the pointer stood
// still with the button held, per axis, and removed first. gap/speed is
// reported too: the same number when the speed is steady.
//
// Speed classes are in CSS px per second (DPI-free): slow < 500, medium < 1500,
// fast >= 1500. Frames with the pointer outside the list's clip (the edge is
// clamped there) or moving under 1 px a frame are left out.
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}
const TOL = Number(flag('tol', 60))
const EDGE_OVERRIDE = flag('edge', null)?.split(',').map(Number) ?? null
const POINTER = flag('pointer', 'dda')
const OUT = flag('out', null)
const runs = argv.filter((a) => !a.startsWith('--'))
if (!runs.length) {
  console.error('usage: analyze.mjs <runDir> [...] [--tol n] [--edge r,g,b] [--pointer dda|poll] [--out f.json]')
  process.exit(2)
}

// ---- small helpers --------------------------------------------------------------
const csv = (file) => {
  if (!existsSync(file)) return []
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
  const head = lines.shift().split(',')
  return lines.map((l) => {
    const v = l.split(',')
    const o = {}
    head.forEach((h, i) => (o[h] = Number(v[i])))
    return o
  })
}
const json = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null)
const quantile = (xs, q) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * q
  const lo = Math.floor(i)
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo)
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const sd = (xs) => {
  if (xs.length < 2) return null
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}
const r3 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000)
const describe = (xs) => ({
  n: xs.length,
  median: r3(quantile(xs, 0.5)),
  p95: r3(quantile(xs, 0.95)),
  mean: r3(mean(xs)),
  sd: r3(sd(xs))
})

/** Runs of pixels within TOL of a colour, as [first, last] indexes. */
function runsOf(buf, offset, len, colour) {
  const out = []
  let start = -1
  for (let i = 0; i < len; i++) {
    const o = offset + i * 4
    const d = Math.abs(buf[o + 2] - colour[0]) + Math.abs(buf[o + 1] - colour[1]) + Math.abs(buf[o] - colour[2])
    if (d <= TOL) {
      if (start < 0) start = i
    } else if (start >= 0) {
      out.push([start, i - 1])
      start = -1
    }
  }
  if (start >= 0) out.push([start, len - 1])
  return out
}

// ---- one run ------------------------------------------------------------------------
function analyzeRun(dir) {
  const meta = json(join(dir, 'meta.json'))
  const info = json(join(dir, 'spike-info.json')) ?? {}
  if (!meta) throw new Error(`${dir}: no meta.json (did the tool run?)`)
  const mode = info.mode ?? 'unknown'
  const F = meta.qpcFreq
  const P = F / (meta.refreshHz || 144)
  const dpr = info.dpr || 1
  const frames = csv(join(dir, 'frames.csv')).sort((a, b) => a.present_qpc - b.present_qpc)
  const mouse = csv(join(dir, 'mouse.csv')).filter((m) => m.visible === 1)
  const poll = csv(join(dir, 'poll.csv'))
  const events = existsSync(join(dir, 'spike-events.jsonl'))
    ? readFileSync(join(dir, 'spike-events.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
    : []
  const strips = existsSync(join(dir, 'strips.bin')) ? readFileSync(join(dir, 'strips.bin')) : Buffer.alloc(0)
  const per = (meta.colLen + meta.rowLen) * 4
  const [sl, st] = meta.stripRect

  // Colours to look for: the native box's (spike constant) and/or today's band's.
  const colours = []
  if (EDGE_OVERRIDE) colours.push({ who: mode === 'dom' ? 'dom' : 'native', rgb: EDGE_OVERRIDE })
  else {
    if (mode === 'native' || mode === 'both') colours.push({ who: 'native', rgb: info.nativeEdge?.slice(0, 3) })
    if (mode === 'dom' || mode === 'both') colours.push({ who: 'dom', rgb: info.domEdge?.slice(0, 3) })
  }
  for (const c of colours) if (!c.rgb) throw new Error(`${dir}: no ${c.who} edge colour in spike-info.json; pass --edge`)

  // The pointer's track, screen physical px.
  const track =
    POINTER === 'poll' || mouse.length < 10
      ? poll.map((p) => ({ t: p.qpc, x: p.x, y: p.y }))
      : mouse.map((m) => ({ t: m.mouse_qpc, x: m.hot_x, y: m.hot_y }))
  track.sort((a, b) => a.t - b.t)
  let cursorIdx = 0
  const at = (t) => {
    // Linear between updates; the last known position after the last update.
    if (!track.length) return null
    if (t <= track[0].t) return track[0]
    let lo = 0
    let hi = track.length - 1
    if (t >= track[hi].t) return track[hi]
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (track[mid].t <= t) lo = mid
      else hi = mid
    }
    cursorIdx = lo
    const a = track[lo]
    const b = track[hi]
    const f = (t - a.t) / (b.t - a.t)
    return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
  }
  void cursorIdx

  // The list's clip in screen px, from the last begin the spike saw.
  // clipPhys carries the spike's --sweep-spike-origin (the both run shifts the
  // native box by it on purpose), so it is taken off again here.
  const client = info.client
  const clipPhys = info.clipPhys
  const [ox, oy] = Array.isArray(info.origin) ? info.origin.map(Number) : [0, 0]
  const clip =
    client && clipPhys
      ? {
          left: client.x + clipPhys.left - ox,
          top: client.y + clipPhys.top - oy,
          right: client.x + clipPhys.right - ox,
          bottom: client.y + clipPhys.bottom - oy
        }
      : null
  // Only runs inside the list's clip (plus the shift and a margin) can be the
  // box: anything else in the strip is other UI that happens to match.
  const M = 3 + Math.max(Math.abs(ox), Math.abs(oy))
  const inSpan = (lo, hi) => ([a, b]) => b >= lo - M && a <= hi + M
  const inClip = (p) =>
    !clip || (p.x > clip.left + 2 && p.x < clip.right - 3 && p.y > clip.top + 2 && p.y < clip.bottom - 3)

  const phaseName = (i) => meta.phases?.[i]?.name ?? String(i)

  // ---- per frame: the edges in the strips -------------------------------------------
  const rows = []
  for (const f of frames) {
    if (f.strip < 0 || (f.strip + 1) * per > strips.length) continue
    const base = f.strip * per
    const found = {}
    for (const c of colours) {
      found[c.who] = {
        col: runsOf(strips, base, meta.colLen, c.rgb)
          .map(([a, b]) => [a + st, b + st])
          .filter(clip ? inSpan(clip.top, clip.bottom) : () => true),
        row: runsOf(strips, base + meta.colLen * 4, meta.rowLen, c.rgb)
          .map(([a, b]) => [a + sl, b + sl])
          .filter(clip ? inSpan(clip.left, clip.right) : () => true)
      }
    }
    rows.push({ f, found })
  }

  /** The far edge's outer pixel along one axis, or null. */
  const farEdge = (runs, anchor, pointer) => {
    if (!runs.length) return null
    const dir = Math.sign(pointer - anchor) || 1
    // The run whose outer pixel lies farthest from the anchor on the pointer's side.
    let best = null
    for (const [a, b] of runs) {
      const outer = dir > 0 ? b : a
      if ((outer - anchor) * dir < -2) continue
      if (best === null || (outer - anchor) * dir > (best - anchor) * dir) best = outer
    }
    return best
  }
  const nearEdge = (runs, anchor, pointer) => {
    // With one run left the anchored edge has scrolled out of the clip and the
    // run is the far edge: no anchored edge in this frame.
    if (runs.length < 2) return null
    const dir = Math.sign(pointer - anchor) || 1
    let best = null
    for (const [a, b] of runs) {
      const outer = dir > 0 ? a : b
      if (best === null || (outer - anchor) * dir < (best - anchor) * dir) best = outer
    }
    return best
  }

  // ---- calibration: the edge against a still pointer -----------------------------------
  const offsets = {}
  for (const c of colours) {
    const still = { x: [], y: [] }
    for (const { f, found } of rows) {
      if (!f.held) continue
      const p = at(f.present_qpc)
      const p0 = at(f.present_qpc - 3 * P)
      if (!p || !p0 || Math.hypot(p.x - p0.x, p.y - p0.y) > 0.5 || !inClip(p)) continue
      const ex = farEdge(found[c.who].row, f.anchor_x, p.x)
      const ey = farEdge(found[c.who].col, f.anchor_y, p.y)
      const dx = Math.sign(p.x - f.anchor_x) || 1
      const dy = Math.sign(p.y - f.anchor_y) || 1
      if (ex !== null && Math.abs(p.x - f.anchor_x) >= 10 && Math.abs(p.y - f.anchor_y) >= 10) still.x.push((ex - p.x) * dx)
      if (ey !== null && Math.abs(p.y - f.anchor_y) >= 10 && Math.abs(p.x - f.anchor_x) >= 10) still.y.push((ey - p.y) * dy)
    }
    offsets[c.who] = {
      x: still.x.length >= 5 ? quantile(still.x, 0.5) : 0,
      y: still.y.length >= 5 ? quantile(still.y, 0.5) : 0,
      samples: { x: still.x.length, y: still.y.length }
    }
  }

  // ---- lag -------------------------------------------------------------------------------
  const lagRows = []
  const byWho = {}
  for (const c of colours) byWho[c.who] = []
  for (const { f, found } of rows) {
    if (!f.held) continue
    const T = f.present_qpc
    const p = at(T)
    const pPrev = at(T - P)
    if (!p || !pPrev || !inClip(p)) continue
    const vx = p.x - pPrev.x
    const vy = p.y - pPrev.y
    const axis = Math.abs(vy) >= Math.abs(vx) ? 'y' : 'x'
    const v = axis === 'y' ? vy : vx
    if (Math.abs(v) < 1) continue
    const a = axis === 'y' ? f.anchor_y : f.anchor_x
    const other = axis === 'y' ? Math.abs(p.x - f.anchor_x) : Math.abs(p.y - f.anchor_y)
    if (other < 10) continue // the strip would run along the box's side, not across it
    const pa = axis === 'y' ? p.y : p.x
    const dirA = Math.sign(pa - a) || 1
    const vCss = (Math.abs(v) * (meta.refreshHz || 144)) / dpr
    const speed = vCss < 500 ? 'slow' : vCss < 1500 ? 'medium' : 'fast'
    for (const c of colours) {
      const runs = axis === 'y' ? found[c.who].col : found[c.who].row
      const edge = farEdge(runs, a, pa)
      if (edge === null) continue
      const target = edge - offsets[c.who][axis] * dirA
      // Back along the track for the latest moment the pointer was at `target`.
      let tStar = null
      const step = P / 20
      let prev = null
      for (let t = T + P; t >= T - 12 * P; t -= step) {
        const q = at(t)
        const qa = axis === 'y' ? q.y : q.x
        if (prev !== null && (qa - target) * (prev - target) <= 0) {
          const f2 = prev === qa ? 0 : (prev - target) / (prev - qa)
          tStar = t + step - step * f2
          break
        }
        prev = qa
      }
      const gap = (pa - target) * Math.sign(v)
      const row = {
        who: c.who,
        t: T,
        phase: phaseName(f.phase),
        axis,
        v: r3(v),
        vCss: Math.round(vCss),
        speed,
        gapPx: r3(gap),
        gapOverSpeed: r3(gap / Math.abs(v)),
        lag: tStar === null ? null : r3((T - tStar) / P)
      }
      lagRows.push(row)
      byWho[c.who].push(row)
    }
  }

  const lagStats = {}
  for (const who of Object.keys(byWho)) {
    const xs = byWho[who].filter((r) => r.lag !== null)
    const out = { all: describe(xs.map((r) => r.lag)) }
    for (const s of ['slow', 'medium', 'fast']) {
      const ss = xs.filter((r) => r.speed === s)
      out[s] = describe(ss.map((r) => r.lag))
      // Shake: the SD where the speed held steady (within 15% of the frames
      // either side), so an acceleration is not counted as shake.
      const steady = ss.filter((r, i) => {
        const a = ss[i - 1]
        const b = ss[i + 1]
        return a && b && Math.abs(a.v - r.v) <= 0.15 * Math.abs(r.v) && Math.abs(b.v - r.v) <= 0.15 * Math.abs(r.v)
      })
      out[s].steadySd = r3(sd(steady.map((r) => r.lag)))
      out[s].steadyN = steady.length
      out[s].gapOverSpeedMedian = r3(quantile(ss.map((r) => r.gapOverSpeed), 0.5))
    }
    const phases = {}
    for (const r of xs) (phases[r.phase] ??= []).push(r.lag)
    out.byPhase = Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, describe(v)]))
    out.unmatched = byWho[who].length - xs.length
    lagStats[who] = out
  }

  // ---- presence: when the box is up in a frame -----------------------------------------
  const visible = (found, who) => found[who].col.length > 0 || found[who].row.length > 0
  const firstFrameAfter = (t, test) => {
    for (const r of rows) if (r.f.present_qpc >= t && test(r)) return r
    return null
  }
  const releases = []
  const escapes = []
  for (let i = 1; i < poll.length; i++) {
    if (poll[i - 1].primary === 1 && poll[i].primary === 0) releases.push(poll[i].qpc)
    if (poll[i - 1].escape === 0 && poll[i].escape === 1 && poll[i].primary === 1) escapes.push(poll[i].qpc)
  }
  const goneAfter = (t, who) => {
    // Only counted when the box was seen in the 150 ms before the moment.
    const before = rows.filter((r) => r.f.present_qpc < t && r.f.present_qpc > t - 0.15 * F && visible(r.found, who))
    if (!before.length) return null
    const gone = firstFrameAfter(t, (r) => !visible(r.found, who))
    if (!gone) return null
    // Frames presented after the moment that still showed the box: the gate's
    // number ("gone within one frame"). The time is kept as well.
    const still = rows.filter((r) => r.f.present_qpc >= t && r.f.present_qpc < gone.f.present_qpc && visible(r.found, who)).length
    return { frames: still, ms: r3(((gone.f.present_qpc - t) * 1000) / F) }
  }
  const presence = {}
  for (const c of colours) {
    const relAll = releases.map((t) => goneAfter(t, c.who)).filter((x) => x !== null)
    const escAll = escapes.map((t) => goneAfter(t, c.who)).filter((x) => x !== null)
    const rel = relAll.map((x) => x.frames)
    const esc = escAll.map((x) => x.frames)
    const begins = events.filter((e) => e.kind === 'begin').map((e) => e.qpc)
    const vis = begins
      .map((t) => {
        const r = firstFrameAfter(t, (x) => visible(x.found, c.who))
        return r && r.f.present_qpc - t < F ? r3((r.f.present_qpc - t) / P) : null
      })
      .filter((x) => x !== null)
    presence[c.who] = {
      releaseToGoneFrames: { ...describe(rel), max: r3(rel.length ? Math.max(...rel) : null), ms: describe(relAll.map((x) => x.ms)), each: rel },
      escapeToGoneFrames: { ...describe(esc), ms: describe(escAll.map((x) => x.ms)), each: esc },
      beginToVisibleFrames: { ...describe(vis), each: vis }
    }
  }

  // ---- both: the origin at rest and the anchored edge's delay (K) ---------------------
  let origin = null
  let kEstimate = null
  if (mode === 'both' && colours.length === 2) {
    const updates = events.filter((e) => e.kind === 'update')
    const causeAt = (t) => {
      let last = null
      for (const u of updates) if (u.qpc <= t && t - u.qpc < 0.3 * F) last = u.cause
      return last
    }
    const diffs = { top: [], bottom: [], left: [], right: [] }
    for (const { f, found } of rows) {
      if (!f.held) continue
      const p = at(f.present_qpc)
      const p0 = at(f.present_qpc - 3 * P)
      // At rest: the pointer still AND nothing scrolled in the last 300 ms.
      if (!p || !p0 || Math.hypot(p.x - p0.x, p.y - p0.y) > 0.5 || causeAt(f.present_qpc)) continue
      const n = found.native
      const d = found.dom
      if (n.col.length >= 2 && d.col.length >= 2) {
        diffs.top.push(d.col[0][0] - n.col[0][0])
        diffs.bottom.push(d.col.at(-1)[1] - n.col.at(-1)[1])
      }
      if (n.row.length >= 2 && d.row.length >= 2) {
        diffs.left.push(d.row[0][0] - n.row[0][0])
        diffs.right.push(d.row.at(-1)[1] - n.row.at(-1)[1])
      }
    }
    // The native box was drawn shifted by (ox, oy) on purpose; the gate's number
    // is the offset WITHOUT that shift (0 when the native box sits exactly on
    // the DOM box). The raw median is kept for K, which compares the drawn edges.
    origin = Object.fromEntries(
      Object.entries(diffs).map(([k, v]) => {
        const raw = quantile(v, 0.5)
        const shift = k === 'top' || k === 'bottom' ? oy : ox
        return [k, { n: v.length, rawDomMinusNative: r3(raw), domMinusNativeMedian: raw === null ? null : r3(raw + shift) }]
      })
    )

    // The anchored edge (vertical) per compositor frame slot, native vs DOM.

    const series = {}
    const t0 = rows.length ? rows[0].f.present_qpc : 0
    for (const { f, found } of rows) {
      if (!f.held) continue
      const cause = causeAt(f.present_qpc)
      if (!cause) continue
      const p = at(f.present_qpc)
      if (!p) continue
      const ne = nearEdge(found.native.col, f.anchor_y, p.y)
      const de = nearEdge(found.dom.col, f.anchor_y, p.y)
      const slot = Math.round((f.present_qpc - t0) / P)
      ;(series[cause] ??= new Map()).set(slot, { ne, de })
    }
    const restTop = origin.top.rawDomMinusNative ?? -oy
    kEstimate = {}
    for (const [cause, map] of Object.entries(series)) {
      const scores = []
      for (let d = 0; d <= 6; d++) {
        const errs = []
        for (const [slot, v] of map) {
          const back = map.get(slot - d)
          if (v.de === null || !back || back.ne === null) continue
          errs.push(Math.abs(v.de - restTop - back.ne))
        }
        scores.push({ delayFrames: d, n: errs.length, meanAbsPx: r3(mean(errs)) })
      }
      const usable = scores.filter((s) => s.n >= 10 && s.meanAbsPx !== null)
      const best = usable.sort((a, b) => a.meanAbsPx - b.meanAbsPx)[0] ?? null
      kEstimate[cause] = { best: best?.delayFrames ?? null, restTopOffset: restTop, scores }
    }
  }

  // ---- the native side's own log and stats ------------------------------------------------
  const nf = csv(join(dir, 'native-frames.csv'))
  const ticks = nf.filter((r) => r.frame >= 0)
  const sampleToCommitUs = ticks.filter((r) => r.committed === 1).map((r) => ((r.commit_qpc - r.sample_qpc) * 1e6) / F)
  const tickToSampleUs = ticks.map((r) => ((r.sample_qpc - r.tick_qpc) * 1e6) / F)
  const stats = events.filter((e) => e.kind === 'stats')
  const lastStats = stats.at(-1) ?? null
  let cpu = null
  if (lastStats && lastStats.upFrames > 0) {
    const upSeconds = lastStats.upFrames / (meta.refreshHz || 144)
    cpu = {
      upSeconds: r3(upSeconds),
      workPctOfCoreWhileUp: r3((lastStats.workUs / 1e6 / upSeconds) * 100),
      coarseCpuPctWhileUp: r3((lastStats.cpuUs / 1e6 / upSeconds) * 100),
      idleWakes: lastStats.idleWakes,
      begins: events.filter((e) => e.kind === 'begin').length,
      failures: lastStats.failures,
      maxWorkUs: lastStats.maxWorkUs
    }
  }

  writeFileSync(
    join(dir, 'lag.csv'),
    'who,t,phase,axis,v,vCss,speed,gapPx,gapOverSpeed,lag\n' +
      lagRows.map((r) => [r.who, r.t, r.phase, r.axis, r.v, r.vCss, r.speed, r.gapPx, r.gapOverSpeed, r.lag].join(',')).join('\n')
  )

  return {
    dir,
    mode,
    sampling: info.samplingMode ?? null,
    refreshHz: meta.refreshHz,
    dpr,
    counts: { ...meta.counts, framesWithStrips: rows.length, pointerTrack: track.length, pointerSource: POINTER === 'poll' || mouse.length < 10 ? 'poll' : 'dda' },
    colours,
    tolerance: TOL,
    edgeOffsetAtRest: offsets,
    lag: lagStats,
    presence,
    origin,
    kEstimate,
    native: {
      ticks: ticks.length,
      tickToSampleUs: describe(tickToSampleUs),
      sampleToCommitUs: describe(sampleToCommitUs),
      cpu
    }
  }
}

// ---- the gate ---------------------------------------------------------------------------------
const results = runs.map(analyzeRun)
const nativeRun = results.find((r) => r.mode === 'native')
const domRun = results.find((r) => r.mode === 'dom')
const bothRun = results.find((r) => r.mode === 'both')
const gate = {}
if (nativeRun) {
  const L = nativeRun.lag.native
  gate.lagPerSpeed = Object.fromEntries(
    ['slow', 'medium', 'fast'].map((s) => [
      s,
      {
        nativeMedian: L?.[s]?.median,
        nativeP95: L?.[s]?.p95,
        n: L?.[s]?.n ?? 0,
        // Fewer than 30 frames at a speed is not a measurement of it.
        pass: (L?.[s]?.n ?? 0) >= 30 ? L[s].median <= 1.25 && L[s].p95 <= 2 : null
      }
    ])
  )
  gate.shake = Object.fromEntries(
    ['slow', 'medium', 'fast'].map((s) => [s, { steadySd: L?.[s]?.steadySd, steadyN: L?.[s]?.steadyN ?? 0, pass: (L?.[s]?.steadyN ?? 0) >= 30 ? L[s].steadySd <= 0.5 : null }])
  )
  const rel = nativeRun.presence.native?.releaseToGoneFrames
  gate.releaseToGone = { max: rel?.max, n: rel?.n, pass: rel?.n ? rel.max <= 1 : null }
  gate.cpu = nativeRun.native.cpu
    ? { workPctWhileUp: nativeRun.native.cpu.workPctOfCoreWhileUp, pass: nativeRun.native.cpu.workPctOfCoreWhileUp < 1 }
    : null
}
if (nativeRun && domRun) {
  const n = nativeRun.lag.native?.all?.median
  const d = domRun.lag.dom?.all?.median
  gate.nativeVsDom = {
    nativeMedian: n,
    domMedian: d,
    perSpeed: Object.fromEntries(
      ['slow', 'medium', 'fast'].map((s) => [s, { native: nativeRun.lag.native?.[s]?.median, dom: domRun.lag.dom?.[s]?.median }])
    ),
    pass: n != null && d != null ? n <= d - 1 : null
  }
}
if (bothRun) {
  gate.origin = bothRun.origin
  gate.k = bothRun.kEstimate
}
const summary = { generated: new Date().toISOString(), tolerance: TOL, pointer: POINTER, gate, runs: results }
const outFile = OUT ?? join(runs[0], '..', 'summary.json')
writeFileSync(outFile, JSON.stringify(summary, null, 2))

// A short text version next to it.
const lines = []
for (const r of results) {
  lines.push(`== ${basename(r.dir)} (${r.mode}) refresh ${r.refreshHz} Hz, dpr ${r.dpr}, frames ${r.counts.frames}, strips ${r.counts.framesWithStrips}, pointer ${r.counts.pointerSource} ${r.counts.pointerTrack}`)
  for (const [who, L] of Object.entries(r.lag)) {
    for (const s of ['slow', 'medium', 'fast'])
      lines.push(`  ${who} ${s.padEnd(6)} lag median ${L[s].median} p95 ${L[s].p95} n ${L[s].n} steady SD ${L[s].steadySd} (n ${L[s].steadyN})`)
    const p = r.presence[who]
    lines.push(`  ${who} release->gone max ${p.releaseToGoneFrames.max} median ${p.releaseToGoneFrames.median} (n ${p.releaseToGoneFrames.n}); escape->gone median ${p.escapeToGoneFrames.median} (n ${p.escapeToGoneFrames.n}); begin->visible median ${p.beginToVisibleFrames.median} (n ${p.beginToVisibleFrames.n})`)
  }
  if (r.native.cpu) lines.push(`  native thread: work ${r.native.cpu.workPctOfCoreWhileUp}% of a core while up, idle wakes ${r.native.cpu.idleWakes}, failures ${r.native.cpu.failures}`)
  if (r.origin) lines.push(`  origin (dom - native, px): ${JSON.stringify(r.origin)}`)
  if (r.kEstimate) lines.push(`  K: ${Object.entries(r.kEstimate).map(([c, k]) => `${c}=${k.best}`).join(', ')}`)
}
lines.push('== gate')
lines.push(JSON.stringify(gate, null, 2))
const text = lines.join('\n')
writeFileSync(outFile.replace(/\.json$/, '.txt'), text + '\n')
console.log(text)
console.log(`\nwritten: ${outFile}`)
