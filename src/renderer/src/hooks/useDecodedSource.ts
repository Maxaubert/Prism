import { useEffect, useState } from 'react'
import type { MediaProbe } from '@shared/types'

export interface DecodedSwap {
  path: string
  url: string | null
  synth: boolean
}

/** What a probe answer (null when the probe rejected) turns the source into. A score the
 *  probe cannot synthesise ends as FAILED (url null, not synth), never stuck on the
 *  synthesising notice (audit #56). Anything else keeps the file's own url. */
export function offerSwap(path: string, offer: Pick<MediaProbe, 'needed' | 'url' | 'synth'> | null, isScore: boolean): DecodedSwap | null {
  if (offer?.synth) return { path, url: null, synth: true }
  if (offer?.needed && offer.url) return { path, url: offer.url, synth: false }
  return isScore ? { path, url: null, synth: false } : null
}

/**
 * The audio player's version of the sidecar.
 *
 * A video file keeps its picture from Chromium and takes only its sound from
 * Prism's decoder, so the two have to be kept in step (useSidecarAudio). An
 * audio file has nothing to keep in step: if Chromium cannot play it, the
 * decoded stream simply IS the source. Apple Lossless, WMA, AC-3, DTS and
 * anything in a container Chromium has no demuxer for (ASF, raw AC-3, AIFF)
 * all arrive here as ordinary, seekable PCM.
 *
 * Returns the url to play and nothing else: the caller cannot tell the
 * difference, which is the point.
 */
export function useDecodedSource(
  path: string,
  url: string
): { src: string; decoded: boolean; synthesising: boolean; failed: boolean } {
  const [swap, setSwap] = useState<{ path: string; url: string | null; synth: boolean } | null>(null)
  const mine = swap?.path === path ? swap : null
  // Recognised by name, before main has answered anything: the first render
  // already puts a src on the element, and a score there errors instantly.
  const isScore = /\.(mid|midi|kar|rmi)$/i.test(path)

  useEffect(() => {
    let live = true
    void window.prism.probeMedia(path).then(
      (offer) => {
        if (!live) return
        // A score has to be SYNTHESISED, which takes seconds: say so and hold
        // the element back, rather than pointing it at a .mid it will reject.
        const next = offerSwap(path, offer, isScore)
        if (next) setSwap(next)
        if (!offer.synth) return
        void window.prism
          .synthMidi(path)
          .catch(() => null)
          .then((u) => {
            if (live) setSwap({ path, url: u, synth: false })
          })
      },
      () => {
        if (live) setSwap(offerSwap(path, null, isScore))
      }
    )
    return () => {
      live = false
    }
  }, [path, isScore])

  const synthesising = mine ? mine.synth : isScore
  return {
    // Empty while synthesising: an <audio> pointed at a score reports an error
    // before the rendering can arrive, and the user sees it.
    src: synthesising ? '' : (mine?.url ?? url),
    decoded: !!mine?.url,
    synthesising,
    failed: !!mine && !mine.synth && mine.url === null
  }
}
