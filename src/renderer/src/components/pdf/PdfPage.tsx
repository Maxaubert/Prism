import { useEffect, useRef, useState, type JSX } from 'react'
import { TextLayer, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import {
  classifyAnnotation,
  linkLabel,
  rectToPercent,
  type PdfLink,
  type RawAnnot
} from '../../lib/pdfLinks'

// One PDF page: the canvas raster and the transparent text layer over it. Only
// mounted while the page is near the viewport (the parent virtualizes); the
// wrapper keeps the page's size while this is unmounted, so scrolling holds.

export function PdfPage({
  doc,
  pageNumber,
  scale,
  onDims,
  onTextLayer,
  onLink
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  /** Rendered scale: 1 is the PDF's own 100%. */
  scale: number
  /** The page's true size at scale 1, once known (parent sizes the wrapper). */
  onDims: (page: number, w: number, h: number) => void
  /** The text layer's spans, one per text item, for find highlights; null again
   *  when this page unmounts or re-renders. */
  onTextLayer: (page: number, divs: HTMLElement[] | null) => void
  /** A link box was clicked. The parent routes it: an external URL through
   *  main's guarded openExternal, an internal destination through goToPage. */
  onLink: (link: PdfLink) => void
}): JSX.Element {
  const [proxy, setProxy] = useState<PDFPageProxy | null>(null)
  const [links, setLinks] = useState<PdfLink[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    void doc.getPage(pageNumber).then((p) => {
      if (!alive) return
      const vp = p.getViewport({ scale: 1 })
      onDims(pageNumber, vp.width, vp.height)
      setProxy(p)
    })
    return () => {
      alive = false
    }
  }, [doc, pageNumber, onDims])

  useEffect(() => {
    const canvas = canvasRef.current
    const textBox = textRef.current
    if (!proxy || !canvas || !textBox) return
    let alive = true

    const viewport = proxy.getViewport({ scale })
    // Raster at the display's density, capped: past 2x the cost shows and the
    // sharpness doesn't.
    const out = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(viewport.width * out)
    canvas.height = Math.floor(viewport.height * out)
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const task = proxy.render({
      canvas,
      canvasContext: ctx,
      viewport,
      transform: out !== 1 ? [out, 0, 0, out, 0, 0] : undefined
    })
    task.promise.catch(() => {
      /* cancelled by a scale change or unmount; the next render owns the canvas */
    })

    textBox.replaceChildren()
    textBox.style.setProperty('--scale-factor', String(viewport.scale))
    textBox.style.setProperty('--user-unit', String(proxy.userUnit ?? 1))
    const layer = new TextLayer({
      textContentSource: proxy.streamTextContent(),
      container: textBox,
      viewport
    })
    void layer
      .render()
      .then(() => alive && onTextLayer(pageNumber, layer.textDivs))
      .catch(() => {
        /* cancelled mid-render */
      })

    return () => {
      alive = false
      task.cancel()
      layer.cancel()
      onTextLayer(pageNumber, null)
    }
  }, [proxy, scale, pageNumber, onTextLayer])

  /**
   * The clickable boxes, in PERCENTAGES of the page.
   *
   * Keyed on the page proxy alone and deliberately NOT on `scale`: percentage
   * geometry is already scale-free, and hanging this off the render effect
   * would be a worker round-trip per zoom notch on every mounted page.
   */
  useEffect(() => {
    if (!proxy) return
    let alive = true
    const vp = proxy.getViewport({ scale: 1 })
    void proxy
      .getAnnotations({ intent: 'display' })
      .then((list: RawAnnot[]) => {
        if (!alive) return
        const out: PdfLink[] = []
        for (const [i, a] of list.entries()) {
          const target = classifyAnnotation(a)
          const r = a.rect
          if (!target || !r || r.length < 4) continue
          const box = rectToPercent(
            vp.convertToViewportPoint(r[0], r[1]) as number[],
            vp.convertToViewportPoint(r[2], r[3]) as number[],
            vp.width,
            vp.height
          )
          if (!box) continue
          out.push({ key: a.id ?? `${pageNumber}:${i}`, ...box, target, label: linkLabel(target) })
        }
        setLinks(out)
      })
      .catch(() => {
        /* a document closed under us; the page is going away anyway */
      })
    return () => {
      alive = false
      setLinks([])
    }
  }, [proxy, pageNumber])

  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div ref={textRef} className="p-pdf-textlayer" />
      {/* Buttons, never anchors: an <a href> is what routes into main's
          window-open handler, and a PDF is a file from anywhere. */}
      <div className="p-pdf-annots">
        {links.map((l) => (
          <button
            key={l.key}
            type="button"
            title={l.label}
            aria-label={
              l.target.kind === 'url' ? `Open ${l.label}` : 'Go to this place in the document'
            }
            style={{
              left: `${l.left}%`,
              top: `${l.top}%`,
              width: `${l.width}%`,
              height: `${l.height}%`
            }}
            onClick={() => onLink(l)}
          />
        ))}
      </div>
    </>
  )
}
