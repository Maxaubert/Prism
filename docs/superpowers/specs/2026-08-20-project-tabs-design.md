# Project tabs

2026-08-20

Prism opens where you point it. The folder it was pointed at becomes the session
root, the sidebar is bounded by it, and there is exactly one of them. This adds a
second way in (open a folder deliberately) and lets several of those be open at
once, as tabs.

## The scope tension, stated once

This is the first thing in Prism that is a workspace rather than a view. CLAUDE.md
says to ask before drifting toward a library or a manager, and tabs over named
projects is that drift. It was asked for explicitly on 2026-08-20 and the answers
below are the deliberate shape. What it must NOT become: a place that remembers
per-project settings, pins, colours, or a list you curate. A tab is a root and a
current file. Nothing else.

## Decisions

| Question | Answer |
| --- | --- |
| What creates a tab | The title bar's Open folder button, the `+` on the strip, and any file arriving from outside (Explorer, drag, argv, dialog) while a tab is already open |
| A file already inside an open tab's root | Switch to that tab and show it there. No duplicate tabs of one project |
| Restart | Tabs persist. Roots that no longer exist are dropped silently |
| Chrome | Its own row under the 36px title bar, present only when two or more tabs exist. One tab is exactly today's chrome |

## The root wall

`sessionRoot` (`src/main/index.ts:204`) is one module-level string, and it is the
security boundary for sixteen IPC handlers: read, list, search, rename, bin,
duplicate, save, open-with, show-in-explorer, subtitles, properties. Every one of
them asks `isInsideRoot(sessionRoot, p)`.

It becomes `openRoots: string[]`, the roots the user has actually opened. Two
levels of check, because the handlers are not all the same shape:

- **Navigation and listing** (`open:within`, `dir:list`, `search:files`) take the
  root they are acting in as an explicit argument. Main validates the root is in
  `openRoots` and the path is inside it. These are per-tab operations and the
  renderer always knows which tab asked, so they get the strict check for free.
  `search:files` needs this anyway: it currently searches `sessionRoot` and has
  nothing else to search.
- **Everything else** (file ops, media, properties, subtitles) checks
  `insideAnyRoot(p)`. These act on a path the user can already see, and threading
  a tab id through `CodeView`'s save or the context menu buys nothing.

This widens the wall from one root to N. That is what tabs mean, and the roots are
still only ever ones the user explicitly opened. The residual difference is that a
markdown link in tab A could reach a file in tab B's root. Both are open projects
of the same user in the same window; accepted.

`isRoot` (the rule that the session root itself can never be renamed or binned)
becomes "is any open root".

## The tab model

Main does not own tabs. It owns `openRoots` for the wall and the file that
persists them. The renderer owns the list, because every tab-shaped decision
(reuse, switch, close) is a renderer decision.

```ts
interface Tab {
  id: string          // stable across a session; the React key
  root: string        // absolute, the folder the tree is bounded by
  files: ViewerFile[] // the root folder's viewable siblings, as today
  index: number       // which of them is on screen
  tree: TreeState     // expanded folders + the children cache
}
```

`App` holds `tabs: Tab[]` and `activeId`. What is one `raw`/`rawIndex` pair today
becomes the active tab's `files`/`index`; the derived scope and sort layers on top
are unchanged and simply read from the active tab.

**`TreeState` lifts out of `Sidebar`.** It is `useState` inside the component
today (`Sidebar.tsx:125`), keyed implicitly by the `root` prop. If it stays there,
switching tabs collapses the tree back to its root every time, which makes tabs
feel fake. Moving `expanded` and `children` into the tab record and passing them
down is the change that makes a tab feel like a place you left. The search `query`
and the keyboard `cursor` stay inside Sidebar and reset on switch; those are
transient, not a place.

## Arriving files

One rule, applied to every file that comes from outside (argv, second-instance
handoff, drag, the open dialog):

1. A tab whose root contains the file already exists: make it active, point it at
   the file. This is the "five photos, one tab" case.
2. Otherwise, and a tab is already open: new tab, rooted at the file's folder.
3. Otherwise (no tabs): fill the empty window, exactly as today.

"Contains" means the file's own folder, not any descendant. Prism's sibling paging
has always been one folder deep, and a tab rooted three levels up would page a
different set of files than the one you double-clicked from.

