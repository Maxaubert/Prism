import { useEffect, useRef, useState, type JSX } from 'react'

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

  useEffect(() => {
    let live = true
    void window.prism.docHtml(path).then((h) => {
      if (live) setGot({ path, html: h })
    })
    return () => {
      live = false
    }
  }, [path])

  // A fresh document starts at the top, however far the last one was scrolled.
  useEffect(() => {
    if (state === 'ready') box.current?.scrollTo({ top: 0 })
  }, [state, path])

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
      ref={box}
      data-doc-scroller
      tabIndex={0}
      className="p-doc h-full w-full overflow-auto outline-none"
      // Sanitised in main against a strict allowlist: no script, no links, and
      // images only as the data: URIs the converter itself made.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
