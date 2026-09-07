import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { ViewerFile } from '@shared/types'
import { ImageView } from '../components/ImageView'
import { VideoView } from '../components/VideoView'
import { AudioView } from '../components/AudioView'
import { ArchiveView } from '../components/ArchiveView'
import { UnsupportedView } from '../components/UnsupportedView'
import { DEFAULT_TRANSPORT_BG, DEFAULT_TRANSPORT_STYLE } from '../lib/transport'
import {
  enterFullscreen,
  exitFullscreen,
  isFullscreen,
  onFullscreenChange
} from '../lib/fullscreen'
import { hlsPlayerHere } from './canPlay'
import { askPlay, type PlayAnswer } from './prismShim'
import { Remote } from './Remote'
import { readTarget, writeTarget, type PhoneTarget } from './target'

// Split out exactly as App splits them (#106): none of these is on the path
// of playing a film, and a phone that only ever plays films must never
// download pdf.js or CodeMirror. Each is one chunk, fetched on first use.
const CodeView = lazy(() => import('../components/CodeView').then((m) => ({ default: m.CodeView })))
const PdfView = lazy(() => import('../components/pdf/PdfView').then((m) => ({ default: m.PdfView })))
const MarkdownView = lazy(() =>
  import('../components/MarkdownView').then((m) => ({ default: m.MarkdownView }))
)
const DocView = lazy(() => import('../components/DocView').then((m) => ({ default: m.DocView })))
const ComicView = lazy(() =>
  import('../components/ComicView').then((m) => ({ default: m.ComicView }))
)

/** App's own rule: markdown is a document until the pencil says otherwise,
 *  and on the phone there is no pencil. */
const isMarkdown = (name: string): boolean => /\.(md|markdown)$/i.test(name)
const noop = (): void => {}
const nothingPending = (): undefined => undefined

/** While a viewer chunk arrives. `delayed-loader` keeps it invisible unless
 *  the wait is long enough to notice, the same as App's. */
function ViewerLoading(): JSX.Element {
  return (
    <div className="delayed-loader grid h-full w-full place-items-center">
      <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[color:var(--p-divider)] border-t-[var(--color-accent-hi)]" />
    </div>
  )
}

/**
 * The reused viewers on a phone (2026-09-06, #104). Video, audio and
 * pictures first; documents, code, comics and archives since #106, mounted
 * with the props App gives them and nothing the phone cannot honour: the
 * editor is `readOnly`, the archive panel reads `capabilities` and offers
 * View and the folders, a markdown's local link opens only a file the
 * folder lists. A slim bar on
 * top carries back and next/previous; it goes with fullscreen, and the flag
 * follows the HOST rather than the tap, because the phone can leave
 * fullscreen on its own (a swipe, the back gesture, the OS player's Done)
 * and a bar that then stays hidden is a page with no way back.
 *
 * FULLSCREEN IS THE HOST'S, WHICHEVER ONE IT HAS (2026-09-07, owner: "i
 * cant go fullscreen in the player on mobile"). This asked for
 * `requestFullscreen` on the document element and nothing else, which an
 * iPhone does not have in any spelling: there the only fullscreen is the
 * media element's own native player. `lib/fullscreen` picks the route;
 * the STAGE is held by a ref so the element a viewer mounted can be found
 * for that route, while the request itself still goes to the document
 * element, so a host with the standard API behaves exactly as it did and
 * the header is inside what goes fullscreen. Both signals are heard, the
 * document's `fullscreenchange` and the video's own begin/end, since on the
 * iOS route the document never says anything at all.
 *
 * The transport is the DEFAULT style at the default band: the PC's choice
 * lives in its own localStorage and the phone has none of it, and a phone
 * has no Settings to choose another. The viewers are keyed by path, as the
 * app keys them by kind, so a step is a fresh mount and nothing outlives the
 * file it belonged to.
 *
 * THE TARGET (2026-09-07, #107): a film or a track carries a small control
 * reading "This phone" or "This PC". On the phone, everything below is
 * exactly as it was. On the PC, the phone's own player is UNMOUNTED (one
 * clock on screen, the spec's rule), the PC is told to open THIS file, and
 * the `Remote` panel drives it - play, pause, seek, next, previous, volume,
 * mute. Flipping back mounts the player again, which is why the flip is
 * nothing but a state change here: what plays where is decided by what is
 * rendered. The choice is remembered, so the next film goes the same way.
 * A picture or a document shows no control at all: there is no PC transport
 * to hand a page of a PDF to.
 *
 * A film or a track is not mounted until `/api/play` has answered (#105):
 * the answer decides whether the element gets a src at all. Mounted before
 * it, the player would start loading the file itself, and on an Android
 * with an MKV that is an error overlay a moment before the stream it should
 * have been given. Wherever MSE can take the stream, hls.js feeds the
 * element through it, loaded on demand, and it OWNS `src`, which is what
 * the players' `attach` prop is for; where there is no MSE (an iPhone) the
 * playlist url is the src, handed to the players through the hooks they
 * already have, and hls.js is never downloaded. Which of the two is
 * `hlsPlayer`'s call, and it is MSE-first on purpose: Chromium claims
 * native HLS and cannot be trusted with it (see `canPlay.ts`).
 */

