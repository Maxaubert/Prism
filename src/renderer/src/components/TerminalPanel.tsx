import { useEffect, useRef, type JSX } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { decidePaste } from '../lib/termPaste'
import { resolveTermTheme, watchTermTheme } from '../lib/termTheme'
import { onTermLookChange, termAcrylic, termBaseFontPx, termFontStack, termThemeId } from '../lib/termLook'
import { forgetSession, markTouched, suppressActivity, takeResume } from '../lib/termActivity'
import '@xterm/xterm/css/xterm.css'

// The terminal surface. This module is a lazy chunk (xterm is ~350KB the
// launch path never needs) and it owns the SESSION STORE: one live xterm
// instance per shell, each with its own DOM element, living in module scope
// because their lifetime is the shell's, not any component's. Switching tabs
// reattaches an element instead of repainting, which is what keeps scrollback,
// selection and the alternate screen (vim, htop) intact for free.

interface Session {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
  unsub: Array<() => void>
  /** Ctrl+scroll zoom, this session only: never persisted, dies with it. */
  fontOverride?: number
}

const sessions = new Map<string, Session>()

/** The theme as painted: follow-style with the acrylic share on drops its own
 *  canvas colour so the window's material shows through the panel behind it.
 *  Presets keep their opaque colours - their background IS the theme. */
function currentTermTheme(): ReturnType<typeof resolveTermTheme> {
  const theme = { ...resolveTermTheme(termThemeId()) }
  if (termThemeId() === 'style' && termAcrylic()) theme.background = '#00000000'
  return theme
}

/** Refit a session and tell the pty its new geometry. */
function refitSession(id: string, s: Session): void {
  if (!s.el.clientWidth || !s.el.clientHeight) return
  suppressActivity(id)
  s.fit.fit()
  window.prism.termResize(id, s.term.cols, s.term.rows)
}

// One restyler for every running shell, driven by BOTH sources of truth: the
// style repainting :root (the follow-style default) and the Terminal settings
// changing (preset theme, base font size). A session the user Ctrl+scrolled
// keeps its own font; everything else follows the base.
function applyLook(): void {
  const theme = currentTermTheme()
  const base = termBaseFontPx()
  const family = termFontStack()
  for (const [id, s] of sessions) {
    s.term.options.theme = theme
    const want = s.fontOverride ?? base
    const sizeChanged = s.term.options.fontSize !== want
    const familyChanged = s.term.options.fontFamily !== family
    if (sizeChanged) s.term.options.fontSize = want
    if (familyChanged) s.term.options.fontFamily = family
    if (sizeChanged || familyChanged) refitSession(id, s)
  }
}
watchTermTheme(applyLook)
onTermLookChange(applyLook)

/** Ctrl+scroll: zoom THIS session's text, unpersisted. */
function zoomSession(id: string, delta: number): void {
  const s = sessions.get(id)
  if (!s) return
  // Up to ~500% of the stock 13px: the Settings base caps at 200%, the wheel
  // deliberately goes further - a session zoom is a moment, not a layout.
  const next = Math.max(7, Math.min(64, (s.fontOverride ?? termBaseFontPx()) + delta))
  s.fontOverride = next
  s.term.options.fontSize = next
  refitSession(id, s)
}

/** Wipe a session's screen and scrollback, back to a bare prompt. The shell
 *  itself is untouched: same process, same cwd, same history. */
export function clearTermSession(id: string): void {
  sessions.get(id)?.term.clear()
}

/** Spawn a session WITHOUT waiting for its panel: a restored background tab's
 *  Claude session must resume now, not when the tab is first visited. The
 *  xterm lives against its detached element (the same way hidden tabs keep
 *  theirs) and the panel simply attaches it later, scrollback intact. */
export function ensureTermSession(id: string, root: string, shellId: string | undefined): void {
  if (!sessions.has(id)) createSession(id, root, shellId)
}

/** Kill a session's renderer half: the xterm instance and its element. Main's
 *  pty half is killed separately (term:kill) or already exited. */
export function disposeTermSession(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  forgetSession(id)
  s.unsub.forEach((u) => u())
  s.term.dispose()
  s.el.remove()
}

