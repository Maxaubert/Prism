import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import { emptySelection, type Selection } from '../../lib/selection'

// The archive panel's drag-select band (out of ArchiveView.tsx, structure
// cleanup 2026-10-12, unchanged).

export interface BandSelectDeps {
  setSel: Dispatch<SetStateAction<Selection>>
  selRef: RefObject<Selection>
}

export interface BandSelect {
  panelBox: RefObject<HTMLDivElement | null>
  hasFocus: RefObject<boolean>
  onPanelPointerDown: (e: React.PointerEvent) => void
  band: { x: number; y: number; w: number; h: number } | null
}

export function useBandSelect({ setSel, selRef }: BandSelectDeps): BandSelect {
  /**
   * Drag-select, the archive's alone (2026-08-25).
   *
   * The tree's sweep was removed because its pointer state outlived real drags
   * - a dropped folder started a phantom band with no button held. This one
   * cannot: it begins ONLY on dead space (a row starts an HTML5 drag instead,
   * and never reaches here), and its listeners are on `window`, removed by
   * pointerup AND pointercancel, so releasing anywhere at all ends it.
   *
   * A plain press on dead space also clears the selection, which is the other
   * half of what dead space should mean.
   */
  /** The drag-select band, in the panel box's own coordinates. */
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const panelBox = useRef<HTMLDivElement>(null)
  /** Was the last press in here? Ctrl+A belongs to the surface you are in. */
  const hasFocus = useRef(false)
  const onPanelPointerDown = useCallback(
    (e: React.PointerEvent): void => {
      hasFocus.current = true
      if (e.button !== 0) return
      const el = e.target as HTMLElement | null
      if (el?.closest('[data-arc-row]')) return // the row owns its own click
      const box = panelBox.current
      if (!box) return
      if (!e.ctrlKey && !e.shiftKey) setSel(emptySelection)
      const rect = box.getBoundingClientRect()
      const sx = e.clientX
      const sy = e.clientY
      const base = e.ctrlKey ? new Set(selRef.current.items) : new Set<string>()
      const move = (ev: PointerEvent): void => {
        const x = Math.min(sx, ev.clientX)
        const y = Math.min(sy, ev.clientY)
        const w = Math.abs(ev.clientX - sx)
        const h = Math.abs(ev.clientY - sy)
        if (w < 4 && h < 4) return // a click, not a sweep
        setBand({ x: x - rect.left, y: y - rect.top, w, h })
        const hits = new Set(base)
        box.querySelectorAll<HTMLElement>('[data-arc-row]').forEach((row) => {
          const r = row.getBoundingClientRect()
          if (r.bottom > y && r.top < y + h && r.right > x && r.left < x + w) {
            const p = row.dataset.arcRow
            if (p) hits.add(p)
          }
        })
        setSel((s) => ({ anchor: s.anchor, items: hits }))
      }
      const end = (): void => {
        setBand(null)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    },
    [selRef, setSel]
  )
  return { panelBox, hasFocus, onPanelPointerDown, band }
}
