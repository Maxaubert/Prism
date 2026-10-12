import type { JSX } from 'react'
import type { FileKind } from '@shared/types'
import type { BrowseDriveUsage } from '@shared/browse'
import { DIALOG_BOX } from '../dialogLook'
import { Modal } from '../Modal'
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
  const body: BodyProps = { root, path, name, kind, onClose }

  return (
    // Close is focused, so Enter and Escape both close without the mouse.
    <Modal
      label={drive ? `Properties of ${path}` : `Properties of ${name}`}
      focusKey={path}
      onCancel={onClose}
      attrs={{ 'data-props-window': 'true' }}
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
    </Modal>
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
