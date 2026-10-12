import { useEffect, useRef, useState, type JSX } from 'react'
import { ContextMenu } from './ContextMenu'
import { docMenu } from '../menus/viewers/doc'
import { DocFind } from './DocFind'
import { useFindShortcut } from '../lib/useFindShortcut'
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

  // Ctrl+F opens the find bar over the document you are looking at.
  useFindShortcut(box, () => setFinding(true))

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
        items={docMenu({ path, find: () => setFinding(true) })}
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
    >
      {/*
        The document is a SHEET on a canvas, not text poured onto the theme.
        A docx opened on the void style was white text on pure black, which is
        not what the file looks like anywhere else - Word, Explorer's preview
        or the app that made it. The sheet is always paper and always dark ink;
        the canvas around it stays the theme's.
      */}
      <div
        className="p-sheet"
        // Sanitised in main against a strict allowlist: no script, no links,
        // and images only as the data: URIs the converter itself made.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
    </div>
  )
}
