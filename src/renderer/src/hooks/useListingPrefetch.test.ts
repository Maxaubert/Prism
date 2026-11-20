import { beforeEach, describe, expect, it, vi } from 'vitest'

const browsePrefetch = vi.fn(async () => null)
vi.stubGlobal('window', { prism: { browsePrefetch } })

const { prefetchQuickAccessOnce, resetQuickAccessOnce } = await import('./useListingPrefetch')

describe('prefetchQuickAccessOnce (audit #89)', () => {
  beforeEach(() => {
    resetQuickAccessOnce()
    browsePrefetch.mockClear()
  })
  const pins = [
    { path: 'C:\\q\\one', isFolder: true },
    { path: 'C:\\q\\file.txt', isFolder: false }
  ] as never

  it('has not used its one turn until the read-ahead really runs', () => {
    // Scheduling and cancelling does not call it; the first run still reads.
    expect(browsePrefetch).not.toHaveBeenCalled()
    expect(prefetchQuickAccessOnce(pins)).toBe(true)
    expect(browsePrefetch).toHaveBeenCalledTimes(1)
    expect(browsePrefetch).toHaveBeenCalledWith('C:\\q\\one', true)
  })
  it('runs once a session', () => {
    prefetchQuickAccessOnce(pins)
    expect(prefetchQuickAccessOnce(pins)).toBe(false)
  })
})
