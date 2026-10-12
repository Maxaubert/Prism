import type { JSX } from 'react'
import { Dialog } from '../components/Dialog'

/** Something that did not work, said once, with one button that closes it:
 *  App's "That didn't work", the tree's paste and add-to-archive failures and
 *  the archive panel's notes. */
export function NoticeDialog({
  title,
  message,
  button = 'OK',
  onClose
}: {
  title: string
  message: string
  button?: 'OK' | 'Close'
  onClose: () => void
}): JSX.Element {
  return (
    <Dialog
      title={title}
      body={message}
      onCancel={onClose}
      choices={[{ label: button, primary: true, onPick: onClose }]}
    />
  )
}
