import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listJobs, resetJobs } from '../lib/jobs'
import { resetHolds } from '../lib/holds'
import { useBinOps, type BinOps, type BinRowInfo } from './useBinOps'

// A BIG BIN IN THE PAGE (review, 2026-11-10: "a 10,000-item bin stalling the
// app"). Restore found each item's folder by asking for the whole list again
// and searching it (`rows().find` per path): Ctrl+A, Restore on 10,000 items
// built 10,000 lists of 10,000 rows before the bar could show, about a second
// of a frozen page. The list is read once per job.
function ops(rows: () => readonly BinRowInfo[]): BinOps {
  const noop = (): void => {}
  let result!: BinOps
  function Probe(): null {
    result = useBinOps({ setAsk: noop, setRefreshKey: noop, noteUndo: noop, rows })
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return result
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetHolds()
  resetJobs()
})

describe('useBinOps on a big bin', () => {
  const big: BinRowInfo[] = Array.from({ length: 10_000 }, (_, i) => ({
    path: `C:\\$Recycle.Bin\\S-1\\$R${i}.txt`,
    name: `${i}.txt`,
    from: `C:\\d${i % 50}`
  }))

  it('a Restore of every row reads the list once, not once per item', () => {
    vi.stubGlobal('window', {
      prism: {
        binRestore: vi.fn(() => new Promise(() => {})),
        cancelFileJob: vi.fn(async () => true)
      }
    })
    const rows = vi.fn(() => big)
    const binOps = ops(rows)
    void binOps.runRestore(big.map((r) => r.path), 'ask')
    expect(rows.mock.calls.length).toBeLessThanOrEqual(2)
    expect(listJobs()).toHaveLength(1)
  })
})
