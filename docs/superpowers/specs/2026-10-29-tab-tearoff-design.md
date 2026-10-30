# Tab tear-off: spec and plan

2026-10-29. Owner: "the tabs should be able to be dragged out of the tab bar and if they're
appropriately far away and you drop the tab you get two windows instead of one window with two
tabs. I guess if the tab is dragged outside of the tab border where it's fully outside then it's a
new window otherwise it snaps to the tab bar. make sure to do this carefully since this is often
something that can feel bad but needs to feel intuitive."

Owner's choices (2026-10-29): a LIVE window follows the cursor; a tab can be dropped into ANY
window's tab bar; dragging a window's ONLY tab moves the whole window; windows close one by one,
and starting Prism with none open gives ONE window (the tabs of the last window closed, as today).

**Changed 2026-10-30** (owner, after trying it by hand: "i dont wanna be carrying a full window ...
actually let it just be the tab you're carrying, that's how file explorer does it"): ONLY THE TAB
follows the cursor, as a tab-sized ghost window; the new window stays hidden until the drop.

**Changed again 2026-10-30** (owner, after trying it by hand: "theres a slight issue where it
switches focus like which tab is in focus as soon as you drag it out, i want those switches to
happen when you drop it. also if you drag it to a new window and wanna remerge when you then drag
a tab from a single tab window you just drag the window it should be the tab you drag"): the
selection changes only when a drop commits, and a window's ONLY tab is carried as a tab too (its
window moves only when it is dropped outside every strip). This replaces the 2026-10-29 choice
that the only tab moves the whole window.

This replaces the 2026-08-23 decision that a tab "should slide left and right inside its own row
and nowhere else" (TabStrip.tsx). Study behind it: a read-only code map (25 single-window
assumptions, checked by a skeptic) and research on Chrome's tab_drag_controller, WinUI TabView,
Edge, Windows File Explorer and VS Code (sources in the session's workflow wf_88956de7-020).

## 1. The gesture

All distances in DIP (Prism runs at 225% on the owner's display).

1. **Reorder as today.** A press on a tab, past `DRAG_SLOP` (4 px), slides it along its row; the
   neighbours make room. A click never tears anything.
2. **The pull.** When the cursor leaves the strip vertically, the carried tab follows it with
   resistance (0.4x), so it visibly pulls against the bar: "pull further and it comes off".
3. **Tear.** The tab tears when its own rect is FULLY outside the strip rect (the owner's rule:
   "fully outside the tab border"), in practice about 24 DIP below or above the strip. Past the
   + button, one tab width of grace. The tab's slot empties (the gap closes with the existing
   170 ms slide) and ONLY THE TAB follows the cursor (2026-10-30): a tab-sized ghost, the tab as
   the strip draws it, lifted, held at the same grab point, in a tiny window of its own that never
   takes the focus or the pointer and sits above every app. The real Prism window is taken at once
   and stays hidden, and empty, until the drop. The source keeps the tab in front (if it was) and
   its page on screen all through the drag (2026-10-30): nothing switches until a drop commits.
4. **Snap back.** Coming back over any Prism window's strip (its rect plus 8 DIP: a tighter zone
   than the tear, so the edge cannot flicker) for 120 ms attaches the tab live: the ghost
   goes, the tab slides into that strip at the slot under the cursor, and reorders there until
   release. Its own strip included; there, it changes no selection (2026-10-30).
5. **Drop.** The tab is packed again at the drop (it stayed live in the source: a film went on
   playing) and that is what goes. Released while floating: the new window is handed the tab,
   placed so its tab sits under the cursor where the ghost was, and shown in front and focused
   once its page has drawn it; the ghost goes. Released attached to another strip: the tab is in
   that strip, selected, that window in front. Only then does the source's neighbour take the
   front (its right, else its left).
6. **Cancel.** Escape, right-click, a lost capture or the window losing focus (Alt+Tab, a UAC
   prompt) change nothing (the tab never left, the selection never changed) and hide the ghost.
   Nothing half-done is ever committed.
7. **The only tab** (2026-10-30). Carried as a tab like any other: the ghost follows, its window
   stays where it is. Over another window's strip it attaches there, and dropped there it merges
   and the emptied window closes. Dropped outside every strip, the window itself is moved so its
   tab sits under the drop point (exactly where a new window would go; a maximized one restores
   to its normal size first) and comes to the front; no window is made. A snap back or a cancel
   changes nothing.
8. **New window size and place.** The source window's normal (restored) size, never maximized,
   clamped to the display under the cursor (10 DIP inset; at least half the work area when the
   source was maximized). The source keeps its own state (maximized stays maximized).
