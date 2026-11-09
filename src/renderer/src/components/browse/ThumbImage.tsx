import { useState, type JSX, type ReactNode } from 'react'
import { thumbImageState } from '../../lib/thumbImageState'
import type { ThumbSource } from '../../lib/thumbKind'
import { useThumbValue, type ThumbFeed } from '../../lib/useThumbs'

/**
 * THE PICTURE BOX of a row or a tile (zoom grid, Stage 3, 2026-11-09; spec
 * 4.6). A square of `box` px that is the same size before and after the
 * picture comes: the kind icon sits in it on a quiet raised ground, the
 * picture fades in over it (120 ms, none for reduced motion), whole and never
 * cropped. A clear picture sits on the viewer's checker, a film wears a small
 * play glyph, and a file with no picture keeps its icon with no error mark.
 * The look is browse.css `.browse-thumb*`; the choices are `thumbImageState`.
 *
 * `icon` is the row's own KindIcon, drawn by the caller so a marked row can
 * give it the tint it sits on.
 */
export function ThumbImage({
  feed,
  path,
  source,
  film,
  box,
  icon
}: {
  feed: ThumbFeed | null
  path: string
  source: ThumbSource
  film: boolean
  box: number
  icon: ReactNode
}): JSX.Element {
  // Only main's pictures come through the feed; an SVG is the file itself.
  const fed = useThumbValue(source === 'main' ? feed : null, path)
  const [decoded, setDecoded] = useState<string | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const url = thumbImageState({ path, source, film, value: fed, loaded: false }).url
  const failed = url !== null && broken === url
  const state = thumbImageState({
    path,
    source,
    film,
    value: failed ? null : fed,
    loaded: url !== null && decoded === url
  })
  return (
    <span
      className={`browse-thumb${state.checker ? ' p-checker' : ''}`}
      style={{ width: box, height: box }}
      data-thumb-state={state.visible ? 'shown' : state.url ? 'loading' : 'icon'}
    >
      <span className="browse-thumb-icon" data-hidden={!state.icon || undefined}>
        {icon}
      </span>
      {state.url && (
        <img
          className="browse-thumb-img"
          src={state.url}
          alt=""
          draggable={false}
          decoding="async"
          data-shown={state.visible || undefined}
          onLoad={() => setDecoded(state.url)}
          onError={() => setBroken(state.url)}
        />
      )}
      {state.play && (
        <span className="browse-thumb-play" aria-hidden="true">
          <svg viewBox="0 0 10 10" width="100%" height="100%">
            <path d="M3.4 2.3 7.6 5 3.4 7.7z" fill="currentColor" />
          </svg>
        </span>
      )}
    </span>
  )
}
