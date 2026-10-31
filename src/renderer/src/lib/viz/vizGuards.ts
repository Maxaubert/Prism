/**
 * When the visualizer may spend anything (review, 2026-10-16).
 */

/**
 * Wake the shared AudioContext only for a track that is playing. The
 * window-wide pointerdown used to resume it whatever the track was doing, so
 * any click undid idleAudioContext and left the audio thread and the device
 * running with nothing playing.
 */
export function wantsResume(state: AudioContextState, paused: boolean): boolean {
  return state === 'suspended' && !paused
}

/**
 * Whether the draw loop runs at all. A hidden tab passes no element (AudioView
 * gives `null` for a background tab), and the loop's idle path only knew a
 * PAUSED element, never a missing one: every background audio tab redrew its
 * 1px off-screen canvas at the display's full rate, all session.
 */
export function drawLoopRuns(media: unknown): boolean {
  return media != null
}

/**
 * What a paused visualizer does with the next frame (perf review, 2026-10-28).
 * `draw` until the picture has settled, or when the canvas size or style
 * changed under it; then `park`: no frame is asked for at all until something
 * wakes it (play, a resize, a style or effect change). It used to ask for one
 * every frame regardless, with a layout read in each, which in a window that
 * is never throttled meant 60 wake-ups a second per paused audio tab, all day.
 */
export function idleFrame(paused: boolean, stillFrames: number, settleFrames: number, changed: boolean): 'draw' | 'park' {
  if (!paused || stillFrames <= settleFrames) return 'draw'
  return changed ? 'draw' : 'park'
}

/** How often a hidden visualizer looks to see whether it is shown again. */
export const HIDDEN_POLL_MS = 250

/**
 * Whether the canvas is on screen at all (#15, 2026-10-31). The viewer stays
 * mounted but `invisible` under Settings, so a song playing there kept its
 * canvas repainting at the display's refresh for nobody: `visibility: hidden`
 * does not slow requestAnimationFrame, and Prism's window is never throttled.
 * A browser that cannot say counts as shown.
 */
export function canvasShown(canvas: { checkVisibility?: (opts?: Record<string, boolean>) => boolean }): boolean {
  if (typeof canvas.checkVisibility !== 'function') return true
  return canvas.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })
}
