import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWinERequests, winERequest } from './winERequests'

const id = 'a1234567-1234-4567-89ab-123456789abc'
afterEach(() => vi.useRealTimers())
describe('Win+E launch handoff', () => {
  it('accepts only local generated request tokens', () => {
    expect(winERequest(['app', `--win-e=${id}`])).toBe(id)
    expect(winERequest(['app', '--win-e=\\remote\\pipe\\foo'])).toBeNull()
    expect(winERequest(['app', '--win-e', id])).toBeNull()
  })
  it('waits for both session restoration and renderer subscription before dispatch/ack', () => {
    const dispatch = vi.fn(),
      ack = vi.fn(async () => {})
    const announce = vi.fn()
    const requests = createWinERequests(dispatch, ack, announce)
    requests.enqueue(id)
    // "started" goes to the helper at once, long before the window is ready,
    // so a cold start after boot is waited for rather than given up on.
    expect(announce).toHaveBeenCalledExactlyOnceWith(id)
    requests.ready(id)
    requests.listen()
    expect(dispatch).not.toHaveBeenCalled()
    expect(ack).not.toHaveBeenCalled()
    requests.restored()
    expect(dispatch).toHaveBeenCalledWith(id)
    requests.ready(id)
    requests.ready(id)
    expect(ack).toHaveBeenCalledExactlyOnceWith(id)
  })
  it('deduplicates pending requests and replays only after reload is ready', () => {
    const dispatch = vi.fn(),
      ack = vi.fn(async () => {})
    const requests = createWinERequests(dispatch, ack, vi.fn())
    requests.restored()
    requests.listen()
    requests.enqueue(id)
    requests.enqueue(id)
    expect(dispatch).toHaveBeenCalledTimes(1)
    requests.reload()
    requests.ready(id)
    requests.listen()
    expect(ack).not.toHaveBeenCalled()
    requests.restored()
    expect(dispatch).toHaveBeenCalledTimes(2)
    requests.ready(id)
  })
  it('expires unacknowledged requests and rejects unsolicited replies', () => {
    vi.useFakeTimers()
    const ack = vi.fn(async () => {})
    const requests = createWinERequests(vi.fn(), ack, vi.fn())
    requests.restored()
    requests.listen()
    requests.enqueue(id)
    vi.advanceTimersByTime(45001)
    requests.ready(id)
    expect(ack).not.toHaveBeenCalled()
  })
})
