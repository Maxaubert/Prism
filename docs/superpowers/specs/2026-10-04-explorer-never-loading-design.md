# Prism Explorer: never a loading screen (design + plan)

Owner, 2026-10-04: "I don't ever want to see that ... not even if you launch it from a restart of
the PC, or it's your first time after installing the program."

## The rule

The Explorer list is never replaced by a "Loading folder…" message. On launch and on every
navigation, the list shows rows for the target folder on the first frame (from a cache) or within
one frame of a names-only read (0.1–3 ms for folders up to 5000 entries, measured). The only
fallback is the already-laid-out list (header, columns, status bar) with the previous folder's rows
kept, and a thin progress hint after 300 ms. `Loading folder…`, `Loading…` and
`data-testid="window-restoring"` over the Explorer are removed, and an e2e asserts that no loading
element ever appears.

## Why it shows today (from the code path report)

1. Startup discards the listing main already read. `restoreTabs` reads `t.root`, not `t.browse.path`,
   sends only `files`, and nothing seeds `useFolderBrowsing`. The renderer reads the folder again
   (`index.ts:762-806, 1543-1552`).
2. The restore is serial. The first Explorer rows wait on every saved tab, each project payload and
   each Claude transcript lookup (`index.ts:737-815`).
3. No persistent cache exists. `visitedDirectories` is memory-only (24 folders), owned by one tab and
   cleared on every tab switch (`visitedDirectories.ts:20-25`).
4. `navigate` sets `setLoading(!cached)` at once, and `FolderBrowser.tsx:389` passes `[]` while
   loading (`useFolderBrowsing.ts:187`, `FolderBrowser.tsx:192, 419`).
5. `listDir` stats every file, 16 at a time, before any row is sent. That takes 17 ms for 2000 files,
   41 ms for System32 and 94 ms on a 3000-entry first touch. Names alone take 0.6, 2.0 and 1.6 ms.
6. `warmFolderSizes` runs 2 `realpathSync` per subfolder before the reply leaves
   (`index.ts:2260`, `desktopAccess.ts:48`, `dirList.ts:28`).

Windows Explorer avoids it the same way (Raymond Chen, Old New Thing). It enumerates on a
background thread, shows items as they arrive (Vista on), and keeps the old view up until the new one
starts filling.

## Design

### A. Names first, details after (fixes new folders)

- `listDir` gets a `phase` split. The `names` phase is `readdir(withFileTypes)` plus a sort by name, with
  kind from the extension (`fileKind` is a pure lookup) and size and mtime absent. The `details`
  phase stats in the background: the first visible ~60 rows first (2.6 ms for System32), then the
  rest. It sends `browse:details` patches in batches of about 500 or every 50 ms.
- `browse:directory` replies with the names phase. The reply type gets `complete: false`.
- The renderer merges patches into `result` by name. Size and date cells show blank (not "0 B")
  until filled. The size sort is the one sort that needs details. While they are pending, the sort
  falls back to name order and re-sorts once when they arrive, without moving the selection or the
  scroll anchor.
- `warmFolderSizes` and `prefetchIndexed` move behind `setImmediate` after the reply, and the
  `insideDesktop` filter switches to async `realpath`, so the reply never waits on them.
- Later option, not phase 1: a bundled, long-running FindFirstFileEx helper returns everything in
  one pass (3.6 ms for System32, 62 ms for WinSxS). Phase A already brings every normal folder under
  5 ms, so this waits until a measurement says it is needed.

### B. A persisted listing cache (fixes launch, reboot and tab switches)

