import { describe, expect, it } from 'vitest'
import { offerSwap } from './useDecodedSource'

describe('offerSwap: no probe answer leaves a score on "synthesising" for ever (audit #56)', () => {
  it('a score the probe cannot synthesise, or a rejected probe, ends as failed', () => {
    const failed = { path: 'a.mid', url: null, synth: false }
    expect(offerSwap('a.mid', { needed: false }, true)).toEqual(failed)
    expect(offerSwap('a.mid', null, true)).toEqual(failed)
  })
  it('a score the probe offers to synthesise waits for the synth', () => {
    expect(offerSwap('a.mid', { needed: false, synth: true }, true)).toEqual({ path: 'a.mid', url: null, synth: true })
  })
  it('a track Chromium cannot play swaps to the decoded url', () => {
    expect(offerSwap('a.wma', { needed: true, url: 'fsaudio://x' }, false)).toEqual({
      path: 'a.wma',
      url: 'fsaudio://x',
      synth: false
    })
  })
  it('an ordinary track, or a rejected probe on one, keeps its own url (no swap, not failed)', () => {
    expect(offerSwap('a.mp3', { needed: false }, false)).toBeNull()
    expect(offerSwap('a.mp3', null, false)).toBeNull()
  })
})