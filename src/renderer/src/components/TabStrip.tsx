import { useCallback, useEffect, useRef, useState, type JSX, type MouseEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { isPinnedExplorer, tabLabels, type Tab } from '../lib/tabs/tabs'
import {
  freeRect,
  ghostRect,
  pastSlop,
  shouldTear,
  slotAt as slotFor,
  snapTarget,
  tearZone,
  type Point,
  type Rect,
  type StripReport,
  type TabHover,
  type TabLook,
  type TearEvent
} from '@shared/tabTear'
import type { StripTear } from '../hooks/useTabTear'
import { pinnedRoots, plusMenuList, recentRoots, togglePin } from '@renderer/lib/recentRoots'
import { DRAG_MIME, overPayload, ownDrop, setDrag, windowsDrag, type DragPayload } from '../lib/drag/dragDrop'
import { archiveTarget, dropVerb, effectOf, type DropKeys } from '../lib/drag/dropVerb'
import { createHoverSwitch, type HoverSwitch } from '../lib/drag/hoverSwitch'
import { ContextMenu } from './ContextMenu'
import { plusButtonMenu, tabContextMenu } from '../menus/tabStrip'
import { TabKindIcon } from './icons/TabKindIcon'
import { useTabWidth } from '../lib/tabs/tabWidthPrefs'
import { Icon } from './icons/Icon'
import { PATHS } from './icons/paths'

/**
 * HOW THE CARRIED TAB LOOKS, for the ghost that follows the cursor (owner,
 * 2026-10-30: "let it just be the tab you're carrying"). The ghost is a page
 * of its own with none of the theme, so the tab's colours go with the tear,
 * resolved: a probe inside the tab wears the tokens the strip's lifted copy
 * wears (TabGhost below) and the browser answers each as a plain colour.
 */
function tabLookOf(el: HTMLElement): TabLook | undefined {
  try {
    const probe = document.createElement('span')
    probe.style.cssText =
      'position:absolute;visibility:hidden;pointer-events:none;background-color:var(--p-tabs);color:var(--p-text);border:1px solid var(--p-divider);outline:1px solid var(--p-accent-hi)'
    el.appendChild(probe)
    const cs = getComputedStyle(probe)
    const look = {
      ground: cs.backgroundColor,
      ink: cs.color,
      edge: cs.borderTopColor,
      accent: cs.outlineColor,
      font: getComputedStyle(el).fontFamily
    }
    probe.remove()
    return look
  } catch {
    return undefined
  }
}

/**
 * The open tabs, as a row under the title bar.
 *
 * Present from the first tab, so the `+` is always somewhere to reach and the
 * chrome never shifts under you when a second folder opens. It goes only when
 * there is nothing open at all, where EmptyState is already offering the way in.
 */
/** The slide that opens and closes the gap a carried tab leaves (#71). With
 *  reduced motion the neighbours simply land in their new places: the gap
 *  still says where the tab would go, without the travel. */
const SLIDE =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? 'transform 0ms'
    : 'transform 170ms cubic-bezier(.23,1,.32,1)'

/**
 * One carried tab, as the gesture knows it (tab tear-off step 3, 2026-10-29).
 * A ref, not state: pointer events come faster than renders, and every
 * decision is made from the latest one. `press` until the pointer has
 * travelled (a click), `strip` while it slides and pulls in its row, `torn`
 * once it has left the strip and main carries it (the window's only tab too,
 * owner 2026-10-30), `ending` while a drop waits for main's answer.
 */
interface Gesture {
  id: string
  from: number
  size: { width: number; height: number }
  laneTop: number
  /** The press inside the tab. */
  grab: Point
  /** The strip and the zone the tab must leave entirely to tear. */
  strip: Rect
  zone: Rect
  /** Where a strip's FIRST tab sits: the new window's one tab is there. */
  origin: Point
  start: Point
  pointer: Point
  phase: 'press' | 'strip' | 'torn' | 'ending'
  /** It left the strip at least once: its end is the tear's to settle. */
  tore: boolean
  /** Main has the ghost on screen (owner, 2026-10-30: only the tab follows
   *  the cursor), or the tab is in another window's strip: the chip here can
   *  go. */
  shown: boolean
  /** Settings never leaves its window. */
  tearable: boolean
  pointerId: number
  el: HTMLElement
}

/** The pin on a + menu row (#99): outlined while the folder is only history,
 *  filled once it is pinned. One path, two fills, so the two states line up. */
const PinGlyph = ({ filled }: { filled: boolean }): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    width={12}
    height={12}
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinejoin="round"
    className="shrink-0"
    data-pin={filled ? 'on' : 'off'}
    aria-hidden
  >
    <path d={PATHS.pin} />
  </svg>
)

/** What the + menu lists right now: pins first, then the newest recents. */
const plusMenuRows = (): Array<{ path: string; pinned: boolean }> =>
  plusMenuList(pinnedRoots(), recentRoots())

