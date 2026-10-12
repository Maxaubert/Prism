import {
  agentIndicator,
  customTermTheme,
  resetTermExtras,
  setAgentIndicator,
  setTermThemeId,
  termExtraDefaults,
  type CustomTermTheme
} from '../../lib/termLook'
import { resolveTermTheme } from '../../lib/termTheme'
import { normalizeColor } from '../../lib/termAnsi'
import { DEFAULT_GROUND } from '../../../shared/ground'

// What a theme card and the editor read off a theme.

export const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
] as const

export type CardAnsi = { green: string; yellow: string; blue: string; cyan: string; red: string }

/** The five colours a card's miniature session reads, with the fallbacks a
 *  custom palette missing one of them gets. */
export const cardAnsi = (a: Record<string, string | undefined>): CardAnsi => ({
  green: a.green ?? '#8cc265',
  yellow: a.yellow ?? '#d1a54b',
  blue: a.blue ?? '#4aa5f0',
  cyan: a.cyan ?? '#42b3c2',
  red: a.red ?? '#e05561'
})

/**
 * A PRESET'S LOOK, worked out once (2026-09-22, owner: the Appearance page
 * "takes a second to load"). A preset never changes, and resolving one runs
 * the legibility floors over its sixteen colours, so the forty cards cost the
 * same forty resolves on every change to any setting on the page. Custom and
 * Follow style are live, and are never read through this.
 */
const presetLooks = new Map<string, ReturnType<typeof resolveTermTheme>>()
export function presetLook(id: string): ReturnType<typeof resolveTermTheme> {
  let look = presetLooks.get(id)
  if (!look) presetLooks.set(id, (look = resolveTermTheme(id)))
  return look
}

/** The selected theme's palette as the editor and the Custom slot hold it.
 *  Normalised: a theme may publish rgba() or #rrggbbaa, and a colour input
 *  handed either silently renders black. */
export function paletteOf(id: string): Pick<CustomTermTheme, 'bg' | 'fg' | 'cursor' | 'ansi' | 'selection'> {
  // THE EDITOR EDITS WHAT IS STORED (#112). A Custom is handed over raw, its
  // alphas and chosen selection included: resolved, it would be the floored
  // composites, and Save changes would turn every see-through colour into an
  // opaque one. Presets and the host's style keep normalising (Prism's
  // e2e holds the follow-style Background to six digits).
  const raw = id === 'custom' ? customTermTheme() : null
  if (raw) {
    const out: Pick<CustomTermTheme, 'bg' | 'fg' | 'cursor' | 'ansi' | 'selection'> = {
      bg: raw.bg,
      fg: raw.fg,
      cursor: raw.cursor,
      ansi: { ...raw.ansi }
    }
    if (raw.selection) out.selection = raw.selection
    return out
  }
  const t = resolveTermTheme(id)
  const ansi: Record<string, string> = {}
  for (const k of ANSI_KEYS) {
    const v = t[k]
    if (typeof v === 'string') ansi[k] = v
  }
  return {
    bg: normalizeColor(t.background, DEFAULT_GROUND),
    fg: normalizeColor(t.foreground, '#e7e7ee'),
    cursor: normalizeColor(t.cursor, '#5b5bd6'),
    ansi
  }
}

/** Picking a theme returns the LOOK to its defaults: the theme is the whole
 *  setup. The indicator's volume is carried across, because it is a General
 *  setting here (how loudly a tab speaks, not what the terminal looks like)
 *  and a behaviour that reset itself on a theme click would be a setting that
 *  does not hold. */
export function pickPreset(id: string): void {
  const volume = agentIndicator()
  setTermThemeId(id)
  resetTermExtras()
  if (volume !== termExtraDefaults().indicator) setAgentIndicator(volume)
}
