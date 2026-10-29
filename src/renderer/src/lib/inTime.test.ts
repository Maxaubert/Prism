import { afterEach, describe, expect, it, vi } from 'vitest'
import { inTime } from './inTime'

afterEach(() => vi.useRealTimers())
describe('a wait with a limit (Win+E on a sleeping share, 2026-10-29)', () => {
  it('answers the value that comes in time', async () => {
    await expect(inTime(Promise.resolve('here'), 1000)).resolves.toBe('here')
  })
  it('answers null when the value is late, and null for a failure', async () => {
    vi.useFakeTimers()
    const late = inTime(new Promise<string>(() => {}), 5000)
    vi.advanceTimersByTime(5001)
    await expect(late).resolves.toBeNull()
    await expect(inTime(Promise.reject(new Error('x')), 5000)).resolves.toBeNull()
  })
})
