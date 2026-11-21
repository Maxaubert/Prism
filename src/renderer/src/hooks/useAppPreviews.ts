import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { ViewerFile } from '@shared/types'
import { isMarkdown } from '@shared/fileKind'
import type { Tab } from '../lib/tabs/tabs'
import { explorerHeadVars } from '../lib/explorerSize'
import { headSizeOf, useExplorerZoom } from '../lib/explorerZoom'
import { usePreviewOpensIn } from '../lib/prefs/previewPrefs'
import { useExplorerWidths } from './useExplorerWidths'
import { useLinger } from './useLinger'
import { usePreviewSlide } from './usePreviewSlide'
import type { useFolderBrowsing } from './useFolderBrowsing'

// The Explorer's preview, in its pane or in a window of its own (audit #8,
// 2026-11-21): which of the two is up, the slide, the widths and the toggles.
// Moved out of App.tsx unchanged.

export interface AppPreviewsDeps {
  active: Tab | null
  activeId: string | null
  browsing: ReturnType<typeof useFolderBrowsing>
  file: ViewerFile | null
  fullscreen: boolean
  editMode: boolean
  placesVisible: boolean
  viewerBox: RefObject<HTMLDivElement | null>
}

export interface AppPreviews {
  showBrowsePreview: boolean
  paneShown: boolean
  windowShown: boolean
  previewWindowUp: boolean
  previewWindowGen: number
  previewSlide: ReturnType<typeof usePreviewSlide>
  previewFlush: boolean
  headVars: ReturnType<typeof explorerHeadVars>
  explorerWidths: ReturnType<typeof useExplorerWidths>
  togglePreview: () => void
  closePreviewWindow: () => void
}

export function useAppPreviews({
  active,
  activeId,
  browsing,
  file,
  fullscreen,
  editMode,
  placesVisible,
  viewerBox
}: AppPreviewsDeps): AppPreviews {
  // The pane shows the file on display, or nothing at all when a navigation
  // took that file away while the pane was open (`previewHeld`, #300 review):
  // it stays at its width with "Select a file to preview".
  const showBrowsePreview =
    browsing.folder &&
    !!active?.browse.preview &&
    (browsing.previewFile
      ? file?.path === browsing.previewFile.path
      : !file && !!active.browse.previewHeld)
  // THE PREVIEW OPENS IN THE PANEL OR IN A WINDOW (owner, 2026-11-08: "a
  // preview which opens as a separate window. just like apple does it"). The
  // same preview either way (the toggle, the file, the arrows, the viewer);
  // only where it is drawn changes. In window mode the pane never opens and
  // the viewer is rendered into PreviewWindow, which stays mounted for its
  // fade out (`previewWindowUp`).
  const previewInWindow = usePreviewOpensIn() === 'window'
  // The tabs whose preview window was OPENED, by a toggle, this session. In
  // window mode the tab's preview flag is the window, and only a toggle opens
  // it: a flag left on by the panel, a restore or a file from Windows is put
  // back off, so the window never appears unasked. State, not a ref (owner,
  // 2026-11-09, the log's arm, open, shut at 13:41:02 and :10): it is only ever MADE
  // for a tab in here, so that flag no longer arms, opens and shuts one in the
  // commit before the effect below takes it back. `markdownPreview` e2e.
  const [windowTabs, setWindowTabs] = useState<ReadonlySet<string>>(() => new Set())
  const paneShown = showBrowsePreview && !previewInWindow
  const windowShown =
    showBrowsePreview && previewInWindow && !fullscreen && !!activeId && windowTabs.has(activeId)
  const previewWindowUp = useLinger(windowShown, 220) && browsing.folder && !fullscreen
  // Each opening is a window of its own (review 2026-11-08): a Space that
  // reopens it while the last one still fades out (or before it was even
  // made) mounts a fresh PreviewWindow, never the old one main has closed.
  const [previewWindowGen, setPreviewWindowGen] = useState(0)
  const [windowWasShown, setWindowWasShown] = useState(windowShown)
  if (windowShown !== windowWasShown) {
    setWindowWasShown(windowShown)
    if (windowShown) setPreviewWindowGen((g) => g + 1)
  }
  // The pane slides open and shut on its toggle (#207): `out` keeps it laid
  // out while it closes, `widthShown` holds it at 0px for an opening's first frame.
  const previewSlide = usePreviewSlide(paneShown, viewerBox)
  // A file's own text in the preview starts on the column header's line (#283;
  // owner, 2026-10-04: "the position of the sorting bar ... that's the height
  // I want the txt files to start at"): the pane takes the header's top, the
  // first line is centred in the header's band and the full view button
  // floats in that band at the right. Text read as source only; a Markdown
  // page, a picture or a film keeps the button's own strip above it.
  const previewFlush = !!file && file.kind === 'text' && !isMarkdown(file.name) && !editMode
  const headVars = explorerHeadVars(headSizeOf(useExplorerZoom()))
  const explorerWidths = useExplorerWidths(placesVisible, previewSlide.widthShown)
  const noteWindowTab = useCallback((tabId: string, opened: boolean) => {
    setWindowTabs((s) => {
      if (s.has(tabId) === opened) return s
      const next = new Set(s)
      if (opened) next.add(tabId)
      else next.delete(tabId)
      return next
    })
  }, [])
  const togglePreview = useCallback(() => {
    // Only a pane that is really on screen slides shut, and only one that is
    // really off slides open; a preview switched on over a folder shows nothing.
    if (previewInWindow) {
      // The window fades instead (PreviewWindow).
      if (activeId) noteWindowTab(activeId, !active?.browse.preview)
    } else if (showBrowsePreview) previewSlide.start(true)
    else if (!active?.browse.preview) previewSlide.start(false)
    browsing.togglePreview()
  }, [previewInWindow, activeId, showBrowsePreview, active?.browse.preview, previewSlide, browsing, noteWindowTab])
  /** The preview window's own closes (Escape, its button, Alt+F4): off,
   *  never on again if it was off already. */
  const closePreviewWindow = useCallback(() => {
    if (activeId) noteWindowTab(activeId, false)
    if (active?.browse.preview) browsing.togglePreview('window-closed')
  }, [activeId, active?.browse.preview, browsing, noteWindowTab])
  const previewOn = !!active?.browse.preview
  const browsingFolder = browsing.folder
  const togglePreviewOff = browsing.togglePreview
  useEffect(() => {
    if (!previewInWindow || !previewOn || !activeId || !browsingFolder) return
    if (!windowTabs.has(activeId)) togglePreviewOff('unasked')
  }, [previewInWindow, previewOn, activeId, browsingFolder, togglePreviewOff, windowTabs])

  return {
    showBrowsePreview,
    paneShown,
    windowShown,
    previewWindowUp,
    previewWindowGen,
    previewSlide,
    previewFlush,
    headVars,
    explorerWidths,
    togglePreview,
    closePreviewWindow
  }
}
