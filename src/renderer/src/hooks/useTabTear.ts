import { useCallback, useEffect, useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { OpenPayload } from '@shared/types'
import type { Point, Rect, Size, TearEnd } from '@shared/tabTear'
import { closeTab, newTab, type TabState } from '../lib/tabs/tabs'
import { applyCarry, buffersLeaving, carryOf, ownedBufferKeys } from '../lib/tabs/tabCarry'
import { forgetTabVolume, setTabRate, setTabVolume, tabRate, tabVolume } from '../lib/tabs/tabVolume'
import { markOf, rememberPaused, rememberTime } from '../lib/playState'
import { rememberDocPos, sessionDocPos } from '../lib/docPosition'
import { archivePasswordsUnder, rememberArchivePassword } from '../lib/archivePass'
import { visitedDirectories } from '../lib/visitedDirectories'

/**
 * TAB TEAR-OFF, THE PAGE'S HALF (step 3, owner, 2026-10-29; spec
 * docs/superpowers/specs/2026-10-29-tab-tearoff-design.md section 1). The strip
 * (TabStrip.tsx) runs the gesture; this is what it does to the tabs.
 *
 * In the SOURCE window:
 * - `out`: the carried tab has left the strip. Its state is packed
 *   (lib/tabs/tabCarry.ts) and handed to main, which shows it in a floating
 *   window; the tab stays in this strip's state, hidden, until the drop, and
 *   if it was in front a neighbour takes the front. The window's ONLY tab
 *   moves the whole window instead (spec 1.7).
 * - `attached`: main snapped it back over this strip: it is in front again.
 * - `end`: a drop the new window took: the tab leaves, WITHOUT a
 *   `browseRelease` (its grants, watch and listings in main are the new
 *   window's now), taking its unsaved text with it. A cancel, or a drop main
 *   did not take: everything as it was, the front as before.
 *
 * In the FLOATING window (the spare): `tabs:adopt` rebuilds the tab under its
 * SAME id with what it carried, and says where it drew it; `tabs:release`
 * gives it back (a snap back or a cancel), and the window is empty again.
 *
 * In ANY OTHER WINDOW (step 4, owner 2026-10-29): `tabs:merge` is a tab
 * dropped into this strip from another window. It is rebuilt the same way,
 * under its same id, at the slot the strip had open for it, selected; it is
 * not this window's home (this window has its own). The only tab of a window
 * merges the same way: its source page lets it go (`end`, committed) and main
 * closes the emptied window.
 */

export interface StripTear {
  /** The carried tab left its strip. Answers how it goes on: 'float' (a
   *  window of its own follows the cursor), 'window' (this window follows: it
   *  is the only tab), or null (it cannot leave: Settings). `refused` is
   *  called if main turns the tear down after all. */
  out(
    id: string,
    at: { grab: Point; origin: Point; strip: Rect; point: Point; size: Size; label: string },
    refused: () => void
  ): 'float' | 'window' | null
  /** Main attached it to this strip again (the snap back). */
  attached(id: string): void
  /** The gesture ended after a tear: answers whether a drop committed. */
  end(id: string, how: TearEnd): Promise<boolean>
  /** It came back and was dropped in this strip: selected, and done. */
  settled(id: string): void
}

export interface TabTearDeps {
  tabStateNow: RefObject<TabState>
  setTabState: Dispatch<SetStateAction<TabState>>
  buffers: RefObject<Map<string, { path: string; text: string }>>
  bufferOwners: RefObject<Map<string, Set<string>>>
  syncDirty: () => void
  open: (p: OpenPayload) => void
}

export function useTabTear({ tabStateNow, setTabState, buffers, bufferOwners, syncDirty, open }: TabTearDeps): StripTear {
  /** The tab being carried, and what was in front before it left. */
  const session = useRef<{ id: string; prevActive: string | null } | null>(null)

  const front = useCallback((id: string | null) => {
    if (!id) return
    setTabState((s) => (s.tabs.some((t) => t.id === id) ? { ...s, activeId: id } : s))
  }, [setTabState])

  /** The drop committed: the tab is the new window's now. */
  const detach = useCallback(
    (id: string) => {
      const s = tabStateNow.current
      const tab = s.tabs.find((t) => t.id === id)
      if (tab) {
        const staying = s.tabs.filter((t) => t.id !== id)
        for (const k of buffersLeaving(tab, staying, buffers.current, bufferOwners.current)) buffers.current.delete(k)
      }
      bufferOwners.current.delete(id)
      // This page's copy of its level only: the new window has its own.
      forgetTabVolume(id)
      syncDirty()
      // NOT forceCloseTab: that releases the tab in main.
      setTabState((st) => closeTab(st.tabs, id, st.activeId))
    },
    [tabStateNow, buffers, bufferOwners, syncDirty, setTabState]
  )

  const out = useCallback<StripTear['out']>(
    (id, at, refused) => {
      const s = tabStateNow.current
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab || tab.kind === 'settings') return null
      if (session.current?.id !== id) session.current = { id, prevActive: s.activeId }
      const ask = (only: boolean, carry?: ReturnType<typeof carryOf>): void =>
        void window.prism
          .tabTear({ tabId: id, only, ...(carry ? { carry } : {}), ...at })
          .then((ok) => {
            if (!ok) refused()
          }, refused)
      const only = s.tabs.length === 1
      const carry = carryOf(tab, {
        buffers: buffers.current,
        owners: bufferOwners.current,
        level: tabVolume,
        rate: tabRate,
        mediaKey: window.prism.mediaUrl,
        mark: markOf,
        docPos: sessionDocPos,
        passwords: archivePasswordsUnder,
        // The only tab's drag mostly just moves its window: it carries no
        // folder listing (a large folder's would be cloned at the start of
        // every such drag and held by main all through it; review
        // 2026-10-30). Merged into another window, that window lists it.
        listing: (p) => {
          if (only) return null
          const d = visitedDirectories.peek(p)
          return d ? { path: d.path, listing: d.listing } : null
        }
      })
      // The only tab moves its window; it carries itself too, since it can
      // merge into another window's strip (step 4).
      if (only) {
        ask(true, carry)
        return 'window'
      }
      // The tab leaves the strip at once: a neighbour takes the front (its
      // right, else its left), so this window never shows a second copy.
      if (s.activeId === id) {
        const i = s.tabs.findIndex((t) => t.id === id)
        front((s.tabs[i + 1] ?? s.tabs[i - 1])?.id ?? null)
      }
      ask(false, carry)
      return 'float'
    },
    [tabStateNow, buffers, bufferOwners, front]
  )

  const attached = useCallback((id: string) => front(id), [front])

  const end = useCallback<StripTear['end']>(
    async (id, how) => {
      const answer = await window.prism.tabTearEnd(how).catch(() => ({ committed: false }))
      const was = session.current
      session.current = null
      if (how === 'drop' && answer.committed) {
        detach(id)
        return true
      }
      // Nothing half-done: back where it was, the front as before.
      front(was?.prevActive ?? null)
      return false
    },
    [detach, front]
  )

  const settled = useCallback(
    (id: string) => {
      session.current = null
      front(id)
    },
    [front]
  )

  // THE FLOATING WINDOW'S SIDE: take the tab, with what it carried, under its
  // own id, then say where the strip drew it (main holds the window by that).
  useEffect(
    () =>
      window.prism.onTabAdopt((carry) => {
        const id = carry.tab.id
        const payload = applyCarry(carry, {
          setLevel: setTabVolume,
          setRate: setTabRate,
          rememberTime,
          rememberPaused,
          rememberDocPos,
          rememberPassword: rememberArchivePassword
        })
        const keys = carry.buffers.map((b) => b.path.toLowerCase())
        for (const b of carry.buffers) buffers.current.set(b.path.toLowerCase(), { path: b.path, text: b.text })
        if (keys.length) bufferOwners.current.set(id, new Set(keys))
        syncDirty()
        open(payload)
        // A hidden window draws no frames, so no requestAnimationFrame: look
        // for the tab until React has put it in the strip.
        let tries = 0
        const look = (): void => {
          const el = document.querySelector(`[data-tab-id="${CSS.escape(id)}"]`)
          if (el || (tries += 1) > 30) {
            const r = el?.getBoundingClientRect()
            window.prism.tabAdopted(id, r ? { x: r.left, y: r.top } : null)
          } else window.setTimeout(look, 16)
        }
        window.setTimeout(look, 0)
      }),
    [buffers, bufferOwners, syncDirty, open]
  )
  // ANOTHER WINDOW'S TAB DROPPED INTO THIS STRIP (step 4): the same tab, by
  // its same id, at the slot the strip had open, in front. Not the home: this
  // window has its own (`ensurePinnedExplorer` keeps one).
  useEffect(
    () =>
      window.prism.onTabMerge(({ carry, at }) => {
        const id = carry.tab.id
        const payload = applyCarry(carry, {
          setLevel: setTabVolume,
          setRate: setTabRate,
          rememberTime,
          rememberPaused,
          rememberDocPos,
          rememberPassword: rememberArchivePassword
        })
        const keys = carry.buffers.map((b) => b.path.toLowerCase())
        for (const b of carry.buffers) buffers.current.set(b.path.toLowerCase(), { path: b.path, text: b.text })
        if (keys.length) bufferOwners.current.set(id, new Set(keys))
        syncDirty()
        if (payload.listing) visitedDirectories.remember(payload.listing)
        const tab = newTab({ ...payload, pinned: false }, id)
        setTabState((st) => {
          const rest = st.tabs.filter((t) => t.id !== id)
          const i = Math.max(0, Math.min(at ?? rest.length, rest.length))
          return { tabs: [...rest.slice(0, i), tab, ...rest.slice(i)], activeId: id }
        })
      }),
    [buffers, bufferOwners, syncDirty, setTabState]
  )
  useEffect(
    () =>
      window.prism.onTabRelease((id) => {
        const s = tabStateNow.current
        const tab = s.tabs.find((t) => t.id === id)
        if (tab) for (const k of ownedBufferKeys(tab, buffers.current, bufferOwners.current)) buffers.current.delete(k)
        bufferOwners.current.delete(id)
        forgetTabVolume(id)
        syncDirty()
        // Out of the strip, nothing released (it is the source's tab) and no
        // window closed: an empty spare is what this window is again.
        setTabState((st) => ({
          tabs: st.tabs.filter((t) => t.id !== id),
          activeId: st.activeId === id ? null : st.activeId
        }))
      }),
    [tabStateNow, buffers, bufferOwners, syncDirty, setTabState]
  )

  return useMemo(() => ({ out, attached, end, settled }), [out, attached, end, settled])
}
