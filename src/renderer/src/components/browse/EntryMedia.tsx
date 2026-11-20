import type { JSX } from 'react'
import { EntryIcon } from '../icons/EntryIcon'
import { FolderGlyph } from '../icons/FolderGlyph'
import { folderIconOf, type FolderIconMap } from '../../lib/folderIcons'
import { thumbSource } from '../../lib/thumbKind'
import type { ThumbFeed } from '../../lib/useThumbs'
import type { ZoomLook } from '../../lib/explorerZoom'
import { ThumbImage } from './ThumbImage'
import type { BrowseEntry } from './types'

/**
 * THE PICTURE OF ONE ENTRY, for a row's name cell and for a grid tile: the
 * thumbnail of a photo or a film when the place wears pictures, else the kind
 * icon (or the folder's, own glyph if one was picked). Row and tile differ
 * only in the box and icon sizes, which they pass in.
 */
export interface EntryPictures {
  /** The place wears pictures (not a search, an archive, the bin). */
  on: boolean
  feed: ThumbFeed | null
  /** Items a paste is still copying: no picture for those. */
  landing: ReadonlyMap<string, number> | undefined
  folderIcons: FolderIconMap
}

/** The entry's kind icon. A marked row is a tint, so its icon keeps its own
 *  colours; its knockouts are the tint as seen (dimmed or not: browse.css sets
 *  --sel-seen). */
function kindIcon(entry: BrowseEntry, size: number, selected: boolean): JSX.Element {
  return (
    <EntryIcon
      kind={entry.file!.kind}
      ext={entry.file!.ext}
      name={entry.name}
      size={size}
      selected={selected}
    />
  )
}

/** The entry's thumbnail source, or null when it wears none. */
function sourceOf(entry: BrowseEntry, pictures: EntryPictures): ReturnType<typeof thumbSource> {
  return pictures.on && !pictures.landing?.has(entry.path.toLowerCase()) ? thumbSource(entry) : null
}

/** A folder's icon: its own picked glyph (wearing the folder colour, D4) or the
 *  plain folder. `glyph` is the picked glyph's size, `plain` the folder's. */
function folderPicture(
  folderIcons: FolderIconMap,
  path: string,
  glyph: number,
  plain: number | undefined
): JSX.Element {
  const own = folderIconOf(folderIcons, path)
  const folder = <EntryIcon kind="folder" size={plain} />
  return own ? (
    <FolderGlyph icon={own} size={glyph} color="var(--p-tree-folder)" fallback={folder} />
  ) : (
    folder
  )
}

/** What a list row's name cell shows before the name. */
export function rowPicture(
  entry: BrowseEntry,
  selected: boolean,
  look: ZoomLook,
  pictures: EntryPictures
): JSX.Element | null {
  if (entry.isFolder) {
    // At the picture steps (3, 4) a folder is as big as a file's icon (owner,
    // 2026-11-10); steps 0 to 2 keep the row icon.
    const glyph = folderPicture(pictures.folderIcons, entry.path, look.icon, look.thumb ? look.icon : undefined)
    return look.thumb ? <span className="browse-thumb-slot">{glyph}</span> : glyph
  }
  if (!entry.file) return null
  // Steps 3 and 4: a photo or a film gets a picture box (its icon half the box
  // until the picture arrives); every other row keeps its icon centred in a
  // slot of the same width, so names line up.
  const src = sourceOf(entry, pictures)
  if (src)
    return (
      <ThumbImage
        feed={pictures.feed}
        path={entry.path}
        source={src}
        film={entry.file.kind === 'video'}
        box={look.thumb}
        icon={kindIcon(entry, Math.min(64, Math.round(look.thumb * 0.5)), selected)}
      />
    )
  return look.thumb ? (
    <span className="browse-thumb-slot">{kindIcon(entry, look.icon, selected)}</span>
  ) : (
    kindIcon(entry, look.icon, selected)
  )
}

/** A tile's picture box: the photo or film's thumbnail when it has one, else
 *  the kind icon (or the folder's) centred on the same quiet ground. The box
 *  is the same size before and after a picture arrives (spec 4.6). */
export function tilePicture(
  entry: BrowseEntry,
  selected: boolean,
  look: ZoomLook,
  pictures: EntryPictures
): JSX.Element {
  const edge = look.edge
  const iconSize = Math.min(64, Math.round(edge * 0.4))
  const src = sourceOf(entry, pictures)
  if (entry.file && src)
    return (
      <ThumbImage
        feed={pictures.feed}
        path={entry.path}
        source={src}
        film={entry.file.kind === 'video'}
        box={edge}
        icon={kindIcon(entry, iconSize, selected)}
      />
    )
  const icon = entry.isFolder ? (
    folderPicture(pictures.folderIcons, entry.path, iconSize, iconSize)
  ) : entry.file ? (
    kindIcon(entry, iconSize, selected)
  ) : (
    <span />
  )
  return (
    <span className="browse-thumb" style={{ width: edge, height: edge }} data-thumb-state="icon">
      <span className="browse-thumb-icon">{icon}</span>
    </span>
  )
}
