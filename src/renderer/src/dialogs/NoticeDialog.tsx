import { useEffect, type JSX } from 'react'
import { Dialog } from '../components/Dialog'
import { logNote } from '../lib/noteLog'

/** The notice's text, which says itself to the diagnostics log as it is
 *  shown (owner, 2026-11-06: "make sure logs are always on so you can see
 *  what happened"), with the operation it came from. */
function LoggedNote({ text, op, title }: { text: string; op?: string; title: string }): JSX.Element {
  useEffect(() => {
    logNote(text, { op, title, level: 'error' })
  }, [text, op, title])
  return <>{text}</>
}

/** Something that did not work, said once, with one button that closes it:
 *  App's "That didn't work", the tree's paste and add-to-archive failures and
 *  the archive panel's notes. `op` names the operation for the log. */
export function NoticeDialog({
  title,
  message,
  button = 'OK',
  op,
  onClose
}: {
  title: string
  message: string
  button?: 'OK' | 'Close'
  op?: string
  onClose: () => void
}): JSX.Element {
  return (
    <Dialog
      title={title}
      body={<LoggedNote text={message} op={op} title={title} />}
      onCancel={onClose}
      choices={[{ label: button, primary: true, onPick: onClose }]}
    />
  )
}