- New `src/main/listingCache.ts` writes `%APPDATA%\Prism\listing-cache\` as one file per folder
  (`<sha1(lowercased path)>.json`) plus `index.json` (path, folder mtime, savedAt, hits, bytes). It
  uses the temp-file-then-rename write that `folderSizeCache.ts:212` already does.
- What it stores: the names-phase listing and the last known details (size, mtime) for each entry,
  and the folder's own mtime.
- What gets in: every folder a tab shows, Quick access and pinned places, and home, Desktop,
  Documents, Downloads and drive roots.
- The budget is 200 folders, 2,000 entries each (larger folders store only their first 2,000 names
  in sorted order and are marked `partial`), and 20 MB in total. It is LRU weighted by hits.
  Quick access places are pinned in the cache.
- Read path: main loads `index.json` plus the files for the restored tabs synchronously before
  `createWindow`, which takes a few ms for a handful of 100 KB files. They are handed to the page
  with the first `open:file`, or through a new sync `browse:cached` the renderer can call for any path.
- Reconcile: every cached paint triggers a real read (names phase). If the folder's mtime equals the
  cached one, only the details are revalidated. Otherwise the rows are diffed in place, keyed by
  name, keeping the selection and scroll. Rows are never blanked.
- The renderer cache becomes app-wide: `createVisitedDirectories` loses the single-tab owner
  (key = path, not tab), so a tab switch is an instant hit. The limit rises to 64 folders and 100k rows.

### C. Startup order

1. Before `createWindow`, read the listing cache for every Explorer tab's `browse.path` (not
   `root`).
2. The restore sends Explorer payloads FIRST, with `browse.path` and the full cached
   `BrowseDirectory` (folders and files). Project payloads, Claude sessions and `pendingOpen` follow,
   each sent as it is ready (parallel with `Promise.allSettled`, not a serial loop). `open:restored`
   no longer gates the Explorer; `restoring` covers only tabs not yet sent.
3. `newTab` hands the payload's listing to `useFolderBrowsing` as its initial `result`. The first
   frame of the tab is the cached rows.
4. The Explorer's live reads go next. `warmIndexer`, the Everything probe, folder sizes and
   thumbnails start after the first `browse:directory` reply, or after 1.5 s, whichever is first.
   They compete for libuv's 4 threads and must not queue in front of the listing.
5. First run after install, or no cache entry: the home read in the names phase is 1–3 ms, done in
   main before `ready-to-show`, so the window opens with rows. The boot shell (`#prism-boot`) stays
   as the window's skeleton, not an Explorer loading message. It already draws before React, and the
   restore changes above make it last tens of ms.

### D. Navigation never blanks

- `navigate` on a miss keeps the previous folder's rows rendered, dimmed to 60% after 120 ms. The
  address bar commits the new path at once. If the names phase has not answered within 300 ms (no
  measured normal folder does: WinSxS is 26 ms), the list becomes empty but keeps its header, and a
  2 px indeterminate bar runs under the header with the status bar saying "Reading folder". An
  unreadable or timed-out folder shows its error in the list body, as today.
- Remove `entries={props.loading ? [] : entries}` and the "Loading folder…" and "Loading…" strings.
  `loading` becomes `pending: 'none' | 'quiet' | 'slow'`, driven by a 300 ms timer.
- A cache hit or a prefetched hit paints synchronously in `navigate`, before the IPC.

### E. Prefetch

- A new main-side `prefetchListing(paths)` runs at most 2 at a time, names phase plus first-screen
  details, into the in-memory and disk caches. It is cancelled by any real navigation.
- What triggers it:
  - Hovering a folder row for 150 ms, or selecting one with the keyboard.
  - The parent of the current folder (so Up is instant).
  - The top 8 Quick access and recent places, at idle after launch.
  - The first 12 subfolders of the current folder when it has 30 or fewer, at idle.
- It skips UNC and network paths, removable drives that are asleep, and any folder over 5,000
  entries. Network paths and sleeping drives can stall, and a large folder is not worth reading speculatively.

### F. Per-entry extras off the critical path

Sizes (`useFolderSizes`), thumbnails, the preview and the search index already start after the rows
exist. They now also wait for `details` to finish for the visible window, and they never run on the
navigation's own tick. Icons stay the static glyphs by kind, so they need no lookup.

