/**
 * WHAT THE BRIDGE ANSWERS, ONCE (structure cleanup, 2026-10-12). Main's
 * handlers return these, the preload promises them and the phone's shim
 * answers the same shapes, so a field added on one side is a type error on
 * the others rather than an `undefined` at runtime. Shapes that already had a
 * shared home stay there (`types.ts`, `browse.ts`, `extraction.ts`, `props.ts`).
 */
import type { FolderSizeResult } from './folderSize'

/**
 * What this host can do (#106). The viewers serve two hosts, the desktop app
 * and the phone page, and the phone's bridge answers the same shape with every
 * flag false. `write` is anything that changes a file, `clipboard` the OS
 * clipboard, `explorer` the desktop around the window, `drag` dragging out to
 * other windows.
 */
export interface HostCapabilities {
  write: boolean
  clipboard: boolean
  explorer: boolean
  drag: boolean
}

/** Size, dates and folder-ness for the Properties window and the editor.
 *  Created and Opened are optional: the phone's stat does not carry them. */
export interface FileStat {
  size: number
  mtimeMs: number
  birthtimeMs?: number
  atimeMs?: number
  isFolder: boolean
}

/** What the camera wrote into a photo, read in main from the file itself.
 *  Best-effort: every field is optional. */
export interface PhotoInfo {
  camera?: string
  lens?: string
  /** "1/250s f/2.8 ISO 400", already assembled: the three are read together. */
  exposure?: string
  taken?: string
  colour?: string
  /** Decimal degrees, as exifr merges them. */
  gps?: { lat: number; lon: number }
  dimensions?: string
}

/** A sidecar subtitle track beside a video. */
export interface SubtitleTrack {
  path: string
  /** What the menu shows: a language name when the suffix gives one. */
  label: string
}

/** A converted copy that plays, or why there is none. */
export interface ConvertResult {
  url?: string
  error?: string
}

/** A comic's pages in reading order, or why it would not open. */
export type ComicOpenResult = { pages: string[] } | { error: 'password' | 'failed' | 'empty' }

/** What a paste did. Nothing is ever written over: a taken name becomes "name (2)". */
export interface PasteResult {
  pasted: number
  failed: number
  refused?: boolean
  empty?: boolean
  /** What actually landed, new names and all, so the tree can select it. */
  paths: string[]
  /** Where each of `paths` came from, in the same order: the pairs main
   *  actually moved, so folder icons follow those and never the renderer's
   *  own cut list (another app may have cut something else since). */
  from?: string[]
  /** The paste was a MOVE: `cut` still matched the clipboard. */
  moved?: boolean
}

/** What a move does with a name already taken at the destination. */
export type MoveOnClash = 'ask' | 'keep-both' | 'replace'
export type MoveClash = { path: string; name: string }
export type MoveResult = {
  /** Where each one came from and landed: undo needs both halves. */
  moved: Array<{ from: string; to: string }>
  /** Names already taken at the destination; with onClash 'ask' nothing moved. */
  clashes: MoveClash[]
  /** Paths that could not be moved at all (gone, locked, into themselves). */
  failed: string[]
  /** The ones among `failed` that Windows refused because something holds
   *  the file open (EBUSY, EPERM) - which is Prism's own player as often as
   *  not (#127), so the renderer lets go and tries these again. */
  busy: string[]
  /** What 'replace' sent to the bin, so undo can bring it back. */
  replaced: string[]
  /** True when the ROOT WALL refused, which is a different message. */
  refused?: boolean
}

/** Undoing a new folder: binned only while it is still empty. */
export type BinIfEmptyResult = 'binned' | 'not-empty' | 'missing' | 'failed'

/** How an archive is locked. ZipCrypto opens with the password; AES cannot. */
export type ArchiveEncryption = 'none' | 'zipcrypto' | 'aes'

/** What the Properties dialog says about an archive: what it holds, how hard
 *  it squeezed, and whether it is locked. */
export type ArchiveStat = {
  files: number
  folders: number
  /** Bytes the members take once unpacked. */
  uncompressed: number
  encryption: ArchiveEncryption
  /** 7z, rar, tar and the rest are read through 7-Zip and never written:
   *  the panel hides its verbs rather than offering what would fail. */
  readOnly?: boolean
}

/** Real files put INTO a zip. */
export type ArchiveAddResult =
  | { added: Array<{ src: string; entry: string }>; clashes: string[]; failed: string[] }
  | 'encrypted'
  | 'failed'

/** Members moved to another folder inside the same zip. */
export type ArchiveMoveResult = 'ok' | 'encrypted' | 'failed'

/* ----- the progress pushes ----- */

/** A running paste's bytes, 0-100, tagged with its job. */
export interface PasteProgress {
  jobId: string
  pct: number
  /** Said once, as a copy starts (owner, 2026-10-28: the list shows each
   *  item being pasted as a row with its own bar): the folder they land in
   *  and each item's expected path. Absent on a move, which is a rename. */
  start?: { dir: string; items: PasteItem[] }
  /** Which item (an index into `start.items`) the copy is on, and how far
   *  through it, 0-100. 100 once it has landed. */
  item?: number
  itemPct?: number
}
/** One item a paste is copying, as the list shows it while it lands. */
export interface PasteItem {
  path: string
  name: string
  isFolder: boolean
}
/** A video conversion's progress, 0-100. */
export interface ConvertProgress {
  path: string
  pct: number
}
/** A checksum's progress, by the call's own id. */
export interface HashProgress {
  id: string
  done: number
  total: number
}
/** A folder size, as far as the scan has got. */
export interface FolderSizeProgress {
  requestId: string
  result: FolderSizeResult
}
/** Minimised and focused, which the page cannot see for itself. */
export interface WindowState {
  minimised: boolean
  focused: boolean
}
