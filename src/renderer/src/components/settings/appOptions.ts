/**
 * PRISM'S OWN SETTINGS ROWS, a closed list (2026-10-05, the grouped cards
 * redesign, #292). The terminal's and dictation's rows are prism-term-core's
 * lists; these are the rows about Prism itself: its style, the Explorer, the
 * player, About. The `termOptions` e2e asserts the Terminal and Agents pages
 * show the core's lists and nothing else, and `settingsSearch` opens every
 * row here by its label: a row in neither list is a fork.
 *
 * `section` is where the row is drawn (`APP_SECTIONS`), `view` the Media
 * page's half that holds it, and `store` where the value lives: the
 * localStorage keys, `windows` (Windows keeps it: the Explorer menu, the Win+E
 * helper, the default apps), or null for a row that stores nothing. The keys
 * are a SNAPSHOT in `appOptions.test.ts`: a key is a saved setting. #298
 * retired one as a setting, `prism.mode` (Colour mode is gone; the key is the
 * boot screen's mirror of the painted theme's mode now). One line per entry, as in the core's lists; a block
 * (a wall of cards, a grid of swatches) has no subtext of its own.
 */
import { THEME_STYLES } from '../../lib/themes/catalogue'

export type AppPageId = 'appearance' | 'explorer' | 'terminal' | 'agents' | 'dictation' | 'media' | 'about'
export type MediaView = 'visualizer' | 'progress'

export interface AppOption {
  id: string
  label: string
  sub: string
  section: keyof typeof APP_SECTIONS
  page: AppPageId
  view?: MediaView
  icon: string
  keywords?: string
  store: readonly string[] | 'windows' | null
}

/** This app's own section headings, by `data-settings-section`. The style's
 *  colours are headed by the style's name on the page ("Colours of Aurora").
 *  The Themes card has no heading: its first row is its header (#298). */
export const APP_SECTIONS = {
  'style-theme': '',
  'this-theme': 'This theme',
  'style-colours': 'Colours',
  'app-text': 'Text',
  window: 'Window',
  layout: 'Layout',
  opening: 'Opening things',
  starts: 'When Prism starts',
  windows: 'Windows',
  'viz-style': 'Visualizer style',
  'viz-colour': 'Visualizer colour',
  'transport-style': 'Progress bar style',
  behind: 'Behind the controls',
  'transport-colour': 'Progress bar colour',
  about: ''
} as const

const DRAFT = ['prism.style.draft'] as const

/** The 18 themes' names, lower case, for Find a setting. */
const THEME_NAMES = THEME_STYLES.map((s) => s.name.toLowerCase()).join(' ')

