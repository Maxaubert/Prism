import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A ratchet for the god file (audit #9): BrowseList.tsx must not grow back.
 * Row and tile building lives in BrowseEntry.tsx, scroll restore and
 * follow-the-selection in useBrowseScroll.ts, the key table in useBrowseKeys.ts,
 * the sweep in useBrowseSweep.ts, zoom anchoring in useBrowseZoom.ts. New list
 * code goes in one of those, or a file of its own. When BrowseList.tsx shrinks,
 * lower LINES to the new count.
 */
const LINES = 575
const SLACK = 50

describe('BrowseList.tsx size', () => {
  it(`stays within ${SLACK} lines of ${LINES}`, () => {
    const text = readFileSync(join(__dirname, 'BrowseList.tsx'), 'utf8')
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    expect(lines).toBeLessThanOrEqual(LINES + SLACK)
  })
})