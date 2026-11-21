# Audit splits: index.ts, App.tsx, BrowseList (2026-11-21)

Owner said yes on 2026-11-21 ("yes to all") to the large splits from the 2026-11-21 audit
(issues #559 and #560: findings #7, #8, #9, #11, #12). This is the spec and the plan in one.

## Rule for all three

- **No behaviour change.** Every key, click, IPC channel, message, timing and error path stays the
  same. Only where code lives changes.
- Each split is its own PR, with the full e2e before it opens.
- Each new file gets a size ratchet test like `src/main/indexSize.test.ts`, so the old file cannot
  grow back.
- Move code. Do not rewrite it. When a move needs a new parameter, pass it explicitly; do not add
  global state.

## 1. `src/main/index.ts` (#7 step 2, #11) - 2,521 lines

- `src/main/windowFactory.ts`: `createWindow` and the session restore it runs.
- `src/main/launchRouter.ts`: `onLaunch`, with the Win+E branch, and one helper for the repeated
  "appQuitting, then app.relaunch" step.
- `src/main/startup/*.ts`: the `whenReady` wiring groups (phone, thumbs, live video, prefs), one
  `wire<Group>(ctx)` function each.
- index.ts stays the composition root: it builds `ctx` and calls these in the same order as today.
- Target: index.ts under 1,200 lines. The ratchet drops to the new count plus 50.

## 2. `src/renderer/src/App.tsx` (#8, #12) - 2,141 lines

- `components/explorer/ExplorerHost.tsx` (or a `useExplorerController` hook if a component would
  change the render tree): it owns the Explorer menu, rename, properties and bin state, quick
  access and places, the archive and bin actions, and the four Explorer context menus.
  `FolderBrowserProps` shrinks to what the shell passes.
- Hooks for App's remaining concerns: `useAppTabs`, `useAppSelection`, `useAppPreviews`,
  `useAppDialogs`.
- The DOM tree and its order stay identical, because the e2e and the CSS select by structure.
- Target: App.tsx under 900 lines, with a ratchet.

## 3. `src/renderer/src/components/browse/BrowseList.tsx` (#9) - 1,724 lines

- `BrowseEntry.tsx`: the row and tile JSX, pure props.
- `useBrowseScroll.ts`: scroll restore and follow-the-selection.
- `useBrowseKeys.ts`: the key table (made in #565).
- Also, if it fits: `useBrowseSweep.ts` (the sweep box) and `useBrowseZoom.ts` (zoom anchoring).
- Same DOM, same class names, same data attributes.
- Target: BrowseList.tsx under 700 lines, with a ratchet.

## Checks per PR

Typecheck, lint with 0 errors, the full vitest, the full e2e (known flakes rerun alone), then build
and install, then the owner's merge question.
