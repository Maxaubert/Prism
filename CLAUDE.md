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
- **Code / text** viewer (2026-08-17): CodeMirror 6, always editable (see below). ~20 Lezer
  grammars give highlighting, folding and real syntax-error squiggles; `@codemirror/legacy-modes`
  adds ~100 stream lexers for highlighting only, so those languages never claim an error.
  Deliberately no semantic diagnostics: without a tsconfig or node_modules they would be noise.
  Every language loads on demand (one Vite chunk each). Prose (`.txt`, `.log`, `.csv`, subtitles)
  gets no gutter and no language. Token colours are fixed in `index.css`, NOT part of a style.
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
  archives (>600MB) list but refuse member operations. Properties on a zip reports what it
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
  taken names asking cancel / keep both / replace. The same drag crosses surfaces: sidebar
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
  click - a plain click still opens a file or expands a folder (double-click-to-open was
  tried and rolled back the same day; only the ARCHIVE is double-click, where single
  click selects). Contiguous selected rows fuse (shared edges drop their rounding).
  Search results speak the same selection language, multi right-click included.
  DRAG-SELECT came back for the ARCHIVE alone (2026-08-25): it starts only on the
  panel's DEAD SPACE, so a row drag (which moves members) can never leave a phantom
  band behind - the failure that got the tree's sweep removed - and its listeners
  die on pointerup and pointercancel alike. A press on dead space, or anywhere
  outside the rows at all, CLEARS the marks in both surfaces: highlighting says
  "these are what I am about to act on", so it must not outlive walking away from
  them. What stays marked is the OPEN file, which is marked for being open.
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
  (3037KB to 1503KB).
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
  time readout about. Past 100% the ELEMENT cannot help - `HTMLMediaElement.volume`
  is capped at 1 by the spec - so `lib/audio` routes it through Web Audio:
  source -> gain -> destination, built ONCE per element and only when a boost is
  actually asked for, so an ordinary file at 80% never touches Web Audio at all.
  The visualizer taps that same chain (a second MediaElementSource for one
  element throws, and a second path to the speakers would play the file twice).
  The sidecar decoder's `<audio>` gets the same treatment, since for a Dolby
  film that element is the one making the sound.
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
  the stored one, and applies to a 5-second clip too. Not persisted: a file
  opened fresh tomorrow should play, from its own beginning if it is short,
  because that is what opening a file means. Playback itself cannot continue
  while the tab is away - there is no element to play it.
- **Pause in background** (2026-08-26, the transport cog): one toggle, off by
  default. Away means another window has the focus OR Prism is minimised -
  PotPlayer's "Pause playback when focus lost", which covers VLC's
  "Pause playback when minimized" too. The signal comes from MAIN over
  `window:state`: Electron does not mark a minimised window hidden, so
  `visibilitychange` never fires and `document.hidden` stays false however small
  the window gets. It resumes only what IT paused (`lib/backgroundPause`, pure
  and tested), so a film you stopped by hand stays stopped.
- **Playback position** (`useMediaControls`, tuned 2026-08-24 by owner decision): media longer
  than 10 MINUTES reopens where you left it, silently - no prompt, no banner. Anything shorter
  never is, which is why a 5-second clip always starts at the start. Stopping inside the LAST
  MINUTE counts as watched: the position is neither saved nor restored there, so a film never
  reopens into its own credits. Video and audio share the rule, so audiobooks and long mixes
  resume and songs do not.
- **"Open in Prism" in Explorer's menu** (2026-08-24, `shellVerb.ts`), off by default, switched
  in Settings > General. A classic HKCU verb under `*`, `Directory` and (2026-08-25)
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
  window so it appears instantly (mitigates Electron cold-start).
- **Update chip** (title bar, right of the file name): one shape for every state, and it never
  changes width - the chip IS the progress bar, filling with accent from the left as the
  download runs (owner pick from 12 mockups, 2026-08-24). Only shown when an update exists.
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

**Standing step, every time a new file type is supported:** ask whether this change adds an
extension. If it does, it goes in `src/shared/fileKind.ts` AND
`build/installer/assoc.nsh`, or Windows will never offer Prism for it - Prism will open the
file happily and be missing from its "Open with", which is exactly what happened to 96
extensions when the code viewer landed. `src/shared/fileAssoc.test.ts` enforces the parity and
names the extensions to add, so the answer to "did I remember?" is `npm test`, not a re-read.
Bare names (`Dockerfile`, `Makefile`) and dotfiles cannot be registered: Windows associates on
extension and they have none.

`npm run dev` / `npm test` for the inner loop; `npm run e2e` drives the built app through
Playwright and runs OFFSCREEN (`tools/e2e/run.mjs` `park()`: opacity 0, position -4000,-4000,
off the taskbar) so it never covers what you are doing. Electron has no headless mode, and a
truly hidden window stops answering clicks and screenshots, so parking it is the way.
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
  N-API prebuilds, and must stay asarUnpacked or Windows cannot load it). Shells spawn
  with node-pty's bundled conpty.dll (`useConptyDll: true`): the OS conhost FAST-FAILS
  the whole app (0xc0000409, no dialog) when a pty is killed mid-read (crashed 2026-08-21).

## Working with me

This is a bounded product: a viewer. When a request drifts toward a library, an editor, or
general media management, ask before assuming. Especially anything that changes the viewer
chrome, the file-association behavior, or the `prism-core` interface (which Filesmith also
depends on).
