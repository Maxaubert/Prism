/* eslint-disable react-hooks/refs -- the deck order is a ref written while deriving the deck, on purpose (see below); moved unchanged from App.tsx, which the compiler lint skipped. */
import { useMemo, useRef } from 'react'
import type { Tab } from '../lib/tabs/tabs'
import { deckOf } from '../lib/mediaDeck'

/* ------------------------------------------------------------------ *
 * Every tab holding media keeps its player, and the strip only decides
 * which one you can SEE (2026-08-27). Handing the sound to a second,
 * hidden element was audible - a pause and an unpause at every switch -
 * because nothing but the element itself surviving is seamless.
 *
 * The order is a ref rather than state on purpose: it is derived from the
 * tabs in the same pass that renders them, and it only ever appends, so
 * there is nothing for a re-render to settle.
 * Moved out of App.tsx unchanged (audit #8, 2026-11-21).
 * ------------------------------------------------------------------ */
export function useAppDeck(
  tabs: Tab[],
  activeId: string | null
): ReturnType<typeof deckOf>['entries'] {
  const deckOrder = useRef<string[]>([])
  return useMemo(() => {
    const next = deckOf(tabs, deckOrder.current, activeId)
    deckOrder.current = next.order
    return next.entries
  }, [tabs, activeId])
}
