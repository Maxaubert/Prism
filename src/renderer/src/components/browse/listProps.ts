import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import type { ArchiveMeta } from '@shared/types'
import type { ListPending } from '../../hooks/usePendingHint'
import type { DateDivider } from '../../lib/dateGroups'
import type { BrowseEntry, FolderBrowserProps } from './types'
/** What the Explorer's list is given (BrowseList's props, shared by its hooks). */
export type BrowseListProps = Pick<
  FolderBrowserProps,
  | 'directory'
  | 'selectedPath'
  | 'scrollTop'
  | 'sort'
  | 'onSelect'
  | 'onScroll'
  | 'onSortChange'
  | 'onContextMenu'
  | 'onRename'
  | 'renamingPath'
  | 'onRenameSubmit'
  | 'onRenameCancel'
  | 'onCopy'
  | 'query'
  | 'searchState'
  | 'onCancelSearch'
  | 'onSearchRange'
  | 'onDropInto'
  | 'onPreviewToggle'
  | 'covered'
  | 'listSlideWidth'
  | 'previewWindowOpen'
  | 'onPreviewWindowClose'
> & {
  /** This Explorer tab: the thumbnail asks are made and cancelled under it. */
  tabId?: string
  entries: BrowseEntry[]
  indexedRows?: Map<number, BrowseEntry | null>
  total: number
  onActivate: (entry: BrowseEntry) => void
  message: string | null
  loading: boolean
  /** A folder that has not answered (#271): 'quiet' dims the rows it keeps,
   *  'slow' runs the thin bar under the header. Never a loading message. */
  pending?: ListPending
  /** The pointer rests on a folder row (null: it left): read it ahead. */
  onFolderHover?: (path: string | null) => void
  onVisibleFolders?: (paths: string[]) => void
  /** Every marked row (the selection plus a sweep's or a Ctrl click's), or
   *  null when the one `selectedPath` is the whole selection. */
  marked?: ReadonlySet<string> | null
  /** Items a paste is still copying here, by lower-cased path, and how far
   *  each has got (0-100): drawn as inert rows with a bar (owner, 2026-10-28). */
  landing?: ReadonlyMap<string, number>
  /** A job over a second is changing this folder: the list is inert under the
   *  loading bar (owner, 2026-11-09, lib/holds). */
  held?: boolean
  /** A click that carries Ctrl or Shift: FolderBrowser builds the selection. */
  onPick?: (entry: BrowseEntry, mods: { ctrl: boolean; shift: boolean }) => void
  /** A sweep let go with the rectangle up: these rows, the keyboard on `near`.
   *  `add` is a Ctrl sweep, which keeps what was marked before it. */
  onSweep?: (paths: string[], near: string | null, add: boolean) => void
  /** Downloads' date groups (#285): a label row before each group's first
   *  entry. Never with `indexedRows` (a search is not grouped). */
  dividers?: readonly DateDivider[]
  /** This is Downloads: Date modified's first click sorts newest first. */
  downloads?: boolean
  /** The place on screen is inside an archive (#300): the Packed column, and
   *  a row dragged out carries archive members, not files on disk. */
  archive?: ArchiveMeta | null
  /** The place on screen is the Recycle Bin (D7): its columns, no drag out,
   *  no drops, no pictures. */
  bin?: boolean
  /** Drawn above the column header: the archive's strip. */
  strip?: ReactNode
  /** THE COMMON KEYS (#330), each quiet (#263): Shift+arrows mark the run
   *  from the anchor to `path`; Ctrl+Space puts `path` in or out of the marks;
   *  Ctrl+A marks every row; Ctrl+Shift+A and Escape clear, answering whether
   *  there was anything to clear (an Escape with nothing marked is not taken). */
  onExtend?: (path: string) => void
  onToggleMark?: (path: string) => void
  onSelectAll?: () => void
  onClear?: () => boolean
  /** Bring this row into view once per `seq` (#101: what an action just made
   *  is marked and scrolled to). Scroll only: the focus stays where it is. */
  revealPath?: { path: string; seq: number } | null
  /** A right press on the list's empty space (inside an archive, #300). */
  onEmptyContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void
}
