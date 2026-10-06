import { useCallback, useLayoutEffect, useRef, useState, type JSX } from 'react'
import type { ArchiveMeta, ViewerFile } from '@shared/types'
import { memberOf } from '@shared/archivePlace'
import { archiveMenuRows, type ArchiveRow, type ArchiveRowId } from '../../lib/archiveMenus'
import { archivePassword, rememberArchivePassword } from '../../lib/archivePass'
import { copyFilePaths } from '../../lib/fileClipboard'
import { clipboardText } from '../../lib/clipboardText'
import type { DragPayload } from '../../lib/dragDrop'
import { formatBytes, formatWhen, savedPercent } from '../../lib/format'
import type { UndoEntry } from '../../lib/undo'
import type { MenuItem } from '../ContextMenu'
import { Dialog } from '../Dialog'
import { FileMenuIcon, type FileMenuIconName } from '../FileMenuIcon'
import { PasswordDialog } from '../PasswordDialog'
import { BrowseRename } from './BrowseRename'
import type { BrowseEntry } from './types'


type Fail = 'password' | 'aes' | 'failed'

const ICONS: Record<ArchiveRowId, FileMenuIconName> = {
  open: 'open',
  'open-new-tab': 'new-tab',
  'extract-here': 'extract',
  'extract-to': 'extract',
  'add-files': 'add-files',
  copy: 'copy',
  'copy-path': 'path',
  rename: 'rename',
  delete: 'delete',
  show: 'folder',
  properties: 'properties'
}

const dirOf = (p: string): string => p.replace(/[\\/][^\\/]*$/, '')
const nameOf = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p

export interface ArchiveActionDeps {
  navigate: (path: string) => void
  openNewTab: (path: string, isFolder: boolean) => void
  /** A member opened full view, the way Enter opens it. */
  openMember: (file: ViewerFile) => void
  /** The place on screen changed under Prism's own write. */
  refresh: () => void
  noteUndo: (entry: UndoEntry) => void
  /** The rows an archive's own row OUTSIDE it shares with every file. */
  outside: {
    copy: (entry: BrowseEntry) => void
    rename: (entry: BrowseEntry) => void
    remove: (entry: BrowseEntry) => void
    properties: (entry: BrowseEntry) => void
    show: (path: string) => void
    copyPath: (path: string) => void
  }
}

/**
 * WHAT A PLACE INSIDE AN ARCHIVE DOES (#300). The rows come from
 * `archiveMenuRows`; this wires each to the archive verbs main already has
 * (extract, extract to, add, rename, delete, copy out) and holds the questions
 * they raise: the password, the permanent delete ("a zip has no Recycle Bin"),
 * a taken name on the way in, a rename. Nothing here is new to main except the
 * place's own `ArchiveMeta`, which names the container and the member.
 */
