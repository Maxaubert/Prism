import type { SweepBegin, SweepEnd, SweepUpdate } from '@shared/sweepOverlay'

/**
 * Whether main draws the sweep box natively for this page (#338). One
 * subscription per page, made at startup (`watchSweepOverlay`, from main.tsx):
 * main says it on every load and every change, and a page that subscribed
 * late would miss the answer. Until the page has heard `true` the answer is
 * false, so the DOM box draws: the fallback is the default, never a guess.
 */
let native = false
let watching = false

interface Bridge {
  begin(m: SweepBegin): void
  update(m: SweepUpdate): void
  end(m: SweepEnd): void
  onState(cb: (s: { native: boolean }) => void): () => void
}

/** The preload's bridge, or null where there is none (unit tests, a phone page). */
export function sweepBridge(): Bridge | null {
  return (globalThis as { prism?: { sweepOverlay?: Bridge } }).prism?.sweepOverlay ?? null
}

export function watchSweepOverlay(): void {
  if (watching) return
  const bridge = sweepBridge()
  if (!bridge) return
  watching = true
  bridge.onState((s) => {
    native = s?.native === true
  })
}

export function nativeBox(): boolean {
  return native
}
