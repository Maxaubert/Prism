import { opaque } from './colour'
import { luminance } from './termAnsi'
import { DEFAULT_GROUND, LIGHT_GROUND } from '../../shared/ground'

// WHAT THE TERMINAL ANSWERS A PROGRAM THAT ASKS (#168, #172, #171). Pure: the panel
// registers the parser handlers and writes these through `term.input(reply,
// false)`, the path xterm's own replies take. Rule `replies-only-when-asked`
// (docs/regression-rules.md): every byte here answers a query in the pty's own
// stream, or is the `?997` report the program switched on with `?2031h`, and
// none holds CR, LF or anything a shell would run.
//
// MEASURED (Claude Code 2.1.296, bundled ConPTY, 2026-10-10): xterm answered
// `ESC]11;?` from the CLEAR canvas the panel paints behind (rule 14) as
// `rgb:0000/0000/0000`, so Claude's "auto" theme picked dark on every ground.
// Claude asks OSC 11 only (never OSC 10, never `?996n`), writes `?2031h`
// without a DECRQM probe first, and on a pushed `?997;2n` asks OSC 11 again and
// switches: its debug log went from "detected=dark" to "detected=light".

export type GroundMode = 'dark' | 'light'

const ESC = '\x1b'
/** String terminator. xterm itself ends its colour replies with BEL; ST is
 *  the standard form and Claude parses it (the measurement above used it). */
const ST = `${ESC}\\`

/** `#rrggbb` (any alpha dropped) as `rgb:rrrr/gggg/bbbb`, each byte doubled:
 *  xterm's own reply form. */
export function oscColour(hex: string): string {
  const h = opaque(hex).slice(1)
  const ch = (i: number): string => h.slice(i, i + 2).repeat(2)
  return `rgb:${ch(0)}/${ch(2)}/${ch(4)}`
}

/**
 * The replies to an OSC 10 (text) or 11 (ground) whose every item is `?`. The
 * OSC takes a list: `10;?;?` asks for 10 then 11. Null for anything else - a
 * SET, an empty one, or a list running past 11 (the cursor and beyond, which
 * xterm answers itself) - so the handler returns false and xterm does what it
 * always did.
 */
export function colourQueryReplies(
  ident: 10 | 11,
  data: string,
  colours: { fg: string; bg: string }
): string[] | null {
  const items = data.split(';')
  if (!items.length || items.some((i) => i !== '?')) return null
  if (ident + items.length - 1 > 11) return null
  return items.map((_, i) => {
    const n = ident + i
    return `${ESC}]${n};${oscColour(n === 10 ? colours.fg : colours.bg)}${ST}`
  })
}

/**
 * Light or dark, MEASURED from the ground: luminance over LIGHT_GROUND is
 * light, the SAME number the window chrome decides with (`chromeTokens`'s
 * `mode`; rule 15, never read off a name), so a program is never told light
 * under a dark title bar. `chromeTheme.test.ts` still pins the two on every
 * preset.
 */
export function groundMode(bg: string): GroundMode {
  return luminance(opaque(bg, DEFAULT_GROUND)) > LIGHT_GROUND ? 'light' : 'dark'
}

/** The answer to `CSI ? 996 n`, and the report mode 2031 pushes. */
export function dsrThemeReply(mode: GroundMode): string {
  return `${ESC}[?997;${mode === 'dark' ? 1 : 2}n`
}

/** DECRQM's answer for a private mode: 1 set, 2 reset. */
export function decrqmReply(mode: number, set: boolean): string {
  return `${ESC}[?${mode};${set ? 1 : 2}$y`
}

/** xterm hands CSI params as `(number | number[])[]` (sub-params nested). */
export function modeParams(params: (number | number[])[]): number[] {
  return params.flatMap((p) => p)
}

/** Whether the program asked for theme reports (`?2031h`), and the mode it
 *  was last told or could have learned (null: nothing yet). */
export interface ThemeReports {
  on: boolean
  last: GroundMode | null
}
export const THEME_REPORTS_OFF: ThemeReports = { on: false, last: null }

