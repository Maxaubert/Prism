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
