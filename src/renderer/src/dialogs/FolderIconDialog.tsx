import type { JSX } from 'react'
import { Dialog } from '../components/Dialog'
import { FolderIconPicker } from '../components/iconGrid/FolderIconPicker'

/**
 * THE FOLDER ICON PICKER (owner, 2026-10-31: "allow the user to pick folder
 * icons both for the sidebar things and folders in general. the user can pick
 * from a set of built in icons"). Opened by "Change icon..." on a folder row
 * (one or several marked) or a sidebar pin. One click or Enter picks and
 * closes (D8); Reset to default takes the icon away; Cancel and Escape change
 * nothing. "From a file..." (2026-10-31) asks for a picture: PNG, JPG, GIF,
 * BMP, WEBP, ICO or SVG (D7), the open dialog on the folder of the last pick.
 */
export function FolderIconDialog({
  name,
  current,
  onPick,
  onReset,
  onFromFile,
  onCancel
}: {
  /** The folder's name, or "3 folders". */
  name: string
  /** The built-in icon it has now, marked in the grid. */
  current?: string
  onPick: (icon: string) => void
  onReset: () => void
  /** Pick a picture instead; the picker stays until it is kept. */
  onFromFile: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <Dialog
      wide
      title={`Icon for ${name}`}
      body={<FolderIconPicker current={current} onPick={onPick} />}
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', onPick: onCancel },
        { label: 'Reset to default', onPick: onReset },
        { label: 'From a file...', onPick: onFromFile }
      ]}
    />
  )
}