/**
 * `?2031h` / `?2031l`. Turned on, a session with nothing told yet takes the
 * mode in force as known: a report is news of a CHANGE, and the program asks
 * for the current one itself (OSC 11, or `?996n`). Without this, the first
 * font change after `?2031h` would push a mode that never changed.
 */
export function themeReports(s: ThemeReports, on: boolean, now: GroundMode): ThemeReports {
  return { on, last: on ? (s.last ?? now) : s.last }
}

/** A query answered (OSC 11, `?996n`): the program now knows `mode`. */
export function noteThemeMode(s: ThemeReports, mode: GroundMode): ThemeReports {
  return { ...s, last: mode }
}

/**
 * XTVERSION's answer (#171): `DCS > | name ST`. MEASURED (Claude Code
 * 2.1.296 --model haiku over the bundled ConPTY, xterm 6.0's other replies
 * stood in, one streamed four-paragraph answer, 45 s, 2026-10-11): with no
 * reply Claude logs "XTVERSION: no reply" and `synchronizedOutput=no`, and
 * wraps 0 frames in `?2026` (synchronized output), so a frame can tear
 * mid-draw; with this reply it logs `terminal identified as "PrismTerminal
 * 0.32.0 (xterm.js 6.0.0)"`, `synchronizedOutput=yes (probe: DECRPM 2026
 * status=2)`, and wraps 65 frames (65 `?2026h`, 65 `?2026l`). The name must NOT
 * start with "xterm.js": Claude reads that as VS Code's terminal and applies
 * its VS Code scroll tuning. The emulator IS this core in both apps, so both
 * answer `PrismTerminal <core version>` (spec decision 5).
 */
export function xtversionReply(core: string, xterm: string): string {
  return `${ESC}P>|PrismTerminal ${core} (xterm.js ${xterm})${ST}`
}

/** `CSI > q` and `CSI > 0 q` ask for the version; any other parameter is not
 *  XTVERSION and is left to xterm. */
export function xtversionAsked(params: number[]): boolean {
  return params.length === 0 || (params.length === 1 && params[0] === 0)
}

/** The least time between two bells that reach the host (#177): a `cat` of a
 *  binary file rings hundreds of times, and a taskbar flash per ring is noise. */
export const BELL_GAP_MS = 1000

/** Whether a bell at `now` gets through, given the last one that did (null:
 *  none yet). Per session. */
export function bellGate(last: number | null, now: number): boolean {
  return last === null || now - last >= BELL_GAP_MS
}

/** The look changed: the report to push, only while the program asked for
 *  them and only when the mode differs from what it was last told. */
export function themePush(s: ThemeReports, mode: GroundMode): { send: string | null; state: ThemeReports } {
  if (!s.on || s.last === mode) return { send: null, state: s }
  return { send: dsrThemeReply(mode), state: { ...s, last: mode } }
}

/**
 * THE REDRAW NUDGE (owner, 2026-10-11, choosing "Tiny resize nudge" over
 * sending Ctrl+L or leaving it). Claude Code 2.1.296 hears a theme push and
 * switches its palette, but only redraws its live frame: what it drew before
 * keeps the old colours (measured, the #172 section of the compat spec). A
 * resize makes it redraw everything visible. So after a push PT shrinks the
 * terminal one column and gives it back: a resize, never a key, and only after
 * a push the program itself asked for (?2031h).
 *
 * NUDGE_AFTER_MS leaves the program time to re-query OSC 11 and switch before
 * the redraw it triggers; NUDGE_HOLD_MS is how long the narrower size stands,
 * long enough that ConPTY passes both sizes on rather than only the last.
 */
export const NUDGE_AFTER_MS = 250
export const NUDGE_HOLD_MS = 80

/** The two widths of a nudge, or null when a terminal is too narrow for one. */
export function nudgeWidths(cols: number): [number, number] | null {
  return Number.isInteger(cols) && cols >= 3 ? [cols - 1, cols] : null
}