import { useCallback, useEffect, useState, type JSX } from 'react'
import { ImageView } from './ImageView'
import { openDocAt, rememberDocPos, saveDocPos } from '../lib/docPosition'
import { preloadImage } from '../lib/imageLoader'
import { useAutoHideChrome } from '../lib/autoHideChrome'

/**
 * A comic book (2026-08-31).
 *
 * A .cbz or .cbr is an archive of pictures, and Prism already shows pictures
 * well - so this is not a new viewer, it is a PAGE LIST wrapped around the
 * one that exists. Zoom, pan, rotate, fullscreen and the image menu all come
 * for free and behave exactly as they do on a jpeg in a folder.
 *
 * Left and Right turn the page (owner decision), which is the one place in
 * Prism where those keys do not page the folder. Ctrl+Left and Ctrl+Right
 * keep the folder, so the next comic is still one keystroke away. The
 * position is remembered the way a PDF's is: a book you put down opens where
 * you left it.
 *
 * Main unpacks the container ONCE into a cache directory and hands back
 * ordinary file paths; nothing about the archive reaches the renderer, and no
 * page is ever unzipped here.
 */
export function ComicView({
  path,
  name,
  onToggleFullscreen,
  fullscreen = false
}: {
  path: string
  name: string
  onToggleFullscreen: () => void
  fullscreen?: boolean
}): JSX.Element {
  const [state, setState] = useState<
    | { for: string; pages: string[] }
    | { for: string; error: 'password' | 'failed' | 'empty' }
    | null
  >(null)
  const [page, setPage] = useState(0)
  const [restoredFor, setRestoredFor] = useState<string | null>(null)

  const loaded = state?.for === path ? state : null
  const pages = loaded && 'pages' in loaded ? loaded.pages : null
  const total = pages?.length ?? 0

  // Both of these are done while RENDERING, the way the viewer resets
  // everything else per file: an effect runs a frame too late, so the new
  // comic gets one frame wearing the old one's page number.
  const [shownFor, setShownFor] = useState(path)
  // The same clock the picture's own controls run on, so the counter and the
  // zoom cluster come and go together rather than one outliving the other.
  const { shown: chromeShown } = useAutoHideChrome(
    useCallback(() => !!document.querySelector('[data-viewer-chrome]:hover'), [])
  )
  if (shownFor !== path) {
    setShownFor(path)
    setPage(0)
    setRestoredFor(null)
  } else if (total && restoredFor !== path) {
    // Open where you put it down, once the pages are known and once per book.
    setRestoredFor(path)
    const want = openDocAt(path)
    if (want > 1) setPage(Math.min(Math.round(want) - 1, total - 1))
  }

  useEffect(() => {
    let alive = true
    void window.prism.comicOpen(path).then((r) => {
      if (!alive) return
      setState('pages' in r ? { for: path, pages: r.pages } : { for: path, error: r.error })
    })
    return () => {
      alive = false
    }
  }, [path])

  const go = useCallback(
    (delta: number) => {
      setPage((p) => Math.min(Math.max(0, p + delta), Math.max(0, total - 1)))
    },
    [total]
  )

  // Remember the page. Same rule as the pdf: the session position always, the
  // stored one only when the number actually changes.
  useEffect(() => {
    if (!total) return
    rememberDocPos(path, page + 1)
    saveDocPos(path, page + 1, total, true)
  }, [page, total, path])

  // The neighbours, so a page turn is instant. Both directions: a comic is
  // read forward, but going back a page must not stall either.
  useEffect(() => {
    if (!pages) return
    for (const d of [1, -1]) {
      const at = pages[page + d]
      if (at) preloadImage(window.prism.mediaUrl(at))
    }
  }, [pages, page])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = document.activeElement as HTMLElement | null
      // The search box, a rename and the shell keep their own arrows.
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
      if (el?.closest('.xterm')) return
      // Ctrl+arrow is the FOLDER's, deliberately: it is how you reach the
      // next book. App handles that one; this only claims the plain arrows,
      // and App yields them by finding data-owns-arrows in the DOM.
      // No Ctrl guard any more: it existed to yield Ctrl+arrow to App's folder
      // paging, and App does not handle Left/Right at all now. The folder is
      // paged with Up and Down, which is how you reach the next book.
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (!total) return
      e.preventDefault()
      e.stopPropagation()
      go(e.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, total])

  if (loaded && 'error' in loaded) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <div className="max-w-[26rem] text-sm text-[var(--p-dim)]">
          {loaded.error === 'password'
            ? 'This comic is password-protected, and Prism has no password for it.'
            : loaded.error === 'empty'
              ? 'There are no pages in this comic.'
              : 'This comic could not be opened.'}
        </div>
      </div>
    )
  }

  if (!pages) {
    return (
      <div className="grid h-full place-items-center text-sm text-[var(--p-dim)]">Opening…</div>
    )
  }

  const at = Math.min(page, total - 1)
  const pageName = pages[at]?.split(/[\\/]/).pop() ?? name

  return (
    <div data-owns-arrows className="relative h-full w-full">
      <ImageView
        // Keyed by page, so each one mounts fresh: zoom and rotation belong to
        // the page you are looking at, exactly as they do in a folder.
        key={pages[at]}
        url={window.prism.mediaUrl(pages[at])}
        name={pageName}
        onToggleFullscreen={onToggleFullscreen}
        fullscreen={fullscreen}
      />
      {/* The page counter. MOUNTS and UNMOUNTS rather than fading, the rule
          the transport learned the hard way: a layer taken to opacity 0
          inside a fullscreen element is composited once and never repainted.
          It hides with the picture's own controls now, on the same clock.

          AND IT SITS ABOVE THEM. It was at bottom-4, which is where the image
          viewer puts its zoom cluster, so the two were drawn on top of one
          another: the counter won on z-index and the cluster's `+` and `1:1`
          showed through from behind it. Different rows, not a fight over the
          same one. */}
      {total > 1 && chromeShown && (
        <div className="pointer-events-none absolute bottom-[3.6rem] left-1/2 z-20 -translate-x-1/2 rounded-full border border-[color:var(--p-divider)] bg-[var(--p-side-flat)]/90 px-3 py-1 text-[11.5px] tabular-nums text-[var(--p-dim)]">
          Page {at + 1} of {total}
        </div>
      )}
    </div>
  )
}
