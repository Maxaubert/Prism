import { useSyncExternalStore } from 'react'

// The terminal's persisted look: which theme it wears and its base font size.
// Same tiny-store shape as tabPrefs. Per-SESSION font zoom (Ctrl+scroll) is
// deliberately NOT here: that lives and dies with the session.

const THEME_KEY = 'prism.term.theme'
const FONT_KEY = 'prism.term.fontPct'

export const TERM_BASE_FONT_PX = 13
export const FONT_PCTS = [80, 90, 100, 110, 125, 150] as const

let listeners: Array<() => void> = []
const notify = (): void => listeners.forEach((l) => l())

/** 'style' follows the app style (the default); anything else names a preset. */
export function termThemeId(): string {
  return localStorage.getItem(THEME_KEY) ?? 'style'
}

export function setTermThemeId(id: string): void {
  localStorage.setItem(THEME_KEY, id)
  notify()
}

const FONT_FAMILY_KEY = 'prism.term.font'

/** Monospace faces worth offering on Windows; each falls back to the stack's
 *  next face when not installed, so picking a missing one degrades quietly. */
export const TERM_FONTS = [
  { id: 'cascadia', name: 'Cascadia Mono', stack: '"Cascadia Mono", Consolas, monospace' },
  { id: 'cascadia-code', name: 'Cascadia Code', stack: '"Cascadia Code", "Cascadia Mono", Consolas, monospace' },
  { id: 'consolas', name: 'Consolas', stack: 'Consolas, "Cascadia Mono", monospace' },
  { id: 'jetbrains', name: 'JetBrains Mono', stack: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace' },
  { id: 'fira', name: 'Fira Code', stack: '"Fira Code", "Cascadia Mono", Consolas, monospace' },
  { id: 'source', name: 'Source Code Pro', stack: '"Source Code Pro", "Cascadia Mono", Consolas, monospace' },
  { id: 'lucida', name: 'Lucida Console', stack: '"Lucida Console", Consolas, monospace' },
  { id: 'courier', name: 'Courier New', stack: '"Courier New", Courier, monospace' }
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
  const v = Number(localStorage.getItem(FONT_KEY))
  return FONT_PCTS.includes(v as (typeof FONT_PCTS)[number]) ? v : 100
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

/** Whether the follow-style terminal shares the window's acrylic background
 *  (its own canvas goes transparent, the app surface shows through). On by
 *  default; presets keep their own opaque colours either way. */
export function termAcrylic(): boolean {
  return localStorage.getItem(ACRYLIC_KEY) !== '0'
}

export function setTermAcrylic(on: boolean): void {
  localStorage.setItem(ACRYLIC_KEY, on ? '1' : '0')
  notify()
}

const AGENT_IND_KEY = 'prism.term.agentIndicator'

export type AgentIndicator = 'off' | 'minimal' | 'full'

/** How a working agent shows on its tab: not at all, an icon plus a left edge
 *  bar, or the whole tab turning. Full is the default - the point of the
 *  indicator is to be seen across a row of tabs. Idle always looks default;
 *  only WORKING paints. */
export function agentIndicator(): AgentIndicator {
  const v = localStorage.getItem(AGENT_IND_KEY)
  return v === 'minimal' || v === 'off' ? v : 'full'
}

export function setAgentIndicator(v: AgentIndicator): void {
  localStorage.setItem(AGENT_IND_KEY, v)
  notify()
}

const AGENT_COLOR_KEY = 'prism.term.agentColor'
const AGENT_COLOR_DEFAULT = '#f97316'

/** The working colour: the full tab's fill, the minimal icon's tint. */
export function agentColor(): string {
  const v = localStorage.getItem(AGENT_COLOR_KEY)
  return v && /^#[0-9a-f]{6}$/i.test(v) ? v : AGENT_COLOR_DEFAULT
}

export function setAgentColor(hex: string): void {
  localStorage.setItem(AGENT_COLOR_KEY, hex)
  notify()
}

const CUSTOM_KEY = 'prism.term.custom'

export interface CustomTermTheme {
  bg: string
  fg: string
  cursor: string
  ansi: Record<string, string>
  /** The rest of the terminal setup, captured by "Save changes": the look is
   *  more than the palette. All optional - older saves carry colours only. */
  font?: string
  fontPct?: number
  indicator?: AgentIndicator
  indicatorColor?: string
  acrylic?: boolean
}

/** What every non-colour terminal setting is out of the box. Picking any
 *  theme returns to these; deviating from them is what "Save changes" saves. */
export const TERM_EXTRA_DEFAULTS = {
  font: 'cascadia',
  fontPct: 100,
  indicator: 'full' as AgentIndicator,
  indicatorColor: AGENT_COLOR_DEFAULT,
  acrylic: true
}

/** Selecting a theme overwrites the terminal settings with their defaults:
 *  the theme is the whole setup, not just the palette. */
export function resetTermExtras(): void {
  localStorage.removeItem(FONT_FAMILY_KEY)
  localStorage.removeItem(FONT_KEY)
  localStorage.removeItem(AGENT_IND_KEY)
  localStorage.removeItem(AGENT_COLOR_KEY)
  localStorage.removeItem(ACRYLIC_KEY)
  notify()
}

/** Re-apply the non-colour half of a saved Custom setup, when it has one. */
export function applyCustomExtras(t: CustomTermTheme | null): void {
  if (!t) return
  if (t.font) setTermFontId(t.font)
  if (t.fontPct) localStorage.setItem(FONT_KEY, String(t.fontPct))
  if (t.indicator) localStorage.setItem(AGENT_IND_KEY, t.indicator)
  if (t.indicatorColor) localStorage.setItem(AGENT_COLOR_KEY, t.indicatorColor)
  if (t.acrylic !== undefined) localStorage.setItem(ACRYLIC_KEY, t.acrylic ? '1' : '0')
  notify()
}

/** The user's ONE custom theme, or null before any save. Saving overwrites:
 *  like Tabby, there is a single Custom slot, edited and re-saved. */
export function customTermTheme(): CustomTermTheme | null {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as CustomTermTheme
    return typeof v.bg === 'string' && typeof v.fg === 'string' ? v : null
  } catch {
    return null
  }
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
export function useAgentIndicator(): AgentIndicator {
  return useSyncExternalStore(sub, agentIndicator)
}
export function useAgentColor(): string {
  return useSyncExternalStore(sub, agentColor)
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
