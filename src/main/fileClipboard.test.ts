import { describe, expect, it, vi } from 'vitest'

const execFile = vi.fn()
vi.mock('./spawnWorker', () => ({ execFile }))

const { hasWindowsFiles, lastPhase, writeFailure } = await import('./fileClipboard')

describe('a clipboard write says where it got to and why it failed (#484)', () => {
  it('the last phase the PowerShell said', () => {
    expect(lastPhase('phase:loaded\r\nphase:data\r\n')).toBe('data')
    expect(lastPhase('')).toBeUndefined()
  })
  it('a timeout, a stop, or PowerShell’s own first error line', () => {
    expect(writeFailure({ killed: true, signal: 'SIGTERM' }, '')).toBe('timeout')
    expect(writeFailure({ code: 'ABORT_ERR' }, '')).toBe('superseded')
    expect(
      writeFailure(
        { code: 1, message: 'Command failed' },
        'Source no longer exists\r\nAt line:9 char:50\r\n+ ... throw\r\n    + CategoryInfo : OperationStopped\r\n'
      )
    ).toBe('Source no longer exists')
    expect(writeFailure({ code: 1, message: 'Command failed' }, '')).toBe('Command failed')
  })
})

describe('hasWindowsFiles', () => {
  it('answers from the format list and spawns nothing (2026-10-16: a PowerShell per right-click)', () => {
    expect(hasWindowsFiles(() => ['text/plain', 'text/uri-list'])).toBe(true)
    expect(hasWindowsFiles(() => ['text/plain', 'image/png'])).toBe(false)
    expect(hasWindowsFiles(() => [])).toBe(false)
    expect(execFile).not.toHaveBeenCalled()
  })

  it('a clipboard that will not answer has no files', () => {
    expect(
      hasWindowsFiles(() => {
        throw new Error('clipboard busy')
      })
    ).toBe(false)
  })
})
