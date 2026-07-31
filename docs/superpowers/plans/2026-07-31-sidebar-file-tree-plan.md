# Sidebar file tree — implementation plan

Spec: [`2026-07-31-sidebar-file-tree-design.md`](../specs/2026-07-31-sidebar-file-tree-design.md)

## Task 1 — shared types

`src/shared/types.ts`: `DirEntry { name, path }`, `DirListing { folders, files }`,
and `root: string` on `OpenPayload`.

## Task 2 — `src/main/dirList.ts` (test-first)

`isInsideRoot`, `listDir`, `toViewerFile` (moved out of `index.ts`). Hidden and
system entries filtered; folders and files sorted naturally and separately.
`isInsideRoot` resolves real paths, lowercases on win32, and requires a separator
boundary.

Verify: `dirList.test.ts` green.

## Task 3 — main wiring

- `sessionRoot` module state; `buildPayload(p, reroot)` sets it when the open is
  external, and is rebuilt on `listDir`.
- `dir:list` and `open:within` handlers, both guarded by `isInsideRoot`.
- Payloads carry `root`.

Verify: `npm run typecheck`.

## Task 4 — preload

`listDir(path)` and `openWithin(path)` on the bridge, typed in `index.d.ts`.

## Task 5 — `lib/fileTree.ts` (test-first)

`ancestorChain(root, path)`, `toggleExpanded(set, path)`, and the child-cache
merge helper. Pure functions only.

Verify: `fileTree.test.ts` green.

## Task 6 — `components/Sidebar.tsx`

Header (root folder name), recursive rows with chevron + kind glyph, lazy load on
expand, reveal-on-open, current-file highlight, `role="tree"` semantics, empty
and unreadable states. Fixed 260px, own scroll.

## Task 7 — `App.tsx`

Sidebar open/closed (persisted, default closed), `Ctrl+B`, title-bar toggle
button, sidebar-plus-viewer layout, hidden in fullscreen, tree clicks via
`open:within`.

## Task 8 — docs + ship

Record the sidebar decision in `CLAUDE.md` (it currently forbids one without an
explicit decision) and mention the panel in `README.md`. Then
`npm test && npm run typecheck && npm run lint && npm run build`, package,
install, commit, push, PR.
