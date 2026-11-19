export type ByteUnit = 'KB' | 'MB' | 'GB' | 'TB'

export interface BytesOptions {
  /** Decimals per unit while a value is under 100; the default is one. Three
   *  digits are always whole. */
  decimals?: Partial<Record<ByteUnit, number>>
  /** Drop a trailing zero decimal: "47 MB" rather than "47.0 MB". */
  trim?: boolean
  /** Said for zero and for nonsense, instead of "0 B" and "". */
  empty?: string
}

/**
 * Bytes -> "824 B" / "2.4 KB" / "25.0 MB": one decimal until three digits,
 * then none, the way Explorer rounds. Empty for nonsense input. One function
 * for every size on screen (#510); the options bend it for the few places
 * that read differently (the drive donut, the code banner) instead of each
 * keeping a rounding of its own.
 */
export function formatBytes(n: number, options: BytesOptions = {}): string {
  const { decimals = {}, trim = false, empty } = options
  if (empty !== undefined && !(Number.isFinite(n) && n > 0)) return empty
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${Math.round(n)} B`
  const units: ByteUnit[] = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let u = -1
  do {
    v /= 1024
    u += 1
  } while (v >= 1024 && u < units.length - 1)
  let text = v >= 100 ? String(Math.round(v)) : v.toFixed(decimals[units[u]] ?? 1)
  if (trim && text.includes('.')) text = text.replace(/\.?0+$/, '')
  return `${text} ${units[u]}`
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

export interface WhenOptions {
  /** A comma before the clock: "4 Jul 2026, 17:14", the Properties window's form. */
  comma?: boolean
  /** Said for a time nobody gave, instead of an empty string. */
  empty?: string
}

/**
 * Epoch ms -> "4 Jul 2026 17:14", the archive panel's Modified column, or
 * "4 Jul 2026, 17:14" with `comma`.
 *
 * Short and unambiguous: a bare `toLocaleString()` gives "04/07/2026, 17:14:30"
 * here, which is both wider and, at a glance, a different date to an American
 * reader. The month name settles it. Empty for a time no container gave us.
 * Every date on screen goes through here (#510), never a machine-locale
 * `toLocaleString()`.
 */
export function formatWhen(ms: number | undefined, options: WhenOptions = {}): string {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return options.empty ?? ''
  const d = new Date(ms)
  const month = d.toLocaleString('en-GB', { month: 'short' })
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${d.getDate()} ${month} ${d.getFullYear()}${options.comma ? ',' : ''} ${time}`
}
/**
 * How much a member SAVED by being compressed, as "12%".
 *
 * Empty when there is nothing to say: no packed size, an empty member (0 of 0
 * is not a saving), or a stored member that saved nothing. Negative savings
 * (a container that grew tiny files) say nothing rather than "-4%".
 *
 * Capped at 99: a file compressed to a thousandth of itself rounds to 100%,
 * and "100%" in a column beside a real byte count reads as "all of it", which
 * is the opposite of what happened.
 */
export function savedPercent(size: number, packed: number | undefined): string {
  if (packed === undefined || !Number.isFinite(packed) || !Number.isFinite(size)) return ''
  if (size <= 0 || packed <= 0 || packed >= size) return ''
  return `${Math.min(99, Math.round(((size - packed) / size) * 100))}%`
}
