import { describe, expect, it } from 'vitest'
import { oneAtATime } from './oneAtATime'

describe('oneAtATime', () => {
  it('shares one run between calls made together, and runs again after (audit #73)', async () => {
    let runs = 0
    let release: () => void = () => undefined
    const start = oneAtATime(async () => {
      runs += 1
      await new Promise<void>((r) => (release = r))
    })
    const a = start()
    const b = start()
    expect(runs).toBe(1)
    release()
    await Promise.all([a, b])
    const c = start()
    expect(runs).toBe(2)
    release()
    await c
  })
})
