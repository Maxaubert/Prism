import { useEffect, type JSX } from 'react'
import { closeOnly, Dialog } from '../components/Dialog'
import { logSaid } from '../lib/sayCore'

/** The notice's text, which says itself to the diagnostics log as it is
 *  shown (owner, 2026-11-06: "make sure logs are always on so you can see
 *  what happened"), with the operation it came from. */
function LoggedNote({ text, op, title, logged }: { text: string; op?: string; title: string; logged?: boolean }): JSX.Element {
  useEffect(() => {
    if (!logged) logSaid(text, { op, title, level: 'error' })
  }, [text, op, title, logged])
  return <>{text}</>
}

/** Something that did not work, said once, with one Close button (#520):
 *  App's "That didn't work", the tree's paste and add-to-archive failures and
 *  the archive panel's notes. `op` names the operation for the log. */
export function NoticeDialog({
  title,
  message,
  op,
  logged,
  onClose
}: {
  title: string
  message: string
  op?: string
  /** say() wrote the log line already: do not write a second. */
  logged?: boolean
  onClose: () => void
}): JSX.Element {
  return (
    <Dialog
      title={title}
      body={<LoggedNote text={message} op={op} title={title} logged={logged} />}
      onCancel={onClose}
      choices={closeOnly(onClose)}
    />
  )
}
