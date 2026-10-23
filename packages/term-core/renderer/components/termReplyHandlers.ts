import type { Terminal } from '@xterm/xterm'
import {
  THEME_REPORTS_OFF,
  colourQueryReplies,
  decrqmReply,
  dsrThemeReply,
  groundMode,
  modeParams,
  nudgeWidths,
  NUDGE_AFTER_MS,
  NUDGE_HOLD_MS,
  noteThemeMode,
  themePush,
  themeReports,
  xtversionAsked,
  xtversionReply,
  type GroundMode
} from '../lib/termReplies'
import { TERM_CORE_VERSION, XTERM_VERSION } from '../../shared/termVersion'
import { OSC52_MAX, parseOsc52 } from '../lib/termOsc52'

/** What the replies need of their session: everything else is xterm's. */
export interface ReplyDeps {
  /** The colours the program really sits on (the panel's ground, rule 14). */
  ground: () => { foreground: string; background: string }
  /** The session's element: hidden (no size), a redraw nudge waits. */
  el: HTMLElement
  /** Resize the session to `cols` for a moment, telling the pty; then refit
   *  it, unless the session has gone or been replaced meanwhile. */
  nudge: (cols: number) => (() => void) | null
  /** A program's OSC 52 copy, through main; resolves whether it landed. */
  copy: (text: string) => Promise<boolean> | undefined
  /** The "Copied" badge. */
  copied: () => void
}

export interface Replies {
  /** The ground changed: tell a program that asked for theme reports. */
  tellTheme: (mode: GroundMode) => void
  /** The program that asked for reports has gone with them. */
  forget: () => void
  dispose: () => void
}

/**
 * THE PROGRAM IS TOLD THE GROUND IT REALLY SITS ON (#168, #172; rule
 * replies-only-when-asked). Moved out of TerminalPanel's createSession (audit
 * 2026-10-12) as one piece: everything a program can ASK the terminal about
 * itself and get an answer to. MEASURED (Claude Code 2.1.296): xterm answered
 * `ESC]11;?` as rgb:0000/0000/0000, read off the clear canvas the panel paints
 * behind (rule 14), so Claude's "auto" theme was dark on Fawn too. Claude
 * writes ?2031h without a DECRQM probe, and on a pushed ?997;2n asks OSC 11
 * again and turns light. Every reply goes through term.input(.., false):
 * onData, in stream order with xterm's own replies (a DA1 right after stays
 * after), and starting with ESC so `looksTyped` never counts it as typing.
 * Anything these do not answer returns false and stays xterm's.
 */
export function attachReplies(term: Terminal, d: ReplyDeps): Replies {
  // Whether the program in front asked for theme reports (?2031h).
  let reports = THEME_REPORTS_OFF
  const reply = (r: string): void => term.input(r, false)
  const modeNow = (): GroundMode => groundMode(d.ground().background)
  const colourQuery =
    (ident: 10 | 11) =>
    (data: string): boolean => {
      const theme = d.ground()
      const replies = colourQueryReplies(ident, data, { fg: theme.foreground, bg: theme.background })
      if (!replies) return false
      replies.forEach(reply)
      // An answered ground tells the program the mode: no push for it later.
      if (ident === 11 || replies.length > 1) reports = noteThemeMode(reports, groundMode(theme.background))
      return true
    }
  term.parser.registerOscHandler(10, colourQuery(10))
  term.parser.registerOscHandler(11, colourQuery(11))
  // ?2031h / ?2031l, followed from the stream. False: xterm still applies
  // whatever other modes ride the same sequence.
  const trackReports =
    (on: boolean) =>
    (params: (number | number[])[]): boolean => {
      if (modeParams(params).includes(2031)) reports = themeReports(reports, on, modeNow())
      return false
    }
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, trackReports(true))
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, trackReports(false))
  // RIS (ESC c) resets every mode, this one too. False: xterm still resets.
  term.parser.registerEscHandler({ final: 'c' }, () => {
    reports = THEME_REPORTS_OFF
    return false
  })
  // CSI ? 996 n: "which are you now?" xterm keeps every other DSR.
  term.parser.registerCsiHandler({ prefix: '?', final: 'n' }, (params) => {
    const p = modeParams(params)
    if (p.length !== 1 || p[0] !== 996) return false
    const mode = modeNow()
    reply(dsrThemeReply(mode))
    reports = noteThemeMode(reports, mode)
    return true
  })
  // DECRQM for 2031, which xterm 6.0 does not know (it would say 0, "not
  // recognised"); every other mode stays xterm's to report.
  term.parser.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, (params) => {
    const p = modeParams(params)
    if (p.length !== 1 || p[0] !== 2031) return false
    reply(decrqmReply(2031, reports.on))
    return true
  })
  // The redraw nudge after a push (termReplies.ts says why): one column less,
  // then a refit back, through the panel's own resize path so xterm and the pty
  // agree. Several switches in a row give one nudge. The theme is switched in
  // Settings, so the program's tab is usually HIDDEN then (no size): the nudge
  // waits until the tab is shown again, since showing it refits to the same
  // size, which tells the program nothing.
  let nudge: number | undefined
  let disposed = false
  const nudgeWhenShown = (): void => {
    // A session disposed while its nudge waited: nothing to nudge, no retry.
    if (disposed) return
    if (!d.el.clientWidth || !d.el.clientHeight) {
      nudge = window.setTimeout(nudgeWhenShown, NUDGE_AFTER_MS)
      return
    }
    const w = nudgeWidths(term.cols)
    if (!w) return
    const back = d.nudge(w[0])
    if (back) nudge = window.setTimeout(back, NUDGE_HOLD_MS)
  }
  const tellTheme = (mode: GroundMode): void => {
    const r = themePush(reports, mode)
    reports = r.state
    if (!r.send) return
    reply(r.send)
    window.clearTimeout(nudge)
    nudge = window.setTimeout(nudgeWhenShown, NUDGE_AFTER_MS)
  }
  // XTVERSION, `CSI > q` / `CSI > 0 q` (#171; termReplies.ts has the
  // measurement): xterm 6.0.0 has no handler, and without a reply Claude never
  // turns on synchronized output. Any other parameter stays xterm's.
  term.parser.registerCsiHandler({ prefix: '>', final: 'q' }, (params) => {
    if (!xtversionAsked(modeParams(params))) return false
    reply(xtversionReply(TERM_CORE_VERSION, XTERM_VERSION))
    return true
  })
  // OSC 52, WRITE-ONLY (#176; termOsc52.ts says why). Every OSC 52 is handled
  // (true), written or refused, so none is drawn as stray text; a READ is
  // swallowed and NEVER answered. A copy goes through main (a background tab
  // or an unfocused window still copies) and raises the Copied badge only when
  // it landed, so a program's copy is never silent.
  term.parser.registerOscHandler(52, (data) => {
    const p = parseOsc52(data, OSC52_MAX)
    if (p?.kind === 'write') {
      void d
        .copy(p.text)
        ?.then((ok) => {
          if (ok) d.copied()
        })
        .catch(() => undefined)
    }
    return true
  })
  return {
    tellTheme,
    forget: () => {
      reports = THEME_REPORTS_OFF
    },
    dispose: () => {
      disposed = true
      window.clearTimeout(nudge)
    }
  }
}