9. **No flash, no lag.** One hidden spare window is kept warm (made ~2 s after startup and after
   each use) with the theme's background colour, and the ghost's window with it, so the tab is
   under the cursor at once. Main moves the ghost (8 ms polling of the cursor, size passed each
   time for mixed-DPI moves), never the renderer over IPC. If no spare is ready, the ghost still
   follows. Every drop waits for the floating page to draw the tab before anything commits (a warm
   spare's in a frame or two, a fresh one's once it has loaded), the ghost holding the drop point.

What a moved tab keeps: its folder, history, selection, scroll, preview, the open file and its
position (video time, play state, volume and speed), unsaved text, and in main everything keyed by
its id (folder grants, the folder watch, listings, archive passwords). It is the same tab, not a
reopened one.

## 2. The window model

Prism becomes multi-window in ONE process (it is one window per process today; Win+E's extra
windows are whole second processes).

- **Registry** (`appState`): every Prism page's window, its tabs as last reported, its own unsaved
  flag, restore state and generation. `windowOf(sender)` and `isPrismPage(sender)` replace
  `appState.mainWindow` / `isMainSender`. "The window files from outside go to" is the last focused.
- **Pushes and replies** go to the sender, to the tab's owner, or to every window, chosen per
  channel (sendToPage callers: listings, details, folder changes, paste progress, tails, archive
  events, update, preferences). A send to a destroyed page is guarded.
- **Window controls and chrome** act on the sender's window: close, minimize, maximize, fullscreen
  (per-window state; one shroud, on the asking window's display), material, corners, DWM border.
  A theme change re-applies to every window.
- **Restore and generations** per window. Only the first window of a session reads the saved tabs;
  a torn-off or Win+E window never does (structurally, not by flag).
- **Closing a window** releases its tabs' main-side state (grants, watchers, listing runs, tails,
  converts) unless a tab is mid-move. A crash rebuilds THAT window from the tabs it last reported.
- **Saving**: each window reports its own strip and bounds; the session file keeps them per
  window, and the LAST window closed is what the next cold start opens (owner: one window).
- **Win+E and the folder handler** (review finding #12) open a window in the running process
  instead of starting a second Prism. `explorerWindow.ts` and its profiles retire.
- Each new window gets the e2e flags under `--e2e` (offscreen, unfocusable), and never inherits
  `--prism-setup`, `--prism-demo` or `--win-e` from the process.

## 3. Tests

Every rule above is a failing e2e scenario first (CLAUDE.md), driven with real mouse input on the
hidden desktop (Playwright `mouse.down/move/up`; the drop point stays inside the viewport, since
the rule is "outside the strip", not outside the window). The tear geometry and hysteresis are a
pure helper with unit tests.

Scenarios: no tear from a click or a short pull; tear at the threshold makes a window holding the
same tab (and the folder watch still works there: a new file appears); the source strip lost it;
snap back over its own strip; attach into another window's strip at the right slot; Escape mid-drag
restores everything; the selection changes only at a committed drop; the only tab is carried as a
tab, moves its window when dropped outside and merges into another strip; unsaved text travels with the tab;
the second window's X closes only it; closing windows one by one and relaunching opens one window
with the last-closed window's tabs; tear-off during a slow cold restore loses no tab; a Win+E press
while running opens a window in the same process (no second Prism process). The harness gets a
`mainWin()` helper and parks every window, not just the first.

## 4. Plan (PRs in order, each with its own full e2e on the hidden desktop)

1. **Multi-window foundation**, no visible change: registry, sender-routed IPC and pushes,
   per-window chrome/fullscreen/restore/unsaved flag, release on close, per-window crash rebuild,
   session file per window with the last-closed rule, e2e harness helpers. A test-only way to open a
   second window proves two windows work side by side (controls, saving, closing).
2. **Win+E in process**: second-instance opens a window; retire `explorerWindow.ts`, its profiles
   and the update guard for child processes.
3. **Tear-off**: the gesture in TabStrip (pull, tear, cancel), the transfer of a tab's state, the
   spare window and main's move loop, the only-tab window move.
4. **Attach into any window**: live hover gap in other windows' strips, merge, closing an emptied
   window.
5. **Later, only if the feel is not native enough**: hand the move to Windows' own move loop
   through Prism's native addon (gives Snap Layouts while dragging). Not planned now.

Each PR records its rule in docs/features.md (and the 2026-08-23 entry is marked superseded) and is
installed after it passes. Rough size: 1 is the largest (mostly mechanical routing), 3 is the most
delicate.
