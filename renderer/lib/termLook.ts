import { useSyncExternalStore } from 'react'
import {
  followsHostStyle,
  hostDefaults,
  hostGround,
  hostIndicators,
  hostOwnsWindowAcrylic,
  onHostChromeChange,
  type AgentIndicator
} from '../host'
import { liveThemeId } from './termThemeRetired'
import { alphaOf, opaque, parseColour, toStored, withAlpha } from './colour'
import { seeThroughAlpha } from './seeThrough'
// A CYCLE, and a safe one: termTheme imports this module too, and neither reads
// the other at module load (only inside functions, at call time), so either may
// be evaluated first.
import { resolveTermTheme } from './termTheme'

export type { AgentIndicator }

// The terminal's persisted look: which theme it wears and its base font size.
// Same tiny-store shape as tabPrefs. Per-SESSION font zoom (Ctrl+scroll) is
// deliberately NOT here: that lives and dies with the session.

const THEME_KEY = 'prism.term.theme'
const FONT_KEY = 'prism.term.fontPct'

export const TERM_BASE_FONT_PX = 13
/** 50% to 200% in tens (owner, 2026-09-28: "font size should have 10%
 *  increments from 50-200"). It was 80-200 with uneven steps. */
export const FONT_PCTS = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200] as const

let listeners: Array<() => void> = []
const notify = (): void => listeners.forEach((l) => l())

/** Names a preset (or 'custom'). 'prism' is the default. Inside Prism the
 *  default was 'style', follow the app style; there is no app style here, so a
 *  stored 'style' reads as 'prism' rather than as a theme nothing can resolve. */
export function termThemeId(): string {
  const v = localStorage.getItem(THEME_KEY)
  // Never touched: the HOST's default ('style' in Prism, a preset here). A
  // stored 'style' where the host has no style to follow reads as that
  // default too, rather than as a theme nothing can resolve.
  if (!v || (v === 'style' && !followsHostStyle())) return hostDefaults().theme
  // A theme since retired (#62) reads as the kept one nearest it.
  return liveThemeId(v)
}

export function setTermThemeId(id: string): void {
  localStorage.setItem(THEME_KEY, id)
  notify()
}

const FONT_FAMILY_KEY = 'prism.term.font'

/** Monospace faces worth offering on Windows; each falls back to the stack's
 *  next face when not installed, so picking a missing one degrades quietly. */
export const TERM_FONTS = [
  { id: 'cascadia', name: 'Cascadia Mono', stack: '"Cascadia Mono", "JetBrainsMono NF", Consolas, monospace' },
  { id: 'cascadia-code', name: 'Cascadia Code', stack: '"Cascadia Code", "Cascadia Mono", Consolas, monospace' },
  { id: 'consolas', name: 'Consolas', stack: 'Consolas, "Cascadia Mono", monospace' },
  { id: 'jetbrains', name: 'JetBrains Mono', stack: '"JetBrains Mono", "JetBrainsMono NF", "Cascadia Mono", Consolas, monospace' },
  { id: 'jetbrains-nf', name: 'JetBrainsMono Nerd Font', stack: '"JetBrainsMono NF", "JetBrains Mono", "Cascadia Mono", Consolas, monospace' },
  { id: 'fira', name: 'Fira Code', stack: '"Fira Code", "Cascadia Mono", Consolas, monospace' },
  { id: 'source', name: 'Source Code Pro', stack: '"Source Code Pro", "Cascadia Mono", Consolas, monospace' },
  { id: 'lucida', name: 'Lucida Console', stack: '"Lucida Console", Consolas, monospace' },
  { id: 'courier', name: 'Courier New', stack: '"Courier New", Courier, monospace' },
  { id: 'ibm-plex', name: 'IBM Plex Mono', stack: '"IBM Plex Mono", "Cascadia Mono", Consolas, monospace' },
  { id: 'roboto-mono', name: 'Roboto Mono', stack: '"Roboto Mono", "Cascadia Mono", Consolas, monospace' },
  { id: 'ubuntu-mono', name: 'Ubuntu Mono', stack: '"Ubuntu Mono", "Cascadia Mono", Consolas, monospace' },
  { id: 'hack', name: 'Hack', stack: 'Hack, "Cascadia Mono", Consolas, monospace' },
  { id: 'iosevka', name: 'Iosevka', stack: 'Iosevka, "Iosevka Term", "Cascadia Mono", Consolas, monospace' },
  { id: 'dejavu', name: 'DejaVu Sans Mono', stack: '"DejaVu Sans Mono", "Cascadia Mono", Consolas, monospace' }
] as const

