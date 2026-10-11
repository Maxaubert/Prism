import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AudioTrackOffer } from '@shared/types'
import type { MenuItem } from '../../components/ContextMenu'
import { videoMenu, type VideoMenuContext } from './video'

// The unit tests run under node, where `window` does not exist; in a browser
// it IS globalThis, which is what the phone shim leans on too.
if (typeof window === 'undefined')
  Object.defineProperty(globalThis, 'window', { value: globalThis })

/** The desktop (every capability) or the phone page (#106: none of them). */
const host = (desktop: boolean): void => {
  ;(globalThis as unknown as { prism: unknown }).prism = {
    capabilities: { write: desktop, clipboard: desktop, explorer: desktop, drag: desktop },
    showInExplorer: vi.fn(),
    copyImageToClipboard: vi.fn()
  }
}
afterEach(() => {
  delete (globalThis as unknown as { prism?: unknown }).prism
})

const ctx = (over: Partial<VideoMenuContext> = {}): VideoMenuContext => ({
  path: 'C:\\films\\a.mkv',
  onStep: vi.fn(),
  canStep: () => true,
  fit: 'fit',
  pickFit: vi.fn(),
  rate: 1,
  setRate: vi.fn(),
  audioTracks: [],
  track: null,
  setTrack: vi.fn(),
  trackLabel: (_t, i) => `Track ${i + 1}`,
  subtitles: { tracks: [], active: null, pick: vi.fn(), add: vi.fn() },
  hasFrame: true,
  el: null,
  ...over
})
const labels = (items: MenuItem[]): string[] => items.map((i) => i.label)
const row = (items: MenuItem[], label: string): MenuItem => {
  const found = items.find((i) => i.label === label)
  if (!found) throw new Error(`no row "${label}"`)
  return found
}

describe('the film menu', () => {
  it('a film with one audio track, on the desktop', () => {
    host(true)
    const items = videoMenu(ctx())
    expect(labels(items)).toEqual([
      'Next video',
      'Previous video',
      'Picture',
      'Speed',
      'Subtitles',
      'Copy frame',
      'Show in File Explorer',
      'Copy path'
    ])
    expect(labels(row(items, 'Picture').children ?? [])).toEqual([
      'Fit to window',
      'Fill window',
      'Stretch',
      '16:9',
      '4:3'
    ])
    expect(labels(row(items, 'Speed').children ?? [])).toEqual([
      '0.5×',
      '0.75×',
      'Normal',
      '1.25×',
      '1.5×',
      '2×'
    ])
    expect(labels(row(items, 'Subtitles').children ?? [])).toEqual(['Off', 'Add subtitle file…'])
  })

  it('a film with a choice of audio tracks and found subtitles', () => {
    host(true)
    const items = videoMenu(
      ctx({
        audioTracks: [{ index: 1 } as AudioTrackOffer, { index: 2 } as AudioTrackOffer],
        subtitles: {
          tracks: [{ path: 'a.en.srt', label: 'English' }],
          active: 'a.en.srt',
          pick: vi.fn(),
          add: vi.fn()
        }
      })
    )
    expect(labels(items)).toEqual([
      'Next video',
      'Previous video',
      'Picture',
      'Speed',
      'Audio track',
      'Subtitles',
      'Copy frame',
      'Show in File Explorer',
      'Copy path'
    ])
    expect(labels(row(items, 'Audio track').children ?? [])).toEqual([
      'Default',
      'Track 1',
      'Track 2'
    ])
    expect(labels(row(items, 'Subtitles').children ?? [])).toEqual([
      'Off',
      'English',
      'Add subtitle file…'
    ])
  })

  it('greys Copy frame with no picture, and the step rows at the ends', () => {
    host(true)
    const items = videoMenu(ctx({ hasFrame: false, canStep: () => false }))
    expect(row(items, 'Copy frame').disabled).toBe(true)
    expect(row(items, 'Next video').disabled).toBe(true)
    expect(row(items, 'Previous video').disabled).toBe(true)
  })

  it('the phone page: no Copy frame, no Explorer, Copy path stays', () => {
    host(false)
    expect(labels(videoMenu(ctx()))).toEqual([
      'Next video',
      'Previous video',
      'Picture',
      'Speed',
      'Subtitles',
      'Copy path'
    ])
  })
})
