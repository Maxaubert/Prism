# Dialogs

Every question and notice Prism puts up in a dialog, and where its text lives (structure cleanup,
2026-10-12; the same idea as `docs/menus.md`).

## The rule

- **Dialogs live in `src/renderer/src/dialogs/`, one file per dialog.** A dialog takes what it
  names (a file name, a count) and one callback per answer, and returns one `<Dialog>`. The
  component that asks keeps its state and decides what each answer does.
- **Each dialog has a test next to it that pins its title, its text and its buttons in order**
  (which one is primary, which is red), and that each button calls its answer. `dialogs/testing.ts`
  reads a dialog's props for that (`specOf`, `labels`, `pick`).
- **A new question gets a new file here**, never an inline `<Dialog>` in a component, and a line
  in the table below.
- The shell is `components/Dialog.tsx` over `components/Modal.tsx` (scrim, Escape and a press
  outside cancel, focus on the primary button); the look is `components/dialogLook.ts`. The
  buttons read safe first: Cancel, then the act.
- **App holds one question at a time**: the `Ask` union in `dialogs/asks.ts`, drawn by
  `dialogs/AskDialogs.tsx` from App's answers (`AskAnswers`). It draws in two layers, `under` and
  `over`, so each question keeps its old place in the tree (the dialogs are not portalled, and
  equal z-index stacks in DOM order).

## Every dialog

| Dialog | Asks or says | Opened by |
|---|---|---|
| `DeleteDialog` | Delete one file or folder: Cancel, Delete permanently (red outline, asks once more), Delete (red, to the Recycle Bin, the default). Title "Delete <name>?", one line: its size | App (`delete`): Explorer row, tree row, Delete key |
| `DeleteManyDialog` | The same for several: "Delete N items?", the first two names, "+rest" and the total size | App (`delete-many`): marked rows |
| `MoveClashDialog` | Names already taken where a move lands: Keep both or Replace | App (`move-clash`): drag, paste |
| `MoveClashDialog` (again) | A Restore from the Recycle Bin onto names already taken: the same dialog, its own ask kind, Keep both lands `name (2)`, Replace sends what is there to the bin | App (`bin-clash`): the bin's Restore |
| `PermanentDeleteDialog` | Delete for good: "Delete <name> permanently?" (or "N items"), the size. Cancel (the default) and Delete permanently. The middle button's second question, the bin's Delete permanently, and a zip's Delete | App (`delete-permanent`, `bin-delete`): the middle button, Delete key, the strip, the row menu |
| `EmptyBinDialog` | "Empty the Recycle Bin?", "N items · size" and one bar per drive (used, in the accent the part it frees, "<free> free" left, "+<freed>" right). Cancel (the default) and Empty Recycle Bin | App (`bin-empty`): the strip, the list's empty space, the sidebar row |
| `NameTakenDialog` | A rename onto a taken name: Replace or Keep both | App (`clash`) |
| `FileChangedDialog` | A file with unsaved edits changed on disk: Keep mine or Reload | App (`file-changed`) |
| `UnsavedDialog` | Unsaved changes: Cancel, Discard, Save all changes | App (`close-dirty`, `close-tab`) |
| `NoticeDialog` | One line that did not work, one button | App (`failed`, "That didn't work"), `Sidebar.tsx` (Paste, Add to archive), `archive/useArchiveOps.tsx` ("Archive") |
| `PasswordDialog` | The archive's password (again, when it was wrong) | `components/archive/ArchiveQuestion.tsx` only, beside App: every route asks through `lib/archiveQuestion.ts`, so an archive never has two up |
| `ArchiveDeleteDialog` | Delete members from a zip: the permanent question, no middle button | `archive/useArchiveOps.tsx` |
| `ArchiveClashDialog` | Added files, or members moved inside a zip (#70 D7), land on names the zip has: Keep both | `archive/useArchiveOps.tsx` |
| `ArchiveFactsDialog` | A zip member's facts | `browse/useArchiveActions.tsx` |
| `FolderIconDialog` | Icon for a folder (or N folders): search, a grid of the built-in icons, Cancel, Reset to default, From a file... (the picture's refusal is App's `failed` NoticeDialog, its text `ICON_REFUSED` in `lib/iconFromFile.ts`). A body that is a tool, so `Dialog`'s `wide` box | App (`folder-icon`): Change icon... on a folder row, marked folder rows, a sidebar pin |

Not here, on purpose: forms and panels that are more than a question. `browse/BrowseRename.tsx`
(the rename field in a dialog; its words, Rename or New folder, are `dialogs/renameWording.ts`,
pinned by its test), `properties/PropertiesDialog.tsx`, `PhoneDialog.tsx`, the core's
`UpdateDialog`, `ExtractWindow.tsx` (it cannot be dismissed, so it shares only the look), and
`browse/BusyBar.tsx`, the loading bar over a held list (not a dialog: it covers one tab's list only,
and the rest of the window stays yours).

## The delete question (owner, 2026-11-10, #500 #503 #504)

- **One component draws all five delete questions**: `dialogs/DeleteQuestion.tsx` (icon, title, one quiet line,
  buttons on the right). `DeleteDialog`, `DeleteManyDialog`, `PermanentDeleteDialog`, `EmptyBinDialog` and
  `ArchiveDeleteDialog` only build its words (`dialogs/deleteCopy.tsx`); `DeleteAsks.tsx` adds the one hook that
  fills the size in. A new delete question goes through `DeleteQuestion`, never its own `<Dialog>`.
- **Minimal text.** The title and one line: what goes and how big it is. No sentence says where it goes or whether
  it can come back. A name is never in quotes (`components/DialogName.tsx` styles it in a body; a title keeps it plain).
- **Buttons.** Red solid is the one that deletes, the same red everywhere. Red outline is the middle "Delete
  permanently" of a normal delete, which asks once more. **The default (the focus, Enter) is Delete on a question
  that can be undone, and Cancel on every one that cannot** (permanent, Empty, a zip). Shift+Delete is still the bin.
- **Size.** A file's size is read once; a folder's is counted by the Properties counter (`useFolderSizes`) and
  fills in, a quiet "…" until then. The question and its buttons never wait. Several items show the total.
- **Only Empty has a bar**, one per drive the bin spans. Main answers `bin:usage` (`binUsage.ts`: the `$I` sizes
  per drive, the drive's size and free space from `driveUsage`).
- Held by the five dialog tests, `deleteCopy.test.ts`, `binUsage.test.ts`, and the `deleteQuestion`, `binDelete` and
  `binEmpty` e2e (every state shot in the default, a light and two high-contrast themes: `delete-question-*.png`,
  `bin-empty-dialog-*.png`).
