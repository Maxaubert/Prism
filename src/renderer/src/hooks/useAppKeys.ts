import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type { ViewerFile } from '@shared/types'
import { isTypingTarget } from '../lib/focusGuards'
import { isExplorerTab, type Tab } from '../lib/tabs/tabs'
import { copyFilePaths } from '../lib/fileClipboard'
import { browseParent } from '../lib/browse'
import type { useFolderBrowsing } from './useFolderBrowsing'
import type { BrowseEntry } from '../components/browse/FolderBrowser'
import type { Ask } from '../dialogs/asks'

// THE APP'S KEYS (out of App.tsx, structure cleanup 2026-10-12, unchanged):
// one capture-phase keydown listener for the window's chords, the folder's
// Up/Down and the Explorer's verbs. Each key's rule is commented where it is
// handled. App hands in what the keys act on.

/** The kinds a player owns Up and Down for once nothing else wants them. */
const PLAYABLE = new Set(['video', 'audio'])
/** The kinds that are read by scrolling: in FULL VIEW they own Up and Down
 *  (owner, 2026-10-28, "the arrow keys up and down navigate files while
 *  you're in it which it should not", all documents). */
const DOCUMENTS = new Set(['doc', 'pdf', 'text'])

/** The document scroller on screen (another tab's stays mounted, hidden). */
const shownDocScroller = (): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('[data-doc-scroller]')].find(
    (el) => el.getClientRects().length > 0 && !el.closest('[aria-hidden="true"]')
  ) ?? null
/** One arrow's worth of scroll, the browser's own line step. */
const LINE_PX = 40

// Whether the open document currently holds focus. Documents mark their own
// scroller with data-doc-scroller; nothing auto-focuses one, so this is true
// only after the user has actually clicked into (or tabbed to) the document.
const docFocused = (): boolean => {
  const el = document.activeElement
  return !!el && !!el.closest('[data-doc-scroller]')
}

export interface AppKeysDeps {
  setup: boolean
  settingsOpen: boolean
  fullscreen: boolean
  active: Tab | null
  browsing: ReturnType<typeof useFolderBrowsing>
  viewerDirectory: string | undefined
  pasteFiles: (directory: string) => Promise<void>
  file: ViewerFile | null
  setBrowseRename: Dispatch<SetStateAction<BrowseEntry | null>>
  setAsk: Dispatch<SetStateAction<Ask | null>>
  viewingFile: boolean
  returnToFolder: () => void
  setFs: (on: boolean) => void
  redo: () => void
  undo: () => void
  newTab: () => void
  closeActiveTab: () => void
  stepTab: (delta: number) => void
  jumpTab: (n: number) => void
  togglePanel: () => void
  go: (delta: number) => void
  hasNavigated: boolean
}

