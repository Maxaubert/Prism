# Prism on your phone

Design, 2026-09-06. Owner decisions from the brainstorm are marked **(owner)**.

## What it is

Watch what Prism has open on a phone or tablet on the same network. Prism on the PC is the
server; the phone runs a web page Prism serves, with no app to install. The phone can either
WATCH on its own clock, or act as a REMOTE for the PC's player. Both **(owner)**.

Out of scope, said plainly: anything off the LAN (no relay, no accounts), HTTPS (a self-signed
certificate on a phone is a worse experience than the risk it removes on a home network),
editing from the phone, and screen mirroring (a video of a window; every kind Prism opens is
reached by reusing its viewers instead).

## Decisions

- **The phone plays independently, and can also drive the PC** as two switchable modes on the
  phone page: Watch and Remote **(owner)**. In Remote mode the phone's own player is unmounted,
  so there is one clock on screen; lockstep between the two screens is not promised, because a
  live transcode runs seconds behind.
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
  (4) Remote mode. Each installable and hand-tested on the phone. One spec (this one), a plan
  per PR.

## Architecture

```
phone browser  <-- HTTP (LAN) -->  main: src/main/phone/  <-- IPC -->  renderer (App)
   phone.html                        server.ts  routes      phone:*      Tools > Phone dialog
   src/renderer/src/phone/           pairing.ts             channel      remote commands in
   prismShim -> fetch/SSE            stream.ts (PR2)                     the active tab's player
   reused viewers                    remote.ts (PR4)
```

### Server (`src/main/phone/`, PR1)

- Node `http` server, one per app, bound on all interfaces, port chosen once (first free from a
  fixed default) and remembered in `userData/phone.json`. Started when the switch is on, stopped
  when off; the switch persists. No WebSocket dependency: the phone receives state over
  Server-Sent Events and sends commands with POST.
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
  - `GET /api/stat?path=`, `GET /api/text?path=` (PR3), `GET /api/doc?path=` (PR3),
    `GET /api/comic?path=` (PR3), `GET /api/archive?path=` (PR3), `GET /api/subs?path=`
    (sidecar tracks as WebVTT).
  - `GET /api/play?path=&can=<codec list>` -> `{mode: 'direct' | 'hls', url, subs}` (PR1
    answers direct or refuses; PR2 adds hls).
  - `GET /m/<encoded path>`: the media route with Range. `serveMedia` is factored so that
    `fsmedia://` and this route call one function; the wall is written once, and the phone
    route adds its own root check on top.
  - `GET /hls/<job>/index.m3u8`, `GET /hls/<job>/<n>.m4s` (PR2).
  - `GET /remote/state` (SSE), `POST /remote/cmd` (PR4).
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
- Shell: a top bar (folder name, back, Watch / Remote toggle, a menu with "Forget this PC"),
  a folder list rooted at the phone's root (Explorer-shaped, one level at a time, folders
  first, the same sort as the tab's default), and the viewer area. Tapping a file opens it;
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

### Remote mode (`src/main/phone/remote.ts`, PR4)

- The renderer reports the active tab's player state to main (`phone:state`: file, kind,
  playing, position, duration, volume, muted, speed) on every change and once a second while
  playing; main fans it out over SSE to phones in Remote mode. Nothing is sent while no phone
  listens.
- Commands (`play`, `pause`, `toggle`, `seek {to}`, `step {by}`, `next`, `prev`, `volume
  {to}`, `mute`) go POST -> main -> `phone:cmd` -> App, which routes them into the active tab's
  `MediaControls`. A command with no player open is answered 409 and the phone says so.
- The phone's Remote screen: the file name, a scrubber, the transport verbs, volume. It is
  the PC's state drawn on the phone; the phone's own `<video>` is unmounted in this mode.

### In Prism (renderer, PR1)

- **Tools** button in the title bar, left of the update chip, glyph only like the others,
  `aria-label="Tools"`. Opens a `ContextMenu` with the row **Phone** (more rows later).
- **Phone dialog**: the switch (with the firewall note the first time), the QR (SVG from the
  `qrcode` package in main, reasoned new dependency) and the address for the CURRENT tab, a
  "Copy address" button, the paired phones (name, paired date, last seen, Forget), and "N
  watching" from the server's live connections. A new tab as current makes a new code; the
  code is shown for its two minutes and re-issued on demand.
- `phone:*` IPC: `phone:get` (state for the dialog), `phone:set-on`, `phone:code(root)`,
  `phone:forget(token)`, `phone:changed` (push to the dialog), `phone:state` / `phone:cmd`
  (PR4).

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
  restart-at-segment, playlist text), `remote.test.ts` (state reducer, command validation),
  `prismShim.test.ts` (URL building, capabilities).
- E2E (`tools/e2e/run.mjs`, scenario `phone`): launch with `--e2e`, turn the server on over
  IPC, issue a code, pair over HTTP, `GET /api/dir`, fetch a fixture with a Range header and
  assert 206, open the phone page in a phone-sized Playwright page with the token, tap a
  fixture and assert the viewer mounts. PR2 adds an HLS fixture play; PR4 drives the PC's
  player from the phone page and asserts its state.
- Hands-on on iPhone, iPad and Android before each PR asks "merge?", with the measurements
  above written into CLAUDE.md.

## Dependencies added

- `qrcode` (main, MIT): QR as SVG for the dialog.
- `hls.js` (renderer, Apache-2.0): HLS wherever MSE is available; the element plays the
  playlist itself only where MSE is absent (iPhone). Loaded on demand.

## Versions

Minor bump per PR, from 0.38.0 (0.36 and 0.37 are the unmerged #102 and #103).
