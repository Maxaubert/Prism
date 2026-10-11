import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItem } from '../../components/ContextMenu'
import { audioMenu, type AudioMenuContext } from './audio'

// The unit tests run under node, where `window` does not exist; in a browser
// it IS globalThis, which is what the phone shim leans on too.
if (typeof window === 'undefined')
  Object.defineProperty(globalThis, 'window', { value: globalThis })

/** The desktop (every capability) or the phone page (#106: none of them). */
const host = (desktop: boolean): void => {
  ;(globalThis as unknown as { prism: unknown }).prism = {
    capabilities: { write: desktop, clipboard: desktop, explorer: desktop, drag: desktop },
    showInExplorer: vi.fn()
  }
}
beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: vi.fn(() => Promise.resolve()) } },
    configurable: true
  })
})
afterEach(() => {
  delete (globalThis as unknown as { prism?: unknown }).prism
})

const ctx = (over: Partial<AudioMenuContext> = {}): AudioMenuContext => ({
  path: 'C:\\music\\a.mp3',
  rate: 1,
  setRate: vi.fn(),
  onStep: vi.fn(),
  canStep: () => true,
  ...over
})
const labels = (items: MenuItem[]): string[] => items.map((i) => i.label)

describe('the audio stage menu', () => {
  it('a track in a folder that steps, on the desktop', () => {
    host(true)
    const items = audioMenu(ctx({ rate: 1.5 }))
    expect(labels(items)).toEqual([
      'Next track',
      'Previous track',
      'Speed',
      'Copy path',
      'Show in File Explorer'
    ])
    expect(items[2].hint).toBe('1.50x')
    expect(labels(items[2].children ?? [])).toEqual([
      '0.25x',
      '0.5x',
      '0.75x',
      'Normal',
      '1.25x',
      '1.5x',
      '1.75x',
      '2x'
    ])
  })

  it('greys Next and Previous at the ends', () => {
    host(true)
    const items = audioMenu(ctx({ canStep: (d) => d === 1 }))
    expect(items[0].disabled).toBe(false)
    expect(items[1].disabled).toBe(true)
  })

  it('no step rows where the host cannot step', () => {
    host(true)
    expect(labels(audioMenu(ctx({ onStep: undefined, canStep: undefined })))).toEqual([
      'Speed',
      'Copy path',
      'Show in File Explorer'
    ])
  })

  it('the phone page keeps only Copy path of the file rows', () => {
    host(false)
    expect(labels(audioMenu(ctx()))).toEqual(['Next track', 'Previous track', 'Speed', 'Copy path'])
  })
})
