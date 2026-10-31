# Features

The feature history and scope rules, moved verbatim from `CLAUDE.md` on 2026-10-09. Read it before
changing a feature: each entry records what the owner decided, why, and what holds it.

## Several windows in one process (tab tear-off step 1, owner, 2026-10-29)

Owner, 2026-10-29: tabs drag out into windows of their own (spec and plan:
`docs/superpowers/specs/2026-10-29-tab-tearoff-design.md`). Step 1 is the foundation, with NO visible change
while one window is open: Prism can hold several windows in ONE process. Owner's choices that hold it:
**windows close one by one, and starting Prism with none open gives ONE window, the tabs of the last window
closed** (as today with one window).

- **The registry** (`src/main/windowRegistry.ts`, `windows` in `appState.ts`) replaces `appState.mainWindow`,
  `isMainSender` and `sendToPage`. Each window has its own unsaved-text flag and close answer, restore state,
  generation and the strip it last reported. A push goes to the SENDER (paste progress, a tail's chunks, an
  extraction's events, a dialog's owner), to the tab's OWNER (a listing's details), or to EVERY window (folder
  changes, video convert progress by path, the update offer, preferences, the phone). A send to a page that has
  gone is dropped, never thrown. Files from outside go to the window focused last (else the oldest).
- **Window controls act on the sender's window**: close, minimise, maximise, the borderless fullscreen (its
  state per window), the fullscreen transition, material, corners and the DWM border (`windowChrome.ts`). One
  shroud, on the asking window's display; a theme change re-applies to every window. The shroud is destroyed
  when the last page window closes, so a hidden cover never keeps the process alive.
- **Only the session's first window reads the saved strip**, structurally: it is the only window made with the
  `saved` seed. Any other window starts with what it is handed (nothing, for now). A window's reload or crash
  rebuild restores ITS OWN last reported tabs, never another's. Main-minted tab ids and the renderer's
  (`tab-w<n>-...`, `--prism-window`) are unique across windows.
- **A window's close releases its tabs' main-side state**: grants, folder watch, listing runs, searches, its
  tails (one tail per path per window) and its video conversions, unless a tab is marked mid-move
  (`windows.markMoving`, for step 3) or the window is being replaced by its own crash rebuild.
- **The session file** (`tabs.json`, `src/main/session.ts`) keeps one entry per window (strip and bounds);
  the top-level `tabs` / `active` / `bounds` are the entry a cold start opens, so an older reader still reads it.
  A window closed while others stay open takes its entry with it; the last one keeps its own; a quit with several
  open keeps them all and the one focused last leads. A v1 file is one window; its bounds still come from
  `window-state.json`, which is read and no longer written.
- **New windows never inherit `--prism-setup`, `--prism-demo` or `--win-e`** from the process; under `--e2e`
  every window is offscreen, unfocusable and (after the first) transparent from the start. The diagnostics core
  keeps a beat per page (`packages/term-core/main/stallWatch.ts`), so one window's beats never hide another's hang.
- Step 2 (Win+E in process), step 3 (the tear-off gesture) and step 4 (attaching into any window) are the next
  entries. The 2026-08-23 "inside its own row only" rule is SUPERSEDED by step 3 (2026-10-29).
- Held by `windowRegistry.test.ts`, `session.test.ts`, `fileTail.test.ts`; e2e `twoWindows` (each window's own
  buttons act on it, both save, the second's X closes only it, its close releases its tabs) and
  `lastClosedRestore` (close the first, then the second: the relaunch is one window with the second's tab). The
  harness parks EVERY window and finds the main one through `__e2eMainWindow` (`mainWin`), never
  `getAllWindows()[0]`.

## Win+E in process (tab tear-off step 2, owner, 2026-10-29)

Owner, 2026-10-29: review finding #12 ("Win+E and the folder handler open a window in the running process
instead of starting a second Prism"), approved through the tear-off plan (spec section 2, plan step 2). Until
now a Win+E press or a folder-verb open while Prism ran started a WHOLE SECOND PRISM (`explorerWindow.ts`)
on a Chromium profile of its own under `<userData>/explorer-windows/<uuid>`, with read-only preferences, a
read-only listing cache, its own diagnostics log, and an update install that refused while it lived.

- **While Prism runs, a request opens a NEW WINDOW of this process** (`second-instance` with
  `--win-e=<uuid>`, and `--browse=<folder>` from the folder verb): File Explorer's own behaviour, and what
  the second process gave. The window opens on one Explorer tab: at the folder the request names, else, for
  a plain Win+E, at "Folder for new tabs" when that names a folder, else Home ("Ask" is Home too: a window
  cannot ask before it is there). It is seeded with nothing, so it never restores a copy of the saved strip,
  and its session entry follows step 1's rules (its own entry; the last window closed is what comes back).
- **Its page answers the helper exactly as the second process's did**: "<id> started" down the held pipe the
  moment main has the request, the id once that window's folder browser shows (`winE:ready`). Each request
  NAMES ITS WINDOW (`winERequests.ts`: a cold start's is the first window's, `WIN_E_FIRST`; one while Prism
  runs is the window made for it, `winE` on its registry record), so listening, restored and a reload are per
  window: one window loading never resets another's request, and only the page it went to can answer it. A
  retransmitted token opens nothing more. A crash rebuild of that window carries its request.
- **A cold start keeps today's behaviour**: the request is the first window's (its pinned Explorer, or a new
  one), and so is one that arrives while the first window is still being made. During an install or a quit
  a request is not answered, so the helper opens File Explorer.
- **Retired**: `explorerWindow.ts` and its test, `--explorer-window`, `extraWindowOwner` and its branches (the
  read-only preference and listing-cache use, the skipped Win+E resume and folder-handler repair, the marker
  files), and the update guard for child processes (`hasOtherExplorerWindows`): the install now asks only
  that NO window holds unsaved text. The old profiles are removed once, off the startup path
  (`oldExplorerWindows.ts`, uuid-named folders only, after the first answer plus 5 s; a folder that is a
  junction or symlink is never walked).
- **Review fixes (2026-10-29, the step-2 review)**:
  - **A Win+E window ranks below an ordinary window** in the session file (`session.ts` `minor`): after a
    quit with both open it is not what the next cold start opens, even when focused last, so one press, a
    browse and a restart never trade a strip of ten tabs for one Explorer. Closed last of all, it still comes
    back. A shutdown or log-off counts as a quit (`session-end`), so the windows Windows closes one by one keep
    their entries. Interim default, chosen by the review fix: **the owner may still decide otherwise.**
  - **A window closed before it answers lets go of the helper's pipe at once** (`winERequests.ts` `forget`
    drops its requests, `dropWinE`), so the helper opens File Explorer then, as when the old second process
    exited, not 45 s later. An expired request lets go of its pipe too.
  - **The folder a request carries travels with the request** and goes with it; a retransmitted token cannot
    change it.
  - **The folder read is bounded at 5 s** (`useWinEOpen.ts`, `lib/inTime.ts`): a sleeping network share as
    "Folder for new tabs" lands the window on Home and answers, rather than letting the helper open File
    Explorer on top of Prism.
- Held by `winERequests.test.ts` (per-window hosts, forget and expiry let go of the pipe, the folder travels
  with its request), `session.test.ts` (the Win+E rank), `oldExplorerWindows.test.ts` (and the junction),
  `inTime.test.ts`, the e2e `winERunningEdges` (two presses at once each answered by its own window, a window
  closed before it answers lets go of the pipe, a Win+E window focused last does not lead the session file
  after a quit), and the e2e
  `folderOpenRunning`: with Prism running, the folder verb and a plain Win+E each open one window more in
  the SAME process (one Prism main process on the e2e profile, counted from the process list), the stand-in
  helper gets "started" then the id, the new window shows the asked folder (or the folder for new tabs), and
  the first window keeps its own. The cold start stays `folderOpen`'s.

## Tab tear-off (tab tear-off step 3, owner, 2026-10-29)

Owner, 2026-10-29: "the tabs should be able to be dragged out of the tab bar and if they're appropriately
far away and you drop the tab you get two windows instead of one window with two tabs. I guess if the tab is
dragged outside of the tab border where it's fully outside then it's a new window otherwise it snaps to the tab
bar. make sure to do this carefully since this is often something that can feel bad but needs to feel
intuitive." Owner's choices the same day: a LIVE window follows the cursor (since 2026-10-30 only the tab does:
"The ghost", below); dragging a window's ONLY tab moves the whole window (REPLACED 2026-10-30: the only tab is
carried as a tab too, "The only tab", below). Spec section 1 is the contract
(`docs/superpowers/specs/2026-10-29-tab-tearoff-design.md`).
**This SUPERSEDES the 2026-08-23 rule** that a tab "should slide left and right inside its own row and nowhere
else" (TabStrip.tsx, #70/#71): a tab still slides in its row, and now it can also leave it.

