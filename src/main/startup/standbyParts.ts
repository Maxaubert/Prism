import { app, BrowserWindow } from 'electron'
import { getPriority, setPriority, constants as osConstants } from 'os'
import { setFlagsFromString } from 'v8'
import { runInNewContext } from 'vm'
import type { Diagnostics } from 'prism-term-core/main/diagnostics'
import { E2E } from '../appState'
import { trimWorkingSets } from '../dwmHelper'
import type { PhoneService } from '../phone'
import type { createPreviewWindows } from '../previewWindow'
import { createStandby } from '../standby'

/** What standby's parts rest and wake (audit #7 step 2): index.ts's own state, read when they run. */
export interface StandbyPartsDeps {
  diag: () => Diagnostics | null
  lagProfiler: () => { rotate(): void } | null
  phoneService: () => PhoneService | null
  dropSpare: () => void
  previewWindows: ReturnType<typeof createPreviewWindows<BrowserWindow>>
}

/** Standby, with its parts and its heap and memory helpers (moved whole out of index.ts). */
export function createStandbyParts(d: StandbyPartsDeps): ReturnType<typeof createStandby> {
  /** V8's own collector, asked for once (main runs without --expose-gc). */
  let collect: (() => void) | null | undefined
  function collectGarbage(): void {
    if (collect === undefined) {
      try {
        setFlagsFromString('--expose-gc')
        collect = runInNewContext('gc') as () => void
      } catch {
        collect = null
      }
    }
    try {
      collect?.()
    } catch {
      /* a collection that cannot run costs nothing but the memory */
    }
  }
  /** Every Prism process's memory now, in MB: private bytes and working set. */
  function memoryNow(): Record<string, number> {
    const out = { processes: 0, privateMb: 0, workingSetMb: 0, mainMb: 0, gpuMb: 0, pageMb: 0 }
    for (const m of app.getAppMetrics()) {
      const priv = (m.memory.privateBytes ?? m.memory.workingSetSize) / 1024
      out.processes += 1
      out.privateMb += priv
      out.workingSetMb += m.memory.workingSetSize / 1024
      if (m.type === 'Browser') out.mainMb += priv
      else if (m.type === 'GPU') out.gpuMb += priv
      else if (m.type === 'Tab') out.pageMb += priv
    }
    for (const k of Object.keys(out) as Array<keyof typeof out>) out[k] = Math.round(out[k])
    return out
  }
  let restTimer: NodeJS.Timeout | null = null
  let priorityBefore: number | null = null
  /**
   * STANDBY'S PARTS (standby.ts; owner, 2026-11-06: "a mode that doesnt use
   * much compute ram"). In the order they rest; they wake in reverse.
   */
  const standby = createStandby({
    log: (fields) => d.diag()?.log.write('main', 'standby', fields),
    parts: [
      // No hidden window survives: the spare, its ghost, and the wait for one.
      { name: 'spare', sleep: () => d.dropSpare(), wake: () => {} },
      // Nor a preview window (owner, 2026-11-08).
      { name: 'preview', sleep: () => d.previewWindows.destroyAll(), wake: () => {} },
      // No watch timer wakes the process (20 a second otherwise).
      { name: 'diag', sleep: () => d.diag()?.standby(true), wake: () => d.diag()?.standby(false) },
      // Nor the sampling profiler (250 samples a second).
      {
        name: 'profiler',
        sleep: () => d.lagProfiler()?.rotate(),
        wake: () => d.lagProfiler()?.rotate()
      },
      // The phone server rests with the windows (its switch stays as it was).
      {
        name: 'phone',
        sleep: () => d.phoneService()?.rest(),
        wake: () => d.phoneService()?.wake()
      },
      // Low priority while resting: a press wakes it first, before any window.
      {
        name: 'priority',
        sleep: () => {
          priorityBefore = getPriority()
          setPriority(osConstants.priority.PRIORITY_LOW)
        },
        wake: () => {
          if (priorityBefore !== null) setPriority(priorityBefore)
          priorityBefore = null
        }
      },
      // The heap collected once the pages have gone, and the memory said.
      {
        name: 'heap',
        sleep: () => {
          if (restTimer) clearTimeout(restTimer)
          restTimer = setTimeout(() => {
            restTimer = null
            if (!standby.on()) return
            collectGarbage()
            // Every Prism process's working set emptied (the helper's --trim):
            // what stays resident is what a resting Prism touches, which is
            // almost nothing. Under --e2e `PRISM_E2E_NO_TRIM=1` measures without.
            const trim = !(E2E && process.env.PRISM_E2E_NO_TRIM === '1')
            if (trim)
              trimWorkingSets(
                process.execPath,
                app.getAppMetrics().map((m) => m.pid)
              )
            restTimer = setTimeout(() => {
              restTimer = null
              if (standby.on())
                d.diag()?.log.write('main', 'standby', {
                  ev: 'rest',
                  trimmed: trim,
                  ...memoryNow()
                })
            }, 2000)
            restTimer.unref()
          }, 3000)
          restTimer.unref()
        },
        wake: () => {
          if (restTimer) clearTimeout(restTimer)
          restTimer = null
        }
      }
    ]
  })
  if (E2E)
    Object.assign(globalThis, {
      __e2eStandby: () => ({
        on: standby.on(),
        windows: BrowserWindow.getAllWindows().length,
        memory: memoryNow()
      })
    })
  return standby
}
