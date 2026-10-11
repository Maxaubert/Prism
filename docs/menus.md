# Right-click menus

Every right-click menu in Prism, and where its rows are defined (owner, 2026-10-11: "make sure
that the right click menus in the repo is organized and easy to find ... so if they're scattered
that would be bad for when we change things").

## The rule

- **Rows live in `src/renderer/src/menus/`, one file per surface.** A builder takes a context
  (state values plus the actions the rows call) and returns `MenuItem[]`. The component keeps its
  state and handlers, and only calls the builder: `items={treeRowMenu({...})}`.
- **Each builder has a test next to it that pins its labels in order**, per variant (file row,
  folder row, several marked, disabled states). Reordering a menu is a change to the builder AND
  a visible change to its test.
- **A new menu gets a new file here**, never an inline array in a component, and a line in the
  table below.
- The renderer is `components/ContextMenu.tsx` (`MenuItem`: label, hint, danger, disabled, icon,
  onPick, one level of `children`, `keepOpen`, `trailing`). It draws no separators: every row has
  a top border.

## Shared rows

| File | What | Used by |
|---|---|---|
| `menus/fileVerbs.tsx` | `fileVerbs` (Show in File Explorer, Copy path; capability-gated for the phone), `stepVerbs` (Next/Previous), `tickIf` | Explorer row, places, image, audio, markdown, doc, code |
| `menus/fileAppMenu.tsx` | the "Open in" flyout (Default app, the apps, Choose another app) | Explorer file row, tree file row |
| `menus/archiveMenus.ts` | pure row lists for a zip: `outside`, `folder`, `file`, `many`, `empty` | wired to actions and icons by `components/browse/useArchiveActions.tsx`, for the Explorer list and the project tree |

## Every menu

| Surface (what is right-clicked) | Builder | Opened in |
|---|---|---|
| Explorer list: a file, a folder, several marked rows | `explorerRow.tsx` `explorerRowMenu` | `App.tsx` (after `archiveActions.menu(...)`, which wins for zip rows) |
| Explorer list: a zip, or anything inside one, or empty space inside one | `archiveMenus.ts` via `useArchiveActions.menu` | `App.tsx`, `Sidebar.tsx` |
| Explorer left panel: Quick access, a pinned file, a project place, a drive | `places.tsx` `placesMenu` | `browse/BrowsePlaces.tsx` |
| Explorer address bar | `addressBar.tsx` `addressBarMenu` | `browse/BrowseToolbar.tsx` |
| Project tree: a file or folder row (also search hits) | `treeRow.tsx` `treeRowMenu` | `Sidebar.tsx` |
| Project tree: several marked rows | `treeRow.tsx` `treeMarkedMenu` | `Sidebar.tsx` |
| Project tree: empty space | `treeRow.tsx` `treeDeadSpaceMenu` | `Sidebar.tsx` |
| Sidebar footer: the terminal button | `terminalButton.tsx` `terminalButtonMenu` | `Sidebar.tsx` |
| The terminal panel itself | `terminalPanel.tsx` `terminalPanelMenu` | `TermDock.tsx` (in the terminal gate's paths) |
| A split-view pane's top band | `splitPane.tsx` `splitPaneMenu` | `App.tsx` |
| A tab; the + button | `tabStrip.tsx` `tabContextMenu`, `plusButtonMenu` | `TabStrip.tsx` |
| Title bar: More (three dots) | `moreMenu.tsx` `titleBarMoreMenu` | `App.tsx` |
| Image viewer (also comic pages, the phone) | `viewers/image.tsx` `imageMenu` | `ImageView.tsx` |
| Video viewer | `viewers/video.tsx` `videoMenu` | `VideoView.tsx` |
| Audio viewer | `viewers/audio.tsx` `audioMenu` | `AudioView.tsx` |
| Markdown | `viewers/markdown.tsx` `markdownMenu` | `MarkdownView.tsx` |
| Office documents and ebooks | `viewers/doc.tsx` `docMenu` | `DocView.tsx` |
| Code and text (editable and read-only) | `viewers/code.tsx` `codeMenu` | `CodeView.tsx` |
| The old zip panel (phone only since #300): a member, several, empty space | `viewers/archivePanel.tsx` `archiveRowMenu`, `archivePanelMenu` | `ArchiveView.tsx` |

## Menus that are not `ContextMenu`

- **The player cog** (video and audio settings): `components/PlayerMenu.tsx`, its own popover.
  Its speed, audio track and subtitle pickers duplicate the video right-click menu's.
- **The sidebar sort button**: `components/SortMenu.tsx`, its own popover.
- **Windows File Explorer's own menu** ("Open file", "Open as project"): registry verbs in
  `src/main/shellVerb.ts`, held by `shellVerb.test.ts`.
- Electron's default menus are off (`Menu.setApplicationMenu(null)`); text inputs have no
  right-click menu.

## Known differences (found 2026-10-11, left for the reorder work)

- The Explorer row and the tree row are separate definitions of the same verbs, in a different
  order and wording ("New terminal here" vs "Open terminal here", Paste greyed vs hidden,
  Properties before vs after Delete, "items" vs "files", only the tree has Copy paths).
- Show in File Explorer and Copy path are retyped (not `fileVerbs`) in the tree, tab, video and
  zip-panel menus, so those skip the phone's capability checks.
- Three copies of the Left/Right/Top/Bottom list (`splitPane.tsx`, `terminalPanel.tsx`,
  `treeRow.tsx`).
- A marked selection that includes a zip row gets the single-zip menu; ordinary folders have no
  empty-space menu in the Explorer list; the `source: 'more'` filter in `explorerRow.tsx` is dead.
