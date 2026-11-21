import { useEffect } from 'react'
import { landJob, updateJob, updateLanding } from '../lib/jobs'
import { holdProgress } from '../lib/holds'

/**
 * Paste byte progress for the job chip. App owns it because the chip is
 * always mounted there; the sidebar that used to subscribe is gone, and
 * without this a long Explorer copy showed no percentage. Moved out of
 * App.tsx unchanged (audit #8, 2026-11-21).
 */
export function usePasteProgress(): void {
  useEffect(() => {
    // Each running paste's item names, by job, for the progress card's file line.
    const pasteNames = new Map<string, string[]>()
    return window.prism.onPasteProgress((m) => {
      if (m.start) {
        landJob(m.jobId, m.start.dir, m.start.items)
        pasteNames.set(m.jobId, m.start.items.map((i) => i.name))
      }
      if (typeof m.item === 'number' && typeof m.itemPct === 'number') updateLanding(m.jobId, m.item, m.itemPct)
      updateJob(m.jobId, m.pct)
      // The progress card (#501): the file the copy is on, by its item index.
      const file = typeof m.item === 'number' ? pasteNames.get(m.jobId)?.[m.item] : undefined
      if (m.pct >= 100) pasteNames.delete(m.jobId)
      // The loading bar (owner, 2026-11-09): how far, and what, by the job.
      holdProgress(m.jobId, {
        pct: m.pct,
        ...(file !== undefined ? { file } : {}),
        ...(m.count ? { done: m.count.done, total: m.count.total } : {}),
        ...(m.start?.items.length === 1 ? { name: m.start.items[0].name } : {})
      })
    })
  }, [])
}
