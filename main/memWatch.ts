import type { DiagLog } from './diagLog'

/**
 * HOW BIG EACH PROCESS IS, EVERY FEW MINUTES (owner, 2026-10-16, after every
 * Claude tab in the Stable copy stopped taking keys: the page process had
 * grown to 15.9 GB overnight, 2.5 MB a second, and nothing in the log said
 * so; it took a live look at the process list to see it). A `memory` crumb
 * every five minutes with each kind of process's private memory, so the next
 * leak shows as a rising line long before it hurts, and the crumbs before a
 * stall say how big the page was. When the page passes 2 GB a `mem-high`
 * problem is written, and again at every doubling (4, 8, 16 GB), never more
 * often: a page that big is a leak, not a busy terminal (the page is a few
 * hundred MB with eight Claude tabs, MEASURED the same night after a restart:
 * 74 MB at start).
 */

/** The slice of Electron's `app.getAppMetrics()` this reads (sizes in KB). */
export interface ProcessMetricLike {
  type: string
  memory: { workingSetSize: number; privateBytes?: number }
}

export interface MemWatchDeps {
  log: DiagLog
  metrics(): ProcessMetricLike[]
  everyMs?: number
  /** The page size, in MB, of the first `mem-high`. */
  highMb?: number
}

export interface MemWatch {
  /** One reading now (the timer's, and the tests'). */
  sample(): void
  stop(): void
}

export const MEM_EVERY_MS = 5 * 60 * 1000
export const MEM_HIGH_MB = 2048

/** Electron's process types, as the crumb names them. */
const KIND: Record<string, 'mainMb' | 'pageMb' | 'gpuMb'> = { Browser: 'mainMb', Tab: 'pageMb', GPU: 'gpuMb' }

export function startMemWatch(deps: MemWatchDeps): MemWatch {
  const highMb = deps.highMb ?? MEM_HIGH_MB
  let nextHigh = highMb
  const sample = (): void => {
    let list: ProcessMetricLike[]
    try {
      list = deps.metrics()
    } catch {
      return
    }
    const mb = { mainMb: 0, pageMb: 0, gpuMb: 0, otherMb: 0 }
    for (const p of list) {
      // Private bytes is what a leak grows; the working set where Windows has none.
      const kb = p.memory.privateBytes ?? p.memory.workingSetSize
      mb[KIND[p.type] ?? 'otherMb'] += kb / 1024
    }
    const out = {
      mainMb: Math.round(mb.mainMb),
      pageMb: Math.round(mb.pageMb),
      gpuMb: Math.round(mb.gpuMb),
      otherMb: Math.round(mb.otherMb)
    }
    deps.log.write('main', 'crumb', { a: 'memory', ...out })
    if (out.pageMb >= nextHigh) {
      deps.log.write('main', 'mem-high', { ...out, overMb: nextHigh })
      while (nextHigh <= out.pageMb) nextHigh *= 2
    }
  }
  const timer = setInterval(sample, deps.everyMs ?? MEM_EVERY_MS)
  timer.unref?.()
  return { sample, stop: () => clearInterval(timer) }
}
