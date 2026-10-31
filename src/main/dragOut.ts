import { extname, resolve } from 'path'
import {
  nativePaths,
  prefetchPlan,
  validRequest,
  type DragOutRequest,
  type DragOutResult,
  type DragPrepareResult,
  type NativeDragRecord,
  type PlanItem
} from '@shared/dragOut'

/**
 * DRAGGING OUT OF PRISM, MAIN'S HALF (#103; owner, 2026-10-31, D1 to D7).
 *
 * The in-app carry (`internalFileDrag.ts`) owns a drag while the pointer is
 * over the window. When the pointer leaves with the button held, the page
 * asks `drag:out` with the same cargo, and main starts Windows' own drag
 * (`webContents.startDrag`, a `DoDragDrop` loop that returns on release).
 *
 *  - Every path is walled (`readable`: a granted folder or main's own temp)
 *    and must exist (an async stat; main never waits on the disk).
 *  - Archive members are carried as temp copies made on the PRESS
 *    (`prepare`), within 64 MB and 64 members (D5). The page never names a
 *    temp path: main looks its own copies up.
 *  - The icon is the system's file icon (D7), cached per extension and warmed
 *    on the press; the app icon when there is none (an empty icon throws).
 *  - While the drag is in flight every window holds its record
 *    (`drag:native-start` / `drag:native-end`), so a drop back into Prism
 *    knows its own cargo by the paths (see `ownDrop` in the renderer).
 *  - UNDER --e2e THE OS DRAG IS NEVER STARTED, whatever the page asks: a
 *    modal loop nothing releases would hang the run. The request is recorded
 *    in the fake (`e2eDragOut.ts`) and stays in flight until the test ends it.
 */

export interface IconLike {
  isEmpty(): boolean
}

export interface DragItem<I> {
  file: string
  files: string[]
  icon: I
}

/** One member as main resolved it from its place path. */
export interface ResolvedMember {
  /** The innermost container's real file. */
  real: string
  entry: string
  dir: boolean
  /** Bytes (a folder: every file under it, its listed size). */
  size: number
}

export interface DragOutDeps<S, I extends IconLike> {
  e2e: boolean
  readable: (p: unknown) => boolean
  /** Async stat: undefined when missing, else whether it is a folder. */
  kindOf: (p: string) => Promise<'file' | 'dir' | undefined>
  fileIcon: (p: string) => Promise<I | null>
  appIcon: () => I
  startDrag: (sender: S, item: DragItem<I>) => void
  senderId: (sender: S) => number
  broadcast: (channel: 'start' | 'end', payload: NativeDragRecord | { token: number }) => void
  /** Keep temp copies from eviction until a time (ms since epoch). */
  pin: (paths: string[], until: number) => void
  /** The e2e fake records the drag instead. */
  record?: (call: { record: NativeDragRecord; iconEmpty: boolean; file: string }) => void
  now?: () => number
  /** Members: resolve one place path (walled), the container's state, and extract. */
  members?: {
    resolve: (place: string) => Promise<ResolvedMember | null>
    signature: (real: string) => Promise<string | null>
    extractFile: (place: string) => Promise<string | null>
    /** A folder, listed at `size` bytes, into the run's member folder. */
    extractDir: (real: string, entry: string, size: number) => Promise<string | null>
  }
}

/** How long temp copies stay pinned after a drag ends: a browser reads lazily. */
export const PIN_AFTER_MS = 60_000
/** A lag this soon after a drag ended is the drag's own modal loop. */
export const QUIET_AFTER_MS = 1_000

const memberKey = (archive: string, entry: string): string => `${resolve(archive).toLowerCase()}\0${entry}`

