// The terminal wears the style. Styles publish their surfaces as CSS custom
// properties on :root (--p-bg, --p-text, --p-accent-hi), so the terminal reads
// those instead of owning colours: the void style gets a black terminal, a
// light style gets a light one, and a style switch restyles running shells.

export interface TermTheme {
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
  return { background: b, foreground: t, cursor: a, selectionBackground: `${a}55` }
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
