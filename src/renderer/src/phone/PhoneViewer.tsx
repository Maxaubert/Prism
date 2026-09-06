import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { ViewerFile } from '@shared/types'
import { ImageView } from '../components/ImageView'
import { VideoView } from '../components/VideoView'
import { AudioView } from '../components/AudioView'
import { DEFAULT_TRANSPORT_BG, DEFAULT_TRANSPORT_STYLE } from '../lib/transport'
import { hlsPlayerHere } from './canPlay'
import { askPlay, type PlayAnswer } from './prismShim'

/**
 * The reused viewers on a phone (2026-09-06, #104). Video, audio and
 * pictures in this PR; the rest say so honestly until PR 3. A slim bar on
 * top carries back and next/previous; it goes with fullscreen, which is the
 * browser's own (`requestFullscreen` on the document), and the flag follows
 * `fullscreenchange` rather than the tap, because the phone can leave
 * fullscreen on its own (a swipe, the back gesture) and a bar that then
 * stays hidden is a page with no way back.
 *
 * The transport is the DEFAULT style at the default band: the PC's choice
 * lives in its own localStorage and the phone has none of it, and a phone
 * has no Settings to choose another. The viewers are keyed by path, as the
 * app keys them by kind, so a step is a fresh mount and nothing outlives the
 * file it belonged to.
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
 *  file's answer must not dress the next one. */
function usePlayAnswer(file: ViewerFile): PlayAnswer | null {
  const media = file.kind === 'video' || file.kind === 'audio'
  const [answer, setAnswer] = useState<{ path: string; answer: PlayAnswer } | null>(null)
  useEffect(() => {
    if (!media) return
    let live = true
    void askPlay(file.path)
      .catch((e: Error): PlayAnswer => ({ mode: 'none', reason: e.message || 'Prism did not answer' }))
      .then((a) => live && setAnswer({ path: file.path, answer: a }))
    return () => {
      live = false
    }
  }, [file.path, media])
  return answer?.path === file.path ? answer.answer : null
}

export function PhoneViewer({
  file,
  onClose,
  onStep,
  canStep
}: {
  file: ViewerFile
  onClose: () => void
  onStep: (d: 1 | -1) => void
  canStep: (d: 1 | -1) => boolean
}): JSX.Element {
  const [fullscreen, setFullscreen] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    const sync = (): void => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  const toggleFullscreen = useCallback((): void => {
    const el = document.documentElement
    // iOS Safari has no document fullscreen at all; the video's own native
    // fullscreen is what a phone there gets, and a tap here does nothing.
    if (!document.fullscreenElement) void el.requestFullscreen?.().catch(() => {})
    else void document.exitFullscreen?.().catch(() => {})
  }, [])

  const url = window.prism.mediaUrl(file.path)
  const answer = usePlayAnswer(file)
  const playlist = answer?.mode === 'hls' ? answer.url : null
  const viaHlsJs = playlist !== null && hlsPlayerHere() === 'hlsjs'
  const attach = useMemo(() => (viaHlsJs && playlist ? attachHlsJs(playlist) : undefined), [viaHlsJs, playlist])
  let view: JSX.Element
  switch (file.kind) {
    case 'video':
    case 'audio':
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
    default:
      view = (
        <p className="p-6 text-center opacity-70" data-phone-unsupported>
          {file.name}: this kind is not on the phone yet.
        </p>
      )
  }
  return (
    <div
      className="flex h-dvh flex-col bg-[var(--p-bg)] text-[var(--p-text)]"
      data-phone-viewer
      data-kind={file.kind}
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
      <div className="relative min-h-0 flex-1">{view}</div>
    </div>
  )
}
