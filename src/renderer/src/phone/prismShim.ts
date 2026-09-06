/**
 * `window.prism` for the phone page (2026-09-06, #104): the READ-ONLY subset
 * of the bridge, answered over HTTP. Everything else is a Proxy fallback
 * that warns once and resolves to false, so a verb a reused viewer reaches
 * for cannot crash the page; `capabilities` is how the viewers learn not to
 * offer it in the first place (#106: `fileVerbs`, the picture, the video,
 * the archive panel and the editor all consult it).
 *
 * NOTHING WRITES from here. `writeText`, `renameFile`, `trashFile` and the
 * archive's member verbs are not members of this object, so they fall to the
 * warning Proxy below and answer false; the server has no route for them.
 *
 * Installed by `boot.ts` before any viewer module loads: `lib/theme` paints
 * on import and asks the bridge for the window material as it does.
 */
import type { PrismApi } from '../../../preload/index'
import type { ArchiveListing, DirListing, FileKind, MediaProbe, TextRead } from '@shared/types'
import { apiUrl, getJson, mediaUrl } from './api'
import { canCsv } from './canPlay'

export const capabilities = {
  write: false,
  clipboard: false,
  explorer: false,
  drag: false
} as const

/** `nativeDrag` is the drag-out bridge's flag (#103, not merged here yet);
 *  the phone says no to it either way, so a viewer can read it safely.
 *  `capabilities` IS on PrismApi (#106); it is named here so the shim
 *  cannot be built without one. */
type Shim = Partial<PrismApi> & { capabilities: typeof capabilities; nativeDrag: false }

/**
 * What `/api/play` answers (#105): direct is the `/m/` url the viewers
 * already build for themselves, hls is a playlist url Prism serves from a
 * live transcode, none is a reason. `audioOnly` is what tells the shim
 * which reused hook the playlist belongs to (see `probeMedia` below).
 */
export type PlayAnswer =
  | { mode: 'direct'; url: string; fps: number | null; duration: number }
  | { mode: 'hls'; url: string; copyVideo: boolean; audioOnly: boolean; fps: number | null; duration: number }
  | { mode: 'none'; reason: string }

/**
 * A playlist url names a JOB on the PC, and the PC reaps a job nobody has
 * asked about for 30s: an answer older than that may point at nothing, so
 * it is asked again rather than trusted. Inside the window every hook that
 * wants to know (the shell, the video's probe, its convert, the sidecar's
 * probe) shares the one fetch.
 */
const PLAY_TTL_MS = 10_000
const plays = new Map<string, { at: number; answer: Promise<PlayAnswer> }>()

/** Direct or HLS for this file, on THIS device. Exported for the phone shell,
 *  which reads the answer to decide whether hls.js has to be loaded. */
export function askPlay(path: string): Promise<PlayAnswer> {
  const now = Date.now()
  const held = plays.get(path)
  if (held && now - held.at < PLAY_TTL_MS) return held.answer
  const answer = getJson<PlayAnswer>('/api/play', { path, can: canCsv() })
  plays.set(path, { at: now, answer })
  // A refused or failed ask is not an answer to keep: the next one tries again.
  answer.catch(() => {
    if (plays.get(path)?.answer === answer) plays.delete(path)
  })
  return answer
}

/** `pw` rides only when there is one: the server reads an absent one as
 *  "no password", and an empty one would be a password of nothing. */
const withPw = (params: Record<string, string>, password?: string): Record<string, string> =>
  password ? { ...params, pw: password } : params

