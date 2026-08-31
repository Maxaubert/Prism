# Prism

A fast, universal media viewer for Windows. Open a file, view or play it, arrow through the
rest of the folder. The "quick look" Windows never shipped.

## What it is

Electron (Windows App via electron-builder) + React 19 + TypeScript + Vite + Tailwind v4, x64
only, Windows 10 1809+ / Windows 11. Self-contained NSIS installer, per-user, unsigned,
distributed via GitHub Releases. Same stack as its sibling **Filesmith**, on purpose.

## Audience

Anyone who double-clicks a file and wants it open now, looking good. Prism replaces the
mediocre built-in Windows Photos / Media Player for everyday viewing. Not a pro tool, not a
library manager, not an editor.

## UI direction

Dark, quiet viewer chrome so the media is the star: near-black frameless window, a single
indigo accent (`#5b5bd6`), minimal controls that fade when not needed. The Prism monogram +
indigo tie it to the Filesmith family without copying its light utility look. Don't add a
light theme or editing tools without an explicit decision. The file-tree sidebar (2026-07-31)
was such a decision: a navigation panel bounded by the folder Prism opened in, not a library.

## Scope

**In scope (v1, the universal quick-viewer):**

- Open via: a file argument (Explorer double-click / "open with" / CLI), drag-and-drop, and an
  open dialog.
- **Image** viewer: fit / zoom / pan / rotate / fullscreen; common formats natively, HEIC/HEIF
  through a pure-JS libheif worker, and (2026-08-24) Targa, PCX, Photoshop, OpenEXR, DPX, SGI,
  DDS, PNM, JPEG 2000, QOI, Radiance HDR and X BitMap through `imageDecode.ts`, which asks the
  bundled ffmpeg for one PNG frame and caches it by path+mtime. Camera RAW (2026-08-24,
  `rawPreview.ts`) shows the full-size JPEG the camera embedded, found by scanning for the
  LARGEST JPEG in the file - which is what Explorer and every fast viewer show. It is NOT a
  development of the sensor data; that needs LibRaw, a native module Prism does not have.
- **Video** player: play / pause / seek / volume / fullscreen, frame-step, and a transport
  settings cog (2026-08-12): speed, loop, autoplay (next video in the folder, skipping other
  kinds), sidecar subtitles (`.srt`/`.vtt` matched by name beside the file or in `Subs/`,
  SRT converted to WebVTT; embedded MKV tracks deliberately out until a demuxer decision).
  Chromium ships no Dolby Digital (AC-3/E-AC-3), DTS or TrueHD decoder, so many MKV rips
  played picture-only. Prism DECODES THEM ITSELF (2026-08-24, owner decision to bundle):
  `vendor/ffmpeg` (BtbN's LGPL SHARED build, fetched by `tools/fetch-ffmpeg.mjs` against a
  pinned tag + SHA-256, never committed, ~128MB into `resources/bin`) feeds an `fsaudio://`
  stream that a hidden `<audio>` plays beside the picture. The trick is a FIXED PCM shape
  (48kHz/16-bit/stereo = 192000 bytes a second), so byte N is always second (N-44)/192000:
  Range requests are answered by starting ffmpeg at that timestamp, which makes a live
  transcode seek like a file - no temp files, no waiting. The video element needs no muting
  (it cannot decode the track either); the sidecar follows its clock and corrects drift by
  nudging playbackRate 2%. Codec choice is an ALLOWLIST of what Chromium plays, so an unknown
  codec gets decoded rather than silently lost. LGPL, not GPL, and shared, not static: the
  AC-3/DTS/TrueHD DECODERS are LGPL, and replaceable DLLs are what the licence asks for -
  which is also why the e2e fixtures encode with `libopenh264` (there is no libx264 here).
  The note that says Prism cannot help now appears only when no ffmpeg was found at all.
  The AUDIO player shares the decoder (2026-08-24) but not the syncing: with no picture to
  keep step with, the decoded stream simply IS the source (`useDecodedSource`), which is what
  makes Apple Lossless, WMA, AC-3, DTS, WavPack, AIFF, AMR and AU play at all. The container
  counts as well as the codec: Chromium has no demuxer for ASF, raw AC-3/DTS, AIFF or AU, so
  anything outside `CHROMIUM_CONTAINERS` is decoded whatever its codec says.
  Video is NOT decoded, and Prism now says which codec it cannot show (`No picture: ...
  (mpeg2video)`) instead of leaving a black window with working sound - MPEG-2, Xvid, WMV,
  Theora, ProRes and FFV1 all land there - EXCEPT that they are now CONVERTED instead
  (2026-08-24, `videoConvert.ts`): the file is turned into an mp4 once and played from the
  copy, so seeking, speed and subtitles all work afterwards. Most cost nothing to convert -
  a .flv/.m2ts/.vob usually holds H.264 and only its container is wrong, so the streams are
  COPIED - and only a genuinely undecodable picture is re-encoded (libopenh264, since the
  LGPL build has no x264). Copies live in `userData/converted`, LRU-evicted at 6GB. The
  "No picture" note is now only the fallback for when no ffmpeg is found at all. `.ts`/`.m2ts`/`.mts` stay unsupported, MEASURED not
  assumed: Chromium has no MPEG-TS demuxer for `<video src>` (picture missing, error banner up,
  though the AC-3 decoded fine), and `.ts`/`.mts` are TypeScript to the code viewer anyway.
  Sidecar `.ass`/`.ssa` subtitles are converted to WebVTT by ffmpeg (2026-08-24); their
  positioning and styling is dropped, because WebVTT cannot express it. The formats sweep of
  the same day added 74 extensions across `fileKind.ts` + `assoc.nsh`, every one of them
  opened in the app and checked before being claimed - including four (`.cr`, `.scm`,
  `.lisp`, `.el`) whose highlighter had shipped for months while the files refused to open.
