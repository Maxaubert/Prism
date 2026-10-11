import { useEffect, useRef, type JSX } from 'react'
import type { FileKind } from '@shared/types'
import type { BrowseDriveUsage } from '@shared/browse'
import { DIALOG_BOX, DIALOG_SCRIM } from '../dialogLook'
import { AudioBody } from './AudioBody'
import type { BodyProps } from './bodyProps'
import { DriveBody } from './DriveBody'
import { FolderBody } from './FolderBody'
import { OtherBody } from './OtherBody'
import { PhotoBody } from './PhotoBody'
import { TextBody } from './TextBody'
import { VideoBody } from './VideoBody'

/**
 * THE PROPERTIES WINDOW, PER KIND (owner, 2026-10-12: "build the properties
 * pop up window a bit nicer looking", picked through three rounds of
 * mockups; spec `docs/superpowers/specs/2026-10-12-properties-window-design.md`).
 *
 * One frame for all: Prism's dialog box, which a click outside or Escape
 * closes, holding the body for the kind. Each body draws its own header and
 * footer, and Close is the only button but on a drive.
 */
export function PropertiesDialog({
  root,
  path,
  name,
  kind,
  isFolder,
  drive,
  onOpenFolder,
  onClose
}: {
  /** The tab's root: a folder's contents row is a listDir, which is walled. */
  root: string
  path: string
  name: string
  kind: FileKind
  isFolder: boolean
  /** A drive from the places panel: its own facts, and no size walk. */
  drive?: BrowseDriveUsage
  /** Opens a folder in the Explorer (the drive's Open, a donut slice). The
   *  project tree passes none, and has no drives to open. */
  onOpenFolder?: (path: string) => void
  onClose: () => void
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  // The listener is registered once and reads the latest onClose from a ref,
  // as Dialog's does (#168): keyed on an inline arrow it was torn down and
  // put back on every render, and an Escape could fall between the two.
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  // Close is focused, so Enter and Escape both close without the mouse.
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('[data-primary="true"]')?.focus()
  }, [path])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        close.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const body: BodyProps = { root, path, name, kind, onClose }

  return (
    // data-owns-escape: the app's capture-phase Escape handler registered
    // first and would otherwise close the WINDOW while a dialog is up.
    <div data-owns-escape className={DIALOG_SCRIM} role="presentation" onMouseDown={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={drive ? `Properties of ${path}` : `Properties of ${name}`}
        data-props-window
        onMouseDown={(e) => e.stopPropagation()}
        // A tall body (a film with many tracks) scrolls inside the box rather
        // than past the window's edge.
        className={`${DIALOG_BOX} max-h-full overflow-y-auto text-[12.5px] text-[var(--p-text)]`}
      >
        {drive ? (
          <DriveBody key={path} drive={drive} onOpenFolder={onOpenFolder} onClose={onClose} />
        ) : isFolder ? (
          <FolderBody key={path} {...body} />
        ) : (
          <FileBody key={path} {...body} />
        )}
      </div>
    </div>
  )
}

function FileBody(props: BodyProps): JSX.Element {
  switch (props.kind) {
    case 'image':
      return <PhotoBody {...props} />
    case 'video':
      return <VideoBody {...props} />
    case 'audio':
      return <AudioBody {...props} />
    case 'text':
      return <TextBody {...props} />
    default:
      return <OtherBody {...props} />
  }
}
