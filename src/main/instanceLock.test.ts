import { describe, expect, it, vi } from 'vitest'

const request = vi.fn(() => true)
vi.mock('electron', () => ({ app: { requestSingleInstanceLock: request } }))

describe('haveInstanceLock', () => {
  it('asks Electron once and gives boot.ts and index.ts the same answer', async () => {
    const { haveInstanceLock } = await import('./instanceLock')
    expect(haveInstanceLock()).toBe(true)
    expect(haveInstanceLock()).toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
  })
})
