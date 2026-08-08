import { useEffect, useRef, useState, type JSX } from 'react'
import { TextLayer, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'

// One PDF page: the canvas raster and the transparent text layer over it. Only
// mounted while the page is near the viewport (the parent virtualizes); the
// wrapper keeps the page's size while this is unmounted, so scrolling holds.

export function PdfPage({
  doc,
  pageNumber,
  scale,
  onDims,
  onTextLayer
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
}): JSX.Element {
  const [proxy, setProxy] = useState<PDFPageProxy | null>(null)
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

  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div ref={textRef} className="p-pdf-textlayer" />
    </>
  )
}