export function termFontId(): string {
  const v = localStorage.getItem(FONT_FAMILY_KEY)
  return TERM_FONTS.some((f) => f.id === v) ? (v as string) : 'cascadia'
}

export function setTermFontId(id: string): void {
  localStorage.setItem(FONT_FAMILY_KEY, id)
  notify()
}

export function termFontStack(): string {
  return TERM_FONTS.find((f) => f.id === termFontId())?.stack ?? TERM_FONTS[0].stack
}

export function termFontPct(): number {
  const raw = localStorage.getItem(FONT_KEY)
  const v = Number(raw)
  // Never set (or nonsense) is the default size. A size saved on the old
  // list that is not on this one (125, 175) is the NEAREST step, not a jump
  // back to 100: the text should not change size under anyone with the update.
  if (!raw || !Number.isFinite(v) || v < FONT_PCTS[0] || v > FONT_PCTS[FONT_PCTS.length - 1]) return 100
  return Math.round(v / 10) * 10
}

export function setTermFontPct(pct: number): void {
  localStorage.setItem(FONT_KEY, String(pct))
  notify()
}

/** The base font in pixels the current percentage means. */
export function termBaseFontPx(): number {
  return Math.round((TERM_BASE_FONT_PX * termFontPct()) / 100)
}

const ACRYLIC_KEY = 'prism.term.acrylic'
const OPACITY_KEY = 'prism.term.opacity'

/** Whether the window is acrylic: the theme's background is painted at the
 *  ground's alpha (`termGroundAlpha`) and the desktop shows through. Inside
 *  Prism this belonged to the follow-style terminal alone and was on by
 *  default; here it works with any theme and is OFF until asked for. */
export function termAcrylic(): boolean {
  const v = localStorage.getItem(ACRYLIC_KEY)
  // Never touched: the host's default (on in Prism, off in Prism Terminal).
  return v === null ? hostDefaults().acrylic : v === '1'
}
export function setTermAcrylic(on: boolean): void {
  localStorage.setItem(ACRYLIC_KEY, on ? '1' : '0')
  notify()
}
/**
 * THE OPACITY SLIDER IS GONE (#114; owner, 2026-10-03: alpha "should be built
 * into the colour pickers ... it should not be a separate opacity setting").
 * The window's see-through is the ALPHA of the ground in force now
 * (`termGroundAlpha`). This reads what the slider left behind, ONCE, for the
 * host's migration, exactly as the window read it: 30-100, defensively, since
 * Number(null) and Number('') are 0, which would read "never set" as fully
 * transparent. Nothing writes the key any more.
 */
export function legacyTermOpacity(): number {
  return opacityPct(localStorage.getItem(OPACITY_KEY))
}

/** A stored opacity as the window read it, 30-100; 100 for anything else. */
export function opacityPct(raw: unknown): number {
  const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw)
  return Number.isFinite(n) ? Math.min(100, Math.max(30, Math.round(n))) : 100
}

/** The legacy key, for the migration that removes it. */
export const LEGACY_OPACITY_KEY = OPACITY_KEY

const AGENT_IND_KEY = 'prism.term.agentIndicator'


/**
 * A stored indicator as the host can draw it (#143): a value among `allowed`
 * reads as itself, anything else (never set, nonsense, or a choice this host's
 * strip does not draw, such as Ring in Prism) as `fallback`. A stored `full`
 * reads as `full`: where the host draws the new marks that IS the new Full,
 * the migration being the meaning, so nothing is rewritten.
 */
export function readIndicator(raw: unknown, allowed: readonly AgentIndicator[], fallback: AgentIndicator): AgentIndicator {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as AgentIndicator) : fallback
}

