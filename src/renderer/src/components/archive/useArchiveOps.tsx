import { useCallback, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { placeOf } from '@shared/archivePlace'
import { archivePassword, rememberArchivePassword } from '../../lib/archivePass'
import { markLanded } from '../../lib/landMarks'
import type { UndoEntry } from '../../lib/undo'
import { ArchiveClashDialog } from '../../dialogs/ArchiveClashDialog'
import { ArchiveDeleteDialog } from '../../dialogs/ArchiveDeleteDialog'
import { NoticeDialog } from '../../dialogs/NoticeDialog'
import { PasswordDialog } from '../../dialogs/PasswordDialog'
import {
  addMembers,
  ARCHIVE_COPY,
  deleteMembers,
  copyBetweenZips,
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
  /** Real files into the zip; a taken name asks Keep both first. `move`
   *  bins the originals once they are in (#70: a plain drag on one drive);
   *  a copy leaves them. `base` is the zip as the Explorer spells it: what
   *  landed is marked there (#101). */
  addInto: (container: string, paths: string[], dest: string, move: boolean, base?: string) => void
  /** Members dragged to another folder of the same zip. A member from a
   *  different archive is refused, and so is a read-only one. A taken name
   *  asks Keep both (#70 D7); the move goes on the undo stack (D8) and lands
   *  marked when `base` is known. `after` runs once they have moved. */
  moveInside: (
    container: string,
    move: { from: string; entries: string[]; dest: string; readOnly?: boolean; base?: string },
    after?: () => void
  ) => void
  /** Members of ANOTHER zip copied into this one (#70 D9): out to temp,
   *  then added, the originals left in their zip. */
  copyBetween: (
    from: { container: string; entries: string[] },
    container: string,
    dest: string,
    base?: string
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
  /** A taken name, on the way in (an add) or inside the zip (a move). */
  const [clash, setClash] = useState<
    | {
        kind: 'add'
        container: string
        paths: string[]
        dest: string
        names: string[]
        move: boolean
        base?: string
        /** The add is over, however it ended (a staged copy drops its folder). */
        settled?: () => void
      }
    | {
        kind: 'move'
        container: string
        entries: string[]
        dest: string
        names: string[]
        base?: string
        after?: () => void
      }
    | null
  >(null)

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
      move: boolean,
      base?: string,
      settled?: () => void
    ): void => {
      void addMembers(window.prism, { container, paths, dest, keepBoth, move }).then((r) => {
        setClash(null)
        if (r.kind === 'clash')
          return setClash({ kind: 'add', container, paths, dest, names: r.names, move, base, settled })
        settled?.()
        if (r.kind === 'said') return setOops(r.message)
        if (r.undo) latest.current.noteUndo?.(r.undo)
        latest.current.refresh()
        // What landed is marked in the list showing it (#70, #101).
        if (base) markLanded(r.entries.map((e) => placeOf(base, e)))
      })
    },
    []
  )
  const addInto = useCallback(
    (container: string, paths: string[], dest: string, move: boolean, base?: string): void =>
      add(container, paths, dest, false, move, base),
    [add]
  )

  const runMoveInside = useCallback(
    (
      container: string,
      entries: string[],
      dest: string,
      keepBoth: boolean,
      base?: string,
      after?: () => void
    ): void => {
      void window.prism.archiveMoveMembers(container, entries, dest, keepBoth).then((r) => {
        setClash(null)
        if (r === 'encrypted' || r === 'failed')
          return setOops(r === 'encrypted' ? ARCHIVE_COPY.moveEncrypted : ARCHIVE_COPY.moveFailed)
        if (r.clashes.length)
          return setClash({ kind: 'move', container, entries, dest, names: r.clashes, base, after })
        if (!r.moved.length) return
        after?.()
        latest.current.noteUndo?.({ kind: 'archive-move', zip: container, base, items: r.moved })
        latest.current.refresh()
        if (base) markLanded(r.moved.map((m) => placeOf(base, m.to)))
      })
    },
    []
  )
  const moveInside = useCallback(
    (
      container: string,
      move: { from: string; entries: string[]; dest: string; readOnly?: boolean; base?: string },
      after?: () => void
    ): void => {
      if (move.from.toLowerCase() !== container.toLowerCase())
        return setOops(ARCHIVE_COPY.otherArchive)
      if (move.readOnly) return setOops(ARCHIVE_COPY.readOnly)
      runMoveInside(container, move.entries, move.dest, false, move.base, after)
    },
    [runMoveInside]
  )

  const copyBetween = useCallback(
    (from: { container: string; entries: string[] }, container: string, dest: string, base?: string): void =>
      withPassword(from.container, from.entries[0]?.split('/').pop() || 'archive', (pw) =>
        copyBetweenZips(
          window.prism,
          { ...from, password: pw },
          container,
          (paths) => new Promise<void>((settled) => add(container, paths, dest, false, false, base, settled))
        )
      ),
    [add, withPassword]
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
          onCancel={() => {
            if (clash.kind === 'add') clash.settled?.()
            setClash(null)
          }}
          onKeepBoth={() =>
            clash.kind === 'add'
              ? add(clash.container, clash.paths, clash.dest, true, clash.move, clash.base, clash.settled)
              : runMoveInside(clash.container, clash.entries, clash.dest, true, clash.base, clash.after)
          }
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
    copyBetween,
    askDelete,
    rename,
    say: setOops,
    open: !!(oops || askPass || confirm || clash),
    dialogs
  }
}
