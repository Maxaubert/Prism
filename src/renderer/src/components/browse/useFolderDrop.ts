import { useEffect, useState, type DragEvent } from 'react'
import {
  DRAG_MIME,
  dragIncludesPath,
  dragPayload,
  ownDrop,
  setDrag,
  windowsDrag,
  type DragPayload
} from '../../lib/drag/dragDrop'
import { isInside, samePath } from '@shared/path'

const insideSource = (directory: string, payload: DragPayload | null): boolean =>
  payload?.kind === 'files' &&
  payload.paths.some((source) => isInside(source, directory, { orEqual: true }))

/** Folder rows, list backgrounds and locations share the same file operation. */
export function useFolderDrop(onDropInto?: (directory: string, payload: DragPayload) => void) {
  const [hovered, setHovered] = useState<string | null>(null)
  useEffect(() => {
    const clear = (): void => setHovered(null)
    window.addEventListener('dragend', clear, true)
    window.addEventListener('drop', clear, true)
    return () => {
      window.removeEventListener('dragend', clear, true)
      window.removeEventListener('drop', clear, true)
    }
  }, [])
  return (directory: string, target = directory) => {
    const accepts = (event: DragEvent): boolean =>
      event.dataTransfer.types.includes(DRAG_MIME) || event.dataTransfer.types.includes('Files')
    return {
      'data-folder-drop': directory,
      'data-drag-over': hovered === target || undefined,
      onDragOver: (event: DragEvent<HTMLElement>): void => {
        if (!accepts(event)) return
        event.preventDefault()
        event.stopPropagation()
        if (
          !onDropInto ||
          dragIncludesPath(event.dataTransfer, target) ||
          insideSource(directory, dragPayload(event.dataTransfer))
        ) {
          event.dataTransfer.dropEffect = 'none'
          setHovered(null)
          return
        }
        // A drag Windows carries shows Copy (#103): Electron's OS drag offers
        // copy and link, and a 'move' effect would be refused. What the drop
        // DOES is Prism's own rule (`ownDrop`), not the effect shown.
        event.dataTransfer.dropEffect =
          windowsDrag(event.dataTransfer) || dragPayload(event.dataTransfer)?.kind === 'members' ? 'copy' : 'move'
        setHovered(target)
      },
      onDragLeave: (event: DragEvent<HTMLElement>): void => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setHovered(null)
      },
      onDrop: (event: DragEvent<HTMLElement>): void => {
        if (!accepts(event)) return
        event.preventDefault()
        event.stopPropagation()
        // In-app cargo, Prism's own cargo back from an OS drag (matched by its
        // paths: a move), or files from Windows (`external`: a copy, #103 D3).
        const payload = ownDrop(event.dataTransfer)
        setDrag(null)
        setHovered(null)
        event.currentTarget.closest<HTMLElement>('.browse-list')?.focus({ preventScroll: true })
        if (!payload) return
        const own = !(payload.kind === 'files' && payload.external)
        const self = payload.kind === 'files' && payload.paths.some((source) => samePath(source, target))
        if (own && (self || insideSource(directory, payload))) return
        onDropInto?.(directory, payload)
      }
    }
  }
}
