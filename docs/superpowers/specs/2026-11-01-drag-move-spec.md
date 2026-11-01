# Drag to move, copy, add and extract in the Explorer (#70), spec and plan

Date: 2026-11-01. Repo: Prism. For one owner approval: spec and plan together.

Issue #70 was written for the tree sidebar (gone since 2026-10-26, Explorer only). This
adapts it to today's Explorer list, crumbs, places, pins and tabs.

## 1. The short version

Most of #70 is already built and tested. The drag engine (`lib/drag/internalFileDrag.ts`),
the drop targets (`components/browse/useFolderDrop.ts`) and the router
(`hooks/useFileOps.ts` `onBrowseDropInto`) already do move, add to a zip, extract and move
inside a zip. What is missing is the Windows key rules (Ctrl copies, Shift moves, and a
different drive copies), a few targets, honest hover feedback, and undo, a clash question
and landing marks on the zip routes.

## 2. What works today (no change needed)

| Gesture | Result | Where |
|---|---|---|
| Row(s) or a multi-selection onto a folder row, the list background, a crumb, a place, a pinned folder, a tab | MOVE, taken names ask (MoveClashDialog), same-named folders merge, undo and redo, folder icons follow | `useFolderDrop`, `useFileOps.runMove`, `src/main/moveOps.ts` |
| Rows onto a place inside an open zip (its folder rows, background, the archive strip, its crumbs) | ADD, the originals go to the Recycle Bin, taken names ask Keep both, undo takes both halves back | `useArchiveActions.drop`, `archive/archiveOps.ts addMembers`, undo kind `archive-in` |
| Zip member(s) onto any real folder | EXTRACT there through the extraction window, remembered password, taken names get "name (2)" | `useFileOps.onDropInto`, `archiveExtractTo` |
| Zip member(s) onto another folder of the same zip | MOVE inside the zip | `useArchiveOps.moveInside`, `zipOps.moveMembers` |
| Files from Windows onto a folder | COPY in (paste engine, job chip, landing marks) | #103 D3, `copyIn` |
| Files from Windows onto a zip place or the archive panel | ADD, originals kept | `addMembers` with `fromPrism: false` |
| Prism window to Prism window (OS drag) | MOVE, members extract | #103 D4, `ownDrop` |
| Drop on the viewer or the window at large | Opens it, as before | `App.tsx` window drop |
| The carried row, the Move/Copy word under it, auto-scroll, Escape, Ctrl+Tab, grey hover fill | As before | `internalFileDrag.ts`, #327, #320, #140 |
| A row refuses itself and its own folder | Shows no-drop | `useFolderDrop` `insideSource` |

Held today by e2e `drag`, `dropBack`, `zipWrites`, `dragOutRow`, `dragOutMember`,
`landingMarks`, and unit tests `moveOps.test.ts`, `undoApply.test.ts`, `dragOut.test.ts`.

## 3. What is missing (the gaps)

- **G1, Ctrl does not copy.** Every in-app drop of rows is a move. `useFolderDrop` and the
  tab target set `dropEffect = 'move'` whatever the keys. The carry already sends `ctrlKey`
  and `shiftKey` on every dragover (`internalFileDrag.ts` `send`), nothing reads them.
- **G2, another drive still moves.** Windows copies by default across drives. Prism moves
  (rename, then `cp` + `rm` on EXDEV in `moveOne`), with no job chip for a long copy.
- **G3, Shift does not force a move.** Only matters once G2 exists.
- **G4, Ctrl into a zip still bins the originals.** `addMembers` always moves Prism rows in.
- **G5, a zip FILE row is not a target.** In a normal folder a `.zip` row is a file row, so
  a drop on it means "its parent folder" and is refused as the source's own folder. Windows
  Explorer adds to the zip there. (`zipWrites` notes it as "not a gesture the Explorer has".)