## Risks

- **Staleness.** A cached listing can be wrong for one frame or a few ms, until the reconcile or
  `fs.watch` corrects it. Opening, renaming or deleting a row that is gone fails with the existing
  "no longer exists" path and triggers a refresh. Mitigation: the reconcile always runs, and the
  in-place diff animates nothing.
- **Memory.** The renderer cache is capped at 100k rows (about 20 MB of JS objects). Main keeps only
  the index in memory.
- **Disk.** A 20 MB cap on the cache, evicted LRU. Clearing the cache is safe at any time.
- **Privacy.** The cache lists file names and sizes of folders the user opened. It is local only,
  under the per-user `%APPDATA%`, never synced or sent. It needs a Settings switch ("Remember folder
  contents for instant opening", default on) and a "Clear" button. Turning it off deletes the folder.
  It is excluded for removable and network drives, and for any folder the app was told is private
  (if that concept exists). It must be named in the privacy statement if Prism has one.
- **Correctness of names-first.** A partial row (no size yet) must not be treated as 0 bytes by
  selection totals, sorting or copy-conflict checks. The type carries `size?: number`, and every
  consumer handles absent.
- **libuv pool contention.** Background stats still compete with sizes and thumbnails. The details
  phase runs at most 8 at a time and yields to the next navigation.

## Headless tests (Prism e2e, `tools/e2e/run.mjs`)

All of these run under `--e2e` with a seeded profile.

1. **`noLoadingEver`.** A `MutationObserver` is installed through a preload hook before the page
   loads (`addInitScript`). It records any node with text matching
   `/Loading folder|Loading…|Opening Prism/` inside `[data-browse]` and any
   `[data-testid=window-restoring]`. Then the scenario launches, navigates 20 folders (fixtures:
   empty, 1, 2000, 5000 files, deep path, Unicode names), switches tabs, goes back and forward, and
   relaunches. It asserts zero recordings.
2. **`coldLaunchCached`.** Seed the profile with tabs.json (an Explorer tab on fixture `F`, not its
   root) and a listing cache for `F`. Launch and measure from `performance.timeOrigin` to the first
   `.browse-name` text equal to a known name. Assert under 400 ms after `ready-to-show` and that the
   first painted row set equals the cache. Then modify `F` (add a file) before launch, and assert the
   new file appears within 500 ms without the list ever emptying.
3. **`coldLaunchNoCache`.** Use a fresh profile (first run). Assert rows appear in the home fixture
   with no loading element, within 600 ms of `ready-to-show`.
4. **`newFolder2000`.** Create 2000 files, navigate in, and assert the first row is in the DOM within
   50 ms of the click (via `requestAnimationFrame` timestamps in page). Size cells fill within 500 ms.
   Assert the selection and scroll were not reset by the details patch.
5. **`slowFolderHint`.** An e2e-only hook (`PRISM_E2E_LIST_DELAY=800`) delays the names phase. Assert
   that the previous rows stay until 300 ms, then the header plus the progress bar show, and no
   loading text appears.
6. **`tabSwitchInstant`.** Use two Explorer tabs. Switching paints rows in the same frame (no IPC
   awaited), which proves the app-wide cache.
7. Unit tests: `listingCache` (budget, eviction, atomic write, corrupt file ignored, pinned places
   kept), the names/details merge reducer, the in-place diff that keeps selection, and the prefetch
   limiter.

Cold-disk timing after a real reboot cannot be done headless. It goes on the hands-on list: reboot,
launch, watch.

## Implementation plan (ordered; one feature PR, version minor bump)

1. **Names-first listing.** In `src/main/dirList.ts`, add `listNames(dir)` and `statDetails(dir, names,
   order)`. In `src/shared/types.ts`, make `ViewerFile.size` and `mtime` optional and add
   `complete`. Add tests to `dirList.test.ts`.
2. **Details stream.** In `src/main/browse.ts` and `index.ts`, `browse:directory` replies with names.
   A new `browse:details` event sends patches (tab, path, generation). In `src/preload/index.ts`, add
   `onBrowseDetails`.
3. **Unblock the reply.** In `index.ts:2255-2270`, move `warmFolderSizes`, `prefetchIndexed` and
   `warmIndexer` after the reply. In `desktopAccess.ts` and `dirList.ts`, switch `canonical` to async
   `realpath` for that filter.
4. **Renderer merge.** In `src/renderer/src/lib/useFolderBrowsing.ts`, apply detail patches. In
   `BrowseList.tsx`, show blank cells while pending. The sort falls back as described. Also
   `selection` totals.
5. **App-wide visited cache.** In `lib/visitedDirectories.ts`, remove the tab owner and raise the
   limits. Adjust `useFolderBrowsing.ts:64, 91, 330`.
6. **Never blank.** In `useFolderBrowsing.ts:187`, add the `pending` state and the 300 ms timer. In
   `FolderBrowser.tsx:192, 389, 419`, keep the old rows, dim them, add the header bar, and delete the
   loading strings. Add a CSS rule for `.browse-progress`.
7. **Persisted cache.** Add a new `src/main/listingCache.ts` plus a test, and `browse:cached` (sync)
   in preload. Write after each completed read and debounce it.
8. **Startup order.** In `index.ts` `restoreTabs` and `restoreWhenListening`, use `browse.path`,
   send Explorer payloads first with the full cached `BrowseDirectory`, and run the rest in parallel.
   In `lib/tabs.ts` `newTab`, carry the listing. In `useFolderBrowsing`, seed `result` from it.
   Defer the indexer, sizes and thumbs until the first reply or 1.5 s.
9. **Prefetch.** Add a new `src/main/listingPrefetch.ts` (limiter, skip rules). In the renderer,
   add hover and selection triggers in `FolderBrowser.tsx` and `BrowseList.tsx`, and idle triggers
   for Quick access and recent.
10. **Settings and privacy.** Add the "Remember folder contents" switch and Clear, and add a line
    to the privacy statement.
11. **E2E scenarios** 1–6 in `tools/e2e/run.mjs`, plus fixtures in `tools/e2e/fixtures.mjs`. Then
    install the branch build for the hands-on check (reboot, first run after install, Win+E).

Tasks 1–6 alone remove the loading screen for navigation. Tasks 7–8 remove it at launch.

## Open questions for the owner (each with a recommendation)

1. **Persist folder listings to disk?** File names are saved in `%APPDATA%`. *Recommend: yes, on by
   default, with a Settings switch and a Clear button. Never for network or removable drives.*
2. **Cache budget.** *Recommend: 200 folders, 2,000 entries each, 20 MB.*
3. **Showing a cached list that may be a few ms stale.** A deleted file can flash, then go.
   *Recommend: accept it. That is what makes reboot and first frame instant, and the reconcile
   follows at once.*
4. **Blank size and date cells for a moment in a new folder** (instead of waiting 17–94 ms for
   all of them). *Recommend: yes. Pursue the native FindFirstFileEx helper only if blank cells are
   noticed.*
5. **Speculative prefetch on hover** (extra disk reads the user didn't ask for). *Recommend: yes,
   local fixed drives only, at most 2 at a time.*
6. **The boot shell "Opening Prism…" before React.** That is the window starting, not the Explorer.
   *Recommend: replace its text with a silent skeleton of the Explorer layout (title bar, places
   rail, empty header), so even that frame doesn't read as loading.*

## Owner decisions (2026-10-04)

The owner approved this design and plan, parts A to E, with all six recommendations above as
written ("yes implement the fix for the loading issue"). Recorded so nobody asks again:

1. **The listing cache is on disk**, on by default, local only, with a Settings switch
   (Settings > General > Remember folders) and a Clear button. Never for network or removable
   drives.
2. **Budget**: 200 folders, 2,000 entries each, 20 MB.
3. **A cached list may be stale for a moment** and is corrected at once by the read that
   always follows it.
4. **Size and date cells may be blank for a moment** in a new folder.
5. **Read ahead on hover**, local fixed drives only, at most 2 at a time.
6. **"Opening Prism..." is replaced** by a silent outline of the Explorer layout.

Part F (the native FindFirstFileEx helper) is DEFERRED: it waits for a measurement that says
names-first is not enough.

## As built (PR for #271)

Where the build differs from the text above, or fills in what it left open:

- **Names first** is `listNames` and `statDetails` in `src/main/dirList.ts`; the run, the
  cache write and the read ahead are `src/main/explorerListing.ts`. One details run per tab: a
  newer read of the same tab stops the older run between stats ("yields to the next
  navigation"). A read made only for its grant (opening a file from the tree, a drop, a shell's
  folder report) passes `details: false` and starts no run, so it cannot take the disk from the
  folder on screen. The details run 8 stats at a time; the read ahead 4.
- **`ViewerFile.size` and `mtimeMs` are optional** (absent: not yet known). `DirListing.complete`
  is `false` while patches are due. Every consumer handles absent: the size cell is blank, the
  status bar shows a total only when every marked size is known, a size or date sort is name
  order until the last patch and then re-sorts once, the image preloader treats unknown as it
  always treated 0.
- **The renderer's merge** is `lib/listingMerge.ts` (pure): `carryDetails` keeps the sizes a
  revisit already knew (recommendation 3), `applyDetails` lays a patch over the rows in place.
  The rows keep their paths and their name order, so the selection and the scroll have nothing
  to lose; the `newFolder2000` e2e holds both across a patch.
- **The listing cache** is `src/main/listingCache.ts`: one compact file per folder (names, sizes,
  dates; paths and kinds are rebuilt on the way out), `index.json`, atomic writes, a corrupt
  file is a miss. It lives under the profile that owns the window preferences, and a second
  Explorer window (Win+E) reads it and never writes. Drive kinds come from WMI
  (`src/main/driveKinds.ts`), asked once after the first listing; until then only the system
  drive counts as local fixed, which covers home on a first run. Home, Desktop, Documents,
  Downloads, Pictures, Music and Videos are pinned, and so is every Quick access folder once it
  is opened. It holds the folders the user OPENED and nothing read ahead (see the review below).
- **Startup**: the restore sends the Explorer tabs first, each with its cached listing or a
  names-only read of the folder it SHOWS (`browse.path`, the root only as a fallback), and the
  project tabs after, in parallel, each as it is ready. Claude session slots are decided in strip
  order first, so the parallel lookups give each tab the same conversation the serial loop did.
  Each payload carries `restoreOrder` and the page puts each tab back at its saved place
  (`addRestoredTab`). The page seeds its snapshots from the payload before the tab exists, so
  its first frame has rows. The indexer warm-up and the drive-kind probe wait for the first
  Explorer answer or 1.5 s.
- **The renderer's snapshots** (`lib/visitedDirectories.ts`) are one app-wide store, 64 folders
  and 100,000 rows. A miss in memory asks the disk cache synchronously (`browse:cached`, under
  1 ms MEASURED for a miss) while rendering, so a folder from an earlier session paints in the
  frame it is asked for.
- **Navigation**: `usePendingHint` gives `none`, `quiet` (the old rows stay, dimmed after
  120 ms by CSS) and `slow` (past 300 ms: no rows, the header, a 2 px bar, the status line
  "Reading folder"). The address bar shows the target at once. The search list's placeholder
  row for a result still on its way is blank.
- **Read ahead** (`src/main/listingPrefetch.ts`, `lib/useListingPrefetch.ts`): a folder row
  under the pointer for 150 ms, a selected folder, the parent, the first 12 subfolders of a
  folder of 30 entries or fewer, the first 8 Quick access folders once a session. Main refuses
  anything not on a local fixed drive and any folder over 5,000 entries; a real navigation drops
  everything still queued.
- **Not done from the text above**: the `insideDesktop` filter was not moved to an async
  `realpath`; it now runs after the reply leaves (`setImmediate`), which is what kept it off
  the reply. The design's "first-screen details first" is the first 60 files in name order,
  not the rows the current sort puts on screen.
- **Found on the way**: `sortFiles` compared with `localeCompare(.., { numeric: true })`, a
  fresh collator per comparison. MEASURED in `newFolder2000`: 42 to 58 ms from the
  double-click to the first row of a new 2000-file folder before the hoisted collator, 25 ms
  after.

## Review, and what changed (2026-10-04)

A review of the first build found eight things. Each was checked against the code; seven were
fixed and one in part.

1. **An offline share could hold the whole restore.** The restore read the folder an Explorer tab
   SHOWED, which the old one never did, and a share that has gone answers only at the SMB
   timeout. Fixed: that read has 750 ms, then the root stands in (as before) and the page reads
   the folder itself. The root keeps its old unlimited read.
2. **An Explorer tab that hosted Claude waited on the transcript scan, and so did every tab
   after it.** In part: the other tabs now wait for the Explorer tabs at most 500 ms, and every
   transcript lookup starts at the top, overlapping the listing reads. That tab's own payload
   still waits for its lookup, because its shell starts with the session id and a resume of the
   wrong session, or none, is worse than a late tab.
3. **The saved active tab could take the front after the window was in use.** Fixed: it takes
   the front only while nobody has clicked or typed in the page.
4. **Read ahead wrote to the cache on disk**, which the README says holds the folders you open,
   and each read ahead counted as a hit, pushing out the folders a cold launch needs. Fixed: read
   ahead lives in the page's memory only.
5. **A folder that had gone stayed in the cache, and its rows under the error.** Fixed: a failed
   read drops the folder from the cache (only when the folder itself is gone, not for a closed
   tab), and the page stops showing the disk's rows once the read has failed.
6. **Back or Forward to a folder held nowhere blanked the list at once.** Fixed: the rows of the
   folder it left stay until the read answers, the same rule as a navigation.
7. **Files the index did not name were never removed** (a kill inside the index's 500 ms delay,
   a write cut short), a details run in flight could write a folder back just after Clear, and a
   locked file failed Clear without a word. Fixed: the start sweeps every file the index does not
   name, a write that began before a Clear is dropped, and Clear deletes what it can file by file.
8. **The tests could miss things.** Fixed: a second probe runs as a frame preload under the e2e
   (`tools/e2e/earlyProbe.js`, `PRISM_E2E_EARLY_PROBE`), so it watches from before the page's
   first script; the check for a testid that no longer exists is gone; `newFolder2000` now also
   opens a new folder sorted by size and asserts the order moves exactly once and the scroll and
   the selection survive it.

## Measured (e2e, this machine, warm disk, 2026-10-04)

| | before (origin/main) | after |
| --- | --- | --- |
| Loading text or restoring screen seen at launch | "Opening Prism..." and `window-restoring` every launch | none, in 20 moves and every launch |
| First Explorer row after the first paint, launch from the cache | 71 to 81 ms (no cache existed) | 50 to 72 ms |
| First run, no cache | not measured on the old build (it read the real home) | 75 to 104 ms |
| New 2000-file folder, double-click to first row | 46 ms | 25 ms |
| Tab switch to rows, every read held 800 ms | (old build has no hold; 27 to 47 ms real) | 8 to 20 ms |

On a warm disk the old build was rarely slow; the screens the owner saw come from a cold disk
after a reboot and from the restore waiting on every saved tab. Both are on the hands-on list:
reboot, launch, watch; and a first run after a fresh install.
