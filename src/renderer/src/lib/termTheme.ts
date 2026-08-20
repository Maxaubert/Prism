import { deriveAnsi, type Ansi16 } from './termAnsi'

// The terminal wears the style. Styles publish their surfaces as CSS custom
// properties on :root (--p-bg, --p-text, --p-accent-hi), so the terminal reads
// those instead of owning colours: the void style gets a black terminal, a
// light style gets a light one, and a style switch restyles running shells.

export interface TermTheme extends Partial<Ansi16> {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
}

/** Pure: style surfaces in, xterm theme out. Fallbacks are the app's default
 *  dark, for the moment before the style has painted. */
export function buildTermTheme(bg: string, text: string, accent: string): TermTheme {
  const b = bg.trim() || '#0b0b0f'
  const t = text.trim() || '#d7dae1'
  const a = accent.trim() || '#5b5bd6'
  // The ANSI sixteen are DERIVED from the base, not assumed: edit a style's
  // background toward red and red text adapts instead of vanishing into it.
  return { background: b, foreground: t, cursor: a, selectionBackground: `${a}55`, ...deriveAnsi(b, t) }
}

/** What the current style says, right now. */
export function readTermTheme(): TermTheme {
  const cs = getComputedStyle(document.documentElement)
  return buildTermTheme(
    cs.getPropertyValue('--p-bg'),
    cs.getPropertyValue('--p-text'),
    cs.getPropertyValue('--p-accent-hi')
  )
}

/** Call `cb` whenever the style repaints :root. Returns the stop function. */
export function watchTermTheme(cb: (t: TermTheme) => void): () => void {
  const mo = new MutationObserver(() => cb(readTermTheme()))
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
  return () => mo.disconnect()
}

/**
 * Preset terminal themes, whole palettes each. Presets rather than variants
 * of the app styles on purpose: a style's material (acrylic, mica, gradients)
 * does not translate into a terminal palette, so half-derived themes looked
 * wrong. 'style' - the default - is not in this list; it means readTermTheme.
 */
export interface TermPreset {
  id: string
  name: string
  bg: string
  fg: string
  cursor: string
}

/**
 * Preset terminal themes: BASES, not palettes. Each names a background,
 * foreground and cursor; the sixteen ANSI colours come from the same
 * derivation the follow-style path uses, so every preset carries the same
 * readability guarantees and there is one palette engine to verify, not six
 * hand-tuned blobs. The names are the terminal's own - deliberately not the
 * app styles' names, because these are not those themes.
 */
export const TERM_PRESETS: TermPreset[] = [
  { id: 'pitch', name: 'Pitch', bg: '#000000', fg: '#e6e6e6', cursor: '#ffffff' },
  { id: 'ink', name: 'Ink', bg: '#0d1117', fg: '#dbe2ea', cursor: '#7aa5d8' },
  { id: 'cinder', name: 'Cinder', bg: '#191214', fg: '#e8dcd8', cursor: '#e0955e' },
  { id: 'denim', name: 'Denim', bg: '#142033', fg: '#d9e4f2', cursor: '#8fb7e8' },
  { id: 'paper', name: 'Paper', bg: '#f6f4ee', fg: '#2a2620', cursor: '#3a63c2' }
]

/** The theme the settings say, resolved: a preset by id, else follow-style. */
export function resolveTermTheme(themeId: string): TermTheme {
  const p = TERM_PRESETS.find((x) => x.id === themeId)
  if (!p) return readTermTheme() // unknown ids (old saves) follow the style
  return {
    background: p.bg,
    foreground: p.fg,
    cursor: p.cursor,
    selectionBackground: `${p.cursor}55`,
    ...deriveAnsi(p.bg, p.fg)
  }
}
