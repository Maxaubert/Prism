import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDriveUsage, driveKind, LABEL_COMMAND, parseLabels, STATFS_WAIT } from './driveUsage'

const TB = 1024 ** 4

describe('parseLabels', () => {
  it('reads one drive per line, label and type', () => {
    const got = parseLabels('C:|3|Windows\r\nD:|3|\r\nE:|2|SANDISK\r\nZ:|4|share\r\nnoise\r\n')
    expect(got.get('C:\\')).toEqual({ label: 'Windows', kind: 'local' })
    expect(got.get('D:\\')).toEqual({ label: '', kind: 'local' })
    expect(got.get('E:\\')).toEqual({ label: 'SANDISK', kind: 'removable' })
    expect(got.get('Z:\\')).toEqual({ label: 'share', kind: 'network' })
    expect(got.size).toBe(4)
  })
  it('keeps a label with a bar in it whole', () => {
    expect(parseLabels('F:|3|a|b').get('F:\\')?.label).toBe('a|b')
  })
  it('asks PowerShell for UTF-8 before it prints a label', () => {
    // Piped, it writes in the OEM code page and "Søren" arrives broken.
    expect(LABEL_COMMAND.startsWith('[Console]::OutputEncoding')).toBe(true)
    expect(LABEL_COMMAND.indexOf('UTF8')).toBeLessThan(LABEL_COMMAND.indexOf('Get-CimInstance'))
  })
  it('reads a label that is not ASCII', () => {
    expect(parseLabels('D:|3|Søren').get('D:\\')?.label).toBe('Søren')
  })
  it('names the drive types', () => {
    expect([2, 3, 4, 5, 0].map(driveKind)).toEqual(['removable', 'local', 'network', 'optical', 'local'])
  })
})

describe('driveUsage', () => {
  afterEach(() => vi.useRealTimers())

  const deps = (over: Partial<Parameters<typeof createDriveUsage>[0]> = {}) => ({
    space: vi.fn(async () => ({ total: TB, free: TB / 4 })),
    labels: vi.fn(async () => parseLabels('C:|3|\nD:|3|Data')),
    now: () => 0,
    ...over
  })

  it('answers sizes and names for drive roots only', async () => {
    const d = deps()
    const usage = createDriveUsage(d)
    const got = await usage(['C:\\', 'd:\\', 'C:\\Users', '\\\\server\\share', 7, 'C:\\'])
    expect(got).toEqual([
      { path: 'C:\\', label: '', kind: 'local', total: TB, free: TB / 4 },
      { path: 'D:\\', label: 'Data', kind: 'local', total: TB, free: TB / 4 }
    ])
    expect(d.space).toHaveBeenCalledTimes(2)
  })

  it('refuses what is not a list', async () => {
    expect(await createDriveUsage(deps())('C:\\')).toEqual([])
  })

  it('reads the labels once for the same drives', async () => {
    const d = deps()
    const usage = createDriveUsage(d)
    await usage(['C:\\'])
    await usage(['C:\\'])
    expect(d.labels).toHaveBeenCalledTimes(1)
    await usage(['C:\\', 'D:\\'])
    expect(d.labels).toHaveBeenCalledTimes(2)
  })

  it('a drive that does not answer has no sizes, and is not asked again while out', async () => {
    vi.useFakeTimers()
    let released = false
    let release: (v: { total: number; free: number }) => void = () => {}
    const d = deps({
      space: vi.fn((root: string) =>
        root === 'Z:\\' && !released
          ? new Promise<{ total: number; free: number }>((r) => (release = r))
          : Promise.resolve({ total: TB, free: root === 'Z:\\' ? 0 : TB / 2 })
      )
    })
    const usage = createDriveUsage(d)
    const first = usage(['C:\\', 'Z:\\'])
    await vi.advanceTimersByTimeAsync(STATFS_WAIT + 10)
    const got = await first
    expect(got[0]).toMatchObject({ total: TB, free: TB / 2 })
    expect(got[1]).not.toHaveProperty('total')
    const second = usage(['C:\\', 'Z:\\'])
    await vi.advanceTimersByTimeAsync(10)
    expect((await second)[1]).not.toHaveProperty('total')
    expect(d.space).toHaveBeenCalledTimes(3)
    released = true
    release({ total: TB, free: 0 })
    await vi.advanceTimersByTimeAsync(10)
    const third = usage(['Z:\\'])
    await vi.advanceTimersByTimeAsync(10)
    expect((await third)[0]).toMatchObject({ total: TB, free: 0 })
  })

  it('a failing size or label read is no size and no name, never a throw', async () => {
    const usage = createDriveUsage(
      deps({ space: async () => Promise.reject(new Error('EIO')), labels: async () => Promise.reject(new Error('x')) })
    )
    expect(await usage(['C:\\'])).toEqual([{ path: 'C:\\' }])
  })

  it('free is clamped to the total', async () => {
    const usage = createDriveUsage(deps({ space: async () => ({ total: 100, free: 400 }) }))
    expect((await usage(['C:\\']))[0]).toMatchObject({ total: 100, free: 100 })
  })
})
