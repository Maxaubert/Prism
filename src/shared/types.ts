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
}

/** A subfolder, as the sidebar tree sees it. */
export interface DirEntry {
  path: string
  name: string
}

/** One directory's listable contents: subfolders, then viewable files.
 *  `unreadable` marks a folder we could not open, so the tree can say so
 *  instead of showing it as empty. */
export interface DirListing {
  folders: DirEntry[]
  files: ViewerFile[]
  unreadable?: boolean
}

/** What main hands the renderer when a file is opened: the folder's viewable
 * files, the index of the one that was actually opened, and the session root
 * (the folder Prism was opened in) that the sidebar tree is bounded by. */
export interface OpenPayload {
  files: ViewerFile[]
  index: number
  root: string
}
