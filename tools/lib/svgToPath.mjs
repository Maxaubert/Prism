/**
 * SVG SHAPES AS ONE PATH (folder icons, 2026-10-31). Lucide draws each icon
 * from paths, circles, rects, lines, ellipses, polylines and polygons; Prism's
 * one line-glyph primitive (`Icon`) draws a single `d`. Each element becomes
 * its own subpath, starting with an absolute moveto, so the parts can be
 * joined end to end without one moving the next.
 */

/** A number as short as it can be written exactly enough (3 decimals). */
export function num(n) {
  const r = Math.round(n * 1000) / 1000
  return String(Object.is(r, -0) ? 0 : r)
}

const f = (v) => Number.parseFloat(v)

/**
 * A path's own `d`, safe to append to another: a leading RELATIVE moveto is
 * absolute when it starts a path, but relative to the previous point once
 * joined. Its first pair becomes `M x y`, and any pairs after it (implicit
 * linetos, relative) become an explicit `l`.
 */
export function absoluteStart(d) {
  const s = d.trim()
  if (s[0] !== 'm') return s
  const m = /^m([^a-zA-Z]*)/.exec(s)
  const rest = s.slice(m[0].length)
  const nums = (m[1].match(/-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi) ?? []).map(Number)
  const head = `M${num(nums[0])} ${num(nums[1])}`
  const tail = nums.slice(2)
  return `${head}${tail.length ? `l${tail.map(num).join(' ')}` : ''}${rest}`
}

function circle(cx, cy, rx, ry) {
  // Two half arcs: one arc from a point to itself draws nothing.
  return `M${num(cx - rx)} ${num(cy)}a${num(rx)} ${num(ry)} 0 1 0 ${num(2 * rx)} 0a${num(rx)} ${num(ry)} 0 1 0 ${num(-2 * rx)} 0`
}

function rect(a) {
  const x = f(a.x ?? 0)
  const y = f(a.y ?? 0)
  const w = f(a.width)
  const h = f(a.height)
  // SVG's rule: a missing radius takes the other's; each is at most half its side.
  let rx = a.rx !== undefined ? f(a.rx) : a.ry !== undefined ? f(a.ry) : 0
  let ry = a.ry !== undefined ? f(a.ry) : rx
  rx = Math.min(rx, w / 2)
  ry = Math.min(ry, h / 2)
  if (!rx || !ry) return `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}z`
  const arc = (dx, dy) => `a${num(rx)} ${num(ry)} 0 0 1 ${num(dx)} ${num(dy)}`
  return (
    `M${num(x + rx)} ${num(y)}h${num(w - 2 * rx)}${arc(rx, ry)}v${num(h - 2 * ry)}${arc(-rx, ry)}` +
    `h${num(-(w - 2 * rx))}${arc(-rx, -ry)}v${num(-(h - 2 * ry))}${arc(rx, -ry)}z`
  )
}

function points(list, close) {
  const n = list.trim().split(/[\s,]+/).map(Number)
  const pairs = []
  for (let i = 0; i + 1 < n.length; i += 2) pairs.push(`${num(n[i])} ${num(n[i + 1])}`)
  return `M${pairs[0]}${pairs.slice(1).map((p) => `L${p}`).join('')}${close ? 'z' : ''}`
}

/** One element as a subpath. */
export function elementToPath(tag, a) {
  switch (tag) {
    case 'path':
      return absoluteStart(a.d)
    case 'circle':
      return circle(f(a.cx ?? 0), f(a.cy ?? 0), f(a.r), f(a.r))
    case 'ellipse':
      return circle(f(a.cx ?? 0), f(a.cy ?? 0), f(a.rx), f(a.ry))
    case 'rect':
      return rect(a)
    case 'line':
      return `M${num(f(a.x1 ?? 0))} ${num(f(a.y1 ?? 0))}L${num(f(a.x2 ?? 0))} ${num(f(a.y2 ?? 0))}`
    case 'polyline':
      return points(a.points, false)
    case 'polygon':
      return points(a.points, true)
    default:
      throw new Error(`no path for <${tag}>`)
  }
}

/** True when an element is drawn filled as well as stroked (Lucide's dots). */
const filled = (a) => a.fill !== undefined && a.fill !== 'none'

/**
 * A whole icon: `d` is every stroked element, `fill` the ones that are filled
 * too (they are stroked as well, so they are in both), or undefined.
 */
export function iconToPaths(nodes) {
  const d = nodes.map(([tag, a]) => elementToPath(tag, a)).join('')
  const dots = nodes.filter(([, a]) => filled(a)).map(([tag, a]) => elementToPath(tag, a))
  return { d, fill: dots.length ? dots.join('') : undefined }
}
