import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useMediaControls } from '../lib/useMediaControls'
import { Transport } from './Transport'
import { IconFull, IconPause, IconPlay } from './icons'

// The video player: the shared media hook + Transport, on a black stage with a
// video frame, an auto-hiding control overlay, click-to-play with a center flash,
// and fullscreen. Everything transport-related lives in the shared pieces; this
// file only adds the video-specific stage behaviour.

export function VideoView({
  url,
  onToggleFullscreen
}: {
  url: string
  onToggleFullscreen: () => void
}): JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const [chromeOn, setChromeOn] = useState(true)
  const [flash, setFlash] = useState<'play' | 'pause' | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showChrome = useCallback(() => {
    setChromeOn(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (video.current && !video.current.paused) setChromeOn(false)
    }, 2600)
  }, [])

  const c = useMediaControls(video, {
    onFullscreen: onToggleFullscreen,
    onActivity: showChrome,
    onPlayChange: (playing) => (playing ? showChrome() : setChromeOn(true)),
    errorMsg: 'This video can’t be played (unsupported codec or corrupt file).'
  })

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [])

  // Click toggles play with a brief center flash; keyboard toggles quietly.
  const clickToggle = (): void => {
    setFlash(c.playing ? 'pause' : 'play')
    setTimeout(() => setFlash(null), 450)
    c.togglePlay()
  }

  return (
    <div
      className="group relative flex h-full w-full items-center justify-center bg-black"
      onMouseMove={showChrome}
      onMouseLeave={() => c.playing && setChromeOn(false)}
      style={{ cursor: chromeOn ? 'default' : 'none' }}
    >
      <video
        ref={video}
        src={url}
        autoPlay
        // Fill the stage and letterbox only on the axis that needs it. max-w/max-h
        // would cap the video at its intrinsic size, so anything smaller than the
        // window (e.g. a 720p file fullscreened) sat boxed in on all four sides.
        className="h-full w-full object-contain"
        onClick={clickToggle}
        onDoubleClick={onToggleFullscreen}
        {...c.bind}
      />

      {/* center play/pause flash + the resting play affordance when paused */}
      {(flash || (!c.playing && !c.error)) && (
        <div className="pointer-events-none absolute grid place-items-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <div className="scale-[1.6]">{c.playing ? IconPause : IconPlay}</div>
          </div>
        </div>
      )}

      {c.error && (
        <div className="absolute inset-0 grid place-items-center bg-black/80 p-8 text-center text-sm text-[#c9ccd6]">
          {c.error}
        </div>
      )}

      {/* auto-hiding control overlay */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-4 pb-3 pt-10 transition-opacity duration-200 ${
          chromeOn ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <Transport
          c={c}
          extra={
            <button
              className="grid place-items-center hover:text-[var(--color-accent-hi)]"
              onClick={onToggleFullscreen}
              title="Fullscreen (F)"
            >
              {IconFull}
            </button>
          }
        />
      </div>
    </div>
  )
}
