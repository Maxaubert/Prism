export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other'

/** One openable file, as the renderer sees it. */
export interface ViewerFile {
  path: string
  name: string
  ext: string // lowercased, leading dot
  kind: FileKind
}

/** What main hands the renderer when a file is opened: the folder's viewable
 * files plus the index of the one that was actually opened. */
export interface OpenPayload {
  files: ViewerFile[]
  index: number
}
