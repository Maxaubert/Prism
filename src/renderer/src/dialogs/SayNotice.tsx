import type { JSX } from 'react'
import { noticeStore, SAY_TITLE } from '../lib/say'
import { NoticeDialog } from './NoticeDialog'

/** The notice `say(text, { kind: 'dialog' })` raises (#517): the one
 *  NoticeDialog, mounted once, in App. Already logged by `say`. */
export function SayNotice(): JSX.Element | null {
  const n = noticeStore.use()
  if (!n) return null
  return <NoticeDialog title={SAY_TITLE} message={n.text} op={n.op} logged onClose={() => noticeStore.set(null)} />
}