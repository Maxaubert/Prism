import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_GROUND } from '../../shared/ground'
import { TERM_PRESETS } from './termTheme'

// ONE DEFAULT GROUND AND ONE LIGHT/DARK LINE (audit 2026-10-12). Read as
// source: a literal ground or a hand-typed 0.4 is a copy that can drift.
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === 'node_modules' ? [] : walk(p)
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : []
  })
const root = join(__dirname, '..', '..', '..')
const files = [...walk(join(root, 'core')), ...walk(join(root, 'src'))].map((f) => ({
  f: relative(root, f).split('\\').join('/'),
  src: readFileSync(f, 'utf8')
}))

describe('the ground', () => {
  it('is the Prism preset', () => {
    expect(TERM_PRESETS.find((p) => p.id === 'prism')?.bg).toBe(DEFAULT_GROUND)
  })
  it('no file types the default ground but ground.ts (the switch knob is its own colour that happens to match)', () => {
    const typed = files
      .filter(({ src }) => /#0b0b0f|#101215/i.test(src))
      .map(({ f }) => f)
      .filter((f) => f !== 'core/shared/ground.ts' && f !== 'core/renderer/lib/switchKnob.ts')
    expect(typed).toEqual([])
  })
  it('no file compares a luminance with a hand-typed 0.4', () => {
    const typed = files.filter(({ src }) => /luminance\([^)]*\)+\s*(>|<=)\s*0\.4\b/.test(src)).map(({ f }) => f)
    expect(typed).toEqual([])
  })
})
