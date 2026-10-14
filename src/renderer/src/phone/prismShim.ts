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
import type {
  ArchiveListing,
  DirListing,
  FileMemory,
  MediaProbe,
  SearchResult,
  TextRead
} from '@shared/types'
import type { MemberExtractResult } from '@shared/extraction'
import type {
  ComicOpenResult,
  ConvertResult,
  HostCapabilities,
  SubtitleTrack
} from '@shared/ipcTypes'
import {
  ROUTE,
  routePath,
  type DocAnswer,
  type PhoneStat,
  type PlayAnswer,
  type PosAnswer
} from '@shared/phoneWire'
import { apiUrl, getJson, getOr, mediaUrl, postFireAndForget } from './api'
import { canCsv } from './canPlay'

/** What `/api/play` answers (#105) and the tracks it lists (#120) are the
 *  wire's (`@shared/phoneWire`); `audioOnly` is what tells the shim which
 *  reused hook the playlist belongs to (see `probeMedia` below). */
export type { PlayAnswer, PlayTrack } from '@shared/phoneWire'

export const capabilities = {
  write: false,
  clipboard: false,
  explorer: false,
  drag: false
} as const satisfies HostCapabilities

/** `capabilities` IS on PrismApi (#106); it is named here so the shim
 *  cannot be built without one. Every other member is typed by PrismApi
 *  itself, so the shim cannot drift from the desktop's answers. */
type Shim = Partial<PrismApi> & { capabilities: typeof capabilities }

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
export function askPlay(path: string, audio: number | null = null): Promise<PlayAnswer> {
  const now = Date.now()
  // The cache is keyed by file AND track (#120): a pick is a different
  // stream, and the players' probes must see the one the shell chose.
  const key = audio === null ? path : `${path}#${audio}`
  const held = plays.get(key)
  if (held && now - held.at < PLAY_TTL_MS) return held.answer
  const answer = getJson<PlayAnswer>(routePath(ROUTE.play), {
    path,
    can: canCsv(),
    ...(audio === null ? {} : { audio: String(audio) })
  })
  plays.set(key, { at: now, answer })
  // A refused or failed ask is not an answer to keep: the next one tries again.
  answer.catch(() => {
    if (plays.get(key)?.answer === answer) plays.delete(key)
  })
  return answer
}

/** The track the shell has chosen for a file, so the players' own probes
 *  (`probeMedia`, `convertVideo`, which take a path and nothing else) ask
 *  for the same stream the shell did. */
const chosenAudio = new Map<string, number | null>()
export function chooseAudio(path: string, audio: number | null): void {
  if (audio === null) chosenAudio.delete(path)
  else chosenAudio.set(path, audio)
}
const askPlayChosen = (path: string): Promise<PlayAnswer> => askPlay(path, chosenAudio.get(path) ?? null)

/** `pw` rides only when there is one: the server reads an absent one as
 *  "no password", and an empty one would be a password of nothing. */
const withPw = (params: Record<string, string>, password?: string): Record<string, string> =>
  password ? { ...params, pw: password } : params

