import { describe, expect, it, vi } from 'vitest'
import { needBox, stopTake } from './captureGuard.mjs'

describe('needBox (audit #96)', () => {
  it('returns the box', async () => {
    const box = { x: 1, y: 2, width: 3, height: 4 }
    expect(await needBox({ boundingBox: async () => box }, 'the grip')).toBe(box)
  })

  it('names what is missing instead of dereferencing null', async () => {
    await expect(needBox({ boundingBox: async () => null }, 'the Resize file tree handle')).rejects.toThrow(
      /Resize file tree handle/
    )
  })
})

describe('stopTake (audit #96)', () => {
  it('stops ffmpeg and closes the app, and survives a take that never got that far', async () => {
    const write = vi.fn()
    const kill = vi.fn()
    const close = vi.fn(async () => {})
    await stopTake({ ff: { stdin: { write }, kill }, app: { close } })
    expect(write).toHaveBeenCalledWith('q')
    expect(kill).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
    await expect(stopTake({})).resolves.toBeUndefined()
  })
})