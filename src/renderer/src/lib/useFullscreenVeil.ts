import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'

// App's fullscreen: the element fullscreen, its fallback, and the two veils
// that fade the window to black over the swap. Out of App.tsx (structure
// cleanup, 2026-10-12), unchanged.

export interface FullscreenVeilDeps {
  setFullscreen: Dispatch<SetStateAction<boolean>>
  fullscreen: boolean
}

export interface FullscreenVeil {
  setFs: (on: boolean) => void
  viewerBox: RefObject<HTMLDivElement | null>
  fsVeilOuter: RefObject<HTMLDivElement | null>
  fsVeilEl: RefObject<HTMLDivElement | null>
}

export function useFullscreenVeil({
  setFullscreen,
  fullscreen
}: FullscreenVeilDeps): FullscreenVeil {
  useEffect(() => window.prism.onFullscreen(setFullscreen), [setFullscreen])
  /**
   * Fullscreen the way YouTube actually does it: the DOM Fullscreen API on
   * the viewer element, which gets Chromium's own built-in smooth transition
   * for free - no hand-rolled veil, no animation of ours at all. The window
   * fullscreen IPC survives only as the fallback for when the element can't
   * take it (e.g. the viewer is display:none under a full terminal).
   */
  const viewerBox = useRef<HTMLDivElement>(null)
  // The fade-to-black rides ON TOP of the DOM fullscreen: darken (150ms), do
  // the swap under full black, lift (280ms) once the new frame has laid out.
  // Driven by transitionend and rAF, styled directly on the nodes, so nothing
  // re-renders mid-fade.
  //
  // TWO VEILS, and the reason is the whole staging (2026-09-02). The inner one
  // lives INSIDE the fullscreen element, because anything outside it stops
  // rendering the moment the element goes fullscreen - it is what covers the
  // swap itself. But on its own it darkened only the picture: the sidebar, the
  // tab strip and the title bar stayed lit through the fade and then vanished
  // when fullscreen began. That reads as three steps - the view goes black, the
  // chrome disappears, the screen fills - instead of one.
  //
  // So the OUTER one covers the whole window and fades WITH it. It stops
  // existing when fullscreen starts, which is exactly when the inner one is
  // already fully black, so the handover is black to black. Coming back out it
  // is there again, covering the window as it reappears.
  const fsVeilEl = useRef<HTMLDivElement>(null)
  const fsVeilOuter = useRef<HTMLDivElement>(null)
  const veils = useCallback(
    (): HTMLDivElement[] =>
      [fsVeilEl.current, fsVeilOuter.current].filter((v): v is HTMLDivElement => !!v),
    []
  )
  /** Every raise of the veil starts a new GENERATION, and every scheduled
   *  lift carries the generation it belongs to (2026-09-03). Without this the
   *  1.5s safety lift outlived its own toggle: its delayed chain fired INTO
   *  the next toggle's fade-in and yanked the fresh black back to transparent
   *  mid-rise, so at certain toggle rhythms the swap ran half-veiled or bare -
   *  the owner's "sometimes it just switches without fading". A stale lift
   *  now checks its generation at every step and dies quietly. */
  const veilGen = useRef(0)
  const liftVeil = useCallback(
    (gen: number) => {
      const list = veils()
      const fresh = (): boolean => gen === veilGen.current
      if (!list.length) {
        window.prism.setFsTransition(false)
        window.prism.setFsShroud(false)
        return
      }
      // Hold the black (320ms) before lifting: long enough for main's shroud
      // to have covered the resize and gone (it leaves at 300ms), so the far
      // side is revealed under black. The double rAF then guarantees the new
      // frame is laid out.
      setTimeout(() => {
        if (!fresh()) return
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (!fresh()) return
            for (const v of list) {
              v.style.transition = 'opacity 280ms ease-out'
              v.style.opacity = '0'
            }
            // The shroud fades out on the same clock, so the taskbar and the
            // desktop reappear WITH the window instead of popping a frame
            // ahead of it.
            window.prism.setFsShroud(false)
            // The far side is painted and the black is lifting: the window may
            // have its material back. Held until now rather than released on
            // `enter-full-screen`, which fires while the resize is still running.
            setTimeout(() => {
              if (fresh()) window.prism.setFsTransition(false)
            }, 300)
          })
        )
      }, 320)
    },
    [veils]
  )
  const setFs = useCallback(
    (on: boolean) => {
      veilGen.current += 1
      const gen = veilGen.current
      const doSwap = (): void => {
        // Main covers the display first and asks Windows for real fullscreen a
        // beat later - the sandwich; see `window:set-fullscreen` in main.
        window.prism.setFullscreen(on)
        liftVeil(gen)
      }
      const list = veils()
      const veil = fsVeilEl.current
      // Opaque FIRST, and before anything moves: this is the whole fix for the
      // one-frame desktop flash, and it has to happen while the black is up.
      window.prism.setFsTransition(true)
      // And the shroud rises with the veil, so the taskbar and the desktop
      // fade to black on the same clock as the window instead of snapping.
      window.prism.setFsShroud(true)
      if (!veil || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        doSwap()
        return
      }
      for (const v of list) {
        v.style.transition = 'opacity 150ms ease-in'
        v.style.opacity = '1'
      }
      let fired = false
      const done = (): void => {
        if (fired || gen !== veilGen.current) return
        fired = true
        // One frame of margin after the fade completes, so the swap happens
        // under GUARANTEED full black, never on the fade's last visible frame.
        setTimeout(() => {
          if (gen === veilGen.current) doSwap()
        }, 40)
      }
      veil.addEventListener('transitionend', done, { once: true })
      setTimeout(done, 240) // transitionend can be swallowed; the swap may not
      setTimeout(() => liftVeil(gen), 1500) // if the swap failed, never stay black
    },
    [liftVeil, veils]
  )
  useEffect(() => {
    // Element fullscreen is the source of truth; Escape exits it natively and
    // this keeps the app state honest either way.
    const onChange = (): void => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [setFullscreen])
  // Whichever path changed the state (element, fallback, OS), the new frame is
  // up: lift the veil over it.
  useEffect(() => liftVeil(veilGen.current), [fullscreen, liftVeil])
  return { setFs, viewerBox, fsVeilOuter, fsVeilEl }
}