export function useAppKeys({
  setup,
  settingsOpen,
  fullscreen,
  active,
  browsing,
  viewerDirectory,
  pasteFiles,
  file,
  setBrowseRename,
  setAsk,
  viewingFile,
  returnToFolder,
  setFs,
  redo,
  undo,
  newTab,
  closeActiveTab,
  stepTab,
  jumpTab,
  togglePanel,
  go,
  hasNavigated
}: AppKeysDeps): void {
  // App-level keys, in the capture phase so this runs before the player's own
  // (bubble-phase) key listener. Arrow keys page through the folder, except a
  // freshly opened audio/video owns them for seeking (the player handles them).
  // The moment the user starts navigating (paging, or arrowing through
  // non-playable files), arrows keep navigating even on playable files; we then
  // claim the key (preventDefault) so the player yields it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      // isContentEditable covers the code editor: CodeMirror types into a div,
      // not a textarea, and the arrows there belong to the caret, not the folder.
      // THE HELP POPUP (#175) IS A TEXT FIELD WHEREVER ITS FOCUS IS. Its search
      // field already shielded these keys, but a click on a copy button, which
      // is what the popup is FOR, leaves the focus on that button, and this
      // listener hears every key the popup does (both are on window in the
      // capture phase, where one's stopPropagation does not silence the other).
      // MEASURED in the e2e before this line existed: Ctrl+W from a copy button
      // closed the tab under the popup, where from the search field it does
      // nothing. Ctrl+Z (a file move undone behind a scrim), Ctrl+T and the
      // vertical keys are behind the same shield for the same reason.
      const typing = isTypingTarget(el)
      // THE EXPLORER'S SEARCH POPUP (#267) owns every key while it is up: it
      // is drawn outside the Explorer (over the whole window), and a chord
      // that reached the app behind it would change what is under it.
      if (el?.closest('[data-search-popup]')) return
      // A MODAL DIALOG WITH THE FOCUS owns every key the same way (review of
      // the folder icons, 2026-10-31): the icon picker's grid is a focusable
      // list, not a field, and Up there paged the open file behind the scrim,
      // Ctrl+Z undid a move behind it and Ctrl+W closed the tab under it.
      // Escape is the dialog's own (data-owns-escape).
      if (el?.closest('[role="dialog"][aria-modal="true"]')) return
      // A MENU ROW WITH THE FOCUS owns the plain keys (#272): More opened from
      // the keyboard puts the focus on its first row, and Down there walked
      // the list too, whose row then took the focus out of the
      // menu (measured in the moreMenu e2e). The chords stay the app's.
      if (el?.closest('[role="menu"]') && !e.ctrlKey && !e.altKey && !e.metaKey) return
      // SETTINGS OWNS ITS PLAIN KEYS (#292): Up and Down walk its rail and
      // Find a setting's results, and the same press used to page the folder
      // behind it too. The chords and the function keys stay the app's.
      if (
        el?.closest('[data-settings-page]') &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        !/^F\d+$/.test(e.key) &&
        e.key !== 'Escape'
      )
        return
      const inBrowser = !!el?.closest('.folder-browser')
      if (inBrowser && e.altKey) return
      if (inBrowser && !e.ctrlKey && !e.altKey && e.key !== 'F11') return
      // The setup owns the window while it is up: none of these should reach the
      // app behind it, least of all Escape, which would close Prism mid-guide.
      if (setup) return
      if (!settingsOpen && !fullscreen && !document.querySelector('[data-owns-escape]')) {
        const explorerFileFocus =
          active &&
          isExplorerTab(active) &&
          (!browsing.folder || !!el?.closest('[data-workspace-viewer]')) &&
          !typing &&
          !el?.closest(
            '.cm-editor,[role="dialog"],[role="menu"],[role="separator"],.browse-viewer-places'
          ) &&
          (el === document.body || !!el?.closest('[data-workspace-viewer]'))
        if (
          explorerFileFocus &&
          e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          ['c', 'x', 'v'].includes(e.key.toLowerCase()) &&
          !window.getSelection()?.toString()
        ) {
          e.preventDefault()
          e.stopPropagation()
          const key = e.key.toLowerCase()
          if (key === 'v' && viewerDirectory) void pasteFiles(viewerDirectory)
          else if (file) void copyFilePaths([file.path], key === 'x')
          return
        }
        if (explorerFileFocus && file && !e.ctrlKey && !e.altKey && !e.metaKey) {
          const entry = { path: file.path, name: file.name, isFolder: false, file }
          if (e.key === 'F2' && !e.shiftKey) {
            e.preventDefault()
            e.stopPropagation()
            setBrowseRename(entry)
            return
          }
          // Shift+Delete is Delete, to the bin (owner, #330): never permanent.
          if (e.key === 'Delete') {
            e.preventDefault()
            e.stopPropagation()
            setAsk({ kind: 'delete', ...entry })
            return
          }
        }
        if (
          viewingFile &&
          !typing &&
          e.key === 'Backspace' &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.metaKey
        ) {
          const archiveOwnsBackspace = [
            ...document.querySelectorAll('[data-archive-subfolder]')
          ].some((node) => !node.closest('[inert],[aria-hidden="true"]'))
          if (archiveOwnsBackspace || e.defaultPrevented) return
          e.preventDefault()
          e.stopPropagation()
          returnToFolder()
          return
        }
        if (viewingFile && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'l') {
          e.preventDefault()
          e.stopPropagation()
          document
            .querySelector<HTMLButtonElement>(
              '.browse-viewer-toolbar [data-testid="browse-edit-path"]'
            )
            ?.click()
          return
        }
      }
      // THE COMMON LIST KEYS (#330) are the list's own: Shift and Ctrl with
      // Up/Down extend the marks or move the keyboard's place there, and must
      // not also page the folder behind it.
      const inLists = !!el?.closest('.browse-list')
      if (
        active &&
        isExplorerTab(active) &&
        e.altKey &&
        !typing &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(e.key)
      ) {
        e.preventDefault()
        if (e.key === 'ArrowLeft') {
          if (viewingFile) returnToFolder()
          else browsing.travel(-1)
        } else if (e.key === 'ArrowRight') browsing.travel(1)
        else if (active) {
          const parent = viewingFile ? viewerDirectory : browseParent(active.browse.path)
          if (parent) void browsing.navigate(parent)
        }
      } else if (e.key === 'F11') {
        e.preventDefault()
        setFs(!fullscreen)
      } else if (e.ctrlKey && !typing && !fullscreen && /^[zy]$/i.test(e.key)) {
        // Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) undo Prism's OWN writes. Behind
        // the typing guard, so the text editor and the shell keep their own -
        // and behind FULLSCREEN (2026-08-28), where the tree and its verbs are
        // not on screen: a keystroke that moves files about while you cannot
        // see them is a change you did not mean to make.
        e.preventDefault()
        if (e.key.toLowerCase() === 'y' || e.shiftKey) redo()
        else undo()
      } else if (
        (e.code === 'KeyT' || e.key === 't' || e.key === 'T') &&
        e.ctrlKey &&
        !typing
      ) {
        e.preventDefault()
        newTab()
      } else if (
        (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') &&
        e.ctrlKey &&
        !typing
      ) {
        // On the last tab it closes the window, as File Explorer does (owner,
        // 2026-10-28, #450), after the unsaved-text ask like any close.
        e.preventDefault()
        closeActiveTab()
      } else if (e.key === 'Tab' && e.ctrlKey && !typing) {
        e.preventDefault()
        stepTab(e.shiftKey ? -1 : 1)
      } else if (e.ctrlKey && !typing && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        jumpTab(Number(e.key))
      } else if (
        (e.code === 'KeyB' || e.key === 'b' || e.key === 'B') &&
        e.ctrlKey &&
        !typing
      ) {
        e.preventDefault()
        togglePanel()
      } else if (e.key === 'Escape') {
        // Settings owns Escape while it's open (its own handler closes it).
        // Without this, the window would shut instead: both listeners are on
        // window in the capture phase, and this one was registered first.
        if (settingsOpen) return
        // So does anything transient that closes itself on Escape (the PDF find
        // bar, an open menu) and any focused input: this listener runs first
        // (capture, registered earliest), so it has to yield by inspection.
        if (typing || document.querySelector('[data-owns-escape]')) return
        // A focused document gives the keys back before the window gives up.
        // Escape is the way out of a document you clicked into, the same as it
        // is out of the text editor; only then does it reach the window.
        if (docFocused()) {
          e.preventDefault()
          ;(document.activeElement as HTMLElement | null)?.blur()
          return
        }
        // ESCAPE DOES NOT CLOSE THE WINDOW (owner, 2026-09-01), IN ANY STATE
        // (#14, owner, 2026-11-01: "escape should not interact with app
        // close"; Settings' own Escape obeys it too). It used to,
        // which is the image-viewer habit and wrong for this one: Prism is
        // RESIDENT and holds tabs and unsaved text, and a reflex
        // keystroke that puts all of that away is the same failure the close
        // flow exists to prevent - the more so because Escape is the key you
        // press to back out of things, not to leave.
        //
        // What it still does is step back out of something: fullscreen here,
        // and a focused document just above. When there is nothing to back out
        // of, it does nothing at all. Ctrl+W closes a tab; the X closes the
        // window.
        if (fullscreen) setFs(false)
      } else if ((e.key === 'PageDown' || e.key === 'PageUp') && !typing) {
        // Same rule as the arrows: the document has these only once it has
        // been focused. Reading a pdf from the sidebar should page the folder.
        if (docFocused()) return
        go(e.key === 'PageDown' ? 1 : -1)
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !typing) {
        // FOCUS decides, for every kind. A document owns the vertical keys only
        // while it is focused - click into it, or Tab to it. Until then it has
        // no more claim on them than a photo does, so arrowing through a folder
        // from the sidebar behaves the same whatever kind of file it lands on.
        // (`typing` already covered the text editor's caret, above.)
        if (docFocused()) return
        // A DOCUMENT IN FULL VIEW SCROLLS (owner, 2026-10-28): the first
        // arrow focuses it and scrolls a line, the rest are its own. The list,
        // not the open document, is where Up and Down walk the folder.
        if (viewingFile && !!file && DOCUMENTS.has(file.kind) && !e.ctrlKey && !e.altKey && !e.shiftKey) {
          const scroller = shownDocScroller()
          if (scroller) {
            e.preventDefault()
            scroller.focus({ preventScroll: true })
            scroller.scrollBy({ top: e.key === 'ArrowDown' ? LINE_PX : -LINE_PX })
            return
          }
        }
        // Alt too: Alt+Up is the list's parent row (review of #330).
        if (inLists && (e.ctrlKey || e.shiftKey || e.altKey)) return
        // A player in front of you: Up/Down are the VOLUME, which is what every
        // media player has taught (2026-08-30). They used to be
        // preventDefault-ed unconditionally here, and useMediaControls yields
        // on defaultPrevented, so the volume keys were dead everywhere.
        if (!!file && PLAYABLE.has(file.kind)) return // player handles it
        e.preventDefault()
        go(e.key === 'ArrowDown' ? 1 : -1)
      }
      // LEFT AND RIGHT ARE NOT NAVIGATION KEYS (owner, 2026-09-01: "we only use
      // up and down there from now on"). They used to page the folder and drive
      // the tree, which meant every viewer that wanted them had to be FOCUSED
      // first, and the two kinds that did want them - a comic turning pages, a
      // player scrubbing - had to be carved out of App by hand.
      //
      // So App does not handle them at all now. Nothing is preventDefaulted,
      // and the keys reach whichever viewer is mounted: `useMediaControls`
      // seeks a video or a track five seconds, and ComicView turns a page. Every
      // other kind gets them and does nothing with them, which is the intent -
      // the folder is paged with Up and Down, in the tree or out of it.
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    active,
    closeActiveTab,
    browsing,
    pasteFiles,
    viewingFile,
    viewerDirectory,
    returnToFolder,
    file,
    fullscreen,
    go,
    hasNavigated,
    jumpTab,
    newTab,
    redo,
    settingsOpen,
    setup,
    stepTab,
    togglePanel,
    undo,
    setAsk,
    setBrowseRename,
    setFs
  ])
}
