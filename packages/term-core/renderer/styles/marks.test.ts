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

  // Perf review 2026-10-16: `left` is a layout and `background-position` a
  // paint on the page's thread every frame; a transform is the compositor's.
  // flow-y alone still slides: the host's chevron edge has no inner layer.
  it('moves the run and the line and fill rainbows by transform only', () => {
    for (const name of ['p-agent-run', 'p-mark-flow-x', 'p-mark-flow-fill']) {
      const at = css.indexOf(`@keyframes ${name} {`)
      const body = css.slice(at, css.indexOf('\n}', at))
      expect(body, name).toContain('transform:')
      expect(body, name).not.toMatch(/\b(left|background-position):/)
    }
    expect(css).toMatch(/translateX\(238\.1%\)/) // 100 / 42: the bar's own widths
  })

  it('pauses every mark while the host says its window is minimised', () => {
    const at = css.indexOf(':root[data-marks-paused]')
    expect(at).toBeGreaterThan(-1)
    const rule = css.slice(at, css.indexOf('}', at))
    for (const cls of Object.values(MOTION_CLASS).filter(Boolean)) {
      for (const c of (cls as string).split(' ')) expect(rule, c).toContain(`.${c}`)
    }
    expect(rule).toMatch(/animation-play-state:\s*paused/)
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
