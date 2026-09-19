import { beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { findRunningEverything } from './existingEverything'

vi.mock('child_process', () => ({ execFile: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks()
})

function answer(output: string, error: Error | null = null): void {
  vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, output: string) => void
    callback(error, output)
    return {} as ReturnType<typeof execFile>
  })
}

describe('read-only existing Everything discovery', () => {
  it('prefers the running alpha instance and only sends bounded version queries', async () => {
    const exe = `${randomUUID()}-es.exe`
    answer('1.5.0.1409a\r\n')
    answer('1.4.1.1032\r\n')
    expect(await findRunningEverything(exe)).toEqual({ exe, instance: '1.5a' })
    expect(vi.mocked(execFile).mock.calls.map((call) => call[1])).toEqual([
      ['-instance', '1.5a', '-get-everything-version'],
      ['-get-everything-version']
    ])
    for (const call of vi.mocked(execFile).mock.calls) {
      expect(call[0]).toBe(exe)
      expect(call[2]).toEqual({ windowsHide: true, timeout: 500 })
    }
  })

  it('uses a running default instance and ignores absent or incompatible responses', async () => {
    const exe = `${randomUUID()}-es.exe`
    answer('', Object.assign(new Error('No alpha IPC'), { code: 8 }))
    answer('1.4.1.1032')
    expect(await findRunningEverything(exe)).toEqual({ exe, instance: '' })
    const absent = `${randomUUID()}-es.exe`
    answer('0.0.0.0')
    answer('unexpected version')
    expect(await findRunningEverything(absent)).toBeNull()
  })

  it('shares short-lived discovery across concurrent requests without repeating probes', async () => {
    const exe = `${randomUUID()}-es.exe`
    answer('1.5.0.1409a')
    answer('0.0.0.0')
    const results = await Promise.all(Array.from({ length: 12 }, () => findRunningEverything(exe)))
    expect(results.every((result) => result?.instance === '1.5a')).toBe(true)
    expect(execFile).toHaveBeenCalledTimes(2)
    expect(await findRunningEverything(exe)).toEqual({ exe, instance: '1.5a' })
    expect(execFile).toHaveBeenCalledTimes(2)
  })

  it('cancels one waiter immediately while preserving shared discovery for another', async () => {
    const exe = `${randomUUID()}-es.exe`
    const callbacks: Array<(error: Error | null, output: string) => void> = []
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      callbacks.push(args.at(-1) as (typeof callbacks)[number])
      return {} as ReturnType<typeof execFile>
    })
    const controller = new AbortController()
    const cancelled = findRunningEverything(exe, controller.signal)
    const other = findRunningEverything(exe)
    controller.abort()
    expect(await cancelled).toBeNull()
    callbacks[0](null, '1.5.0.1409a')
    callbacks[1](null, '1.4.1.1032')
    expect(await other).toEqual({ exe, instance: '1.5a' })
    expect(execFile).toHaveBeenCalledTimes(2)
  })

  it('does no work for a request already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await findRunningEverything(`${randomUUID()}-es.exe`, controller.signal)).toBeNull()
    expect(execFile).not.toHaveBeenCalled()
  })
})
