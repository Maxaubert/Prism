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
    // A ring's COLOUR may change on focus where the element already wears a
    // hairline ring as its edge (a swatch: its hover look); a ring's WIDTH
    // (ring, ring-2, ring-offset) may not, that is the box.
    const hits = all.flatMap((f) =>
      [
        ...f.src.matchAll(
          /\b(?:group-|peer-)?focus(?:-visible|-within)?:(?:ring(?:-\d+|-inset|-offset[^\s'"`]*)?(?=[\s'"`]|$)|outline(?!-none)[^\s'"`]*)/g
        )
      ].map(
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

// Each of these showed NO focus at all in the review of #272 (measured:
// focused and unfocused computed styles identical).
describe('focus still shows where the ring went', () => {
  const src = (path: string): string => all.find((f) => f.path === path)!.src

  it('a slider gets the stronger fill, its box is a thin track', () => {
    expect(src('index.css')).toMatch(
      /:where\(input\[type='range'\]\):focus-visible \{\s*background-image: linear-gradient\(var\(--p-hover-hi\)/
    )
  })

  it("a field's focus edge is in the utilities layer, so a border class cannot hide it", () => {
    const css = src('index.css')
    const layer = css.slice(css.indexOf('@layer utilities'))
    expect(layer).toMatch(/textarea:focus-visible/)
    expect(layer).toMatch(/border-color: color-mix\(in srgb, var\(--p-text\) 28%, transparent\)/)
  })

  it('no Explorer mark sets the background shorthand, which wipes the focus fill', () => {
    const hits = [...src('components/browse/browse.css').matchAll(/([^{}]*\[(?:aria-current|data-selected|data-menu|aria-pressed)[^{}]*)\{([^}]*)\}/g)]
      .filter((m) => /(?:^|[;\s])background\s*:/.test(m[2]))
      .map((m) => m[1].trim())
    expect(hits).toEqual([])
  })

  it('a card or swatch painted inline still shows focus', () => {
    // The appearance cards: the other inline backgrounds there are previews
    // drawn inside a card, not focusable.
    expect(src('components/Onboarding.tsx')).toMatch(
      /aria-pressed=\{mode === m\}[\s\S]{0,900}style=\{\{ backgroundColor: 'var\(--p-hover\)' \}\}/
    )
    expect(src('components/Settings.tsx')).toMatch(/hover:ring-white\/30 focus-visible:ring-white\/30/)
  })
})
