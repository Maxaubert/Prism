import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchQuestions, type WatchedTerm } from './questionWatch'
import screens from './questionWidget.screens.json'

const at = (name: string): string[] => (screens as Record<string, string[]>)[name]

/** A terminal showing `rows`; `write` swaps the screen and fires the parse event. */
function fakeTerm(): WatchedTerm & { write(rows: string[]): void } {
  let screen: string[] = []
  const subs = new Set<() => void>()
  return {
    rows: 40,
    buffer: {
      active: {
        viewportY: 0,
        getLine: (y) => ({ translateToString: () => screen[y] ?? '' })
      }
    },
    onWriteParsed: (cb) => {
      subs.add(cb)
      return { dispose: () => subs.delete(cb) }
    },
    write(rows) {
      screen = rows
      for (const cb of subs) cb()
    }
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('watchQuestions', () => {
  it('reports each change of question once, after output settles', () => {
    const term = fakeTerm()
    const got: unknown[] = []
    watchQuestions(term, (s) => got.push(s), 150)
    term.write(at('run2-01-question-1'))
    term.write(at('run2-01-question-1'))
    expect(got).toEqual([])
    vi.advanceTimersByTime(150)
    expect(got).toEqual([{ text: 'Pick a colour?' }])
    term.write(at('run2-01-question-1'))
    vi.advanceTimersByTime(150)
    expect(got).toHaveLength(1)
    term.write(at('run2-02-right'))
    vi.advanceTimersByTime(150)
    term.write(at('run2-08-enter-answer'))
    vi.advanceTimersByTime(150)
    expect(got).toEqual([{ text: 'Pick a colour?' }, { text: 'Pick a size?' }, { review: true }])
  })

  it('reports the same question again after the widget went away', () => {
    const term = fakeTerm()
    const got: unknown[] = []
    watchQuestions(term, (s) => got.push(s), 150)
    term.write(at('run2-02-right'))
    vi.advanceTimersByTime(150)
    term.write(['PS C:\\> '])
    vi.advanceTimersByTime(150)
    term.write(at('run2-02-right'))
    vi.advanceTimersByTime(150)
    expect(got).toEqual([{ text: 'Pick a size?' }, { text: 'Pick a size?' }])
  })

  it('stops on dispose', () => {
    const term = fakeTerm()
    const got: unknown[] = []
    const w = watchQuestions(term, (s) => got.push(s), 150)
    term.write(at('run2-02-right'))
    w.dispose()
    vi.advanceTimersByTime(500)
    term.write(at('run2-01-question-1'))
    vi.advanceTimersByTime(500)
    expect(got).toEqual([])
  })
})
