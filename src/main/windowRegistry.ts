import type { SavedTabs } from './tabs'

/**
 * EVERY PRISM WINDOW IN THIS PROCESS (tab tear-off step 1, 2026-10-29; spec
 * docs/superpowers/specs/2026-10-29-tab-tearoff-design.md section 2). Prism
 * was one window per process, and main held it as `appState.mainWindow`:
 * every push went to it, every window control acted on it, and a second
 * window's page counted as foreign. This is the registry that replaces it.
 *
 * Pure (Electron's types only, through the narrow `PageWindow` below), so the
 * routing rules are unit tested with fakes (`windowRegistry.test.ts`):
 *
 * - A push goes to the SENDER (a reply, a progress stream), to the window that
 *   OWNS a tab (a listing's details), or to EVERY window (an update offer, a
 *   preference). A send to a page that has gone is dropped, never thrown.
 * - "The window files from outside go to" is the one focused last; a window
 *   never focused (the e2e's are unfocusable) counts as older than any that
 *   was, and among those the oldest wins, so one window behaves as before.
 * - Each window carries its own unsaved-text flag, its own restore state and
 *   generation, and the strip it last reported.
 */

/** What the registry needs of a BrowserWindow. */
export interface PageWindow {
  isDestroyed(): boolean
  webContents: PageContents
}
export interface PageContents {
  readonly id: number
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

/** Where a window's first tabs come from. Only the session's FIRST window is
 *  made with `saved`, which is the only route to the saved strip on disk: a
 *  test, torn-off or Win+E window cannot read it by mistake (the skeptic's
 *  `coldRestoreDone` trap, 2026-10-29). */
export type WindowSeed = { kind: 'saved' } | { kind: 'tabs'; tabs: SavedTabs } | { kind: 'none' }

export interface WindowRecord<W extends PageWindow = PageWindow> {
  readonly win: W
  /** The page's webContents id: what every IPC sender is matched on. */
  readonly id: number
  /** A serial for the window's life in this process (`w1`, `w2`, ...): the
   *  prefix of the tab ids its page mints, so ids never collide across windows. */
  readonly key: string
  /** The session's first window: the one that answers a cold-start Win+E. A
   *  crash rebuild of it is first too. */
  readonly first: boolean
  /** The renderer flags it was made with (`--prism-setup`, `--prism-demo`):
   *  the first window's only, carried by its crash rebuild. */
  readonly launchFlags: readonly string[]
  /** What its page restores when it first listens (and after a reload, when
   *  it never reported a strip of its own). */
  seed: WindowSeed
  /** The strip its page reported last (`tabs:changed`). */
  reported: SavedTabs | null
  /** Its editor holds unsaved text. */
  dirty: boolean
  /** The unsaved-text question was answered for THIS window: its close goes through. */
  closeConfirmed: boolean
  /** Bumped by every main-frame load: a restore from an older page stops. */
  gen: number
  restoreStarted: boolean
  restored: boolean
  /** Order of focus (0: never focused). */
  focusedAt: number
  /** Being replaced by a crash rebuild: its close releases nothing. */
  rebuilding: boolean
}

export interface AddOptions {
  /** The window's key, when it had to be known before the window was built
   *  (it rides in the page's own argv). */
  key?: string
  first?: boolean
  seed?: WindowSeed
  launchFlags?: readonly string[]
}

export interface WindowRegistry<W extends PageWindow = PageWindow> {
  add(win: W, options?: AddOptions): WindowRecord<W>
  /** Forget a window; answers the tab ids it held (to release, unless mid-move). */
  remove(win: W): string[]
  all(): Array<WindowRecord<W>>
  count(): number
  /** The record of a sender (a top-level Prism page), or undefined. */
  of(sender: { id: number } | null | undefined): WindowRecord<W> | undefined
  recordOf(win: W): WindowRecord<W> | undefined
  /** The window a sender belongs to, when it is a registered Prism page. */
  windowOf(sender: { id: number } | null | undefined): W | null
  isPrismPage(sender: { id: number } | null | undefined): boolean
  focused(win: W): void
  /** Where files from outside go: the window focused last (else the oldest). */
  target(): WindowRecord<W> | undefined
  /** The oldest live window (the e2e's "main" window). */
  oldest(): WindowRecord<W> | undefined
  /** Guarded sends. */
  sendTo(
    to: W | WindowRecord<W> | PageContents | null | undefined,
    channel: string,
    ...args: unknown[]
  ): boolean
  sendToAll(channel: string, ...args: unknown[]): number
  /** To the window whose page asked for this tab last (else the one that
   *  reported it, else every window: a push nobody hears is a frozen tab). */
  sendToTabOwner(tabId: string, channel: string, ...args: unknown[]): void
  noteTabOwner(tabId: string, sender: { id: number }): void
  ownerOf(tabId: string): WindowRecord<W> | undefined
  /** A crash rebuild: the new window takes over the old one's tabs. */
  handOver(from: W, to: W): void
  anyDirty(): boolean
  /** Tab tear-off (step 3): a tab in flight between windows keeps its main
   *  state when the window it leaves closes. Unused until then. */
  markMoving(tabId: string): void
  unmarkMoving(tabId: string): void
  isMoving(tabId: string): boolean
}

const contentsOf = <W extends PageWindow>(
  to: W | WindowRecord<W> | PageContents | null | undefined
): PageContents | null => {
  if (!to) return null
  if ('win' in to) return to.win.isDestroyed() ? null : to.win.webContents
  if ('webContents' in to) return to.isDestroyed() ? null : to.webContents
  return to
}

export function createWindowRegistry<W extends PageWindow = PageWindow>(): WindowRegistry<W> {
  const records = new Map<number, WindowRecord<W>>()
  /** The window whose page last asked for each tab (by webContents id). */
  const owners = new Map<string, number>()
  const moving = new Set<string>()
  let serial = 0
  let focusSeq = 0

  const live = (r: WindowRecord<W>): boolean =>
    !r.win.isDestroyed() && !r.win.webContents.isDestroyed()
  const send = (wc: PageContents | null, channel: string, args: unknown[]): boolean => {
    if (!wc || wc.isDestroyed()) return false
    try {
      wc.send(channel, ...args)
      return true
    } catch {
      return false // a page that went between the check and the send
    }
  }
  const tabIdsOf = (r: WindowRecord<W>): string[] => {
    const ids = new Set<string>()
    for (const t of r.reported?.tabs ?? []) if (t.id) ids.add(t.id)
    for (const [tab, owner] of owners) if (owner === r.id) ids.add(tab)
    return [...ids]
  }

  const registry: WindowRegistry<W> = {
    add(win, options = {}) {
      serial += 1
      const record: WindowRecord<W> = {
        win,
        id: win.webContents.id,
        key: options.key ?? `w${serial}`,
        first: !!options.first,
        launchFlags: options.launchFlags ?? [],
        seed: options.seed ?? { kind: 'none' },
        reported: null,
        dirty: false,
        closeConfirmed: false,
        gen: 0,
        restoreStarted: false,
        restored: false,
        focusedAt: 0,
        rebuilding: false
      }
      records.set(record.id, record)
      return record
    },
    remove(win) {
      const r = registry.recordOf(win)
      if (!r) return []
      const ids = tabIdsOf(r)
      records.delete(r.id)
      for (const [tab, owner] of owners) if (owner === r.id) owners.delete(tab)
      return r.rebuilding ? [] : ids.filter((id) => !moving.has(id))
    },
    all: () => [...records.values()].filter(live),
    count: () => registry.all().length,
    of: (sender) => (sender ? records.get(sender.id) : undefined),
    recordOf: (win) => {
      for (const r of records.values()) if (r.win === win) return r
      return undefined
    },
    windowOf: (sender) => {
      const r = registry.of(sender)
      return r && live(r) ? r.win : null
    },
    isPrismPage: (sender) => !!registry.windowOf(sender),
    focused(win) {
      const r = registry.recordOf(win)
      if (r) r.focusedAt = ++focusSeq
    },
    target() {
      let best: WindowRecord<W> | undefined
      for (const r of registry.all()) if (!best || r.focusedAt > best.focusedAt) best = r // insertion order: the oldest wins a tie
      return best
    },
    oldest: () => registry.all()[0],
    sendTo: (to, channel, ...args) => send(contentsOf(to), channel, args),
    sendToAll(channel, ...args) {
      let n = 0
      for (const r of registry.all()) if (send(r.win.webContents, channel, args)) n += 1
      return n
    },
    sendToTabOwner(tabId, channel, ...args) {
      const owner = registry.ownerOf(tabId)
      if (owner && send(owner.win.webContents, channel, args)) return
      registry.sendToAll(channel, ...args)
    },
    noteTabOwner(tabId, sender) {
      if (typeof tabId === 'string' && tabId && records.has(sender.id)) owners.set(tabId, sender.id)
    },
    ownerOf(tabId) {
      const id = owners.get(tabId)
      const r = id === undefined ? undefined : records.get(id)
      if (r && live(r)) return r
      return registry.all().find((x) => x.reported?.tabs.some((t) => t.id === tabId))
    },
    handOver(from, to) {
      const a = registry.recordOf(from)
      const b = registry.recordOf(to)
      if (!a || !b) return
      a.rebuilding = true
      for (const [tab, owner] of owners) if (owner === a.id) owners.set(tab, b.id)
      b.focusedAt = a.focusedAt
    },
    anyDirty: () => registry.all().some((r) => r.dirty),
    markMoving: (tabId) => void moving.add(tabId),
    unmarkMoving: (tabId) => void moving.delete(tabId),
    isMoving: (tabId) => moving.has(tabId)
  }
  return registry
}
