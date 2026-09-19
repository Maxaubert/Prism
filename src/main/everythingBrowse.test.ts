import { beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'child_process'
import { findEverything } from './everything'
import {
  clearEverythingBrowseCache,
  getIndexedFolderSizes,
  searchEverythingBrowse,
  searchEverythingBrowseWindow
} from './everythingBrowse'
import { managedIndexerRuntime } from './indexerRuntime'
import { findRunningEverything } from './existingEverything'

vi.mock('child_process', () => ({ execFile: vi.fn() }))
vi.mock('./everything', () => ({ findEverything: vi.fn(async () => 'es.exe') }))
vi.mock('./indexerRuntime', () => ({ managedIndexerRuntime: vi.fn(() => undefined) }))
vi.mock('./existingEverything', () => ({ findRunningEverything: vi.fn(async () => null) }))

beforeEach(() => {
  vi.clearAllMocks()
  clearEverythingBrowseCache()
  vi.mocked(findEverything).mockResolvedValue('es.exe')
  vi.mocked(managedIndexerRuntime).mockReturnValue(undefined)
  vi.mocked(findRunningEverything).mockResolvedValue(null)
})

function answer(output: string, error: Error | null = null): void {
  vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, output: string) => void
    callback(error, output)
    return {} as ReturnType<typeof execFile>
  })
}

