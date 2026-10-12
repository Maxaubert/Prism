import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import type { DetectedAgent } from 'prism-term-core/shared/types'
import { holdsWindowClose } from 'prism-term-core/renderer/lib/agentClose'
import { workingFor } from 'prism-term-core/renderer/lib/agentClock'
import { useUpdateFlow, type UpdateFlowHandle } from 'prism-term-core/renderer/lib/useUpdateFlow'
import { baseName } from '@shared/path'
import type { Ask } from '../dialogs/asks'
import type { Tab } from '../lib/tabs/tabs'

// Leaving the window: main's "may I close?", the agent that holds it, and the
// update install that ends in a quit. Out of App.tsx (structure cleanup,
// 2026-10-12), unchanged. App draws the questions it raises (AskDialogs).

export interface WindowCloseDeps {
  workingIds: ReadonlySet<string>
  tabs: Tab[]
  setAsk: Dispatch<SetStateAction<Ask | null>>
  agentKinds: RefObject<Map<string, DetectedAgent>>
  dirtyPaths: ReadonlySet<string>
  ask: Ask | null
}

export interface WindowClose {
  update: UpdateFlowHandle
  leave: (then?: 'install') => void
  runInstall: () => void
}

export function useWindowClose({
  workingIds,
  tabs,
  setAsk,
  agentKinds,
  dirtyPaths,
  ask
}: WindowCloseDeps): WindowClose {
  // Main held the window open because the editor is dirty; ask, then answer it.
  const askClose = useRef<() => void>(() => {})
  useEffect(() => window.prism.onAskClose(() => askClose.current()), [])
  /**
   * What STARTS the install once every question has been answered. It is the
   * core's (`useUpdateFlow` hands it to the guard below: it moves the chip to
   * "downloading" and calls the bridge); Prism only decides WHEN it may run.
   * Held in a ref because the questions are asked through `ask`, which carries
   * `then: 'install'` and not a function, as it always has.
   */
  const installStart = useRef<(() => void) | null>(null)
  const runInstall = useCallback(() => {
    const start = installStart.current
    installStart.current = null
    start?.()
  }, [])
  /**
   * LEAVING THE APP - closing the window, or the quit an update install ends
   * in - once unsaved text has been settled. prism-term-core's rule, the same
   * in Prism Terminal (owner, 2026-09-19): the window is held only while an
   * agent is MID-ANSWER, since an idle one comes back at the next launch.
   */
  const leave = useCallback(
    (then?: 'install') => {
      const busy = [...workingIds]
      if (!holdsWindowClose(busy.length)) {
        if (then === 'install') runInstall()
        else window.prism.close(true)
        return
      }
      const root = tabs.find((t) => t.terms.includes(busy[0]))?.root ?? ''
      setAsk({
        kind: 'close-window-agent',
        label: baseName(root),
        agent: { kind: agentKinds.current.get(busy[0]) ?? 'other', forMs: workingFor(busy[0]) },
        others: busy.length - 1,
        then
      })
    },
    [agentKinds, runInstall, setAsk, tabs, workingIds]
  )
  useEffect(() => {
    askClose.current = () => (dirtyPaths.size ? setAsk({ kind: 'close-dirty' }) : leave())
  }, [dirtyPaths, leave, setAsk])
  // Main holds every route out of the window while this is true.
  useEffect(() => window.prism.setAgentBusy(holdsWindowClose(workingIds.size)), [workingIds])
  /**
   * THE UPDATE CHIP AND ITS WINDOW (#168). Both are prism-term-core's, the
   * same in Prism Terminal (owner, 2026-09-19: "yes keep the core"): a click on
   * the chip opens a window with the release's notes, and Install in that
   * window comes HERE before anything is downloaded. What is Prism's is this
   * guard, and it is the path the chip's click used to take, unchanged:
   * installing ends in a quit, and unsaved text vetoes a quit, so the same
   * question closing asks is asked first (2026-08-28; main refuses the install
   * outright while anything is dirty), and then `leave` asks about an agent
   * that is mid-answer. Never calling `start` is the cancel. A PREVIEW never
   * gets here: the core starts its fake install unguarded, because it closes
   * nothing and asking "discard your changes?" for a demo would be the app
   * lying to make it look real.
   */
  const installGuard = useCallback(
    (start: () => void) => {
      installStart.current = start
      if (dirtyPaths.size) setAsk({ kind: 'close-dirty', then: 'install' })
      else leave('install')
    },
    [dirtyPaths, leave, setAsk]
  )
  // ONE QUESTION AT A TIME, Prism Terminal's finding and the same here: the
  // app's chords still work while the update window is up (Ctrl+W, Alt+F4), and
  // a question raised from behind it mounts UNDER it (same z-index, earlier in
  // the document) and takes the focus onto its primary button where nobody can
  // see it, so Enter, pressed at what looks like Install, answers the hidden
  // question instead. A question about losing work outranks a list of patch
  // notes, so the window gives way. That is the core's `covered` since #178:
  // it holds mid-install too, where the user cannot close the window (it stays
  // up and draws the progress, owner 2026-09-20), and a running install's
  // window comes back once the question has been answered.
  const update = useUpdateFlow(window.prism, installGuard, !!ask)
  return { update, leave, runInstall }
}
