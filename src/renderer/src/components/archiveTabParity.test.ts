import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SWEEP_BAND_LOOK } from './browse/sweepLook'
import { nextSort } from '../lib/downloadsView'

// The zip panel wears the Explorer's parts (#519): one band look, one sortable
// header with the Explorer's column keys and click rule.
const src = (p: string): string => readFileSync(join(__dirname, p), 'utf8')

describe('the zip panel and the Explorer share their parts (#519)', () => {
  it('both bands draw from the one SWEEP_BAND_LOOK', () => {
    expect(src('browse/SweepBand.tsx')).toContain('...SWEEP_BAND_LOOK')
    const view = src('ArchiveView.tsx')
    expect(view).toContain('...SWEEP_BAND_LOOK')
    expect(view).not.toMatch(/22%, transparent/)
    expect(String(SWEEP_BAND_LOOK.background)).toContain('16%')
  })

  it('the panel header is the sortable ArchiveHeader, with every column it had', () => {
    const view = src('ArchiveView.tsx')
    expect(view).toContain('<ArchiveHeader')
    expect(view).not.toMatch(/<span className=\{COL_PACKED\}>Packed/)
    const head = src('archive/ArchiveHeader.tsx')
    for (const label of ['Name', 'Type', 'Size', 'Packed', 'Modified']) expect(head).toContain(`label: '${label}'`)
    expect(head).toContain('nextSort(')
  })

  it('a second click on a column turns it round', () => {
    expect(nextSort({ key: 'size', direction: 'asc' }, 'size', false)).toEqual({ key: 'size', direction: 'desc' })
    expect(nextSort({ key: 'name', direction: 'asc' }, 'modified', false)).toEqual({ key: 'modified', direction: 'asc' })
  })
})