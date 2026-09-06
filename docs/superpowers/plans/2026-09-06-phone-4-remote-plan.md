# Prism on your phone, PR 4: Remote mode

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The phone page has a Remote mode: it shows what the PC's active tab is playing (name, position, duration, volume) and drives it (play, pause, seek, next, previous, volume, mute), instantly, with the phone's own player unmounted.

**Architecture:** The active foreground player registers itself in a tiny renderer registry (`lib/remoteTarget.ts`) from inside `useMediaControls` (it already knows whether it owns the keyboard: `keys`). App reports the target's state to main over `phone:state` on change and once a second while playing; main fans it out over Server-Sent Events (`GET /remote/state`) to phones listening, and turns `POST /remote/cmd` into `phone:cmd` for App, which calls the registered controls (next/previous go through App's own same-kind stepping). Nothing is sent while no phone listens.

**Tech Stack:** as before; SSE over the existing `http` server, no new dependency.

**Spec:** `docs/superpowers/specs/2026-09-06-phone-design.md`

## Global Constraints

- No em-dashes. Branch `feat/107-phone-remote` off `feat/106-phone-documents`; issue #107; version `0.41.0`.
- A command with no player open answers 409 and the phone says so. Commands are validated in a pure function before they reach the renderer.
- The phone's own `<video>`/`<audio>` is UNMOUNTED in Remote mode: one clock on screen.
- Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01MGe29Jw7CVa2MjsshPeQPM`.

---

### Task 1: The wire shapes, pure

**Files:**
- Create: `src/shared/remote.ts` + `src/shared/remote.test.ts`

**Interfaces:**
```ts
export interface RemoteState {
  /** Nothing playable is open in the active tab. */
  empty: boolean
  name: string
  kind: 'video' | 'audio' | ''
  playing: boolean
  cur: number
  dur: number
  vol: number      // 0..2
  muted: boolean
  rate: number
  canNext: boolean
  canPrev: boolean
}
export type RemoteCmd =
  | { op: 'play' } | { op: 'pause' } | { op: 'toggle' }
  | { op: 'seek'; to: number } | { op: 'step'; by: number }
  | { op: 'next' } | { op: 'prev' }
  | { op: 'volume'; to: number } | { op: 'mute' }