/** How an agent shows on its tab: not at all, a line under the tab (Minimal),
 *  a spinner by the name (Ring, #143), or the tabs you are not on filled
 *  (Full). MINIMAL is the default (owner, 2026-09-18; it was full in Prism and
 *  in the first build): the line says it, and a filled tab is the loud version
 *  you opt into. */
export function agentIndicator(): AgentIndicator {
  return readIndicator(localStorage.getItem(AGENT_IND_KEY), hostIndicators(), hostDefaults().indicator)
}

export function setAgentIndicator(v: AgentIndicator): void {
  localStorage.setItem(AGENT_IND_KEY, v)
  notify()
}

const AGENT_COLOR_KEY = 'prism.term.agentColor'
const AGENT_DONE_KEY = 'prism.term.agentDoneColor'
const AGENT_QUESTION_KEY = 'prism.term.agentQuestionColor'
const DONE_ON_KEY = 'prism.term.agentDoneOn'
const QUESTION_ON_KEY = 'prism.term.agentQuestionOn'

/**
 * THE TWO ATTENTION MARKS, each optional (2026-09-28; owner: "an optional
 * completion indicator ... a green border on the bottom", and "a question
 * indicator ... a blue indicator, also optional"). ON by default: they are how
 * a tab that needs you says so. Switches, not theme settings, so a theme
 * never turns them on or off.
 */
export function agentDoneOn(): boolean {
  return localStorage.getItem(DONE_ON_KEY) !== '0'
}
export function setAgentDoneOn(on: boolean): void {
  localStorage.setItem(DONE_ON_KEY, on ? '1' : '0')
  notify()
}
export function agentQuestionOn(): boolean {
  return localStorage.getItem(QUESTION_ON_KEY) !== '0'
}
export function setAgentQuestionOn(on: boolean): void {
  localStorage.setItem(QUESTION_ON_KEY, on ? '1' : '0')
  notify()
}

const RAINBOW_KEY = 'prism.term.agentRainbow'

/**
 * THE RAINBOW FINISH (#143; owner, 2026-10-10): a finished tab wears the app
 * icon's colours, flowing. A switch, ON by default; off is the finished
 * colour, still. Not a theme setting: a theme pick never touches it. Drawn
 * only where the host's strip draws it (`tabMarks.rainbow`).
 */
export function agentRainbow(): boolean {
  return localStorage.getItem(RAINBOW_KEY) !== '0'
}
export function setAgentRainbow(on: boolean): void {
  localStorage.setItem(RAINBOW_KEY, on ? '1' : '0')
  notify()
}

const FAILED_ON_KEY = 'prism.term.agentFailedOn'
const HOOKS_KEY = 'prism.term.agentHooks'

/**
 * THE FAILED MARK (#131): a turn that ended on an error (a rate limit, an
 * overload), told by Claude Code's own hook. A switch beside the other two,
 * on by default for their reason.
 */
export function agentFailedOn(): boolean {
  return localStorage.getItem(FAILED_ON_KEY) !== '0'
}
export function setAgentFailedOn(on: boolean): void {
  localStorage.setItem(FAILED_ON_KEY, on ? '1' : '0')
  notify()
}

/**
 * "EXACT STATUS FROM CLAUDE CODE" (#131; owner, 2026-10-05: on by default,
 * with a switch). On, a NEW shell is handed the bundled plugin; off, it is
 * not, and no plugin loads. A running shell keeps what it started with.
 */
export function agentHooksOn(): boolean {
  return localStorage.getItem(HOOKS_KEY) !== '0'
}
export function setAgentHooksOn(on: boolean): void {
  localStorage.setItem(HOOKS_KEY, on ? '1' : '0')
  notify()
}
/** Six digits, or eight with an alpha (#112): every reader takes both. */
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i

/** A stored agent colour: the canonical form of a 6 or 8 digit hex, or null. */
const agentHex = (v: string | null | undefined): string | null =>
  v && HEX.test(v) ? toStored(parseColour(v)!) : null

/** Write a choice, or forget it: anything but a 6 or 8 digit hex gives the
 *  choice back to the theme. */
function writeChoice(key: string, hex: string | null | undefined): void {
  const v = agentHex(hex)
  if (v) localStorage.setItem(key, v)
  else localStorage.removeItem(key)
}

