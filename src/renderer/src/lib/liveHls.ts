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
export function attachLive(playlist: string): (el: HTMLMediaElement) => () => void {
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
      h.on(Hls.Events.ERROR, (_e, data) => {
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
        h.destroy()
        hls = null
        el.dispatchEvent(new Event('error'))
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
