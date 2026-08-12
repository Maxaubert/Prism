/** Bytes -> "824 B" / "2.4 KB" / "25 MB": one decimal until three digits,
 *  then none, the way Explorer rounds. Empty for nonsense input. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${Math.round(n)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let u = -1
  do {
    v /= 1024
    u += 1
  } while (v >= 1024 && u < units.length - 1)
  return `${v >= 100 ? String(Math.round(v)) : v.toFixed(1)} ${units[u]}`
}

/** Seconds -> "m:ss" or "h:mm:ss". Returns "0:00" for non-finite input. */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