export function TabStrip({
  tabs,
  activeId,
  onPick,
  onClose,
  onNew,
  onDropFile,
  onDropIntoTab,
  onReorder,
  onOpenRecent,
  tear,
  wash,
  inTitleRow = false
}: {
  tabs: Tab[]
  activeId: string | null
  onPick: (id: string) => void
  onClose: (id: string) => void
  /** The + at the end. This one ADDS a tab, rooted at the user's own folder
   *  with nothing to answer first; the sidebar's folder button is the one that
   *  opens a chooser, and it replaces the current tab. Different verbs, so
   *  different labels. */
  onNew: () => void
  /** A file dropped on the strip opens in a new tab. */
  onDropFile: (path: string) => void
  /** Existing tabs receive cargo in their current folder without switching tabs. */
  onDropIntoTab: (tabId: string, payload: DragPayload, keys: DropKeys) => void
  /** A tab dragged along the strip lands in front of `toIndex` (#70). */
  onReorder: (id: string, toIndex: number) => void
  /** Open a folder from the + menu's list of places Prism has been. */
  onOpenRecent: (path: string) => void
  /** Tearing a tab off into a window of its own (step 3, hooks/useTabTear).
   *  Without it a tab only slides in its row, as before. */
  tear?: StripTear
  /** Whether the style's light reaches the strip. Follows the title bar, so
   *  the setup's mode wipe does not tear between the two rows. */
  wash: boolean
  /** The title bar is hidden (#250): the strip fills the middle of the one
   *  row, between the panel toggle and the bar's buttons, and that row draws
   *  the height and the rule under it. */
  inTitleRow?: boolean
}): JSX.Element | null {
  const width = useTabWidth()
  // A tab being carried (#71 follow-up): the strip animates it rather than
  // drawing a hairline - the tab lifts out and its neighbours slide across to
  // open the gap it would drop into, which is what "picked up" looks like.
  // Reordering is a POINTER drag, not an HTML5 one (owner, 2026-08-23): a
  // system drag goes anywhere on screen and carries an OS snapshot. The strip
  // keeps its HTML5 handlers for FILES dropped onto it - that is a different
  // gesture with a different meaning.
  // THE TAB COMES OFF (tab tear-off step 3, owner, 2026-10-29: "if the tab is
  // dragged outside of the tab border where it's fully outside then it's a
  // new window otherwise it snaps to the tab bar"). This replaces the
  // 2026-08-23 rule that a tab "should slide left and right inside its own row
  // and nowhere else". Out of the strip it pulls at 0.4x; fully out (its own
  // rect clear of the strip, one tab width of grace past the +) it tears, and
  // a real window under the cursor holds it, moved by main. Back over this
  // strip for 120 ms, it attaches again; over ANY other Prism window's strip
  // it attaches there (step 4, the hover below). Escape, a right-click, a lost capture
  // or the window losing focus put everything back. The numbers:
  // src/shared/tabTear.ts; the rules: docs/features.md.
  // While ANY drag is in flight the strip stops being a window-drag handle.
  // The empty space after the + is the natural place to drop a folder, but it
  // is app-region drag: Chromium hands presses there to the OS, so no
  // dragover ever arrived and the drop could only be made over a tab. The
  // handle comes back the moment the drag ends.
  const [dragInFlight, setDragInFlight] = useState(false)
  const [fileDropTab, setFileDropTab] = useState<string | null>(null)
  // A background tab held under a drag comes to the front (#70 D12).
  const pickRef = useRef(onPick)
  useEffect(() => {
    pickRef.current = onPick
  })
  const hoverSwitch = useRef<HoverSwitch | null>(null)
  useEffect(() => {
    const sw = createHoverSwitch((id) => pickRef.current(id))
    hoverSwitch.current = sw
    return () => sw.clear()
  }, [])
  useEffect(() => {
    const on = (): void => setDragInFlight(true)
    const off = (): void => {
      setDragInFlight(false)
      setFileDropTab(null)
      hoverSwitch.current?.clear()
    }
    window.addEventListener('dragstart', on, true)
    window.addEventListener('dragenter', on, true)
    window.addEventListener('dragend', off, true)
    window.addEventListener('drop', off, true)
    return () => {
      window.removeEventListener('dragstart', on, true)
      window.removeEventListener('dragenter', on, true)
      window.removeEventListener('dragend', off, true)
      window.removeEventListener('drop', off, true)
    }
  }, [])
  const [plusMenu, setPlusMenu] = useState<{
    x: number
    y: number
    rows: Array<{ path: string; pinned: boolean }>
  } | null>(null)
  /** A tab's own menu (its rows: menus/tabStrip.tsx). */
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string; root: string } | null>(
    null
  )
  const [dropAt, setDropAt] = useState<number | null>(null)
  /** The slot the pointer-up lands in, as of the LAST move (state lags). */
  const dropRef = useRef<number | null>(null)
  const setDrop = (at: number | null): void => {
    dropRef.current = at
    setDropAt(at)
  }
  /** What the carried tab looks like this frame: its phase, and the copy that
   *  follows the pointer (the ghost), drawn above everything (a portal), so a
   *  tab pulled out of the strip is never clipped by it. */
  const [carry, setCarry] = useState<{
    id: string
    from: number
    width: number
    phase: Gesture['phase']
    /** The copy following the pointer: while it slides and pulls, and as the
     *  chip until main's ghost is on screen. */
    ghost: Rect | null
    /** Off the strip's line: the ghost wears a ground and a shadow. */
    lifted: boolean
  } | null>(null)
  const g = useRef<Gesture | null>(null)
  // The tab boundaries as they were when the drag STARTED. Asking which tab
  // sits under the pointer cannot work once they animate: the neighbour
  // slides out from under the cursor, the answer flips back, and the strip
  // judders. Frozen geometry has no feedback loop.
  const lanes = useRef<Array<{ left: number; width: number; mid: number }>>([])
  const strip = useRef<HTMLDivElement>(null)
  const plus = useRef<HTMLButtonElement>(null)
  /** True once the press has travelled far enough to BE a drag: a plain click
   *  must still switch tabs. */
  const dragging = useRef(false)
  /** Whatever had the keyboard before the drag: a shell, a tree row, the
   *  search box. Dragging a tab is not leaving it. */
  const heldFocus = useRef<HTMLElement | null>(null)
  /** The latest `tear`, for listeners made once. */
  const tearRef = useRef(tear)
  useEffect(() => {
    tearRef.current = tear
  }, [tear])
  const endDrag = (): void => {
    setDrop(null)
    setCarry(null)
    lanes.current = []
    const el = heldFocus.current
    heldFocus.current = null
    if (el && document.contains(el)) requestAnimationFrame(() => el.focus())
  }
  /** The slot a point is asking for, from the frozen lanes. */
  const slotAt = (x: number): number => slotFor(lanes.current.map((l) => l.mid), x)
  /** The gesture is over: nothing listens to the pointer any more. Cleared
   *  BEFORE the capture goes, so the lost capture that follows is not a cancel. */
  const finish = (s: Gesture): void => {
    if (g.current === s) g.current = null
    try {
      if (s.el.hasPointerCapture(s.pointerId)) s.el.releasePointerCapture(s.pointerId)
    } catch {
      /* the element has gone */
    }
    endDrag()
  }
  /** Draw the carried tab where it is in its row (sliding, pulled). */
  const drawInStrip = (s: Gesture): void => {
    const ghost = ghostRect(s.pointer, s.grab, s.size, s.strip, s.laneTop)
    setCarry((c) => (c ? { ...c, phase: 'strip', ghost, lifted: Math.abs(ghost.top - s.laneTop) > 0.5 } : c))
    // The CARRIED tab's own centre decides, not the pointer: it is what the
    // eye is following, and it keeps a grab near an edge honest.
    setDrop(slotAt(ghost.left + s.size.width / 2))
  }
  /** Escape, a right-click, a lost capture, the window losing focus: put
   *  everything back, and hide the ghost (spec 1.6). */
  const cancel = (): void => {
    const s = g.current
    if (!s || s.phase === 'ending') return
    finish(s)
    if (s.tore) void tearRef.current?.end(s.id, 'cancel')
  }
  const cancelRef = useRef(cancel)
  useEffect(() => {
    cancelRef.current = cancel
  })
  // THE STRIP GOING AWAY MID-DRAG ENDS IT (review 2026-10-29): F11 unmounts
  // the strip (fullscreen has none), and with it every listener that could
  // end the carry. Main carries the ghost until it hears, so it hears now.
  useEffect(() => () => cancelRef.current(), [])
  /** When a right-click cancelled a carry: the context menu its release
   *  brings (Windows opens it on the button's release) is swallowed. */
  const menuAfterCancel = useRef(0)
  useEffect(() => {
    const swallow = (e: Event): void => {
      if (!menuAfterCancel.current || performance.now() - menuAfterCancel.current > 1500) return
      menuAfterCancel.current = 0
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('contextmenu', swallow, true)
    return () => window.removeEventListener('contextmenu', swallow, true)
  }, [])
  /** Fully out of the strip: main takes it from here (spec 1.3, 1.7). */
  const tearOut = (s: Gesture): void => {
    const took = tearRef.current?.out(
      s.id,
      // The snap-back target is the strip held to the tear zone: a tab torn
      // sideways past the + must not be over it at once (review 2026-10-29).
      // Its size and label go too: another window's strip judges the tear-out
      // by the one and draws the other while it hovers there (step 4).
      {
        grab: s.grab,
        origin: s.origin,
        strip: snapTarget(s.strip, s.zone),
        point: s.pointer,
        size: s.size,
        label: tabLabels(tabs)[s.from] ?? '',
        // The ghost draws it as this strip does (main checks each value).
        look: tabLookOf(s.el)
      },
      () => {
        if (g.current === s) cancelRef.current()
      }
    )
    if (!took) {
      // It cannot leave (Settings): it stays a slide in its row.
      s.tearable = false
      return drawInStrip(s)
    }
    s.phase = 'torn'
    s.tore = true
    s.shown = false
    // The gap closes behind it with the same slide that opened it. The tab
    // in front stays in front, its page on screen, until a drop commits
    // (owner, 2026-10-30: "i want those switches to happen when you drop it").
    setDrop(null)
    setCarry((c) => (c ? { ...c, phase: 'torn', ghost: freeRect(s.pointer, s.grab, s.size), lifted: true } : c))
  }
  const onTabPointerDown = (e: PointerEvent<HTMLDivElement>, id: string, i: number): void => {
    if (e.button !== 0 || g.current) return
    // The X is not a handle: capturing the pointer here would swallow its
    // own click and close nothing.
    if ((e.target as HTMLElement).closest('[data-tab-close]')) return
    heldFocus.current = document.activeElement as HTMLElement | null
    const boxes = [...(strip.current?.querySelectorAll('[data-tab]') ?? [])].map((el) =>
      el.getBoundingClientRect()
    )
    lanes.current = boxes.map((b) => ({ left: b.left, width: b.width, mid: b.left + b.width / 2 }))
    const box = boxes[i]
    const sb = strip.current?.getBoundingClientRect()
    if (!box || !sb) return
    const stripRect = { left: sb.left, top: sb.top, right: sb.right, bottom: sb.bottom }
    const p = { x: e.clientX, y: e.clientY }
    g.current = {
      id,
      from: i,
      size: { width: box.width, height: box.height },
      laneTop: box.top,
      grab: { x: e.clientX - box.left, y: e.clientY - box.top },
      strip: stripRect,
      zone: tearZone(stripRect, plus.current?.getBoundingClientRect().right ?? sb.right, box.width),
      origin: { x: boxes[0].left, y: boxes[0].top },
      start: p,
      pointer: p,
      phase: 'press',
      tore: false,
      shown: false,
      tearable: !!tear && tabs[i]?.kind !== 'settings',
      pointerId: e.pointerId,
      el: e.currentTarget
    }
    dragging.current = false
    setCarry({ id, from: i, width: box.width, phase: 'press', ghost: null, lifted: false })
    setDrop(i)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onTabPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const s = g.current
    if (!s || s.phase === 'ending') return
    // A right button pressed while carrying is a cancel (spec 1.6), and the
    // menu its release would open is not wanted.
    if (e.buttons & 2) {
      menuAfterCancel.current = performance.now()
      return cancel()
    }
    s.pointer = { x: e.clientX, y: e.clientY }
    if (s.phase === 'press') {
      const dx = e.clientX - s.start.x
      // A drag starts past the slop along the row, or once the pointer has
      // left the strip: a wobble up and down inside it is still a click.
      const out = e.clientY < s.strip.top || e.clientY > s.strip.bottom
      if (Math.abs(dx) < 4 && !(out && pastSlop(dx, e.clientY - s.start.y))) return
      s.phase = 'strip'
      dragging.current = true
    }
    if (s.phase === 'torn') {
      // Main follows the system cursor itself; under --e2e it is told this.
      window.prism.tabTearPoint(e.clientX, e.clientY)
      if (!s.shown) {
        const ghost = freeRect(s.pointer, s.grab, s.size)
        setCarry((c) => (c ? { ...c, ghost } : c))
      }
      return
    }
    if (s.tearable && shouldTear(s.pointer, s.grab, s.size, s.zone)) return tearOut(s)
    drawInStrip(s)
  }
  const onTabPointerUp = (): void => {
    const s = g.current
    if (!s || s.phase === 'ending') return
    const was = s.phase
    if (was === 'torn') {
      // Held as it is (the gap closed, the tab hidden) until main answers, so
      // a committed drop never shows the tab here again for a frame; the
      // front changes only then (useTabTear).
      s.phase = 'ending'
      void (tearRef.current?.end(s.id, 'drop') ?? Promise.resolve(false))
        .catch(() => false)
        .then(() => finish(s))
      return
    }
    const landed = dragging.current && was === 'strip' ? dropRef.current : null
    finish(s)
    // Torn and snapped back, then dropped here: a reorder like any other, the
    // front as it was (owner, 2026-10-30: a snap back changes no selection).
    if (landed !== null) onReorder(s.id, landed)
  }
  // How the tear goes, from main (spec 1.3, 1.4).
  useEffect(
    () =>
      window.prism.onTearEvent((ev: TearEvent) => {
        const s = g.current
        if (!s || s.id !== ev.tabId) return
        if (ev.kind === 'shown' && s.phase === 'torn') {
          s.shown = true
          setCarry((c) => (c ? { ...c, ghost: null } : c))
        } else if (ev.kind === 'attached' && s.phase === 'torn') {
          // Back over this strip: it is a slide in its row again, at the slot
          // under the pointer. The front is as it was all along.
          s.phase = 'strip'
          s.shown = false
          drawInStrip(s)
        } else if (ev.kind === 'ended' && s.phase === 'torn') cancelRef.current()
        // In ANOTHER window's strip (step 4): that strip draws it, so no
        // chip follows the pointer here; torn out of it again, the chip is
        // back until the ghost shows.
        else if (ev.kind === 'over' && s.phase === 'torn') {
          s.shown = true
          setCarry((c) => (c ? { ...c, ghost: null } : c))
        } else if (ev.kind === 'off' && s.phase === 'torn') {
          s.shown = false
          setCarry((c) => (c ? { ...c, ghost: freeRect(s.pointer, s.grab, s.size) } : c))
        }
      }),
    // drawInStrip reads only refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  /**
   * STEP 4: A TAB CARRIED IN ANOTHER WINDOW HOVERS OVER THIS STRIP (owner,
   * 2026-10-29: "a torn tab hovering over ANY Prism window's strip attaches
   * there LIVE"). The pointer is the other window's (its strip holds the
   * capture), so main says where it is, every move: this strip opens a gap at
   * the slot under the tab and draws the tab in it, sliding along, and tells
   * main the slot (the drop lands there). Null: it left again, or the carry
   * ended; the gap closes with the same slide. A drop (`tabs:merge`) puts the
   * tab in the gap (useTabTear), and the gap goes without a slide, since the
   * tab now fills it.
   */
  const [hover, setHover] = useState<{
    tabId: string
    label: string
    width: number
    slot: number
    /** Null while the gap closes after it left. */
    ghost: Rect | null
    lifted: boolean
  } | null>(null)
  /** The lanes as they were when the hover began (frozen, as for a carry). */
  const hoverLanes = useRef<{ mids: number[]; laneTop: number } | null>(null)
  const hoverSlot = useRef<number | null>(null)
  const hoverGone = useRef<number | null>(null)
  useEffect(() => {
    const clearSoon = (): void => {
      if (hoverGone.current !== null) window.clearTimeout(hoverGone.current)
      hoverGone.current = window.setTimeout(() => {
        hoverGone.current = null
        setHover(null)
      }, 200)
    }
    const offHover = window.prism.onTabHover((h: TabHover | null) => {
      const el = strip.current
      if (!h || !el) {
        hoverLanes.current = null
        hoverSlot.current = null
        // The gap closes with the slide; then nothing is left of it.
        setHover((v) => (v ? { ...v, slot: Number.MAX_SAFE_INTEGER, ghost: null } : v))
        clearSoon()
        return
      }
      if (hoverGone.current !== null) {
        window.clearTimeout(hoverGone.current)
        hoverGone.current = null
      }
      const sb = el.getBoundingClientRect()
      if (!hoverLanes.current) {
        const boxes = [...el.querySelectorAll('[data-tab]')].map((b) => b.getBoundingClientRect())
        hoverLanes.current = { mids: boxes.map((b) => b.left + b.width / 2), laneTop: boxes[0]?.top ?? sb.top }
      }
      const lanes = hoverLanes.current
      const rect = { left: sb.left, top: sb.top, right: sb.right, bottom: sb.bottom }
      const ghost = ghostRect(h.point, h.grab, h.size, rect, lanes.laneTop)
      const slot = slotFor(lanes.mids, ghost.left + h.size.width / 2)
      if (hoverSlot.current !== slot) {
        hoverSlot.current = slot
        window.prism.tabHoverSlot(h.tabId, slot)
      }
      setHover({
        tabId: h.tabId,
        label: h.label,
        width: h.size.width,
        slot,
        ghost,
        lifted: Math.abs(ghost.top - lanes.laneTop) > 0.5
      })
    })
    const offMerge = window.prism.onTabMerge(() => {
      if (hoverGone.current !== null) window.clearTimeout(hoverGone.current)
      hoverGone.current = null
      hoverLanes.current = null
      hoverSlot.current = null
      setHover(null)
    })
    return () => {
      offHover()
      offMerge()
      if (hoverGone.current !== null) window.clearTimeout(hoverGone.current)
    }
  }, [])
  /**
   * WHERE THIS STRIP IS, FOR MAIN (step 4): every window reports its strip
   * and the + button's right edge, so a tab carried in another window can be
   * hit-tested against it. Sent only when it changed, never while a tab is
   * carried here or hovers here (the + slides then), and null once the strip
   * is gone (fullscreen, no tabs).
   */
  const stripSent = useRef('')
  const observed = useRef<Element | null>(null)
  const reportStrip = useCallback((): void => {
    const el = strip.current
    let report: StripReport | null = null
    if (el) {
      const sb = el.getBoundingClientRect()
      report = {
        strip: { left: sb.left, top: sb.top, right: sb.right, bottom: sb.bottom },
        plusRight: plus.current?.getBoundingClientRect().right ?? sb.right
      }
    }
    const key = JSON.stringify(report)
    if (key === stripSent.current) return
    stripSent.current = key
    window.prism.tabStrip(report)
  }, [])
  const stripBusy = carry !== null || hover !== null
  const stripBusyRef = useRef(stripBusy)
  useEffect(() => {
    stripBusyRef.current = stripBusy
    if (!stripBusy) reportStrip()
  })
  const resizes = useRef<ResizeObserver | null>(null)
  useEffect(() => {
    const on = (): void => {
      if (!stripBusyRef.current) reportStrip()
    }
    resizes.current = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(on)
    window.addEventListener('resize', on)
    return () => {
      resizes.current?.disconnect()
      resizes.current = null
      observed.current = null
      window.removeEventListener('resize', on)
      stripSent.current = ''
      window.prism.tabStrip(null)
    }
  }, [reportStrip])
  useEffect(() => {
    const el = strip.current
    if (el === observed.current) return
    if (observed.current) resizes.current?.unobserve(observed.current)
    observed.current = el
    if (el) resizes.current?.observe(el)
  })
  // While a tab is carried, the keyboard and the window can end it (spec 1.6).
  const carrying = carry !== null
  useEffect(() => {
    if (!carrying) return
    const key = (e: KeyboardEvent): void => {
      const s = g.current
      if (!s) return
      // Torn off, the tab stays live in this window until the drop (owner,
      // 2026-10-30), and the drop takes it as it is then: no key may change
      // it or the strip meanwhile (Ctrl+W, Ctrl+Tab, a step in the folder).
      const torn = s.phase === 'torn' || s.phase === 'ending'
      if (e.key !== 'Escape' && !torn) return
      // Escape is the carry's alone while it lasts: not fullscreen's, not a
      // panel's.
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') cancelRef.current()
    }
    const blur = (): void => cancelRef.current()
    const menu = (e: Event): void => {
      if (!g.current) return
      e.preventDefault()
      cancelRef.current()
    }
    // Dropped, while main settles the drop (a fresh window can take seconds):
    // the pointer's capture went with the release, so no click, wheel or drag
    // may reach the page either; the drop already packed the tab as it was
    // (review 2026-10-30: a folder opened meanwhile was lost with the tab).
    const pointer = (e: Event): void => {
      if (g.current?.phase !== 'ending') return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const POINTER = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'wheel', 'dragstart'] as const
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', blur)
    window.addEventListener('contextmenu', menu, true)
    for (const t of POINTER) window.addEventListener(t, pointer, { capture: true, passive: false })
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', blur)
      window.removeEventListener('contextmenu', menu, true)
      for (const t of POINTER) window.removeEventListener(t, pointer, { capture: true })
    }
  }, [carrying])
  /** The gap: torn off, the tabs after it close up; carried in the row,
   *  everything between its old slot and the one under it shifts by its width. */
  const torn = carry?.phase === 'torn'
  const slide = (i: number): number => {
    // A tab from another window hovering here: everything from its slot on
    // makes room (step 4).
    if (hover && !carry) return i >= hover.slot ? hover.width : 0
    if (!carry || i === carry.from) return 0
    if (torn) return i > carry.from ? -carry.width : 0
    if (dropAt === null) return 0
    if (dropAt > carry.from && i > carry.from && i < dropAt) return -carry.width
    if (dropAt <= carry.from && i >= dropAt && i < carry.from) return carry.width
    return 0
  }
  if (!tabs.length) return null
  const labels = tabLabels(tabs)
  // Middle-click closes, the way every tab strip does. `auxclick` rather than
  // mousedown so a stray middle press while scrolling does not lose a tab.
  const auxClose = (e: MouseEvent, id: string): void => {
    if (e.button === 1) {
      e.preventDefault()
      onClose(id)
    }
  }
  return (
    <div
      role="tablist"
      aria-label="Open folders"
      ref={strip}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        // Dropping something here opens it in a NEW tab; stopPropagation keeps
        // the window-level drop from opening it in the current one. Tabs
        // themselves reorder by pointer, not by this.
        e.preventDefault()
        e.stopPropagation()
        // Prism's own rows carry their paths in the drag payload, not as
        // files - a folder dragged out of the tree has to land here too, and
        // that is the natural way to open one beside what you have.
        // From Windows or back from Prism's own OS drag alike (#103): the
        // paths open, nothing moves.
        const inside = ownDrop(e.dataTransfer)
        setDrag(null)
        if (inside?.kind === 'files') for (const p of inside.paths) onDropFile(p)
      }}
      // While a tab is genuinely being carried the whole strip wears the
      // closed hand, children included: a tab is made of a label button, an
      // icon slot and an X, each with a cursor of its own, and letting them
      // answer for themselves made it flicker under the moving pointer.
      // In the title row the ROW paints the ground (and the wash): the strip
      // painting it again was a second see-through coat, the opaque bar the
      // owner saw on glass (#294).
      className={`${dragInFlight ? 'no-drag' : 'drag'} p-styled-font flex ${inTitleRow ? 'min-w-0 flex-1' : 'h-8 shrink-0 border-b border-[var(--p-divider)] bg-[var(--p-tabs)]'} items-stretch gap-0 overflow-x-auto pr-1 text-[12px] transition-[background-color,border-color] duration-[550ms] [transition-timing-function:cubic-bezier(.16,1,.3,1)] ${
        carry && carry.phase !== 'press' ? 'cursor-grabbing [&_*]:cursor-grabbing' : ''
      } ${wash && !inTitleRow ? 'p-wash' : ''}`}
    >
      {tabs.map((t, i) => {
        const on = t.id === activeId
        return (
          <div
            key={t.id}
            data-tab-role={t.kind === 'settings' ? 'settings' : 'explorer'}
            data-pinned={isPinnedExplorer(t) ? '' : undefined}
            // Hairline side edges in the divider token: they separate flush
            // tabs when the style draws edges, and vanish (the token goes
            // transparent) when it doesn't. Right edges only: the first tab
            // sits flush against the window's left side, no line before it.
            // EVERY TAB IS ONE WIDTH (owner, 2026-09-21: "make tabs in both
            // apps have a fixed size, and not dynamically adjust based on the
            // content"), the pinned Explorer tab included. A tab was as wide
            // as its label, up to 14rem, so a folder with a long name shoved
            // every tab after it sideways. Now 114px (owner, 2026-09-21/22: "way smaller... around 60% of what it
            // is now", which is what the Explorer tab used to be), shrinking - all of them
            // equally - only when the strip runs out of room, the way a browser
            // does; the label truncates inside. Prism Terminal's strip is the
            // same, on purpose. AND IT IS A SETTING (#216; owner, 2026-09-23:
            // "fixed size or dynamic ... the user can pick"; then "dynamic ...
            // the default"): Tab width > Dynamic (the DEFAULT)
            // is the strip from before, each tab as wide as its name
            // up to 14rem (the cap is on the label).
            data-tab-fixed={width === 'fixed' || undefined}
            data-tab-dynamic={width === 'dynamic' || undefined}
            className={`no-drag group relative flex items-center gap-1.5 border-r border-[color:var(--p-divider)] px-2.5 transition-colors ${
              width === 'fixed' ? 'min-w-[64px] flex-[0_1_114px]' : 'min-w-0 shrink'
            } ${
              on
                  ? // THE SECONDARY COLOUR (owner, 2026-09-03): the strip, the
                    // tabs at rest and this one are all --p-tabs, one surface
                    // with the sidebar and the title bar. --p-tab-active is
                    // kept as a token (it equals --p-tabs today) and the
                    // active tab is told by its ink, not a fill. So it
                    // PAINTS NOTHING (#294): the strip's ground is already
                    // under it, and a second coat of a see-through --p-tabs
                    // turned the tab you are on into an opaque slab on glass
                    // (0.80 twice is 0.96, MEASURED on Onyx).
                    'text-[var(--p-text)]'
                  : 'text-[var(--p-dim)] hover:bg-white/5 hover:text-[var(--p-text)]'
            }`}
            data-tab-id={t.id}
            style={{
              transform: (carry && carry.id !== t.id) || (hover && !carry) ? `translateX(${slide(i)}px)` : undefined,
              // What you carry is a COPY (the ghost, drawn above everything,
              // so a tab pulled out of the strip is never clipped by it); the
              // tab itself keeps its place, unseen, holding the pointer, and
              // the strip only really rearranges when the drop lands. The
              // neighbours sliding open the gap are the preview. The
              // window's only tab too (owner, 2026-10-30).
              opacity: carry?.id === t.id && carry.phase !== 'press' ? 0 : undefined,
              transition: (carry && carry.id !== t.id) || (hover && !carry) ? SLIDE : undefined
            }}
            // The WHOLE tab is the click target, not just the label: the
            // padding, the icon slot and the slack around a short name all
            // pick the tab. The close button stops propagation to opt out.
            onClick={() => {
              // A press that travelled is a drag, not a pick.
              if (dragging.current) {
                dragging.current = false
                return
              }
              onPick(t.id)
            }}
            onAuxClick={(e) => auxClose(e, t.id)}
            // The tab's own menu (2026-08-30). The wrapper owns it, not the
            // inner button: the padding and the icon slot are part of the
            // target, the same reasoning the click handler gives. A right
            // click cannot start a carry - onTabPointerDown ignores button 2.
            onContextMenu={(e) => {
              e.preventDefault()
              setTabMenu({
                x: e.clientX,
                y: e.clientY,
                id: t.id,
                root: t.kind === 'settings' ? '' : t.browse.path
              })
            }}
            // Tabs reorder by dragging (#70): the half of the tab the pointer
            // is over decides which side of it the dragged tab lands.
            data-tab
            data-folder-drop={t.kind === 'settings' ? undefined : t.browse.path}
            data-drag-over={fileDropTab === t.id || undefined}
            onDragOver={(e) => {
              // Stop before the blank-strip handler: an existing tab is a
              // destination, while empty strip space opens a new tab.
              e.stopPropagation()
              if (
                t.kind === 'settings' ||
                !(e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes('Files'))
              ) {
                e.dataTransfer.dropEffect = 'none'
                return
              }
              e.preventDefault()
              // The one drop rule (#70): the tab's folder, or a place inside
              // a zip, read from its path; Ctrl and Shift as held now.
              const seen: DragPayload | null =
                overPayload(e.dataTransfer) ??
                (windowsDrag(e.dataTransfer) ? { kind: 'files', paths: [], external: true } : null)
              const verb = dropVerb({
                payload: seen,
                target: { dir: t.browse.path, archive: archiveTarget(t.browse.path) },
                keys: { ctrl: e.ctrlKey, shift: e.shiftKey }
              })
              e.dataTransfer.dropEffect = effectOf(verb, windowsDrag(e.dataTransfer))
              setFileDropTab(verb === 'none' ? null : t.id)
              // Never the tab in front, never one being carried or torn.
              hoverSwitch.current?.over(t.id === activeId || carry ? null : t.id)
            }}
            onDragLeave={(e) => {
              if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
                setFileDropTab(null)
                hoverSwitch.current?.clear()
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              // From Windows: never moved, only copied in (a tab inside a zip
              // would otherwise bin the originals, review of #300; any folder,
              // #103 D3). Prism's own cargo back from an OS drag moves (D4).
              const payload = ownDrop(e.dataTransfer)
              setDrag(null)
              setFileDropTab(null)
              hoverSwitch.current?.clear()
              if (t.kind === 'settings' || !payload) return
              const keys = { ctrl: e.ctrlKey, shift: e.shiftKey }
              const target = { dir: t.browse.path, archive: archiveTarget(t.browse.path) }
              if (dropVerb({ payload, target, keys }) === 'none') return
              onDropIntoTab(t.id, payload, keys)
            }}
            onPointerDown={(e) => onTabPointerDown(e, t.id, i)}
            onPointerMove={onTabPointerMove}
            onPointerUp={onTabPointerUp}
            onPointerCancel={cancel}
            onLostPointerCapture={() => {
              if (g.current && g.current.phase !== 'ending') cancel()
            }}
          >
            {/* The active mark: an accent rule along the top. */}
            {on && <span className="absolute inset-x-0 top-0 h-0.5 bg-[var(--p-accent-hi)]" aria-hidden />}
            {/* EVERY TAB SAYS WHAT IT HOLDS (#308; owner, 2026-10-06: "we
                should have some default icons per type of page explorer,
                project and settings"; 2026-10-07, of the mockup: "A3 and C2").
                A folder or a gear in the tab's own ink, solid
                on the tab you are on and lines on the rest. It replaced the
                small folder in the folder colour that only Explorer tabs had. */}
            <TabKindIcon
              kind={t.kind === 'settings' ? 'settings' : 'explorer'}
              solid={on}
            />
            <button
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              // Fixed: whatever the tab leaves after its marks and the close
              // button, truncated there. Fit: the label sizes the tab, up to
              // 14rem, as before.
              className={`min-w-0 truncate py-1 text-left ${width === 'fixed' ? 'flex-1' : 'max-w-[14rem]'}`}
              title={t.browse.path}
              onClick={() => {
              // A press that travelled is a drag, not a pick.
              if (dragging.current) {
                dragging.current = false
                return
              }
              onPick(t.id)
            }}
            >
              {labels[i]}
            </button>
            {/* Every tab closes (owner, 2026-10-28), the home tab included:
                no pin, the X like any other. */}
            <button
              className={`grid h-4 w-4 shrink-0 place-items-center rounded-sm text-[var(--p-icon)] transition-opacity hover:bg-white/10 hover:text-[var(--p-text)] ${
                on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              data-tab-close
              title={`Close ${labels[i]} (Ctrl+W)`}
              aria-label={`Close ${labels[i]}`}
              onClick={(e) => {
                e.stopPropagation()
                onClose(t.id)
              }}
            >
              <Icon name="close" size={10} weight="2.4" join={false} />
            </button>
          </div>
        )
      })}
      <button
        ref={plus}
        className="no-drag my-1 grid w-7 shrink-0 place-items-center rounded text-[var(--p-icon)] transition-colors hover:bg-white/10 hover:text-[var(--p-text)]"
        // The + closes up behind a torn-off tab like the tabs do.
        style={{
          transform:
            torn && carry
              ? `translateX(${-carry.width}px)`
              : hover && !carry
                ? `translateX(${hover.ghost ? hover.width : 0}px)`
                : undefined,
          transition: carry || hover ? `${SLIDE}, background-color 150ms, color 150ms` : undefined
        }}
        title="New Explorer tab (Ctrl+T). Right-click for recent folders"
        aria-label="New tab"
        onClick={onNew}
        // The + adds a tab instantly; its RIGHT click is where "somewhere I
        // have been before" lives, so the instant verb stays instant.
        onContextMenu={(e) => {
          e.preventDefault()
          // Read when it opens: the list is history, and history moves.
          setPlusMenu({ x: e.clientX, y: e.clientY, rows: plusMenuRows() })
        }}
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M12 6v12m6-6H6" />
        </svg>
      </button>
      {carry?.ghost &&
        tabs[carry.from] &&
        createPortal(
          <TabGhost
            rect={carry.ghost}
            lifted={carry.lifted}
            kind={tabs[carry.from]?.kind === 'settings' ? 'settings' : 'explorer'}
            label={labels[carry.from] ?? ''}
            active={tabs[carry.from]?.id === activeId}
          />,
          document.body
        )}
      {hover?.ghost &&
        !carry &&
        createPortal(
          <TabGhost rect={hover.ghost} lifted={hover.lifted} kind="explorer" label={hover.label} active incoming={hover.tabId} />,
          document.body
        )}
      {tabMenu && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          onClose={() => setTabMenu(null)}
          items={tabContextMenu({
            root: tabMenu.root,
            onClose: () => onClose(tabMenu.id)
          })}
        />
      )}
      {plusMenu && (
        <ContextMenu
          x={plusMenu.x}
          y={plusMenu.y}
          onClose={() => setPlusMenu(null)}
          items={plusButtonMenu({
            rows: plusMenu.rows,
            onOpenRecent,
            onTogglePin: (path) => {
              togglePin(path)
              setPlusMenu((m) => (m ? { ...m, rows: plusMenuRows() } : m))
            },
            pinIcon: (filled) => <PinGlyph filled={filled} />
          })}
        />
      )}
    </div>
  )
}

/**
 * THE CARRIED TAB'S COPY (tab tear-off step 3): the tab's own face, following
 * the pointer above everything. In its row it is the tab, nothing added; off
 * the row's line (pulled, or the chip before main's ghost is up) it takes
 * the strip's ground and a soft shadow, so it reads as lifted rather than as
 * text loose over the page.
 */
function TabGhost({
  rect,
  lifted,
  kind,
  label,
  active,
  incoming
}: {
  rect: Rect
  lifted: boolean
  kind: 'settings' | 'explorer'
  label: string
  active: boolean
  /** A tab from ANOTHER window hovering in this strip (step 4): its id. */
  incoming?: string
}): JSX.Element {
  return (
    <div
      aria-hidden
      data-tab-ghost
      data-tab-incoming={incoming}
      className={`p-styled-font pointer-events-none fixed z-[1000] flex items-center gap-1.5 overflow-hidden px-2.5 text-[12px] ${
        active ? 'text-[var(--p-text)]' : 'text-[var(--p-dim)]'
      }`}
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
        background: lifted ? 'var(--p-tabs)' : undefined,
        // The place token (DESIGN.md `rounded.place`): lifted, it is a small
        // object of its own; on the row, flush like every tab.
        borderRadius: lifted ? 4 : 0,
        boxShadow: lifted ? '0 8px 24px rgba(0,0,0,.28), 0 0 0 1px var(--p-divider)' : 'none',
        // Immediate feedback: the lift reads in 120 ms, decelerating.
        transition: 'box-shadow 120ms cubic-bezier(.16,1,.3,1), border-radius 120ms cubic-bezier(.16,1,.3,1)'
      }}
    >
      {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-[var(--p-accent-hi)]" aria-hidden />}
      <TabKindIcon kind={kind} solid={active} />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  )
}
