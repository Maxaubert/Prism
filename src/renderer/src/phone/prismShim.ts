/**
 * `window.prism` for the phone page (2026-09-06, #104): the READ-ONLY subset
 * of the bridge, answered over HTTP. Everything else is a Proxy fallback
 * that warns once and resolves to false, so a verb a reused viewer reaches
 * for cannot crash the page; `capabilities` is how the viewers learn not to
 * offer it in the first place (PR 3 wires the menus to it).
 *
 * Installed by `boot.ts` before any viewer module loads: `lib/theme` paints
 * on import and asks the bridge for the window material as it does.
 */
import type { PrismApi } from '../../../preload/index'
import type { DirListing, MediaProbe, TextRead } from '@shared/types'
import { apiUrl, getJson, mediaUrl } from './api'

export const capabilities = {
  write: false,
  clipboard: false,
  explorer: false,
  drag: false
} as const

/** `nativeDrag` is the drag-out bridge's flag (#103, not merged here yet);
 *  the phone says no to it either way, so a viewer can read it safely. */
type Shim = Partial<PrismApi> & { capabilities: typeof capabilities; nativeDrag: false }

const implemented: Shim = {
  capabilities,
  mediaUrl,
  nativeDrag: false,
  demo: false,
  forceSetup: false,
  listDir: (_root: string, path: string): Promise<DirListing | null> =>
    getJson<DirListing>('/api/dir', { path }).catch(() => null),
  readText: (): Promise<TextRead> => Promise.resolve({ error: 'unreadable' }), // PR 3
  probeMedia: (): Promise<MediaProbe> => Promise.resolve({ ffmpeg: false, needed: false }),
  audioBlind: () => Promise.resolve(null),
  subsFor: (path: string) =>
    getJson<Array<{ path: string; label: string }>>('/api/subs', { path }).catch(() => []),
  readSubs: async (path: string): Promise<string | null> => {
    const r = await fetch(apiUrl('/api/subs/read', { path }))
    return r.ok ? r.text() : null
  },
  pickSubtitle: () => Promise.resolve(null),
  // The PC's decoders: `probeMedia` above says nothing needs converting, so
  // these are never asked for real work. They are named here anyway because
  // `usePlayableVideo` returns `onConvertProgress`'s answer as an effect's
  // cleanup, and the Proxy fallback's Promise there is a React error on
  // every video. The waveform and MIDI say "nothing" (PR 2 streams them).
  onConvertProgress: () => () => {},
  cancelConvert: () => {},
  mediaPeaks: () => Promise.resolve(null),
  synthMidi: () => Promise.resolve(null),
  // The picture's copy and save verbs are the PC's clipboard and dialogs;
  // they answer "did not happen" here without a warning, since PR 3 hides
  // them behind `capabilities` and until then a tap must not crash.
  copyImageToClipboard: () => false,
  saveImageCopy: () => Promise.resolve(null),
  // A phone has no window material: the theme paints and nothing else moves.
  setWindowMaterial: () => {},
  setAwake: () => {},
  setFullscreen: () => {},
  onDirChanged: () => () => {},
  onFileAppended: () => () => {},
  onWindowState: () => () => {},
  onFullscreen: () => () => {}
}

const warned = new Set<string>()

export function installShim(): void {
  const proxy = new Proxy(implemented, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof Shim]
      // A symbol, `then` or the like is somebody INSPECTING the object (a
      // console, React, an await), not a viewer calling a verb: answering
      // those with a function would make the bridge a thenable.
      if (typeof prop !== 'string' || prop === 'then' || prop === 'toJSON') return undefined
      return (): Promise<false> => {
        if (!warned.has(prop)) {
          warned.add(prop)
          console.warn(`prism.${prop} is not available on the phone`)
        }
        return Promise.resolve(false)
      }
    }
  })
  // In a browser `globalThis` IS `window`; naming it this way is what lets
  // the unit tests run under node, which has no window at all.
  ;(globalThis as unknown as { prism: unknown }).prism = proxy
}
