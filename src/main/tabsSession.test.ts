import { beforeEach, describe, expect, it, vi } from 'vitest'

const writes: Array<{ how: 'async' | 'sync'; text: string }> = []
vi.mock('./latestWrite', () => ({
  latestWriter: () => ({
    write: async (text: string) => void writes.push({ how: 'async', text }),
    flushSync: (text: string) => void writes.push({ how: 'sync', text })
  })
}))
vi.mock('./paths', () => ({ userPaths: { tabs: () => 'tabs.json' } }))
const granted: string[] = []
vi.mock('./desktopAccess', () => ({ grantDesktopDirectory: (_t: string, p: string) => void granted.push(p) }))
vi.mock('./browse', () => ({ browseDirectory: async () => null }))

const { createTabsSession } = await import('./tabsSession')

function session() {
  return createTabsSession({
    cachedListing: async () => null,
    archiveRead: async () => undefined,
    binRead: async () => null,
    buildPayload: async () => null
  }).session
}
const strip = { tabs: [{ id: 't1', root: 'C:\\x' }], active: 0 }

beforeEach(() => {
  writes.length = 0
  granted.length = 0
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

describe('a tab saved in the Recycle Bin (stage 2, D5)', () => {
  const BIN = 'shell:RecycleBinFolder'
  const saved = {
    tabs: [
      {
        id: 'b1',
        root: 'C:\\x',
        browse: { path: BIN, history: [{ path: BIN }], cursor: 0, surface: 'folder', preview: true }
      }
    ],
    active: 0
  }

  it('comes back in the bin with the bin read, and the sentinel is granted nothing', async () => {
    const listing = { path: BIN, listing: { folders: [], files: [], bin: true } }
    const sent: Array<{ listing?: unknown }> = []
    const s = createTabsSession({
      cachedListing: async () => null,
      archiveRead: async () => undefined,
      binRead: async () => listing as never,
      buildPayload: async () => null
    })
    await s.restoreTabs((p) => void sent.push(p as never), saved as never, () => 'x')
    expect(sent).toHaveLength(1)
    expect(sent[0].listing).toEqual(listing)
    expect(granted).not.toContain(BIN)
  })

  it('a bin that does not answer falls back to the root listing', async () => {
    const s = createTabsSession({
      cachedListing: async (p) =>
        p === 'C:\\x' ? ({ path: 'C:\\x', listing: { folders: [], files: [] } } as never) : null,
      archiveRead: async () => undefined,
      binRead: async () => null,
      buildPayload: async () => null
    })
    const sent: Array<{ listing?: { path: string } }> = []
    await s.restoreTabs((p) => void sent.push(p as never), saved as never, () => 'x')
    expect(sent[0].listing?.path).toBe('C:\\x')
  })
})
