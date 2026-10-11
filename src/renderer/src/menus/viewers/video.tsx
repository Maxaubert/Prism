/**
 * The film's menu: what you get right-clicking a playing video (VideoView,
 * anywhere on the picture; not while it plays in the background). The cog's
 * menu is PlayerMenu, not this.
 *
 * Its rows predate the shared helpers and keep their own shape: a tick column
 * on every row (this file's own tickIf, not fileVerbs'), and their own Next /
 * Previous and Explorer / Copy path rows rather than stepVerbs and fileVerbs.
 */
import type { JSX } from 'react'
import type { AudioTrackOffer } from '@shared/types'
import type { MenuItem } from '../../components/ContextMenu'
import { pngFromVideo } from '../../lib/copyImage'
import type { Subtitles } from '../../lib/useSubtitles'
import { VIDEO_FITS, type VideoFit } from '../../lib/videoFit'

export interface VideoMenuContext {
  path: string
  onStep: (dir: 1 | -1) => void
  canStep: (dir: 1 | -1) => boolean
  /** The picture's current fit, and the pick that changes (and remembers) it. */
  fit: VideoFit
  pickFit: (id: VideoFit) => void
  /** The current playback rate, read from the media controls. */
  rate: number
  setRate: (r: number) => void
  /** The file's audio tracks; the picker shows only when there is more than one. */
  audioTracks: AudioTrackOffer[]
  /** The chosen track's index, null for the file's default. */
  track: number | null
  setTrack: (index: number | null) => void
  /** What a track is called in the picker. */
  trackLabel: (t: AudioTrackOffer, i: number) => string
  subtitles: Pick<Subtitles, 'tracks' | 'active' | 'pick' | 'add'>
  /** Whether there was a picture to take when the menu opened. */
  hasFrame: boolean
  /** The video element as it was when the menu opened, for Copy frame. */
  el: HTMLVideoElement | null
}

/** A ticked row: the menu has no checkbox of its own, so the tick is the icon. */
const tickIf = (on: boolean): JSX.Element => (
  <span className="w-2.5 shrink-0 text-[var(--color-accent-hi)]" aria-hidden>
    {on ? '✓' : ''}
  </span>
)

/**
 * The right-click menu (2026-08-27), VLC-shaped: what the picture does, how
 * fast it plays, which subtitles, and the file itself. Everything here is
 * reachable elsewhere too - this is the place people look first.
 */
export function videoMenu(ctx: VideoMenuContext): MenuItem[] {
  const {
    path,
    onStep,
    canStep,
    fit,
    pickFit,
    rate,
    audioTracks,
    track,
    setTrack,
    trackLabel,
    subtitles,
    hasFrame,
    el
  } = ctx
  // Trimmed to what belongs here (owner picks, 2026-08-27). Play/pause and
  // fullscreen came out: a click and a double-click already do them, and a
  // menu you trim is not the place for a third way. Every row carries the
  // tick column, ticked or not, so the labels line up.
  const items: MenuItem[] = [
    {
      label: 'Next video',
      icon: tickIf(false),
      disabled: !canStep(1),
      onPick: () => onStep(1)
    },
    {
      label: 'Previous video',
      icon: tickIf(false),
      disabled: !canStep(-1),
      onPick: () => onStep(-1)
    },
    {
      label: 'Picture',
      icon: tickIf(false),
      // No hints in here: `hint` is the shortcut column, and a sentence in
      // it is a wall of text down the right-hand side.
      children: VIDEO_FITS.map((f) => ({
        label: f.label,
        icon: tickIf(fit === f.id),
        onPick: () => pickFit(f.id)
      }))
    },
    {
      label: 'Speed',
      // The same rate the cog's slider drives - one setting, two ways in -
      // so the current value belongs on the row that opens the list.
      hint: `${rate.toFixed(2)}×`,
      icon: tickIf(false),
      children: [0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => ({
        label: r === 1 ? 'Normal' : `${r}×`,
        icon: tickIf(Math.abs(rate - r) < 0.01),
        onPick: () => ctx.setRate(r)
      }))
    },
    ...(audioTracks.length > 1
      ? [
          {
            // Only for a file that HAS a choice: one track needs no picker.
            label: 'Audio track',
            icon: tickIf(false),
            children: [
              {
                label: 'Default',
                icon: tickIf(track === null),
                onPick: () => setTrack(null)
              },
              ...audioTracks.map((t, i) => ({
                label: trackLabel(t, i),
                icon: tickIf(track === t.index),
                onPick: () => setTrack(t.index)
              }))
            ]
          } as MenuItem
        ]
      : []),
    {
      // Always here, even with nothing found: this is the one place that can
      // ADD a track, which is the point of the manual row. (The cog still
      // hides its section when there is nothing to list - it is a list, not
      // a way to do something.)
      label: 'Subtitles',
      icon: tickIf(false),
      children: [
        {
          label: 'Off',
          icon: tickIf(subtitles.active === null),
          onPick: () => subtitles.pick(null)
        },
        ...subtitles.tracks.map((t) => ({
          label: t.label,
          icon: tickIf(subtitles.active === t.path),
          onPick: () => subtitles.pick(t.path)
        })),
        { label: 'Add subtitle file…', icon: tickIf(false), onPick: () => subtitles.add() }
      ]
    },
    // The frame goes to the OS clipboard and Explorer is the desktop's:
    // on the phone (#106) neither row is offered.
    ...(window.prism.capabilities.clipboard
      ? [
          {
            // VLC's Shift+S, as a visible verb rather than a keystroke: the
            // fullscreen read-only rule allows a click on something you can
            // see. Greyed when there is no picture to take - an enabled row
            // that does nothing is the failure that got the other rows cut.
            label: 'Copy frame',
            icon: tickIf(false),
            disabled: !hasFrame,
            // Wrapped rather than passed: menuItems() runs in the render
            // pass that draws the menu, and the linter follows a bare
            // reference into copyFrame's ref access. The extra closure is
            // the seam.
            onPick: () =>
              void pngFromVideo(el).then((png) => {
                if (png) window.prism.copyImageToClipboard(png)
              })
          }
        ]
      : []),
    // Beside Copy frame (owner, 2026-10-12: the clipboard rows together).
    {
      label: 'Copy path',
      icon: tickIf(false),
      onPick: () => void navigator.clipboard.writeText(path)
    },
    ...(window.prism.capabilities.explorer
      ? [
          {
            label: 'Show in File Explorer',
            icon: tickIf(false),
            onPick: () => window.prism.showInExplorer(path)
          }
        ]
      : [])
  ]
  return items
}
