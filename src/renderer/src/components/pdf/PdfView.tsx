import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX
} from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { IconFull } from '../icons'
import { findMatches, stepMatch, type Match, type PageText } from '../../lib/pdfSearch'
import { PdfPage } from './PdfPage'
import { PdfFindBar } from './PdfFindBar'
import '../../assets/pdf.css'

// Prism's own PDF viewer: pdf.js pages in a continuous scroll, the app's chrome
// and nobody else's. No Chromium toolbar, no built-in sidebar; zoom and paging
// in the same hover pill the image viewer uses, and a first-party Ctrl+F that
// counts matches across the whole document.

GlobalWorkerOptions.workerSrc = workerUrl

// pdf.js side data rides next to the bundle (electron.vite.config copies it),
// resolved against the document base so dev serve and file:// both work.
const sideData = (dir: string): string => new URL(`pdf/${dir}/`, document.baseURI).toString()

const MIN_SCALE = 0.25
const MAX_SCALE = 5
const STEP = 1.18
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
  onToggleFullscreen
}: {
  url: string
  onToggleFullscreen: () => void
}): JSX.Element {
  const [docState, setDocState] = useState<DocState | null>(null)
  const [mode, setMode] = useState<FitMode>('fit-page')
  const [manualScale, setManualScale] = useState(1)
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 })
  const [page, setPage] = useState(1)
  const [pageEdit, setPageEdit] = useState<string | null>(null)
  // Page sizes at scale 1, as the pages announce themselves (mixed-size
  // documents correct their placeholders on approach).
  const [dims, setDims] = useState<Map<number, { w: number; h: number }>>(new Map())
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

  // A new file in the same viewer: reset the per-document state during render
  // (the pattern the sidebar uses), and let the load effect fill docState in.
  const [forUrl, setForUrl] = useState(url)
  if (forUrl !== url) {
    setForUrl(url)
    setMode('fit-page')
    setManualScale(1)
    setPage(1)
    setPageEdit(null)
    setDims(new Map())
    setNear(new Set([1, 2]))
    setFindOpen(false)
    setQuery('')
    setMatches([])
    setCurMatch(-1)
  }

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
  const error = loaded?.error ?? null
  const baseDims = loaded?.base ?? FALLBACK_DIMS
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
      const availW = boxSize.w - PAD_X * 2
      const availH = boxSize.h - PAD_Y * 2
      const fit =
        m === 'fit-width' ? availW / baseDims.w : Math.min(availW / baseDims.w, availH / baseDims.h)
      return clamp(fit, MIN_SCALE, MAX_SCALE)
    },
    [boxSize, baseDims]
  )

  const scale = mode === 'manual' ? manualScale : fitFor(mode)

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

  const zoomBy = useCallback(
    (f: number) => {
      holdCentre()
      setMode('manual')
      setManualScale(clamp(scale * f, MIN_SCALE, MAX_SCALE))
    },
    [holdCentre, scale]
  )

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
    // The current page is the one crossing a line a third of the way down.
    const line = box.getBoundingClientRect().top + box.clientHeight / 3
    let best = 1
    wrappers.current.forEach((el, n) => {
      const r = el.getBoundingClientRect()
      if (r.top <= line && r.bottom >= line) best = n
      else if (r.bottom < line && n > best) best = n
    })
    setPage(best)
  }, [])

  const goToPage = useCallback((n: number) => {
    const el = wrappers.current.get(n)
    const box = scroller.current
    if (!el || !box) return
    box.scrollTo({ top: el.offsetTop - PAGE_GAP })
    setPage(n)
  }, [])

  /* ---------- find ---------- */

  const pageText = useCallback(
    (d: PDFDocumentProxy, n: number): Promise<PageText> => {
      let p = textCache.current.get(n)
      if (!p) {
        p = d
          .getPage(n)
          .then((pg) => pg.getTextContent())
          .then((tc) => ({ items: tc.items.map((i) => ('str' in i ? i.str : '')) }))
        textCache.current.set(n, p)
      }
      return p
    },
    []
  )

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
  // layers bump re-runs this to centre it).
  useEffect(() => {
    const m = matches[curMatch]
    if (!m) return
    const divs = layers.current.get(m.page + 1)
    const span = divs?.[m.item]
    if (span) span.scrollIntoView({ block: 'center' })
    else goToPage(m.page + 1)
  }, [curMatch, matches, layersVersion, goToPage])

  const stepFind = useCallback(
    (d: number) => setCurMatch((c) => stepMatch(c, d, matches.length)),
    [matches.length]
  )

  const closeFind = useCallback(() => {
    setFindOpen(false)
    setQuery('')
    scroller.current?.focus()
  }, [])

  /* ---------- keys + wheel ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
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
      if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault()
        goToPage(clamp(page + (e.key === 'PageDown' ? 1 : -1), 1, pageCount))
        return
      }
      if (typing) return
      switch (e.key) {
        case '+':
        case '=': zoomBy(STEP); break
        case '-':
        case '_': zoomBy(1 / STEP); break
        case '0': fitTo('fit-page'); break
        case 'w':
        case 'W': fitTo('fit-width'); break
        case 'f':
        case 'F': onToggleFullscreen(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [findOpen, stepFind, goToPage, page, pageCount, zoomBy, fitTo, onToggleFullscreen])

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

  // Documents own their vertical keys: focus makes native scrolling answer them.
  useEffect(() => {
    if (doc) scroller.current?.focus()
  }, [doc])

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
        tabIndex={-1}
        onScroll={onScroll}
        className="h-full w-full overflow-auto outline-none"
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
                  style={{ width: d.w * scale, height: d.h * scale }}
                  className="relative shrink-0 bg-white shadow-[0_2px_16px_rgba(0,0,0,.5)]"
                >
                  {near.has(n) && (
                    <PdfPage doc={doc} pageNumber={n} scale={scale} onDims={onDims} onTextLayer={onTextLayer} />
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

      {/* control cluster, appears on hover (the image viewer's pill, adapted) */}
      {doc && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[color:var(--p-divider)] bg-[var(--p-title)] px-2 py-1 text-[var(--p-text)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
          <button className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-white/15" onClick={() => zoomBy(1 / STEP)} title="Zoom out (-)">−</button>
          <button
            className="pointer-events-auto min-w-[3.2rem] rounded-full px-2 text-[12px] font-semibold tabular-nums hover:bg-white/15"
            onClick={() => fitTo('fit-page')}
            title="Fit page (0)"
          >
            {Math.round(scale * 100)}%
          </button>
          <button className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-white/15" onClick={() => zoomBy(STEP)} title="Zoom in (+)">+</button>
          <div className="mx-1 h-5 w-px bg-white/15" />
          <button
            className={`pointer-events-auto grid h-8 w-8 place-items-center rounded-full hover:bg-white/15 ${mode === 'fit-width' ? 'text-[var(--p-accent-hi)]' : ''}`}
            onClick={() => fitTo(mode === 'fit-width' ? 'fit-page' : 'fit-width')}
            title={mode === 'fit-width' ? 'Fit page (0)' : 'Fit width (W)'}
          >
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 12h18M6 8l-3 4 3 4M18 8l3 4-3 4" />
            </svg>
          </button>
          <button className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full hover:bg-white/15" onClick={onToggleFullscreen} title="Fullscreen (F)">
            {IconFull}
          </button>
        </div>
      )}
    </div>
  )
}