- **The gesture** (all DIP; the numbers are `src/shared/tabTear.ts`, pinned by `tabTear.test.ts`):
  - A press past 4 DIP along the row (or out of the strip) is a drag; a click, or a wobble inside the strip,
    never tears anything and still picks the tab.
  - Out of the strip, the carried tab follows at **0.4x** (it visibly pulls against the bar), and the same
    rubber band holds it at either end of the row.
  - It **tears when its own rect is fully outside the strip** (the zone ends one tab width past the +), and the
    cursor is 12 DIP out (a guard for a grab at the tab's very edge, so a tear is never inside the snap zone).
    With a press in the middle of a 32 DIP tab, that is 16 DIP below the strip.
    Carried sideways, it tears once it is fully past that grace too, even with the cursor still over the strip's
    empty end.
  - The gap closes with the existing 170 ms slide, and **only the tab follows the cursor** (the ghost, below),
    held at the same grab point as in the strip. The new window is taken at once and stays hidden, and empty,
    until the drop. Until the ghost is on screen a copy of the tab follows the pointer inside the source.
  - **The front changes only at the drop** (owner, 2026-10-30, after trying it by hand: "theres a slight issue
    where it switches focus like which tab is in focus as soon as you drag it out, i want those switches to
    happen when you drop it"). All through the drag the source keeps the dragged tab in front (if it was) and
    its page on screen; only its slot in the strip is empty. A drop that COMMITS elsewhere (a new window, or
    another window's strip) is when the source's neighbour takes the front (its right, else its left, as a
    close does) and the other window selects the tab; the source switches only once that window has it, so
    nothing flickers. A cancel, a snap back, a drop in its own strip or a failed drop change no selection at
    all, and the source's record and session entry keep the tab in front until the commit (`handTab`).
    Because the tab stays live in the source (a film goes on playing, a playlist moves on), the drop packs it
    AGAIN and sends it with the drop (`tabs:tear-end`), and that is what the other window gets; the floating
    window is handed the tab only then, so it never plays a second copy while hidden. No key reaches the page
    while a tab is torn off (Escape cancels; the rest are swallowed, so Ctrl+W or a step in the folder cannot
    change the tab under the drag).
  - **Snap back**: over its own strip (rect plus 8 DIP, tighter than the tear; the strip held to the tear zone,
    `snapTarget`, so a tab torn sideways past the + is never over it at once, review 2026-10-29: the window
    attached and tore again in a loop) for **120 ms**, the ghost
    goes, the tab is in the strip again at the slot under the pointer, and reorders until release, the front
    as it was.
    Every Prism window's strip takes it the same way since step 4 (the next entry).
  - **Drop** while floating: the new window is handed the tab, placed so its tab sits under the cursor where
    the ghost was, shown in front and focused once its page has drawn the tab (the ghost holds the drop point
    until then), and the ghost goes. Released in the strip after a snap back: a reorder like any other, the
    front as it was (2026-10-30; it used to select the tab).
  - **Cancel**: Escape, a right-click, a lost pointer capture or the window losing focus change nothing (the tab
    never left the source, and the front never changed), and the ghost hides (the floating window never showed
    and was never handed the tab). Nothing half-done is committed. A
    right-click's own context menu does not open after it. The strip going away mid-drag (F11) cancels too, and
    so does the source page reloading; the source window closing mid-drag releases the tab's grants and watch
    (review 2026-10-29).
  - **The only tab is carried as a tab** (owner, 2026-10-30: "also if you drag it to a new window and wanna
    remerge when you then drag a tab from a single tab window you just drag the window it should be the tab you
    drag"; this REPLACES the 2026-10-29 choice that the only tab moved the whole window, and its fade). The
    ghost follows the cursor and the window stays where it is (maximized too) all through the drag. Over another
    window's strip it attaches there live, exactly like any torn tab, and dropped there it MERGES (step 4). Dropped
    outside every strip, the source window ITSELF is moved (`setBounds`, its normal size; a maximized one is
    restored first) so its tab sits under the drop point, exactly where a new torn window would go
    (`floatBounds`), and brought to the front; no window is made and the spare stays the spare. It is clear
    (the addon's `setAlpha`) while it is restored and moved, and the ghost holds the drop point until it has
    drawn there (review 2026-10-30: the ghost went first, and a maximized one played its restore to its old
    place). Back over its own strip, or any cancel: nothing changes. Held by `tearOff.test.ts` and the tabTear
    scenario (drop, snap back, Escape, blur).
  - **New window size and place**: the source's normal size, never maximized, at least half the work area when
    the source was maximized, never more than the work area less 10 DIP a side; its top never above the work
    area and 48 DIP of it always on the display. The source keeps its own state.
  - Settings never leaves its window (it slides in its row only).
- **The ghost** (owner, 2026-10-30, after trying the live window by hand: "i dont wanna be carrying a full
  window ... actually let it just be the tab you're carrying, that's how file explorer does it"). While a torn
  tab is outside every strip, ONLY a tab-sized ghost follows the cursor: the tab as the strip draws it (the solid
  folder, its label, the strip's ground and the theme's ink, the accent rule), never a window preview, at
  slightly lower opacity (`TEAR.ghostOpacity`, 0.85; owner, 2026-10-30: "you want it to be the tab still but
  just slightly lower opacity"). Its window is exactly the tab and OPAQUE, see-through only by its window's
  opacity: the first build was a transparent window with a shadow, and with DirectComposition off (Prism's
  video fix) it drew nothing ("right now there's nothing"). It is its own tiny native window (`src/main/tabGhost.ts`): frameless,
  unfocusable, out of the taskbar, click-through (`setIgnoreMouseEvents`), always on top at `screen-saver`
  level (never hidden behind the source, the bug the live window had), shown INACTIVE, placed before it shows,
  made warm with the spare. Its page is a fixed data: page with a CSP allowing no script and no fetch, no
  preload, sandboxed, no navigation; the label goes in as `textContent` inside one JSON value and the colours
  as checked CSS colours (`validTabLook`), so a folder name can never be markup. The strip sends its computed
  look with the tear (`look` on `tabs:tear`; one that fails the check is dropped, never the tear). Over another
  window's strip it hides (that strip draws the tab), and comes back when the tab tears out again; a snap back,
  a drop and every cancel hide it at once. Since 2026-10-30 the ONLY tab has its ghost too (above).
  Review 2026-10-30: at a drop the ghost stays until the window just shown has drawn a frame (at most
  250 ms, `TEAR.drawnMs`), so no frame shows neither; a late drop keeps it at the drop point until the
  window shows or the tab goes back. The ghost itself shows clear and takes its opacity only after its own first
  frame (never the previous tab's face), a window jumping to a display of another scale is placed twice
  (`setBoundsSure`), and the tab size a page sends is held to 400 x 64 DIP (`tabSize`).
- **How it is built**: the strip keeps the pointer (its capture holds outside the window) and decides the tear;
  then ONE call (`tabs:tear`) and main owns the move (`src/main/tearOff.ts`): it shows the ghost and moves it
  every 8 ms from `screen.getCursorScreenPoint` (`ghostBounds`, in DIP, the size passed each time for
  mixed-DPI moves; never from the renderer's events over IPC), and works out every tick where the hidden
  floating window (or, the only tab, its own window) goes (`floatBounds`), placing it there only at the drop.
  Nothing else moves during the drag. In memory only (`syncCalls`, `spawnCalls` stay green).
- **The spare**: one hidden window is kept warm (made 2 s after the first window has loaded and after each use)
  with the theme's ground (`themeGround`), so the window is under the cursor in a frame or two. It is not a
  window of the session (`spare` on its registry record): never counted, never where files from outside go,
  never in the session file, its close releases nothing, and the last window of the session closing destroys
  it. A snap back or a cancel leaves it the spare (it was never handed the tab); a drop whose page never drew
  the tab gives it back, and the folder watch that page started goes on for the source if the source shows
  the tab, else stops.
- **No spare ready** (the first 2 s, and 2 s after each drop): a fresh window is made, hidden; the ghost follows
  the cursor all the same (it does not wait for the window), and a copy of the tab follows the pointer inside
  the source until the ghost is on screen. Every drop commits NOTHING until the floating page has drawn the
  tab (review 2026-10-29: the tab's unsaved text was lost and the window could stay hidden for good; since
  2026-10-30 the page is handed the tab at the drop, so a warm spare takes a frame or two, a fresh one until
  it has loaded): the source holds the tab, and once the page has it the window commits, shows and takes the
  focus; a page that never comes (10 s, `TEAR.lateDropMs`) or dies gives the tab back. The ghost waits at the
  drop point all that time.
- **What a moved tab keeps** (`lib/tabs/tabCarry.ts`, `tabCarry.test.ts`): it is the SAME tab, by the same id,
  rebuilt in the new page in the restore shape: its folder, history, selection, scroll, preview, the open file,
  the film's place and whether it played, its volume, mute and speed, a document's place, the archive
  passwords given for it, the listing on screen, and its unsaved text (the new window holds it, and its close
  asks). In main nothing moves: everything keyed by the id (grants, the folder watch, listings) stays, the tab
  is marked moving (`windows.markMoving`) from the drop until the commit (two pages have it then), and the
  source lets it go only after the drop has committed, without a `browseRelease`. Only the page that has a tab may stop its folder watch (two pages show
  it for a moment). The new window's one tab is its home.
- **Under --e2e** nothing moves: the windows stay parked, main follows the page's pointer (`tabs:tear-point`)
  rather than the system cursor (Playwright's mouse is not it), and `__e2eTear` tells where the window would be.
  There is a spare only when a scenario asks (`PRISM_E2E_SPARE=1`). The ghost is parked and clear like every
  window and never moved, but it really shows and hides: `__e2eTear` gives `shown`, its would-be `ghost`
  bounds, `ghostWin` (made, loaded, visible) and `spare.visible`; `__e2eGhostLabel` reads its label back.
- Held by `tabTear.test.ts` (every number, and that no tear is ever inside the snap target; `ghostBounds`,
  `validTabLook`), `tearOff.test.ts` (the loop, the dwell, drop, cancel, the only tab carried as a tab and its
  window moved only by a drop outside, a slow window's late drop, its failure, the source closing; nothing
  handed to the floating window before the drop and the drop's own carry handed then; the ghost shown at the
  tear, following, hidden in a strip, on a snap back, at the drop after the window shows, on every cancel, a
  slow ghost, the spare never shown or moved during the drag), `tabGhost.test.ts` (its page has no script, the
  label is data, when it shows),
  `windowRegistry.test.ts` (the spare), `tabCarry.test.ts`, and the e2e `tabTear` (written,
  run before the PR): a click and a short pull tear nothing; the ghost shows after the tear, tab-sized, with
  the tab's label, and follows the pointer while the floating window stays hidden and empty; all through the
  drag the source keeps the dragged tab selected with its folder on screen, and only after the drop does its
  neighbour take the front; a tear makes a window holding the same tab id, whose folder watch shows a new file
  in the NEW window, and the source strip lost it; a snap back over its own strip makes no window and changes
  no selection; Escape (the dragged tab in front) and a right-click (a background tab) mid-drag change
  nothing, the front included; a sideways tear past the + stays torn; unsaved text travels; a drop on a fresh
  window (no spare) shows it holding the tab; the only tab shows the ghost while its window stays put, and a
  drop outside moves its window to where a new window would go (`moved`, `moves` in `__e2eTear`), while
  Escape moves nothing. The ghost is hidden after a drop (the new window shown), a snap back, Escape, a
  right-click and the late drop.
- Attaching into ANOTHER window's strip, and closing a window emptied that way: step 4, the next entry.

## Attach into any window (tab tear-off step 4, owner, 2026-10-29)

Owner, 2026-10-29 (spec section 1, points 4, 5 and 7; plan step 4): "a tab can be dropped into ANY window's tab
bar", approved as: a torn tab hovering over ANY Prism window's strip attaches there LIVE, release commits it
there, moving away tears it off again, and the ONLY tab's window move merges into another window's strip and
the emptied window closes on release.

- **Over another window's strip** (its target and margin exactly as the source's own: the strip held to its
  tear zone, plus 8 DIP, `attachRects` in `src/shared/tabTear.ts`) for **120 ms**, the tab attaches there,
  live: the ghost hides (owner, 2026-10-30; the floating window is hidden all through the drag), and that
  strip opens a gap at the slot under the cursor (its neighbours
  slide with the 170 ms slide) and draws the tab in it, sliding along as the cursor moves. Main tells that page
  where the tab is (`tabs:hover`, every tick the cursor moved; the pointer is still the source's, whose strip
  holds the capture), and the page tells main the slot (`tabs:hover-slot`).
- **Released there**: the tab is in that strip at that slot, selected, that window in front (focused). It is
  the SAME tab, moved exactly as a tear moves it: the same id, everything it carried (`tabCarry.ts`), its
  main-side state untouched, `handTab` at the commit (the source's record and session entry lose it at once,
  the target's list it at once), nothing released. The source lets it go only after the commit, as in step 3.
  It is not that window's home (that window has its own). The floating window was never handed the tab: it
  is the spare still. The source's front changes only now (2026-10-30, above).
- **Moving away again tears it off again**, by the tear's own rule and hysteresis: fully outside that strip's
  tear zone (one carried-tab width past its +), the cursor 12 DIP out. The gap closes with the slide, the
  ghost is back under the cursor, and the same 120 ms dwell takes it in again. The two zones cannot
  meet, so it never flickers between the two.
- **The only tab** (carried as a tab since 2026-10-30, its window staying where it is): over another window's
  strip it attaches the same way, the ghost hidden. Its own window hides no strip behind it while its tab is
  carried, and the window whose strip it enters comes to the front at once (review 2026-10-30: focused, it was
  in front of every other, so a maximized one could merge nowhere on its own monitor; tabAttach drags one over
  window 2 with its own window in front). Released there, the tab is that window's and the emptied
  window closes, asking nothing (its unsaved text went with the tab). The tab stays marked moving until that
  window has left the registry, so its close releases nothing. Torn out again, the ghost is back; a cancel
  changes nothing.
- **Every cancel still restores exactly** (Escape, a right-click, a lost capture, the window losing focus): the
  gap closes, the tab is back in its own strip at its place, the front tab as before, no window made, the other
  window as it was.
- **Z-order** (review 2026-10-30): the windows are hit-tested front to back AS WINDOWS STACKS THEM, asked
  every tick (the native addon's `zOrder`, `native/sweep/zorder.h`; a window on another virtual desktop is not
  on screen). Without the addon (not loaded, an older build, --e2e) the order is Prism's own: the window focused
  or raised most recently in front (`frontAt`), and among windows never focused (the e2e's) the newest. A
  window's body hides every strip behind it, and so does ANOTHER APP'S window (`coveredAt`): a strip under a
  browser takes nothing and raises nothing, and a tab hovering in a strip tears out of it where anything in front
  of that window is under the cursor. A window the cursor stays over for **750 ms** (`TEAR.raiseMs`, Chrome's
  number: a pass on the way somewhere else raises nothing) comes to the front WITHOUT the focus (`moveTop`; the
  source would cancel on losing it), the ghost above it (it is above every app), and is in front for the hit test
  from then on, the next tear included. A tab that goes back to its source after a raise, or a cancel, brings
  the source (still focused) to the front again. Interim number, chosen by the build: **the owner may still
  decide otherwise.**
- **The only tab's window no longer goes clear during the drag** (2026-10-30: it stays put under the ghost);
  only a drop that moves it does (above). Its drag carries no folder listing
  (a large folder's was cloned at the start of every such drag, review 2026-10-30); merged, the target lists
  the folder itself.
- **Every window reports its strip** (`tabs:strip`: the strip's rect and the +'s right edge, client
  coordinates; null when there is none, fullscreen or no tabs), when it changes and never while a tab is carried
  in it or hovers over it. Main keeps it on the window's record (`strip`), cleared when the page reloads. A
  minimized, hidden, still-restoring window or the spare is never a target; a target that closes, reloads or
  loses its strip mid-hover lets the tab go on flying.
- **Under --e2e** the same page-pointer mapping as step 3; since every window is parked at the same place, a
  window other than the source is a target only once the e2e says where it pretends to be (`__e2eTearAt`, an
  offset from where the source is read). `__e2eFocused` gives the unfocusable windows a focus order,
  `__e2eStrip` reads a window's report; nothing is raised under --e2e.
- Held by `tearOff.test.ts` (live attach and the hover it sends, the slot the drop lands at, tearing out again
  and not flickering, a cancel there, a strip behind a window's body and the 750 ms raise, overlapping strips,
  no strip, a target going away, a drop before the floating page had the tab, the only tab's ghost hidden there
  and merged and its window closed with the tab moving until it has gone, its cancel moving nothing, no carry,
  the e2e placement),
  `tabTear.test.ts` (`attachRects` and its hysteresis, the request and the strip report), and the e2e
  `tabAttach`: a tab torn from window 1 attaches live into window 2's strip (the ghost and the floating window
  hidden, the tab drawn, the slot between its two tabs, its neighbour making room), window 1 keeping it in front
  all the while, dropped it lands there by the same id, selected, window 1 lost it and only then gives its
  front to the neighbour, no window made, its grants kept and its folder watch showing a new file in window
  2; hovering hides the ghost and pulling away tears it off again with the ghost back (the floating window
  still hidden); Escape over window 2 restores window 1 exactly; a third
  window's only tab (window 2 in front of it) shows its ghost, which hides over window 2's strip; cancelled
  there it changes nothing, and dropped it merges at the end, selected, and its window closes (and leaves the
  session file), no window moved; with the strips overlapping, window 2 (focused last) takes the tab until
  window 1 is focused last, and then its own strip does. Since the review (2026-10-30): a right-click over
  window 2 cancels and restores; window 2 hidden mid-hover lets the tab go, takes nothing hidden and takes it
  again shown; window 2 reloading mid-hover lets it go and takes it again only once restored. `tearOff.test.ts`
  holds the rest: another app's window over a strip or coming over the hovered one, a window in front ending the
  hover, the system's order changing mid-drag, a window that stops taking tabs, a raise outliving the tear, the
  source brought back to the front on a cancel or a snap back after a raise, and the e2e's bookkeeping raise.

## Drag files out of Prism (#103, owner, 2026-10-31)

Owner, 2026-10-31: approved the spec and plan (`2026-10-31-drag-out-spec.md`, kept with the session) with
all its recommendations. Rows, a selection, archive members and the open file can be dragged into Explorer,
a browser's upload box, Discord, another Prism window or any app that takes files.

- **D1, the hand-off at the window's edge.** Inside the window the in-app carry is unchanged (the carried
  row #327, the arrow #320, Ctrl+Tab). When the pointer leaves with the button held (or reaches the last
  2 px of an edge, so a maximized window can hand off too: `lib/drag/edge.ts`), the carry ends quietly, no
  drop, and main starts Windows' own drag (`webContents.startDrag`) with the same cargo. Pins never hand off
  (they carry an order), tabs keep their own tear-off. ONLY A CARGO MAIN ALREADY SAID YES TO hands off (review,
  2026-10-31): the press's `drag:prepare` answer (`isReady` in `lib/drag/dragOut.ts`). Nothing that can leave (a
  member still extracting or over the budget, a path main refused) keeps the in-app carry at the edge, so the
  2 px margin of a maximized window never ends a drag for nothing. A release that comes before main has started
  the drag (`drag:out-cancel`) stops it: Chromium's drag source would drop at once wherever the pointer is.
- **D2, out of Prism is a COPY only.** Electron's OS drag offers copy and link, never move; Windows' own
  move-on-the-same-drive would need native code and was not chosen.
- **D3, a drop from Windows onto a Prism folder is a COPY** (it MOVED until now, though the payload's own
  comment said "never moved, only copied in"). `file:copy-into` runs the paste engine on the dropped paths:
  the job chip, the landing rows, "name (2)" for a taken name, never a folder into itself. Every source must
  pass the wall (`movable`); the drop browses each source's folder first. Two differences from the old move,
  as a paste has them (review, 2026-10-31, for the owner to confirm): no undo entry (a paste records none),
  and no clash question (the spec's 4.6 kept it; the paste engine's "name (2)" is what Explorer's own copy
  does).
- **D4, Prism window to Prism window MOVES**, like a drop inside one window. Every window holds main's
  record of the OS drag in flight (`drag:native-start` / `drag:native-end`); a drop of Windows files is
  Prism's own only when a record is set AND the dropped paths are its paths (`ownDrop`, `samePathSet`). A
  stale payload can never match a drop, which is what moved the wrong file in the 2026-09-05 attempt. The
  renderer keeps the record 1.5 s past the end message, since the drop and that message travel apart.
  Members come back as members and extract from the archive (the job window). Targets show Copy for any
  drag Windows carries; what the drop does is this rule, not the effect shown.
- **D5, archive members are extracted on the PRESS**, at most 64 MB and 64 members (a folder is one, at its
  listed size), into the run's member folder, files and folders alike (a folder took the "Copy folder"
  route into a `prism-arcdir-` temp folder nothing removed, made by every press on a folder row: review,
  2026-10-31). The 2 GB cap counts a folder at its listed size, the quit removes it. Reused while the
  container is unchanged, and never carried once it changed (the copy names the zip's size and time); a locked archive uses its remembered password or prepares nothing. Over the budget
  there is no hand-off and no message; the in-app drag still extracts onto a folder and Copy stays the way
  out. Temp copies a drag carries are pinned against eviction while it runs and 60 s after
  (`MemberTemp.pin`), since a browser reads an upload lazily.
- **D6, the open file**: the picture at fit (a press that travels drags it; zoomed in, a press pans as
  before) and the file's name in the viewer toolbar (every kind). No drag from the video picture. A member
  of an archive open in the viewer is not draggable from the viewer (it is no file on disk).
- **D7, the drag icon outside the window is the system's file icon** (`app.getFileIcon`, cached per
  extension, warmed on the press; the app's icon, never an empty one, when there is none).
- **The walls hold**: main checks every path against the root wall (`readable`) and stats it async before
  `startDrag`; nothing new is granted; the page never names a temp path. The lag profiler writes no profile
  for a lag during the drag's modal loop (`duringDrag`).
- **The e2e never starts an OS drag** (a modal loop nothing would release): under `--e2e` main records what
  it would hand `startDrag` (`e2eDragOut.ts`, read as `globalThis.__e2eDragOut`), a guard `dragOut.test.ts`
  pins. Held by `dragOutRow`, `dragOutMember`, `dragOutViewer`, `dropBack` (real dropped files through a
  hidden input; it failed on the old move), and the unit tests `src/main/dragOut.test.ts`,
  `src/shared/dragOut.test.ts`, `lib/drag/dragOut.test.ts`, `lib/drag/edge.test.ts`, `memberTemp.test.ts`,
  `lagProfiler.test.ts`.
- **Held by the e2e as well** (review, 2026-10-31): the carry survives the 2 px margin, a release ends the
  drag, pins never hand off, an over-budget member keeps the carry at the edge, a folder member lands in the
  member folder and leaves no `prism-arcdir-` folder, and `dropBack` drops on a row, a tab (copy and move),
  the window (its own file opens), a zip's folder (added, and moved for its own), its own folder (refused)
  and a member record (extracted from the archive).
- **Only a hand test proves** (task 1's spike, not run on 2026-10-31): that `startDrag` picks the drag up
  mid-press after the in-app carry cancelled the browser drag, that it blocks until release with main still
  answering, that a drop in Explorer is a copy (Shift too), a browser upload, Discord, a second Prism window
  (a move) and back into the same window (a move). If the hand-off does not pick up, the fallback is a small
  native `DoDragDrop`, which needs the owner's say.

## Explorer only: no terminal, dictation or projects (owner, 2026-10-26)

Owner decision 2026-10-26 (spec: `docs/superpowers/specs/2026-10-26-explorer-only-design.md`, release
0.119.0): Prism is an Explorer plus its viewers. The terminal, local dictation and project tabs with their
file tree are removed. Reason: a fast viewer should not carry what the owner never uses, and the terminal's
agent poll was the measured cause of the ~5 s startup freeze (`diag.jsonl` 2026-10-21, 24 and 26, seen in 7 of
8 runs). Every older entry below that describes the terminal, dictation, agents, the sidebar tree, split panes
or project settings is HISTORY, kept for its measurements; none of it ships.

- **Stays**: Explorer tabs (none pinned since 2026-10-28, below), every viewer, search, rename / move / delete,
  Properties, archives, Win+E, file associations, the folder handler (#393), the update chip and window,
  Settings (Appearance, Explorer, Media, Diagnostics, About), 18 themes and the colour picker, the phone page,
  `npm run diag`.
- **NO PINNED TAB; THE LAST CLOSE CLOSES PRISM** (owner, 2026-10-28: "remove the pin system for tabs every
  tab can be closed if you close the last it closes prism just like file explorer", and "tab should show the
  current folder name"). Every tab has its X, its Close tab row and middle-click, and drags anywhere; every tab
  is named by the folder it shows (the first one read "Explorer"). One Explorer tab still carries an invisible
  HOME mark (`Tab.pinned`, kept for saved strips), the one a file from outside lands in: restore keeps the
  strip's order and marks the first Explorer tab when none is marked, and closing the home tab hands the mark to
  the first Explorer tab left (`closeTab`). Closing the last tab closes the window (`useTabOps`
  `forceCloseTab`, after the unsaved-text question) and leaves the strip saved, so the next launch restores
  it. `tabs.test.ts`, `tabStrip.test.ts`; e2e `tabs`. Settings as the last tab follows the same rule
  (performance review, 2026-10-28): the gear or Settings' own close then closes the window, where it left an
  empty one (`settingsCloseIsLast`, `tabs.test.ts`; e2e `settingsLastTab`).
- **Entry points**: a file from argv, an association, a second instance or a drop opens in the home Explorer tab
  as before. A folder from argv, a drop or the shell verb opens an Explorer tab at it (or switches to a tab that
  already shows exactly that folder). The shell verb on folders now reads "Open in Prism"; `relabelVerb`
  rewrites the old "Open as project" text on the next start.
- **Saved tabs migrate**: a `role: 'project'` (or role-less) entry restores as an Explorer tab at its
  `browse.path ?? root`, keeping its open file; old `open` and `panes` fields are ignored. Held by
  `src/main/tabs.test.ts` and `src/renderer/src/lib/tabs/tabs.test.ts`.
- **Permissions**: every `media` permission is denied (the microphone was dictation's only use), held by
  `src/main/permissions.test.ts`. PDF external links use Prism's own `openExternal` channel.
- **Viewer watch**: a file in the full viewer is no longer watched through a project root; `useFolderBrowsing`
  watches the shown file's folder while the viewer is in front (`useFolderBrowsing.test.ts`).
- **Dead pref keys keep their strings** (`prism.term.*`, `prism.tree.*`, `prism.sidebar*`, `prism.newtab.show`
  values): `src/shared/prefKeys.test.ts` pins them, and a stored `terminal` new-tab value reads as the folder
  browser (`newTabPrefs.test.ts`). `%LOCALAPPDATA%\PrismDictation` is never deleted (Flare may use it).
- **The leftovers went** (2026-10-28, performance review, owner: "do a review of the app look for bugs,
  lingering code that should be changed ... look for stall points, things that use up too many resources").
  `src/main/roots.ts` and the recursive `src/main/dirWatch.ts` are gone: no root had been registered since
  #439, so the watcher never started, `ownWrite`'s mute map only grew, and the "a tab's own root cannot be
  renamed or binned" check guarded nothing. The wall is the desktop grants (`desktopAccess.ts`) plus what main
  extracted or made (`pathWall.ts`), unchanged in effect; the folder watch is `browseWatch.ts`. The sidebar's
  `searchTree` / `search:files` and the unused `copyFileToClipboard` left the desktop preload; the phone keeps
  its own `searchHere` (`prismShim.ts`). The dead pref keys are RETIRED, by an explicit list in
  `src/shared/prefKeys.ts` (never a `prism.term` prefix: the colour picker's format lives there): the sync
  refuses them, main deletes their store files once per run, each window drops its copies.
  `prefKeys.test.ts` still pins every string; `windowPreferences.test.ts` (main and renderer) hold the cleanup.
  The places toggle, the folder-icon setting and the update dialog no longer name the tree or terminals, and
  the renderer's copies of the core's `hiddenTitle` and colour maths became the core's.
- **Core**: `packages/term-core` is pruned to the settings frame, Diagnostics, the update chip and window,
  diag log, colour maths and Tooltips. No node-pty, `@xterm/*` or whisper ships (`THIRD-PARTY-NOTICES.md`).
- **Gates**: `npm run e2e` (112 scenarios at the cut, offscreen) is the PR gate; `npm run e2e:ui` is the
  runner-safe subset that `ui-gate.yml` runs in CI (it replaced `terminal-gate.yml`). The `channels.test.ts`,
  `prefKeys.test.ts` and `syncCalls.test.ts` walls are unchanged.

## Scope

**In scope (v1, the universal quick-viewer):**

- Open via: a file argument (Explorer double-click / "open with" / CLI), drag-and-drop, and an
  open dialog.
- **A PASTE SHOWS IN THE LIST** (owner, 2026-10-28: "for bigger items or things that take time to paste it
  should show a progress bar now nothing happens and suddenly items just appear"; picked: rows in the list).
  The job chip was there all along (bottom left, small and dim), which is why it read as nothing. Now a copy
  says its items as it starts (`file:paste-into` sends `start: { dir, items }`, each item's expected path)
  and how far each has got (`item`, `itemPct`); the list (`FolderBrowser`) puts every item still copying into
  the listing at once, sorted where it will land, drawn faded, inert, "Copying…" with a filling bar in the
  Size column (`lib/jobs` `landJob`/`landingIn`, `BrowseList` `landing`), until the real file arrives. A
  move is a rename and shows none. `jobs.test.ts`; e2e `pasteProgress` (a 600 MB copy).
  CHEAP FOR A BIG PASTE INTO A BIG FOLDER (performance review, 2026-10-28; owner: "look for stall points,
  things that use up too many resources"): each progress message filtered every item against the whole
  listing, lower-casing both, re-sorted the folder, and re-rendered every open Explorer tab, and main sent one
  unthrottled message per landed item. Now `FolderBrowser` follows only its own folder's rows
  (`useLandingIn`), looks them up in a set, and builds the merged listing from the ROW SET alone
  (`browse/landingRows.ts` `rowsKey`): a percentage tick redraws bars and never re-sorts. Main sends at most
  one message per 120 ms, landings included; progress on an item says every item before it is through
  (`updateLanding`). A landed row stays at 100 until the listing has the real file (it blinked out until the
  watcher's re-read). Two sources with one name predict two names in order (`pasteCopy.ts` `predictNames`,
  `uniqueNameAsync`'s `taken`), and the copy writes exactly where its row said (they shared one path and one
  row hid the other). A cut copied across drives counts its percentage in items (`movePct`; from the second
  such item it read 100%). `landingRows.test.ts`, `jobs.test.ts`, `pasteCopy.test.ts`, `fileOps.test.ts`.
- **A CUT ROW LOOKS CUT** (owner, 2026-10-28: "when you click ctrl x on an item selected the highlight
  effect should get dimmed to indicate you clicked ctrl x"). A row marked cut (`data-cut`, from
  `lib/fileClipboard`) wears the inactive selection's dimmed tint and edge while selected, and its name and
  icon fade to 55 % (`browse.css`); a paste or a new copy clears the mark. e2e `explorerVerbs` compares the
  cut row's tint with the dimmed and full ones.
- **A SLOW PICTURE OVER ANOTHER SAYS IT IS LOADING** (owner, 2026-10-28: a HEIC clicked while another
  picture is in the preview "just takes some time then it switches ... which makes it seem like the image
  can't be viewed or there is a bug"). The viewer keeps the last picture until the next is ready (so
  arrowing never flashes empty), and now, once the wait is long enough to see (the spinner's own delay;
  the dim after 0.25 s), shows the ring over that stand-in and dims it to 35 % (`ImageView` `switching`).
  A quick or preloaded picture shows neither. e2e `previewSlowImage` (`PRISM_E2E_SLOW_MEDIA` makes one
  file answer 1.5 s late; it fails on the old viewer).
- **THE LAST PICTURE STAYS UNTIL THE NEXT IS DRAWABLE** (#28, 2026-08-05 review, fixed 2026-10-31). Ready
  meant fetched, so crossing between an ordinary picture and one past 40 MP swapped the `<img>` for an
  empty canvas (or back) at once, and the stage sat blank for the whole decode, seconds on a big scan;
  the 2026-10-16 fix brought the ring back but not the picture. Now the next picture is decoded
  off-screen first (`lib/imageReady` `readyImage`: a huge one becomes its bitmap, an ordinary one is
  decoded by a detached element), and only then replaces the last, which stands in under the ring and
  the dim (`switching`) meanwhile. The canvas takes its bitmap before the paint (`useLayoutEffect`), and
  an `<img>` decoded ahead draws with `decoding="sync"`, so neither shows a blank frame. An early decode
  that refuses still swaps, so the element's own error says why. Stepping past a picture drops its
  hidden decode; stepping back to the one still on screen does not decode it again. e2e
  `imageHugeSwap` (arrows across 42 MP both ways, watching every frame) and `imageReady.test.ts`.
- **MAIN TYPES EVERY PICTURE FILEKIND LISTS** (#31, 2026-08-05 review, fixed 2026-10-31). fsmedia://'s
  type table was a second list beside `fileKind`, and they drifted: `.ico` went out as octet-stream and
  missed the whole-buffer fast path that is gated on `image/`. The image half of `mime.ts` is now built
  from `fileKind`'s `imageExtensions()`: Chromium's own formats keep their types (`NATIVE_IMAGE`), and what
  main converts is typed as the copy it would serve (PNG from ffmpeg, JPEG from a HEIC or a raw's
  preview); `mediaProtocol` answers those with its own type before it reads the table, so on the wire
  only `.ico` changed.
  TIFF and JPEG XL stay viewable: the review found them dead, but they have decoded through the bundled
  ffmpeg since 2026-08-24 (`imageDecode.ts`; the bundled build lists `libjxl` and `tiff`). `mime.test.ts`
  fails on any image extension nothing can draw.
- **THE EXPLORER'S REFRESHES COST LESS** (owner, 2026-10-28: "do a review of the app look for bugs,
  lingering code that should be changed ... look for stall points, things that use up too many
  resources"; findings in research/prism/2026-10-28-performance-review.md). A refresh that brings a new
  file keeps a Date or Size sort: the answer that carried the old details says `carried`, and its new rows
  sort as the newest (no size: last) until their patch lands, where Downloads used to flip to A-Z and back
  (#3; `entries.test.ts`, `listingMerge.test.ts`). A watcher or focus re-read (`again`) skips the
  arrival's indexer and folder-size warm-ups, and the listing cache skips a write whose rows did not
  change (#10; `listingCache.test.ts`). The window's focus no longer re-reads a folder whose watch is up
  and read in the last minute (`FOCUS_TRUST_MS`, #10). A re-read with the same rows keeps the answer on
  screen, so nothing re-sorts (#18). A details patch is merged once, not twice (#11), and a details patch
  under Name/Type/Path, or a folder-size tick under any sort but Size, refills the rows in their order
  instead of sorting again (`sameOrder`/`refill`, #11 #20; `sortTiming.test.ts`). The viewer sorts its
  folder once per folder, not per arrow press (#21). Each tab's grants are counted by resolved folder,
  so the owner checks are lookups (#31; `desktopAccess.test.ts`). A running Everything, once found, is
  trusted for 5 minutes and forgotten when a query passes it over; none found is asked again after 30 s
  (#32 #42; `existingEverything.test.ts`). Drive names are re-read when the drive set changes, else
  hourly, and a refresh answers with the names it has while new ones load; one PowerShell answers names
  and kinds, run through `spawnWorker`; the places panel skips a render when the drives say the same
  (#33 #44 #51 #52; `driveUsage.test.ts`, `useDriveUsage.test.ts`). A preference write of this process
  no longer echoes through the folder watch into a re-read and a push (#45; `windowPreferences.test.ts`).
- **Image** viewer: fit / zoom / pan / rotate / fullscreen; common formats natively, HEIC/HEIF
  through a pure-JS libheif worker, and (2026-08-24) Targa, PCX, Photoshop, OpenEXR, DPX, SGI,
  DDS, PNM, JPEG 2000, QOI, Radiance HDR and X BitMap through `imageDecode.ts`, which asks the
  bundled ffmpeg for one PNG frame and caches it by path+mtime. Camera RAW (2026-08-24,
  `rawPreview.ts`) shows the full-size JPEG the camera embedded, found by scanning for the
  LARGEST JPEG in the file - which is what Explorer and every fast viewer show. It is NOT a
  development of the sensor data; that needs LibRaw, a native module Prism does not have.
- **Video** player: play / pause / seek / volume / fullscreen, frame-step, and a transport
  settings cog (2026-08-12): speed, loop, autoplay (next video in the folder, skipping other
  kinds), sidecar subtitles (`.srt`/`.vtt` matched by name beside the file or in `Subs/`,
  SRT converted to WebVTT; embedded MKV tracks deliberately out until a demuxer decision).
  Chromium ships no Dolby Digital (AC-3/E-AC-3), DTS or TrueHD decoder, so many MKV rips
  played picture-only. Prism DECODES THEM ITSELF (2026-08-24, owner decision to bundle):
  `vendor/ffmpeg` (BtbN's LGPL SHARED build, fetched by `tools/fetch-ffmpeg.mjs` against a
  pinned tag + SHA-256, never committed, ~128MB into `resources/bin`) feeds an `fsaudio://`
  stream that a hidden `<audio>` plays beside the picture. The trick is a FIXED PCM shape
  (48kHz/16-bit/stereo = 192000 bytes a second), so byte N is always second (N-44)/192000:
  Range requests are answered by starting ffmpeg at that timestamp, which makes a live
  transcode seek like a file - no temp files, no waiting. The video element needs no muting
  (it cannot decode the track either); the sidecar follows its clock and corrects drift by
  nudging playbackRate 2%. Codec choice is an ALLOWLIST of what Chromium plays, so an unknown
  codec gets decoded rather than silently lost. LGPL, not GPL, and shared, not static: the
  AC-3/DTS/TrueHD DECODERS are LGPL, and replaceable DLLs are what the licence asks for -
  which is also why the e2e fixtures encode with `libopenh264` (there is no libx264 here).
  The note that says Prism cannot help now appears only when no ffmpeg was found at all.
  The AUDIO player shares the decoder (2026-08-24) but not the syncing: with no picture to
  keep step with, the decoded stream simply IS the source (`useDecodedSource`), which is what
  makes Apple Lossless, WMA, AC-3, DTS, WavPack, AIFF, AMR and AU play at all. The container
  counts as well as the codec: Chromium has no demuxer for ASF, raw AC-3/DTS, AIFF or AU, so
  anything outside `CHROMIUM_CONTAINERS` is decoded whatever its codec says.
  Video is NOT decoded, and Prism now says which codec it cannot show (`No picture: ...
  (mpeg2video)`) instead of leaving a black window with working sound - MPEG-2, Xvid, WMV,
  Theora, ProRes and FFV1 all land there - EXCEPT that they are now CONVERTED instead
  (2026-08-24, `videoConvert.ts`): the file is turned into an mp4 once and played from the
  copy, so seeking, speed and subtitles all work afterwards. Most cost nothing to convert -
  a .flv/.m2ts/.vob usually holds H.264 and only its container is wrong, so the streams are
  COPIED - and only a genuinely undecodable picture is re-encoded (libopenh264, since the
  LGPL build has no x264). Copies live in `userData/converted`, LRU-evicted at 6GB. The
  "No picture" note is now only the fallback for when no ffmpeg is found at all. `.ts`/`.m2ts`/`.mts` stay unsupported, MEASURED not
  assumed: Chromium has no MPEG-TS demuxer for `<video src>` (picture missing, error banner up,
  though the AC-3 decoded fine), and `.ts`/`.mts` are TypeScript to the code viewer anyway.
  Sidecar `.ass`/`.ssa` subtitles are converted to WebVTT by ffmpeg (2026-08-24); their
  positioning and styling is dropped, because WebVTT cannot express it. The formats sweep of
  the same day added 74 extensions across `fileKind.ts` + `assoc.nsh`, every one of them
  opened in the app and checked before being claimed - including four (`.cr`, `.scm`,
  `.lisp`, `.el`) whose highlighter had shipped for months while the files refused to open.
- **Audio track picker** (2026-08-28, the video's right-click menu): a film
  with more than one track lists them ("English - AC-3 5.1", "Commentary -
  AAC stereo" - the file's own title, else the language, else a number), with
  Default ticked. Chromium exposes NO way to switch tracks on a `<video>`, so
  a pick is not a switch: the picture is muted and the chosen stream plays
  through the same fsaudio:// sidecar the Dolby path already runs on, on the
  video's clock. Per file, and it resets on the way to the next one. One
  track shows no picker, because a list of one is chrome.
- **Audio** player: play / seek / volume, a live circular visualizer, cover art, and the same
  settings cog (speed, loop, autoplay next track). Loop/autoplay/subs-wanted persist. MIDI is
  SYNTHESISED, not decoded (2026-08-24, `midi.ts`): a `.mid` is a score, so Prism bundles
  FluidSynth (LGPL) and the MIT FluidR3Mono soundfont, renders the file to a WAV once, and
  plays that. What you hear is the soundfont's reading of the score, which is what MIDI is.
  THE VISUALIZER AND THE PROGRESS BAR WEAR THE THEME (owner, 2026-10-27: "a color that fits",
  not necessarily the accent). Each of the 18 themes names a scheme (`MEDIA_SCHEMES` in
  `themes/catalogue.ts`; light themes get schemes with no pale stops), a theme switch sets both
  to it, and one set to follow the accent keeps following. A pick of your own stands until the
  next switch. `theme.test.ts` holds it.
- **Office and ebook documents** (2026-08-24, kind `doc`): `.docx/.docm` via mammoth, `.odt/.odp`
  by walking the ODF XML, spreadsheets via SheetJS (one table per sheet), `.pptx` as its slides
  in order (slide10 AFTER slide2, which zip order does not give), `.rtf` by a brace walker (a
  regex leaves `{onttbl{0 Arial;}}` in the middle of the letter), and `.epub` along the
  SPINE rather than zip order. A reading view, not Office: no editing, no layout fidelity.
  Every one is converted AND SANITISED IN MAIN against an allowlist before it reaches the
  renderer - no script, no handlers, no iframe/form, images only as the converter's own data:
  URIs, and no links at all, because the window it lands in can reach `window.prism`.
  **A SPREADSHEET IS A GRID, NOT A PAGE** (owner report, 2026-10-26, #437): a 10-column report
  ran off the paper onto the dark canvas (dark ink on near-black) and wrapped every cell word by
  word. A workbook now drops the paper and draws what Excel shows (`src/main/sheetHtml.ts`):
  column letters and row numbers pinned while scrolling, the file's own column widths
  (characters x 7 + 5 px), one line per row, text running on over EMPTY neighbours and clipped
  by full ones, numbers and dates right-aligned, solid fills (light ink on a dark one), merges,
  hidden rows and columns skipped, capped at 5000 rows x 200 columns with a note. Widths and
  fills travel as `<col width>` / `<td bgcolor>` held to a pattern by the sanitiser, never as a
  style. Held by `sheetHtml.test.ts`.
- **PDF / document** viewer: first-party pdf.js viewer (2026-08-08): continuous canvas pages,
  zoom/fit, text selection, own Ctrl+F (no Chromium PDF UI). The zoom baseline is rebased
  (2026-08-12): 1.9 pdf.js units is the default and the pill calls it 100%. Markdown renders formatted
  (react-markdown, sanitized inline HTML, remote badges).
  **MARKDOWN IS ONE LIST** (2026-10-12, structure cleanup): `.md`, `.markdown`, `.mdown`, `.mkd`,
  `.mkdn`, in `src/shared/fileKind.ts` (`isMarkdown`), read by the viewers, the archive panel,
  the phone and main's image grants alike. Before, the viewers knew two and main's grants seven,
  one of them `.mk`, which is a Makefile. Not `.mk` and not `.mdx` (JSX inside): both stay plain
  text. The three new ones are registered by the installer too; `fileAssoc.test.ts` holds the
  parity and `fileKind.test.ts` the list.
  **LINKS GO SOMEWHERE** (2026-08-31, `lib/pdf/pdfLinks.ts`, pure and tested), and the
  allowlist is the feature. pdf.js has already thrown the ACTION NAME away by the time the
  display side sees an annotation: a /URI, a /Launch at an executable, a /GoToR and a
  recognised /JavaScript window.open all arrive as the same `data.url` string. So the rule
  is by SHAPE - a Link subtype carrying none of action / attachment / attachmentId /
  setOCGState / resetForm / actions, and then either an http(s) url or a dest. `unsafeUrl`,
  the raw string out of the file, is never read by anything. ftp:, mailto: and tel: pass
  pdf.js's own filter and are refused here too, because openExternal drops them and a
  clickable box that does nothing is worse than no box. They render as `<button>` boxes,
  never `<a href>` - an anchor is what routes into main's window-open handler, which had NO
  scheme check at all until this change (it does now, and `will-navigate` is guarded too).
  The boxes are PERCENTAGES of the page, so the annotations are fetched once per page and
  never again on a zoom step, and the layer is z-index 2: above the text layer's 1, below
  the pill's 10 and the find bar's 20. An internal /XYZ destination lands at its own
  y-coordinate rather than at the top of the page - a footnote link that jumps to the top
  of page 312 reads as broken, not as approximate.
- **Code / text** viewer (2026-08-17): CodeMirror 6, always editable (see below). ~20 Lezer
  grammars give highlighting, folding and real syntax-error squiggles; `@codemirror/legacy-modes`
  adds ~100 stream lexers for highlighting only, so those languages never claim an error.
  Deliberately no semantic diagnostics: without a tsconfig or node_modules they would be noise.
  Every language loads on demand (one Vite chunk each). Prose (`.txt`, `.log`, `.csv`, subtitles)
  gets no gutter and no language. Token colours are the THEME's since #298 (`--p-code-*`).
  **JSONC COMMENTS ARE COMMENTS** (#312; owner, 2026-10-07: "comments in jsonc arent read as
  comments in prism"): the strict JSON grammar made every // line plain text under a squiggle.
  `.jsonc`, `tsconfig(.*).json`, `jsconfig(.*).json`, `.eslintrc(.json)`, `.babelrc(.json)`,
  `(.)devcontainer.json`, `wrangler/turbo/biome/deno.json` and every `.json` in a `.vscode`
  folder go to `lib/code/jsoncMode.ts` (a tokenizer with the JSON grammar's own tags, comment tags,
  brace folding) and `codeLint.jsoncErrors` (comments and trailing commas blanked to spaces,
  offsets kept, then `JSON.parse`), so a missing comma is still underlined. `.json5` colours the
  same with no linter (bare keys and single quotes). Plain `.json` stays strict. `jsonc` e2e.
  **A FILE THAT GROWS** (2026-08-31): "Follow the file" appends new bytes as they are
  written - a build log, an agent's transcript - and a file PAST THE 64MB CEILING now shows
  its TAIL (2MB) instead of an apology. Both are READ-ONLY, and structurally so: a followed
  file keeps no `saved.current` at all, which is the ref `save()` checks, so nothing has to
  remember to test a flag. That matters because the editor's one update listener treats any
  document change as the user typing - an appended chunk would star the file in the tree and
  arm "Save all changes" on the way out, which is how a partial tail gets written over a
  900MB file. Appends are kept out of the undo history too (Ctrl+Z would otherwise un-grow
  the log). The watching is `src/main/fileTail.ts`: an offset, a 500ms poll and a read of
  exactly the new bytes, never sync, with a STREAMING decoder because a chunk boundary can
  fall mid-character, and a RESET when the file gets SHORTER - a rotated log is not new
  bytes to splice on. `TEXT_MAX_BYTES` is untouched; the tail is a separate read-only path.
  **HEX** (`lib/hexRows.ts` + `HexView`): a file Prism cannot interpret is still one it can
  read, so `UnsupportedView` grew its one button. A page at a time over a Range request
  against `fsmedia://`, so it costs 4KB whether the file is a header or a 4GB ISO - the
  renderer never holds it. Paged rather than scrolled on purpose: a continuous hex view of a
  big file is a 268-million-row virtualized list, which is a viewer, not a panel. The tree
  HIDES unviewable files, so the only route to that screen is Windows handing the file over.
- **Comic books** (2026-08-31, `.cbz`/`.cbr`, kind `comic`): a page list wrapped around the
  IMAGE viewer, so zoom, pan, rotate, fullscreen and the picture menu all come for free. Its
  own kind and deliberately NOT `archive`: widening `archiveOk` would put Extract all, Add
  files and member Delete - the one permanent delete in Prism - onto a book. Read-only, both
  formats. **LEFT AND RIGHT TURN PAGES** (owner decision) - no longer an exception, since
  2026-09-01 those keys are nobody's navigation: Up/Down reach the next book, and the Ctrl
  modifier that used to buy the folder back is retired with the rule it worked around. The container is unpacked ONCE into `userData/comics`, LRU-evicted at 2GB: a page
  turn then costs what showing a jpeg costs. Per-page extraction was the obvious design and is
  the one the performance rules forbid - adm-zip reads the whole container synchronously per
  call, and the 7-Zip route spawns a process into a fresh temp directory per member (~278ms),
  neither of which is a page turn, and both of which leave temp directories nothing removes.
  Because every page lives under ONE directory, the media wall grants that directory rather
  than growing `extractedPaths`, which is a Set that never shrinks. Page ORDER is numeric
  (`shared/comicPages.ts`, pure and tested): real comics are numbered 1, 2, 10 as often as
  001, 002, 010, and a plain sort puts page 10 second - which is the archive panel's own bug,
  not to be copied. `ComicInfo.xml`, `__MACOSX/` forks and `Thumbs.db` are not pages, so the
  filter is positive: it is a page if Prism calls it an image. Position is remembered like a
  PDF's.
- **Archives beyond zip** (2026-08-24): `.7z .rar .tar .gz .tgz .bz2 .xz .iso .cab` open
  READ-ONLY through a bundled 7-Zip (`sevenZip.ts`; `tools/fetch-7zip.mjs` expands the official
  MSI with `msiexec /a`, 7z.exe + 7z.dll because rar lives in the DLL). The panel offers view
  and copy and nothing else on those; zip keeps every verb. A member name is validated BEFORE
  extraction, never after: checking afterwards only says where a file was SUPPOSED to land.
- **ZIPS ARE FOLDERS** (#300; owner, 2026-10-06: "make zips seem like ordinary folders, they keep
  the icon but you open them like any other folder but you get the zip relevant right click menu
  options. this would work the same in project mode", then of the mockup: "I like the look for
  zip files, use that"). Spec, plan and decisions: `docs/superpowers/specs/2026-10-06-zip-as-folder-design.md`;
  mockup `research/prism/2026-10-06-zip-as-folder`. A place inside an archive is ONE Windows path
  (`C:\x.zip\Wind\src`): a history entry, a tab's path, a crumb, a row, like any folder.
  MAIN decides which segment is the container, by a stat of the candidates named like an
  archive (`shared/archivePlace.ts`, `main/archiveBrowse.ts`): a FOLDER named `x.zip` stays a
  folder, and a path with no such segment costs no stat. Every archive kind browses this way;
  7-Zip formats, a zip over adm-zip's cap and a NESTED archive (unpacked to temp, max 4 deep)
  are read-only. The listing carries `ArchiveMeta` (strip, Packed column, crumb icons, menus)
  and every folder's total (no `folder:size` on a virtual path). A container is parsed once and
  kept (path + size + mtime); a zip over 64 MB lists and unpacks through 7-Zip (MEASURED: ~25 ms
  a listing, against holding the whole file). A MEMBER opened or previewed goes through
  `MemberGate`: `archive:member` unpacks just it under `%TEMP%\prism-members\<pid>-<launch>`,
  granted to READS as a directory, never to a write; removed at process exit, dead runs at
  the next start, 2 GB cap while running; 256 MB auto-preview limit. Review of #300: unpacks
  run two at a time, NEWEST first (arrowing fired one whole-container read per row); a nested
  archive over 1 GB or past the temp drive's room refuses (`nest-big`); a locked archive's
  names never go to the listing cache on disk; a folder gone from a zip REPLACES the history
  entry (a push made Back bounce forever); drops from Windows carry `external` everywhere. Members are READ-ONLY
  (CodeView `readOnly`, no pencil, the note bar with Extract here in full view and projects).
  Menus are `lib/archiveMenus.ts` (pure, tested, the `zipMenus` e2e compares): left out ON
  PURPOSE are Rename on a folder inside (file-only `renameMember`), Open with on a member (an
  app would save into a temp copy), and Paste into a zip. Cut/Paste are inert inside. The tree
  draws an archive as a folder node (`treePaint` `zip`), its members with the archive's menus.
  The old panel (`ArchiveView`) is the PHONE's alone now; the desktop shows `ArchiveCard` for an
  archive's own row. E2E: `zipFolder`, `zipMenus`, `zipWrites`, `zipProject`, `zipRestore`,
  `zipLocked`; the old archive scenarios drive the Explorer through `inZip`.
  GOING INTO A FOLDER CLEARS THE PREVIEW (review of #300; owner, 2026-10-06, of a zip whose card
  stayed in the pane beside its own contents: "the double view"). An Explorer that moves to
  another folder or into a zip (double-click, Enter, crumbs, Back/Forward/Up, places, address)
  drops the file on display (`tabs.ts` `leaveShown`); a pane that was open stays open at its width
  as `PreviewEmpty` ("Select a file to preview", `browse.previewHeld`, renderer only), a shut one
  stays shut, nothing is previewed on its own, and a project keeps its open file. `previewClears` e2e.
  COMING BACK OUT OF A ZIP SHOWS IT AGAIN (#334; owner, 2026-10-09: "when you go back again you
  should see the zip in the preview since the main view is now just a different folder"): Back,
  Up or a crumb to the folder holding it marks the zip (the way out) and, with the pane on, its
  card returns (`lib/wayOutPreview.ts`, judged once per arrival in `useFolderBrowsing`). Only the
  way out, only a file row: out of a folder the pane stays empty. `zipPreviewBack` e2e.
- **Archive viewer** (2026-08-22, #68; since #300 the PHONE's only, the desktop's is above): open a `.zip` onto its manifest - the archive's own
  SYSTEM icon (the user's association, via app.getFileIcon, one fetch per extension; the
  amber parcel is only the loading/no-handler fallback, its picker deliberately removed),
  name and totals, with the members in a panel that FILLS the window (2026-08-25: it
  used to be a 560px box adrift in the space, and read as a fraction of the app).
  The panel scrolls, the page does not. Rows are EXPLORER COLUMNS under a header
  (2026-08-25, owner pick): name, type ("HEIC image", "TypeScript source" - what Prism
  will DO with it, not Explorer's "HEIC File"), size (folders say "3 items"), packed size
  with the saving as a minus percent, and the entry's own modified time. The narrow
  columns drop out on a small window; the name never does. Navigation is Explorer-shaped:
  clicking a folder walks INTO it, the crumb row (fixed height, so the panel never jumps)
  or Backspace climbs out - no collapsible tree, and NO hover quick-verbs (tried twice,
  rejected twice). A VERB ROW under the archive's name (2026-08-25) carries what you come
  to an archive to do: Extract all (main's own dialog picks where, which IS the consent -
  it is why that destination is not bound by the root wall - and the contents land in a
  folder named after the archive, "name (2)" if one is there), Add files (zip only), Copy,
  Rename (handed up to App, which owns renaming), Show in Explorer. Row verbs stay on the
  right-click menu + F2/Delete: view (extracted to a temp file main
  grants individually, shown with the ordinary viewers), copy out (real clipboard), rename,
  delete. Member delete is the ONE permanent delete in Prism (a zip has no Recycle Bin) and
  the dialog says so. Passwords: asked once per archive and remembered; ZipCrypto opens via
  adm-zip, AES members go through a DETECTED 7-Zip (7z.exe at its standard install paths,
  args-only execFile - the same enumerated-exe rule as "Open in"), and without 7-Zip they
  say so honestly. zip only; 7z/rar containers are out until a fresh decision. Oversized
  archives (>600MB) list but refuse WRITE operations.
  **A BIG ZIP IS READ THROUGH 7-ZIP** (2026-08-31): the 600MB ceiling is ADM-ZIP's, not
  zip's - it reads the whole container into memory - so a 1.9GB zip used to list (by reading
  1.9GB into main) and then answer "failed" to every extract, drag and copy, which is the
  worst of both. A zip past the cap now takes the same read-only 7-Zip path a .7z does: it
  lists in 88ms (MEASURED on a 1.9GB, 796-file zip) and extracts fine, and simply has no
  write verbs. Writes keep the cap, because they are still adm-zip's. Extract-all follows
  the ONE-FOLDER RULE: an archive whose whole content is a single top-level folder - what
  every "download as zip" produces - hands that folder up rather than burying it under
  another named after the archive, done by MOVING after extraction so the
  never-write-over-a-folder rule survives. **Extract here** is a one-click verb needing no
  dialog (the archive's own folder is already inside a root, so there is nothing to consent
  to); **Extract to...** keeps the dialog, which IS the consent that lets it write anywhere.
  Both sit on the verb row and on the panel's own menu, and a FOLDER row offers Copy folder
  and Extract folder here - its Copy used to extract the members one at a time and put the
  loose FILES on the clipboard, so you right-clicked one thing and pasted a flat pile. The
  "Extract folder here" stages BESIDE THE ARCHIVE, not in temp: it finishes with a rename, and
  `fs.rename` CANNOT CROSS VOLUMES - it throws EXDEV. Temp is on C: and the archive very often
  is not (an X: drive of comics is what found it), so every extract onto another disk failed
  AFTER 7-Zip had done the work, and said nothing useful because the failure was the move
  rather than the extraction. Staging on the destination's own volume makes the rename
  same-volume and instant whatever the folder weighs; a copy fallback catches EXDEV anyway.
  The clipboard copy still stages in temp, because nothing renames it anywhere.
  A FOLDER comes out in ONE 7-Zip call, never one per member (2026-08-31): the member-at-a-time
  route spawns a process each, and each one RE-OPENS the container, so "Extract folder here" on
  a 2GB archive was hundreds of full re-reads and simply failed. MEASURED on that archive: the
  25-file folder came out in 279ms and the 561-file one in 1.2s, against hundreds of spawns.
  Dragging a folder OUT works the same way now - one call into a staging folder, then each
  wanted entry moved into place - which is where the landing rule lives (the shape BELOW the
  dragged folder is kept, the parents above it dropped). That staging folder is INSIDE THE
  DESTINATION since 2026-09-19 (#166), a dot-named `.prism-extract-*` the tree's listing and
  watcher both skip, and the landing is a RENAME: it was in temp with a `cp` across, which is
  a second full write of what 7-Zip had just written and a copy nothing can stop half way,
  and the extraction has a Cancel button now. The copy survives as the fallback for a rename
  that is refused. The member filters come from the
  archive's own listing and are still refused for `..` or a drive letter before 7-Zip is
  spawned, because `-o` is the only thing keeping the write inside a folder Prism made.
  7-Zip path reports its own percentage, and getting it to say ANYTHING was measured rather
  than assumed: with `-bsp1` alone and stdout redirected 7-Zip prints nothing at all between
  "Extracting archive" and "Everything is Ok", because it suppresses the progress indicator
  when its output is not a console. `-bb1` (log each file) is what brings both the names and
  the percentages back, so it is the PAIR that works and neither alone; a file COUNT out of
  the listing's total is the fallback for an archive of a few huge members. Exit code 1 is
  7-Zip's WARNING, not a failure - treating it as one threw away a working extraction - and
  a real failure now carries 7-Zip's own line up to the extraction window, because "couldn't
  be extracted" on its own is a failure nobody can act on. The percentage is read only at
  the START of a line (2026-09-19): the member's name arrives on a line of its own, and a
  member called "50% off.jpg" was a percentage as far as the old anywhere-match could tell. `-p` is omitted entirely when there
  is no password, since `-p` with nothing after it is an EMPTY password rather than none.
  All of it matters because a window saying nothing for the minutes a 2GB archive
  takes is indistinguishable from one that has hung. **A ZIP RECORDS ITS FOLDERS OPTIONALLY** and plenty of writers
  leave them out (Google Takeout, `zip -D`, most Java tooling), which made such an archive
  read as EMPTY: the panel lists one level at a time by matching each member's parent, and
  every member's parent was two levels down with nothing naming those folders.
  `shared/archiveTree.ts` fills them in from the member names, pure and tested, applied to
  BOTH readers' output because what the container says is the problem. Member order is
  NUMERIC now too, the same hoisted collator `dirList.ts` uses: a plain localeCompare put
  "issue 10" before "issue 2", which for an archive full of comics was the whole listing in
  the wrong order. The crumb row is CHEVRONS with the folder you are in in full contrast and
  semibold (2026-08-31): it was all one grey with `/` between, which read as a sentence
  rather than as a path you can click back along. Rows are ZEBRA-striped, and the stripe is
  `color-mix(in srgb, var(--p-text) 3.5%, transparent)` rather than a fixed grey - Prism has
  custom styles, so it has to hold on void, on an accent-tinted ground and on anything built
  later, and mixing against the TEXT colour gets the direction right by construction. The
  FIRST row is the plain ground and the second is the stripe (owner pick, 2026-08-31, after
  seeing it the other way round). The
  crumb row ends in a chevron at EVERY level, the current folder included: chevrons only
  BETWEEN segments read as a separator between two names, and the trailing one is what makes
  the row read as a path. Rows run EDGE TO EDGE with no radius, so the stripe and the
  selection fill reach both borders rather than floating as tiles in a gutter - the scroller
  gives up its horizontal padding and the rows carry the inset themselves, at the same px-4
  the column header uses, so the columns still line up.
  **ONE EXTRACTION WINDOW, FOR EVERY WAY OF EXTRACTING** (2026-09-19, #166). Owner: "When
  you extract something, the progress bar works differently based on like how you extracted
  ... there are so many options to extract, and some use different methods. I would like it
  to just be one kind of view that appears, and I want it to be a pop-up window that you
  can't close, kind of like it is with WinRAR, where you just see the progress bar, and you
  just have to wait until it's done extracting." Asked the same day: it gets a CANCEL
  button; no X, and Escape and a click outside do nothing. This SUPERSEDES two recorded
  decisions and keeps a third. Superseded: the in-layout progress track that was "ALWAYS in
  the layout and only fades in" (2026-08-31, itself removed 2026-09-03), and the JOB CHIP
  extractions ran on from 2026-09-03, which was chosen so you could keep working past a long
  job - the owner has now chosen the opposite for this one verb. Pastes and adding to a zip
  stay on the chip; `lib/jobs` is otherwise untouched. KEPT: finishing raises NO popup
  (2026-08-31). Success closes the window silently, there is no second dialog, and the
  verb row's button still says "Extracted" for two seconds.
  There were five routes and three looks (a chip with a percentage, a chip with none, and
  NOTHING AT ALL for members dragged onto a sidebar folder). Now MAIN tells the story and no
  route draws anything: every route that writes extracted files to a folder the user can see
  (Extract here, Extract to..., the panel's and the tree row's menus, a folder row's Extract
  folder here / to..., a member row's pair, the drag) opens a job in `src/main/extractJob.ts`,
  and the job is the one thing that speaks on ONE channel, `extract:event` (start, progress,
  end: `shared/extraction.ts`). The job starts AFTER main's own folder dialog is answered,
  which is why the start has to come from main. The renderer has one listener, one PURE
  reducer (`lib/extraction.ts`, tested) and one window (`ExtractWindow`, mounted beside App).
  The temp extractions that VIEW a member or put one on the clipboard open no job and stay
  silent. Progress is REAL on both engines: 7-Zip's percentage, the file count as its
  fallback, and the member being written (`readFileName`, out of the same `-bb1` log); for
  adm-zip a count of members written. That needed the adm-zip loop made ASYNCHRONOUS:
  `getData` inflates on main's thread, so no progress got out and no Cancel got in until it
  was over. A deflated member is inflated on the libuv pool now and CRC-checked as adm-zip
  checks it - and NOT through adm-zip's own `getDataAsync`, read rather than assumed: its
  inflater attaches no 'error' listener, so one corrupt member is an unhandled 'error'
  event that takes the app down.
  IT CANNOT BE DISMISSED, in three layers, because any one alone leaks: the scrim swallows
  the mouse; `#root` goes `inert` (so the window is a portal on `body`); and `inert` stops
  focus but NOT keystrokes, which still reach the window-level listeners - Ctrl+W would
  close the tab, Delete would bin a file - so `lib/extractionGuard` swallows them. It is
  installed BEFORE React renders, because listeners on one target run in the order they were
  added and `stopImmediatePropagation` only reaches the ones behind it. Focus lands on the
  BOX, not on Cancel: the verb is often picked with Enter, and that key must not cancel what
  it started. AND IT IS BROUGHT BACK TO THE BOX AT EVERY CHANGE OF PHASE (found in review the
  same day): Cancel and Close are two keyed elements, so a failure arriving while the focus
  was on Cancel dropped it onto `body`, where the guard swallows Tab, Enter and Space alike,
  and the error could be closed with a mouse and with nothing else. A window up for under 700ms lingers, full, for the remainder - a small zip
  extracts inside a frame, and the chip met the same thing on 2026-09-03.
  CANCEL WAITS AND THEN CLEANS. `kill` returns before the handles are gone (the `holders.ts`
  lesson), so main waits for 7-Zip to CLOSE, the adm-zip loop checks a flag between members,
  and the window says it is cancelling until main reports the end. What is removed is what
  `Made` recorded and nothing else: a staging or landing folder that is the job's whole, a
  file the job wrote under a name that was free, and a folder the job created - with
  `rmdir`, which refuses one that holds anything. A cancelled extraction never costs a file
  that was there before. A FAILURE keeps what came out, as it always has, turns the SAME
  window into the error with 7-Zip's own line, and only Close removes that; a refusal main
  will not even start (the wall) opens the window straight into its error, since the callers
  show none of their own any more. One visible extraction at a time, refused in main as well.
  **THE WINDOW IS AN OPEN SHEET** (#336; owner, 2026-10-09, picking B of round 2: "clean, fits
  every theme, minimal text": the bar, the percentage, one live line naming the file being
  extracted right now, WinRAR style, and Cancel; mockups in
  `research/prism/mockups/2026-10-09-extract-dialog/round2`, round 1 beside it). Only the LOOK
  and the words changed; every rule above stands. No title and no caption: the archive is the
  box's `title` and its `aria-label` ("Extracting X to D"). Top row (40px): the number, 34px at
  weight 400 with a small `%`, blank until the engine speaks; Cancel at its end. The bar is a
  12px WELL, the widest and thickest thing (fill `--p-accent-solid` on `--p-control`, a
  `--p-dim2` inset edge, corners `var(--p-radius)`, no pulse). Under it the file line (UI face,
  tabular figures, 18px fixed), fitted by canvas measure in the MIDDLE so the member's own name
  stays (`fitPath`). Cancelling: the line says Cancelling and Cancel dims. Failed: "Couldn't
  extract" takes the number's place, the well keeps where it stopped HATCHED in `--p-dim` (never
  orange: Sand's warn ink is its accent's hue), the line is the reason alone (`failureText`), and
  Close is `--p-sel-bg` with `--p-on-accent`. 20px top and bottom. Main's 60ms progress cap is
  the throttle. `extractCancel` samples the box and the well every 25ms through a run (they never
  change), and writes `extract-sheet-*.png` (running in Aurora and Sand, failed in four styles).
  **7-ZIP ASKS FOR A PASSWORD ON STDIN, AND WAITED FOR EVER** (2026-09-20, found reviewing
  #166, MEASURED on 7-Zip 25.00). A 7z whose CONTENT is encrypted but whose names are not
  (the common case) lists without a password, so nothing fails early; extracted with no `-p`,
  which is how Prism says "no password", 7-Zip prints "Enter password (will not be echoed):"
  and reads stdin, which for a Node child is an open pipe nobody writes to. It sat there for
  the hour the timeout allows. Before #166 that was a chip that never finished; under #166 it
  was a modal window over the whole app with a bar that never moved, and the archive panel's
  own password question was never asked, because the 'password' answer it waits for never
  came. Every 7-Zip run has its stdin CLOSED now, so the prompt reads end-of-file and 7-Zip
  stops at once ("Break signaled"), and `sevenFailReason` reads the prompt, matched whole, as
  a password being wanted. The e2e drives both engines through it: the verb row shows the
  window's error with the password sentence, and a member row's verb closes the window
  quietly, asks, asks again on a wrong answer, and extracts on the right one.
  The e2e's big archive is slow by CODEC, not by size, MEASURED: 800MB of stored random data
  extracts here in 534ms, which is a race; 160MB of base64 packed with PPMd, whose decoder is
  as slow as its encoder, takes twenty seconds whatever the disk does. Built once under
  `.e2e/big`. Found on the way: "Extract folder to..." handed over each member's path, so the
  landing rule flattened the folder into a pile of files; it names the folder now. Properties on a zip reports what it
  holds, how much it saved, and its encryption (2026-08-22).
- **Folder navigation**: from the opened file, page through sibling viewable files (arrow
  keys). The navigation-scope filter (all / group / per-type, 2026-07-31) was REMOVED
  2026-08-20: a forgotten filter read as missing files. Do not reintroduce it without a
  fresh decision. A sort menu sits in the sidebar header (2026-08-12, Playnite-shaped: one
  asc/desc pair, then name / date modified / size / type); tree rows and arrow-paging share
  the order. Documents own their
  vertical keys: Up/Down and PageUp/PageDown scroll or flip pages in pdf/text.
  **LEFT AND RIGHT ARE NOT NAVIGATION** (2026-09-01, owner decision, overturning the older
  rule that they always paged the folder). App does not handle them at all: nothing is
  preventDefaulted and they reach whichever viewer is mounted, WITH NO CLICK FIRST, which is
  the point - a viewer that wanted them used to have to be focused, and the kinds that did
  want them had to be carved out of App by hand. A video or a track SEEKS five seconds
  (`useMediaControls`, video and audio alike); a comic turns a page. Every other kind gets
  them and does nothing, which is the intent: a PDF was offered them and refused (owner,
  same day), because Up/Down and PageUp/PageDown already flip its pages once it is focused.
  The folder is paged with Up and Down. **FOCUS decides the vertical keys, for every kind, and nothing
  auto-focuses a document any more** (2026-08-17): opening a pdf, a README or a code file
  takes no focus, so Up/Down and PageUp/PageDown keep paging the folder while you browse from
  the sidebar. Click into the document (or Tab to it) and it owns them: the pdf flips pages,
  the page scrolls, the caret moves. Escape hands them back without closing the window.
  Documents mark their scroller `data-doc-scroller`; `docFocused()` in `hooks/useAppKeys.ts` is
  the single test, and there is deliberately no kind-based DOC set any more. A window-level key
  listener in a viewer (PdfView's page keys, CodeView's Ctrl+S/Ctrl+F) must check focus itself.
  **IN FULL VIEW A DOCUMENT KEEPS UP AND DOWN, AND THE STEPPING IS THE LIST'S ORDER** (owner,
  2026-10-28, an Excel workbook: "the arrow keys up and down navigate files while you're in it which it
  should not", "with the excel sheet in full view up goes down and down goes up", and keyed through it
  "brings my pc to its knees"; scope: all documents). Changes the 2026-08-17 rule for FULL VIEW only: a
  `doc`, `pdf` or `text` file in full view takes the first Up or Down itself (`useAppKeys`, `DOCUMENTS`):
  its scroller is focused and scrolls a line, and the keys are its own from then on. From the list
  (preview beside it) nothing changed. The slowdown was the arrows hopping file to file in Downloads,
  each opened in full view (a video, a PDF, a HEIC conversion, the workbook converted again on every
  pass): measured on the workbook itself, keyed scrolling inside it is light (no long frames, CPU near
  0). And full view stepped by the old viewer sort (`prism.sort`, name) while the list showed its own
  (Downloads newest first), so Down was not the next row: `App` now orders the viewer's files by the
  list's sort (`browsing.sort`, the same `sortFiles` the list uses). e2e `docArrows` (fails on the old
  code).
- **Search has operators** (2026-08-28, `shared/searchQuery.ts`, pure and
  tested): every word must match, in any order (`holiday 2024` finds
  "2024-06 holiday", which one substring never could), `"two words"` is a
  phrase, `*.mp4` and `img_??.jpg` are globs over the WHOLE name, `ext:mp4`
  is the extension, and `-raw` leaves those out. A bare `.mp4` stays a plain
  substring on purpose - it is what someone looking for "photo.mp4.bak"
  typed. A query of nothing but exclusions matches nothing, because that is a
  folder listing with a hole in it, not a search. The box's tooltip is where
  this is taught: a placeholder cannot hold five lines and a help panel in a
  viewer's sidebar is chrome.
- **File tree sidebar** (`Ctrl+B`): collapsible panel rooted at the folder Prism was opened in;
  expand subfolders, click a file to view it. The root is a wall: main refuses paths outside it.
  **THE TREE DRAWS ONLY THE ROWS IN VIEW** (2026-09-28; owner: "i click and it takes like 3 seconds
  for it to react"). MEASURED: Temp open in the tree was 47,816 rows, 382,000 elements, and a 1.2 s
  renderer block on every folder switch. `lib/treePaint.ts` flattens the tree into fixed-height rows
  (notes included), `TreeWindow` mounts the ones in view plus `OVERSCAN`, and anything that scrolls
  to a row does it by INDEX (`showRow`), since an offscreen row has no element. Opening a folder fades
  its rows in; the old slide needed every child mounted. `bigTree` e2e holds it (20,000 files, under
  200 rows in the page). Never make a tree row taller than `size.row` or of varying height.
  **Keyboard-navigable (2026-08-17)**: the arrows drive a cursor over the flattened visible rows
  (`fileTree.visibleRows` / `stepRow`, pure and tested), folders included. Up/Down step every
  row and walk into expanded folders. **UP AND DOWN ONLY** (2026-09-01): Left/Right used to
  mean previous/next FILE here and to be the chevron on a folder row, and both went with the
  rule above. A folder still opens and closes from the keyboard with ENTER, which is the row
  button's own activation and never went through the tree's nav. Landing on a file opens it, landing on a folder
  only moves the highlight. ONE mark, not two: the filled accent belongs to the cursor and
  follows it onto folders; the open file is deliberately left unmarked while the cursor is
  elsewhere (`aria-selected` still names it). The cursor row is the tree's single tab stop (roving `tabIndex`),
  so Enter and Space are the row button's own activation, with no key handling for them
  anywhere. Sidebar lends the whole thing to App through `onNav`, returning false when there is
  no tree to drive (panel shut, search showing, end of tree) so App pages the folder instead.
- **Rename + delete from the tree** (F2 / Delete / right-click, files and folders, decided 2026-08-01).
  Nothing is destroyed: deleting and overwriting both go via the Recycle Bin, a taken name asks
  (cancel / replace / keep both), and names are validated first. The session root itself can never
  be renamed or binned.
- **Context-menu verbs** (2026-08-12): "Open in" (a submenu of the apps Windows registers for that
  extension, from the registry, plus the Windows chooser; main only launches exes it enumerated
  itself), Show in File Explorer, Copy path, Copy file (real clipboard drop via PowerShell),
  Duplicate (Explorer-style "name (2)" naming).
- **Text edits in place** (2026-08-17, replacing the 2026-08-12 edit mode): every text file is
  simply editable where it sits, Ctrl+S to save. The pencil now belongs to **markdown alone**,
  the one kind with a rendered form to toggle away from; code and `.txt` have none, so a mode
  switch there was meaningless chrome. **Unsaved text lives in App, keyed by path**
  (2026-08-18), not inside the editor: leaving a file keeps it, so switching files asks
  NOTHING and coming back shows your edits rather than what is on disk. Every dirty file is
  starred and bold in the tree, not just the open one. The only thing that can destroy the
  work is closing, so only closing asks: main mirrors the renderer's dirty flag and blocks
  `win.on('close')` until the user answers **Cancel / Discard / Save all changes** (which
  covers Alt+F4 and the taskbar, not just the X). A failed write cancels the close and names
  the file rather than closing over the top of it.
  **Undo and redo** (2026-08-22, `lib/undo.ts`, pure and tested): Ctrl+Z / Ctrl+Y (and
  Ctrl+Shift+Z) reverse Prism's own file writes - move, rename, bin, duplicate - and a
  quiet pill says what went back. Undo NEVER asks and never overwrites: it puts things
  beside whatever appeared meanwhile ('keep-both'), and a binned file comes back through
  the shell's Recycle Bin namespace (MoveHere, not the localised Restore verb). Behind the
  typing guard, so a focused editor and the terminal keep their own Ctrl+Z. Archive-internal
  writes are deliberately NOT on the stack (a member delete is permanent anyway).
  Prism's writes are therefore: rename, bin,
  duplicate, the editor's save, and the archive's member verbs (rename/delete inside a
  zip, 2026-08-22). Anything further (move, new folder) is a fresh decision, not a
  natural next step - except NEW FOLDER, decided 2026-10-07 (#330, Ctrl+Shift+N, see THE
  COMMON FILE KEYS), and MOVE, which was decided (2026-08-22, #70) and is reachable
  ONLY by dragging: a row (or a whole multi-selection) dropped on a folder row moves there,
  taken names asking cancel / keep both / replace. THE FOLDER DROPPED INTO becomes the marked
  row (2026-08-31): what you dragged has left, so a mark on it points at nothing, and clearing
  it points at nothing either - the destination is what you are now looking at, and where the
  arrows carry on from. It has to survive the refresh the move itself triggers, which
  otherwise clears every mark; that is one piece of STATE and not a ref, because the reset
  reads it while rendering. EXCEPT that TWO FOLDERS OF THE SAME NAME
  MERGE (2026-08-31). They are one folder with more in it, which is what every file manager
  does; asking there offered either a second copy of a whole tree or the destruction of one.
  The merge is recursive, so a same-named folder one level down merges too, and the question
  survives only for the FILES inside - scanned depth-first BEFORE anything moves, so 'ask'
  still reports the lot and leaves the disk untouched. `moveOne` creates the parent it is
  moving into, which is what makes UNDOING a merge work: the folder those files came out of
  no longer exists. The emptied source goes with `rmdir`, not `rm` - `rm` refuses a directory
  without `recursive`, and `recursive` would delete exactly the leftovers a partial merge is
  trying to preserve. And a drop that asks for nothing DOES nothing, silently: putting a
  folder back where it already was is how anybody changes their mind mid-drag, and it was
  answering with the wall's "a tab's own folder cannot be moved" about a move nobody
  requested. Filtered in main before the wall check. The same drag crosses surfaces: sidebar
  rows dropped INTO an open archive are added to the zip at that folder, archive members
  dropped on a sidebar folder are extracted there (sharing the archive's remembered
  password via `lib/archivePass`), members dropped on an archive folder move inside the
  zip, and files dragged from EXPLORER onto the archive panel are added to it. Folders
  travel whole on every route. Rebuilding a password-protected zip is refused rather than
  risked (adm-zip would re-emit those entries wrongly), and dropping on the window at
  large still just opens the file. Multi-select WAS that fresh decision too (2026-08-22): shift ranges and
  ctrl toggles select WITHOUT opening, in the tree and the archive alike (drag-to-select
  was tried and REMOVED the same day: dragging is for moving, and the sweep's pointer
  state outlived real drags); right-click inside a multi-selection acts on all of it (copy
  files, copy paths, delete N with one question). The tree KEEPS its quick-look single
  click for FILES - one click opens one. A FOLDER selects on the first click and expands on
  the SECOND (owner decision, 2026-08-31): it is a drop destination, a rename target and what
  "Open terminal here" acts on, so pointing at one without walking into it is worth a click.
  That NARROWS the 2026-08-22 rule rather than reversing it - what was tried and rolled back
  then was double-click-to-OPEN, which still does not exist. The chevron still expands on the
  first click, being the one control whose whole job is the folder's state. The ARCHIVE stays
  double-click, where single click selects. Contiguous selected rows fuse in the TREE (shared
  edges drop their rounding); the archive's rows are square and edge to edge, so there is
  nothing there to fuse.
  Search results speak the same selection language, multi right-click included.
  DRAG-SELECT came back for the ARCHIVE alone (2026-08-25): it starts only on the
  panel's DEAD SPACE, so a row drag (which moves members) can never leave a phantom
  band behind - the failure that got the tree's sweep removed - and its listeners
  die on pointerup and pointercancel alike. A press on dead space, or anywhere
  outside the rows at all, CLEARS the marks in both surfaces: highlighting says
  "these are what I am about to act on", so it must not outlive walking away from
  them. What stays marked is the OPEN file, which is marked for being open.
  THE SWEEP CAME BACK FOR THE TREE AND THE EXPLORER (#257; owner, 2026-10-03: "let me
  highlight files by holding down left click ... that transparent quadrant"). Built ONCE
  (`hooks/useSweep.ts`, pure half `lib/marquee.ts`): a press on a row's BLANK space (right of
  its name, other columns included) or under the rows draws the rectangle; a press on a
  chevron, icon or name is still the row's click and drag. Plain replaces, Ctrl adds, Escape
  puts back, auto-scroll at the edges. Rows are hit by INDEX (both lists are virtual). It
  cannot outlive a drag: it starts only from a real left press, ends on up, cancel, blur,
  Escape or any move with the button up, and switches the row's `draggable` off for the
  press. The Explorer gained MULTI-SELECT with it (Ctrl and Shift clicks too; Copy, Cut,
  Delete and a drag act on all; Open, Rename and More act on one and are off). The
  Explorer's MEDIUM row is the tree's default row (`rowLook()` in `treePrefs`). The `marquee`
  e2e measures both; a drag in a test is taken by the row's NAME, since a locator's centre is
  blank space. **THE BOX MARKS ONLY WHAT IT TOUCHES** (#326; owner, 2026-10-07: "only the ones
  that are inside it, even if that's a px"): a row is hit when the rectangle overlaps it ACROSS
  and down (`rowsInBox`), the row's across part being what is DRAWN (the Explorer's row ends at
  its last column, measured off a row in view), never the scroll box. `marqueeEdge` holds it.
  **IN THE EXPLORER THE WHOLE ROW DRAGS, THE ARROW STAYS, AND THE BOX STARTS ONLY OFF THE ROWS**
  (#320; owner, 2026-10-07: "when you left click drag an item dont switch the cursor to the hand,
  keep it the normal cursor ... the whole row should let me left click drag ... that drag should
  only be from empty spaces either under or beside the file row"). This narrows #257 for the
  Explorer's list (the tree keeps its rule): a press ANYWHERE on a file row (any cell, any gap)
  is its click and drag, never a sweep; the sweep starts under the last row or BESIDE the rows.
  For "beside" a row is as wide as its columns (`width: fit-content`), Name grows only to
  `--browse-name-max` (440px, Large 520px; search's Path to `--browse-path-max`) instead of the
  rest of the width, and a `--browse-gutter` (32px) on the right is always blank, so even a
  narrow list has a place to start one; the header keeps the same grid and gutter, so its labels
  stay over the row's cells, and its LAST cell's box still runs on to the header's right edge
  (`--browse-col-edge-end`; the 2026-10-04 "no strip a hover cannot fill" rule).
  **A CLICK THEN A SWEEP IS ONE BLOCK** (owner, 2026-10-12: "I clicked to select one file then I
  drag selected the ones over it and ... the first file is selected but disconnected from the
  rest, they should all be connected"; asked, chose that it joins). A plain sweep keeps the one
  row just clicked (the whole selection, or in the tree with none the lit open file) when it
  TOUCHES the swept rows (beside or inside them; one far away is dropped, as in Windows), so it
  joins the swept rows, shares their square edges and the verbs act on all of it; marks a sweep
  made are not a click, so a second plain sweep still replaces them, and Ctrl still adds
  (`lib/marquee.ts` `sweepBase`, unit tested; `marquee` and `marqueeQuiet` e2e).
  A click beside the rows clears the marks like the space under them. During an internal drag
  every element's cursor is pinned to `default` (`internalFileDrag.ts`; it was `grabbing`).
  The `marquee` e2e measures the gutter and the header, sweeps from beside, drags from the Size
  and Date cells (label up, no rectangle, `default` cursor under the pointer, on html and body).
  **THE BOX IS UNDER THE POINTER IN EVERY FRAME** (#332; owner, 2026-10-08: "fast movements make
  it fall behind the cursor, while it should stay at the cursor position perfectly the whole
  time, file explorer's highlight does it perfectly"). The box was React state, so the list
  rendered it AFTER each frame was painted. MEASURED (`sweepLag`, 300 rows, CDP moves of 25-40px):
  before, every move's first frame was a move behind (up to 54px, mean 23px, list and tree), and
  every auto-scroll frame was off (up to 430px Explorer, 203px tree); after, 0px in all of them.
  So `useSweep` only mounts the band (`sweeping`, `bandRef`) and the pointer handler writes its
  place straight onto it from geometry read at the press, at the sweep's start, after a scroll
  or resize (`ResizeObserver`) and at the release (`measure`), never per move; marks are worked
  out once a frame in the tick, and again on the release, so the marks that stand are the box's.
  The band mounts through `flushSync` in the move that starts the sweep: a plain state update
  from a native listener painted that frame with NO box (MEASURED, `sweepLag` counts such a
  frame as late). Do not put the box back in React state.
  **ON WINDOWS 11 THE BOX IS DRAWN NATIVELY** (#338; owner, 2026-10-09, after #332 still trailed
  zoomed in: "it totally does happen even when not [zoomed]"; he chose the native overlay over
  leaving it, reversing #332's "declined"). Explorer's `UIMarqueeSelector` is about one frame
  behind the hardware cursor, Chromium's path two to four (research `prism\2026-10-08-explorer-
  marquee.md`); the web-side attempts are TRIED AND REVERTED (b5f0517, b1c5014), do not redo them.
  Prism's own N-API addon (`native/sweep/`, its README has the rules) puts a TOPMOST
  DirectComposition visual on the window's own HWND and draws the box from `GetCursorPos` every
  compositor frame on its own thread; main (`src/main/sweepOverlay.ts`) decides per window and
  forwards; `useSweep` sends begin / update / end (anchor, clip, dpr, the band's colours; never per
  move) for a MOUSE sweep and keeps the DOM band mounted and placed but `display: none` only while
  main has said `native: true`. Hit testing, marks, auto-scroll and Escape stay in the page, so
  the marks now trail the box by Chromium's frames (accepted). The cursor is sampled LATE, 1000 us
  before the next tick: MEASURED (research `prism\2026-10-09-native-sweep-spike.md`, injected, 1x)
  0.26 to 0.31 frames behind the pointer at every speed, File Explorer 0.72 to 0.86, the DOM box
  1.06, sampling at the tick 1.15; owner by eye under Wind, 1500 us "not quite there", 1000 us
  "seems like it works". More than 14 commits under 100 us before the tick in 1440 up-frames widens
  the lead 250 us at a time to 2000 us, then it samples at the tick. Anchor delays K: auto 2,
  wheel 0, resize 2 (not measured). FALLS BACK to the DOM box, automatically and with no
  setting, when: the addon is missing or fails to load, no `DCompositionWaitForCompositorClock`
  (Windows 10), Remote Desktop, a pen, `--e2e`, `--sweep-overlay=off` (diagnosis only), a failed
  target or HRESULT, or a thread that stops moving (500 ms watchdog); one diagnostics crumb
  (`sweep-overlay`) per change. THE THREAD NEVER CALLS INTO JS (PrismTerminal #127's quit abort),
  the `std::thread` is never destroyed joinable, and it is joined at will-quit and at exit
  (50 of 50 offscreen quits with a box up exited 0, `tools/sweep-latency/addon-check.mjs`). The
  `sweepOverlay` e2e holds the page's contract (under `--e2e` main records instead of drawing);
  the drawing is on the PR's hands-on list. Known and accepted: square corners, and an in-page
  layer over the list (a toast, a tooltip) is now UNDER the box, which the clip keeps inside the
  list's visible rows.
  **MARKING IS NOT PICKING** (#263; owner, 2026-10-03: "when you multiselect like this it picks
  a file so here this drag starts one of the videos ... same is the case if i ctrl select it
  shouldnt start or preview anything"). In the Explorer a sweep and a Ctrl or Shift click call
  `browsing.select(path, true)`, a QUIET select: it moves the tab's selected path (the
  keyboard's place) and nothing else, so the preview keeps its file, nothing plays or pauses
  and a shut pane stays shut. A plain click and the arrows preview and play as before. The
  `marqueeQuiet` e2e holds it with four films.
  **EXPLORER SIZE IS A SETTING** (owner, 2026-10-03: "let the current be medium the old be
  big, and make a slightly smaller version too"). Settings > Explorer > Explorer row size
  (`lib/explorerSize.ts`, `prism.explorer.size`, unknown reads Medium): Small 22px / 11.5px /
  12px icon, Medium (DEFAULT) 26 / 12.5 / 14, Large the pre-#257 Explorer, 40 / 15 / 18 with
  its old padding and columns (`[data-row-size='large']` in browse.css). The Explorer's list
  ALONE: the tree keeps Font size. `explorerSize` e2e.
  **THE PLACES PANEL IS THE THEMES MOCKUP'S** (#296; owner, 2026-10-06: "i really like the
  sidebar from here, so use that, with the icons and the disks with a bar showing how much is in
  use"). Quick access is the pins that ARE a Known Folder (`BrowseShortcut.known`), each with its
  line glyph (`PlaceIcon`), Home by the user's folder name; Pinned is every other pin (hint when
  empty); then Projects; then This PC: name as File Explorer writes it ("Local Disk (C:)"), used /
  total in `--p-accent-solid` on a faint track, "N free of M" in `formatBytes`. **THREE DRIVE
  STYLES** (owner, 2026-10-06, of the mockups in `research/prism/2026-10-06-drive-rows`: "option A,
  D and E as options in settings, with A being default"): Settings > Explorer > Layout > Drive
  style (`drive-style`, `prism.sidebar.driveStyle`, `lib/prefs/driveStylePrefs.ts`), Tiles (A, DEFAULT:
  a tile, glyph in a chip, % on the name line, a pill bar), Ring (D: two lines, a donut with the %)
  and Gauge (E: 20 steps, free left, total right). `DriveRow.tsx` + `drive-rows.css`, measures in
  em of the row text so they follow Explorer row size. From 90% used (`nearlyFull`) the mark is
  `--p-warn` and its number `--p-warn-ink` (theme.ts, floored 3:1 and 4.5:1 on the panel); the
  system drive (main's `system`) wears the Windows badge, a removable one the USB glyph. Under
  `--e2e`, `PRISM_E2E_DRIVE_USED` puts the system drive at that share used. Still
  ONE pin store and order: a pin moves (menu or drag) only within its own section. Sizes come
  from main (`driveUsage.ts`, `browse:drives`): `statfs` per drive, 1.5 s cap, a drive whose call
  is still out is not asked again; labels from ONE PowerShell CIM query, only when the drive set
  changes or after 10 minutes. The page asks when the panel mounts, on focus (30 s apart) and
  every 3 minutes (`useDriveUsage`). Headings are semibold, a step under the rows' text, so the
  heading baseline nudges were measured again. `sidebarPlaces` e2e.
  **THE COLUMN HEADER IS FILE EXPLORER'S** (#274; owner, 2026-10-04: the hover "should be inside
  the whole box"; Size's name "aligned to the left"; the arrow "shows only when you hover over
  them while the currently sorted item has an arrow at all times"). The header keeps the rows'
  grid; each cell reaches out by half `--browse-col-gap` each way and the end cells by the row
  padding, so the cells tile it edge to edge (a narrow layout that hides a column re-points the
  last cell). Size VALUES stay right-aligned. The arrow is always in the layout and only fades,
  so a label never moves. Focus is the fill, no box. `columnHeaders` e2e.
  **DOWNLOADS IS NEWEST FIRST, IN FILE EXPLORER'S DATE GROUPS** (#285; owner, 2026-10-04: "make
  the downloads folder in prism in the explorer not have that folders first rule, just like file
  explorer ... or do it like file explorer"). Only the Known Folder (`BrowseShortcut.known`, what
  `app.getPath('downloads')` resolves), never a folder by its name. A sort nobody picked there is
  Date modified, newest first (`lib/downloadsView.ts`); a header click sets `sortChosen` and is
  remembered like any folder's, and Downloads' own sort never travels to the next folder. By Date
  modified (either way) files and folders MIX, the name breaking a tie, under quiet one-row label
  dividers (`.browse-divider`, aria-hidden; each row carries its group as `aria-description`); any
  other column is the ordinary folders-first view, and a search is never grouped. The groups are
  calendar ones, MEASURED in File Explorer on this machine (Windows 11 26200, read back over UI
  Automation): Today, Yesterday, Earlier this week, Last week, Earlier this month, Last month,
  Earlier this year, A long time ago (and Tomorrow ... Sometime in the future), the week starting on
  the user's iFirstDayOfWeek (`main/weekStart.ts`); `lib/dateGroups.ts` holds the rule and the
  evidence. Folders now carry `mtimeMs` (details stream, listing cache `folderTimes`), and the rows
  move once, when every date is in. Explorer's within-group files-before-folders is NOT copied.
  `downloadsDate` e2e (`PRISM_E2E_DOWNLOADS` points the Known Folder at a fixture, e2e only).
  **DRAGGING A PANEL EDGE PAINTS, IT DOES NOT RE-RENDER** (owner, 2026-10-12: "the UI is very
  unresponsive like when I'm dragging the left sidebar or the right sidebar with the preview ...
  very choppy, very laggy"). Every move of a grip used to keep the width in React state, which
  re-rendered the whole App (every tab, the list, the preview) and wrote localStorage: 42 to 54
  times in a half-second drag, MEASURED by the `panelDrag` e2e. Nor may a move change the width
  VARIABLES: on the workspace, an inherited custom property restyles every element under it with
  all the theme's variables, 62 to 68 ms a frame (a trace of the owner's own drags: 4.8 s of
  style recalculation in 7.8 s). A move now writes plain pixel widths onto the few boxes that show
  them (the Explorer's grid, the preview pane, the viewer's places, the two grips), once per
  frame (`useExplorerWidths` `live`); the release keeps the width once and hands the boxes back
  to the variables. Restyling over a drag fell from 719 and 761 ms to 23 and 34 ms in the e2e,
  the longest frame from 28 to 7 ms. Keys and double-click are unchanged.
  **THE LIST'S SCROLLBAR SHOWS ONLY WHILE IT SCROLLS** (owner, 2026-10-12: "i think prism
  wakes when your cursor is on that panel but i wanna change that too to only show when
  actually scrolling"). `browse/OverlayScrollbar.tsx`, Prism's own 4px bar (#267's "the
  scrollbar is too distracting"): a scroll or a wheel shows it, 900 ms of stillness fades it,
  and the pointer resting on the list no longer wakes it. The pointer on the bar itself, while
  it shows, and a drag of its thumb hold it up. `listScrollbar` e2e.
  **EVERY SCROLLBAR IS THE LIST'S** (owner, 2026-10-27: "the sidebar scrollbar should be more
  minimalistic all scrollbars should be the same. the one on the main view of the explorer is
  pretty good so reuse that"). `OverlayScrollbars.tsx`, mounted once in `renderApp.tsx`, catches
  every scroll on the document and draws the same bar (same classes, now in `index.css`) over
  whatever scrolled, vertical and horizontal; native bars are hidden while it is mounted
  (`p-overlay-scrollbars`). `data-own-scrollbar` opts out: the file list (its own), the address
  crumbs and the drive legend (no bar on purpose). `listScrollbar` e2e scrolls the places panel
  and finds the bar on its edge; `lib/overlayScroll.test.ts` holds the arithmetic. QUIETER AND FLUSH
  (owner, 2026-10-28: "still not subtle enough and its not on the edge ... theres a small gap"): the
  thumb is 3 px at 16 % (5 px at 32 % under the pointer), with no inset; the e2e measures the gap as 0.
  SAFER AND CHEAPER (performance review, 2026-10-28): a bar that unmounted under the pointer, or a drag
  the system cancelled (`pointercancel`, lost capture), left the bar held shown and every other scroller
  ignored for the window's life; now an empty measure clears hover and drag, and cancel ends a drag like a
  release. Menus and popovers no longer close on a press on the bar (`data-overlay-scrollbar`,
  `onOverlayScrollbar` in `useDismiss` and `ContextMenu`), so a scrolled menu's thumb can be dragged. An
  axis whose style is `overflow: hidden` gets no bar (`scrollsByStyle`). A scroll that moves only the thumb
  writes its offset to the thumb; React renders only when a track changes (`sameTracks`).
  `overlayScroll.test.ts`; `listScrollbar` e2e checks the thumb follows and a hidden box gets no bar.
  **THE ADDRESS AND THE SEARCH ARE ONE FIELD** (#267; owner, 2026-10-04: "make the url box more
  visible and for the black theme make the grey colours used in search and in the url bar darker
  grey"). Both wear `.browse-field` (`--p-field`, `-edge`, `-edge-hover`, `-hint`). On a ground
  MEASURED darker than #121212 (`lib/fieldColours.ts`) the fill is a 2.5% step (Void #060606, was
  #080808) and a 3:1 edge carries the box; every other style keeps --p-control and --p-divider.
  The placeholder is held to 4.5:1 on the field. `addressField` e2e.
  **NO ACTION ROW, A DOLPHIN ADDRESS, SEARCH IS A POPUP** (#267; owner, same day, showing KDE
  Dolphin and PowerToys Run: "remove our quick action buttons ... the search field should be a
  search icon only that displays a search pop up on click like this but centered on screen and
  blurred background behind ... the url bar in the image looks really clean too so copy that
  style ... a show more which essentially does a normal search like before"). The Explorer's
  Open / Open as project / Copy / Rename / Delete / "..." row is GONE; every verb is the row's
  right-click menu and its key (Enter, F2, Del, Ctrl+C/X/V), and the list has the height
  (`explorerVerbs` e2e proves each). Toolbar: back, forward, up, refresh, the address field,
  a terminal's own buttons when the tab has one, the preview toggle, the search button. The
  field: a chevron LEADS every name, the current folder bold, a long path keeps its end and
  fades its start. Search: the button or Ctrl+F in the Explorer (an editor's or a shell's
  Ctrl+F is theirs) opens `BrowseSearchPopup`, portalled, centred, the help popup's blur and
  no shadow. Main's SAME search in its own slot (`browseSuggest`, `suggestSlot`, 3 s) so it
  never stops the list's, keeping the BEST 200 by `nameRank`, not the first 200 (review of
  #268: the walk now spends its whole budget, and the index is asked for 5000 by name and
  ranked in main, so `test.ts` is not lost behind 200 `*.test.ts`); `shared/searchSuggest.ts`
  ranks the likely 8 (whole name, start, a word's start, inside; then nearer, folder, shorter).
  Focus stays in the combobox, and a press anywhere in the popup keeps it there (a press on the
  magnifier once sent it to the page, where Ctrl+T opened a tab underneath); nothing is marked
  until the arrows, and every edit of the field takes the mark away; Enter on a marked row opens it (a folder is gone into), Enter on
  nothing or Show more or Ctrl+Enter runs the list's full search, "Clear search" in the status
  line ends it. ONE LAYER: it does not open over a modal and leaves (for good) on a question,
  the update window, Settings, another tab or folder; App ignores keys from inside it
  (`data-search-popup`). The `searchPopup` e2e runs with `PRISM_E2E_INDEX_ROOT` elsewhere, so
  it searches by the walk: the e2e's private index did not list fresh files for 60 s (MEASURED).
  **A SEARCH IS A PLACE IN THE HISTORY, AND GOING SOMEWHERE ENDS IT** (#281; owner, 2026-10-04:
  "if you click something in the sidebar you're not in search anymore, but if you click back arrow
  you go to the search list again"). The query once lived on the folder's history entry, so a
  sidebar place for the folder searched (or a revisit of it) came back filtered. Now
  `searchBrowseState` (`lib/browse.ts`) pushes an entry with the query; any navigation, the same
  folder included, lands unfiltered and never takes a search's scroll; Back restores the results;
  Clear search steps back to the plain entry (Forward returns). `searchNav` e2e.
  **A MARKED FILE IS A TINT, A CHOSEN PAGE IS SOLID** (owner, same day: "more transparent like
  selecting files in file explorer" for files, "more saturated" for the settings page).
  Explorer, tree, sidebar search and archive rows wear `--p-sel-tint` (`hi` at 22%, stepped down only
  where a name would fall under 4.5:1 or a quiet column under 3.2:1) with a faint
  `--p-sel-line` edge round the BLOCK (`lib/markedLook.ts`, `data-join-up/down`), and keep
  their own text and icon colours (no on-accent ink, no monochrome icon fallback). The
  chosen card uses `--p-accent-solid`, which does not move with the accent's alpha; the
  Settings rail's chosen page is a GREY fill since #292 (`--p-sel-solid` went with it). Quick access's current place wears the tint too. `theme.selection.test.ts`,
  `markTint` e2e. The menu's grey
  row is unchanged (its icon's knockouts are its own grey). THE TINT IS NOT FLATTENED UNDER
  GLASS, on purpose: it carries no label of its own, only the row's ordinary text, which sits
  on the same glass marked or not, and a flattened tint is the opaque slab the owner rejected.
  **THE SELECTION IS ITS OWN COLOUR** (owner, 2026-10-03: "the settings accent colour for the
  tab should be separated from the explorer accent colour ... called something like selected
  item colour"). Style row **Selection** right after Accent (Primary, Secondary, Accent,
  Selection, Text, Folder icons), the core picker with alpha (min 10%): the pick's colour and
  alpha ARE `--p-sel-tint` everywhere the tint is used (`Style.selection` / draft `selection`,
  six or eight hex, `cleanColour` on load, kept by a saved style). UNSET is `hi` at 22% byte
  for byte and the picker shows that; nothing is stored until a pick, and picking the shown
  value back is no edit. A pick past the floors (names 4.5:1, quiet columns 3.2:1) keeps its
  hue and loses strength (`selectionTintAlpha`'s `start`). The Accent keeps the buttons and
  progress. The edge is SOFTER: `TINT_LINE` 0.28 (was 0.5; "the border contrast is slightly
  too much"), scaled with a picked strength up to 0.5 (`tintLineAlpha`). The SWEEP BAND (the
  Explorer's and the archive's drag box) wears it too, as Windows' does: `--p-sel-hue` /
  `--p-sel-hue-hi`, which unset are `--p-accent` / `--p-accent-hi` exactly.
  `theme.selectionColour.test.ts`, `markTint` and `styleColours` e2e.
  **NO STRIPES IN THE EXPLORER** (owner, same day: "try no alternating row bg for explorer"):
  every `.browse-row` is the plain ground. The archive view keeps its zebra (`p-zebra`).
  ARRIVING NEVER SELECTS (2026-09-22, owner: "no file should be selected when I haven't
  clicked any ... either because I clicked it or it's the current file displaying, or I've
  navigated onto it with the arrow keys"). In the Explorer, walking into a folder by a sidebar
  place, a crumb, Up, Back or Forward marks nothing, and in particular not what an earlier visit
  selected - the subfolder you had come out of used to come back marked. The ONE exception is
  the file on display (preview pane or full view), marked when you arrive at its folder
  (`browse.ts` `arrivalMark`). Order and scroll are still remembered; the arrows start at the top.
  NARROWED 2026-09-23 (#204, owner: "say you navigate admin -> documents -> claude, then you use
  backspace to go back ... when you move back to documents, the claude folder should be
  highlighted, when you go to admin, documents should be highlighted"): arriving at the DIRECT
  PARENT of the folder you were in (Back or Up) marks that folder, and the arrows carry on from
  it. Going in, Forward, and a jump anywhere else still mark nothing; the file on display wins.
  A RIGHT-CLICK SELECTS, AS FILE EXPLORER DOES (#296, owner, 2026-10-06: "sidebar items should
  also get highlighted also the discs. but currently its highlighted grey on the main view, not
  the accent/highlight color ... i see file explorer uses the same highlight if you select a file
  with left or rightclick. we should probably do the same"). SUPERSEDES the grey menu mark below
  (2026-08-31, #204) in the Explorer list: a right-click on an unmarked row makes it THE selection
  (quiet, #263: no preview, no play), in the one selected look (`--p-sel-tint`); inside several
  marked rows all stay. A place (pin, project, drive in Tiles/Ring/Gauge; `data-menu`) and a
  project tree row (`onMenuHl`) wear the same tint while their menu is open, without becoming
  current or selected. Still no ring. `rightClickSelect` e2e measures it on a dark and a light style.
  THE SIDEBAR MARKS ONE PLACE, AS FILE EXPLORER DOES (#296, owner, 2026-10-06: "when you right click
  a sidebar item different from the currently selected one there should only be highlighting on the
  right clicked item ... in file explorer it works like this when you're in a subfolder from the
  sidebar, i think its based on whether you clicked the pin first then went from there ... the
  sidebar item gets fully highlighted when you click it but as soon as you click something in the
  main view after that it gets dimmed, still highlighted but dimmed"). Before, every place whose
  path equalled the folder wore `aria-current` (a pinned project lit two rows, a subfolder none).
  Now `lib/placeMark.ts`: the place CLICKED (FolderBrowser's `chosenPlace`, also Open from its menu)
  stays marked while the folder is it or beneath it, and is forgotten once the folder leaves it;
  otherwise the first place whose path IS the folder; else none. `aria-current` is on that row
  alone. While a menu is open on ANOTHER place the mark is DIMMED, not hidden (`data-mark-dim`;
  owner, 2026-10-06: "think it would look better if the selected folder is dimmed rather than not
  highlighted when you right click a different folder"), drives' tiles included, and only the
  right-clicked row is full. NO FLASH BETWEEN RIGHT-CLICKS (same message: "when you right click
  multiple times the highlight goes from the one you right clicked -> the actually selected folder
  -> the new one you right clicked"): `ContextMenu` closed on the right PRESS outside it, and
  Windows sends `contextmenu` on the RELEASE, so every frame of the held button had no menu. A
  right press outside now closes the menu in the capture phase of the `contextmenu` that opens the
  next one (or 400 ms after the release if none comes), for every ContextMenu, the project tree's
  too. `rightClickSelect` records every animation frame across a second right-click. A MENU IS
  ABOVE EVERY PANEL (owner, 2026-10-27, a screenshot: the address bar's menu over the preview had
  the preview's text drawn on it and the text caret over its rows): `ContextMenu` renders into
  `document.body` through a portal, out of the opener's stacking context. `menuOverPreview`
  checks every row is what the pointer hits at its centre. Two
  strengths (`useActiveArea`, `data-active-area` on `.folder-browser`; a press or focus, menus
  excluded): full `--p-sel-tint` while the sidebar is where the user acts, `--p-sel-tint-dim`
  (the tint drained toward its own grey at `SEL_DIM` of its strength, held in
  `theme.selection.test.ts`) once they act elsewhere. The list's selection dims the same way while
  the sidebar is active, File Explorer's inactive selection. `rightClickSelect` measures all of it.
  A COLLAPSED PANEL PEEKS AS QUICKLY AS FLARE'S SIDEBAR (owner, 2026-10-27: "flare has a very good
  balance prism is a bit too unresponsive ... the time it takes to hide when the cursor is not over
  the sidebar"). `lib/sidebarPeek.ts` takes Flare's `reveal.rs` numbers: 60 ms on the edge opens it
  (was 150), it goes 100 ms after the pointer leaves (was 300), and the panel counts 4 px past its
  own box (Flare's KEEP) so a graze does not start the close. The 6 px strip and the 180 ms slide
  stay Prism's. `sidebarPeek.test.ts`; e2e `explorerSide` holds the hide under 450 ms (286 measured).
  THE PLACES PANEL SLIDES ONLY WHEN IT IS TOGGLED, AND A TAB SWITCH SLIDES NOTHING (#204, owner,
  2026-09-23). Both panels animate their width (180ms) only while App's `panelSliding` is true,
  for one slide after a toggle (`slidePanel`); the places column keeps its contents at their open
  width while it slides. The project `Sidebar` sits behind every tab and is shut on an Explorer
  tab, and one FolderBrowser serves every tab, so any other width change (a tab switch, a drag,
  a window resize) lands at once.
  (SUPERSEDED 2026-10-06, #296, above; kept for the history.) A RIGHT-CLICK NEVER SELECTS (2026-08-31): the row it was opened over is the
  menu's target and is marked in GREY (`menuPath`), not in the accent - the accent means
  "these are what I am about to act on", and the menu already acts on the row you opened it
  over. Marks elsewhere are dropped for the same reason: right-clicking row A while B and C
  are marked leaves the verb going to A, and marks claiming otherwise are lying. Right-
  clicking INSIDE a multi-selection still acts on all of it.
- **THE DRAG LABEL HANGS OFF THE POINTER'S BOTTOM RIGHT, ATTACHED** (#310; owner, 2026-10-07: "when
  you pick up an item with left click drag the label is to its bottom left but also not attached to
  the cursor ... it should be attached and it should be from the bottom right"). The label is an
  IN-PAGE element (`lib/drag/internalFileDrag.ts`, which cancels the native drag so Ctrl+Tab still works),
  not a drag image, so it is placed in CSS px from the pointer and the display scale never enters.
  It sat its whole width LEFT of the pointer and 12 px below. `lib/drag/dragBadgePlace.ts` puts its
  top-left corner 8 px right of and below the tip (File Explorer's way: the pointer never covers the
  name), flipping to the other side only where the window edge leaves no room. One rule for every
  drag the hook carries: tree, Explorer list, several items, places. The `dragLabel` e2e measures it
  mid-drag at 100%, 150% and 225% (`--force-device-scale-factor`). **WHAT HANGS THERE IS THE ROW**
  (#327; owner, 2026-10-07: "when i pick up an item i wanna pick up the row, essentially not just a
  label, so i want the icon and so on"; then, asked: the row as it looks SELECTED, only its icon and
  name; several items show only the row pressed on, with a count). `lib/drag/dragRow.ts` builds it from the
  source row's own DOM and computed style: the icon beside the name (never the tree's chevron), the
  row's height, side padding, gap and font, the `--p-sel-line` edge, and the tint composited on the
  SOURCE row's own ground (the first opaque one up from it: the list's, the sidebar's), so it matches
  the marked row in every style (`--p-sel-tint-seen` only where no ground is opaque); never the type,
  size or date, nor an unsaved file's `*`. Several items: a small count (`--p-sel-bg`,
  `--p-on-accent`) on its corner, never "N items"; an unmarked row pressed carries itself alone. Move
  or Copy is a small line OUTSIDE the placed box (absolute: under the row, over it at the window's
  bottom), so the row never jumps as a target toggles. The same `dragLabel` e2e holds it, comparing
  the carried row's PIXELS with the marked row's, in Aurora and Paper (`drag-row-*.png`).
- **SETTINGS CONTROLS ARE NEUTRAL; ONLY SAVE WEARS THE ACCENT** (#202; owner, 2026-09-23: "i dont
  want settings buttons to be affected by the accent colour... grey based on the bg colour ... same
  colours as the drop down menus"; "the only ones to keep accented are the save buttons"). The
  Switch (on: `--p-text-soft` track, `--p-bg` knob), the pressed Segmented option and the row
  buttons (Default apps, Clear) are the terminal core's own `fields.tsx` since #292 (PrismTerminal
  #42 holds them there), and no page keeps a copy. Selection marks (style cards, swatches) and
  Reset links are not buttons and keep the accent; the chosen rail page is grey since #292.
  `settings/settingsControls.test.ts` holds it. **EVERY SWITCH IS THE CORE'S** (#318; owner,
  2026-10-07: "toggles differ in look i like the teal with black not the green and white", then
  "it should depend on the theme so only teal on the teal theme"): the Win+E row (once its own
  accent-and-white exception), the phone server switch and the player menu's toggles use the
  core's `Switch` or its `SWITCH_ON` / `SWITCH_KNOB_ON`, and no file outside the core draws a
  `role="switch"`. The LOOK is the core's call: from core 0.26.0 (PrismTerminal #139) an on switch
  is `--p-sel-bg` with an `--p-on-accent` knob. The `settingsLook` e2e holds every switch on the
  Explorer page to one track and one knob colour when on.
- **NOTHING WEARS A FOCUS BOX; FOCUS IS THE HOVER'S FILL** (#272; owner, 2026-10-04, of a white box
  round the title bar's menu button: "remove the focus effect. go through the ui and remove focus
  effects like this"). `index.css`'s base-layer rule takes Chromium's ring off every focused
  element but a text field, and lays the `--p-hover` fill over a focused control (button, tab,
  menu row, option, switch, link) as a background IMAGE, so a filled button keeps its colour under
  it. A text field shows focus as its edge going a step lighter (or its own accent edge), never a
  ring; that rule is in the UTILITIES layer, since a `border-[...]` class beat it from base. A
  state that paints a control (an Explorer mark, an inline style) sets `background-color`, never
  the `background` shorthand, which wipes the fill; a slider takes `--p-hover-hi`. The `moreMenu`
  e2e compares each probe FOCUSED AGAINST UNFOCUSED (a field, a slider, a swatch, a segment): a
  check that it merely "has a fill" passed with no focus showing.
  No `focus:ring` / `focus-visible:outline-*` class, no `:focus` outline in a stylesheet:
  `noFocusRings.test.ts` reads the renderer for both. Drop targets and selection marks (a
  swatch's ring) are not focus and keep theirs. prism-term-core's own rings (UpdateChip,
  UpdateDialog, HelpPanel, ThemeSwitchAsk, ColourPicker, fields) are the core's to change.
- **THE TITLE BAR'S MENU IS THREE DOTS, AND IT TOGGLES** (#272; owner, same message: "clicking this
  button opens the menu each time, it should open then close open close", and "the icon should be
  a 3 vertical dot menu where will have multiple things, remote just being one of them"). More
  (`data-more-button`, where Tools was), Phone its first row. `ContextMenu` takes the `anchor`
  that opened it and does not count a press on it as outside: dismissing on that press made the
  click reopen it. Opened by Enter or Space (`detail === 0`) the first row takes the focus, Up and
  Down walk the rows, Escape gives the focus back; App's key handler yields plain keys to a focused
  menu row. The `moreMenu` e2e clicks it four times, in both title-bar layouts, and walks it by key.
- **TAB WIDTH IS A SETTING** (#216; owner, 2026-09-23, asked in Prism Terminal (#56 there) and
  agreed for Prism: "a setting for tab width, where the user can pick fixed size or dynamic").
  Then: "put the option closer to the top of appearance, and call it dynamic ... have dynamic be
  the default". It was the FIRST row of Settings > Style; since the grouped cards (#292, the
  owner's approved v1) it is in Appearance > Window, after Show title bar
  (`lib/tabs/tabWidthPrefs.ts`, `prism.window.tabWidth`, the same key and words as Prism Terminal's):
  **Dynamic** (the DEFAULT, by the owner's word, so the strip fixed since 2026-09-21 goes back to
  dynamic with this update: each tab as wide as its name, capped at 14rem) or **Fixed** (every tab
  114px). The `tabs` scenario measures the default, picks Fixed, and puts Dynamic back.
- **UNDER --e2e NOTHING OPENS OUTSIDE THE APP** (#222; owner, 2026-09-24: "make sure that future
  runs don't do that in my real browser", after a run opened four example.com tabs). Every web
  link goes through `openLink` in main, which under `--e2e` records it on
  `globalThis.__e2eOpenedLinks` and starts nothing; the Default apps deep link is skipped too.
  `termMenuCopy` clicks a printed link for real and asserts it was recorded.
- **"COPIED" AT THE BOTTOM CENTRE, AND A THIN THEMED TERMINAL SCROLLBAR** (#215; owner,
  2026-09-23, asked in Prism Terminal (#54, #52 there) and agreed for Prism). The core's
  `CopiedBadge` is mounted once in App; every terminal copy (Ctrl+C over a selection, the menu's
  Copy and Copy link) goes through the core's `copyText`, which raises it only once the clipboard
  has the text. xterm 6 scrolls with its own slider, but its sheet left the viewport a second,
  EMPTY native bar; `index.css` takes it away and makes the slider 6px and round (its colours
  come from the core, off the theme). `termMenuCopy` measures both.
- **THE TERMINAL MENU FITS WHAT WAS CLICKED** (#210; owner, 2026-09-23, asked in Prism Terminal
  (#44 there) and agreed for Prism: "if i click it on a link it shows copy link, if i click it with
  text marked it says copy"). `TermDock`'s menu leads with Copy link over a link and Copy with text
  marked, from the core's read-only `termContextAt`, both copied exactly through main. Close
  terminal STAYS here (it was Prism Terminal's Close TAB the owner removed). Backspace over a
  selection on the line being edited deletes it, the core's since core-v0.11.0. The
  `termMenuCopy` scenario proved both in a real pwsh (removed with the terminal, 2026-10-26).
  Ctrl+A (2026-08-25) marks everything in whichever surface you last pressed in:
  every row the TREE is showing (expanded folders included, never what is
  collapsed and invisible), or every member of the archive folder you are in.
  Behind the typing guard, so the search box, a rename, the editor and the
  shell keep their own Ctrl+A.
  **THE COMMON FILE KEYS, IN THE EXPLORER'S LIST AND THE TREE** (#330; owner, 2026-10-07:
  "add common hotkeys to the explorer and project so that for example ctrl + A selects all";
  the list and four decisions picked in the session). ONE mapping, `lib/listKeys.ts` (pure,
  tested): Ctrl+A all; Ctrl+Shift+A and Esc clear (Esc only when something is marked and
  nothing nearer owns it: `lib/nearerEscape`, a `data-owns-escape` closer or the peek); Shift+Up/Down/Home/End mark the run from the anchor (`rangeSelect`,
  a run that shrinks back, Explorer's, unlike the Shift CLICK's merge); Ctrl+Up/Down/Home/End
  move the keyboard's place and not the marks (the Explorer's `cursor`, the tree's own
  cursor), Ctrl+Space marks or unmarks it; Ctrl+Shift+N NEW FOLDER (the owner's yes to the
  fresh decision above: main names it "New folder", "(2)"..., checks the place, never inside
  a zip; then the rename; undo kind `mkdir` bins it ONLY while empty, and the rename that
  follows folds into it, `rememberRename`, so one Ctrl+Z takes it away); Ctrl+D and Shift+Del
  ARE Delete (OWNER: Shift+Del is NOT permanent, nothing changed the "nothing is destroyed"
  rule; inert inside a zip; the MARKS decide, so a row the Ctrl keys or Esc left unlit is
  never what a delete key takes, the Explorer's rule in the tree too); Alt+Up the tree's parent row (Alt+Left/Right claimed, nothing;
  App leaves Alt+Up/Down to the lists, or it walks and OPENS the row above first);
  type-to-jump in the tree too (OWNER: taken only on a match, else the letter reaches the
  viewer; LETTERS only, `isJumpKey`, since a digit is the player's seek and a jump opens); F3 the folder search or the tree filter (OWNER: the PDF keeps F3 only with the
  focus in it; its window listener yields a claimed F3 and letter); Alt+Enter Prism's own
  Properties (OWNER); Ctrl+Shift+C the full paths as text, one per line, the menu's Copy path
  (no badge, as the menu); Ctrl+Enter a folder in a new Explorer tab. NOT Ctrl+Left/Right
  (2026-09-01). All of it is QUIET (#263: marking opens and plays nothing), behind the typing
  guard, from the rows only, and CLAIMED, since the player, the PDF and the archive panel
  listen on the window: App leaves Shift/Ctrl+Up/Down to the lists (`inLists`), the archive
  panel's and the tree's Ctrl+A step aside for the other surface, tree rows ignore chords.
  A letter chord matches the physical key only when the layout's key is not a Latin letter
  (AZERTY's Ctrl+Q is not Ctrl+A). After a rename the keyboard follows the row to its new
  name. Fullscreen unmounts both surfaces, so nothing here writes there. The `hotkeys` e2e
  drives every key on both surfaces, a paused film under them, and a zip.
  Tabs reorder by dragging along the strip (`reorderTabs`, pure and tested), with a
  hairline showing where one would land. (Since 2026-10-29 a tab can also be pulled OUT of
  the strip into a window of its own: "Tab tear-off", above; the 2026-08-23 "its own row and
  nowhere else" rule is superseded.)
  Selection is the accent tint (`data-selected`); `aria-selected` still means the OPEN
  file, which is what the e2e leans on. Keyboard unchanged: arrows land-and-open, Enter
  opens, F2/Delete act on the row (Delete takes the whole selection when the row is in
  one).
- **MOVING THE FILE YOU ARE WATCHING** (2026-09-13, #127; owner: dragging the film I was
  watching into a subfolder did not work, nor after opening another file, then it did).
  MEASURED: a rename of a file Prism is streaming fails with EBUSY, from Node's own read
  stream on it and from ffmpeg reading it alike - so the file is locked by Prism's own
  handles for as long as a player holds it, and switching files only helped once the old
  element had let go. DELETE learned this on 2026-08-22 (`releaseFiles` + `trashWithRetry`)
  and MOVE never did. `runMove` does the same now: the tab steps off the file (the element
  unmounts, the stream closes), a moment passes, the move runs, and what Windows still
  calls busy (`MoveResult.busy`, EBUSY or EPERM, kept beside `failed`) is tried again three
  times while the handles drain. Then it FOLLOWS the file: reopened at its new path, at the
  second it was at and playing if it was - the session mark is keyed by url and the url
  changed with the path, so the old url's mark is copied onto the new one before the
  reopen. A move that did not happen (a clash to answer, still busy) puts the file back on
  screen, and a file still busy after the retries says "in use by another program" rather
  than the bare "could not be moved", because that sentence is the one thing left to act
  on. Proved in `drag`: a playing film is dragged into a folder, really moves, and the
  viewer follows it there, playing, at or after the second it was at.
  **AND THE PROGRAM IN USE WAS PRISM** (same day, owner screenshot: "in use by another
  program" on a real film, after all of the above). MEASURED on a three-minute Dolby film:
  after the player let go, TWO of Prism's own sidecar ffmpegs stayed alive through every
  retry, holding the film with the CRT's share mode - Chromium does not cancel an
  `fsaudio://` response the moment its element unmounts, and the six-second fixture had
  hidden it, its decoder having already finished. So main stops what IT started before it
  renames: `src/main/holders.ts` (pure over its inputs, tested) registers every ffmpeg
  main spawns on a media file with the file it reads - the audio sidecar, the waveform's
  peaks - and `move:entries` and `file:rename` call `holders.release` on the paths first,
  which kills the matching children and WAITS for them to close (bounded), since `kill` is
  TerminateProcess and returns before the handles are gone. The renderer's own release
  and retry stay: they cover the element's stream, this covers the decoders. The e2e's
  Dolby film in the drag box is three minutes long now, so its decoder is still running
  when the drag lands, which is the case that failed.
- **A LINE SAYS WHERE A DROP LANDS** (2026-09-13, #126; owner: dragging to the root should
  be easier - at the bottom of the list, or over a file in the root, a blue line should say
  it will drop here). Dropping on a FILE row has meant "into that file's folder" since
  2026-09-01 and the space beneath the list has meant the root, but only a FOLDER's own row
  lit up, and the root has no row: the two drops that land in the root were the two with
  no cue at all. An accent hairline under the hovered file row (`data-drop-line`), or under
  the LAST row when the pointer is beneath the list, is that cue. The tree context carries
  the hovered ROW beside the target folder (`dropRow`, with `'end'` for the space beneath),
  and the sidebar's gutter resolver hands back the row it matched as well as its folder.
  Drawn for a file row whenever its folder is the target - which lights a subfolder's
  files too, beside their folder's own ring, and reads as the same promise twice rather
  than as noise. Proved in `drag` with synthetic dragover events, since a real drag ends in
  a drop and the line is a mid-drag state.
  **AND THE FOLDER IT HOVERS IS MARKED IN GREY** (2026-09-14, #140; owner: "blue means
  selected; the grey highlighting is more indicative of marked files"). The folder row
  under a drag wore the hover fill AND an accent ring, and the ring read as a selection,
  which it is not: the accent is "these are what I am about to act on" and a drop
  destination is where something is about to land. It wears the fill alone now - the
  same grey the right-click menu's target wears - and the accent keeps two meanings in
  the tree, the selection and the drop LINE, which is a promise about a place and not a
  mark on a row. Proved in `drag` off the computed style mid-drag: filled, no ring.
- **The empty window offers a TAB, not a file** (2026-08-31). With nothing open at all the
  first button was "Open file...", which is the narrowest way into an app whose whole model is
  a tab rooted at a FOLDER you then browse: it left you holding one file with no obvious next
  move. It is "New tab" now, instant and rooted per the "New tabs show" setting exactly as the
  + is, with the folder chooser beside it. Dropping a file still works and the line above still
  says so. `open:dialog` in main is left in place but is now reachable from nothing.
- **EVERY TAB IS ONE WIDTH** (owner, 2026-09-21: "make tabs in both apps have a fixed size, and not
  dynamically adjust based on the content"), the pinned Explorer tab included. A tab was as wide
  as its label, up to 14rem, so a folder with a long name shoved every tab after it sideways.
  Now `flex: 0 1 114px`, min 64px (the same day: 176px first, far too wide; then "way smaller...
  around 60%", 106px; then "a bit wider like 20%", 127px; then "10% less wide", 114px): one width, all of them shrinking EQUALLY only when the strip
  runs out of room, as a browser does; the label truncates inside, the root is on the tooltip.
  Prism Terminal's strip is the same code and the same rule. `tabs` measures the boxes.
- **Open a folder, and project tabs** (2026-08-20): the root used to be inferred from
  whatever file arrived and there was only ever one. A title-bar button and `Ctrl+T` now
  choose a folder, and several roots stay open as tabs. **A tab is a root and a current
  file, nothing else** - no per-tab settings, no pinning, no list you curate. A FOLDER
  arriving from outside ("Open as project") reuses a tab whose root IS that folder,
  otherwise spawns one. EXACT ROOT ONLY (owner, 2026-09-04, reversing 2026-09-01's
  containing-root fold): that fold moved an agent's tab under it. A FILE from outside no
  longer makes a project at all (2026-09-22, below). Tabs persist
  in `tabs.json`; a root that is gone is dropped without a word. THE TREE PERSISTS TOO
  (2026-08-31): the folders that were open are saved with the tab, so closing Prism no longer
  collapses everything - a file six folders down came back in the viewer with NOTHING marked
  in the sidebar, because none of the rows leading to it existed. That is view state rather
  than a per-tab setting, so "a tab is a root and a current file" stands; capped at 400
  folders, because it is a suggestion and not a record. Separately and always, ANY tab opens
  the folders between its root and the file it is showing (`ancestorsWithin`, pure and
  tested): a file handed over by Explorer has no saved tree at all and still has to be
  markable. The tree also FILLS IN anything expanded but not loaded, which a restored one
  entirely is: only a toggle ever fetched a folder's children, so the folders came back open
  with nothing in them and every row sat on "loading..." until it was collapsed and reopened
  by hand. Bounded six at a time, and that is not a nicety - a tree restored 400 folders deep
  would otherwise fire 400 `listDir` calls at once into the same libuv pool the `fsmedia://`
  Range handler reads a playing film through. In-flight fetches are tracked too, or the
  gap-filler re-issues every outstanding load each time one lands, which is O(n^2) requests. The strip is present from the
  FIRST tab, so the `+` is always reachable and the chrome never shifts when a second folder
  opens; it goes only when nothing is open at all. **Two folder buttons, two verbs**: the
  strip's `+` (and `Ctrl+T`) ADDS a tab instantly (its RIGHT click offers the last five folders
  Prism has been opened in, newest first, deduped, read fresh each time - history, not a list
  to curate; a folder that has gone drops out on the attempt), rooted at the user's home folder with no
  dialog, and spawns unconditionally (pressing + must never appear to do nothing); the
  sidebar's folder button (on the search row, left of the search box, away from sort/filter
  which narrow rather than change) opens the chooser and REPLACES the current tab root. Rerooting onto a folder another tab already holds switches there instead,
  keeping one tab per root. `Ctrl+W` closes a tab and the
  last one leaves an EMPTY WINDOW rather than quitting: Prism is resident and a window that
  vanishes under a reflex keystroke is the failure the close flow exists to prevent.
  Closing a tab holding unsaved text asks, like the window does.
  The root wall is a set now (`src/main/roots.ts`, removed 2026-10-28 with the roots), not one string. Navigation handlers
  (`open:within`, `dir:list`, `search:files`) name their root and get the strict per-tab
  check; everything else checks `insideAnyRoot`. The renderer owns the tab list and reports
  it, which is what narrows the wall when a tab closes.
- **A terminal, one per tab** (2026-08-20): opens FULL VIEW (the viewer steps aside but
  stays mounted, so scroll/zoom/playback survive) via `Ctrl+\``, `Ctrl+Shift+T`, or the
  sidebar FOOTER-row button (a new bottom row, one button so far). SPLIT is the deliberate
  arrangement, menu-only (no hotkey, 2026-08-21): right-click a file, "Open in split view"
  PINS file panes (up to 4 windows, FIFO, direction flyout with memory); the terminal's own
  split docks bottom/top/left/right (right-click menus), resizable. Ctrl+W closes
  innermost-first: pinned panes pop LIFO, then the tab itself. The terminal wears the style (reads
  --p-bg/--p-text/--p-accent-hi live): void means a black terminal. Right-clicking the
  terminal button offers split view and Clear terminal. The agent indicator has two
  volumes (owner picks, 2026-08-23): MINIMAL runs an indeterminate line along the tab's
  bottom edge while an agent works and says nothing else - no finished state, that is
  full's alone, and NO BRAIN ICON either (owner, 2026-09-09): the bar and the icon were
  two marks for the one thing minimal has to say, and the icon is the louder of them, so
  the quiet volume read nearly as loud as the other one. The icon's permanent slot goes
  with it - a mode that can never fill the slot does not reserve its width - which is why
  the tabs settle a little narrower when the setting is changed. FULL fills the tab with
  the working colour, keeps the icon, and holds the finished colour
  until the tab is visited. Syntax highlighting and history
  ghost-suggestions (RightArrow accepts, Up/Down recalls) are PSReadLine's, forced on at
  spawn - including `-EnableScreenReaderMode:$false`, because automation tooling
  false-positives the system screen-reader flag and PSReadLine then silently drops to a
  plain renderer (diagnosed 2026-08-20; a real screen-reader user gets a Settings knob if
  ever asked for). cwd starts at the tab's root; hiding keeps the shell running; exit,
  tab close, or quit kill it; rerooting keeps it. A tab whose terminal was SHOWING at quit
  reopens as a terminal (tabs.json remembers the view; the shell itself is fresh) - a
  Claude-session tab must not come back as an empty viewer (2026-08-21). And a shell that
  HOSTED CLAUDE at quit resumes the conversation BY SESSION ID: main reads the newest
  session claude recorded for the folder (~/.claude/projects) and launches the shell with
  `claude --resume <id>` as its STARTUP command - never typed on screen, never a bare
  --continue guessing (no session on disk = no resume). That was the ONE command Prism
  ever wrote itself - an explicit owner exception (2026-08-21) to the line below; the
  Set-Location of #99 (2026-09-04) is the second -
  claude AND codex (2026-08-23): claude comes back by session id, codex by its own `codex resume --last`, whose picker already filters by cwd so no lookup is needed; agent detection names the kind and tabs.json records it (the old boolean means claude). Other agents light the dot but have nothing to come back to. Ctrl+C
  over a selection copies it, Windows Terminal style; unselected it stays the interrupt.
  pwsh by default, Settings picks from what the machine has. The pty gets a
  terminal's OWN environment, not Prism's (2026-08-23): TERM=xterm-256color and
  COLORTERM=truecolor, with NO_COLOR and FORCE_COLOR=0 dropped, and the SESSION MARKERS an
  agent leaves for its children stripped by name (CLAUDECODE, CLAUDE_CODE_CHILD_SESSION /
  SESSION_ID / MESSAGING_SOCKET / MESSAGING_TOKEN / ENTRYPOINT / EXECPATH, CLAUDE_PID,
  CODEX_COMPANION_*). Prism inherits whatever launched it: from an agent's own shell that
  meant monochrome agents AND child sessions - no transcript saved, so nothing for Prism's
  resume to find, and a live pipe to somebody else's conversation. Real CLAUDE_CODE_*
  configuration (web-search limits, feature flags) is deliberately kept. **This is the one thing in Prism that executes**, accepted by design -
  the line that remains is that Prism never generates a command: main spawns only shells it
  detected itself, and forwards keystrokes. AI CLIs are the primary workload: an image on
  the clipboard forwards the ^V KEYSTROKE (Claude Code reads the image itself - swallowing
  that key is how other terminals break image paste), copied files paste as quoted paths,
  text is bracketed paste, Shift+Enter sends the backslash-CR continuation, and a file
  dropped on the panel types its path instead of opening. Prism claims only Ctrl+\` and
  F11 over a focused shell, plus the tab chords (Ctrl+T / W / B, Ctrl+Tab, Ctrl+1-9): Escape
  stays vim's. **Ctrl+W closes a tab over a focused shell, in BOTH apps** (owner, 2026-09-19);
  the shell loses delete-word on that chord, knowingly, and Ctrl+Backspace does the same job.
- **Reaching the terminal, and leaving it alone** (2026-08-31). Ctrl+` is THREE-WAY,
  VS Code's rule: a terminal that is showing but does not have the keyboard gets the
  keyboard, and only a press from INSIDE it hides. The old two-way toggle meant that
  reaching for the shell you could already see put it away. `toggleTermView` itself is
  unchanged and still tested; the branch lives in App, where `inTerm` already exists.
  **Ctrl+Shift+F finds in the SCROLLBACK** (xterm's own `addon-search`, so it knows about
  wrapped lines and the alternate screen), a DocFind-shaped bar over the panel; xterm's
  key handler must return false for it or the pty gets the bytes too, and it is added
  EXPLICITLY rather than by widening the `/^[twb]$/i` tab-key regex, which ignores shift
  and would cost the shell plain Ctrl+F. **"Open terminal here"** on a folder row follows
  the reroot policy verbatim: an UNTOUCHED shell is replaced by one spawned in that
  folder, a TOUCHED one is somebody's work and is never taken away - that folder gets a
  terminal in a NEW TAB instead. The tab's own root does not move; the sidebar's folder
  button is the verb for that. **AND THE SHELL COMES BACK WHERE IT WAS** (2026-09-09):
  the tab remembers its shell's FOLDER (`cwd` in tabs.json), which is not its root - both
  "Open terminal here" and a plain `cd` inside the root move the shell and deliberately
  leave the root alone, and restore spawned at the root, so the folder you had walked to
  was thrown away every launch. It compounded, which is what made it worth fixing rather
  than living with: claude records a conversation under the folder it was launched in, so
  the resume looked up the ROOT's newest session and a tab came back holding the wrong
  conversation - worse than coming back with none. The lookup follows the shell's folder
  now. What is saved is its own report (#99's OSC 9;9, the truth) and the folder it was
  spawned in as the fallback for a shell that has not reported yet or never will (WSL,
  bash); it is dropped on the way back in unless it still exists and is still the root or
  inside it, so a folder renamed since is a spawn that never happens rather than one that
  fails. Extra shells in the same tab still come back at the root - they are slots that
  spawn when picked, and only the one that was showing has a folder worth keeping. And the
  close question now NAMES what it interrupts:
  `lib/agentClock.ts` times how long an agent has been working, which `outputRuns`
  cannot - its `start` resets on a 1.5s silence, so it measures a burst, deliberately.
  **THE CLOSE QUESTION IS ONE RULE, NOT A SETTING** (owner, 2026-09-19, #154: "remove the
  setting but just have it on smart mode by default"). It is the core's `agentClose`, the same
  in Prism Terminal: a plain shell closes unasked; a tab whose shell HOSTS an agent asks,
  working or idle, in any of the tab's shells; the WINDOW is held only while one is mid-answer
  (main mirrors `agentBusy` beside `editorDirty`, the renderer asks about unsaved text first
  and the agent second, and an update install goes through the same question). The Agents /
  Off setting and `lib/tabPrefs` went with it. Unsaved text still asks, always.
- **The terminal and the sidebar stay in step** (2026-09-04, #99). The shell REPORTS its
  folder at every prompt, Windows Terminal's way: the pwsh bootstrap wraps whatever `prompt`
  the profile installed (oh-my-posh and starship survive) to print OSC 9;9 for the FileSystem
  provider, Windows PowerShell gets the same `-Command`, cmd gets it through PROMPT
  (`termPrompt.ts`); WSL and bash report nothing and are left out. xterm's OSC handler reads
  it, never the process - pwsh's process cwd does not follow Set-Location. A cd INSIDE the
  tab's root expands to the folder and marks it, root unchanged (research across Warp, VS
  Code, Zed, JetBrains and Dolphin: no editor reroots on a cd, and Warp pins to the git root
  precisely so an in-project cd moves nothing); a cd OUTSIDE reroots the tab, unless another
  tab holds that folder, which would switch you there mid-keystroke. The other way, a reroot
  (folder button, a folder row dropped on the viewer) respawns an UNTOUCHED shell as before
  and now writes ONE `Set-Location -LiteralPath` into a TOUCHED one - **the second command
  Prism ever writes itself**, beside the agent resume (owner decision) - and only when the
  shell has reported a prompt with nothing typed since, hosts no agent, and is not already
  there. Anything else is left alone, silently. Equal cwd is a no-op both ways, which is also
  what stops the echo loop. `termCwd.ts` (shared, pure) holds the parsing, the quoting and the
  inside/outside decision. TWO LIES FOUND ON THE WAY: xterm answers the pty on its own (focus
  in/out, which pwsh 7.5 switches on; device attributes at spawn), and every reply went through
  onData and counted as the USER typing, so a shell nobody had touched read as touched from
  its first prompt - keys are heard on onKey now, and onData counts only plain text; and
  Ctrl+` left to xterm became a NUL byte to the pty, so hiding the panel with the key it is
  hidden with counted as typing too.
  **AN AGENT'S STARTUP IS NOT WORK** (2026-09-04, owner: the tab lit "working" while
  Claude was only starting). The indicator scores SUSTAINED output, and an agent's startup
  paint is exactly that. The 4s clock from detection that covered it guessed at two things
  it could not know - how late the process poll noticed the agent (up to 2.5s), and how
  long the machine takes to boot it, which at app start with several tabs resuming at once
  runs past four seconds - so the paint's tail scored as an answer. MEASURED: a plain start
  streams 2.2s, a resume of a 46MB session 2.1s, both inside the clock on a quiet machine,
  which is why it only showed under load. The rule now (`markBorn` / `startupOutput`,
  pure and tested) needs no guess: nothing after detection counts until the FIRST SILENCE
  (1.5s) OR the first KEYSTROKE into the agent - whichever comes first - and the first
  chunk after that is the agent's own. The keystroke half was found the same hour: a prompt
  typed within a moment of the paint left no silence between its echoes and the answer, so
  the whole first answer read as startup and the tab lit only on the second message. Cost,
  said plainly: `claude
  "do this"` typed as one command runs straight from startup into work with no gap, and
  shows nothing until its first pause.
  **THE PROMPT LINE IS CARRIED ACROSS A RESIZE BY HAND** (2026-09-04, owner screenshot:
  "PS C:\" and the tail of the path with blank columns between, Ctrl+L putting it right).
  ConPTY - node-pty's bundled dll, which Prism must use because the inbox conhost fast-fails
  the app when a pty dies mid-read - sends NOTHING on a resize, MEASURED: 0 bytes narrower
  and 0 bytes wider, where the inbox conhost repaints the whole screen (339 bytes). It
  reflows its own buffer and expects the terminal to do the same; xterm does, for every line
  EXCEPT the one holding the cursor, on the Unix assumption that the shell redraws its own
  line on SIGWINCH. Nobody redraws it here, so the prompt was cut at the narrower width and
  stayed cut once widened, and the next keystroke landed at ConPTY's idea of the column. So
  `fitKeepingCursorLine` reads the logical line under the cursor before the resize and
  writes it back after, through xterm's own parser, cursor restored - only when it is the
  LAST thing in the buffer (a prompt), never on the alternate screen. `windowsPty` is
  declared too, with a build number past 21376 (the dll is newer than any inbox conhost),
  which keeps xterm's reflow on and its scrollback growth ConPTY-shaped; declared WITHOUT a
  build number it turns reflow off, which loses every long line. `promptLayout` in the e2e
  wraps and unwraps a prompt and types after it; it was written to reproduce this and did.
  **A FILE ARRIVING MEANS "SHOW ME THIS FILE"** (2026-09-04): it used to land underneath a
  full terminal, unseen. Since 2026-09-22 it lands in the Explorer tab (below), which comes
  to the front with its own terminal stepped aside; a project's shell is left alone.
  **THE INDICATOR IS THE AGENT'S OWN WORD** (2026-09-04, owner: "instant, and event-driven,
  no loop"). Claude Code writes its state into the terminal TITLE, MEASURED on a real
  session: "✳ Claude Code" at idle, a half-circle spinner glyph ("◐ Claude Code", cycling
  ◐◑◒◓) from 30ms after Enter, held through tool calls, and back to "✳ <task>" the instant
  the answer lands. xterm already parses titles, so `lib/agentTitle.ts` (pure, tested) reads
  the glyph and App sets the tab the moment the event arrives - measured in the e2e at 41ms
  to light and 21ms to clear, shell latency included, against the 1.2-2.7s the output
  heuristic cost. A title with a state is ALSO the agent being present, NOW, ahead of the
  process poll that would have said so up to 2.5s later; the poll still notices it leaving.
  A titled session is never scored from its output again - the agent's own word is exact and
  its repaints would only second-guess it. CODEX HAS A DIALECT OF ITS OWN (measured the same
  day, in a folder it trusts - in an untrusted one the trust prompt eats the first keystroke
  and it quits): a BRAILLE spinner before the FOLDER NAME while busy ("⠙ yeah", cycling
  ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) and the bare folder name at rest, during startup too - the spinner runs while
  MCP servers load and the bare name marks the moment it is ready - with its child
  processes' titles ("npm", "cmd.exe") interleaved, meaning nothing. So the reader is PER
  SESSION (`readAgentTitle`) and remembers the name after the spinner, whose bare form is
  the idle; a spinner BEFORE the first idle is the agent STARTING, present and not working,
  for both dialects. A braille spinner is common currency (ora, and every CLI built on it),
  so the Codex dialect is acted on only once the process poll has found an agent in the
  shell; Claude's glyphs are its own and act alone. A session with no title state keeps the
  output fallback, which lost its 700ms tick: the chunk that carries a run past the sustain
  sets working right then, and ONE timer armed on the latest chunk clears it after the
  silence. The e2e stands a shell in for Claude with `$Host.UI.RawUI.WindowTitle`, NOT a
  raw `[Console]::Write` of the sequence - that one re-encodes the glyph to "?" on its way
  through the console (measured); Claude writes its bytes straight to the pty.
  **AND `ls` COLOURS ONLY THE FOLDERS** (owner, same day): pwsh's own defaults paint a
  directory bold on a BLUE BACKGROUND (a tint on a navy console, a selection on Prism's
  palette), an .exe green, a .ps1 yellow, a .zip red and the table header green with the
  numeric column's header in italic green on top - a listing read as highlighted source.
  The bootstrap (`PS_FILE_STYLE`) sets directories to bold blue TEXT and clears the rest,
  so files and headers take the terminal's own foreground; the blue is ANSI blue, which is
  the chosen theme's blue. AND EVERY THEME'S SIXTEEN NOW CLEAR THE CONTRAST FLOOR
  (`legiblePalette`): the curated presets used to be kept exact, and MEASURED against their
  own backgrounds a dozen dark ones carried a bright black at 1.0-2.7:1 - the colour
  PSReadLine paints parameters, operators and its inline prediction in - and the light ones
  a bright white (numbers, members) at 1.0:1. Only a colour that fails moves, and only to
  the floor, so a scheme that reads keeps its exact colours; `termTheme.legible.test.ts`
  asserts it for every preset.
- **Prism on your phone** (2026-09-06, #104). A plain Node `http` server in
  `src/main/phone/` serves a phone-sized page on the LAN, and the phone browses a folder
  the PC has open and plays what it can play natively. WHICH folder is the phone's own to
  choose since 2026-09-08 (the tab-switching decision below, which reversed the design's
  first one), and since 2026-10-14 it is ANY folder on the PC, like the Explorer (the entry
  below says what that widened): the code it scanned decides only where it STARTS. PLAIN HTTP, deliberately: a
  self-signed certificate is a warning page on every phone and a trust prompt nobody can act
  on, and the bytes never leave the user's own network. The DIALOG says so, and says BEFORE the switch
  goes on that Windows will ask about the firewall, because a per-user installer cannot add
  the rule and a declined prompt is a phone that cannot connect with no error anywhere.
  Pairing is a six-character SINGLE-USE code (no 0/O/1/I, since it is typed as well as
  scanned), two minutes long, never persisted; the phone trades it for a token it keeps, and
  the token remembers the ROOT it is on, which is the tab the code was shown from until the
  phone moves itself. A paired phone scanning another tab's code MOVES to that root and keeps
  its token, so the list never grows a second row for one phone; `POST /api/tab` is the same
  move by another door, and the door that is actually used. The wall is written ONCE at the
  top of `handle`: every route but the page and `/pair` needs a paired phone, and every path is
  checked against THAT phone's own root with `validRoot` before anything reads it; media
  bytes then go through `serveMedia` itself, so `/m/` inherits `fsmedia://`'s rules on top.
  EVERY ASK, not just the first (2026-09-07): a wall can move under a stream. Closing the
  tab, or the phone scanning another tab's code, used to leave an HLS job serving the old
  folder for as long as the phone kept asking, because `/hls/` was keyed by the job's id
  and checked only that the token owned it. The job's own file is re-checked against the
  phone's root on every ask now, and a phone that MOVES loses the old root's grants and its
  running job in the same breath.
  The token rides as a Bearer header for fetches and as `?t=` for `<video src>`, which can
  carry no header. Nothing on the phone path is synchronous on main's thread: the page
  streams, the listing is the bounded async `listDir` the sidebar uses, pairing is a Map.
  One honest exception, and it is the PC's too: an archive listed or extracted for the phone
  goes through main's own reader, and for a zip under the cap that is adm-zip, which is
  synchronous by construction (a big zip takes the 7-Zip path, which is not). The phone
  changed nothing there; it is the same call the panel makes.
  Under `--e2e` it binds `127.0.0.1` ONLY, so a throwaway build never raises the firewall
  prompt; the e2e's "phone" is a second sandboxed window of the app's own Chromium, since
  the harness ships no browser binary. The phone page is a SECOND VITE ENTRY
  (`src/renderer/phone.html`, `src/renderer/src/phone/`) mounting the SAME `ImageView`,
  `VideoView` and `AudioView` behind `prismShim.ts`, a Proxy standing in for `window.prism`:
  the handful of calls the viewers make are answered over the wire, and anything else WARNS
  rather than throws, because a viewer's optional call (position memory, settings) must
  not take the picture down with it. The More button (three dots, Tools until #272) in the TITLE BAR is the home of the
  dialog (switch, QR, address, paired phones, who is watching now), and it is in the title
  bar because the sidebar can be hidden. The dialog shows what the server IS, re-read on
  every `phone:changed`, never what was clicked. Documents (#106) followed as their own
  decision, below.
- **The phone plays what it cannot play** (2026-09-06, #105): an MKV, HEVC on an Android,
  Dolby audio anywhere, through a live transcode to HLS that SEEKS LIKE A FILE. THE PLAYLIST
  IS PRISM'S AND THE SEGMENTS ARE FFMPEG'S (`src/main/phone/hls.ts`, pure and tested):
  `/api/play` writes every four-second segment of the whole film up front, VOD, so the
  scrubber knows the duration from the first byte and can ask for segment 400 before
  segment 2 exists; one ffmpeg per phone-and-file (`jobs.ts`) makes the files, from
  whatever segment it was started at, and a request past its head by more than three
  segments kills it and restarts it there (`nextAction`). That works only because of
  `-copyts`: a segment's own timestamps say where in the film it is, or a run restarted at
  minute 30 would hand over a segment claiming to be minute 0. Keyframes are FORCED on the
  boundary with the start time in the expression, and NVENC NEEDS `-forced-idr 1` TO OBEY:
  measured through the real route, `-force_key_frames` alone still gave 10.5s segments
  (the forced frames come out as plain I-frames, which the HLS muxer does not cut on), so
  every segment after the first sat 6.5s later than the playlist said and nothing errored.
  Paths go to ffmpeg with FORWARD slashes, or its HLS muxer writes `init.mp4` into the
  current directory. The token rides on EVERY URI in the playlist (`0.m4s?t=`): a player
  resolves them against the playlist's url and drops its query, so a token on the playlist
  alone reached no segment at all (401 on init.mp4, found by the e2e). The decision is PER
  DEVICE, never from a user agent (`decide.ts`, pure): the phone reports what its own
  `canPlayType` answers as tokens (`canPlay.ts`, `can=h264,aac,mp4,mse`), a container the
  phone cannot demux is HLS whatever the codecs, a codec the phone plays is COPIED into the
  segments and one it does not is encoded - so an iPhone gets its HEVC and Dolby copied
  while an Android gets both re-encoded. Encodes are capped at 1080p, audio is always AAC
  stereo 192k. HDR is tone-mapped through libplacebo on Vulkan (the plan's bench: 7.5x
  realtime with the colours right; `tonemap_opencl` 0.7x, unusable; without a tone-map the
  picture is flat grey), and the encoder flips to libopenh264 after ONE GPU refusal and
  stays there for the session. MEASURED THROUGH THE ROUTE (2026-09-06, RTX 5090, the built
  app under `--e2e`, `can` forcing an encode): the 4K SDR HEVC Zoolander answers `/api/play`
  in 48ms (cold probe), its first segment in 560ms, holds 17.6-18.4x realtime on disk and
  lands a ten-minute seek in 1.2s; the 4K HDR10 Hellboy II remux answers in 74ms, first
  segment 1.5s, 8-10.4x with the tone-map, a ten-minute seek in 2.2s. On the PHONE the
  playlist goes through hls.js wherever MSE can take it and is the element's own `src` only
  where there is none (an iPhone), MSE-FIRST ON PURPOSE (`hlsPlayer`, pure): Chromium answers
  "maybe" to the HLS mime (its built-in player, measured on Chrome 150) and that player asks
  for segments without the token, so trusting the claim sent an Android to a player that
  could not work. hls.js is loaded on demand so an iPhone never downloads it, and it owns
  `src` through the players' one new prop, `attach`. A job nobody asks about for 30s has its
  ffmpeg KILLED and nothing else: a paused player fetches nothing, and the first cut reaped
  the whole job at 30s, so a phone paused longer than that resumed into a 404 and a fatal
  hls.js error nobody handled (the element's own error event never fires when hls.js owns
  the source, so the page simply went quiet). The record and its segments stay for ten
  minutes and the next ask restarts ffmpeg where it stands; a fatal hls.js error now retries
  the network, recovers the media once, and past that raises the element's own error so the
  player draws the overlay it already has. `userData/phone/hls` is wiped at startup. An HLS
  film is handed its playlist as the url from the start, never the direct bytes first (one
  aborted request per film, measured in the console). Everything on
  the path is walled: a job is opened only on a path that passed the phone's own root, its id
  is what `/hls/` is keyed by, another phone's token gets 404 rather than 403, and only
  `index.m3u8`, `init.mp4` and `<n>.m4s` are served from a job directory.
  `PRISM_PHONE_DEBUG=1` logs ffmpeg's own progress line and exit per job. Three things a
  live transcode taught us on the way (2026-09-07): a job's ffmpeg is decided on `close`,
  never `exit`, because everything decided there is read from stderr and `exit` can arrive
  before it has drained, so a fast NVENC refusal read as an empty reason and never fell
  back to software; a failure is forgotten the moment `/api/play` asks again, or one bad
  run was a ten-minute 404 for that film however often the phone reloaded; and only the
  NEWEST ask may move the run, because a prefetch and a seek arriving together each
  restarted ffmpeg at their own segment and killed the other's, so neither was ever served.
  An ask the player has moved past gives up at once with a 404 it retries, rather than
  holding a connection for thirty seconds.
- **THE STREAM SURVIVES THE NIGHT, AND SAYS WHAT IT SAW** (2026-09-12, #116; owner, after a
  film on the iPad: twenty hitches in two hours, and no way to unpause after sleeping).
  Three things found by measurement, one still open. (1) `init.mp4` WAS SERVED EMPTY: the
  muxer creates the init file at 0 bytes when the run opens its output and writes the moov
  only as the first segment is flushed - MEASURED at 0 bytes 100ms into a copy run, 1457
  bytes at 150ms - and the player asks for init.mp4 FIRST, which is the ask that starts the
  run, so hls.js got nothing, "initSegment does not contain moov or trak boxes", six parse
  retries and a stop. `init()` now waits for the run's FIRST SEGMENT on disk, because
  ffmpeg closes the init file before it finalises any segment; the fake ffmpeg writes the
  file empty and fills it with the first segment, so the test fails the old way. (2) A JOB
  IDLE TEN MINUTES lost its RECORD along with its segments, so a phone paused longer than
  that - asleep for the night - got 404 on every segment and a player that had given up,
  where a refresh worked because it is a fresh `/api/play`. The record is a few hundred
  bytes and is the phone's stream for as long as the phone is paired: the sweep removes the
  DIRECTORY and keeps the job, `ended` reset so the next ask restarts ffmpeg where it
  stands. And hls.js's network-retry budget on the phone RESETS when a fragment lands: it
  counted for the whole film, so four blips across two hours made the fifth fatal, which is
  a player that "just stops". (3) COPY MODE'S PLAYLIST LIES: a copied stream can only be cut
  at the film's own keyframes, and Prism's playlist says every segment is 4.000s. MEASURED
  on the owner's HEVC film (keyframes 1-4s apart): segments of 1.9-6.7s; on an x264 rip
  with 10s keyframes: 10s segments. ffmpeg's rule is exact and deterministic - segment N
  runs from the first keyframe at or after 4N to the first at or after 4(N+1), measured
  against the RUN's first packet, so a restart moves the grid. hls.js on the PC survives
  it (4 minutes of the HEVC copy at 1x and 16 minutes of the x264 copy at 4x through the
  app's own Chromium: no backward jump, no skip, one stall), so it is NOT proven to be the
  iPad's hitching, and it is not fixed here; it is written down so the next person does not
  rediscover it. What decides it is the PHONE LOG: `userData/phone/phone.log`
  (`src/main/phone/diag.ts`) is ONE timeline - the server's every segment ask with how long
  it waited, every start, kill, exit and reap of a job, every play answer and refused
  stream - and the phone's own player, posted in batches to `/api/diag` (walled like every
  route, capped by `diagLines`): hls.js's error events fatal or not, waiting/stalled/seek
  events, a buffer sample every ten seconds (`phone/diag.ts`). An iPad has no Web Inspector
  without a Mac; this is the substitute, always on, a few dozen bytes a line, rotated at 2MB.
  The open hypothesis is iPadOS WebKit's MediaSource quota against a 4K HEVC copy with 30s
  buffered ahead: a buffer-full error, a flush, and a resume from the last keyframe, which
  is the 1-2s replay the owner described. The log says.
- **ONE PLACE PER FILM, ON THE PC** (2026-09-13, #118; owner: some way into a film on the
  PC, opened it on the iPad, and it began at the beginning). The position lived in each
  renderer's own localStorage keyed by the media URL - `fsmedia://` on the PC,
  `/hls/<job>/index.m3u8?t=<token>` on the phone, which changes with every job and token -
  so the phone never saw the PC's place and could not even find its own from one evening to
  the next. `src/main/positions.ts` is the store now (`userData/positions.json`, tabs.json's
  shape: debounced, capped at 500 newest, a suggestion), keyed by FILE PATH lower-cased,
  reached over IPC from the window (`positionGet/Set`) and over `/api/pos` from the phone,
  walled like every path a phone names. THAT IS THE ONE THING A PHONE WRITES, and it writes
  a number into main's own store, never the filesystem the wall protects; the "nothing
  writes" rule of #106 stands for files. The RULES stayed with the players and moved into
  `lib/resumePoint.ts` (pure, tested): over ten minutes, cleared in the last seconds, whole
  seconds every five. The session mark (`playState`, per host) still wins; the stored place
  is asked for and applied only while the element is still at its start, since the answer
  comes back over IPC or the wire and a user who has already scrubbed is not to be yanked
  back. The old localStorage key is read ONCE and written through, so nobody loses their
  place at upgrade. Proved in `phoneHls`: the window writes 2400, the phone reads it, the
  phone writes 3000, the window reads it, and positions.json holds it.
  **AND THE CHOICES BESIDE THE PLACE** (2026-09-13, #124; owner: "if I set the audio track
  to English and later come back to it in a new tab, it should still be in English"). The
  same record holds the audio track, the subtitle track and the aspect ratio picked for the
  file (`FileMemory`); `set` MERGES a patch and null CLEARS a field, which is itself a
  memory: a film whose subtitles you turned off opens with them off whatever the global
  "subtitles wanted" says, and a remembered track that is no longer beside the file falls
  back to that rule. Read with the tracks, in ONE `Promise.all`, so the auto-pick and the
  memory cannot race. The phone reads its remembered track BEFORE it asks for the stream,
  so the film opens on it rather than swapping to it, and the phone's own picks are
  written through the same route (`memoryPatch`, pure, is the wire's validator). The
  record FOLLOWS Prism's own renames and moves (`Positions.rename`, called from the IPC
  handlers with the from and to they already have), so a film tidied into a folder keeps
  its place and its choices. And the video player's per-file resets (ratio, track) are
  keyed by PATH now, not url: the phone's audio pick swaps the url for the same film, and
  the ratio you chose must not reset on it. Proved in `player` (the subtitle pick and 16:9
  survive stepping to ep2 and back, and sit in the store by path) and in `phoneHls` (a
  reload of the film comes back on the Commentary track).
  **AND COMING BACK REFRESHES THE STREAM ITSELF** (same day, owner: leaving the page and
  coming back left a player that would not go on "until a site refresh"). What WebKit does
  to a backgrounded media element and its MediaSource buffers is written nowhere Prism can
  read, so `phone/returning.ts` (pure decision, tested) does what the refresh did and only
  when the player is visibly the worse for it: after more than 20s hidden, an element with
  an error, with no data ready, or that claims to play while its clock stands still over
  1.5s, is re-attached at its own position - hls.js's own `recoverMediaError` plus
  `startLoad(t)`, or `load()` and a seek on the native path. A short absence or a working
  player is left alone, since re-attaching a working stream is itself a hitch. Every return
  writes one line to the phone log saying what was seen and what was done, so the next
  report says whether the rule fired.
- **Documents on the phone** (2026-09-07, #106): PDFs, markdown, code and text, office and
  ebook documents, comics and archive listings, through the SAME viewers the PC mounts
  (`PhoneViewer`, lazy-loaded exactly as App loads them, so a phone that only plays films
  never downloads pdf.js or CodeMirror; measured in the e2e from the page's own resource
  timing). Five read-only routes (`/api/text`, `/api/doc`, `/api/comic`, `/api/archive`,
  `/api/archive/extract`) call the converters main already has, and the WALL'S ONE
  SOFTENING ON THE PHONE is a grant set (`grants.ts`) that is per PHONE and per ANSWER: a
  markdown's own pictures, a comic's unpacked page directory, one extracted member, each
  allowed to the token that asked and to nobody else, consulted by the media route beside
  `validRoot`. NOTHING WRITES A FILE: the shim has no `writeText`, no rename, no delete and
  no archive verb, and the server has no route for any of them (the one thing a phone
  records since #118 is a playback position, into main's own store). `window.prism.capabilities`
  (`write`, `clipboard`, `explorer`, `drag`; all true in preload, all false in the shim) is
  how ONE viewer serves TWO hosts - `fileVerbs` answers only Copy path without `explorer`,
  the picture, the video, the archive panel and the editor each hide what they cannot
  honour, and `CodeView` is `readOnly` STRUCTURALLY (no `saved.current`, so `save()` has
  nothing to write). `resolveMdUrl` takes the url builder as an argument instead of
  hard-coding `fsmedia://`, which is what lets a README's picture arrive over `/m/`.
  THE TOUCH PASS, the parts a real device is not needed for, MEASURED in the app's own
  Chromium under CDP touch emulation: a tap on a comic's outer thirds turns the page (touch
  pointers only, so a click on the desktop does what it always did), a TAP WAKES THE CHROME
  (`autoHideChrome` heard only `pointermove`, and a finger that touches and lifts fires none,
  so a phone could never bring the page counter or the transport back), the archive's rows
  are 44px under `(pointer: coarse)`, and code WRAPS by default - written ONCE into
  `prism.code.wrap` if the phone has not chosen (`phoneWrapDefault`, pure), never forced
  over a choice. Two things found on the way: pdf.js's worker is an `.mjs` and the server's
  MIME table did not know it, so a module worker got `application/octet-stream` and refused
  it without a word (pinned in `server.test.ts`); and a member VIEWED out of a zip on the
  phone is a double-tap, the panel's own rule. Pinch, swipe and the native video controls
  wait for a real device; hex and the terminal are not offered.
- **LIST OR GRID, WITH THUMBNAILS MADE ON THE PC** (2026-09-13, #135; owner: two buttons in
  the phone's title bar, a list icon and a grid icon, to switch between). The pair sits right
  of the magnifier, the active one in the accent, and the choice is the PHONE's (`view.ts`,
  localStorage, pure over its storage and tested), so a reload comes back in the view you
  chose. The grid is tiles at least 110px wide - three across on a phone, more on a tablet -
  a square picture with the name under it on two lines, folders included; a tap opens as a
  row does. THE PICTURES ARE THUMBNAILS, not the files (owner pick over icon tiles): a grid
  of names is a list that saves scrolling, a grid of pictures is a photo app.
  `src/main/thumbs.ts` renders a 320px JPEG with the bundled ffmpeg - the photo itself, HEIC
  and RAW and the ffmpeg-decoded formats included since that is the decoder they go through
  anyway, a frame three seconds into a video with the first frame as the fallback for a clip
  shorter than that - cached under `userData/thumbs` by path, size and mtime (`thumbKey`),
  touched on a hit and evicted oldest-first past 200MB (`toEvict`). AT MOST FOUR AT A TIME,
  which is the performance rules again: a folder of three hundred photos would otherwise
  start three hundred ffmpegs into the pool a playing film reads through; asks for one key
  share one process, and the tiles are `loading="lazy"`, so only what is on screen is asked
  for. `/api/thumb` is walled by `inside()` like every path, answers 404 for a file with no
  picture in it (the tile draws its chip through the image's own error), and lets the phone
  cache the JPEG for a day, since the key changes with the file. The thumbnail ffmpeg is not
  registered with #133's holders in this change - they had not merged - and it lives well
  under a second, inside the move's own retry; `register` is where they hook in.
  **THE NAME IS CENTRED UNDER THE TILE, AND THE PAIR IS A TOGGLE** (2026-09-14, #143,
  owner). The caption under the square was left-aligned, which on a square reads as
  hanging off one corner; it is centred on the square now, two lines at most. Inside the
  box, along its bottom edge over a scrim, was built first and RETRACTED the same day
  (owner: "I want it outside, but maybe centred"), so the square stays a picture and
  nothing else. The list and grid buttons were two icons side by side, the active one
  tinted, which read as two verbs rather than one switch; they are one segmented pill
  now, the active half filled in the accent. Proved in `phone` off the boxes and the
  computed styles: the name below the square and centred on it; one pill, the active
  half filled.
- **THE REMOTE WAS BUILT AND REMOVED** (owner, 2026-09-08, after using it on an iPad;
  #107). For a day the phone could drive the PC: a state stream (`GET /remote/state`,
  Server-Sent Events), a validated command drop (`POST /remote/cmd`), a registry naming
  whichever PC player owned the keyboard (`lib/remoteTarget`), and a "Play on: This phone /
  This PC" control in the phone's player that handed the film on screen over with
  `{op: 'open', path}`. It went ENTIRELY, root and branch: the routes, the IPC channels
  (`phone:state`, `phone:cmd`, `phone:listeners`), `shared/remote.ts`, the phone's panel and
  client, and the `phoneRemote` e2e. Written down so nobody rebuilds it by reading the older
  decision: the phone PLAYS WHAT IT OPENS and never drives the PC. Two things the shape
  wanted that a phone in the hand does not - a mode to be in before you pick a file, and a
  second clock that lockstep was never promised for - and the thing it cost was the one that
  matters, which is that the simplest possible answer to "where does this play" is "here".
  What survives is the one-screen explorer, the player, the search, the fullscreen routes and
  every fix that landed beside them.
- **THE PHONE BROWSES THE WHOLE PC, LIKE THE EXPLORER** (owner, 2026-10-14: "i wanna change up
  how remote works so its basically just on the explorer, meaning youre not tied down to a
  specific project"; asked, they chose "the whole PC, like Explorer", a drawer of "Explorer's
  places", and "where it left off"). SUPERSEDES "THE PHONE SEES THE OPEN TABS" below. The phone
  is no longer on a tab: it is in a FOLDER anywhere on the PC. The crumb row starts at This PC
  (`THIS_PC`, '' in `phone/browse.ts`), which is the places page; the hamburger opens the same
  places as a drawer titled Places (`phone/Places.tsx`): Quick access (the Known Folders, then
  the user's own Quick access pins, which the window reports over `phone:pins`) and This PC
  with each drive, its label and a bar of how full it is. Search is the folder you are in and
  everything below it. A folder that has gone says so and offers Up and This PC. A code can be
  made from ANY tab, the Explorer included, and carries only where a NEW phone starts (the
  folder in front, or This PC with Settings in front); after that the PC remembers each
  phone's folder (`Phone.here`, saved at most every 2 s) and a fresh visit lands there,
  whatever the PC does. The dialog says before the switch goes on that a paired phone can open
  every folder this Windows user can, and only view.
  THE WALL WIDENS, said plainly because a widening nobody wrote down is one nobody can weigh:
  from the folders open as tabs to every LOCAL folder this Windows user can read, which is
  what the desktop Explorer already reaches. It is the Explorer's own rule, per phone
  (`phone/phoneAccess.ts` on `desktopAccess.ts`, one owner `phone:<token>` each): listing a
  folder grants it, and a file is readable only DIRECTLY inside a folder that phone listed (or
  one of its own answers granted it, as before). Main's media wall agrees because it is the
  same map, so `/m/` needed no hole of its own. What did NOT change: pairing is the gate,
  plain HTTP on the user's own network (loopback under `--e2e`), read-only (a film's position
  is the one write), and every HLS ask re-checks the wall. A UNC share and a device path are
  refused for a phone even where the desktop takes them. A forgotten phone's owner is released
  for good. `docImages.ts` learned `<source srcset>` in the same change: the README's AVIF had
  only ever been served by the old root wall. Held by `phoneAccess.test.ts`, the server tests
  and the `phoneExplorer` e2e (pair from the folder in front, the drawer's places and drives,
  This PC with no Up, a drive lists, a folder no tab holds lists and opens its file, a file in
  a never-listed folder is 403, the PC remembers where the phone is, a reload lands in place).
  **THE REVIEW THAT FOLLOWED** (2026-10-14, report in
  `research/prism/2026-10-14-phone-access-review.md`): a search term starting with `/` or `-`
  reached es.exe as a switch (one writes a file), so such a term is now passed quoted
  (`everythingQuery.ts`); `/m/` answers carry a sandboxing CSP, so an SVG or HTML file on the PC
  never runs as the phone page; the server answers the user's own network only (`localNetwork`
  in `phone/lan.ts`: loopback, private, link-local, 100.64/10, IPv6 ULA); markdown links open
  with `noopener`. **ITS LEFTOVERS, CLOSED** (owner, 2026-10-15: "we can do the phone security
  thing"): nothing on another computer. A mapped network drive and a folder that links to a share
  are spelled like local paths, so `phoneOnThisPc` asks where the path REALLY is (the OS's final
  path, which is the share: measured with a drive mapped to `\\localhost\C$`) before a folder is
  listed and before every read and media answer, and the drawer leaves network drives out. A
  pairing code dies when the dialog closes (`phone:code-drop`), where it used to stay redeemable
  for the rest of its two minutes. The token still travels in clear text, because the server is
  plain HTTP; only HTTPS closes that, and a phone browser warns on a self-signed certificate, so
  it is the owner's decision, not made. Held by `phoneAccess.test.ts`, `places.test.ts`, the
  server test "never lists or reads a folder that is really on another computer" and the
  `phone` e2e ("a code is refused once the dialog closed").
  **NO "ADDRESS PHONES USE"; REMOTE ACCESS BECOMES AN APP** (owner, 2026-10-16, reversing
  #406 the same day: "remove the reverse proxy thing from Prism... we'll instead start
  eventually looking at making it an app where you can just remote into your PC safely... the
  profile can be combined with that app"). The optional address (#406, 0.116.0) is gone: a
  trusted HTTPS name needed either the user's own domain and proxy, or a trust profile
  installed on every phone, which is not something people should have to do by hand. HTTPS
  and remote access come later, in a dedicated app that can carry the trust itself. What stays
  from #406 is a wall: through any proxy a user puts in front of Prism by hand, every client
  address the request names must also be on the user's own network (`forwardedLocal`). Held by
  `lan.test.ts` and the server test "refuses a request a proxy forwarded from outside the
  network".
- **THE PHONE SEES THE OPEN TABS AND SWITCHES BETWEEN THEM** (superseded 2026-10-14, above; owner, 2026-09-08, from the
  same session: "i should be able to switch tabs without scanning a new qr code. i should be
  able to see the available tabs and switch"; #107). This REVERSES the design's own first
  decision - that a phone sees ONE tab's folder, the tab the QR was shown from, and reaches
  another only by scanning its code - and it WIDENS THE WALL, which is written down here
  rather than left to be discovered, because a widening nobody wrote down is one nobody can
  weigh: a paired phone may now reach ANY root the PC currently has OPEN. What did NOT
  change is the shape of that wall. The phone is on ONE root at a time, every path it names
  is still checked against that one with `validRoot`, and the set it may move within is the
  folders the user has open on their own screen (`roots.openRoots()`), read ON THE ASK since
  a tab closes without telling anybody. Nothing the phone sends widens anything: `POST
  /api/tab` is walled by that set and stores the PC's OWN SPELLING of the root, so the wall
  compares what it wrote, and a folder the PC does not hold is refused WITH A REASON,
  because the failure being removed is a phone pointing at a folder that is gone. The MOVE
  itself is the path a re-scan already took, factored out of `/pair` rather than written a
  second time (`move()`): the old root's grants and its running HLS job go with it, both
  belonging to a folder the phone has left. On the phone the tabs live behind a
  HAMBURGER at the head of the crumb row (owner, 2026-09-09, #112). The tab's name had a row
  of its own there first, which spent a whole row of a phone screen saying what the first
  crumb already says; three lines say "everything else is over here" in a language every
  phone speaks, and the drawer behind them is titled. It opens a SIDEBAR rather than a page:
  it comes in over the folder, the ground behind it stays visible and dismisses it when
  tapped, and it is capped at 320px so a tablet keeps the folder beside it, which is the
  whole point of a drawer. The panel is painted in `--p-side-flat`, the flat surface the
  context menus use, NOT `--p-bg`: several styles are translucent and a drawer you can read
  the folder through is a smear rather than a layer. The hamburger is in every directory and
  in none of the files: a file's screen is the file's. The list is READ FRESH every time it is
  opened, with a refused pick re-reading rather than only complaining, since "that folder is
  not open in Prism any more" is a list that has moved on. A tab that CLOSES is therefore no
  longer a dead end: that screen offers the list, and the scan-again screen is now what a
  phone whose token the PC has FORGOTTEN sees, and nothing else. Proved in the `phoneTabs`
  e2e, the one phone scenario launched with TWO roots open: what it asserts after a pick is
  not the header's text but what the LISTING answers, since a header that moved over an
  unchanged listing would be a lie nobody would catch.
  **THE DRAWER IS A LIST OF PLACES** (2026-09-14, #145; owner: "the sidebar mostly just
  looks unclean"). It was a title with the current root repeated under it in small type, a
  text tick in a column of its own on the left holding every name off the edge, and rows
  with no mark of what they were. Now: the title with one line saying what the list IS
  ("Folders open in Prism on the PC"), rows of the explorer's own height wearing the
  folder glyph, the name over its path, a DRAWN tick in the accent on the right of the
  tab the phone is on, and that row filled in the hover grey; the panel comes in from its
  edge over a scrim that fades, rounded on the side that faces the folder. The current
  root left the header because the ticked row already says it. `FolderGlyph` moved to
  its own file so the drawer and the explorer share one silhouette (since 2026-10-12 it is
  `FolderFill` in `components/icons/Icon.tsx`, the tree's own).
  **AND THE COG'S MENU IS A BOTTOM SHEET** (same change; owner: "the settings cog in
  videos on mobile is a bit flaky and small"). The desktop's popover is 230px of 30px rows
  at 12.5px hanging off the cog in the bottom corner, under a thumb. On the phone the SAME
  menu - same markup, levels and row names the e2e drives - lies across the bottom of the
  stage above the transport, rows at the 44px floor, text at 16px, switches a thumb can
  read, and no sticky `:hover` fill (iOS keeps one on the last row tapped, which reads as
  a row that stayed selected; the press is the feedback under `(hover: none)`). It is
  `phone.css` again and not a prop: `position: fixed` keyed on `data-player-menu` takes it
  out of the cog's box, and since the bar spans the stage's bottom edge the sheet lands in
  the same place whether the fixed box resolves against the viewport or against a bar that
  carries a filter. PlayerMenu gained MARKERS only (`data-player-menu`, `data-menu-switch`,
  `data-menu-knob`, `data-menu-slider`, `data-on`), guarded by `touch.test.ts` like the
  transport's. Measured in `phoneHls`: the sheet spans over 90% of the stage, its rows are
  44px, it sits above the transport, and it reads at 16px.
- **SIZED FOR A THUMB** (owner, 2026-09-08, after the same iPad session: the video controls
  and the rows in the file explorer are too small; #107). 44px is the PLATFORM FLOOR rather
  than a taste - Apple asks for 44pt and Google for 48dp - and a ROW is taller again (56px),
  because a list is scrolled past as well as tapped and a list of 44px rows under a moving
  thumb is a list you mis-hit. The hard part is the PLAYERS, which are the desktop's own:
  the sizing lives in `phone.css` under the marker on the phone's viewer stage
  (`[data-phone-stage]`) rather than in VideoView, AudioView and Transport, because a rule
  in a stylesheet the app window never loads cannot reach the app window by accident, where
  a `touch` prop threaded through three components is a second set of sizes to keep in step
  for ever and one default away from changing the desktop. NOT ONE SIZE IN THOSE FILES
  MOVED; they gained NAMES only (`data-transport-row`, `data-time`, `data-scrub`,
  `data-scrub-track`, `data-scrub-thumb`, `data-vol-readout`, `data-vol-pct`), because a
  stylesheet has to name what it scales and naming it by Tailwind class breaks the next time
  a class is edited for a reason that has nothing to do with the phone. That deal is what
  `touch.test.ts` checks, the way the installer's extensions are checked against
  `fileKind.ts`: every marker the stylesheet reaches for must still be rendered by the
  component that owns it, since a stale selector quietly returns the phone to desktop-sized
  controls with nothing red anywhere. The scrub THUMB is always drawn here, having appeared
  on hover, which is a state a touch screen never enters, so the one mark saying where the
  film had got to was invisible on the device that most needs it. Measured in the `phone`
  e2e under touch emulation rather than read off the stylesheet, since the numbers meet
  across three files: an explorer row at 56px and a transport button at 44px.
- **A TAP IS HOW A PHONE ASKS TO SEE THE CONTROLS** (owner, same session, #107). A MOUSE has
  a pointer on screen: you can see the transport has gone, you click to pause, and that is
  what the desktop has done since the beginning and still does. A FINGER has none, so with
  the chrome down on its 2.6s clock the first tap was always a pause nobody asked for - the
  tap every phone player on earth spends on bringing the controls back. So a tap with the
  chrome HIDDEN reveals it and the next one plays or pauses. The rule is the POINTER TYPE
  and not the page (`lib/tapChrome`, pure and tested), so a touchscreen laptop gets the
  phone's behaviour from its finger and the desktop's from its mouse, which is what each of
  them means; a pen counts as a finger, the reading the comic's page turn already makes, and
  an UNKNOWN pointer reads as a mouse, so a click carrying no pointerdown at all (Enter on a
  focused element, a synthetic click) does what it always did. Read at POINTERDOWN rather
  than at click, because between the finger landing and the click there is room for
  something else to wake the chrome and a click-time reading would then call a tap aimed at
  a bare picture a tap on the controls. Nothing swallows the click, so a double tap still
  goes fullscreen. The e2e taps a PLAYING film whose controls have hidden themselves and
  asserts the film is still playing, which is the assertion that fails the moment the rule
  goes: with `tapVerb` returning `toggle` the same tap pauses.
- **The phone searches, and the PC does the searching** (2026-09-07, #107). A page that
  browses one level at a time cannot reach a file three folders down, so a magnifier over
  the crumb row opens a field, and while it holds a query the RESULTS ARE THE LIST. The
  GRAMMAR IS THE DESKTOP'S AND SO IS THE READER: `GET /api/search?q=` answers the same
  `SearchResult` the sidebar's box gets, out of the same `searchFiles`, so every word in any
  order, "a phrase", `*.mp4`, `ext:py` and `-exclusions` are taught in ONE place
  (`shared/searchQuery`) and the phone implements not a line of it. It asks. The route NAMES
  NO PATH, which is what makes its wall the root's own - `validRoot(root, root)`, the check
  the `search:files` IPC handler makes and also the check that a tab still holds the folder -
  since the phone's own root is what is walked and there is nothing in a query that could
  name another; the shim's member is `searchTree` and it DROPS the root argument for the same
  reason, a root a page could name being a root it could ask to have searched. A hit is the
  name over the folder it is in, which is the only thing telling two files of one name apart;
  a folder walks there, a file opens. The debounce is the sidebar's own 180ms, so a phone
  typing at the same speed costs the PC the same walks. Next and previous page THE LIST THE
  FILE WAS OPENED FROM (`fileFromHit`, pure and tested): a hit lives anywhere under the root,
  so paging the folder's own files would step to something you were not looking at, and from
  another folder to nothing at all. One X, two steps, as every phone's search field behaves:
  it empties a field that holds something and closes an empty one, so clearing lands you back
  in the folder you were in. Proved end to end in `phoneDocs`, which is where the fixture tree
  has depth: `ext:py` answers the two python files in two different folders (no substring over
  a name can), and `buried.py`, three folders down, opens from its row.
  AND IT ANSWERS ON THE KEYSTROKE (owner, 2026-09-08: "search on mobile is very slow").
  MEASURED through the real route against a Downloads root the walk takes 73ms to 357ms, so
  the server was never the slow part: what was slow was the WAIT MADE VISIBLE, 180ms of
  debounce plus a Wi-Fi round trip with the list BLANK for all of it, every keystroke
  emptying the screen and filling it again. So the rows NARROW LOCALLY while the ask is out
  (`phone/narrow.ts`, pure and tested), with the desktop's own matcher rather than a second
  reading of the grammar, since a phone guessing at what `ext:` or a glob means would show
  rows the PC is about to disagree with. It is a preview and never an answer: only a query
  that CONTAINS the last one can narrow it, a narrowing that empties the list is treated as
  the guess it is (`*.mp` to `*.mp4` matches a different set entirely) and the last answer
  stays up, and the walk's reply replaces the lot. What says a search is running is an
  indeterminate line on the header's own bottom edge, which cannot move the rows underneath
  it. The debounce is still 180ms, so the PC pays for exactly the walks it paid for before.
  A SUPERSEDED WALK SAYS SO NOW (`SearchResult.superseded`): `dirList` stops a cancelled walk
  where it stands and answered with no hits, which is the same shape as "nothing matches", so
  the PC's own sidebar bumping the ticket while a phone was asking drew an empty list over
  rows that were right; the phone asks again and past a few tries leaves the rows it has.
  The e2e samples the hit count frame by frame across a keystroke rather than counting once,
  because the failure is a list that goes blank for a couple of hundred milliseconds and then
  fills again, which a single count taken afterwards is a race against.
- **Fullscreen is the host's, whichever one it has** (2026-09-07, #107, owner: "i cant go
  fullscreen in the player on mobile"). The phone page asked for `requestFullscreen` on the
  document element and nothing else, and WEBKIT ON AN IPHONE HAS NO ELEMENT AND NO DOCUMENT
  FULLSCREEN API AT ALL - not prefixed, not disabled, absent - so the button was dead on the
  device most likely to press it. `lib/fullscreen` (pure, tested) knows THREE ROUTES and
  takes the one this host has: the standard API on an element, the older prefixed
  `webkitRequestFullscreen` (an iPad, and WebKit builds that never took the unprefixed name),
  and the iOS-only `webkitEnterFullscreen` on the MEDIA element, whose state is
  `webkitDisplayingFullscreen` because there is no fullscreen element to read. THE PAGE'S OWN
  FULLSCREEN WINS wherever it exists, and that is a decision rather than an ordering accident:
  the OS player draws its own transport over everything, so on a host that can fullscreen the
  PAGE it would hide Prism's transport and the way back to the folder.
  Which is why the request still goes to the document element and a standard host behaves
  exactly as it did; the stage is held by a ref only so the element a viewer mounted can be
  FOUND for the iOS route, and it is looked for after every commit rather than once, since a
  film's `<video>` does not exist until `/api/play` has answered. BOTH SIGNALS ARE HEARD, the
  document's `fullscreenchange` and the video's own `webkitbegin`/`webkitendfullscreen`: on
  the iOS route the document never says anything at all, and a header that stayed hidden
  after the OS player's Done is a page with no way back. Everything there takes its elements
  as ARGUMENTS and reaches for no global (the document comes from `container.ownerDocument`),
  which is what lets all three branches be tested under node against hosts written to have
  one each, rather than eyeballed on one device. The e2e can prove only the STANDARD route,
  since the app's own Chromium has it: the `phone` scenario asserts the control is on a film
  and that the page goes fullscreen with its header. That press is also why the e2e's phone
  window is `fullscreenable: false` - granted its fullscreen, a parked window moves to 0,0 at
  the size of the screen, invisible at opacity 0 and still a sheet over whatever the owner is
  doing, which is the thing parking exists to prevent. Blink enters fullscreen either way.
- **A RELOAD COMES BACK WHERE YOU WERE** (owner, 2026-09-08, #107: "when i refresh a page it
  should reload me on that file, so if im in a subfolder and reload i should be there, or a
  movie i should be on the movie"). A phone reloads for reasons nobody chose - a background
  tab dropped, the Wi-Fi gone, the screen locked long enough - and every one of those landed
  back at the paired root with nothing open, which on a film four folders down is the whole
  walk again. The place is IN THE URL now (`phone/place.ts`, pure and tested), written with
  `history.replaceState` as it changes. ONE PLACE, NEVER TWO: either the folder being
  browsed (`?at=`) or the file being viewed (`?open=`), and the folder of an open file is
  the one HOLDING it, so writing both would leave a folder in the URL that reading it back
  can never use. REPLACE rather than push, deliberately: an entry per tap turns a folder
  walk into a stack the phone's own back button pops one step at a time, and a mis-tap then
  costs several presses to leave, where what was asked for is a reload that lands where you
  were. A PLACE BELONGS TO A ROOT, and the root moves now that the phone switches tabs, so
  it is checked against the root the phone is on NOW and dropped to that root when it is
  outside - the same fallback that covers a file since deleted and a folder since renamed,
  neither of them a screen worth meeting after a reload. The file is resolved from the
  FOLDER'S OWN LISTING rather than from a route of its own: the listing already carries the
  name, kind and size a viewer reads, and a file that has gone is simply not in it, which is
  the fallback with no second way to fail. It is done while RENDERING, the shape the
  search's `askFor` uses, since by the time an effect ran the folder would have had a frame
  of its own on screen first. The pairing code is still spent on arrival and never written
  back. `phoneTabs` reloads twice, once in a folder two levels down and once with a file open
  in it, and reads the URL as well as the screen: a page that remembered its folder somewhere
  else would pass the folder half and lose the file half.
- **THE CRUMB ROW'S LAST CHEVRON IS A BUTTON THAT DOES NOTHING** (owner, same day). The
  phone's crumbs copied the archive panel's trailing chevron, which is a deliberate decision
  there (2026-08-31) and wrong here: the phone's row sits immediately right of the UP
  chevron, so a chevron pointing back beside a chevron pointing on reads as a back and a
  forward button, one of which is inert. A separator belongs BETWEEN names, so the phone
  draws it between them and the desktop panel is left exactly as it is. The names themselves
  are drawn as things to press now - the accent on every folder above this one, full
  contrast on the one you are in - where dimming them all read as a caption rather than as
  the way back up. COUNTED in the e2e at three levels deep, which is where "one fewer than
  the levels" is more than one chevron: at one level it and "none at all" are the same
  number.
- **AND A FILE ROW SAYS HOW BIG IT IS** (owner, same day: a 126MB sample clip opened in the
  belief it was the 8.9GB film, and the row said nothing that would have told them apart).
  `formatBytes`, the desktop's own, so a size reads the same in both places rather than
  through a second formatter that rounds differently. A size of 0 draws NOTHING rather than
  "0 B": 0 is also what a file that could not be stat'ed carries, and a number nobody
  measured is worse than no number. Search hits carry no size at all (`SearchHit` has no
  such field), so their rows keep the folder they are in as their second line. The e2e matches
  a row's size against the desktop formatter's own shape, so a second formatter rounding
  differently would show up there.
- **A WINDOWLESS PRISM IS NOT A STATE PRISM CAN STAY IN** (2026-10-03, #265; owner: "prism
  suddenly stopped opening, not sure why, but that should never happen"). FOUND: a Prism
  launched from Explorer with an .mp4 was alive and idle 45 minutes later with NO renderer and NO
  window; it held the single-instance lock, so every later launch handed its file over and
  exited. No dump, nothing in the event log, not reproduced (5 launches of the same file got a
  window). The window is shown only once its page is up, nothing listened for the page dying,
  and the handoff only raised a window. So, for the class (`windowGuard.ts`, `crashBudget.ts`,
  wired in `createWindow` and `second-instance`): `render-process-gone` logs a line and RELOADS;
  the third death in 2 minutes REBUILDS the window (new one first, or the last window closing
  quits); the same run on the rebuilt window QUITS (a dialog, never under `--e2e`), which frees
  the lock. A page unresponsive for 45 s is restarted the same way; a shorter hang is only
  logged. A WATCHDOG shows any window not shown within 8 s and reloads a dead page. A SECOND
  LAUNCH makes a window if there is none and reloads a dead page before it raises, the files
  waiting in `pendingOpen` for the page to listen. The log is `window-crashes.log` in userData
  (64 KB, then `.old`). `crashReporter` runs with `uploadToServer: false`: dumps stay in
  userData's Crashpad folder, never uploaded. Only the window's own close clears `mainWindow`,
  and per-process IPC listeners are registered once, outside `createWindow`, since it can run
  twice now. The `neverWindowless` e2e kills the page (`forcefullyCrashRenderer`) through every
  path; `PRISM_E2E_CRASH_AT_START` and `PRISM_E2E_HOLD_RECOVERY` (E2E only) recreate the
  2026-10-03 shape and hold the reload so the watchdog and the handoff are proved alone.
  From the review: a death kills the page's shells and warm spares (`killAll`), since the
  reloaded page resumes its agents and an old pty would be a second, unseen Claude; from the
  SECOND death in a run (or after a rebuild) the page comes back WITHOUT its saved tabs
  (`crashBudget.strained`, logged `restore tabs=skipped`), or a tab that kills the page would
  kill it at every recovery and every later launch; a startup restore belongs to one page
  (`pageGen`, bumped per main-frame navigation and window) and an older run stops touching
  `pendingOpen` and `startupRestored`; a crash ends a pending hang timer; a launch during a quit
  or an install makes no window (a quit relaunches with the handed files, never under `--e2e`);
  `crashReporter` starts only once the single-instance lock is won.
- **A STALL IS READ FROM THE DIAGNOSTICS LOG, NOT GUESSED** (#322; owner, 2026-10-07: "implement
  some robust logging and debugging into the program especially to catch stalls for example in
  explorer or in general"). When the owner says "it stalled", run `npm run diag -- --app prism
  --since 10m` from a Prism Terminal checkout FIRST (schema: PT's `docs/diagnostics.md`). The log is
  `%APPDATA%\Prism\logs\diag.jsonl`, local only. `startDiagnostics` runs before every IPC
  registration (it wraps ipcMain) and stops LAST on the quit. A channel long BY DESIGN goes in
  `src/main/diagChannels.ts` under the rule written there; a crumb that can fire many times a second
  is `often` (Detailed only).
- **THE EXPLORER NEVER SHOWS A LOADING SCREEN** (2026-10-04, #271; owner: "I don't ever want to
  see that ... not even if you launch it from a restart of the PC, or it's your first time after
  installing the program"). Design, the owner's six decisions and what was measured:
  `docs/superpowers/specs/2026-10-04-explorer-never-loading-design.md`. The rules: a folder is
  answered with its NAMES (`listNames`) and sizes and dates follow as `browse:details` patches
  (`ViewerFile.size`/`mtimeMs` absent means unknown, never 0); the restore sends Explorer tabs
  FIRST with their cached or names-only listing and the rest in parallel, back in saved order
  (`restoreOrder`); the listing cache on disk (`listingCache.ts`, local fixed drives only,
  Settings > Explorer > Remember recent folders, on by default, Clear) is what the first frame after a
  reboot paints; the renderer's snapshots are app-wide, so a tab switch is a hit; a navigation
  keeps the old rows and shows only a 2 px bar past 300 ms (`usePendingHint`); no "Loading"
  text anywhere in the Explorer and none in the boot shell, which is a silent outline. Read
  ahead: hover, selection, parent, small folders' children, Quick access, two at a time, into the
  page's memory ONLY (the disk cache is the folders the user opened, as the README promises). A
  restore read of a tab's shown folder has 750 ms and the other tabs wait for the Explorer at
  most 500 ms: nothing slow (an offline share, a transcript scan) holds more than its own tab. The
  `noLoadingEver`, `coldLaunchCached`, `coldLaunchNoCache`, `newFolder2000`, `slowFolderHint`,
  `tabSwitchInstant` and `rememberFolders` e2e hold it; cold disk after a reboot is hands-on.
- **A FOLDER'S SIZE, ONCE KNOWN, STAYS ON SCREEN** (2026-10-13; owner: "fix some cache for the
  sizes so i dont see this calculating all the time"). Main already saved every size on disk
  (`folderSizeCache.ts`), but the Explorer threw away what it knew whenever a listing refreshed: a
  new folder array was a new key, every request was cancelled and every row went back to
  "Calculating…" (Documents was asked 137 times in a day, 127 cancelled). `useFolderSizes` now keys
  on the folders themselves and keeps the last size of every folder for the session (5,000 at
  most); a new viewport starts from those and refreshes in place, and a failed answer never hides a
  known size. "Calculating…" is only a folder never measured. The `sizesKept` e2e holds it.
- **NOTHING ON THE STARTUP PATH HOLDS A STDIN PIPE** (2026-09-22, #189; owner: "it currently
  takes about 2 seconds to load. what could be done to make it about instant"). MEASURED: 1,188 ms
  from process start to a visible window, 369 ms after this fix (usable 1,303 -> 477 ms); an empty
  Electron app is ~180 ms. One thing was 850-900 ms of it: the window-border helper was a resident
  PowerShell fed through a HELD-OPEN STDIN PIPE, and in Electron's MAIN process the first child
  started that way blocks the UI thread for ~900 ms (a second takes 4 ms; with `stdio: 'ignore'`
  the first takes 7 ms; plain Node 3-12 ms - so it is Electron's, not Windows' or Defender's). It
  started inside `showWindow`, and the first frame waited on the thread it blocked. Everything
  else was ruled out by measurement, so nobody has to redo it: main's own JS (156 ms vs 118 ms
  empty), the page's JS (~18 ms), fonts (single ms), IPC handlers (none over 20 ms). The border
  program is now `native/dwm/PrismDwm.cs`, compiled at BUILD time (`tools/build-dwm.mjs`, the Win+E
  helper's route) and started per change with NO PIPE; changes in one tick share one process.
  `startup` in the e2e fails above 800 ms to first paint (proved: 1,170 ms on the old helper, 356
  ms on this). A new child process on the startup path takes `stdio: 'ignore'` or goes after the
  first frame. How it was found (trace, profiles, the bare-Electron repro) is in #189.
  STILL OPEN, for "instant" rather than "fast": anything that starts a process cannot beat
  Electron's own floor; showing an already-running window can. That is the resident model, and it
  is the design question for Prism Explorer (#187). The `localStorage` preference shim
  (`lib/windowPreferences.ts`, a synchronous IPC per preference write) cost ~457 ms on a page
  RELOAD and nothing measurable on a cold start today; watch it.
- **AN IDLE PRISM SPENDS NOTHING** (perf review, 2026-10-28; owner: "look for stall points, things that
  use up too many resources"; findings in `research/prism/2026-10-28-performance-review.md`). The
  window is never throttled (media keeps playing), so every timer the page owns runs at full rate all
  day in a resident app. Now: the auto-hide chrome clock (`lib/autoHideChrome.ts`) runs only while
  there is chrome to hide; once gone it re-rendered the image viewer ~9 times a second for ever
  (`autoHideChrome.test.ts`); VideoView's 250 ms clock the same. A paused visualizer PARKS (no frame
  at all) and is woken by play, a resize or a style change, where it asked for every frame to read a
  rect (`lib/viz/vizGuards.ts` `idleFrame`). Image reads are CANCELLED when nobody wants them any more
  (`lib/imageLoader.ts`, a signal per caller, aborted 50 ms after the last one goes so a warmed
  neighbour is handed to the viewer that steps onto it; `imageLoader.test.ts`); the App's warm-up is
  keyed on the neighbours' paths, not on `view`. The PDF finds its page by binary search, not a rect
  read of every page per scroll (`pdf/pageAtLine.ts`), and its page refs are stable.
  `useFolderBrowsing` returns one object while nothing in it changed (the App's capturing key and drag
  listeners re-subscribed on every render). Logging stays as it was asked for ("keep logging as much as
  possible"): MINIMISED, the page beats every 2.5 s and sends every 2 s rather than 500/250 ms
  (`noteDiagBackground`, from main's window-state push), and main's `stallWatch` waits 10 s rather than
  2 s before asking for the stack, so a hung page is still caught (`stallWatch.test.ts`, `diag.test.ts`).
  And the `memory` crumb and `mem-high` finally run in Prism (`appMetrics` was never passed;
  `src/main/diagWiring.test.ts`).
- **Performance rules learned the hard way** (2026-08-26, all measured on this
  machine). MAIN IS ONE THREAD AND EVERYTHING SHARES IT: `execFileSync` there
  stops every window, every IPC reply, the terminals and the `fsmedia://` Range
  handler a playing film depends on. There is now none left - 7-Zip listing,
  member extraction, extract-all, the AES member path and the ass-to-vtt
  conversion all run through `execFile`. Same rule for big reads: the camera-RAW
  scan reads up to 40MB and does it with `fs/promises`. THE RENDERER MUST NEVER
  HOLD A MEDIA FILE: the waveform's peaks used to `fetch` the file and
  `decodeAudioData` the lot, which took the renderer to 7.4GB on a 2GB film and
  then threw (Web Audio cannot open an MKV at all); peaks come from ffmpeg in
  main now (`peaks.ts`), streamed, holding 160 running maxima and nothing else -
  2.9s for a two-hour film, cached, 179MB peak. The visualizer's drop analysis
  is the same shape and is capped at 15 minutes of audio. Cheap wins worth
  keeping: `readdirSync(withFileTypes)` and ONE stat per file rather than two
  took `dir:list` on System32 from 159ms to 11ms, and lazy-loading pdf.js,
  react-markdown and DocView alongside CodeMirror halved the launch bundle
  (3037KB to 1503KB). MORE OF THE SAME (2026-08-31): `dir:list` and
  `search:files` were `readdirSync` plus a stat per file, on main's one
  thread, up to 20000 entries per debounced keystroke - the exact thing this
  block rules out, left in place because it was fast enough not to notice on
  a warm local disk. They are async now, and the important part is that the
  OBVIOUS translation is a REGRESSION: measured on System32 (about 5000
  entries, median of five), sync 140ms, naive await 269ms, bounded-16 44ms.
  One await per entry is a round trip per entry; the win is the CONCURRENCY,
  and the bound is what keeps 8400 stats out of the same libuv pool the
  `fsmedia://` Range handler reads a playing film through. The search also had
  to learn to be SUPERSEDED: while it was synchronous it finished inside one
  keystroke and there was never a second walk in flight, so each call takes a
  ticket now and a stale walk stops where it is. And the biggest single win in
  that file was not the fs at all - `localeCompare` builds a fresh collator on
  EVERY comparison, so sorting 5000 names built 5000 of them: 23.3ms against
  0.5ms with one hoisted collator.
  MORE OF THE SAME (2026-08-28): the agent dot used to
  spawn a PowerShell and dump EVERY process on the machine, command lines and
  all, every 2.5s for as long as a terminal existed - 110KB of JSON a few
  times a minute to answer a question that changes twice an hour. It now asks
  only when a pty has PRINTED something since the last look (nothing can start
  or finish in a silent shell), backs off to 20s while the answer holds, and
  asks for "pid ppid" with the command line only where a broad prefilter hits:
  measured 110KB/214ms down to 7KB/155ms, on top of far fewer calls. A
  conversion nobody waits for is CANCELLED (`video:cancel` existed in main and
  was called from nowhere, so arrowing past a WMV re-encoded a whole film for
  no one), and the convert cache touches on a hit, so the film you rewatch is
  not the one evicted. The HEIC utility process stands down after a minute
  idle instead of living as long as the app; the shared AudioContext suspends
  when nothing is playing; the visualizer's frame loop stops once a paused
  picture has settled; and a cross-volume move copies with `fs/promises`
  rather than `cpSync`, which blocked every window for as long as it took.
  **THE MAIN PROCESS NEVER WAITS ON THE DISK** (owner, 2026-10-12, after the tabs.json freeze:
  "ok yes plan then go ahead"; plan `docs/superpowers/plans/2026-10-12-main-never-waits-plan.md`).
  163 synchronous calls in `src/main` were traced to their triggers: the 137 that ran while the
  user works (opening, listing, search, moves, renames, archives, media, subtitles, documents,
  window state, preferences, the listings index) are async now; window preferences and the
  listings index answer their `sendSync` from memory and write off main. What stays synchronous
  is startup, quit, worker code, a `sendSync` answer, the root wall's `canonical()` and adm-zip
  (whole-archive reads and writes; since moved to the zip worker, below), each with a
  `// sync-ok: <reason>`. `src/main/syncCalls.test.ts` fails `npm test` on any unmarked one.
  **MAIN NEVER STARTS A PROCESS ITSELF** (owner, 2026-10-27: "start looking at stalls and fix
  them"). Starting a process is synchronous on the starting thread, and #351 measured it taking
  main for 3 s; the startup freeze (4 to 5 s about ten seconds in, nothing in flight, still there
  in 0.119.1 with the terminal gone) lines up with the reg.exe, PowerShell and es.exe burst main
  made then. Every short-lived program (registry, PowerShell, Everything, ffprobe, thumbnails,
  subtitles, 7-Zip listings, "Open with" launches) now starts from one worker thread
  (`spawnWorker.ts`); what streams from a child says `// spawn-ok: <reason>`, and
  `spawnCalls.test.ts` fails on anything else. Every launch also profiled its first 30 s, and
  the profile of 0.119.4's startup freeze (3980 ms) was 4.6 s of `(idle)`: the block is in
  Electron, Chromium or Windows, not JavaScript, which is why the native trace below exists.
- **MAIN'S REMAINING STALL POINTS** (owner, 2026-10-28: "do a review of the app look for bugs, lingering
  code that should be changed ... look for stall points, things that use up too many resources"; review
  `research/prism/2026-10-28-performance-review.md` #9, #13 to #17, #28, #53, #54). (1) The wall remembers
  a resolved path for 2 s (`dirList` `canonical`, only paths that exist, bounded, cleared by Prism's own
  writes through `written`), resolves each path once per guard call, and an awaiting caller (fsmedia://
  and fsaudio:// Range requests, `folder:sizes-cached`, `folder:size`) resolves off main first
  (`warmCanonical`, `insideDesktopAllAsync`); the folder-size warm-up runs on local fixed drives only.
  `dirListCanonical.test.ts`. (2) `browse:cached` answers from memory, never the disk: the stored text of
  64 folders (4 MB) is held, read in after the index loads (pinned places first), kept by every put, async
  read and hover read-ahead; a folder not held misses and the async listing paints it
  (`listingCache.test.ts`). (3) Tab restore applies the history's rule to a tab's root, path and file: off
  this PC's fixed disks they are kept unchecked (`tabs.test.ts`). (4) A copy's landing rows are sent BEFORE
  anything is sized, then sized with lstat (links and junctions never followed) before the copy starts:
  sizing beside the copy was built here, but #455's paste loop landed first and kept the simpler order
  (`pasteCopy.test.ts`). (5) Streaming children start in the
  process worker too (`spawnStream`, stdout moved over in chunks, pause and resume reach the pipe): the
  audio sidecar (every seek) and the waveform's peaks so far; propsMedia, videoConvert, sevenZip, phone
  jobs and the Win+E launch still carry `spawn-ok` (`spawnWorker.test.ts`). (6) The worker moves a Buffer
  that owns its memory instead of copying it (a 256 MB decode no longer peaks at twice that). (7) A tail
  reads at most 4 MB a turn, skips a backlog past 64 MB with a reset to the last 2 MB, and a file shown as
  its tail follows from where that tail ended (`fileTail.test.ts`).
- **LOG AS MUCH AS POSSIBLE WHILE PRISM IS YOUNG** (owner, 2026-10-27: "i think its important to
  keep logging as much as possible in order to fix issues now that the app is in its early
  stages"). Four things, one PR: (1) the CPU profiler runs in EVERY session (`lagProfiler.ts`,
  `enabled: () => true`). (2) A `main-lag` of 1 s or more also dumps a Chromium trace
  (`nativeTrace.ts`): `contentTracing` records `toplevel`, IPC, mojo, GPU and loading events
  into an 8 MB ring buffer all session, and the lag stops it into `logs\lag-<time>.trace.json`
  (open in ui.perfetto.dev), named in the line's `trace`; one dump a minute at most, newest five
  kept (`nativeTrace.test.ts`). (3) Detailed logging is ON until the owner switches it off
  (`verboseByDefault`, a switch flipped in Settings is kept; the e2e keeps the quiet default;
  `diagLog.test.ts`). (4) The log keeps 8 MB a file, five files (`DIAG_MAX_BYTES`, was 2 MB).
  **CHEAPER AND SAFER, STILL ALWAYS ON** (performance review, 2026-10-28; owner: "look for stall points,
  things that use up too many resources"). The owner's log showed a dump of the 8 MB buffer take 6.2 s into
  a 43 MB file, main lagging 2.6 s during it and 8.8 s right after recording restarted, and a dump cut off by
  quit left a 13 MB `<guid>.tmp` that no prune matched. Now: a 2 MB buffer of `toplevel`, `electron`,
  `startup` and `navigation` (`ipc`, `mojom`, `gpu` and `loading` filled it many times faster and no dump
  needed them); one dump every 10 minutes; none within 30 s of an `fs-slow` line (the disk is the stall);
  none once quitting (`before-quit` stops it); recording comes back 30 s after a dump. A main-lag during a
  dump or within 30 s of one says `afterDump: true` and gets no CPU profile. Kept traces are capped at
  50 MB as well as five, and a leftover trace `.tmp` from an earlier session goes a minute after launch.
  The CPU profiler samples every 4 ms (was 1 ms) in 15 s windows (was 5 s): still 250 samples in a 1 s
  lag, a quarter of the interrupts and a third of the stop/start work. `nativeTrace.test.ts`,
  `lagProfiler.test.ts`.
  **THE TAB STRIP IS SAVED OFF MAIN** (owner, 2026-10-12: the app "stalled for like 5 seconds",
  first after an unpin, then on entering Downloads). A CPU profile of the owner's main process
  put every sample of a 3954 ms freeze in `writeFileSync` under `writeTabs`: the tab strip's
  20 KB save, 400 ms after any tab change, waiting on a busy disk. `tabs.ts` `tabsWriter` now
  writes it on libuv's pool and swaps it in with a rename; only the quit flush is synchronous,
  and a write that lands after a newer one is dropped. `tabs.test.ts` holds both.
  **ZIP WORK RUNS IN ITS OWN PROCESS** (owner, 2026-10-12: "handle this, create a plan then go
  ahead"; plan `docs/superpowers/plans/2026-10-12-zip-worker-plan.md`). adm-zip reads and
  writes a whole archive synchronously, so listing, previewing, renaming, deleting, adding or
  moving inside a zip froze main for as long as that took. Every adm-zip call that takes a path
  now runs in a utility process (`zipWorker.ts`, the HEIC worker's pattern; the logic in
  `zipOps.ts`, unchanged). Main's side (`zipClient.ts`) runs edits to one archive one at a
  time in order, holds a read behind an earlier edit of the same file, kills the worker after
  60 s idle, and rejects every pending job if it exits (the next job starts a fresh one). The
  Explorer's listing of a zip waits for a pending edit, since adm-zip rewrites the file in
  place. `zipClient.test.ts` and `zipOps.test.ts` hold it; the e2e `zipWrites` adds a 160 MB
  file and requires every IPC round trip during the write to stay under 200 ms (worst 58 ms
  over a 2.3 s write).
  **THE WALL RESOLVES A GRANT ONCE, AND A PROCESS IS STARTED OFF MAIN** (#351;
  owner, 2026-10-11: "big issues with stalls at the beginning of using the
  program, like entering the first folder, highlighting a file ... then it
  becomes smooth"). MEASURED with a CPU profile of main over the first 25 s on
  the owner's own profile: 3.6 s of it was `realpathSync`, from
  `validDesktopRoot` on every `dir:list` of the restored project tree, which
  resolved every one of 86 grants several times per call. Each grant (and each
  open root, `roots.ts`) is resolved ONCE when it is granted now, and a call
  resolves only the path it was asked about (`canonicalPath` /
  `withinCanonical`): 178 ms, main busy 5.3 s down to 2.4 s. The asked path
  is still resolved live, so a junction is judged by where it points; a
  granted folder later swapped for a junction stops matching its grant, which
  refuses. `desktopAccess.test.ts` caps the realpath count with 200 grants.
  The drive labels' PowerShell is spawned from a WORKER THREAD
  (`driveUsage.ts`): starting a process is synchronous on its thread, and the
  log showed main frozen 2.95 to 3.25 s with only `browse:drives` in flight,
  about every four hours. Read ahead was already two at a time; its slow
  `browse:prefetch` times were queueing behind the blocked thread.
  **A MAIN-LAG CARRIES ITS OWN CPU PROFILE, AND WHAT IT CAUGHT IS OFF MAIN** (owner,
  2026-10-12: "handle this, create a plan then go ahead"; plan
  `docs/superpowers/plans/2026-10-12-main-freezes-plan.md`). After the disk work left main,
  e2e runs still showed 3 to 10 s `main-lag`s with only finished IPC in flight, so the cause
  had to be caught in the act. `lagProfiler.ts` runs V8's sampling profiler (1 ms; 4 ms
  since 2026-10-28) in main from its own inspector session, in 5 s windows (15 s since 2026-10-28); a `main-lag` of 1 s or more writes the
  window holding it to `logs\lag-<time>.cpuprofile`, names it in the line, and a
  `lag-profile` line says how much was JavaScript and where (`lagSummary.ts`; a builtin
  such as `spawn` names its caller; the window named is the one holding most of the lag,
  since the rotation can fire after a block but before the detector's tick logs it,
  `lagProfiler.test.ts`). ON IN EVERY SESSION since 2026-10-27 (it was `--e2e` and
  Detailed logging only); the newest ten files are kept. The e2e's Stalls table prints the summary and copies the
  files to `.e2e\lag-profiles`; `diagLog` holds the chain end to end with a 1.3 s busy
  main. What the profiles showed, each fixed: (1) `spawn` of the DWM border helper held
  main 405 ms as a window was shown (`tabs`); it is called on every show, theme, maximize
  and fullscreen change, so `dwmHelper.ts` now starts it from one resident WORKER THREAD,
  still with no pipe (`dwmHelper.test.ts`: main never spawns). (2) The first document of a
  session held main 2.2 s (`document`, `doc:html` in flight), 1.9 s of it Node's module
  loader reading mammoth's files one by one, and the first sanitise 0.4 to 1.1 s loading
  the rehype tree (`seeThrough`); conversion and sanitising run on a document worker
  thread now (`docWorker.ts`, `docClient.ts`, gone after a minute idle), and
  `docClient.test.ts` fails if `index.ts` or an `ipc/` handler reaches a converter. After: `doc:html` still
  takes 2.1 s on a cold run, on the worker, and the same eight scenarios ran twice with
  no `main-lag` of 150 ms or more. NOT PRISM'S, left as they are: the terminal core's
  dictation engine starts its server with `spawn` on main (239 ms, `addressField`; the fix
  belongs in PrismTerminal's `core/`), and a 229 ms lag in `markTint` was all `(idle)`,
  outside JavaScript, at the same millisecond as a lag in the owner's own running Prism,
  so it was the machine or the window system, not either process's code (a plain Node
  process timing its own 50 ms tick beside a later full run lagged up to 241 ms too).
- **The band behind the transport** is a slider (2026-08-25, Settings > Media > Progress bar, Control band opacity):
  0-100%, opaque by default, which is the bar exactly as it always looked. Below
  55% the controls carry their own drop shadow, because at that point they are
  sitting on the film rather than on a band. The edge, outline and island styles
  ignore it: a hairline, a glow rail and a floating capsule are their own shape,
  and a band would make them a different style rather than the same one on a
  background. Stored as a NUMBER, and read back defensively - `Number(null)` and
  `Number('')` are both 0, so a naive loader would read "never set" as "fully
  transparent" and quietly remove the bar for everyone.
- **Fullscreen and the transport** (2026-08-25, three days of wrong guesses, so the
  findings are written down). The controls appeared on entering fullscreen and never
  again. They were NOT hidden: the DOM had them mounted at the right rectangle, opacity
  1, visible, inside the fullscreen element, with the pointer moves arriving in dozens
  per second - and a capture of that strip of the real screen showed only film.
  DirectComposition was presenting the picture and the page's own overlay never reached
  the glass. `--disable-direct-composition` is the fix (overlays alone were already off
  for the HDR pause-brightness bug and were not enough). MEASURED cost: zero dropped
  frames in 899 at 4K HEVC, and the acrylic styles composite identically with it on or
  off. Then the hide broke, three times over, all the same shape - something waking the
  controls the instant they hid: a cancellable timer that only had to miss one reset;
  the bar's own `mouseleave`, which fires when an element is REMOVED under the pointer;
  Chromium's `mousemove` on layout change under a STATIONARY cursor; and PlayerMenu's
  unmount reporting "closed" through the same path that pins the chrome open. So: the
  transport MOUNTS and UNMOUNTS (a layer taken to opacity 0 inside a fullscreen element
  is composited once and never repainted), it has no mouse handlers of its own, activity
  is heard on the WINDOW in the capture phase, and hiding is decided by a clock reading
  the last wake, the video's own paused state, and the bar's own `:hover`. Nothing that
  can be left stuck. Do not reintroduce a hover flag, a root-level onMouseMove, or an
  opacity fade in place.
- **The video's right-click menu** (2026-08-27, trimmed to the owner's picks):
  Next video, Previous video, PICTURE, Speed, Subtitles, Show in File Explorer,
  Copy path. Play/pause and fullscreen were offered and CUT - a click and a
  double-click already do them. Next/Previous follow autoplay's rule, the next
  file of the same KIND, stepping over photos and documents; the row greys out
  when there is none that way. PICTURE is fit to window (the default, and the
  way back), fill, stretch, and forced 16:9 / 4:3 for a file whose header lies
  about its shape; VLC's 1:1 was offered and cut, because on a 4K file in a
  small window it shows a corner of the picture and reads as a bug. The mode is
  per file and resets on the way in to the next. Speed shows the CURRENT rate on
  its row - one setting, the cog's slider being the other way in. Subtitles keeps
  auto-detection AND a manual "Add subtitle file…": main's dialog picks it, which
  is the consent that lets it be read from outside every root. Every row carries
  the tick column, ticked or not, so the labels line up, and `hint` is the
  SHORTCUT column - a sentence in it is a wall of text down the right-hand side.
  The COG still hides its subtitles section when there are no tracks: it is a
  list, while the menu is the one place that can add one.
- **THE COG CARRIES PICTURE, AUDIO TRACK AND SUBTITLES** (2026-09-13, #120; owner: on the
  phone there is no right-click menu on a film, so the pickers were out of reach). The cog
  is the one control both hosts share, so it gained the three things the menu had alone:
  Picture (fit, fill, stretch, 16:9, 4:3), Audio track (Default plus each track, only when
  the file has more than one - a list of one is chrome) and Subtitles, which is ALWAYS
  there for a video now, "Off" alone meaning none found: it used to hide itself when
  nothing was found, which on a phone with no menu to fall back on read as "not offered".
  "Add subtitle file…" is the PC's, being a file dialog. Next and Previous stay out, the
  audio player's cog is unchanged, and the right-click menu is exactly as it was. THE
  PHONE SWITCHES AUDIO BY STREAM, NOT BY SIDECAR: it has no fsaudio://, so a pick goes UP
  through VideoView's `onAudioTrack` to the phone shell, which asks `/api/play?audio=N`
  again - a track the file does not have is refused with 400, never handed to ffmpeg as
  an index - and the PC opens a job of its own for it (`jobId` includes the track). The
  player is handed the new playlist and KEEPS ITS PLACE through the session mark, seeded
  for the new url at render time the moment the answer lands, before the element loads
  it; the last answer stays up until then, so the picture never drops to "Preparing…".
  The shim remembers the chosen track per file (`chooseAudio`) so the players' own probes,
  which take a path and nothing else, ask for the same stream the shell did, and the
  probe's `tracks` carry no url on the phone because a track there is not a stream to
  attach but a playlist to swap. The Dolby fixture grew a second track (AAC, "Commentary",
  880Hz) and `phoneHls` picks it from the cog and asserts the src changed, the film plays,
  and it resumed at or after where it was.
  **A PICK MUTES THE PICTURE ON THE SIDECAR HOST ONLY** (2026-09-13, #137; owner: on the
  phone, switching to English went silent, Italian too, and nothing brought the sound back).
  `forceMute: track !== null` is right on the PC, where the picked track plays through the
  sidecar and the picture's own sound must stop, and wrong on the phone, where the pick IS
  the element's stream - so every pick was silence, the default's own language included,
  and the remembered track (#124) re-applied it on every reload. The mute is conditioned on
  the host now (`!onAudioTrack`), and `phoneHls` unmutes the element before the pick and
  asserts it is still unmuted after the swap.
  **AND IT IS SUBMENUS** (owner, same day, #122: "split into sub menus, not all in one big
  menu"). The top level is one row per setting - Speed, Audio track, Subtitles, Aspect ratio
  (the name the owner used; the menu's "Picture" is the same list) - each showing its CURRENT
  VALUE and a chevron, and opening its own list under a back row, YouTube's settings shape;
  a pick returns to the top, where the row now reads what was chosen. The three toggles
  stay top-level, being one tap each. Escape climbs a level and closes only from the top;
  closing forgets the level, so the menu reopens at the top. Speed's list is the presets
  with the slider under them for anything in between. The e2e reads the row values
  (`data-menu-value`) as well as the lists, since a row that said "Off" over a picked track
  would be the lie nobody caught.
- **Fullscreen is black, and read-only** (2026-08-28). The stage behind a
  fullscreen film paints `#000` whatever the theme says: the letterbox is part
  of the picture, so a light theme's paper-white bars or an accent-tinted
  ground are the app leaking into the film. Windowed, the theme is the theme.
  And nothing WRITES from a keystroke while fullscreen: Ctrl+Z/Ctrl+Y and the
  archive's F2/Delete are inert there, because the tree, the crumbs and the
  dialogs are off screen and a file change nobody can see is a change nobody
  meant. A visible click on a verb still works.
- **A covered window keeps playing** (2026-08-27, found in the owner's own log,
  not reproduced by any test here). Windows tells Chromium when another window
  COVERS this one; Chromium marks the page hidden - `document.hidden` true,
  `visibilitychange` fires - and its hidden-page media policy suspends playback
  a millisecond later, restoring it on the way back. It read exactly like a
  setting misbehaving, and the app's own "pause in background" was off the whole
  time. `--disable-features=CalculateNativeWinOcclusion` and
  `backgroundThrottling: false` are the fix: covered is not closed, and for a
  media viewer the sound is the point. Do not re-enable throttling to save
  background CPU without solving that.
- **Volume goes to 200%** (2026-08-27, VLC's ceiling), on a column that rises
  from the speaker button rather than a bar that grew sideways and shoved the
  time readout about. Two ways to the same place, neither a special mode: the
  column runs the whole way to 200%, and so does the WHEEL over the picture
  (VLC's habit, 5% a notch, in the video and the audio player alike). An
  on-picture readout - speaker, a bar to 200% with the 100% mark drawn on it,
  and the number - shows for any volume change and leaves after 1.2s, with ONE
  look at every level: no dimming, no colour change past 100%, because the bar
  and the number already say how loud it is. It MOUNTS and UNMOUNTS, like the
  transport, for the same fullscreen-compositing reason. Level and mute
  belong to the TAB for the session (`lib/tabs/tabVolume`): the same level follows
  you across the files you open in that tab, a new tab starts at 100%, a
  closed tab forgets, and nothing is persisted - the old single localStorage
  number was shared by every file in every window and came back tomorrow. Past 100% the ELEMENT cannot help - `HTMLMediaElement.volume`
  is capped at 1 by the spec - so `lib/audio` routes it through Web Audio:
  source -> gain -> destination, built ONCE per element and only when a boost is
  actually asked for, so an ordinary file at 80% never touches Web Audio at all.
  The visualizer taps that same chain (a second MediaElementSource for one
  element throws, and a second path to the speakers would play the file twice).
  The sidecar decoder's `<audio>` gets the same treatment, since for a Dolby
  film that element is the one making the sound. The elements are fetched
  `crossOrigin="anonymous"`, and `lib/audio` REFUSES to route one that is not:
  a media resource fetched without CORS taints its MediaElementSource, so the
  graph gets digital silence - and since an element can never be un-routed,
  turning the volume back down does not bring the sound back. Measured
  2026-08-27: peak 0 without the attribute, 0.129 with it. That was the
  200%-is-silent bug; refusing to route is a volume that stops at 100%, which
  is a far better failure than a film that has gone quiet.
- **A file comes back doing what it was doing** (2026-08-26, finished
  2026-08-27). A tab renders only while it is in front, so opening Settings - or
  any other tab - unmounts the viewer, and the player came back as a fresh
  `<video autoplay>` at time 0: a film you had deliberately stopped started
  again, and a film you were watching RESTARTED. `lib/playState` remembers, FOR
  THE SESSION ONLY, both halves - paused or not, and where it had got to - so
  autoplay is skipped for the first and the element seeks to the second. The
  persisted resume-position could not do this job: that one is films only (over
  10 minutes) and saves every few seconds, so looking away in the first moments
  of anything lost the place entirely. The session position therefore WINS over
  the stored one, and applies to a 5-second clip too. NOTHING AUTOPLAYS ON
  OPEN any more (2026-08-28, owner decision, overturning the older rule that
  opening a file meant playing it): a folder of films, and a window of
  restored tabs, used to start every one of them at once - you would hear a
  film from a tab you were not even looking at. Only a file that was ALREADY
  playing a moment ago plays when its element appears, which is `wasPlaying`
  rather than `!wasPaused` - the difference being the file nobody has played
  yet. The playlist records its own intent (`intendToPlay`) for the file a
  finished video hands over to, and for the menu's Next while you are
  watching; stepping away from a film you had PAUSED lands paused.
  That covers a genuine remount
  (a new file, a split view opening); the tab switch itself no longer is one,
  see below.
- **A FILE FROM OUTSIDE OPENS IN THE EXPLORER TAB** (2026-09-22, owner: "that file opened
  in prism's explorer rather than as a project ... a setting to choose whether to open files
  maximized or as previews ... default should be preview"; supersedes #172, which did it
  for the right-click "Open file" alone). A double-click, "Open with", the command line,
  Explorer's "Open file" and a file DROPPED on the window all take one route: main sends
  `{ explorerFile }` and builds NOTHING (`buildPayload` would register the folder as a
  root, which is a project's and a phone's), and `useExplorerArrival` brings the PINNED
  Explorer forward, then opens the file with the Explorer's own `openFile` - the call a
  Quick access pin makes, which grants the folder to the tab and walks there, so Back
  returns to where the Explorer was. Two steps because `openFile` acts on the tab in
  FRONT. Settings > Explorer > "View for files from Windows" (`prism.open.external`):
  PREVIEW (default) is the list with the preview pane FORCED ON showing the file; FULL
  VIEW is the file filling the Explorer. A project tab already open on that folder is NOT
  used (one rule), the pinned Explorer moves rather than a tab per file, and several files
  go one at a time so the last named is on screen. No switch on the command line: with
  every door taking the same route there is nothing to tell apart, so the registry
  command is unchanged. A FOLDER is unchanged ("Open as project"), and so is a restore.
  The e2e harness therefore opens a scenario's launch file as a SEEDED project tab in
  `tabs.json` (the state those scenarios test), not on the command line; `openInExplorer`
  drives the real handoff in both modes. The window drop is not driven by the e2e (a
  synthetic drop carries no OS file path); it shares `arrive` with the handoff.
- **A PICK PLAYS, A RESTORE DOES NOT** (2026-09-14, #139; owner: "when you click on a
  video or audio file it starts immediately; the only time it shouldn't is when you open
  up Prism"). The tree's click and the arrows have played since 2026-09-03; what still
  arrived paused was a file WINDOWS hands over - Explorer's double-click, the argv
  launch - because it came through the same door a restore does (`onOpenFile`), and the
  phone, where a tap opened the film and waited. Both are picks now: `arrive` in App
  records the intent for an arrival that is not a restore and not a folder, and the
  phone's Browser tells the viewer which file it was TAPPED onto (`picked`), against the
  one a reload put back, which lands paused as it always did. On the phone the intent is
  recorded at render time on the STREAM'S url - the playlist, which does not exist until
  `/api/play` has answered - and once per file, because a later url for the same film is
  an audio pick and the seed already carries whether it was playing. The 2026-08-28 rule
  stands where it matters: a restored tab's film sits paused, proved by `playOnOpen`,
  which relaunches with the film in a background tab and visits it. Whether a real
  iPad honours the attribute after a row tap is the device's own autoplay policy; the
  e2e proves it in Chromium.
  THE EXPLORER'S PICKS PLAY TOO (#207; owner, 2026-09-23: "when you click a audio or video
  file it autoplays, the only times videos and audio shouldnt autoplay is when you open prism
  and a video is already in one of the tabs"). The Explorer's own opens never recorded the
  intent, so a film clicked or double-clicked there, a pin, a menu Open sat at 0:00.
  `useFolderBrowsing.openFile` records it now unless told `play = false`: the preview TOGGLE
  (it shows the selection, paused) and "Open full view" (it keeps what the pane was doing).
- **MUTE, VOLUME AND SPEED CARRY TO THE NEXT FILE** (#207; owner, 2026-09-23: "if the user
  mutes audio or sets speed to be 0.5 and then clicks a new video, those settings should be
  kept ... maybe the user wants to just look at videos without audio, or dissect videos in
  half speed"). Speed joined the tab's session level (`tabRate` in `lib/tabs/tabVolume`): the
  player is keyed by KIND, so a photo or a track between two films remounted it at 1x. Same
  scope as the level: this tab, this session, never on disk.
- **THE PREVIEW PANE SLIDES ON ITS TOGGLE** (#207; owner, 2026-09-23: "the same way you made
  an animation for the sidebar in explorer, do the same for the preview window").
  `hooks/usePreviewSlide` runs it in phases, because the pane's grid column exists only while
  it is open: an opening lays the column out at 0px once the file is on screen and widens it
  a frame later; a closing keeps the pane laid out (`out`) while it narrows. The list's
  column, the viewer App lays over the slot and its action bar tween together
  (`data-preview-sliding`, `workspace.css`), the contents frozen at their open width. Only
  the toggle slides; a tab switch, a drag or a resize lands at once.
- **A tab you leave keeps playing** (2026-08-27, `lib/mediaDeck`). A tab
  renders only while it is in front, so walking to Settings or another folder
  stopped the film. Handing the sound to a second, hidden element was tried
  first and REJECTED by ear: it pauses and unpauses at every switch, because
  the only seamless answer is for the ELEMENT ITSELF to survive. So every tab
  holding a video or a track keeps its player mounted and the strip only
  decides which one you SEE - measured: the same element, zero `pause` events,
  the clock never stalling, across Settings and a second tab. A hidden player
  owns no keyboard (`useMediaControls`'s `keys`), draws no chrome, no menu, no
  visualizer and asks for no waveform; it does not autoplay the next file
  either, because a tab you are not looking at does not choose what plays.
  Two rules keep it honest: the deck order is APPEND-ONLY (removing a media
  element from the document pauses it, and React moves DOM nodes when a list
  reorders, so a deck following the tab strip would stutter on a drag), and
  there is a CEILING of 4 players, the oldest background one standing down,
  never the active one. It does mean two films can play at once if you left
  one running and go to another - which is what "keeps playing" means.
- **Pause in background** (2026-08-26, the transport cog): one toggle, off by
  default. Away means another window has the focus OR Prism is minimised -
  PotPlayer's "Pause playback when focus lost", which covers VLC's
  "Pause playback when minimized" too. The signal comes from MAIN over
  `window:state`: Electron does not mark a minimised window hidden, so
  `visibilitychange` never fires and `document.hidden` stays false however small
  the window gets. It resumes only what IT paused (`lib/backgroundPause`, pure
  and tested), so a film you stopped by hand stays stopped.
- **A new file is a new file** (2026-08-28). The viewer is keyed by KIND, not
  by path, so arrowing through a folder never remounts `useMediaControls` -
  and three things quietly outlived the file they belonged to: only the FIRST
  long video in a tab ever resumed (`resumedRef` stayed true), one unplayable
  file left its error overlay across every file after it, and the element came
  back at 1x with the new src while the cog still read 1.50x. The reset is
  done while RENDERING, not in an effect: by the time an effect runs, the new
  file has already had a frame with the old one's error on top of it. Speed is
  re-applied rather than cleared - it is a preference about watching, not
  about one file.
- **Playback position** (`useMediaControls`, tuned 2026-08-24 by owner decision): media longer
  than 10 MINUTES reopens where you left it, silently - no prompt, no banner. Anything shorter
  never is, which is why a 5-second clip always starts at the start. Stopping inside the LAST
  MINUTE counts as watched: the position is neither saved nor restored there, so a film never
  reopens into its own credits. Video and audio share the rule, so audiobooks and long mixes
  resume and songs do not.
- **"Open file" and "Open as project" in Explorer's menu** (2026-08-24, `shellVerb.ts`;
  RELABELLED 2026-09-19, #167, superseding "Open in Prism" and "Open Prism here". Owner:
  "Prism is split now into File Explorer and Project ... maybe just say Open As Project ...
  and don't have any of them mention Prism, you can see that by the logo." Decided the same
  day: a folder AND a folder's empty space read "Open as project", a single file reads "Open
  file". The icon beside the row is Prism's own, so the name was being said twice, and what
  the row never said was what the click DOES. The registry KEYS keep the name `OpenWithPrism`:
  a key is an identity, not copy, and renaming it would orphan every entry already written
  and fall out of step with the uninstaller. Only the words moved; how an arriving file or
  folder is ROUTED is untouched and is a separate task. A REGISTRATION THAT SURVIVES IS
  RELABELLED AT LAUNCH (`relabelVerb`). The verb is on by default, so nearly every machine
  carried the old text. An ordinary upgrade gets the new words without it: the old
  uninstaller deletes the three keys and the startup repair writes them back, current by
  construction. But everything else here leaves a WORKING verb alone, so keys that survive
  into the new build (an uninstaller skipped or cut short, an exe replaced in place) would
  keep the old text for ever. The rule is narrow: the entry must be ON (all
  three keys), pointing at THIS exe, and its label READ and found different; then the LABEL
  VALUE ALONE is rewritten, never the command, never the icon. `reg add <key> /ve` CREATES a
  missing key, so without the "on" check a relabel would put a dead, commandless row into
  the menu of somebody who switched the verb off. Never in dev, under `--e2e` or from a
  preview (`automatic`, the same gate the startup repair has), never for somebody who said
  no, once per launch rather than on every Settings open (six reg.exe spawns), and inside
  the setting's one queue so an explicit off cannot race it. It compares against the CURRENT
  label rather than a list of old ones, so the next rewording needs nothing new.)
  ON by default since
  2026-08-31 (owner decision), switched in Settings > Explorer > Add to the Explorer menu. THE ONE FACT STORED IS THE NO
  (`shell-verb-off` in userData, since 2026-09-03, #93; corrected here 2026-09-20, this
  passage still described the first design): a default that reapplied itself over a NO
  would be a setting that lies - turn the verb off and it would be back tomorrow. The
  first design stored the YES ("the default has been applied") and that was the wrong
  fact, because every upgrade runs the old uninstaller, which deletes the keys, while
  userData survives: the marker said done over an empty registry and the verb had to be
  switched on by hand after every build. Without a NO, an absent verb is simply put back
  at launch. Never in dev and
  never under `--e2e`, where `app.getPath('exe')` is a throwaway build and writing those keys
  would repoint the real installed Prism's verb at it. A classic HKCU verb under `*`, `Directory` and (2026-08-25)
  `Directory\Background`, where it takes `%V` rather than `%1`
  (which is empty on a background click) - per user, no
  elevation - added and removed with `reg.exe` (argv only). A FOLDER handed over this way
  roots a project tab and then obeys "New projects show" - the folder browser (the default
  since #148), the first file, or a terminal. That setting was "New tabs show" and was
  shared with the + until #148, since when the + and Ctrl+T always open an Explorer tab;
  main's argv reader used to demand a FILE, so the folder verb was present
  and did nothing (fixed 2026-08-25). A folder a tab already holds switches to that tab. On Windows 11 it appears under
  "Show more options", because the short menu is built from IExplorerCommand COM handlers and
  those need a registered DLL; the hint in Settings says so rather than leaving it to be
  hunted for. The switch reports what the REGISTRY says, not what was clicked, and a verb
  pointing at some other copy of Prism reads as off so turning it on repoints it here.
- Keyboard-first controls; remember window size/position.
  **IT OPENS AT FILE EXPLORER'S SIZE, AND NEVER MAXIMIZED** (owner, 2026-10-11: "i dont love
  that it opens fullscreen, it should be the same size as file explorer"; asked, chose "Explorer
  size, remember resizes"). `src/main/windowSize.ts`, pure and tested: nothing saved is File
  Explorer's own 933 x 756 DIP (MEASURED from a fresh File Explorer window on the owner's
  machine the same day; it was 1164 x 698), a size the user dragged to comes back with its
  place, the saved maximized flag is never restored, and a saved size filling 95% of its work
  area both ways counts as nothing saved (the owner's was 1711 x 914 on 1707 x 912). This also
  ends a known e2e leak: a scenario that left the shared profile maximized made every later
  launch maximized.
  **THEN WIDER, AND SLIMMER SIDE PANELS** (owner, the same day, after trying it: "it should be
  wider then this as a default size and the left and right sidebar should be shrunk a bit on
  default size, just a bit though like 10-15%"). The first window is 1240 x 756 (Explorer's
  height, wider than its 933). The panels' unsaved widths in
  `src/renderer/src/hooks/useExplorerWidths.ts` are the ones the owner then settled on, read from
  the saved state of that window ("almost perfect, i extended the sidebar on the left
  slightly, so my ui now if its capturable is perfcect"): places 190 (was 210; 145 on a narrow window, was 160),
  the preview 26% of the row (322 of 1240; was 40%), capped at 630 instead of 720. A width the
  user dragged a panel to is unaffected. `windowSize.test.ts` holds the size.
- **Resident single-instance model**: one process; opening another file hands off to the running
  window so it appears instantly (mitigates Electron cold-start). The window is RAISED past
  Windows' foreground lock when it appears and when a file is handed to it (2026-08-28):
  `show()` and `focus()` only ask, and a process that did not have the foreground can be
  refused - the window is drawn but not activated, and the user's first click is then spent
  activating it instead of pressing what it landed on. The brief always-on-top is the
  documented way past that, and it is dropped in the same breath.
- **Update chip** (title bar, right of the file name): one shape for every state, and it never
  changes width. Only shown when an update exists. It WAS the progress bar, filling with accent
  from the left (owner pick from 12 mockups, 2026-08-24); that is SUPERSEDED:
  **IT IS FILLED IN THE ACCENT, AND THE UPDATE WINDOW STAYS FOR THE INSTALL AND DRAWS THE BAR**
  (2026-09-20, #178, the core's #32; owner: "have the update available button be accented
  colour. and when you click install keep me with the panel open and have the progress bar
  straight there, kind of like the way extract works for zip files in prism"). The chip is one
  label at one width, filled with `--p-sel-bg` (the accent moved until `--p-on-accent` clears
  4.5:1; the raw accent is only held to 3:1). The window's track is always in the layout and
  only fades in, the archive panel's own rule: `updateWindow` samples the box every 25ms through
  a whole install and it never changes size. While it runs the USER cannot put it away; Cancel
  cancels the DOWNLOAD (`update:cancel`: one AbortController per run in main, passed to fetch
  and the write, the partial installer removed with its temp folder) and is disabled once the
  installer has the file. A cancel says nothing; a failure or a preview's end is said on the
  status line IN the window (Close / Install again), and the line under the chip survives only
  for an ending with the window hidden. Do not rebuild the chip-as-progress-bar or a window
  that closes on Install. THE NOTES ARE SORTED UNDER HEADINGS (same day; owner: "headers bug
  fixes, new features, so on... not like a git commit", "dont have the changelog inside a
  container", and of the "This is a preview" line, "dont show this text"): the core's
  `shared/releaseGroups` files the parser's plain strings under New features / Improvements /
  Bug fixes / Under the hood, takes off a commit-type prefix and the trailing "(#31)", and the
  list sits on the dialog's own ground with no box. It only moves and trims strings; the
  plain-text rule below is untouched.
  IT LEADS THE BAR'S RIGHT-HAND GROUP (2026-09-20, #179; owner: "update button in prism should
  be the left most button, right now it has the remote button to its left"): chip, then More
  (Tools until #272), then the pencil and the cog. Tools was built to its LEFT (#104) and that is
  superseded. The chip is the one control there that comes and goes, and between two that stay
  its arrival moved More sideways; at the head it takes room only from the file's name, which truncates.
  `updateWindow` measures the order off the boxes.
  **A CLICK OPENS THE UPDATE WINDOW, IT NO LONGER INSTALLS** (2026-09-19, #168; owner: "when
  you click the Update badge, it opens like a pop window, which shows the change log or like
  patch notes for the new update, and then you can choose cancel or install"). This SUPERSEDES
  the click-to-install of "in-app update check against GitHub Releases (click to install)":
  until now a click downloaded an installer and quit the app with nothing said about what was
  in it. The chip, the window (`UpdateDialog`), their reducer (`updateFlow` / `useUpdateFlow`)
  and the notes parser are **prism-term-core's**, the same in Prism Terminal (owner, same day:
  "yes keep the core"); a chip or a dialog written here instead of there is a fork. The core
  chip was built to keep THIS bar's rule, and found that the old inline chip did not: the
  shape was one but the WIDTH was not, since the pill was sized by a label that went from
  "Update 0.56.0" to "7%". Every label is laid out in one grid cell now and only the one that
  applies is visible (one label only since #178, which is the same rule kept more simply);
  `updateWindow` samples the width through a whole install, left edge never moving. What is
  PRISM'S OWN:
  - **Where to look**: `src/main/update.ts` (the repo, the installer's name, the other-windows
    guard). It returns the release BODY as `notes`, RAW, only the head of it
    (`MAX_BODY_CHARS`), anything but a string read as no notes.
  - **THE NOTES ARE PLAIN TEXT, NEVER HTML, NEVER MARKDOWN, NEVER A LINK.** They are text off
    the network shown in a window that can reach `window.prism`. `parseReleaseNotes` reduces
    them to strings and the dialog prints each as a text node; there is no markdown renderer
    and no `dangerouslySetInnerHTML` on this path and there must not be. `updateGuard` hands
    the real page a hostile body (img onerror, script, iframe, anchors) and asserts the DOM:
    no such element, the handler never ran, no url and no "by @" printed.
  - **THE GUARD, UNCHANGED.** Install in the window comes to App's `installGuard` before a
    byte is downloaded, and that is the path the chip's click always took: unsaved text first
    (`close-dirty` with `then: 'install'`, 2026-08-28), then `leave('install')` for an agent
    that is mid-answer (`close-window-agent`), and main still refuses while anything is
    dirty. The core hands the guard a `start`; never calling it is the cancel. The agent
    question reads "Stop the agent and install the update?" / "Install and restart" now (the
    core's wording): it used to borrow "close the window?", a question about something the
    user did not ask for. ONE QUESTION AT A TIME: any `ask` raised while the update window is
    up hides it, because a question mounted under it took the focus where nobody could see it.
    Since #178 that is `useUpdateFlow`'s `covered` argument: it is the ONE way the window leaves
    mid-install (the host's, never the user's), and a running install's window comes back when
    the question has gone.
  - **`--preview-update`** (owner: "I would want to see how the Update banner looks in both
    apps ... make like a fake update"): the core's fake offer, announced at once, in the
    INSTALLED app too and on a SECOND launch into the resident one (only when nothing real is
    on offer). What the flag promises and `updateWindow` holds it to: never the network, never
    a download, never an installer, never a quit; Install runs a fake progress and ends on
    "Preview only: nothing was installed", and it asks none of the guard's questions, because
    it closes nothing. Main decides by what IT offered (`pendingUpdate.mock`), never by the url
    the page sent. An unpackaged build previews without the flag (this replaced the inert mock
    chip, which read "Update 43.2.0": `app.getVersion()` is Electron's under `electron
    <script>`, so the version shown is package.json's, over `app:version`). Under `--e2e`
    there is NO chip without the flag, and nothing asks GitHub (`updateQuiet`).
  - Two things the e2e found on the way, both older than this change: **Settings closed under
    a modal on the same Escape** (its capture-phase listener was registered first and
    `stopPropagation` does not silence a sibling listener on the window; it yields to
    `[role="dialog"][aria-modal="true"]` now, NOT to `data-owns-escape`, which things under
    the page wear too), and `Dialog`'s key listener re-registered on every render, which
    Prism Terminal MEASURED losing an Escape about one run in five; it registers once and
    reads the latest `onCancel` from a ref.
  `updateWindow`, `updateGuard` and `updateQuiet` are in `npm run e2e:ui`, runner-safe
  (the agent is a shell speaking through its title, and the poll's first answer is WAITED for,
  not slept for: it arrives seconds after a spawn and takes a titled session's state with it).
- **One icon per kind** (2026-08-30, #74): the ProgIDs used to point `DefaultIcon` at
  `Prism.exe,0`, so a .zip and a .mkv opened with Prism were the same picture in Explorer.
  Each now has its own .ico in `resources/icons`, generated by `tools/icons/build_icons.py`.
  They keep the NEAR-BLACK TILE (owner pick over a bare glyph, 2026-08-30): the tile carries
  its own contrast, so one icon reads on Explorer light and dark alike. That is not a small
  point - `tools/icons/compare.py` puts four treatments on both grounds, and a BARE white
  glyph is invisible on light mode, so dropping the tile would have forced a palette change
  as well. Every size is DRAWN at that size, never downsampled from one big render, and the
  glyphs are laid out in sixteenths of the tile so a 16px frame lands on whole pixels rather
  than wherever LANCZOS puts it. 16px is the size that decides it: details view is what most
  people look at all day, and it is the frame every mockup round was judged on. ROUND EIGHT
  (2026-08-31) settled the three that had not been: code is stepped indent bars now (the
  chevrons were legible but every editor on the machine draws them), document is a
  folded-corner page (what shipped before was marked `provisional` in the source and had
  never been chosen), and comic is an open book - drawn for the document column and picked
  for this one, which is why nothing collides. The code glyph carries THREE bars and not
  four, measured not assumed: at 16px four leave a 1.1px gap and a light bar on a near-black
  tile blooms across it, so the top two merged into one smudge. `tools/icons/round8.py` keeps
  every candidate and `mockups.py <round>` renders the comparison page they were picked
  from. ROUND TEN (2026-08-31) re-cut ARCHIVE: three thick layers now, belted. The belt is
  the lesson - round nine laid a strap OVER the layers and it read as a vertical line on top
  of the icon, because it had no relationship to the shape underneath. At icon scale the only
  depth cue that survives is SILHOUETTE, so the channel is CARVED: the glyph is drawn on its
  own layer and the channel sets that layer's alpha to zero, which makes the near-black tile
  show through as a real hole. A shadow, a gradient or a highlight edge would have been a
  grey smudge at 16px. The belt carries the one indigo now that the top layer has given it up.
  **AND THEN IT GREW** (2026-08-31). MEASURED against Explorer rather than adjusted by
  eye: in one column of the owner's own screenshot Adobe's .pdf glyph is 36px tall and our
  .cbz is 30px, which with our page at 13/16 of its frame puts that frame at 36.9px - so
  Adobe filled 97.5% of the same box and we filled 81%. A page icon beside a page icon is
  exactly where a sixth of a difference reads. The page is 11 by 15 now (96% of the
  frame's height, 73% of its width, against 85% and 67%), and it is WHOLE UNITS rather
  than the 12 by 15.6 that would have held the approved 0.769 ratio exactly: a fractional
  edge lands on a half-covered pixel row at 16px, which is the frame that has to be crisp.
  11:15 is 0.733, which is CLOSER to the owner's own reference pair (0.761 and 0.715) than
  the 0.769 it replaces. `PX0` stays at 3.0 on purpose - the chip overhangs to its left,
  and a page centred at 12 wide would have forced that overhang to halve to stay on the
  frame; growing rightward and downward keeps it whole, and the composition's own centre
  moves from 6.9 to 7.4 against a frame centre of 8. Everything written against the old
  page is carried onto the new one by `round12.on_page`, so the chip, the glyph boxes and
  the band all scaled with it and nothing had to be re-eyeballed. The lesson is the FIVE
  COPIES: `P = (3.0, 2.0, 13.0, 15.0)` was written out in round15, 16, 17 and 18 and the
  comic's fold in five files, so changing round12 alone would have left the comic's
  artwork filling the old rectangle while the page grew underneath it - silently, since
  nothing errors. They read round12 now. The archive is a landscape container with its own
  box and grew separately, by less: it was already 88% of the frame's width where the page
  was 67%, so what it lacked was height (75% -> 81%).
  **AND THE SAME ICONS ARE IN PRISM** (2026-08-31, owner ask: the sidebar was "so
  colorful"). `tools/icons/svg.py` replays the very functions that draw the .ico frames
  into a path recorder, so the sidebar and Explorer cannot drift. Three layers: the page
  in the ink, the fold and chip and mark in the BACKGROUND BEHIND THE ROW, then the
  detail inside the mark punched back in the ink (the clapperboard's stripes, the splat's
  core; only those two have that layer). The middle one is the whole contract - wiring it
  to a panel token looks perfect in every screenshot of an unselected tree and is wrong
  the moment somebody clicks a row, where the icon then carries a rectangle of panel
  colour across the accent fill. A one-path `fill-rule="evenodd"` variant that makes those
  real HOLES was built and NOT taken (owner pick): under evenodd a hole straying outside
  the body is one crossing rather than two, so the chip loses its overhang. The nine
  FileKinds map onto the seven icons by Explorer's own table (`Prism.Text` -> the code
  icon), so a .ts in the tree and the same .ts on the desktop are one picture. The colour
  is `--p-tree-file`, and it resolves to WHITE or to a NEAR-BLACK, whichever the style's
  own ground takes (owner instruction, 2026-08-31). It is measured, never read off the
  mode flag - a custom ground is whatever somebody made it - and it takes the BETTER of
  the two ratios rather than testing a midpoint, since two colours either side of a
  midpoint can both be poor. What it replaced was a 0.38 dimming of the theme's text,
  which is a mid-tone by construction and so could never be either end. The dark end is
  NOT #000000 (owner: "a bit less black"): it is the ground's own colour carried 86% of
  the way down, which softens it and picks up the paper's temperature in the same move -
  Linen resolves to a warm #232221, Frost to a cool #222323 - and still measures
  14.3-15.2:1 where pure black measured 18.9-20.3:1, so nothing was bought with
  legibility. White stays white on dark grounds, which is not what was complained about.
  The Settings picker still WINS - the rule is the default, not an override, or the
  control would be one that does nothing - and the icons need no light/dark switch of
  their own, because a light style resolves the token to the dark end by itself. And
  the chip carries THE FILE'S OWN EXTENSION (owner instruction, same day): seven icons
  cover a hundred-odd extensions between them, so ZIP against RAR is what the chip is FOR
  and an empty one is just a black bar. It is TEXT rather than outlines, set in the app's
  own face, and its size comes from a table keyed by CHARACTER COUNT - two and three keep
  the full size, and only a WEBM-length one steps down, measured against the widest glyph
  rather than a typical one. A file with no extension (`Dockerfile`) draws no label; the
  chip is drawn either way. Archives lost their amber with the rest,
  and the tree stopped showing WINDOWS' association icon for them - that was the colourful
  thing - while the archive VIEW's header keeps it (#68), because there the box is
  introducing itself.
  **THE SETTINGS CONTROL IS A SWITCH OF ICON SETS, NOT A COLOUR** (2026-09-01, #80).
  "File icons" used to be a colour well, and one arbitrary tint over every kind is a
  narrower thing than choosing which icons you get. It offers MONOCHROME - the measured
  white-or-near-black above, unchanged - and COLOURED, a preset per kind (archive
  `#8b8be2`, audio `#69b485`, code `#464646`, document `#6060ff`, image `#ff8080`, video
  `#5384df`, all on a `#1b1d22` label band bar code's `#000000`). TWO COLOURS ARE PICKED
  PER KIND and everything else is DERIVED: the mark and the label text are white or black
  by the same better-of-two rule, so no pick can make an illegible icon, and `hi` is
  always the page, being the knockout inside the mark. Resolved in the EMITTER rather than
  the app, because the picks are presets and the app would recompute the same seven
  answers on every tree row. Two values deliberately escape the rule: CODE's mark is dark
  by owner instruction (the rule says white at 9.44:1; dark measures 2.22:1) because a
  code file is a dark editor, and COMIC keeps its Explorer scheme - whose own pink splat
  measures 1.00:1 against its own page, working there only because the sunburst sits
  between them, so in-app it is cream at 3.42:1. The arbitrary `fileIcon` went with the
  picker that set it: a colour nothing can reach and no control can clear is worse than
  the rule it would override.
  THE BAND IS THE THING THAT BREAKS. `ko`'s band OVERSHOOTS the page by 0.6 units so its
  antialiasing lands clear of the page's rounded bottom corners - two identical curved
  edges painted one over the other leave a pale fringe, the page's edge pixel being part
  ink and the band's part background. That is invisible only while the band is painted in
  the ROW's background, which is exactly what monochrome does; give it a colour of its own
  and the same overshoot reads as a LABEL WIDER THAN THE ICON. So the emitter ships both,
  `ko` overshooting and `band` clipped, and the e2e measures the boxes rather than trusting
  it. THE LABEL FLIPS WITH THE BAND for the same reason: monochrome sets it in the ink
  inside a background-coloured band, coloured sets it in `text` inside a coloured one, and
  leaving it on the ink is ink on ink.
  And `iconPaths.ts` is WRITTEN BY `svg.py` now (`python tools/icons/svg.py`). It was a
  hand-run slice of that script's stdout kept in a scratchpad, which is how a generated
  file ends up hand-edited.
  A LAYER IS ONE PATH OF SEVERAL SUBPATHS, and under the default nonzero fill rule two
  subpaths wound OPPOSITE ways cancel where they overlap. The quarter note is exactly that
  overlap - a stem rectangle sitting on a head ellipse - and the emitter drew rectangles
  clockwise and ellipses anticlockwise, so the note came out with a quadrant punched out of
  its head, on a shape that is solid in the .ico the very same functions draw. Every shape
  the emitter writes winds clockwise now. `tools/icons/repick.py` is where the page COLOURS
  are chosen: it splits the shipped renderer into a tintable page and an ink overlay, so a
  live recolour is what the .ico would hold rather than a mock-up of it, and it reads the
  contrast against BOTH Explorer grounds while you choose - a colour can look right on the
  one you happen to be picking on and vanish on the other, which is what the white image
  page does at 1.07:1 on light.
  ONE COLOUR, AND THREE EXCEPTIONS (owner picks, 2026-08-31). archive, audio, image and
  video wear `#aab2c0`, so the KIND lives in the silhouette, the mark and the extension on
  the chip. Measured while choosing: 7.63:1 on Explorer's dark ground and 1.99:1 on its
  light one. The chip is near-black with the extension knocked out of it, so the label
  carries on both grounds whatever the page does. The exceptions each earn their keep:
  COMIC is artwork rather than a flat colour; CODE carries ONE BAR in Prism's indigo,
  because it and document are both three rounded bars in the same box and the shared
  colour left the silhouette as the only thing telling them apart - which at 16px is
  nothing. Colour is the right axis there and it was MEASURED, not assumed: breaking the
  silhouette instead was tried first (`round24.py`) and its zigzag, nested and
  bars-plus-caret candidates all still read as document at 16px, because geometry is the
  first thing downsampling spends and hue is not. DOCUMENT is PAPER, `#ffffff` - a docx,
  pdf, xlsx or pptx is a sheet of paper and Word shows one as white on a canvas that is
  not white. Pure white measures 1.07:1 on Explorer light, where the silhouette vanishes
  outright, so the page carries a HAIRLINE (`#c4c9d2`, a third of a unit) eroded from its
  own mask - the boundary a page has against its canvas, not the heavy dark outline the
  set rejected. Eroded rather than drawn as a second shape, so it follows the rounded
  corners and the fold's diagonal and cannot drift out of step.
  **THE LABEL IS A FOOTER BAND** (owner pick, round 30, 2026-09-01), not the overhanging
  corner tab it was. `band_at="bottom"` is round12's own path and reference one's own
  treatment, so this is the composition returning to where it started: the band is clipped
  to the page and takes its rounded bottom corners, and the mark is RAISED out of its way -
  a label that takes room has to be given room, which is what round 28's scaling round
  failed at. Archive keeps its low chip (it is a container, not a page) and comic keeps its
  top-left one, standing in for the reference's masthead.
  **AND CODE HAS A MARK PER LANGUAGE** (same pick, `tools/icons/langs.py`): a React
  component and a shell script were the same picture, and now they are an atom and a `>_`.
  Two rules shaped the set and both are load-bearing. THE LETTERS ARE ALREADY TAKEN - the
  band carries the extension, so a mark made of letterforms (JS in a square, TS in a
  square) prints the same thing twice and spends the only part of the icon that can say
  something else; every mark is pictorial and the letterform languages keep the stepped
  bars, which is not a demotion because their band already says JS. And the .ico is PER
  EXTENSION, not per language: a ProgID has exactly ONE DefaultIcon, .jsx and .tsx share
  the React mark, and one icon for both would have to print JSX on a .tsx. That costs a
  ProgID each, against `assoc.nsh`'s own warning that one-class-per-KIND is why Open With
  says "Prism" once instead of listing thirty near-identical rows - so the list is kept
  SHORT deliberately (25 extensions) and everything else keeps the bars. Marks are FILLED,
  never stroked, and three carry a knockout that is not decoration: without it a cog is a
  flower, a cylinder is a rounded rectangle and a cup is a blob.
  **DOCKERFILE HAS A MARK IN THE TREE AND NOT IN EXPLORER**, and that is not a bug.
  Windows associates on EXTENSION, so a bare name (`Dockerfile`, `Makefile`) and a dotfile
  (`.gitignore`) have nothing to hang a ProgID on however well the mark is drawn. The app
  resolves a file by NAME as well, and costs nothing per mark, so it is simply more
  generous than the desktop can be: `LANG_BY_EXT` is the table Explorer registers and
  `LANG_BY_NAME` is the app's own.
  **SO THERE IS AN ICON PER EXTENSION - ALL 298** (owner pick, 2026-09-01). A ProgID
  carries one .ico and an .ico carries one baked label, so a class shared by many
  extensions prints one of their names on ALL of them: `prism-code.ico` said PY on 130
  extensions, `prism-image.ico` said JPG on 52, `prism-audio.ico` said MP3 on 32. The
  owner met it as "what is PT on my .log files" - it was PY, on files that are not
  Python, and the band being loud is what made a lie nobody had noticed unmissable. One
  class each is the only arrangement in which the label tells the truth. It costs 8.6MB
  of .ico and ~300 registry classes; it does NOT cost the Open With menu, which was the
  worry `assoc.nsh` records - measured after installing, each extension points at exactly
  one Prism class, so a given file still offers Prism once. `tools/icons/extmap.py` reads
  the extension table out of `fileKind.ts` rather than restating it (and refuses a parse
  that comes back implausibly small, since a regex matching nothing would hand every file
  the wrong icon silently); `gen_assoc.py` writes both halves of the installer macro from
  it. That generator SPLICES between the first and last per-extension line rather than
  running to `!macroend`: the first version ran to the end and silently ate the Explorer
  verb's own uninstall keys, which `shellVerb.test.ts` caught. A code extension picks up
  its LANGUAGE mark where one exists - 81 of 160 do - and the rest keep the stepped bars.
  **THE SEVEN OLD CLASSES ARE KEPT ALIVE, and that is not tidiness.** A UserChoice - the
  key that records "always open .log with Prism" - is hashed per user and signed, so an
  app must never write it and therefore can never MOVE it. Deleting the class it names
  does not move the choice, it ORPHANS it: Windows finds nothing at the far end and falls
  back to some other handler, which is how the owner's .log and .md ended up wearing
  another editor's icon the first time this shipped. `Prism.Text` and its six siblings
  stay defined, pointing at the kind icons they always did; NOTHING is registered against
  them any more, so they matter only to somebody whose existing default names one, and for
  them the icon stays what it was until they choose Prism again - at which point Windows
  writes the new per-extension class and the label becomes true. Until they do, those seven
  icons name their CATEGORY rather than an extension - TEXT, IMAGE, VIDEO, AUDIO,
  DOCUMENT, ARCHIVE, COMIC. One of them can be the default for any of a hundred
  extensions, so no extension is a true answer for it (which is how it came to say PY on
  130 kinds of file), but the class does know one true thing about every file that reaches
  it: what KIND it is. Spelled out rather than abbreviated on purpose - "TXT" in the slot
  where every other icon prints an extension reads as a claim that the file IS a .txt,
  which on a .csv is the same small lie again, while "TEXT" reads as the category it is.
  **VIDEO IS A PLAY DISC** and **ARCHIVE'S LABEL IS THE BAND** (owner picks, rounds 31 and
  32, 2026-09-01). The clapperboard is gone: its stripes are one pixel each at 16px and
  merge into a grey bar, which is why the in-app icon had needed a two-stripe cut of its
  own - a disc with one hole in it has nothing to lose at any size, so that divergence
  RETIRES and the .ico and the tree draw the same mark again. Two left, not three. And the
  archive's label was the last one in the set that was not a band; it is a full-width band
  across the container now, clipped to the folder's own silhouette so it takes its rounded
  corners. The chip's REASON was always sound - a chip over the top hides the tab that says
  which container it is - and a band at the foot honours it while matching the set. It
  covers the zip's pull, which the round showed and which is the price.
  **AND IN-APP THE BAND IS EMPTY**, because at 14px the label is not small type, it is not
  type at all. MEASURED: the label is 4.08 units in a 24-unit viewBox, so at N pixels its
  cap height is 4.08N/24 - 2.4px in a tree row, where LOG, MD and TXT all come out as the
  same three grey dots. Five pixels is the floor for reading three characters, which puts
  the icon at 30px (`LABEL_FLOOR` in TreeRows), and nothing in the app draws one that big.
  Nothing is lost by dropping it: a tree row carries the filename beside the icon, in a
  face chosen to be read, and `cleanup.log` already ends in the three characters the band
  was whispering. The .ico keeps its label at every frame because its frames go to 256,
  where it reads properly - so the band is full in Explorer's medium and large views and a
  smudge in its 16px details view, for the same reason and with the same answer available
  if it ever annoys anyone.
  Except that the label came BACK in-app the same day (owner: "they should be the same
  icons everywhere"), because one icon everywhere is worth more than two pixels of cap
  height. The arithmetic stays in a comment where the floor was, so the next person to
  notice the smudge finds the reasoning rather than filing it. What had actually caused the
  complaint was not the label at all: `.log` was getting the CODE mark, and an indent guide
  - a vertical spine with rungs hanging off it - is a picture of structure at 48px and a
  pair of LETTERFORMS at 14. The owner read it as "PT" and asked what the abbreviation
  meant. PROSE draws lines now (`.txt .log .csv .srt .vtt`), which is right anyway since
  prose has no indentation to draw, and the list is `codeLang.isProse`'s own rather than a
  second one - `iconPaths.test.ts` asserts the two agree, along with every generated table
  naming a mark that exists.
  COMIC WEARS THE BAND TOO (2026-09-01): it kept the top-left chip when the rest of the set
  moved, and a set where six labels sit at the foot and the seventh is in the corner reads
  as an oversight rather than as an exception. Its label is still DRAWN rather than knocked
  out, because there is artwork behind it and a hole would show the sunburst through the
  letters.
  **TWO IDENTICAL CURVED EDGES DO NOT CANCEL.** The in-app band traced the page's own
  rounded bottom corners, and left a pale arc at each of them: the page's edge pixel is
  part ink, the band's is part background, and part of part is a fringe. On a straight
  axis-aligned edge the coverage is exact and nothing shows, which is why the seam appeared
  at the two corners and nowhere else. The band's KO path OVERSHOOTS the page by 0.6 units
  now, so its antialiasing has nothing of the icon to half-cover; it is painted in the
  row's own background, so the overshoot is background on background and invisible. The
  `solid` evenodd variant keeps a CLIPPED copy, because a hole straying outside the body is
  one crossing rather than two and would fill instead of cut.
  CODE IS INVERTED (owner pick, 2026-09-01, round 27 candidate 13): a DARK page,
  `#2b303b`, because a code file is a dark editor and nothing else in the set is one. It
  replaces the single indigo bar that had been telling code from document - an accent bar
  did that by adding a hue to one stripe, which is a detail, and the page is most of the
  icon. A DARK PAGE IS AN INVERSION, NOT A RECOLOUR, and that is the whole construction:
  the fold, the chip and the extension knocked out of the chip are ALL drawn in ink
  everywhere else in the set, so on a dark page all three vanish at once and the naive
  recolour is an icon with no fold, no chip and no label. So code's fold and chip take
  `#aab2c0` - the grey that is the PAGE on the other kinds becomes the MARKS on this one -
  its label is DRAWN in the page colour rather than knocked out, and its three bars are
  `#e9edf7` with no accent among them, since once the ground carries the difference an
  indigo stripe on top of it is one difference too many. The page measures 1.23:1 on
  Explorer's dark ground, which is pure white's 1.07:1 problem pointed the other way, so
  it carries the SAME hairline document does in a light colour (`#7a8498`, 4.33:1 on dark
  and 3.51:1 on light) - `_hairline` grew a colour argument rather than a second
  implementation, because two MinFilter erosions of the same mask would drift. `repick.py`
  no longer offers code, for the same reason it never offered comic: its live recolour
  assumes one flat page under ink, and neither of those two is that, so tinting them there
  would show a colour the .ico cannot hold.
  THE IN-APP ICONS CANNOT CARRY ANY OF THAT, being painted in one ink, so `svg.py` has
  THREE deliberate divergences from the .ico and they are divergences rather than drift:
  the clapperboard has two stripes instead of three (three are a pixel each at 14px and
  merge into a grey bar), the comic is a bare splat (its sunburst and halftone exist to be
  different COLOURS from each other and flatten to a grey rectangle), and CODE is an
  indent guide with rungs rather than the stepped bars - a spine reads as structure where
  three full-width bars read as prose, which is the only way code and document stay apart
  when both are one colour.
- **THE ADDRESS BAR ANSWERS A RIGHT-CLICK** (2026-09-22, owner: "let me right click the url bar to
  get options to copy path or copy as text like file explorer"). Explorer's own three: Copy address,
  Copy address as text, Edit address, always for the FOLDER SHOWN, wherever on the bar you click
  (owner, 2026-10-27: "it should always copy the full path to the active folder you're in"; a
  parent crumb's menu used to copy only up to that crumb). `menuOverPreview` holds it. Copy address is Explorer's PAIR in one data object - the folder as a file drop AND
  its path as text (`file:copy-address`, `copyWindowsFiles`' `text`) - so a paste in Explorer takes
  the folder and a paste in a text field takes the path.
- **Every surface answers a right-click** (2026-08-30, #76). Seven had no menu at all while
  the video had a carefully trimmed one, and almost every verb they needed already existed
  somewhere else. The picture, the audio stage, the text editor, a tab, the archive panel's
  DEAD SPACE, the documents and the terminal all have one now, and `menus/fileVerbs.tsx` holds
  the rows that mean the same thing wherever a file is on screen. Two deliberate gaps: a tab
  has NO "close others" (each close can raise the unsaved-changes question, and firing several
  would overwrite it and lose the work it protects), and the terminal's menu carries paste but
  not copy (xterm owns its selection; Ctrl+C over one already copies).
  The SIDEBAR's dead space answers one too (2026-08-31): Paste, Open terminal here, Show in
  File Explorer and Copy path, all on the PLACE rather than on a row, since a right-click
  that missed every row simply read as a miss. Paste reads the clipboard through PowerShell
  (`Get-Clipboard -Format FileDropList`) because Windows puts a multi-file copy on as
  CF_HDROP and Electron's own clipboard API exposes only one path; the copy side was already
  a PowerShell call for the same reason. The SOURCES may be anywhere - you copied them in
  Explorer - and only the DESTINATION is walled. Nothing is ever written over: a taken name
  becomes "name (2)", the way Duplicate does. Deliberately NOT `ownWrite`'d, because the
  tree has no other way to hear about a paste and muting only DEFERS the watcher's event by
  a second and a half anyway.
  **ONE PLACE AND ONE ORDER** (owner, 2026-10-11 and 2026-10-12). Every menu's rows are a
  builder in `src/renderer/src/menus/`, one file per surface with a test pinning its order,
  indexed in `docs/menus.md` ("make sure that the right click menus in the repo is organized
  and easy to find"). Then the order: "every menu with delete should have that option at the
  bottom. copy cut paste copy path settings should be in the same area ... most things should
  have a properties menu at least files and folders and drives ... make sure the order feels
  natural". So: opening rows, then Cut, Copy, Copy path, Paste together, then what changes the
  item, then Show in File Explorer and Properties, and Delete LAST (Close tab last on a tab).
  Places in the left panel and the tree's empty space gained Properties; a drive's is its own
  (since 2026-10-12 the donut of its top-level folders, `components/properties/DriveBody.tsx`), never a walk of the disk.
  The tree's "Open terminal here" became "New terminal here", the Explorer's word. Held by the
  `menus/*.test.ts` files and the e2e `rowPaste` and zip-menu checks.
  **THE PROPERTIES WINDOW, PER KIND** (owner, 2026-10-12: "build the properties pop up window a
  bit nicer looking ... for the drives we could show a circle diagram"; picked over three rounds
  of mockups in `research/prism/mockups/2026-10-12-properties`, then "plan then build"; spec
  `docs/superpowers/specs/2026-10-12-properties-window-design.md`). `components/properties/`. A
  DRIVE: a donut of its top-level folders sized from the search index, the legend beside it
  scrolling (no Free row, the centre says it), a tooltip off the pointer's bottom right with the
  slice's dot, a slice or row opens the folder; the disk's own model with underscores as spaces
  ("WD BLACK SN850X 8000GB"), connection and file system; Disk Cleanup (Windows' `cleanmgr`),
  Close (no Open: "remove the open button. that should never be in properties", same day; the
  legend's last row fades while rows remain below: "make the last list item fade out instead of
  being cut"). A FOLDER: size, contents, Created, Modified, Opened; Close only. A PHOTO: the
  picture on top, megapixels, camera, lens, exposure, place (no map button). A VIDEO: a frame on
  top, resolution, frame rate, codec, bitrate, audio tracks, subtitles. A SONG: its cover, or
  sound bars when it has none ("none of these ... have a default note or something similar",
  then D), and its tags. TEXT and code: language, encoding, line endings, counts. Every FILE: an
  on-demand SHA-256 with a copy button. `propertiesWindow` e2e (25 checks) and unit tests for
  every parser.
  **NO ICONS on a viewer's menu, and almost no shortcut hints** (owner pick, 2026-08-31). The
  first cut read like a toolbar - the picture's menu offered next, previous, zoom in, zoom out,
  fit, actual size, rotate, fullscreen and copy, most with a key against the row - and every one
  of those was already a press or a button away, so the menu taught keys nobody needed taught
  and buried the two verbs that live only there. A menu over the thing you are looking at is a
  short list of verbs: the PICTURE's is Rotate, Copy image, and where the file is. Ticks are not
  icons (they say what is currently on), and the SIDEBAR keeps its glyphs - it sits among
  icon-led file rows and is the one menu long enough to need scanning.
- **The screen stays awake while something plays** (2026-08-30). Two hours of film is two hours
  of no input, which is exactly what the lock screen waits for. `lib/awake` COUNTS players
  rather than toggling, because the media deck keeps up to four mounted and a background tab
  pausing must not unblock what you are watching.
- **A frame step is a frame** (2026-08-30). It was a flat 1/30s that did not pause, so on 24fps
  film it moved 1.25 frames and landed between two of them, and during playback it was
  invisible. ffprobe reports `avg_frame_rate` now and the step pauses first.
- **Up/Down are the volume when the tree does not want them** (2026-08-30). App preventDefaulted
  them unconditionally and `useMediaControls` yields on `defaultPrevented`, so the volume keys
  were dead everywhere - most obviously in fullscreen, where the sidebar is gone. The tree still
  gets first refusal.
- **A save puts the file back the way it found it** (2026-08-30, `src/main/textFile.ts`). Two
  silent corruptions. Every read was utf-8, but a `.reg` is UTF-16LE BY DEFINITION and Prism
  claims `.reg`, as is anything PowerShell 5.1 redirected to a file: those opened as mojibake
  and Prism offered to save the mojibake back. And CodeMirror rejoins its document with `
`
  whatever it read, so one fixed typo in a `.bat` was 400 changed lines. The sniff is BOM-ONLY
  and deliberately so: guessing UTF-16 from interleaved NUL bytes mis-fires and turns a working
  file into nonsense, and every real Windows producer writes the mark.
- **Copy the PICTURE, not the file** (2026-08-30). For HEIC, camera RAW and the ffmpeg-decoded
  formats, "copy the file" hands the other application bytes it cannot open. Copy image works
  from the decoded blob, NOT from the `<img>` (which carries the zoom and rotation - how you are
  looking at it, not what it is) and NOT from the big-image canvas (downscaled to 2560px, so the
  copy would silently shrink). Copy frame is the video's, greyed when there is no picture.
- **Ctrl+F in every document, and it opens where you left off** (2026-08-30). A polished find bar
  sat in the PDF viewer while Ctrl+F did nothing on a README or a 300-page epub. Highlighting
  goes through the CSS Custom Highlight API rather than wrapping matches in `<mark>`: the office
  and ebook views render HTML main sanitised and the markdown view is React's, so injecting
  nodes would fight the renderer that owns them. Reading position is session-first then stored,
  only for documents long enough to be worth it, cleared at the end (a document read to the
  bottom opens at the top next time). The PDF remembers a PAGE, because an offset depends on the
  zoom and on which pages are virtualized.
- **The tree notices changes Prism did not make** (2026-08-30, `src/main/dirWatch.ts`; SUPERSEDED by
  `browseWatch.ts`, one non-recursive watch per tab, 2026-10-26, and removed 2026-10-28).
  `refreshKey` only ever moved on Prism's own writes, so a download finishing or an agent
  writing files left the tree lying. Coalesced into a set of directories on a quiet window with
  a hard ceiling; filtered by the listing's own rules and by EVERY path segment (a recursive
  watch reports `.git/HEAD`, and an agent committing does that constantly); muted around Prism's
  own writes, which refresh the tree themselves. Scoped to the root set BY CONSTRUCTION -
  `roots.ts` announces every open and close and that is the only thing that starts a watch. The
  renderer re-lists only folders a tab has already loaded and does NOT bump `refreshKey`, which
  is what would clear the selection.
- **And so does the open file** (2026-08-31, `lib/fileReload.ts`). The watcher above
  refreshed the TREE and left the EDITOR showing a frozen copy, whose `saved.current.text`
  was now a lie - so one Ctrl+S wrote the stale version back over the agent's work. The
  signal cannot be trusted on its own: `DirChange` carries directories and never a file
  name, and Prism's OWN save emits one about 1.2s late, because a muted directory is
  DEFERRED rather than dropped. So the correctness condition is the file's own stamp
  (mtime + size), taken after every read and after every write. A CLEAN editor swaps
  silently: `saved.current` is set BEFORE the dispatch (or the update listener marks the
  file dirty against text nobody typed) and the transaction is kept OUT of the history
  (or Ctrl+Z walks back to the stale text and the next Ctrl+S commits the very corruption
  this fixes). A DIRTY one asks, once per file however many times it is rewritten, and
  never in fullscreen, where a dialog composites outside the fullscreen element and nobody
  sees it: Prism has no diff and no merge, so it is Keep mine or Reload from disk and
  nothing in between. A file that has momentarily VANISHED (a rename-into-place write, a
  git checkout) is left entirely alone - nulling `saved.current` there would disarm Ctrl+S
  on the user's own unsaved work. Markdown re-reads the same way with no question, having
  nothing unsaved to lose. Deliberately NOT extended to the pdf viewer or to office and
  ebook documents: those cost a conversion in main per event, and nobody rewrites a .docx
  underneath a reader. The paging list is still frozen (it comes from the open payload), so
  a file an agent CREATES appears in the tree and is not arrow-pageable until the tab
  re-roots - said rather than half-fixed.
- **The uninstaller had never run** (2026-08-30). `customUnInstall` was defined in `pages.nsh`,
  which `installer.nsh` excludes when `BUILD_UNINSTALLER` is set, so electron-builder's
  `!ifmacrodef` found nothing: every ProgID, every OpenWithProgids entry and the Explorer verb
  survived an uninstall. The macro lives in `assoc.nsh` now and a parity test asserts both that
  and that every key `shellVerb.ts` writes is one the uninstaller deletes.
- **Open folders from other apps** (#393; owner, 2026-10-15, asked through Prism Terminal: path
  links clicked there opened folders in File Explorer, and Prism Terminal must not know Prism
  exists). OFF by default, in Settings > Explorer > Windows. On, Prism is Windows' default verb
  for `Directory` and `Drive` (HKCU, `PrismBrowse`), so a folder ANY app opens with the shell's
  default verb (Run, cmd `start`, `shell:` links, shortcuts, Prism Terminal after its core change)
  opens a Prism Explorer, the Win+E way: the same handshake, landing on that folder instead of
  Home. Files are untouched. MEASURED the same day with a logging stand-in (spec:
  `docs/superpowers/specs/2026-10-15-folder-handler-design.md`): never the `Folder` class, which
  is Control Panel too; Electron's `shell.openPath`/`openExternal` take NO shell verb, so no
  registry entry catches them, which is why Prism Terminal opens folders through the default verb
  now. File Explorer's own double-click STAYS in File Explorer (owner's choice): the verb is
  `ProgrammaticAccessOnly`, which also keeps it out of the menu. THE VERB RUNS A COPY OF THE WIN+E
  HELPER OUTSIDE THE INSTALL FOLDER (`%LOCALAPPDATA%\PrismFolders`), `--folder`: anything short of
  Prism's acknowledgement (Prism missing, crashed, hung, a path that is not a folder) opens the
  folder in File Explorer, so turning Prism into the folder handler can never leave folders
  unopenable. The helper owns the registry (reg.exe prints an unset default as localised text):
  the default it replaced is kept as `PreviousDefault` on Prism's key and put back exactly on
  off, another file manager included; a default some other app took since is never touched. The
  one fact stored in userData is the YES (`folders-on`), for the startup repair. The uninstaller
  undoes it in NSIS (`build/installer/folders.nsh`), and keeps it across an upgrade. Held by the
  helper's self-tests (`npm run test:win-e`), `folderHandler.test.ts`, `browseRequest` in
  `winERequests.test.ts`, and the e2e `folderOpen` (cold start) and `folderOpenRunning` (while Prism runs:
  a new window of the same process, 2026-10-29).
- **Opt-in file associations**: register Prism as the handler for chosen types, from Settings.
  Never hijack defaults silently. The installer offers EVERY viewable type
  (`build/installer/assoc.nsh`); the app itself just opens Windows' Default apps page, so that
  list is the only thing deciding what Windows will offer Prism for.
  That list only governs the RECOMMENDED half of "Open with" (2026-08-20). The dialog's
  "More apps" section is every installed application, unfiltered, so Prism can be pointed at
  a `.zip` no matter what we register, and no app can remove itself from it: the only lever,
  `NoOpenWith`, is all-or-nothing and would drop the 143 types we do support. Hence
  `UnsupportedView`, which names the file and the format instead of leaving an empty window.

**Out of scope (v1):** playlists / library / collections, editing, casting, streaming URLs,
subtitles (planned later), office-doc rendering beyond PDF (planned later), cross-platform
(Electron keeps it feasible later, but Windows-only for now).

Detailed plan and phases live in [`ROADMAP.md`](../ROADMAP.md); the design spec and implementation
plan live in `docs/superpowers/`.
