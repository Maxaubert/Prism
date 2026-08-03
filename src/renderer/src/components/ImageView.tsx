import { useCallback, useEffect, useRef, useState, type JSX, type MouseEvent, type WheelEvent } from 'react'
import { IconFull } from './icons'
import { loadImage, type LoadedImage } from '../lib/imageLoader'

// Above this resolution Chromium rasterizes a visible <img> on the MAIN thread —
// measured at 2.3s of hard freeze for a 384 MP PNG, during which nothing paints
// (so the loading spinner never appeared and navigation appeared to hang).
// createImageBitmap does the same work entirely off-thread, so such images are
// decoded to a display-sized bitmap and shown on a canvas instead.
const CANVAS_PATH_PIXELS = 40_000_000
// Longest edge of that bitmap. Sharp at a step or two of zoom while staying cheap
// to rasterize: measured, 4096 cost ~550ms of raster on display, 2560 ~200ms.
const MAX_EDGE = 2560


// The image viewer: fit-to-window by default, wheel zoom toward the cursor, drag
// to pan, rotate, reset, and fullscreen. Remounted per file by the app (key=path),
// so zoom/pan/rotation reset on navigation with no extra bookkeeping.

const MAX_ZOOM = 40
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export function ImageView({
  url,
  name,
  onToggleFullscreen
}: {
  url: string
  name: string
  onToggleFullscreen: () => void
}): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [rot, setRot] = useState(0)
  const [panning, setPanning] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [img, setImg] = useState<LoadedImage | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const huge = !!img && img.width * img.height > CANVAS_PATH_PIXELS

  // The viewer is remounted per file (keyed by path), so state starts fresh here;
  // no synchronous resets needed. All updates below fire asynchronously.
  useEffect(() => {
    let alive = true
    loadImage(url)
      .then((r) => alive && setImg(r))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [url])

  // Very large images: decode off the main thread, downscaled, straight into the
  // canvas. Keeps the UI responsive (and the spinner painting) throughout.
  useEffect(() => {
    if (!img || !huge) return
    let alive = true
    let bitmap: ImageBitmap | null = null
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
    createImageBitmap(img.blob, {
      resizeWidth: Math.max(1, Math.round(img.width * scale)),
      resizeHeight: Math.max(1, Math.round(img.height * scale)),
      resizeQuality: 'high'
    })
      .then((bmp) => {
        bitmap = bmp
        const c = canvasRef.current
        if (!alive || !c) {
          bmp.close()
          return
        }
        c.width = bmp.width
        c.height = bmp.height
        // bitmaprenderer hands the bitmap over without copying it.
        const ctx = c.getContext('bitmaprenderer')
        if (ctx) {
          ctx.transferFromImageBitmap(bmp)
        } else {
          c.getContext('2d')?.drawImage(bmp, 0, 0)
          bmp.close()
        }
        setLoaded(true)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
      bitmap?.close()
    }
  }, [img, huge])

  const reset = useCallback(() => {
    setZoom(1)
    setTx(0)
    setTy(0)
  }, [])

  const cursorFromCentre = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r) return [0, 0]
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]
  }

  const zoomAt = useCallback(
    (e: { clientX: number; clientY: number }, next: number) => {
      const ns = clamp(next, 1, MAX_ZOOM)
      if (ns === 1) {
        reset()
        return
      }
      const [cx, cy] = cursorFromCentre(e)
      setZoom((z) => {
        const k = ns / z
        setTx((x) => cx - k * (cx - x))
        setTy((y) => cy - k * (cy - y))
        return ns
      })
    },
    [reset]
  )

  const zoomCentered = useCallback(
    (factor: number) => {
      const r = stageRef.current?.getBoundingClientRect()
      const center = r ? { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 } : { clientX: 0, clientY: 0 }
      zoomAt(center, zoom * factor)
    },
    [zoomAt, zoom]
  )

  const onWheel = (e: WheelEvent): void => {
    zoomAt(e, zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18))
  }

  const onImgDown = (e: MouseEvent): void => {
    if (zoom <= 1) return
    e.preventDefault()
    const orig = { x: e.clientX, y: e.clientY, tx, ty }
    setPanning(true)
    const move = (ev: globalThis.MouseEvent): void => {
      setTx(orig.tx + (ev.clientX - orig.x))
      setTy(orig.ty + (ev.clientY - orig.y))
    }
    const up = (): void => {
      setPanning(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Image-specific keys (arrows stay with the app for folder nav).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      switch (e.key) {
        case '+':
        case '=': zoomCentered(1.18); break
        case '-':
        case '_': zoomCentered(1 / 1.18); break
        case '0': reset(); break
        case 'r':
        case 'R': setRot((d) => (d + 90) % 360); break
        case 'f':
        case 'F': onToggleFullscreen(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomCentered, reset, onToggleFullscreen])

  const cursor = zoom > 1 ? (panning ? 'grabbing' : 'grab') : 'default'

  return (
    <div
      ref={stageRef}
      onWheel={onWheel}
      className="group relative flex h-full w-full items-center justify-center overflow-hidden"
    >
      {failed ? (
        <div className="grid place-items-center p-8 text-center text-sm text-[#c9ccd6]">
          This image can’t be displayed (unsupported format or corrupt file).
        </div>
      ) : (
        <>
          {/* Buffering spinner. Mounted for the whole load; the `delayed-loader`
              class keeps it invisible for the first ~260ms (CSS, so it survives a
              main-thread stall from a huge decode) and fades it in after that. */}
          {!loaded && (
            <div className="delayed-loader pointer-events-none absolute inset-0 grid place-items-center">
              <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[color:var(--p-divider)] border-t-[var(--color-accent-hi)]" />
            </div>
          )}
          {/* Fit the stage in both directions (same reason as the video): max-w/max-h
              cap at intrinsic size, which left images smaller than the window sitting
              tiny in the middle of the screen. Zoom still scales up from this fit. */}
          {img && huge && (
            <canvas
              ref={canvasRef}
              onMouseDown={onImgDown}
              onDoubleClick={(e) => zoomAt(e, zoom > 1 ? 1 : 2)}
              style={{
                transform: `translate(${tx}px, ${ty}px) scale(${zoom}) rotate(${rot}deg)`,
                cursor,
                opacity: loaded ? 1 : 0,
                transition: panning ? 'none' : 'transform .12s ease-out, opacity .2s ease-out'
              }}
              className="h-full w-full object-contain"
            />
          )}
          {img && !huge && (
            <img
              src={img.objectUrl}
              alt={name}
              draggable={false}
              decoding="async"
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
              onMouseDown={onImgDown}
              onDoubleClick={(e) => zoomAt(e, zoom > 1 ? 1 : 2)}
              style={{
                transform: `translate(${tx}px, ${ty}px) scale(${zoom}) rotate(${rot}deg)`,
                cursor,
                opacity: loaded ? 1 : 0,
                transition: panning ? 'none' : 'transform .12s ease-out, opacity .2s ease-out'
              }}
              className="h-full w-full object-contain"
            />
          )}
        </>
      )}

      {/* control cluster, appears on hover */}
      {!failed && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[var(--p-title)]/90 px-2 py-1 text-[var(--p-text)] opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
          <button className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-white/15" onClick={() => zoomCentered(1 / 1.18)} title="Zoom out (-)">−</button>
          <button className="pointer-events-auto min-w-[3.2rem] rounded-full px-2 text-[12px] font-semibold tabular-nums hover:bg-white/15" onClick={reset} title="Reset (0)">
            {Math.round(zoom * 100)}%
          </button>
          <button className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-white/15" onClick={() => zoomCentered(1.18)} title="Zoom in (+)">+</button>
          <div className="mx-1 h-5 w-px bg-white/15" />
          <button className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full hover:bg-white/15" onClick={() => setRot((d) => (d + 90) % 360)} title="Rotate (R)">
            <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 3v5h-5" />
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
