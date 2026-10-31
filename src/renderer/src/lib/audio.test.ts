import { afterEach, describe, expect, it, vi } from 'vitest'
import { anyPlaying, boostFactor, elementVolume, routable } from './audio'

describe('volume past 100%', () => {
  it('leaves everything to the element up to 100%', () => {
    expect(elementVolume(0.8)).toBe(0.8)
    expect(boostFactor(0.8)).toBe(1)
  })

  it('holds the element at its ceiling and boosts above it', () => {
    // The spec caps HTMLMediaElement.volume at 1, so 150% has to be a gain.
    expect(elementVolume(1.5)).toBe(1)
    expect(boostFactor(1.5)).toBe(1.5)
  })

  it('treats exactly 100% as the plain path, with no gain at all', () => {
    expect(elementVolume(1)).toBe(1)
    expect(boostFactor(1)).toBe(1)
  })

  it('never asks for a negative volume or a negative gain', () => {
    expect(elementVolume(-0.5)).toBe(0)
    expect(boostFactor(-0.5)).toBe(1)
  })

  it('silences by element volume as well as gain, so mute is mute', () => {
    expect(elementVolume(0)).toBe(0)
  })
})

describe('what may be routed through Web Audio', () => {
  const el = (crossOrigin: string | null): HTMLMediaElement =>
    ({ crossOrigin }) as unknown as HTMLMediaElement

  it('refuses an element that was fetched without CORS', () => {
    // Routing one of those feeds the graph silence, for good: the sound does
    // not come back when the volume drops under 100% again.
    expect(routable(el(null))).toBe(false)
    expect(routable(el(''))).toBe(false)
  })

  it('allows a CORS-clean element', () => {
    expect(routable(el('anonymous'))).toBe(true)
    expect(routable(el('use-credentials'))).toBe(true)
  })
})

describe('the shared context sleeps when the last player lets go (#17)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (document as unknown as { querySelectorAll?: unknown }).querySelectorAll
  })

  const setup = (playing: boolean[]): { suspend: ReturnType<typeof vi.fn> } => {
    const suspend = vi.fn(() => Promise.resolve())
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running'
        suspend = suspend
      }
    )
    // The setup's document cannot be replaced, only given the one call this reads.
    const doc = document as unknown as { querySelectorAll?: unknown }
    doc.querySelectorAll = () => playing.map((p) => ({ paused: !p }))
    return { suspend }
  }

  it('suspends once nothing in the window is playing', async () => {
    const { idleIfSilent, getAudioContext } = (vi.resetModules(), await import('./audio'))
    const { suspend } = setup([false])
    getAudioContext()
    idleIfSilent()
    expect(suspend).toHaveBeenCalledTimes(1)
  })

  it('leaves it running while another player still plays', async () => {
    const { idleIfSilent, getAudioContext } = (vi.resetModules(), await import('./audio'))
    const { suspend } = setup([false, true])
    getAudioContext()
    idleIfSilent()
    expect(suspend).not.toHaveBeenCalled()
  })

  it('knows which players are playing', () => {
    expect(anyPlaying([])).toBe(false)
    expect(anyPlaying([{ paused: true }])).toBe(false)
    expect(anyPlaying([{ paused: true }, { paused: false }])).toBe(true)
  })
})
