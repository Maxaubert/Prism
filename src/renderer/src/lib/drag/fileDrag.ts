import type { DragEvent } from 'react'
import { DRAG_MIME, setDrag } from './dragDrop'

/**
 * THE OPEN FILE AS A DRAG SOURCE (#103, D6; owner, 2026-10-31): the picture
 * at fit, and the file's name in the viewer's toolbar. A `files` payload
 * carried by the same in-app hook as a row (`internalFileDrag.ts`): inside
 * the window it drops on a folder like a row does (a move), and at the edge
 * it hands off to Windows (a copy). No path, no drag (a member of an archive,
 * a zoomed picture).
 */
export function fileDragProps(path: string | undefined): {
  draggable?: true
  'data-file-drag'?: string
  onDragStart?: (event: DragEvent<HTMLElement>) => void
  onDragEnd?: () => void
} {
  if (!path) return {}
  return {
    draggable: true,
    'data-file-drag': path,
    onDragStart: (event) => {
      setDrag({ kind: 'files', paths: [path] })
      event.dataTransfer.effectAllowed = 'copyMove'
      event.dataTransfer.setData(DRAG_MIME, 'files')
    },
    onDragEnd: () => setDrag(null)
  }
}
