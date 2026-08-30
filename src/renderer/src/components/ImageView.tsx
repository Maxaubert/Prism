import { useCallback, useEffect, useRef, useState, type JSX, type MouseEvent, type WheelEvent } from 'react'
import { IconFull } from './icons'
import { loadImage, type LoadedImage } from '../lib/imageLoader'
import { clampPan, panBounds } from '../lib/imagePan'

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

  /* How big the stage is, measured rather than assumed (2026-08-28).
   *
   * `zoom` is a multiple of the FIT, not of the picture: at zoom 1 a 6000px
   * photo in a 1200px window is showing at a fifth of its size. Two things
   * need the real numbers - the readout, which used to say "100%" over that
   * fifth, and rotation, which turned a landscape photo on its side and let
   * the stage crop it, because nothing re-fitted it. */
  const [stage, setStage] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setStage((p) => (p.w === width && p.h === height ? p : { w: width, h: height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** What object-contain is already doing: the picture's on-screen scale at
   *  zoom 1. Zero while the size of either is unknown. */
  const fitScale =
    img?.width && img?.height && stage.w && stage.h
      ? Math.min(stage.w / img.width, stage.h / img.height)
      : 0
  /** Turned on its side, the fitted picture is as wide as it was tall. This is
   *  what makes it fit again rather than run off the top and bottom. */
  const rotFit =
    rot % 180 === 90 && fitScale
      ? Math.min(stage.w / (img!.height * fitScale), stage.h / (img!.width * fitScale))
      : 1
  const shownScale = fitScale * rotFit * zoom
  /** The zoom that would show this picture at its true size. */
  /**
   * The floor zoom (2026-08-28).
   *
   * 1 means "fit", and for a picture SMALLER than the window the fit is
   * already an enlargement - so its true size sits below 1. The floor is
   * therefore actual size or fit, whichever is smaller, and never below:
   * without it, "actual size" on a small picture left the zoom outside the
   * range every button clamps to, where zooming OUT made the picture bigger.
   */
  const trueZoom = fitScale ? 1 / (fitScale * rotFit) : 1
  const zoomFloor = Math.min(1, trueZoom)

  const oneToOne = (): void => {
    if (!fitScale) return
    // Clamped like every other zoom path: a picture SMALLER than the window is
    // already being scaled up by the fit, so its true size is below 1 - and an
    // unclamped 0.4 there made "actual size" a state the buttons could not
    // leave, where zooming out made the picture bigger (2026-08-28).
    setZoom(clamp(trueZoom, zoomFloor, MAX_ZOOM))
    setTx(0)
    setTy(0)
  }

  /* The picture on screen stays there until the next one is ready.
   *
   * This component is no longer remounted per file, so `img` still holds the
   * previous picture while the new one decodes - which is the point: swapping
   * only when the replacement exists means arrowing through a folder never
   * shows an empty window. Everything that IS per-file (zoom, pan, rotation,
   * the failure flag) is reset here, since a remount is no longer doing it. */
  useEffect(() => {
    let alive = true
    // Both of these settle asynchronously, with the load: setting them straight
    // away would render twice for no reason, and `failed` in particular must not
    // clear before there is anything to replace what failed.
    //
    // `loaded` is never reset. It drives the fade-in, so clearing it would fade
    // the picture already on screen down to nothing while the next one decodes:
    // the same black flash, arrived at from the other direction. It starts false
    // on first mount, which is the only time a fade is wanted.
    loadImage(url)
      .then((r) => {
        if (!alive) return
        setFailed(false)
        setImg(r)
        setZoom(1)
        setTx(0)
        setTy(0)
        setRot(0)
      })
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
      const ns = clamp(next, zoomFloor, MAX_ZOOM)
      if (ns === 1) {
        reset()
        return
      }
      const [cx, cy] = cursorFromCentre(e)
      // Clamped against the NEW scale: zooming out towards a corner used to
      // leave the picture parked off stage.
      const b =
        img && fitScale ? panBounds(img, stage, fitScale * rotFit * ns, rot) : null
      setZoom((z) => {
        const k = ns / z
        setTx((x) => {
          const nx = cx - k * (cx - x)
          return b ? clampPan(nx, 0, b)[0] : nx
        })
        setTy((y) => {
          const ny = cy - k * (cy - y)
          return b ? clampPan(0, ny, b)[1] : ny
        })
        return ns
      })
    },
    [reset, img, stage, fitScale, rotFit, rot]
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
    // Read once: the zoom cannot change mid-drag, and the picture may only
    // travel until its edge reaches the middle of the stage.
    const b = img && fitScale ? panBounds(img, stage, shownScale, rot) : null
    const move = (ev: globalThis.MouseEvent): void => {
      const nx = orig.tx + (ev.clientX - orig.x)
      const ny = orig.ty + (ev.clientY - orig.y)
      const [cx2, cy2] = b ? clampPan(nx, ny, b) : [nx, ny]
      setTx(cx2)
      setTy(cy2)
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
      // Never while typing. The sidebar's search box sits in the same window
      // as the picture, so 'r' rotated it mid-word and '0' reset the zoom
      // under someone searching for "r0ma" (2026-08-28).
      const el = e.target as HTMLElement | null
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
      switch (e.key) {
        case '+':
        case '=': zoomCentered(1.18); break
        case '-':
        case '_': zoomCentered(1 / 1.18); break
        case '0': reset(); break
        case '1': oneToOne(); break
        case 'r':
        case 'R': setRot((d) => (d + 90) % 360); break
        case 'f':
        case 'F': onToggleFullscreen(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // oneToOne closes over the measured scale, which changes with the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomCentered, reset, onToggleFullscreen, fitScale, rotFit])

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
                transform: `translate(${tx}px, ${ty}px) scale(${zoom * rotFit}) rotate(${rot}deg)`,
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
                transform: `translate(${tx}px, ${ty}px) scale(${zoom * rotFit}) rotate(${rot}deg)`,
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
            {Math.round((shownScale || zoom) * 100)}%
          </button>
          <button className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-white/15" onClick={() => zoomCentered(1.18)} title="Zoom in (+)">+</button>
          <button
            className="pointer-events-auto rounded-full px-2 text-[11px] font-semibold tabular-nums hover:bg-white/15"
            onClick={oneToOne}
            title="Actual size (1)"
          >
            1:1
          </button>
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
