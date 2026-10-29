import { beforeEach, describe, expect, it, vi } from 'vitest'

const writes: Array<{ how: 'async' | 'sync'; text: string }> = []
vi.mock('./latestWrite', () => ({
  latestWriter: () => ({
    write: async (text: string) => void writes.push({ how: 'async', text }),
    flushSync: (text: string) => void writes.push({ how: 'sync', text })
  })
}))
vi.mock('./paths', () => ({ userPaths: { tabs: () => 'tabs.json' } }))
vi.mock('./desktopAccess', () => ({ grantDesktopDirectory: () => {} }))
vi.mock('./browse', () => ({ browseDirectory: async () => null }))

const { createTabsSession } = await import('./tabsSession')

function session() {
  return createTabsSession({
    cachedListing: async () => null,
    archiveRead: async () => undefined,
    buildPayload: async () => null
  }).session
}
const strip = { tabs: [{ id: 't1', root: 'C:\\x' }], active: 0 }

beforeEach(() => {
  writes.length = 0
})

describe("a window's close writes the session file (review, 2026-10-29)", () => {
  it('off main while other windows stay open: closing one of several never stalls main on the disk', () => {
    const s = session()
    s.report(1, strip)
    s.report(2, strip)
    s.closed(1, { others: true, quitting: false })
    expect(writes.map((w) => w.how)).toEqual(['async'])
  })

  it('on main for the last window, and for any window at the quit', () => {
    const s = session()
    s.report(1, strip)
    s.closed(1, { others: false, quitting: false })
    s.report(2, strip)
    s.report(3, strip)
    s.closed(2, { others: true, quitting: true })
    expect(writes.map((w) => w.how)).toEqual(['sync', 'sync'])
  })

  it('the close flush follows the same rule', () => {
    const s = session()
    s.report(1, strip)
    s.flush(false)
    s.report(1, strip)
    s.flush(true)
    expect(writes.map((w) => w.how)).toEqual(['async', 'sync'])
  })
})
