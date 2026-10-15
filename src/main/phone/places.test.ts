import { describe, expect, it } from 'vitest'
import type { BrowseShortcut } from '@shared/browse'
import { parsePins, phonePlaces } from './places'

const locations = async (): Promise<BrowseShortcut[]> => [
  { name: 'Home', path: 'C:\\Users\\max', group: 'quick', known: 'home' },
  { name: 'Downloads', path: 'C:\\Users\\max\\Downloads', group: 'quick', known: 'downloads' },
  { name: 'C:', path: 'C:\\', group: 'drive' },
  { name: 'D:', path: 'D:\\', group: 'drive' }
]

describe("the phone's places (2026-10-14)", () => {
  it('Known Folders, then the pins once each, then every drive with its usage', async () => {
    const got = await phonePlaces(
      locations,
      [
        { name: 'Films', path: 'D:\\Films' },
        { name: 'Downloads', path: 'c:\\users\\max\\downloads\\' }
      ],
      async () => [{ path: 'C:\\', label: 'Windows', total: 100, free: 40, system: true }]
    )
    expect(got.quick.map((q) => q.name)).toEqual(['Home', 'Downloads', 'Films'])
    expect(got.quick[1]).toEqual({ name: 'Downloads', path: 'C:\\Users\\max\\Downloads', known: 'downloads' })
    expect(got.drives).toEqual([
      { name: 'C:', path: 'C:\\', label: 'Windows', total: 100, free: 40, system: true },
      { name: 'D:', path: 'D:\\' }
    ])
  })

  it('a mapped network drive is not offered (2026-10-15)', async () => {
    const got = await phonePlaces(locations, [], async () => [{ path: 'D:\\', label: 'share', kind: 'network' }])
    expect(got.drives.map((d) => d.path)).toEqual(['C:\\'])
  })

  it('a drive whose usage failed is still a drive', async () => {
    const got = await phonePlaces(locations, [], async () => {
      throw new Error('powershell')
    })
    expect(got.drives.map((d) => d.path)).toEqual(['C:\\', 'D:\\'])
  })

  it('keeps only local folders from what the window sent', () => {
    expect(
      parsePins([
        { name: 'Films', path: 'D:\\Films' },
        { name: 'Share', path: '\\\\nas\\films' },
        { path: 'E:\\x' },
        'soup',
        null
      ])
    ).toEqual([
      { name: 'Films', path: 'D:\\Films' },
      { name: 'E:\\x', path: 'E:\\x' }
    ])
    expect(parsePins('soup')).toEqual([])
  })
})
