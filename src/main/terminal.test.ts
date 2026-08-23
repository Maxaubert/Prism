import { describe, expect, it, vi } from 'vitest'
import { OutputBatcher, ptyEnv } from './terminal'

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

describe('ptyEnv', () => {
  it('answers for what the panel can display, not for its launcher', () => {
    const env = ptyEnv({ TERM: 'dumb', COLORTERM: undefined, PATH: 'C:\bin' })
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env.PATH).toBe('C:\bin')
  })

  it('drops the variables that would silence colour', () => {
    // The real regression: Prism launched from a shell with NO_COLOR=1 handed
    // it to every agent, and Claude Code went monochrome, logo and all.
    const env = ptyEnv({ NO_COLOR: '1', FORCE_COLOR: '0' })
    expect('NO_COLOR' in env).toBe(false)
    expect('FORCE_COLOR' in env).toBe(false)
  })

  it('keeps a FORCE_COLOR that asks for MORE colour', () => {
    expect(ptyEnv({ FORCE_COLOR: '3' }).FORCE_COLOR).toBe('3')
  })

  it('passes everything else through untouched, undefined aside', () => {
    const env = ptyEnv({ FOO: 'bar', GONE: undefined })
    expect(env.FOO).toBe('bar')
    expect('GONE' in env).toBe(false)
  })
})
