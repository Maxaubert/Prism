# Folder browsing

Prism's folder surface adds desktop navigation without making a working terminal follow every
folder change. The accepted brief keeps browser, media and terminal sessions in one top-level tab
strip and keeps desktop browsing separate from phone sharing.

## User behavior

- One pinned Explorer tab stays first and remembers its location. The + and Ctrl+T open ordinary
  Explorer tabs. Right-click a folder and choose Open as project to open a separate tab with a
  fixed project tree and an empty workspace, with no selected file or Explorer list. This explicit
  action starts empty regardless of the startup preference, and stays empty after restart until
  a file is selected. For a file, its containing folder becomes the project
  and that file opens. Explorer location and existing sessions stay where they were.
- The sidebar button toggles places and drives in Explorer, and the folder tree in project tabs.
  Project files and terminals retain the original viewer layout, without the path bar, folder
  browser or terminal browsing controls. Restored project browse state cannot expose Explorer.
  Ordinary tabs close immediately; live agents use the confirmation preference and unsaved text
  always asks. The pinned Explorer has no close action.
- Back/Forward retrace folder history; Up and ancestor breadcrumbs move to parent locations.
  Clicking empty path-bar space or Ctrl+L edits an absolute folder path. Clicking a named segment
  navigates there. Alt+Left/Right/Up provide navigation shortcuts; F5 refreshes.
- The whole path bar highlights on hover or keyboard focus, with no pen icon. In Explorer it stays above the full-file viewer,
  showing the file after its containing folder. Back, Backspace or a folder breadcrumb returns to
  the folder. Backspace inside an editor or text field still edits text.
- Every Quick access default can be unpinned. Pin any file or folder from its context menu.
  Drag pins to reorder them, or use Move up/Move down in the context
  menu. Pin choices and order persist, including a deliberately empty list. File pins open the
  existing viewer; folder pins navigate. Pinning does not add phone shares.
- Drag files or folders from Explorer or the project tree onto a folder, breadcrumb or drive.
  Starting a drag preserves the current selection and preview. Its label stays close to the cursor,
  attached at its lower-left edge and kept inside the window. A selected source stays blue
  when dragged over itself; that row is not a destination.
  Dropping in an Explorer list's empty area moves them into its displayed folder; a file row
  targets that file's containing folder. Hold the mouse button and use Ctrl+Tab or Ctrl+Shift+Tab
  to carry items into another tab. Dropping directly onto an existing tab moves into its currently
  displayed Explorer folder or project root without activating it or opening a new tab. Drop targets
  use a neutral grey fill without a focus ring. Nothing moves until release. Escape, window blur or releasing
  outside the window cancels the carry. Existing conflict prompts and undo remain available.
  Quick access folder pins accept files and folders into their target directories using the same move operation.
  Dropping onto a file pin, the Quick access heading or empty space does nothing. Dragging an
  existing pin only reorders Quick access; it cannot move, open or extract its target elsewhere,
  including after switching tabs. Only the context-menu action adds a pin.
- The list includes dotfiles, unsupported files and folders normally hidden from the viewer tree.
  Folders precede files. Search matches names in the current folder and its descendants, including
  AppData, with the shared query operators. Results show containing paths and stream while the
  search runs. Cancel, inaccessible folders, skipped links and partial results are visible. A walk
  stops after 250,000 entries, 1,000 matches or 30 seconds; it never presents this as complete.
  Name, type, size and modified-time sorting are available. Search is literal, not typo-correcting.
- Single-click selects. Double-click or Enter opens a directory or the file's existing viewer.
  In Explorer, Open in split view enables one viewer to the right of the file list. Further file
  selections and opens replace that viewer; they never add pinned panes or hide the list. Folder
  navigation keeps the current file in the viewer. Open full view explicitly hides the list;
  returning restores the split. The split setting and displayed file survive restart.
  The viewer header keeps Open full view without repeating the selected filename. The existing
  preview toggle opens and closes the split.
  Unsupported files retain the existing fallback.
