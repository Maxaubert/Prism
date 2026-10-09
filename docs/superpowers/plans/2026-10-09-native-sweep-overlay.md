# The drag-select box in a native overlay: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Windows 11 the sweep box is drawn by a DirectComposition visual on Prism's own window from the real cursor every compositor frame (about one frame behind the pointer, as Explorer), with today's DOM box as the automatic fallback.

**Architecture:** An N-API addon (`native/sweep/`, Prism's own C++) loaded lazily in main owns one native thread, a D3D11 device and a DComp device, and one topmost DComp target per BrowserWindow HWND. The renderer's `useSweep` keeps hit testing and marks, and sends begin / update / end (anchor, clip, dpr, colours, never per move) through main, which validates, maps CSS px to physical client pixels and forwards. The thread waits on `DCompositionWaitForCompositorClock`, reads `GetCursorPos`, computes an integer rect and commits only on change. It never calls back into JS.

**Tech Stack:** Electron 43 main, C++17 with MSVC via node-gyp (dev dependency), `node_api.h`, D3D11, DirectComposition, React 19 renderer, Vitest, the Playwright e2e in `tools/e2e/run.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-09-native-sweep-overlay-design.md`

## Global Constraints

- No em-dashes anywhere in code, comments, docs or UI copy.
- Never send input to the owner's screen and never open anything on it, except in a run the owner starts or explicitly allows (task 1). Never close `PrismTerminal` or `PrismTerminalStable`.
- Nothing new on the startup path: the addon loads and the target is made after the window's first paint (#189).
- The native thread never calls into JS (no thread-safe functions): the PrismTerminal #127 abort class.
- Static CRT (`/MT`); `dumpbin /dependents` of the `.node` lists only system DLLs.
- `DCompositionWaitForCompositorClock` is resolved with `GetProcAddress`, never imported, so the addon loads on Windows 10.
- The addon never calls `SetWindowDisplayAffinity`.
- No new runtime dependency. New dev dependencies: `node-gyp`, `node-api-headers`.
- Version: `package.json` to `0.100.0` inside this PR.
- Commits: `type(scope): subject` with the trailers `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01FHHaWKR4M5QtW7Wecyuk4t`.
- Branch `feat/338-native-sweep-overlay`, worktree `.claude/worktrees/native-sweep`, issue #338.

---

### Task 1: Spike, the go/no-go gate

Nothing after this task starts until the gate passes. On a no-go the branch stops here.

**Files:**
- Create: `native/sweep/binding.gyp`, `native/sweep/sweep.cc` (spike quality: begin/end, hard-coded colours, no K delay)
- Create: `tools/sweep-latency/latency.cpp`, `tools/sweep-latency/build.mjs` (dev-only measuring tool, never shipped)
- Modify (spike-only, reverted at the end of the task): `src/main/index.ts` to load the addon behind `--sweep-spike` and draw a box from the press point of a renderer test hook
- Create: `C:\Users\Admin\Documents\Claude\research\prism\2026-10-09-native-sweep-spike.md` (results, with source and date; listed in `research\README.md` if the topic list needs it)

- [ ] **Step 1: Addon that draws.** D3D11 device (hardware, WARP fallback), `DCompositionCreateDevice2`, `CreateTargetForHwnd(hwnd, TRUE)`, two 1x1 premultiplied surfaces filled with `ClearRenderTargetView`, five visuals with nearest-neighbour interpolation, a thread looping on the compositor clock with a wake event, `GetCursorPos` plus `ScreenToClient`, commit on change.
- [ ] **Step 2: Offscreen checks first (no owner screen).** In a parked offscreen Prism window: target creation returns S_OK, the thread starts and stops 100 times, `GetThreadDpiAwarenessContext` on the native thread is logged, and `app.quit()` with a box up 50 times in a loop ends with exit code 0 every time (criterion 6).
- [ ] **Step 3: Build the measuring tool.** Desktop Duplication of the monitor holding Prism; per frame: `DXGI_OUTDUPL_FRAME_INFO` pointer position and time, the box's far edge along a scan line through the list's blank gutter (edge colour from the theme in force, read from the page), output CSV. Passive mode by default (records while the owner moves the mouse); `--inject` (SendInput at a fixed speed per compositor tick) only with the owner's explicit yes for that run.
- [ ] **Step 4: Ask the owner for a two-minute run, then run it.** He sweeps slow, medium and fast, down and across, once with the spike box and once with `--sweep-overlay=off`. Also: acrylic on and off, mica, normal, maximised, fullscreen (criterion 4, by eye and by the tool's edge position against the DOM box's at rest).
- [ ] **Step 5: Decide.** Compute per speed: median and p95 lag in frames, standard deviation at steady speed, release-to-gone frames, thread CPU. Gate: native median <= 1.25 frames and p95 <= 2 at every speed; native median at least 1 frame below the DOM box's; SD <= 0.5 frame; visible in all six window states with origin within 1 physical px; gone within 1 frame of release; 50/50 clean quits; CPU < 1% of a core while up, zero idle wakeups. Record K = round(DOM box median lag). Record the measured client-to-target origin offset, normal and maximised.
- [ ] **Step 6: Write the results file and report go or no-go to the orchestrator/owner.** Revert the spike-only `index.ts` change; keep `native/sweep/` as the starting point for task 4.

**Verification:** the research file holds every number of the gate and the verdict.

---

### Task 2: The message contract, pure

**Files:**
- Create: `src/shared/sweepOverlay.ts`
- Test: `src/shared/sweepOverlay.test.ts`

**Interfaces:**
```ts
export interface CssPoint { x: number; y: number }
export interface CssRect { left: number; top: number; right: number; bottom: number }
export type Rgba = readonly [number, number, number, number] // bytes, straight alpha
export interface SweepBegin { id: number; anchor: CssPoint; clip: CssRect; dpr: number; fill: Rgba; edge: Rgba }
export interface SweepUpdate { id: number; anchor: CssPoint; clip: CssRect; dpr: number }
export interface SweepEnd { id: number }
export interface SweepState { native: boolean }
export const SWEEP_CHANNELS: { begin: 'sweep-overlay:begin'; update: 'sweep-overlay:update'; end: 'sweep-overlay:end'; state: 'sweep-overlay:state' }
export function parseBegin(v: unknown): SweepBegin | null
export function parseUpdate(v: unknown): SweepUpdate | null
export function parseEnd(v: unknown): SweepEnd | null
```

- [ ] **Step 1: Failing tests.** Accepts a well-formed message; refuses NaN, Infinity, a negative-size clip, coordinates beyond +-100000, `dpr` outside 0.25..8, a colour byte outside 0..255 or not an integer, a non-integer id, extra nesting.
- [ ] **Step 2: Run** `npx vitest run src/shared/sweepOverlay.test.ts`, expect failures.
- [ ] **Step 3: Implement** the parsers.
- [ ] **Step 4: Run again,** expect pass. Commit `feat(sweep): the native box's message contract (#338)`.

---

### Task 3: CSS to physical pixels, and colours, pure

**Files:**
- Create: `src/main/sweepOverlayMath.ts`, test `src/main/sweepOverlayMath.test.ts`
- Create: `src/renderer/src/lib/cssColour.ts`, test `src/renderer/src/lib/cssColour.test.ts`

**Interfaces:**
```ts
// main
export interface PhysBox { ax: number; ay: number; left: number; top: number; right: number; bottom: number; edge: number }
export function toPhysical(m: SweepUpdate, origin: { x: number; y: number }): PhysBox
// renderer
export function cssColour(s: string): Rgba | null
```

- [ ] **Step 1: Failing tests.** At dpr 1, 1.5, 2.25 (and 2.25 x 1.1 zoom): anchor `round(css * dpr) + origin`; clip left/top `floor`, right/bottom `ceil`; edge `max(1, round(dpr))` (2 at 2.25, 1 at 1.25); the spike's origin offset applied. `cssColour`: `rgb(1, 2, 3)`, `rgba(1, 2, 3, 0.16)`, `color(srgb 0.1 0.2 0.3 / 0.16)` (how Chromium serialises `color-mix`), `transparent`, junk returns null.
- [ ] **Step 2: Run,** expect failures. **Step 3: Implement. Step 4: Run,** expect pass. Commit `feat(sweep): map the box to physical pixels (#338)`.

---

### Task 4: The addon, product quality

**Files:**
- Modify: `native/sweep/binding.gyp` (`/MT`, `/O2`, `/W4 /WX`, C++17, `win_delay_load_hook`)
- Create: `native/sweep/box.h` (pure integer box math), `native/sweep/overlay.h`, `native/sweep/overlay.cc` (device, targets, thread), `native/sweep/sweep.cc` (N-API surface), `native/sweep/README.md` (what it is, why in-process, the rules above)
- Create: `tools/build-sweep.mjs`
- Modify: `package.json` (`build:sweep`, `package` runs it, devDependencies `node-gyp`, `node-api-headers`), `.gitignore` (`native/sweep/build/`)

**Interfaces (JS side of the addon):**
```ts
interface PrismSweep {
  probe(): { build: number; clock: boolean; remote: boolean }
  attach(hwnd: Buffer): void           // async on the thread; state via status()
  status(hwnd: Buffer): 'pending' | 'ready' | 'failed' | 'none'
  begin(hwnd: Buffer, box: PhysBox, fill: Rgba, edge: Rgba): boolean // false: not ready
  update(hwnd: Buffer, box: PhysBox): void // applied K frames later (anchor and clip only)
  end(hwnd: Buffer): void
  detach(hwnd: Buffer): void
  shutdown(timeoutMs: number): boolean   // idempotent; false if the join timed out
  stats(): { frames: number; commits: number; maxWorkUs: number; failures: number }
  selfTest(): string[]                   // empty when every box.h case passes
}
```

- [ ] **Step 1: Failing self-test.** Write the `box.h` cases in `selfTest()` (anchor left or right of the cursor, above or below, zero-size, far corner clamped to clip +1, intersection with clip, empty when fully clipped, +1 on right and bottom) against a stub returning wrong values; `node tools/build-sweep.mjs` fails on them.
- [ ] **Step 2: Implement `box.h`;** the build's self-test passes.
- [ ] **Step 3: Implement the thread** (command queue under a mutex, one auto-reset wake event; idle: `WaitForSingleObject`; up: compositor clock with the wake handle; primary-button check honouring `SM_SWAPBUTTON`; K-frame queue for updates, K from task 1; commit only on change; any failed HRESULT marks the target failed, hides, and raises `failures`). All COM calls on the thread, including target creation.
- [ ] **Step 4: Implement `tools/build-sweep.mjs`** after `tools/build-dwm.mjs`: skip off Windows, run node-gyp against `node-api-headers`, copy to `vendor/sweep/prism_sweep.node`, run `dumpbin /dependents` (found by `vswhere`) and fail on any non-system DLL, then load it in plain Node and fail on a non-empty `selfTest()` or a throwing `probe()`.
- [ ] **Step 5: Verify** `npm run build:sweep` passes; offscreen attach/begin/end/shutdown loop (task 1's harness) still clean. Commit `feat(sweep): the native box addon (#338)`.

---

### Task 5: Main owns availability, forwarding and teardown

**Files:**
- Create: `src/main/sweepOverlay.ts`, test `src/main/sweepOverlay.test.ts`
- Modify: `src/main/index.ts` (wiring only: `initSweepOverlay({ packaged, resourcesPath, appPath, e2e, argv })` after the first window's first paint, `will-quit` and `process.on('exit')` call `shutdown`)
- Modify: `electron-builder.yml` (`extraResources`: `vendor/sweep` to `sweep`, filter `prism_sweep.node`)

**Interfaces:**
```ts
export type OffReason = 'missing' | 'load-failed' | 'no-clock' | 'remote' | 'e2e' | 'flag' | 'target-failed' | 'runtime-failure'
export function sweepDirs(packaged: boolean, resourcesPath: string, appPath: string): string[]
export function initSweepOverlay(deps: { load: (path: string) => PrismSweep | null; e2e: boolean; argv: readonly string[]; log: (kind: string, fields: object) => void; ... }): SweepOverlay
export interface SweepOverlay { attach(win: BrowserWindow): void; shutdown(): void; recorded?: unknown[] }
```

- [ ] **Step 1: Failing tests with a fake addon.** State `{ native: false }` with each OffReason (and one diag line per change); `{ native: true }` only after `status` is `ready`; begin/update/end forwarded with `toPhysical`; an invalid message dropped; a begin that returns false sends `{ native: false }` to that page; `blur`, `minimize`, `hide`, `closed`, `render-process-gone`, `did-start-navigation` call `end` (and `closed` calls `detach`); `shutdown` once at will-quit and harmless again at exit; under `e2e` nothing is loaded and every message is pushed to `globalThis.__e2eSweepOverlay`; remote session rechecked on `session-change` and `display-metrics-changed`.
- [ ] **Step 2: Run,** expect failures. **Step 3: Implement. Step 4: Run,** expect pass.
- [ ] **Step 5: Wire** in `index.ts`; `npm run typecheck`; `npm run dev` with the e2e-style offscreen check that `startup` stays under 800 ms (`npm run e2e -- startup`). Commit `feat(sweep): main decides and forwards the native box (#338)`.

---

### Task 6: Preload bridge

**Files:**
- Modify: `src/preload/index.ts`, `src/preload/index.d.ts`

- [ ] **Step 1:** `sweepOverlay: { begin(m: SweepBegin): void; update(m: SweepUpdate): void; end(m: SweepEnd): void; onState(cb: (s: SweepState) => void): () => void }`, using `SWEEP_CHANNELS`.
- [ ] **Step 2:** `npm run typecheck` passes. Commit with task 7.

---

### Task 7: `useSweep` talks to the overlay, and hides the DOM box only when told

**Files:**
- Modify: `src/renderer/src/hooks/useSweep.ts`
- Create: `src/renderer/src/hooks/sweepOverlayState.ts` (one subscription per page, `nativeBox(): boolean`)
- Modify: `src/renderer/src/components/browse/BrowseList.tsx`, `src/renderer/src/components/Sidebar.tsx` (new options), `src/renderer/src/components/TreeRows.tsx` (`SweepBand` comment)

**New options on `SweepOptions<G>`:**
```ts
/** The list's own coordinates back to the page's client, with the measured scroll. */
fromList: (p: { x: number; y: number }, geo: G) => { x: number; y: number }
/** The scroller's visible rect in the page's client, from the measured geometry. */
clipOf: (geo: G) => CssRect
```

- [ ] **Step 1:** In the move that starts a sweep: read the band's computed colours (`cssColour`), send `begin` with `fromList(start)`, `clipOf(geo)`, `devicePixelRatio`. In `scrolled()`: send `update`. In `hide()`: send `end`. `paint()` keeps writing the band's place, but leaves `display: none` while `nativeBox()` is true, so the fallback is a flag flip, not a code path.
- [ ] **Step 2:** On `{ native: false }` during a sweep, the next `paint()` shows the band.
- [ ] **Step 3:** BrowseList: `fromList` is the inverse of its `toList` (`x - scrollLeft + left`, `logicalTopAt` undone); `clipOf` is the measured rect with `place`'s -2/+2. Sidebar: the same from its geometry.
- [ ] **Step 4:** `npm run typecheck`, `npm run lint`, `npm test`. `npm run e2e -- marquee` and `npm run e2e -- sweepLag` still pass (DOM box under e2e). Commit `feat(sweep): the list hands the box to the native overlay (#338)`.

---

### Task 8: e2e for the contract

**Files:**
- Modify: `tools/e2e/run.mjs` (new `sweepOverlayScenario`, registered near `sweepLagScenario`)

- [ ] **Step 1: Write the scenario.** Explorer list with 300 rows, then the tree. Sweep by CDP moves; read `globalThis.__e2eSweepOverlay` through `app.evaluate`. Assert: exactly one `begin` per sweep with the anchor within 1 CSS px of the press point, the clip equal to the scroller's client rect (+-2), `dpr` equal to the page's, `fill` and `edge` equal to the band's computed colours; zero messages per plain pointer move; during auto-scroll an `update` per scroll step whose anchor y moved by the scroll delta; one `end` each for release, Escape, and a blur (window `blur` from the test); the DOM band visible throughout.
- [ ] **Step 2: Run** `npm run e2e -- sweepOverlay` against task 7 with `end` disabled in `hide()`; expect the release assertion to fail. Restore; expect pass.
- [ ] **Step 3:** Commit `test(sweep): the native box's contract under e2e (#338)`.

---

### Task 9: CI and release build it

**Files:**
- Modify: `.github/workflows/ci.yml` (`check` job: `- run: npm run build:sweep` after `build:dwm`, with a comment)
- Modify: `.github/workflows/release.yml` (`npm run build:sweep` before `npm run build`)

- [ ] **Step 1:** Edit both. **Step 2:** Push the branch; the `check` job builds and self-tests the addon on windows-latest (green). Commit `ci(sweep): build and self-test the native box addon (#338)`.

---

### Task 10: Docs and version

**Files:**
- Modify: `CLAUDE.md` (replace "THE REST OF THE TRAIL IS CHROMIUM'S, AND WAS LEFT" with the native box rule: the owner's words, what draws it, the fallback list, the no-JS-callback rule, the spike numbers, the e2e and hands-on names; add `node-gyp` and the addon to the native-code notes beside `PrismDwm`)
- Modify: `package.json` version `0.100.0`; `package-lock.json`
- Modify: `README.md` only if it lists the sweep

- [ ] **Step 1:** Edit. **Step 2:** `grep` the diff for em-dashes (none). Commit `docs(sweep): the native box in CLAUDE.md, version 0.100.0 (#338)`.

---

### Task 11: Gate, install, hands-on, PR

- [ ] **Step 1:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:sweep`, then the full `npm run e2e` (parked, unfocused).
- [ ] **Step 2:** Package and install per CLAUDE.md (kill `Prism` and `Prism-Setup*` only, silent install, poll the exe's LastWriteTime, launch, report the version). Confirm `resources\sweep\prism_sweep.node` is present and the diag log says `native` for the window.
- [ ] **Step 3:** Owner hands-on list: fast sweeps unzoomed and zoomed in Wind (transform and render engines); auto-scroll down and up; wheel under a held button (anchored edge stays on its row); Escape mid-sweep; Alt+Tab and Win+D mid-sweep; release outside the window; second monitor at another scale, window dragged across; acrylic on and off, maximised, fullscreen; a light and a dark theme and a picked accent; the tree and the Explorer; two Prism windows; quit with a box up.
- [ ] **Step 4:** Open the PR (closes #338) with the spike numbers, the unsigned `.node` note, and the hands-on list; ask "merge?" once with a recommendation.
