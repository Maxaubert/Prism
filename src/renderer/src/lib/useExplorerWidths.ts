import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

const WIDTHS_KEY = 'prism.explorer.widths'
export type ExplorerSection = 'places' | 'preview'
type Widths = Record<ExplorerSection, number | null>
export type ExplorerWidthBounds = { min: number; max: number; value: number }

function loadWidths(): Widths {
  try {
    const saved = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? '{}')
    const read = (key: ExplorerSection): number | null =>
      typeof saved[key] === 'number' && Number.isFinite(saved[key]) && saved[key] > 0
        ? saved[key]
        : null
    return { places: read('places'), preview: read('preview') }
  } catch {
    return { places: null, preview: null }
  }
}

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
   * which re-rendered the whole App (the Explorer, its 400 rows, the preview)
   * and wrote localStorage: 29 to 36 ms a move, MEASURED by the `panelDrag`
   * e2e, against a 16 ms frame. A move now writes only the CSS variable the
   * layout already reads, clamped to the bounds the drag began with (the other
   * panel does not move meanwhile); `resize` keeps it, once, on release.
   */
  const live = (section: ExplorerSection, value: number): void => {
    const element = workspace.current
    if (!element) return
    const width = clamp(value, bounds[section].min, bounds[section].max)
    if (section === 'places') {
      if (placesVisible) element.style.setProperty('--explorer-places-width', `${width}px`)
      element.style.setProperty('--explorer-places-peek-width', `${width}px`)
    } else if (previewVisible) element.style.setProperty('--browse-preview-width', `${width}px`)
  }
  const resize = (section: ExplorerSection, value: number | null): void => {
    setPreferred((current) => {
      const next = {
        ...current,
        [section]: value === null ? null : clamp(value, bounds[section].min, bounds[section].max)
      }
      localStorage.setItem(WIDTHS_KEY, JSON.stringify(next))
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
