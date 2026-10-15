/** "Open folders in Prism" (#393), as Windows reports it. `on`: Prism is the
 *  folder handler; `mine`: it points at THIS Prism and profile, not another copy. */
export interface FolderHandlerStatus {
  available: boolean
  on: boolean
  mine: boolean
  error?: string
}
