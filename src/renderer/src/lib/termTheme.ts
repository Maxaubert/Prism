// The terminal wears the style. Styles publish their surfaces as CSS custom
// properties on :root (--p-bg, --p-text, --p-accent-hi), so the terminal reads
// those instead of owning colours: the void style gets a black terminal, a
// light style gets a light one, and a style switch restyles running shells.

export interface TermTheme {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  /** The 16 ANSI colours, when a preset defines them. Following the style
   *  leaves them at xterm's defaults. */
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  magenta?: string
  cyan?: string
  white?: string
  brightBlack?: string
  brightRed?: string
  brightGreen?: string
  brightYellow?: string
  brightBlue?: string
  brightMagenta?: string
  brightCyan?: string
  brightWhite?: string
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

/**
 * Preset terminal themes, whole palettes each. Presets rather than variants
 * of the app styles on purpose: a style's material (acrylic, mica, gradients)
 * does not translate into a terminal palette, so half-derived themes looked
 * wrong. 'style' - the default - is not in this list; it means readTermTheme.
 */
export const TERM_PRESETS: Array<{ id: string; name: string; theme: TermTheme }> = [
  {
    id: 'void',
    name: 'Void',
    theme: { background: '#000000', foreground: '#e6e6e6', cursor: '#ffffff', selectionBackground: '#e6e6e644' }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    theme: {
      background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#44475a99',
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9',
      magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2', brightBlack: '#6272a4', brightRed: '#ff6e6e',
      brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
      brightCyan: '#a4ffff', brightWhite: '#ffffff'
    }
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    theme: {
      background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selectionBackground: '#586e7599',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2',
      magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5', brightBlack: '#586e75', brightRed: '#cb4b16',
      brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1', brightWhite: '#fdf6e3'
    }
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    theme: {
      background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selectionBackground: '#66592399',
      black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588',
      magenta: '#b16286', cyan: '#689d6a', white: '#a89984', brightBlack: '#928374', brightRed: '#fb4934',
      brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b',
      brightCyan: '#8ec07c', brightWhite: '#ebdbb2'
    }
  },
  {
    id: 'nord',
    name: 'Nord',
    theme: {
      background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selectionBackground: '#434c5e99',
      black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1',
      magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0', brightBlack: '#4c566a', brightRed: '#bf616a',
      brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb', brightWhite: '#eceff4'
    }
  }
]

/** The theme the settings say, resolved: a preset by id, else follow-style. */
export function resolveTermTheme(themeId: string): TermTheme {
  return TERM_PRESETS.find((p) => p.id === themeId)?.theme ?? readTermTheme()
}
