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
