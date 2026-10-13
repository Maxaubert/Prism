import { deriveAnsi, legiblePalette, normalizeColor, type Ansi16 } from './termAnsi'
import { liveThemeId } from './termThemeRetired'
import { customTermTheme, termThemeId, themeDraft, type CustomTermTheme } from './termLook'
import { composite, legibleOn, opaque, parseColour } from './colour'
import { followsHostStyle, hostDefaults } from '../host'
import { DEFAULT_GROUND } from '../../shared/ground'

// The terminal owns its colours. Inside Prism it could also WEAR THE APP STYLE
// (read --p-bg / --p-text / --p-accent-hi off :root); Prism Terminal has no app
// styles, so that path is gone and the direction is reversed: the chosen
// terminal theme is what drives the window chrome (lib/chromeTheme).

export interface TermTheme extends Partial<Ansi16> {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
}

/**
 * FOLLOWING THE HOST'S STYLE (theme id 'style'). Only where the host HAS styles
 * (Prism): it publishes its surfaces as CSS custom properties on :root, so the
 * terminal reads those instead of owning colours, and a style switch restyles
 * running shells. Prism Terminal has no styles to follow; there the terminal
 * theme drives the window, and `followsHostStyle` is false.
 */

/** Pure: style surfaces in, xterm theme out. Fallbacks are the default dark,
 *  for the moment before the style has painted. */
export function buildTermTheme(bg: string, text: string, accent: string, flatBg?: string): TermTheme {
  const b = bg.trim() || DEFAULT_GROUND
  const t = text.trim() || '#d7dae1'
  const a = accent.trim() || '#5b5bd6'
  // The ANSI sixteen are DERIVED from the base, not assumed: edit a style's
  // background toward red and red text adapts instead of vanishing into it.
  // The maths run against the FLAT surface: an acrylic style publishes an
  // rgba() background, which is fine to PAINT but not to measure against -
  // unparsed it turned every hue pure black.
  return {
    background: b,
    foreground: t,
    cursor: a,
    selectionBackground: `${a}55`,
    ...deriveAnsi(normalizeColor(flatBg?.trim() || b, DEFAULT_GROUND), t)
  }
}

/** What the host's style says, right now. */
export function readTermTheme(): TermTheme {
  const cs = getComputedStyle(document.documentElement)
  return buildTermTheme(
    cs.getPropertyValue('--p-bg'),
    cs.getPropertyValue('--p-text'),
    cs.getPropertyValue('--p-accent-hi'),
    // The flat twin of --p-bg: guaranteed hex, exists exactly because
    // "the contrast maths read it, and neither wants an rgba".
    cs.getPropertyValue('--p-side-flat')
  )
}

/** Call `cb` whenever the host's style repaints :root. Returns the stop function. */
export function watchTermTheme(cb: (t: TermTheme) => void): () => void {
  const mo = new MutationObserver(() => cb(readTermTheme()))
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
  return () => mo.disconnect()
}

/**
 * Preset terminal themes, whole palettes each. Presets rather than variants
 * of the app styles on purpose: a style's material (acrylic, mica, gradients)
 * does not translate into a terminal palette, so half-derived themes looked
 * wrong. Inside Prism the default was 'style' (follow the app); there is no
 * app style here, so the default is the 'prism' preset and a stored 'style'
 * resolves to it.
 */
export interface TermPreset {
  id: string
  name: string
  bg: string
  fg: string
  cursor: string
  /** The window chrome's accent, when the theme has an opinion. Absent, the
   *  chrome takes the palette's blue. */
  accent?: string
  /** A curated full palette (extracted from Tabby's schemes, or the user's
   *  own). Absent, the sixteen are derived from bg/fg by the engine. */
  ansi?: Ansi16
}

/**
 * Preset terminal themes, two kinds. A few carry an exact palette (the owner's
 * PT Default, Nord, Dracula); the rest are BASES: background, foreground,
 * cursor and an accent, their sixteen derived by the same engine
 * (deriveAnsi). Names are the terminal's own, deliberately not Prism's app
 * styles' names.
 */
