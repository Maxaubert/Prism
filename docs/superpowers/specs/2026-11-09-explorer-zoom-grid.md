# Prism: Ctrl+scroll zoom, from list rows to a thumbnail grid

Spec and implementation plan in one document. Written 2026-11-09 against `.claude/worktrees/open-fixes`
(main at 0.134.0 plus overnight fixes that do not touch the list). Nothing was changed or run; this is reading only.

Owner's words: "in prism let me ctrl scroll to adjust teh size of the list view and go to a grid view where i see
thumbnnails for images and videos, inclding the mov files".
Owner's two choices: **Smooth, like Explorer** (rows get taller in a few steps, then it becomes a grid, tiles keep
growing to a large size, scrolling the other way goes back) and **One size everywhere** (one size for all folders,
surviving a restart).

## 0. What exists today (the facts this design stands on)

- `BrowseList.tsx` (1122 lines) is a virtual list with a FIXED `rowHeight = look.height`, where `look =
  explorerRow(useExplorerSize())`. Sizes are Small 22px, Medium (the tree's default row), Large 40px
  (`lib/explorerSize.ts`, pref `prism.explorer.size`, Settings > Style > Explorer size). Rows, text and icon move together.
- Virtualisation: `first/end = floor(logicalTop / rowHeight) -/+ OVERSCAN`, a `translateY` block, and a `scale`
  that compresses the scroll space once `count * rowHeight` passes 4,000,000px (`spaceHeight`, `logicalTopAt`).
  The wheel listener (line ~445) returns early on `event.ctrlKey`, so Ctrl+wheel is free today. No `setZoomFactor`
  anywhere in `src`.
- Everything addresses rows by INDEX: `rowAt(index)`, `divided.rowOf/entryAt` (Downloads' date groups are
  divider rows of the list's own height that every walk steps over), `pendingFocus`, `selectionPosition`,
  `typed` (type to jump), `stepTo`, `typeJump`, `listKey` (`lib/listKeys.ts`: pure and index-only), `spaceKey`.
- Sweep: `useSweep` + `SweepBand` (an absolutely placed band; on Windows 11 main draws it natively, #338);
  `rowsInBox(box, {…height: rowHeight}, count)` and `nearestRow(py, rowHeight, first, last)` are 1D (Y only).
- Landing marks: `props.landing` (path to percent) draws inert rows with a filling bar; `held` makes the list frame
  `inert` under `BusyBar`, and `useFolderBrowsing` freezes the listing.
- Header: one band of `explorerHeadHeight(size)` with a sort `<button>` per column (`nextSort`); the band's height is
  aligned with the sidebar heading and a text preview's first line (`panelsAlign`, `explorerHeadVars`).
- Thumbnails: `src/main/thumbs.ts` (the phone's grid only, `docs/features.md` "Where thumbnails show: only the
  phone's grid"). Bundled ffmpeg, 320px JPEG (WebP with alpha for formats that can be clear, `thumbAlpha.ts`),
  cache `userData/thumbs` keyed `sha1(path|size|mtime)`, 200MB ceiling with oldest-first eviction, at most 4
  ffmpegs, shared in-flight, `register(child, file)` hooks the holders (#133) so a move or delete kills a thumbnail
  ffmpeg that holds the file. Started through `spawnWorker` `execFile` (main starts no process itself).
  Video: a frame 3s in, first frame as the fallback.
- The wall: `fsmedia://` is served only for a folder the Explorer granted (`desktopAccess.ts`, `ownsDirectly`), an
  archive member main extracted, or something main made itself. Thumbnails are not served to the PC window today.
- HEVC `.mov`: the bundled ffmpeg (BtbN LGPL shared build, `ffmpeg-n9.0.1`) has the native `hevc` decoder (decoding
  needs no extra library, unlike x265 encoding), and the phone path already decodes the owner's iPhone HEVC films.
  The tone-map chain `zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,
  zscale=t=bt709:m=bt709:r=tv,format=yuv420p` is in `phone/hls.ts`, so the build has zscale and tonemap.
- E2E: scenarios are `async function xScenario(fixtures)` registered with `await run(xScenario)` at the foot of
  `tools/e2e/run.mjs`; `explorerSizeScenario` (line 11432) is the pattern for a size scenario that survives a restart.
  The e2e runs on the hidden desktop (`hidden.mjs`); nothing here changes that.

## 1. The feature in one paragraph

In an Explorer tab, holding Ctrl and scrolling (or pinching a precision trackpad) changes ONE zoom value, a step
number from 0 to 9. Steps 0 to 2 are today's Small, Medium and Large rows. Steps 3 and 4 are taller list rows whose
icon becomes a picture (a thumbnail for images and videos). Steps 5 to 9 are a grid of tiles (a square picture with
the name under it) from 96px to 272px. Scrolling the other way goes back. The step is saved once for the whole app
and every folder wears it. The thumbnails are made on the PC by the bundled ffmpeg, cached on disk, and requested
only for what is on screen.

## 2. Zoom steps

| Step | Name | Mode | Row or tile | Picture | Text |
|---|---|---|---|---|---|
| 0 | Small | list | 22px row | icon 12 | 11.5 |
| 1 | Medium | list | tree row (today's default) | icon as today | 12.5 |
| 2 | Large | list | 40px row | icon 18 | 15 |
| 3 | Roomy | list | 56px row | 40px picture | 13 |
| 4 | Roomier | list | 76px row | 60px picture | 13 |
| 5 | Tiles S | grid | 96px tile | 96 square | 11.5 |
| 6 | Tiles M | grid | 128px tile | 128 | 12 |
| 7 | Tiles L | grid | 168px tile | 168 | 12.5 |
| 8 | Tiles XL | grid | 216px tile | 216 | 13 |
| 9 | Tiles XXL | grid | 272px tile | 272 | 13 |

One table, `lib/explorerZoom.ts` `ZOOM_STEPS`, each entry a full look (`kind: 'row' | 'tile'`, `height`/`edge`, `font`,
`icon`, `gap`, `padX`, `thumb`). Tiles: cell width `edge + 2*TILE_PAD(6)`, cell height `edge + NAME_BAND` where the
name band holds two lines of text at `font * 1.35 + 6`, gap between cells 4px, list padding 12px. Never a row
stretched round small text: a step is one look (the rule in `explorerSize.ts`).

Settings > Style > Explorer size keeps its three choices and writes steps 0 to 2. At step 3 or higher the row shows no
choice lit and its description gets "Set with Ctrl and scroll" (the settings copy test caps a description at eight
words: it is eight). The header band uses Large's 36px for steps 2 and up, as today for Large.

Saved: pref `prism.explorer.zoom` (shared scope, an integer, `createPref`, `parse` clamps and turns junk into the
default). When it was never set, it reads from `prism.explorer.size` (small 0, medium 1, large 2), so nobody's
size changes on update. The old pref stays written by the Settings row for downgrade safety. Added to
`src/shared/prefKeys.ts` (`prefKeys.test.ts` pins the string).

## 3. Ctrl+wheel and the trackpad

Pure `lib/zoomWheel.ts` (`createZoomWheel()` returns `feed(event, now) -> steps`), one wheel listener on the list's
scroller (the existing listener's `ctrlKey` early return stays for scrolling; a second branch handles Ctrl):

- `preventDefault()` (non-passive already) so Chromium's own page zoom never fires; also `webFrame` zoom limits are
  left alone (nothing else uses Ctrl+wheel in the Explorer; viewers keep their own Ctrl+wheel zoom).
- Normalise to pixels: `deltaMode 0` as is, lines x 40, pages x 800.
- An accumulator in pixels. One notch of a mouse wheel is 100, and a step needs `STEP_PX = 100`. A touchpad pinch
  arrives as Ctrl+wheel with small, often fractional `deltaY` (|delta| < 50 on the first event of a burst, or a
  non-integer): treated as a pinch, `STEP_PX = 40`, so a full pinch crosses about three steps.
- Up (negative deltaY) is bigger, as File Explorer. The accumulator resets on a pause over 250ms and on a change of
  direction. At most one step per 60ms, so a hard spin cannot skip ten steps on one frame; the remainder carries.
- At step 0 or 9 the accumulator is cleared and the event is still swallowed.
- The same chord from the keyboard: Ctrl+Plus and Ctrl+Equals zoom in, Ctrl+Minus out, Ctrl+0 back to Medium, only
  when the list or a tile has focus (not a field). Stage 1 greps `src` first; if any of these is bound, that binding
  wins and the keyboard route is dropped for it, the wheel is unaffected.

### Keeping the cursor's row in place

`lib/zoomAnchor.ts`, pure: `anchorScroll({ from, to, index, within, pointerY, count, width })` returns the new
`scrollTop`.

1. Before the change, read the layout under the pointer: the item index under `pointerY` (list: `floor((logicalTop +
   y)/rowH)`; grid: row and column from x and y) and `within`, how far down its cell the pointer is (0..1).
   Pointer over blank space (the area under the last row, a gap) anchors on the nearest item.
2. After the render that applies the new step, in `useLayoutEffect` (so no frame paints at the old offset): the
   item's new row `r = floor(index / cols)` (cols is 1 in list), and `scrollTop = r * cellH + within * cellH -
   pointerY`, clamped to `[0, contentH - viewH]`, written through the same path as the list's own scroll
   (`handUp`, so the tab's remembered scroll follows). A grid anchored on an item keeps that item under the cursor
   across list to grid and back; the row it lands in differs because many items share a grid row, and the item
   under the cursor is the invariant.
3. Compressed scroll space (`scale > 1`, over 4,000,000px) uses logical coordinates (`logicalTopAt`), exactly as the
   keyboard's scroll-into-view does; a 10,000-item grid never reaches it (section 5), a 400,000-row list still may.
4. With the pointer outside the list (a keyboard zoom), the anchor is the focused item if any, else the first
   visible one, at the cell's current offset from the top.
5. A change of the list's width (preview pane dragged, window resized) anchors on the first visible item the same
   way, so the grid does not jump under you.

The test is a pure property: for every pair of steps and every index, the item that was under `pointerY` is under
`pointerY` after (within one pixel), unless clamped at the ends.

## 4. Thumbnails on the PC

### 4.1 What gets one

By `fileKind` and extension: **image** (JPEG, PNG, GIF first frame, WebP, AVIF, BMP, TIFF, ICO, PSD and the rest
`thumbs.ts` already sends to ffmpeg), **HEIC/HEIF**, **camera raw**, **video** (mp4, m4v, mkv, webm, avi, wmv, ogv
and **mov, HEVC included**). Not thumbnailed: PDF, office, ebooks, comics, audio, archives, code, text (they keep
their kind icon at tile size). SVG is drawn by the page from the file itself through `fsmedia://` as an `<img>`
(Chromium draws it; main never rasterises it), capped at 2MB, else the icon. Zip members and anything not on disk:
icons (their bytes are not a file; extracting to thumbnail is a library feature, out of scope). Folders keep the
folder glyph, with the picked folder icon honoured as in rows (`useFolderIcons`).

### 4.2 Making one

Extend `thumbs.ts` (the phone's code path must give byte-identical keys and argv at 320):

- **Two tiers by device pixels**: the tile's edge x `devicePixelRatio`, at most 320 uses the 320 tier (the phone's
  own entries are reused, nothing is made twice), above that the 640 tier. A 272px tile on the owner's 225% screen
  needs 612px; 640 covers it. Key: the existing `sha1(path|size|mtime)` for 320, and `sha1(path|size|mtime|640)` for
  640. `thumbWidth` becomes a parameter of `thumbArgs` (default `THUMB_WIDTH`, so existing tests hold).
- **Image**: as today (`scale=W:-2`, JPEG q5, WebP alpha for `thumbKeepsAlpha`). EXIF orientation: ffmpeg applies the
  display matrix by default; Stage 2 proves it with a rotated fixture.
- **Video**: `-ss 3 -noaccurate_seek -i file -frames:v 1`. `-noaccurate_seek` lets ffmpeg take the nearest keyframe
  at or before the seek point and decode only that frame, instead of decoding every frame from the previous
  keyframe up to second 3. On a 4K HEVC iPhone `.mov` that is the difference between about one frame of decode and
  dozens. If the first attempt makes nothing (clip shorter than 3s) the existing second attempt at 0 runs. `-threads 2`
  caps decode threads so one 4K frame cannot take the machine.
- **HEVC `.mov`**: the native decoder, software, no hwaccel (a hardware path adds a device init per process and a
  driver surface for a 0.3s job). iPhone HDR (HLG or PQ, 10-bit): a plain scale of an HLG frame looks flat and dark.
  Pass 1 runs with `-loglevel info` and reads the input stream line ("yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67)")
  from stderr (`isHdr` in `phone/decide.ts` has the two transfers); if HDR, pass 2 runs the same CPU tone-map chain
  as `phone/hls.ts` before the scale. SDR files, the vast majority, are one pass. This costs no ffprobe process.
  Stage 2 measures the owner's own film (a path the owner can drop into the fixture folder is NOT used; see 4.8).
- **HEIC**: Stage 2 first tests `tools/e2e/assets/gradient.heic` through the ffmpeg route (the phone's comment says it
  works). If this ffmpeg build cannot decode HEIC tiles, the fallback is `heicClient` (a worker, `heic-convert`),
  one at a time and only for tiles that are visible, scaled by ffmpeg after (the decode of a full HEIC is the heavy
  part, so it is the slowest tile type and it is last in the queue's priority).
- **Raw**: `rawPreview.ts` already pulls the embedded JPEG; the thumbnail is that JPEG scaled by ffmpeg, in a
  worker, falling through to ffmpeg-on-the-raw if no preview exists.
- A **timeout of 15s** kills any thumbnail ffmpeg (a hung network file); the kill is the same `child.kill` the
  holders use. A failed or timed-out file is a negative result (4.6).

### 4.3 Load limits (a big folder never stalls the app or the disk)

- One queue in main, `ThumbQueue`, in front of the existing `Thumbs.make`. Total ffmpegs at once stay the existing
  `AT_ONCE = 4` ceiling shared with the phone; the desktop may hold **at most 3 of the 4**, so a phone browsing in
  the same minute is never starved, and on a machine with 4 or fewer logical cores the desktop's share is 1.
- Priority: the tile order the renderer sent (nearest the viewport centre first), then the page ahead. A new
  `want` from the same tab REPLACES that tab's queue (section 4.5), so the queue is never longer than about two
  screens (tens of items, not 10,000).
- The renderer asks only after the list has **settled**: 120ms with no scroll event and no zoom wheel. Fast
  scrolling through a 10,000-file folder requests nothing but cache hits.
- Cache probes (is there already a file for this key) are plain async `stat`s with at most 8 in flight; the source
  file's `stat` for the key is the same bound. `exists`/`stat` only, no readdir of the cache on the live path.
- While a **loading-bar hold** is on the tab (`held`), the renderer makes no `want`. While **a film is playing**
  (the renderer knows: the transport is mounted) the desktop's share drops to 1, the performance rule the
  phone comment states ("the pool a playing film reads through").
- Main never waits on the disk: only async fs (`fsp.stat`, `utimes`, `rename`), `// sync-ok` nowhere. Main starts no
  process: `spawnWorker`'s `execFile`, as `thumbs.ts` does; `spawnCalls.test.ts` and `syncCalls.test.ts` stay green.
- Memory: ffmpeg `maxBuffer` stays 4MB; the renderer holds at most 600 decoded `<img>`s (the mounted tiles plus
  a page each way) because it only mounts what is virtualised.

### 4.4 Cache

- Folder `userData/thumbs`, shared with the phone. **Ceiling raised from 200MB to 500MB, trimmed to 450MB**
  (`CACHE_MAX_BYTES`, `CACHE_TRIM_BYTES`; 640px frames are about four times a 320 frame, so 200MB would hold a few
  thousand tiles). Oldest-first eviction by modified time through the existing `CacheBudget`/`toEvict`, running
  once, never two at a time (unchanged logic).
- A hit is touched so eviction keeps what is used, but a touch is skipped when the file was touched within the last
  24 hours, so a screenful of hits is not 200 `utimes` calls.
- **Invalidation is the key**: size and mtime are in the hash, so a changed file is a new key and the old entry
  ages out. Nothing is watched or deleted eagerly. Delete or rename of a file leaves an orphan that eviction takes.
- Startup: stale `*.part` files are removed once, async, off the startup path.
- Failures are not written to disk. A session-memory negative cache (LRU 5,000 keys, `lru.ts`) stops a broken file
  being retried on every scroll; it clears for that key when the file changes (new key).

### 4.5 Asking, cancelling, delivering

Three IPC channels, one new module `src/main/ipc/thumbs.ts` registered like the others in `ipc/`:

- `thumbs:want` `(tabId, gen, items: { path, tier }[])` replaces that tab's pending request set (items not in the new
  list that are still queued are dropped; items already running finish, they are under a second, and are cached for
  next time). Returns `{ ready: { [path]: url } }` for the cache hits at once, so a revisit paints with no
  flicker. Others are queued.
- `thumbs:ready` (main to renderer, `webContents.send`, batched every 50ms): `{ gen, results: { path, url | null }[] }`.
  `gen` is the renderer's counter; a reply from an older generation is ignored. `null` means "no picture".
- `thumbs:cancel` `(tabId)`: on tab close, folder change, hold, or the tab leaving the front; drops its queue.
- A running ffmpeg for a path nobody wants any more is killed only if it has run over 1.5s (4K HEVC), via the same
  `child.kill`; shorter ones finish, because killing and restarting would cost more than letting them end.
- Dedupe: one in-flight job per key across tabs and the phone (the existing `inFlight` map).

### 4.6 What a tile shows

1. **Before and without a thumbnail**: the file's kind icon (`KindIcon`/`FolderIcon`) centred in the picture box, on
   `--p-raised` at low strength, scaled to 40% of the box (never over 64px). No spinner, no shimmer, no layout
   change: the box is the same size before and after.
2. **Arrival**: the `<img>` fades in over 120ms; reduced motion has no fade. `decoding="async"`, `draggable={false}`
   (the tile owns dragging), `object-fit: contain` (the picture is never cropped; the media is the star).
3. **Clear pictures** (`thumbKeepsAlpha`) sit on `.p-checker`, the viewer's own class, once the thumbnail has
   arrived, as the phone's tile does (`phone/thumbClass.ts`).
4. **Video** wears a small play glyph in the box's bottom-left corner (a 20px disc in `--p-side-flat` at 70%, glyph
   in `--p-text`). No duration (it would need a probe per file).
5. **No picture** (`null`: corrupt, unsupported, timed out, DRM): the icon stays, forever for that key, with no
   error mark. An unreadable file is the icon, not a red tile.
6. A **landing** (pasting) file: the icon, faded, with the existing fill bar; no request is made for it.
7. Marked, focused, cut and drop-target looks are the rows' own tokens (`--p-sel-bg`, `--p-sel-tint`, focus ring,
   cut opacity), applied to the whole tile; the name never changes colour for a thumbnail.

### 4.7 The wall

- The renderer never gets a file path to a thumbnail. `thumbs:ready` carries `fsmedia://thumb/<key>` where `<key>`
  matches `^[0-9a-f]{40}\.(jpg|webp)$`. The media handler answers that host BEFORE the root wall by reading only
  `join(thumbsDir, key)` (no traversal is possible: the regex has no separator or dot-dot). Every other `fsmedia://`
  request keeps the wall exactly as it is.
- `thumbs:want` checks each path with `readable(path)` (the root wall) AND `ownsDirectly(tabId, path)` (a direct
  entry of a folder this tab visited, the guard file operations use), and ignores the rest silently. A compromised
  renderer cannot make main read, or thumbnail, a file the Explorer did not list for it.
- SVG tiles load `fsmedia://` of the file itself, which the wall already covers because the folder is granted.
- No new network surface, no new protocol scheme, no new permission. The phone's `/api/thumb` route and its 320
  keys are untouched (`server.test.ts` unchanged).

### 4.8 Bundled things

Nothing new: no new binary, no new dependency, so `THIRD-PARTY-NOTICES.md` does not change. (A HEVC `.mov` test
file for the e2e is generated, see Stage 2; it is a test asset, not shipped.)

## 5. The grid

### 5.1 Layout and virtualisation

A new file `components/browse/BrowseGrid.tsx` (the list file is already 1,122 lines and the grid is not a flag on
it); `BrowseList` renders `BrowseGrid` in place of its row block when the step's `kind` is `tile` and the list is a
plain folder listing (not searching, not `indexedRows`, not an archive member listing, not "This PC"). Everything that
is not about geometry stays in BrowseList and is passed down, so the grid and the list share one source of truth for
selection, focus, rename, drag, drop, menus, landing and hold.

Geometry is a pure function, `lib/gridLayout.ts`:
`gridLayout({ width, count, edge, font }) -> { cols, cellW, cellH, rows, contentH }` with
`cols = max(1, floor((width - 2*PAD + GAP) / (cellW + GAP)))`. Cells are fixed-size and left-aligned (no stretch,
so geometry is deterministic and testable; leftover width is a margin on the right, as Explorer does).
`indexAt(layout, x, y)`, `cellRect(layout, index)` and `rowsWindow(layout, scrollTop, viewH, overscan)` are the only
places a pixel meets an index.

Virtualisation, sized for 10,000 files:

- Mounted rows = visible rows + 2 overscan above and below; mounted tiles = that times `cols`. At 96px tiles in a
  1,500px list that is about 14 columns x 14 rows, under 200 tiles. The upper bound is held by a unit test
  (`mounted <= (viewH/cellH + 5) * cols`).
- 10,000 files at 96px tiles and 14 columns is 715 rows x 124px = 89,000px of scroll height; at 272px with 4
  columns, 2,500 rows x 316px = 790,000px. Both are under Chromium's element height limit and under the existing
  4,000,000px compression threshold, so the grid reuses the list's `spaceHeight`/`scale` code unchanged as a safety
  net for odd cases (the grid's `rowHeight` is `cellH`); a test pins 1,000,000 files do not break the layout.
- Tiles are absolutely placed inside a `translateY` block per mounted row window (same technique as the list), keyed
  by path, so a scroll recycles DOM by key and an image already decoded is not re-decoded.
- No per-tile observers and no per-tile `getBoundingClientRect`. One scroller, one `ResizeObserver` on it (the list
  has this), and the thumbnail requests come from the mounted window (section 5.6).
- Downloads' date groups (`dividers`) do not draw in the grid (a full-width header between tile rows would make
  the index to cell map irregular); the sort stays by date, the groups return when the zoom returns to a row step.
- The scroll position, selection and focus are the tab's own and survive a step change through the anchor (3).

### 5.2 Arrow keys in two dimensions

`lib/gridNav.ts`, pure, tested with the same style as `listKeys`: `gridStep(count, cols, from, key, edge?)`:

- Left and Right: minus or plus 1, stopping at the first and last item (Explorer does not wrap).
- Up: minus `cols`; on the first row it stays. Down: plus `cols`; if that is past the end and the current item is not
  in the last row, it goes to the last item (Explorer does this); in the last row it stays.
- PageUp and PageDown: `cols x (visibleRows - 1)`, clamped; Home and End: first and last. With nothing focused,
  Down and Right land on 0, Up and Left on the last, as `stepTo` does.
- Ctrl+arrow moves focus without marking (`focus-*`), Ctrl+Space toggles the focused item's mark (`toggle-mark`),
  Shift+arrow extends the marks over the INDEX RANGE from the anchor to the new focus. In a grid, Explorer's Shift
  extends a range in index order, not a rectangle, and the existing `extend-*` model is already an index range,
  so Shift selection needs no new model. `listKey` gains no new keys; for Left and Right it is the grid that decides
  (below).
- Ctrl+A, Escape, Alt+Up, Alt+Left, F3, Alt+Enter, Ctrl+Enter, Delete, Enter, F2 are `listKey` and BrowseList's own,
  unchanged.

**Left and Right in the list stay the viewer's** (owner, 2026-09-01: they reach the viewer). In the grid they move
the focus (a grid has no other way to go sideways). This is the one key behaviour that differs by mode; see
decision 6. The preview pane keeps its own keys when it has focus.

**Up and Down walking the folder** in an OPENED file (the viewer, not the Explorer list) stays index-order: the
grid is not on screen then, and +/-1 in folder order is the sorted order the grid also shows row by row. Coming
back to the Explorer scrolls the opened file into view in the grid (the existing return-to-list reveal, computed
with `cellRect`).

### 5.3 Type-ahead, rename, Space

- Type to jump: unchanged (`typeJump`, `isJumpKey`, `typedRun`, `spaceKey` are index and name based). The jump
  scrolls the target tile into view with the same reveal.
- Space (preview toggle) and the Quick Look window: unchanged; in the grid the preview pane sits to the right as
  now and its width changes the number of columns (anchor 3.5).
- Rename (F2, slow click, the menu): `BrowseRename` renders in the tile's name band, centred, the width of the cell,
  one line, selecting the name without its extension as in a row. The band does not grow; a long name scrolls inside
  the field. Escape cancels, Enter commits, as in a row. Held by a test that the field sits inside the tile's
  rect and that no layout shifts while it is open.

### 5.4 Sweep, Shift and Ctrl selection, drag

- **Sweep**: `useSweep` stays (it is geometry-agnostic: `fromList/toList` map pointer to list coordinates); what
  changes is the callback that turns a box into paths. A new `cellsInBox(box, layout, count)` returns the indexes
  whose TILE RECT (the cell minus the 4px gap margin, name band included) intersects the box, computed from the
  box's column and row spans, not by scanning all 10,000 (the same discipline as `rowsInBox`). `nearestRow` becomes
  `nearestCell`. The sweep starts only on blank space: the gaps, the right margin and under the last row.
  Autoscroll at the edges uses the existing code. Ctrl+sweep adds (`sweepAdd`), as now.
- **Click selection**: click selects one; Ctrl+click toggles; Shift+click marks the index range from the anchor; the
  existing `props.onPick(entry, {ctrl, shift})` is called by the tile exactly as by a row. No new selection model.
- **Drag out**: a press-drag on any part of a tile (picture or name) starts the same drag a row does
  (`setDrag`, `noteReady`, `DRAG_MIME`); a marked tile drags all marks. The drag ghost is the native one main starts
  (`dragOut.ts`); in the page the dragging tiles dim as rows do. Under `--e2e` no OS drag starts (existing rule), so
  the e2e covers the carry through the in-app route.
- **Drop**: a folder tile is a drop target through `folderDrop(entry.path, …)` exactly as a folder row (the move/copy
  rules D1 to D10 are untouched, including "a drop onto one of the carried tiles shows no-drop"). Blank space and
  the list frame drop into the current folder as now. A hovered folder tile lights its ring.

### 5.5 Right-click menus

Every menu builder in `menus/` is unchanged and a tile calls the same ones: `explorerRowMenu` for an item,
the blank-space menu for the gaps. Blank-space menu gains ONE row: "Show as grid" when the zoom is a row step
(sets the step to 6), "Show as list" when it is a grid step (sets Medium). `docs/menus.md` and the menu's pinning
test get that row; no other menu changes. Shift+F10 and the Menu key open the focused tile's menu at the tile's rect.

### 5.6 Sort headers in grid mode

The header band keeps its height (`explorerHeadHeight`, so the sidebar heading and a text preview's first line stay
on one baseline, `panelsAlign`). In a grid the columns would be meaningless, so the band shows the same sort
`<button>`s (Name, Date modified, Size, Type; the same labels, `nextSort`, `aria-label`s and the always-present
arrow) packed to the left at their natural width with 16px between, no column alignment. Same classes, so the sorted
arrow, hover and tooltips are as in the list. Horizontal overflow: the buttons wrap by hiding the lowest-priority
ones in order (Type, Size) below 360px of list width; Name and Date modified always stay.

### 5.7 The loading bar's hold and landing marks

- A hold (`held`) makes the list frame `inert` under `BusyBar` and freezes the listing: the grid lives inside that
  frame and renders from the frozen listing, so it does not move, re-sort or request thumbnails while held. When the
  hold lifts, one fresh read commits and `thumbs:want` resumes after the settle delay.
- Landing marks: an entry in `props.landing` becomes an inert, faded tile with `data-landing`, `aria-busy`, and the
  existing fill bar drawn as a 4px bar across the bottom of the picture box with "Copying…" as the name band's text
  (the rows' wording); its percent updates redraw only that bar (the rows' rule: a percentage tick re-sorts nothing).
  The "rows are for the first second" rule (`trimLanding`) is unchanged: past one second the bar covers the list.
  Landing tiles take no thumbnail request; they get theirs when the real file arrives.

## 6. The phone

Unchanged. `server.ts`, `/api/thumb`, its 320px JPEG/WebP, its `a=1` cache key and its route tests are not edited.
The phone's grid code shares only `thumbs.ts`; the 320 tier produces the same keys and argv (a test compares the
argv and key of the new `thumbArgs(file, kind, out, seek, 320)` byte for byte to the old one). The raised cache
ceiling is shared and only helps it.

## 7. Performance rules and CLAUDE.md compliance

- Main never waits on the disk: async fs only in `thumbs.ts` and `ipc/thumbs.ts`; no `*Sync` (`syncCalls.test.ts`).
- Main starts no process: `execFile` from `spawnWorker` only (`spawnCalls.test.ts`).
- Nothing synchronous on the renderer's scroll path beyond arithmetic: layout is pure maths; the wheel handler does
  arithmetic and one state write; image requests are debounced.
- Idle cost of the feature when the zoom is a row step below 3: zero new work (no thumbs module activity, no new
  listeners except one wheel branch).
- The e2e stays headless on the hidden desktop; nothing here shows a window. Install is the last step of the work
  (Stage 7), after the whole e2e is green before the PR.

## 8. Decisions made without asking

1. Ten zoom steps; the first three ARE today's Small, Medium, Large, so nothing about the three Settings choices
   changes. Steps 3 and 4 are list rows with pictures (so the transition is gradual), then five tile sizes.
2. The saved zoom is a new shared pref `prism.explorer.zoom`; `prism.explorer.size` is the fallback seed and is kept
   written by the Settings row (so a downgrade still works).
3. Ctrl+wheel up is bigger, as File Explorer. A mouse notch is one step; a trackpad pinch crosses about three.
   Plus/Minus/0 keys are added only if unbound.
4. Tiles show the picture whole (`contain`), never cropped, with the file's name under it in two lines; fixed-size,
   left-aligned cells.
5. Thumbnails only for images, camera raws, HEIC and videos. SVG drawn by the page. PDFs, comics, audio covers and
   zip members stay icons (the viewer, not a library).
6. In the grid, Left and Right move the focus. In the list they still reach the viewer (owner, 2026-09-01). This is
   the only per-mode key difference, and it is what makes a grid usable; if the owner wants Left and Right to keep
   reaching a playing preview, the fix is to give the preview a click-to-focus rule, not to take them away from the grid.
7. Shift+arrow selects an index range (Explorer's grid behaviour), so the selection model is untouched.
8. In a folder grid, Downloads' date groups are not drawn; sort order is kept.
9. The grid is for plain folder listings only. A search result, an Everything-indexed window of results, an archive
   member listing and "This PC" stay rows at the current step's row height (steps 5 to 9 use Large's 40px there).
10. Two thumbnail sizes (320 shared with the phone, 640) chosen by tile edge x device pixel ratio.
11. Video frame by `-ss 3 -noaccurate_seek`; HDR is detected from ffmpeg's own stderr and tone-mapped in a second
    pass, so no ffprobe process is added. No hardware decode.
12. Desktop uses at most 3 of the 4 ffmpeg slots (1 on 4-core machines or while a film plays); requests wait for
    the list to settle for 120ms.
13. Cache ceiling raised from 200MB to 500MB (trim to 450MB). Not configurable.
14. Failures are remembered in memory per key, not on disk; a broken file shows its icon with no error mark.
15. One new row in the blank-space menu ("Show as grid" or "Show as list"), no submenu.
16. The e2e HEVC fixture is a committed 64x64, 1 second `.mov` (about 10KB) made once with an ffmpeg that has an
    HEVC encoder (the bundled LGPL build has none), named in the assets README; the scenarios generate every other
    fixture with the bundled ffmpeg.
17. The feature record goes in `docs/features.md` under a new heading, the look in `docs/ui-direction.md`, the menu
    row in `docs/menus.md`.
18. Version: one minor bump (0.135.0) in the last stage's PR. Stages are stacked branches, each its own PR merged in
    order, each needing the owner's own yes to merge as always. The grid stays hidden behind a cap until Stage 6.

## 9. Implementation plan

Branches `feat/zoom-1` to `feat/zoom-7`, stacked. Each stage: failing test first (the unit test, then the e2e
scenario named for it), the change, typecheck + lint (0 errors) + unit tests, the scenarios that cover the
change while iterating, and the WHOLE e2e before a PR is opened or pushed (the gate). A stage's scenario builds its
own fixture folder under `.e2e/<name>/` with the bundled ffmpeg (image, video, a rotated JPEG, a clear PNG), and
removes it in a `finally`. Every scenario reaps what it started. `ZOOM_MAX_AVAILABLE = 4` until Stage 6, so no
user can reach a half-built grid.

### Stage 1: the zoom model, the wheel, the saved step (list steps 0 to 4, no pictures)

App state after: Ctrl+wheel resizes the rows through five steps, anchored, saved, and the Settings row still works.
Steps 3 and 4 show bigger kind icons (no thumbnails yet).

Files: new `lib/explorerZoom.ts` (steps, pref, seed from the old size, `zoomIn/zoomOut/atStep`), `lib/zoomWheel.ts`,
`lib/zoomAnchor.ts`; edit `lib/explorerSize.ts` (`explorerHeadVars` reads the step), `shared/prefKeys.ts`,
`components/browse/BrowseList.tsx` (`look` from the step; the Ctrl branch; the layout-effect anchor; the keys),
`components/browse/FolderBrowser.tsx` (`rowLook`), `App.tsx` (`headVars`), `components/settings/ExplorerPage.tsx`
(the three choices write steps 0 to 2; none lit above), `settings/settingsCopy` text.
Unit (all written first, failing): `explorerZoom.test.ts` (table shape: heights ascend, steps 0 to 2 equal the old
looks; parse clamps junk; seeding from `small|medium|large`), `zoomWheel.test.ts` (mouse notch = 1 step; pinch
fractional = about 3 per pinch; reversal resets; 60ms limit; pause resets; ends clamp), `zoomAnchor.test.ts` (the
invariance property above for list-to-list), `prefKeys.test.ts` (the new string), `settingsCopy.test.ts`.
E2E: `zoomList` (fixture: 120 small files). Ctrl+wheel up x3 from Medium: row height read off the DOM is the step's
height at each; the row under a fixed pointer is the same file before and after (the y delta within 1px); wheel
down returns; at 0 and 4 extra events change nothing and the page's zoom factor stays 1; restart with the same
profile: the step is back; a second folder opens at the same step; the Settings row lights Large at step 2 and none at 3.

### Stage 2: the thumbnail engine in main (no UI)

App state after: the phone works as before; main can make, cache, queue and serve PC thumbnails; no renderer
caller yet except the test hook.

Files: edit `main/thumbs.ts` (width parameter, tier key, `-noaccurate_seek`, HDR second pass, timeout, negative LRU,
24h touch rule, ceilings), new `main/thumbQueue.ts` (priority, replace-by-tab, cancel, the 3-of-4 share, the film
and core-count rules; pure scheduling core plus the class), new `main/ipc/thumbs.ts` (`want`, `ready`, `cancel`,
walled by `readable` + `ownsDirectly`), `main/mediaProtocol.ts` (the `thumb` host, key regex, before the wall),
`preload` (the `window.prism.thumbs` API), `main/index.ts` (wiring, `.part` cleanup), `ipc/context.ts`.
Unit (first): `thumbs.test.ts` extended (320 argv and key byte-identical to the old; the 640 key differs; the video
argv has `-noaccurate_seek` and `-threads 2`; the HDR detector over sample stderr lines of HLG, PQ and SDR; the
timeout kills); `thumbQueue.test.ts` (nearest first; a new want replaces the tab's queue and drops queued items
only; the share of 3; 1 on a 4-core or while a film plays; dedupe across tabs; cancel); `mediaProtocol.test.ts`
(the `thumb` host serves only a valid key, refuses `..`, a separator, a wrong extension, a missing file; every other
host still goes through the wall); `ipc/thumbs.test.ts` (a path outside the roots, a path not a direct entry of a
visited folder, and an archive member are ignored); `thumbEviction` for 500MB; `thumbs.imageEncode.ffmpeg.test.ts`
style integration with the real ffmpeg for a rotated JPEG (orientation applied), a clear PNG (WebP alpha), an HEIC
(`gradient.heic`; decides the HEIC route by its result), a raw with an embedded preview if a fixture exists.
E2E: `thumbsEngine` (fixture: JPEG, rotated JPEG, clear PNG, GIF, mp4, the committed HEVC `.mov`, a 0-byte "jpg", a
text file renamed `.jpg`). Through `page.evaluate` it calls `window.prism.thumbs.want` for the lot: every good file
gets an `fsmedia://thumb/…` URL that loads as an image of the right orientation and width 320; the 0-byte and the fake
get `null`; the mov frame is not black; asking again is answered from the cache with no new ffmpeg (the diag counter
for thumbnail runs does not move); a path outside the folder is refused; renaming a file while 40 thumbs are queued
succeeds (the holders kill the holder); changing a file's mtime makes a new URL; 200 `want`s for distinct files never
show more than 3 ffmpegs at once (the existing process count diag), and the app's input stays responsive.
Measured and written down in `docs/features.md` in this stage: the owner-style HEVC frame time, the HDR path, the
HEIC route taken.

### Stage 3: pictures in the list rows (steps 3 and 4) and the tile parts

App state after: Ctrl+scroll to step 3 or 4 shows real thumbnails in the Name column's picture slot.

Files: new `components/browse/ThumbImage.tsx` (the picture box: icon, fade-in, checker, play glyph, `contain`,
`decoding=async`), new `lib/useThumbs.ts` (the renderer half of 4.5: it takes the mounted entries, waits for the
settle, sends `want` with a generation, applies `ready`, holds the per-folder path-to-url map, cancels on
folder change, hold, tab hidden), `lib/thumbKind.ts` (which entries get one; pure; the SVG rule), edit
`BrowseList.tsx` (the picture slot for `look.thumb > 0`), `browse.css` (`.browse-thumb*`).
Unit (first): `thumbKind.test.ts` (every extension class in `fileKind` is classified; the SVG size cap; zip members
and folders excluded), `useThumbs.test.ts` (settle debounce: scrolling sends nothing, stopping sends one want;
older generations ignored; hold sends nothing and cancels; a null result is remembered; the map clears on folder
change), `ThumbImage.test.tsx` (states: before, arrived, none, alpha gets the checker, video gets the glyph).
E2E: `thumbsList` (own fixture of 30 images and videos incl. the `.mov`, 10 other files): at step 3 the image rows
show a loaded `<img>` whose natural width is 320 and whose box is 40px; the `.mov` row shows a non-black picture
(sampled pixels); a text file row shows its icon; scrolling a 400-file folder fast sends no `want` until it stops
(count of `thumbs:want` in the diag log); a corrupt image keeps its icon; a clear PNG row has the checker.

### Stage 4: the grid (layout, virtualisation, click, scroll, sort strip)

App state after: the grid is built and tested but NOT user-reachable: `ZOOM_MAX_AVAILABLE` stays 4 (a test-only
pref lifts it for the unit and e2e runs), so no build has a grid without sweep, drag and rename. Stage 6 flips it
to 9. The grid's keyboard in this stage is Up/Down/Home/End by index (replaced in Stage 5).

Files: new `lib/gridLayout.ts`, `components/browse/BrowseGrid.tsx`, `components/browse/GridTile.tsx`,
`browse.css`/`grid.css`; edit `BrowseList.tsx` (hand off to the grid for tile steps on plain folder listings; header
strip), `lib/zoomAnchor.ts` (grid cases), `FolderBrowser.tsx`, `lib/useThumbs.ts` (tier by tile edge x dpr).
Unit (first): `gridLayout.test.ts` (cols at several widths, `indexAt` and `cellRect` are inverses, `rowsWindow` bounds,
mounted-tile bound, 10,000 and 1,000,000 items), `zoomAnchor.test.ts` (list-to-grid and grid-to-list and width
change keep the item under the pointer), `gridHeader.test.ts` (the strip shows the same buttons and sort calls).
E2E: `gridBasic` (fixture: 2,000 mixed files in 3 subfolders, generated with tiny files): Ctrl+wheel to step 6: tiles
appear, columns equal the maths for the measured width; thumbnails load for the first screen and not for tiles far
down; scrolling to the end and back keeps mounted tiles under the bound (DOM count); clicking selects, Ctrl+click and
Shift+click mark; double-click on a folder tile enters it and on an image opens the viewer; the header strip sorts by
Date modified and the tiles reorder; the pointer anchor holds across list to grid and back; the step survives
a restart in the grid; resizing the preview pane changes the columns and keeps the first visible item.

### Stage 5: keyboard in the grid

App state after: the full keyboard model works in the grid.

Files: new `lib/gridNav.ts`; edit `useListKeyboard.ts` and `BrowseList.tsx` (the key switch picks `gridStep` when
the step is a tile and the listing is a grid; `listKeys.ts` is not edited), the reveal (`cellRect`), page keys,
Shift/Ctrl semantics.
Unit (first): `gridNav.test.ts` (Left/Right/Up/Down at the edges and in a partial last row; the "Down goes to the
last item" rule; Page keys; Home/End; no focus), `gridKeys.test.ts` (Shift+arrow gives the index range; Ctrl+arrow moves
focus only; Ctrl+Space toggles; type-ahead and `spaceKey` are unchanged in the grid; Left/Right in the LIST still
fall through to the viewer).
E2E: `gridKeys` (own fixture of 50 files): arrows move in two dimensions, measured by which tile has the focus ring;
Down from the last-but-one row's short tile lands on the last item; Shift+Down marks a range; Ctrl+arrow then
Ctrl+Space marks a non-adjacent tile; typing "ph" jumps to the first name that starts so; Space toggles the preview
pane; Enter opens; Up/Down in an opened image walks the folder in order and Back returns with the opened tile scrolled
into view; in the list at step 1 Left and Right still reach the viewer.

### Stage 6: sweep, drag, drop, rename, menus, hold, landing marks, and the cap flips to 9

App state after: the whole grid is user-reachable.

Files: new `lib/cellsInBox.ts`; edit `BrowseList.tsx`/`BrowseGrid.tsx`/`GridTile.tsx` (sweep callbacks, drag and
drop handlers, `BrowseRename` placement, menus incl. Shift+F10, hold/landing look), `menus/` blank-space builder
(+ pinning test), `docs/menus.md`, `lib/explorerZoom.ts` (`ZOOM_MAX_AVAILABLE = 9`).
Unit (first): `cellsInBox.test.ts` (boxes over gaps select nothing; a box inside one tile selects it; spans over
rows and columns; the name band counts; 10,000-item box is a span computation, not a scan), `landingGrid.test.ts`
(percent tick redraws the bar only), menu pinning test.
E2E: `gridSweep` (sweep over tiles marks exactly the tiles whose rect the box touches; Ctrl-sweep adds; a press in a
gap starts a sweep and a press on a tile does not; autoscroll while sweeping), `gridDrag` (the in-app drag of a marked
tile set onto a folder tile moves, with Ctrl copies, onto a carried tile shows no-drop, onto the blank grid drops into
the folder; folder-tile hover ring), `gridRename` (F2 in a tile: the field is inside the tile rect, extension not
selected, no layout shift, Enter renames and the tile keeps its place per sort), `gridMenus` (right-click on a tile,
on a gap, Shift+F10; "Show as list" goes to Medium and "Show as grid" to step 6), `gridHold` (a 600MB paste into the
grid folder: past one second the bar covers the grid, the tiles stand still, landing tiles carry the bar, no thumbs
requested while held, they resume after; Cancel works), `gridPhone` (the phone page still lists and shows its own
thumbnails).

### Stage 7: the 10,000-file folder, docs, release

App state after: shipped.

Files: `docs/features.md` (a new entry in the file's voice: the owner's words, the two choices, the dates, every rule
above, what tests hold it; and the line "Where thumbnails show: only the phone's grid" corrected to include the
Explorer), `docs/ui-direction.md` (the tile look, the steps), `docs/menus.md`, `README` screenshots line if the
`readme` skill finds one stale, `package.json` 0.135.0, `THIRD-PARTY-NOTICES.md` unchanged (verified: nothing bundled).
E2E: `gridBig` (a 10,000-file folder generated by the scenario, 9,000 tiny valid PNGs with distinct content and 1,000
others): entering the folder paints within the existing listing budget; a fast scroll from top to bottom keeps the
frame times under the `lagProfiler` limits and mounted tiles bounded; no more than 3 ffmpegs ever; thumbnails for the
final viewport arrive within a few seconds of stopping; app memory (`process.memoryUsage` via diag) does not grow with
scroll distance; the disk does not get a readdir of the cache per tile (counted); closing the tab cancels the queue
(no ffmpeg left after a second).
Then: whole unit suite, typecheck, lint (0 errors), the WHOLE e2e once, PR, owner's yes to merge; after the merge,
`gh run list` to check the release workflow (lint failed one before); install is the last verification:
`npm run package` from a real `node_modules`, kill Prism and Prism-Setup, run the installer `/S`, poll
`Prism.exe`'s LastWriteTime, launch after setup exits, report the installed version.

## 10. Risks and what to look at first

- HEIC route (Stage 2 decides by measurement). The fallback adds a serialized worker path.
- A 4K HDR HEVC thumbnail in the second pass is the slowest case (a CPU tone-map of one frame); bounded by the 15s
  timeout, the 3-slot share and only running for visible tiles.
- Left and Right differ between list and grid (decision 6); the owner may want the preview's seek keys reconsidered.
- Chromium may deliver a precision-touchpad pinch as Ctrl+wheel with different magnitudes by driver: the `STEP_PX`
  values are constants in `zoomWheel.ts`, tuned in the Stage 1 hands-on check on the owner's trackpad if it has one.
- The 225% display: every geometry number is in CSS px and the tier choice uses `devicePixelRatio`; the Stage 4
  scenario measures tile boxes after render, never assumes constants (memory: measure UI alignment).
