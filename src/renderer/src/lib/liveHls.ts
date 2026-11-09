import { filmLine } from './filmDiag'

/**
 * hls.js on a desktop <video>, for the live transcode (2026-11-08,
 * liveRoute.ts). Chromium claims native HLS and cannot be trusted with it
 * (phone/canPlay.ts, measured), so the stream goes through MSE, as on an
 * Android. The library is fetched on first use (it is already the phone's,
 * so nothing new ships) and torn down with the element. A network failure is
 * retried a few times (a job main restarts after a pause answers within a
 * second or two), a media failure gets hls.js's own recovery, and anything
 * past that reaches the player as the element's own error, which is the
 * notice it already draws for a file it cannot play.
 */
export function attachLive(playlist: string, path = ''): (el: HTMLMediaElement) => () => void {
  return (el) => {
    let hls: { destroy(): void } | null = null
    let dead = false
    void import('hls.js').then(({ default: Hls }) => {
      if (dead) return
      if (!Hls.isSupported()) {
        el.src = playlist
        return
      }
      const h = new Hls({ enableWorker: true, lowLatencyMode: false })
      let networkRetries = 0
      let mediaRetries = 0
      h.on(Hls.Events.FRAG_BUFFERED, () => {
        networkRetries = 0
      })
      const giveUp = (detail: string): void => {
        filmLine('live-error', path, { detail }, false)
        h.destroy()
        hls = null
        el.dispatchEvent(new Event('error'))
      }
      h.on(Hls.Events.ERROR, (_e, data) => {
        // A 404 BEFORE THERE IS A PICTURE IS A JOB THAT FELL OVER (review,
        // 2026-11-09): main waits for ffmpeg, so this is its failure, not a slow
        // start (one broken piece can even have been buffered, so `readyState`
        // decides), and hls.js's own patient retries sat on a blank player for
        // over two minutes. It says so now: nothing is left to try.
        const refused = (data as { response?: { code?: number } }).response?.code === 404
        if (el.readyState < 2 && refused && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          giveUp(data.details)
          return
        }
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 4) {
          networkRetries += 1
          window.setTimeout(() => !dead && h.startLoad(), 500 * networkRetries)
          return
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
          mediaRetries += 1
          h.recoverMediaError()
          return
        }
        giveUp(data.details)
      })
      h.loadSource(playlist)
      h.attachMedia(el)
      hls = h
    })
    return () => {
      dead = true
      hls?.destroy()
    }
  }
}