/**
 * The two agent colours, as CHOICES. '' means "follow the theme" and is the
 * default (owner, 2026-09-18: the indicator should wear the theme's accent):
 * a fixed orange belonged to one theme and clashed with thirty-eight others.
 * What the theme gives when nothing is chosen is lib/agentColors' business;
 * this file only remembers whether the user has an opinion.
 */
export function agentColorChoice(): string {
  return agentHex(localStorage.getItem(AGENT_COLOR_KEY)) ?? hostDefaults().agentColor
}

/** A hex picks a colour; '' gives the choice back to the theme. */
export function setAgentColor(hex: string): void {
  writeChoice(AGENT_COLOR_KEY, hex)
  notify()
}

/** The question colour's choice ('' = the default blue, moved to the ground's
 *  floor by lib/agentColors), like the other two. */
export function agentQuestionColorChoice(): string {
  return agentHex(localStorage.getItem(AGENT_QUESTION_KEY)) ?? ''
}
export function setAgentQuestionColor(hex: string): void {
  writeChoice(AGENT_QUESTION_KEY, hex)
  notify()
}

/** The finished-while-away colour's choice: an agent that stopped working on
 *  a BACKGROUND tab wears it until the tab is visited. */
export function agentDoneColorChoice(): string {
  return agentHex(localStorage.getItem(AGENT_DONE_KEY)) ?? hostDefaults().agentDoneColor
}

export function setAgentDoneColor(hex: string): void {
  writeChoice(AGENT_DONE_KEY, hex)
  notify()
}

const CUSTOM_KEY = 'prism.term.custom'

export interface CustomTermTheme {
  /** Every colour is the stored form: `#rrggbb`, or `#rrggbbaa` with an
   *  alpha (#112). */
  bg: string
  fg: string
  cursor: string
  /** The selection's fill, with its alpha. Absent: derived from the cursor,
   *  as it always was (`<cursor>55`). */
  selection?: string
  ansi: Record<string, string>
  /** The rest of the terminal setup, captured by "Save changes": the look is
   *  more than the palette. All optional - older saves carry colours only.
   *  `font` and `fontPct` are READ NO MORE (owner, 2026-09-28: the font and its
   *  size "should transcend" a theme, so no theme sets them); older saves may
   *  still carry them, and they are ignored. */
  font?: string
  fontPct?: number
  indicator?: AgentIndicator
  indicatorColor?: string
  doneColor?: string
  questionColor?: string
  acrylic?: boolean
}

/** What every theme-bound non-colour setting is out of the box. Picking any
 *  theme returns to these; deviating from them is what "Save changes" saves.
 *  The font and its size are not among them: they belong to no theme. */
export function termExtraDefaults(): {
  indicator: AgentIndicator
  indicatorColor: string
  doneColor: string
  questionColor: string
  acrylic: boolean
} {
  const d = hostDefaults()
  return {
    indicator: d.indicator,
    // '' = the theme's own (see agentColorChoice).
    indicatorColor: d.agentColor,
    doneColor: d.agentDoneColor,
    questionColor: '',
    acrylic: d.acrylic
  }
}

/** Selecting a theme overwrites the terminal settings with their defaults:
 *  the theme is the whole setup, not just the palette. */
export function resetTermExtras(): void {
  localStorage.removeItem(AGENT_IND_KEY)
  localStorage.removeItem(AGENT_COLOR_KEY)
  localStorage.removeItem(AGENT_DONE_KEY)
  localStorage.removeItem(AGENT_QUESTION_KEY)
  localStorage.removeItem(ACRYLIC_KEY)
  notify()
}

/** Re-apply the non-colour half of a saved Custom setup, when it has one. */
export function applyCustomExtras(t: CustomTermTheme | null): void {
  if (!t) return
  // The font and its size belong to no theme (2026-09-28): an older save that
  // carries them does not put them back.
  // Through the same reader as the store (#143): a saved Ring in a host that
  // draws none is not written over the user's choice.
  if (t.indicator && hostIndicators().includes(t.indicator)) localStorage.setItem(AGENT_IND_KEY, t.indicator)
  // A saved setup that followed the theme goes back to following it.
  // Validated as every other writer is: a colour that is not one follows the
  // theme rather than landing in storage unchecked (#112).
  writeChoice(AGENT_COLOR_KEY, t.indicatorColor)
  writeChoice(AGENT_DONE_KEY, t.doneColor)
  writeChoice(AGENT_QUESTION_KEY, t.questionColor)
  if (t.acrylic !== undefined) localStorage.setItem(ACRYLIC_KEY, t.acrylic ? '1' : '0')
  // No opacity (#114): a saved see-through is the alpha of the saved `bg`.
  notify()
}

