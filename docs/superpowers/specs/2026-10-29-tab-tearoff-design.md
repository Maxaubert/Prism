# Tab tear-off: spec and plan

2026-10-29. Owner: "the tabs should be able to be dragged out of the tab bar and if they're
appropriately far away and you drop the tab you get two windows instead of one window with two
tabs. I guess if the tab is dragged outside of the tab border where it's fully outside then it's a
new window otherwise it snaps to the tab bar. make sure to do this carefully since this is often
something that can feel bad but needs to feel intuitive."

Owner's choices (2026-10-29): a LIVE window follows the cursor; a tab can be dropped into ANY
window's tab bar; dragging a window's ONLY tab moves the whole window; windows close one by one,
and starting Prism with none open gives ONE window (the tabs of the last window closed, as today).

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
   + button, one tab width of grace. The tab leaves the strip at once (the gap closes with the
   existing 170 ms slide) and a real Prism window appears under the cursor, holding the tab at the
   same grab point in ITS strip, and follows the cursor.
4. **Snap back.** Coming back over any Prism window's strip (its rect plus 8 DIP: a tighter zone
   than the tear, so the edge cannot flicker) for 120 ms attaches the tab live: the floating window
   goes, the tab slides into that strip at the slot under the cursor, and reorders there until
   release. Its own strip included.
5. **Drop.** Released while floating: the new window stays where it is and takes focus. Released
   attached: the tab is in that strip, selected, that window in front.
6. **Cancel.** Escape, right-click, a lost capture or the window losing focus (Alt+Tab, a UAC
   prompt) put the tab back where it was, selected as before, and close the floating window. Nothing
   half-done is ever committed.
7. **The only tab.** Past the tear point the WHOLE window follows the cursor instead (no second
   window); over another window's strip it attaches there and the emptied window closes. A
   maximized single-tab window restores to its normal size under the cursor, like a title-bar drag.
8. **New window size and place.** The source window's normal (restored) size, never maximized,
   clamped to the display under the cursor (10 DIP inset; at least half the work area when the
   source was maximized). The source keeps its own state (maximized stays maximized).
9. **No flash, no lag.** One hidden spare window is kept warm (made ~2 s after startup and after
   each use) with the theme's background colour, so the window is under the cursor within a frame
   or two. Main moves it (8 ms polling of the cursor, size passed each time for mixed-DPI moves),
   never the renderer over IPC. If no spare is ready, a floating tab chip shows until it is.

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
restores everything; the only tab moves the window and merges; unsaved text travels with the tab;
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
