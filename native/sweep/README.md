# The native sweep box (#338)

Prism's own N-API addon that draws the drag-select box (the sweep, `hooks/useSweep.ts`) with
DirectComposition on Prism's own window, from the real cursor, every compositor frame. File
Explorer draws its box the same way; Chromium's path from a pointer move to a painted DOM box is
one to four frames longer. Design: `docs/superpowers/specs/2026-10-09-native-sweep-overlay-design.md`.
Measurements: `C:\Users\Admin\Documents\Claude\research\prism\2026-10-09-native-sweep-spike.md`.

| File | What it is |
|---|---|
| `box.h` | The box's integer geometry (Explorer's `_SetVisualLoc`): pure, self-tested by the build |
| `overlay.h`, `overlay.cc` | The one native thread, the D3D11 + DComp device, one topmost target per window |
| `sweep.cc` | The JS surface main calls (`src/main/sweepOverlay.ts`), and `selfTest()` |
| `binding.gyp` | node-gyp, MSVC, `/MT`, `/W4 /WX` |

Built by `npm run build:sweep` (`tools/build-sweep.mjs`) into `vendor/sweep/prism_sweep.node`,
shipped by `extraResources` as `resources/sweep/prism_sweep.node`.

## Why in-process, and why a thread of its own

- `CreateTargetForHwnd` refuses another process's window, so only code inside Prism's main
  process can put a visual on Prism's window. A TOPMOST target is drawn above the window's
  children, Chromium's GPU child included. No second window exists: no focus, z-order, owner,
  taskbar or input question.
- The hot loop is native: wait for the compositor clock, `GetCursorPos`, integer math, at most one
  `Commit`. JS sends the box's anchor, clip and colours at the start of a sweep and when the list
  scrolls or resizes, never per pointer move.

## The rules that must not regress

- **The thread never calls into JS.** No thread-safe function: JS only writes the mutex-guarded
  command queue and sets an event. A native callback landing while Node tears down is the
  0xc0000409 abort PrismTerminal #127 measured at quit.
- **Every COM object lives on the thread**: created, used and released there, the target too.
- **The `std::thread` is heap-allocated and never destroyed while joinable.** `shutdown(ms)` joins
  with a timeout and LEAKS the thread past it (`ExitProcess` ends it); a joinable `std::thread` at
  CRT teardown calls `std::terminate`, the same abort. `will-quit`, `process.on('exit')` and the
  env cleanup hook all call it; it is idempotent. Nothing runs in `DllMain`.
- **Bounded waits only while a box is up**: the clock wait has a 100 ms timeout, and an occluded
  return (display off) is followed by a plain 16 ms wait, never a spin. Idle, the thread waits on
  its event alone and costs nothing per frame.
- **`DCompositionWaitForCompositorClock` is resolved with `GetProcAddress`**, never imported, so
  the module loads on Windows 10, where main keeps the DOM box.
- **Never `SetWindowDisplayAffinity`**: the box must stay capturable (Wind's render engine and
  screenshots duplicate the screen).
- **Static CRT.** `dumpbin /dependents` may name only KERNEL32, USER32, d3d11, dxgi, dcomp and the
  delay-loaded node.exe; the build fails otherwise.
- **Any failed HRESULT** marks that window's target failed for the session (a lost device takes
  every target); main then turns the native box off and the page draws the DOM box.

## When the cursor is sampled

Late in the frame, 1000 us before the next compositor tick (`kLeadUsDefault`). MEASURED
2026-10-09/10 at 1x with injected sweeps: sampled at the tick the box is 1.15 frames behind the
pointer, no better than the DOM box (1.06); sampled late at 1000 us it is 0.26 to 0.31 frames
behind at every speed, where File Explorer is 0.72 to 0.86. The owner, zoomed in under Wind:
1500 us "follows almost perfectly ... not quite there", 1000 us "seems like it works".

A commit that lands under 100 us before the tick counts as a miss (calibrated against Desktop
Duplication: it matched the frames actually shown late). More than 14 misses in 1440 up-frames
(ten seconds of sweeping at 144 Hz) widens the lead by 250 us, up to 2000 us; past that the thread
samples at the tick for the rest of the session (a frame behind, never a miss). `stats()` reports
the sampling, the lead in force, the misses and the widenings, and main writes them to the
diagnostics log at each sweep's end.

The anchor waits for its rows: an update is applied `K[cause]` frames after it arrives (auto-scroll
2, wheel 0, resize 2, measured except resize).

## Measuring again

`tools/sweep-latency/` holds the dev-only tools: `latency.cpp` (Desktop Duplication: pointer
updates and the box's edge per frame), `analyze.mjs`, and `addon-check.mjs` (offscreen: start and
stop, attach, a box up, idle wakeups, a second window, 50 quits with a box up). `configure()` on the
addon (sampling, lead, adaptive, ignore the button) exists for these tools only; main never calls
it. The spike's own drivers (`--sweep-spike`, `measure.mjs`) are in the history of #338 at
`18291b7`.
