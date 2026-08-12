export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other'

/** One openable file, as the renderer sees it. */
export interface ViewerFile {
  path: string
  name: string
  ext: string // lowercased, leading dot
  kind: FileKind
  /** Bytes on disk; 0 if it couldn't be stat'ed. Used to skip preloading files
   *  so large that warming them would cost more than it saves. */
  size: number
  /** Modified time (ms since epoch); 0 if it couldn't be stat'ed. Sorting. */
  mtimeMs: number
}

/** A subfolder, as the sidebar tree sees it. */
export interface DirEntry {
  path: string
  name: string
}

/** A sidebar search hit: enough to draw the row and open the file. */
export interface SearchHit {
  path: string
  name: string
  kind: FileKind
  /** Where it lives, relative to the searched root ('' at the root itself). */
  dir: string
}

export interface SearchResult {
  hits: SearchHit[]
  /** True when a cap stopped the walk: there may be more than what came back. */
  truncated: boolean
}

/** One directory's listable contents: subfolders, then viewable files.
 *  `unreadable` marks a folder we could not open, so the tree can say so
 *  instead of showing it as empty. */
export interface DirListing {
  folders: DirEntry[]
  files: ViewerFile[]
  unreadable?: boolean
}

/** An app the "Open in" submenu can hand a file to. `id` is the executable's
 *  path; main only ever launches an id it enumerated itself. */
export interface OpenWithApp {
  id: string
  name: string
  /** The exe's icon as a data URL, when Windows would give one up. */
  icon?: string
}

/** What to do when a rename runs into a name that's already taken. 'ask' changes
 *  nothing and reports back, so the choice can be put to the user. */
export type OnClash = 'ask' | 'overwrite' | 'keep-both'

export type RenameResult =
  | { ok: true; path: string }
  | {
      ok: false
      reason: 'invalid' | 'clash' | 'missing' | 'failed'
      message?: string
      /** For a clash: the name "keep both" would use, e.g. "photo (2).jpg". */
      suggestion?: string
    }

/** What main hands the renderer when a file is opened: the folder's viewable
 * files, the index of the one that was actually opened, and the session root
 * (the folder Prism was opened in) that the sidebar tree is bounded by. */
export interface OpenPayload {
  files: ViewerFile[]
  index: number
  root: string
}
