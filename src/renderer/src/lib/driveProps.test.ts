import { describe, expect, it } from 'vitest'
import { driveProps } from './driveProps'

const TB = 1024 ** 4

describe('a drive in Properties (owner, 2026-10-12)', () => {
  it('says what it is, where, and how full, without walking the disk', () => {
    const rows = driveProps({ path: 'C:\\', kind: 'local', system: true, total: 8 * TB, free: 4 * TB })
    expect(rows.map((r) => r.label)).toEqual(['Type', 'Location', 'Capacity', 'Used', 'Free'])
    expect(rows[0].value).toBe('Local disk (Windows)')
    expect(rows[3].value).toMatch(/\(50%\)$/)
  })

  it('names its own label, and says so when the sizes have not come', () => {
    const rows = driveProps({ path: 'D:\\', kind: 'removable', label: 'ESD-USB' })
    expect(rows).toEqual([
      { label: 'Type', value: 'Removable drive' },
      { label: 'Location', value: 'D:\\' },
      { label: 'Label', value: 'ESD-USB' },
      { label: 'Size', value: 'Not known' }
    ])
  })
})
