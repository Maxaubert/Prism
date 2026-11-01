/**
 * A Range header, read per RFC 7233 (#23, 2026-11-01).
 *
 * The fsmedia:// handler used to read `bytes=-500` (the LAST 500 bytes) as
 * 0-500, answer a start past the end with the file's last byte instead of a
 * 416, and crash on a 0-byte file (end = -1). Three answers, kept apart:
 *
 * - `{ start, end }`: serve exactly those bytes (206). The end is clamped to
 *   the file; a suffix longer than the file is the whole file.
 * - `'unsatisfiable'`: a well-formed range with nothing in the file to serve
 *   (start at or past the end, a suffix of 0, any range on an empty file):
 *   416 with `Content-Range: bytes * /size`.
 * - `null`: no header, or one this server does not read (another unit, a
 *   malformed spec, several ranges): the header is IGNORED and the whole file
 *   goes back (200), which the RFC allows.
 */
export type ByteRange = { start: number; end: number }

export function parseByteRange(
  header: string | null,
  total: number
): ByteRange | 'unsatisfiable' | null {
  if (!header) return null
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header)
  if (!m) return null
  const [, first, last] = m
  if (!first && !last) return null
  if (!first) {
    // "-N": the last N bytes.
    const n = Number(last)
    if (!Number.isSafeInteger(n)) return null
    if (n === 0 || total <= 0) return 'unsatisfiable'
    return { start: Math.max(0, total - n), end: total - 1 }
  }
  const start = Number(first)
  if (!Number.isSafeInteger(start)) return null
  let end = last ? Number(last) : total - 1
  if (last && !Number.isSafeInteger(end)) return null
  // A last before the first is not a range at all: ignored, not refused.
  if (last && end < start) return null
  if (start >= total) return 'unsatisfiable'
  if (end >= total) end = total - 1
  return { start, end }
}
