import { useEffect, useState } from 'react'
import { hostOwnsWindowAcrylic, termHost } from '../../host'
import {
  agentColorChoice,
  agentDoneColorChoice,
  agentQuestionColorChoice,
  customTermTheme,
  saveCustomTermTheme,
  seeThroughLevel,
  setTermThemeId,
  termAcrylic,
  termExtraDefaults,
  termSeeThrough,
  termThemeId,
  useAgentColorChoice,
  useAgentDoneColorChoice,
  useAgentQuestionColorChoice,
  useCustomTermTheme,
  useTermAcrylic,
  useTermSeeThrough,
  useTermThemeId,
  withGroundAlpha
} from '../../lib/termLook'
import { paletteOf } from './palette'

/**
 * THE TERMINAL'S SETUP AND ITS SAVE, once (2026-10-05). The theme wall's Save
 * changes and, since the grouped cards redesign, a second one over the agent
 * colours (owner, Q3) both save the WHOLE setup as Custom and light together,
 * because both read this.
 *
 * "Save changes": the theme's whole look - palette of the selected theme,
 * agent colours, acrylic and how see-through the ground is - lands in the
 * Custom slot, reselectable after any theme switch. The font, its size and the
 * indicator's style belong to no theme and are not part of it (2026-09-28).
 * Where the terminal owns the window acrylic, the see-through is the slider's
 * level (2026-10-13), one of the extras; in Prism, acrylic is the switch.
 */
export interface TermSetup {
  /** The settings deviate from the selected theme's stock. */
  dirty: boolean
  /** Save the whole setup as Custom, and select it. */
  save: () => void
  /** What a save carries besides the palette (the editor's save adds it). */
  extras: { indicatorColor: string; doneColor: string; questionColor: string; acrylic?: boolean; seeThrough?: number }
}

export function useTermSetup(): TermSetup {
  // Subscribed for the re-render only; the state is read in one place below.
  useTermThemeId()
  useTermAcrylic()
  useTermSeeThrough()
  useAgentColorChoice()
  useAgentDoneColorChoice()
  useAgentQuestionColorChoice()
  useCustomTermTheme()
  const { dirty, extras } = termSetupState()
  return { dirty, save: saveTermSetup, extras }
}

/** Dirty and the extras, from the stores as they are (tested). */
export function termSetupState(): Pick<TermSetup, 'dirty' | 'extras'> {
  const themeId = termThemeId()
  const windowGlass = hostOwnsWindowAcrylic()
  const custom = customTermTheme()
  // The CHOICES ('' = follow the theme) are what is saved and compared.
  const extras = {
    indicatorColor: agentColorChoice(),
    doneColor: agentDoneColorChoice(),
    questionColor: agentQuestionColorChoice(),
    // The see-through: the slider's level where the terminal owns the window
    // acrylic (2026-10-13; a level of the theme's, so a moved slider lights
    // Save changes and a theme pick asks first), Prism's switch elsewhere.
    ...(windowGlass ? { seeThrough: termSeeThrough() } : { acrylic: termAcrylic() })
  }
  // Dirty = the SETTINGS deviate from the selected theme's stock: any theme
  // arrives with the defaults, a Custom arrives with what it saved. Comparing
  // whole palettes kept the button lit forever - the palette IS the selection.
  // Built field by field in the same order as `extras`, since the comparison
  // is by JSON and key order is part of that.
  const src = themeId === 'custom' && custom ? custom : null
  const baseline = {
    indicatorColor: src?.indicatorColor ?? termExtraDefaults().indicatorColor,
    doneColor: src?.doneColor ?? termExtraDefaults().doneColor,
    questionColor: src?.questionColor ?? termExtraDefaults().questionColor,
    ...(windowGlass
      ? { seeThrough: seeThroughLevel(src?.seeThrough ?? termExtraDefaults().seeThrough) }
      : { acrylic: src?.acrylic ?? termExtraDefaults().acrylic })
  }
  const dirty = JSON.stringify(extras) !== JSON.stringify(baseline)
  return { dirty, extras }
}

/** Save the whole setup in force as Custom, and select it. */
export function saveTermSetup(): void {
  saveAsCustom(withGroundAlpha(paletteOf(termThemeId())))
}

/** Save a palette with the setup in force as Custom, and select it: Save
 *  changes, and the colour editor's save. */
export function saveAsCustom(palette: ReturnType<typeof paletteOf>): void {
  const { extras } = termSetupState()
  saveCustomTermTheme({ ...withGroundAlpha(palette), ...extras })
  setTermThemeId('custom')
}

/**
 * Whether the acrylic material is missing on this PC, where the terminal owns
 * the window's (Prism Terminal). The material is Windows 11's; null while main
 * has not answered reads as supported, so a row does not flash disabled on
 * every open.
 */
export function useNoAcrylic(): boolean {
  const acrylic = termHost().acrylic
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => {
    if (acrylic.kind !== 'window') return
    let live = true
    void acrylic.supported().then((v) => {
      if (live) setOk(v)
    })
    return () => {
      live = false
    }
  }, [acrylic])
  return hostOwnsWindowAcrylic() && ok === false
}
