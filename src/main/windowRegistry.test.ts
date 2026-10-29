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
