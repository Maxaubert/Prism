import { afterEach, describe, expect, it, vi } from 'vitest'
import { startCapture } from './micCapture'

/**
 * THE CHOSEN MIC IS GONE, SO THE SYSTEM DEFAULT (owner, 2026-10-17: "it says
 * now it cant find the mic, but mics connected and should be the system
 * default"). A saved device id that no longer matches records from the
 * default instead of failing.
 */
describe('startCapture', () => {
  afterEach(() => vi.unstubAllGlobals())
  const stub = (getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>): void => {
    vi.stubGlobal('MediaStreamTrackProcessor', class {})
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  }
  // A stream with no audio track ends the open right after getUserMedia.
  const empty = { getAudioTracks: () => [], getTracks: () => [] } as unknown as MediaStream
  const gone = Object.assign(new Error('gone'), { name: 'OverconstrainedError' })

  it('falls back to the default mic when the saved one is gone', async () => {
    const calls: MediaStreamConstraints[] = []
    stub(async (c) => {
      calls.push(c)
      if (calls.length === 1) throw gone
      return empty
    })
    await expect(startCapture({ deviceId: 'stale' })).rejects.toBe('no-device')
    expect(calls).toHaveLength(2)
    expect((calls[0].audio as MediaTrackConstraints).deviceId).toEqual({ exact: 'stale' })
    expect((calls[1].audio as MediaTrackConstraints).deviceId).toBeUndefined()
  })

  it('does not retry a refusal, nor when no mic was chosen', async () => {
    const denied = vi.fn(async () => {
      throw Object.assign(new Error('no'), { name: 'NotAllowedError' })
    })
    stub(denied)
    await expect(startCapture({ deviceId: 'dji' })).rejects.toBe('denied')
    expect(denied).toHaveBeenCalledTimes(1)
    const none = vi.fn(async () => {
      throw gone
    })
    stub(none)
    await expect(startCapture({})).rejects.toBe('no-device')
    expect(none).toHaveBeenCalledTimes(1)
  })
})
