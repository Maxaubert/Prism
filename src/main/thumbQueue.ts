/**
 * The desktop's queue in front of Thumbs (Stage 2 of the zoom grid, 2026-11-09).
 *
 * A folder of ten thousand pictures must never stall the app or the disk, so
 * the page asks only for what is on screen and a little beyond, and this
 * queue decides when each one is made:
 *
 * - In the order the tab asked (the page sends nearest the viewport centre
 *   first, then the page ahead). A new `want` from a tab REPLACES that tab's
 *   waiting list, so the queue is never longer than about two screens; what is
 *   already running finishes (it is under a second and is cached for next time).
 * - Only `share()` ffmpegs at once: 3 of the 4 Thumbs allows, so a phone
 *   browsing in the same minute is never starved; 1 on a machine of 4 cores or
 *   fewer, and 1 while a film plays (the pool a playing film reads through).
 * - One job per file and tier across tabs; every tab that wants it is told.
 * - Tabs take turns, so a long list in one does not starve the others.
 * - A running job nobody wants any more is killed only once it has run over
 *   1.5 s (a 4K HEVC film), because killing and restarting a quick one would
 *   cost more than letting it end.
 *
 * Pure scheduling: `make` is Thumbs.makeFor, `settled` is where the answer
 * goes. No fs, no process, no Electron.
 */
import type { ThumbTier } from '@shared/thumbTypes'

export interface QueueItem {
  path: string
  tier: ThumbTier
}

export interface QueueDeps {
  /** Make one picture; the file made, or null for none. `signal` kills it. */
  make: (path: string, tier: ThumbTier, signal: AbortSignal) => Promise<string | null>
  /** How many may run now. */
  share: () => number
  /** A job finished for a tab that still wanted it. */
  settled: (tab: string, gen: number, path: string, tier: ThumbTier, file: string | null) => void
  /** A running job nobody wants is killed after this long (default 1500). */
  orphanKillMs?: number
}

/** The desktop's share of Thumbs' four ffmpeg slots. */
export function desktopShare(o: { cores: number; filmPlaying: boolean }): number {
  return o.cores <= 4 || o.filmPlaying ? 1 : 3
}

interface Job {
  key: string
  path: string
  tier: ThumbTier
  /** tab -> the generation it last asked under. */
  waiters: Map<string, number>
  running: boolean
  startedAt: number
  abort: AbortController
  timer: ReturnType<typeof setTimeout> | null
}

export class ThumbQueue {
  private readonly jobs = new Map<string, Job>()
  /** Each tab's waiting order: job keys. */
  private readonly order = new Map<string, string[]>()
  private running = 0
  /** The tab served last, so the next job comes from the one after it. */
  private lastTab: string | null = null

  constructor(private readonly deps: QueueDeps) {}

  stats(): { running: number; queued: number } {
    let queued = 0
    for (const j of this.jobs.values()) if (!j.running) queued += 1
    return { running: this.running, queued }
  }

  /** Replace this tab's list. Items still waiting that are not in `items` are
   *  dropped; running ones carry on. */
  want(tab: string, gen: number, items: readonly QueueItem[]): void {
    const next: string[] = []
    const seen = new Set<string>()
    for (const it of items) {
      const key = `${it.tier}|${it.path}`
      if (seen.has(key)) continue
      seen.add(key)
      next.push(key)
      let job = this.jobs.get(key)
      if (!job) {
        job = {
          key,
          path: it.path,
          tier: it.tier,
          waiters: new Map(),
          running: false,
          startedAt: 0,
          abort: new AbortController(),
          timer: null
        }
        this.jobs.set(key, job)
      }
      job.waiters.set(tab, gen)
    }
    for (const key of this.order.get(tab) ?? []) if (!seen.has(key)) this.unwant(key, tab)
    // A running job this tab asked for before, and still wants, is in `seen`;
    // one it no longer lists has just been let go by `unwant` above.
    if (next.length) this.order.set(tab, next)
    else this.order.delete(tab)
    this.pump()
  }

  /** The tab closed, changed folder, was held or left the front. */
  cancel(tab: string): void {
    for (const key of this.order.get(tab) ?? []) this.unwant(key, tab)
    this.order.delete(tab)
    // A job running for the tab that its list no longer holds (replaced
    // earlier) is already let go; this clears the rest.
    for (const job of [...this.jobs.values()]) if (job.waiters.has(tab)) this.unwant(job.key, tab)
  }

  /** The share changed (a film started or stopped): start what now fits. */
  poke(): void {
    this.pump()
  }

  private unwant(key: string, tab: string): void {
    const job = this.jobs.get(key)
    if (!job) return
    job.waiters.delete(tab)
    if (job.waiters.size > 0) return
    if (!job.running) {
      this.jobs.delete(key)
      return
    }
    this.orphan(job)
  }

  /** A running job that nobody waits for: killed now if it has run over the
   *  limit, else when it reaches it (unless someone wants it again by then). */
  private orphan(job: Job): void {
    const limit = this.deps.orphanKillMs ?? 1500
    const age = Date.now() - job.startedAt
    if (age >= limit) {
      job.abort.abort()
      return
    }
    if (job.timer) return
    job.timer = setTimeout(() => {
      job.timer = null
      if (job.running && job.waiters.size === 0) job.abort.abort()
    }, limit - age)
  }

  private pump(): void {
    while (this.running < this.deps.share()) {
      const job = this.next()
      if (!job) return
      this.start(job)
    }
  }

  /** The next waiting job, taking turns between tabs. */
  private next(): Job | null {
    const tabs = [...this.order.keys()]
    if (tabs.length === 0) return null
    const from = this.lastTab === null ? -1 : tabs.indexOf(this.lastTab)
    for (let i = 1; i <= tabs.length; i++) {
      const tab = tabs[(from + i + tabs.length) % tabs.length]
      for (const key of this.order.get(tab) ?? []) {
        const job = this.jobs.get(key)
        if (job && !job.running) {
          this.lastTab = tab
          return job
        }
      }
    }
    return null
  }

  private start(job: Job): void {
    job.running = true
    job.startedAt = Date.now()
    this.running += 1
    let made: Promise<string | null>
    try {
      made = this.deps.make(job.path, job.tier, job.abort.signal)
    } catch {
      made = Promise.resolve(null)
    }
    void made
      .catch(() => null)
      .then((file) => {
        this.running -= 1
        if (job.timer) clearTimeout(job.timer)
        this.jobs.delete(job.key)
        for (const [tab, gen] of job.waiters) {
          this.deps.settled(tab, gen, job.path, job.tier, file)
        }
        // The finished job leaves its tabs' orders on their next want; drop it now.
        for (const [tab, keys] of this.order) {
          if (!keys.includes(job.key)) continue
          const rest = keys.filter((k) => k !== job.key)
          if (rest.length) this.order.set(tab, rest)
          else this.order.delete(tab)
        }
        this.pump()
      })
  }
}
