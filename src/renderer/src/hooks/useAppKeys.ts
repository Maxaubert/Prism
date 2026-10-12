import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { ViewerFile } from '@shared/types'
import { isTypingTarget } from '../lib/focusGuards'
import { isExplorerTab, type Tab, type TermView } from '../lib/tabs/tabs'
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
  termView: TermView
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
  restoreTermFocus: (id?: string | undefined) => void
  toggleTerm: () => void
  setTermFind: Dispatch<SetStateAction<boolean>>
  openTermFull: () => void
  newTab: () => void
  unpinSplitId: (paneId: string) => void
  closeActiveTab: () => void
  stepTab: (delta: number) => void
  jumpTab: (n: number) => void
  togglePanel: () => void
  go: (delta: number) => void
  treeNav: RefObject<((dir: 'up' | 'down') => boolean) | null>
  hasNavigated: boolean
}

export function useAppKeys({
  setup,
  settingsOpen,
  fullscreen,
  active,
  termView,
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
  restoreTermFocus,
  toggleTerm,
  setTermFind,
  openTermFull,
  newTab,
  unpinSplitId,
  closeActiveTab,
  stepTab,
  jumpTab,
  togglePanel,
  go,
  treeNav,
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
      // A focused terminal is typing too (xterm's hidden textarea), but the
      // tab-management hotkeys (Ctrl+T/W/Tab/digits) and Ctrl+B (sidebar)
      // still belong to Prism there, by request - which does cost the shell
      // Ctrl+W (delete-word) and Ctrl+B (vim page-up, tmux's prefix). The
      // keys shells truly live on - Ctrl+C, Ctrl+D (EOF), Ctrl+S (XOFF),
      // Escape, the arrows - stay the shell's; only the search box, a rename
      // and the text editor keep the full typing shield.
      const inTerm = !!el && !!el.closest('.xterm')
      // THE EXPLORER'S SEARCH POPUP (#267) owns every key while it is up: it
      // is drawn outside the Explorer (over the whole window), and a chord
      // that reached the app behind it would change what is under it.
      if (el?.closest('[data-search-popup]')) return
      // A MENU ROW WITH THE FOCUS owns the plain keys (#272): More opened from
      // the keyboard puts the focus on its first row, and Down there walked
      // the sidebar's tree too, whose row then took the focus out of the
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
          termView !== 'full' &&
          (!browsing.folder || !!el?.closest('[data-workspace-viewer]')) &&
          !typing &&
          !inTerm &&
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
          !inTerm &&
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
        if (viewingFile && !inTerm && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'l') {
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
      // THE COMMON LIST KEYS (#330) are the list's and the tree's own: Shift
      // and Ctrl with Up/Down extend the marks or move the keyboard's place
      // there, and must not also walk the tree (which OPENS what it lands on)
      // or page the folder behind it. Alt+Up in the tree is its parent row.
      const inLists = !!el?.closest('.browse-list,[data-project-sidebar]')
      if (
        active &&
        isExplorerTab(active) &&
        e.altKey &&
        !inTerm &&
        !typing &&
        !el?.closest('[data-project-sidebar]') &&
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
      } else if (e.ctrlKey && !typing && !inTerm && !fullscreen && /^[zy]$/i.test(e.key)) {
        // Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) undo Prism's OWN writes. Behind
        // the typing guard, so the text editor and the shell keep their own -
        // and behind FULLSCREEN (2026-08-28), where the tree and its verbs are
        // not on screen: a keystroke that moves files about while you cannot
        // see them is a change you did not mean to make.
        e.preventDefault()
        if (e.key.toLowerCase() === 'y' || e.shiftKey) redo()
        else undo()
      } else if (e.key === '`' && e.ctrlKey) {
        // NOT behind the typing guard: one of the few keys Prism claims over
        // a focused terminal (F11 and Ctrl+Shift+T are the others).
        // Everything else, Escape and Ctrl+W included, belongs to the shell.
        //
        // Three-way, VS Code's rule (2026-08-31): a terminal that is SHOWING
        // but does not have the keyboard gets the keyboard, and only a second
        // press - from inside it - hides it. The old two-way toggle meant
        // that reaching for the shell you could already see put it away, so
        // you pressed it twice and got a scroll position you had not asked
        // for. `toggleTermView` itself is unchanged, and still tested.
        e.preventDefault()
        // Over the help popup (#175) the key means what it says, "the terminal":
        // the popup goes and the shell has the keyboard. Handing the shell the
        // focus with the popup still up is the failure the core warns about,
        // a question typed "into the search field" landing in the shell.
        if (termView !== 'hidden' && !inTerm) restoreTermFocus()
        else toggleTerm()
      } else if (
        (e.code === 'KeyF' || e.key === 'f' || e.key === 'F') &&
        e.ctrlKey &&
        e.shiftKey &&
        termView !== 'hidden'
      ) {
        // Claimed over a focused shell too (xterm's own handler returns false
        // for it, or the pty would get the bytes as well). Only while a
        // terminal is showing: Ctrl+Shift+F means nothing otherwise, and
        // swallowing it everywhere would be chrome pretending to be a feature.
        e.preventDefault()
        setTermFind(true)
      } else if ((e.code === 'KeyT' || e.key === 't' || e.key === 'T') && e.ctrlKey && e.shiftKey) {
        // Also claimed while the shell is focused: it never hides, it only
        // brings the terminal to full view, so it cannot eat typed text.
        e.preventDefault()
        openTermFull()
      } else if (
        (e.code === 'KeyT' || e.key === 't' || e.key === 'T') &&
        e.ctrlKey &&
        (!typing || inTerm)
      ) {
        e.preventDefault()
        newTab()
      } else if (
        (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') &&
        e.ctrlKey &&
        (!typing || inTerm)
      ) {
        // Close the innermost thing first: split panes pop LIFO (tabs within
        // the tab), and only with none left does Ctrl+W reach the tab itself.
        // It still never takes the window on the last tab: Prism is resident,
        // and a window that vanishes under a reflex keystroke - with unsaved
        // text in it - is the failure the close flow exists to prevent.
        e.preventDefault()
        if (active && !isExplorerTab(active) && active.panes.length > 0) {
          unpinSplitId(active.panes[active.panes.length - 1].id)
        } else {
          closeActiveTab()
        }
      } else if (e.key === 'Tab' && e.ctrlKey && (!typing || inTerm)) {
        e.preventDefault()
        stepTab(e.shiftKey ? -1 : 1)
      } else if (e.ctrlKey && (!typing || inTerm) && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        jumpTab(Number(e.key))
      } else if (
        (e.code === 'KeyB' || e.key === 'b' || e.key === 'B') &&
        e.ctrlKey &&
        (!typing || inTerm)
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
        // ESCAPE DOES NOT CLOSE THE WINDOW (owner, 2026-09-01). It used to,
        // which is the image-viewer habit and wrong for this one: Prism is
        // RESIDENT and holds tabs, a terminal and unsaved text, and a reflex
        // keystroke that puts all of that away is the same failure the close
        // flow exists to prevent - the more so because Escape is the key you
        // press to back out of things, not to leave.
        //
        // What it still does is step back out of something: fullscreen here,
        // and a focused document just above. When there is nothing to back out
        // of, it does nothing at all. Ctrl+W closes a tab; the X closes the
        // window.
        if (fullscreen) setFs(false)
      } else if ((e.key === 'PageDown' || e.key === 'PageUp') && !typing && termView !== 'full') {
        // Same rule as the arrows: the document has these only once it has
        // been focused. Reading a pdf from the sidebar should page the folder.
        if (docFocused()) return
        go(e.key === 'PageDown' ? 1 : -1)
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !typing && termView !== 'full') {
        // FOCUS decides, for every kind. A document owns the vertical keys only
        // while it is focused - click into it, or Tab to it. Until then it has
        // no more claim on them than a photo does, so arrowing through a folder
        // from the sidebar behaves the same whatever kind of file it lands on.
        // (`typing` already covered the text editor's caret, above.)
        if (docFocused()) return
        // Alt too: Alt+Up is the tree's parent row, and walking the tree here
        // first would open or play the row above on the way (review of #330).
        if (inLists && (e.ctrlKey || e.shiftKey || e.altKey)) return
        // The tree gets first refusal: it walks folders as well as files, and
        // says no when it isn't there to walk.
        const dir = e.key === 'ArrowDown' ? 'down' : 'up'
        if (!fullscreen && treeNav.current?.(dir)) {
          e.preventDefault()
          return
        }
        // Nothing to walk, and a player in front of you: Up/Down are the
        // VOLUME, which is what every media player has taught (2026-08-30).
        // They used to be preventDefault-ed unconditionally here, and
        // useMediaControls yields on defaultPrevented, so the volume keys were
        // dead everywhere - most obviously in fullscreen, where the sidebar is
        // gone and there is nothing else for them to do. The player only gets
        // them when the tree does not want them, so browsing a folder from the
        // sidebar is unchanged.
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
    openTermFull,
    redo,
    restoreTermFocus,
    settingsOpen,
    setup,
    stepTab,
    termView,
    togglePanel,
    toggleTerm,
    undo,
    unpinSplitId,
    setAsk,
    setBrowseRename,
    setFs,
    setTermFind,
    treeNav
  ])
}
