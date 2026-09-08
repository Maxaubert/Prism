# Prism on your phone

Design, 2026-09-06. Owner decisions from the brainstorm are marked **(owner)**.

## What it is

Watch what Prism has open on a phone or tablet on the same network. Prism on the PC is the
server; the phone runs a web page Prism serves, with no app to install. The phone WATCHES on
its own clock. It does not drive the PC: a remote was built and then REMOVED after hands-on
use (see the first decision below), so nothing here promises one.

Out of scope, said plainly: anything off the LAN (no relay, no accounts), HTTPS (a self-signed
certificate on a phone is a worse experience than the risk it removes on a home network),
editing from the phone, and screen mirroring (a video of a window; every kind Prism opens is
reached by reusing its viewers instead).

## Decisions

- **THE PHONE PLAYS WHAT IT OPENS AND NEVER DRIVES THE PC** **(owner, 2026-09-08, after
  using it on an iPad: "remove the this pc button", and when asked, remove it entirely)**.
  This is the decision that stands, and it REPLACES two earlier ones written here: Watch and
  Remote as two switchable modes on the phone page, and then (2026-09-07, while PR4 was
  green) one screen with a "This phone / This PC" target in the player that handed the film
  on screen to the PC with `{op: 'open', path}`. Both were built and both are GONE, root and
  branch: the `/remote/state` stream, the `/remote/cmd` drop, the `phone:state` /
  `phone:cmd` / `phone:listeners` IPC, `shared/remote.ts`, the renderer's target registry,
  the phone's remote panel and client, and the `phoneRemote` e2e. Nobody should rebuild any
  of it by reading the older decision above it, which is why the older wording is not kept:
  a mode to be in before you pick a file, and a second clock on a second screen that
  lockstep was never promised for, are what a remote costs, and neither is worth what it
  bought. What remains is the one-screen explorer, the phone's own player, search and the
  fullscreen routes.
- **SIZED FOR A THUMB** **(owner, 2026-09-08, from the same session: the video controls and
  the rows in the file explorer are too small)**. 44px is the platform floor rather than a
  taste (Apple asks 44pt, Google 48dp) and a row is taller again at 56px, because a list is
  scrolled past as well as tapped. The players are the desktop's own components, so the
  sizing is a stylesheet the app window never loads (`phone.css`, hanging off the phone's
  own viewer stage) rather than a `touch` prop threaded through three of them: the desktop's
  sizes cannot move by accident, and there is no second set of numbers to keep in step.
- **A TAP ASKS FOR THE CONTROLS** **(owner, same session)**. With the chrome hidden, a tap
  on the picture brings it back and does not pause; the next tap plays or pauses. Touch
  only: a mouse has a pointer on screen and keeps the desktop's click-to-pause exactly as it
  always was, so the rule is the pointer type rather than the page.
