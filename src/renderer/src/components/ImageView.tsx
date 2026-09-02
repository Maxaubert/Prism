import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent,
  type ReactNode,
  type WheelEvent
} from 'react'
import { IconFull } from './icons'
import { loadImage, type LoadedImage } from '../lib/imageLoader'
import { clampPan, panBounds } from '../lib/imagePan'
import { chromeClass, useAutoHideChrome } from '../lib/autoHideChrome'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { fileVerbs, tickIf } from '../lib/fileVerbs'
import { encodeCopy, pngFromBlob } from '../lib/copyImage'
import {
  loadSlideSeconds,
  saveSlideSeconds,
  SLIDE_SECONDS,
  stopsSlideshow,
  type SlideSeconds
} from '../lib/slideshow'

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
  path,
  name,
  onToggleFullscreen,
  onStep,
  canStep,
  status,
  fullscreen = false
}: {
  url: string
  /** The file on disk. The menu's verbs act on this, not on the fsmedia url. */
  path?: string
  name: string
  onToggleFullscreen: () => void
  /** The slideshow's step: the same route the arrows take, so it moves through
   *  the folder in whatever order the sort menu decided. */
  onStep?: (dir: 1 | -1) => void
  /** Whether there IS one that way, which is how the slideshow knows to wrap
   *  by walking back to the start rather than stopping at the end. */
  canStep?: (dir: 1 | -1) => boolean
  /** Something to show in the control bar, between the zoom group and the
   *  rotate/fullscreen group: the comic's page counter. ONE BAR rather than two
   *  (owner, 2026-09-02) - a second pill stacked above this one was twice the
   *  chrome for one line of text. */
  status?: ReactNode
  /** Fullscreen paints the stage black and shows no checkerboard: the same
   *  rule the film follows, for the same reason. */
  fullscreen?: boolean
}): JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // Pinned while the pointer is on the bar, or while the right-click menu is
  // open - an invisible menu would keep eating clicks and the first Escape.
  const { shown: chromeShown, leaving: chromeLeaving } = useAutoHideChrome(
    useCallback(
      () => !!menu || !!document.querySelector('[data-viewer-chrome]:hover'),
      [menu]
    ),
    undefined,
    // The arrows are navigation - a comic page turn, a step through the folder -
    // and doing the thing you came to do should not summon the controls. Every
    // other key still does, because +, -, 0, 1 and R all change what the bar is
    // showing.
    useCallback((e: KeyboardEvent) => !e.key.startsWith('Arrow'), [])
  )
  /**
   * What the ELEMENT says it is, when the header parser could not say.
   *
   * `probeDimensions` reads PNG, GIF, JPEG and WebP headers and answers 0x0
   * for everything else - which is SVG, AVIF, BMP and ICO, precisely the
   * formats most likely to carry transparency. With 0 for a width, `fitScale`
   * is 0, so anything sized from it collapses: the checkerboard behind the
   * picture, the pan bounds, and the zoom readout (which was falling back to
   * a bare `zoom`). The element knows, once it has loaded.
   */
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [copyNote, setCopyNote] = useState<string | null>(null)
  const [slideshow, setSlideshow] = useState(false)
  const [slideSecs, setSlideSecs] = useState<SlideSeconds>(() => loadSlideSeconds())
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
  /** The source size: the header when it could be parsed, else the element. */
  const src =
    img?.width && img?.height
      ? { width: img.width, height: img.height }
      : natural
        ? { width: natural.w, height: natural.h }
        : null
  const fitScale =
    src && stage.w && stage.h ? Math.min(stage.w / src.width, stage.h / src.height) : 0
  /** Turned on its side, the fitted picture is as wide as it was tall. This is
   *  what makes it fit again rather than run off the top and bottom. */
  const rotFit =
    rot % 180 === 90 && fitScale && src
      ? Math.min(stage.w / (src.height * fitScale), stage.h / (src.width * fitScale))
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
      const b = src && fitScale ? panBounds(src, stage, fitScale * rotFit * ns, rot) : null
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
    const b = src && fitScale ? panBounds(src, stage, shownScale, rot) : null
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


  /** The picture on the clipboard, and a word when it could not go. A canvas
   *  has a backing-store limit, so a big enough panorama gives back no bytes
   *  at all - and a verb that silently does nothing is worse than one that
   *  says so. */
  /**
   * The slideshow's clock.
   *
   * It steps forward and, at the end of the folder, walks back to the start.
   * The WRAP lives here rather than in `go` on purpose: a slideshow that
   * stops after the last picture has ended rather than looped, while the
   * arrow keys must still stop at the edge, because someone arrowing is
   * looking for a file.
   */
  useEffect(() => {
    if (!slideshow || !onStep || !canStep) return
    const id = window.setInterval(() => {
      if (canStep(1)) onStep(1)
      else while (canStep(-1)) onStep(-1)
    }, slideSecs * 1000)
    return () => window.clearInterval(id)
  }, [slideshow, slideSecs, onStep, canStep])

  // Anything deliberate ends it. A picture that keeps changing itself under
  // someone who has started browsing is the whole failure mode.
  useEffect(() => {
    if (!slideshow) return
    const onKey = (e: KeyboardEvent): void => {
      if (stopsSlideshow(e.key)) setSlideshow(false)
    }
    const onPointer = (): void => setSlideshow(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointer, true)
    }
  }, [slideshow])

  const saveCopy = useCallback(
    async (format: 'png' | 'jpeg'): Promise<void> => {
      const bytes = await encodeCopy(img?.blob ?? null, format)
      if (!bytes) {
        setCopyNote('That image is too large to save a copy of')
        window.setTimeout(() => setCopyNote(null), 2200)
        return
      }
      const where = await window.prism.saveImageCopy(bytes, name, format)
      if (where) {
        setCopyNote('Saved a copy')
        window.setTimeout(() => setCopyNote(null), 1800)
      }
    },
    [img, name]
  )

  const copyImage = useCallback(async (): Promise<void> => {
    const png = await pngFromBlob(img?.blob ?? null)
    const ok = !!png && window.prism.copyImageToClipboard(png)
    setCopyNote(ok ? 'Image copied' : 'That image is too large to copy')
    window.setTimeout(() => setCopyNote(null), 1800)
  }, [img])

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
        // The menu advertises this in its shortcut column, so it has to exist.
        // A text selection keeps its own copy: only an untouched page gets it.
        case 'c':
        case 'C':
          if (e.ctrlKey && !window.getSelection()?.toString()) {
            e.preventDefault()
            void copyImage()
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // oneToOne closes over the measured scale, which changes with the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomCentered, reset, onToggleFullscreen, fitScale, rotFit, copyImage])

  const cursor = zoom > 1 ? (panning ? 'grabbing' : 'grab') : 'default'

  /**
   * The picture's own menu (2026-08-30, cut back 2026-08-31).
   *
   * It started as everything the picture could do and read like a toolbar:
   * next, previous, zoom in, zoom out, fit, actual size, rotate, fullscreen,
   * copy, and a shortcut against nearly every row. All of that was already
   * one press or one button away - the arrows page the folder, the zoom
   * cluster sits in the corner, F is fullscreen - so the menu was teaching
   * keys nobody needed taught and burying the two verbs that are only here.
   *
   * What is left is what you cannot do another way with a pointer: turn the
   * picture, take the PIXELS (which for a HEIC or a RAW is the one thing
   * Windows itself cannot do), and get to the file. No icons: this is a short
   * list of verbs, not a toolbar.
   */
  const menuItems = (): MenuItem[] => [
    { label: 'Rotate', onPick: () => setRot((d) => (d + 90) % 360) },
    { label: 'Copy image', hint: 'Ctrl+C', disabled: !img, onPick: () => void copyImage() },
    {
      label: 'Save a copy',
      disabled: !img,
      children: [
        { label: 'PNG', onPick: () => void saveCopy('png') },
        { label: 'JPEG', onPick: () => void saveCopy('jpeg') }
      ]
    },
    ...(onStep && canStep
      ? [
          {
            label: slideshow ? 'Stop slideshow' : 'Slideshow',
            // The interval hangs off the same row, so starting one and saying
            // how fast it goes are one gesture rather than two.
            onPick: () => setSlideshow((on) => !on),
            children: SLIDE_SECONDS.map((n) => ({
              label: `${n} seconds`,
              icon: tickIf(n === slideSecs),
              onPick: () => {
                setSlideSecs(n)
                saveSlideSeconds(n)
                setSlideshow(true)
              }
            }))
          } as MenuItem
        ]
      : []),
    ...(path ? fileVerbs(path) : [])
  ]

  return (
    <div
      ref={stageRef}
      onWheel={onWheel}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      className="group relative flex h-full w-full items-center justify-center overflow-hidden"
    >
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />}
      {/* A multi-page TIFF shows its first page and used to say nothing about
          the rest. ffmpeg cannot reach page 2, so this is honest about what
          it is: a note, not a picker. Scans and faxes arrive this way. */}
      {copyNote && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/65 px-3 py-1 text-[11.5px] text-white/90">
          {copyNote}
        </div>
      )}
      {!!img?.pages && img.pages > 1 && (
        <div
          className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-1 text-[11px] text-white/85"
          title={`This file holds ${img.pages} pages. Prism shows the first.`}
        >
          Page 1 of {img.pages}
        </div>
      )}
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
          {/* The ground behind a transparent picture, and ONLY behind it.
              The element is `object-contain`, so its box is the whole stage
              while the painted picture is a letterboxed sub-rect the DOM
              never names - a background on either paints the entire window.
              This is a sibling sized to the picture (fitScale times the
              source) carrying the identical transform, so it moves, zooms
              and turns with it. Not in fullscreen: the 2026-08-28 rule is
              that a fullscreen stage is black whatever the theme says, and a
              checkerboard is exactly the app leaking into the picture. */}
          {img && src && fitScale > 0 && !fullscreen && (
            <div
              aria-hidden
              className="p-checker pointer-events-none absolute left-1/2 top-1/2"
              style={{
                width: src.width * fitScale,
                height: src.height * fitScale,
                transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${zoom * rotFit}) rotate(${rot}deg)`,
                opacity: loaded ? 1 : 0,
                transition: panning ? 'none' : 'transform .12s ease-out, opacity .2s ease-out'
              }}
            />
          )}
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
              onLoad={(e) => {
                setLoaded(true)
                const el = e.currentTarget
                if (el.naturalWidth && el.naturalHeight) {
                  setNatural({ w: el.naturalWidth, h: el.naturalHeight })
                }
              }}
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

      {/* THE CONTROL CLUSTER HIDES ITSELF (2026-09-02), windowed and in
          fullscreen alike. It used to be `opacity-0 group-hover:opacity-100`,
          which is a CSS hover on the stage: fine windowed, and exactly the
          pattern that failed for the video transport in fullscreen, where a
          layer taken to zero opacity is composited once and never repainted.
          So it MOUNTS AND UNMOUNTS on a clock, through the transport's own
          rule - see `useAutoHideChrome`, which carries the reasoning.
          `data-viewer-chrome` is how the clock asks whether the pointer is on
          it: reaching for a button and pausing your hand must not make the
          button disappear, and asking the DOM cannot be a flag that failed to
          clear. */}
      {!failed && chromeShown && (
        <div
          data-viewer-chrome
          // THE WHOLE PILL TAKES THE POINTER, not just its buttons. It was
          // `pointer-events-none` with each button opting back in, which meant
          // the gaps, the dividers and the page counter could not be hovered -
          // so `[data-viewer-chrome]:hover`, which is what pins the bar open,
          // did not match when the cursor sat on the counter in the middle of
          // it. Reaching for a control and pausing your hand has to hold it up
          // wherever on the bar the hand stopped.
          className={`pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[var(--p-title)]/90 px-2 py-1 text-[var(--p-text)] backdrop-blur ${chromeClass(chromeLeaving)}`}
        >
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
          {status != null && (
            <>
              <div className="mx-1 h-5 w-px bg-white/15" />
              <span className="px-1 text-[11.5px] tabular-nums text-[var(--p-dim)]">{status}</span>
            </>
          )}
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
