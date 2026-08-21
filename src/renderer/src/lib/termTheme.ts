import { deriveAnsi, normalizeColor, type Ansi16 } from './termAnsi'
import { customTermTheme } from './termLook'

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
export function buildTermTheme(bg: string, text: string, accent: string, flatBg?: string): TermTheme {
  const b = bg.trim() || '#0b0b0f'
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
    ...deriveAnsi(normalizeColor(flatBg?.trim() || b, '#101215'), t)
  }
}

/** What the current style says, right now. */
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
  /** A curated full palette (extracted from Tabby's schemes, or the user's
   *  own). Absent, the sixteen are derived from bg/fg by the engine. */
  ansi?: Ansi16
}

/**
 * Preset terminal themes, two kinds. The first block is EXTRACTED palettes -
 * the user's own Bright Lights (from their Tabby config) and a pick of
 * Tabby's community schemes, exact colours kept. The second block is BASES:
 * background/foreground/cursor only, their sixteen derived by the same
 * engine the follow-style path uses. Names are the terminal's own,
 * deliberately not the app styles' names.
 */
export const TERM_PRESETS: TermPreset[] = [
  {
    id: 'bright-lights',
    name: 'Bright Lights',
    bg: '#000000',
    fg: '#ffffff',
    cursor: '#f34b00',
    ansi: { black: '#191919', red: '#ff355b', green: '#b7e876', yellow: '#ffc251', blue: '#ef5350', magenta: '#ba76e7', cyan: '#6cbfb5', white: '#c2c8d7', brightBlack: '#191919', brightRed: '#ff355b', brightGreen: '#b7e876', brightYellow: '#ffc251', brightBlue: '#76d5ff', brightMagenta: '#ba76e7', brightCyan: '#6cbfb5', brightWhite: '#c2c8d7' }
  },
  { id: 'pitch', name: 'Pitch', bg: '#000000', fg: '#e6e6e6', cursor: '#ffffff' },
  {
    id: 'molokai',
    name: 'Molokai',
    bg: '#121212',
    fg: '#bbbbbb',
    cursor: '#bbbbbb',
    ansi: { black: '#121212', red: '#fa2573', green: '#98e123', yellow: '#dfd460', blue: '#1080d0', magenta: '#8700ff', cyan: '#43a8d0', white: '#bbbbbb', brightBlack: '#555555', brightRed: '#f6669d', brightGreen: '#b1e05f', brightYellow: '#fff26d', brightBlue: '#00afff', brightMagenta: '#af87ff', brightCyan: '#51ceff', brightWhite: '#ffffff' }
  },
  {
    id: 'jellybeans',
    name: 'Jellybeans',
    bg: '#121212',
    fg: '#dedede',
    cursor: '#ffa560',
    ansi: { black: '#929292', red: '#e27373', green: '#94b979', yellow: '#ffba7b', blue: '#97bedc', magenta: '#e1c0fa', cyan: '#00988e', white: '#dedede', brightBlack: '#bdbdbd', brightRed: '#ffa1a1', brightGreen: '#bddeab', brightYellow: '#ffdca0', brightBlue: '#b1d8f6', brightMagenta: '#fbdaff', brightCyan: '#1ab2a8', brightWhite: '#ffffff' }
  },
  {
    id: 'wombat',
    name: 'Wombat',
    bg: '#171717',
    fg: '#dedacf',
    cursor: '#bbbbbb',
    ansi: { black: '#000000', red: '#ff615a', green: '#b1e969', yellow: '#ebd99c', blue: '#5da9f6', magenta: '#e86aff', cyan: '#82fff7', white: '#dedacf', brightBlack: '#313131', brightRed: '#f58c80', brightGreen: '#ddf88f', brightYellow: '#eee5b2', brightBlue: '#a5c7ff', brightMagenta: '#ddaaff', brightCyan: '#b7fff9', brightWhite: '#ffffff' }
  },
  {
    id: 'hybrid',
    name: 'Hybrid',
    bg: '#161719',
    fg: '#b7bcba',
    cursor: '#b7bcba',
    ansi: { black: '#2a2e33', red: '#b84d51', green: '#b3bf5a', yellow: '#e4b55e', blue: '#6e90b0', magenta: '#a17eac', cyan: '#7fbfb4', white: '#b5b9b6', brightBlack: '#1d1f22', brightRed: '#8d2e32', brightGreen: '#798431', brightYellow: '#e58a50', brightBlue: '#4b6b88', brightMagenta: '#6e5079', brightCyan: '#4d7b74', brightWhite: '#5a626a' }
  },
  {
    id: 'monokai-soda',
    name: 'Monokai Soda',
    bg: '#1a1a1a',
    fg: '#c4c5b5',
    cursor: '#f6f7ec',
    ansi: { black: '#1a1a1a', red: '#f4005f', green: '#98e024', yellow: '#fa8419', blue: '#9d65ff', magenta: '#f4005f', cyan: '#58d1eb', white: '#c4c5b5', brightBlack: '#625e4c', brightRed: '#f4005f', brightGreen: '#98e024', brightYellow: '#e0d561', brightBlue: '#9d65ff', brightMagenta: '#f4005f', brightCyan: '#58d1eb', brightWhite: '#f6f6ef' }
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    bg: '#1e1e1e',
    fg: '#e6d4a3',
    cursor: '#bbbbbb',
    ansi: { black: '#161819', red: '#f73028', green: '#aab01e', yellow: '#f7b125', blue: '#719586', magenta: '#c77089', cyan: '#7db669', white: '#faefbb', brightBlack: '#7f7061', brightRed: '#be0f17', brightGreen: '#868715', brightYellow: '#cc881a', brightBlue: '#377375', brightMagenta: '#a04b73', brightCyan: '#578e57', brightWhite: '#e6d4a3' }
  },
  {
    id: 'jetbrains-darcula',
    name: 'JetBrains Darcula',
    bg: '#202020',
    fg: '#adadad',
    cursor: '#ffffff',
    ansi: { black: '#000000', red: '#fa5355', green: '#126e00', yellow: '#c2c300', blue: '#4581eb', magenta: '#fa54ff', cyan: '#33c2c1', white: '#adadad', brightBlack: '#555555', brightRed: '#fb7172', brightGreen: '#67ff4f', brightYellow: '#ffff00', brightBlue: '#6d9df1', brightMagenta: '#fb82ff', brightCyan: '#60d3d1', brightWhite: '#eeeeee' }
  },
  {
    id: 'afterglow',
    name: 'Afterglow',
    bg: '#212121',
    fg: '#d0d0d0',
    cursor: '#d0d0d0',
    ansi: { black: '#151515', red: '#ac4142', green: '#7e8e50', yellow: '#e5b567', blue: '#6c99bb', magenta: '#9f4e85', cyan: '#7dd6cf', white: '#d0d0d0', brightBlack: '#505050', brightRed: '#ac4142', brightGreen: '#7e8e50', brightYellow: '#e5b567', brightBlue: '#6c99bb', brightMagenta: '#9f4e85', brightCyan: '#7dd6cf', brightWhite: '#f5f5f5' }
  },
  {
    id: 'materialdark',
    name: 'MaterialDark',
    bg: '#232322',
    fg: '#e5e5e5',
    cursor: '#16afca',
    ansi: { black: '#212121', red: '#b7141f', green: '#457b24', yellow: '#f6981e', blue: '#134eb2', magenta: '#560088', cyan: '#0e717c', white: '#efefef', brightBlack: '#424242', brightRed: '#e83b3f', brightGreen: '#7aba3a', brightYellow: '#ffea2e', brightBlue: '#54a4f3', brightMagenta: '#aa4dbc', brightCyan: '#26bbd1', brightWhite: '#d9d9d9' }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    bg: '#1e1f29',
    fg: '#f8f8f2',
    cursor: '#bbbbbb',
    ansi: { black: '#000000', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#bbbbbb', brightBlack: '#555555', brightRed: '#ff5555', brightGreen: '#50fa7b', brightYellow: '#f1fa8c', brightBlue: '#bd93f9', brightMagenta: '#ff79c6', brightCyan: '#8be9fd', brightWhite: '#ffffff' }
  },
  {
    id: 'onehalfdark',
    name: 'OneHalfDark',
    bg: '#282c34',
    fg: '#dcdfe4',
    cursor: '#a3b3cc',
    ansi: { black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#dcdfe4', brightBlack: '#282c34', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#dcdfe4' }
  },
  {
    id: 'espresso',
    name: 'Espresso',
    bg: '#323232',
    fg: '#ffffff',
    cursor: '#d6d6d6',
    ansi: { black: '#353535', red: '#d25252', green: '#a5c261', yellow: '#ffc66d', blue: '#6c99bb', magenta: '#d197d9', cyan: '#bed6ff', white: '#eeeeec', brightBlack: '#535353', brightRed: '#f00c0c', brightGreen: '#c2e075', brightYellow: '#e1e48b', brightBlue: '#8ab7d9', brightMagenta: '#efb5f7', brightCyan: '#dcf4ff', brightWhite: '#ffffff' }
  },
  {
    id: 'zenburn',
    name: 'Zenburn',
    bg: '#3f3f3f',
    fg: '#dcdccc',
    cursor: '#73635a',
    ansi: { black: '#4d4d4d', red: '#705050', green: '#60b48a', yellow: '#f0dfaf', blue: '#506070', magenta: '#dc8cc3', cyan: '#8cd0d3', white: '#dcdccc', brightBlack: '#709080', brightRed: '#dca3a3', brightGreen: '#c3bf9f', brightYellow: '#e0cf9f', brightBlue: '#94bff3', brightMagenta: '#ec93d3', brightCyan: '#93e0e3', brightWhite: '#ffffff' }
  },
  {
    id: 'onehalflight',
    name: 'OneHalfLight',
    bg: '#fafafa',
    fg: '#383a42',
    cursor: '#bfceff',
    ansi: { black: '#383a42', red: '#e45649', green: '#50a14f', yellow: '#c18401', blue: '#0184bc', magenta: '#a626a4', cyan: '#0997b3', white: '#fafafa', brightBlack: '#4f525e', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff' }
  },
  {
    id: 'ayu-light',
    name: 'ayu_light',
    bg: '#fafafa',
    fg: '#5c6773',
    cursor: '#ff6a00',
    ansi: { black: '#000000', red: '#ff3333', green: '#86b300', yellow: '#f29718', blue: '#41a6d9', magenta: '#f07178', cyan: '#4dbf99', white: '#ffffff', brightBlack: '#323232', brightRed: '#ff6565', brightGreen: '#b8e532', brightYellow: '#ffc94a', brightBlue: '#73d8ff', brightMagenta: '#ffa3aa', brightCyan: '#7ff1cb', brightWhite: '#ffffff' }
  },
  {
    id: 'github',
    name: 'Github',
    bg: '#f4f4f4',
    fg: '#3e3e3e',
    cursor: '#3f3f3f',
    ansi: { black: '#3e3e3e', red: '#970b16', green: '#07962a', yellow: '#f8eec7', blue: '#003e8a', magenta: '#e94691', cyan: '#89d1ec', white: '#ffffff', brightBlack: '#666666', brightRed: '#de0000', brightGreen: '#87d5a2', brightYellow: '#f1d007', brightBlue: '#2e6cba', brightMagenta: '#ffa29f', brightCyan: '#1cfafe', brightWhite: '#ffffff' }
  },
  {
    id: 'tokyonight-day',
    name: 'TokyoNight Day',
    bg: '#e1e2e7',
    fg: '#3760bf',
    cursor: '#3760bf',
    ansi: { black: '#e9e9ed', red: '#f52a65', green: '#587539', yellow: '#8c6c3e', blue: '#2e7de9', magenta: '#9854f1', cyan: '#007197', white: '#6172b0', brightBlack: '#a1a6c5', brightRed: '#f52a65', brightGreen: '#587539', brightYellow: '#8c6c3e', brightBlue: '#2e7de9', brightMagenta: '#9854f1', brightCyan: '#007197', brightWhite: '#3760bf' }
  },
  { id: 'cinder', name: 'Cinder', bg: '#191214', fg: '#e8dcd8', cursor: '#e0955e' },
  {
    id: 'rose-pine-dawn',
    name: 'Rose Pine Dawn',
    bg: '#faf4ed',
    fg: '#575279',
    cursor: '#9893a5',
    ansi: { black: '#f2e9de', red: '#b4637a', green: '#286983', yellow: '#ea9d34', blue: '#56949f', magenta: '#907aa9', cyan: '#d7827e', white: '#575279', brightBlack: '#6e6a86', brightRed: '#b4637a', brightGreen: '#286983', brightYellow: '#ea9d34', brightBlue: '#56949f', brightMagenta: '#907aa9', brightCyan: '#d7827e', brightWhite: '#575279' }
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    bg: '#fcf4dc',
    fg: '#536870',
    cursor: '#536870',
    ansi: { black: '#002831', red: '#d11c24', green: '#738a05', yellow: '#a57706', blue: '#2176c7', magenta: '#c61c6f', cyan: '#259286', white: '#eae3cb', brightBlack: '#001e27', brightRed: '#bd3613', brightGreen: '#475b62', brightYellow: '#536870', brightBlue: '#708284', brightMagenta: '#5956ba', brightCyan: '#819090', brightWhite: '#fcf4dc' }
  },
  { id: 'paper', name: 'Paper', bg: '#f6f4ee', fg: '#2a2620', cursor: '#3a63c2' },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    bg: '#001e27',
    fg: '#708284',
    cursor: '#708284',
    ansi: { black: '#002831', red: '#d11c24', green: '#738a05', yellow: '#a57706', blue: '#2176c7', magenta: '#c61c6f', cyan: '#259286', white: '#eae3cb', brightBlack: '#001e27', brightRed: '#bd3613', brightGreen: '#475b62', brightYellow: '#536870', brightBlue: '#708284', brightMagenta: '#5956ba', brightCyan: '#819090', brightWhite: '#fcf4dc' }
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    bg: '#011627',
    fg: '#d6deeb',
    cursor: '#80a4c2',
    ansi: { black: '#011627', red: '#ef5350', green: '#22da6e', yellow: '#addb67', blue: '#82aaff', magenta: '#c792ea', cyan: '#21c7a8', white: '#ffffff', brightBlack: '#969696', brightRed: '#ef5350', brightGreen: '#22da6e', brightYellow: '#ffeb95', brightBlue: '#82aaff', brightMagenta: '#c792ea', brightCyan: '#7fdbca', brightWhite: '#ffffff' }
  },
  {
    id: 'ayu',
    name: 'ayu',
    bg: '#0f1419',
    fg: '#e6e1cf',
    cursor: '#f29718',
    ansi: { black: '#000000', red: '#ff3333', green: '#b8cc52', yellow: '#e7c547', blue: '#36a3d9', magenta: '#f07178', cyan: '#95e6cb', white: '#ffffff', brightBlack: '#323232', brightRed: '#ff6565', brightGreen: '#eafe84', brightYellow: '#fff779', brightBlue: '#68d5ff', brightMagenta: '#ffa3aa', brightCyan: '#c7fffd', brightWhite: '#ffffff' }
  },
  { id: 'ink', name: 'Ink', bg: '#0d1117', fg: '#dbe2ea', cursor: '#7aa5d8' },
  { id: 'denim', name: 'Denim', bg: '#142033', fg: '#d9e4f2', cursor: '#8fb7e8' },
  {
    id: 'nord',
    name: 'Nord',
    bg: '#2e3440',
    fg: '#d8dee9',
    cursor: '#d8dee9',
    ansi: { black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0', brightBlack: '#373e4d', brightRed: '#94545d', brightGreen: '#809575', brightYellow: '#b29e75', brightBlue: '#68809a', brightMagenta: '#8c738c', brightCyan: '#6d96a5', brightWhite: '#aeb3bb' }
  },
  {
    id: 'spacegray',
    name: 'SpaceGray',
    bg: '#20242d',
    fg: '#b3b8c3',
    cursor: '#b3b8c3',
    ansi: { black: '#000000', red: '#b04b57', green: '#87b379', yellow: '#e5c179', blue: '#7d8fa4', magenta: '#a47996', cyan: '#85a7a5', white: '#b3b8c3', brightBlack: '#000000', brightRed: '#b04b57', brightGreen: '#87b379', brightYellow: '#e5c179', brightBlue: '#7d8fa4', brightMagenta: '#a47996', brightCyan: '#85a7a5', brightWhite: '#ffffff' }
  },
  {
    id: 'argonaut',
    name: 'Argonaut',
    bg: '#0e1019',
    fg: '#fffaf4',
    cursor: '#ff0018',
    ansi: { black: '#232323', red: '#ff000f', green: '#8ce10b', yellow: '#ffb900', blue: '#008df8', magenta: '#6d43a6', cyan: '#00d8eb', white: '#ffffff', brightBlack: '#444444', brightRed: '#ff2740', brightGreen: '#abe15b', brightYellow: '#ffd242', brightBlue: '#0092ff', brightMagenta: '#9a5feb', brightCyan: '#67fff0', brightWhite: '#ffffff' }
  },
  {
    id: 'iceberg',
    name: 'Iceberg',
    bg: '#161821',
    fg: '#c6c8d1',
    cursor: '#c6c8d1',
    ansi: { black: '#1e2132', red: '#e27878', green: '#b4be82', yellow: '#e2a478', blue: '#84a0c6', magenta: '#a093c7', cyan: '#89b8c2', white: '#c6c8d1', brightBlack: '#6b7089', brightRed: '#e98989', brightGreen: '#c0ca8e', brightYellow: '#e9b189', brightBlue: '#91acd1', brightMagenta: '#ada0d3', brightCyan: '#95c4ce', brightWhite: '#d2d4de' }
  },
  {
    id: 'tokyonight-storm',
    name: 'TokyoNight Storm',
    bg: '#24283b',
    fg: '#c0caf5',
    cursor: '#c0caf5',
    ansi: { black: '#1d202f', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6', brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5' }
  },
  {
    id: 'tokyonight',
    name: 'TokyoNight',
    bg: '#1a1b26',
    fg: '#c0caf5',
    cursor: '#c0caf5',
    ansi: { black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6', brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5' }
  },
  {
    id: 'adventuretime',
    name: 'AdventureTime',
    bg: '#1f1d45',
    fg: '#f8dcc0',
    cursor: '#efbf38',
    ansi: { black: '#050404', red: '#bd0013', green: '#4ab118', yellow: '#e7741e', blue: '#0f4ac6', magenta: '#665993', cyan: '#70a598', white: '#f8dcc0', brightBlack: '#4e7cbf', brightRed: '#fc5f5a', brightGreen: '#9eff6e', brightYellow: '#efc11a', brightBlue: '#1997c6', brightMagenta: '#9b5953', brightCyan: '#c8faf4', brightWhite: '#f6f5fb' }
  },
  {
    id: 'rose-pine-moon',
    name: 'Rose Pine Moon',
    bg: '#232136',
    fg: '#e0def4',
    cursor: '#59546d',
    ansi: { black: '#393552', red: '#eb6f92', green: '#3e8fb0', yellow: '#f6c177', blue: '#9ccfd8', magenta: '#c4a7e7', cyan: '#ea9a97', white: '#e0def4', brightBlack: '#817c9c', brightRed: '#eb6f92', brightGreen: '#3e8fb0', brightYellow: '#f6c177', brightBlue: '#9ccfd8', brightMagenta: '#c4a7e7', brightCyan: '#ea9a97', brightWhite: '#e0def4' }
  },
  {
    id: 'rose-pine',
    name: 'Rose Pine',
    bg: '#191724',
    fg: '#e0def4',
    cursor: '#555169',
    ansi: { black: '#26233a', red: '#eb6f92', green: '#31748f', yellow: '#f6c177', blue: '#9ccfd8', magenta: '#c4a7e7', cyan: '#ebbcba', white: '#e0def4', brightBlack: '#6e6a86', brightRed: '#eb6f92', brightGreen: '#31748f', brightYellow: '#f6c177', brightBlue: '#9ccfd8', brightMagenta: '#c4a7e7', brightCyan: '#ebbcba', brightWhite: '#e0def4' }
  },
  {
    id: 'ubuntu',
    name: 'Ubuntu',
    bg: '#300a24',
    fg: '#eeeeec',
    cursor: '#bbbbbb',
    ansi: { black: '#2e3436', red: '#cc0000', green: '#4e9a06', yellow: '#c4a000', blue: '#3465a4', magenta: '#75507b', cyan: '#06989a', white: '#d3d7cf', brightBlack: '#555753', brightRed: '#ef2929', brightGreen: '#8ae234', brightYellow: '#fce94f', brightBlue: '#729fcf', brightMagenta: '#ad7fa8', brightCyan: '#34e2e2', brightWhite: '#eeeeec' }
  }
]

/** The theme the settings say, resolved: a preset by id, else follow-style. */
export function resolveTermTheme(themeId: string): TermTheme {
  if (themeId === 'custom') {
    const c = customTermTheme()
    if (c)
      return {
        background: c.bg,
        foreground: c.fg,
        cursor: c.cursor,
        selectionBackground: `${c.cursor}55`,
        ...c.ansi
      }
  }
  const p = TERM_PRESETS.find((x) => x.id === themeId)
  if (!p) return readTermTheme() // unknown ids (old saves) follow the style
  return {
    background: p.bg,
    foreground: p.fg,
    cursor: p.cursor,
    selectionBackground: `${p.cursor}55`,
    // A curated palette is taste and stays exact; only base-only presets get
    // the derived sixteen.
    ...(p.ansi ?? deriveAnsi(p.bg, p.fg))
  }
}
