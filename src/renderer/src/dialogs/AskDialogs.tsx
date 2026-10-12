import type { JSX } from 'react'
import type { OnClash, OpenPayload } from '@shared/types'
import type { MoveOnClash } from '@shared/ipcTypes'
import type { Ask } from './asks'
import { CloseAgentDialog } from './CloseAgentDialog'
import { DeleteDialog } from './DeleteDialog'
import { DeleteManyDialog } from './DeleteManyDialog'
import { FileChangedDialog } from './FileChangedDialog'
import { MoveClashDialog } from './MoveClashDialog'
import { NameTakenDialog } from './NameTakenDialog'
import { NoticeDialog } from './NoticeDialog'
import { UnsavedDialog } from './UnsavedDialog'

/** What App does with each answer. Every dialog first clears the ask
 *  (`dismiss`) unless the answer below says otherwise. */
export interface AskAnswers {
  dismiss: () => void
  /** The unsaved files the window close names. */
  unsavedNames: readonly string[]
  runDelete: (path: string) => void
  runDeleteMany: (paths: string[]) => void
  runMove: (paths: string[], dest: string, mode: MoveOnClash) => void
  runRename: (path: string, name: string, onClash: OnClash) => void
  /** Closing the window or installing, once unsaved text is settled. */
  leave: (then?: 'install') => void
  /** Throws away every unsaved buffer (the window close's Discard). */
  discardAll: () => void
  saveAllThen: (then: () => void) => void
  discardTabBuffers: (id: string) => void
  forceCloseTab: (id: string) => void
  applyReroot: (id: string, payload: OpenPayload) => void
  answerReload: (path: string, reload: boolean) => void
  runInstall: () => void
}

/**
 * Two layers, so each question sits where it always sat in App's tree (the
 * dialogs are not portalled, and equal z-index stacks in DOM order): `under`
 * is drawn before the update window and the Explorer's own dialogs, `over`
 * after them.
 */
const OVER = new Set<Ask['kind']>(['close-tab', 'reroot', 'clash', 'failed'])

export function AskDialogs({
  ask,
  layer,
  answers: a
}: {
  ask: Ask | null
  layer: 'under' | 'over'
  answers: AskAnswers
}): JSX.Element | null {
  if (!ask || OVER.has(ask.kind) !== (layer === 'over')) return null
  switch (ask.kind) {
    case 'delete':
      return (
        <DeleteDialog name={ask.name} onCancel={a.dismiss} onDelete={() => a.runDelete(ask.path)} />
      )
    case 'delete-many':
      return (
        <DeleteManyDialog
          count={ask.paths.length}
          onCancel={a.dismiss}
          onDelete={() => a.runDeleteMany(ask.paths)}
        />
      )
    case 'move-clash':
      return (
        <MoveClashDialog
          names={ask.names}
          onCancel={a.dismiss}
          onKeepBoth={() => a.runMove(ask.paths, ask.dest, 'keep-both')}
          onReplace={() => a.runMove(ask.paths, ask.dest, 'replace')}
        />
      )
    case 'close-dirty':
      return (
        <UnsavedDialog
          names={a.unsavedNames}
          consequence={
            ask.then === 'install'
              ? 'Installing the update restarts Prism, and restarting without saving throws them away.'
              : 'Closing without saving throws them away.'
          }
          onCancel={a.dismiss}
          onDiscard={() => {
            a.discardAll()
            a.dismiss()
            a.leave(ask.then)
          }}
          // A failed write must not close the window over the top of the
          // text it failed to keep: we stay put and say which file.
          onSave={() => a.saveAllThen(() => a.leave(ask.then))}
        />
      )
    case 'file-changed': {
      const answer = (reload: boolean) => (): void => {
        a.answerReload(ask.path, reload)
        a.dismiss()
      }
      return <FileChangedDialog name={ask.name} onKeep={answer(false)} onReload={answer(true)} />
    }
    case 'close-tab-confirm':
    case 'close-window-agent':
      return (
        <CloseAgentDialog
          target={
            ask.kind === 'close-tab-confirm' ? 'tab' : ask.then === 'install' ? 'install' : 'window'
          }
          label={ask.label}
          agent={ask.agent}
          others={ask.kind === 'close-window-agent' ? ask.others : 0}
          onCancel={a.dismiss}
          onClose={() => {
            a.dismiss()
            if (ask.kind === 'close-tab-confirm') a.forceCloseTab(ask.id)
            else if (ask.then === 'install') a.runInstall()
            else window.prism.close(true)
          }}
        />
      )
    case 'close-tab':
      return (
        <UnsavedDialog
          names={ask.names}
          consequence="Closing this folder is the last way back to them."
          onCancel={a.dismiss}
          onDiscard={() => {
            a.discardTabBuffers(ask.id)
            a.dismiss()
            a.forceCloseTab(ask.id)
          }}
          onSave={() => a.saveAllThen(() => a.forceCloseTab(ask.id))}
        />
      )
    case 'reroot':
      return (
        <UnsavedDialog
          names={ask.names}
          consequence="Opening another folder here is the last way back to them."
          onCancel={a.dismiss}
          onDiscard={() => {
            a.discardTabBuffers(ask.id)
            a.dismiss()
            a.applyReroot(ask.id, ask.payload)
          }}
          onSave={() => a.saveAllThen(() => a.applyReroot(ask.id, ask.payload))}
        />
      )
    case 'clash':
      return (
        <NameTakenDialog
          name={ask.name}
          suggestion={ask.suggestion}
          onCancel={a.dismiss}
          onReplace={() => a.runRename(ask.path, ask.name, 'overwrite')}
          onKeepBoth={() => a.runRename(ask.path, ask.name, 'keep-both')}
        />
      )
    case 'failed':
      return <NoticeDialog title="That didn't work" message={ask.message} onClose={a.dismiss} />
  }
}
