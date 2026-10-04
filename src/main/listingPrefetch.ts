/**
 * READ AHEAD (#271; owner-approved recommendation 5, 2026-10-04: "read ahead
 * on hover, local fixed drives only, at most 2 at a time"). A folder the
 * pointer rests on, the parent, the first few subfolders of a small folder and
 * the top Quick access places are read before they are asked for, so the
 * click paints from memory. These are reads nobody asked for, so they are
 * kept small: two at a time, a short queue that drops the oldest asks, and
 * a real navigation cancels everything still waiting (the in-flight two
 * finish; they are a few milliseconds each).
 */
export function createPrefetchQueue<T>({
  run,
  limit = 2,
  maxQueued = 32
}: {
  run: (path: string) => Promise<T>
  limit?: number
  maxQueued?: number
}) {
  const key = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  const queued: Array<{ path: string; resolve: (v: T | null) => void }> = []
  const inFlight = new Map<string, Promise<T | null>>()
  let active = 0

  const pump = (): void => {
    while (active < limit && queued.length) {
      const next = queued.shift()!
      active += 1
      const k = key(next.path)
      const job = run(next.path)
        .catch(() => null)
        .finally(() => {
          active -= 1
          inFlight.delete(k)
          pump()
        })
      inFlight.set(k, job)
      void job.then(next.resolve)
    }
  }

  return {
    /** Ask for one folder. Resolves with what `run` answered, or null when it
     *  was dropped, cancelled or failed. */
    add(path: string): Promise<T | null> {
      const k = key(path)
      const running = inFlight.get(k)
      if (running) return running
      const waiting = queued.find((q) => key(q.path) === k)
      if (waiting)
        return new Promise((resolve) => {
          const prior = waiting.resolve
          waiting.resolve = (v) => {
            prior(v)
            resolve(v)
          }
        })
      return new Promise((resolve) => {
        queued.push({ path, resolve })
        // Newest asks matter most: the pointer has moved on from the oldest.
        while (queued.length > maxQueued) queued.shift()!.resolve(null)
        pump()
      })
    },
    /** A real navigation: nothing waiting is worth the disk any more. */
    cancel(): void {
      for (const q of queued.splice(0)) q.resolve(null)
    },
    get running(): number {
      return active
    },
    get waiting(): number {
      return queued.length
    }
  }
}
