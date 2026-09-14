import { EventEmitter } from 'events'
import { describe, expect, it } from 'vitest'
import { Holders, under } from './holders'

/** A child that dies a tick after kill(), the way a real process does. */
function fakeChild(): EventEmitter & { kill: () => boolean; killed: boolean } {
  const c = new EventEmitter() as EventEmitter & { kill: () => boolean; killed: boolean }
  c.killed = false
  c.kill = () => {
    c.killed = true
    setImmediate(() => c.emit('close', null, 'SIGTERM'))
    return true
  }
  return c
}

describe('under', () => {
  it('matches the path itself and anything inside it, case-insensitively', () => {
    expect(under('C:\\Films\\a.mkv', 'c:\\films\\A.MKV')).toBe(true)
    expect(under('C:\\Films\\sub\\a.mkv', 'C:\\Films')).toBe(true)
    expect(under('C:\\Films2\\a.mkv', 'C:\\Films')).toBe(false)
  })
})

describe('Holders', () => {
  it('kills the children reading the files being moved, waits for them, and leaves the rest', async () => {
    const h = new Holders()
    const a = fakeChild()
    const b = fakeChild()
    const c = fakeChild()
    h.add(a, 'C:\\Films\\film.mkv')
    h.add(b, 'C:\\Films\\film.mkv')
    h.add(c, 'C:\\Films\\other.mkv')
    expect(h.count(['C:\\Films\\film.mkv'])).toBe(2)
    expect(await h.release(['C:\\Films\\film.mkv'])).toBe(2)
    expect(a.killed && b.killed).toBe(true)
    expect(c.killed).toBe(false)
    expect(h.count(['C:\\Films'])).toBe(1)
    // A folder being moved takes everything under it.
    expect(await h.release(['C:\\Films'])).toBe(1)
    expect(c.killed).toBe(true)
  })

  it('forgets a child that closed on its own, and does not wait past the bound', async () => {
    const h = new Holders()
    const gone = fakeChild()
    h.add(gone, 'C:\\a.mkv')
    gone.emit('close', 0, null)
    expect(h.count(['C:\\a.mkv'])).toBe(0)
    const stuck = new EventEmitter() as EventEmitter & { kill: () => boolean }
    stuck.kill = () => true // never closes
    h.add(stuck, 'C:\\b.mkv')
    const t0 = Date.now()
    expect(await h.release(['C:\\b.mkv'], 100)).toBe(1)
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})
