# Prism Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shell per tab, docked to any edge of the viewer, living and dying with its project.

**Architecture:** Main hosts every pty (`node-pty`/ConPTY) behind an id-keyed registry, the renderer keeps one live xterm instance per session in a module store so scrollback survives tab switches, and the viewer area becomes a flex container whose direction/order derive from the dock edge.

**Tech Stack:** `node-pty` (fallback `@lydell/node-pty`), `@xterm/xterm` + addons `fit`, `unicode11`, `web-links`, lazy-loaded like CodeView. AI CLIs (Claude Code) are the primary workload: the paste rule, Shift+Enter and drop scoping exist for them.

**Spec:** `docs/superpowers/specs/2026-08-20-terminal-design.md`

## Global Constraints

- Windows only, Electron ^43, x64. `node-pty` is the app's first native module: electron-builder must rebuild it and `asarUnpack` it, and the installed app must prove it.
- Prism never generates a command. Main spawns only shells it detected itself; renderer-supplied shell ids are looked up, never exec'd as paths.
- xterm loads lazily (own Vite chunk); the launch path pays nothing.
- No em-dashes anywhere. Small focused files. TDD for every pure unit.
- Branch: `feat/terminal`, issue first, PR referencing it. The last verification step is packaging + installing the build.

---

### Task 1: Prove node-pty in this Electron

**Files:**
- Modify: `package.json` (deps), `electron-builder.yml` (asarUnpack)
- Create: `scripts/pty-smoke.mjs` (throwaway probe, deleted in this same task)

**Interfaces:**
- Produces: `node-pty` importable from `src/main/*` in dev AND in the packaged app; `electron-builder.yml` gains `asarUnpack: ['node_modules/node-pty/**']`.

- [ ] **Step 1: Install**

```bash
npm i node-pty @xterm/xterm @xterm/addon-fit
npx electron-rebuild -f -m . 2>&1 | tail -3
```

- [ ] **Step 2: Probe it in the real runtime** (Electron's ABI, not Node's)

```js
// scripts/pty-smoke.mjs — run with: npx electron scripts/pty-smoke.mjs
import { app } from 'electron'
import pty from 'node-pty'
app.whenReady().then(() => {
  const p = pty.spawn('powershell.exe', ['-NoLogo', '-Command', 'echo pty-ok; exit'], {
    cols: 80, rows: 24, cwd: process.env.USERPROFILE, name: 'xterm-color'
  })
  let out = ''
  p.onData((d) => (out += d))
  p.onExit(() => { console.log(out.includes('pty-ok') ? 'SMOKE PASS' : 'SMOKE FAIL: ' + out); app.quit() })
})
```

Expected: `SMOKE PASS`. If the rebuild fails or the module will not load: `npm rm node-pty && npm i @lydell/node-pty`, change the import, re-probe; if that also fails, STOP and report (spike rule: the answer is the deliverable).

- [ ] **Step 3: asarUnpack** — in `electron-builder.yml` add at top level:

```yaml
asarUnpack:
  - node_modules/node-pty/**
```

- [ ] **Step 4: Delete the probe, commit**

```bash
rm scripts/pty-smoke.mjs
git add package.json package-lock.json electron-builder.yml
git commit -m "Prove node-pty under Electron 43, asarUnpack it"
```

---

### Task 2: Shell detection

**Files:**
- Create: `src/main/shells.ts`, Test: `src/main/shells.test.ts`

**Interfaces:**
- Produces: `interface ShellDef { id: string; name: string; exe: string; args: string[] }`; `parseWslList(out: string): string[]` (pure); `detectShells(): Promise<ShellDef[]>` (cached; probes with `existsSync`/`where`); `shellById(id: string | undefined, list: ShellDef[]): ShellDef` (falls back pwsh → powershell).

