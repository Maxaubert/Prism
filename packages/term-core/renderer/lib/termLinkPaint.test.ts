import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachLinkPaint } from './termLinkPaint'

// THE LIVE PASS PAINTS ONLY WHAT CHANGED (perf review 2026-10-16). Every
// decoration xterm registers or disposes redraws the whole viewport, and the
// live pass used to dispose and register every link on the live screen on
// every pass (12.5 a second while output flows). A fake terminal with just the
// buffer, markers and decorations the painter uses: no xterm, no DOM.

interface FakeMarker {
  line: number
  isDisposed: boolean
  dispose(): void
}

function fakeTerm(cols: number, rows: number) {
  const lines: string[] = []
  const live = { decos: 0, registered: 0, disposed: 0 }
  const handlers = { parsed: [] as Array<() => void> }
  const element = { isConnected: true, querySelector: () => null }
  const lineAt = (text: string) => ({
    isWrapped: false,
    length: cols,
    translateToString: (trim?: boolean) => (trim ? text.trimEnd() : text.padEnd(cols)),
    getCell: (x: number) => ({ getChars: () => text[x] ?? '', getWidth: () => 1 })
  })
  const buffer = {
    type: 'normal',
    get baseY() {
      return Math.max(0, lines.length - rows)
    },
    get cursorY() {
      return Math.min(rows, lines.length) - 1
    },
    get viewportY() {
      return this.baseY
    },
    get length() {
      return lines.length
    },
    getLine: (i: number) => (i >= 0 && i < lines.length ? lineAt(lines[i]) : undefined),
    getNullCell: () => ({ getChars: () => '', getWidth: () => 1 })
  }
  const off = { dispose: () => {} }
  const term = {
    cols,
    rows,
    element,
    buffer: { active: buffer, onBufferChange: () => off },
    registerMarker: (offset: number): FakeMarker => {
      const m: FakeMarker = {
        line: buffer.baseY + buffer.cursorY + offset,
        isDisposed: false,
        dispose: () => {
          m.isDisposed = true
        }
      }
      return m
    },
    registerDecoration: () => {
      live.decos += 1
      live.registered += 1
      let gone = false
      return {
        onRender: () => off,
        dispose: () => {
          if (gone) return
          gone = true
          live.decos -= 1
          live.disposed += 1
        }
      }
    },
    onWriteParsed: (cb: () => void) => {
      handlers.parsed.push(cb)
      return off
    },
    onResize: () => off,
    onRender: () => off,
    refresh: () => {}
  }
  /** Print lines and tell the painter, as xterm does after parsing. */
  const write = (...more: string[]): void => {
    lines.push(...more)
    handlers.parsed.forEach((cb) => cb())
  }
  /** Rewrite a line in place, as a TUI redraws a row. */
  const rewrite = (i: number, text: string): void => {
    lines[i] = text
    handlers.parsed.forEach((cb) => cb())
  }
  return { term: term as unknown as Terminal, live, element, write, rewrite, lines }
}

const url = (i: number): string => `see https://example.com/${i} ok`

describe('the link painter (perf review 2026-10-16)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as { window?: unknown }).window = globalThis
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('leaves the live screen alone when it did not change', () => {
    const t = fakeTerm(40, 5)
    const p = attachLinkPaint(t.term, () => '#58a6ff')
    t.write(url(0), url(1), 'plain', url(2))
    vi.runAllTimers()
    expect(t.live.decos).toBe(3)
    const before = { ...t.live }
    // A spinner tick: output parsed, the screen as it was.
    t.rewrite(2, 'plain')
    vi.runAllTimers()
    expect(t.live.registered).toBe(before.registered)
    expect(t.live.disposed).toBe(before.disposed)
    p.dispose()
  })

  it('paints again only the line that changed', () => {
    const t = fakeTerm(40, 5)
    const p = attachLinkPaint(t.term, () => '#58a6ff')
    t.write(url(0), url(1), url(2))
    vi.runAllTimers()
    const before = { ...t.live }
    t.rewrite(1, `now ${url(9)}`)
    vi.runAllTimers()
    expect(t.live.registered - before.registered).toBe(1)
    expect(t.live.disposed - before.disposed).toBe(1)
    expect(t.live.decos).toBe(3)
    p.dispose()
  })

  it('keeps one decoration per link as lines scroll into the scrollback', () => {
    const t = fakeTerm(40, 3)
    const p = attachLinkPaint(t.term, () => '#58a6ff')
    t.write(url(0), url(1))
    vi.runAllTimers()
    t.write(url(2), url(3))
    vi.runAllTimers()
    t.write('plain', url(4))
    vi.runAllTimers()
    expect(t.live.decos).toBe(5)
    p.dispose()
    expect(t.live.decos).toBe(0)
  })

  it('paints the live screen again when the ink changes', () => {
    const t = fakeTerm(40, 5)
    let ink = '#58a6ff'
    const p = attachLinkPaint(t.term, () => ink)
    t.write(url(0), url(1))
    vi.runAllTimers()
    const before = { ...t.live }
    ink = '#79c0ff'
    t.rewrite(0, url(0))
    vi.runAllTimers()
    expect(t.live.registered - before.registered).toBe(2)
    expect(t.live.decos).toBe(2)
    p.dispose()
  })

  it('scans nothing while out of the page, and catches up when attached', () => {
    const t = fakeTerm(40, 5)
    const p = attachLinkPaint(t.term, () => '#58a6ff')
    t.element.isConnected = false
    t.write(url(0), url(1))
    expect(vi.getTimerCount()).toBe(0)
    vi.runAllTimers()
    expect(t.live.registered).toBe(0)
    t.element.isConnected = true
    p.attached()
    vi.runAllTimers()
    expect(t.live.decos).toBe(2)
    p.dispose()
  })

  it('paints a burst of scrollback in slices after the live screen', () => {
    const rows = 4
    const t = fakeTerm(40, rows)
    const p = attachLinkPaint(t.term, () => '#58a6ff')
    t.write(url(0))
    vi.runAllTimers()
    expect(t.live.decos).toBe(1)
    // Far more than two screens arrive between two passes.
    t.write(...Array.from({ length: 40 }, (_, i) => url(i + 1)))
    vi.advanceTimersToNextTimer() // the pass itself, nothing after it
    expect(t.live.decos).toBe(rows)
    vi.runAllTimers() // the backlog
    expect(t.live.decos).toBe(41)
    p.dispose()
  })
})
