# Recycle Bin in the Explorer: spec and implementation plan

Prism v0.135.0 (main). Owner request, 2026-11-10: "add recycle bin to the bottom of the explorer page".
Owner choices: placement A (a plain "Recycle Bin" row, the LAST row of Quick access, after Videos, same
look as the other rows, trash icon, no count, no extra chrome), and a click opens "In Prism": the bin's
files listed like a folder, each with its original location and date deleted, plus Restore, Delete
permanently and Empty.

This document was written from code only. Nothing in the repo was changed and no e2e was run.

## 0. What the code showed (facts the design rests on)

1. **"This PC" is NOT a special listing on the desktop.** The brief assumed it. In the desktop Explorer
   it is only a section of the places panel (`BrowsePlaces.tsx`, the `drives` rows). Every location is a
   real absolute path: `SavedBrowse.path`, `BrowseLocation.path`, `isAbsolute` checks in `browse.ts`,
   `explorerListing.ts`, `tabs.ts` (lines 86, 96, 198) and `tabsSession.ts`. Only the PHONE has a `THIS_PC`
   sentinel (`''`, `src/renderer/src/phone/browse.ts`). So the bin needs a new kind of location.
2. **The nearest models are the zip-as-folder places (#300) and the search listing.** Both put something
   that is not a plain folder into the same history, address bar, tabs and session. The zip hook sits in
   `explorerListing.browse` (`deps.archive`, answered BEFORE the `isAbsolute` path), in
   `tabsSession.explorerRestoreListing` (`archiveRead`) and in `browse.ts browseWatch`. The bin follows
   that shape. `searchColumns` in `BrowseList.tsx` is the model for a column set of its own.
   `props.strip` (the zip's Extract strip) is the model for the bin's action strip.
3. **`src/main/binRestore.ts` already reads the bin.** It finds `<drive>\$Recycle.Bin\<SID>` (SID from
   `whoami /user` through `spawnWorker`, asked once), reads `$I` files with `parseInfo` (v1 fixed 260
   chars at 24, v2 char count at 24 and path at 28, FILETIME at 16), reads 32 at a time, pairs each `$I`
   with its `$R`, refuses a symlink in the bin, and moves `$R` back with `rename` then drops the `$I`.
   `binIndex(paths, bins?)` already takes the bin folders as a parameter, which is the seam the tests
   use. `parseInfo` ignores the size (int64 at offset 8). The bin view needs it.
4. **The root wall.** `desktopAccess.ts` grants a folder and its immediate entries to a tab. `pathWall.ts`
   has `grantExtracted` (read AND `movable`/`archiveReadOk`, wrong for the bin) and `grantServable`
   (media wall only, wrong for text and PDF). Neither fits. See D12.
5. **Existing delete is a move to the bin plus undo.** `useFileOps.ts` uses `trashFile` (main:
   `shell.trashItem`), `withFileJob` (hold after `BUSY_AFTER_MS = 1000`, Cancel, `finally` ends the bar)
   and the undo stack (`lib/undo.ts`, `undoApply.ts`). Undo of `trash` calls `restoreFromBinJob(paths,
   jobId)` and main's `fileRestore` handler (`ipc/files.ts` ~line 690): `binIndex`, then `restoreIndexed`,
   then PowerShell `Shell.Application` for what it could not move.
6. **Docs say the zip member delete is "the ONE permanent delete in Prism"** (`docs/features.md` ~line
   1621) and "Nothing is destroyed" (~line 1864). Both lines must change (D20).
7. **E2E seams are env vars read only under `--e2e`** (`PRISM_E2E_DOWNLOADS`, `PRISM_E2E_HOME`,
   `PRISM_E2E_SLOW_COPY`...). The new seam follows that.
8. **The phone can already browse `C:\$Recycle.Bin\<own SID>` as an ordinary path.** Not part of this
   feature. Noted in section 9.

## 1. Decisions (every one, numbered)

### Reading the bin

**D1. Read the bin directly, in main, with async fs only. No Shell namespace.**
For each fixed local drive (`isLocalFixed`, letters A to Z, each probe capped at 1.5 s like
`browseLocations`), read `<drive>\$Recycle.Bin\<current user SID>`.

Why not the Shell namespace (`Shell.Application` `Namespace(0xA)` through PowerShell):
- It is a process start. CLAUDE.md: main never starts a process itself; it would go through
  `spawnWorker`, and the process still costs 200 to 500 ms before any work.
- `binRestore.ts` records the measurement: ~1,800 items took 1.0 to 2.2 s, and one run took 10.4 s. At
  10,000 items that is roughly 6 to 12 s with outliers past 60 s, with no progress and no Cancel.
- The property names (`System.Recycle.DeletedFrom`) work, but the verbs are localised, and a COM walk
  over every item is the slow part.
- The direct route is the same reading the app already trusts for undo (`binRestore.ts`, shipped since
  0.12x), with no process.

Cost of the direct route: it relies on the `$I`/`$R` format (stable since Vista; v1 and v2 both parsed),
and on the user's SID folder. Mitigations: a `$I` with an unknown version or a bad length is skipped and
counted in one diag line (`bin-skipped`), never shown as a broken row; a drive with no bin folder is an
empty bin on that drive; the existing shell path in `fileRestore` stays for UNDO exactly as it is.

**D2. The SID comes from the existing `ownSid()`** (whoami through `spawnWorker`, cached). Export it from
`binRestore.ts`. Only this user's folder is read, never another account's (same rule as `binsOf`).

**D3. Listing algorithm (per bin folder, all drives in parallel, 2 at a time per physical disk is not
needed: the reads are tiny).**
1. `readdir(dir, { withFileTypes: true })`: one call gives names AND file-or-folder for every `$R`, so no
   per-item stat. A dirent that is a symlink or junction is skipped (as `moveBack` already refuses it).
2. Keep `$I<id><ext>` that has a `$R<id><ext>` beside it (case-insensitive, as `binIndex` does). Skip
   `desktop.ini`. An orphan `$R` or `$I` is not listed (Explorer hides them too).
3. Read the `$I` files 64 at a time (`readFile`, 30 to 600 bytes each). Parse with `parseInfo`, extended
   to also return `size` (int64 at offset 8) and to keep returning `null` for anything it cannot read.
4. Build rows from the `$I` alone: name = base name of the original path, original location = its folder,
   deleted = FILETIME to ms (`Number(ft / 10000n - 11644473600000n)`), size = the `$I` size (the folder's
   total on Windows 10 and later; a number Windows wrote, not a walk), kind = `fileKind(ext, name)` from the
   ORIGINAL name's extension.
5. A warm cache in main: `Map<"dir|$Iname", parsed>`. `$I` files never change once written. A read keeps
   entries whose name is still in the `readdir`, reads only the new names, and the cache is cleared after
   any Restore, Delete permanently or Empty that Prism itself did. (A reused id between two reads is
   possible only if both an item and its replacement used the same random six characters, which is
   negligible, and the clear-on-own-write covers Prism's own changes.)

**D4. Speed target for a bin of 10,000 items** (measured in stage 0 by a unit test that writes 10,000
real `$I`/`$R` pairs to a temp folder and logs the number; the test asserts a loose 5 s so CI is stable,
and the real figure goes into `docs/features.md`):
- cold read, first rows on screen: at most 1.0 s on this PC's SSD (expected: `readdir` of 20,000 entries
  ~40 ms, 10,000 small reads at 64 in flight ~300 to 600 ms).
- warm read (nothing new): at most 150 ms.
- the list is already virtual (`BrowseList.tsx`), so painting 10,000 rows is not the cost; the IPC reply of
  10,000 rows is about 3 MB and takes ~30 ms.
- Main's event loop is never blocked longer than one batch of 64 reads. No `*Sync` call (`syncCalls.test.ts`
  stays green), no `child_process` (`spawnCalls.test.ts` stays green).

### The location and its listing

**D5. The bin is a location named by one fixed string: `BIN_PLACE = 'shell:RecycleBinFolder'`**
(new `src/shared/binPlace.ts`, with `isBinPlace(p)`, `BIN_NAME = 'Recycle Bin'`). It is Windows' own name
for the bin, so typing it, or typing `Recycle Bin`, in the address field goes there (`pastedPath` maps
both). It is deliberately NOT absolute: every `isAbsolute` guard (the walls, the file ops, `browse:watch`,
the listing cache, the search, the drag-out) refuses it by default, which fails closed. The places that
must accept it are listed and changed on purpose:
- `explorerListing.browse` (hook before the archive hook; the listing is never written to the listing
  cache on disk: no deleted file names land in `%APPDATA%`).
- `ipc/browse.ts browseWatch` (a bin watch, D9).
- `tabs.ts` lines 86, 96 (saved `browse.path` and history entries). The tab `root` stays a real folder.
- `tabsSession.ts` `explorerRestoreListing` (a `binRead` step like `archiveRead`) and its
  `grantDesktopDirectory` loop (skip the sentinel).
- `desktopAccess.grantDesktopDirectory` ignores it (so nothing is granted for it).
- renderer: `navigate` (typed and clicked), `browseCrumbs`, `browseParent`, tab title.

**D6. Where it shows.**
- Address field and breadcrumb: one crumb, "Recycle Bin", with the row's trash glyph. `browseCrumbs`
  special-cases the sentinel (name `Recycle Bin`).
- Up: nowhere to go (`browseParent` returns null), so Up is disabled and Backspace goes Back (the existing
  `canBack ? onBack : onUp` rule).
- Back and Forward: the bin is an ordinary history entry (`navigateBrowseState` with the sentinel path).
  Its sort and scroll are remembered like any place.
- Tab title: "Recycle Bin". A tab can be pinned (the pin stores `browse.path`) and restored after restart
  (D5 list). "Open in new tab" from the row opens a tab rooted at Home with the bin as its first history
  entry.
- A bin that is empty: the list's normal empty state with the line "The Recycle Bin is empty." (uses the
  existing empty-folder text component; one new string, pinned by a test).

