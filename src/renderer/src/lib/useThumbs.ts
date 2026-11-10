import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ThumbWant, ThumbsReady, ThumbsWantReply } from '@shared/thumbTypes'

// THE PAGE'S HALF OF THE THUMBNAIL ASKS (zoom grid, Stage 3, spec 4.5).
//
// The list tells the feed which pictures are mounted (`visible`, nearest the
// middle first). The feed waits for the list to SETTLE, 120 ms with no change
// in what is mounted, so a fast scroll through a huge folder asks for nothing
// at all, then sends ONE `want` for the pictures it does not know yet. Main
// answers the cache hits in the reply and pushes the rest as they are made.
//
// - A `gen` counter tags every ask; a pushed answer of an older generation is
//   ignored (a newer ask replaced the queue it came from).
// - A path is remembered once answered: a url, or null for "no picture", which
//   is not asked again in this folder until the file changes (its size or date
//   moved: main keys a thumbnail on those, so it is a new picture). A bigger
//   tier than the one held asks again while the smaller picture keeps showing,
//   and so does a changed file.
// - `setActive(false)` (a loading-bar hold, a hidden window, a zoom step with
//   no pictures) cancels what main still has queued and asks for nothing until
//   it is true again.
// - `reset()` is a new folder: the map is cleared and the queue cancelled.
//
// Pure of React so the unit test drives it with fake timers; `useThumbs` is the
// thin hook round it.

export const SETTLE_MS = 120

export interface ThumbsApi {
  want(tab: string, gen: number, items: ThumbWant[]): Promise<ThumbsWantReply>
  cancel(tab: string): void
  onReady(cb: (msg: ThumbsReady) => void): () => void
}

/** One picture the list wants. `stamp` is the file's size and date when known
 *  (they arrive after the name), the page's own: it never goes over the wire. */
export type ThumbAsk = ThumbWant & { stamp?: string }

export interface ThumbFeed {
  /** What is mounted now, nearest the middle first. Cheap to call on every render. */
  visible(items: readonly ThumbAsk[]): void
  /** undefined: not here yet. null: no picture. A string: the fsmedia://thumb url. */
  get(path: string): string | null | undefined
  subscribe(listener: () => void): () => void
  setActive(on: boolean): void
  reset(): void
  dispose(): void
}

interface Held {
  url: string | null
  tier: number
  stamp?: string
}

export function createThumbFeed(api: ThumbsApi, tab: string, settleMs = SETTLE_MS): ThumbFeed {
  const held = new Map<string, Held>()
  const listeners = new Set<() => void>()
  let items: readonly ThumbAsk[] = []
  let signature = ''
  /** A want is out there that nothing has cancelled or replaced. */
  let asked = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let gen = 0
  let active = true
  let off: (() => void) | null = null

  const notify = (): void => {
    for (const l of [...listeners]) l()
  }
  /** A held answer that is about an older version of the file. */
  const outdated = (h: Held | undefined, it: ThumbAsk): boolean =>
    h !== undefined && h.stamp !== undefined && it.stamp !== undefined && h.stamp !== it.stamp
  const unknown = (): ThumbAsk[] =>
    items.filter((it) => {
      const h = held.get(it.path)
      return (h?.tier ?? 0) < it.tier || outdated(h, it)
    })
  const clearTimer = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  /** Stop everything this feed has out: the timer, and main's queue if it was asked.
   *  A feed that never asked sends nothing (a row step below 3 costs no IPC). */
  const drop = (): void => {
    const had = asked || timer !== null
    clearTimer()
    gen += 1
    asked = false
    if (had) api.cancel(tab)
  }
  const ensureListener = (): void => {
    if (off) return
    off = api.onReady((msg) => {
      if (msg.gen !== gen) return
      let changed = false
      for (const r of msg.results) {
        const it = items.find((x) => x.path === r.path)
        held.set(r.path, { url: r.url, tier: it?.tier ?? 320, stamp: it?.stamp })
        changed = true
      }
      if (changed) notify()
    })
  }

  const send = (): void => {
    timer = null
    if (!active) return
    const asks = unknown()
    if (!asks.length) return
    asked = true
    ensureListener()
    const mine = ++gen
    void api
      .want(tab, mine, asks.map(({ path, tier }) => ({ path, tier })))
      .then((reply) => {
        if (mine !== gen) return
        let changed = false
        for (const [path, url] of Object.entries(reply.ready)) {
          const a = asks.find((x) => x.path === path)
          held.set(path, { url, tier: a?.tier ?? 320, stamp: a?.stamp })
          changed = true
        }
        if (changed) notify()
      })
      .catch(() => undefined)
  }

  const schedule = (): void => {
    clearTimer()
    if (!active || !items.length) return
    timer = setTimeout(send, settleMs)
  }

  return {
    visible(next) {
      const sig = next.map((it) => `${it.tier}|${it.path}`).join('\n')
      // The size and date come after the name (statDetails), so the first
      // stamp an answer sees is its baseline, not a change.
      let stale = false
      for (const it of next) {
        const h = held.get(it.path)
        if (!h || it.stamp === undefined) continue
        if (h.stamp === undefined) h.stamp = it.stamp
        else if (outdated(h, it)) stale = true
      }
      if (sig === signature && !stale) {
        items = next
        return
      }
      items = next
      signature = sig
      // Nothing new to ask, or a set already sent: no timer, no churn.
      if (!active) return
      if (!unknown().length) {
        // Everything mounted is known: what main still has queued is for rows scrolled away.
        drop()
        return
      }
      schedule()
    },
    get(path) {
      const h = held.get(path)
      return h === undefined ? undefined : h.url
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setActive(on) {
      if (on === active) return
      active = on
      if (!on) {
        // Whatever is in flight is stale: its answer must not land.
        drop()
        return
      }
      schedule()
    },
    reset() {
      drop()
      held.clear()
      items = []
      signature = ''
      notify()
    },
    dispose() {
      drop()
      listeners.clear()
      off?.()
      off = null
    }
  }
}

/** The feed for one Explorer tab: made once, torn down with the list. `api` is
 *  null where the preload has no thumbs (a test host), and every ask is then dropped. */
export function useThumbFeed(tab: string | undefined): ThumbFeed | null {
  const feed = useMemo(() => {
    const api = typeof window !== 'undefined' ? window.prism?.thumbs : undefined
    return tab && api ? createThumbFeed(api, tab) : null
  }, [tab])
  useEffect(() => () => feed?.dispose(), [feed])
  return feed
}

/** One path's answer, re-rendering only the component that asked when it changes. */
export function useThumbValue(feed: ThumbFeed | null, path: string): string | null | undefined {
  return useSyncExternalStore(
    (cb) => feed?.subscribe(cb) ?? (() => undefined),
    () => feed?.get(path)
  )
}

/** False while the window is hidden or minimised: no thumbnails are made for a
 *  page nobody sees. Focus is not the test (a window behind another is seen). */
export function useDocumentShown(): boolean {
  return useSyncExternalStore(
    (cb) => {
      document.addEventListener('visibilitychange', cb)
      return () => document.removeEventListener('visibilitychange', cb)
    },
    () => document.visibilityState !== 'hidden'
  )
}
