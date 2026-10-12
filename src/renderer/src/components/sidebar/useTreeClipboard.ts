import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { useFileCut, copyFilePaths } from '../../lib/fileClipboard'
import { updateJob } from '../../lib/jobs'
import { type PasteResult, useFilePaste, PASTE_MESSAGES } from '../../lib/useFilePaste'
import { parentDir, baseName } from '@shared/path'
import { FIELD, EDITOR, OVERLAY } from '../../lib/focusGuards'
import type { Selection } from '../../lib/selection'
import type { TreeState } from '../../lib/tabs'
import type { PaintRow } from '../../lib/treePaint'

// THE TREE'S CLIPBOARD AND DELETE KEYS (out of Sidebar.tsx, structure cleanup
// 2026-10-12, unchanged): Ctrl+C / X / V and Delete in the panel, the cut
// mark, paste and what it selects after, and which rows a delete key bins.

export interface TreeClipboardDeps {
  setDroppedOn: Dispatch<SetStateAction<string[] | null>>
  setSel: Dispatch<SetStateAction<Selection>>
  setCursor: Dispatch<SetStateAction<string | null>>
  showRow: (
    path: string,
    opts?: { smooth?: boolean | undefined; focus?: boolean | undefined }
  ) => boolean
  onOpenFile: (path: string) => void
  load: (p: string, force?: boolean) => Promise<void>
  setPasteNote: Dispatch<SetStateAction<string | null>>
  selRef: RefObject<Selection>
  apartAt: string | null
  state: TreeState
  onDeleteMany: (paths: string[]) => void
  paintRef: RefObject<PaintRow[]>
  onDelete: (path: string, name: string, isFolder: boolean) => void
  hasFocus: RefObject<boolean>
  at: string | null
  root: string
}

export interface TreeClipboard {
  binMarks: (path: string) => boolean
  cutSet: ReadonlySet<string>
  runPaste: (directory: string) => Promise<void>
  copyMark: (paths: string[], cut: boolean) => void
}

