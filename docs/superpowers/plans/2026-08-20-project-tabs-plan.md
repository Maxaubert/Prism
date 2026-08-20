# Project tabs: implementation plan

Design: [`../specs/2026-08-20-project-tabs-design.md`](../specs/2026-08-20-project-tabs-design.md)

Two shippable pieces. Phase 1 stands alone and is worth landing on its own: it
closes a real gap (there is no way to open a folder today) and it does not touch
the tab model. Phases 2 to 5 are the tabs.

TDD throughout: pure logic gets its test first, and every phase ends green on
`npm test`, `npm run typecheck`, `npm run lint`.

---

## Phase 1: open a folder

The root becomes something you can choose. No tabs yet: opening a folder reroots
the single session, exactly as opening a file does now.

1. **`src/main/index.ts`** — add `ipcMain.handle('open:folder')`:
   `showOpenDialog({ properties: ['openDirectory'] })`, then a payload rooted at
   the chosen folder pointing at its first viewable file. A folder with no
   viewable files returns `{ files: [], index: -1, root }`.
2. **`src/shared/types.ts`** — `OpenPayload.index` may now be `-1`. Audit the
   renderer's uses of `index`; `App` must render `EmptyState` rather than a
   viewer when there is no file, with the tree still bound to the root.
3. **`src/preload/index.ts`** — `openFolder(): Promise<OpenPayload | null>`.
4. **Title bar** (`App.tsx`) — the Open folder button beside the panel toggle.
   Folder-plus glyph, `title="Open folder (Ctrl+T)"`, matching the existing
   button's classes exactly.
5. **`Ctrl+T`** in App's window key listener, behind the `typing` guard.
6. **e2e** — `openFolderScenario`: launch on a file, open a different fixture
   folder, assert the tree rerooted and the viewer shows that folder's first file.
   Driving the native dialog is not possible, so the scenario calls the IPC path
   through `win.evaluate(() => window.prism.openFolder())` is also not possible;
   instead add a test-only main-process hook the harness already uses for seeding,
   or assert the reroot via `open:path`. **Decide this when writing it**: if
   neither is clean, cover Phase 1 with unit tests on the payload builder and let
   the e2e come in Phase 5 where the strip gives something observable to assert.

**Ships alone.** Merge before starting Phase 2.

---

## Phase 2: many roots in main

No user-visible change. The wall stops being one string.

1. **New `src/main/roots.ts`** with its test first. Owns the open-root set:
   `addRoot`, `dropRoot`, `insideAnyRoot(p)`, `isAnyRoot(p)`, and
   `validRoot(root, p)` for the strict per-tab check. Move `isInsideRoot` and
   `isRoot` here from wherever they live now and keep their traversal tests.
2. **`src/main/index.ts`** — replace `let sessionRoot` with the module from step 1.
   Rewrite the sixteen call sites:
   - `open:within`, `dir:list`, `search:files` gain a `root` argument, validated
     with `validRoot`.
   - The rest become `insideAnyRoot(p)` / `!isAnyRoot(p)`.
3. **`src/preload/index.ts`** — the three navigation calls take the root.
4. **`App.tsx` / `Sidebar.tsx`** — pass the current root to those three. With one
   root this is `payload.root`, so the change is mechanical and the app behaves
   identically at the end of this phase.
5. `npm run e2e` must pass untouched. That is the proof this phase changed nothing.

---

## Phase 3: the tab model in the renderer

Still no strip. `tabs` has exactly one entry and everything looks the same.

1. **New `src/renderer/src/lib/tabs.ts`**, test first. Pure, no React:
   - `Tab` type.
   - `receiveFile(tabs, activeId, payload)` returning the next `{tabs, activeId}`:
     reuse a tab with a matching root, else spawn, else fill. This is the rule
     from the design and the branchiest thing in the feature.
   - `closeTab(tabs, id)` returning the next list and which tab becomes active
     (the right-hand neighbour, then the left, then none).
   - `tabLabels(tabs)`: basenames, disambiguated by parent only on collision.
2. **`App.tsx`** — `raw`/`rawIndex` become `tabs`/`activeId` with the active tab's
   `files`/`index` feeding the existing derived scope and sort layers unchanged.
   `open`, `openFromTree`, `go` and `advanceSameKind` all read and write the
   active tab.
3. **Lift `TreeState`** out of `Sidebar` (`Sidebar.tsx:125`) into the tab record:
   `Sidebar` takes `tree` and `onTree` props. `query` and `cursor` stay inside.
4. `npm run e2e` passes untouched again, for the same reason.

---

## Phase 4: the strip, the buttons, the keys

The feature becomes visible.

1. **New `src/renderer/src/components/TabStrip.tsx`** — the 32px row, rendered
   only when `tabs.length > 1`. Accent on the active tab, per-tab close X,
   middle-click to close, `+` at the end, full path as `title`, the `p-wash`
   class the title bar uses. `role="tablist"` / `role="tab"` with
   `aria-selected`, and a roving `tabIndex` so the strip is one tab stop, the way
   the file tree already does it.
2. **`App.tsx`** — mount it under the title bar; wire the arriving-file rule from
   `lib/tabs.ts` into `open`, the `open:file` IPC listener, and drag-and-drop.
3. **Closing a tab with dirty files in its root** — a new `ask` kind reusing the
   existing `Dialog` and the window's Cancel / Discard / Save all copy.
4. **Keys** — `Ctrl+W`, `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+1`..`Ctrl+9`, all
   behind the `typing` guard. `Ctrl+T` from Phase 1 now spawns a tab.
5. **Open folder button** now spawns a tab rather than rerooting.

---

## Phase 5: persistence and e2e

1. **`src/main/tabs.ts`** (test first) — `readTabs` / `writeTabs` against
   `userData/tabs.json`, modelled on `readWindowState`: a corrupt or missing file
   returns no tabs, a root that no longer exists or cannot be read is dropped.
2. **`src/main/index.ts`** — restore on launch, then apply the arriving-file rule
   to the launch argument. Save on the same 400ms debounce as the window state,
   driven by an IPC message from the renderer when the tab list changes.
3. **e2e `tabsScenario`** — open a second root, assert the strip appears with two
   tabs, switch and assert the tree and the viewer both follow, close one and
   assert the strip disappears. Then close the app, relaunch against the same
   profile, and assert the strip came back. Screenshot `tabs.png`.
4. **`CLAUDE.md`** — the scope section gains the tab rules: a tab is a root and a
   current file, arriving files reuse a matching root, and the strip is absent at
   one tab. Plus the line that the root wall is now a set.

---

## Risk

The one place a mistake is expensive is Phase 2: it turns a security check into a
set membership test across sixteen handlers. Mitigations are that `roots.ts` is
pure and tested first, that the phase is behaviour-preserving so the existing e2e
suite is a real regression net, and that the strict `validRoot` check is used for
the three handlers where the renderer genuinely knows which tab is asking.

The second risk is scope. The design's "out of scope" list exists to be pointed
at: reordering, pinning, per-tab settings, and tab overflow menus are all natural
next thoughts and none of them are in this.
