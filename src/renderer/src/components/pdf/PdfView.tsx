import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { openDocAt, rememberDocPos, saveDocPos } from '../../lib/docPosition'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { IconFull } from '../icons'
import { findMatches, stepMatch, type Match, type PageText } from '../../lib/pdfSearch'
import { PdfPage } from './PdfPage'
import { type PdfLink } from '../../lib/pdfLinks'
import { baseZoom, zoomPercent } from '../../lib/pdfZoom'
import { PdfFindBar } from './PdfFindBar'
import '../../assets/pdf.css'

// Prism's own PDF viewer: pdf.js pages in a continuous scroll, the app's chrome
// and nobody else's. No Chromium toolbar, no built-in sidebar; zoom and paging
// in the same hover pill the image viewer uses, and a first-party Ctrl+F that
// counts matches across the whole document.

GlobalWorkerOptions.workerSrc = workerUrl

// pdf.js side data rides next to the bundle (electron.vite.config copies it).
// Dev serves it over http, where a plain relative URL works. The packaged app
// runs from file://, where fetch() refuses file: URLs, so there the data is
// served through fsmedia:// instead (registered with supportFetchAPI). Built
// with forward slashes and per-segment encoding so pdf.js can append filenames.
const sideData = (dir: string): string => {
  if (location.protocol !== 'file:') return new URL(`pdf/${dir}/`, document.baseURI).toString()
  const here = decodeURIComponent(location.pathname)
    .replace(/^\/+/, '')
    .replace(/[^\\/]*$/, '') // the folder index.html loads from
  const path = `${here}pdf/${dir}/`
  return `fsmedia://local/${path.split(/[\\/]/).map(encodeURIComponent).join('/')}`
}

const MIN_SCALE = 0.25
const MAX_SCALE = 5
const STEP = 1.18
// What the pill calls 100% is now DERIVED PER DOCUMENT, in lib/pdfZoom.ts:
// pdf.js units are relative to the page's own size, so a flat 1.9 meant "1.9x
// whatever this document happens to measure" and an artbook with 1800pt pages
// opened three times the width of a letter one (2026-08-31). 100% is a fixed
// width on screen now, and a letter page still lands at exactly 1.9, so the
// documents that were already right are unchanged. Fit modes and the absolute
// clamps still work in pdf.js units.
const PAGE_GAP = 16
const PAD_X = 48
const PAD_Y = 24
// US Letter, until page 1 announces the document's real size.
const FALLBACK_DIMS = { w: 612, h: 792 }
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

type FitMode = 'fit-page' | 'fit-width' | 'manual'

interface DocState {
  url: string
  doc: PDFDocumentProxy | null
  error: 'load' | 'password' | null
  /** Page 1 at scale 1: the size every page is assumed to be until it corrects. */
  base: { w: number; h: number }
}

