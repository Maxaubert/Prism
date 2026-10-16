/** Past this, the drop analysis is skipped: its cost is the file's whole
 *  decoded length in memory, and nobody needs drop rings in an audiobook. */
export const DROPS_MAX_SECONDS = 15 * 60

/**
 * Whether a track this long may be decoded whole for its drops.
 *
 * An UNKNOWN length is a no (review, 2026-10-16). The guard used to read
 * "skip when finite and too long", so a NaN duration - the element before its
 * metadata - passed it, and the first run fetched and decoded a multi-hour
 * audiobook whole: exactly what the 2026-08-26 guard was written to stop.
 */
export function dropsAllowed(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0 && duration <= DROPS_MAX_SECONDS
}

/** The parts of a media element the watch reads. */
export interface DropMedia {
  readonly duration: number
  readonly readyState: number
  readonly currentSrc: string
  readonly src: string
  addEventListener(type: 'loadedmetadata', fn: () => void): void
  removeEventListener(type: 'loadedmetadata', fn: () => void): void
}

const HAVE_METADATA = 1

/**
 * Run the drop analysis once per loaded source, and only once its length is
 * known (review, 2026-10-16).
 *
 * It used to run at mount AND on every `loadeddata`: the mount run saw NaN
 * and decoded whatever it was, and a song was fetched and decoded twice. Now
 * it runs when the metadata is in (at once if it already is), and each new
 * run aborts the one before, as does the cleanup.
 */
export function watchDrops(
  media: DropMedia,
  analyse: (url: string, signal: AbortSignal) => Promise<number[]>,
  onDrops: (times: number[]) => void
): () => void {
  let current: AbortController | null = null
  const run = (): void => {
    current?.abort()
    current = null
    onDrops([])
    if (!dropsAllowed(media.duration)) return
    const url = media.currentSrc || media.src
    if (!url) return
    const mine = new AbortController()
    current = mine
    analyse(url, mine.signal).then(
      (times) => {
        if (!mine.signal.aborted) onDrops(times)
      },
      () => {
        /* leave empty - no drop rings for this file */
      }
    )
  }
  if (media.readyState >= HAVE_METADATA) run()
  media.addEventListener('loadedmetadata', run)
  return () => {
    current?.abort()
    media.removeEventListener('loadedmetadata', run)
  }
}
