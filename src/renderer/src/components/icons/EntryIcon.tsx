import type { JSX } from 'react'
import type { FileKind } from '@shared/types'
import { FolderFill } from './Icon'
import { KindIcon, iconColour } from './FileIcons'

/**
 * THE ONE ICON OF AN ENTRY (owner, 2026-11-19, #521): a folder is the filled
 * folder, a file is its kind's icon. Every list that draws a row (the Explorer,
 * search, places, the archive panel and card, the phone) asks for it here, so a
 * folder in a zip is the Explorer's folder and no caller repeats "picked glyph
 * else folder" or picks its own knockout colour.
 */

/** What a file icon's fold and band are cut out to, i.e. the colour behind it. */
export const GROUND_PAGE = 'var(--p-bg)'
export const GROUND_SIDE = 'var(--p-side-flat)'

/** The colour actually behind the icon. A marked row is a tint (so the icon
 *  keeps its colours and its knockouts are that tint as seen), dimmed when the
 *  list has lost focus; `--sel-seen` is what a browse row or a drag ghost
 *  sets, so the Explorer follows its own dimming without being told. */
// eslint-disable-next-line react-refresh/only-export-components -- the knockout rule, beside the icon it colours
export function entryGround(selected: boolean, dimmed: boolean, ground: string): string {
  if (!selected) return ground
  return dimmed ? 'var(--p-sel-tint-dim-seen)' : 'var(--sel-seen, var(--p-sel-tint-seen))'
}

export function EntryIcon({
  kind,
  size,
  ext,
  name,
  selected = false,
  dimmed = false,
  ground = GROUND_PAGE
}: {
  /** 'folder', or the file's kind. */
  kind: FileKind | 'folder'
  /** Pixels. Unset is the tree's row icon. */
  size?: number
  /** The file's extension, drawn on its band. */
  ext?: string
  /** The file's whole name, for the marks Windows cannot register. */
  name?: string
  /** The row is marked. */
  selected?: boolean
  /** The marked row's list is not the focused one. */
  dimmed?: boolean
  /** The colour behind an unmarked row. */
  ground?: string
}): JSX.Element {
  if (kind === 'folder') return <FolderFill size={size ?? 14} color={iconColour('folder')} />
  return (
    <KindIcon
      kind={kind}
      ext={ext}
      name={name}
      color={iconColour(kind)}
      size={size}
      bg={entryGround(selected, dimmed, ground)}
    />
  )
}