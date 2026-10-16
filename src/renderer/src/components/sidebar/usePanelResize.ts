import {
  useCallback,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  type SetStateAction
} from 'react'
import { createPref } from '../../lib/prefs/createPref'

// THE TREE PANEL'S WIDTH (out of Sidebar.tsx, structure cleanup 2026-10-12,
// unchanged): the edge handle's drag and arrow keys, clamped and remembered.

// Panel width: dragged from the edge, remembered, and bounded so it can't be
// squeezed into uselessness or grow to swallow the media.
export const MIN_W = 170
export const MAX_W = 520
export const DEFAULT_W = 260

export const clampWidth = (n: number): number => Math.round(Math.min(MAX_W, Math.max(MIN_W, n)))

/**
 * A DRAG PAINTS, IT DOES NOT RENDER (review, 2026-10-16; the Explorer grips'
 * rule, useExplorerWidths). Every pointer move used to set the width state,
 * re-rendering the whole Sidebar, and write the pref. A move now paints the
 * clamped width straight onto the panel; the release keeps it, once.
 */
export function createPanelDrag(paint: (width: number) => void, commit: (width: number) => void) {
  let live: number | null = null
  return {
    move(width: number): void {
      live = clampWidth(width)
      paint(live)
    },
    end(): void {
      const width = live
      live = null
      if (width !== null) commit(width)
    }
  }
}

const widthPref = createPref<number>({
  key: 'prism.sidebar.width',
  read: 'always',
  parse: (raw) => {
    const v = Number(raw)
    return Number.isFinite(v) && v > 0 ? clampWidth(v) : DEFAULT_W
  },
  fallback: DEFAULT_W
})
const loadWidth = widthPref.get

export interface PanelResizeDeps {
  panel: RefObject<HTMLElement | null>
  right: boolean
}

export interface PanelResize {
  width: number
  dragging: boolean
  onHandleDown: (e: PointerEvent<HTMLDivElement>) => void
  onHandleMove: (e: PointerEvent<HTMLDivElement>) => void
  onHandleUp: (e: PointerEvent<HTMLDivElement>) => void
  resize: (next: number) => void
  onHandleKey: (e: KeyboardEvent<HTMLDivElement>) => void
  setPointerResize: Dispatch<SetStateAction<boolean>>
  pointerResize: boolean
}

export function usePanelResize({ panel, right }: PanelResizeDeps): PanelResize {
  const [width, setWidth] = useState(loadWidth)
  const [dragging, setDragging] = useState(false)
  const [pointerResize, setPointerResize] = useState(false)
  const resize = useCallback((next: number) => {
    const w = clampWidth(next)
    setWidth(w)
    widthPref.set(w)
  }, [])
  // The panel and its body carry the width (Sidebar.tsx); a SHUT panel stays
  // at zero, as it would have rendered.
  const [drag] = useState(() =>
    createPanelDrag((w) => {
      const box = panel.current
      if (!box) return
      if (box.style.width !== '0px') box.style.width = `${w}px`
      const body = box.firstElementChild
      if (body instanceof HTMLElement) body.style.width = `${w}px`
      box.querySelector(':scope > [role="separator"]')?.setAttribute('aria-valuenow', String(w))
    }, resize)
  )

  const onHandleDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture(e.pointerId)
    setPointerResize(true)
    setDragging(true)
  }, [])

  const onHandleMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!dragging || !panel.current) return
      const box = panel.current.getBoundingClientRect()
      drag.move(right ? box.right - e.clientX : e.clientX - box.left)
    },
    [dragging, drag, right, panel]
  )

  const onHandleUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId)
      drag.end()
      setDragging(false)
    },
    [drag]
  )

  const onHandleKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      setPointerResize(false)
      const wider = right ? 'ArrowLeft' : 'ArrowRight'
      if (e.key === wider) resize(width + 16)
      else if (e.key === (right ? 'ArrowRight' : 'ArrowLeft')) resize(width - 16)
      else return
      e.preventDefault()
    },
    [resize, width, right]
  )
  return {
    width,
    dragging,
    onHandleDown,
    onHandleMove,
    onHandleUp,
    resize,
    onHandleKey,
    setPointerResize,
    pointerResize
  }
}