export function createDragOut<S, I extends IconLike>(deps: DragOutDeps<S, I>) {
  const now = deps.now ?? Date.now
  let flight: NativeDragRecord | null = null
  let endedAt = -Infinity
  let token = 0
  const icons = new Map<string, I>()
  /** archive + entry to its temp copy, with the container's state it came from. */
  const copies = new Map<string, { sig: string; path: string }>()
  /**
   * A hand-off waiting on its checks, per page. `out` awaits stats and an icon
   * before `startDrag`, and a release in that gap must not start a drag:
   * Chromium's drag source drops at once when the button is already up,
   * wherever the pointer is. The page says so (`cancel`), and `out` looks
   * right before it starts.
   */
  const pending = new Map<number, number>()
  let gen = 0

  const iconKey = (p: string, kind: 'file' | 'dir'): string => {
    if (kind === 'dir') return '<dir>'
    const ext = extname(p).toLowerCase()
    // These carry their own picture: one per file, never per extension.
    return ['.exe', '.lnk', '.ico', '.url', ''].includes(ext) ? p.toLowerCase() : ext
  }
  const iconFor = async (p: string, kind: 'file' | 'dir'): Promise<I> => {
    const key = iconKey(p, kind)
    const hit = icons.get(key)
    if (hit) return hit
    const got = await deps.fileIcon(p).catch(() => null)
    if (got && !got.isEmpty()) {
      icons.set(key, got)
      return got
    }
    return deps.appIcon()
  }

  /** The temp copies of these members made from the container's state `sig`,
   *  or null when any one is not ready (never made, or made from an older zip). */
  const memberPaths = (archive: string, entries: string[], sig: string | null): string[] | null => {
    const map = new Map<string, string>()
    for (const e of entries) {
      const hit = copies.get(memberKey(archive, e))
      if (hit && sig !== null && hit.sig === sig) map.set(e, hit.path)
    }
    return nativePaths(entries, map)
  }
  /** Did a press prepare anything from this archive. The page names it, so it
   *  is stat'ed only when main made copies from it itself. */
  const preparedFrom = (archive: string): boolean => {
    const prefix = memberKey(archive, '')
    for (const k of copies.keys()) if (k.startsWith(prefix)) return true
    return false
  }

  const end = (record: NativeDragRecord): void => {
    if (flight?.token !== record.token) return
    flight = null
    endedAt = now()
    deps.pin(record.paths, now() + PIN_AFTER_MS)
    deps.broadcast('end', { token: record.token })
  }

  /** Start (or, under --e2e, record) the OS drag on checked paths. */
  const start = (sender: S, r: DragOutRequest, paths: string[], icon: I): DragOutResult => {
    const record: NativeDragRecord = {
      token: ++token,
      paths,
      cargo: r.kind === 'files' ? { kind: 'files', paths: r.paths } : { kind: 'members', archive: r.archive, entries: r.entries },
      source: deps.senderId(sender)
    }
    flight = record
    deps.pin(paths, Infinity)
    deps.broadcast('start', record)
    if (deps.e2e) {
      // THE HARD GUARD: never startDrag under --e2e. The test (or the
      // page's release, `cancel`) ends it.
      deps.record?.({ record, iconEmpty: icon.isEmpty(), file: paths[0] })
      return { ok: true, token: record.token }
    }
    try {
      // On Windows this is DoDragDrop: it returns when the button is released.
      deps.startDrag(sender, { file: paths[0], files: paths, icon })
    } catch {
      end(record)
      return { ok: false, reason: 'failed' }
    }
    end(record)
    return { ok: true, token: record.token }
  }

  return {
    /**
     * The press: warm the icon, and extract archive members within the
     * budget. Answers whether the cargo is ready to hand off.
     */
    async prepare(req: unknown): Promise<DragPrepareResult> {
      if (!validRequest(req)) return { ok: false, reason: 'refused' }
      if (req.kind === 'files') {
        if (!req.paths.every((p) => deps.readable(p))) return { ok: false, reason: 'refused' }
        const first = req.paths[0]
        const kind = await deps.kindOf(first)
        if (!kind) return { ok: false, reason: 'failed' }
        await iconFor(first, kind)
        return { ok: true }
      }
      const m = deps.members
      if (!m) return { ok: false, reason: 'refused' }
      const items: Array<ResolvedMember & { place: string }> = []
      for (const [i, place] of req.places.entries()) {
        const r = await m.resolve(place)
        // The place must BE the member the cargo names, in this archive.
        if (!r || resolve(r.real).toLowerCase() !== resolve(req.archive).toLowerCase() || r.entry !== req.entries[i])
          return { ok: false, reason: 'refused' }
        items.push({ ...r, place })
      }
      // Only now, every place resolved inside the wall to this very archive,
      // is the page's archive path stat'ed.
      const sig = await m.signature(req.archive)
      if (!sig) return { ok: false, reason: 'failed' }
      const ready = new Set<string>()
      for (const it of items) {
        const hit = copies.get(memberKey(req.archive, it.entry))
        if (hit && hit.sig === sig && (await deps.kindOf(hit.path))) ready.add(it.entry)
      }
      const plan = prefetchPlan(items as PlanItem[], ready)
      if (!plan) return { ok: false, reason: 'budget' }
      for (const it of items) {
        if (!plan.includes(it.entry)) continue
        const out = await (it.dir ? m.extractDir(it.real, it.entry, it.size) : m.extractFile(it.place)).catch(() => null)
        if (!out) return { ok: false, reason: 'failed' }
        copies.set(memberKey(req.archive, it.entry), { sig, path: out })
      }
      const first = memberPaths(req.archive, req.entries, sig)?.[0]
      if (first) await iconFor(first, items[0].dir ? 'dir' : 'file')
      return { ok: true }
    },

    /** The edge: check the cargo, then start (or, under --e2e, record) the OS drag. */
    async out(sender: S, req: unknown): Promise<DragOutResult> {
      if (flight) return { ok: false, reason: 'busy' }
      if (!validRequest(req)) return { ok: false, reason: 'refused' }
      const r = req as DragOutRequest
      const page = deps.senderId(sender)
      const mine = ++gen
      pending.set(page, mine)
      try {
        let paths: string[] | null
        if (r.kind === 'files') paths = r.paths
        else {
          // A copy made from an older state of the zip is not the member now.
          const m = deps.members
          const sig = m && preparedFrom(r.archive) ? await m.signature(r.archive) : null
          paths = memberPaths(r.archive, r.entries, sig)
        }
        if (!paths) return { ok: false, reason: 'not-ready' }
        if (!paths.every((p) => deps.readable(p))) return { ok: false, reason: 'refused' }
        const kinds = await Promise.all(paths.map((p) => deps.kindOf(p)))
        if (kinds.some((k) => !k)) return { ok: false, reason: 'missing' }
        // Checked again: another request may have started one while this one stat'ed.
        if (flight) return { ok: false, reason: 'busy' }
        const icon = await iconFor(paths[0], kinds[0]!)
        if (flight) return { ok: false, reason: 'busy' }
        // Released while the checks ran: no drag, it would drop at once.
        if (pending.get(page) !== mine) return { ok: false, reason: 'cancelled' }
        pending.delete(page)
        return start(sender, r, paths, icon)
      } finally {
        if (pending.get(page) === mine) pending.delete(page)
      }
    },

    /**
     * The page saw the button come up after it asked for a hand-off. Before
     * `startDrag` this stops the hand-off; once a real drag runs, Windows owns
     * the release and this does nothing. Under --e2e it IS the release that
     * ends the recorded drag.
     */
    cancel(sender: S): void {
      const page = deps.senderId(sender)
      pending.delete(page)
      if (deps.e2e && flight && flight.source === page) end(flight)
    },


    /** The drag in flight, if any. */
    inFlight: (): NativeDragRecord | null => flight,

    /** Under --e2e: end the recorded drag, as a release would. */
    endFake(): void {
      if (flight) end(flight)
    },

    /** Under --e2e: a record for any paths, as if a drag had left a window
     *  (members' cargo too, for a drop back that extracts). */
    startFake(paths: string[], source = -1, cargo?: NativeDragRecord['cargo']): NativeDragRecord | null {
      if (!deps.e2e || flight) return null
      const record: NativeDragRecord = { token: ++token, paths, cargo: cargo ?? { kind: 'files', paths }, source }
      flight = record
      deps.broadcast('start', record)
      return record
    },

    /** The temp copies main holds for drags (the e2e reads them). */
    preparedCopies: (): string[] => [...copies.values()].map((c) => c.path),

    /** A drag is running, or ended moments ago: its modal loop is not a lag. */
    quiet: (): boolean => !!flight || now() - endedAt < QUIET_AFTER_MS
  }
}

export type DragOut = ReturnType<typeof createDragOut>