describe('Everything Explorer adapter', () => {
  it('requests an uncapped total and native viewport with global sort, preserving malformed slots', async () => {
    answer('77296\r\n')
    answer(JSON.stringify([{ filename: 'C:\\Root\\a.dll', attributes: 32 }, {}, null]))
    const signal = new AbortController().signal
    expect(
      await searchEverythingBrowseWindow(
        'C:\\Root',
        'play',
        { offset: 9000, limit: 128, sort: { key: 'size', direction: 'desc' } },
        signal
      )
    ).toEqual({
      offset: 9000,
      total: 77296,
      rows: [{ filename: 'C:\\Root\\a.dll', attributes: 32 }, null, null]
    })
    const count = vi.mocked(execFile).mock.calls[0]
    const viewport = vi.mocked(execFile).mock.calls[1]
    expect(count[1]).toContain('-get-result-count')
    expect(count[1]).not.toContain('-n')
    expect(viewport[1]).toEqual(
      expect.arrayContaining([
        '-viewport-offset',
        '9000',
        '-viewport-count',
        '128',
        '-sort',
        'size-descending'
      ])
    )
    expect(viewport[1]).not.toContain('-n')
    for (const command of [count[1], viewport[1]]) {
      const args = command as string[]
      expect(args.slice(args.indexOf('-count'), args.indexOf('-count') + 2)).toEqual([
        '-count',
        '18446744073709551615'
      ])
    }
    expect(viewport[2]).toMatchObject({ signal, windowsHide: true })
  })

  it('resets inherited count settings without removing an explicit count filter from the query', async () => {
    answer('50')
    answer(JSON.stringify([{ filename: 'C:\\Root\\play.dll', attributes: 32 }]))
    await searchEverythingBrowseWindow(
      'C:\\Root',
      'play count:50',
      { offset: 0, limit: 128, sort: { key: 'name', direction: 'asc' } },
      new AbortController().signal
    )
    expect(vi.mocked(execFile).mock.calls).toHaveLength(2)
    for (const call of vi.mocked(execFile).mock.calls) {
      const args = call[1] as string[]
      expect(args.slice(args.indexOf('-count'), args.indexOf('-count') + 2)).toEqual([
        '-count',
        '18446744073709551615'
      ])
      expect(args.slice(-2)).toEqual(['-search*', '<play count:50>'])
    }
  })

  it('keeps empty tail windows and rejects invalid count responses', async () => {
    answer('500')
    answer('[]')
    expect(
      await searchEverythingBrowseWindow(
        'C:\\Root',
        'play',
        { offset: 600, limit: 128, sort: { key: 'path', direction: 'asc' } },
        new AbortController().signal
      )
    ).toEqual({ offset: 600, total: 500, rows: [] })
    answer('NaN')
    answer('[]')
    expect(
      await searchEverythingBrowseWindow(
        'C:\\Root',
        'play',
        { offset: 0, limit: 128, sort: { key: 'name', direction: 'asc' } },
        new AbortController().signal
      )
    ).toBeNull()
  })

  function useExisting(): void {
    vi.mocked(managedIndexerRuntime).mockReturnValue({
      useExistingIndex: true,
      endpoint: { instance: 'Prism-private', exe: 'es.exe' }
    } as ReturnType<typeof managedIndexerRuntime>)
    vi.mocked(findRunningEverything).mockResolvedValue({ exe: 'es.exe', instance: '1.5a' })
  }

  it('uses the running index without waiting for or starting the private engine', async () => {
    useExisting()
    const rows = [{ filename: 'C:\\Root\\playnite.exe', attributes: 32, size: 42 }]
    answer(JSON.stringify(rows))
    expect(
      await searchEverythingBrowse('C:\\Root', 'playnite', 100, new AbortController().signal)
    ).toEqual(rows)
    expect(findEverything).not.toHaveBeenCalled()
    expect(vi.mocked(execFile).mock.calls[0][1]).toContain('1.5a')
    answer(JSON.stringify([{ filename: 'C:\\Root\\Games', attributes: 16, size: 42 }]))
    expect(await getIndexedFolderSizes(['C:\\Root\\Games'])).toEqual(
      new Map([['C:\\Root\\Games', { bytes: 42 }]])
    )
    expect(findEverything).not.toHaveBeenCalled()
  })

  it('falls back to the bundled index when the running index does not cover the drive', async () => {
    useExisting()
    answer('[]')
    answer('[]')
    const rows = [{ filename: 'X:\\Root\\playnite.exe', attributes: 32 }]
    answer(JSON.stringify(rows))
    expect(
      await searchEverythingBrowse('X:\\Root', 'playnite', 100, new AbortController().signal)
    ).toEqual(rows)
    expect(findEverything).toHaveBeenCalledOnce()
    expect(vi.mocked(execFile).mock.calls[2][1]).toContain('Prism-private')
  })

  it('does not treat another index coverage as proof that an empty result is complete', async () => {
    useExisting()
    answer(JSON.stringify([{ filename: 'C:\\Root\\known.txt', attributes: 32 }]))
    await searchEverythingBrowse('C:\\Root', '*', 100, new AbortController().signal)
    vi.mocked(findRunningEverything).mockResolvedValue(null)
    answer('[]')
    answer('[]')
    expect(
      await searchEverythingBrowse('C:\\Root', '*', 100, new AbortController().signal)
    ).toBeNull()
  })

  it('passes native syntax as one query argument, including quotes and command-looking text', async () => {
    answer('[{"filename":"C:\\\\Root\\\\hidden.dll","attributes":34,"size":42}]')
    const signal = new AbortController().signal
    const rows = await searchEverythingBrowse(
      'C:\\Root',
      'folder: "a b" | file: ext:dll -installer',
      100,
      signal
    )
    expect(rows).toHaveLength(1)
    expect(execFile).toHaveBeenCalledWith(
      'es.exe',
      expect.arrayContaining([
        '-path',
        'C:\\Root',
        '-search*',
        '<folder: "a b" | file: ext:dll !installer>'
      ]),
      expect.objectContaining({
        signal,
        windowsHide: true,
        windowsVerbatimArguments: true,
        timeout: 2000
      }),
      expect.any(Function)
    )
    answer('[]')
    await searchEverythingBrowse('C:\\Root', '"-export-json" "$(literal)"', 100, signal)
    expect(vi.mocked(execFile).mock.calls[1][1]).toContain('<"-export-json" "$(literal)">')
  })

  it('keeps a successful empty result distinct from unavailable Everything', async () => {
    answer('')
    answer(JSON.stringify([{ filename: 'C:\\Root\\known.txt', attributes: 32 }]))
    expect(
      await searchEverythingBrowse('C:\\Root', 'missing', 1, new AbortController().signal)
    ).toEqual([])
    vi.mocked(findEverything).mockResolvedValue(null)
    expect(
      await searchEverythingBrowse('C:\\Root', 'missing', 1, new AbortController().signal)
    ).toBeNull()
    expect(execFile).toHaveBeenCalledTimes(2)
  })

  it('quotes a spaced scope independently of the literal query tail', async () => {
    answer(
      JSON.stringify([{ filename: 'C:\\Root & $literal\\Saved Games\\notes.txt', attributes: 32 }])
    )
    await searchEverythingBrowse(
      'C:\\Root & $literal\\Saved Games',
      '"-n 1" | "saved games"',
      10,
      new AbortController().signal
    )
    expect(vi.mocked(execFile).mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        '-path',
        '"C:\\Root & $literal\\Saved Games"',
        '-search*',
        '<"-n 1" | "saved games">'
      ])
    )
  })

  it('falls back for unindexed drives and caches covered roots for empty queries', async () => {
    answer('[]')
    answer('[]')
    expect(
      await searchEverythingBrowse('X:\\Unindexed', 'missing', 1, new AbortController().signal)
    ).toBeNull()
    answer('[]')
    answer(JSON.stringify([{ filename: 'C:\\Root\\known.txt', attributes: 32 }]))
    expect(
      await searchEverythingBrowse('C:\\Root', 'missing', 1, new AbortController().signal)
    ).toEqual([])
    answer('[]')
    expect(
      await searchEverythingBrowse('C:\\Root', 'missing again', 1, new AbortController().signal)
    ).toEqual([])
    expect(execFile).toHaveBeenCalledTimes(5)
  })

  it('retries the named instance only on IPC-not-found and rejects malformed JSON', async () => {
    answer('', Object.assign(new Error('IPC'), { code: 8 }))
    answer('[]')
    answer(JSON.stringify([{ filename: 'C:\\Root\\known.txt', attributes: 32 }]))
    expect(await searchEverythingBrowse('C:\\Root', '*', 1, new AbortController().signal)).toEqual(
      []
    )
    expect(vi.mocked(execFile).mock.calls[1][1]).toEqual(
      expect.arrayContaining(['-instance', '1.5a'])
    )
    answer('{}')
    expect(
      await searchEverythingBrowse('C:\\Root', '*', 1, new AbortController().signal)
    ).toBeNull()
    expect(execFile).toHaveBeenCalledTimes(4)
  })

  it('does not spawn for a cancelled request or retry an aborted process', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await searchEverythingBrowse('C:\\Root', '*', 1, controller.signal)).toBeNull()
    expect(execFile).not.toHaveBeenCalled()
  })

  it('never switches to a personal Everything instance when the private engine is down', async () => {
    vi.mocked(managedIndexerRuntime).mockReturnValue({
      endpoint: { instance: 'Prism-private', exe: 'es.exe' }
    } as ReturnType<typeof managedIndexerRuntime>)
    answer('', Object.assign(new Error('IPC'), { code: 8 }))
    expect(
      await searchEverythingBrowse('C:\\Root', '*', 10, new AbortController().signal)
    ).toBeNull()
    expect(execFile).toHaveBeenCalledTimes(1)
    expect(vi.mocked(execFile).mock.calls[0][1]).toEqual(
      expect.arrayContaining(['-instance', 'Prism-private'])
    )
  })

  it('returns only valid requested non-reparse folder totals and escapes names literally', async () => {
    answer(
      JSON.stringify([
        { filename: 'C:\\Root\\[photos]', attributes: 16, size: 42 },
        { filename: 'C:\\Root\\junction', attributes: 1040, size: 999 },
        { filename: 'C:\\Root\\unavailable', attributes: 16, size: null },
        { filename: 'C:\\Other', attributes: 16, size: 999 }
      ])
    )
    expect(
      await getIndexedFolderSizes([
        'C:\\Root\\[photos]',
        'C:\\Root\\junction',
        'C:\\Root\\unavailable'
      ])
    ).toEqual(new Map([['C:\\Root\\[photos]', { bytes: 42 }]]))
    expect(vi.mocked(execFile).mock.calls[0][1]?.at(-1)).toContain('\\[photos\\]')
  })
})
