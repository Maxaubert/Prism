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
 * not clear a target that is no longer its own. `clearTarget(id)` is that
 * guard, here rather than in the hook's cleanup so it can be tested.
 *
 * A registry rather than React state, for the same reason `awake.ts` is one:
 * the player lives several components below App, and threading a callback
 * down through Viewer and the deck for one subscriber is more wiring than the
 * thing it wires. And it must NOT become App state on the other side either:
 * the player publishes a fresh snapshot on every clock tick, and a subscriber
 * that mirrored it into state would re-render the whole App four times a
 * second for as long as anything played. With nobody subscribed a set is one
 * small object and a walk over an empty set, which is the cost the ordinary
 * path pays; App subscribes only while a phone listens.
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

/**
 * Take a player out, but only if it is still the one registered. A player
 * that unmounts after the next one has registered (the viewer swapping from
 * one film to the next commits both in one go) must leave that one alone.
 */
export function clearTarget(id: string): void {
  if (current?.id === id) setTarget(null)
}

/** Hear every change. Does not replay the current value; read it with getTarget. */
export function onTarget(cb: (t: Target | null) => void): () => void {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}
