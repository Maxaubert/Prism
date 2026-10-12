import type { JSX } from 'react'
import type { MediaProps } from '@shared/props'
import { formatBytes, formatTime } from '../../lib/format'
import {
  bitrateLabel,
  fpsLabel,
  resolutionLabel,
  subtitlesLabel,
  trackLabel,
  trackName,
  videoLabel
} from '../../lib/propsFormat'
import type { BodyProps } from './bodyProps'
import { ChecksumRow } from './ChecksumRow'
import { OtherBody } from './OtherBody'
import { Banner, Facts, Footer, Group, Reading, Sub, Title, type Fact } from './parts'
import { useLoaded } from './useLoaded'

/** The picture rows: what decides "will it play, and how good is it". */
function videoFacts(media: MediaProps): Fact[] {
  const v = media.video
  return [
    ...(v ? [{ label: 'Resolution', value: resolutionLabel(v.width, v.height) }] : []),
    ...(v?.fps ? [{ label: 'Frame rate', value: fpsLabel(v.fps) }] : []),
    ...(v ? [{ label: 'Video', value: videoLabel(v) }] : []),
    ...(media.bitrate ? [{ label: 'Bitrate', value: bitrateLabel(media.bitrate, 'video') }] : [])
  ]
}

/**
 * A FILM (owner, 2026-10-12, round 1 A): a frame across the top with the
 * length in a badge, the picture rows, then every audio track and the
 * subtitles by language. Without ffprobe (the phone, a broken install) the
 * old rows stand in, which the renderer can still read for itself.
 */
export function VideoBody(props: BodyProps): JSX.Element {
  const { path, name, onClose } = props
  const media = useLoaded(path, () => window.prism.propsMedia(path), null)
  const frame = useLoaded(path, () => window.prism.propsPicture(path), null)
  const stat = useLoaded(path, () => window.prism.statFile(path), null)

  if (media === null) return <OtherBody {...props} />

  return (
    <div data-props-body="video">
      {frame && <Banner src={frame} height={170} badge={media?.duration ? formatTime(media.duration) : undefined} />}
      <Title text={name} />
      {stat && <Sub text={formatBytes(stat.size)} />}
      {media === undefined ? (
        <Reading />
      ) : (
        <>
          <Facts rows={videoFacts(media)} />
          <Group title="Audio tracks">
            {media.audio.length > 0 && (
              <ol className="mt-1.5">
                {media.audio.map((t, i) => (
                  <li key={i} className="flex h-[22px] items-center gap-2.5">
                    <span className="w-3 tabular-nums text-[var(--p-dim2)]">{i + 1}</span>
                    <span className="text-[var(--p-text-soft)]">{trackName(t, i)}</span>
                    <span className="min-w-0 truncate text-[var(--p-dim)]">{trackLabel(t)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Group>
          <Group title="Subtitles">
            <div className="mt-1.5 text-[var(--p-text-soft)]">{subtitlesLabel(media.subtitles)}</div>
          </Group>
        </>
      )}
      <Facts rows={[]} className="mt-4">
        <ChecksumRow path={path} />
      </Facts>
      <Footer onClose={onClose} />
    </div>
  )
}
