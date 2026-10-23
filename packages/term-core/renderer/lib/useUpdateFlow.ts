import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { UpdateInfo } from '../../shared/updateTypes'
import { NO_UPDATE, updateFlow, type UpdateFlow } from './updateFlow'
import { crumb } from './diag'

// The update chip and its window, wired to a host (#28). The rules are
// `updateFlow`'s; this is only the plumbing both apps would otherwise write
// twice: listen for the offer and the progress, run the install, clear the
// line under the chip after a while.
//
// THE BRIDGE IS HANDED IN, as everything a host owns is (core/README.md): the
// core never reads `window.prism`. Both apps' preloads already spell these
// members the same way, so each passes its own bridge object as it is.

/** The members of a host's preload this needs. */
export interface UpdateBridge {
  /** Subscribe to the offer; returns the unsubscribe. */
  onUpdate(cb: (info: UpdateInfo) => void): () => void
  /** Subscribe to the download percentage; returns the unsubscribe. */
  onUpdateProgress(cb: (pct: number) => void): () => void
  /** Download and hand off. Resolves false when nothing was installed; on
   *  success the app quits under the installer and this never matters. */
  installUpdate(url: string): Promise<boolean>
  /**
   * Stop the download that `installUpdate` is running (#32). `installUpdate`
   * then resolves false, which is how the page hears it stopped. OPTIONAL: a
   * host that cannot stop one leaves it out, and the window's Cancel is then
   * disabled for the length of the install rather than being a button that lies.
   */
  cancelUpdate?(): void
}

/**
 * What a host wants settled BEFORE an install starts, because a real install
 * ends in the app quitting: this app asks about an agent that is mid-answer,
 * Prism asks about unsaved text as well. It is given `start` and calls it if
 * and when the answer is yes; never calling it is the cancel.
 */
export type InstallGuard = (start: () => void) => void

/** How long the line under the chip stays if nobody dismisses it. */
const NOTICE_MS = 8000

export interface UpdateFlowHandle {
  state: UpdateFlow
  /** The chip was clicked. */
  open: () => void
  /** Cancel or Close, Escape, a press outside. Does nothing mid-install. */
  cancel: () => void
  /** Install was chosen in the window. */
  install: () => void
  /** Cancel was pressed during the download. Undefined when the host's bridge
   *  cannot stop one, which is what the window reads to disable the button. */
  abort: (() => void) | undefined
  dismissNotice: () => void
}

/**
 * `covered`: something that OUTRANKS the update window is on screen (a close
 * question, in both apps). The window is hidden for as long as that is true,
 * mid-install included, and a running install's window comes back afterwards.
 * It is the one way the window leaves during an install, and it is the host's,
 * never the user's: a question about losing work mounted UNDER a window that
 * cannot be closed would take the focus where nobody can see it.
 */
export function useUpdateFlow(
  bridge: UpdateBridge,
  guard?: InstallGuard,
  covered = false
): UpdateFlowHandle {
  const [state, dispatch] = useReducer(updateFlow, NO_UPDATE)
  // The latest of both, for callbacks that must stay stable.
  const live = useRef({ state, guard })
  useEffect(() => {
    live.current = { state, guard }
  })

  useEffect(() => bridge.onUpdate((info) => dispatch({ type: 'available', info })), [bridge])
  useEffect(() => bridge.onUpdateProgress((pct) => dispatch({ type: 'progress', pct })), [bridge])

  const running = state.phase !== 'idle'
  useEffect(() => {
    if (covered) dispatch({ type: 'hide' })
    else if (running) dispatch({ type: 'open' })
    // `state.open` is a dependency on purpose: an install that STARTS while the
    // question is still on its way out opens the window, and this puts it away
    // again until the question has gone.
  }, [covered, running, state.open])

  // The line under the chip only: with the window up, the ending is said IN it
  // and stays until the window is closed.
  const loose = state.notice !== null && !state.open
  useEffect(() => {
    if (!loose) return
    const t = setTimeout(() => dispatch({ type: 'dismiss' }), NOTICE_MS)
    return () => clearTimeout(t)
  }, [loose])

  const open = useCallback(() => {
    crumb('update-open')
    dispatch({ type: 'open' })
  }, [])
  const cancel = useCallback(() => dispatch({ type: 'cancel' }), [])
  const dismissNotice = useCallback(() => dispatch({ type: 'dismiss' }), [])

  const install = useCallback(() => {
    const { state: s, guard: g } = live.current
    const info = s.info
    if (!info || s.phase !== 'idle') return
    const start = (): void => {
      crumb('update-install', { version: info.version, preview: !!info.mock })
      dispatch({ type: 'install' })
      void bridge.installUpdate(info.url).then(
        (ok) => dispatch({ type: 'settled', ok }),
        () => dispatch({ type: 'settled', ok: false })
      )
    }
    // A PREVIEW ASKS NOTHING. The host's question is "this will close the app
    // and end what your agent is doing", and a preview closes nothing: asking
    // it there would be the app lying to make a demo look real.
    if (info.mock || !g) return start()
    // The host's own question must not be asked from behind the window, so the
    // window steps aside for it. `install` brings it back as the progress
    // window if the answer is yes; a no leaves it closed, as Cancel would.
    dispatch({ type: 'hide' })
    g(start)
  }, [bridge])

  const canAbort = typeof bridge.cancelUpdate === 'function'
  const abort = useCallback(() => {
    if (live.current.state.phase !== 'downloading') return
    dispatch({ type: 'abort' })
    bridge.cancelUpdate?.()
  }, [bridge])

  return { state, open, cancel, install, abort: canAbort ? abort : undefined, dismissNotice }
}
