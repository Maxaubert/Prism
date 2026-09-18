import { beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'child_process'
import { findEverything } from './everything'
import {
  clearEverythingBrowseCache,
  getIndexedFolderSizes,
  searchEverythingBrowse
} from './everythingBrowse'
import { managedIndexerRuntime } from './indexerRuntime'

vi.mock('child_process', () => ({ execFile: vi.fn() }))
vi.mock('./everything', () => ({ findEverything: vi.fn(async () => 'es.exe') }))
vi.mock('./indexerRuntime', () => ({ managedIndexerRuntime: vi.fn(() => undefined) }))

beforeEach(() => {
  vi.clearAllMocks()
  clearEverythingBrowseCache()
  vi.mocked(findEverything).mockResolvedValue('es.exe')
  vi.mocked(managedIndexerRuntime).mockReturnValue(undefined)
})

function answer(output: string, error: Error | null = null): void {
  vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, output: string) => void
    callback(error, output)
    return {} as ReturnType<typeof execFile>
  })
}

describe('Everything Explorer adapter', () => {
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
