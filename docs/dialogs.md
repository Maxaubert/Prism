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
| `DeleteDialog` | Move one file or folder to the Recycle Bin? | App (`delete`): Explorer row, tree row, Delete key |
| `DeleteManyDialog` | Move N items to the Recycle Bin? | App (`delete-many`): marked rows |
| `MoveClashDialog` | Names already taken where a move lands: Keep both or Replace | App (`move-clash`): drag, paste |
| `NameTakenDialog` | A rename onto a taken name: Replace or Keep both | App (`clash`) |
| `FileChangedDialog` | A file with unsaved edits changed on disk: Keep mine or Reload | App (`file-changed`) |
| `UnsavedDialog` | Unsaved changes: Cancel, Discard, Save all changes | App (`close-dirty`, `close-tab`) |
| `NoticeDialog` | One line that did not work, one button | App (`failed`, "That didn't work"), `Sidebar.tsx` (Paste, Add to archive), `archive/useArchiveOps.tsx` ("Archive") |
| `PasswordDialog` | The archive's password (again, when it was wrong) | `archive/useArchiveOps.tsx`, `ArchiveView.tsx`, `MemberGate.tsx`, App (Explorer inside a zip) |
| `ArchiveDeleteDialog` | Delete members from a zip, for good (Cancel is primary) | `archive/useArchiveOps.tsx` |
| `ArchiveClashDialog` | Added files land on names the zip has: Keep both | `archive/useArchiveOps.tsx` |
| `ArchiveFactsDialog` | A zip member's facts | `browse/useArchiveActions.tsx` |
| `FolderIconDialog` | Icon for a folder (or N folders): search, a grid of the built-in icons, Cancel, Reset to default, From a file... (the picture's refusal is App's `failed` NoticeDialog, its text `ICON_REFUSED` in `lib/iconFromFile.ts`). A body that is a tool, so `Dialog`'s `wide` box | App (`folder-icon`): Change icon... on a folder row, marked folder rows, a sidebar pin |

Not here, on purpose: forms and panels that are more than a question. `browse/BrowseRename.tsx`
(the rename field in a dialog), `properties/PropertiesDialog.tsx`, `PhoneDialog.tsx`, the core's
`UpdateDialog`, and `ExtractWindow.tsx` (it cannot be dismissed, so it shares only the look).
