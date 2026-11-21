import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from 'react'
import type { Tab } from '../lib/tabs/tabs'
import { useExplorerSide } from '../lib/prefs/explorerSidePrefs'
import { compactRailPref, onboardedPref, placesPref } from '../lib/prefs/layoutPrefs'
import {
  loadTransportBg,
  loadTransportStyle,
  saveTransportBg,
  saveTransportStyle,
  type TransportStyle
} from '../lib/transport'

// The window's own layout state (audit #8, 2026-11-21): the first-run setup,
// fullscreen and drag flags, the transport look, and the places panel with its
// slide, its rail and its peek pin. Moved out of App.tsx unchanged.

export interface AppLayout {
  hasNavigated: boolean
  setHasNavigated: Dispatch<SetStateAction<boolean>>
  dragging: boolean
  setDragging: Dispatch<SetStateAction<boolean>>
  fullscreen: boolean
  setFullscreen: Dispatch<SetStateAction<boolean>>
  transportStyle: TransportStyle
  transportBg: number
  pickTransport: (s: TransportStyle) => void
  pickTransportBg: (pct: number) => void
  setup: boolean
  setSetup: Dispatch<SetStateAction<boolean>>
  explorerSide: ReturnType<typeof useExplorerSide>
  panelSliding: boolean
  placesVisible: boolean
  compactRail: boolean
  peekingRef: MutableRefObject<boolean>
  pinPanel: () => void
  togglePanel: () => void
}

export function useAppLayout(settingsOpen: boolean, active: Tab | null): AppLayout {
  // Whether the user has started paging through the folder in this session. A
  // freshly opened audio/video keeps the arrow keys for seeking; once you've
  // navigated, arrows keep paging even when they land on a playable file.
  const [hasNavigated, setHasNavigated] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [transportStyle, setTransportStyle] = useState<TransportStyle>(loadTransportStyle)
  const [transportBg, setTransportBg] = useState<number>(loadTransportBg)
  // Setup launches with --setup, which shows the guide even here, where it has
  // been through once already.
  const [setup, setSetup] = useState(
    () => window.prism.forceSetup === true || !onboardedPref.get()
  )
  // A PANEL SLIDES WHEN IT IS OPENED OR CLOSED, AND ONLY THEN (owner,
  // 2026-09-23: "when you collapse the explorer sidebar its not animated, it
  // should be"). True for one slide after a toggle, so a tab switch, a drag of
  // an edge or a window resize, which change a width, do not play the slide.
  const explorerSide = useExplorerSide()
  const [panelSliding, setPanelSliding] = useState(false)
  const panelSlideTimer = useRef<number | undefined>(undefined)
  const slidePanel = useCallback(() => {
    setPanelSliding(true)
    window.clearTimeout(panelSlideTimer.current)
    panelSlideTimer.current = window.setTimeout(() => setPanelSliding(false), 240)
  }, [])
  const [placesVisible, setPlacesVisible] = useState(placesPref.get)
  // Settings covers the places, so over it the same control collapses that page's
  // rail instead: one button, one idea - narrow the panel on the left.
  const [compactRail, setCompactRail] = useState(compactRailPref.get)
  const toggleRail = useCallback(() => {
    setCompactRail((on) => {
      compactRailPref.set(!on)
      return !on
    })
  }, [])
  // A Ctrl+B or a click on the toggle while the panel PEEKS pins it where it
  // stands (#250): it is already out, so it must not slide in from nothing.
  const peekingRef = useRef(false)
  const pinPanel = useCallback(() => {
    setPlacesVisible(true)
    placesPref.set(true)
  }, [])
  const togglePanel = useCallback(() => {
    if (peekingRef.current && !settingsOpen) return pinPanel()
    if (settingsOpen) toggleRail()
    else if (active) {
      if (active.browse.surface !== 'folder') return
      slidePanel()
      setPlacesVisible((visible) => {
        placesPref.set(!visible)
        return !visible
      })
    }
  }, [settingsOpen, active, toggleRail, slidePanel, pinPanel])
  const pickTransport = useCallback((s: TransportStyle) => {
    setTransportStyle(s)
    saveTransportStyle(s)
  }, [])
  const pickTransportBg = useCallback((pct: number) => {
    setTransportBg(pct)
    saveTransportBg(pct)
  }, [])

  return {
    hasNavigated,
    setHasNavigated,
    dragging,
    setDragging,
    fullscreen,
    setFullscreen,
    transportStyle,
    transportBg,
    pickTransport,
    pickTransportBg,
    setup,
    setSetup,
    explorerSide,
    panelSliding,
    placesVisible,
    compactRail,
    peekingRef,
    pinPanel,
    togglePanel
  }
}
