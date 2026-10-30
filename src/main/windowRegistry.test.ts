import { describe, expect, it } from 'vitest'
import { createWindowRegistry, type PageWindow } from './windowRegistry'

let nextId = 100
function fakeWindow(): PageWindow & {
  sent: Array<[string, unknown[]]>
  destroy(): void
  gone: boolean
} {
  const id = (nextId += 1)
  const w = {
    gone: false,
    sent: [] as Array<[string, unknown[]]>,
    isDestroyed: () => w.gone,
    destroy: () => {
      w.gone = true
    },
    webContents: {
      id,
      isDestroyed: () => w.gone,
      send: (channel: string, ...args: unknown[]) => {
        if (w.gone) throw new Error('Object has been destroyed')
        w.sent.push([channel, args])
      }
    }
  }
  return w
}
const strip = (...ids: string[]) => ({ tabs: ids.map((id) => ({ id, root: 'C:\\x' })), active: 0 })

describe('the window registry (tab tear-off step 1, 2026-10-29)', () => {
  it('knows a Prism page by its sender, and nothing else', () => {
    const r = createWindowRegistry()
    const a = fakeWindow()
    r.add(a, { first: true, seed: { kind: 'saved' } })
    expect(r.isPrismPage(a.webContents)).toBe(true)
    expect(r.windowOf(a.webContents)).toBe(a)
    expect(r.isPrismPage({ id: 1 })).toBe(false)
    expect(r.isPrismPage(null)).toBe(false)
    a.destroy()
    expect(r.isPrismPage(a.webContents)).toBe(false)
  })

  it('gives each window its own key, flags and unsaved flag', () => {
    const r = createWindowRegistry()
    const a = r.add(fakeWindow(), { first: true, launchFlags: ['--prism-setup'] })
    const b = r.add(fakeWindow())
    expect(a.key).not.toBe(b.key)
    expect(a.first && !b.first).toBe(true)
    expect(b.launchFlags).toEqual([]) // a new window never inherits --prism-setup / --prism-demo
    b.dirty = true
    expect(a.dirty).toBe(false)
    expect(r.anyDirty()).toBe(true)
    expect(b.seed).toEqual({ kind: 'none' }) // only the first window reads the saved strip
  })

  it('sends to one window, to all, and never throws at a page that has gone', () => {
    const r = createWindowRegistry()
    const a = fakeWindow()
    const b = fakeWindow()
    r.add(a)
    r.add(b)
    expect(r.sendToAll('x:y', 1)).toBe(2)
    b.destroy()
    expect(r.sendTo(b, 'x:y')).toBe(false)
    expect(r.sendToAll('x:z')).toBe(1)
    expect(a.sent.map(([c]) => c)).toEqual(['x:y', 'x:z'])
  })

  it('routes a tab push to the window that asked for the tab, then to the one that reported it, else to all', () => {
    const r = createWindowRegistry()
    const a = fakeWindow()
    const b = fakeWindow()
    r.add(a)
    const rb = r.add(b)
    r.noteTabOwner('t1', b.webContents)
    r.sendToTabOwner('t1', 'browse:details', 1)
    expect(a.sent).toEqual([])
    expect(b.sent).toHaveLength(1)
    rb.reported = strip('t2')
    r.sendToTabOwner('t2', 'browse:details', 2)
    expect(b.sent).toHaveLength(2)
    r.sendToTabOwner('unknown', 'browse:details', 3)
    expect(a.sent).toHaveLength(1)
    expect(b.sent).toHaveLength(3)
  })

  it('files from outside go to the window focused last, else the oldest', () => {
    const r = createWindowRegistry()
    const a = fakeWindow()
    const b = fakeWindow()
    r.add(a)
    r.add(b)
    expect(r.target()?.win).toBe(a) // nothing focused (the e2e): the oldest
    r.focused(b)
    expect(r.target()?.win).toBe(b)
    r.focused(a)
    expect(r.target()?.win).toBe(a)
    a.destroy()
    expect(r.target()?.win).toBe(b)
  })

  it('a raise under a carried tab moves a window up the front order, never the focus order', () => {
    const r = createWindowRegistry()
    const a = fakeWindow()
    const b = fakeWindow()
    const ra = r.add(a)
    const rb = r.add(b)
    r.focused(a)
    r.raised(b)
    // Files from outside still go to the window focused last...
    expect(r.target()?.win).toBe(a)
    // ...while the tear sees the raised one in front.
    expect(rb.frontAt).toBeGreaterThan(ra.frontAt)
    r.focused(a)
    expect(ra.frontAt).toBeGreaterThan(rb.frontAt)
  })

  it("a window's close answers its tabs to release, except one mid-move", () => {
    const r = createWindowRegistry()
    const a = fakeWindow()
    const ra = r.add(a)
    ra.reported = strip('t1', 't2')
    r.noteTabOwner('t3', a.webContents)
    r.markMoving('t2')
    expect(r.remove(a).sort()).toEqual(['t1', 't3'])
    expect(r.count()).toBe(0)
  })

  it('a tab closed for good leaves the owner map, and is not released again with its window', () => {
    const r = createWindowRegistry()
    const a = fakeWindow()
    r.add(a)
    r.noteTabOwner('t1', a.webContents)
    r.noteTabOwner('t2', a.webContents)
    r.forgetTab('t1')
    expect(r.remove(a)).toEqual(['t2'])
  })

  it('a crash rebuild hands the tabs over and releases nothing', () => {
    const r = createWindowRegistry()
    const a = fakeWindow()
    const b = fakeWindow()
    const ra = r.add(a, { first: true })
    ra.reported = strip('t1')
    r.noteTabOwner('t1', a.webContents)
    r.add(b, { first: true, seed: { kind: 'tabs', tabs: strip('t1') } })
    r.handOver(a, b)
    expect(r.remove(a)).toEqual([])
    expect(r.ownerOf('t1')?.win).toBe(b)
  })
})

