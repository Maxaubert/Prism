import { describe, expect, it } from 'vitest'
import {
  BELL_GAP_MS,
  THEME_REPORTS_OFF,
  bellGate,
  colourQueryReplies,
  decrqmReply,
  dsrThemeReply,
  groundMode,
  modeParams,
  nudgeWidths,
  noteThemeMode,
  oscColour,
  themePush,
  themeReports,
  xtversionAsked,
  xtversionReply
} from './termReplies'
import { resolveTermTheme } from './termTheme'

const COLOURS = { fg: '#3d2a1f', bg: '#e6d8c0' }

describe('oscColour', () => {
  it("doubles each byte, xterm's own form", () => {
    // The value MEASURED from xterm itself on an opaque light ground.
    expect(oscColour('#f5f5f0')).toBe('rgb:f5f5/f5f5/f0f0')
  })
  it('drops the alpha: the program is told the colour it sees', () => {
    expect(oscColour('#f5f5f0cc')).toBe('rgb:f5f5/f5f5/f0f0')
  })
})

describe('colourQueryReplies', () => {
  it('answers one query with its own number', () => {
    expect(colourQueryReplies(11, '?', COLOURS)).toEqual(['\x1b]11;rgb:e6e6/d8d8/c0c0\x1b\\'])
    expect(colourQueryReplies(10, '?', COLOURS)).toEqual(['\x1b]10;rgb:3d3d/2a2a/1f1f\x1b\\'])
  })
  it('answers a list in order: 10;?;? asks for 10 then 11', () => {
    expect(colourQueryReplies(10, '?;?', COLOURS)).toEqual([
      '\x1b]10;rgb:3d3d/2a2a/1f1f\x1b\\',
      '\x1b]11;rgb:e6e6/d8d8/c0c0\x1b\\'
    ])
  })
  it('leaves a SET, and anything past 11, to xterm', () => {
    expect(colourQueryReplies(11, 'rgb:00/00/00', COLOURS)).toBeNull()
    expect(colourQueryReplies(10, '?;#000000', COLOURS)).toBeNull()
    expect(colourQueryReplies(11, '?;?', COLOURS)).toBeNull()
    expect(colourQueryReplies(11, '', COLOURS)).toBeNull()
  })
  it('never holds CR, LF or BEL: a reply, not a command', () => {
    for (const r of colourQueryReplies(10, '?;?', COLOURS) ?? [])
      for (const c of ['\r', '\n', '\x07']) expect(r.includes(c)).toBe(false)
  })
})

describe('groundMode', () => {
  it.each(['fawn', 'paper'])('%s is light', (id) => {
    expect(groundMode(resolveTermTheme(id).background)).toBe('light')
  })
  it.each(['pt-default', 'prism'])('%s is dark', (id) => {
    expect(groundMode(resolveTermTheme(id).background)).toBe('dark')
  })
  it('measures the colour, never its alpha', () => {
    expect(groundMode('#e6d8c040')).toBe('light')
  })
})

describe('the mode reports (#172)', () => {
  it('DSR 996 is answered 997;1 dark, 997;2 light', () => {
    expect(dsrThemeReply('dark')).toBe('\x1b[?997;1n')
    expect(dsrThemeReply('light')).toBe('\x1b[?997;2n')
  })
  it('DECRQM 2031 says set or reset', () => {
    expect(decrqmReply(2031, true)).toBe('\x1b[?2031;1$y')
    expect(decrqmReply(2031, false)).toBe('\x1b[?2031;2$y')
  })
  it("flattens xterm's params", () => {
    expect(modeParams([1004, [2031, 1], 25])).toEqual([1004, 2031, 1, 25])
  })
})

describe('themePush', () => {
  it('sends nothing while the program has not asked for reports', () => {
    expect(themePush(THEME_REPORTS_OFF, 'light').send).toBeNull()
  })
  it('sends a change once, and nothing for the same mode again', () => {
    // ?2031h while the ground is dark: the mode the program can already know.
    let s = themeReports(THEME_REPORTS_OFF, true, 'dark')
    expect(themePush(s, 'dark').send).toBeNull() // a font change: no news
    const r = themePush(s, 'light')
    expect(r.send).toBe('\x1b[?997;2n')
    s = r.state
    expect(themePush(s, 'light').send).toBeNull()
    expect(themePush(s, 'dark').send).toBe('\x1b[?997;1n')
  })
  it('stops after ?2031l, and turning it on again keeps what was told', () => {
    let s = themeReports(THEME_REPORTS_OFF, true, 'dark')
    s = themeReports(s, false, 'dark')
    expect(themePush(s, 'light').send).toBeNull()
    s = themeReports(s, true, 'light')
    // Told dark last; the ground is light now, so the next look change says so.
    expect(themePush(s, 'light').send).toBe('\x1b[?997;2n')
  })
  it('an answered query counts as told', () => {
    let s = themeReports(THEME_REPORTS_OFF, true, 'dark')
    s = noteThemeMode(s, 'light')
    expect(themePush(s, 'light').send).toBeNull()
  })
})

describe('xtversionReply (#171)', () => {
  it('names this terminal, then the xterm.js under it, as DCS >| ... ST', () => {
    expect(xtversionReply('0.32.0', '6.0.0')).toBe('\x1bP>|PrismTerminal 0.32.0 (xterm.js 6.0.0)\x1b\\')
  })
  it('never starts the name with "xterm.js": Claude would apply its VS Code tuning', () => {
    const name = xtversionReply('0.32.0', '6.0.0').slice('\x1bP>|'.length)
    expect(name.startsWith('xterm.js')).toBe(false)
  })
  it('holds no CR, LF or BEL a shell could act on', () => {
    const r = xtversionReply('0.32.0', '6.0.0')
    for (const c of ['\r', '\n', '\x07']) expect(r.includes(c)).toBe(false)
  })
})

describe('xtversionAsked', () => {
  it('answers CSI > q and CSI > 0 q only', () => {
    expect(xtversionAsked([])).toBe(true)
    expect(xtversionAsked([0])).toBe(true)
    expect(xtversionAsked([1])).toBe(false)
    expect(xtversionAsked([0, 0])).toBe(false)
  })
})

describe('bellGate (#177)', () => {
  it('lets the first bell through', () => {
    expect(bellGate(null, 5000)).toBe(true)
  })
  it('drops a bell 300 ms after the last one, lets one 1.1 s after through', () => {
    expect(bellGate(5000, 5300)).toBe(false)
    expect(bellGate(5000, 6100)).toBe(true)
  })
  it('is a one-second gap', () => {
    expect(BELL_GAP_MS).toBe(1000)
    expect(bellGate(0, 999)).toBe(false)
    expect(bellGate(0, 1000)).toBe(true)
  })
})

// The redraw nudge after a theme push (owner, 2026-10-11): one column less,
// then the width back, never a key.
describe('nudgeWidths', () => {
  it('is one column narrower and back', () => {
    expect(nudgeWidths(120)).toEqual([119, 120])
  })
  it('is nothing for a terminal too narrow or not measured', () => {
    expect(nudgeWidths(2)).toBeNull()
    expect(nudgeWidths(0)).toBeNull()
    expect(nudgeWidths(Number.NaN)).toBeNull()
  })
})