const implemented: Shim = {
  capabilities,
  mediaUrl,
  demo: false,
  forceSetup: false,
  listDir: (_root, path) => getOr<DirListing, null>(routePath(ROUTE.dir), { path }, null),
  /**
   * The sidebar's search, named the same so the field is the desktop's own
   * call (Task 2). The ROOT is dropped on purpose: the phone's is the one it
   * paired to and the server knows it, and a root a page could name is a root
   * it could ask to have searched. A refused or failed ask reads as no hits,
   * which is what the field already draws while nothing matches.
   */
  // The folder the phone is in and everything below it (2026-10-14): the
  // browser hands that folder where the desktop hands a root.
  searchTree: (dir, query) =>
    getOr<SearchResult>(routePath(ROUTE.search), { dir, q: query }, { hits: [], truncated: false }),
  /**
   * The read-only document routes (#106). Each answers in the shape its IPC
   * does, so the viewers are not told the difference, and a refused or
   * failed fetch is the same failure the IPC would report: a text the phone
   * cannot read is `unreadable`, a document that would not convert is null,
   * an archive that would not list is `failed`.
   */
  readText: (path) => getOr<TextRead>(routePath(ROUTE.text), { path }, { error: 'unreadable' }),
  docHtml: (path) =>
    getJson<DocAnswer>(routePath(ROUTE.doc), { path })
      .then((r) => r.html)
      .catch(() => null),
  comicOpen: (path, password = '') =>
    getOr<ComicOpenResult>(routePath(ROUTE.comic), { path, pw: password }, { error: 'failed' }),
  archiveList: (path, password) =>
    getOr<ArchiveListing>(routePath(ROUTE.archive), withPw({ path }, password), {
      ok: false,
      reason: 'failed'
    }),
  archiveExtract: (path, entry, password) =>
    getOr<MemberExtractResult>(
      routePath(ROUTE.archiveExtract),
      withPw({ path, entry }, password),
      { ok: false, reason: 'failed' }
    ),
  // The panel asks this for one thing, whether the container can be written,
  // and on the phone no container can: every archive reads as the 7z kind.
  // The counts are the Properties popup's, which the phone does not have.
  archiveStat: () =>
    Promise.resolve({ files: 0, folders: 0, uncompressed: 0, encryption: 'none' as const, readOnly: true }),
  statFile: (path) => getOr<PhoneStat, null>(routePath(ROUTE.stat), { path }, null),
  // The PC's own position store (#118), the one thing a phone WRITES: a
  // number per film, into main's store and never the filesystem. A film left
  // at minute 40 on the PC opens at minute 40 here, and the other way round.
  positionGet: (path) =>
    getJson<PosAnswer>(routePath(ROUTE.pos), { path })
      .then((r) => r.t)
      .catch(() => null),
  positionSet: (path, t) => postFireAndForget(routePath(ROUTE.pos), { t }, { path }),
  // ...and the choices beside the place (#124): the same route, a patch.
  memoryGet: (path) =>
    getJson<PosAnswer>(routePath(ROUTE.pos), { path })
      .then((r): FileMemory => {
        const { t, ...rest } = r
        return t === null ? rest : { ...rest, t }
      })
      .catch(() => null),
  memorySet: (path, patch) => postFireAndForget(routePath(ROUTE.pos), patch, { path }),
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
    const a = await askPlayChosen(path).catch((): PlayAnswer => ({ mode: 'none', reason: '' }))
    if (a.mode === 'none') return { ffmpeg: false, needed: false }
    if (a.mode === 'direct') return { ffmpeg: true, needed: false, fps: a.fps ?? undefined }
    if (a.audioOnly) return { ffmpeg: true, needed: true, url: a.url }
    // The file's tracks, so the picker has rows (#120). No url: on the phone
    // a track is not a sidecar stream but a different playlist, and the
    // pick goes up to the shell (`onAudioTrack`), never to the sidecar.
    const tracks = (a.tracks ?? []).map((t) => ({ ...t, url: '' }))
    return {
      ffmpeg: true,
      needed: false,
      fps: a.fps ?? undefined,
      tracks,
      convert: { reason: 'container', quick: a.copyVideo }
    }
  },
  convertVideo: async (path): Promise<ConvertResult> => {
    const a = await askPlayChosen(path).catch((e: Error): PlayAnswer => ({ mode: 'none', reason: e.message }))
    if (a.mode === 'hls') return { url: a.url }
    return { error: a.mode === 'none' && a.reason ? a.reason : 'Prism could not prepare this file' }
  },
  audioBlind: () => Promise.resolve(null),
  subsFor: (path) => getOr<SubtitleTrack[]>(routePath(ROUTE.subs), { path }, []),
  // A refused or failed fetch is "no subtitles", like every other read here.
  readSubs: async (path) => {
    try {
      const r = await fetch(apiUrl(routePath(ROUTE.subsRead), { path }))
      return r.ok ? await r.text() : null
    } catch {
      return null
    }
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
  // The Properties window's extra facts (2026-10-12) are the PC's: on the
  // phone each answers "not known", and a checksum never starts.
  propsMedia: () => Promise.resolve(null),
  propsPicture: () => Promise.resolve(null),
  propsText: () => Promise.resolve(null),
  driveDetails: () => Promise.resolve(null),
  driveCleanup: () => Promise.resolve(false),
  hashFile: () => ({ done: Promise.resolve(null), cancel: () => {} }),
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
