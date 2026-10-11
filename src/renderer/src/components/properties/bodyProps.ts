import type { FileKind } from '@shared/types'

/** What every kind's body is handed by the frame. */
export interface BodyProps {
  /** The tab's root: a folder's listing is walled by it. */
  root: string
  path: string
  name: string
  kind: FileKind
  onClose: () => void
}
