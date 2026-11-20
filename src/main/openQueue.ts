import type { BrowserWindow } from 'electron'
import { PUSH } from '@shared/channels'
import type { OpenPayload } from '@shared/types'
import { dirname } from 'path'
import type { WindowRegistry } from './windowRegistry'

/** A file or folder from outside Prism that waits for a window to open it. */
export interface PendingOpen {
  path: string
  dir: boolean
}

export interface OpenQueueDeps {
  windows: Pick<WindowRegistry<BrowserWindow>, 'sendTo' | 'target'>
  exists: (path: string) => Promise<boolean>
}

/**
 * THE FILES FROM OUTSIDE THAT WAIT FOR A WINDOW (#538 item 6; launch routing
 * out of index.ts). Files from outside wait for the window they go to (the
 * one focused last, `windows.target()`) to restore. Only that window drains
 * it: at the end of its restore, when it gains the focus having restored (the
 * window they waited for may have lost it meanwhile, review 2026-10-29), and
 * before a later handoff's files, so arrival order holds.
 */
export function createOpenQueue(deps: OpenQueueDeps): {
  /** How many files wait. */
  waiting: () => number
  /** Queue files behind the ones already waiting. */
  push: (...items: PendingOpen[]) => void
  /** Replace the queue (the launch's own files). */
  set: (items: PendingOpen[]) => void
  sendOpen: (target: PendingOpen, to: BrowserWindow | null) => Promise<void>
  drainPending: (win: BrowserWindow, live?: () => boolean) => Promise<void>
} {
  const { windows, exists } = deps
  let pendingOpen: PendingOpen[] = []

  async function sendOpen(target: PendingOpen, to: BrowserWindow | null): Promise<void> {
    // A FILE from outside goes to the Explorer tab (owner, 2026-09-22: "that file
    // opened in prism's explorer rather than as a project"). Nothing is built for
    // it: the Explorer grants its own folders per tab as it walks there. Same
    // channel as everything else, so it keeps its place behind the restore.
    if (!target.dir) {
      const explorerFile: OpenPayload = { explorerFile: target.path, files: [], index: -1, root: dirname(target.path) }
      windows.sendTo(to, PUSH.openFile, explorerFile)
      return
    }
    // A FOLDER opens an Explorer tab at it (owner, 2026-10-26: no more projects).
    // Nothing is built for it either; the page makes the tab and grants the folder.
    if (!(await exists(target.path))) return
    const explorerFolder: OpenPayload = { explorerFolder: target.path, files: [], index: -1, root: target.path }
    windows.sendTo(to, PUSH.openFile, explorerFolder)
  }

  /** One drain at a time: a focus, a restore's end and a handoff can each ask
   *  at once, and two loops shifting the queue could reorder the opens. */
  let draining: Promise<void> = Promise.resolve()
  /** The waiting files, to `win`, while it is still the window they go to. */
  function drainPending(win: BrowserWindow, live: () => boolean = () => true): Promise<void> {
    const run = draining.then(async () => {
      while (pendingOpen.length && live() && !win.isDestroyed() && windows.target()?.win === win)
        await sendOpen(pendingOpen.shift()!, win)
    })
    draining = run.catch(() => {})
    return run
  }

  return {
    waiting: () => pendingOpen.length,
    push: (...items) => void pendingOpen.push(...items),
    set: (items) => {
      pendingOpen = items
    },
    sendOpen,
    drainPending
  }
}