- **SEARCH ANSWERS ON THE KEYSTROKE** **(owner, same session: "search on mobile is very
  slow")**. The walk was never the slow part (73ms to 357ms measured through the real route);
  the blank list during the debounce and the round trip was. The phone narrows the answer it
  already has with the desktop's own matcher while the ask is out, so the rows stay under the
  finger and the walk's reply replaces them whole.
- **The phone sees ONE tab's folder** **(owner)**: the tab the QR was shown from. Same root
  wall as the tab. Not every open tab.
- **Pair once, remembered** **(owner)**. The QR carries a one-time code; the phone exchanges it
  for a long-lived token kept in its browser. The token remembers the ROOT it was paired to. A
  returning phone opens that root if a tab still holds it; otherwise it gets "that folder is
  no longer open in Prism, scan again". Scanning from another tab moves the phone to that root.
  Paired phones are listed and can be forgotten from Prism.
- **Most kinds Prism opens** **(owner)**: video, audio, pictures, PDF, markdown, code and text
  (read-only), office and ebook documents, comics, archives (listing and viewing members; no
  writes). Hex and the terminal are not offered.
- **And it searches the whole folder** **(owner ask, 2026-09-07)**: a page that browses one
  level at a time cannot reach a file three folders down, so the crumb row carries a
  magnifier and a query REPLACES the list with its hits, each the name over the folder it is
  in. The grammar and the reader are the desktop's - `shared/searchQuery` and `searchFiles`,
  through `GET /api/search?q=` - so the phone implements none of it and none of it can drift.
  The route names no path: what is searched is the root that phone paired to.
- **Fullscreen by whichever route the host has** **(2026-09-07)**: an iPhone has no element
  and no document Fullscreen API at all, so a page that knew only `requestFullscreen` had a
  dead button on the device most likely to press it. `lib/fullscreen` picks between the
  standard API, the older prefixed `webkitRequestFullscreen` and the iOS-only
  `webkitEnterFullscreen` on the media element, and prefers the PAGE wherever it can go:
  the OS player draws over Prism's transport and the way back.
- **Reuse Prism's own viewers** (approach A): a second renderer entry mounts the existing
  viewer components behind a network shim of `window.prism`. This is `prism-core`'s second
  consumer, without extracting the package yet.
- **The home is a Tools button in the title bar** **(owner: "title bar or sidebar bottom")**,
  left of the update chip, opening a menu with one row for now: Phone. That opens a dialog
  holding everything: the switch, the QR and address for the current tab, paired phones with
  Forget, and who is watching. Nothing in Settings, so the feature has one home. The title bar
  is chosen over the sidebar footer because it is present with the sidebar hidden and in the
  empty window.
- **Test devices: iPhone, iPad and Android** **(owner)**. The playback allowlist is per device,
  reported by the phone itself (`canPlayType`), never assumed from the user agent.
- **Four PRs, stacked** **(owner)**: (1) server, pairing, Tools menu, phone shell, direct play
  of video, audio and pictures; (2) the transcode; (3) the document kinds on the phone;
  (4) Remote mode, since REMOVED (see the first decision). Each installable and hand-tested
  on the phone. One spec (this one), a plan per PR.

## Architecture

```
phone browser  <-- HTTP (LAN) -->  main: src/main/phone/  <-- IPC -->  renderer (App)
   phone.html                        server.ts  routes      phone:*      Tools > Phone dialog
   src/renderer/src/phone/           pairing.ts             channel
   prismShim -> fetch                stream.ts (PR2)
   reused viewers
```

### Server (`src/main/phone/`, PR1)

- Node `http` server, one per app, bound on all interfaces, port chosen once (first free from a
  fixed default) and remembered in `userData/phone.json`. Started when the switch is on, stopped
  when off; the switch persists. No WebSocket dependency, and since the remote went there is
  nothing to push either: every route is a plain request the phone makes.
- Advertised address: the first non-internal IPv4 of the machine; the dialog shows every
  candidate when there is more than one, the QR encodes the first.
- The first `listen` raises Windows Firewall's prompt for Prism. The dialog says so BEFORE the
  switch is turned on, because a per-user unelevated installer cannot add the rule, and a
  declined prompt is a phone that cannot connect and no error anywhere.
- Every request except pairing carries the token (`Authorization: Bearer`). Pairing attempts
  are rate-limited (5 per minute per address) and the code is single-use, valid two minutes.
- Routes (all JSON unless said):
  - `GET /` and static assets: the phone bundle, read from the app's `out/renderer` (asar is
    readable through `fs`). In dev, non-API paths are proxied to electron-vite's dev server.
  - `POST /pair {code, name}` -> `{token, root}`.
  - `GET /api/me` -> `{root, open: boolean, name}`. `open` false is the "scan again" screen.
  - `GET /api/dir?path=` -> the same `DirListing` `dir:list` returns, filtered by the phone's
    root with the strict per-root check (`validRoot`).
  - `GET /api/search?q=` -> the `SearchResult` the sidebar's box gets, from `searchFiles`
    over the phone's own root. It names no path, so its wall is `validRoot(root, root)`.
  - `GET /api/stat?path=`, `GET /api/text?path=` (PR3), `GET /api/doc?path=` (PR3),
    `GET /api/comic?path=` (PR3), `GET /api/archive?path=` (PR3), `GET /api/subs?path=`
    (sidecar tracks as WebVTT).
  - `GET /api/play?path=&can=<codec list>` -> `{mode: 'direct' | 'hls', url, subs}` (PR1
    answers direct or refuses; PR2 adds hls).
  - `GET /m/<encoded path>`: the media route with Range. `serveMedia` is factored so that
    `fsmedia://` and this route call one function; the wall is written once, and the phone
    route adds its own root check on top.
  - `GET /hls/<job>/index.m3u8`, `GET /hls/<job>/<n>.m4s` (PR2).
