import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// NO FOCUS BOXES (#272; owner, 2026-10-04: "remove the focus effect. go
// through the ui and remove focus effects like this"). Read as source, the
// way settingsControls.test.ts reads Settings: no class in the renderer draws
// a ring or an outline on focus, and no stylesheet gives :focus-visible an
// outline. Focus shows as a fill (index.css's base rule) or a field's edge.
const ROOT = resolve(__dirname, '..')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p)
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
  })
}
const all = files(ROOT).map((p) => ({
  path: relative(ROOT, p).replace(/\\/g, '/'),
  src: readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
}))

describe('no focus rings', () => {
  it('found the renderer source', () => {
    expect(all.some((f) => f.path === 'index.css')).toBe(true)
    expect(all.length).toBeGreaterThan(50)
  })

  it('no class draws a ring or an outline on focus', () => {
    const hits = all.flatMap((f) =>
      [...f.src.matchAll(/\b(?:group-|peer-)?focus(?:-visible|-within)?:(?:ring|outline)(?!-none)[^\s'"`]*/g)].map(
        (m) => `${f.path}: ${m[0]}`
      )
    )
    expect(hits).toEqual([])
  })

  it('no stylesheet outlines a focused element', () => {
    const hits = all
      .filter((f) => f.path.endsWith('.css'))
      .flatMap((f) =>
        [...f.src.matchAll(/([^{}]*:focus[^{}]*)\{([^}]*)\}/g)]
          .filter((m) => {
            const value = (prop: string): string =>
              (m[2].match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`))?.[1] ?? 'none').trim()
            return !/^(none|0)\b/.test(value('outline')) || !/^none\b/.test(value('box-shadow'))
          })
          .map((m) => `${f.path}: ${m[1].trim()}`)
      )
    expect(hits).toEqual([])
  })

  it('the base rule takes the ring away and lays the hover fill on', () => {
    const css = all.find((f) => f.path === 'index.css')!.src
    expect(css).toMatch(/:focus-visible:where\([^)]*\)[^{]*\{\s*outline: none;/)
    expect(css).toMatch(/background-image: linear-gradient\(var\(--p-hover\), var\(--p-hover\)\)/)
  })
})
