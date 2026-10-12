import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPref } from './prefs/createPref'

export type ExplorerSection = 'places' | 'preview'
type Widths = Record<ExplorerSection, number | null>
export type ExplorerWidthBounds = { min: number; max: number; value: number }

const widthsPref = createPref<Widths>({
  key: 'prism.explorer.widths',
  read: 'always',
  parse: (raw) => {
    const saved = JSON.parse(raw ?? '{}')
    const read = (key: ExplorerSection): number | null =>
      typeof saved[key] === 'number' && Number.isFinite(saved[key]) && saved[key] > 0
        ? saved[key]
        : null
    return { places: read('places'), preview: read('preview') }
  },
  serialize: (widths) => JSON.stringify(widths),
  fallback: { places: null, preview: null }
})
const loadWidths = widthsPref.get

const clamp = (value: number, min: number, max: number): number =>
  Math.round(Math.max(min, Math.min(max, value)))

/** Keep preferred widths through window resizing; only deliberate adjustments are saved. */
export function useExplorerWidths(placesVisible: boolean, previewVisible: boolean) {
  const workspace = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(window.innerWidth)
  const [preferred, setPreferred] = useState(loadWidths)
  useLayoutEffect(() => {
    const element = workspace.current
    if (!element) return
    const measure = (): void => setAvailable(element.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // At high zoom the minima scale down together instead of pushing a section offscreen.
  const minimum = Math.min(160, available / (previewVisible ? 4 : 2))
  const listMin = Math.min(240, available / 3)
  const previewMin = previewVisible ? Math.min(240, available / 3) : 0
  const placesMax = Math.max(minimum, available - listMin - previewMin)
  // The width the places panel HAS when shown, kept while it is hidden too:
  // a peek (#250) lays it over the list at that width, not at the zero its
  // column collapses to.
  // Unsaved widths are the ones the owner settled on, measured from their window (2026-10-11,
  // after "shrink them just a bit"); docs/features.md, the window-size entry.
  const placesOwn = clamp(preferred.places ?? (available <= 760 ? 145 : 190), minimum, placesMax)
  const placesWidth = placesVisible ? placesOwn : 0
  const previewMax = Math.max(previewMin, available - placesWidth - listMin)
  const previewWidth = previewVisible
    ? clamp(preferred.preview ?? Math.min(630, available * 0.26), previewMin, previewMax)
    : 0
  const bounds: Record<ExplorerSection, ExplorerWidthBounds> = {
    places: { min: minimum, max: placesMax, value: placesWidth },
    preview: { min: previewMin, max: previewMax, value: previewWidth }
  }
  /**
   * A DRAG PAINTS, IT DOES NOT RENDER (owner, 2026-10-12: "very choppy, very
   * laggy" dragging either panel's edge). Every move used to set state here,
   * which re-rendered the whole App and wrote localStorage, 42 to 54 times in
   * a half-second drag (the `panelDrag` e2e). Nor may a move change the width
   * VARIABLES: they sit on the workspace, and an inherited custom property
   * changed there restyles every element under it with all of Prism's theme
   * variables, 62 to 68 ms a frame on the owner's window (MEASURED, a trace of
   * their own drags: 4.8 s of style recalculation in 7.8 s of dragging). A move
   * writes plain pixel values, which nothing inherits, onto the few boxes that
   * show the widths: the Explorer's grid, the preview pane, the viewer's places
   * and the two grips. `resize`, on release, keeps the width and hands those
   * boxes back to the variables.
   */
  // What each painted box had inline before, so the release gives it back.
  const painted = useRef(new Map<HTMLElement, Map<string, string>>())
  const paint = (element: Element | null | undefined, property: string, value: string): void => {
    if (!(element instanceof HTMLElement)) return
    let before = painted.current.get(element)
    if (!before) painted.current.set(element, (before = new Map()))
    if (!before.has(property)) before.set(property, element.style.getPropertyValue(property))
    element.style.setProperty(property, value)
  }
  const live = (section: ExplorerSection, value: number): void => {
    const root = workspace.current
    if (!root) return
    const width = clamp(value, bounds[section].min, bounds[section].max)
    const places = section === 'places' ? (placesVisible ? width : 0) : placesWidth
    const preview = section === 'preview' ? (previewVisible ? width : 0) : previewWidth
    const browser = root.querySelector('.folder-browser')
    if (browser) {
      const right = browser.getAttribute('data-side') === 'right'
      const open = browser.hasAttribute('data-preview')
      paint(
        browser,
        'grid-template-columns',
        right
          ? `${open ? preview : 0}px minmax(0, 1fr) ${places}px`
          : `${places}px minmax(0, 1fr)${open ? ` ${preview}px` : ''}`
      )
    }
    const placesGrip = root.querySelector('.explorer-resize-places')
    paint(placesGrip, placesGrip?.classList.contains('is-right') ? 'right' : 'left', `${places}px`)
    const previewGrip = root.querySelector('.explorer-resize-preview')
    paint(previewGrip, previewGrip?.classList.contains('is-left') ? 'left' : 'right', `${preview}px`)
    paint(root.querySelector('[data-browse-preview]'), 'width', `${preview}px`)
    paint(root.querySelector('.browse-viewer-places'), 'flex-basis', `${places}px`)
  }
  const unpaint = (): void => {
    for (const [element, before] of painted.current)
      for (const [property, value] of before)
        if (value) element.style.setProperty(property, value)
        else element.style.removeProperty(property)
    painted.current.clear()
  }
  const resize = (section: ExplorerSection, value: number | null): void => {
    unpaint()
    setPreferred((current) => {
      const next = {
        ...current,
        [section]: value === null ? null : clamp(value, bounds[section].min, bounds[section].max)
      }
      widthsPref.set(next)
      return next
    })
  }
  return {
    workspace,
    bounds,
    live,
    resize,
    style: {
      '--explorer-places-width': `${placesWidth}px`,
      '--explorer-places-peek-width': `${placesOwn}px`,
      '--browse-preview-width': `${previewWidth}px`
    } as CSSProperties
  }
}