- The phone's root is checked on EVERY route with `validRoot(root, path)`; a path outside it is
  403 even if another tab holds it. Archive members and comic pages come through the same
  grants main already keeps (`extractedPaths`, `comicsDir`).

### Pairing (`src/main/phone/pairing.ts`, pure and tested, PR1)

- State: `{codes: Map<code, {root, expires}>, phones: Map<token, {name, root, paired, seen}>}`.
- `issueCode(root, now)`, `redeem(code, name, now)`, `forget(token)`, `touch(token, now)`,
  `phoneFor(token)`. Codes are 6 characters from an unambiguous alphabet; tokens are 32 random
  bytes, hex.
- Persisted to `userData/phone.json` (`{port, on, phones}`), read once at start, written on
  change; a malformed file starts empty.
- `root` on a phone is updated when the same phone (same token) scans a code from another tab.

### Playback (`src/main/phone/stream.ts`, PR2; the decision is pure and tested)

- `decide(probe, can, ext)`: `direct` when the container is one phones demux (mp4, m4v, mov,
  webm, mp3, m4a, aac, ogg, flac, wav) AND every stream's codec is in the phone's reported
  `can` list; else `hls`. Pictures are always direct (HEIC, RAW and the ffmpeg-decoded stills
  already come back as JPEG or PNG from the media route).
- HLS with fMP4 segments of 4 seconds, event playlist with the full duration up front (from
  ffprobe), so the phone's scrubber shows the whole film from the first segment.
  - Video: `copy` when the phone can play it, else `h264_nvenc` (preset p4, 1080p ceiling,
    `-cq` rate control), falling back to `libopenh264` when NVENC refuses. Audio: `copy` when
    AAC, else `aac` 192k stereo.
  - One job per (phone, file). A segment request beyond what the running job has produced
    kills it and restarts at that segment's time with `-ss` and `-start_number`, which is what
    makes a live transcode seek like a file. Segments live in `userData/phone/<job>/`, removed
    when the job ends and swept at start.
  - Measured before the PR is called done: transcode speed on this machine for a 4K HEVC film
    and a 1080p AC-3 MKV, and the time from tap to first frame on each device.
- Subtitles: the sidecar files Prism already finds (`sidecarsFor`), served as WebVTT through
  `/api/subs`, attached as `<track>` elements. Embedded tracks stay out, as on the PC.
- The playlist goes through `hls.js` (reasoned new renderer dependency, loaded on demand)
  wherever MSE is available, and is the element's own `src` only where there is none (an
  iPhone). MSE-first on purpose, revised 2026-09-06 while measuring: Chromium answers "maybe"
  to the HLS mime, and its built-in player asks for segments without the token, so trusting a
  native claim sent an Android to a player that could not work.

### The phone page (`src/renderer/phone.html`, `src/renderer/src/phone/`, PR1 + PR3)

- Second Vite input. Shares the viewer components, `lib/`, `index.css` and the style tokens;
  its own shell.
- `prismShim.ts` implements the READ-ONLY subset of `PrismApi` over the routes and installs it
  as `window.prism` before anything renders. Everything else is absent, and
  `window.prism.capabilities` says so (`{write: false, clipboard: false, explorer: false,
  drag: false}`); the viewers and `fileVerbs` consult it to hide verbs. `nativeDrag` is false.
  `mediaUrl(path)` returns the `/m/` URL with the token.
- Shell: a top bar (folder name, back, a menu with "Forget this PC"; the Watch / Remote
  toggle planned here is gone with the remote itself, 2026-09-08),
  a folder list rooted at the phone's root (Explorer-shaped, one level at a time, folders
  first, the same sort as the tab's default), a search field over the crumb row whose hits
  replace that list while it holds a query, and the viewer area. Tapping a file opens it;
  swiping or the next/previous buttons page the folder's viewable files as Up/Down do on the
  PC. Landscape on a phone hides the bar while a video plays.
- Touch pass per viewer, measured on the devices: pinch and double-tap on pictures, swipe on
  comics, native fullscreen and the native controls for video on iOS (Safari's inline player
  is the one that supports pinch-to-fill and AirPlay), Prism's transport elsewhere. PDF via
  pdf.js works on mobile; its side data is served under `/pdf/` as on the PC.
- Code and text are read-only (`EditorState.readOnly`); markdown renders formatted with no
  pencil. Nothing on the phone writes, and the shim has no `writeText`.