- **G6, the hover lies in three cases.**
  - Members over another folder of their OWN zip show "Copy", but the drop moves them
    (members always get `'copy'` in `useFolderDrop` and `TabStrip`).
  - A read-only archive (7z, rar, nested, over adm-zip's cap) accepts the hover, then says
    "read only" after the drop.
  - Members of zip A over zip B accept the hover, then say "another archive" after.
- **G7, move inside a zip is bare.** A taken name refuses the whole move with "could not be
  moved" (`zipOps.moveMembers` returns `'failed'`), no Keep both question, no undo
  ("archive-internal writes are deliberately NOT on the stack", 2026-08-22), no landing mark.
- **G8, zip A to zip B is refused.** `moveInside` says `ARCHIVE_COPY.otherArchive`.
- **G9, landing marks (#101) miss three routes:** a drag extraction (`ExtractToResult` gives
  only `written`, no paths), a drag add into a zip, a move inside a zip.
- **G10, Ctrl onto the own folder is refused.** Windows makes a duplicate there.
- **G11, no hover-to-switch on tabs.** To drop into a folder of a background tab you must
  drop on the tab itself (its current folder only).
- **G12, a drop from another Prism window ignores Ctrl.** D4 always moves.
- **G13, the docs and the issue still speak of the sidebar** (`docs/features.md` around
  line 1156, "sidebar rows dropped INTO an open archive", and the #70 body).

## 4. What it does, from the user's side (with the recommended answers)

One rule everywhere, Windows' rule:

- **A plain drag MOVES on the same drive and COPIES to another drive.**
- **Ctrl copies. Shift moves.** Holding or letting go mid-drag changes it live, and the
  word under the carried row says which (Move or Copy). No-drop shows nothing, as today.
- **Onto a folder row, the list background, a crumb, a place, a pin or a tab**: moved or
  copied into that folder. A copy into the folder it came from makes "name (2)" (G10).
- **Onto a zip, its row in a folder (G5) or any place inside it**: added at that place.
  A move bins the originals, as decided 2026-08-22; a copy leaves them.
- **Zip members onto a real folder**: always extracted (a copy). Shift does nothing.
- **Zip members onto another folder of the same zip**: moved inside it. A taken name asks
  Keep both or Cancel (G7). Ctrl+Z puts them back.
- **Zip members onto another zip**: copied into it (G8), originals stay in their zip.
- **Read-only archives, and anything else that will be refused, show no-drop on hover**
  (G6). Main still has the final say and keeps its messages.
- **Hovering a background tab for 0.6 s while dragging brings it to the front** (G11), so
  the drop can land in its list. Leaving the strip without a drop leaves that tab in front.
- **What lands is marked** in the list showing it (#101), on every route above.
- Dropping on the viewer or the window still opens the file. Dragging out at the window
  edge (#103) is unchanged.

## 5. Decisions for the owner (recommended answer first)

1. **D1, Ctrl copies, Shift moves?** Recommend YES, as Windows. Cost: one pure rule shared
   by every target.
2. **D2, another drive copies by default?** Recommend YES, as Windows (the task says "as
   Windows"). Today a cross-drive drag moves, and a big one runs with no job chip.
   Alternative: keep "always moves" and only add Ctrl. Drives are told apart by the path's
   root (`C:` or `\\server\share`); a subst drive or a junction can guess wrong, which only
   swaps move for copy, both safe.
3. **D3, the cross-drive rule for zips too?** Recommend YES, one rule: a zip's drive is the
   outer zip file's drive. Alternative: into a zip always moves, as decided 2026-08-22.
4. **D4, a Ctrl copy is not on the undo stack?** Recommend NOT on it, as a paste and a drop
   from Windows (D3 of #103) are not. Windows can undo a copy; Prism's paste cannot, and
   both should match. A later "undo a copy" would do both at once.
5. **D5, a Ctrl copy's taken names?** Recommend the paste engine's "name (2)", no question,
   as #103 D3 already does for drops from Windows. A move keeps its question.
6. **D6, drop on a zip file row adds to it (G5)?** Recommend YES, for `.zip` only. 7z and
   rar rows show no-drop (Prism cannot write them). This replaces the `zipWrites` note.
7. **D7, Keep both for a taken name when moving inside a zip (G7)?** Recommend YES, the same
   ArchiveClashDialog an add uses (Keep both, Cancel; no Replace inside an archive).
8. **D8, undo for a move inside a zip (G7)?** Recommend YES, a new undo kind
   `archive-move`; it reverses the 2026-08-22 "archive-internal writes are not on the
   stack" only for moves (rename and delete stay off: a delete is permanent anyway).
9. **D9, zip A to zip B copies (G8)?** Recommend YES, a copy only (extract to the run's
   member folder, which the #103 press already does, then add). Alternative: keep refused.
10. **D10, Ctrl inside the same zip?** Recommend IGNORED for now: the word says Move and it
    moves. A copy inside a zip needs a new main verb; ask again if wanted.
11. **D11, Ctrl on a drop from another Prism window (G12)?** Recommend YES: the drop
    event's own Ctrl turns D4's move into a copy. Shift and the drive rule apply as inside.
12. **D12, hover a tab to switch to it (G11)?** Recommend YES, 0.6 s, in-app carry and
    Windows drags alike, never the tab being torn. Folder rows do NOT spring open on hover
    (File Explorer's list does not either).
13. **D13, a right-drag menu (Copy here, Move here, Cancel)?** Recommend NO for now. The
    carry only follows the left button; a right-drag is new menu work (`docs/menus.md`).
14. **D14, the label words?** Recommend keep the one word, Move or Copy, quiet chrome
    (`docs/ui-direction.md`). An add says Move or Copy too; an extraction says Copy.
15. **D15, #70 after this?** Recommend: rewrite its body for the Explorer, link this spec,
    and close it with the PR.

## 6. Design

One pure rule, used by every target and by the drop itself, so the word shown and the
thing done can never differ:

`src/renderer/src/lib/drag/dropVerb.ts`

```ts
type DropVerb = 'move' | 'copy' | 'add-move' | 'add-copy' | 'extract' | 'move-inside'
  | 'zip-to-zip' | 'none'
dropVerb({ payload, target, keys: { ctrl, shift } }): DropVerb
// target: { dir, archive?: { container, outer, readOnly } }
```

- Volume: `volumeOf(path)` in `@shared/path` (drive letter or UNC share root).
- `effectOf(verb)` gives the dropEffect: move, add-move, move-inside are `'move'`; the rest
  `'copy'`; `'none'` refuses. A drag Windows carries still shows `'copy'` (Electron's OS
  drag cannot take `'move'`, #103), whatever the verb.
- Targets learn whether a folder is inside a zip from what they already hold: the list's
  `props.archive` (`ArchiveMeta`), a crumb's place in `archive.chain`, a tab's own listing,
  and for a zip row its extension. Main still decides at the drop, by its listing
  (`onBrowseDropInto` browses the destination first, as now).

The drop path: `onBrowseDropInto(dest, payload, tabId, keys)` asks `dropVerb` again with
main's answer and routes:

- `move` to `runMove` (unchanged), `copy` to `copyIn` (the paste engine, job chip, marks),
- `add-move` / `add-copy` to `addInto(..., fromPrism)` with `fromPrism` = the verb,
- `extract` to `archiveExtractTo` (now marks what it wrote),
- `move-inside` to `moveInside` (clash question, undo, marks),
- `zip-to-zip` to a new `copyBetween` (members prepared to the member folder, then added).

## 7. Files to change

Renderer:
- `src/renderer/src/lib/drag/dropVerb.ts` (new) and `dropVerb.test.ts` (new).
- `src/renderer/src/components/browse/useFolderDrop.ts`: read the keys and the target's
  archive, set the effect from `dropVerb`, pass the keys to `onDropInto`.
- `src/renderer/src/components/browse/BrowseList.tsx`: a `.zip` file row becomes a drop
  target for the zip itself (D6); targets inside a zip pass `props.archive`.
- `src/renderer/src/components/browse/BrowseToolbar.tsx`, `BrowsePlaces.tsx`: pass the
  archive of a crumb or place where they have one.
- `src/renderer/src/components/browse/types.ts`: `onDropInto` gains `keys`.
- `src/renderer/src/components/TabStrip.tsx`: effect from `dropVerb`; the 0.6 s hover
  switch (D12), cleared on leave, drop, dragend and a tear.
- `src/renderer/src/hooks/useFileOps.ts`: `onBrowseDropInto` and `onDropInto` route by
  verb; Ctrl from a Prism-to-Prism drop (D11); marks for extraction.
- `src/renderer/src/components/browse/useArchiveActions.tsx`: `drop` takes the verb.
- `src/renderer/src/components/archive/useArchiveOps.tsx` and `archiveOps.ts`: `addInto`
  copy or move; `moveInside` with Keep both, undo entry, marks; `copyBetween` (D9);
  marks after an add (the `entry` names it returns, spelled as Explorer places).
- `src/renderer/src/components/ArchiveView.tsx`: its own drop uses `dropVerb` too, so the
  archive panel follows the same keys.
- `src/renderer/src/lib/undo.ts`, `undoApply.ts`: kind `archive-move` (undo moves each
  member back to its old folder, grouped by folder; redo moves them again), `describeUndo`.

Main and shared:
- `src/shared/path.ts`: `volumeOf`.
- `src/shared/extraction.ts`: `ExtractToResult` gains `paths` (the top-level names as
  written, after "name (2)"); `src/main/archive.ts` fills it.
- `src/main/zipOps.ts`: `moveMembers(zip, entries, dest, keepBoth)` answers the clashes
  instead of a bare `'failed'`, and returns `moved: Array<{ from, to }>` for undo; the IPC
  type `ArchiveMoveResult` follows; `zipWorker.ts` and `preload/index.ts` pass `keepBoth`.
- No new dependency, no `*Sync` on a live path, no new process.

Docs:
- `docs/features.md`: one new entry "Drag in the Explorer: move, copy, add, extract (#70)",
  the owner's words and date, each decision and the test that holds it; fix the sidebar
  wording near line 1156 and the 2026-08-22 "not on the stack" line for D8.
- `docs/dialogs.md`: ArchiveClashDialog row gains "move inside a zip".
- `ROADMAP.md` if #70 is listed there.

## 8. Tests

Unit (vitest):
- `lib/drag/dropVerb.test.ts`: every row of section 4 as a table; Ctrl, Shift, both, none;
  same and other drive; UNC; zip on another drive; read-only; members own zip, other zip,
  real folder; own folder with and without Ctrl; Windows drags always show copy.
- `shared/path.test.ts`: `volumeOf` for `C:\`, `c:`, `\\srv\share\x`, a zip path.
- `main/zipOps.test.ts`: `moveMembers` reports clashes, Keep both renames, returns pairs.
- `components/archive/archiveOps.test.ts`: `addMembers` copy leaves originals, no undo.
- `lib/undoApply.test.ts`: `archive-move` undo and redo, a folder member, a member gone.
- `main/archive.test.ts` (or `extractJob.test.ts`): `paths` names the renamed arrivals.
- `components/browse/useFolderDrop` effect cases folded into `dropVerb.test.ts`;
  `TabStrip` hover switch timing as a small pure helper test if it is split out.

E2e (`tools/e2e/run.mjs`, headless on the hidden desktop as always; new scenarios):
- `dragCopy`: Ctrl+drag a row onto a folder: the word reads Copy, the original stays, the
  copy is marked; Ctrl onto its own folder makes "name (2)"; Ctrl let go mid-drag moves;
  Shift reads Move.
- `dragDrive`: only when the machine has a second fixed volume (skips with a reason
  otherwise, CI too): a plain drag reads Copy, Shift reads Move. The rule itself is held by
  the unit table.
- `dragZipRow`: a row dropped on a `.zip` row in its folder is added, original binned, undo
  brings it back; Ctrl keeps the original; a `.7z` row shows no-drop.
- `dragZipInside`: members onto a folder of the same zip read Move, move, are marked;
  a taken name asks Keep both; Ctrl+Z and Ctrl+Y.
- `dragZipToZip`: members of A onto a folder of zip B: copied, A unchanged.
- `dragHoverTab`: a carried row held over a background tab brings it front after 0.6 s;
  dropped in that tab's list, it moves there.
- `dragReadOnly`: members or rows over a 7z place show no-drop and nothing is said.
- Extend `drag` (the extraction drop marks its file) and `dropBack` (Ctrl on a drop from
  another window copies).

Gate as always: the covering scenarios while iterating, the whole suite before the PR,
then typecheck, lint, unit tests, package and install.

## 9. Plan (one PR, in this order)

1. `volumeOf` and `dropVerb` with their unit tables (red first, then green).
2. Targets read it: `useFolderDrop`, `TabStrip`, `ArchiveView`, `BrowseList` zip rows,
   crumbs and places pass the archive. `dragCopy`, `dragReadOnly` scenarios.
3. Routing in `useFileOps` and `useArchiveActions`: copy, add copy, keys from a
   Prism-to-Prism drop. `dragZipRow`, extended `dropBack`.
4. Main: `moveMembers` clashes and pairs, `ExtractToResult.paths`. Their unit tests.
5. Zip inside: Keep both, `archive-move` undo, marks; extraction and add marks.
   `dragZipInside`, extended `drag`.
6. Zip to zip copy (D9). `dragZipToZip`.
7. Tab hover switch (D12). `dragHoverTab`.
8. Cross-drive default (D2, D3) last, since it changes a habit. `dragDrive`.
9. Docs (features.md entry, dialogs.md), #70 body rewritten, whole e2e suite, PR, install.

If any decision is a NO, its step drops out and nothing else depends on it, except D2
and D3 which share step 8.

## 10. Risks

- **Habit change (D2).** A cross-drive drag that used to move will copy. Mitigated by the
  word under the row; Shift still moves.
- **The OS drag cannot carry 'move'.** A drag Windows carries always shows Copy, so a
  Prism-to-Prism drop that moves (D4) still shows Copy. Known since #103; not made worse.
- **Drive guess.** `volumeOf` is by path root; subst, junctions and mounted folders can be
  on a different volume than they look. Worst case a move is a copy or the reverse; the
  EXDEV fallback keeps a move correct.
- **The hover cannot see main's answer.** A zip over adm-zip's cap, or one with encrypted
  members, looks writable on hover; main refuses at the drop and says so, as today.
- **Tab hover switch vs. tear-off.** Both live in `TabStrip`; the switch must never run
  for a tab being torn or reordered. `dragHoverTab` and `tabAttach` both run.
- **Undoing a zip move rewrites the zip twice.** For a large zip that is two long writes;
  the zip worker keeps main responsive (zipWrites times an IPC round trip already).
- **Zip to zip** extracts to the member folder first, inside the #103 budget (64 MB, 64
  members). Over it, the drop extracts in full to the same folder through the extraction
  window; the 2 GB cap still holds.
- **Members of a nested zip** stay read-only (a temp copy); they extract and copy out, never
  move.
- **One leaked app fails every scenario after it**: every new scenario reaps by profile
  path, as the others do.
