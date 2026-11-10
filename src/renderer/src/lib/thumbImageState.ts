import { thumbKeepsAlpha } from '@shared/thumbAlpha'
import { fsmediaUrl } from './mdUrl'
import type { ThumbSource } from './thumbKind'

// WHAT THE PICTURE BOX DRAWS (zoom grid, Stage 3, spec 4.6), as plain data so
// a test can hold it. `value` is the feed's answer for the path: undefined
// (not asked or not here yet), null (no picture, for good) or the url.
//
// The icon stays under the picture until it has decoded (`loaded`), so the box
// never shows a hole; the box is the same size in every state. A picture that
// can be clear sits on the viewer's checker once it is in; a film wears a play
// glyph once its frame shows; "no picture" is the icon with no mark of any kind.

export interface ThumbImageInput {
  path: string
  source: ThumbSource
  film: boolean
  value: string | null | undefined
  /** The <img> has decoded. */
  loaded: boolean
}

export interface ThumbImageState {
  /** The <img> to mount, or null for none. */
  url: string | null
  /** The kind icon is drawn (under the picture until it shows). */
  icon: boolean
  checker: boolean
  play: boolean
  /** The picture is faded in. */
  visible: boolean
}

export function thumbImageState({ path, source, film, value, loaded }: ThumbImageInput): ThumbImageState {
  // An SVG needs no ask: the page draws the file. A null from a failed draw
  // (`onError`) is how it falls back to the icon.
  const url = source === 'svg' ? (value === null ? null : fsmediaUrl(path)) : (value ?? null)
  const visible = !!url && loaded
  return {
    url,
    icon: !visible,
    checker: visible && (source === 'svg' || thumbKeepsAlpha(path)),
    play: visible && film,
    visible
  }
}
