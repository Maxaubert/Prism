import { useState, type JSX } from 'react'
import type { MediaProps } from '@shared/props'
import { formatBytes, formatTime } from '../../lib/format'
import { audioFormat, bitrateLabel } from '../../lib/propsFormat'
import type { BodyProps } from './bodyProps'
import { ChecksumRow } from './ChecksumRow'
import { SoundBarsGlyph } from './glyphs'
import { OtherBody } from './OtherBody'
import { Facts, Footer, Reading, type Fact } from './parts'
import { useLoaded } from './useLoaded'

function songFacts(media: MediaProps): Fact[] {
  const t = media.tags
  const first = media.audio[0]
  const format = first ? audioFormat(first) : ''
  return [
    ...(t.artist ? [{ label: 'Artist', value: t.artist }] : []),
    ...(t.album ? [{ label: 'Album', value: t.year ? `${t.album} (${t.year})` : t.album }] : []),
    ...(t.track ? [{ label: 'Track', value: t.trackTotal ? `${t.track} of ${t.trackTotal}` : String(t.track) }] : []),
    ...(t.genre ? [{ label: 'Genre', value: t.genre }] : []),
    ...(format ? [{ label: 'Format', value: format }] : []),
    ...(media.bitrate ? [{ label: 'Bitrate', value: bitrateLabel(media.bitrate, 'audio') }] : [])
  ]
}

/** The cover's place, 104px square: the file's own art, or the sound bars. */
function Cover({ src }: { src: string | null | undefined }): JSX.Element {
  const [failed, setFailed] = useState(false)
  return (
    <div
      data-props-cover={src && !failed ? 'art' : 'bars'}
      className="grid h-[104px] w-[104px] shrink-0 place-items-center overflow-hidden rounded-md bg-[var(--p-hover-hi)] text-[var(--p-kind-audio)]"
    >
      {src && !failed ? (
        <img src={src} alt="" draggable={false} className="block h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : src === undefined ? null : (
        <SoundBarsGlyph />
      )}
    </div>
  )
}

/**
 * A SONG (owner, 2026-10-12, round 1 A): the cover beside the title, the
 * artist and "7:37 · 47.5 MB", then the tags as rows. A song with no cover
 * gets the sound bars in the audio colour on a dark tile, the same size, so
 * every song lines up (owner, 2026-10-12, audio default D: "Sound bars
 * instead of a note this is good"). The tile is the hover fill over the
 * dialog, the mockup's own "free" colour.
 */
export function AudioBody(props: BodyProps): JSX.Element {
  const { path, name, onClose } = props
  const media = useLoaded(path, () => window.prism.propsMedia(path), null)
  // Asked alongside the probe rather than after it: main answers null at once
  // for a song with no picture, and the tile waits for neither.
  const cover = useLoaded(path, () => window.prism.propsPicture(path), null)
  const stat = useLoaded(path, () => window.prism.statFile(path), null)

  if (media === null) return <OtherBody {...props} />

  const title = media?.tags.title || name.replace(/\.[^.]+$/, '')
  const line = [media?.duration ? formatTime(media.duration) : '', stat ? formatBytes(stat.size) : '']
    .filter(Boolean)
    .join(' · ')

  return (
    <div data-props-body="audio">
      <div className="flex items-center gap-3.5">
        <Cover src={media && !media.cover ? null : cover} />
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold leading-[1.3] text-[var(--p-text)] [overflow-wrap:anywhere]">{title}</h2>
          {media?.tags.artist && <div className="mt-0.5 truncate text-[var(--p-text-soft)]">{media.tags.artist}</div>}
          {line && <div className="mt-0.5 truncate tabular-nums text-[var(--p-dim)]">{line}</div>}
        </div>
      </div>
      {media === undefined ? (
        <Reading />
      ) : (
        <Facts rows={songFacts(media)}>
          <ChecksumRow path={path} />
        </Facts>
      )}
      <Footer onClose={onClose} />
    </div>
  )
}
