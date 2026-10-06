import { useSyncExternalStore } from 'react'

// HOW THE SIDEBAR DRAWS ITS DRIVES (#296; owner, 2026-10-06, of the drive row
// mockups: "I want option A, D and E as options in settings, with A being
// default"). Settings > Explorer > Layout > Drive style. Tiles is mockup A
// (a soft tile per drive, a pill bar), Ring is D (two plain lines and a small
// donut), Gauge is E (a 20 step meter). The behaviour of a drive row is the
// same in all three; only its look changes.

export type DriveStyle = 'tiles' | 'ring' | 'gauge'

export const DRIVE_STYLES: Array<{ id: DriveStyle; name: string }> = [
  { id: 'tiles', name: 'Tiles' },
  { id: 'ring', name: 'Ring' },
  { id: 'gauge', name: 'Gauge' }
]

const KEY = 'prism.sidebar.driveStyle'
const DEFAULT: DriveStyle = 'tiles'

/** A stored style, made safe: anything but a known id reads as Tiles. */
export function driveStyleOf(raw: unknown): DriveStyle {
  return DRIVE_STYLES.some((s) => s.id === raw) ? (raw as DriveStyle) : DEFAULT
}

function load(): DriveStyle {
  try {
    return driveStyleOf(localStorage.getItem(KEY))
  } catch {
    return DEFAULT
  }
}

let style: DriveStyle = load()
const listeners = new Set<() => void>()

export function setDriveStyle(s: DriveStyle): void {
  style = driveStyleOf(s)
  try {
    localStorage.setItem(KEY, style)
  } catch {
    /* no storage: it lasts the session */
  }
  listeners.forEach((l) => l())
}

export function driveStyle(): DriveStyle {
  return style
}

export function useDriveStyle(): DriveStyle {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => style
  )
}

/** For tests: read the store again, as a fresh launch would. */
export function reloadDriveStyle(): void {
  style = load()
}
