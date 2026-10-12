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

const clampWidth = (n: number): number => Math.round(Math.min(MAX_W, Math.max(MIN_W, n)))

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
      resize(right ? box.right - e.clientX : e.clientX - box.left)
    },
    [dragging, resize, right, panel]
  )

  const onHandleUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
  }, [])

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
