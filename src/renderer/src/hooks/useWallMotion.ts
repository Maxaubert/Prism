import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import {
  CARD_IN_MS,
  CARD_OUT_MS,
  CARD_RISE,
  rowOf,
  staggerDelay,
  WALL_CLOSE_MS,
  WALL_EASE,
  WALL_OPEN_MS
} from '../lib/themes/wall'

/**
 * SHOW ALL / SHOW FEWER, BOTH WAYS ANIMATED (owner, 2026-10-06; ported from
 * the approved mockup). Opening, the wall's height eases from collapsed to
 * full while the row that was in view slides to its place (FLIP) and every
 * other card fades in and rises, nearest rows first. Closing is a little
 * faster: the other rows fade out while the chosen row slides to the top and
 * the height shuts. A second press mid-way starts from where the wall IS,
 * never from a jump. `overflow: hidden` only while moving (`data-moving`), so
 * nothing is clipped at rest. Reduced motion: the layout simply changes.
 *
 * END STATES ARE EXACT: when it finishes no animation is left running and no
 * inline height, transform or opacity is left on the wall or a card; the
 * layout is React's again (`layout`).
 *
 * The cards are found by `[data-theme-card]`; a hidden one carries `data-hid`.
 * `layout(open)` must lay the wall out synchronously (a `flushSync`).
 */
export function useWallMotion(
  wallRef: RefObject<HTMLElement | null>,
  layout: (open: boolean) => void
): {
  run: (open: boolean, keptRow: number, cols: number) => void
  busy: () => boolean
} {
  const state = useRef<{ done: (() => void) | null; target: boolean }>({ done: null, target: false })
  const layoutRef = useRef(layout)
  useLayoutEffect(() => {
    layoutRef.current = layout
  })

  const settle = (): void => {
    state.current.done?.()
  }

  // A wall taken away mid-way leaves nothing running.
  useEffect(() => () => settle(), [])

  const run = useCallback(
    (open: boolean, keptRow: number, cols: number) => {
      const w = wallRef.current
      const layout = layoutRef.current
      if (!w) {
        state.current.target = open
        layout(open)
        return
      }
      // Where the wall is NOW, mid-animation included.
      const h0 = w.getBoundingClientRect().height
      const tiles = [...w.querySelectorAll<HTMLElement>('[data-theme-card]')]
      const tops = new Map(tiles.map((c) => [c, c.getBoundingClientRect().top]))
      const closing = state.current.done !== null && !state.current.target
      const shown = new Set(
        tiles.filter((c) => !c.hasAttribute('data-hid') && !(closing && !c.hasAttribute('data-keep')))
      )
      settle()
      state.current.target = open
      if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
        layout(open)
        return
      }
      const anims: Animation[] = []
      w.setAttribute('data-moving', '')
      const finish = (): void => {
        if (state.current.done !== finish) return
        state.current.done = null
        for (const a of anims) a.cancel()
        w.removeAttribute('data-moving')
        for (const c of tiles) c.removeAttribute('data-keep')
        layout(state.current.target)
      }
      state.current.done = finish
      if (open) {
        layout(true)
        const h1 = w.getBoundingClientRect().height
        anims.push(w.animate({ height: [`${h0}px`, `${h1}px`] }, { duration: WALL_OPEN_MS, easing: WALL_EASE }))
        tiles.forEach((c, i) => {
          if (shown.has(c)) {
            c.setAttribute('data-keep', '')
            const dy = (tops.get(c) ?? 0) - c.getBoundingClientRect().top
            if (Math.abs(dy) > 0.5)
              anims.push(c.animate({ transform: [`translateY(${dy}px)`, 'none'] }, { duration: WALL_OPEN_MS, easing: WALL_EASE }))
          } else {
            anims.push(
              c.animate(
                { opacity: [0, 1], transform: [`translateY(-${CARD_RISE}px)`, 'none'] },
                { duration: CARD_IN_MS, delay: staggerDelay(rowOf(i, cols), keptRow), easing: WALL_EASE, fill: 'backwards' }
              )
            )
          }
        })
      } else {
        const kept = tiles.filter((_, i) => rowOf(i, cols) === keptRow)
        if (!kept.length) {
          finish()
          return
        }
        const cs = getComputedStyle(w)
        const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
        const h1 = kept[0].offsetHeight + pad
        const dy = kept[0].offsetTop - tiles[0].offsetTop
        anims.push(w.animate({ height: [`${h0}px`, `${h1}px`] }, { duration: WALL_CLOSE_MS, easing: WALL_EASE, fill: 'forwards' }))
        tiles.forEach((c, i) => {
          if (rowOf(i, cols) === keptRow) {
            c.setAttribute('data-keep', '')
            if (dy)
              anims.push(
                c.animate({ transform: ['none', `translateY(${-dy}px)`] }, { duration: WALL_CLOSE_MS, easing: WALL_EASE, fill: 'forwards' })
              )
          } else {
            anims.push(c.animate({ opacity: [1, 0] }, { duration: CARD_OUT_MS, easing: 'ease-out', fill: 'forwards' }))
          }
        })
      }
      Promise.all(anims.map((a) => a.finished)).then(finish, () => {})
    },
    [wallRef]
  )

  const busy = useCallback(() => state.current.done !== null, [])
  return { run, busy }
}
