import { useCallback, useEffect, useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { OpenPayload } from '@shared/types'
import type { Point, Rect, Size, TabLook, TearEnd } from '@shared/tabTear'
import { closeTab, newTab, type Tab, type TabState } from '../lib/tabs/tabs'
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
 * - `out`: the carried tab has left the strip, and main carries it: only the
 *   tab (the ghost, owner 2026-10-30) follows the cursor, the window's ONLY
 *   tab too (owner, 2026-10-30: "it should be the tab you drag"). The tab
 *   stays in this strip's state, IN FRONT IF IT WAS, its page on screen, all
 *   through the drag (owner, 2026-10-30: "i want those switches to happen
 *   when you drop it"); only its slot in the strip is empty.
 * - `end`: a drop is sent with the tab packed NOW (lib/tabs/tabCarry.ts): it
 *   stayed live here, so a film went on playing, and that is what the other
 *   window takes. A drop another window took: the tab leaves, WITHOUT a
 *   `browseRelease` (its grants, watch and listings in main are that
 *   window's now), taking its unsaved text with it, and only THEN does a
 *   neighbour take the front (its right, else its left). A cancel, a snap
 *   back, a drop main did not take, or the only tab's window moved: nothing
 *   changes, the front included.
 *
 * In the FLOATING window (the spare): `tabs:adopt` (at the drop) rebuilds the
 * tab under its SAME id with what it carried, and says where it drew it;
 * `tabs:release` gives it back (a drop whose window failed), and the window is
 * empty again.
 *
 * In ANY OTHER WINDOW (step 4, owner 2026-10-29): `tabs:merge` is a tab
 * dropped into this strip from another window. It is rebuilt the same way,
 * under its same id, at the slot the strip had open for it, selected; it is
 * not this window's home (this window has its own). The only tab of a window
 * merges the same way: its source page lets it go (`end`, committed) and main
 * closes the emptied window.
 */

export interface StripTear {
  /** The carried tab left its strip. Answers true (main carries it from
   *  here) or false (it cannot leave: Settings). `refused` is called if main
   *  turns the tear down after all. */
  out(
    id: string,
    at: { grab: Point; origin: Point; strip: Rect; point: Point; size: Size; label: string; look?: TabLook },
    refused: () => void
  ): boolean
  /** The gesture ended after a tear: answers whether a drop committed. */
  end(id: string, how: TearEnd): Promise<boolean>
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
  /** The drop committed: the tab is another window's now, and only now does
   *  a neighbour take the front (`closeTab`: its right, else its left). */
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

  /** The tab and its state as they are now. `listing`: the folder on screen
   *  goes too, for the other window's first frame; never the only tab's (a
   *  large folder's listing was cloned at every such drag, review 2026-10-30:
   *  merged, the other window lists it itself). */
  const pack = useCallback(
    (tab: Tab, listing: boolean) =>
      carryOf(tab, {
        buffers: buffers.current,
        owners: bufferOwners.current,
        level: tabVolume,
        rate: tabRate,
        mediaKey: window.prism.mediaUrl,
        mark: markOf,
        docPos: sessionDocPos,
        passwords: archivePasswordsUnder,
        listing: (p) => {
          if (!listing) return null
          const d = visitedDirectories.peek(p)
          return d ? { path: d.path, listing: d.listing } : null
        }
      }),
    [buffers, bufferOwners]
  )

  const out = useCallback<StripTear['out']>(
    (id, at, refused) => {
      const s = tabStateNow.current
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab || tab.kind === 'settings') return false
      const only = s.tabs.length === 1
      // What the tear sends is light (no listing): the drop sends the tab as
      // it is then, and that is what goes.
      void window.prism.tabTear({ tabId: id, only, carry: pack(tab, false), ...at }).then((ok) => {
        if (!ok) refused()
      }, refused)
      // NOTHING ELSE CHANGES HERE (owner, 2026-10-30): the tab stays in front
      // if it was, until a drop commits.
      return true
    },
    [tabStateNow, pack]
  )

  const end = useCallback<StripTear['end']>(
    async (id, how) => {
      const s = tabStateNow.current
      const tab = how === 'drop' ? s.tabs.find((t) => t.id === id) : undefined
      const carry = tab && tab.kind !== 'settings' ? pack(tab, s.tabs.length > 1) : undefined
      const answer = await window.prism.tabTearEnd(how, carry).catch(() => ({ committed: false }))
      if (how === 'drop' && answer.committed) {
        detach(id)
        return true
      }
      // Nothing half-done, and nothing to put back: nothing changed.
      return false
    },
    [tabStateNow, pack, detach]
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

  return useMemo(() => ({ out, end }), [out, end])
}