export const TERM_PRESETS: TermPreset[] = [
  // FEWER, AND EACH ITS OWN (owner, 2026-09-23: "clean up the themes. there's
  // too many similar themes. i want them to be more unique, like sure most
  // should be normal themes grey, white, black, and so on. but have some brown
  // themes, pink, green, etc"). The forty near-copies became sixteen, then the
  // next day forty again, each distinct (see "FORTY" below): the neutrals
  // first (the app's own four, a plain grey, Volt's yellow-green on black, a white and a light
  // grey), a pair, dark and light, per colour: brown, pink, green; then the
  // classic terminal looks, more colours, and the well-known schemes. A retired
  // theme is not a dead end: RETIRED_THEMES (termThemeRetired.ts) moves whoever
  // wore it to the nearest one kept. The original themes give their base
  // colours only; the sixteen are derived, which clears the legibility floor
  // by construction.

  // PT DEFAULT is the owner's own palette (2026-09-22, saved as Custom and handed
  // over: "let this be the default theme ... for prism terminal"): Wombat's
  // colours on a darker #121212, the two blacks lifted so they read, and the
  // app icon's orange as the accent. Prism Terminal's default; a preset like
  // any other everywhere else.
  {
    id: 'pt-default',
    name: 'PT Default',
    bg: '#121212',
    fg: '#dedacf',
    cursor: '#bbbbbb',
    accent: '#fe8f34',
    ansi: { black: '#646464', red: '#ff615a', green: '#b1e969', yellow: '#ebd99c', blue: '#5da9f6', magenta: '#e86aff', cyan: '#82fff7', white: '#dedacf', brightBlack: '#6b6b6b', brightRed: '#f58c80', brightGreen: '#ddf88f', brightYellow: '#eee5b2', brightBlue: '#a5c7ff', brightMagenta: '#ddaaff', brightCyan: '#b7fff9', brightWhite: '#ffffff' }
  },
  // Prism's own dark look: what the terminal wore by default inside Prism.
  { id: 'prism', name: 'Prism', bg: DEFAULT_GROUND, fg: '#e7e7ee', cursor: '#7c7cf0', accent: '#5b5bd6' },
  // THE APP ICON'S TWO THEMES (owner, 2026-09-21: "two themes that match the
  // app icon colour scheme, one with orange and black, and one with orange and
  // dark grey"). The icon is orange #ec9448 over a charcoal and dark-grey
  // swirl, with a cream chevron. The ACCENT is the icon's orange too, so the
  // chrome (the active tab, the update chip, a selection) wears it as well as
  // the cursor.
  {
    id: 'pitch',
    name: 'Pitch',
    bg: '#000000',
    // The icon's cream, dimmed a touch: pure #fbeedd on black glares.
    fg: '#efe7da',
    cursor: '#ec9448',
    accent: '#ec9448'
  },
  {
    id: 'cinder',
    name: 'Cinder',
    // The icon's own dark grey, the swirl's body: grey, and meant to read as
    // grey beside Pitch's black rather than as a second black.
    bg: '#383c44',
    fg: '#f3eadc',
    cursor: '#ec9448',
    accent: '#ec9448'
  },
  // A plain grey, no tint and no opinion: the neutral the others are not.
  { id: 'graphite', name: 'Graphite', bg: '#1f1f1f', fg: '#d6d6d6', cursor: '#d6d6d6', accent: '#9a9a9a' },
  // VOLT (owner, 2026-09-28, a screenshot of a black page with one
  // yellow-green button: "make one of the black themes this colour scheme ...
  // kind of cyberpunk style"). It took Ink's place: Ink was a blue-black
  // next to Prism and Tokyo Night, the one black the forty could lose.
  // Its own sixteen, neon on black: the lime as the green (the prompt), a
  // yellow beside it, cyan and a hot pink for the rest.
  {
    id: 'volt',
    name: 'Volt',
    bg: '#050706',
    fg: '#eef2e6',
    cursor: '#d8ff26',
    accent: '#d8ff26',
    ansi: { black: '#3a4234', red: '#ff3b5c', green: '#c6f41f', yellow: '#f4ff52', blue: '#38b6ff', magenta: '#ff4fd8', cyan: '#22f0d0', white: '#d9dfd0', brightBlack: '#6b7562', brightRed: '#ff7088', brightGreen: '#e2ff5c', brightYellow: '#fbff9a', brightBlue: '#7cd0ff', brightMagenta: '#ff8ae5', brightCyan: '#78ffe8', brightWhite: '#ffffff' }
  },
  { id: 'paper', name: 'Paper', bg: '#f6f4ee', fg: '#2a2620', cursor: '#3a63c2' },
  // A light grey, cooler than Paper's cream.
  { id: 'mist', name: 'Mist', bg: '#e4e4e2', fg: '#26262a', cursor: '#4a4a52', accent: '#5c5c66' },
  // BROWN AND BEIGE (owner: "i want a noctua theme, don't call it that but use
  // that nice brown beige colour scheme"). The beige of the fan frame and the
  // brown of its blades: Umber is the brown ground with beige text, Fawn the
  // beige ground with brown text.
  { id: 'umber', name: 'Umber', bg: '#2b211b', fg: '#e8d8c0', cursor: '#d9b38c', accent: '#c4966a' },
  { id: 'fawn', name: 'Fawn', bg: '#e6d8c0', fg: '#3d2a1f', cursor: '#7a4e35', accent: '#8a5a3c' },
  // Pink: a dusk rose, and a pale blossom.
  { id: 'rosewood', name: 'Rosewood', bg: '#24161d', fg: '#f2dce5', cursor: '#ee85aa', accent: '#e4719a' },
  { id: 'blossom', name: 'Blossom', bg: '#fbeef2', fg: '#3b2230', cursor: '#c64a78', accent: '#c64a78' },
  // Green: a deep moss, and a pale sage.
  { id: 'moss', name: 'Moss', bg: '#141c16', fg: '#d8e4d2', cursor: '#8cc07a', accent: '#78ad66' },
  { id: 'sage', name: 'Sage', bg: '#e9efe5', fg: '#223024', cursor: '#4c7d47', accent: '#4c7d47' },

  // FORTY, AS THE TRAILER SAYS (owner, 2026-09-24: "make more themes so we have
  // 40 themes total like the trailer says. verify all themes look good, no
  // invisible text, make some typical colour schemes like a green window, blue,
  // and more fun ones like the noctua and pink one we have, don't make them
  // ugly though"). Every one is held by termTheme.legible.test.ts: the text,
  // the cursor, the accent and all sixteen colours against its own ground.

  // The classic terminal looks: a green and an amber screen, the old PowerShell
  // blue window, the Commodore's blue, the Windows console's own scheme (High Contrast was
  // removed, owner 2026-10-11).
  { id: 'phosphor', name: 'Phosphor', bg: '#050d06', fg: '#7ef08a', cursor: '#7ef08a', accent: '#3fcf5a' },
  { id: 'amber', name: 'Amber', bg: '#110b02', fg: '#ffbf5a', cursor: '#ffbf5a', accent: '#f0a030' },
  { id: 'marine', name: 'Marine', bg: '#012456', fg: '#eeedf0', cursor: '#ffd866', accent: '#ffd866' },
  { id: 'retro', name: 'Retro', bg: '#352879', fg: '#b3adf0', cursor: '#b3adf0', accent: '#9d93ea' },
  {
    id: 'campbell',
    name: 'Campbell',
    bg: '#0c0c0c',
    fg: '#cccccc',
    cursor: '#ffffff',
    accent: '#3b78ff',
    ansi: { black: '#0c0c0c', red: '#c50f1f', green: '#13a10e', yellow: '#c19c00', blue: '#0037da', magenta: '#881798', cyan: '#3a96dd', white: '#cccccc', brightBlack: '#767676', brightRed: '#e74856', brightGreen: '#16c60c', brightYellow: '#f9f1a5', brightBlue: '#3b78ff', brightMagenta: '#b4009e', brightCyan: '#61d6d6', brightWhite: '#f2f2f2' }
  },

  // More colours, dark and light, in the spirit of Umber and Blossom.
  { id: 'ocean', name: 'Ocean', bg: '#0a2630', fg: '#d3eef2', cursor: '#5fd4e0', accent: '#3fb8c8' },
  { id: 'garnet', name: 'Garnet', bg: '#1f0d10', fg: '#f3dadd', cursor: '#ff6b7d', accent: '#e2475c' },
  { id: 'plum', name: 'Plum', bg: '#1c1226', fg: '#e9ddf5', cursor: '#c792ea', accent: '#b07ce0' },
  { id: 'lavender', name: 'Lavender', bg: '#f1edfa', fg: '#2e2540', cursor: '#7c5cc4', accent: '#7c5cc4' },
  { id: 'sky', name: 'Sky', bg: '#eaf4fd', fg: '#1c2b3a', cursor: '#2f7bd6', accent: '#2f7bd6' },
  { id: 'peach', name: 'Peach', bg: '#fdeee3', fg: '#3e2a20', cursor: '#c9632f', accent: '#c05e2c' },
  { id: 'butter', name: 'Butter', bg: '#fbf5d8', fg: '#3a3320', cursor: '#9a7300', accent: '#8f6b00' },
  { id: 'mint', name: 'Mint', bg: '#e5f6ef', fg: '#1d3129', cursor: '#1a8a64', accent: '#17805c' },

  // Well-known schemes, in their real colours: a scheme called Monokai that is
  // not Monokai would be a lie. Where one of their sixteen falls under the
  // floor (Solarized's darkest, Latte's white), legiblePalette moves only that
  // one, and only as far as the floor.
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    bg: '#002b36',
    fg: '#93a1a1',
    cursor: '#93a1a1',
    accent: '#268bd2',
    ansi: { black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5', brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#93a1a1', brightYellow: '#839496', brightBlue: '#6c9fd8', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3' }
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    bg: '#282828',
    fg: '#ebdbb2',
    cursor: '#ebdbb2',
    accent: '#fe8019',
    ansi: { black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984', brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2' }
  },
  {
    id: 'tokyonight',
    name: 'Tokyo Night',
    bg: '#1a1b26',
    fg: '#c0caf5',
    cursor: '#c0caf5',
    accent: '#7aa2f7',
    ansi: { black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6', brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5' }
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    bg: '#1e1e2e',
    fg: '#cdd6f4',
    cursor: '#f5e0dc',
    accent: '#cba6f7',
    ansi: { black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de', brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1', brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7', brightCyan: '#94e2d5', brightWhite: '#a6adc8' }
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    bg: '#eff1f5',
    fg: '#4c4f69',
    // Latte's own cursor (rosewater, #dc8a78) is 2.3:1 on this ground and
    // goes missing; its mauve, the scheme's accent, is the cursor here.
    cursor: '#8839ef',
    accent: '#8839ef',
    ansi: { black: '#5c5f77', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d', blue: '#1e66f5', magenta: '#ea76cb', cyan: '#179299', white: '#acb0be', brightBlack: '#6c6f85', brightRed: '#d20f39', brightGreen: '#40a02b', brightYellow: '#df8e1d', brightBlue: '#1e66f5', brightMagenta: '#ea76cb', brightCyan: '#179299', brightWhite: '#bcc0cc' }
  },
  {
    id: 'monokai',
    name: 'Monokai',
    bg: '#272822',
    fg: '#f8f8f2',
    cursor: '#f8f8f0',
    accent: '#a6e22e',
    ansi: { black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75', blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2', brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#f4bf75', brightBlue: '#66d9ef', brightMagenta: '#ae81ff', brightCyan: '#a1efe4', brightWhite: '#f9f8f5' }
  },
  {
    id: 'kanagawa',
    name: 'Kanagawa',
    bg: '#1f1f28',
    fg: '#dcd7ba',
    cursor: '#c8c093',
    accent: '#7e9cd8',
    ansi: { black: '#16161d', red: '#c34043', green: '#76946a', yellow: '#c0a36e', blue: '#7e9cd8', magenta: '#957fb8', cyan: '#6a9589', white: '#c8c093', brightBlack: '#727169', brightRed: '#e82424', brightGreen: '#98bb6c', brightYellow: '#e6c384', brightBlue: '#7fb4ca', brightMagenta: '#938aa9', brightCyan: '#7aa89f', brightWhite: '#dcd7ba' }
  },
  {
    id: 'cobalt',
    name: 'Cobalt',
    bg: '#193549',
    fg: '#ffffff',
    cursor: '#ffc600',
    accent: '#ffc600',
    ansi: { black: '#000000', red: '#ff628c', green: '#3ad900', yellow: '#ffc600', blue: '#1478db', magenta: '#ff9d00', cyan: '#80fcff', white: '#bbbbbb', brightBlack: '#6f8fa6', brightRed: '#ff628c', brightGreen: '#3ad900', brightYellow: '#ffe57f', brightBlue: '#5fa8ff', brightMagenta: '#fb94ff', brightCyan: '#9effff', brightWhite: '#ffffff' }
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    bg: '#262335',
    fg: '#f0eff1',
    cursor: '#ff7edb',
    accent: '#ff7edb',
    ansi: { black: '#262335', red: '#fe4450', green: '#72f1b8', yellow: '#fede5d', blue: '#03edf9', magenta: '#ff7edb', cyan: '#03edf9', white: '#ffffff', brightBlack: '#8a7ab5', brightRed: '#fe4450', brightGreen: '#72f1b8', brightYellow: '#fede5d', brightBlue: '#03edf9', brightMagenta: '#ff7edb', brightCyan: '#03edf9', brightWhite: '#ffffff' }
  },
  {
    id: 'horizon',
    name: 'Horizon',
    bg: '#1c1e26',
    fg: '#d5d8da',
    cursor: '#e95678',
    accent: '#e95678',
    ansi: { black: '#16161c', red: '#e95678', green: '#29d398', yellow: '#fab795', blue: '#26bbd9', magenta: '#ee64ac', cyan: '#59e1e3', white: '#d5d8da', brightBlack: '#6f6f70', brightRed: '#ec6a88', brightGreen: '#3fdaa4', brightYellow: '#fbc3a7', brightBlue: '#3fc4de', brightMagenta: '#f075b5', brightCyan: '#6be4e6', brightWhite: '#d5d8da' }
  },

  // The two public schemes kept from the first list, in their real colours.
  {
    id: 'nord',
    name: 'Nord',
    bg: '#2e3440',
    fg: '#d8dee9',
    cursor: '#d8dee9',
    ansi: { black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0', brightBlack: '#373e4d', brightRed: '#94545d', brightGreen: '#809575', brightYellow: '#b29e75', brightBlue: '#68809a', brightMagenta: '#8c738c', brightCyan: '#6d96a5', brightWhite: '#aeb3bb' }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    bg: '#1e1f29',
    fg: '#f8f8f2',
    cursor: '#bbbbbb',
    ansi: { black: '#000000', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#bbbbbb', brightBlack: '#555555', brightRed: '#ff5555', brightGreen: '#50fa7b', brightYellow: '#f1fa8c', brightBlue: '#bd93f9', brightMagenta: '#ff79c6', brightCyan: '#8be9fd', brightWhite: '#ffffff' }
  }
]

/** What an unknown id, and the legacy 'style', resolve to. */
export const DEFAULT_TERM_THEME = 'prism'

/** The chrome accent a theme asks for, if it asks: a preset's own, the one a
 *  Custom was saved with, or the colour editor's draft while it is open on
 *  the theme in force. A Custom saved before it carried one asks for none,
 *  and the chrome takes the palette's blue (owner, 2026-10-12: PT Default,
 *  its cursor edited and saved, "changed the accent colour to blue"). */
export function presetAccent(themeId: string): string | undefined {
  const draft = themeDraft()
  if (draft && themeId === termThemeId()) return draft.accent
  if (themeId === 'custom') return customTermTheme()?.accent
  return TERM_PRESETS.find((x) => x.id === liveThemeId(themeId))?.accent
}

/**
 * A Custom palette as the terminal draws it (see `resolveTermTheme`), from the
 * palette itself rather than the store: the theme editor's preview and its
 * derived Selection read a DRAFT, and the wall's Custom card reads the saved
 * one, and both must show what the terminal shows (#113 review: raw alphas
 * drew a 30% foreground the terminal floors to 4.5:1).
 */
export function resolveCustomTheme(c: CustomTermTheme, ground?: string | null): TermTheme {
  const own = opaque(c.bg, DEFAULT_GROUND)
  const g = ground && parseColour(ground) ? opaque(ground) : own
  const cursor = legibleOn(c.cursor, g, 3)
  const ansi: Record<string, string> = {}
  for (const [k, v] of Object.entries(c.ansi)) ansi[k] = composite(v, g)
  return {
    background: c.bg,
    foreground: legibleOn(c.fg, g, 4.5),
    cursor,
    // A chosen selection keeps its alpha; else the cursor's, derived as it
    // always was (from the OPAQUE cursor: a hex8 one gave ten digits).
    selectionBackground: c.selection ?? `${cursor}55`,
    ...legiblePalette(ansi, own)
  }
}

/**
 * `ground`: the colour the terminal is really painted on, where the host lets
 * somebody pick one (`terminalGround`); absent, the theme's own background.
 *
 * A CUSTOM COLOUR MAY CARRY AN ALPHA (#112). Its text, cursor and sixteen are
 * composited ONCE against the ground in force and handed on opaque, because
 * xterm blends its text against a canvas that is clear here. The text is held
 * to 4.5:1 and the cursor to 3:1, but never above the contrast of the user's
 * own opaque pick (`legibleOn`): at alpha 1 nothing moves, so an opaque Custom
 * resolves byte for byte as it always did, a failing cursor included. The
 * sixteen are floored by `legiblePalette` as before, on the composites.
 */
export function resolveTermTheme(themeId: string, ground?: string | null): TermTheme {
  // THE COLOUR EDITOR'S DRAFT IS WORN (owner, 2026-10-12: "have it apply
  // instantly so that I can ctrl tab to see how it actually looks"): while it
  // is open, the theme in force is what it holds, for the terminal and the
  // chrome alike. Only the theme in force: a card for any other is its own.
  const draft = themeDraft()
  if (draft && themeId === termThemeId()) return resolveCustomTheme(draft, ground)
  return resolveSavedTheme(themeId, ground)
}

/** A theme as saved, never the editor's draft: a preset's card and the palette
 *  the editor opens with read this, so neither ever shows (or caches) a draft. */
export function resolveSavedTheme(themeId: string, ground?: string | null): TermTheme {
  // The host's own style, where it has one to follow.
  if (themeId === 'style' && followsHostStyle()) return readTermTheme()
  if (themeId === 'custom') {
    const c = customTermTheme()
    if (c) return resolveCustomTheme(c, ground)
  }
  // DEFAULT_TERM_THEME is in the list; that find cannot miss, the last fallback is for the type.
  const p =
    TERM_PRESETS.find((x) => x.id === liveThemeId(themeId)) ??
    // An id nothing answers to: the host's own default, where that is a preset.
    TERM_PRESETS.find((x) => x.id === hostDefaults().theme) ??
    TERM_PRESETS.find((x) => x.id === DEFAULT_TERM_THEME) ??
    TERM_PRESETS[0]
  return {
    background: p.bg,
    foreground: p.fg,
    cursor: p.cursor,
    selectionBackground: `${p.cursor}55`,
    // A curated palette is taste and stays as exact as legibility allows:
    // only a colour that fails the floor against the background moves, and
    // only as far as the floor (owner, 2026-09-04). Base-only presets get
    // the derived sixteen, which clear it by construction.
    ...legiblePalette(p.ansi ?? deriveAnsi(p.bg, p.fg), p.bg)
  }
}
