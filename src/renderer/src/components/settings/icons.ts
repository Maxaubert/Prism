import { isSettingIcon } from 'prism-term-core/renderer/settings/layout/icons'

/**
 * PRISM'S OWN SETTINGS ICONS (2026-10-05, the grouped cards redesign). The
 * core's set (`layout/icons.ts`) draws every row both apps share; these are
 * the pictures only Prism's rows need, from the approved v1 mockup's set, in
 * the same grammar: one 24 unit stroke path, drawn at 16px with a 1.7 stroke.
 * A row names its icon; `iconPath` hands the core's `Glyph` either the core's
 * name or one of these paths.
 */
export const PRISM_ICONS = {
  explorer: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
  media: 'M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2',
  mode: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  droplet: 'M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0c0-4.3 6-10.5 6-10.5z',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  select: 'M4 4h7v7H4zM13 13h7v7h-7zM13 4h7v7h-7z',
  text: 'M5 7V5h14v2M12 5v14M9 19h6',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
  corners: 'M4 20V11a7 7 0 0 1 7-7h9',
  rows: 'M4 6h16M4 12h16M4 18h16',
  follow: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  project: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  history: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 8v4l3 2',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  win: 'M4 5.5l7-1v7H4zM13 4.2l7-1.2v8.5h-7zM4 13h7v6.5l-7-1zM13 13h7v8l-7-1.2z',
  filecheck: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 14l2 2 4-4',
  band: 'M4 5h16v14H4zM4 15h16',
  glow: 'M12 4l1.8 4.6L18 10l-4.2 1.4L12 16l-1.8-4.6L6 10l4.2-1.4z',
  cycle: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
  move: 'M4 12h16M16 8l4 4-4 4',
  setup: 'M4 12a8 8 0 1 1 2.3 5.7M4 18v-4h4',
  progress: 'M4 12h16M8 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  pen: 'M15 5l4 4L8 20H4v-4z'
} as const

export type PrismIconName = keyof typeof PRISM_ICONS

const own = (name: string): name is PrismIconName => Object.prototype.hasOwnProperty.call(PRISM_ICONS, name)

/** Whether a name is drawable: the core's set or Prism's. */
export const isIconName = (name: string): boolean => isSettingIcon(name) || own(name)

/** What `Glyph` and the search are handed: a core icon by name, else Prism's
 *  path. An unknown name throws, which the unit suite then finds. */
export function iconPath(name: string): string {
  if (isSettingIcon(name)) return name
  if (own(name)) return PRISM_ICONS[name]
  throw new Error(`no settings icon ${name}`)
}
