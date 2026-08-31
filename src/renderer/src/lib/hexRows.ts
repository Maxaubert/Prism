/**
 * A file's bytes, as a hex dump reads them (2026-08-31).
 *
 * The formatting is here rather than in the component because it is entirely
 * arithmetic and string work, and because the interesting cases - the last
 * short row, a byte that is not printable, an offset column wide enough for a
 * 4GB file - are exactly the ones worth a test rather than a squint.
 *
 * Deliberately NOT a general hex editor. A hex view of a 4GB ISO is a
 * 268-million-row virtualized list with its own scrolling, selection and copy
 * semantics; this is one page at a time, read-only, of a file Prism could not
 * otherwise show anything of at all.
 */

export interface HexRow {
  /** Byte offset of the row's first byte, in the whole file. */
  offset: number
  /** Sixteen two-character cells, padded with '' where the file ended. */
  cells: string[]
  /** The same bytes as text, with anything unprintable as a dot. */
  ascii: string
}

/** Bytes per row, which is the width every hex dump has ever used. */
export const ROW_BYTES = 16

/** One page: enough to fill a screen, small enough to be one Range request. */
export const PAGE_BYTES = 4096

const hex = (n: number): string => n.toString(16).padStart(2, '0')

/**
 * The offset column, wide enough for the file it is labelling.
 *
 * Eight digits up to 4GB, ten beyond: a fixed eight would silently start
 * wrapping to a wider column part way down a big file, which reads as the
 * table breaking.
 */
export function offsetLabel(at: number, size: number): string {
  const width = size > 0xffffffff ? 10 : 8
  return Math.max(0, Math.floor(at)).toString(16).padStart(width, '0').toUpperCase()
}

/** Printable ASCII stays itself; everything else is a dot, including the
 *  high half, which in a dump is a byte and not a character. */
function printable(b: number): string {
  return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'
}

/** `bytes` laid out sixteen to a row, starting at byte `from` of the file. */
export function hexRows(bytes: Uint8Array, from: number): HexRow[] {
  const rows: HexRow[] = []
  for (let i = 0; i < bytes.length; i += ROW_BYTES) {
    const slice = bytes.subarray(i, i + ROW_BYTES)
    const cells: string[] = []
    let ascii = ''
    for (let j = 0; j < ROW_BYTES; j += 1) {
      // A short last row keeps its columns: blanks, not a ragged edge.
      cells.push(j < slice.length ? hex(slice[j]) : '')
      if (j < slice.length) ascii += printable(slice[j])
    }
    rows.push({ offset: from + i, cells, ascii })
  }
  return rows
}

/** How many pages a file of `size` bytes has. An empty file still has one,
 *  because a viewer showing "page 1 of 0" is a viewer with a bug. */
export function pageCount(size: number): number {
  return Math.max(1, Math.ceil(Math.max(0, size) / PAGE_BYTES))
}

/** A page number kept inside the file, 0-based. */
export function clampPage(page: number, size: number): number {
  const last = pageCount(size) - 1
  if (!Number.isFinite(page)) return 0
  return Math.min(Math.max(0, Math.floor(page)), last)
}

/** The Range header for a page: inclusive on both ends, as HTTP wants it. */
export function pageRange(page: number, size: number): string {
  const from = clampPage(page, size) * PAGE_BYTES
  const to = Math.min(from + PAGE_BYTES, Math.max(size, 1)) - 1
  return `bytes=${from}-${Math.max(from, to)}`
}
