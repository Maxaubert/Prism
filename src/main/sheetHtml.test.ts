import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { colName, colPx, parseRef, sheetToHtml, workbookToHtml, MAX_ROWS } from './sheetHtml'
import { sanitizeDoc } from './docSanitize'

function sheet(rows: unknown[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows)
}

describe('sheetHtml (#437: a spreadsheet is a grid, not a page)', () => {
  it('names columns the way Excel does', () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA'])
  })

  it('reads a range', () => {
    expect(parseRef('A1:J208')).toEqual({ s: { r: 0, c: 0 }, e: { r: 207, c: 9 } })
    expect(parseRef('B3')).toEqual({ s: { r: 2, c: 1 }, e: { r: 2, c: 1 } })
    expect(parseRef('')).toBeNull()
  })

  it("sizes a column from the file's character width", () => {
    expect(colPx({ wch: 22.62 })).toBe(163)
    expect(colPx(undefined)).toBe(64)
  })

  it('draws letters, row numbers and the file widths', () => {
    const ws = sheet([['a', 'b']])
    ws['!cols'] = [{ wch: 10 }, { wch: 30 }]
    const html = sheetToHtml(ws)
    expect(html).toContain('<col width="75" /><col width="215" />')
    expect(html).toContain('<th>A</th><th>B</th>')
    expect(html).toContain('<tr><th>1</th>')
  })

  it('puts numbers on the right and keeps their formatted text', () => {
    const ws = sheet([['RUH125', 104.025]])
    ws.B1.w = '104.0'
    expect(sheetToHtml(ws)).toContain('<td class="xl-n">104.0</td>')
  })

  it('lets a title run on over empty neighbours, and not over full ones', () => {
    const ws = sheet([['Type: Rapport uonsket hendelse', null, null], ['Type: Rapport uonsket hendelse', 'x']])
    const html = sheetToHtml(ws)
    const [, , row1, row2] = html.split('<tr>')
    expect(row1).toContain('class="xl-run"')
    expect(row2).not.toContain('xl-run')
  })

  it('carries a solid fill, with light ink on a dark one', () => {
    const ws = sheet([['Nr.']])
    ws.A1.s = { patternType: 'solid', fgColor: { rgb: '8497B0' } }
    expect(sheetToHtml(ws)).toContain('<td class="xl-ink" bgcolor="#8497b0">Nr.</td>')
  })

  it('spans merged cells and leaves out what they cover', () => {
    const ws = sheet([['Title', 'gone', 'gone'], ['a', 'b', 'c']])
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]
    const html = sheetToHtml(ws)
    expect(html).toContain('colspan="3"')
    expect(html).not.toContain('gone')
  })

  it('clips a merge that claims the whole sheet to what is drawn', () => {
    const ws = sheet([['Title'], ['b']])
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 1048575, c: 16383 } }]
    const t = performance.now()
    expect(sheetToHtml(ws)).toContain('rowspan="2"')
    expect(performance.now() - t).toBeLessThan(500)
  })

  it('skips hidden columns and rows', () => {
    const ws = sheet([['keep', 'hidden'], ['hidden row', 'x']])
    ws['!cols'] = [{}, { hidden: true }]
    ws['!rows'] = [{}, { hidden: true }]
    const html = sheetToHtml(ws)
    expect(html).not.toContain('hidden')
    expect(html).not.toContain('<th>B</th>')
  })

  it('caps a huge sheet and says so', () => {
    const ws = sheet(Array.from({ length: MAX_ROWS + 10 }, (_, i) => [i]))
    const html = sheetToHtml(ws)
    expect(html).toContain(`<th>${MAX_ROWS}</th>`)
    expect(html).not.toContain(`<th>${MAX_ROWS + 1}</th>`)
    expect(html).toContain(`Showing the first ${MAX_ROWS} rows`)
  })

  it('escapes what the cells say', () => {
    expect(sheetToHtml(sheet([['<img src=x onerror=alert(1)>']]))).toContain('&lt;img')
  })

  it('names the sheets only when there are several', () => {
    expect(workbookToHtml(['Data'], { Data: sheet([['a']]) })).not.toContain('xl-name')
    expect(workbookToHtml(['A', 'B'], { A: sheet([['a']]), B: sheet([['b']]) })).toContain('<h2 class="xl-name">B</h2>')
  })

  it('survives the sanitiser with its widths and fills, and nothing else', async () => {
    const ws = sheet([['Nr.']])
    ws.A1.s = { patternType: 'solid', fgColor: { rgb: '8497B0' } }
    const clean = await sanitizeDoc(workbookToHtml(['Data'], { Data: ws }))
    expect(clean).toContain('bgcolor="#8497b0"')
    expect(clean).toContain('<col width="64">')
    const evil = await sanitizeDoc('<table><colgroup><col width="1;x"></colgroup><tr><td bgcolor="url(x)" style="background:url(x)">a</td></tr></table>')
    expect(evil).not.toContain('url(')
    expect(evil).not.toContain('width="1;x"')
  })
})
