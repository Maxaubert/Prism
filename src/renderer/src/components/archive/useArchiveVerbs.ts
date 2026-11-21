import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { FileKind } from '@shared/types'
import { baseName, parentDir } from '@shared/path'
import { copyFilePaths } from '../../lib/fileClipboard'
import { archivePassword } from '../../lib/archivePass'
import { emptySelection, type Selection } from '../../lib/selection'
import { extractAll as extractArchive } from '../../lib/extractAll'
import type { Entry } from './entry'
import type { ArchiveOps } from './useArchiveOps'

// THE ARCHIVE PANEL'S VERBS (out of ArchiveView.tsx, audit #31, unchanged):
// view, copy out, extract, rename, delete and add, each one a call into
// useArchiveOps or main. The panel keeps the state they touch and hands the
// setters in.

export type OpenMember = { name: string; path: string; kind: FileKind }

export function useArchiveVerbs({
  path,
  cwd,
  rows,
  ops,
  setSel,
  setBusy,
  setJustDone,
  setOpening,
  setMember,
  setEditing
}: {
  /** The archive's own path. */
  path: string
  cwd: string
  /** The rows of the folder being looked at. */
  rows: Entry[]
  ops: ArchiveOps
  setSel: Dispatch<SetStateAction<Selection>>
  setBusy: (b: 'copy' | 'add' | null) => void
  setJustDone: (done: boolean) => void
  setOpening: (name: string | null) => void
  setMember: (m: OpenMember | null) => void
  setEditing: (path: string | null) => void
}): {
  view: (entry: Entry) => void
  extractMembers: (entry: Entry, entries: string[], here: boolean) => void
  copyOut: (entry: Entry) => void
  submitRename: (entry: Entry, name: string) => void
  setConfirmDel: (entry: Entry) => void
  setConfirmDelMany: (paths: string[]) => void
  copyMany: (paths: string[]) => void
  copyFolder: (entry: string) => void
  extractFolderHere: (entry: string) => void
  extractAll: (here?: boolean) => void
  addFiles: () => void
} {
  const {
    withPassword: runWithPass,
    extract: extractOut,
    rename: renameIn,
    askDelete,
    addInto: addIn,
    say: setOops
  } = ops

  /** One member out of the container (asking the password when it is wanted);
   *  `onOk` gets the extracted path. */
  const extractMember = useCallback(
    (entry: Entry, onOk: (outPath: string, kind: FileKind) => void, onDone?: () => void): void =>
      runWithPass(path, entry.name, (pw) =>
        window.prism.archiveExtract(path, entry.path, pw).then((r) => {
          onDone?.()
          if (r.ok) {
            onOk(r.path, r.kind)
            return 'ok'
          }
          return r.reason
        })
      ),
    [path, runWithPass]
  )

  const view = useCallback(
    (entry: Entry): void => {
      setOpening(entry.name)
      extractMember(
        entry,
        (outPath, kind) => setMember({ name: entry.name, path: outPath, kind }),
        () => setOpening(null)
      )
    },
    [extractMember, setOpening, setMember]
  )
  /** The archive's own folder: where "Extract here" lands a member. */
  const besideArchive = parentDir(path)
  /** Members OUT to a real folder (2026-09-03, owner: "Extract here" and
   *  "Extract to..." on a member row, file or folder alike). `here` lands
   *  beside the archive, inside the root; otherwise main's dialog picks,
   *  which is the consent that lets it write anywhere. The extraction
   *  window and the password question are useArchiveOps' (#166). */
  const extractMembers = useCallback(
    (entry: Entry, entries: string[], here: boolean): void =>
      extractOut(path, entries, entry.name, here ? besideArchive : null),
    [path, besideArchive, extractOut]
  )

  const copyOut = useCallback(
    (entry: Entry): void => extractMember(entry, (outPath) => void copyFilePaths([outPath])),
    [extractMember]
  )
  const submitRename = useCallback(
    (entry: Entry, name: string): void => {
      setEditing(null)
      renameIn(path, entry.path, entry.name, name)
    },
    [path, renameIn, setEditing]
  )
  /** Asks before deleting one member. */
  const setConfirmDel = useCallback(
    (entry: Entry): void => askDelete(path, [entry.path], [entry.name]),
    [path, askDelete]
  )
  /** Asks before deleting several; the marks go with them. */
  const setConfirmDelMany = useCallback(
    (paths: string[]): void =>
      askDelete(path, paths, paths.map(baseName), () => setSel(emptySelection)),
    [path, askDelete, setSel]
  )

  /** Copy every selected FILE out at once; folders don't extract. */
  const copyMany = useCallback(
    (paths: string[]): void => {
      const files = paths.filter((p) => rows.find((r) => r.path === p && !r.dir))
      void (async () => {
        const out: string[] = []
        let locked = 0
        for (const p of files) {
          const r = await window.prism.archiveExtract(path, p, archivePassword(path))
          if (r.ok) out.push(r.path)
          else if (r.reason === 'password' || r.reason === 'aes') locked += 1
        }
        if (out.length) void copyFilePaths(out)
        if (locked)
          setOops(
            `${locked} of the selected members are password protected. Open one first to unlock the archive, then copy again.`
          )
      })()
    },
    [path, rows, setOops]
  )
  /**
   * Copy a FOLDER out as a folder.
   *
   * `copyMany` extracts each member on its own and puts the loose files on
   * the clipboard, which is right for a multi-selection of files and wrong
   * for a folder: you right-clicked one thing and got a flat pile of what was
   * inside it. Main extracts the whole subtree to one temp directory with its
   * shape intact, and that directory is what goes on the clipboard.
   */
  const copyFolder = useCallback(
    (entry: string): void => {
      setBusy('copy')
      void window.prism.archiveExtractDir(path, entry).then((r) => {
        setBusy(null)
        if (r.ok) void copyFilePaths([r.path])
        else if (r.reason === 'password' || r.reason === 'aes')
          setOops(
            'That folder is password protected. Open a member first to unlock the archive, then copy again.'
          )
        else
          setOops(
            r.message
              ? `That folder couldn't be copied. ${r.message}`
              : "That folder couldn't be copied."
          )
      })
    },
    [path, setOops, setBusy]
  )
  /** One folder from inside the archive, out beside the archive itself.
   *  The window, its progress and its error are all main's (#166). */
  const extractFolderHere = useCallback(
    (entry: string): void => {
      void window.prism.archiveExtractDir(path, entry, true).then((r) => {
        if (r.ok) setJustDone(true)
      })
    },
    [path, setJustDone]
  )

  /** Extract the whole thing. Main asks where (its dialog IS the consent, and
   *  is why the destination need not be inside a Prism root), and puts the
   *  contents in a folder named after the archive. */
  const extractAll = useCallback(
    (here = false): void => {
      // THE EXTRACTION WINDOW (2026-09-19, #166), superseding the chip this
      // ran on since 2026-09-03 and the "Extracting..." the button used to
      // read. Owner: "I would like it to just be one kind of view that
      // appears, and I want it to be a pop-up window that you can't close,
      // kind of like it is with WinRAR." Main opens it once its own folder
      // dialog is answered, feeds it, and turns it into the error when there
      // is one (7-Zip's own line included), so every route looks the same
      // because no route draws anything.
      void extractArchive(path, here).then((r) => {
        if (r.ok) setJustDone(true)
      })
    },
    [path, setJustDone]
  )

  /** Add real files to the folder you are looking at. zip only: the 7-Zip
   *  containers are read-only, and their button is not offered. */
  const addFiles = useCallback((): void => {
    setBusy('add')
    void window.prism.pickFiles().then((paths) => {
      setBusy(null)
      if (paths.length) addIn(path, paths, cwd, false)
    })
  }, [addIn, path, cwd, setBusy])

  return {
    view,
    extractMembers,
    copyOut,
    submitRename,
    setConfirmDel,
    setConfirmDelMany,
    copyMany,
    copyFolder,
    extractFolderHere,
    extractAll,
    addFiles
  }
}
