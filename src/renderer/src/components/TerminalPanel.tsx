import { useEffect, useRef, type JSX } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { decidePaste } from '../lib/termPaste'
import { readTermTheme, watchTermTheme } from '../lib/termTheme'
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
}

const sessions = new Map<string, Session>()

// One watcher restyles every running shell when the style repaints :root, so
// switching to void turns live terminals black without a respawn. Module
// scope, like the sessions it dresses.
watchTermTheme((t) => {
  for (const s of sessions.values()) s.term.options.theme = t
})

/** Wipe a session's screen and scrollback, back to a bare prompt. The shell
 *  itself is untouched: same process, same cwd, same history. */
export function clearTermSession(id: string): void {
  sessions.get(id)?.term.clear()
}

/** Kill a session's renderer half: the xterm instance and its element. Main's
 *  pty half is killed separately (term:kill) or already exited. */
export function disposeTermSession(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  s.unsub.forEach((u) => u())
  s.term.dispose()
  s.el.remove()
}

function createSession(id: string, root: string, shellId: string | undefined): Session {
  const term = new Terminal({
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true, // unicode11 needs it
    fontFamily: '"Cascadia Mono", Consolas, monospace',
    fontSize: 13,
    // The terminal wears the style: void gets a black terminal, a light style
    // a light one. Live switches are handled by the watcher above.
    theme: readTermTheme()
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

  term.onData((d) => window.prism.termInput(id, d))
  const unsub = [
    window.prism.onTermData((forId, data) => {
      if (forId === id) term.write(data)
    })
    // Exit is App's to handle: it owns the tab's term slot and must hear the
    // exit even while this panel is hidden. App disposes us via
    // disposeTermSession, so nothing is subscribed here.
  ]

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    // Prism's tab-management keys work over a focused shell (no shell uses
    // them): returning false keeps xterm from also feeding bytes to the pty.
    // App's window listener does the actual work.
    if (
      e.ctrlKey &&
      !e.altKey &&
      (e.key === 'Tab' || e.key === 't' || e.key === 'T' || e.key === 'w' || e.key === 'W' || /^[1-9]$/.test(e.key))
    ) {
      return false
    }
    if (e.key === 'Enter' && e.shiftKey) {
      // Newline-without-submit, the continuation form Claude Code accepts
      // everywhere. This is what /terminal-setup exists to configure; here it
      // simply works.
      window.prism.termInput(id, '\\\r')
      return false
    }
    if ((e.key === 'v' || e.key === 'V') && e.ctrlKey && !e.shiftKey) {
      const decision = decidePaste(window.prism.readClipboard())
      // An image forwards the ^V byte: the TUI reads the clipboard itself.
      if (decision.kind === 'key') window.prism.termInput(id, '\x16')
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

  void window.prism.termSpawn(id, root, shellId).then((ok) => {
    if (!ok && sessions.has(id)) {
      term.write('\x1b[31mCould not start the shell.\x1b[0m\r\n')
    }
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
      s.fit.fit()
      window.prism.termResize(sessionId, s.term.cols, s.term.rows)
    }
    refit()
    const ro = new ResizeObserver(refit)
    ro.observe(host)
    return () => {
      ro.disconnect()
      // Detach, don't dispose: the shell runs on unseen.
      if (s.el.parentElement === host) host.removeChild(s.el)
    }
  }, [sessionId, root, shellId])

  return <div ref={box} className="h-full w-full min-h-0 min-w-0 bg-[var(--p-bg)] p-1" />
}
