import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDriveUsage,
  DRIVE_TABLE_FRESH,
  driveKind,
  LABEL_COMMAND,
  LABEL_RETRY,
  LABEL_TTL,
  parseLabels,
  powershellInWorker,
  readDriveTable,
  readLabels,
  STATFS_WAIT,
  withUsedShare
} from './driveUsage'

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

  it('past the hour, answers with the names it has and reads new ones behind it (perf review #44)', async () => {
    let now = 0
    let finish: (names: ReturnType<typeof parseLabels>) => void = () => {}
    const labels = vi
      .fn<() => Promise<ReturnType<typeof parseLabels>>>()
      .mockResolvedValueOnce(parseLabels('C:|3|Old'))
      .mockImplementationOnce(() => new Promise((r) => (finish = r)))
    const usage = createDriveUsage(deps({ labels, now: () => now }))
    expect((await usage(['C:\\']))[0].label).toBe('Old')
    now = LABEL_TTL - 1
    await usage(['C:\\'])
    expect(labels).toHaveBeenCalledTimes(1)
    now = LABEL_TTL + 1
    // The new read is still out: the reply does not wait for it.
    expect((await usage(['C:\\']))[0].label).toBe('Old')
    expect(labels).toHaveBeenCalledTimes(2)
    finish(parseLabels('C:|3|New'))
    await new Promise((r) => setTimeout(r, 0))
    expect((await usage(['C:\\']))[0].label).toBe('New')
  })

  it('a failed name read keeps the names it had and is asked again sooner', async () => {
    let now = 0
    const labels = vi
      .fn<() => Promise<ReturnType<typeof parseLabels>>>()
      .mockResolvedValueOnce(parseLabels('C:|3|Kept'))
      .mockResolvedValueOnce(new Map())
      .mockResolvedValue(parseLabels('C:|3|Back'))
    const usage = createDriveUsage(deps({ labels, now: () => now }))
    await usage(['C:\\'])
    now = LABEL_TTL + 1
    expect((await usage(['C:\\']))[0].label).toBe('Kept')
    await new Promise((r) => setTimeout(r, 0))
    now += LABEL_RETRY - 1000
    expect((await usage(['C:\\']))[0].label).toBe('Kept')
    expect(labels).toHaveBeenCalledTimes(2)
    now += 2000
    await usage(['C:\\'])
    expect(labels).toHaveBeenCalledTimes(3)
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

  it('marks the drive Windows runs from, and only that one', async () => {
    for (const sys of ['C:', 'c:', 'C:\\']) {
      const got = await createDriveUsage(deps({ systemDrive: () => sys }))(['C:\\', 'D:\\'])
      expect(got.map((d) => !!d.system)).toEqual([true, false])
    }
    const none = await createDriveUsage(deps({ systemDrive: () => undefined }))(['C:\\'])
    expect(none[0]).not.toHaveProperty('system')
  })
})

describe('withUsedShare', () => {
  const drives = [
    { path: 'C:\\', system: true, total: 1000, free: 600 },
    { path: 'D:\\', total: 1000, free: 600 },
    { path: 'Z:\\', system: true }
  ]
  it('puts the system drive at that share used, its total untouched', () => {
    const got = withUsedShare(drives, '0.95')
    expect(got[0]).toMatchObject({ path: 'C:\\', system: true, total: 1000 })
    expect(got[0].free).toBeCloseTo(50)
    expect(got[1]).toBe(drives[1])
    expect(got[2]).toBe(drives[2])
  })
  it('does nothing without a share that means anything', () => {
    for (const s of [undefined, '', 'x', '-1', '2']) expect(withUsedShare(drives, s)).toBe(drives)
  })
})

// #351: the query is spawned from a worker thread, so a slow process start
// waits there rather than in main's. This proves the worker route answers.
describe.runIf(process.platform === 'win32')('readLabels', () => {
  it('reads the system drive through the worker', async () => {
    // The app's query, worker and parser on the real machine. The app kills
    // the query at 10 s, and a starved machine passed that (2026-10-30 on
    // the runner, 2026-11-01 here under load): the machine's speed is not
    // under test, so this read waits up to 25 s.
    const labels = parseLabels((await powershellInWorker(LABEL_COMMAND, 25_000)) ?? '')
    const system = `${(process.env.SystemDrive ?? 'C:').toUpperCase()}\\`
    expect(labels.get(system)?.kind).toBe('local')
  }, 30_000)
  it('shares one query between the names and the kinds (perf review #51)', async () => {
    // Its own query, past the last one's freshness: it inherited the test
    // above's answer, and when that read failed this failed with it
    // (2026-10-30: ".toMatch() expects to receive a string, but got object").
    const later = Date.now() + 2 * DRIVE_TABLE_FRESH
    const one = readDriveTable(later)
    expect(readDriveTable(later)).toBe(one)
    // What the table holds is the test above's to check: this one is the
    // sharing. readLabels, asked while that answer is fresh, parses that same
    // answer: the app's own read on the real machine, at no second query.
    // (It answered a Map whatever happened: review, 2026-11-01.)
    const answer = await one
    expect(await readLabels()).toEqual(parseLabels(answer ?? ''))
  }, 30_000)
})
