import { useSyncExternalStore } from 'react'
import type { ColourFormat } from './colour'

/**
 * HOW EVERY COLOUR FIELD SHOWS ITS VALUE (#112): HEX, RGBA or HSLA, toggled in
 * the picker and remembered per app and per viewer (owner, 2026-10-03: the
 * fields open in HEX, and the toggle is remembered). Display only: it changes
 * nothing that is stored. Read defensively: anything but the three reads as
 * HEX, and a blocked store loses the choice, not the app.
 */
export const COLOUR_FORMAT_KEY = 'prism.term.colourFormat'
const ORDER: ColourFormat[] = ['hex', 'rgba', 'hsla']

const listeners = new Set<() => void>()
const sub = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function colourFormat(): ColourFormat {
  try {
    const v = localStorage.getItem(COLOUR_FORMAT_KEY)
    return v === 'rgba' || v === 'hsla' ? v : 'hex'
  } catch {
    return 'hex'
  }
}

export function setColourFormat(f: ColourFormat): void {
  try {
    localStorage.setItem(COLOUR_FORMAT_KEY, f)
  } catch {
    /* kept for this render only */
  }
  listeners.forEach((l) => l())
}

/** HEX, then RGBA, then HSLA, then HEX again. */
export function cycleColourFormat(): ColourFormat {
  const next = ORDER[(ORDER.indexOf(colourFormat()) + 1) % ORDER.length]
  setColourFormat(next)
  return next
}

export function useColourFormat(): ColourFormat {
  return useSyncExternalStore(sub, colourFormat)
}
