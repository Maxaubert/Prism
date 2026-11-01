import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PATHS } from './paths'

// ONE STRING PER DRAWING (structure cleanup, 2026-10-12). Read as source, the
// way noFocusRings.test.ts reads the renderer: a glyph's path data written out
// in two places (the close cross was typed eleven times) is a drawing that
// will one day be fixed in one of them. A second copy belongs in `PATHS`.
const ROOT = resolve(__dirname, '../..')

// The generated file-kind art is emitted whole by tools/icons/svg.py, and the
// built-in folder icons by tools/icons/folder-icons.mjs (Lucide repeats shapes
// across icons and shares Feather's paths with some of Prism's).
const GENERATED = new Set(['lib/iconPaths.ts', 'lib/folderIconSet.ts'])

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
  })
}
const all = files(ROOT)
  .map((p) => ({ path: relative(ROOT, p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') }))
  .filter((f) => !GENERATED.has(f.path))

/** Every quoted string that reads as svg path data: a moveto, then numbers. */
function pathStrings(src: string): string[] {
  return [...src.matchAll(/(["'`])([Mm][\d.-][^"'`$]{5,})\1/g)].map((m) => m[2])
}

describe('icon paths', () => {
  it('found the renderer source', () => {
    expect(all.some((f) => f.path === 'components/icons/paths.ts')).toBe(true)
    expect(all.length).toBeGreaterThan(50)
  })

  it('no path data is written out twice', () => {
    const seen = new Map<string, string[]>()
    for (const f of all)
      for (const d of pathStrings(f.src)) seen.set(d, [...(seen.get(d) ?? []), f.path])
    const twice = [...seen]
      .filter(([, at]) => at.length > 1)
      .map(([d, at]) => `${d}  (${at.join(', ')})`)
    expect(twice).toEqual([])
  })

  it('the table holds each drawing once', () => {
    const values = Object.values(PATHS)
    expect(new Set(values).size).toBe(values.length)
  })
})