export function PdfView({
  url,
  path,
  onToggleFullscreen
}: {
  url: string
  /** The file on disk, which is what a remembered PAGE is keyed by. Absent for
   *  an archive member, which lives in temp and is not worth remembering. */
  path?: string
  onToggleFullscreen: () => void
}): JSX.Element {
  const [docState, setDocState] = useState<DocState | null>(null)
  const [mode, setMode] = useState<FitMode>('manual')
  /** The manual zoom as a MULTIPLE of this document's base, so 1 is 100%
   *  whatever the pages measure. Stored relative rather than absolute
   *  because the base is not known until page one has loaded. */
  const [manualZoom, setManualZoom] = useState(1)
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 })
  const [page, setPage] = useState(1)
  const [pageEdit, setPageEdit] = useState<string | null>(null)
  // Page sizes at scale 1, as the pages announce themselves (mixed-size
  // documents correct their placeholders on approach).
  const [dims, setDims] = useState<Map<number, { w: number; h: number }>>(new Map())
  /** The widest and tallest page in the document; see `docBox` below. */
  const [pageBox, setPageBox] = useState<{ w: number; h: number } | null>(null)
  const [near, setNear] = useState<Set<number>>(new Set([1, 2]))

  // Find state.
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Match[]>([])
  const [curMatch, setCurMatch] = useState(-1)
  const [layersVersion, setLayersVersion] = useState(0)

  const scroller = useRef<HTMLDivElement>(null)
  const wrappers = useRef<Map<number, HTMLDivElement>>(new Map())
  const layers = useRef<Map<number, HTMLElement[]>>(new Map())
  const textCache = useRef<Map<number, Promise<PageText>>>(new Map())
  /** The document this viewer has already restored, so it happens once. */
  const restoredFor = useRef<string | null>(null)
  const lastSavedPage = useRef(0)
  /** The page count, for the save's "is this document long enough" test. A
   *  ref written in an effect, because onScroll must not be rebuilt per page
   *  and a ref may not be written while rendering. */
  const totalPages = useRef(0)
  /** What a remembered page is filed under. Empty for an archive member. */
  const key = path ?? ''

  // A new file in the same viewer: reset the per-document state during render
  // (the pattern the sidebar uses), and let the load effect fill docState in.
  const [forUrl, setForUrl] = useState(url)
  if (forUrl !== url) {
    setForUrl(url)
    setMode('manual')
    setManualZoom(1)
    setPage(1)
    setPageEdit(null)
    setDims(new Map())
    setPageBox(null)
    setNear(new Set([1, 2]))
    setFindOpen(false)
    setQuery('')
    setMatches([])
    setCurMatch(-1)
  }
  // A ref cannot be written while rendering, so the one-shot flag that guards
  // the page restore is reset in an effect - the same split useMediaControls
  // makes for exactly this reason.
  useEffect(() => {
    restoredFor.current = null
    lastSavedPage.current = 0
  }, [url])

  /* ---------- document ---------- */

  useEffect(() => {
    let alive = true
    layers.current.clear()
    textCache.current.clear()
    const task = getDocument({
      url,
      cMapUrl: sideData('cmaps'),
      cMapPacked: true,
      standardFontDataUrl: sideData('standard_fonts'),
      wasmUrl: sideData('wasm'),
      iccUrl: sideData('iccs')
    })
    task.promise
      .then(async (d) => {
        const first = await d.getPage(1)
        if (!alive) return
        const vp = first.getViewport({ scale: 1 })
        setDocState({ url, doc: d, error: null, base: { w: vp.width, h: vp.height } })
      })
      .catch((e: unknown) => {
        if (!alive) return
        const name = (e as { name?: string })?.name
        setDocState({
          url,
          doc: null,
          error: name === 'PasswordException' ? 'password' : 'load',
          base: FALLBACK_DIMS
        })
      })
    return () => {
      alive = false
      void task.destroy()
    }
  }, [url])

  // Everything below derives from the doc only once it is the CURRENT url's:
  // a stale document from the previous file renders nothing.
  const loaded = docState?.url === url ? docState : null
  const doc = loaded?.doc ?? null
  useEffect(() => {
    totalPages.current = doc?.numPages ?? 0
  }, [doc])
  const error = loaded?.error ?? null
  const baseDims = loaded?.base ?? FALLBACK_DIMS
  /**
   * The WIDEST and TALLEST page in the document, settled once every page has
   * been measured (2026-09-01).
   *
   * Every size decision used to come from PAGE ONE, and an artbook is what
   * shows why that is wrong: its cover is 391pt across and its spreads are
   * 842pt. Sizing 100% so the COVER fills the intended width put the spreads
   * at 2502 CSS px, so the document opened with a horizontal scrollbar and the
   * reader had to zoom out of a view they never asked to be zoomed into.
   *
   * Settled ONCE rather than tracked incrementally: a value that grew as pages
   * were measured would rescale the document under the reader mid-page.
   */
  const docBox = pageBox ?? baseDims
  const pageCount = doc?.numPages ?? 0

  /* ---------- fit + zoom ---------- */

  // The scroll viewport's size, so fit scales derive instead of being stored.
  useEffect(() => {
    const box = scroller.current
    if (!box) return
    const ro = new ResizeObserver(() => setBoxSize({ w: box.clientWidth, h: box.clientHeight }))
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  const fitFor = useCallback(
    (m: FitMode): number => {
      if (boxSize.w <= 0 || boxSize.h <= 0) return 1
      // A pixel of slack, deliberately. Fitting EXACTLY means any rounding
      // anywhere - the page box, the gutter, a fractional device ratio - lands
      // on the wrong side and shows a scrollbar for one pixel of overflow.
      const availW = boxSize.w - PAD_X * 2 - 1
      const availH = boxSize.h - PAD_Y * 2
      const fit =
        m === 'fit-width' ? availW / docBox.w : Math.min(availW / docBox.w, availH / docBox.h)
      return clamp(fit, MIN_SCALE, MAX_SCALE)
    },
    [boxSize, docBox]
  )

  /** The pdf.js scale this document calls 100%. */
  const base = baseZoom(docBox.w)
  const scale = mode === 'manual' ? clamp(manualZoom * base, MIN_SCALE, MAX_SCALE) : fitFor(mode)

  /**
   * How a document OPENS (2026-09-01), which is two separate faults that
   * looked like one.
   *
   * 100% is a fixed width on screen - a letter page's 1163 CSS px - so it does
   * not shrink for the window. An A4 document opened in a viewer narrower than
   * that, which is every window with the sidebar out, was therefore already
   * wider than the space it had. So the rule is 100% BUT NEVER WIDER THAN THE
   * VIEW: fit the width when it would overflow, and leave it at 100% when
   * there is room. Fitting unconditionally would be the opposite fault - an A4
   * page blown up to 172% on a wide screen.
   *
   * And whatever is still wider than the view is CENTRED. scrollLeft was only
   * ever written by the zoom anchor, so a document that overflowed opened
   * flush against its left edge, showing the gutter and cutting the right-hand
   * side off. Every pdf viewer centres the page; the flex row already does it
   * for layout and nothing did it for the scroll position.
   *
   * One shot per document, keyed on the url, so it never fights a zoom or a
   * scroll the reader has since made themselves.
   */
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  if (doc && boxSize.w > 0 && openedFor !== url) {
    // Adjusted while RENDERING, the way this file already resets per-document
    // state above: deciding it in an effect means a first paint at the wrong
    // scale and a second render to correct it, which is the cascade the lint
    // rule is about.
    setOpenedFor(url)
    if (docBox.w * base > boxSize.w - PAD_X * 2) setMode('fit-width')
  }
  useEffect(() => {
    if (!openedFor) return
    // After the layout the opening scale produces, not before it - and the
    // laid-out width is the honest test. Predicting it from the page size and
    // the padding is right up to whatever the prediction did not know about;
    // asking the box whether it actually overflows costs one frame and cannot
    // be wrong. A document that does still fits itself to the width here.
    const id = requestAnimationFrame(() => {
      const box = scroller.current
      if (!box) return
      if (box.scrollWidth > box.clientWidth + 1) {
        setMode('fit-width')
        return
      }
      if (box.scrollWidth <= box.clientWidth) return
      box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2
    })
    return () => cancelAnimationFrame(id)
  }, [openedFor])

  // Zoom keeps the point of the document you were looking at where it was:
  // remember the scroll centre as a fraction, restore it after the resize.
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const holdCentre = useCallback(() => {
    const box = scroller.current
    if (!box) return
    anchor.current = {
      x: box.scrollWidth ? (box.scrollLeft + box.clientWidth / 2) / box.scrollWidth : 0,
      y: box.scrollHeight ? (box.scrollTop + box.clientHeight / 2) / box.scrollHeight : 0
    }
  }, [])

  useLayoutEffect(() => {
    const box = scroller.current
    const a = anchor.current
    if (!box || !a) return
    anchor.current = null
    box.scrollLeft = a.x * box.scrollWidth - box.clientWidth / 2
    box.scrollTop = a.y * box.scrollHeight - box.clientHeight / 2
  }, [scale])

  /** Takes a pdf.js scale, stores it relative to the document's base. */
  const rescale = useCallback(
    (next: number) => {
      holdCentre()
      setMode('manual')
      setManualZoom(clamp(next, MIN_SCALE, MAX_SCALE) / base)
    },
    [holdCentre, base]
  )

  const zoomBy = useCallback((f: number) => rescale(scale * f), [rescale, scale])

  const fitTo = useCallback(
    (m: Exclude<FitMode, 'manual'>) => {
      holdCentre()
      setMode(m)
    },
    [holdCentre]
  )

  /* ---------- virtualization + current page ---------- */

  const setWrapper = useCallback((n: number, el: HTMLDivElement | null) => {
    if (el) wrappers.current.set(n, el)
    else wrappers.current.delete(n)
  }, [])

  useEffect(() => {
    if (!doc) return
    const box = scroller.current
    if (!box) return
    const io = new IntersectionObserver(
      (entries) => {
        setNear((prev) => {
          const next = new Set(prev)
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page)
            if (e.isIntersecting) next.add(n)
            else next.delete(n)
          }
          return next
        })
      },
      // A viewport and a half each way: neighbours are ready before they arrive.
      { root: box, rootMargin: '150% 0%' }
    )
    wrappers.current.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [doc, pageCount])

  const onScroll = useCallback(() => {
    const box = scroller.current
    if (!box) return
    const total = totalPages.current
    // The current page is the one crossing a line a third of the way down.
    const line = box.getBoundingClientRect().top + box.clientHeight / 3
    let best = 1
    wrappers.current.forEach((el, n) => {
      const r = el.getBoundingClientRect()
      if (r.top <= line && r.bottom >= line) best = n
      else if (r.bottom < line && n > best) best = n
    })
    setPage(best)
    // Remember the PAGE, not the offset: the offset depends on the zoom and
    // on which pages are virtualized, so it means nothing on the way back in.
    if (key && total) {
      rememberDocPos(key, best)
      if (Math.abs(best - lastSavedPage.current) >= 1) {
        lastSavedPage.current = best
        saveDocPos(key, best, total, true)
      }
    }
  }, [key])

  /**
   * Scroll to a page, and optionally to a place ON it.
   *
   * `offset` is viewport pixels down from the page's top edge, at the
   * CURRENT scale. It exists for /XYZ destinations: a table of contents or a
   * footnote back-link carries a real y-coordinate, and landing at the top of
   * page 312 of a dense document reads as broken rather than as approximate.
   * Everything else passes nothing and lands at the top, as before.
   */
  const goToPage = useCallback((n: number, offset = 0) => {
    const el = wrappers.current.get(n)
    const box = scroller.current
    if (!el || !box) return
    box.scrollTo({ top: el.offsetTop - PAGE_GAP + Math.max(0, offset) })
    setPage(n)
  }, [])

  /**
   * Open at the page you left off on (2026-08-30).
   *
   * A 10-minute film reopened where you stopped and a 400-page PDF opened at
   * page 1. Runs once the pages have been laid out, since goToPage needs a
   * wrapper to scroll to, and once per document.
   */
  useEffect(() => {
    if (!key || !doc || restoredFor.current === url) return
    const want = openDocAt(key)
    if (want <= 1) {
      restoredFor.current = url
      return
    }
    if (!wrappers.current.has(Math.min(want, doc.numPages))) return // not laid out yet
    restoredFor.current = url
    goToPage(clamp(Math.round(want), 1, doc.numPages))
    // near/dims change as pages mount, which is what re-runs this until the
    // wanted page exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, doc, url, near, dims])

  /* ---------- find ---------- */

  const pageText = useCallback((d: PDFDocumentProxy, n: number): Promise<PageText> => {
    let p = textCache.current.get(n)
    if (!p) {
      p = d
        .getPage(n)
        .then((pg) => pg.getTextContent())
        .then((tc) => ({ items: tc.items.map((i) => ('str' in i ? i.str : '')) }))
      textCache.current.set(n, p)
    }
    return p
  }, [])

  // Re-search on query change, debounced a touch so typing doesn't extract the
  // whole document per keystroke.
  useEffect(() => {
    if (!doc || !findOpen) return
    let alive = true
    const t = setTimeout(() => {
      if (!query.trim()) {
        setMatches([])
        setCurMatch(-1)
        return
      }
      void Promise.all(Array.from({ length: doc.numPages }, (_, i) => pageText(doc, i + 1))).then(
        (pages) => {
          if (!alive) return
          const found = findMatches(pages, query)
          setMatches(found)
          setCurMatch(found.length ? 0 : -1)
        }
      )
    }, 150)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [doc, findOpen, query, pageText])

  /**
   * A link box was clicked.
   *
   * External goes through `window.prism.openExternal`, which is guarded
   * `^https?:` in the preload AND again in main - never through an anchor,
   * which would reach main's window-open handler instead.
   *
   * Internal resolves the destination to a page and, where the destination
   * says so, to a y-coordinate on it. A named destination is one more lookup;
   * an explicit one already carries the page reference.
   */
  const onLink = useCallback(
    (link: PdfLink) => {
      if (link.target.kind === 'url') {
        window.prism.openExternal(link.target.url)
        return
      }
      if (!doc) return
      void (async () => {
        try {
          const raw = link.target.kind === 'dest' ? link.target.dest : null
          const explicit = typeof raw === 'string' ? await doc.getDestination(raw) : raw
          if (!Array.isArray(explicit) || !explicit.length) return
          const ref = explicit[0] as number | { num: number; gen: number }
          const n =
            typeof ref === 'number'
              ? ref + 1
              : (doc.cachedPageNumber(ref) ?? (await doc.getPageIndex(ref)) + 1)
          const target = clamp(Math.round(n), 1, doc.numPages)
          // /XYZ carries [ref, {name:'XYZ'}, left, top, zoom]: `top` is in PDF
          // user space, measured from the BOTTOM of the page, so it has to go
          // through the page's own viewport to become pixels from the top.
          let offset = 0
          const named = explicit[1] as { name?: string } | undefined
          const top = explicit[3]
          if (named?.name === 'XYZ' && typeof top === 'number' && Number.isFinite(top)) {
            const page = await doc.getPage(target)
            const y = page.getViewport({ scale }).convertToViewportPoint(0, top)[1] as number
            if (Number.isFinite(y)) offset = y
          }
          goToPage(target, offset)
        } catch {
          /* a destination this document cannot resolve: do nothing visible */
        }
      })()
    },
    [doc, goToPage, scale]
  )

  const onTextLayer = useCallback((n: number, divs: HTMLElement[] | null) => {
    if (divs) layers.current.set(n, divs)
    else layers.current.delete(n)
    setLayersVersion((v) => v + 1)
  }, [])

  // Paint every match through the CSS Custom Highlight API: ranges over the
  // text-layer spans of whichever pages are rendered right now.
  useEffect(() => {
    if (typeof CSS === 'undefined' || !('highlights' in CSS)) return
    const all = new Highlight()
    const here = new Highlight()
    matches.forEach((m, idx) => {
      const divs = layers.current.get(m.page + 1)
      if (!divs) return
      for (const part of m.parts) {
        const node = divs[part.item]?.firstChild
        if (!node || node.nodeType !== Node.TEXT_NODE) continue
        const len = (node as Text).length
        if (part.start >= len) continue
        const r = new Range()
        r.setStart(node, part.start)
        r.setEnd(node, Math.min(part.end, len))
        ;(idx === curMatch ? here : all).add(r)
      }
    })
    CSS.highlights.set('p-find', all)
    CSS.highlights.set('p-find-here', here)
    return () => {
      CSS.highlights.delete('p-find')
      CSS.highlights.delete('p-find-here')
    }
  }, [matches, curMatch, layersVersion])

  // Walking the matches follows them on screen: the exact span when its page is
  // rendered, the page itself until then (rendering brings the span, and the
  // layers bump finishes the centring). One-shot per match: layer bumps happen
  // on every scroll (virtualization) and zoom, and refollowing on those would
  // pin the viewport to the match and make scrolling away impossible.
  const followPending = useRef(false)
  useEffect(() => {
    followPending.current = curMatch >= 0
  }, [curMatch, matches])
  useEffect(() => {
    const m = matches[curMatch]
    if (!m || !followPending.current) return
    const divs = layers.current.get(m.page + 1)
    const span = divs?.[m.item]
    if (span) {
      span.scrollIntoView({ block: 'center' })
      followPending.current = false
    } else {
      goToPage(m.page + 1) // the span's layer mounts next; that bump centres it
    }
  }, [curMatch, matches, layersVersion, goToPage])

  const stepFind = useCallback(
    (d: number) => setCurMatch((c) => stepMatch(c, d, matches.length)),
    [matches.length]
  )

  const closeFind = useCallback(() => {
    setFindOpen(false)
    setQuery('')
    // The re-search effect is gated on findOpen, so these must clear here or
    // the highlights (and the match being followed) would outlive the bar.
    setMatches([])
    setCurMatch(-1)
    scroller.current?.focus()
  }, [])

  /* ---------- keys + wheel ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Settings (or the setup) covers the viewer with an inert wrapper; a
      // window-level listener doesn't know that unless it looks.
      if (scroller.current?.closest('[inert]')) return
      const el = e.target as HTMLElement | null
      const typing = !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
      if ((e.key === 'f' || e.key === 'F') && e.ctrlKey) {
        e.preventDefault()
        setFindOpen(true)
        return
      }
      if (e.key === 'F3') {
        e.preventDefault()
        if (findOpen) stepFind(e.shiftKey ? -1 : 1)
        else setFindOpen(true)
        return
      }
      // The bar's input handles its own Escape; this catches the key when the
      // bar is open but focus is on the document (App yields it to the bar).
      if (e.key === 'Escape' && findOpen) {
        closeFind()
        return
      }
      // Flipping pages is the document's business, and only once the document
      // has focus. This listener is on `window`, so without the check it fired
      // from the sidebar too and paged the pdf instead of the folder.
      if (e.key === 'PageDown' || e.key === 'PageUp') {
        if (!scroller.current?.contains(document.activeElement)) return
        e.preventDefault()
        goToPage(clamp(page + (e.key === 'PageDown' ? 1 : -1), 1, pageCount))
        return
      }
      if (typing) return
      switch (e.key) {
        case '+':
        case '=':
          zoomBy(STEP)
          break
        case '-':
        case '_':
          zoomBy(1 / STEP)
          break
        case '0':
          rescale(base)
          break
        case 'w':
        case 'W':
          fitTo('fit-width')
          break
        case 'p':
        case 'P':
          fitTo('fit-page')
          break
        case 'f':
        case 'F':
          onToggleFullscreen()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    base,
    findOpen,
    stepFind,
    closeFind,
    goToPage,
    page,
    pageCount,
    zoomBy,
    fitTo,
    rescale,
    onToggleFullscreen
  ])

  // Ctrl+wheel zooms. Native listener: React's synthetic wheel is passive, and
  // a passive handler cannot stop the browser's own pinch-zoom default.
  useEffect(() => {
    const box = scroller.current
    if (!box) return
    const onWheel = (e: globalThis.WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? STEP : 1 / STEP)
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => box.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  // Deliberately NOT focused on open. A document earns the vertical keys by
  // being clicked into (or tabbed to), never by merely being on screen: taking
  // them on arrival is what used to make PageDown flip pages while the user was
  // only paging through the folder from the sidebar. Escape gives them back.

  /* ---------- render ---------- */

  const pages = useMemo(() => Array.from({ length: pageCount }, (_, i) => i + 1), [pageCount])
  const onDims = useCallback((p: number, w: number, h: number) => {
    setDims((prev) => {
      const cur = prev.get(p)
      if (cur && cur.w === w && cur.h === h) return prev
      const next = new Map(prev)
      next.set(p, { w, h })
      return next
    })
  }, [])

  /**
   * Every page's real size, read up front (2026-09-01).
   *
   * A page that has not rendered yet was laid out at PAGE ONE's size, which is
   * right for the overwhelming majority of documents and wrong for exactly the
   * ones that need it most: a pdf's MediaBox is PER PAGE, so a scanned document
   * with a landscape insert, or a comic whose pages are not all the same plate,
   * laid every page out as page one and then resized each as it came into view.
   * That moves everything below it, so the scroll position slides under the
   * reader while they are reading.
   *
   * `getPage` parses the page dictionary, not its content stream, so this is
   * cheap - but it is still one call per page and this is the renderer, so it
   * runs BOUNDED, eight at a time, the same shape the tree's gap-filler uses.
   * Results are flushed in batches rather than per page: every setDims is a
   * re-render and a 400-page comic would otherwise be 400 of them.
   */
  useEffect(() => {
    if (!doc) return
    let alive = true
    const total = doc.numPages
    let next = 2 // page one is already measured, and is `base`
    let batch = new Map<number, { w: number; h: number }>()
    // SEEDED WITH PAGE ONE, which the worker loop starts after. A
    // single-page document runs no workers at all, so these stayed at zero and
    // `docBox` became 0 wide - and a fit of availW/0 is Infinity, clamped to
    // the maximum scale. A 1822pt page came out 9110px across. Seeding is also
    // simply correct for every other document: page one is a page, and the
    // widest page cannot be found by ignoring it.
    let maxW = baseDims.w
    let maxH = baseDims.h
    const flush = (): void => {
      if (!alive || batch.size === 0) return
      const got = batch
      batch = new Map()
      setDims((prev) => {
        const merged = new Map(prev)
        for (const [n, d] of got) merged.set(n, d)
        return merged
      })
    }
    const worker = async (): Promise<void> => {
      while (alive) {
        const n = next++
        if (n > total) return
        const page = await doc.getPage(n)
        if (!alive) return
        const vp = page.getViewport({ scale: 1 })
        batch.set(n, { w: vp.width, h: vp.height })
        if (vp.width > maxW) maxW = vp.width
        if (vp.height > maxH) maxH = vp.height
        if (batch.size >= 32) flush()
      }
    }
    void Promise.all(
      Array.from({ length: Math.min(8, Math.max(0, total - 1)) }, () => worker())
    ).then(() => {
      flush()
      if (alive && maxW > 0 && maxH > 0) setPageBox({ w: maxW, h: maxH })
    })
    return () => {
      alive = false
    }
  }, [doc, baseDims.w, baseDims.h])

  const commitPageEdit = (): void => {
    const n = Number(pageEdit)
    setPageEdit(null)
    if (Number.isFinite(n) && pageEdit) goToPage(clamp(Math.round(n), 1, pageCount))
  }

  if (error) {
    return (
      <div className="grid h-full w-full place-items-center p-8 text-center text-sm text-[#c9ccd6]">
        {error === 'password'
          ? 'This PDF is password-protected.'
          : 'This PDF can’t be displayed (corrupt or unsupported file).'}
      </div>
    )
  }

  return (
    <div className="group relative h-full w-full">
      <div
        ref={scroller}
        // 0, not -1: Tab is the keyboard's way into the document, and clicking
        // anywhere on a page lands focus here too.
        tabIndex={0}
        data-doc-scroller
        onScroll={onScroll}
        className="h-full w-full overflow-auto outline-none"
        /*
         * The vertical scrollbar's space is RESERVED. A multi-page document
         * always grows one, but not until its pages have rendered - so the
         * width measured when deciding how to open was about 15px too
         * generous, and a page sized to it overflowed by exactly that once
         * the bar appeared. A stable gutter makes clientWidth the same
         * number before and after, which is what the fit derives from.
         */
        style={{ scrollbarGutter: 'stable' }}
      >
        {!doc ? (
          <div className="delayed-loader grid h-full place-items-center">
            <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[color:var(--p-divider)] border-t-[var(--color-accent-hi)]" />
          </div>
        ) : (
          <div
            className="flex min-h-full w-max min-w-full flex-col items-center"
            style={{ padding: `${PAD_Y}px ${PAD_X}px`, gap: PAGE_GAP }}
          >
            {pages.map((n) => {
              const d = dims.get(n) ?? baseDims
              return (
                <div
                  key={n}
                  data-page={n}
                  ref={(el) => setWrapper(n, el)}
                  /*
                   * FLOORED to whole pixels. A page laid out at a fractional
                   * width rounds up in the scroll box, and one rounded-up
                   * pixel against a fit that lands exactly on the available
                   * width is a horizontal scrollbar that never goes away -
                   * which is the bar itself, rather than anything about the
                   * document being too big.
                   */
                  style={{ width: Math.floor(d.w * scale), height: Math.floor(d.h * scale) }}
                  className="relative shrink-0 bg-white shadow-[0_2px_16px_rgba(0,0,0,.5)]"
                >
                  {near.has(n) && (
                    <PdfPage
                      doc={doc}
                      pageNumber={n}
                      scale={scale}
                      onDims={onDims}
                      onTextLayer={onTextLayer}
                      onLink={onLink}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {findOpen && (
        <PdfFindBar
          query={query}
          onQuery={setQuery}
          current={curMatch}
          total={matches.length}
          onStep={stepFind}
          onClose={closeFind}
        />
      )}

      {/* control cluster, appears on hover (the image viewer's pill, adapted).
          focus-within on the pill itself, not the group: the scroller keeps
          focus for the scroll keys, and group-focus-within would pin the pill
          permanently visible. z-10: the text layer's spans carry z-index 1,
          and a z-auto pill under a big page sat BELOW them - visible through
          the transparent text, but swallowing no clicks. */}
      {doc && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] px-2 py-1 text-[var(--p-text)] opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <input
            value={pageEdit ?? String(page)}
            onFocus={(e) => {
              setPageEdit(String(page))
              e.target.select()
            }}
            onChange={(e) => setPageEdit(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={commitPageEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitPageEdit()
              else if (e.key === 'Escape') {
                e.stopPropagation()
                setPageEdit(null)
                scroller.current?.focus()
              }
            }}
            aria-label="Page number"
            className="pointer-events-auto w-9 rounded-full bg-transparent text-center text-[12px] font-semibold tabular-nums outline-none hover:bg-white/15 focus:bg-white/15"
          />
          <span className="text-[12px] text-[var(--p-dim)]">/ {pageCount}</span>
          <div className="mx-1 h-5 w-px bg-white/15" />
          <button
            className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-white/15"
            onClick={() => zoomBy(1 / STEP)}
            title="Zoom out (-)"
          >
            −
          </button>
          <button
            className="pointer-events-auto min-w-[3.2rem] rounded-full px-2 text-[12px] font-semibold tabular-nums hover:bg-white/15"
            onClick={() => rescale(base)}
            title="Default zoom (0)"
          >
            {zoomPercent(scale, base)}%
          </button>
          <button
            className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-white/15"
            onClick={() => zoomBy(STEP)}
            title="Zoom in (+)"
          >
            +
          </button>
          <div className="mx-1 h-5 w-px bg-white/15" />
          <button
            className={`pointer-events-auto grid h-8 w-8 place-items-center rounded-full hover:bg-white/15 ${mode === 'fit-width' ? 'text-[var(--p-accent-hi)]' : ''}`}
            onClick={() => fitTo(mode === 'fit-width' ? 'fit-page' : 'fit-width')}
            title={mode === 'fit-width' ? 'Fit page (P)' : 'Fit width (W)'}
          >
            <svg
              viewBox="0 0 24 24"
              width={16}
              height={16}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 12h18M6 8l-3 4 3 4M18 8l3 4-3 4" />
            </svg>
          </button>
          <button
            className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full hover:bg-white/15"
            onClick={onToggleFullscreen}
            title="Fullscreen (F)"
          >
            {IconFull}
          </button>
        </div>
      )}
    </div>
  )
}