/** hls.js on the element, for `attach`: the library is fetched on first use
 *  and torn down with the element. If the player left before the import
 *  landed, nothing is attached. Should the library decline a device whose
 *  MSE said yes, the element gets the playlist as its own src: a player
 *  that may work over one that certainly has nothing. */
function attachHlsJs(playlist: string): (el: HTMLMediaElement) => () => void {
  return (el) => {
    let hls: { destroy(): void } | null = null
    let dead = false
    void import('hls.js').then(({ default: Hls }) => {
      if (dead) return
      if (!Hls.isSupported()) {
        el.src = playlist
        return
      }
      const h = new Hls({ enableWorker: true, lowLatencyMode: false })
      // hls.js owns the source, so the element's own error event never
      // fires for a stream that dies: without this the page went silent. A
      // network failure is retried (a job the PC restarts after a pause
      // answers within a second or two), a media failure gets the one
      // recovery the library offers, and anything past that reaches the
      // player as the element's own error, which is the overlay it already
      // draws for a file it cannot play.
      let networkRetries = 0
      let mediaRetries = 0
      h.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 4) {
          networkRetries += 1
          window.setTimeout(() => !dead && h.startLoad(), 500 * networkRetries)
          return
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
          mediaRetries += 1
          h.recoverMediaError()
          return
        }
        h.destroy()
        hls = null
        el.dispatchEvent(new Event('error'))
      })
      h.loadSource(playlist)
      h.attachMedia(el)
      hls = h
    })
    return () => {
      dead = true
      hls?.destroy()
    }
  }
}

/** The verdict for the file on screen, or null while it is being asked. Kept
 *  with its path, since the shell is not remounted on a step and the last
 *  file's answer must not dress the next one. Not asked at all unless the
 *  phone is the one playing: `/api/play` is what OPENS a transcode job, so
 *  a film handed to the PC must not start one for a player that will never
 *  be mounted. */
function usePlayAnswer(file: ViewerFile, want: boolean): PlayAnswer | null {
  const [answer, setAnswer] = useState<{ path: string; answer: PlayAnswer } | null>(null)
  useEffect(() => {
    if (!want) return
    let live = true
    void askPlay(file.path)
      .catch((e: Error): PlayAnswer => ({ mode: 'none', reason: e.message || 'Prism did not answer' }))
      .then((a) => live && setAnswer({ path: file.path, answer: a }))
    return () => {
      live = false
    }
  }, [file.path, want])
  return answer?.path === file.path ? answer.answer : null
}