function createSession(id: string, root: string, shellId: string | undefined): Session {
  const term = new Terminal({
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true, // unicode11 needs it
    allowTransparency: true, // the acrylic share paints a see-through canvas
    fontFamily: termFontStack(),
    // The Settings base size; Ctrl+scroll can zoom this one session later.
    fontSize: termBaseFontPx(),
    // Follow-style by default, or the chosen preset. Live switches of either
    // are handled by applyLook above.
    theme: currentTermTheme()
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  // Ink UIs (Claude Code) draw boxes and spinners whose width math assumes
  // Unicode 11 - without this addon the emoji misalign, which is the tell of
  // a terminal that didn't bother.
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  term.loadAddon(new WebLinksAddon((_e, url) => window.prism.openExternal(url)))

  const el = document.createElement('div')
  el.className = 'h-full w-full'
  term.open(el)

  term.onData((d) => {
    markTouched(id) // user input: the reroot policy leaves this shell alone
    window.prism.termInput(id, d)
  })
  // A resuming session shows a quiet spinner until claude's first paint:
  // the ~4s between an empty terminal and the conversation appearing read
  // as broken without one. Claude's own screen setup then paints over it.
  const resume = takeResume(id)
  let spin: ReturnType<typeof setInterval> | null = null
  if (resume) {
    markTouched(id) // a claude session from the first moment
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    let i = 0
    term.write('\x1b[2m⠋ Resuming Claude session…\x1b[0m')
    spin = setInterval(() => {
      term.write(`\r\x1b[2m${frames[(i += 1) % frames.length]} Resuming Claude session…\x1b[0m`)
    }, 120)
  }
  const stopSpin = (): void => {
    if (spin) {
      clearInterval(spin)
      spin = null
      term.write('\r\x1b[2K')
    }
  }
  const unsub = [
    window.prism.onTermData((forId, data) => {
      if (forId === id) {
        stopSpin()
        term.write(data)
      }
    }),
    stopSpin
    // Exit is App's to handle: it owns the tab's term slot and must hear the
    // exit even while this panel is hidden. App disposes us via
    // disposeTermSession, so nothing is subscribed here.
  ]

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    // Ctrl+C over a SELECTION copies it, the way Windows Terminal does; with
    // nothing selected it stays the interrupt every shell expects.
    if ((e.key === 'c' || e.key === 'C') && e.ctrlKey && !e.shiftKey && !e.altKey && term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
      return false
    }
    // Prism's tab-management keys work over a focused shell (no shell uses
    // them): returning false keeps xterm from also feeding bytes to the pty.
    // App's window listener does the actual work.
    if (
      e.ctrlKey &&
      !e.altKey &&
      (e.key === 'Tab' || /^[twb]$/i.test(e.key) || /^[1-9]$/.test(e.key))
    ) {
      return false
    }
    if (e.key === 'Enter' && e.shiftKey) {
      // Newline-without-submit, the continuation form Claude Code accepts
      // everywhere. This is what /terminal-setup exists to configure; here it
      // simply works.
      markTouched(id) // input like any other: its repaint is echo, not work
      window.prism.termInput(id, '\\\r')
      return false
    }
    if ((e.key === 'v' || e.key === 'V') && e.ctrlKey && !e.shiftKey) {
      const decision = decidePaste(window.prism.readClipboard())
      // An image forwards the ^V byte: the TUI reads the clipboard itself.
      if (decision.kind === 'key') {
        markTouched(id)
        window.prism.termInput(id, '\x16')
      }
      else if (decision.kind === 'text') term.paste(decision.data)
      return false
    }
    if ((e.key === 'v' || e.key === 'V') && e.ctrlKey && e.shiftKey) {
      // The escape hatch: plain text paste even when an image rides along.
      const clip = window.prism.readClipboard()
      if (clip.text) term.paste(clip.text)
      return false
    }
    return true
  })

  const session: Session = { term, fit, el, unsub }
  sessions.set(id, session)

  // A session restored over a Claude conversation launches straight into it:
  // the resume id rides the SPAWN (main builds it into the shell's startup
  // command), so nothing is ever visibly typed.
  void window.prism.termSpawn(id, root, shellId, resume ?? undefined).then((ok) => {
    if (!ok && sessions.has(id)) {
      term.write('\x1b[31mCould not start the shell.\x1b[0m\r\n')
      return
    }
    // The spawn is done: re-assert the real size once. The first fit can race
    // a slow spawn, and a static window will never resize on its own.
    if (sessions.has(id)) window.prism.termResize(id, term.cols, term.rows)
  })
  return session
}

/**
 * Mounts (or re-attaches) the session for `sessionId`. Never disposes on
 * unmount: hiding the panel keeps the shell. Disposal is App's, on exit or
 * tab close, through disposeTermSession.
 */
export default function TerminalPanel({
  sessionId,
  root,
  shellId
}: {
  sessionId: string
  root: string
  shellId: string | undefined
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = box.current
    if (!host) return
    const s = sessions.get(sessionId) ?? createSession(sessionId, root, shellId)
    host.appendChild(s.el)
    s.term.focus()
    const refit = (): void => {
      // A hidden or zero-sized panel would fit to nonsense; the observer fires
      // again when it has real bounds.
      if (!host.clientWidth || !host.clientHeight) return
      // The redraw this resize provokes is us, not the shell working.
      suppressActivity(sessionId)
      s.fit.fit()
      window.prism.termResize(sessionId, s.term.cols, s.term.rows)
    }
    refit()
    const ro = new ResizeObserver(refit)
    ro.observe(host)
    // Ctrl+scroll zooms this session's text - unpersisted, the Settings base
    // size is untouched. Non-passive so the browser's own zoom never fires.
    const wheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoomSession(sessionId, e.deltaY < 0 ? 1 : -1)
    }
    host.addEventListener('wheel', wheel, { passive: false })
    return () => {
      ro.disconnect()
      host.removeEventListener('wheel', wheel)
      // Detach, don't dispose: the shell runs on unseen.
      if (s.el.parentElement === host) host.removeChild(s.el)
    }
  }, [sessionId, root, shellId])

  // No background of its own: TermDock already paints --p-bg, and a second
  // translucent coat here stacked into a visibly darker panel than the rest
  // of the window (the acrylic terminal made it obvious).
  return <div ref={box} data-term-region className="h-full w-full min-h-0 min-w-0 p-1" />
}
