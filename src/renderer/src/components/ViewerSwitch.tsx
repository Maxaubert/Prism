import { lazy, Suspense, type JSX, type ReactNode } from 'react'
import type { ViewerFile } from '@shared/types'
import { isMarkdown } from '@shared/fileKind'
import { DEFAULT_TRANSPORT_BG, DEFAULT_TRANSPORT_STYLE, type TransportStyle } from '../lib/transport'
import { ImageView } from './ImageView'
import { VideoView } from './VideoView'
import { AudioView } from './AudioView'
import { UnsupportedView } from './UnsupportedView'
import { LoadingState } from './LoadingState'

// Split out, all five: none of them is on the path of opening a photo or
// playing a film, and the resident single-instance model exists so the window
// is there the instant you ask (a phone that only ever plays films must never
// download pdf.js or CodeMirror, #106). CodeMirror is ~770KB, pdf.js about a
// megabyte, and react-markdown brings remark, rehype and micromark with it.
const CodeView = lazy(() => import('./CodeView').then((m) => ({ default: m.CodeView })))
const PdfView = lazy(() => import('./pdf/PdfView').then((m) => ({ default: m.PdfView })))
const MarkdownView = lazy(() => import('./MarkdownView').then((m) => ({ default: m.MarkdownView })))
const DocView = lazy(() => import('./DocView').then((m) => ({ default: m.DocView })))
const ComicView = lazy(() => import('./ComicView').then((m) => ({ default: m.ComicView })))

const noop = (): void => {}
const never = (): boolean => false
const nothingPending = (): undefined => undefined

/**
 * Where the viewer is drawn, which is what decides the few things that differ:
 *  - `full`: App's stage, every prop App has.
 *  - `phone`: the phone's page; text is read-only there (no writeText).
 *  - `member`: a member previewed inside ArchiveView, from its temp copy. It
 *    gets no path for the image and PDF viewers (nothing is remembered
 *    against a temp copy), and documents and comics are not offered.
 */
export type ViewerMode = 'full' | 'phone' | 'member'

export interface ViewerSwitchProps {
  file: ViewerFile
  mode: ViewerMode
  /** The phone's player src when it is a stream (an HLS playlist); the
   *  file's own media url otherwise. */
  url?: string
  /** What an archive is here: App's card, the phone's panel, a nested panel. */
  archive: () => JSX.Element
  /** What a kind this place does not show is. UnsupportedView by default. */
  unsupported?: () => JSX.Element
  /** While a viewer chunk arrives; the delayed loader by default. */
  loading?: ReactNode
  onToggleFullscreen?: () => void
  fullscreen?: boolean
  onAutoAdvance?: () => void
  onStep?: (dir: 1 | -1) => void
  canStep?: (dir: 1 | -1) => boolean
  transportStyle?: TransportStyle
  transportBg?: number
  background?: boolean
  volumeKey?: string
  onOpenLocal?: (path: string) => void
  readOnly?: boolean
  onBuffer?: (path: string, text: string | null) => void
  getPending?: (path: string) => string | undefined
  onExternalChange?: (path: string) => void
  reloadAnswer?: { path: string; reload: boolean } | null
  /** The phone's player hooks (HLS, its own audio-track pick). */
  attach?: (el: HTMLMediaElement) => () => void
  audioTrack?: number | null
  onAudioTrack?: (index: number | null) => void
}

/**
 * KIND TO VIEWER, ONCE (structure cleanup, 2026-10-12): App's stage, the
 * phone and an archive's member preview each had their own switch. A prop a
 * host does not give stays unset where the viewer allows that, and is inert
 * (a no-op, "cannot step", the default transport) where it does not.
 */
export function ViewerSwitch(props: ViewerSwitchProps): JSX.Element {
  const { file, mode } = props
  const url = props.url ?? window.prism.mediaUrl(file.path)
  const toggle = props.onToggleFullscreen ?? noop
  const fallback = props.loading === undefined ? <LoadingState className="h-full w-full" /> : props.loading
  const transportStyle = props.transportStyle ?? DEFAULT_TRANSPORT_STYLE
  const unsupported = (): JSX.Element =>
    props.unsupported ? props.unsupported() : <UnsupportedView file={file} />
  switch (file.kind) {
    case 'video':
      return (
        <VideoView
          url={url}
          path={file.path}
          onToggleFullscreen={toggle}
          onAutoAdvance={props.onAutoAdvance ?? noop}
          onStep={props.onStep ?? noop}
          canStep={props.canStep ?? never}
          transportStyle={transportStyle}
          transportBg={props.transportBg ?? DEFAULT_TRANSPORT_BG}
          background={props.background}
          volumeKey={props.volumeKey}
          fullscreen={props.fullscreen}
          attach={props.attach}
          audioTrack={props.audioTrack}
          onAudioTrack={props.onAudioTrack}
        />
      )
    case 'image':
      return (
        <ImageView
          url={url}
          path={mode === 'member' ? undefined : file.path}
          name={file.name}
          onToggleFullscreen={toggle}
          onStep={props.onStep}
          canStep={props.canStep}
          fullscreen={props.fullscreen}
        />
      )
    case 'audio':
      return (
        <AudioView
          url={url}
          path={file.path}
          name={file.name}
          fullscreen={props.fullscreen ?? false}
          onToggleFullscreen={toggle}
          onAutoAdvance={props.onAutoAdvance ?? noop}
          onStep={props.onStep}
          canStep={props.canStep}
          transportStyle={transportStyle}
          background={props.background}
          volumeKey={props.volumeKey}
          attach={props.attach}
        />
      )
    case 'pdf':
      return (
        <Suspense fallback={fallback}>
          <PdfView url={url} path={mode === 'member' ? undefined : file.path} onToggleFullscreen={toggle} />
        </Suspense>
      )
    case 'doc':
      if (mode === 'member') return unsupported()
      return (
        <Suspense fallback={fallback}>
          <DocView path={file.path} name={file.name} />
        </Suspense>
      )
    case 'comic':
      if (mode === 'member') return unsupported()
      return (
        <Suspense fallback={fallback}>
          <ComicView
            path={file.path}
            name={file.name}
            onToggleFullscreen={toggle}
            fullscreen={props.fullscreen ?? false}
          />
        </Suspense>
      )
    case 'archive':
      return props.archive()
    case 'text':
      // Markdown is a document until the pencil says otherwise; everything
      // else is its own source, editable where it sits (read-only on the
      // phone and for a member). A save here changes nothing on screen that
      // isn't already there, so it must not remount the viewer.
      return isMarkdown(file.name) ? (
        <Suspense fallback={fallback}>
          <MarkdownView path={file.path} onOpenLocal={props.onOpenLocal ?? noop} />
        </Suspense>
      ) : (
        <Suspense fallback={fallback}>
          <CodeView
            path={file.path}
            name={file.name}
            readOnly={mode === 'phone' ? true : props.readOnly}
            onSaved={noop}
            onBuffer={props.onBuffer ?? noop}
            getPending={props.getPending ?? nothingPending}
            onExternalChange={props.onExternalChange}
            answer={props.reloadAnswer}
            fullscreen={props.fullscreen}
          />
        </Suspense>
      )
    default:
      return unsupported()
  }
}
