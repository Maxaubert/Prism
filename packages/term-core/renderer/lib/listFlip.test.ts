import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { opensAbove } from './listFlip'

describe('opensAbove (audit #85)', () => {
  const bounds = { top: 0, bottom: 600 }
  it('opens below when the list fits', () => {
    expect(opensAbove({ top: 100, bottom: 132 }, 300, bounds)).toBe(false)
  })
  it('flips up near the bottom of the pane when there is room above', () => {
    expect(opensAbove({ top: 500, bottom: 532 }, 300, bounds)).toBe(true)
  })
  it('stays below when it fits neither way and below has more room', () => {
    expect(opensAbove({ top: 100, bottom: 132 }, 700, bounds)).toBe(false)
  })
})
describe('the settings Select uses it (audit #85)', () => {
  it('measures as it opens and opens upward with bottom-full', () => {
    const s = readFileSync(join(__dirname, '..', 'settings', 'fields.tsx'), 'utf8')
    expect(s).toContain('opensAbove(')
    expect(s).toContain("bottom-full mb-1")
  })
})