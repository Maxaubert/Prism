import type { MediaControls } from './useMediaControls'

/**
 * Which player the phone drives (#107).
 *
 * The media deck keeps up to four players mounted, and split view can put
 * more than one on screen, but the phone's Remote mode is a remote for ONE
 * of them: the foreground player, the one that owns the keyboard
 * (`useMediaControls`'s `keys`). That hook registers itself here while it has
 * the keys and takes itself out when it loses them or unmounts, so App never
 * has to work out which of the mounted players is the one you are looking at.
 *
 * The `id` is the hook's own per-mount identity, and it is what makes the
 * unregister safe: a player that unmounts AFTER the next one registered must
 * not clear a target that is no longer its own.
 *
 * A registry rather than React state, for the same reason `awake.ts` is one:
 * the player lives several components below App, and threading a callback
 * down through Viewer and the deck for one subscriber is more wiring than the
 * thing it wires.
 */
export interface Target {
  /** The registering hook's identity, so an unregister can be checked. */
  id: string
  controls: MediaControls
  kind: 'video' | 'audio'
}

let current: Target | null = null
const subs = new Set<(t: Target | null) => void>()

export function getTarget(): Target | null {
  return current
}

/** Register the foreground player, or clear it. Subscribers hear only changes. */
export function setTarget(t: Target | null): void {
  if (t === current) return
  current = t
  for (const cb of subs) cb(t)
}

/** Hear every change. Does not replay the current value; read it with getTarget. */
export function onTarget(cb: (t: Target | null) => void): () => void {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}