export function PhoneViewer({
  file,
  onClose,
  onStep,
  canStep,
  onOpenLocal
}: {
  file: ViewerFile
  onClose: () => void
  onStep: (d: 1 | -1) => void
  canStep: (d: 1 | -1) => boolean
  /** A markdown link to a local file; the browser decides whether it opens. */
  onOpenLocal: (path: string) => void
}): JSX.Element {
  const stageRef = useRef<HTMLDivElement | null>(null)
  // The element a viewer mounted, found after the commit that mounted it: a
  // film's <video> does not exist until `/api/play` has answered, so this
  // cannot be read once. `video` before `audio`, since VideoView also
  // carries a hidden sidecar <audio> and it is the picture that has the iOS
  // native player.
  const [mediaEl, setMediaEl] = useState<HTMLMediaElement | null>(null)
  // No dep list on purpose: the element arrives in a commit this component cannot name (the
  // play answer, a step, the flip back from the PC), and the updater returns the SAME element
  // when nothing changed, which React bails out on without a re-render. No chain of updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const stage = stageRef.current
    const found =
      stage?.querySelector<HTMLMediaElement>('video') ??
      stage?.querySelector<HTMLMediaElement>('audio') ??
      null
    setMediaEl((was) => (was === found ? was : found))
  })
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const root = document.documentElement
    const sync = (): void => setFullscreen(isFullscreen(root, mediaEl))
    sync()
    return onFullscreenChange(root, mediaEl, sync)
  }, [mediaEl])
  const toggleFullscreen = useCallback((): void => {
    const root = document.documentElement
    if (isFullscreen(root, mediaEl)) exitFullscreen(root, mediaEl)
    else enterFullscreen(root, mediaEl)
  }, [mediaEl])

  const media = file.kind === 'video' || file.kind === 'audio'
  const [target, setTarget] = useState<PhoneTarget>(() => readTarget(localStorage))
  const pickTarget = (t: PhoneTarget): void => {
    setTarget(t)
    writeTarget(localStorage, t)
  }
  const onPc = media && target === 'pc'

  const answer = usePlayAnswer(file, media && !onPc)
  const playlist = answer?.mode === 'hls' ? answer.url : null
  // An HLS film is handed its PLAYLIST as the url from the start. The direct
  // url used to go in and be swapped a moment later, which cost one aborted
  // request per film and an ERR_ABORTED in the console; the playlist is the
  // only src there is for such a file, and the shim's convertVideo answers
  // the same string, so nothing swaps.
  const url = playlist ?? window.prism.mediaUrl(file.path)
  const viaHlsJs = playlist !== null && hlsPlayerHere() === 'hlsjs'
  const attach = useMemo(() => (viaHlsJs && playlist ? attachHlsJs(playlist) : undefined), [viaHlsJs, playlist])
  let view: JSX.Element
  switch (file.kind) {
    case 'video':
    case 'audio':
      if (onPc) {
        // Keyed to the file, so stepping to the next one is a fresh mount
        // and a fresh handover: the PC is told about the file on screen.
        view = <Remote key={file.path} openPath={file.path} />
        break
      }
      if (!answer) {
        view = (
          <p className="p-6 text-center opacity-70" data-phone-preparing>
            Preparing...
          </p>
        )
        break
      }
      if (answer.mode === 'none') {
        view = (
          <p className="p-6 text-center opacity-70" data-phone-unplayable>
            {file.name}: {answer.reason}
          </p>
        )
        break
      }
      view =
        file.kind === 'video' ? (
          <VideoView
            key={file.path}
            url={url}
            path={file.path}
            onToggleFullscreen={toggleFullscreen}
            onAutoAdvance={() => onStep(1)}
            onStep={onStep}
            canStep={canStep}
            transportStyle={DEFAULT_TRANSPORT_STYLE}
            transportBg={DEFAULT_TRANSPORT_BG}
            fullscreen={fullscreen}
            attach={attach}
          />
        ) : (
          <AudioView
            key={file.path}
            url={url}
            path={file.path}
            name={file.name}
            fullscreen={fullscreen}
            onToggleFullscreen={toggleFullscreen}
            onAutoAdvance={() => onStep(1)}
            onStep={onStep}
            canStep={canStep}
            transportStyle={DEFAULT_TRANSPORT_STYLE}
            attach={attach}
          />
        )
      break
    case 'image':
      view = (
        <ImageView
          key={file.path}
          url={url}
          path={file.path}
          name={file.name}
          onToggleFullscreen={toggleFullscreen}
          onStep={onStep}
          canStep={canStep}
          fullscreen={fullscreen}
        />
      )
      break
    case 'pdf':
      view = (
        <Suspense fallback={<ViewerLoading />}>
          <PdfView key={file.path} url={url} path={file.path} onToggleFullscreen={toggleFullscreen} />
        </Suspense>
      )
      break
    case 'doc':
      view = (
        <Suspense fallback={<ViewerLoading />}>
          <DocView key={file.path} path={file.path} name={file.name} />
        </Suspense>
      )
      break
    case 'comic':
      view = (
        <Suspense fallback={<ViewerLoading />}>
          <ComicView
            key={file.path}
            path={file.path}
            name={file.name}
            onToggleFullscreen={toggleFullscreen}
            fullscreen={fullscreen}
          />
        </Suspense>
      )
      break
    case 'archive':
      // No onUndoable, no onRenameSelf, no refreshKey: those are the writes
      // and the undo stack, and the panel hides every verb that would need
      // them once `capabilities` says so.
      view = <ArchiveView key={file.path} file={file} fullscreen={fullscreen} />
      break
    case 'text':
      // Read-only, structurally: the editor is told so and keeps no buffer,
      // so `onBuffer` and `getPending` are what App would pass for a file
      // with nothing unsaved. There is no writeText on the phone anyway.
      view = isMarkdown(file.name) ? (
        <Suspense fallback={<ViewerLoading />}>
          <MarkdownView key={file.path} path={file.path} onOpenLocal={onOpenLocal} />
        </Suspense>
      ) : (
        <Suspense fallback={<ViewerLoading />}>
          <CodeView
            key={file.path}
            path={file.path}
            name={file.name}
            readOnly
            onSaved={noop}
            onBuffer={noop}
            getPending={nothingPending}
            fullscreen={fullscreen}
          />
        </Suspense>
      )
      break
    default:
      // The listing never carries a kind Prism cannot show, so this is
      // reached only by a path typed by hand; the view names the file and
      // stops, its hex button being the desktop's (it reads `capabilities`).
      view = <UnsupportedView file={file} />
  }
  return (
    <div
      className="flex h-dvh flex-col bg-[var(--p-bg)] text-[var(--p-text)]"
      data-phone-viewer
      data-kind={file.kind}
      data-target={media ? target : undefined}
    >
      {!fullscreen && (
        <header className="flex h-11 shrink-0 items-center gap-1 px-2 pt-[env(safe-area-inset-top)] text-sm">
          <button
            className="grid h-9 w-10 shrink-0 place-items-center rounded"
            aria-label="Back to the folder"
            onClick={onClose}
          >
            <svg
              viewBox="0 0 24 24"
              width={18}
              height={18}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <span className="min-w-0 flex-1 truncate" data-phone-title>
            {file.name}
          </span>
          <button
            className="grid h-9 w-10 shrink-0 place-items-center rounded disabled:opacity-30"
            aria-label="Previous"
            disabled={!canStep(-1)}
            onClick={() => onStep(-1)}
          >
            <svg
              viewBox="0 0 24 24"
              width={18}
              height={18}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 15l6-6 6 6" />
            </svg>
          </button>
          <button
            className="grid h-9 w-10 shrink-0 place-items-center rounded disabled:opacity-30"
            aria-label="Next"
            disabled={!canStep(1)}
            onClick={() => onStep(1)}
          >
            <svg
              viewBox="0 0 24 24"
              width={18}
              height={18}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </header>
      )}
      {media && !fullscreen && <TargetSwitch target={target} onPick={pickTarget} />}
      <div ref={stageRef} className="relative min-h-0 flex-1">
        {view}
      </div>
    </div>
  )
}

/**
 * This phone | This PC. A radio group rather than two buttons: the two are
 * one choice, and a screen reader says which is on. It sits under the title
 * row rather than in it, because "This phone" and "This PC" are words and
 * the row already carries back, the file name and both step verbs; and it
 * goes with the header in fullscreen, where the phone is plainly the one
 * playing.
 */
function TargetSwitch({
  target,
  onPick
}: {
  target: PhoneTarget
  onPick: (t: PhoneTarget) => void
}): JSX.Element {
  const seg = (t: PhoneTarget, label: string): JSX.Element => {
    const on = target === t
    return (
      <button
        role="radio"
        aria-checked={on}
        data-phone-target={t}
        className={`h-9 rounded-full px-3 text-sm ${on ? 'bg-[var(--p-accent)] text-white' : 'opacity-70'}`}
        onClick={() => onPick(t)}
      >
        {label}
      </button>
    )
  }
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 px-3 pb-1">
      <span className="text-xs opacity-50">Play on</span>
      <div
        role="radiogroup"
        aria-label="Play on"
        className="flex items-center rounded-full border border-[color:var(--p-line)] p-0.5"
      >
        {seg('phone', 'This phone')}
        {seg('pc', 'This PC')}
      </div>
    </div>
  )
}
