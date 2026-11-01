# Right-click menus

Every right-click menu in Prism, and where its rows are defined (owner, 2026-10-11: "make sure
that the right click menus in the repo is organized and easy to find ... so if they're scattered
that would be bad for when we change things").

## The rule

- **Rows live in `src/renderer/src/menus/`, one file per surface.** A builder takes a context
  (state values plus the actions the rows call) and returns `MenuItem[]`. The component keeps its
  state and handlers, and only calls the builder: `items={explorerRowMenu({...})}`.
- **Each builder has a test next to it that pins its labels in order**, per variant (file row,
  folder row, several marked, disabled states). Reordering a menu is a change to the builder AND
  a visible change to its test.
- **A new menu gets a new file here**, never an inline array in a component, and a line in the
  table below.
- The renderer is `components/ContextMenu.tsx` (`MenuItem`: label, hint, danger, disabled, icon,
  onPick, one level of `children`, `keepOpen`, `trailing`). It draws no separators: every row has
  a top border.

## The order (owner, 2026-10-12)

"every menu with delete should have that option at the bottom. copy cut paste copy path settings
should be in the same area ... most things should have a properties menu at least files and
folders and drives ... make sure the order feels natural".

Every file or folder menu reads top to bottom in the same groups:

1. **Opening**: Open, Show in preview / Open in split view, Open in new tab,
   then Open in (a file).
2. **The clipboard, together**: Cut, Copy, Copy path, Paste. A menu with fewer keeps the same
   order (a viewer's Copy image or Copy frame, then Copy path).
3. **Changing it**: Pin / Unpin, Change icon... (a folder or a pin, 2026-10-31; with several
   marked folders `Change icon for N folders...`, not offered when a file is marked), Extract,
   Duplicate, Rename. Several marked rows with a picture among them: `Save copies as` (#474), with
   the picture's `Save a copy` formats.
4. **Where it is and its facts**: Show in File Explorer, then Properties.
5. **Delete, always LAST**, on every menu that has it (Close tab is last on a tab, the same way).

Files, folders and drives all have Properties: the left panel's places (a drive shows its kind and
sizes and a donut of its folders, `components/properties/DriveBody.tsx`, never a walk of the whole disk) Open question, not done: Show in
File Explorer may move under a "More" flyout or go.

## Shared rows

| File | What | Used by |
|---|---|---|
| `menus/fileVerbs.tsx` | `fileVerbs` (Show in File Explorer, Copy path; capability-gated for the phone), `stepVerbs` (Next/Previous). The row glyphs `menuIcon` and `tickIf` are `components/icons/menuGlyphs.tsx` | Explorer row, places, image, audio, markdown, doc, code |
| `menus/fileAppMenu.tsx` | the "Open in" flyout (Default app, the apps, Choose another app) | Explorer file row |
| `menus/archiveMenus.ts` | pure row lists for a zip: `outside`, `folder`, `file`, `many`, `empty` | wired to actions and icons by `components/browse/useArchiveActions.tsx`, for the Explorer list |

## Every menu

| Surface (what is right-clicked) | Builder | Opened in |
|---|---|---|
| Explorer list: a file, a folder, several marked rows | `explorerRow.tsx` `explorerRowMenu` | `App.tsx` (after `archiveActions.menu(...)`, which wins for zip rows) |
| Explorer list: a zip, or anything inside one, or empty space inside one | `archiveMenus.ts` via `useArchiveActions.menu` | `App.tsx` |
| Explorer left panel: Quick access, a pinned file, a drive | `places.tsx` `placesMenu` | `browse/BrowsePlaces.tsx` |
| Explorer address bar | `addressBar.tsx` `addressBarMenu` | `browse/BrowseToolbar.tsx` |
| A tab; the + button | `tabStrip.tsx` `tabContextMenu`, `plusButtonMenu` | `TabStrip.tsx` |
| Title bar: More (three dots) | `moreMenu.tsx` `titleBarMoreMenu` | `App.tsx` |
| Image viewer (also comic pages, the phone); Photo info (the I key's card, #78) only where the picture is a file, not on the phone | `viewers/image.tsx` `imageMenu` | `ImageView.tsx` |
| Video viewer | `viewers/video.tsx` `videoMenu` | `VideoView.tsx` |
| Audio viewer | `viewers/audio.tsx` `audioMenu` | `AudioView.tsx` |
| Markdown | `viewers/markdown.tsx` `markdownMenu` | `MarkdownView.tsx` |
| Office documents and ebooks | `viewers/doc.tsx` `docMenu` | `DocView.tsx` |
| Code and text (editable and read-only) | `viewers/code.tsx` `codeMenu` | `CodeView.tsx` |
| The old zip panel (phone only since #300): a member, several, empty space | `viewers/archivePanel.tsx` `archiveRowMenu`, `archivePanelMenu` | `ArchiveView.tsx` |

## Menus that are not `ContextMenu`

- **The player cog** (video and audio settings): `components/PlayerMenu.tsx`, its own popover.
  Its speed, audio track and subtitle pickers duplicate the video right-click menu's.
- **Windows File Explorer's own menu** ("Open file", "Open in Prism" on folders): registry verbs in
  `src/main/shellVerb.ts`, held by `shellVerb.test.ts`.
- Electron's default menus are off (`Menu.setApplicationMenu(null)`); text inputs have no
  right-click menu.

## Known differences (found 2026-10-11)

- Show in File Explorer and Copy path are retyped (not `fileVerbs`) in the tab, video and
  zip-panel menus, so those skip the phone's capability checks.
- A marked selection that includes a zip row gets the single-zip menu; ordinary folders have no
  empty-space menu in the Explorer list.
- The project tree, its menus and the terminal's menus went on 2026-10-26 (Explorer only).
