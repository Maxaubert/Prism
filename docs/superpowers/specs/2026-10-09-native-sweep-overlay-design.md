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

Two visible differences, both accepted here and on the hands-on list:

- The native box has square corners (Explorer's are square); the DOM band has `borderRadius: 2`.
- The native box is drawn above EVERYTHING in Prism's window, so an in-page layer that covers the
  DOM band today (a toast, a tooltip, a popover over the list) is under the native box. The clip
  keeps it inside the list's visible rows, so the column header, the tab strip and the panes are
  never covered.

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
`PrismDwm.cs`. `node-gyp` is a DEV dependency (build time only); it fetches the Node headers itself.

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

Only a MOUSE sweep uses the native box. A pen sweep (useSweep accepts `pointerType === 'pen'`) keeps
the DOM box: Chromium handles WM_POINTER for a pen, so no mouse messages are promoted, the async state
of the mouse buttons stays up and the safety net below would hide the box on its first frame, and
`GetCursorPos` is not guaranteed to follow the pen tip. The renderer sends nothing for a pen sweep.

Three messages, all one-way (`ipcRenderer.send`), none per pointer move:

- `sweep-overlay:begin` `{ id, anchor: {x, y}, clip: {left, top, right, bottom}, dpr, fill, edge }`,
  in the move that starts the sweep (where `flushSync` mounts the band today).
  - `anchor`: the press point mapped from the list's coordinates back to the client with the
    CURRENT scroll (`start` through a new `fromList(start, geo)` option, the inverse of `toList`).
  - `clip`: the scroller's visible client rect from the measured geometry (`clipOf(geo)`),
    exactly, without `place`'s `-2/+2`: the native box is drawn above everything in the window, so a
    clip two pixels wider would draw over the column header. Where the clip cuts the box, that edge
    is not drawn, which is what the DOM band's overflow-hidden `-2/+2` edge looks like (implementation,
    2026-10-10; `box.h`).
  - `dpr`: `window.devicePixelRatio`, which already folds Chromium's zoom and the window's DPI.
  - `fill`, `edge`: the band element's computed `background-color` and `border-top-color`, read once
    (the band stays mounted with `display: none`), parsed to premultiplied-free RGBA bytes by a pure
    `cssColour` parser. Theme changes during a held sweep are not followed (the band does not
    follow them today either).
- `sweep-overlay:update` `{ id, cause, anchor, clip, dpr }`, from `scrolled()` (scroll, window
  resize, list resize) after `remeasure()`, so the anchor follows the content as auto-scroll and the
  wheel move it, and a DPI change mid-drag arrives as a new `dpr`. `cause` is `'auto'` (our own
  `scrollTop` write in the auto-scroll tick), `'scroll'` (any other scroll event: the wheel, a
  scrollbar) or `'resize'`, because the native side delays each cause differently (below).
- `sweep-overlay:end` `{ id }`, from `hide()` (release, Escape, pointercancel, blur, a move with the
  button up, unmount): every path that hides the DOM box today.

Main sends `sweep-overlay:state` `{ native: boolean }` on every `did-finish-load` of the page (so a
reload starts from the truth, not from a stale `true`) and again on every change. Until a page has
heard `true` it treats the answer as `false`. The renderer keeps the band hidden while `native` is
true AND was true when the sweep's `begin` went: a `true` that arrives mid-sweep found no box main
took (main ignores a `begin` while native is off), so that sweep keeps the DOM band. If main finds the
native side failed on a `begin`, or drops a `begin` as invalid, it sends `{ native: false }`, and
the renderer shows the DOM band AT ONCE, in place, the pointer held still or not (review, 2026-10-10:
it used to wait for the next move; the `sweepOverlay` e2e drives both through main's e2e hook). A
refusal because the window's target FAILED turns the native box off for the session
(`target-failed`), so a reload is not told `true` again.

The three messages pass through main's event loop, so a busy main delays `begin` (the box appears
late) and `end` from Escape (the box stays a little longer). The release is covered without main by
the button check below. The spike records the begin-to-visible and Escape-to-gone delays; the
diagnostics log's slow-IPC line already reports a main that is busy.

### What main does

- Validates every message (finite numbers, bounded sizes, id matches the window's live sweep) in a
  pure `src/shared/sweepOverlay.ts`.
- Maps to physical client pixels (`src/main/sweepOverlayMath.ts`, pure): `round(css * dpr)` for the
  anchor, `floor` for clip left and top, `ceil` for right and bottom, plus the window's
  client-to-target origin offset that the spike measures (expected 0,0 with `titleBarStyle: 'hidden'`;
  the maximised inset is measured too). The edge is `max(1, floor(dpr))` physical pixels, which is
  what Chromium draws for today's 1 CSS px border (MEASURED 2026-10-10 in this Electron: 1 px at 100
  to 175 %, 2 at 200 to 250 %; the first build rounded and drew it twice as thick at 150 and 175 %).
