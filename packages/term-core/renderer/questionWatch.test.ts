import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchQuestions, type WatchedTerm } from './questionWatch'
import screens from './questionWidget.screens.json'

const at = (name: string): string[] => (screens as Record<string, string[]>)[name]

/**
 * A terminal `rows` high whose buffer is `write`'s lines: the last `rows` of
 * them are the live screen (`baseY`), the rest scrollback. `write` swaps the
 * buffer and fires the parse event; `scrollTop` moves the viewport to the top.
 */
function fakeTerm(rows = 40): WatchedTerm & { write(lines: string[]): void; scrollTop(): void } {
  let screen: string[] = []
  const subs = new Set<() => void>()
  const active = {
    baseY: 0,
    viewportY: 0,
    getLine: (y: number) => (y < screen.length ? { translateToString: () => screen[y] } : undefined)
  }
  return {
    rows,
    buffer: { active },
    onWriteParsed: (cb) => {
      subs.add(cb)
      return { dispose: () => subs.delete(cb) }
    },
    write(lines) {
      screen = lines
      active.baseY = active.viewportY = Math.max(0, lines.length - rows)
      for (const cb of subs) cb()
    },
    scrollTop() {
      active.viewportY = 0
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

  it('finds a widget taller than the pane, its tab row in scrollback', () => {
    const term = fakeTerm(8)
    const got: unknown[] = []
    watchQuestions(term, (s) => got.push(s), 150)
    term.write(at('run2-02-right'))
    vi.advanceTimersByTime(150)
    expect(got).toEqual([{ text: 'Pick a size?' }])
  })

  it('follows the newer of two widget frames, a stale one above', () => {
    const term = fakeTerm(50)
    const got: unknown[] = []
    watchQuestions(term, (s) => got.push(s), 150)
    term.write(at('run2-01-question-1'))
    vi.advanceTimersByTime(150)
    term.write([...at('run2-01-question-1'), ...at('run2-02-right')])
    vi.advanceTimersByTime(150)
    expect(got).toEqual([{ text: 'Pick a colour?' }, { text: 'Pick a size?' }])
  })

  it('reads the live screen while the user has scrolled up', () => {
    const term = fakeTerm(30)
    const got: unknown[] = []
    watchQuestions(term, (s) => got.push(s), 150)
    const lines = [...at('run2-01-question-1'), ...Array<string>(40).fill('output'), ...at('run2-02-right')]
    term.write(lines)
    term.scrollTop()
    vi.advanceTimersByTime(150)
    expect(got).toEqual([{ text: 'Pick a size?' }])
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
