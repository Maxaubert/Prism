import {
  useRef,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type SetStateAction
} from 'react'
import { listKey, isJumpKey, typedRun, typeJump, stepTo } from '../../lib/listKeys'
import { nearerEscape } from '../../lib/nearerEscape'
import { emptySelection, rangeSelect, clickSelect, type Selection } from '../../lib/selection'
import { parentDir, extOf, baseName } from '@shared/path'
import { clipboardText } from '../../lib/clipboardText'
import { fileKind } from '@shared/fileKind'
import type { ArchiveMeta } from '@shared/types'
import type { TreeState } from '../../lib/tabs/tabs'
import type { TreeRow } from '../../lib/fileTree'
import type { Menu } from './types'

// THE TREE'S KEYS (out of Sidebar.tsx, structure cleanup 2026-10-12,
// unchanged): what a key on a focused tree row does, from listKey's verbs,
// and type-to-jump. The Explorer's list has its own (BrowseList).

export interface TreeKeysDeps {
  rows: TreeRow[]
  query: string
  at: string | null
  order: string[]
  land: (row: { path: string; isFolder: boolean }, keepFocus?: boolean) => void
  panel: RefObject<HTMLElement | null>
  sel: Selection
  setSel: Dispatch<SetStateAction<Selection>>
  setApartAt: Dispatch<SetStateAction<string | null>>
  setCursor: Dispatch<SetStateAction<string | null>>
  showRow: (
    path: string,
    opts?: { smooth?: boolean | undefined; focus?: boolean | undefined }
  ) => boolean
  memberMeta: (path: string) => ArchiveMeta | null
  onOpenNewTab: (path: string) => void
  state: TreeState
  setProps: Dispatch<SetStateAction<Omit<Menu, 'x' | 'y' | 'apps'> | null>>
  binMarks: (path: string) => boolean
  selRef: RefObject<Selection>
  onDeleteMany: (paths: string[]) => void
  onDelete: (path: string, name: string, isFolder: boolean) => void
  root: string
  onNewFolder: (dir: string) => Promise<string | null>
  setState: (update: (s: TreeState) => TreeState) => void
  load: (p: string, force?: boolean) => Promise<void>
  setEditing: Dispatch<SetStateAction<string | null>>
}

export interface TreeKeys {
  onTreeKey: (e: ReactKeyboardEvent<HTMLElement>) => boolean
}

