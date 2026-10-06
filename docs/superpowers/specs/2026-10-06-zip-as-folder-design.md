# Zips open like ordinary folders: design and plan

Issue #300. Branch `feat/300-zip-as-folder`. One approval covers this spec and the plan at the end.

## The owner's words

2026-10-06, choosing option 2 of three: "make zips seem like ordinary folders, they keep the icon but
you open them like any other folder but you get the zip relevant right click menu options. this would
work the same in project mode". After the mockup: "I like the look for zip files, use that".

Approved mockup: `C:\Users\Admin\Documents\Claude\research\prism\2026-10-06-zip-as-folder\index.html`,
screenshots in `shots\` beside it: 01 Downloads with zips and the zip's preview card, 02 the menu on a
zip from outside, 03 inside the zip root (strip, Packed column), 04a/04 a subfolder with a file
previewed after a short unpacking step, 07 the menu on a folder inside, 08 the menu on a file inside,
09/10 project mode (the zip as an expandable tree node, a member open read-only with the note "In
<zip>, read-only. Extract it to make changes." and Extract here).

## What it replaces

Today a zip is a FILE. Selecting it in the Explorer opens `ArchiveView` in the preview pane or the
full view; in a project tab it fills the viewer. ArchiveView is its own world: a centred header with a
verb row, a second breadcrumb (`data-archive-crumbs`), its own cwd that the tab's history never sees,
its own zebra table, its own sort (folders first, name only), its own selection, sweep, Ctrl+A,
Backspace and member overlay with Escape.

After this change there is ONE path in the address bar that continues into the zip, ONE Back/Forward
history, and the normal Explorer list (no zebra, every column sortable, search, the preview pane, the
sweep and multi-select), exactly as for a folder. The zip keeps its zip icon. Inside a zip a slim strip
names the zip, its counts and compressed size, with Extract here and Extract to...; a Packed column
appears only inside zips. Opening or previewing a file inside a zip unpacks just that file to a
session temp folder first.

## Decisions this spec takes (each listed so the approval covers it)

1. **Every archive kind browses as a folder, not only .zip.** `.7z .rar .tar .gz .tgz .bz2 .tbz .xz
   .txz .iso .cab` already list through the same `listArchiveWalled` (bundled 7-Zip), so they get the
   same folder view, READ-ONLY: no Add, Rename or Delete rows, exactly as ArchiveView offers today. A
   zip over adm-zip's 600 MB cap is read-only the same way. Keeping ArchiveView on the desktop for
   these alone would leave two UIs for one idea. Comics (`.cbz`, `.cbr`) are their own kind and are
   untouched. If the owner wants .zip alone, the change is one predicate (`browsableArchive`).
2. **ArchiveView stays, for the phone only.** `phone/PhoneViewer.tsx` mounts it, and the phone has
   its own Browser, routes and e2e (`phoneDocs`). The desktop stops importing it (`App.tsx`'s
   `case 'archive'`, and its own nested-archive branch is then reachable only from the phone). No
   desktop-only code inside it is deleted in this PR, to keep the diff focused; trimming it is a
   follow-up.
3. **A zip handed over by Windows walks the Explorer INTO it** (double-click in File Explorer, Open
   with, argv, a drop on the window). A zip is a folder now, and the "Files from Windows open in"
   setting (preview / full view) is about files. Back returns to where the Explorer was, as today.
4. **The strip has no fill of its own.** The mockup tints it 5% toward the zip colour. Under glass
   that is a second translucent coat over the list's ground, which reads as a darker band, so the
   strip sits on the list's own ground with the `--p-divider` rule under it. Everything else is the
   mockup's.
5. **Menu rows the archive layer cannot do safely are left out**, and the mockup drew three of them:
   - *Rename on a FOLDER inside a zip*: `renameMember` is file-only and the 2026-08-30 note in
     ArchiveView records folder rename as "a decision, not a gap". Left out.
   - *Open with Notepad* (the "Open in" submenu) on a member: the app would be handed a temp copy,
     and whatever it saves is silently lost when the temp folder is cleaned. That contradicts
     "read-only, extract it to make changes". Left out.
   - *Paste (Ctrl+V) into a zip folder*: not in the mockup. `archive:add` could do it, but it is a new
     route; inert in v1.
   Everything else in the mockup's menus maps onto an existing, tested operation (table below).
6. **Opening a member is read-only everywhere.** The editor gets `readOnly` (CodeView already has
   the prop), markdown loses its pencil, and the full viewer and the project viewer carry the note
   bar with Extract here. The preview pane carries no note (mockup 04).
7. **A folder row inside a zip previews as a folder card** (mockup 03, 07: icon, name, "N items",
   its children with sizes). The zip row outside previews as the zip card (mockup 01). A real folder
   outside a zip keeps today's empty preview; giving every folder a card is a separate decision.

## Location model

### Representation

A place inside an archive is ONE Windows-shaped path, what File Explorer itself shows:

```
C:\Users\Admin\Downloads\Wind-0.2.2.zip\Wind-0.2.2\src\main
```

It is the `path` of a `BrowseLocation`, a history entry, a tab's `browse.path`, a crumb, a selected
row's path and a `ViewerFile.path` in a listing. Nothing else in the history model changes:
`navigateBrowseState`, `travelBrowseState`, `searchBrowseState`, `browseParent` and `browseCrumbs`
already work on segments, so the parent of `x.zip\a` is `x.zip` (the zip root) and the parent of
`x.zip` is its folder. Up from the zip root lands in the folder with the ZIP marked (#204's
direct-parent rule, unchanged code).

Which segment is the container is decided by MAIN, never guessed from an extension: a filesystem path
cannot continue past a file, so `archivePlace(path)` walks the prefixes and the FIRST prefix that is a
FILE of a browsable archive kind is the container (a FOLDER named `x.zip` stays a folder). Inside the
container the listing is authoritative: a segment that the listing says is a FILE member of archive
kind is a NESTED container (`outer.zip\inner.zip\docs`). Pure halves in `src/shared/archivePlace.ts`:

```ts
export interface ArchivePlace {
  /** The real container file on disk (outermost). */
  container: string
  /** Inner containers, outermost first, as member paths ('a/inner.zip'). */
  nested: string[]
  /** Forward-slash path inside the innermost container, '' at its root. */
  inner: string
}
export function placePath(place: ArchivePlace): string        // back to the Windows path
export function innerOf(container: string, path: string): string | null
export function levelOf(entries: ArchiveEntry[], inner: string): { folders; files }  // one level
```

The renderer learns the place from the listing's answer: `BrowseDirectory` gains
`archive?: ArchiveMeta`:

```ts
export interface ArchiveMeta {
  container: string          // what the strip, the crumbs' zip icon and the menus name
  display: string            // the innermost container's name ("Wind-0.2.2.zip")
  files: number; folders: number
  packed: number             // compressed size of the innermost container
  unpacked: number
  readOnly: boolean          // 7-Zip formats, an oversized zip, a nested container
  encryption: 'none' | 'zipcrypto' | 'aes'
}
```

`BrowseLocation` gains nothing required. It gains `zip?: string` (the container path) as a hint for
the first frame of a restored tab, so the crumbs can show the zip icon before the answer; main's
answer always wins.

### History, tabs and restore

- History entries inside a zip are ordinary entries. Search inside a zip is a place in the history
  (#281) like any search.
- `src/main/tabs.ts` `parseBrowse` drops every entry that is not `isFolder`, which would drop every
  place inside a zip on restore. It widens to `isPlace(p)`: a folder, or a path whose `archivePlace`
  container exists as a file of a browsable kind (a STAT of the container only, never a read of the
  zip at restore time: restore must stay fast, #271). An inner folder that has since vanished from
  the zip is found at listing time and falls back (Errors, below).
- The project tab's saved `open` tree folders widen the same way, so an expanded zip node and the
  folders under it come back open.
- `sort.key` gains `'packed'`. It is valid only inside an archive; a location outside one reads a
  saved or carried `'packed'` as `'size'` (`viewSort`), so a sort never leaks out of a zip.

### Crumbs and the address field

`browseCrumbs` already yields one crumb per segment. `BrowseToolbar` draws the container crumb (and a
nested one) with the archive icon at crumb size, `--p-tree-zip` like the tree's (mockup 03). Typing or
pasting `...\x.zip\a\b` into the field navigates there (main resolves it). Ctrl+L, the crumb
right-click menu and dropping on a crumb work as for folders; a drop on a crumb inside a zip adds to
the zip at that folder (Drag and drop, below).

## Listing inside a zip

### Main

New `src/main/archiveBrowse.ts` (one responsibility: places inside archives), called from the places
that list folders today, each by ONE branch at its top:

- `browse:directory` (via `explorerListings.browse`): when `archivePlace(path)` finds a container,
  answer from the archive instead of `listNames`. Same `BrowseRead` shape plus `archive`; the answer
  is complete at once (`complete` absent): the container's own listing carries sizes, packed sizes and
  dates, so there is no `browse:details` run.
- `dir:list` (the project tree): the same branch, answering `DirListing`.
- `browse:cached`, `browse:prefetch`: see Listing cache.
- `browse:watch`: inside a zip, watches the container's FOLDER, filtered to the container file; a
  change to the zip (another program wrote it, or Prism's own add, rename, delete) drops main's parsed
  copy and emits `dir:changed` for the place on screen.

The walls: the container must pass `insideDesktop` (the tab's grant of the folder holding it, as
today's `archiveOk`) or, for a container that is itself an extracted member, `extractedPaths` /
the member temp directory (today's `archiveReadOk`). The inner path must exist in the listing.

The read: `listArchiveWalled` as today (adm-zip under the cap, 7-Zip above it and for every other
format), plus `withImpliedFolders` (zips that never wrote folder records). Parsed ONCE per container
and kept in a small in-memory LRU in main keyed by path + size + mtime (8 containers, 200k entries in
all), so walking around inside a zip is a filter over memory, not a re-read. adm-zip's
`new AdmZip(path)` is a `readFileSync` of the whole container on main's thread; the listing reads the
file with `fs/promises` first and parses the Buffer, the shape `extractTo` already uses, so a 500 MB
zip does not stall main while it lists. Measure in the PR: list time for a 15 MB, a 300 MB and a
590 MB zip; if the 590 MB parse itself blocks over 150 ms, zips over 64 MB list through 7-Zip (88 ms
MEASURED on 1.9 GB, 2026-08-31) and keep adm-zip for writes only.

One level becomes a `DirListing`:

- `folders`: `DirEntry` with the virtual path, the folder's name, `mtimeMs` when the container
  recorded one, and NEW `size` / `items` totals summed from the members beneath (so the Size column
  and Size sort work without `folder:size`, which must never be asked about a virtual path).
- `files`: `ViewerFile` with the virtual path, the kind from the member's extension, `size`,
  `mtimeMs`, and NEW optional `packed?: number` and `encrypted?: true`. A nested archive member has
  kind `archive`.
- Hostile names (`..`, a drive letter, an absolute path, an empty segment) are not listed, as
  `listArchive` already refuses them; `safeMemberPath` stays the gate before any extraction.
- Member names are sorted by the Explorer's own `browseEntries` and `sortFiles`, so the numeric
  collator (issue 2 before issue 10) is the one every folder uses.
- Explorer-hidden files: a member is shown whatever its kind, as the Explorer shows every file.

### Renderer

`useFolderBrowsing` is unchanged in shape: `navigate`, `travel`, the cached-first paint, the pending
hint and the error path all work, because main answers the same channel. Three small additions:

- `listing.archive` is kept beside the listing and handed to `FolderBrowser` as `archive`.
- `useFolderSizes` and `useListingPrefetch` skip paths inside an archive (sizes come with the
  listing; a prefetch of a place inside the zip on screen is free in main anyway).
- `openFile` for a member goes to the member route (Preview and open, below), never `openWithin`.

### The Packed column

`BrowseList` grows one column, Packed, right-aligned like Size, present ONLY when `archive` is set
(`data-in-archive` on the list switches the grid template, as `data-row-size` does today). Header
behaviour is #274's: the cell tiles the header, the arrow always in layout, Size and Packed values
right-aligned. Value: `formatBytes(packed)`; a folder's cell is empty, as in the mockup. Sorting by
it is the new `'packed'` key. The narrow layout hides Packed before Type, the old panel's order.

### The strip

New `components/browse/ArchiveStrip.tsx`, one line, 40 px, above the column header, only inside an
archive (mockup 03): the archive icon (`KindIcon kind="archive"` in `--p-tree-zip`), the container's
name semibold, then dim tabular "645 files, 15.6 MB compressed", and at the end Extract here and
Extract to... as neutral row buttons (`ROW_BUTTON`, never the accent, #202). No fill (Decision 4), a
`--p-divider` rule below. Focus is the hover fill, no ring (#272). Extract here shows "Extracted" for
two seconds after success, the old verb row's rule. Read-only formats keep both buttons (extracting
writes to disk, not to the archive). The status bar adds "In Wind-0.2.2.zip" (mockup).

### No stripes

Inside a zip the rows are `.browse-row`, plain ground, the 2026-10-03 "NO STRIPES IN THE EXPLORER"
rule. The zebra lives on only in the phone's ArchiveView.

## Menus per context

The Explorer's row menu is built in App (`browseMenu`). It gains two contexts. Rows below are exactly
what ships; each names the operation behind it.

**A zip (or other archive) row, outside** (mockup 02):

| Row | Behind it |
|---|---|
| Open (Enter) | `browsing.navigate(zip)` |
| Open in new tab | new Explorer tab at the zip path |
| Extract here | `archive:extract-all` with `here` (one-folder rule, extraction window) |
| Extract to... | `archive:extract-all` (main's dialog is the consent) |
| Add files... | `dialog:pick-files` then `archive:add` at '' (zip under the cap only) |
| Copy (Ctrl+C), Copy address, Rename (F2), Delete (Del), Show in File Explorer, Properties | the file's existing rows, unchanged |

Rename of the zip while a tab is inside it: that tab's places now name a path that no longer
exists; they fall back like any renamed folder (Errors). Undo of the rename brings them back.

**A folder inside a zip** (mockup 07):

| Row | Behind it |
|---|---|
| Open (Enter) | navigate |
| Open in new tab | new Explorer tab at the virtual path |
| Extract this folder | `archive:extract-dir` with `here` (stages beside the archive, #166 window) |
| Extract this folder to... | `archive:extract-to` via `archiveExtractMembersTo([folder])` |
| Add files here... | `archive:add` at that folder (writable zip only) |
| Copy folder (Ctrl+C) | `archive:extract-dir` to temp, the folder on the clipboard |
| Delete from zip (Del) | `archive:delete` (whole subtree), the permanent-delete question |
| Show <zip> in File Explorer | `showInExplorer(container)` |
| Properties | the folder's totals from the listing |

Left out: Rename (Decision 5). No Open as project, New terminal here, Pin to Quick access or Use folder
in terminal: none of them has a real folder to act on.

**A file inside a zip** (mockup 08):

| Row | Behind it |
|---|---|
| Open (Enter) | the member route, full view |
| Extract this file | `archive:extract-to` beside the archive |
| Extract this file to... | `archiveExtractMembersTo` |
| Copy file (Ctrl+C) | `archive:extract` to temp, then `copyFilePaths` |
| Rename (F2) | `archive:rename` (writable zip only) |
| Delete from zip (Del) | `archive:delete`, the permanent-delete question |
| Show <zip> in File Explorer | `showInExplorer(container)` |
| Properties | size, packed, saving, modified, encrypted, from the listing |

Left out: Open with (Decision 5).

**Several rows marked inside a zip**: Copy N files, Extract N here, Extract N to..., Delete N from zip
(one question). Folders in the selection are carried by their members, as today.

**Read-only containers** (7z and the rest, an oversized zip, a nested zip): no Add, Rename or Delete
rows anywhere, and F2 and Delete are inert there. The empty-space menu inside a zip: Extract here,
Extract to..., Add files here... (writable), Select all, Show <zip> in File Explorer, Copy address.

**The delete question** keeps the old wording: it is the one permanent delete in Prism, "a zip has no
Recycle Bin". Inside-zip writes stay off the undo stack, as today, except a Prism-row MOVE into a zip
(`archive-in`), which already is on it.

## Preview and open: the member temp folder

### The route

New `archive:member` IPC (`src/main/memberTemp.ts`): `(virtualPath, password?) -> { ok, path, kind } |
{ ok: false, reason: 'password' | 'aes' | 'failed' | 'too-big' }`. It resolves the place, checks the
member against the listing, and extracts ONE member to the member temp folder. Every route through it
uses the ASYNC member read (`memberData`, inflate on the libuv pool, CRC checked; 7-Zip with stdin
closed for AES, 7z and big zips), never `getData` on main's thread.

A member opened, previewed or arrow-paged to is a `ViewerFile` with the VIRTUAL path and
`member: true` in `tab.files`, so paging, the selection, the crumbs and the tab label speak in places
inside the zip. App's viewer switch puts one gate in front of every kind: `MemberGate` (new
`components/MemberGate.tsx`) asks `archive:member`, shows the mockup's unpacking state (a 200 px bar,
"Unpacking caret.ts to show it", only after 150 ms so a small member never flashes it), and then
renders the SAME viewer with the temp path. A password answer raises the existing `PasswordDialog`
(moved out of ArchiveView into its own file, shared by both) and retries; a wrong one says so; the
password is remembered per container for the session in `lib/archivePass`, as today.

`openWithin` is not used for members; a new pure `memberSiblings(listing, virtualPath)` builds the
tab's `files` / `index` from the listing already on screen.

### Lifetime and cleanup

- **Where**: `%TEMP%\prism-members\<pid>-<launch>\`, one folder per Prism run, and under it one
  file per member at `<sha1(container path, size, mtime, member)>\<member name>`, so the viewer's kind
  detection reads the real name and two same-named members never collide.
- **Reuse**: the same member of an unchanged container is not extracted twice in a run.
- **The grant**: the run's folder is granted as a DIRECTORY to the media wall, the reads
  (`file:text` and the other read handlers) and `archiveReadOk`, the `comicsDir` rule, instead of one
  `extractedPaths` entry per member (a Set that never shrinks). `file:write` and every write handler
  never accept it.
- **Cleanup**: at startup, after the first window is up (never on the startup path, #189), remove
  every `prism-members\*` folder whose pid is not alive; at quit, remove this run's folder (best
  effort, a file a player still holds is left for the next start); while running, an LRU cap of 2 GB
  for the run's folder, evicting least recently viewed, never the member on screen or in a mounted
  player (`holders`, `mediaDeck`).
- **Old routes**: today's `prism-zip-*` mkdtemp per member (view, copy) moves onto this folder too, so
  nothing leaks into `%TEMP%` any more. The comics cache and the extraction jobs (#166) are untouched.

### Size limits and large archives

- **Automatic preview** (a click, the arrows, the preview pane) unpacks a member up to 256 MB. A
  bigger one shows a card in the pane (name, size, "Large file. Open it to unpack it.") and unpacks
  only on Open or Enter, with the bar showing real progress (7-Zip's percentage, else bytes written).
  Escape or leaving the file cancels it and removes the partial file.
- **A member bigger than the free space** on the temp drive refuses with "Not enough space to unpack
  this file." (checked with `statfs` before the write).
- **Big containers**: listing as above (once per container, kept). A zip past the 600 MB cap is
  browsed read-only through 7-Zip, as today.
- **Films and tracks inside a zip** play once unpacked; playing state, volume and the deck work on
  the temp path. Arrowing through a folder of films unpacks only the one shown.

### Nested archives

A member of archive kind is a folder too (`outer.zip\inner.zip\docs`). Main unpacks the inner
container into the member temp folder once (same keying, same cap) and lists it from there; a nested
container is always READ-ONLY (it is a temp copy, and a write to it would be lost). Depth is capped at
4: a fifth level shows the error "Archives nested this deep are not opened." The address bar shows the
whole chain, each container crumb with the archive icon.

## Project mode

- **The tree**: an archive row draws as a FOLDER row with the archive icon (mockup 09): a chevron,
  first click selects, second expands, the chevron expands at once (the 2026-08-31 folder rule).
  Expanding asks `dir:list` for the virtual path, which answers from the archive. Folders inside
  expand the same way; the tree's `open` set persists them (Location model). `TreeWindow`, row
  height and `treePaint` are unchanged: these are ordinary rows.
- **A file inside**: a click opens it in the tab's viewer through `MemberGate`, read-only, with the
  note bar above it (mockup 09): the archive icon, "In **Wind-0.2.2.zip**, read-only. Extract it to
  make changes." and an Extract here button (`archive:extract-to` of that member beside the archive,
  then the tree reveals and opens the extracted copy so editing can start). Ctrl+S does nothing, the
  buffer cannot become dirty, and the close question never counts it.
- **The menus** are the Explorer's three contexts (mockup 10 is the zip-outside one). Dropping on an
  archive node or a folder inside adds to the zip; dragging a member onto a real tree folder extracts
  it there (the existing `members` payload).
- **The viewer's own crumb row** (the project viewer's path line) continues through the zip like the
  address bar.
- **A project tab whose current file IS an archive** (a restore, a handoff from before this change):
  the viewer shows the archive card (the preview card, below) instead of ArchiveView; its Open
  expands and selects the node in the tree.

## The preview cards

New `components/browse/ArchiveCard.tsx` (pure props, no IPC of its own), two shapes:

- **Archive card** (a zip row selected outside, mockup 01): header row (icon, name, "ZIP archive,
  15.6 MB"), a 48 px archive icon with the name and "645 files, 33 folders, 15.6 MB compressed", the
  neutral buttons Open / Extract here / Extract to..., "Inside, in <single top folder>" (or "Inside")
  with the top level's rows and sizes, and the facts Unpacked and Modified. Its data is one
  `archive:summary` call (counts, sizes, the first two levels), cached with the listing.
- **Folder card** (a folder inside a zip, mockups 03 and 07): icon, name, "N items", the children.

Both are drawn from the listing main already holds, so selecting is instant. A password-protected
container shows the card with "Password protected" and Open asks.

## Search inside a zip

The search button and Ctrl+F work inside a zip and search THE WHOLE ARCHIVE below the current folder
(the folder-and-subfolders meaning of the Explorer's search). `browse:search` and `browse:suggest` get
an archive branch in main: the query (`shared/searchQuery.ts`, operators and all) runs over the parsed
entries in memory, one answer, no walk, no Everything, `source: 'archive'`; the result keeps the
window shape so paging a big result works unchanged. A hit that is a folder navigates there; a file
opens through the member route. The status line's wording is the existing one.

## Keyboard

Unchanged keys, new places: Enter on an archive row goes in; Enter on a member opens it full view;
Backspace, Alt+Left, Alt+Right and Alt+Up walk the one history (Up from the zip root lands in the
folder with the zip marked); the arrows move and preview; Ctrl+A marks the current folder's rows;
F2 renames a FILE member of a writable zip and is inert on a folder member or a read-only container;
Delete asks the permanent-delete question on a writable zip; Ctrl+C copies out; Ctrl+X and Ctrl+V are
inert inside a zip; F5 re-reads the container; Ctrl+F searches. In fullscreen the writing keys stay
inert (2026-08-28). ArchiveView's own window-level Backspace and Escape listeners no longer exist on
the desktop, which also ends the double handling of Backspace with the Explorer's own.

## Drag and drop

Reusing the payloads that exist (`lib/dragDrop.ts`):

- **Out of a zip**: dragging member rows starts a `members` payload (container, inner paths). Dropped
  on a real folder row, a crumb outside the zip, a sidebar place or a tree folder, it extracts there
  through `archive:extract-to` (one window, #166), as the archive view's drag does today. Dragging to
  Windows' own Explorer is not offered (an internal drag only, as today).
- **Into a zip**: a `files` payload (Prism rows) dropped on a folder row inside a writable zip, the
  list's empty space, the strip or an in-zip crumb is added there (`archive:add`); as today a drag of
  Prism rows is a MOVE (originals binned, `archive-in` on the undo stack) and files from Windows are
  copied. Name clashes ask Cancel / Keep both (the old `addClash` dialog, moved into its own file).
- **Within a zip**: members dropped on a folder of the SAME container move (`archive:move-members`);
  from another container: "That came from another archive. Extract it first, then add it here."
- **Refused** on a read-only container, a password-protected zip ("Prism can't add to a
  password-protected archive."), and an archive dropped into itself, all existing refusals.

The drop line and grey drop fill (#126, #140) apply as on any folder.

## Errors

- **Corrupt or unreadable**: entering it keeps the list where it was and shows the Explorer's own
  error line, worded for it: "This archive can't be read. It may be damaged or incomplete." A member
  that fails its CRC: "Couldn't unpack <name>. The archive may be damaged." in the pane.
- **Password-protected names** (a 7z or rar with encrypted names): entering asks for the password
  first (PasswordDialog), a wrong one asks again saying so, Cancel stays where you were.
- **Password-protected content**: the listing works; the first member opened asks, once per
  container for the session. AES through 7-Zip as today; ZipCrypto through adm-zip.
- **Gone**: an inner folder that no longer exists (the zip was rewritten elsewhere) falls back to the
  nearest folder that does exist inside the zip, then to the zip root, then to the folder holding the
  zip, with the error line naming what was missing. A vanished container is the ordinary "This folder
  cannot be opened" path.
- **Too deep, too big, no space**: the sentences above.

## Listing cache (#271)

A place inside an archive the user OPENED is written to the on-disk listing cache like any folder,
under the same budgets, only when the CONTAINER is on a local fixed drive; `folderMtimeMs` is the
container's mtime, so a changed zip is a miss. The names-only storage rebuilds paths by joining
segments, which works for virtual paths unchanged (unit test). So a tab inside a zip paints from disk
in the first frame after a reboot, as the rule demands. The renderer's in-memory snapshots hold
inside-zip places like any other. Read ahead (#271) never reads a container.

## What does not change

The extraction window and its routes (#166), the one-folder rule, extract-here staging beside the
archive, password memory, the 7-Zip stdin rule, the zip colour (`--p-tree-zip`), the root wall, the
comic kind, the phone, ArchiveView's code, `archive.ts` and `sevenZip.ts` operations (only new
callers, plus the async read and the member temp folder).

## Tests

### Unit (vitest)

- `shared/archivePlace.test.ts`: `innerOf`, `placePath`, `levelOf` (implied folders, numeric order
  left to the caller, hostile names absent), nested chains, a folder named `x.zip` on disk stays a
  folder (with a stubbed stat).
- `main/archiveBrowse.test.ts` against real fixture zips built in the test (adm-zip), a corrupt one
  (truncated bytes), a zip without folder records, a nested zip, `src/main/fixtures/crypto.zip` and
  `aes.zip`: container found by stat, one level answered with sizes, packed, dates and folder totals,
  missing inner refused, traversal names never listed, the LRU invalidated by a new mtime, read-only
  flags, depth cap.
- `main/memberTemp.test.ts`: one member to the run folder, reuse, the 256 MB auto-preview limit, the
  no-space refusal (stubbed `statfs`), Zip Slip names refused before a write, startup cleanup removes
  dead runs only, the 2 GB LRU never evicts a held path, quit cleanup.
- `main/tabs.test.ts`: `parseBrowse` keeps history entries and `open` folders inside an existing
  container, drops them when the container is gone, reads `'packed'`.
- `lib/browse.test.ts`: navigate into a zip and out, Up from the zip root marks the zip, a search in
  a zip is a history place, `'packed'` reads as `'size'` outside.
- `components/browse/entries.test.ts`: sorting by Packed, folders by their summed size.
- `main/listingCache.test.ts`: a virtual path round-trips.
- `lib/archiveMenus.test.ts` (new, pure `archiveMenuRows(context, caps)`): the exact rows of each
  context, writable and read-only, single and multi; it is what the e2e compares against.
- The existing `noFocusRings`, `settingsControls` and `theme.selection` tests cover the new controls
  unchanged.

### E2E (`tools/e2e/run.mjs`, headless runner only)

Parked offscreen, never focused, every scenario reaping its processes, fixtures built under the
scenario's own folder with adm-zip and the bundled 7-Zip (`fixtures.mjs`). Before running: check that
no other Prism e2e run is alive (never two at once), then run the touched scenarios while iterating
and the whole suite before the PR.

New:
- `zipFolder`: an Explorer tab on a fixture Downloads with a zip; double-click goes in; the address
  field shows one crumb row with the zip crumb wearing the archive icon; the strip shows the name and
  counts; the Packed column exists inside and not outside; every row's computed background is the
  same (no zebra); sort by Packed reverses; walk two folders down, Back, Forward, Alt+Up; Up from the
  root lands outside with the zip marked; a text member previews after the unpacking state with its
  text, and an image member draws; Ctrl+F finds a member three folders down and Enter opens it;
  `.e2e-shots/zip-*.png` for the look, which is LOOKED AT before calling it done.
- `zipMenus`: right-click a zip outside, a folder inside, a file inside, and a 7z inside: the rows
  equal `archiveMenuRows` exactly, and the left-out rows are absent.
- `zipWrites`: F2 renames a file member and AdmZip sees it; Delete asks the no-Recycle-Bin question
  and AdmZip loses the entry; Delete on a folder takes its subtree; Add files here (an e2e-only
  `PRISM_E2E_PICK_FILES` answering `dialog:pick-files`) lands in that folder; a Prism row dragged in
  is added and its original binned, then Ctrl+Z puts it back.
- `zipProject`: a project tab whose root holds a zip; the node expands with a chevron; a member opens
  read-only with the note; typing changes nothing and no dirty star appears; Extract here puts the
  file beside the zip and opens it editable.
- `zipRestore`: relaunch with a tab two folders inside a zip: it comes back there, painted in the
  first frame (from the listing cache), with Back still working; then with the zip deleted, the tab
  falls back to its folder.
- `zipNested`, `zipLocked` (ZipCrypto asks once, wrong password asks again, AES through 7-Zip, a 7z
  with encrypted names asks on entering), `zipCorrupt` (the error line, the list left where it was,
  nothing in the console), `zipTemp` (opening members creates files only under the run's
  `prism-members` folder, nothing in `%TEMP%\prism-zip-*`, and the folder is gone after quit).

Migrated (they drive ArchiveView today, by `[data-arc-row]`, `data-archive-crumbs`, the verb row):
- `archiveScenario` becomes `zipFolder` and `zipWrites` (rename, delete, member view, folder walk,
  sweep and Ctrl+A now through the Explorer list).
- `sevenZipScenario`: browse the 7z as a read-only folder, view a member, extract a folder in one
  7-Zip call, no write rows.
- `extractScenario`, `extractWindowScenario`, `extractCancelScenario`, `flatZipScenario`: same
  assertions (one window, Cancel cleans, the password sentence, the one-folder rule, `.e2e/big`),
  triggered from the strip, the outside menu and the inside menus instead of the verb row.
- `markTintScenario`'s zip half: marks inside a zip in the Explorer list.
- `dragScenario`'s archive parts: members out to a folder, rows in, through the list.
- The scenarios that LAUNCH a zip (`launch(zipPath)`): the handoff now walks the Explorer into it, so
  they wait for the Explorer list inside the zip.
- `phoneScenario`, `phoneDocsScenario`: unchanged (ArchiveView on the phone).

## Risks

- **Main's thread on big zips.** adm-zip parses synchronously. Mitigated by the async file read, the
  per-container parse cache and the 7-Zip listing threshold, measured in the PR before it is chosen.
- **Two Explorer PRs in flight** (#295 acrylic, #297 sidebar, #299 themes) touch `browse.css`,
  `FolderBrowser`, `BrowseList` and the preview slot. The new UI is in new files (`ArchiveStrip`,
  `ArchiveCard`, `MemberGate`, `archivePlace`, `archiveBrowse`, `memberTemp`, `archiveMenus`); the
  existing files take small, local branches. Rebased on main before the PR; conflicts expected only in
  `browse.css` and `BrowseList`'s grid.
- **The restore widening.** `parseBrowse` and the tree's `open` accept places inside a container by
  a stat of the container only; a zip rewritten between runs is caught at listing time, not restore.
- **Temp space.** A film inside a zip is unpacked whole before it plays; the 256 MB auto limit, the
  space check and the 2 GB run cap bound it.
- **Behaviour change for anyone used to the panel**: Explorer double-click semantics (single click
  selects) now apply inside zips, which is what ArchiveView already did; the verb row's Copy and
  Rename move to the menu.
- **The phone keeps the old panel**, so the two surfaces differ until a phone decision.
- **Path ambiguity** is closed by main's stat walk; a renderer that guesses from an extension
  (the restored crumb icon) is corrected by the first answer.

## Plan

Built from `origin/main` in `.claude/worktrees/zip-folder`. Each step ends with `npm test`,
`npm run typecheck` and `npm run lint` green; e2e scenarios are run as they come into being, one run
at a time, after checking that no other Prism e2e is running. Version bump inside the PR: 0.89.0 to
0.90.0 (a feature).

1. **The place model.** `shared/archivePlace.ts` + tests; `ArchiveMeta`, `DirEntry.size/items`,
   `ViewerFile.packed/encrypted/member`, `BrowseSort` `'packed'` in shared types; `viewSort` reads
   `'packed'` as `'size'` outside an archive.
2. **Main listing.** `main/archiveBrowse.ts` (stat walk, walls, async read, parse LRU, level to
   `DirListing`, nested containers, depth cap) + tests; branches in `explorerListings.browse`,
   `dir:list`, `browse:watch`, `browse:cached`; measure the 15/300/590 MB list times and set the
   7-Zip threshold; listing cache accepts virtual places.
3. **Restore.** `tabs.ts` `parseBrowse` and `open` widened to `isPlace` + tests.
4. **Member temp folder.** `main/memberTemp.ts` (`archive:member`, run folder, directory grant,
   reuse, limits, cancel, startup and quit cleanup, LRU) + tests; move today's per-member mkdtemp
   routes (view, copy file) onto it; preload `archiveMember`, `archiveSummary`.
5. **Explorer list.** `FolderBrowser` passes `archive`; `BrowseList` Packed column and
   `data-in-archive`; `ArchiveStrip`; status bar "In <zip>"; skip folder sizes and prefetch inside
   archives; crumbs draw the archive icon.
6. **Opening members.** `MemberGate` in App's viewer switch, the unpacking state, `memberSiblings`,
   `openFile`'s member branch, read-only CodeView and markdown, the note bar with Extract here in full
   view; `PasswordDialog` and the clash dialog moved to their own files.
7. **Preview cards.** `ArchiveCard` (archive and folder shapes), `archive:summary`; App's
   `case 'archive'` renders the card; Windows handoff of an archive walks the Explorer into it.
8. **Menus and keys.** `lib/archiveMenus.ts` (pure rows) + tests; App's `browseMenu` contexts wired to
   the existing archive IPC; F2, Delete, Ctrl+C, Ctrl+X/V inert, Ctrl+A, F5 inside archives; the
   permanent-delete question; the empty-space menu.
9. **Search.** Archive branch in `browseSearch` and `browseSuggest` + tests.
10. **Drag and drop.** Member rows start `members`; `onDropInto` and `useFolderDrop` route drops on
    in-archive targets to add / move-members, with the existing refusals and undo.
11. **Project mode.** Tree rows for archives (folder behaviour, archive icon), `dir:list` inside,
    member opens with the note, menus, drops, the viewer's crumb row.
12. **E2E.** New scenarios and the migrations listed above, `PRISM_E2E_PICK_FILES`; the whole suite
    green; look at every `.e2e-shots/zip-*.png` next to the mockup's shots.
13. **Docs.** Prism `CLAUDE.md`: replace the "Archive viewer" paragraph's desktop half with a short
    "ZIPS ARE FOLDERS (#300)" rule (owner's words, the place model, read-only members, the temp
    folder, what ArchiveView is still for) and point here; README's feature list.
14. **Ship.** Package, silent install, launch, report the version (no e2e at install); open the PR
    with the hands-on list (a real Downloads zip, a 2 GB zip, an AES zip, a film inside a
    zip, project mode on a real repo's `dist`), and ask "merge?" once.
