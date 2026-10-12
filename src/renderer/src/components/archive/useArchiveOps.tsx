import { useCallback, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { archivePassword, rememberArchivePassword } from '../../lib/archivePass'
import type { UndoEntry } from '../../lib/undo'
import { ArchiveClashDialog } from '../../dialogs/ArchiveClashDialog'
import { ArchiveDeleteDialog } from '../../dialogs/ArchiveDeleteDialog'
import { NoticeDialog } from '../../dialogs/NoticeDialog'
import { PasswordDialog } from '../../dialogs/PasswordDialog'
import {
  addMembers,
  ARCHIVE_COPY,
  deleteMembers,
  renameMember,
  runWithPassword,
  type ArchiveFail,
  type PassQuestion
} from './archiveOps'

export interface ArchiveOpsDeps {
  /** The place on screen changed under Prism's own write. */
  refresh: () => void
  /** A move IN happened; the host keeps the undo stack. */
  noteUndo?: (entry: UndoEntry) => void
}

export interface ArchiveOps {
  /** Run with the archive's remembered password, asking when it is wanted. */
  withPassword: (
    container: string,
    name: string,
    run: (pw: string | undefined) => Promise<ArchiveFail | 'ok'>
  ) => void
  /** Members out to a real folder: `dest`, or where main's dialog says when
   *  it is null (the dialog is the consent that lets it write anywhere).
   *  The extraction window is main's (#166): it shows progress and any
   *  error, so only a password is left to answer here, which is why the
   *  call says `asksPassword` (the window then closes quietly on a wrong one
   *  instead of putting an error up underneath the question). */
  extract: (
    container: string,
    inners: string[],
    name: string,
    dest: string | null,
    onDone?: () => void
  ) => void
  /** Real files into the zip; a taken name asks Keep both first. */
  addInto: (container: string, paths: string[], dest: string, fromPrism: boolean) => void
  /** Members dragged to another folder of the same zip. A member from a
   *  different archive is refused, and so is a read-only one. `after` runs
   *  once they have moved. */
  moveInside: (
    container: string,
    move: { from: string; entries: string[]; dest: string; readOnly?: boolean },
    after?: () => void
  ) => void
  /** Ask, then delete members for good. `after` runs once they are gone. */
  askDelete: (container: string, inners: string[], names: string[], after?: () => void) => void
  /** Rename one member (file members only; the caller checks). */
  rename: (container: string, inner: string, from: string, to: string) => void
  /** Say something in the archive's message box. */
  say: (message: string) => void
  /** One of the questions is up, so a key behind it is not the panel's. */
  open: boolean
  dialogs: JSX.Element
}

/**
 * The questions the archive verbs raise, held once for both hosts: the
 * password, the taken name on the way in, the permanent delete ("a zip has no
 * Recycle Bin") and the message box. The verbs themselves are archiveOps.ts.
 */
export function useArchiveOps(deps: ArchiveOpsDeps): ArchiveOps {
  const latest = useRef(deps)
  useLayoutEffect(() => {
    latest.current = deps
  })
  const [oops, setOops] = useState<string | null>(null)
  const [askPass, setAskPass] = useState<PassQuestion | null>(null)
  const [confirm, setConfirm] = useState<{
    container: string
    inners: string[]
    names: string[]
    after?: () => void
  } | null>(null)
  const [clash, setClash] = useState<{
    container: string
    paths: string[]
    dest: string
    names: string[]
    fromPrism: boolean
  } | null>(null)

  const withPassword = useCallback(
    (
      container: string,
      name: string,
      run: (pw: string | undefined) => Promise<ArchiveFail | 'ok'>
    ): void =>
      runWithPassword({
        name,
        run,
        remembered: archivePassword(container),
        remember: (pw) => rememberArchivePassword(container, pw),
        ask: (q) =>
          setAskPass({
            ...q,
            run: (answer) => {
              setAskPass(null)
              q.run(answer)
            }
          }),
        say: setOops
      }),
    []
  )

  const extractMembers = useCallback(
    (
      container: string,
      inners: string[],
      name: string,
      dest: string | null,
      onDone?: () => void
    ): void =>
      withPassword(container, name, (pw) =>
        (dest !== null
          ? window.prism.archiveExtractTo(container, inners, dest, pw, true)
          : window.prism.archiveExtractMembersTo(container, inners, pw)
        ).then((r) => {
          if (r.ok) onDone?.()
          return !r.ok && r.reason === 'password' ? 'password' : 'ok'
        })
      ),
    [withPassword]
  )

  const add = useCallback(
    (
      container: string,
      paths: string[],
      dest: string,
      keepBoth: boolean,
      fromPrism: boolean
    ): void => {
      void addMembers(window.prism, { container, paths, dest, keepBoth, fromPrism }).then((r) => {
        setClash(null)
        if (r.kind === 'said') return setOops(r.message)
        if (r.kind === 'clash')
          return setClash({ container, paths, dest, names: r.names, fromPrism })
        if (r.undo) latest.current.noteUndo?.(r.undo)
        latest.current.refresh()
      })
    },
    []
  )
  const addInto = useCallback(
    (container: string, paths: string[], dest: string, fromPrism: boolean): void =>
      add(container, paths, dest, false, fromPrism),
    [add]
  )

  const moveInside = useCallback(
    (
      container: string,
      move: { from: string; entries: string[]; dest: string; readOnly?: boolean },
      after?: () => void
    ): void => {
      if (move.from.toLowerCase() !== container.toLowerCase())
        return setOops(ARCHIVE_COPY.otherArchive)
      if (move.readOnly) return setOops(ARCHIVE_COPY.readOnly)
      void window.prism.archiveMoveMembers(container, move.entries, move.dest).then((r) => {
        if (r === 'ok') {
          after?.()
          latest.current.refresh()
        } else setOops(r === 'encrypted' ? ARCHIVE_COPY.moveEncrypted : ARCHIVE_COPY.moveFailed)
      })
    },
    []
  )

  const askDelete = useCallback(
    (container: string, inners: string[], names: string[], after?: () => void): void => {
      if (inners.length) setConfirm({ container, inners, names, after })
    },
    []
  )

  const rename = useCallback(
    (container: string, inner: string, from: string, to: string): void => {
      if (!to || to === from) return
      withPassword(container, from, (pw) =>
        renameMember(
          window.prism,
          { container, inner, name: to, pw },
          () => latest.current.refresh(),
          setOops
        )
      )
    },
    [withPassword]
  )

  const dialogs = (
    <>
      {askPass && (
        <PasswordDialog
          name={askPass.name}
          wrong={askPass.wrong}
          onSubmit={askPass.run}
          onCancel={() => setAskPass(null)}
        />
      )}
      {confirm && (
        <ArchiveDeleteDialog
          names={confirm.names}
          count={confirm.inners.length}
          onCancel={() => setConfirm(null)}
          onDelete={() => {
            const { container, inners, names, after } = confirm
            setConfirm(null)
            void deleteMembers(window.prism, container, inners, names).then((said) => {
              after?.()
              latest.current.refresh()
              if (said) setOops(said)
            })
          }}
        />
      )}
      {clash && (
        <ArchiveClashDialog
          names={clash.names}
          onCancel={() => setClash(null)}
          onKeepBoth={() => add(clash.container, clash.paths, clash.dest, true, clash.fromPrism)}
        />
      )}
      {oops && <NoticeDialog title="Archive" message={oops} onClose={() => setOops(null)} />}
    </>
  )

  return {
    withPassword,
    extract: extractMembers,
    addInto,
    moveInside,
    askDelete,
    rename,
    say: setOops,
    open: !!(oops || askPass || confirm || clash),
    dialogs
  }
}
