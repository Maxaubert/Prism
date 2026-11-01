import { useEffect, useState, type DragEvent } from 'react'
import type { ArchiveMeta } from '@shared/types'
import {
  DRAG_MIME,
  overPayload,
  ownDrop,
  setDrag,
  windowsDrag,
  type DragPayload
} from '../../lib/drag/dragDrop'
import { archiveTarget, dropVerb, effectOf, type DropKeys } from '../../lib/drag/dropVerb'

/** What a drag over a target carries for the rule: Prism's cargo, or, for a
 *  drag Windows carries from elsewhere, files that are only ever copied in. */
const seenOf = (dt: DataTransfer): DragPayload | null =>
  overPayload(dt) ?? (windowsDrag(dt) ? { kind: 'files', paths: [], external: true } : null)

const keysOf = (event: DragEvent): DropKeys => ({ ctrl: event.ctrlKey, shift: event.shiftKey })

/**
 * Folder rows, list backgrounds, crumbs, places and pins share the same drop
 * (#70). What it does is `dropVerb`'s answer, on hover (the word under the
 * carried row) and again at the drop with the keys held then. `meta` is the
 * listing's own archive, so a place inside it knows it is one; any other
 * target reads that from its path (a `.zip` row, a crumb, a pin).
 */
export function useFolderDrop(
  onDropInto?: (directory: string, payload: DragPayload, keys: DropKeys) => void,
  meta?: ArchiveMeta | null
) {
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
    const dropTarget = { dir: directory, archive: archiveTarget(directory, meta) }
    return {
      'data-folder-drop': directory,
      'data-drag-over': hovered === target || undefined,
      onDragOver: (event: DragEvent<HTMLElement>): void => {
        if (!accepts(event)) return
        event.preventDefault()
        event.stopPropagation()
        // Prism's own rows refuse themselves and the folder they are in,
        // carried in the window or back from its OS drag alike (#103); a
        // read-only archive refuses everything (G6).
        const verb = onDropInto
          ? dropVerb({ payload: seenOf(event.dataTransfer), target: dropTarget, keys: keysOf(event) })
          : 'none'
        event.dataTransfer.dropEffect = effectOf(verb, windowsDrag(event.dataTransfer))
        setHovered(verb === 'none' ? null : target)
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
        // paths), or files from Windows (`external`: a copy, #103 D3).
        const payload = ownDrop(event.dataTransfer)
        setDrag(null)
        setHovered(null)
        event.currentTarget.closest<HTMLElement>('.browse-list')?.focus({ preventScroll: true })
        if (!payload) return
        const keys = keysOf(event)
        if (dropVerb({ payload, target: dropTarget, keys }) === 'none') return
        onDropInto?.(directory, payload, keys)
      }
    }
  }
}
