/**
 * The pictures either side of the one on screen that are worth warming: images
 * only, and none bigger than `maxBytes` (warming one costs more in memory and
 * decode jank than it saves). An unknown size (#271) is warmed, as 0 (could not
 * stat) always was.
 *
 * Paths, so the App can key its warm-up on them (perf review, 2026-10-28): the
 * file list is rebuilt by every details patch, and a warm-up keyed on the list
 * gave up and restarted its reads each time.
 */
export function neighbourImages(
  files: readonly { path: string; kind: string; size?: number }[],
  index: number,
  maxBytes: number
): string[] {
  const out: string[] = []
  for (const d of [-1, 1]) {
    const n = files[index + d]
    if (n && n.kind === 'image' && (n.size ?? 0) <= maxBytes) out.push(n.path)
  }
  return out
}