export const APP_OPTIONS: readonly AppOption[] = [
  { id: 'style-theme', label: 'Themes', sub: 'Choose your look.', section: 'style-theme', page: 'appearance', icon: 'appearance', keywords: `${THEME_NAMES} dark light mode style look`, store: ['prism.style', 'prism.style.presets'] },
  { id: 'see-through', label: 'See-through window', sub: 'The desktop shows behind every surface.', section: 'this-theme', page: 'appearance', icon: 'glass', keywords: 'acrylic glass transparent translucent desktop', store: DRAFT },
  { id: 'theme-edits', label: 'Edits to this theme', sub: 'Saved as your own copy.', section: 'this-theme', page: 'appearance', icon: 'pen', keywords: 'save custom copy preset changes', store: ['prism.style.draft', 'prism.style.presets'] },
  { id: 'c-bg', label: 'Background', sub: 'Behind lists, files and settings.', section: 'style-colours', page: 'appearance', icon: 'viewer', keywords: 'primary ground glass acrylic transparent alpha color', store: DRAFT },
  { id: 'c-chrome', label: 'Sidebar and tab bar colour', sub: 'Also used for the title bar.', section: 'style-colours', page: 'appearance', icon: 'sidebar', keywords: 'secondary panel chrome color', store: DRAFT },
  { id: 'c-accent', label: 'Accent colour', sub: 'Buttons, progress, visualizer and chosen cards.', section: 'style-colours', page: 'appearance', icon: 'accent', keywords: 'highlight color alpha', store: DRAFT },
  { id: 'c-selection', label: 'Selection colour', sub: 'Tint of selected files and places.', section: 'style-colours', page: 'appearance', icon: 'select', keywords: 'marked highlight tint color', store: DRAFT },
  { id: 'c-text', label: 'Text colour', sub: 'File names, labels and readouts.', section: 'style-colours', page: 'appearance', icon: 'text', keywords: 'ink foreground color', store: DRAFT },
  { id: 'c-folder-icon', label: 'Folder icon colour', sub: 'Folder icons in the file tree.', section: 'style-colours', page: 'appearance', icon: 'folder', keywords: 'folders zip color', store: DRAFT },
  { id: 'c-font', label: 'Font', sub: 'The typeface used across the app.', section: 'app-text', page: 'appearance', icon: 'font', keywords: 'typeface face family', store: DRAFT },
  { id: 'tree-size', label: 'Font size', sub: 'Sidebar and settings text.', section: 'app-text', page: 'appearance', icon: 'size', keywords: 'font zoom bigger smaller scale', store: ['prism.tree.size'] },
  { id: 'title-bar', label: 'Show title bar', sub: 'When off, tabs share the top row.', section: 'window', page: 'appearance', icon: 'titlebar', keywords: 'caption top frame hide hidden', store: ['prism.window.titleBar'] },
  { id: 'tab-width', label: 'Tab width', sub: 'Sized to the name, or all equal.', section: 'window', page: 'appearance', icon: 'tabs', keywords: 'size wide narrow equal fixed dynamic', store: ['prism.window.tabWidth'] },
  { id: 'c-edges', label: 'Panel edges', sub: 'Lines between panels and around the window.', section: 'window', page: 'appearance', icon: 'edges', keywords: 'border lines hairline outline faint strong', store: DRAFT },
  { id: 'c-corners', label: 'Corner roundness', sub: 'How round the larger surfaces are.', section: 'window', page: 'appearance', icon: 'corners', keywords: 'radius square soft round', store: DRAFT },
  { id: 'tree-side', label: 'Sidebar position', sub: 'The side the file tree sits on.', section: 'layout', page: 'explorer', icon: 'sidebar', keywords: 'left right tree panel', store: ['prism.tree.side'] },
  { id: 'explorer-size', label: 'Explorer row size', sub: 'Row height, with text and icons.', section: 'layout', page: 'explorer', icon: 'rows', keywords: 'small medium large density compact', store: ['prism.explorer.size'] },
  { id: 'auto-scroll', label: 'Scroll to the open file', sub: 'The tree follows the file you view.', section: 'layout', page: 'explorer', icon: 'follow', keywords: 'auto scroll follow reveal', store: ['prism.tree.autoscroll'] },
  { id: 'newtab-mode', label: 'Folder for new tabs', sub: 'Where a new tab starts.', section: 'opening', page: 'explorer', icon: 'newtab', keywords: 'home directory start ask chosen', store: ['prism.newtab.mode', 'prism.newtab.folder'] },
  { id: 'newtab-show', label: 'First view of a new project', sub: 'What a folder opened as a project shows.', section: 'opening', page: 'explorer', icon: 'project', keywords: 'project terminal browser first file', store: ['prism.newtab.show'] },
  { id: 'open-external', label: 'View for files from Windows', sub: 'How files opened from Windows appear.', section: 'opening', page: 'explorer', icon: 'file', keywords: 'preview full view double click open with', store: ['prism.open.external'] },
  { id: 'remember-tabs', label: 'Reopen tabs at start', sub: 'Brings back the tabs from last time.', section: 'starts', page: 'explorer', icon: 'history', keywords: 'restore remember session startup', store: ['prism.tabs.remember'] },
  { id: 'remember-folders', label: 'Remember recent folders', sub: 'Kept only on this PC.', section: 'starts', page: 'explorer', icon: 'clock', keywords: 'cache listing clear history', store: ['prism.explorer.rememberFolders'] },
  { id: 'win-e-shortcut', label: 'Open in place of File Explorer', sub: 'A small helper starts with Windows.', section: 'windows', page: 'explorer', icon: 'win', keywords: 'shortcut replace file explorer hotkey', store: 'windows' },
  { id: 'explorer-verb', label: 'Add to the Explorer menu', sub: 'Open files and folders in Prism.', section: 'windows', page: 'explorer', icon: 'menu', keywords: 'context menu right click open with', store: 'windows' },
  { id: 'default-apps', label: 'Default app for file types', sub: 'Windows keeps this choice.', section: 'windows', page: 'explorer', icon: 'filecheck', keywords: 'associations default viewer open with', store: 'windows' },
  { id: 'viz-style', label: 'Visualizer style', sub: '', section: 'viz-style', page: 'media', view: 'visualizer', icon: 'media', keywords: 'music audio shape bars halo preset', store: ['prism.viz.style', 'prism.viz.presets'] },
  { id: 'viz-colour', label: 'Visualizer colour', sub: '', section: 'viz-colour', page: 'media', view: 'visualizer', icon: 'droplet', keywords: 'color solid gradient palette', store: ['prism.viz.theme'] },
  { id: 'viz-glow', label: 'Glow', sub: 'A soft glow around the shapes.', section: 'viz-colour', page: 'media', view: 'visualizer', icon: 'glow', keywords: 'visualizer effect shine', store: ['prism.viz.glow'] },
  { id: 'viz-cycle', label: 'Cycle', sub: 'The colours shift hue over time.', section: 'viz-colour', page: 'media', view: 'visualizer', icon: 'cycle', keywords: 'visualizer effect hue rotate', store: ['prism.viz.cycle'] },
  { id: 'viz-move', label: 'Move', sub: 'The colours slide across over time.', section: 'viz-colour', page: 'media', view: 'visualizer', icon: 'move', keywords: 'visualizer effect scroll slide', store: ['prism.viz.move'] },
  { id: 'transport-style', label: 'Progress bar style', sub: '', section: 'transport-style', page: 'media', view: 'progress', icon: 'progress', keywords: 'seek bar player controls transport', store: ['prism.transport.style'] },
  { id: 'transport-bg', label: 'Control band opacity', sub: 'How solid the band behind the controls is.', section: 'behind', page: 'media', view: 'progress', icon: 'band', keywords: 'background transparent player video', store: ['prism.transport.bg'] },
  { id: 'transport-colour', label: 'Progress bar colour', sub: '', section: 'transport-colour', page: 'media', view: 'progress', icon: 'droplet', keywords: 'color solid gradient seek bar', store: ['prism.viz.barTheme'] },
  { id: 'transport-glow', label: 'Glow', sub: 'A soft glow around the shapes.', section: 'transport-colour', page: 'media', view: 'progress', icon: 'glow', keywords: 'progress bar effect shine', store: ['prism.viz.barGlow'] },
  { id: 'transport-cycle', label: 'Cycle', sub: 'The colours shift hue over time.', section: 'transport-colour', page: 'media', view: 'progress', icon: 'cycle', keywords: 'progress bar effect hue rotate', store: ['prism.viz.barCycle'] },
  { id: 'transport-move', label: 'Move', sub: 'The colours slide across over time.', section: 'transport-colour', page: 'media', view: 'progress', icon: 'move', keywords: 'progress bar effect scroll slide', store: ['prism.viz.barMove'] },
  { id: 'app-version', label: 'Version', sub: 'The version you are running.', section: 'about', page: 'about', icon: 'version', keywords: 'update release number', store: null },
  { id: 'show-setup', label: 'Setup guide', sub: 'The first run steps, from the start.', section: 'about', page: 'about', icon: 'setup', keywords: 'onboarding welcome first run again', store: null }
]

/** One of this app's rows by id. Throws on a typo, which the tests find. */
export function appOpt(id: string): AppOption {
  const o = APP_OPTIONS.find((a) => a.id === id)
  if (!o) throw new Error(`no app settings option ${id}`)
  return o
}