- The Explorer list supports arrows, Enter, Backspace, F2, Delete and Ctrl+C/X/V.
  Keyboard navigation retains list focus across folder loads, empty folders
  and returns from full-file views, without a focus outline around the list frame. Individual
  rows and controls retain their visible keyboard focus.
  Paste targets the displayed directory, even when a child folder is selected. Ctrl+F focuses folder search.
  Cut files retain their move behavior across Explorer and project tabs; a later Copy cancels it.
  Copy puts the original files and Windows copy/cut metadata on the system clipboard for other
  applications. A single common image also supplies bitmap pixels for document apps, while
  Explorer and terminals can still use the file. Incoming Windows copy/cut metadata takes
  precedence over old Prism cut marks. Unicode paths remain literal across the process boundary.
  Full and split Explorer viewers also support file copy, cut, paste, rename and delete when
  the viewer owns keyboard focus. Editors, selected text and terminals retain their own shortcuts.
  In the project tree, Backspace collapses a folder or selects its parent within the project;
  F5 refreshes and Ctrl+F searches. Existing project multi-selection and paste destinations remain.
- The Open as project quick button requires a selected folder; a file or no selection disables it.
  Delete is a quick button and keeps its confirmation. More file actions omits Open, Copy, Rename
  and Delete, while the row's right-click menu retains the complete action set.
- Quick access items, drives and project-tree rows offer Open as project and Open in new tab.
  The latter always creates an Explorer tab. Folder projects start empty; a file opens in a
  project rooted at its parent. Existing tabs keep their location and selection.
  Explorer and project file menus share action icons, clipboard shortcuts and app choices.
  Context-menu Paste targets the clicked folder or a file's parent, including search results.
  Menus scroll within the window at high zoom. See the [menu consistency audit](file-menu-audit.md)
  for the shared actions and deliberate differences.
- Drag the boundaries between Quick access, the file list and the viewer to adjust section widths.
  Mouse resizing uses the simple horizontal resize cursor without a hover or dragging highlight,
  including the project sidebar and terminal dividers.
  Keyboard-focused dividers support arrow keys and Home/End; double-click resets their width.
  Widths persist across restarts and fit the available window space, including at high zoom.
- Desktop scrollbars use slim 6px thumbs without arrow buttons or solid tracks.
- Right-clicked rows use a grey highlight and outline on both subtler alternating row colors.
  Dismissing the menu restores the normal stripe or selected-row appearance.
- Return to folder and folder navigation pause that tab's media. Turning preview off also pauses
  it. Switching top-level tabs preserves Prism's existing intentional playback behavior.
- Comic and image controls respond to pointer activity inside their own viewer frame. Moving
  over Explorer, the title bar, sidebars or another viewer neither reveals them nor prolongs
  their idle timer. Each comic keeps that timer across page changes. PDF controls use only
  their own viewer's hover state; their keyboard focus behavior remains available.
- New terminal here in Explorer creates a new top-level project tab at that directory. Browsing leaves existing shells,
  agent sessions and their actual cwd alone. Ctrl+Tab and Ctrl+Shift+Tab traverse the shared strip.
- Project terminals keep their working directory while another Explorer tab browses elsewhere.
  Opening a terminal stays in the same project tab. New terminal adds a session inside that tab;
  Open terminal here preserves touched or agent shells and opens a session at the chosen folder.
  Project file split panes retain their existing independent behavior. The sidebar continues to
  follow the reported terminal location within the project root.

Existing tree, archive, viewer and terminal actions remain separate surfaces with their established
selection and keyboard rules. The folder list is not a new editing, thumbnail or library system.

## State and lifecycle

`src/renderer/src/lib/tabs.ts` retains project root, shell slots, file list and pinned panes.
Explorer/project roles and the single pinned Explorer persist with the tab. Existing saved tabs
retain their project behavior; opening a new Explorer does not create a phone root.
`lib/browse.ts` manages the independent browsing location and up to 100 history entries. Each entry
keeps selection, scroll, search query and sort. The surface and preview toggle are saved separately.
`lib/useFolderBrowsing.ts` coordinates directory requests, stale-result protection and media pause.