export function useTreeKeys({
  rows,
  query,
  at,
  order,
  land,
  panel,
  sel,
  setSel,
  setApartAt,
  setCursor,
  showRow,
  memberMeta,
  onOpenNewTab,
  state,
  setProps,
  binMarks,
  selRef,
  onDeleteMany,
  onDelete,
  root,
  onNewFolder,
  setState,
  load,
  setEditing
}: TreeKeysDeps): TreeKeys {
  /**
   * THE COMMON KEYS IN THE TREE (#330; owner, 2026-10-07: "add common hotkeys
   * to the explorer and project"), the Explorer list's set (lib/listKeys).
   * Reached only with the focus inside the panel and past its typing guard.
   * Marking is QUIET (#263): Shift and Ctrl with the arrows move the cursor
   * and the marks and never open or play what they land on, which is why App
   * leaves those chords to the tree. True when the key was taken; a taken key
   * is claimed, so the player's window-wide keys (Ctrl+Space, Shift+Home,
   * Alt+Left) and the PDF's F3 stand aside.
   */
  const typedTree = useRef({ text: '', at: 0 })
  const rowOf = (path: string | null): (typeof rows)[number] | undefined =>
    path ? rows.find((r) => r.path.toLowerCase() === path.toLowerCase()) : undefined
  const onTreeKey = (e: ReactKeyboardEvent<HTMLElement>): boolean => {
    const k = listKey(e)
    const searching = !!query.trim()
    if (!k) {
      // TYPE TO JUMP (owner: "add it like the Explorer's"): a letter is taken
      // only when it matches a row on screen; otherwise it still reaches the
      // viewer (a film's k, j, l and m, a picture's f). Letters only: a digit
      // is the player's seek and . and , its frame step, and a jump OPENS.
      if (searching || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false
      if (!isJumpKey(e.key)) return false
      const run = typedRun(typedTree.current, e.key, performance.now())
      typedTree.current = run
      const i = typeJump(
        rows.map((r) => r.name),
        at ? order.findIndex((p) => p.toLowerCase() === at.toLowerCase()) : -1,
        run.text
      )
      if (i < 0) return false
      land(rows[i])
      return true
    }
    // Ctrl+A is the window listener's above (it predates this), and plain
    // Back/Forward have no history here: Alt+Left and Alt+Right do nothing,
    // but are still claimed, so a film behind the tree does not seek.
    if (k === 'select-all') return false
    if (k === 'back' || k === 'forward') return true
    if (k === 'search') {
      panel.current?.querySelector<HTMLInputElement>('input')?.focus()
      return true
    }
    if (k === 'clear') {
      if (!sel.items.size) return false
      // A peek, the PDF's find bar, a menu: Escape is theirs to close first.
      if (e.key === 'Escape' && nearerEscape()) return false
      setSel(emptySelection)
      // Nothing lit, the cursor's row included: it keeps the focus only.
      setApartAt(at)
      return true
    }
    // The rest act on the tree's own rows; while a search has replaced them
    // they are claimed and do nothing.
    if (searching) return true
    const cur = rowOf(at)
    const move = /^(extend|focus)-(up|down|home|end)$/.exec(k)
    if (move) {
      const from = cur ? rows.indexOf(cur) : -1
      const to = stepTo(rows.length, from, move[2] as 'up' | 'down' | 'home' | 'end')
      if (to === null) return true
      const row = rows[to]
      setCursor(row.path)
      setApartAt(move[1] === 'focus' ? row.path : null)
      if (move[1] === 'extend')
        setSel((s) => rangeSelect(order, { anchor: s.anchor ?? at, items: s.items }, row.path))
      requestAnimationFrame(() => showRow(row.path, { focus: true }))
      return true
    }
    if (k === 'toggle-mark') {
      if (cur) {
        setSel((s) => clickSelect(order, s, cur.path, { ctrl: true }))
        // In or out, the row is lit by the marks alone from now on.
        setApartAt(cur.path)
      }
      return true
    }
    if (k === 'parent') {
      // Alt+Up: the row of the folder this one is in, as Backspace does for a
      // row that is not an open folder. The root has no row of its own.
      const up = cur ? rowOf(parentDir(cur.path)) : undefined
      if (up) land(up)
      return true
    }
    if (k === 'copy-paths') {
      const paths = sel.items.size ? order.filter((p) => sel.items.has(p)) : cur ? [cur.path] : []
      if (paths.length) void clipboardText(paths.join('\n'))
      return true
    }
    if (!cur) return true
    // Inside an archive the rows are its members: nothing here makes, bins or
    // describes them (the archive's own menu does).
    const member = !!memberMeta(cur.path)
    if (k === 'open-new-tab') {
      if (cur.isFolder && !member && fileKind(extOf(cur.name), cur.name) !== 'archive')
        onOpenNewTab(cur.path)
      return true
    }
    if (member) return true
    if (k === 'properties') {
      const file = state.children[parentDir(cur.path)]?.files.find(
        (f) => f.path.toLowerCase() === cur.path.toLowerCase()
      )
      setProps({ path: cur.path, name: cur.name, isFolder: cur.isFolder, size: file?.size })
      return true
    }
    if (k === 'bin') {
      // Ctrl+D and Shift+Delete are Delete, to the Recycle Bin (owner: Shift+
      // Delete is not a permanent delete in Prism).
      if (binMarks(cur.path)) return true
      const items = selRef.current.items
      if (items.size > 1 && items.has(cur.path)) onDeleteMany([...items])
      else onDelete(cur.path, cur.name, cur.isFolder)
      return true
    }
    if (k === 'new-folder') {
      // In the folder row the cursor is on, or beside the file it is on.
      const dir = cur.isFolder ? cur.path : parentDir(cur.path)
      const dirName = baseName(dir)
      if (
        fileKind(extOf(dirName), dirName) === 'archive' ||
        !dir.toLowerCase().startsWith(root.toLowerCase())
      )
        return true
      void onNewFolder(dir).then((made) => {
        if (!made) return
        if (dir.toLowerCase() !== root.toLowerCase())
          setState((s) => ({ ...s, expanded: new Set([...s.expanded, dir]) }))
        void load(dir, true).then(() => {
          setCursor(made)
          setSel({ anchor: made, items: new Set([made]) })
          setEditing(made)
          requestAnimationFrame(() => showRow(made))
        })
      })
      return true
    }
    return false
  }
  return { onTreeKey }
}
