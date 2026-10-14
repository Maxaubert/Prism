import { useSyncExternalStore } from 'react'
import type { HelpShellChoice } from '../../shared/help/shells'
import { readPref, writePref } from './prefStore'

/**
 * The help panel's settings (#12). VALUES ARE PER APP, like every other
 * setting in the core: each app has its own localStorage.
 *
 * ON BY DEFAULT, unlike dictation, and every reader treats a missing key as
 * on. The owner asked only that it be OPTIONAL ("optional in settings whether
 * a user wants to see them"); it is a discoverability feature for people who
 * do not yet know the shell, who are exactly the people who would never find
 * a switch to turn it on. It costs nothing while shut: no process, no
 * network, no listener beyond the one key. Off means off all the same: the
 * button goes, and the key goes back to the shell.
 */
const K = {
  enabled: 'prism.help.enabled',
  shell: 'prism.help.shell',
  // A new key for the side panel (#199): the popup's width, centred and
  // growing both ways, is no width for a sheet on the right.
  width: 'prism.help.panelWidth'
} as const

export const HELP_KEYS = K

const listeners = new Set<() => void>()
const notify = (): void => listeners.forEach((l) => l())
const sub = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

const read = readPref
const write = (key: string, value: string): void => {
  writePref(key, value)
  notify()
}

/** On unless switched off. */
export const helpEnabled = (): boolean => read(K.enabled) !== '0'
export const setHelpEnabled = (on: boolean): void => write(K.enabled, on ? '1' : '0')

/**
 * The shell chip somebody last PICKED BY HAND, or null when they never have.
 * The panel opens on the shell of the tab in front; this is only what it falls
 * back to where there is no such tab (the start screen, Settings).
 */
export const helpShell = (): HelpShellChoice | null => {
  const v = read(K.shell)
  return v === 'powershell' || v === 'cmd' || v === 'bash' ? v : null
}
export const setHelpShell = (shell: HelpShellChoice): void => write(K.shell, shell)

export const useHelpEnabled = (): boolean => useSyncExternalStore(sub, helpEnabled)
export const onHelpPrefs = sub

/**
 * HOW WIDE THE PANEL IS (owner, 2026-09-20: "you also need to be able to
 * adjust the width of this since some text can be seen" - a row is one line
 * and truncates, so a name or a command that does not fit is read by making
 * the window wider). Stored in CSS pixels, clamped on the way in AND on the
 * way out: a number saved on a 4K screen must not leave the popup wider than
 * a laptop's window when it is read back there.
 */
// The side panel (#199): 620 is the mockup the owner settled on; it never
// takes more than the terminal can spare (the panel's max-width does that).
export const HELP_WIDTH = { min: 420, max: 1100, default: 620 } as const

export const clampHelpWidth = (n: number): number =>
  Number.isFinite(n) && n > 0
    ? Math.round(Math.min(HELP_WIDTH.max, Math.max(HELP_WIDTH.min, n)))
    : HELP_WIDTH.default

/** NEVER SET IS NOT ZERO. `Number(null)` and `Number('')` are both 0, and a
 *  naive clamp reads that as the narrowest popup there is rather than the one
 *  nobody has resized - which the e2e caught as a footer line cut short. */
export const helpWidth = (): number => {
  const raw = read(K.width)
  return raw === null || raw === '' ? HELP_WIDTH.default : clampHelpWidth(Number(raw))
}
export const setHelpWidth = (px: number): void => write(K.width, String(clampHelpWidth(px)))

export function useHelpWidth(): number {
  return useSyncExternalStore(sub, helpWidth, () => HELP_WIDTH.default)
}