**D7. Columns, in this order: Name, Original location, Date deleted, Size, Type.**
- A new `binColumns` array in `BrowseList.tsx` (as `searchColumns` is), chosen when `listing.bin` is set.
  Sort keys added to `BrowseSort['key']`: `'from'` (Original location) and `'deleted'` (Date deleted).
  Outside the bin they read as `name` and `modified` (`viewSort`, the way `packed` reads as `size`), so a
  sort never leaks out.
- Default sort: Date deleted, newest first (the Downloads rule, #285: a sort nobody picked there is the
  place's own). File Explorer defaults to Name; newest first is what someone who just deleted something
  wants. The owner can flip it in a sentence.
- Cell content: Original location is the folder only (`C:\Users\Admin\Documents`), with the full original
  path as the cell's title. Date deleted uses `formatWhen`. Size uses `formatBytes`. Type uses `typeLabel`
  (unchanged).
- Folders and files are mixed in the sort exactly as the Name sort does elsewhere (folders first by Name;
  by Date deleted they interleave, as Downloads' date view does).
- Grid (zoom) mode: allowed; tiles show the kind icon and the original name, never a thumbnail (D13).

**D8. Icons.** `KindIcon` by the original extension (the same icons as everywhere), `FolderIcon` for a
binned folder. No thumbnails in the bin (the thumbnail wall `insideDesktopAll` is left exactly as it is).

**D9. Live update.** A new small `src/main/binWatch.ts`: `fs.watch` (non-recursive, `persistent: false`)
on each existing bin folder, 250 ms debounce, one watcher set per tab like `browseWatch`. It emits the
existing `DirChange` shape with `{ root: BIN_PLACE, dirs: [BIN_PLACE] }`, so the existing re-read flow
(`dir-changed`, the loading-bar hold) runs unchanged. `browseWatch` routes the sentinel to it before the
`ownsDesktopDirectory` check. A bin folder that does not exist yet (a drive never binned to) is not
watched; the next focus read (`FOCUS_TRUST_MS`) picks it up. Binning from Prism, from File Explorer or from
another program all show up within about 0.5 s while the bin is open.

**D10. Folders in the bin: shown, never opened.** Double-click and Enter on a binned folder do nothing in
v1. They can be marked, restored and deleted permanently. Reason: opening one means granting the contents
of `$R<id>\` to the wall and showing paths that are not real places. That is a bigger wall decision than
this feature, and Explorer users rarely browse inside a binned folder. Listed in section 9.

**D11. Search.** The search field is not shown in the bin and Ctrl+F does nothing there (the search walk
needs real folders). Type-ahead in the list still works. Listed in section 9.

### What viewing does

**D12. A binned file CAN be previewed in the pane and opened in the viewer, read-only, through a grant
for exactly the entries the listing returned.**
- `pathWall.ts` gets a fourth set, `binReads` (`grantBin(paths)`, `clearBin()`), folded into `readable`
  and `mediaAllowed` ONLY. It is NOT in `editable`, `movable`, `archiveOk`, `archiveReadOk` or `comicOk`,
  so a binned file can be read but never written, renamed, moved, zipped or dragged out through the
  existing IPC.
- The set is REPLACED on every bin listing (it shrinks when the bin does), holds only `$R` paths of the
  returned rows (no `$I`, no `desktop.ini`, no other user's folder), and a `$R` that is now a symlink is
  never granted. Granted by exact path, not by folder: the bin folder is never passed to
  `grantDesktopDirectory`. Defence in depth: `grantDesktopDirectory` and `extendDesktopDirectories`
  refuse any path with a `$Recycle.Bin` segment, with a test.
- A binned file opened in the viewer is a `ViewerFile` with `binned: { from, at }` (new optional field,
  beside `member`). Everywhere `member` makes a file read-only (`App.tsx` 1330 and 1496, `Viewer.tsx`
  113, `ViewerSwitch.tsx` 118, `thumbKind.ts`, `unsupported.ts`), `binned` does the same: no editing, no
  save, no drag-out, no "Open in default app" (a file Prism cannot show shows its card with the
  original location instead of handing a bin path to Windows). The viewer title shows the original name.
- The preview pane and the full viewer reach the file through `fsmedia://`, `file:text` and the other
  `readable` guards, all of which now answer yes for exactly the granted `$R` paths.
- A folder row has no viewer. A kind Prism cannot show shows the existing "cannot show" card.
- `file:text` keeps its 64 MB cap and its reason answers.

### Actions

**D13. Restore.** Puts each `$R` back at its original path with `rename` (same drive, so it is O(1) even
for a folder of a million files) and removes the `$I`. In detail:
- the original folder is missing: it is created (`mkdir recursive`), as Explorer does.
- the name is taken there: the **existing `MoveClashDialog` is reused unchanged** ("X is already there":
  Cancel, Keep both, Replace). Its body text ("Keep both lands them beside what is there; replacing sends
  the old ones to the Recycle Bin") is true for Restore. Keep both restores as `name (2)` (`uniqueNameAsync`
  from `fileOps.ts`). Replace sends the existing item to the bin first (`trashItem`) and then restores.
  Cancel leaves everything in the bin. With several clashes it asks once for all (the dialog already
  counts names), as paste does.
- a restore that fails (locked, access denied, the drive gone): that item stays in the bin and the end
  line says "N of M could not be put back." through the existing `failed` NoticeDialog.
- Restore asks nothing when there is no clash. The restored items are marked where they land (the
  "what an action makes is marked" rule, #101) by `ops.land`, but the bin view itself does not navigate
  away.
- Entry points: the strip's Restore button, the row menu, the Enter key on nothing (see D15).

**D14. Delete permanently.** New dialog `PermanentDeleteDialog` (`src/renderer/src/dialogs/`, one file,
one test), plain and final, Cancel is the primary button (the safe answer is the one Enter picks, as
`ArchiveDeleteDialog` does):
- one item: title `Delete permanently?`, body `"<name>" is deleted for good. Windows cannot put it back.`
  with the name emphasised (`DIALOG_EMPHASIS`).
- several: title `Delete 3 items permanently?`, body `Everything selected is deleted for good. Windows
  cannot put it back.`
- buttons: `Cancel` (primary), `Delete` (danger).
The delete is `fs.rm(path, { recursive: true, force: true })` on the `$R` then `unlink` of its `$I`, one
item at a time, so progress and Cancel work (D17). It is the SECOND permanent delete in Prism (the zip
member delete is the first); docs say so (D20). It is not on the undo stack (like the member delete).

**D15. Empty Recycle Bin.** New dialog `EmptyBinDialog` (own file and test): title `Empty the Recycle
Bin?`, body `Everything in it, on every drive, is deleted for good. Windows cannot put it back.`, buttons
`Cancel` (primary), `Empty` (danger). If the bin view is open the body adds the count taken from the
listing (`Delete 10,000 items for good?` form): the dialog takes an optional `count`.
How: main deletes every `$I`/`$R` pair of this user's bin on every fixed drive itself, with `fs.rm`,
24 at a time, reporting progress and honouring Cancel. This is chosen over `SHEmptyRecycleBin`
because:
- Prism has no native ffi, so `SHEmptyRecycleBin` means PowerShell (`Clear-RecycleBin -Force`) through
  `spawnWorker`: a process start, no progress, no Cancel, and on a 10,000-item bin it can run for
  minutes with the bar stuck at 0.
- The pair deletion is exactly what Windows does underneath; there is no other index to fix up on
  Vista and later (the `$I` files ARE the index). `desktop.ini` is never touched.
- It can be tested against the e2e's own fake bin without touching the real one.
Known cost: Explorer's own Recycle Bin desktop icon may keep showing "full" until its next refresh.
It is listed in section 9 as the one thing to check by hand after the first build. If it proves
bad, the fallback is one `Clear-RecycleBin -Force` through `spawnWorker` AFTER the pairs are gone (it then
has nothing left to walk and finishes in about a second). That fallback is a one-line change and is not
built unless the check fails.
Items another process binned while the empty ran are deleted too if they appear in the second
`readdir` pass; the job ends when a pass finds nothing.

**D16. Keyboard, multi-select, drag, hidden verbs.**
- Delete or Shift+Delete on marked rows: the `PermanentDeleteDialog`. It reuses the list's existing
  Delete key hook (`FolderBrowser.tsx` ~560) with the bin's own handler, so the "keyboard is back in the
  list after a delete" rule holds.
- Ctrl+A, Shift and Ctrl clicks, the sweep box: unchanged (several rows marked is the normal case).
- Enter on a file: opens it in the viewer (read-only). Enter on a folder: nothing. There is no Restore
  hotkey (a hotkey that moves files needs the strip or a menu to be found; the strip is always in view).
- Ctrl+Z after a Restore: undoes it (D18). Ctrl+Z after a Delete permanently or an Empty: nothing to undo
  (they are not on the stack).
- Drag OUT of the bin: not allowed (no `draggable`, no drag payload): a bin path is not a place to
  copy from, and a drop elsewhere would have to move `$R` and leave `$I`. Drops INTO the bin view and onto
  the sidebar row: refused (`dropEffect = 'none'`). Dragging files to the bin row to delete them is a
  possible later feature, not v1.
- Hidden or disabled in the bin: New folder (Ctrl+Shift+N and the toolbar button), Rename (F2), Cut, Copy,
  Paste (Ctrl+V does nothing there, and the clipboard keeps what it had), Duplicate, Pin to Quick
  access, Change icon, Show in File Explorer, Open in, Properties, "Open in new tab" for a row. The bin
  is not a place you write to.
- Copy original path (menu and Ctrl+Shift+C): copies the ORIGINAL full path(s), one per line.

**D17. The loading bar and Cancel.** Restore, Delete permanently and Empty each run through `withFileJob`
(`kind: 'bin'`, verbs `Restoring`, `Deleting`, `Emptying`), so they get the existing 1-second threshold
(`BUSY_AFTER_MS`), the hold on the list (`dirs: [BIN_PLACE]`, plus the destination folders for Restore),
Cancel, and the `finally` that always ends the bar. Main runs them like `fileRestore` does: a job id,
`startCopies(jobId)`, `PUSH.pasteProgress` ticks every `PASTE_TICK_MS`, an `AbortSignal` checked between
items, and a `RestoreOutcome`-shaped reply (`done`, `left`, `cancelled`). Cancel stops between items; what
was done stays done and the end line says `Stopped. Restored 120 of 500.` (`stoppedNote`). The e2e seam
`PRISM_E2E_SLOW_BIN` (ms added per item, `--e2e` only, like `PRISM_E2E_SLOW_COPY`) makes a 40-item job
last long enough to see the bar and press Cancel.

**D18. Undo integration: a mirror of `trash`.** New `UndoEntry` kind `{ kind: 'unbin'; paths: string[] }`, where `paths` are the places the
items were restored TO (after any "name (2)" rename).
- Undo of `unbin`: `trashFile` each path (the same call `duplicate`'s undo and `trash`'s redo use), so the
  item is back in the bin (with a new id).
- Redo of `unbin`: `restoreJob(paths)` (exactly `trash`'s undo).
- It is the exact mirror of `trash`, so the two agree: stack `[trash X]`, restore X from the bin view,
  stack `[trash X, unbin X]`. Ctrl+Z: X goes back into the bin. Ctrl+Z again: `trash X`'s undo restores
  it by path, the same code as today. Ctrl+Y walks it back.
- If the user emptied the bin in between, the existing text applies unchanged: `Windows would not give
  those back. They may have been emptied from the Recycle Bin.`
- Delete permanently and Empty are never on the stack. An older `trash` entry whose item was deleted for
  good fails with that same text when undone. No change needed.

**D19. The sidebar row.**
- `BrowsePlaces.tsx`: after the Quick access `list.map`, inside the same `<section aria-label="Quick
  access">`, one more `<button className="browse-place quick-access-pin" data-bin-place>` (same
  classes, so same look, hover, selection mark, and 225% scale metrics, no new CSS). Label `Recycle
  Bin`. Icon `PlaceIcon name="bin"`: a new entry in `placePaths.ts` using lucide's `trash-2` path (one
  stroke family, same as the other glyphs). Title (tooltip) `Recycle Bin`.
- It is not a pin: not in the pin store, not draggable (`draggable={false}`), no `data-quick-access-path`,
  so pin reordering ignores it, and a pin dropped onto it lands at the end of the section as a drop on
  empty space already does. The section is drawn even when every Known Folder is unpinned (the
  `if (!list.length) return null` rule gets one exception for this row).
- It joins `placeRows` (`row: 'bin'`, `path: BIN_PLACE`) so `markedPlace` marks it while the bin is on
  screen, and `aria-current` follows the existing rule.
- **No count, no empty or full icon.** One icon, always. The owner chose "no count, no extra chrome", and
  a full-or-empty icon would need a bin read at every startup and on every change. No bin read happens
  until the row is clicked.
- Click: `choose('bin', BIN_PLACE)` then `onNavigate(BIN_PLACE)`. Middle click and the menu's "Open in new
  tab" open a new tab (D6).
- Right-click menu (new builder `binPlaceMenu`): `Open`, `Open in new tab`, `Empty Recycle Bin`. There is
  no Unpin row and no way to hide the row in v1 (it is not a pin, and `appOptions.ts` is a CLOSED list;
  adding a setting is the owner's call). Shift+F10 and the menu key work as on the other rows.
- Not on the phone (D21).

**D20. Docs that must change** (the same PRs): `docs/features.md` (a new section, plus the two lines in 0.6),
`docs/menus.md` (three builders), `docs/dialogs.md` (two dialogs and the `Ask` kinds), `docs/ui-direction.md`
(one sentence: the places panel's last Quick access row is the bin), `CLAUDE.md` "Current scope" (one
bullet), `THIRD-PARTY-NOTICES.md` unchanged (no new dependency or binary).

**D21. The phone does not get the bin.** The phone is read-only and browses real folders; the bin is
neither. `src/main/phone/places.ts` and the phone's `Places.tsx` stay unchanged, and a test pins that the
phone's place list holds no `BIN_PLACE`. Section 9 notes the existing exposure of the raw SID folder.

### Menus and dialogs (new files, each with its pinning test)

- `src/renderer/src/menus/binRow.tsx` (+ `binRow.test.ts`), exports:
  - `binRowMenu` (one file): `Open`, `Show in preview`, `Restore`, `Copy original path`, `Delete
    permanently`.
  - `binRowMenu` (one folder): `Restore`, `Copy original path`, `Delete permanently`.
  - several marked: `Restore 3 items`, `Copy original paths`, `Delete 3 items permanently`.
  - `binEmptySpaceMenu` (right press on the list's empty space, the zip's `onEmptyContextMenu` slot):
    `Empty Recycle Bin`, disabled when the listing has no rows.
  - `binPlaceMenu` (the sidebar row): `Open`, `Open in new tab`, `Empty Recycle Bin`.
  Order follows the menus rule (opening, clipboard, changing, delete last).
- `src/renderer/src/dialogs/PermanentDeleteDialog.tsx` and `EmptyBinDialog.tsx` (+ tests). `asks.ts` gains
  `{ kind: 'bin-delete'; paths: string[]; names: string[] }` and `{ kind: 'bin-empty'; count?: number }`;
  `AskDialogs.tsx` draws them; `AskAnswers` gains the answers. Restore's clash reuses `move-clash`.
- `src/renderer/src/components/browse/BinStrip.tsx` (in the zip strip's slot): three plain buttons,
  `Restore` (becomes `Restore 3 items` with several marked, disabled with nothing marked),
  `Delete permanently` (same rule), `Empty Recycle Bin` (disabled when empty). Same strip look as
  `ArchiveStrip`; no new theme tokens.

### Main-side pieces

- `src/main/binRoots.ts`: `binDirs(): Promise<string[]>` (real: the SID folder of each fixed drive that
  exists; seam: see D22) and `trashItem(path)` (real: `shell.trashItem`; seam: write a v2 `$I` and rename
  into the fake bin). `files.ts` replaces its three direct `shell.trashItem` uses with this wrapper, and
  `binRestore.binsOf` and `binIndex` ask `binDirs()`. This makes every delete, restore and undo in a seam
  run stay inside the fake bin.
- `src/main/binList.ts`: the reader (D3), the warm cache, the row builder, `BIN_PLACE` listing as a
  `DirListing` with a new `bin?: true` flag and files carrying `binned`.
- `src/main/binOps.ts`: `restoreItems`, `deleteItems`, `emptyBin`, each taking `(paths, signal, onTick)`.
  Each accepts only `$R` paths in the CURRENT granted set (the same set as the wall) whose parent is one of
  `binDirs()`. A path outside the set is a no-op counted as failed. The renderer can therefore never use
  these channels to delete or move an arbitrary file.
- `src/main/binWatch.ts` (D9), `src/shared/binPlace.ts` (D5).
- IPC (names in `shared/channels.ts`, thin handlers in `ipc/files.ts`, preload and `ipcTypes.ts`):
  `binRestore(paths, onClash, jobId)`, `binDelete(paths, jobId)`, `binEmpty(jobId)`. Replies reuse the
  `RestoreOutcome` shape plus `clashes` for `onClash: 'ask'` (the `MoveResult` pattern: with `ask` nothing
  moves and the clashing names come back).

### E2E seam and safety

**D22. The seam: `PRISM_E2E_BIN_DIRS`**, read only when `--e2e` is on (a unit test pins that it is ignored
without `--e2e`). Value: `|`-separated absolute folders, each standing in for one drive's
`$Recycle.Bin\<SID>` folder. A scenario makes them under its own fixtures folder, named
`...\bin-<scenario>\C\$Recycle.Bin\S-1-5-21-1-2-3-1001` (so the `$Recycle.Bin` segment guard of D12 is
exercised), and fills them with REAL `$I`/`$R` files written by the scenario (v2, and one v1 pair), in the
same drive as the fixtures so `rename` works exactly as in life.
With the seam on:
- listing, wall grants, watch, restore, delete, empty, undo and Prism's own "Delete" (which is
  `trashItem`) all use only those folders.
- the real bin is never read, listed or written. Because `trashItem` is the wrapper, even a scenario that
  deletes through the UI lands in the fake bin.
- `PRISM_E2E_SLOW_BIN` adds a per-item delay for the Cancel scenario.
Every new scenario has its own fixtures folder and removes it in a `finally` (the `downloadsDate` shape).
The suite runs on the hidden desktop and is silent as always (`hidden.mjs`, `--mute-audio`); no new scenario
opens a window or plays sound (preview checks use an image and a text file, never a film).

## 2. Implementation plan: stages

Each stage is one commit group on ONE branch `feat/recycle-bin`, built in order by one workflow overnight;
each leaves `npm run typecheck`, `npm run lint` and `npm test` green and the app working. Tests are written
first and shown failing before the code. E2E scenarios are run while iterating by name
(`npm run e2e -- binRow`), and the WHOLE suite once before the PR is opened (the PR gate). One PR at the
end, version bump from `origin/main` right before the push (the clash rule), install as the last step.

### Stage 0. Seam, parser, reader, speed number (main only, no UI)

Files: `src/main/binRoots.ts`, `src/main/binList.ts`, `src/main/binRestore.ts` (export `ownSid`; `parseInfo`
returns `size`; `binsOf`/`binIndex` ask `binRoots`), `src/main/binRoots.test.ts`, `src/main/binList.test.ts`,
`src/main/binRestore.test.ts` (extended).
Failing tests first (unit):
- `parseInfo` returns size and date for v1 and v2; a truncated, zero-length or unknown-version buffer is
  `null`.
- `binDirs()` returns the seam folders under `--e2e` and ignores the variable without it.
- reader: pairs only; orphan `$R` and orphan `$I` not listed; `desktop.ini` skipped; a symlink `$R` skipped;
  folder versus file from the dirent; original name, folder and date right; two drives; a missing drive
  folder is empty; the warm read reads only new names; 10,000 pairs timing logged and under 5 s.
State after: nothing visible changes. Undo's restore behaves as before (it now asks `binDirs()`, the same
folders in real life).

### Stage 1. The wall and the file operations (main)

Files: `src/main/pathWall.ts` (`binReads`), `src/main/desktopAccess.ts` (refuse `$Recycle.Bin`
segment), `src/main/binOps.ts`, `src/main/ipc/files.ts` (three handlers, `trashItem` wrapper),
`src/shared/channels.ts`, `src/shared/ipcTypes.ts`, `src/preload/index.ts`, tests `pathWall.test.ts`
(extended), `desktopAccess.test.ts` (extended), `binOps.test.ts`.
Failing tests first (unit, against real temp files):
- wall: a granted `$R` is `readable` and `mediaAllowed`; it is NOT `editable`, `movable`, `archiveOk`,
  `archiveReadOk`, `comicOk`; its `$I` is not readable; a second listing replaces the set; a symlink is not
  granted; `grantDesktopDirectory('...\\$Recycle.Bin\\S-1-..')` grants nothing.
- ops: restore puts a file and a folder back, creates a missing folder, removes the `$I`, keeps both on a
  clash (`name (2)`), replaces on request (old one goes to the fake bin), reports a clash with `ask` and
  moves nothing; delete removes `$R` (file and folder tree) and `$I`; empty removes every pair of both
  fake drives and leaves `desktop.ini`; a path not in the granted set is refused; Cancel (an aborted
  signal) stops between items and reports `done` and `left`; progress ticks.
State after: no UI, but the channels work and are fully tested.

### Stage 2. The location (listing, tabs, session, watch)

Files: `src/shared/binPlace.ts`, `src/shared/types.ts` (`DirListing.bin`, `ViewerFile.binned`),
`src/shared/browse.ts` (sort keys), `src/main/explorerListing.ts` (bin hook), `src/main/index.ts` (wire),
`src/main/browse.ts` (`browseWatch` routes the sentinel), `src/main/binWatch.ts`, `src/main/tabs.ts`,
`src/main/tabsSession.ts`, `src/renderer/src/lib/browse.ts` (`browseCrumbs`, `pastedPath` input), 
`src/renderer/src/hooks/useFolderBrowsing.ts` (navigate with the sentinel, tab title), tests
`binPlace.test.ts`, `explorerListing.test.ts`, `tabs.test.ts`, `browse.test.ts` (extended), `binWatch.test.ts`.
Failing tests first (unit): sentinel parse (`Recycle Bin`, `shell:RecycleBinFolder`, case); `isAbsolute` is
false for it and every file IPC refuses it; the listing hook answers it and never writes the listing cache;
saved tabs keep a bin history entry and a bin `browse.path`; crumbs are one "Recycle Bin"; Up is null; the
watch fires `{ root, dirs }` when a pair appears in a fake dir.
E2E (written failing first, scenario `binRow`, part 1): the address field accepts `Recycle Bin`, shows the
crumb, Back and Forward work, the tab is titled Recycle Bin, and a restart (relaunch on the same profile)
brings the bin tab back.
State after: typing `Recycle Bin` opens the listing as a plain list with the default columns (no new
look yet). Nothing is reachable from the sidebar.

### Stage 3. The sidebar row

Files: `BrowsePlaces.tsx`, `placePaths.ts` (the `bin` glyph), `menus/binRow.tsx` (`binPlaceMenu` first),
`menus/binRow.test.ts`, `App.tsx` (no change to `browsePlaces`: the row is not a pin), docs/ui-direction.md.
Failing tests first: unit for `binPlaceMenu` labels in order; a component-level test (or the `places.test.ts`
extended) that the row is the last child of Quick access, has the pin classes, is not draggable, and the
Quick access section is drawn with every Known Folder unpinned.
E2E (`binRow`, part 2): the row is last in Quick access after Videos, same class and height as Videos
(measured, not assumed, at the current display scale), a click opens the bin and marks the row, the menu has
Open, Open in new tab, Empty Recycle Bin, a drop on it is refused, a screenshot `.e2e/shots/bin-row.png`
is looked at.
State after: the row works and opens the (plain) listing.

### Stage 4. The bin view (columns, sort, view, read-only)

Files: `BrowseList.tsx` (`binColumns`, cells, empty line), `BrowseGrid.tsx`/`GridTile.tsx` (no thumbs),
`lib/viewSort`-equivalent (default sort Date deleted desc; `from`, `deleted` keys), `components/browse/
BinStrip.tsx` (buttons present, actions stubbed to "not yet" until stage 5), `FolderBrowser.tsx` (hide
New folder, Rename, Cut/Copy/Paste, drag-out, search, Properties in the bin), `App.tsx` and viewer files for
`binned` read-only (the seven `member` sites), `ViewerFile.binned` set by `binList`, the wall grant called
from the bin hook.
Failing tests first: unit for sort by `from` and `deleted` (both directions, ties by name), the default
sort, `viewSort` mapping outside the bin; `binColumns` order is Name, Original location, Date deleted, Size,
Type; a `binned` file is read-only at each `member` site (one parametrised test); no search field in the
bin.
E2E: `binList` (fake bin with 12 items on two fake drives: columns and header order, cell texts, default
newest first, each header sorts, folder rows have no open, the strip is visible, an empty fake bin says "The
Recycle Bin is empty."), `binView` (a binned .txt and a binned .png preview in the pane, open in the viewer
with Enter, the editor cannot type or save, the viewer title is the original name, a request for the `$I`
file's `fsmedia://` url and for a path outside the grant is refused, the real bin was never read: the app
reports its bin folders through a `--e2e` hook `__prismBinDirs()` that must equal the seam list).
State after: the bin can be browsed, sorted and previewed, read-only. Restore, Delete and Empty do nothing
yet (buttons disabled with a title "Coming in this build" is NOT shipped: they are wired in stage 5; the
branch is not released between stages).

### Stage 5. Actions: Restore, Delete permanently, Empty, undo

Files: `dialogs/PermanentDeleteDialog.tsx`, `dialogs/EmptyBinDialog.tsx`, `dialogs/asks.ts`,
`dialogs/AskDialogs.tsx`, `menus/binRow.tsx` (rest), `hooks/useBinOps.ts` (the three jobs through
`withFileJob`, the clash flow, notes, selection hand-over), `lib/undo.ts` and `lib/undoApply.ts` (the
`unbin` entry), `FolderBrowser.tsx` (Delete key, menus, empty-space menu), `docs/menus.md`, `docs/dialogs.md`.
Failing tests first (unit): the two dialogs' title, text, button order, primary and danger; menu labels per
variant; `undoApply` for `unbin` (undo bins, redo restores, failure text), `undo.test.ts` caps and describe
text; `useBinOps` pure helpers (clash detection, the `name (2)` choice, the stopped note).
E2E (each failing first, own fixtures, `finally` cleanup): `binRestore` (a file and a folder come back to
their original places, the missing original folder is made, the rows leave the list, the restored file is
marked where it lands), `binClash` (the existing dialog appears with the right name; Keep both makes `name
(2)`; Replace puts the old one in the fake bin; Cancel changes nothing), `binDelete` (Del opens the new
dialog with Cancel primary and the wording; Cancel keeps; Delete removes `$R` and `$I` from disk; several
marked say "3 items"), `binEmpty` (menu on the sidebar row and the strip both ask; Empty clears both fake
drives, keeps `desktop.ini`, the list shows the empty line), `binUndo` (Delete a file with Prism, restore it
from the bin view, Ctrl+Z puts it back in the bin, Ctrl+Z restores it through the old path, Ctrl+Y again;
after Empty, Ctrl+Z says the existing "emptied" text), `binBig` (500 pairs written by the scenario with
`PRISM_E2E_SLOW_BIN`: the bar appears after about 1 s, shows a count, Cancel stops it with `Stopped.
Restored N of 500.`, what was restored is on disk and the rest is still listed), `binLive` (a pair written
into a fake dir while the bin is open shows within 2 s; one removed disappears; during a held job the list
does not trickle).
State after: the feature is complete and tested.

### Stage 6. Docs, the record, the whole suite

Files: `docs/features.md` (new section "The Recycle Bin in the Explorer (owner, 2026-11-10)" in the file's
voice: the owner's two choices, every decision above in short form, the measured 10,000-item numbers, and
the tests that hold each; edit the "ONE permanent delete" and "Nothing is destroyed" lines), `docs/menus.md`,
`docs/dialogs.md`, `docs/ui-direction.md`, `CLAUDE.md` (one bullet in Current scope), `ROADMAP.md` if it
lists the bin.
Then: `npm run typecheck`, `npm run lint` (0 errors), `npm test`, the whole `npm run e2e`, the version bump
from `origin/main`, open the PR with the link and a recommendation, wait for the owner's merge answer.
After the owner agrees to the install step: `npm run package`, kill Prism and Prism-Setup, `/S` install,
poll `Prism.exe`'s LastWriteTime, report the installed version. By hand with the real bin (the one check
no test does, on the owner's word): open the row, look at the list against File Explorer's bin, empty
a few throwaway files, and look at the desktop bin icon.
State after: a PR ready for the owner's merge question.

## 3. Test names at a glance

Unit: `binRestore.test.ts` (parse), `binRoots.test.ts`, `binList.test.ts` (including the 10,000 timing),
`binOps.test.ts`, `pathWall.test.ts`, `desktopAccess.test.ts`, `binPlace.test.ts`, `binWatch.test.ts`,
`tabs.test.ts`, `browse.test.ts`, `explorerListing.test.ts`, `binRow.test.ts` (menus),
`PermanentDeleteDialog.test.ts`, `EmptyBinDialog.test.ts`, `undoApply.test.ts`, `undo.test.ts`, the phone
place test (no bin).
E2E: `binRow`, `binList`, `binView`, `binRestore`, `binClash`, `binDelete`, `binEmpty`, `binUndo`, `binBig`,
`binLive`. Add `binRow` and `binList` to `e2e:ui` only if they stay runner-safe (they need no real drive
other than the fixture drive; decide when they exist).

## 4. Risks

- The row, the strip and the columns are visible: LOOK at the screenshots (`bin-row.png`, `bin-list.png`)
  as the CLAUDE.md "a page that works is not a page that looks right" rule says, at 225% scale too.
- Explorer's own bin icon after Empty (D15).
- A Windows build whose `$I` is neither v1 nor v2 would list nothing for those items; the diag line
  `bin-skipped` says how many.
- The `member` read-only sites are seven; stage 4 turns them into one helper `readOnlyFile(file)` so the
  next kind cannot be forgotten.

## 5. Not settled, for the owner

1. Empty by deleting the pairs (D15) rather than by Windows: one hand check of the desktop icon is needed.
2. No search in the bin and binned folders are not opened (D10, D11): fine for v1, or wanted now?
3. Default sort: Date deleted, newest first (D7), against File Explorer's Name.
4. Dropping files on the sidebar bin row to delete them is not built (D16).
5. The row cannot be hidden (D19); a setting would add a row to the closed `appOptions.ts` list.
6. The phone can already browse `C:\$Recycle.Bin\<own SID>` as a plain path. A one-line phone-wall refusal
   of any `$Recycle.Bin` segment is suggested, but it changes the phone, so it is the owner's call and is not in
   this plan.

## Owner's answers (2026-11-10)

- Approved as written.
- Default sort: newest deleted first.
- The phone is blocked from browsing `<drive>\$Recycle.Bin` as a plain path (add this to the plan's stage that touches the phone wall, with a failing test first).

