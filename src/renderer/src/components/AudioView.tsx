import { useRef, useState, type JSX, type SyntheticEvent } from 'react'
import { useMediaControls } from '../lib/useMediaControls'
import { Transport } from './Transport'
import { WaveVisualizer } from './WaveVisualizer'

// The audio player: cover tile + track name up top, the horizontal wave-bar
// visualizer as the centerpiece, and the shared Transport at the bottom. The
// <audio> element is hidden and crossorigin so the visualizer's AnalyserNode can
// read its samples (see the corsEnabled fsmedia scheme in main).

// Some MP3s report duration Infinity until a seek forces Chromium to compute it,
// which leaves the scrubber stuck; nudge to the end and back once on load.
function forceDuration(e: SyntheticEvent<HTMLMediaElement>): void {
  const m = e.currentTarget
  if (m.duration === Infinity || Number.isNaN(m.duration)) {
    const onT = (): void => {
      m.removeEventListener('timeupdate', onT)
      m.currentTime = 0
    }
    m.addEventListener('timeupdate', onT)
    try {
      m.currentTime = 1e101
    } catch {
      /* seek not ready yet; ignore */
    }
  }
}

export function AudioView({ url, name }: { url: string; name: string }): JSX.Element {
  // A callback ref feeds both the controls hook (via the ref object) and the
  // visualizer (via state, so it re-renders once the element actually mounts).
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [mediaEl, setMediaEl] = useState<HTMLAudioElement | null>(null)
  const setMedia = (el: HTMLAudioElement | null): void => {
    audioRef.current = el
    setMediaEl(el)
  }
  const c = useMediaControls(audioRef, {
    errorMsg: 'This audio can’t be played (unsupported codec or corrupt file).'
  })
  const ext = (name.split('.').pop() ?? '').toUpperCase()

  return (
    <div className="relative flex h-full w-full flex-col bg-[#0d0f14]">
      <audio
        ref={setMedia}
        src={url}
        crossOrigin="anonymous"
        autoPlay
        className="hidden"
        onLoadedMetadata={forceDuration}
        {...c.bind}
      />

      {c.error ? (
        <div className="grid flex-1 place-items-center p-8 text-center text-sm text-[#c9ccd6]">{c.error}</div>
      ) : (
        <>
          {/* the now-playing cluster, vertically centered: cover, title, wave graph */}
          <div className="flex flex-1 flex-col items-center justify-center gap-10 px-8">
            <div className="flex flex-col items-center gap-5">
              <div className="grid h-32 w-32 place-items-center rounded-3xl bg-gradient-to-br from-[#5b5bd6] via-[#9a6cff] to-[#ff9a8b] text-6xl text-white shadow-[0_12px_40px_rgba(120,90,255,0.35)]">
                ♪
              </div>
              <div className="max-w-full text-center">
                <div className="truncate text-[15px] font-semibold text-[#eceef4]">{name}</div>
                <div className="mt-0.5 text-[12px] text-[var(--color-dim)]">{ext} audio</div>
              </div>
            </div>

            {/* the horizontal wave graph */}
            <div className="h-40 w-full max-w-4xl">
              <WaveVisualizer media={mediaEl} />
            </div>
          </div>

          {/* transport */}
          <div className="shrink-0 border-t border-white/[.06] bg-[#12141b] px-4 py-3">
            <Transport c={c} />
          </div>
        </>
      )}
    </div>
  )
}
