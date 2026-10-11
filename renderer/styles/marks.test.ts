import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { MOTION_CLASS } from '../components/markClasses'

// Every motion the resolver can name has its class here, its keyframes, and a
// reduced-motion rule: a missing keyframe is a still mark nobody notices, and a
// mark left to the window's "*" rule ends a grow at empty.

const css = readFileSync(join(__dirname, 'marks.css'), 'utf8')
const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))

describe('the marks stylesheet (#143)', () => {
  it('has a class and keyframes for every motion', () => {
    for (const [motion, cls] of Object.entries(MOTION_CLASS)) {
      if (!cls) continue
      for (const c of cls.split(' ')) {
        expect(css, `${motion}: .${c}`).toMatch(new RegExp(`\\.${c}\\s*\\{[^}]*animation:\\s*${c}`))
        expect(css, `${motion}: @keyframes ${c}`).toContain(`@keyframes ${c}`)
      }
    }
  })

  it('stills every one of them under reduced motion, with !important', () => {
    for (const cls of Object.values(MOTION_CLASS).filter(Boolean)) {
      for (const c of (cls as string).split(' ')) expect(reduced, c).toContain(`.${c}`)
    }
    expect(reduced).toMatch(/animation:\s*none\s*!important/)
  })

  it('keeps a working edge FULL, the run whole, the question on, and has no ride', () => {
    expect(reduced).toMatch(/\.p-mark-grow\s*\{\s*transform:\s*none/)
    expect(reduced).toMatch(/\.p-agent-run\s*\{\s*left:\s*0;\s*width:\s*100%/)
    expect(reduced).toMatch(/\.p-mark-breathe\s*\{\s*opacity:\s*1/)
    // The ride went with the 2026-10-10 rework: Full's working tab carries
    // Minimal's own run.
    expect(css).not.toContain('p-mark-ride')
  })
})
