import type { CellObject, WorkSheet } from 'xlsx'

/**
 * One worksheet as a GRID, the way Excel draws it (#437).
 *
 * The first cut was `sheet_to_html` poured into the prose page: a 10-column
 * report ran off the paper into the dark canvas, every cell wrapped word by
 * word, and the title block was squeezed into column A. A spreadsheet is not
 * prose, so it gets what Excel shows instead: column letters and row numbers,
 * the file's own column widths, one line per row, text that runs on into
 * empty neighbours, numbers on the right, and the header fills.
 *
 * Everything that varies per file travels as an attribute the sanitiser can
 * check against a pattern (`<col width>`, `<td bgcolor>`), never as a style:
 * a style is CSS, and CSS from somebody else's file can fetch.
 */

/** Rows and columns past these are left out, and the sheet says so. */
export const MAX_ROWS = 5000
export const MAX_COLS = 200

/** Excel's default column, 8.43 characters. */
const DEFAULT_WCH = 8.43
/** Roughly one character of the grid's 13px face. */
const CHAR_PX = 7

interface Range {
  s: { r: number; c: number }
  e: { r: number; c: number }
}

interface ColInfo {
  hidden?: boolean
  wch?: number
  wpx?: number
  width?: number
}

/** "A", "B", ... "Z", "AA": the column's letters. */
export function colName(c: number): string {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** Parse "A1:J208" (or a single "B3") into zero-based bounds. */
export function parseRef(ref: string): Range | null {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref.toUpperCase())
  if (!m) return null
  const col = (s: string): number => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
  const s = { r: Number(m[2]) - 1, c: col(m[1]) }
  const e = m[3] ? { r: Number(m[4]) - 1, c: col(m[3]) } : { ...s }
  return { s, e }
}

/** A column's width in screen pixels, Excel's way: characters x 7 + 5. */
export function colPx(info: ColInfo | undefined): number {
  const wch = info?.wch ?? (info?.width !== undefined ? info.width : DEFAULT_WCH)
  return Math.max(8, Math.round(wch * CHAR_PX + 5))
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The text Excel would show: its formatted value, else the raw one. */
function shown(cell: CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return cell?.w ?? ''
  if (cell.w !== undefined) return cell.w
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE'
  return String(cell.v)
}

/** A solid fill's colour as #rrggbb, or null. */
function fill(cell: CellObject | undefined): string | null {
  const s = cell?.s as { patternType?: string; fgColor?: { rgb?: string } } | undefined
  if (s?.patternType !== 'solid') return null
  const rgb = s.fgColor?.rgb
  if (!rgb) return null
  // ARGB from some writers, RGB from others.
  const hex = rgb.length === 8 ? rgb.slice(2) : rgb
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null
}

/** True when white text reads better than black on this fill. */
function darkFill(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b < 150
}

/** The sheet as one `<table class="xl">`, row numbers and column letters included. */
export function sheetToHtml(ws: WorkSheet): string {
  const range = parseRef(ws['!ref'] ?? '')
  if (!range) return '<p class="xl-empty">This sheet is empty.</p>'

  const colsInfo = (ws['!cols'] ?? []) as ColInfo[]
  const rowsInfo = (ws['!rows'] ?? []) as Array<{ hidden?: boolean } | undefined>
  const lastRow = Math.min(range.e.r, range.s.r + MAX_ROWS - 1)
  const lastCol = Math.min(range.e.c, range.s.c + MAX_COLS - 1)

  const cols: number[] = []
  for (let c = range.s.c; c <= lastCol; c++) if (!colsInfo[c]?.hidden) cols.push(c)
  const width = new Map(cols.map((c) => [c, colPx(colsInfo[c])]))

  // Merged blocks: the top-left cell spans, the rest are not drawn.
  const span = new Map<string, { rows: number; cols: number }>()
  const covered = new Set<string>()
  for (const m of (ws['!merges'] ?? []) as Range[]) {
    span.set(`${m.s.r},${m.s.c}`, { rows: m.e.r - m.s.r + 1, cols: cols.filter((c) => c >= m.s.c && c <= m.e.c).length })
    for (let r = m.s.r; r <= m.e.r; r++)
      for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(`${r},${c}`)
  }

  const at = (r: number, c: number): CellObject | undefined => ws[`${colName(c)}${r + 1}`] as CellObject | undefined
  const blank = (r: number, c: number): boolean =>
    !covered.has(`${r},${c}`) && shown(at(r, c)) === '' && !fill(at(r, c))

  const out: string[] = ['<table class="xl"><colgroup><col width="44" />']
  for (const c of cols) out.push(`<col width="${width.get(c)}" />`)
  out.push('</colgroup><thead><tr><th class="xl-corner"></th>')
  for (const c of cols) out.push(`<th>${colName(c)}</th>`)
  out.push('</tr></thead><tbody>')

  for (let r = range.s.r; r <= lastRow; r++) {
    if (rowsInfo[r]?.hidden) continue
    out.push(`<tr><th>${r + 1}</th>`)
    // Cells a run of text has crossed into: they lose their right gridline so
    // the words read as one line, the way Excel hides it.
    let runLeft = 0
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i]
      const key = `${r},${c}`
      if (covered.has(key)) continue
      const cell = at(r, c)
      const text = shown(cell)
      const bg = fill(cell)
      const cls: string[] = []
      const numeric = cell?.t === 'n' || cell?.t === 'd'
      if (numeric) cls.push('xl-n')
      else if (cell?.t === 'b' || cell?.t === 'e') cls.push('xl-c')
      if (bg && darkFill(bg)) cls.push('xl-ink')

      if (text && !numeric) {
        // How far the text runs: over empty neighbours until it fits.
        let need = text.length * CHAR_PX + 8 - (width.get(c) ?? 0)
        let k = 0
        while (need > 0 && i + k + 1 < cols.length && blank(r, cols[i + k + 1])) {
          k++
          need -= width.get(cols[i + k]) ?? 0
        }
        if (k > 0) {
          cls.push('xl-run')
          runLeft = k
        }
      } else if (runLeft > 0) {
        runLeft--
        if (runLeft > 0) cls.push('xl-run-on')
      }

      const sp = span.get(key)
      const attrs =
        (cls.length ? ` class="${cls.join(' ')}"` : '') +
        (bg ? ` bgcolor="${bg}"` : '') +
        (sp && sp.cols > 1 ? ` colspan="${sp.cols}"` : '') +
        (sp && sp.rows > 1 ? ` rowspan="${sp.rows}"` : '')
      out.push(`<td${attrs}>${esc(text)}</td>`)
    }
    out.push('</tr>')
  }
  out.push('</tbody></table>')

  const rows = range.e.r - range.s.r + 1
  const ncols = range.e.c - range.s.c + 1
  if (rows > MAX_ROWS || ncols > MAX_COLS)
    out.push(
      `<p class="xl-more">Showing the first ${Math.min(rows, MAX_ROWS)} rows and ${Math.min(ncols, MAX_COLS)} columns of ${rows} x ${ncols}.</p>`
    )
  return out.join('')
}

/** Every sheet of a workbook, named when there is more than one. */
export function workbookToHtml(names: string[], sheets: Record<string, WorkSheet>): string {
  const parts = names.map((name) => {
    const head = names.length > 1 ? `<h2 class="xl-name">${esc(name)}</h2>` : ''
    return `<section class="xl-sheet">${head}${sheetToHtml(sheets[name])}</section>`
  })
  return `<div class="xl-book">${parts.join('')}</div>`
}
