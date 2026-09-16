/** Logical file bytes below a folder. Counts exclude the root folder itself. */
export interface FolderSizeResult {
  bytes: number
  files: number
  folders: number
  unreadable: number
  skippedLinks: number
  truncated: boolean
}