describe('the tear-off spare (step 3, 2026-10-29)', () => {
  it('is not a window of the session: not counted, never the target or the oldest', () => {
    const r = createWindowRegistry()
    const spare = r.add(fakeWindow(), { spare: true, seed: { kind: 'adopt' } })
    expect(r.count()).toBe(0)
    expect(r.target()).toBeUndefined()
    expect(r.oldest()).toBeUndefined()
    const a = r.add(fakeWindow(), { first: true })
    expect(r.count()).toBe(1)
    expect(r.target()).toBe(a)
    expect(r.oldest()).toBe(a)
    expect(r.spare()).toBe(spare)
    // Pushes still reach it: its page keeps the theme and the preferences.
    expect(r.all()).toContain(spare)
    expect(r.sendToAll('x:y')).toBe(2)
  })

  it('owns a tab only while that tab flies, and its close releases nothing', () => {
    const r = createWindowRegistry()
    const a = r.add(fakeWindow(), { first: true })
    a.reported = strip('t1', 't2')
    const s = r.add(fakeWindow(), { spare: true })
    r.noteTabOwner('t2', a.win.webContents)
    // A late request from a floating window the tab has left: ignored.
    r.noteTabOwner('t2', s.win.webContents)
    expect(r.ownerOf('t2')).toBe(a)
    r.markMoving('t2')
    r.noteTabOwner('t2', s.win.webContents)
    expect(r.ownerOf('t2')).toBe(s)
    expect(r.remove(s.win)).toEqual([])
  })

  it('becomes an ordinary window when the drop makes it one', () => {
    const r = createWindowRegistry()
    r.add(fakeWindow(), { first: true })
    const s = r.add(fakeWindow(), { spare: true })
    r.markMoving('t2')
    r.noteTabOwner('t2', s.win.webContents)
    s.spare = false
    r.unmarkMoving('t2')
    expect(r.count()).toBe(2)
    expect(r.spare()).toBeUndefined()
    // Its close now releases the tab it holds, like any window's.
    expect(r.remove(s.win)).toEqual(['t2'])
  })

  it('the drop takes the tab out of the source at once: its close releases it no more', () => {
    const r = createWindowRegistry()
    const a = r.add(fakeWindow(), { first: true })
    a.reported = { tabs: strip('t1', 't2', 't3').tabs, active: 2 }
    r.noteTabOwner('t2', a.win.webContents)
    const s = r.add(fakeWindow(), { spare: true })
    r.markMoving('t2')
    r.noteTabOwner('t2', s.win.webContents)
    s.spare = false
    s.reported = strip('t2')
    expect(r.handTab('t2', a.win, s.win)?.tabs.map((t) => t.id)).toEqual(['t1', 't3'])
    r.unmarkMoving('t2')
    // The tab in front stays the one in front.
    expect(a.reported).toMatchObject({ active: 1 })
    expect(r.ownerOf('t2')).toBe(s)
    // Before the source's page has reported its own strip again.
    expect(r.remove(a.win)).toEqual(['t1', 't3'])
    // A strip that never listed it is left alone.
    expect(r.handTab('t9', s.win, s.win)).toBeNull()
  })
})