The root identifies the project/session and phone share; it does not follow casual navigation.
Existing viewer lifecycles are reused so preview does not create another player or decoder.
Dirty text stays in the application's in-memory buffer store while browsing and switching tabs.
It is subject to the existing save/discard close flow, not a new crash-recovery mechanism.

`src/main/tabs.ts` validates saved state before restore. It keeps existing absolute shell cwd even
outside the original root, restores browsing history and expanded folders, and retains existing
pinned files. Terminal pins record slot indices and are remapped to fresh shell IDs on restore.
Hidden terminals also retain their restore state. Shell processes restart; restoring an eligible
agent conversation uses the existing resume pipeline rather than preserving the old process.
Duplicate saved tab IDs retain the first owner; later duplicates receive fresh restore IDs.

## Desktop authority and phone isolation

`src/main/browse.ts` accepts explicit desktop directory navigation through the preload bridge.
`listDir(path, true)` uses the existing bounded asynchronous listing pipeline without the viewer's
file-kind and clutter filters. Tree and phone callers retain the default filtering behavior.

`src/main/desktopAccess.ts` keeps desktop grants apart from `roots.ts`. A visited directory grants
itself and immediate entries, not every descendant of a drive. Explicit tree expansion, search
results and discovered subtitle directories extend the relevant grants. Canonical path checks
continue to reject implicit junction escapes. History and mounted/dirty content can retain access
until the owning tab closes; `browseRelease` revokes its grants. A browse request already in flight
at close cannot recreate them when its listing completes.

The phone continues to use `validRoot` and `openRoots`. Visiting a parent, drive or unrelated folder
on the desktop does not make that location a phone share.
Recursive search grants only the parents of returned desktop matches. It does not follow links
or junctions, and cancellation is scoped to its tab and request.

`browseWatch(tabId, path)` explicitly watches the visible owned directory, nonrecursively, with
coalesced `dir:changed` events. One watcher is held per tab. Passing null, leaving the folder surface
or releasing the tab closes it. Granting a location for a cwd report does not change the watcher.
The browser also refreshes on focus and through Refresh.

## Verification commands

Run from the repository root on Windows:

```powershell
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run fetch:bin
npx playwright test --config tools/e2e/browse.config.ts
npm run e2e
```

The dedicated Playwright suite uses the built Electron entry, isolated user-data profiles and
offscreen test windows. Its scenarios cover folder history, unsupported files, real shell tabs,
media/preview behavior, dirty buffers, phone scope, cwd restore and pinned-file restore.
Agent title fixtures do not prove that a real Claude or Codex conversation was exercised.
The HTML report is `.e2e/browse-report`; traces are retained on failure.

These commands describe the gates, not their latest results. Record actual outcomes and any failed
checks in the PR. A hands-on branch build must use a separate profile and must not replace the
installed Prism or close active user terminals. This document makes no installation claim.

Package the follow-up trial with `npm run package -- --config.directories.output=dist/menu-consistency-trial`.
Then `tools/preview-branch.ps1` opens `dist/menu-consistency-trial/win-unpacked/Prism.exe` with a separate
`.e2e/menu-consistency-profile`. Its `--preview` flag suppresses automatic Explorer menu registration so
trying the branch does not repoint the installed application's shell verb. To run the focused suite
against that executable, set `PRISM_BROWSE_EXECUTABLE` to its absolute path before invoking Playwright.
The separate output path also lets the earlier trial remain open while the new build is prepared.
Set `PRISM_TEST_WORD=1` to also verify image paste in a temporary Word document. That optional
local check requires installed Word with no running Word process, and closes its own unsaved document.

Quick access folder pins receive file drops, while pin drags show an insertion line for reordering:

![A pinned folder receives a file drop](screenshots/folder-browsing/quick-access-folder-drop.png)

![A pin drag reorders shortcuts without moving their files](screenshots/folder-browsing/quick-access-pin-reorder.png)

The drag label follows close to the pointer and remains inside the window at high zoom:

