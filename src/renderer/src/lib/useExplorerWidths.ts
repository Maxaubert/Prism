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
  const placesWidth = placesVisible
    ? clamp(preferred.places ?? (available <= 760 ? 160 : 210), minimum, placesMax)
    : 0
  const previewMax = Math.max(previewMin, available - placesWidth - listMin)
  const previewWidth = previewVisible
    ? clamp(preferred.preview ?? Math.min(720, available * 0.4), previewMin, previewMax)
    : 0
  const bounds: Record<ExplorerSection, ExplorerWidthBounds> = {
    places: { min: minimum, max: placesMax, value: placesWidth },
    preview: { min: previewMin, max: previewMax, value: previewWidth }
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
    resize,
    style: {
      '--explorer-places-width': `${placesWidth}px`,
      '--browse-preview-width': `${previewWidth}px`
    } as CSSProperties
  }
}