export function emptyState(): RemoteState
export function parseCmd(raw: unknown): RemoteCmd | null      // validates op and numeric ranges (to >= 0, |by| <= 600, 0 <= volume <= 2)
export function stateChanged(a: RemoteState, b: RemoteState): boolean   // everything but cur, plus cur when it moved more than 0.9s
```

- [ ] Tests for `parseCmd` (accepts each op, refuses unknown ops, NaN, a negative seek, a volume of 3, a non-object) and `stateChanged` (a 0.5s tick is not a change, a 1s tick is, play/pause is, the same object is not). Implement. Commit `feat(phone): remote wire shapes, pure and tested (#107)`.

---

### Task 2: The registry and App's reporting

**Files:**
- Create: `src/renderer/src/lib/remoteTarget.ts` + test
- Modify: `src/renderer/src/lib/useMediaControls.ts`, `src/renderer/src/App.tsx`, `src/preload/index.ts`

**Interfaces:**
- `remoteTarget.ts`:
  ```ts
  export interface Target { controls: MediaControls; kind: 'video' | 'audio' }
  export function setTarget(t: Target | null): void
  export function getTarget(): Target | null
  export function onTarget(cb: (t: Target | null) => void): () => void
  ```
- `useMediaControls`: when `keys` is true (the foreground player), `setTarget({ controls, kind })` in an effect on every render of the controls object's changing fields (playing/cur/dur/vol/muted/rate), and `setTarget(null)` on unmount or when `keys` turns false. The hook needs the kind: add `kind?: 'video' | 'audio'` to `Options`, passed by `VideoView` and `AudioView`.
- preload: `phoneState(s: RemoteState): void` (send), `onPhoneCmd(cb: (c: RemoteCmd) => void): () => void`, `onPhoneListeners(cb: (n: number) => void): () => void` (so App reports only while someone listens).
- App: an effect that subscribes to `onTarget` and to the listener count; builds `RemoteState` from the target plus the active tab's file name and `sameKindIndex(±1) >= 0`; sends on `stateChanged` and on a 1s interval while `playing` and listeners > 0; handles `onPhoneCmd` by calling the target's `togglePlay`/`seekTo`/`seekBy`/`setVol`/`toggleMute`, and `stepSameKind(±1)` for next/prev; `play`/`pause` become `togglePlay` only when the state differs.

- [ ] Tests for the registry (set/get/subscribe/unsubscribe). Implement. Typecheck, lint, unit. Commit `feat(phone): the foreground player registers as the remote's target; App reports and obeys (#107)`.

---

### Task 3: SSE and the command route in main

**Files:**
- Modify: `src/main/phone/routes.ts` (+ test: `/remote/state` -> `{ kind: 'remote', what: 'state' | 'cmd', query }`), `src/main/phone/server.ts` (+ test), `src/main/index.ts`

**Interfaces:**
- `PhoneDeps` gains `remote: { onCmd: (token: string, cmd: RemoteCmd) => Promise<boolean>; onListeners: (n: number) => void }` and the server gains `pushState(s: RemoteState): void`.
- `GET /remote/state` (token required): `text/event-stream`, sends the last known state at once as `event: state\ndata: <json>\n\n`, then every push; a `: ping` comment every 15s; on close, decrements listeners.
- `POST /remote/cmd` (token required, JSON body): `parseCmd` -> 400 on null; `onCmd` resolves false -> 409 `{ error: 'nothing is playing on the PC' }`; true -> 204.
- `index.ts`: `onCmd` sends `phone:cmd` to the window and resolves `true` when a `phone:state` arrived in the last 5s with `empty === false` (main keeps the last state, which is also what a fresh SSE client is sent); `onListeners` sends `phone:listeners`; `ipcMain.on('phone:state', ...)` stores and calls `server.pushState`.

- [ ] Tests: an SSE client (Node `fetch` reading the body stream) receives the initial state and a pushed one; a command with no state is 409; a bad command is 400; listeners count rises on connect and falls on abort. Implement. Commit `feat(phone): remote state over SSE and commands over POST (#107)`.

---

### Task 4: The Remote screen on the phone

**Files:**
- Create: `src/renderer/src/phone/Remote.tsx`, `src/renderer/src/phone/remoteClient.ts` (+ test for the EventSource wrapper's parsing and reconnect)
- Modify: `src/renderer/src/phone/Browser.tsx` (the Watch / Remote toggle in the header; in Remote mode the viewer is unmounted and `Remote` is shown)

- [ ] **Step 1:** `remoteClient.ts`: `connect(onState, onDown)` using `EventSource(apiUrl('/remote/state'))` (the token in the query is what `tokenOf` reads), reconnecting with backoff on error; `send(cmd)` = `fetch('/remote/cmd', POST)` returning the status. Tests with a fake `EventSource`.
- [ ] **Step 2:** `Remote.tsx`: the file name (or "Nothing is playing on the PC"), a scrubber (`<input type=range>` over `dur`, sending `seek` on change, drawn from `cur` while not being dragged), `-10s`, play/pause, `+10s`, previous/next (disabled by `canPrev`/`canNext`), a volume slider 0..200 and mute. Big touch targets (48px). A 409 shows a one-line notice for two seconds.
- [ ] **Step 3:** Browser header: a segmented `Watch | Remote` control, remembered in `localStorage` (`prism.phone.mode`). Remote mode hides the folder list too: the phone IS the remote then; the toggle brings the folder back.
- [ ] **Step 4:** E2E `phoneRemote`: launch on `ep1.mp4`, pair, open the phone window, switch to Remote, assert the file name appears; `POST /remote/cmd {op:'toggle'}` from the harness and assert the PC's `<video>` is playing; `seek` to 3 and assert `currentTime > 2.9`; `volume` 0.5 and assert `video.volume === 0.5`; `next` steps to `ep2.mp4` if the fixtures have one (else assert `canNext === false` in the SSE state). Measure command latency (POST sent to `<video>` playing) and write the number down.
- [ ] **Step 5:** CLAUDE.md paragraph (one clock on screen; nothing sent while nobody listens; the target is whoever owns the keyboard; lockstep deliberately not promised), gates, full e2e before push, PR against `feat/106-phone-documents`, package, install 0.41.0.
