import { describe, expect, it } from 'vitest'
import { KEY_WINDOW_MS, initialCaretHold, onCaretKey, onCaretMove, type CaretHoldState } from './termCaretHold'

const move = (s: CaretHoldState, line: number, x: number, t: number) => onCaretMove(s, { line, x }, t)

describe('termCaretHold', () => {
  it('follows xterm as today before anything was typed', () => {
    expect(move(initialCaretHold(), 10, 3, 1000).hold).toBeNull()
  })

  it("holds on the input line while a streaming frame parks the cursor above it (Claude's inline view, MEASURED)", () => {
    let s = onCaretKey(initialCaretHold(), 1000)
    s = move(s, 24, 4, 1010).state // the echo on the input line
    const frame = move(s, 10, 3, 1000 + KEY_WINDOW_MS + 50) // a frame ends on the output row
    expect(frame.hold).toEqual({ line: 24, x: 4 })
    // It stays held through more frames.
    expect(move(frame.state, 10, 3, 2000).hold).toEqual({ line: 24, x: 4 })
  })

  it('takes the LOWEST position a key reaches, so a frame inside the window does not win', () => {
    let s = onCaretKey(initialCaretHold(), 1000)
    s = move(s, 24, 5, 1010).state
    const r = move(s, 10, 3, 1050) // a frame lands inside the key's window
    expect(r.hold).toEqual({ line: 24, x: 5 })
    expect(r.state.caret).toEqual({ line: 24, x: 5 })
  })

  it('follows at or below the caret: a new prompt, output that pushed the input down', () => {
    let s = onCaretKey(initialCaretHold(), 1000)
    s = move(s, 24, 4, 1010).state
    const down = move(s, 25, 0, 2000)
    expect(down.hold).toBeNull()
    expect(down.state.caret).toEqual({ line: 25, x: 0 })
    // Same line, the cursor moved along it (a shell prompt redraw): follow.
    expect(move(down.state, 25, 9, 2100).hold).toBeNull()
  })

  it('a new key re-anchors, even upwards (Up in a multi-line edit)', () => {
    let s = onCaretKey(initialCaretHold(), 1000)
    s = move(s, 24, 4, 1010).state
    s = onCaretKey(s, 3000)
    const up = move(s, 23, 2, 3010)
    expect(up.hold).toBeNull()
    expect(up.state.caret).toEqual({ line: 23, x: 2 })
  })
})