- Hands it to the addon for the sender's window (`BrowserWindow.fromWebContents`, HWND from
  `getNativeWindowHandle()`).
- Ends the box itself, without waiting for the page, on the window's `blur`, `minimize`, `hide`,
  `closed`, the page's `render-process-gone` and a cross-document `did-start-navigation`
  (`isSameDocument` false: an in-page URL change is not a reload), and at `will-quit`.

### What the native thread does, every compositor frame while a box is up

1. `DCompositionWaitForCompositorClock(1, &wake, 100)` (loaded with `GetProcAddress`; its
   presence is the Windows 11 check). The wake event also carries begin, update, end and stop, so
   nothing waits a frame for a state change. A bounded timeout, never `INFINITE`, so the stop flag
   is always seen. The call returns AT ONCE with `STATUS_GRAPHICS_PRESENT_OCCLUDED` while the
   display is off or occluded (documented): any return that is neither the clock nor the wake event
   is followed by a plain 16 ms wait on the wake event, so a box up over a sleeping display never
   spins a core.
2. If the primary mouse button is up, hide the box: the box never outlives the button, even if the
   page's release never arrived. `GetAsyncKeyState` reads PHYSICAL buttons (documented), so the
   primary is `VK_RBUTTON` when `GetSystemMetrics(SM_SWAPBUTTON)` is set. It reads 0 on a desktop
   that is not the input desktop (lock screen, UAC), which hides the box: the safe way to fail.
3. `GetCursorPos`, `ScreenToClient(hwnd)`: physical client pixels (PMv1 and PMv2 both get
   unvirtualised coordinates; the spike confirms for the native thread).
4. The box, in integer pixels, as Explorer's `_SetVisualLoc` does: `left = min(ax, cx)`,
   `right = max(ax, cx) + 1`, same down; then intersected with the clip. The far corner is clamped to
   the clip plus one pixel, Explorer's `OnMouseMoved` clamp. An edge the clip cut off is not drawn.
5. If the rect equals the last committed one, do nothing (no commit, no GPU work). Otherwise set five
   visuals (fill, four edges) as offsets and scale transforms of two 1x1 premultiplied colour
   surfaces with nearest-neighbour interpolation and a hard border mode, and `Commit` once.

The colour surfaces are filled once per `begin` that changes a colour. `IDCompositionSurface::BeginDraw`
hands back a texture that may be an ATLAS shared with other surfaces plus an `offset` into it
(documented), so the fill is `ID3D11DeviceContext1::ClearView` on the 1x1 rect at that offset, never
`ClearRenderTargetView`, which would clear the whole atlas. Format `B8G8R8A8_UNORM`, premultiplied
alpha, so the CSS straight-alpha bytes are premultiplied in the addon.

**When the sample is taken: late in the frame, 1000 us before the next tick** (decided 2026-10-09
from the spike's numbers and the owner's eye; research `prism/2026-10-09-native-sweep-spike.md`).
The compositor clock ticks as DWM starts composing a frame; a commit made just after the tick is
composed in the NEXT frame, so a cursor sampled at the tick is a whole frame old when it reaches the
glass. MEASURED at 1x with injected sweeps: sampled at the tick the box is 1.15 frames behind the
pointer, no better than today's DOM box (1.06), and the owner could not tell them apart; File
Explorer is 0.65. So after the tick the thread waits until `kLeadUsDefault` (1000 us) before the
next frame's tick, then reads the cursor and commits: 0.29 frames at 1200 us with no missed frame,
0.25 at 900 us with 0.3 % missed. The owner, zoomed in under Wind, judged 1500 us "follows almost
perfectly ... not quite there" and 1000 us "seems like it works". The lead is a constant with that
reason beside it, not a setting.

A machine whose timer wakes later can miss DWM's latch at 1000 us (a missed commit shows a frame
late). The thread counts a commit that lands under `kLatchUs` (100 us) before the tick as a miss
(calibrated 2026-10-10 against the frames Desktop Duplication saw a frame late; 300 us over-counted
several times and widened for nothing); more than 14 in a window of 1440 up-frames (ten seconds of
sweeping at 144 Hz, over 1 %) WIDENS the lead by 250 us, up to 2000 us, never narrower than 1000.
The confirming run (injected, 2026-10-10) stayed at 1000 us with no widening.
Past 2000 us it falls back to sampling at the tick for the rest of the session: a frame behind, but
never a miss. `stats()` reports the sampling, the lead in force, the misses and the widenings, and
main writes them to the diagnostics log at the first `end` and at any `end` where they changed.

While no box is up the thread waits on the event alone and costs nothing per frame.

### The anchor waits for its rows