export function useTreeClipboard({
  setDroppedOn,
  setSel,
  setCursor,
  showRow,
  onOpenFile,
  load,
  setPasteNote,
  selRef,
  apartAt,
  state,
  onDeleteMany,
  paintRef,
  onDelete,
  hasFocus,
  at,
  root
}: TreeClipboardDeps): TreeClipboard {
  /** CUT is a mark, not a different clipboard (2026-09-03): the paths go on
   *  the clipboard exactly as Copy puts them, and the mark makes the NEXT
   *  paste a move - checked in main against what the clipboard then holds, so
   *  a copy taken elsewhere in between quietly downgrades it to a copy.
   *  Explorer interop is one-way: files cut here paste as copies there. */
  const cutSet = useFileCut()
  const copyMark = useCallback((paths: string[], cut: boolean): void => {
    if (!paths.length) return
    void copyFilePaths(paths, cut)
  }, [])

  // Byte progress lands on the job it was tagged with: several pastes can
  // run at once, and the chip shows the oldest with a count of the rest.
  useEffect(() => window.prism.onPasteProgress((m) => updateJob(m.jobId, m.pct)), [])

  /** After main's answer (useFilePaste has said anything worth saying, and
   *  ends the job even when the call is rejected). */
  const onPasted = useCallback(
    (r: PasteResult, dest: string): void => {
      if (!r.pasted) return
      // The pasted files become the selection, Explorer's way - now, and
      // again after the watcher's refresh clears every mark (droppedOn).
      if (r.paths.length) {
        setDroppedOn(r.paths)
        setSel({ anchor: r.paths[0], items: new Set(r.paths) })
        setCursor(r.paths[0])
        requestAnimationFrame(() => showRow(r.paths[0]))
        // And it OPENS (owner, 2026-09-03): highlighted but still showing
        // the old film read as the paste having gone somewhere else. A
        // pasted folder is not a thing to view, so files only.
        const first = r.paths[0]
        void window.prism.statFile(first).then((st) => {
          if (st && !st.isFolder) onOpenFile(first)
        })
      }
      void load(dest, true)
    },
    [load, onOpenFile, showRow, setCursor, setDroppedOn, setSel]
  )
  const runPaste = useFilePaste(onPasted, setPasteNote, PASTE_MESSAGES.refusedTab)

  /**
   * THE MARKS DECIDE WHAT A DELETE KEY BINS (review of #330), the Explorer
   * list's rule. A row the cursor sits on but the marks do not light (Ctrl+
   * Up/Down took the keyboard away from them, or Escape cleared them) is not
   * what Delete, Ctrl+D or Shift+Delete take: they take the marks, or nothing
   * when there are none. True when this answered the key. A lit cursor row
   * keeps the old rule (the row, or the whole selection it is in).
   */
  const binMarks = useCallback(
    (path: string): boolean => {
      const lower = path.toLowerCase()
      const items = [...selRef.current.items]
      const marked = items.some((p) => p.toLowerCase() === lower)
      const apart = !!apartAt && apartAt.toLowerCase() === lower
      if (marked || !apart) return false
      // Inside an archive the members are the archive menu's; nothing here.
      if (items.some((p) => state.children[parentDir(p)]?.archive)) return true
      if (items.length > 1) onDeleteMany(items)
      else if (items.length === 1) {
        const only = items[0]
        const isFolder = paintRef.current.some(
          (r) => r.kind === 'folder' && r.path.toLowerCase() === only.toLowerCase()
        )
        onDelete(only, baseName(only), isFolder)
      }
      return true
    },
    [apartAt, state.children, onDelete, onDeleteMany, paintRef, selRef]
  )

  /** Ctrl+C / Ctrl+X / Ctrl+V in the tree (2026-09-03, owner). Behind the same
   *  surface guard as Ctrl+A: the last press was in the panel, and nothing
   *  else - search box, rename field, editor, terminal - holds the keyboard,
   *  so every one of those keeps its own clipboard untouched. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || e.metaKey) return
      const a = document.activeElement as HTMLElement | null
      // The typing guard: anything that owns its own keys keeps them - the
      // search box, a rename field, the editor, the shell, a dialog. A FOCUSED
      // VIDEO is not typing (2026-09-03, owner): clicking a film hands the
      // element the keyboard, and Delete then reached nothing at all.
      const typing =
        !!a &&
        a !== document.body &&
        a.dataset.row === undefined &&
        (a.matches(FIELD) || !!a.closest(`${EDITOR},${OVERLAY}`))
      if (e.key === 'Delete' && !e.ctrlKey) {
        // Delete on the cursor row from anywhere in the panel's reach. The
        // row button handles its own when it is focused; this is for when
        // the viewer took the focus with it. Shift+Delete is Delete (owner,
        // #330: never permanent).
        if (!hasFocus.current || typing || a?.dataset.row !== undefined) return
        const cur = at
        if (!cur) return
        e.preventDefault()
        if (binMarks(cur)) return
        const items = selRef.current.items
        if (items.size > 1 && items.has(cur)) return onDeleteMany([...items])
        const isFolder = paintRef.current.some(
          (r) => r.kind === 'folder' && r.path.toLowerCase() === cur.toLowerCase()
        )
        return onDelete(cur, baseName(cur), isFolder)
      }
      if (!e.ctrlKey || e.shiftKey) return
      const k = e.key.toLowerCase()
      if (k !== 'c' && k !== 'x' && k !== 'v') return
      if (!hasFocus.current || typing) return
      if (k === 'v') {
        e.preventDefault()
        // EXPLORER'S RULE (owner, 2026-09-03): Ctrl+V pastes into the folder
        // that CONTAINS the highlighted row, never into the highlighted
        // folder itself - "Cloud" highlighted under Documents pastes into
        // Documents; a file inside Cloud pastes into Cloud. The keyboard
        // should not care what kind of row the cursor is on. The row MENU's
        // Paste on a folder still means "into this folder": that verb is
        // explicit. Clamped to the root, which is the floor of the tree.
        const cur = at
        const parent = cur ? parentDir(cur) : root
        runPaste(parent.toLowerCase().startsWith(root.toLowerCase()) ? parent : root)
        return
      }
      const targets = selRef.current.items.size ? [...selRef.current.items] : at ? [at] : []
      if (!targets.length) return
      e.preventDefault()
      copyMark(targets, k === 'x')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [at, root, copyMark, runPaste, onDelete, onDeleteMany, binMarks, hasFocus, paintRef, selRef])
  return { binMarks, cutSet, runPaste, copyMark }
}