/** The user's ONE custom theme, or null before any save. Saving overwrites:
 *  like Tabby, there is a single Custom slot, edited and re-saved. */
export function customTermTheme(): CustomTermTheme | null {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as CustomTermTheme
    // Every colour read through the one parser and kept in the one stored form
    // (#112). A background or foreground that is not a colour is no Custom, as
    // it always was; a bad cursor is the text colour, a bad selection is
    // derived, and a bad one of the sixteen is simply absent.
    const bg = stored(v.bg)
    const fg = stored(v.fg)
    if (!bg || !fg) return null
    const ansi: Record<string, string> = {}
    if (v.ansi && typeof v.ansi === 'object')
      for (const [k, c] of Object.entries(v.ansi)) {
        const ok = stored(c)
        if (ok) ansi[k] = ok
      }
    const selection = stored(v.selection)
    const out: CustomTermTheme = { ...v, bg, fg, cursor: stored(v.cursor) ?? fg, ansi }
    if (selection) out.selection = selection
    else delete out.selection
    return out
  } catch {
    return null
  }
}

/** A colour in its stored form, or null for anything that is not one. */
function stored(c: unknown): string | null {
  if (typeof c !== 'string') return null
  const p = parseColour(c)
  return p ? toStored(p) : null
}

/**
 * The alpha of the ground in force (#112): the host's picked ground where it
 * has one (Prism Terminal's Background colour), else the Custom theme's own
 * background, 1 for a preset (presets are opaque). The same order as the
 * window paints in. Since #114 this IS the window's see-through under
 * acrylic, in place of the Opacity slider.
 *
 * Where it is the window's see-through it is FLOORED on the way out, as the
 * slider's reader clamped to 30-100 (review of #115): the pickers clamp what
 * they write, but a stored or hand-edited `#12121205` must not paint an all
 * but invisible window. The floor is the byte 30% gives (0x4d), so every
 * value a picker or the migration writes reads unchanged.
 *
 * And there, with the see-through switch on, an OPAQUE ground paints
 * the default see-through (#156, `paintsAlpha`): a preset is no longer 1.
 */
export function termGroundAlpha(): number {
  const a = rawGroundAlpha()
  if (!hostOwnsWindowAcrylic()) return a
  // The ground is only looked up when the default can apply: resolving a
  // theme on every read of an alpha that needs none would be waste.
  const on = termAcrylic()
  return paintsAlpha(a, on && isOpaque(a) ? groundInForce() : '#000000', on)
}
/** The lowest window see-through: Opacity 30's byte, round(0.3 * 255). */
export const GROUND_ALPHA_MIN = 0x4d / 255

/**
 * THE ONE RULE for what a ground paints where the terminal owns the window
 * acrylic (#156), shared by the window (`termGroundAlpha`) and Save changes'
 * dirty check (`useTermSetup`), so the two can never disagree about a saved
 * setup. With the switch on, an OPAQUE ground paints the default see-through
 * (Prism's levels, by the ground light or dark): on means see-through by
 * itself, as Prism's switch does, where before #156 a preset stayed solid and
 * the switch looked broken. A ground that carries an alpha keeps it, floored
 * at 30% as the Opacity slider was.
 */
export function paintsAlpha(raw: number, ground: string, acrylicOn: boolean): number {
  if (acrylicOn && isOpaque(raw)) return seeThroughAlpha(ground)
  return Math.max(GROUND_ALPHA_MIN, raw)
}
/** Opaque BY THE BYTE: an alpha that stores as ff is opaque. */
const isOpaque = (a: number): boolean => Math.round(a * 255) >= 255

/** The ground in force, opaque, in the order the window paints it: the
 *  host's picked one, else the theme's own (a Custom's `bg` included). */