- The phone keeps its token and root in `localStorage`; a 401 clears them and shows the
  pairing screen (paste the code or scan again).

### In Prism (renderer, PR1)

- **Tools** button in the title bar, left of the update chip, glyph only like the others,
  `aria-label="Tools"`. Opens a `ContextMenu` with the row **Phone** (more rows later).
- **Phone dialog**: the switch (with the firewall note the first time), the QR (SVG from the
  `qrcode` package in main, reasoned new dependency) and the address for the CURRENT tab, a
  "Copy address" button, the paired phones (name, paired date, last seen, Forget), and "N
  watching" from the server's live connections. A new tab as current makes a new code; the
  code is shown for its two minutes and re-issued on demand.
- `phone:*` IPC: `phone:get` (state for the dialog), `phone:set-on`, `phone:code(root)`,
  `phone:forget(token)`, `phone:changed` (push to the dialog).

## Error handling

- A route failure is a status and a one-line reason the phone shows ("Prism refused this
  file", "Prism could not read the folder"); never a blank page.
- A transcode failure carries ffmpeg's last line to the phone, as extraction does on the PC.
- The server failing to bind (port taken) tries the next ten ports, then reports in the
  dialog. The switch reflects what the server IS, not what was clicked.
- A phone that stops fetching segments for 30 seconds ends its job; a phone that reconnects
  starts a new one at its position.
- Main's one thread: nothing on the phone path is sync. Directory listings reuse the bounded
  async `dir:list`; media is streamed with `createReadStream`; ffmpeg is spawned, never
  `execFileSync`.

## Testing

- Unit: `pairing.test.ts` (issue, redeem once, expiry, forget, root update, persistence
  round-trip), `routes.test.ts` (auth, per-root wall, path decoding), `decide.test.ts`
  (direct/hls per container, codec and `can` list), `hls.test.ts` (segment time math,
  restart-at-segment, playlist text), `prismShim.test.ts` (URL building, capabilities), `fullscreen.test.ts` (which of the three
  routes a host gets, entering and leaving on each, and the signals each one gives back -
  the iOS branch lives here because no browser the e2e can drive has it),
  `tapChrome.test.ts` (which pointer reveals and which toggles, pen as a finger, an unknown
  pointer as a mouse), `touch.test.ts` (the deal `phone.css` makes: the floor is declared
  once, the phone's own components size from the token, and every marker the stylesheet
  reaches for is still rendered by the component that owns it), `narrow.test.ts` (a growth
  narrows, a shorter query does not, an emptied narrowing keeps the last answer).
- E2E (`tools/e2e/run.mjs`, scenario `phone`): launch with `--e2e`, turn the server on over
  IPC, issue a code, pair over HTTP, `GET /api/dir`, fetch a fixture with a Range header and
  assert 206, open the phone page in a phone-sized Playwright page with the token, tap a
  fixture and assert the viewer mounts. PR2 adds an HLS fixture play. `phone` also presses
  the film's
  fullscreen control and asserts the standard route takes the page (and its header) with it;
  `phoneDocs` searches, because that is the fixture tree with depth - `ext:py` answers two
  files in two folders, and one three folders down opens from its row.
  The TOUCH decisions are measured in the same two scenarios, under Chromium's touch
  emulation, because they are the difference between the phone page and the app window: the
  `phone` scenario measures an explorer row and a transport button against the 44px floor,
  and taps a PLAYING film whose controls have hidden themselves - the controls come back and
  the film is still playing, then the next tap pauses. That middle assertion is the one that
  carries the rule: with `tapVerb` returning `toggle` the same tap pauses, which is how it
  was checked. `phoneDocs` samples the hit count frame by frame across a keystroke rather
  than counting once, since the failure being guarded against is a list that goes blank for
  a couple of hundred milliseconds and then fills again.
- Hands-on on iPhone, iPad and Android before each PR asks "merge?", with the measurements
  above written into CLAUDE.md.

## Dependencies added

- `qrcode` (main, MIT): QR as SVG for the dialog.
- `hls.js` (renderer, Apache-2.0): HLS wherever MSE is available; the element plays the
  playlist itself only where MSE is absent (iPhone). Loaded on demand.

## Versions

Minor bump per PR, from 0.38.0 (0.36 and 0.37 are the unmerged #102 and #103).
