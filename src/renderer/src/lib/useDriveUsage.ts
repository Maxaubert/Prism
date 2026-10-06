import { useEffect, useState } from 'react'
import type { BrowseDriveUsage } from '@shared/browse'

/**
 * The This PC rows' sizes (#296), asked of main when the places panel
 * appears, when the set of drives changes, when the window comes back to the
 * front (at most every FOCUS_GAP) and every REFRESH while it stays up. The
 * last answer is kept for the whole page, so a panel that is shut and opened
 * again draws its bars at once instead of growing them a beat later.
 */

export const REFRESH = 3 * 60_000
export const FOCUS_GAP = 30_000

const known = new Map<string, BrowseDriveUsage>()
let askedAt = 0

export function useDriveUsage(
  paths: readonly string[],
  read: ((paths: string[]) => Promise<BrowseDriveUsage[]>) | undefined
): ReadonlyMap<string, BrowseDriveUsage> {
  const key = paths.join('|')
  const [seen, setSeen] = useState<ReadonlyMap<string, BrowseDriveUsage>>(() => new Map(known))
  useEffect(() => {
    if (!read || !key) return
    const roots = key.split('|')
    let live = true
    const ask = (): void => {
      askedAt = Date.now()
      read(roots)
        .then((answer) => {
          for (const drive of answer) known.set(drive.path.toUpperCase(), drive)
          if (live) setSeen(new Map(known))
        })
        .catch(() => {})
    }
    ask()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') ask()
    }, REFRESH)
    const focus = (): void => {
      if (Date.now() - askedAt >= FOCUS_GAP) ask()
    }
    window.addEventListener('focus', focus)
    return () => {
      live = false
      window.clearInterval(timer)
      window.removeEventListener('focus', focus)
    }
  }, [key, read])
  return seen
}