## Opening a folder

`dialog.showOpenDialog({ properties: ['openDirectory'] })`. The new tab shows the
folder's first viewable file in the current sort order. A folder with nothing
viewable in it opens the tree and leaves `EmptyState` in the viewer, so the tab is
still a usable place to browse from.

## Persistence

`tabs.json` beside `window-state.json` in `userData`, written on the same 400ms
debounce for the same reason:

```json
{ "tabs": [{ "root": "D:\\shoot", "file": "D:\\shoot\\a.jpg" }], "active": 0 }
```

On launch: drop any root that no longer exists or is unreadable, rebuild the rest,
then apply the arriving-file rule to whatever the launch argument was. A launch
with no argument restores the strip and its active tab.

Roots are absolute paths on one machine. A missing root is dropped without a word:
a viewer that opens with an error dialog about a folder you deleted last week is
worse than one that quietly opens with one tab fewer.

## Unsaved work

`dirtyPaths` is already keyed by absolute path and lives in `App`, so it spans
tabs with no change. Two flows:

- **Closing a tab** whose root holds dirty files asks first, with the same three
  answers as the window: Cancel / Discard / Save all changes. Without this, the
  only way to reach those buffers disappears while the window stays open, and the
  window's own close prompt would later name files from a tab that is gone.
- **Closing the window** is unchanged. It already names every dirty file, and
  those files may now live in several tabs.

## Chrome

The 36px title bar keeps everything it has and gains one button: **Open folder**,
a folder-plus glyph next to the panel toggle, since that is the other button about
"what am I looking at". Always present, one tab or ten.

The strip is a second row, 32px, shown only when `tabs.length > 1`:

```
┌──────────────────────────────────────────────┐
│ ▣ ⊞  Prism   a.jpg        •  3/12   ⚙  ─ □ ✕ │
├──────────────────────────────────────────────┤
│ shoot ✕ │ docs ✕ │ music ✕ │  +              │
├───────────┬──────────────────────────────────┤
│ tree      │  viewer                          │
```

A tab is labelled with its root's basename, truncated, with the full path as its
title. Two roots with the same basename are disambiguated by their parent
(`assets — shoot`, `assets — docs`), computed only when there is a collision. The
active tab carries the indigo accent the sidebar cursor uses. The strip follows
the same `p-wash` rule as the title bar so the setup wipe does not tear.

Going from two tabs to one removes the row. That shifts the viewport 32px, which
is correct: the strip is chrome for a state that no longer exists.

## Keyboard

Nothing existing moves. `Ctrl+B`, `F11`, `Escape`, the arrows, `PageUp`/`PageDown`,
`Ctrl+S` and `Ctrl+F` all keep their meanings.

| Key | Action |
| --- | --- |
| `Ctrl+T` | Open folder (new tab) |
| `Ctrl+W` | Close the active tab. The last tab leaves an empty window, it does not quit |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+1`..`Ctrl+9` | Jump to the nth tab |

`Ctrl+W` deliberately does not close the window on the last tab. Prism is
resident and a window that vanishes under a reflex keystroke, taking unsaved text
with it, is the one failure this app has been careful to avoid.

All of these are ignored while typing, using the existing `typing` guard in App's
window key listener.

## Testing

- Pure logic, unit tested, in `src/renderer/src/lib/tabs.ts`: the arriving-file
  rule (reuse / spawn / fill), tab close and the resulting active index, and the
  basename collision labels. These are the parts with real branching.
- `src/main/roots.ts`: `insideAnyRoot` and the root validation, unit tested,
  including the traversal cases `isInsideRoot` already covers.
- Persistence: `readTabs` dropping a missing root, and a corrupt file falling back
  to no tabs. Same shape as `readWindowState`.
- e2e: a scenario that opens a second root, asserts the strip appears with two
  tabs, switches, asserts the tree and the viewer both follow, closes one and
  asserts the strip disappears. Plus a restart assertion, which the harness can do
  by closing the app and relaunching against the same profile.

## Out of scope

Reordering tabs by drag, pinning, per-tab settings, a tab overflow menu, tearing a
tab into its own window, and any notion of a project that is not simply "a folder
that is open". Middle-click to close is in, being one line.
