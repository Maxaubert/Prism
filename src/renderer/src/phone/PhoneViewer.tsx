import { useCallback, useEffect, useState, type JSX } from 'react'
import type { ViewerFile } from '@shared/types'
import { ImageView } from '../components/ImageView'
import { VideoView } from '../components/VideoView'
import { AudioView } from '../components/AudioView'
import { DEFAULT_TRANSPORT_BG, DEFAULT_TRANSPORT_STYLE } from '../lib/transport'

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
 */
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
  let view: JSX.Element
  switch (file.kind) {
    case 'video':
      view = (
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
    case 'audio':
      view = (
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
