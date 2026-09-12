/**
 * The phone page's half of the diagnostics log (2026-09-12): what the
 * PLAYER saw, posted to the PC in small batches and written beside the
 * server's own timeline in `userData/phone/phone.log`. An iPad shows
 * nothing of why a film hitched, and its Web Inspector needs a Mac; this
 * is the substitute. Lines are queued and flushed every five seconds, or at
 * once when the batch is full, with `keepalive` so a page going to the
 * background still hands over what it has. Nothing here affects playback:
 * a post that fails is dropped.
 *
 * `pack` is the pure part: what one post carries, capped, so a stalled
 * player that logs every frame cannot grow a batch without bound.
 */
import { apiUrl } from './api'

export const BATCH = 40
const FLUSH_MS = 5000

let queue: string[] = []
let timer: number | null = null

/** The lines a post carries out of the queue, and what stays behind. */
export function pack(lines: string[]): { send: string[]; rest: string[] } {
  return { send: lines.slice(0, BATCH), rest: lines.slice(BATCH) }
}

function flush(): void {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
  if (!queue.length) return
  const { send, rest } = pack(queue)
  queue = rest
  void fetch(apiUrl('/api/diag'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lines: send }),
    keepalive: true
  }).catch(() => undefined)
  if (queue.length) flush()
}

/** One line for the log. Stamped with the page's own clock so the PC can
 *  see the order the phone saw things in, whatever the wire delayed. */
export function diag(text: string): void {
  queue.push(`${(performance.now() / 1000).toFixed(2)} ${text}`)
  if (queue.length >= BATCH) flush()
  else if (timer === null) timer = window.setTimeout(flush, FLUSH_MS)
}

// A phone going to the background stops running timers, and the lines that
// matter most are the ones just before it did: flush on the way out.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

const num = (n: number): string => n.toFixed(2)

/** What a media element is doing, as one line: where it is, how much is
 *  buffered ahead, how many ranges (a hole shows as two), and the frames
 *  the decoder dropped. */
export function mediaState(el: HTMLMediaElement): string {
  const b = el.buffered
  let ahead = 0
  let inRange = false
  for (let i = 0; i < b.length; i++) {
    if (el.currentTime >= b.start(i) - 0.1 && el.currentTime <= b.end(i)) {
      ahead = b.end(i) - el.currentTime
      inRange = true
    }
  }
  const q = (el as HTMLVideoElement).getVideoPlaybackQuality?.()
  return (
    `t=${num(el.currentTime)} ${el.paused ? 'paused' : 'playing'} ahead=${num(ahead)}${inRange ? '' : ' (outside buffer)'}` +
    ` ranges=${b.length} ready=${el.readyState} rate=${el.playbackRate}` +
    (q ? ` dropped=${q.droppedVideoFrames}/${q.totalVideoFrames}` : '')
  )
}

/** Watch a player: the events that ARE a hitch (waiting, stalled, a seek
 *  nobody asked for), and a state sample every ten seconds. Returns the
 *  detach. */
export function watchMedia(el: HTMLMediaElement): () => void {
  const events = ['waiting', 'stalled', 'seeking', 'seeked', 'playing', 'pause', 'ended', 'error', 'ratechange']
  const on = (e: Event): void => {
    const err = e.type === 'error' && el.error ? ` ${el.error.code} ${el.error.message}` : ''
    diag(`${e.type}${err} ${mediaState(el)}`)
  }
  for (const name of events) el.addEventListener(name, on)
  diag(`watch ${el.tagName.toLowerCase()} ${navigator.userAgent}`)
  const tick = window.setInterval(() => diag(`sample ${mediaState(el)}`), 10_000)
  return () => {
    for (const name of events) el.removeEventListener(name, on)
    window.clearInterval(tick)
    flush()
  }
}
