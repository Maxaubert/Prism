import { useEffect, useState } from 'react'

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
export function useDecodedSource(path: string, url: string): { src: string; decoded: boolean } {
  const [swap, setSwap] = useState<{ path: string; url: string } | null>(null)
  const decoded = swap?.path === path
  useEffect(() => {
    let live = true
    void window.prism.probeMedia(path).then((offer) => {
      if (live && offer.needed && offer.url) setSwap({ path, url: offer.url })
    })
    return () => {
      live = false
    }
  }, [path])
  return { src: decoded && swap ? swap.url : url, decoded }
}
