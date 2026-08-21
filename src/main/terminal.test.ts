import { describe, expect, it, vi } from 'vitest'
import { OutputBatcher } from './terminal'

describe('OutputBatcher', () => {
  it('coalesces chunks and flushes once per window', () => {
    vi.useFakeTimers()
    const sent: string[] = []
    const b = new OutputBatcher((d) => sent.push(d), 8)
    b.push('a')
    b.push('b')
    b.push('c')
    expect(sent).toEqual([]) // nothing yet: batched
    vi.advanceTimersByTime(8)
    expect(sent).toEqual(['abc']) // one message, all the bytes
    b.push('d')
    vi.advanceTimersByTime(8)
    expect(sent).toEqual(['abc', 'd'])
    vi.useRealTimers()
  })

  it('flush() empties immediately, so an exiting shell keeps its last words', () => {
    const sent: string[] = []
    const b = new OutputBatcher((d) => sent.push(d), 8)
    b.push('bye')
    b.flush()
    expect(sent).toEqual(['bye'])
    b.flush() // idempotent: nothing queued, nothing sent
    expect(sent).toEqual(['bye'])
  })
})
