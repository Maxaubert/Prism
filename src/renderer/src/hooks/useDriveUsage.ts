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

/** One drive's answer says what the last one said. */
export function sameDrive(a: BrowseDriveUsage | undefined, b: BrowseDriveUsage): boolean {
  return (
    !!a &&
    a.path === b.path &&
    a.total === b.total &&
    a.free === b.free &&
    a.label === b.label &&
    a.kind === b.kind &&
    !!a.system === !!b.system
  )
}

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
          // THE SAME BYTES DRAW NOTHING (perf review #33, 2026-10-28): every
          // poll set a new map, so the places panel re-rendered every three
          // minutes with nothing changed.
          for (const drive of answer) {
            const key = drive.path.toUpperCase()
            if (!sameDrive(known.get(key), drive)) known.set(key, drive)
          }
          // Against what THIS panel shows: another one may have filled the
          // shared answers before this one had any.
          if (live)
            setSeen((shown) =>
              answer.every((drive) => sameDrive(shown.get(drive.path.toUpperCase()), drive))
                ? shown
                : new Map(known)
            )
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