function groundInForce(): string {
  return opaque(hostGround() ?? resolveTermTheme(termThemeId()).background)
}

function rawGroundAlpha(): number {
  const picked = hostGround()
  if (picked) return alphaOf(picked)
  if (termThemeId() === 'custom') {
    const c = customTermTheme()
    if (c) return alphaOf(c.bg)
  }
  return 1
}

/**
 * A palette with the ground alpha IN FORCE on its background (#114), where
 * that alpha is the window's see-through: what Save as Custom saves and what
 * the colour editor opens on, so a see-through window stays see-through
 * through a save (the Opacity slider was carried in the setup the same way).
 * Where the host's style owns the glass (Prism), the palette as it is.
 *
 * It is the alpha the WINDOW paints (`termGroundAlpha`), the default measured
 * from the picked Background where one is in force: what the user saw is what
 * is saved, and what Save changes' dirty check reads back. Measuring from the
 * palette's own ground instead (review of #156) saved a dark Custom under an
 * opaque white pick at b9 while the window and the check stayed at d1, so
 * Save changes stayed lit after every save.
 *
 * Without a pick the ground is the PALETTE's own, not the active theme's:
 * every preset card has an edit button, and a light preset edited under a
 * dark active theme opened, and saved, at the dark level (review of the fix
 * above). For the active theme the two are the same ground.
 */
export function withGroundAlpha<T extends { bg: string }>(palette: T): T {
  if (!hostOwnsWindowAcrylic()) return palette
  const ground = opaque(hostGround() ?? palette.bg)
  return { ...palette, bg: withAlpha(palette.bg, paintsAlpha(rawGroundAlpha(), ground, termAcrylic())) }
}

export function saveCustomTermTheme(theme: CustomTermTheme): void {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(theme))
  notify()
}

export function onTermLookChange(cb: () => void): () => void {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
  }
}

const sub = onTermLookChange

export function useTermThemeId(): string {
  return useSyncExternalStore(sub, termThemeId)
}
export function useTermFontPct(): number {
  return useSyncExternalStore(sub, termFontPct)
}
export function useTermFontId(): string {
  return useSyncExternalStore(sub, termFontId)
}
export function useTermAcrylic(): boolean {
  return useSyncExternalStore(sub, termAcrylic)
}
/** The ground's alpha, re-read when the look OR the host's window colours
 *  change (a picked background is the host's, not this store's). */
export function useTermGroundAlpha(): number {
  return useSyncExternalStore(subGround, termGroundAlpha)
}
function subGround(cb: () => void): () => void {
  const offLook = onTermLookChange(cb)
  const offChrome = onHostChromeChange(cb)
  return () => {
    offLook()
    offChrome()
  }
}
export function useAgentIndicator(): AgentIndicator {
  return useSyncExternalStore(sub, agentIndicator)
}
export function useAgentColorChoice(): string {
  return useSyncExternalStore(sub, agentColorChoice)
}
export function useAgentDoneColorChoice(): string {
  return useSyncExternalStore(sub, agentDoneColorChoice)
}
export function useAgentQuestionColorChoice(): string {
  return useSyncExternalStore(sub, agentQuestionColorChoice)
}
export function useAgentDoneOn(): boolean {
  return useSyncExternalStore(sub, agentDoneOn)
}
export function useAgentQuestionOn(): boolean {
  return useSyncExternalStore(sub, agentQuestionOn)
}
export function useAgentRainbow(): boolean {
  return useSyncExternalStore(sub, agentRainbow)
}
export function useAgentFailedOn(): boolean {
  return useSyncExternalStore(sub, agentFailedOn)
}
export function useAgentHooksOn(): boolean {
  return useSyncExternalStore(sub, agentHooksOn)
}
export function useCustomTermTheme(): CustomTermTheme | null {
  // Cache per notify tick: useSyncExternalStore needs a stable snapshot.
  return useSyncExternalStore(sub, customSnapshot)
}
let customCache: { raw: string | null; value: CustomTermTheme | null } = { raw: null, value: null }
function customSnapshot(): CustomTermTheme | null {
  const raw = localStorage.getItem(CUSTOM_KEY)
  if (raw !== customCache.raw) customCache = { raw, value: customTermTheme() }
  return customCache.value
}