![Close drag label at normal zoom](screenshots/folder-browsing/drag-badge-close-zoom100.png)

![Close drag label at 200 percent zoom](screenshots/folder-browsing/drag-badge-close-zoom200.png)

## Captured interface

These captures use the packaged branch with isolated test profiles and generated files.

![Held file drag uses a neutral destination fill](screenshots/folder-browsing/explorer-held-drag.png)

![Breadcrumb drop target at 200 percent zoom](screenshots/folder-browsing/explorer-held-drag-zoom200.png)

![Dropping onto an existing tab targets its open folder](screenshots/folder-browsing/explorer-tab-drop.png)

Comic and PDF toolbars remain hidden while the pointer is outside their viewer:

![Comic controls hidden during Explorer activity](screenshots/folder-browsing/viewer-toolbar-comic.png)

![Comic controls at 200 percent zoom](screenshots/folder-browsing/viewer-toolbar-comic-zoom200.png)

![PDF controls hidden during Explorer activity](screenshots/folder-browsing/viewer-toolbar-pdf.png)

![PDF controls at 200 percent zoom](screenshots/folder-browsing/viewer-toolbar-pdf-zoom200.png)

Keyboard navigation keeps focus inside the list, with a visible row indicator and no frame outline:

![Explorer keyboard focus stays on file rows](screenshots/folder-browsing/keyboard-navigation.png)

![Explorer keyboard navigation at 200 percent zoom](screenshots/folder-browsing/keyboard-navigation-zoom200.png)

The split header keeps Open full view without repeating the filename. Folder search retains
keyboard focus while a document is displayed beside it:

![Explorer split header and focused folder search](screenshots/folder-browsing/split-header.png)

![Explorer split header at 200 percent zoom](screenshots/folder-browsing/split-header-zoom200.png)

Resizable Explorer sections keep slim scrollbars beside the file list and viewer. Only keyboard
focus marks the divider; mouse hover and dragging leave it quiet:

![Explorer resizing without a hover or drag highlight](screenshots/folder-browsing/explorer-quiet-resize.png)

![Project sidebar resizing without a hover or drag highlight](screenshots/folder-browsing/project-quiet-resize.png)

Dragging a selected file over itself preserves its blue selection and the current preview:

![Selected drag source keeps its blue highlight](screenshots/folder-browsing/explorer-drag-selection.png)

Keyboard-focused dividers remain visible, and right-click targets use neutral grey:

![Resizable Explorer sections and slim scrollbars](screenshots/folder-browsing/explorer-resizable-sections.png)

![Resizable Explorer sections at 200 percent zoom](screenshots/folder-browsing/explorer-resizable-sections-zoom200.png)

![Grey right-click highlight on a subtle row stripe](screenshots/folder-browsing/explorer-grey-context-row.png)

![Grey right-click highlight at 200 percent zoom](screenshots/folder-browsing/explorer-grey-context-row-zoom200.png)

The quick action row includes Delete, and the More menu keeps the additional actions. The whole
path bar remains editable without a pen icon:

![Explorer actions and compact More menu](screenshots/folder-browsing/explorer-actions-more.png)

![Explorer action row at 200 percent zoom](screenshots/folder-browsing/explorer-actions-more-zoom200.png)

Explorer split view keeps the file list in the middle and one replaceable viewer on the right:

![Explorer file list with one split viewer](screenshots/folder-browsing/explorer-single-split.png)

![Explorer split viewer at 200 percent zoom](screenshots/folder-browsing/explorer-single-split-zoom200.png)

Projects retain independent file splits and terminals inside their existing tab, without Explorer controls:

![Project independent file splits](screenshots/folder-browsing/project-independent-splits.png)

![Project independent splits at 200 percent zoom](screenshots/folder-browsing/project-independent-splits-zoom200.png)

![Project file without Explorer controls](screenshots/folder-browsing/project-file-without-explorer.png)

![Project file and terminal](screenshots/folder-browsing/project-split-without-explorer.png)

![Project split terminal at 200 percent zoom](screenshots/folder-browsing/project-split-without-explorer-zoom200.png)
