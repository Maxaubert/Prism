import { useEffect, useState, type DragEvent } from 'react'
import {
  DRAG_MIME,
  dragIncludesPath,
  dragPayload,
  droppedPaths,
  setDrag,
  type DragPayload
} from '../../lib/dragDrop'

const pathKey = (path: string): string =>
  path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
const insideSource = (directory: string, payload: DragPayload | null): boolean =>
  payload?.kind === 'files' &&
  payload.paths.some((source) => {
    const from = pathKey(source)
    const to = pathKey(directory)
    return from === to || to.startsWith(from + '\\')
  })

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
        event.dataTransfer.dropEffect =
          dragPayload(event.dataTransfer)?.kind === 'members' ? 'copy' : 'move'
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
        const payload = dragPayload(event.dataTransfer)
        const self = dragIncludesPath(event.dataTransfer, target)
        const paths = payload ? [] : droppedPaths(event.dataTransfer)
        setDrag(null)
        setHovered(null)
        event.currentTarget.closest<HTMLElement>('.browse-list')?.focus({ preventScroll: true })
        if (payload && !self && !insideSource(directory, payload)) onDropInto?.(directory, payload)
        else if (paths.length) onDropInto?.(directory, { kind: 'files', paths })
      }
    }
  }
}