export function useArchiveActions(deps: ArchiveActionDeps): {
  menu: (
    target: { entry: BrowseEntry | null; paths?: string[] },
    meta: ArchiveMeta | null,
    directory: string,
    /** What Open does where the menu is: the project tree expands a folder
     *  and opens a file there, rather than walking the Explorer. */
    open?: (entry: BrowseEntry) => void
  ) => MenuItem[] | null
  rename: (entry: BrowseEntry, meta: ArchiveMeta) => void
  remove: (paths: string[], meta: ArchiveMeta) => void
  copy: (paths: string[], meta: ArchiveMeta, folders: ReadonlySet<string>) => void
  extractWhole: (meta: ArchiveMeta, here: boolean, rows: string[]) => void
  drop: (dest: string, payload: DragPayload, meta: ArchiveMeta) => void
  done: boolean
  dialogs: JSX.Element
} {
  const latest = useRef(deps)
  useLayoutEffect(() => {
    latest.current = deps
  })
  const [oops, setOops] = useState<string | null>(null)
  const [askPass, setAskPass] = useState<{ name: string; wrong: boolean; run: (pw: string) => void } | null>(null)
  const [confirm, setConfirm] = useState<{ meta: ArchiveMeta; inners: string[]; names: string[] } | null>(null)
  const [clash, setClash] = useState<{
    meta: ArchiveMeta
    paths: string[]
    dest: string
    names: string[]
    fromPrism: boolean
  } | null>(null)
  const [renaming, setRenaming] = useState<{ meta: ArchiveMeta; inner: string; name: string } | null>(null)
  const [facts, setFacts] = useState<{ name: string; lines: Array<[string, string]> } | null>(null)
  const [done, setDone] = useState(false)
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashDone = (): void => {
    setDone(true)
    if (doneTimer.current) clearTimeout(doneTimer.current)
    doneTimer.current = setTimeout(() => setDone(false), 2000)
  }

  /** Run with the remembered password; on 'password' ask, and again when it
   *  was wrong. */
  const withPassword = useCallback(
    (container: string, name: string, run: (pw: string | undefined) => Promise<Fail | 'ok'>): void => {
      const attempt = (pw: string | undefined, wrong: boolean): void => {
        void run(pw).then((r) => {
          if (r === 'ok') {
            if (pw) rememberArchivePassword(container, pw)
            return
          }
          if (r === 'password')
            setAskPass({
              name,
              wrong,
              run: (answer) => {
                setAskPass(null)
                attempt(answer, true)
              }
            })
          else if (r === 'aes')
            setOops(`"${name}" is AES-encrypted, and the 7-Zip that opens those is missing from this install.`)
          else setOops(`Couldn't read "${name}" from the archive.`)
        })
      }
      attempt(archivePassword(container), false)
    },
    []
  )

  const inners = (meta: ArchiveMeta, paths: string[]): string[] =>
    paths.map((p) => memberOf(meta, p)).filter((p): p is string => !!p)

  /** Members beside the OUTERMOST archive, or where main's dialog says. */
  const extract = useCallback(
    (meta: ArchiveMeta, paths: string[], here: boolean, folders: ReadonlySet<string>): void => {
      const list = inners(meta, paths)
      if (!list.length) return
      const name = nameOf(paths[0])
      // A single folder of a zip on disk: staged beside it and renamed into
      // place, never merged into a folder already there (#166's route).
      if (here && !meta.nested && list.length === 1 && folders.has(paths[0])) {
        void window.prism.archiveExtractDir(meta.container, list[0], true).then((r) => {
          if (r.ok) flashDone()
        })
        return
      }
      withPassword(meta.container, name, (pw) =>
        (here
          ? window.prism.archiveExtractTo(meta.container, list, dirOf(meta.outer), pw, true)
          : window.prism.archiveExtractMembersTo(meta.container, list, pw)
        ).then((r) => {
          if (r.ok && here) flashDone()
          return !r.ok && r.reason === 'password' ? 'password' : 'ok'
        })
      )
    },
    [withPassword]
  )

  /** The whole archive: the strip's pair. A nested one is a temp copy, so its
   *  current folder's rows go out beside the outermost zip instead. */
  const extractWhole = useCallback(
    (meta: ArchiveMeta, here: boolean, rows: string[]): void => {
      if (!meta.nested && !meta.inner) {
        void window.prism.archiveExtractAll(meta.container, here).then((r) => {
          if (r.ok && here) flashDone()
        })
        return
      }
      extract(meta, rows, here, new Set())
    },
    [extract]
  )

  const copy = useCallback(
    (paths: string[], meta: ArchiveMeta, folders: ReadonlySet<string>): void => {
      void (async () => {
        const out: string[] = []
        let locked = 0
        for (const p of paths) {
          if (folders.has(p)) {
            const inner = memberOf(meta, p)
            if (!inner) continue
            const r = await window.prism.archiveExtractDir(meta.container, inner)
            if (r.ok) out.push(r.path)
            else if (r.reason === 'password' || r.reason === 'aes') locked += 1
          } else {
            const r = await window.prism.archiveMember(p, archivePassword(meta.container), true)
            if (r.ok) out.push(r.path)
            else if (r.reason === 'password' || r.reason === 'aes') locked += 1
          }
        }
        if (out.length) void copyFilePaths(out)
        if (locked)
          setOops(
            `${locked} of those ${locked === 1 ? 'is' : 'are'} password protected. Open one first to unlock the archive, then copy again.`
          )
      })()
    },
    []
  )

  const rename = useCallback((entry: BrowseEntry, meta: ArchiveMeta): void => {
    const inner = memberOf(meta, entry.path)
    // A folder inside a zip is not renamed: `renameMember` is file-only, a
    // decision recorded 2026-08-30 (the spec's Decision 5).
    if (!inner || entry.isFolder || meta.readOnly) return
    setRenaming({ meta, inner, name: entry.name })
  }, [])

  const remove = useCallback((paths: string[], meta: ArchiveMeta): void => {
    if (meta.readOnly) return
    const list = inners(meta, paths)
    if (list.length) setConfirm({ meta, inners: list, names: paths.map(nameOf) })
  }, [])

  const addInto = useCallback(
    (meta: ArchiveMeta, paths: string[], dest: string, keepBoth: boolean, fromPrism: boolean): void => {
      void window.prism.archiveAdd(meta.container, paths, dest, keepBoth).then(async (r) => {
        setClash(null)
        if (r === 'encrypted') return setOops("Prism can't add to a password-protected archive.")
        if (r === 'failed') return setOops("Those couldn't be added to the archive.")
        if (r.clashes.length) return setClash({ meta, paths, dest, names: r.clashes, fromPrism })
        // A drag of Prism's own rows is a MOVE (owner, 2026-08-22): once the
        // members are safely in, the originals go to the Recycle Bin, and
        // Ctrl+Z takes both halves back. Files from Windows are left alone.
        if (fromPrism && r.added.length) {
          const originals: string[] = []
          for (const a of r.added) if (await window.prism.trashFile(a.src)) originals.push(a.src)
          latest.current.noteUndo({
            kind: 'archive-in',
            zip: meta.container,
            dest,
            entries: r.added.map((a) => a.entry),
            originals
          })
        }
        latest.current.refresh()
      })
    },
    []
  )

  const addFiles = useCallback(
    (meta: ArchiveMeta, dest: string): void => {
      void window.prism.pickFiles().then((paths) => {
        if (paths.length) addInto(meta, paths, dest, false, false)
      })
    },
    [addInto]
  )

  const drop = useCallback(
    (dest: string, payload: DragPayload, meta: ArchiveMeta): void => {
      const inner = memberOf(meta, dest) ?? ''
      if (payload.kind === 'members') {
        if (payload.archive.toLowerCase() !== meta.container.toLowerCase())
          return setOops('That came from another archive. Extract it first, then add it here.')
        if (meta.readOnly) return setOops("This archive can't be changed. Extract it to make changes.")
        void window.prism.archiveMoveMembers(meta.container, payload.entries, inner).then((r) => {
          if (r === 'ok') latest.current.refresh()
          else
            setOops(
              r === 'encrypted'
                ? "Prism can't rearrange a password-protected archive."
                : "Those couldn't be moved inside the archive. A name may be taken."
            )
        })
        return
      }
      if (meta.readOnly) return setOops("This archive can't be changed. Extract it to make changes.")
      addInto(meta, payload.paths, inner, false, !payload.external)
    },
    [addInto]
  )

  const memberFacts = (entry: BrowseEntry, meta: ArchiveMeta): void => {
    const lines: Array<[string, string]> = [['In', meta.display]]
    if (entry.isFolder) {
      lines.push(['Size', formatBytes(entry.folderSize?.bytes ?? 0)])
      lines.push(['Items', String(entry.folderSize?.files ?? 0)])
    } else if (entry.file) {
      const f = entry.file
      lines.push(['Size', formatBytes(f.size ?? 0)])
      if (f.packed !== undefined) lines.push(['Packed', formatBytes(f.packed)])
      const saved = savedPercent(f.size ?? 0, f.packed)
      if (saved) lines.push(['Saving', saved])
      if (f.mtimeMs) lines.push(['Modified', formatWhen(f.mtimeMs)])
      lines.push(['Encrypted', f.encrypted ? 'Yes' : 'No'])
    }
    setFacts({ name: entry.name, lines })
  }

  const menu = useCallback(
    (
      target: { entry: BrowseEntry | null; paths?: string[] },
      meta: ArchiveMeta | null,
      directory: string,
      open?: (entry: BrowseEntry) => void
    ): MenuItem[] | null => {
      const { entry } = target
      const item = (row: ArchiveRow, onPick: () => void): MenuItem => ({
        label: row.label,
        hint: row.hint,
        danger: row.danger,
        icon: <FileMenuIcon name={ICONS[row.id]} />,
        onPick
      })
      // An archive's own row OUTSIDE it (mockup 02).
      if (!meta) {
        if (!entry?.file || entry.file.kind !== 'archive' || entry.file.member) return null
        const path = entry.path
        return archiveMenuRows({ kind: 'outside', writable: true }).map((row) =>
          item(row, () => {
            switch (row.id) {
              case 'open':
                return latest.current.navigate(path)
              case 'open-new-tab':
                return latest.current.openNewTab(path, true)
              case 'extract-here':
                return void window.prism.archiveExtractAll(path, true)
              case 'extract-to':
                return void window.prism.archiveExtractAll(path, false)
              case 'add-files':
                return void window.prism.pickFiles().then((paths) => {
                  if (!paths.length) return
                  void window.prism.archiveAdd(path, paths, '', true).then((r) => {
                    if (r === 'encrypted') setOops("Prism can't add to a password-protected archive.")
                    else if (r === 'failed') setOops("Those couldn't be added to the archive.")
                    else latest.current.refresh()
                  })
                })
              case 'copy':
                return latest.current.outside.copy(entry)
              case 'copy-path':
                return latest.current.outside.copyPath(path)
              case 'rename':
                return latest.current.outside.rename(entry)
              case 'delete':
                return latest.current.outside.remove(entry)
              case 'show':
                return latest.current.outside.show(path)
              case 'properties':
                return latest.current.outside.properties(entry)
            }
          })
        )
      }
      const zip = meta.display
      const writable = !meta.readOnly
      const show = (): void => latest.current.outside.show(meta.outer)
      if (!entry) {
        return archiveMenuRows({ kind: 'empty', writable, zip }).map((row) =>
          item(row, () => {
            switch (row.id) {
              case 'extract-here':
                return extractWhole(meta, true, [])
              case 'extract-to':
                return extractWhole(meta, false, [])
              case 'add-files':
                return addFiles(meta, memberOf(meta, directory) ?? '')
              case 'show':
                return show()
              case 'copy-path':
                return void clipboardText(directory)
            }
          })
        )
      }
      const paths = target.paths && target.paths.length > 1 ? target.paths : null
      const folders = new Set(entry.isFolder ? [entry.path] : [])
      if (paths) {
        return archiveMenuRows({ kind: 'many', writable, count: paths.length, zip }).map((row) =>
          item(row, () => {
            switch (row.id) {
              case 'copy':
                return copy(paths, meta, folders)
              case 'extract-here':
                return extract(meta, paths, true, folders)
              case 'extract-to':
                return extract(meta, paths, false, folders)
              case 'delete':
                return remove(paths, meta)
            }
          })
        )
      }
      const kind = entry.isFolder ? 'folder' : 'file'
      return archiveMenuRows({ kind, writable, zip }).map((row) =>
        item(row, () => {
          switch (row.id) {
            case 'open':
              if (open) return open(entry)
              // A folder, or an archive inside the archive: both are gone into.
              if (entry.isFolder || entry.file?.kind === 'archive') return latest.current.navigate(entry.path)
              return entry.file ? latest.current.openMember(entry.file) : undefined
            case 'open-new-tab':
              return latest.current.openNewTab(entry.path, true)
            case 'extract-here':
              return extract(meta, [entry.path], true, folders)
            case 'extract-to':
              return extract(meta, [entry.path], false, folders)
            case 'add-files':
              return addFiles(meta, memberOf(meta, entry.path) ?? '')
            case 'copy':
              return copy([entry.path], meta, folders)
            case 'rename':
              return rename(entry, meta)
            case 'delete':
              return remove([entry.path], meta)
            case 'show':
              return show()
            case 'properties':
              return memberFacts(entry, meta)
          }
        })
      )
    },
    [addFiles, copy, extract, extractWhole, remove, rename]
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
        <Dialog
          title={
            confirm.inners.length > 1
              ? `Delete ${confirm.inners.length} items from the archive?`
              : `Delete "${confirm.names[0]}" from the archive?`
          }
          body="This is permanent: a zip has no Recycle Bin to take it back from."
          onCancel={() => setConfirm(null)}
          choices={[
            { label: 'Cancel', onPick: () => setConfirm(null), primary: true },
            {
              label: 'Delete',
              danger: true,
              onPick: () => {
                const { meta, inners: list } = confirm
                setConfirm(null)
                void (async () => {
                  let failed = 0
                  for (const p of list) if (!(await window.prism.archiveDelete(meta.container, p))) failed += 1
                  latest.current.refresh()
                  if (failed) setOops(`${failed} of ${list.length} couldn't be deleted from the archive.`)
                })()
              }
            }
          ]}
        />
      )}
      {clash && (
        <Dialog
          title={
            clash.names.length > 1
              ? `${clash.names.length} names are already in the archive`
              : `"${clash.names[0]}" is already in the archive`
          }
          body="Keep both adds them beside what is there. Nothing has been written yet."
          onCancel={() => setClash(null)}
          choices={[
            { label: 'Cancel', onPick: () => setClash(null) },
            {
              label: 'Keep both',
              primary: true,
              onPick: () => addInto(clash.meta, clash.paths, clash.dest, true, clash.fromPrism)
            }
          ]}
        />
      )}
      {renaming && (
        <BrowseRename
          name={renaming.name}
          onCancel={() => setRenaming(null)}
          onSave={(name) => {
            const { meta, inner } = renaming
            setRenaming(null)
            if (!name || name === renaming.name) return
            withPassword(meta.container, renaming.name, (pw) =>
              window.prism.archiveRename(meta.container, inner, name, pw).then((r) => {
                if (r === 'ok') {
                  latest.current.refresh()
                  return 'ok'
                }
                if (r === 'failed') {
                  setOops(`Couldn't rename to "${name}". The name may be taken or invalid.`)
                  return 'ok'
                }
                return r
              })
            )
          }}
        />
      )}
      {facts && (
        <Dialog
          title={facts.name}
          body={
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1">
              {facts.lines.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-[var(--p-dim)]">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          }
          onCancel={() => setFacts(null)}
          choices={[{ label: 'OK', primary: true, onPick: () => setFacts(null) }]}
        />
      )}
      {oops && (
        <Dialog
          title="Archive"
          body={oops}
          onCancel={() => setOops(null)}
          choices={[{ label: 'OK', primary: true, onPick: () => setOops(null) }]}
        />
      )}
    </>
  )

  return { menu, rename, remove, copy, extractWhole, drop, done, dialogs }
}
