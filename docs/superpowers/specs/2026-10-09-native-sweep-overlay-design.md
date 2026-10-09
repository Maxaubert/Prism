# The drag-select box draws in a native overlay, at Explorer's latency: design

Issue #338. Branch `feat/338-native-sweep-overlay`. One approval covers this spec and the plan
(`docs/superpowers/plans/2026-10-09-native-sweep-overlay.md`).

## The owner's words

2026-10-08 (#332): "fast movements make it fall behind the cursor, while it should stay at the
cursor position perfectly the whole time, file explorer's highlight does it perfectly". After #332
shipped, zoomed in with Wind, the box still trails and shakes on fast moves. 2026-10-09, having been
told the rest of the trail is Chromium's own path and the only way past it is a native overlay: he
chose the native overlay. Asked whether the trail shows without zoom: "Yes, it totally does happen
even when not soon" (dictated; read as "not zoomed").

This reverses the 2026-10-09 CLAUDE.md line "the owner declined it" under #332; the implementation PR
rewrites that paragraph.

## Research this rests on

- `C:\Users\Admin\Documents\Claude\research\prism\2026-10-08-explorer-marquee.md`: how Explorer draws
  its box (one source of position, integer pixels, about one composed frame behind the hardware
  cursor) and why Chromium is two to four frames behind. Option 6 is this design.
- `C:\Users\Admin\Documents\Claude\research\prism\2026-10-09-native-overlay-facts.md`: measured facts.
  The two that decide the design: both DirectComposition target slots on Prism's own BrowserWindow
  HWND are free in the browser process (S_OK, measured), and a minimal N-API addon built against Node
  24 headers loads unchanged in Electron 43 main (measured).

## What changes for the user

On Windows 11 the box is drawn by Windows' compositor from the real cursor, every compositor frame,
as Explorer's is: about one frame behind the pointer instead of two to four. Its colours are the same
theme colours as today. The row marks still come from the page, so on a fast move the marks now
follow the box by Chromium's frames (today the box follows the pointer by them). That is the inverse
of today and is accepted: the box is what the eye tracks, the marks settle the moment the hand stops,
and at the release the marks that stand are the box's (unchanged rule from #332).

Everywhere the native box cannot run (below), today's DOM box draws exactly as it does now. There is
no setting.

## The approach: one, with reasons

**An N-API addon in Prism's main process that puts a topmost DirectComposition visual tree on the
BrowserWindow's own HWND, driven by its own native thread on the compositor clock.**

Why this and not the other two routes in the facts sheet:

1. **No second window.** A topmost DComp target is drawn above the window's children (documented),
   which includes Chromium's GPU-process `Intermediate D3D Window`. The box is then part of Prism's
   own window: it moves, minimises, hides and is covered by other windows with it, takes no input
   (DComp visuals have no hit testing), never takes focus, is not on the taskbar or in Alt+Tab, and
   has no z-order, owner or input-queue question (the cross-process owner trap, Raymond Chen). Every
   risk the layered-popup routes carry is absent by construction.
2. **Only in-process code may target the HWND.** `CreateTargetForHwnd` refuses another process's
   window (documented), so a helper exe (route b) would have to fall back to its own layered popup
   with every risk in point 1. That rules out the crash isolation a helper would buy.
3. **Not koffi (route c).** It would be a third-party runtime dependency, the hot loop would be
   JavaScript in a worker isolate with its own GC, and DComp and D3D11 are COM vtables, awkward and
   unsafe to hand-call. Our own small C++ is shorter than the binding code koffi would need.
4. **No JS on the hot path, and the thread never calls JS.** The loop is native: wait for the
   compositor clock, `GetCursorPos`, integer math, at most one `Commit`. JS talks to it only through
   synchronous calls that write a mutex-guarded state and set an event. With no thread-safe function
   back into JS there is no native callback that can land while Node tears down, which is exactly the
   abort class PrismTerminal #127 measured (0xc0000409 at quit).

What it costs, accepted: a new build step (node-gyp with MSVC, both on this machine and the
windows-latest runner, measured and documented), and a crash in the addon takes Prism's main process
down. The second is mitigated by keeping the addon tiny (one thread, a handful of COM calls, every
HRESULT checked, any failure disables it for the session) and by the spike's quit loop.

It is not a third-party runtime dependency: the addon is Prism's own code under `native/sweep/`, like
`PrismDwm.cs`. `node-gyp` and `node-api-headers` are DEV dependencies (build time only).

## Who owns what

| Part | Owner | Does |
|---|---|---|
| Hit testing, marks, auto-scroll, Escape, click swallowing | renderer (`useSweep`), unchanged | exactly what #332 does today |
| The box's ANCHOR, clip and colours | renderer computes, main forwards | sent at the start and whenever the list scrolls or resizes |
| The box's FAR CORNER | native thread | `GetCursorPos` every compositor frame |
| Drawing | native thread | DComp visuals on the window's topmost target |
| Whether the native box is used | main (`sweepOverlay.ts`) | per window, decided once, re-decided on display or session change |
| Fallback box | renderer | today's `SweepBand`, shown whenever main has not said "native" |

### What the renderer sends (CSS px of the page, which is the window's client area)

Three messages, all one-way (`ipcRenderer.send`), none per pointer move:

- `sweep-overlay:begin` `{ id, anchor: {x, y}, clip: {left, top, right, bottom}, dpr, fill, edge }`,
  in the move that starts the sweep (where `flushSync` mounts the band today).
  - `anchor`: the press point mapped from the list's coordinates back to the client with the
    CURRENT scroll (`start` through a new `fromList(start, geo)` option, the inverse of `toList`).
  - `clip`: the scroller's visible client rect from the measured geometry (the rect the DOM box is
    clamped to today, `place`'s `-2/+2` included).
  - `dpr`: `window.devicePixelRatio`, which already folds Chromium's zoom and the window's DPI.
  - `fill`, `edge`: the band element's computed `background-color` and `border-top-color`, read once
    (the band stays mounted with `display: none`), parsed to premultiplied-free RGBA bytes by a pure
    `cssColour` parser. Theme changes during a held sweep are not followed (the band does not
    follow them today either).
- `sweep-overlay:update` `{ id, anchor, clip, dpr }`, from `scrolled()` (scroll, window resize, list
  resize) after `remeasure()`, so the anchor follows the content as auto-scroll and the wheel move
  it, and a DPI change mid-drag arrives as a new `dpr`.
- `sweep-overlay:end` `{ id }`, from `hide()` (release, Escape, pointercancel, blur, a move with the
  button up, unmount): every path that hides the DOM box today.

Main answers once per page and again on change: `sweep-overlay:state` `{ native: boolean }`. The
renderer keeps the band hidden while `native` is true. If main finds the native side failed on a
`begin` it sends `{ native: false }`, and the renderer shows the DOM band from the next move (one
sweep may lose its box for a few frames; logged).

### What main does

- Validates every message (finite numbers, bounded sizes, id matches the window's live sweep) in a
  pure `src/shared/sweepOverlay.ts`.
- Maps to physical client pixels (`src/main/sweepOverlayMath.ts`, pure): `round(css * dpr)` for the
  anchor, `floor` for clip left and top, `ceil` for right and bottom, plus the window's
  client-to-target origin offset that the spike measures (expected 0,0 with `titleBarStyle: 'hidden'`;
  the maximised inset is measured too). The edge is `max(1, round(dpr))` physical pixels, which is
  what Chromium draws for today's 1 CSS px border.
- Hands it to the addon for the sender's window (`BrowserWindow.fromWebContents`, HWND from
  `getNativeWindowHandle()`).
- Ends the box itself, without waiting for the page, on the window's `blur`, `minimize`, `hide`,
  `closed`, the page's `render-process-gone` and `did-start-navigation`, and at `will-quit`.

### What the native thread does, every compositor frame while a box is up

1. `DCompositionWaitForCompositorClock(1, &wake, INFINITE)` (loaded with `GetProcAddress`; its
   presence is the Windows 11 check). The wake event also carries begin, update, end and stop, so
   nothing waits a frame for a state change.
2. If the primary mouse button is up (`GetAsyncKeyState`, `SM_SWAPBUTTON` honoured), hide the box:
   the box never outlives the button, even if the page's release never arrived.
3. `GetCursorPos`, `ScreenToClient(hwnd)`: physical client pixels (PMv1 and PMv2 both get
   unvirtualised coordinates; the spike confirms for the native thread).
4. The box, in integer pixels, as Explorer's `_SetVisualLoc` does: `left = min(ax, cx)`,
   `right = max(ax, cx) + 1`, same down; then intersected with the clip. The far corner is clamped to
   the clip plus one pixel, Explorer's `OnMouseMoved` clamp.
5. If the rect equals the last committed one, do nothing (no commit, no GPU work). Otherwise set five
   visuals (fill, four edges) as offsets and scale transforms of two 1x1 premultiplied colour
   surfaces with nearest-neighbour interpolation, and `Commit` once.

While no box is up the thread waits on the event alone and costs nothing per frame.

### The anchor waits for its rows

An `update` from a scroll reaches the native side before Chromium has shown the scrolled rows (that
is the very latency being removed for the cursor). Applied at once, the anchored edge would run ahead
of its row by two to four frames of scroll during auto-scroll, a new kind of mismatch. So the native
side applies each `update` K compositor frames after it arrives, K being Chromium's own frame lag as
the spike measures it on this machine (expected 2 or 3, a constant in the addon, not a setting). The
far corner is never delayed. Mostly the anchored edge is clipped out of view during auto-scroll
anyway; this keeps it glued to its row when it is in view (a wheel turn under a held button).

### Teardown

- `end` hides the visuals in the next commit (a frame), before React has unmounted anything.
- Per window: the DComp target is created when the window has painted its first frame (never on the
  startup path, the #189 rule) and released on `closed`.
- Process: `will-quit` calls the addon's `shutdown()`, which sets stop, wakes the thread and joins it
  (bounded, 250 ms; past that it detaches and logs). `process.on('exit')` calls it again (idempotent),
  for the `app.exit` paths that skip `will-quit`.

## When the native box is not used (automatic, no setting)

Main decides per window and tells the page. The native box is off when any of these holds, and the
reason is written to the diagnostics log once per change:

- the addon is missing or fails to load (dev without `npm run build:sweep`, a damaged install);
- Windows has no `DCompositionWaitForCompositorClock` (Windows 10: the supported 1809+ range keeps
  today's box; `DwmFlush` was measured at 1.6 ms of jitter and would be a second timing path to keep
  correct for a box the owner will not see; a later decision if Windows 10 users ask);
- `GetSystemMetrics(SM_REMOTESESSION)` (Remote Desktop composes on the client; rechecked on
  `session-change` and `display-metrics-changed`);
- device or target creation failed, or any HRESULT failed during a sweep (off for the session);
- `--e2e` (the e2e records the contract instead, below);
- `--sweep-overlay=off` on the command line, for diagnosing a report only. Not in Settings: the
  native box is the same feature drawn better, not a choice a user should have to make.

No setting, because the two boxes look the same and the only difference is latency.

## Magnifiers

- Windows Magnifier and Wind's transform engine magnify everything DWM composes, the pointer
  included: the box behaves as Explorer's does.
- Wind's render engine captures with Desktop Duplication and draws its own cursor sprite. DComp
  content is captured like any other; the addon never calls `SetWindowDisplayAffinity`, so the box is
  never excluded from capture (it would vanish under Wind and from screenshots). The box then trails
  Wind's sprite by the duplicated frame's age, the same floor Explorer has there.
- There is no new window, so nothing layered ever becomes foreground and Wind's engine pick is
  untouched.

## The spike comes first (plan task 1), with a go/no-go number

Before any product code: a throwaway build of the addon drawing a box from `GetCursorPos` on a real
Prism window, and a measuring tool.

**What it measures.** A small C++ tool (`tools/sweep-latency/`) duplicates the monitor (Desktop
Duplication), and per composed frame records the hardware pointer position from the frame info and
the box's far edge found along a scan line. The lag of a frame is the pointer-to-edge gap divided by
the pointer's speed over that frame, in frames. **The owner moves the mouse himself** (passive mode,
the default): nothing is injected and nothing runs on the owner's screen without a run he starts. A
SendInput mode exists only for a run the owner explicitly allows. It records three sweeps of about
ten seconds each, slow, medium and fast, both down and across, once with the native box and once
with `--sweep-overlay=off` (today's box) for the comparison.

**Go** when all of these hold:

1. Native box median lag at most 1.25 frames and p95 at most 2 frames at every speed.
2. Native median at least 1 frame below the DOM box's median in the same run.
3. Shake: the standard deviation of the native gap at most 0.5 frame at a steady speed.
4. Visible above Chromium's content in six window states: acrylic on and off, mica, normal,
   maximised, fullscreen; its origin within one physical pixel of the DOM box's at rest.
5. Gone within one frame of the button's release in every recorded sweep.
6. 50 quits in a row (`app.quit()` from a test hook) with a box up, no crash dialog and no
   0xc0000409.
7. The thread's CPU while a box is up under 1% of a core, and zero wakeups while idle.

**No-go**: stop, write the numbers into the research folder, keep today's box, report to the owner.
K (the anchor delay) is the DOM box's median lag from the same run, rounded.

## Packaging and CI

- Source `native/sweep/` (`binding.gyp`, `sweep.cc`, `overlay.cc`, `overlay.h`, `box.h`). Built by
  `tools/build-sweep.mjs` (`npm run build:sweep`), the `build:dwm` pattern: node-gyp with MSVC,
  `/MT` (static CRT, so nothing from the VC++ redistributable is needed on a fresh Windows; the
  script checks `dumpbin /dependents` names only system DLLs), output
  `vendor/sweep/prism_sweep.node`, then a self-test in plain Node (load, `selfTest()` runs the box
  math cases, `probe()` reports the Windows build and whether the clock exists, no window).
- Shipped by `extraResources` (`vendor/sweep` to `sweep`), outside the asar, so no `asarUnpack`
  entry. Main loads `resources/sweep/prism_sweep.node` packaged and `vendor/sweep/` in dev.
- `ci.yml` `check` job and `release.yml` run `npm run build:sweep` beside `build:dwm`; `package`
  runs it too. The windows-latest image has VS 2022 MSVC, SDK 26100 and Python (documented).
- Signing: the `.node` is a PE file like the exe and must be in the SignPath signing set once Prism
  is enrolled; until then it ships unsigned like everything else, and the PR says so.
- No network request, so `PRIVACY.md` is unchanged.

## Tests

- **Unit (vitest)**: `shared/sweepOverlay.test.ts` (message validation, refuses NaN, huge rects, a
  stale id), `main/sweepOverlayMath.test.ts` (CSS to physical at 100%, 150%, 225% and with zoom,
  rounding of anchor and clip, edge width, the origin offset), `renderer/lib/cssColour.test.ts`
  (`rgb()`, `rgba()`, `color(srgb ...)` as Chromium serialises `color-mix`, alpha 0 and 1),
  `main/sweepOverlay.test.ts` with a fake addon (availability reasons, attach after first paint,
  end on blur/minimize/closed/render-process-gone, shutdown at will-quit, e2e recording).
- **Native self-test**: the box math (`box.h`: anchor either side, zero size, clamp, clip, the +1
  right and bottom) runs in `build:sweep` and therefore in CI.
- **e2e** (`sweepOverlay`, new): under `--e2e` the native side is off and main RECORDS every message
  on `globalThis.__e2eSweepOverlay`. The scenario sweeps the Explorer list and the tree and asserts:
  one `begin` with the anchor at the press point, the scroller's clip, the page's `dpr` and the band's
  colours; an `update` per auto-scroll step whose anchor moved by the scroll; one `end` for each of
  release, Escape, blur; no message per pointer move; and the DOM box drawn throughout (the fallback
  is what e2e users see). `marquee`, `marqueeEdge`, `marqueeQuiet` and `sweepLag` stay green
  unchanged.
- **Hands-on** (installed build, owner's machine): fast sweeps unzoomed and zoomed with Wind (both
  engines), auto-scroll down and up, wheel under a held button, Escape mid-sweep, Alt+Tab and
  Win+D mid-sweep, release outside the window, a second monitor at another scale with the window
  moved across, acrylic on and off, maximised and fullscreen, a light and a dark theme and a picked
  accent, the tree and the Explorer, two Prism windows, quit with a box up.

## Risks

| Risk | What covers it |
|---|---|
| The topmost visual does not draw above Chromium's GPU child, or not under acrylic | Spike criterion 4, before any product code. No-go if it fails. |
| Focus | No window exists; DComp takes no input. Blur ends the box (main and page). |
| Z-order over other windows | The box is inside Prism's window: other windows cover it as they cover the list. |
| DPI change mid-drag | The page's `resize` path sends a new `dpr`; the thread reads the cursor in physical pixels regardless. One frame may be off. |
| Two monitors | Everything is relative to the window's client; `ScreenToClient` handles a cursor on the other monitor. Hands-on with a second scale. |
| Crash in the addon takes main down | Tiny surface, every HRESULT checked, disable on first failure, no JS callbacks, spike quit loop of 50. |
| Shutdown abort (PrismTerminal #127) | No thread-safe function into JS; bounded join in `will-quit` and at exit. |
| Startup stall (#189) | Nothing on the startup path: the target is created after the first paint, the addon is loaded lazily then. |
| Marks lag the box | Accepted (the inverse of today); the release commits the box's marks. |
| Anchored edge runs ahead during scroll | The K-frame delay on updates, measured. |
| Remote Desktop, Windows 10 | Automatic fallback to today's box. |

## Version

Minor: `0.99.1` to `0.100.0`, inside the PR.