- **Audio track picker** (2026-08-28, the video's right-click menu): a film
  with more than one track lists them ("English - AC-3 5.1", "Commentary -
  AAC stereo" - the file's own title, else the language, else a number), with
  Default ticked. Chromium exposes NO way to switch tracks on a `<video>`, so
  a pick is not a switch: the picture is muted and the chosen stream plays
  through the same fsaudio:// sidecar the Dolby path already runs on, on the
  video's clock. Per file, and it resets on the way to the next one. One
  track shows no picker, because a list of one is chrome.
- **Audio** player: play / seek / volume, a live circular visualizer, cover art, and the same
  settings cog (speed, loop, autoplay next track). Loop/autoplay/subs-wanted persist. MIDI is
  SYNTHESISED, not decoded (2026-08-24, `midi.ts`): a `.mid` is a score, so Prism bundles
  FluidSynth (LGPL) and the MIT FluidR3Mono soundfont, renders the file to a WAV once, and
  plays that. What you hear is the soundfont's reading of the score, which is what MIDI is.
- **Office and ebook documents** (2026-08-24, kind `doc`): `.docx/.docm` via mammoth, `.odt/.odp`
  by walking the ODF XML, spreadsheets via SheetJS (one table per sheet), `.pptx` as its slides
  in order (slide10 AFTER slide2, which zip order does not give), `.rtf` by a brace walker (a
  regex leaves `{onttbl{0 Arial;}}` in the middle of the letter), and `.epub` along the
  SPINE rather than zip order. A reading view, not Office: no editing, no layout fidelity.
  Every one is converted AND SANITISED IN MAIN against an allowlist before it reaches the
  renderer - no script, no handlers, no iframe/form, images only as the converter's own data:
  URIs, and no links at all, because the window it lands in can reach `window.prism`.
- **PDF / document** viewer: first-party pdf.js viewer (2026-08-08): continuous canvas pages,
  zoom/fit, text selection, own Ctrl+F (no Chromium PDF UI). The zoom baseline is rebased
  (2026-08-12): 1.9 pdf.js units is the default and the pill calls it 100%. Markdown renders formatted
  (react-markdown, sanitized inline HTML, remote badges).
  **LINKS GO SOMEWHERE** (2026-08-31, `lib/pdfLinks.ts`, pure and tested), and the
  allowlist is the feature. pdf.js has already thrown the ACTION NAME away by the time the
  display side sees an annotation: a /URI, a /Launch at an executable, a /GoToR and a
  recognised /JavaScript window.open all arrive as the same `data.url` string. So the rule
  is by SHAPE - a Link subtype carrying none of action / attachment / attachmentId /
  setOCGState / resetForm / actions, and then either an http(s) url or a dest. `unsafeUrl`,
  the raw string out of the file, is never read by anything. ftp:, mailto: and tel: pass
  pdf.js's own filter and are refused here too, because openExternal drops them and a
  clickable box that does nothing is worse than no box. They render as `<button>` boxes,
  never `<a href>` - an anchor is what routes into main's window-open handler, which had NO
  scheme check at all until this change (it does now, and `will-navigate` is guarded too).
  The boxes are PERCENTAGES of the page, so the annotations are fetched once per page and
  never again on a zoom step, and the layer is z-index 2: above the text layer's 1, below
  the pill's 10 and the find bar's 20. An internal /XYZ destination lands at its own
  y-coordinate rather than at the top of the page - a footnote link that jumps to the top
  of page 312 reads as broken, not as approximate.
- **Code / text** viewer (2026-08-17): CodeMirror 6, always editable (see below). ~20 Lezer
  grammars give highlighting, folding and real syntax-error squiggles; `@codemirror/legacy-modes`
  adds ~100 stream lexers for highlighting only, so those languages never claim an error.
  Deliberately no semantic diagnostics: without a tsconfig or node_modules they would be noise.
  Every language loads on demand (one Vite chunk each). Prose (`.txt`, `.log`, `.csv`, subtitles)
  gets no gutter and no language. Token colours are fixed in `index.css`, NOT part of a style.
  **A FILE THAT GROWS** (2026-08-31): "Follow the file" appends new bytes as they are
  written - a build log, an agent's transcript - and a file PAST THE 64MB CEILING now shows
  its TAIL (2MB) instead of an apology. Both are READ-ONLY, and structurally so: a followed
  file keeps no `saved.current` at all, which is the ref `save()` checks, so nothing has to
  remember to test a flag. That matters because the editor's one update listener treats any
  document change as the user typing - an appended chunk would star the file in the tree and
  arm "Save all changes" on the way out, which is how a partial tail gets written over a
  900MB file. Appends are kept out of the undo history too (Ctrl+Z would otherwise un-grow
  the log). The watching is `src/main/fileTail.ts`: an offset, a 500ms poll and a read of
  exactly the new bytes, never sync, with a STREAMING decoder because a chunk boundary can
  fall mid-character, and a RESET when the file gets SHORTER - a rotated log is not new
  bytes to splice on. `TEXT_MAX_BYTES` is untouched; the tail is a separate read-only path.
  **HEX** (`lib/hexRows.ts` + `HexView`): a file Prism cannot interpret is still one it can
  read, so `UnsupportedView` grew its one button. A page at a time over a Range request
  against `fsmedia://`, so it costs 4KB whether the file is a header or a 4GB ISO - the
  renderer never holds it. Paged rather than scrolled on purpose: a continuous hex view of a
  big file is a 268-million-row virtualized list, which is a viewer, not a panel. The tree
  HIDES unviewable files, so the only route to that screen is Windows handing the file over.
- **Comic books** (2026-08-31, `.cbz`/`.cbr`, kind `comic`): a page list wrapped around the
  IMAGE viewer, so zoom, pan, rotate, fullscreen and the picture menu all come for free. Its
  own kind and deliberately NOT `archive`: widening `archiveOk` would put Extract all, Add
  files and member Delete - the one permanent delete in Prism - onto a book. Read-only, both
  formats. **LEFT AND RIGHT TURN PAGES** (owner decision), the one place in Prism where they
  do not page the folder; Ctrl+arrow still does, which is how you reach the next book, and App
  yields by finding `data-owns-arrows` in the DOM the way Escape does rather than by listener
  order (both listeners are on the window in the capture phase and App's was registered
  first). The container is unpacked ONCE into `userData/comics`, LRU-evicted at 2GB: a page
  turn then costs what showing a jpeg costs. Per-page extraction was the obvious design and is
  the one the performance rules forbid - adm-zip reads the whole container synchronously per
  call, and the 7-Zip route spawns a process into a fresh temp directory per member (~278ms),
  neither of which is a page turn, and both of which leave temp directories nothing removes.
  Because every page lives under ONE directory, the media wall grants that directory rather
  than growing `extractedPaths`, which is a Set that never shrinks. Page ORDER is numeric
  (`shared/comicPages.ts`, pure and tested): real comics are numbered 1, 2, 10 as often as
  001, 002, 010, and a plain sort puts page 10 second - which is the archive panel's own bug,
  not to be copied. `ComicInfo.xml`, `__MACOSX/` forks and `Thumbs.db` are not pages, so the
  filter is positive: it is a page if Prism calls it an image. Position is remembered like a
  PDF's.
- **Archives beyond zip** (2026-08-24): `.7z .rar .tar .gz .tgz .bz2 .xz .iso .cab` open
  READ-ONLY through a bundled 7-Zip (`sevenZip.ts`; `tools/fetch-7zip.mjs` expands the official
  MSI with `msiexec /a`, 7z.exe + 7z.dll because rar lives in the DLL). The panel offers view
  and copy and nothing else on those; zip keeps every verb. A member name is validated BEFORE
  extraction, never after: checking afterwards only says where a file was SUPPOSED to land.
- **Archive viewer** (2026-08-22, #68): open a `.zip` onto its manifest - the archive's own
  SYSTEM icon (the user's association, via app.getFileIcon, one fetch per extension; the
  amber parcel is only the loading/no-handler fallback, its picker deliberately removed),
  name and totals, with the members in a panel that FILLS the window (2026-08-25: it
  used to be a 560px box adrift in the space, and read as a fraction of the app).
  The panel scrolls, the page does not. Rows are EXPLORER COLUMNS under a header
  (2026-08-25, owner pick): name, type ("HEIC image", "TypeScript source" - what Prism
  will DO with it, not Explorer's "HEIC File"), size (folders say "3 items"), packed size
  with the saving as a minus percent, and the entry's own modified time. The narrow
  columns drop out on a small window; the name never does. Navigation is Explorer-shaped:
  clicking a folder walks INTO it, the crumb row (fixed height, so the panel never jumps)
  or Backspace climbs out - no collapsible tree, and NO hover quick-verbs (tried twice,
  rejected twice). A VERB ROW under the archive's name (2026-08-25) carries what you come
  to an archive to do: Extract all (main's own dialog picks where, which IS the consent -
  it is why that destination is not bound by the root wall - and the contents land in a
  folder named after the archive, "name (2)" if one is there), Add files (zip only), Copy,
  Rename (handed up to App, which owns renaming), Show in Explorer. Row verbs stay on the
  right-click menu + F2/Delete: view (extracted to a temp file main
  grants individually, shown with the ordinary viewers), copy out (real clipboard), rename,
  delete. Member delete is the ONE permanent delete in Prism (a zip has no Recycle Bin) and
  the dialog says so. Passwords: asked once per archive and remembered; ZipCrypto opens via
  adm-zip, AES members go through a DETECTED 7-Zip (7z.exe at its standard install paths,
  args-only execFile - the same enumerated-exe rule as "Open in"), and without 7-Zip they
  say so honestly. zip only; 7z/rar containers are out until a fresh decision. Oversized
  archives (>600MB) list but refuse WRITE operations.
  **A BIG ZIP IS READ THROUGH 7-ZIP** (2026-08-31): the 600MB ceiling is ADM-ZIP's, not
  zip's - it reads the whole container into memory - so a 1.9GB zip used to list (by reading
  1.9GB into main) and then answer "failed" to every extract, drag and copy, which is the
  worst of both. A zip past the cap now takes the same read-only 7-Zip path a .7z does: it
  lists in 88ms (MEASURED on a 1.9GB, 796-file zip) and extracts fine, and simply has no
  write verbs. Writes keep the cap, because they are still adm-zip's. Extract-all follows
  the ONE-FOLDER RULE: an archive whose whole content is a single top-level folder - what
  every "download as zip" produces - hands that folder up rather than burying it under
  another named after the archive, done by MOVING after extraction so the
  never-write-over-a-folder rule survives. **Extract here** is a one-click verb needing no
  dialog (the archive's own folder is already inside a root, so there is nothing to consent
  to); **Extract to...** keeps the dialog, which IS the consent that lets it write anywhere.
  Both sit on the verb row and on the panel's own menu, and a FOLDER row offers Copy folder
  and Extract folder here - its Copy used to extract the members one at a time and put the
  loose FILES on the clipboard, so you right-clicked one thing and pasted a flat pile. The
  "Extract folder here" stages BESIDE THE ARCHIVE, not in temp: it finishes with a rename, and
  `fs.rename` CANNOT CROSS VOLUMES - it throws EXDEV. Temp is on C: and the archive very often
  is not (an X: drive of comics is what found it), so every extract onto another disk failed
  AFTER 7-Zip had done the work, and said nothing useful because the failure was the move
  rather than the extraction. Staging on the destination's own volume makes the rename
  same-volume and instant whatever the folder weighs; a copy fallback catches EXDEV anyway.
  The clipboard copy still stages in temp, because nothing renames it anywhere.
  A FOLDER comes out in ONE 7-Zip call, never one per member (2026-08-31): the member-at-a-time
  route spawns a process each, and each one RE-OPENS the container, so "Extract folder here" on
  a 2GB archive was hundreds of full re-reads and simply failed. MEASURED on that archive: the
  25-file folder came out in 279ms and the 561-file one in 1.2s, against hundreds of spawns.
  Dragging a folder OUT works the same way now - one call into a staging folder, then each
  wanted entry moved into place - which is where the landing rule lives (the shape BELOW the
  dragged folder is kept, the parents above it dropped). The member filters come from the
  archive's own listing and are still refused for `..` or a drive letter before 7-Zip is
  spawned, because `-o` is the only thing keeping the write inside a folder Prism made.
  7-Zip path reports its own percentage, and getting it to say ANYTHING was measured rather
  than assumed: with `-bsp1` alone and stdout redirected 7-Zip prints nothing at all between
  "Extracting archive" and "Everything is Ok", because it suppresses the progress indicator
  when its output is not a console. `-bb1` (log each file) is what brings both the names and
  the percentages back, so it is the PAIR that works and neither alone; a file COUNT out of
  the listing's total is the fallback for an archive of a few huge members. Exit code 1 is
  7-Zip's WARNING, not a failure - treating it as one threw away a working extraction - and
  a real failure now carries 7-Zip's own line up to the panel, because "couldn't be
  extracted" on its own is a failure nobody can act on. `-p` is omitted entirely when there
  is no password, since `-p` with nothing after it is an EMPTY password rather than none.
  All of it matters because a button reading "Extracting..." for the minutes a 2GB archive
  takes is indistinguishable from one that has hung. **A ZIP RECORDS ITS FOLDERS OPTIONALLY** and plenty of writers
  leave them out (Google Takeout, `zip -D`, most Java tooling), which made such an archive
  read as EMPTY: the panel lists one level at a time by matching each member's parent, and
  every member's parent was two levels down with nothing naming those folders.
  `shared/archiveTree.ts` fills them in from the member names, pure and tested, applied to
  BOTH readers' output because what the container says is the problem. Member order is
  NUMERIC now too, the same hoisted collator `dirList.ts` uses: a plain localeCompare put
  "issue 10" before "issue 2", which for an archive full of comics was the whole listing in
  the wrong order. The crumb row is CHEVRONS with the folder you are in in full contrast and
  semibold (2026-08-31): it was all one grey with `/` between, which read as a sentence
  rather than as a path you can click back along. Rows are ZEBRA-striped, and the stripe is
  `color-mix(in srgb, var(--p-text) 3.5%, transparent)` rather than a fixed grey - Prism has
  custom styles, so it has to hold on void, on an accent-tinted ground and on anything built
  later, and mixing against the TEXT colour gets the direction right by construction. The
  crumb row ends in a chevron at EVERY level, the current folder included: chevrons only
  BETWEEN segments read as a separator between two names, and the trailing one is what makes
  the row read as a path. Rows run EDGE TO EDGE with no radius, so the stripe and the
  selection fill reach both borders rather than floating as tiles in a gutter - the scroller
  gives up its horizontal padding and the rows carry the inset themselves, at the same px-4
  the column header uses, so the columns still line up. The
  extraction progress track is ALWAYS in the layout and only fades in, because inserting it
  when the work began pushed the member list down and pulled it back up; the e2e measures
  that the list does not move. And finishing raises NO popup (owner decision) - the button
  you pressed says "Extracted" for two seconds and goes back, which is closure without
  ceremony. A FAILURE still speaks, and carries 7-Zip's own line. Properties on a zip reports what it
  holds, how much it saved, and its encryption (2026-08-22).
- **Folder navigation**: from the opened file, page through sibling viewable files (arrow
  keys). The navigation-scope filter (all / group / per-type, 2026-07-31) was REMOVED
  2026-08-20: a forgotten filter read as missing files. Do not reintroduce it without a
  fresh decision. A sort menu sits in the sidebar header (2026-08-12, Playnite-shaped: one
  asc/desc pair, then name / date modified / size / type); tree rows and arrow-paging share
  the order. Documents own their
  vertical keys: Up/Down and PageUp/PageDown scroll or flip pages in pdf/text; Left/Right
  always page the folder. **FOCUS decides the vertical keys, for every kind, and nothing
  auto-focuses a document any more** (2026-08-17): opening a pdf, a README or a code file
  takes no focus, so Up/Down and PageUp/PageDown keep paging the folder while you browse from
  the sidebar. Click into the document (or Tab to it) and it owns them: the pdf flips pages,
  the page scrolls, the caret moves. Escape hands them back without closing the window.
  Documents mark their scroller `data-doc-scroller`; App's `docFocused()` is the single test,
  and there is deliberately no kind-based DOC set any more. A window-level key listener in a
  viewer (PdfView's page keys, CodeView's Ctrl+S/Ctrl+F) must check focus itself.
- **Search has operators** (2026-08-28, `shared/searchQuery.ts`, pure and
  tested): every word must match, in any order (`holiday 2024` finds
  "2024-06 holiday", which one substring never could), `"two words"` is a
  phrase, `*.mp4` and `img_??.jpg` are globs over the WHOLE name, `ext:mp4`
  is the extension, and `-raw` leaves those out. A bare `.mp4` stays a plain
  substring on purpose - it is what someone looking for "photo.mp4.bak"
  typed. A query of nothing but exclusions matches nothing, because that is a
  folder listing with a hole in it, not a search. The box's tooltip is where
  this is taught: a placeholder cannot hold five lines and a help panel in a
  viewer's sidebar is chrome.
- **File tree sidebar** (`Ctrl+B`): collapsible panel rooted at the folder Prism was opened in;
  expand subfolders, click a file to view it. The root is a wall: main refuses paths outside it.
  **Keyboard-navigable (2026-08-17)**: the arrows drive a cursor over the flattened visible rows
  (`fileTree.visibleRows` / `stepRow`, pure and tested), folders included. Up/Down step every
  row and walk into expanded folders; Left/Right keep meaning previous/next FILE, and become
  the chevron while the cursor is on a folder. Landing on a file opens it, landing on a folder
  only moves the highlight. ONE mark, not two: the filled accent belongs to the cursor and
  follows it onto folders; the open file is deliberately left unmarked while the cursor is
  elsewhere (`aria-selected` still names it). The cursor row is the tree's single tab stop (roving `tabIndex`),
  so Enter and Space are the row button's own activation, with no key handling for them
  anywhere. Sidebar lends the whole thing to App through `onNav`, returning false when there is
  no tree to drive (panel shut, search showing, end of tree) so App pages the folder instead.
- **Rename + delete from the tree** (F2 / Delete / right-click, files and folders, decided 2026-08-01).
  Nothing is destroyed: deleting and overwriting both go via the Recycle Bin, a taken name asks
  (cancel / replace / keep both), and names are validated first. The session root itself can never
  be renamed or binned.
- **Context-menu verbs** (2026-08-12): "Open in" (a submenu of the apps Windows registers for that
  extension, from the registry, plus the Windows chooser; main only launches exes it enumerated
  itself), Show in File Explorer, Copy path, Copy file (real clipboard drop via PowerShell),
  Duplicate (Explorer-style "name (2)" naming).
- **Text edits in place** (2026-08-17, replacing the 2026-08-12 edit mode): every text file is
  simply editable where it sits, Ctrl+S to save. The pencil now belongs to **markdown alone**,
  the one kind with a rendered form to toggle away from; code and `.txt` have none, so a mode
  switch there was meaningless chrome. **Unsaved text lives in App, keyed by path**
  (2026-08-18), not inside the editor: leaving a file keeps it, so switching files asks
  NOTHING and coming back shows your edits rather than what is on disk. Every dirty file is
  starred and bold in the tree, not just the open one. The only thing that can destroy the
  work is closing, so only closing asks: main mirrors the renderer's dirty flag and blocks
  `win.on('close')` until the user answers **Cancel / Discard / Save all changes** (which
  covers Alt+F4 and the taskbar, not just the X). A failed write cancels the close and names
  the file rather than closing over the top of it.
  **Undo and redo** (2026-08-22, `lib/undo.ts`, pure and tested): Ctrl+Z / Ctrl+Y (and
  Ctrl+Shift+Z) reverse Prism's own file writes - move, rename, bin, duplicate - and a
  quiet pill says what went back. Undo NEVER asks and never overwrites: it puts things
  beside whatever appeared meanwhile ('keep-both'), and a binned file comes back through
  the shell's Recycle Bin namespace (MoveHere, not the localised Restore verb). Behind the
  typing guard, so a focused editor and the terminal keep their own Ctrl+Z. Archive-internal
  writes are deliberately NOT on the stack (a member delete is permanent anyway).
  Prism's writes are therefore: rename, bin,
  duplicate, the editor's save, and the archive's member verbs (rename/delete inside a
  zip, 2026-08-22). Anything further (move, new folder) is a fresh decision, not a
  natural next step - except MOVE, which was decided (2026-08-22, #70) and is reachable
  ONLY by dragging: a row (or a whole multi-selection) dropped on a folder row moves there,
  taken names asking cancel / keep both / replace - EXCEPT that TWO FOLDERS OF THE SAME NAME
  MERGE (2026-08-31). They are one folder with more in it, which is what every file manager
  does; asking there offered either a second copy of a whole tree or the destruction of one.
  The merge is recursive, so a same-named folder one level down merges too, and the question
  survives only for the FILES inside - scanned depth-first BEFORE anything moves, so 'ask'
  still reports the lot and leaves the disk untouched. `moveOne` creates the parent it is
  moving into, which is what makes UNDOING a merge work: the folder those files came out of
  no longer exists. The emptied source goes with `rmdir`, not `rm` - `rm` refuses a directory
  without `recursive`, and `recursive` would delete exactly the leftovers a partial merge is
  trying to preserve. And a drop that asks for nothing DOES nothing, silently: putting a
  folder back where it already was is how anybody changes their mind mid-drag, and it was
  answering with the wall's "a tab's own folder cannot be moved" about a move nobody
  requested. Filtered in main before the wall check. The same drag crosses surfaces: sidebar
  rows dropped INTO an open archive are added to the zip at that folder, archive members
  dropped on a sidebar folder are extracted there (sharing the archive's remembered
  password via `lib/archivePass`), members dropped on an archive folder move inside the
  zip, and files dragged from EXPLORER onto the archive panel are added to it. Folders
  travel whole on every route. Rebuilding a password-protected zip is refused rather than
  risked (adm-zip would re-emit those entries wrongly), and dropping on the window at
  large still just opens the file. Multi-select WAS that fresh decision too (2026-08-22): shift ranges and
  ctrl toggles select WITHOUT opening, in the tree and the archive alike (drag-to-select
  was tried and REMOVED the same day: dragging is for moving, and the sweep's pointer
  state outlived real drags); right-click inside a multi-selection acts on all of it (copy
  files, copy paths, delete N with one question). The tree KEEPS its quick-look single
  click for FILES - one click opens one. A FOLDER selects on the first click and expands on
  the SECOND (owner decision, 2026-08-31): it is a drop destination, a rename target and what
  "Open terminal here" acts on, so pointing at one without walking into it is worth a click.
  That NARROWS the 2026-08-22 rule rather than reversing it - what was tried and rolled back
  then was double-click-to-OPEN, which still does not exist. The chevron still expands on the
  first click, being the one control whose whole job is the folder's state. The ARCHIVE stays
  double-click, where single click selects. Contiguous selected rows fuse in the TREE (shared
  edges drop their rounding); the archive's rows are square and edge to edge, so there is
  nothing there to fuse.
  Search results speak the same selection language, multi right-click included.
  DRAG-SELECT came back for the ARCHIVE alone (2026-08-25): it starts only on the
  panel's DEAD SPACE, so a row drag (which moves members) can never leave a phantom
  band behind - the failure that got the tree's sweep removed - and its listeners
  die on pointerup and pointercancel alike. A press on dead space, or anywhere
  outside the rows at all, CLEARS the marks in both surfaces: highlighting says
  "these are what I am about to act on", so it must not outlive walking away from
  them. What stays marked is the OPEN file, which is marked for being open.
  A RIGHT-CLICK NEVER SELECTS (2026-08-31): the row it was opened over is the
  menu's target and is marked in GREY (`menuPath`), not in the accent - the accent means
  "these are what I am about to act on", and the menu already acts on the row you opened it
  over. Marks elsewhere are dropped for the same reason: right-clicking row A while B and C
  are marked leaves the verb going to A, and marks claiming otherwise are lying. Right-
  clicking INSIDE a multi-selection still acts on all of it.
  Ctrl+A (2026-08-25) marks everything in whichever surface you last pressed in:
  every row the TREE is showing (expanded folders included, never what is
  collapsed and invisible), or every member of the archive folder you are in.
  Behind the typing guard, so the search box, a rename, the editor and the
  shell keep their own Ctrl+A.
  Tabs reorder by dragging along the strip (`reorderTabs`, pure and tested), with a
  hairline showing where one would land.
  Selection is the accent fill (`data-selected`); `aria-selected` still means the OPEN
  file, which is what the e2e leans on. Keyboard unchanged: arrows land-and-open, Enter
  opens, F2/Delete act on the row (Delete takes the whole selection when the row is in
  one).
- **The empty window offers a TAB, not a file** (2026-08-31). With nothing open at all the
  first button was "Open file...", which is the narrowest way into an app whose whole model is
  a tab rooted at a FOLDER you then browse: it left you holding one file with no obvious next
  move. It is "New tab" now, instant and rooted per the "New tabs show" setting exactly as the
  + is, with the folder chooser beside it. Dropping a file still works and the line above still
  says so. `open:dialog` in main is left in place but is now reachable from nothing.
- **Open a folder, and project tabs** (2026-08-20): the root used to be inferred from
  whatever file arrived and there was only ever one. A title-bar button and `Ctrl+T` now
  choose a folder, and several roots stay open as tabs. **A tab is a root and a current
  file, nothing else** - no per-tab settings, no pinning, no list you curate. A file
  arriving from outside reuses a tab whose root already holds it (five photos from one
  folder is one tab), otherwise spawns one, otherwise fills the empty window. Tabs persist
  in `tabs.json`; a root that is gone is dropped without a word. The strip is present from the
  FIRST tab, so the `+` is always reachable and the chrome never shifts when a second folder
  opens; it goes only when nothing is open at all. **Two folder buttons, two verbs**: the
  strip's `+` (and `Ctrl+T`) ADDS a tab instantly (its RIGHT click offers the last five folders
  Prism has been opened in, newest first, deduped, read fresh each time - history, not a list
  to curate; a folder that has gone drops out on the attempt), rooted at the user's home folder with no
  dialog, and spawns unconditionally (pressing + must never appear to do nothing); the
  sidebar's folder button (on the search row, left of the search box, away from sort/filter
  which narrow rather than change) opens the chooser and REPLACES the current tab root. Rerooting onto a folder another tab already holds switches there instead,
  keeping one tab per root. `Ctrl+W` closes a tab and the
  last one leaves an EMPTY WINDOW rather than quitting: Prism is resident and a window that
  vanishes under a reflex keystroke is the failure the close flow exists to prevent.
  Closing a tab holding unsaved text asks, like the window does.
  The root wall is a set now (`src/main/roots.ts`), not one string. Navigation handlers
  (`open:within`, `dir:list`, `search:files`) name their root and get the strict per-tab
  check; everything else checks `insideAnyRoot`. The renderer owns the tab list and reports
  it, which is what narrows the wall when a tab closes.
- **A terminal, one per tab** (2026-08-20): opens FULL VIEW (the viewer steps aside but
  stays mounted, so scroll/zoom/playback survive) via `Ctrl+\``, `Ctrl+Shift+T`, or the
  sidebar FOOTER-row button (a new bottom row, one button so far). SPLIT is the deliberate
  arrangement, menu-only (no hotkey, 2026-08-21): right-click a file, "Open in split view"
  PINS file panes (up to 4 windows, FIFO, direction flyout with memory); the terminal's own
  split docks bottom/top/left/right (right-click menus), resizable. Ctrl+W closes
  innermost-first: pinned panes pop LIFO, then the tab itself. The terminal wears the style (reads
  --p-bg/--p-text/--p-accent-hi live): void means a black terminal. Right-clicking the
  terminal button offers split view and Clear terminal. The agent indicator has two
  volumes (owner picks, 2026-08-23): MINIMAL runs an indeterminate line along the tab's
  bottom edge while an agent works and says nothing else - no finished state, that is
  full's alone; FULL fills the tab with the working colour, and holds the finished colour
  until the tab is visited. Syntax highlighting and history
  ghost-suggestions (RightArrow accepts, Up/Down recalls) are PSReadLine's, forced on at
  spawn - including `-EnableScreenReaderMode:$false`, because automation tooling
  false-positives the system screen-reader flag and PSReadLine then silently drops to a
  plain renderer (diagnosed 2026-08-20; a real screen-reader user gets a Settings knob if
  ever asked for). cwd starts at the tab's root; hiding keeps the shell running; exit,
  tab close, or quit kill it; rerooting keeps it. A tab whose terminal was SHOWING at quit
  reopens as a terminal (tabs.json remembers the view; the shell itself is fresh) - a
  Claude-session tab must not come back as an empty viewer (2026-08-21). And a shell that
  HOSTED CLAUDE at quit resumes the conversation BY SESSION ID: main reads the newest
  session claude recorded for the folder (~/.claude/projects) and launches the shell with
  `claude --resume <id>` as its STARTUP command - never typed on screen, never a bare
  --continue guessing (no session on disk = no resume). That is the ONE command Prism
  ever writes itself - an explicit owner exception (2026-08-21) to the line below,
  claude AND codex (2026-08-23): claude comes back by session id, codex by its own `codex resume --last`, whose picker already filters by cwd so no lookup is needed; agent detection names the kind and tabs.json records it (the old boolean means claude). Other agents light the dot but have nothing to come back to. Ctrl+C
  over a selection copies it, Windows Terminal style; unselected it stays the interrupt.
  pwsh by default, Settings picks from what the machine has. The pty gets a
  terminal's OWN environment, not Prism's (2026-08-23): TERM=xterm-256color and
  COLORTERM=truecolor, with NO_COLOR and FORCE_COLOR=0 dropped, and the SESSION MARKERS an
  agent leaves for its children stripped by name (CLAUDECODE, CLAUDE_CODE_CHILD_SESSION /
  SESSION_ID / MESSAGING_SOCKET / MESSAGING_TOKEN / ENTRYPOINT / EXECPATH, CLAUDE_PID,
  CODEX_COMPANION_*). Prism inherits whatever launched it: from an agent's own shell that
  meant monochrome agents AND child sessions - no transcript saved, so nothing for Prism's
  resume to find, and a live pipe to somebody else's conversation. Real CLAUDE_CODE_*
  configuration (web-search limits, feature flags) is deliberately kept. **This is the one thing in Prism that executes**, accepted by design -
  the line that remains is that Prism never generates a command: main spawns only shells it
  detected itself, and forwards keystrokes. AI CLIs are the primary workload: an image on
  the clipboard forwards the ^V KEYSTROKE (Claude Code reads the image itself - swallowing
  that key is how other terminals break image paste), copied files paste as quoted paths,
  text is bracketed paste, Shift+Enter sends the backslash-CR continuation, and a file
  dropped on the panel types its path instead of opening. Prism claims only Ctrl+\` and
  F11 over a focused shell: Escape stays vim's, Ctrl+W stays delete-word.
- **Reaching the terminal, and leaving it alone** (2026-08-31). Ctrl+` is THREE-WAY,
  VS Code's rule: a terminal that is showing but does not have the keyboard gets the
  keyboard, and only a press from INSIDE it hides. The old two-way toggle meant that
  reaching for the shell you could already see put it away. `toggleTermView` itself is
  unchanged and still tested; the branch lives in App, where `inTerm` already exists.
  **Ctrl+Shift+F finds in the SCROLLBACK** (xterm's own `addon-search`, so it knows about
  wrapped lines and the alternate screen), a DocFind-shaped bar over the panel; xterm's
  key handler must return false for it or the pty gets the bytes too, and it is added
  EXPLICITLY rather than by widening the `/^[twb]$/i` tab-key regex, which ignores shift
  and would cost the shell plain Ctrl+F. **"Open terminal here"** on a folder row follows
  the reroot policy verbatim: an UNTOUCHED shell is replaced by one spawned in that
  folder, a TOUCHED one is somebody's work and is never taken away - that folder gets a
  terminal in a NEW TAB instead. The tab's own root does not move; the sidebar's folder
  button is the verb for that. And the close question now NAMES what it interrupts:
  `lib/agentClock.ts` times how long an agent has been working, which `outputRuns`
  cannot - its `start` resets on a 1.5s silence, so it measures a burst, deliberately.
  'Off' still means off: a confirmation that appears anyway is a setting that lies.
- **Performance rules learned the hard way** (2026-08-26, all measured on this
  machine). MAIN IS ONE THREAD AND EVERYTHING SHARES IT: `execFileSync` there
  stops every window, every IPC reply, the terminals and the `fsmedia://` Range
  handler a playing film depends on. There is now none left - 7-Zip listing,
  member extraction, extract-all, the AES member path and the ass-to-vtt
  conversion all run through `execFile`. Same rule for big reads: the camera-RAW
  scan reads up to 40MB and does it with `fs/promises`. THE RENDERER MUST NEVER
  HOLD A MEDIA FILE: the waveform's peaks used to `fetch` the file and
  `decodeAudioData` the lot, which took the renderer to 7.4GB on a 2GB film and
  then threw (Web Audio cannot open an MKV at all); peaks come from ffmpeg in
  main now (`peaks.ts`), streamed, holding 160 running maxima and nothing else -
  2.9s for a two-hour film, cached, 179MB peak. The visualizer's drop analysis
  is the same shape and is capped at 15 minutes of audio. Cheap wins worth
  keeping: `readdirSync(withFileTypes)` and ONE stat per file rather than two
  took `dir:list` on System32 from 159ms to 11ms, and lazy-loading pdf.js,
  react-markdown and DocView alongside CodeMirror halved the launch bundle
  (3037KB to 1503KB). MORE OF THE SAME (2026-08-31): `dir:list` and
  `search:files` were `readdirSync` plus a stat per file, on main's one
  thread, up to 20000 entries per debounced keystroke - the exact thing this
  block rules out, left in place because it was fast enough not to notice on
  a warm local disk. They are async now, and the important part is that the
  OBVIOUS translation is a REGRESSION: measured on System32 (about 5000
  entries, median of five), sync 140ms, naive await 269ms, bounded-16 44ms.
  One await per entry is a round trip per entry; the win is the CONCURRENCY,
  and the bound is what keeps 8400 stats out of the same libuv pool the
  `fsmedia://` Range handler reads a playing film through. The search also had
  to learn to be SUPERSEDED: while it was synchronous it finished inside one
  keystroke and there was never a second walk in flight, so each call takes a
  ticket now and a stale walk stops where it is. And the biggest single win in
  that file was not the fs at all - `localeCompare` builds a fresh collator on
  EVERY comparison, so sorting 5000 names built 5000 of them: 23.3ms against
  0.5ms with one hoisted collator.
  MORE OF THE SAME (2026-08-28): the agent dot used to
  spawn a PowerShell and dump EVERY process on the machine, command lines and
  all, every 2.5s for as long as a terminal existed - 110KB of JSON a few
  times a minute to answer a question that changes twice an hour. It now asks
  only when a pty has PRINTED something since the last look (nothing can start
  or finish in a silent shell), backs off to 20s while the answer holds, and
  asks for "pid ppid" with the command line only where a broad prefilter hits:
  measured 110KB/214ms down to 7KB/155ms, on top of far fewer calls. A
  conversion nobody waits for is CANCELLED (`video:cancel` existed in main and
  was called from nowhere, so arrowing past a WMV re-encoded a whole film for
  no one), and the convert cache touches on a hit, so the film you rewatch is
  not the one evicted. The HEIC utility process stands down after a minute
  idle instead of living as long as the app; the shared AudioContext suspends
  when nothing is playing; the visualizer's frame loop stops once a paused
  picture has settled; and a cross-volume move copies with `fs/promises`
  rather than `cpSync`, which blocked every window for as long as it took.
- **The band behind the transport** is a slider (2026-08-25, Settings > Player):
  0-100%, opaque by default, which is the bar exactly as it always looked. Below
  55% the controls carry their own drop shadow, because at that point they are
  sitting on the film rather than on a band. The edge, outline and island styles
  ignore it: a hairline, a glow rail and a floating capsule are their own shape,
  and a band would make them a different style rather than the same one on a
  background. Stored as a NUMBER, and read back defensively - `Number(null)` and
  `Number('')` are both 0, so a naive loader would read "never set" as "fully
  transparent" and quietly remove the bar for everyone.
- **Fullscreen and the transport** (2026-08-25, three days of wrong guesses, so the
  findings are written down). The controls appeared on entering fullscreen and never
  again. They were NOT hidden: the DOM had them mounted at the right rectangle, opacity
  1, visible, inside the fullscreen element, with the pointer moves arriving in dozens
  per second - and a capture of that strip of the real screen showed only film.
  DirectComposition was presenting the picture and the page's own overlay never reached
  the glass. `--disable-direct-composition` is the fix (overlays alone were already off
  for the HDR pause-brightness bug and were not enough). MEASURED cost: zero dropped
  frames in 899 at 4K HEVC, and the acrylic styles composite identically with it on or
  off. Then the hide broke, three times over, all the same shape - something waking the
  controls the instant they hid: a cancellable timer that only had to miss one reset;
  the bar's own `mouseleave`, which fires when an element is REMOVED under the pointer;
  Chromium's `mousemove` on layout change under a STATIONARY cursor; and PlayerMenu's
  unmount reporting "closed" through the same path that pins the chrome open. So: the
  transport MOUNTS and UNMOUNTS (a layer taken to opacity 0 inside a fullscreen element
  is composited once and never repainted), it has no mouse handlers of its own, activity
  is heard on the WINDOW in the capture phase, and hiding is decided by a clock reading
  the last wake, the video's own paused state, and the bar's own `:hover`. Nothing that
  can be left stuck. Do not reintroduce a hover flag, a root-level onMouseMove, or an
  opacity fade in place.
- **The video's right-click menu** (2026-08-27, trimmed to the owner's picks):
  Next video, Previous video, PICTURE, Speed, Subtitles, Show in File Explorer,
  Copy path. Play/pause and fullscreen were offered and CUT - a click and a
  double-click already do them. Next/Previous follow autoplay's rule, the next
  file of the same KIND, stepping over photos and documents; the row greys out
  when there is none that way. PICTURE is fit to window (the default, and the
  way back), fill, stretch, and forced 16:9 / 4:3 for a file whose header lies
  about its shape; VLC's 1:1 was offered and cut, because on a 4K file in a
  small window it shows a corner of the picture and reads as a bug. The mode is
  per file and resets on the way in to the next. Speed shows the CURRENT rate on
  its row - one setting, the cog's slider being the other way in. Subtitles keeps
  auto-detection AND a manual "Add subtitle file…": main's dialog picks it, which
  is the consent that lets it be read from outside every root. Every row carries
  the tick column, ticked or not, so the labels line up, and `hint` is the
  SHORTCUT column - a sentence in it is a wall of text down the right-hand side.
  The COG still hides its subtitles section when there are no tracks: it is a
  list, while the menu is the one place that can add one.
- **Fullscreen is black, and read-only** (2026-08-28). The stage behind a
  fullscreen film paints `#000` whatever the theme says: the letterbox is part
  of the picture, so a light theme's paper-white bars or an accent-tinted
  ground are the app leaking into the film. Windowed, the theme is the theme.
  And nothing WRITES from a keystroke while fullscreen: Ctrl+Z/Ctrl+Y and the
  archive's F2/Delete are inert there, because the tree, the crumbs and the
  dialogs are off screen and a file change nobody can see is a change nobody
  meant. A visible click on a verb still works.
- **A covered window keeps playing** (2026-08-27, found in the owner's own log,
  not reproduced by any test here). Windows tells Chromium when another window
  COVERS this one; Chromium marks the page hidden - `document.hidden` true,
  `visibilitychange` fires - and its hidden-page media policy suspends playback
  a millisecond later, restoring it on the way back. It read exactly like a
  setting misbehaving, and the app's own "pause in background" was off the whole
  time. `--disable-features=CalculateNativeWinOcclusion` and
  `backgroundThrottling: false` are the fix: covered is not closed, and for a
  media viewer the sound is the point. Do not re-enable throttling to save
  background CPU without solving that.
- **Volume goes to 200%** (2026-08-27, VLC's ceiling), on a column that rises
  from the speaker button rather than a bar that grew sideways and shoved the
  time readout about. Two ways to the same place, neither a special mode: the
  column runs the whole way to 200%, and so does the WHEEL over the picture
  (VLC's habit, 5% a notch, in the video and the audio player alike). An
  on-picture readout - speaker, a bar to 200% with the 100% mark drawn on it,
  and the number - shows for any volume change and leaves after 1.2s, with ONE
  look at every level: no dimming, no colour change past 100%, because the bar
  and the number already say how loud it is. It MOUNTS and UNMOUNTS, like the
  transport, for the same fullscreen-compositing reason. Level and mute
  belong to the TAB for the session (`lib/tabVolume`): the same level follows
  you across the files you open in that tab, a new tab starts at 100%, a
  closed tab forgets, and nothing is persisted - the old single localStorage
  number was shared by every file in every window and came back tomorrow. Past 100% the ELEMENT cannot help - `HTMLMediaElement.volume`
  is capped at 1 by the spec - so `lib/audio` routes it through Web Audio:
  source -> gain -> destination, built ONCE per element and only when a boost is
  actually asked for, so an ordinary file at 80% never touches Web Audio at all.
  The visualizer taps that same chain (a second MediaElementSource for one
  element throws, and a second path to the speakers would play the file twice).
  The sidecar decoder's `<audio>` gets the same treatment, since for a Dolby
  film that element is the one making the sound. The elements are fetched
  `crossOrigin="anonymous"`, and `lib/audio` REFUSES to route one that is not:
  a media resource fetched without CORS taints its MediaElementSource, so the
  graph gets digital silence - and since an element can never be un-routed,
  turning the volume back down does not bring the sound back. Measured
  2026-08-27: peak 0 without the attribute, 0.129 with it. That was the
  200%-is-silent bug; refusing to route is a volume that stops at 100%, which
  is a far better failure than a film that has gone quiet.
- **A file comes back doing what it was doing** (2026-08-26, finished
  2026-08-27). A tab renders only while it is in front, so opening Settings - or
  any other tab - unmounts the viewer, and the player came back as a fresh
  `<video autoplay>` at time 0: a film you had deliberately stopped started
  again, and a film you were watching RESTARTED. `lib/playState` remembers, FOR
  THE SESSION ONLY, both halves - paused or not, and where it had got to - so
  autoplay is skipped for the first and the element seeks to the second. The
  persisted resume-position could not do this job: that one is films only (over
  10 minutes) and saves every few seconds, so looking away in the first moments
  of anything lost the place entirely. The session position therefore WINS over
  the stored one, and applies to a 5-second clip too. NOTHING AUTOPLAYS ON
  OPEN any more (2026-08-28, owner decision, overturning the older rule that
  opening a file meant playing it): a folder of films, and a window of
  restored tabs, used to start every one of them at once - you would hear a
  film from a tab you were not even looking at. Only a file that was ALREADY
  playing a moment ago plays when its element appears, which is `wasPlaying`
  rather than `!wasPaused` - the difference being the file nobody has played
  yet. The playlist records its own intent (`intendToPlay`) for the file a
  finished video hands over to, and for the menu's Next while you are
  watching; stepping away from a film you had PAUSED lands paused.
  That covers a genuine remount
  (a new file, a split view opening); the tab switch itself no longer is one,
  see below.
- **A tab you leave keeps playing** (2026-08-27, `lib/mediaDeck`). A tab
  renders only while it is in front, so walking to Settings or another folder
  stopped the film. Handing the sound to a second, hidden element was tried
  first and REJECTED by ear: it pauses and unpauses at every switch, because
  the only seamless answer is for the ELEMENT ITSELF to survive. So every tab
  holding a video or a track keeps its player mounted and the strip only
  decides which one you SEE - measured: the same element, zero `pause` events,
  the clock never stalling, across Settings and a second tab. A hidden player
  owns no keyboard (`useMediaControls`'s `keys`), draws no chrome, no menu, no
  visualizer and asks for no waveform; it does not autoplay the next file
  either, because a tab you are not looking at does not choose what plays.
  Two rules keep it honest: the deck order is APPEND-ONLY (removing a media
  element from the document pauses it, and React moves DOM nodes when a list
  reorders, so a deck following the tab strip would stutter on a drag), and
  there is a CEILING of 4 players, the oldest background one standing down,
  never the active one. It does mean two films can play at once if you left
  one running and go to another - which is what "keeps playing" means.
- **Pause in background** (2026-08-26, the transport cog): one toggle, off by
  default. Away means another window has the focus OR Prism is minimised -
  PotPlayer's "Pause playback when focus lost", which covers VLC's
  "Pause playback when minimized" too. The signal comes from MAIN over
  `window:state`: Electron does not mark a minimised window hidden, so
  `visibilitychange` never fires and `document.hidden` stays false however small
  the window gets. It resumes only what IT paused (`lib/backgroundPause`, pure
  and tested), so a film you stopped by hand stays stopped.
- **A new file is a new file** (2026-08-28). The viewer is keyed by KIND, not
  by path, so arrowing through a folder never remounts `useMediaControls` -
  and three things quietly outlived the file they belonged to: only the FIRST
  long video in a tab ever resumed (`resumedRef` stayed true), one unplayable
  file left its error overlay across every file after it, and the element came
  back at 1x with the new src while the cog still read 1.50x. The reset is
  done while RENDERING, not in an effect: by the time an effect runs, the new
  file has already had a frame with the old one's error on top of it. Speed is
  re-applied rather than cleared - it is a preference about watching, not
  about one file.
- **Playback position** (`useMediaControls`, tuned 2026-08-24 by owner decision): media longer
  than 10 MINUTES reopens where you left it, silently - no prompt, no banner. Anything shorter
  never is, which is why a 5-second clip always starts at the start. Stopping inside the LAST
  MINUTE counts as watched: the position is neither saved nor restored there, so a film never
  reopens into its own credits. Video and audio share the rule, so audiobooks and long mixes
  resume and songs do not.
- **"Open in Prism" in Explorer's menu** (2026-08-24, `shellVerb.ts`), ON by default since
  2026-08-31 (owner decision), switched in Settings > General. Applied ONCE, and the marker
  file in userData is the whole design: a default that reapplied itself every launch would be
  a setting that lies - turn the verb off and it would be back tomorrow. Never in dev and
  never under `--e2e`, where `app.getPath('exe')` is a throwaway build and writing those keys
  would repoint the real installed Prism's verb at it. A classic HKCU verb under `*`, `Directory` and (2026-08-25)
  `Directory\Background`, where it reads "Open Prism here" and takes `%V` rather than `%1`
  (which is empty on a background click) - per user, no
  elevation - added and removed with `reg.exe` (argv only). A FOLDER handed over this way
  roots a tab and then obeys "New tabs show" - first file, a terminal, or nothing - exactly
  as the + does; main's argv reader used to demand a FILE, so the folder verb was present
  and did nothing (fixed 2026-08-25). A folder a tab already holds switches to that tab. On Windows 11 it appears under
  "Show more options", because the short menu is built from IExplorerCommand COM handlers and
  those need a registered DLL; the hint in Settings says so rather than leaving it to be
  hunted for. The switch reports what the REGISTRY says, not what was clicked, and a verb
  pointing at some other copy of Prism reads as off so turning it on repoints it here.
- Keyboard-first controls; remember window size/position.
- **Resident single-instance model**: one process; opening another file hands off to the running
  window so it appears instantly (mitigates Electron cold-start). The window is RAISED past
  Windows' foreground lock when it appears and when a file is handed to it (2026-08-28):
  `show()` and `focus()` only ask, and a process that did not have the foreground can be
  refused - the window is drawn but not activated, and the user's first click is then spent
  activating it instead of pressing what it landed on. The brief always-on-top is the
  documented way past that, and it is dropped in the same breath.
- **Update chip** (title bar, right of the file name): one shape for every state, and it never
  changes width - the chip IS the progress bar, filling with accent from the left as the
  download runs (owner pick from 12 mockups, 2026-08-24). Only shown when an update exists.
- **One icon per kind** (2026-08-30, #74): the ProgIDs used to point `DefaultIcon` at
  `Prism.exe,0`, so a .zip and a .mkv opened with Prism were the same picture in Explorer.
  Each now has its own .ico in `resources/icons`, generated by `tools/icons/build_icons.py`.
  They keep the NEAR-BLACK TILE (owner pick over a bare glyph, 2026-08-30): the tile carries
  its own contrast, so one icon reads on Explorer light and dark alike. That is not a small
  point - `tools/icons/compare.py` puts four treatments on both grounds, and a BARE white
  glyph is invisible on light mode, so dropping the tile would have forced a palette change
  as well. Every size is DRAWN at that size, never downsampled from one big render, and the
  glyphs are laid out in sixteenths of the tile so a 16px frame lands on whole pixels rather
  than wherever LANCZOS puts it. 16px is the size that decides it: details view is what most
  people look at all day, and it is the frame every mockup round was judged on. ROUND EIGHT
  (2026-08-31) settled the three that had not been: code is stepped indent bars now (the
  chevrons were legible but every editor on the machine draws them), document is a
  folded-corner page (what shipped before was marked `provisional` in the source and had
  never been chosen), and comic is an open book - drawn for the document column and picked
  for this one, which is why nothing collides. The code glyph carries THREE bars and not
  four, measured not assumed: at 16px four leave a 1.1px gap and a light bar on a near-black
  tile blooms across it, so the top two merged into one smudge. `tools/icons/round8.py` keeps
  every candidate and `mockups.py <round>` renders the comparison page they were picked
  from. ROUND TEN (2026-08-31) re-cut ARCHIVE: three thick layers now, belted. The belt is
  the lesson - round nine laid a strap OVER the layers and it read as a vertical line on top
  of the icon, because it had no relationship to the shape underneath. At icon scale the only
  depth cue that survives is SILHOUETTE, so the channel is CARVED: the glyph is drawn on its
  own layer and the channel sets that layer's alpha to zero, which makes the near-black tile
  show through as a real hole. A shadow, a gradient or a highlight edge would have been a
  grey smudge at 16px. The belt carries the one indigo now that the top layer has given it up.
- **Every surface answers a right-click** (2026-08-30, #76). Seven had no menu at all while
  the video had a carefully trimmed one, and almost every verb they needed already existed
  somewhere else. The picture, the audio stage, the text editor, a tab, the archive panel's
  DEAD SPACE, the documents and the terminal all have one now, and `lib/fileVerbs.tsx` holds
  the rows that mean the same thing wherever a file is on screen. Two deliberate gaps: a tab
  has NO "close others" (each close can raise the unsaved-changes question, and firing several
  would overwrite it and lose the work it protects), and the terminal's menu carries paste but
  not copy (xterm owns its selection; Ctrl+C over one already copies).
  The SIDEBAR's dead space answers one too (2026-08-31): Paste, Open terminal here, Show in
  File Explorer and Copy path, all on the PLACE rather than on a row, since a right-click
  that missed every row simply read as a miss. Paste reads the clipboard through PowerShell
  (`Get-Clipboard -Format FileDropList`) because Windows puts a multi-file copy on as
  CF_HDROP and Electron's own clipboard API exposes only one path; the copy side was already
  a PowerShell call for the same reason. The SOURCES may be anywhere - you copied them in
  Explorer - and only the DESTINATION is walled. Nothing is ever written over: a taken name
  becomes "name (2)", the way Duplicate does. Deliberately NOT `ownWrite`'d, because the
  tree has no other way to hear about a paste and muting only DEFERS the watcher's event by
  a second and a half anyway.
  **NO ICONS on a viewer's menu, and almost no shortcut hints** (owner pick, 2026-08-31). The
  first cut read like a toolbar - the picture's menu offered next, previous, zoom in, zoom out,
  fit, actual size, rotate, fullscreen and copy, most with a key against the row - and every one
  of those was already a press or a button away, so the menu taught keys nobody needed taught
  and buried the two verbs that live only there. A menu over the thing you are looking at is a
  short list of verbs: the PICTURE's is Rotate, Copy image, and where the file is. Ticks are not
  icons (they say what is currently on), and the SIDEBAR keeps its glyphs - it sits among
  icon-led file rows and is the one menu long enough to need scanning.
- **The screen stays awake while something plays** (2026-08-30). Two hours of film is two hours
  of no input, which is exactly what the lock screen waits for. `lib/awake` COUNTS players
  rather than toggling, because the media deck keeps up to four mounted and a background tab
  pausing must not unblock what you are watching.
- **A frame step is a frame** (2026-08-30). It was a flat 1/30s that did not pause, so on 24fps
  film it moved 1.25 frames and landed between two of them, and during playback it was
  invisible. ffprobe reports `avg_frame_rate` now and the step pauses first.
- **Up/Down are the volume when the tree does not want them** (2026-08-30). App preventDefaulted
  them unconditionally and `useMediaControls` yields on `defaultPrevented`, so the volume keys
  were dead everywhere - most obviously in fullscreen, where the sidebar is gone. The tree still
  gets first refusal.
- **A save puts the file back the way it found it** (2026-08-30, `src/main/textFile.ts`). Two
  silent corruptions. Every read was utf-8, but a `.reg` is UTF-16LE BY DEFINITION and Prism
  claims `.reg`, as is anything PowerShell 5.1 redirected to a file: those opened as mojibake
  and Prism offered to save the mojibake back. And CodeMirror rejoins its document with `
`
  whatever it read, so one fixed typo in a `.bat` was 400 changed lines. The sniff is BOM-ONLY
  and deliberately so: guessing UTF-16 from interleaved NUL bytes mis-fires and turns a working
  file into nonsense, and every real Windows producer writes the mark.
- **Copy the PICTURE, not the file** (2026-08-30). For HEIC, camera RAW and the ffmpeg-decoded
  formats, "copy the file" hands the other application bytes it cannot open. Copy image works
  from the decoded blob, NOT from the `<img>` (which carries the zoom and rotation - how you are
  looking at it, not what it is) and NOT from the big-image canvas (downscaled to 2560px, so the
  copy would silently shrink). Copy frame is the video's, greyed when there is no picture.
- **Ctrl+F in every document, and it opens where you left off** (2026-08-30). A polished find bar
  sat in the PDF viewer while Ctrl+F did nothing on a README or a 300-page epub. Highlighting
  goes through the CSS Custom Highlight API rather than wrapping matches in `<mark>`: the office
  and ebook views render HTML main sanitised and the markdown view is React's, so injecting
  nodes would fight the renderer that owns them. Reading position is session-first then stored,
  only for documents long enough to be worth it, cleared at the end (a document read to the
  bottom opens at the top next time). The PDF remembers a PAGE, because an offset depends on the
  zoom and on which pages are virtualized.
- **The tree notices changes Prism did not make** (2026-08-30, `src/main/dirWatch.ts`).
  `refreshKey` only ever moved on Prism's own writes, so a download finishing or an agent
  writing files left the tree lying. Coalesced into a set of directories on a quiet window with
  a hard ceiling; filtered by the listing's own rules and by EVERY path segment (a recursive
  watch reports `.git/HEAD`, and an agent committing does that constantly); muted around Prism's
  own writes, which refresh the tree themselves. Scoped to the root set BY CONSTRUCTION -
  `roots.ts` announces every open and close and that is the only thing that starts a watch. The
  renderer re-lists only folders a tab has already loaded and does NOT bump `refreshKey`, which
  is what would clear the selection.
- **And so does the open file** (2026-08-31, `lib/fileReload.ts`). The watcher above
  refreshed the TREE and left the EDITOR showing a frozen copy, whose `saved.current.text`
  was now a lie - so one Ctrl+S wrote the stale version back over the agent's work. The
  signal cannot be trusted on its own: `DirChange` carries directories and never a file
  name, and Prism's OWN save emits one about 1.2s late, because a muted directory is
  DEFERRED rather than dropped. So the correctness condition is the file's own stamp
  (mtime + size), taken after every read and after every write. A CLEAN editor swaps
  silently: `saved.current` is set BEFORE the dispatch (or the update listener marks the
  file dirty against text nobody typed) and the transaction is kept OUT of the history
  (or Ctrl+Z walks back to the stale text and the next Ctrl+S commits the very corruption
  this fixes). A DIRTY one asks, once per file however many times it is rewritten, and
  never in fullscreen, where a dialog composites outside the fullscreen element and nobody
  sees it: Prism has no diff and no merge, so it is Keep mine or Reload from disk and
  nothing in between. A file that has momentarily VANISHED (a rename-into-place write, a
  git checkout) is left entirely alone - nulling `saved.current` there would disarm Ctrl+S
  on the user's own unsaved work. Markdown re-reads the same way with no question, having
  nothing unsaved to lose. Deliberately NOT extended to the pdf viewer or to office and
  ebook documents: those cost a conversion in main per event, and nobody rewrites a .docx
  underneath a reader. The paging list is still frozen (it comes from the open payload), so
  a file an agent CREATES appears in the tree and is not arrow-pageable until the tab
  re-roots - said rather than half-fixed.
- **The uninstaller had never run** (2026-08-30). `customUnInstall` was defined in `pages.nsh`,
  which `installer.nsh` excludes when `BUILD_UNINSTALLER` is set, so electron-builder's
  `!ifmacrodef` found nothing: every ProgID, every OpenWithProgids entry and the Explorer verb
  survived an uninstall. The macro lives in `assoc.nsh` now and a parity test asserts both that
  and that every key `shellVerb.ts` writes is one the uninstaller deletes.
- **Opt-in file associations**: register Prism as the handler for chosen types, from Settings.
  Never hijack defaults silently. The installer offers EVERY viewable type
  (`build/installer/assoc.nsh`); the app itself just opens Windows' Default apps page, so that
  list is the only thing deciding what Windows will offer Prism for.
  That list only governs the RECOMMENDED half of "Open with" (2026-08-20). The dialog's
  "More apps" section is every installed application, unfiltered, so Prism can be pointed at
  a `.zip` no matter what we register, and no app can remove itself from it: the only lever,
  `NoOpenWith`, is all-or-nothing and would drop the 143 types we do support. Hence
  `UnsupportedView`, which names the file and the format instead of leaving an empty window.

**Out of scope (v1):** playlists / library / collections, editing, casting, streaming URLs,
subtitles (planned later), office-doc rendering beyond PDF (planned later), cross-platform
(Electron keeps it feasible later, but Windows-only for now).

Detailed plan and phases live in [`ROADMAP.md`](ROADMAP.md); the design spec and implementation
plan live in `docs/superpowers/`.

## Architecture

Standard Electron three-layer split (`src/main`, `src/preload`, `src/renderer`), mirroring
Filesmith's conventions.

- **The viewer lives here for now.** The plan is a shared package, **`prism-core`**, which
  would also power Filesmith's previews, but it has not been extracted: `ImageView`,
  `VideoView`, `AudioView`, `Visualizer` and the `fsmedia://` protocol are all in this repo
  today. When it is extracted, the split is:
  - `prism-core` owns: the image / video / audio / PDF / text viewer React components, the
    audio visualizer, the `fsmedia://` streaming protocol (Range-aware, so `<video>`/`<audio>`
    can seek), file-kind detection, and thumbnail generation.
  - Prism owns: the window/tray/resident lifecycle, open-file routing (argv / drag / dialog /
    associations), folder navigation, settings, and packaging.
- **Filesmith and Prism never depend on each other at runtime.** They only share `prism-core`,
  which each bundles at build time. A user with Filesmith does not need Prism, and vice versa.

## Reuse from Filesmith (becomes `prism-core`)

These already exist in Filesmith and are the seed of `prism-core` (extracted in Phase 1):

- `src/renderer/src/components/PreviewWindow.tsx`: the image/video/PDF viewer shell.
- `src/renderer/src/components/AudioVisualizer.tsx`: the circular Web-Audio visualizer.
- `src/main/index.ts` `serveMedia` + the `fsmedia://` privileged scheme (Range/206 streaming).
- `src/shared/fileKind.ts`: extension → kind.
- `src/main/thumbnail.ts` + `Util/IconHelper` equivalents: thumbnail/decoded-image fallback.

## Build, test, release

**The root wall covers `fsmedia://` too** (2026-08-28): media is served only from a root, from
an archive member main extracted on request, or from something main made itself (a converted
copy, a synthesised MIDI wav), each registered as it is handed over. The `fsaudio://` sibling
was walled from the start; this one was not, which was an accident of the two handlers being
written a month apart. One softening, because the wall broke something real: a MARKDOWN
DOCUMENT GRANTS ITS OWN PICTURES (`src/main/docImages.ts`). A doc in `docs/` pointing at
`../assets/logo.png` names a file outside the folder Prism opened in, and the wall refused it -
measured, and a regression against the markdown viewer's own relative-path resolver. Main reads
the document it is about to hand over and allows exactly the image files it names, so a page
still cannot ask for a path the document does not mention. The app's OWN asset tree is servable too, and that is not
optional: pdf.js fetches its cmaps, standard fonts, wasm and icc profiles over
`fsmedia://` because `fetch` refuses file: URLs in a packaged build, so walling
them off broke every PDF that does not embed its fonts - and only in the
PACKAGED app, since dev serves the same data over the vite server. Native
dialogs are parented to the window in the same pass - unparented, Windows makes them modeless and a fullscreen picker never
shows at all - and `file:text` is capped (64MB) and awaited, so a read error is caught rather
than escaping as a rejected invoke. It answers with a REASON, never null: the
editor used to seed itself with "(could not read file)" and record that as the
disk contents, so one Ctrl+S wrote the placeholder over a 200MB log. A file
Prism could not read is now shown as unreadable and cannot be saved at all.

**Standing step, every time a new file type is supported:** ask whether this change adds an
extension. If it does, it goes in `src/shared/fileKind.ts` AND
`build/installer/assoc.nsh`, or Windows will never offer Prism for it - Prism will open the
file happily and be missing from its "Open with", which is exactly what happened to 96
extensions when the code viewer landed. `src/shared/fileAssoc.test.ts` enforces the parity and
names the extensions to add, so the answer to "did I remember?" is `npm test`, not a re-read.
It reads BOTH halves of the .nsh since 2026-08-28: the install macro was tested and the
uninstall one was not, so it fell 96 extensions behind and uninstalling left dead "Open with"
entries pointing at a ProgID that no longer existed.
Bare names (`Dockerfile`, `Makefile`) and dotfiles cannot be registered: Windows associates on
extension and they have none.

`npm run dev` / `npm test` for the inner loop; `npm run e2e` drives the built app through
Playwright and runs OFFSCREEN (`tools/e2e/run.mjs` `park()`: opacity 0, position -4000,-4000,
off the taskbar) so it never covers what you are doing. Electron has no headless mode, and a
truly hidden window stops answering clicks and screenshots, so parking it is the way.
It also never takes the FOREGROUND (2026-08-28): the suite passes `--e2e`, and main then
creates the window `focusable: false` and `showInactive()`s it, because thirty launches
yanking the caret out of whatever the owner is typing is its own kind of broken. Playwright
drives the page over CDP, which needs no OS focus. MEASURED both ways: without the flag the
new window becomes the foreground window, with it the foreground never changes.
And every scenario REAPS what it leaves behind (same date, same file): the terminal
scenario's app outlived its `app.close()` - five electron processes still up - and since it
holds the single-instance lock, every scenario after it launched, handed its file over and
exited. Fifteen scenarios failed for one leak, and no amount of retrying could have helped;
only the profile path is matched, so the machine's own Prism is never touched.
`npm run e2e -- <name>` runs only the scenarios whose name contains `<name>`,
and each scenario has its OWN try/catch (2026-08-28): they used to share one,
so the first crash skipped every scenario after it and reported a single
failure. The run ends with a pass/fail/duration table.
`npm run package` builds the NSIS installer;
version lives in `package.json`. **Releasing is automated** (2026-08-21):
`.github/workflows/release.yml` builds and publishes on every push to main - a new
`package.json` version creates release `v<version>` with generated notes, a push on an existing
version replaces that release's installer in place. Bump the version when a release should be
NEW; CI gates are typecheck + unit tests only (the e2e needs this machine). Unsigned, per-user,
GitHub Releases.

**Installing is the LAST verification step, every time work is finished** - after tests,
typecheck, lint and e2e, and not something to ask about first. Tests and e2e drive the built
bundle, never the shipped app: packaging and installing is what proves the installer still
works, that the associations still register, and that the resident app actually launches.
`npm run package`, then install `dist/Prism-Setup-x64-<version>.exe` silently with `/S`
(per-user, no elevation), closing any running Prism first. Report the installed version.

## Conventions

- TypeScript, `sealed`-by-default mindset, small focused files, feature-not-layer organization.
- Follow Filesmith's patterns (aliases `@shared`/`@renderer`, eslint/prettier config, IPC shape,
  frameless TopBar) so `prism-core` drops into both apps cleanly.
- No em-dashes anywhere (use en-dashes, commas, or parentheses).
- No new runtime dependencies beyond React / Electron / `prism-core` without a reason. Current
  reasoned exceptions (all viewer-core, destined for `prism-core`): CodeMirror 6
  (`@codemirror/*` + `@lezer/highlight`, the code viewer: highlighting, folding, search and
  syntax-error squiggles across ~150 languages, which is not a thing to hand-roll),
  `react-markdown` +
  `remark-gfm` + `rehype-raw` + `rehype-sanitize` (markdown), `pdfjs-dist` (PDF),
  `heic-convert` (HEIC decode), `adm-zip` (the archive viewer: reading and rewriting zip
  containers is not a thing to hand-roll; pure JS, no native code), `node-pty` + `@xterm/*` (the terminal: a real ConPTY and
  its renderer, not a thing to hand-roll; node-pty is the app's ONE native module, ships
  N-API prebuilds, and must stay asarUnpacked or Windows cannot load it; `@xterm/*` now
  includes `addon-search`, because searching a terminal means the SCROLLBACK buffer,
  wrapped lines and the alternate screen, none of which a DOM search over the rendered
  rows can see), `exifr` (main-only, the photo's own EXIF). Shells spawn
  with node-pty's bundled conpty.dll (`useConptyDll: true`): the OS conhost FAST-FAILS
  the whole app (0xc0000409, no dialog) when a pty is killed mid-read (crashed 2026-08-21).

## Working with me

This is a bounded product: a viewer. When a request drifts toward a library, an editor, or
general media management, ask before assuming. Especially anything that changes the viewer
chrome, the file-association behavior, or the `prism-core` interface (which Filesmith also
depends on).
