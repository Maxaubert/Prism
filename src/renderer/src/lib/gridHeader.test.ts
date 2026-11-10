import { describe, expect, it } from 'vitest'
import { gridHeaderColumns } from './gridHeader'

// In a grid the header band is a strip of the same sort buttons (spec 5.6):
// Name, Date modified, Size, Type, packed left; the lowest priority go first
// when the list is narrow, Name and Date modified never.
describe('grid header strip', () => {
  const all = [
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'size', label: 'Size' },
    { key: 'modified', label: 'Date modified' }
  ] as const

  it('shows the same four buttons, in the strip order', () => {
    expect(gridHeaderColumns(all, 900).map((c) => c.key)).toEqual(['name', 'modified', 'size', 'type'])
  })

  it('keeps each button exactly as the list has it (key and label)', () => {
    for (const c of gridHeaderColumns(all, 900)) expect(all.find((a) => a.key === c.key)).toEqual(c)
  })

  it('drops Type then Size below 360px, never Name or Date modified', () => {
    expect(gridHeaderColumns(all, 359).map((c) => c.key)).toEqual(['name', 'modified'])
    expect(gridHeaderColumns(all, 100).map((c) => c.key)).toEqual(['name', 'modified'])
    expect(gridHeaderColumns(all, 360).map((c) => c.key)).toEqual(['name', 'modified', 'size', 'type'])
  })

  it('a list of other columns passes through its own names', () => {
    expect(gridHeaderColumns([{ key: 'name', label: 'Name' }], 900).map((c) => c.key)).toEqual(['name'])
  })
})
