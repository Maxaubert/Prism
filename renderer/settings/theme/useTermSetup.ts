import { useEffect, useState } from 'react'
import { hostGround, hostOwnsWindowAcrylic, termHost } from '../../host'
import {
  agentColorChoice,
  agentDoneColorChoice,
  agentQuestionColorChoice,
  customTermTheme,
  saveCustomTermTheme,
  setTermThemeId,
  paintsAlpha,
  termAcrylic,
  termExtraDefaults,
  termGroundAlpha,
  termThemeId,
  useAgentColorChoice,
  useAgentDoneColorChoice,
  useAgentQuestionColorChoice,
  useCustomTermTheme,
  useTermAcrylic,
  useTermGroundAlpha,
  useTermThemeId,
  withGroundAlpha
} from '../../lib/termLook'
import { alphaOf, opaque } from '../../lib/colour'
import { resolveTermTheme } from '../../lib/termTheme'
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
 * The see-through rides on the palette's own `bg` (#114).
 */
export interface TermSetup {
  /** The settings deviate from the selected theme's stock. */
  dirty: boolean
  /** Save the whole setup as Custom, and select it. */
  save: () => void
  /** What a save carries besides the palette (the editor's save adds it). */
  extras: { indicatorColor: string; doneColor: string; questionColor: string; acrylic: boolean }
}

export function useTermSetup(): TermSetup {
  // Subscribed for the re-render only; the state is read in one place below.
  useTermThemeId()
  useTermAcrylic()
  useTermGroundAlpha()
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
  const acrylicOn = termAcrylic()
  // The window's see-through (#114): the alpha of the ground in force, the
  // picked Background's first. A byte, so the comparison below is exact.
  const groundByte = Math.round(termGroundAlpha() * 255)
  const custom = customTermTheme()
  // The CHOICES ('' = follow the theme) are what is saved and compared.
  const extras = {
    indicatorColor: agentColorChoice(),
    doneColor: agentDoneColorChoice(),
    questionColor: agentQuestionColorChoice(),
    acrylic: acrylicOn
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
    acrylic: (src?.acrylic ?? termExtraDefaults().acrylic)
  }
  // THE UNSAVED-CHANGES QUESTION SURVIVES THE SLIDER (#114, #60). Opacity was
  // one of the extras, so a changed one lit Save changes and a theme pick
  // asked before forgetting it. Its place is taken by the ground's alpha in
  // force against what the theme's own setup paints: a see-through picked
  // Background lights Save changes in the same way. Only where that alpha is
  // the window's (Prism has no such alpha, and is not asked to resolve one).
  // The theme's own is computed by the rule the window paints by (#156,
  // `paintsAlpha`): an older Custom saved with acrylic on and an opaque `bg`
  // paints the default see-through, so it is not dirty on pick. A preset's own
  // setup has the host's default acrylic (off in Prism Terminal).
  // Its default level is measured from the ground the WINDOW measures from,
  // the picked Background first (review of #156): an opaque pick changes no
  // setting, so it must not light Save changes by being lighter or darker
  // than the theme's own ground.
  const ownByte = (): number => {
    const picked = hostGround()
    const ground = picked ? opaque(picked) : (src?.bg ?? resolveTermTheme(themeId).background)
    return Math.round(paintsAlpha(src ? alphaOf(src.bg) : 1, ground, baseline.acrylic) * 255)
  }
  const dirty =
    JSON.stringify(extras) !== JSON.stringify(baseline) || (hostOwnsWindowAcrylic() && groundByte !== ownByte())
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
  saveCustomTermTheme({ ...palette, ...extras })
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
