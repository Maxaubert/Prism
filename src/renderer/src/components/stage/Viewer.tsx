import type { JSX } from 'react'
import type { ViewerFile } from '@shared/types'
import { ViewerSwitch } from '../ViewerSwitch'
import { ArchiveCard } from '../browse/ArchiveCard'
import { MemberGate } from '../MemberGate'
import { MemberNote } from '../MemberNote'
import type { TransportStyle } from '../../lib/transport'
import { LoadingState } from '../LoadingState'
import type { UndoEntry } from '../../lib/undo'
import { extractAll } from '../../lib/extractAll'

/** While the editor chunk arrives. `delayed-loader` keeps it invisible unless
 *  the wait is long enough to notice, so a warm cache shows nothing at all. */
export function EditorLoading(): JSX.Element {
  return (
    <LoadingState className="h-full w-full" />
  )
}

export function Viewer({
  file,
  onUndoable,
  refreshKey,
  onToggleFullscreen,
  fullscreen,
  transportStyle,
  transportBg,
  onOpenLocal,
  onAutoAdvance,
  onStep,
  canStep,
  onBuffer,
  onRenameSelf,
  getPending,
  onExternalChange,
  reloadAnswer,
  background = false,
  volumeKey = '',
  onOpenArchive,
  note = false,
  readOnly = false
}: {
  file: ViewerFile
  /** An archive's card asks to go in (#300): the Explorer walks into it, a
   *  project's tree opens its node. */
  onOpenArchive?: (path: string) => void
  /** Full view or a project: a member wears its read-only note (#300). The
   *  preview pane carries none (mockup 04). */
  note?: boolean
  /** A member of an archive, shown from its temp copy: nothing edits it. */
  readOnly?: boolean
  /** An archive reports its own undoable writes up to App's stack. */
  onUndoable: (entry: UndoEntry) => void
  /** An archive's own "Rename" verb: App owns renaming, so it does it. */
  onRenameSelf: (name: string) => void
  /** Bumped after an undo, so an open archive re-reads its container. */
  refreshKey: number
  onToggleFullscreen: () => void
  fullscreen: boolean
  transportStyle: TransportStyle
  /** How solid the band behind the video's controls is, 0-100%. */
  transportBg: number
  /** Something outside Prism rewrote a file that holds unsaved edits. */
  onExternalChange: (path: string) => void
  /** What the user answered about it. */
  reloadAnswer: { path: string; reload: boolean } | null
  /** A markdown link to a local file; opened the same way as a tree click. */
  onOpenLocal: (path: string) => void
  /** Autoplay: a finished video/track moves to the next of its kind. */
  onAutoAdvance: () => void
  /** The video menu's Next / Previous, by the same rule. */
  onStep: (dir: 1 | -1) => void
  canStep: (dir: 1 | -1) => boolean
  /** Code and text edit in place, so the viewer hands its buffer up to App. */
  onBuffer: (path: string, text: string | null) => void
  /** Asked for the unsaved text of a file, if App is holding any. */
  getPending: (path: string) => string | undefined
  /** This tab is not the one in front: its player keeps going, unseen. */
  background?: boolean
  /** Whose volume this player uses - the tab's, for the session. */
  volumeKey?: string
}): JSX.Element {
  // A MEMBER of an archive (#300): main unpacks it to the run's temp folder
  // first, and the same viewer is drawn on the copy, read-only.
  if (file.member) {
    const props = {
      onUndoable, refreshKey, onToggleFullscreen, fullscreen, transportStyle, transportBg,
      onOpenLocal, onAutoAdvance, onStep, canStep, onBuffer, onRenameSelf, getPending,
      onExternalChange, reloadAnswer, background, volumeKey, onOpenArchive
    }
    const gate = (
      <MemberGate file={file} render={(real) => <Viewer {...props} file={real} readOnly />} />
    )
    if (!note) return gate
    return (
      <div className="flex h-full w-full min-h-0 flex-col">
        <MemberNote path={file.path} onExtracted={onOpenLocal} />
        <div className="relative flex min-h-0 flex-1 items-center justify-center">{gate}</div>
      </div>
    )
  }
  // Windows can always hand us a file we don't show: the "Choose another app"
  // dialog lists every installed application, not just the ones registered for
  // the type. The switch's UnsupportedView says so plainly instead of leaving
  // an empty window with a grey line in it.
  return (
    <ViewerSwitch
      file={file}
      mode="full"
      loading={<EditorLoading />}
      onToggleFullscreen={onToggleFullscreen}
      fullscreen={fullscreen}
      onAutoAdvance={onAutoAdvance}
      onStep={onStep}
      canStep={canStep}
      transportStyle={transportStyle}
      transportBg={transportBg}
      background={background}
      volumeKey={volumeKey}
      onOpenLocal={onOpenLocal}
      readOnly={readOnly}
      onBuffer={onBuffer}
      getPending={getPending}
      onExternalChange={onExternalChange}
      reloadAnswer={reloadAnswer}
      // ZIPS ARE FOLDERS (#300): an archive is gone INTO, like a folder, and
      // its row previews as this card. The old panel lives on for the phone.
      archive={() => (
        <ArchiveCard
          path={file.path}
          name={file.name}
          mtimeMs={file.mtimeMs}
          onOpen={() => onOpenArchive?.(file.path)}
          onExtractHere={() => void extractAll(file.path, true)}
          onExtractTo={() => void extractAll(file.path, false)}
        />
      )}
    />
  )
}