An `update` reaches the native side at a different time from when Chromium shows the matching rows,
and the gap depends on who scrolled:

- **`auto`**: our tick writes `scrollTop` and sends the update in the same task; Chromium shows the
  scrolled rows two to four frames later. Applied at once, the anchored edge would run ahead of its
  row, a new kind of mismatch.
- **`scroll`** (wheel, scrollbar): Chromium scrolls on its COMPOSITOR thread and the `scroll` event
  reaches the page's main thread at or after the frame that showed it. Applied late, the edge would
  lag its row instead.
- **`resize`**: like `auto`, the new layout shows a few frames after the page measured it.

So the native side applies an update `K[cause]` compositor frames after it arrives, each `K` measured
in the spike as the delay that minimises the anchored edge's distance from its row (not inferred
from the pointer lag, which is a different path), constants in the addon, not settings. MEASURED in
the spike (2026-10-10, injected): `auto` 2, `scroll` 0; `resize` not measured, 2 (as `auto`) until it
is. The far corner is never delayed. Mostly the anchored edge is
clipped out of view during auto-scroll; this keeps it glued to its row when it is in view (a wheel
turn under a held button).

### Teardown

- `end` hides the visuals in the next commit (a frame), before React has unmounted anything.
- Per window: the DComp target is created when the window has painted its first frame (never on the
  startup path, the #189 rule) and released on `closed`.
- Process: `will-quit` calls the addon's `shutdown()`, which sets stop, wakes the thread and joins it
  (bounded, 250 ms; past that it logs and LEAKS the thread, which `ExitProcess` then ends).
  `process.on('exit')` and a `napi_add_env_cleanup_hook` call it again (idempotent), for the
  `app.exit` paths that skip `will-quit`.
- The thread object is heap-allocated and never destroyed while joinable: a static or member
  `std::thread` still joinable when the CRT tears down calls `std::terminate`, which is the same
  0xc0000409 abort as #127. Nothing runs in `DllMain`. Every COM object is created and released on
  the native thread; the JS side only writes the mutex-guarded state and sets the event.
- A hung native thread would leave its last committed box on the window until the window closes
  (main cannot draw on its behalf). The thread's only blocking call is the clock wait with its
  100 ms timeout, and `stats().frames` is checked by main at `end`: no progress for 500 ms is logged
  and turns the native box off for the session.

## When the native box is not used (automatic, no setting)

Main decides per window and tells the page. The native box is off when any of these holds, and the
reason is written to the diagnostics log once per change:

- the addon is missing or fails to load (dev without `npm run build:sweep`, a damaged install);
- Windows has no `DCompositionWaitForCompositorClock` (Windows 10: the supported 1809+ range keeps
  today's box; `DwmFlush` was measured at 1.6 ms of jitter and would be a second timing path to keep
  correct for a box the owner will not see; a later decision if Windows 10 users ask. OWNER'S CALL,
  asked with the PR: Windows 10 users get exactly today's box);
- `GetSystemMetrics(SM_REMOTESESSION)` (Remote Desktop composes on the client; rechecked on
  every `begin`, on `unlock-screen` and on `display-metrics-changed` / `display-added`);
- device or target creation failed, or any HRESULT failed during a sweep (off for the session);
- the sweep is not a mouse sweep (a pen: above);
- `--e2e` (the e2e records the contract instead, below);
- `--sweep-overlay=off` on the command line, for diagnosing a report only. Not in Settings: the
  native box is the same feature drawn better, not a choice a user should have to make.

No setting, because the two boxes look the same but for the corners and the layering above, and the
difference that matters is latency.

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
Duplication). Desktop Duplication reports the pointer per MOUSE UPDATE (`LastMouseUpdateTime`,
`PointerPosition`), not per composed frame, and some acquisitions carry only a pointer update
(`LastPresentTime` 0). So the tool logs the two streams separately, interpolates the pointer's
position at each image frame's `LastPresentTime`, and finds the box's far edge along a scan line in
that image. The lag of a frame is the pointer-to-edge gap divided by the pointer's speed over that
frame, in frames. **The owner moves the mouse himself** (passive mode, the default): nothing is
injected and nothing runs on the owner's screen without a run he starts. A SendInput mode exists only
for a run the owner explicitly allows. It records three sweeps of about ten seconds each, slow,
medium and fast, both down and across, once with the native box and once with the spike flag left
off (today's DOM box) for the comparison. Wind is off or at 1x for the measured run: a magnified
image would put the box's edge in Wind's pixels, not the screen's.

The spike's Prism is a dev build started with its own `--user-data-dir` in the session scratchpad:
the owner's installed Prism holds the single-instance lock of the default profile, and a launch
against it would hand over and exit. The owner's Prism is never closed.

**Go** when all of these hold:

1. Native box median lag at or below File Explorer's median at every speed, under the same
   injected motion, and p95 at most 2 frames. (Was "median at most 1.25 frames": the tick-sampled
   box passed that at 1.15 frames while the owner saw no difference from today's box, so the bar is
   Explorer, the box the owner compares against. Changed 2026-10-09 with the spike's numbers.)
2. Native median below the DOM box's median at every speed in the same run. (Was "at least 1 frame
   below": the DOM box after #332 measures 1.06 frames, so that bar could not be met by any box
   short of a negative lag.)
3. Shake: the standard deviation of the native gap at most 0.5 frame at a steady speed.
4. Visible above Chromium's content in six window states: acrylic on and off, mica, normal,
   maximised, fullscreen, and still visible after the material is switched WHILE the target is
   attached (Chromium rewrites DWM attributes on a backdrop change); its origin within one physical
   pixel of the DOM box's at rest.
5. Gone within one frame of the button's release in every recorded sweep. Recorded, not gated:
   begin-to-visible and Escape-to-gone, which pass through main.
6. 50 quits in a row (`app.quit()` from a test hook) with a box up, no crash dialog and no
   0xc0000409.
7. The thread's CPU while a box is up under 1% of a core, and zero wakeups while idle.

**No-go**: first measure the late-sample variant (above); if it still fails, stop, write the numbers
into the research folder, keep today's box, report to the owner. `K[cause]` (the anchor delays) come
from the same run: the delay that keeps the anchored edge closest to its row during an auto-scroll
and during a wheel turn under a held button.

## Packaging and CI

- Source `native/sweep/` (`binding.gyp`, `sweep.cc`, `overlay.cc`, `overlay.h`, `box.h`). Built by
  `tools/build-sweep.mjs` (`npm run build:sweep`), the `build:dwm` pattern: node-gyp with MSVC,
  `/MT` (static CRT, so nothing from the VC++ redistributable is needed on a fresh Windows; the
  script checks `dumpbin /dependents` names only an allow-list: `KERNEL32`, `USER32`, `d3d11`,
  `dxgi`, `dcomp`, and the delay-loaded `node.exe` that node-gyp's `win_delay_load_hook` redirects to
  the host exe; any `VCRUNTIME*`, `MSVCP*` or `api-ms-win-crt-*` fails the build), output
  `vendor/sweep/prism_sweep.node`, then a self-test in plain Node (load, `selfTest()` runs the box
  math cases, `probe()` reports the Windows build and whether the clock exists, no window).
- Shipped by `extraResources` (`vendor/sweep` to `sweep`), outside the asar, so no `asarUnpack`
  entry. Main loads `resources/sweep/prism_sweep.node` packaged and `vendor/sweep/` in dev.
- `ci.yml` `check` job and `release.yml` run `npm run build:sweep` beside `build:dwm`; `package`
  runs it too. The windows-latest image has VS 2022 MSVC, SDK 26100 and Python (documented).
  node-gyp fetches the Node headers and `node.lib` for its target version from nodejs.org on a
  cold cache (build time only, never at run time); the build pins the target with `--target` to the
  Node version Electron 43 embeds, so the build machine's own Node version does not matter.
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
  is what e2e users see); an `update` from a wheel turn carries `cause: 'scroll'`, one from the
  auto-scroll `cause: 'auto'`; a pen sweep sends nothing; a reload sends a fresh `state`.
  `marquee`, `marqueeEdge`, `marqueeQuiet` and `sweepLag` stay green unchanged.
- **Hands-on** (installed build, owner's machine): fast sweeps unzoomed and zoomed with Wind (both
  engines), auto-scroll down and up, wheel under a held button, Escape mid-sweep, Alt+Tab and
  Win+D mid-sweep, release outside the window, a second monitor at another scale with the window
  moved across, acrylic on and off, maximised and fullscreen, a light and a dark theme and a picked
  accent, the tree and the Explorer, two Prism windows, quit with a box up; the marks following the
  box on a fast sweep (whether that reads well zoomed in is the owner's to judge); a toast or tooltip
  over the list during a sweep (it is now under the box); square corners.

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
| Anchored edge runs ahead of, or behind, its row during scroll | `K[cause]`, measured per cause. |
| Remote Desktop, Windows 10 | Automatic fallback to today's box. |
| Pen sweep | DOM box; nothing sent. |
| Display off with a box up | Occluded return followed by a 16 ms wait, never a spin. |
| Hung native thread leaves a box | Bounded waits only; main sees no progress and turns it off. |
| GPU reset (TDR) | The thread asks the D3D device at every `begin` and every frame a box is up (`GetDeviceRemovedReason`): a commit on a lost device can succeed and show nothing, and the colour surfaces are refilled only when a colour changes, so no HRESULT would fail. Lost: every target is released, native off for the session. |

## Version

Minor: `0.99.1` to `0.100.0`, inside the PR.
