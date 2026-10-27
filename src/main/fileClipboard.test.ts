import { describe, expect, it, vi } from 'vitest'

const execFile = vi.fn()
vi.mock('./spawnWorker', () => ({ execFile }))

const { hasWindowsFiles } = await import('./fileClipboard')

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
