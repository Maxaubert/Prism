# Sidebar file tree — design

**Date:** 2026-07-31

## Problem

Prism opens one file and pages through its folder. Everything else in the folder
tree is invisible: to view a photo one folder over you have to go back to
Explorer and open it from there. A viewer that already knows the folder should
let you move around it.

## Solution

A collapsible file tree on the left, rooted at the folder Prism was opened in.

**Contents.** Folders first, then the files Prism can open, both natural-sorted.
Files it cannot open, dotfiles, and Windows system entries (`desktop.ini`,
`Thumbs.db`, `$RECYCLE.BIN`, `System Volume Information`) are not listed. A
folder row carries a chevron; clicking it expands in place, loading children the
first time and caching them. Indentation and chevrons only, no connector lines.

**Clicking a file** opens it and makes that file's folder the paging list, so the
arrow keys step through it under the current navigation scope. The tree does not
move: the folder you came from stays expanded, so returning is one click. The
open file is highlighted, and opening a file from outside expands the tree to
reveal it.

**The root is a wall.** No `..` row, and the main process refuses any directory
request that resolves outside the root. The guard compares real paths, so a
symlink or junction pointing outward is refused too. Opening a file from
Explorer, drag, or the dialog re-roots to that file's folder, and that is the
only way the root changes.

**Chrome.** Fixed 260px wide; long names truncate. Toggled by a title-bar button
and `Ctrl+B`, hidden in fullscreen, open/closed remembered in `localStorage`.
Closed on a fresh install. The tree ignores the navigation scope: it always shows
everything viewable, so a PDF is reachable while paging photos.

## Architecture

### Main owns the root

The root is the security boundary, so main holds it rather than trusting a path
from the renderer. `buildPayload` re-roots when the open came from outside
(launch argv, second-instance handoff, dialog, drag); tree clicks go through a
separate channel that cannot.

New `src/main/dirList.ts`:

- `isInsideRoot(root, path)` — true for the root itself and anything beneath it.
  Compares resolved real paths, case-insensitively on Windows, and requires a
  separator boundary so `C:\photos-old` is not treated as inside `C:\photos`.
- `listDir(dir)` — `{ folders, files }` for one directory, filtered and sorted.
- `toViewerFile(path)` — moved here from `index.ts`, which keeps the file's one
  job (window, protocol, routing) intact.

New IPC:

| Channel | Purpose |
| --- | --- |
| `dir:list` | children of a directory inside the root, or `null` |
| `open:within` | payload for a file inside the root, leaving the root alone |

`OpenPayload` gains `root: string` so the renderer can title the panel and reveal
the current file. `buildPayload` is rewritten on top of `listDir`, dropping its
own duplicate readdir/filter/sort.

### Renderer

- `lib/fileTree.ts` — pure: `ancestorChain(root, path)` for reveal, plus the
  expand/collapse and cache reducers. No React, no IPC: unit-testable.
- `components/Sidebar.tsx` — the panel: header, recursive rows, chevrons,
  `role="tree"` / `treeitem` / `aria-expanded`, keyboard focus per row.
- `App.tsx` — owns the open/closed flag, `Ctrl+B`, and the sidebar-plus-viewer
  layout. A tree click calls `open:within`, so the payload swaps but the root
  does not.

### Failure cases

An unreadable folder shows a muted "can't read" row rather than vanishing; an
empty one shows "empty". A file that disappears between listing and click falls
back to the existing "couldn't open" path. A rejected `dir:list` (outside root)
returns `null` and the row simply does not expand.

## Testing

- `dirList.test.ts` — the root guard: the root itself, a child, a `..` escape, a
  sibling sharing a name prefix, case differences, trailing separators.
- `fileTree.test.ts` — `ancestorChain` from root to a nested file, a file
  directly in the root, and a path outside the root; expand/collapse reducers.
- Manual: open a file, reveal, expand a sibling folder, click a file in it,
  confirm the arrows page that folder and the root cannot be escaped.

## Out of scope

Drag-to-resize the panel, renaming or deleting files, multi-root, a search box,
watching the folder for external changes, and virtualised rendering for very
large folders. Each is additive if a real folder proves it necessary.
