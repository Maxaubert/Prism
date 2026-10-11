/**
 * The audio stage's menu: what you get right-clicking a playing track
 * (AudioView, anywhere on the visualizer; not while it plays in the background).
 */
import type { MenuItem } from '../../components/ContextMenu'
import { RATES } from '../../lib/useMediaControls'
import { fileVerbs, stepVerbs, tickIf } from '../fileVerbs'

export interface AudioMenuContext {
  path: string
  /** The current playback rate, read from the media controls. */
  rate: number
  setRate: (r: number) => void
  /** Absent when the host cannot step the folder: the Next/Previous rows are left out. */
  onStep?: (dir: 1 | -1) => void
  canStep?: (dir: 1 | -1) => boolean
}

/**
 * The audio stage's menu (2026-08-30).
 *
 * A strict subset of the video's, for the reason the video's own rows were
 * trimmed: play/pause and fullscreen are a click and a double-click away
 * already. What is left is what you cannot otherwise reach without leaving
 * the file - the next track, the speed, and where the thing lives.
 */
export function audioMenu(ctx: AudioMenuContext): MenuItem[] {
  const { path, rate, onStep, canStep } = ctx
  return [
    ...(onStep && canStep ? stepVerbs('track', onStep, canStep) : []),
    {
      label: 'Speed',
      // The hint is the current RATE, not a shortcut: the row says what the
      // speed IS, which is the reason to open it.
      hint: `${rate.toFixed(2)}x`,
      children: RATES.map((r) => ({
        label: r === 1 ? 'Normal' : `${r}x`,
        icon: tickIf(Math.abs(rate - r) < 0.001),
        onPick: () => ctx.setRate(r)
      }))
    },
    ...fileVerbs(path)
  ]
}