const implemented: Shim = {
  capabilities,
  mediaUrl,
  nativeDrag: false,
  demo: false,
  forceSetup: false,
  listDir: (_root: string, path: string): Promise<DirListing | null> =>
    getJson<DirListing>('/api/dir', { path }).catch(() => null),
  /**
   * The read-only document routes (#106). Each answers in the shape its IPC
   * does, so the viewers are not told the difference, and a refused or
   * failed fetch is the same failure the IPC would report: a text the phone
   * cannot read is `unreadable`, a document that would not convert is null,
   * an archive that would not list is `failed`.
   */
  readText: (path: string): Promise<TextRead> =>
    getJson<TextRead>('/api/text', { path }).catch((): TextRead => ({ error: 'unreadable' })),
  docHtml: (path: string): Promise<string | null> =>
    getJson<{ html: string }>('/api/doc', { path })
      .then((r) => r.html)
      .catch(() => null),
  comicOpen: (
    path: string,
    password = ''
  ): Promise<{ pages: string[] } | { error: 'password' | 'failed' | 'empty' }> =>
    getJson<{ pages: string[] } | { error: 'password' | 'failed' | 'empty' }>('/api/comic', {
      path,
      pw: password
    }).catch(() => ({ error: 'failed' as const })),
  archiveList: (path: string, password?: string): Promise<ArchiveListing> =>
    getJson<ArchiveListing>('/api/archive', withPw({ path }, password)).catch(
      (): ArchiveListing => ({ ok: false, reason: 'failed' })
    ),
  archiveExtract: (
    path: string,
    entry: string,
    password?: string
  ): Promise<
    { ok: true; path: string; kind: FileKind } | { ok: false; reason: 'password' | 'aes' | 'failed' }
  > =>
    getJson<{ ok: true; path: string; kind: FileKind } | { ok: false; reason: 'password' | 'aes' | 'failed' }>(
      '/api/archive/extract',
      withPw({ path, entry }, password)
    ).catch(() => ({ ok: false as const, reason: 'failed' as const })),
  // The panel asks this for one thing, whether the container can be written,
  // and on the phone no container can: every archive reads as the 7z kind.
  // The counts are the Properties popup's, which the phone does not have.
  archiveStat: () =>
    Promise.resolve({ files: 0, folders: 0, uncompressed: 0, encryption: 'none' as const, readOnly: true }),
  statFile: (path: string): Promise<{ size: number; mtimeMs: number; isFolder: boolean } | null> =>
    getJson<{ size: number; mtimeMs: number; isFolder: boolean }>('/api/stat', { path }).catch(() => null),
  // A file too big to hand over whole has no tail on the phone, and nothing
  // is followed: the editor shows its "too large" note and leaves it there.
  tailBytes: () => Promise.resolve(null),
  startTail: () => Promise.resolve(false),
  stopTail: () => Promise.resolve(),
  /**
   * The reused players ask this, and the answer is shaped for the hooks
   * they already have (#105): a FILM the phone cannot play as it is looks
   * like a file that needs converting (`usePlayableVideo`), and the
   * "copy" `convertVideo` then hands back is the playlist url; `quick` is
   * whether the picture is copied rather than encoded, which is what the
   * overlay's wording turns on. An AUDIO-ONLY stream takes the other hook:
   * `useDecodedSource` swaps in a `needed` stream's url as the element's
   * source, which for the PC is the decoder's fsaudio:// and here is the
   * playlist. Told apart by the server's `audioOnly`, never guessed from
   * the file. A refused ask reads as nothing to decode, so the element
   * tries the file itself and reports what happens.
   */
  probeMedia: async (path: string): Promise<MediaProbe> => {
    const a = await askPlay(path).catch((): PlayAnswer => ({ mode: 'none', reason: '' }))
    if (a.mode === 'none') return { ffmpeg: false, needed: false }
    if (a.mode === 'direct') return { ffmpeg: true, needed: false, fps: a.fps ?? undefined }
    if (a.audioOnly) return { ffmpeg: true, needed: true, url: a.url }
    return { ffmpeg: true, needed: false, fps: a.fps ?? undefined, convert: { reason: 'container', quick: a.copyVideo } }
  },
  convertVideo: async (path: string): Promise<{ url?: string; error?: string }> => {
    const a = await askPlay(path).catch((e: Error): PlayAnswer => ({ mode: 'none', reason: e.message }))
    if (a.mode === 'hls') return { url: a.url }
    return { error: a.mode === 'none' && a.reason ? a.reason : 'Prism could not prepare this file' }
  },
  audioBlind: () => Promise.resolve(null),
  subsFor: (path: string) =>
    getJson<Array<{ path: string; label: string }>>('/api/subs', { path }).catch(() => []),
  readSubs: async (path: string): Promise<string | null> => {
    const r = await fetch(apiUrl('/api/subs/read', { path }))
    return r.ok ? r.text() : null
  },
  pickSubtitle: () => Promise.resolve(null),
  // A phone "conversion" is a live transcode on the PC with nothing to
  // report and nothing to cancel (a job nobody asks about reaps itself).
  // Named anyway: `usePlayableVideo` returns `onConvertProgress`'s answer as
  // an effect's cleanup, and the Proxy fallback's Promise there is a React
  // error on every video. The waveform and MIDI say "nothing" for now.
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
