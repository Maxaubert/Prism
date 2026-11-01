/**
 * HOVER A TAB TO SWITCH TO IT (#70 D12; owner approved the spec "as
 * recommended", 2026-11-01). A background tab held under a drag for 0.6 s
 * comes to the front, so the drop can land in its list rather than only in
 * the tab's current folder. In-app carry and Windows drags alike; never the
 * tab being torn (the strip passes null for it, and for the tab already in
 * front). Leaving the strip without a drop leaves the switched tab in front.
 * Folder rows do NOT spring open on hover: File Explorer's list does not.
 */
export const HOVER_SWITCH_MS = 600

export interface HoverSwitch {
  /** The drag is over this tab (null: over nothing that switches). */
  over: (id: string | null) => void
  /** Left the tab, dropped, or the drag ended. */
  clear: () => void
}

export function createHoverSwitch(pick: (id: string) => void, wait = HOVER_SWITCH_MS): HoverSwitch {
  let timer: ReturnType<typeof setTimeout> | null = null
  /** The tab the wait is for, kept after it fires so it fires once. */
  let armed: string | null = null
  const clear = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    armed = null
  }
  return {
    over: (id) => {
      if (id === armed) return
      clear()
      if (!id) return
      armed = id
      timer = setTimeout(() => {
        timer = null
        pick(id)
      }, wait)
    },
    clear
  }
}

/**
 * Whether a dragleave's point is still on the tab (#70 review, 2026-11-01).
 * The in-app carry sends dragleave with no relatedTarget whenever the element
 * under the pointer changes, so crossing the tab's icon, label or close button
 * read as leaving and restarted the 0.6 s wait. A leave with no point (0, 0,
 * as a drag that ended elsewhere sends) is a real one.
 */
export function stillInside(
  box: { left: number; top: number; right: number; bottom: number },
  x: number,
  y: number
): boolean {
  if (x === 0 && y === 0) return false
  return x >= box.left && x < box.right && y >= box.top && y < box.bottom
}
