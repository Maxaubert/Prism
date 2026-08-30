import { useEffect, useRef, useState, type JSX } from 'react'
import { ContextMenu } from './ContextMenu'
import { fileVerbs, MenuIcon } from '../lib/fileVerbs'
import { DocFind } from './DocFind'
import { openDocAt, rememberDocPos, saveDocPos } from '../lib/docPosition'

/** How far the reader must move before the position is written to disk. */
const SAVE_STEP = 200

/**
 * Office and ebook documents: Word, spreadsheets, presentations, ODF and epub.
 *
 * The HTML arrives from main already converted AND already sanitised (see
 * docSanitize.ts), so this only has to lay it out and let it scroll. It is a
 * reading view, not an editor and not a fidelity claim: a spreadsheet is one
 * table per sheet, a presentation is its slides in order.
 *
 * Marked `data-doc-scroller`, so the app's focus rule gives it the vertical
 * keys once you click into it, exactly like the PDF and code viewers.
 */
export function DocView({ path, name }: { path: string; name: string }): JSX.Element {
  // Keyed by the file it describes, so a new document is 'loading' by
  // construction and no effect has to reset anything.
  const [got, setGot] = useState<{ path: string; html: string | null } | null>(null)
  const mine = got?.path === path ? got : null
  const state: 'loading' | 'ready' | 'failed' = !mine ? 'loading' : mine.html === null ? 'failed' : 'ready'
  const html = mine?.html ?? null
  const box = useRef<HTMLDivElement>(null)
  /** Which path the restore has already run for; it must not run twice. */
  const restoredFor = useRef<string | null>(null)
  const lastSaved = useRef(0)
  const [finding, setFinding] = useState(false)
  // The bar belongs to the document it was opened on. Paging to the next file
  // left it up, still counting matches in a document that is no longer there:
  // its Ranges point at detached nodes, so the arrows scrolled nothing. Done
  // while RENDERING, the way the viewer resets everything else per file - an
  // effect would show one frame of the old bar over the new document.
  const [findFor, setFindFor] = useState(path)
  if (findFor !== path) {
    setFindFor(path)
    setFinding(false)
  }
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    let live = true
    void window.prism.docHtml(path).then((h) => {
      if (live) setGot({ path, html: h })
    })
    return () => {
      live = false
    }
  }, [path])

  /**
   * Open where you left off (2026-08-30).
   *
   * A 10-minute film reopened at its own position and a 400-page document did
   * not, which is backwards: the film is the one you can find your place in
   * by scrubbing. One-shot per path, because this effect can re-run and a
   * second scroll would drag the reader back up mid-read.
   */
  useEffect(() => {
    if (state !== 'ready') return
    if (restoredFor.current === path) return
    restoredFor.current = path
    const el = box.current
    if (!el) return
    // After paint: the HTML has just landed and the scroller has no height
    // until it has been laid out, so an immediate scrollTo lands at 0.
    requestAnimationFrame(() => {
      const want = openDocAt(path)
      el.scrollTo({ top: want > 0 ? want : 0 })
    })
  }, [state, path])

  /**
   * Ctrl+F belongs to the open document whether or not it has focus, and
   * nothing focuses a document on arrival (2026-08-17), so this is a window
   * listener rather than one on this subtree - the same shape PdfView and
   * CodeView use. Capture, so it lands before anything else claims the key.
   */
  /**
   * Ctrl+F belongs to the document you are LOOKING at (2026-08-30).
   *
   * A window listener is right - nothing focuses a document on arrival, so
   * this key has to work without focus - but "the window" holds more than one
   * viewer: split view mounts up to four, and the media deck keeps others
   * alive behind the strip. Without an ownership test every mounted document
   * opened its own find bar, and the last one to register won the focus, so
   * pressing Ctrl+F over a PDF opened the markdown pane's bar instead.
   *
   * Three tests, cheapest first: not covered by Settings (`[inert]`, the same
   * check PdfView makes), not in a hidden tab, and either this pane holds the
   * focus or nothing in another pane does.
   */
  const ownsKeys = (): boolean => {
    const el = box.current
    if (!el || el.closest('[inert]') || el.closest('[hidden]')) return false
    if (!el.isConnected || !el.offsetParent) return false
    const active = document.activeElement as HTMLElement | null
    if (active && active !== document.body) {
      // Somebody has the focus: only the pane containing it may answer.
      const pane = active.closest('[data-doc-scroller], .cm-editor, [data-pdf-scroller]')
      if (pane && pane !== el && !el.contains(active)) return false
    }
    return true
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey && (e.key === 'f' || e.key === 'F'))) return
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return
      if (!ownsKeys()) return
      e.preventDefault()
      e.stopPropagation()
      setFinding(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])


  if (state === 'loading') {
    return (
      <div className="grid h-full w-full place-items-center text-sm text-[var(--p-dim)]">
        Reading {name}…
      </div>
    )
  }
  if (state === 'failed' || html === null) {
    return (
      <div className="grid h-full w-full place-items-center px-8 text-center text-sm text-[var(--p-text-soft)]">
        Prism could not read this document. It may be password-protected, or damaged.
      </div>
    )
  }
  return (
    <div
      className="relative h-full w-full"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
    {finding && <DocFind scroller={box} onClose={() => setFinding(false)} />}
    {menu && (
      <ContextMenu
        x={menu.x}
        y={menu.y}
        onClose={() => setMenu(null)}
        items={[
          {
            label: 'Find',
            hint: 'Ctrl+F',
            icon: <MenuIcon d="M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15.5 15.5L20 20" />,
            onPick: () => setFinding(true)
          },
          {
            // The honest escape hatch: this is a READING view, with no layout
            // fidelity and no editing, so the app that made the file is one
            // row away rather than a thing to go and hunt for.
            label: 'Open in default app',
            icon: <MenuIcon d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />,
            onPick: () => window.prism.openInDefault(path)
          },
          ...fileVerbs(path)
        ]}
      />
    )}
    <div
      ref={box}
      data-doc-scroller
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget
        rememberDocPos(path, el.scrollTop)
        // Persisted at a coarser step: a scroll fires per frame and this is a
        // convenience, not a transaction.
        if (Math.abs(el.scrollTop - lastSaved.current) < SAVE_STEP) return
        lastSaved.current = el.scrollTop
        saveDocPos(path, el.scrollTop, el.scrollHeight - el.clientHeight)
      }}
      className="p-doc h-full w-full overflow-auto outline-none"
      // Sanitised in main against a strict allowlist: no script, no links, and
      // images only as the data: URIs the converter itself made.
      dangerouslySetInnerHTML={{ __html: html }}
    />
    </div>
  )
}
