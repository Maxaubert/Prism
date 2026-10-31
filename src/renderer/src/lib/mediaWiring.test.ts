import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

/**
 * Wiring pins for #15 and #17 (review, 2026-10-31). The rules themselves are
 * tested in audio.test.ts and viz/vizGuards.test.ts, but nothing there fails
 * when the CALL goes: these tests have no DOM to mount the hook or the canvas
 * in, so they read the source and hold the lines that use the rules.
 */
const src = (rel: string): string =>
  readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n')

describe('the media wiring stays in place', () => {
  it('lets the audio context go when a player unmounts mid-song (#17)', () => {
    const hook = src('hooks/useMediaControls.ts')
    expect(hook).toMatch(/useEffect\(\(\) => \(\) => idleIfSilent\(\), \[\]\)/)
  })

  it('sleeps the draw loop while the canvas is hidden (#15)', () => {
    const viz = src('components/Visualizer.tsx')
    // tick looks first, and a hidden canvas only sets a timer, never a frame.
    expect(viz).toMatch(
      /const tick = \(now: number\): void => \{\n\s+if \(!canvasShown\(canvas\)\) \{\n\s+raf = 0\n\s+sleep = window\.setTimeout\(/
    )
    expect(viz).toMatch(/HIDDEN_POLL_MS\)\n\s+return\n/)
  })

  it('clears a pending sleep when the loop is torn down (#15)', () => {
    const viz = src('components/Visualizer.tsx')
    expect(viz).toMatch(
      /return \(\) => \{\n\s+cancelAnimationFrame\(raf\)\n\s+if \(sleep\) clearTimeout\(sleep\)/
    )
  })
})