- [ ] **Step 1: Failing tests** (`shells.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { parseWslList, shellById, type ShellDef } from './shells'

const L: ShellDef[] = [
  { id: 'pwsh', name: 'PowerShell 7', exe: 'pwsh.exe', args: ['-NoLogo'] },
  { id: 'powershell', name: 'Windows PowerShell', exe: 'powershell.exe', args: ['-NoLogo'] },
  { id: 'cmd', name: 'Command Prompt', exe: 'cmd.exe', args: [] }
]

describe('parseWslList', () => {
  it('reads UTF-16LE-ish output with blank lines and CRLF', () => {
    // wsl -l -q emits UTF-16; the caller decodes, this parses decoded text
    expect(parseWslList('Ubuntu\r\n\r\nDebian\r\n')).toEqual(['Ubuntu', 'Debian'])
  })
  it('is empty for no distros or an error banner', () => {
    expect(parseWslList('')).toEqual([])
    expect(parseWslList('Windows Subsystem for Linux has no installed distributions.')).toEqual([])
  })
})

describe('shellById', () => {
  it('finds the saved shell', () => expect(shellById('cmd', L).id).toBe('cmd'))
  it('falls back to pwsh when the saved shell is gone', () => expect(shellById('wsl-Arch', L).id).toBe('pwsh'))
  it('falls back to powershell when pwsh is absent too', () => expect(shellById('x', L.slice(1)).id).toBe('powershell'))
})
```

Run `npx vitest run src/main/shells.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement** — `parseWslList` filters lines matching `/^[\w.-]+$/` (an error banner contains spaces); `detectShells` probes `pwsh.exe` via `where` (spawnSync), always includes `powershell.exe` and `cmd.exe`, appends `wsl -l -q` distros decoded from UTF-16LE as `{ id: 'wsl-<name>', exe: 'wsl.exe', args: ['-d', name, '--cd', '.'] }`, caches the promise. `shellById` as tested.

- [ ] **Step 3: Green, commit** `git add src/main/shells.* && git commit -m "Detect the shells this machine actually has"`

---

### Task 3: The PTY host in main

**Files:**
- Create: `src/main/terminal.ts`, Test: `src/main/terminal.test.ts`
- Modify: `src/main/index.ts` (IPC + will-quit), `src/preload/index.ts`

**Interfaces:**
- Consumes: `detectShells`, `shellById` from Task 2.
- Produces (preload, and therefore `window.prism`):

```ts
termShells: () => Promise<ShellDef[]>                       // invoke 'term:shells'
termSpawn: (id: string, root: string, shellId?: string) => Promise<boolean>  // 'term:spawn'
termInput: (id: string, data: string) => void               // send 'term:input'
termResize: (id: string, cols: number, rows: number) => void // send 'term:resize'
termKill: (id: string) => void                              // send 'term:kill'
onTermData: (cb: (id: string, data: string) => void) => () => void  // 'term:data'
onTermExit: (cb: (id: string) => void) => () => void        // 'term:exit'
```

- [ ] **Step 1: Failing test for the pure registry + batcher** (`terminal.test.ts`)

```ts
import { describe, expect, it, vi } from 'vitest'
import { OutputBatcher } from './terminal'

describe('OutputBatcher', () => {
  it('coalesces chunks and flushes once per window', () => {
    vi.useFakeTimers()
    const sent: string[] = []
    const b = new OutputBatcher((d) => sent.push(d), 8)
    b.push('a'); b.push('b'); b.push('c')
    expect(sent).toEqual([])          // nothing yet: batched
    vi.advanceTimersByTime(8)
    expect(sent).toEqual(['abc'])     // one message, all the bytes
    b.push('d'); vi.advanceTimersByTime(8)
    expect(sent).toEqual(['abc', 'd'])
    vi.useRealTimers()
  })
  it('flush() empties immediately (used on exit so the tail is not lost)', () => {
    const sent: string[] = []
    const b = new OutputBatcher((d) => sent.push(d), 8)
    b.push('bye'); b.flush()
    expect(sent).toEqual(['bye'])
  })
})
```

- [ ] **Step 2: Implement `terminal.ts`** — `OutputBatcher` (as tested; `setTimeout`-based). `spawnTerm(id, root, shellId, send)`: refuse a live id, `shellById` the def, `pty.spawn(def.exe, def.args, { cwd: root, cols: 80, rows: 24, name: 'xterm-color', useConpty: true })`; pipe `onData` through a batcher into `send('term:data', id, chunk)`; `onExit` flushes then `send('term:exit', id)` and deletes. `writeTerm/resizeTerm/killTerm/killAll` over the `Map<string, IPty>`. Import `node-pty` lazily inside `spawnTerm` (`await import`) so main's startup never pays for it.

- [ ] **Step 3: Wire IPC in `index.ts`** — beside the tabs handlers:

```ts
ipcMain.handle('term:shells', () => detectShells())
ipcMain.handle('term:spawn', (_e, id: string, root: string, shellId?: string) =>
  insideAnyRoot(root) || isAnyRoot(root) ? spawnTerm(id, root, shellId, (ch, ...a) => mainWindow?.webContents.send(ch, ...a)) : false)
ipcMain.on('term:input', (_e, id: string, d: string) => writeTerm(id, d))
ipcMain.on('term:resize', (_e, id: string, c: number, r: number) => resizeTerm(id, c, r))
ipcMain.on('term:kill', (_e, id: string) => killTerm(id))
app.on('will-quit', () => killAll())
```

(The spawn root must be an open root: the shell can leave it, but it STARTS where a tab is.)

- [ ] **Step 4: Preload passthroughs** as in Interfaces; `onTermData`/`onTermExit` return unsubscribers (match `onOpenFile`'s pattern).

- [ ] **Step 5: Green + typecheck, commit** `git commit -m "PTY host: spawn, pipe, resize, kill, batched output"`

---

### Task 4: Renderer session store and dock geometry

**Files:**
- Create: `src/renderer/src/lib/termDock.ts`, Test: `src/renderer/src/lib/termDock.test.ts`
- Modify: `src/renderer/src/lib/tabs.ts` (+`term` field), Test: `src/renderer/src/lib/tabs.test.ts`

**Interfaces:**
- Produces: `type DockEdge = 'bottom' | 'top' | 'right' | 'left'`; `dockFlex(edge): 'column' | 'column-reverse' | 'row' | 'row-reverse'` (viewer first, so bottom/right are plain, top/left reversed); `dockAxis(edge): 'x' | 'y'`; `clampTermSize(px: number, total: number): number` (min 90, max 80% of total); `loadDock()/saveDock(edge)`, `loadTermSize(axis)/saveTermSize(axis, px)` over localStorage (keys `prism.term.dock`, `prism.term.h`, `prism.term.w`). On `Tab`: `term: { id: string; open: boolean } | null` (default null; `newTab` sets it); `setTabTerm(tabs, tabId, term): Tab[]`.

- [ ] **Step 1: Failing tests**

```ts
// termDock.test.ts
import { describe, expect, it } from 'vitest'
import { clampTermSize, dockAxis, dockFlex, loadDock, saveDock } from './termDock'

describe('dock geometry', () => {
  it('viewer stays first in DOM: bottom/right plain, top/left reversed', () => {
    expect(dockFlex('bottom')).toBe('column')
    expect(dockFlex('top')).toBe('column-reverse')
    expect(dockFlex('right')).toBe('row')
    expect(dockFlex('left')).toBe('row-reverse')
  })
  it('one remembered size per axis', () => {
    expect(dockAxis('bottom')).toBe('y'); expect(dockAxis('top')).toBe('y')
    expect(dockAxis('left')).toBe('x'); expect(dockAxis('right')).toBe('x')
  })
  it('clamps to something usable at both ends', () => {
    expect(clampTermSize(10, 1000)).toBe(90)
    expect(clampTermSize(950, 1000)).toBe(800)
    expect(clampTermSize(300, 1000)).toBe(300)
  })
  it('round-trips the edge and survives garbage', () => {
    saveDock('left'); expect(loadDock()).toBe('left')
    localStorage.setItem('prism.term.dock', 'diagonal'); expect(loadDock()).toBe('bottom')
  })
})
// tabs.test.ts additions
it('a new tab has no terminal', () => expect(tabOf(SHOOT, []).term).toBeNull())
it('setTabTerm writes only the named tab', () => {
  const a = tabOf(SHOOT, []), b = tabOf(DOCS, [])
  const next = setTabTerm([a, b], a.id, { id: 's1', open: true })
  expect(next[0].term).toEqual({ id: 's1', open: true })
  expect(next[1].term).toBeNull()
})
```

- [ ] **Step 2: Implement both, green** (also: `rerootTab` keeps `term` untouched per spec; `newTab` initialises `term: null`).

- [ ] **Step 3: The paste decision, pure** — Create `src/renderer/src/lib/termPaste.ts` + `termPaste.test.ts`. Failing tests first:

```ts
import { describe, expect, it } from 'vitest'
import { decidePaste, quotePaths } from './termPaste'

describe('decidePaste', () => {
  // Image wins: a clipboard-aware TUI (Claude Code) reads it itself off the
  // OS clipboard when it sees the ^V keystroke; our job is not to swallow it.
  it('an image forwards the ^V key', () =>
    expect(decidePaste({ image: true, text: '', files: [] })).toEqual({ kind: 'key' }))
  it('an image wins even when text rides along (Word copies both)', () =>
    expect(decidePaste({ image: true, text: 'x', files: [] })).toEqual({ kind: 'key' }))
  it('text becomes a bracketed paste', () =>
    expect(decidePaste({ image: false, text: 'a\nb', files: [] })).toEqual({ kind: 'text', data: 'a\nb' }))
  it('copied files paste as quoted paths', () =>
    expect(decidePaste({ image: false, text: '', files: ['C:\\a b\\s.png'] }))
      .toEqual({ kind: 'text', data: '"C:\\a b\\s.png"' }))
  it('an empty clipboard does nothing', () =>
    expect(decidePaste({ image: false, text: '', files: [] })).toEqual({ kind: 'none' }))
})

describe('quotePaths', () => {
  it('quotes each and joins with spaces', () =>
    expect(quotePaths(['C:\\a.png', 'C:\\b c.png'])).toBe('"C:\\a.png" "C:\\b c.png"'))
})
```

Implement; green. Preload gains the reader it consumes:

```ts
// preload — Electron clipboard is available here
readClipboard: (): { image: boolean; text: string; files: string[] } => {
  const formats = clipboard.availableFormats()
  const files = formats.includes('FileNameW')
    ? clipboard.readBuffer('FileNameW').toString('ucs2').replace(/\0+$/, '').split('\0').filter(Boolean)
    : []
  return { image: formats.some((f) => f.startsWith('image/')), text: clipboard.readText(), files }
}
```

- [ ] **Step 4: Commit** `git commit -m "Dock geometry, the tab's terminal slot, and the paste decision, as pure data"`

---

### Task 5: TerminalPanel (xterm) + TermDock (layout)

**Files:**
- Create: `src/renderer/src/components/TerminalPanel.tsx` (lazy chunk; also owns the module-level session store: `Map<id, { term: Terminal; fit: FitAddon; el: HTMLDivElement }>` — xterm types stay inside the lazy chunk this way)
- Create: `src/renderer/src/components/TermDock.tsx` (dock wrapper + drag handle + right-click menu; no xterm imports)

**Interfaces:**
- Consumes: Task 3's `window.prism.term*`; Task 4's geometry.
- Produces: `<TermDock edge size onResize onDockPick sessionId root onExited>`; inside it `<Suspense><TerminalPanel sessionId root onExited/></Suspense>`.

- [ ] **Step 1: TerminalPanel** — on mount for a `sessionId` not in the store: create `Terminal({ cursorBlink: true, scrollback: 10000, allowProposedApi: true, fontFamily: 'Cascadia Mono, Consolas, monospace', fontSize: 13, theme: { background: '#0b0b0f', cursor: '#5b5bd6', selectionBackground: '#5b5bd644' } })` with `FitAddon`, `Unicode11Addon` (+ `term.unicode.activeVersion = '11'`, so Ink UIs' emoji/box math lines up) and `WebLinksAddon` (Claude Code's printed URLs become clickable, opened via `shell.openExternal` through a preload passthrough); a detached `div`, `term.open(div)`; `term.onData((d) => window.prism.termInput(sessionId, d))`; subscribe `onTermData` (write matching id), `onTermExit` (→ `onExited()`); `window.prism.termSpawn(sessionId, root, savedShellId())` — a `false`/rejected spawn writes `Could not start the shell.` into the xterm and stops. For a KNOWN id: reattach the stored `div`. Component appends the div to its container, `fit.fit()` + `termResize` on a `ResizeObserver`, focuses on mount. It never disposes on unmount (hide keeps the shell); `disposeTermSession(id)` is exported for exit/tab-close. Install `@xterm/addon-unicode11` and `@xterm/addon-web-links` in this task.

- [ ] **Step 1b: AI-CLI keys and paste** — one `attachCustomKeyEventHandler`:

```ts
term.attachCustomKeyEventHandler((e) => {
  if (e.type !== 'keydown') return true
  if (e.key === 'Enter' && e.shiftKey) {
    // Newline-without-submit, the continuation Claude Code accepts everywhere.
    // This is what /terminal-setup exists to configure; here it just works.
    window.prism.termInput(sessionId, '\\\r')
    return false
  }
  if (e.key === 'v' && e.ctrlKey && !e.shiftKey) {
    const decision = decidePaste(window.prism.readClipboard())
    if (decision.kind === 'key') window.prism.termInput(sessionId, '\x16') // the TUI reads the image itself
    else if (decision.kind === 'text') term.paste(decision.data)           // bracketed paste
    return false
  }
  return true
})
```

Right-click handler: selection → copy + clear selection; none → run the same `decidePaste` path. Ctrl+Shift+V forces plain text paste (escape hatch when you want the text half of a mixed clipboard).
- [ ] **Step 2: TermDock** — flex child sized by `size` on the dock axis, drag handle on the inner edge (Sidebar's pointer-capture pattern), `onContextMenu` → a small fixed-position menu (`role="menu"`, items `Dock bottom/top/left/right`, current one checked) calling `onDockPick`.
- [ ] **Step 3: Typecheck + lint green; verify the chunk** — `npm run build` and confirm xterm landed in its own asset, not in `index-*.js` (grep the out/renderer/assets listing).
- [ ] **Step 4: Commit** `git commit -m "The terminal surface and its dock, xterm in a lazy chunk"`

---

### Task 6: Wire it into App: toggle, keys, button, lifecycle

**Files:**
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: State + actions in App** — `const toggleTerm = useCallback(...)`: no `active` → no-op; `active.term === null` → `setTabState(setTabTerm(..., { id: nextTermId(), open: true }))` (module counter like `nextTabId`); else flip `open`. `onTermExited(tabId, sessionId)`: `disposeTermSession`, `setTabTerm(..., null)`. On `closeTab`/`forceCloseTab` paths: if the closing tab has `term`, `window.prism.termKill(term.id)` + `disposeTermSession`.
- [ ] **Step 2: Render** — inside the viewer flex area (viewer stays a child): wrap viewer + `<TermDock>` in a container with `style={{ flexDirection: dockFlex(edge) }}`; TermDock rendered when `active?.term?.open`. Hidden tabs' sessions stay alive in the store untouched; only the ACTIVE tab's open panel renders (reattach keeps its scrollback). Fullscreen renders no dock.
- [ ] **Step 3: Keys** — in the capture-phase listener, BEFORE the `typing` guard bail-outs: `` e.key === '`' && e.ctrlKey `` → `preventDefault(); toggleTerm()` (works while the terminal is focused; opening focuses the shell, closing lets focus fall back). Everything else stays behind `typing`, which xterm's hidden textarea already trips.
- [ ] **Step 4: Sidebar button** — on the search row, right of the folder button, same 26px bordered style, terminal glyph (`>_` box path), `aria-label="Terminal"`, `title="Terminal (Ctrl+\`)"`, accent border+icon while `active?.term?.open`. New prop `onToggleTerm`, `termOpen`.
- [ ] **Step 4b: Drop scoping** — a file dropped ON the terminal panel types its quoted path(s) (`quotePaths` from Task 4) into the pty instead of opening in the viewer: TermDock's container handles `drop`/`dragover` with `stopPropagation`, and App's window-level drop handler ignores events whose target sits inside `[data-term-panel]`. Drops anywhere else keep opening files.
- [ ] **Step 5: Manual run** (`npm run dev`): open, type, `exit`, re-open, hide/show survival, dock all four edges, drag-resize, switch tabs and back (scrollback intact), close tab with shell, drop a file on the panel → quoted path typed.
- [ ] **Step 6: Commit** `git commit -m "One shell per tab: toggle, dock, keys, lifecycle"`

---

### Task 7: Settings shell picker

**Files:**
- Modify: `src/renderer/src/components/Settings.tsx`; Create: `src/renderer/src/lib/termPrefs.ts`, Test: `src/renderer/src/lib/termPrefs.test.ts`

**Interfaces:**
- Produces: `savedShellId(): string | undefined`, `saveShellId(id)` (key `prism.term.shell`); Settings → General gains "Terminal shell" dropdown fed by `window.prism.termShells()`, matching the existing dropdown/radio pattern there.

- [ ] **Step 1: Failing test** — round-trip + `undefined` for unset/blank. **Step 2: implement, green.**
- [ ] **Step 3: Settings UI** — load shells on section mount; select writes `saveShellId`; caption `Applies to new terminals.`
- [ ] **Step 4: Commit** `git commit -m "Pick the shell new terminals launch"`

---

### Task 8: e2e scenario

**Files:**
- Modify: `tools/e2e/run.mjs` (add `terminalScenario`, register after `tabsScenario`)

- [ ] **Step 1: The scenario**

```js
async function terminalScenario(fixtures) {
  console.log('terminal')
  const { app, win } = await launch(join(fixtures, 'README.md'))
  try {
    await win.locator('aside [aria-label="Terminal"]').click()
    await win.waitForSelector('.xterm', { timeout: 15000 })
    await sleep(2500) // pwsh prompt
    await win.keyboard.type('echo prism-e2e-marker')
    await win.keyboard.press('Enter')
    await win.waitForFunction(() =>
      (document.querySelector('.xterm')?.textContent ?? '').includes('prism-e2e-marker'),
      null, { timeout: 15000 })
    ok(true, 'the shell echoes back through the pty')
    // hide, then show: same session, scrollback intact
    await win.keyboard.press('Control+`')
    ok((await win.locator('.xterm:visible').count()) === 0, 'Ctrl+` hides the panel')
    await win.keyboard.press('Control+`')
    ok(((await win.locator('.xterm').textContent()) ?? '').includes('prism-e2e-marker'),
      'reopening shows the same shell, scrollback intact')
    await win.keyboard.type('exit'); await win.keyboard.press('Enter')
    await win.waitForFunction(() => !document.querySelector('.xterm'), null, { timeout: 10000 })
    ok(true, 'exit closes the panel')
    ok(!win.isClosed(), 'window survives the shell')
  } finally { await app.close() }
}
```

- [ ] **Step 2: Paste assertions in the same scenario** — before the exit step: `win.evaluate` writes a known string via Electron clipboard (through a preload passthrough or `app.evaluate(({clipboard}) => clipboard.writeText('paste-marker'))` on the main side), `Control+V`, assert `paste-marker` appears; then `app.evaluate` writes a 2x2 PNG via `clipboard.writeImage(nativeImage.createFromDataURL(...))` and assert Ctrl+V does NOT paste text (the ^V forwarded silently: `.xterm` textContent unchanged) — the image half of the rule, testable without Claude Code.
- [ ] **Step 3: `npm run e2e`** — whole suite green, screenshot `terminal.png` added before the exit step.
- [ ] **Step 4: The Claude Code acceptance run (manual, on this machine)** — in a dev Prism terminal: `claude`, then (a) Win+Shift+S a screenshot, Ctrl+V, confirm Claude Code attaches the image; (b) paste 3 lines of text, confirm one prompt, not three submits; (c) Shift+Enter, confirm newline-not-submit; (d) click a URL it prints. Record the results in the PR body.
- [ ] **Step 5: Commit** `git commit -m "e2e: pty round-trip, hide-survival, the paste rule, and exit"`

---

### Task 9: Docs, package, install

**Files:**
- Modify: `CLAUDE.md` (scope bullet: the terminal, its lifecycle, the executes-by-design line; dependency list gains node-pty + xterm with the reason)

- [ ] **Step 1: CLAUDE.md** — add the terminal bullet under scope and the deps exception; keep it lean.
- [ ] **Step 2: Full gate** — `npm test`, `npm run typecheck`, `npx eslint src tools`, `npm run e2e`.
- [ ] **Step 3: Package + install** (the standing last step) — `npm run package`, silent-install, launch the INSTALLED app, open a terminal in it: this is the native-module proof. Report the version.
- [ ] **Step 4: Commit, push, PR** referencing the issue.

## Self-Review

- Spec coverage: model/count/dock/menu (T4,5,6), shell+Settings (T2,7), lifecycle (T3,6), keys (T6), errors (T5 spawn-fail line, T3 silent drop by id-match), batching (T3), lazy chunk (T5 step 3), packaging proof (T1,9), e2e (T8). Reroot-keeps-shell: T4 step 2. Escape-belongs-to-shell: no interception anywhere, only Ctrl+` claimed (T6).
- Placeholders: none; every step carries its code or exact behaviour.
- Names consistent: `spawnTerm/writeTerm/resizeTerm/killTerm/killAll`, `term:*` channels, `setTabTerm`, `disposeTermSession`, `savedShellId`.
