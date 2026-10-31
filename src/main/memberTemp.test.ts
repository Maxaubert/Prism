import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemberTemp, cleanDeadRuns } from './memberTemp'

let box: string
let temp: MemberTemp
let container: string
beforeEach(() => {
  box = mkdtempSync(join(tmpdir(), 'prism-memtemp-'))
  temp = new MemberTemp(join(box, 'prism-members'), 42, 7)
  container = join(box, 'c.zip')
  writeFileSync(container, 'zip bytes')
})
afterEach(() => temp.removeRun())

const writer =
  (text: string, calls: { n: number }) =>
  async (dir: string): Promise<{ ok: true; path: string }> => {
    calls.n += 1
    const p = join(dir, 'a.txt')
    writeFileSync(p, text)
    return { ok: true, path: p }
  }

describe('the member temp folder (#300)', () => {
  it('puts one member under the run folder, by its own name, and reuses it', async () => {
    const calls = { n: 0 }
    const one = await temp.ensure(container, 'docs/a.txt', writer('x', calls))
    expect(one.ok).toBe(true)
    if (!one.ok) return
    expect(one.path.startsWith(temp.dir)).toBe(true)
    expect(one.path.endsWith('a.txt')).toBe(true)
    expect(temp.owns(one.path)).toBe(true)
    const two = await temp.ensure(container, 'docs/a.txt', writer('x', calls))
    expect(two.ok && two.path).toBe(one.path)
    expect(calls.n).toBe(1)
  })

  it('asks at once share one unpack, and a file gone from disk is unpacked again', async () => {
    const calls = { n: 0 }
    const [x, y] = await Promise.all([
      temp.ensure(container, 'docs/a.txt', writer('x', calls)),
      temp.ensure(container, 'docs/a.txt', writer('x', calls))
    ])
    expect(calls.n).toBe(1)
    expect(x.ok && y.ok && x.path === y.path).toBe(true)
    if (!x.ok) return
    rmSync(x.path)
    const again = await temp.ensure(container, 'docs/a.txt', writer('x', calls))
    expect(again.ok && existsSync(again.path)).toBe(true)
    expect(calls.n).toBe(2)
  })

  it('two members of one name never collide', async () => {
    const a = await temp.ensure(container, 'one/a.txt', writer('1', { n: 0 }))
    const b = await temp.ensure(container, 'two/a.txt', writer('2', { n: 0 }))
    expect(a.ok && b.ok && a.path !== b.path).toBe(true)
  })

  it('refuses a file written outside its folder, and says why it failed', async () => {
    const outside = join(box, 'escaped.txt')
    const r = await temp.ensure(container, 'x', async () => {
      writeFileSync(outside, 'nope')
      return { ok: true, path: outside }
    })
    expect(r.ok).toBe(false)
    const said = await temp.ensure(container, 'y', async () => ({ ok: false, reason: 'password' as const }))
    expect(said).toEqual({ ok: false, reason: 'password' })
  })

  it('the cap evicts the least recently viewed and never one that is held', async () => {
    const big = async (dir: string): Promise<{ ok: true; path: string }> => {
      const p = join(dir, 'f.bin')
      writeFileSync(p, Buffer.alloc(1000))
      return { ok: true, path: p }
    }
    const a = await temp.ensure(container, 'a', big)
    const b = await temp.ensure(container, 'b', big)
    const c = await temp.ensure(container, 'c', big)
    if (!a.ok || !b.ok || !c.ok) throw new Error('unpack')
    temp.touch(a.path)
    const gone = await temp.evict((f) => f === b.path, 2000)
    expect(gone).toEqual([c.path])
    expect(existsSync(a.path) && existsSync(b.path)).toBe(true)
  })

  it('a file a drag out carries is never evicted until its pin runs out (#103)', async () => {
    const big = async (dir: string): Promise<{ ok: true; path: string }> => {
      const p = join(dir, 'f.bin')
      writeFileSync(p, Buffer.alloc(1000))
      return { ok: true, path: p }
    }
    const a = await temp.ensure(container, 'a', big)
    const b = await temp.ensure(container, 'b', big)
    if (!a.ok || !b.ok) throw new Error('unpack')
    temp.touch(b.path)
    temp.pin([a.path], Infinity)
    expect(await temp.evict(() => false, 1000)).toEqual([b.path])
    expect(existsSync(a.path)).toBe(true)
    // Pinned for 60 s after the drag: past that it follows the normal eviction.
    temp.pin([a.path], Date.now() + 60_000)
    expect(temp.pinned(a.path)).toBe(true)
    expect(temp.pinned(a.path, Date.now() + 61_000)).toBe(false)
    temp.pin([a.path], Date.now() - 1)
    expect(await temp.evict(() => false, 0)).toEqual([a.path])
  })

  it('pins only its own copies, and drops pins that ran out (#103: the map stays small)', async () => {
    const a = await temp.ensure(container, 'a', writer('x', { n: 0 }))
    if (!a.ok) throw new Error('unpack')
    // A drag of the user's own files pins nothing here.
    temp.pin([join(box, 'mine.txt'), 'C:\\Users\\x\\photo.jpg'], Infinity)
    expect(temp.pinCount()).toBe(0)
    temp.pin([a.path], 1000, 0)
    expect(temp.pinCount()).toBe(1)
    // Any later pin sweeps the ones that ran out.
    temp.pin([], Infinity, 2000)
    expect(temp.pinCount()).toBe(0)
  })

  it('a folder member is counted at its listed size, and evicted whole (#103)', async () => {
    const folder = async (dir: string): Promise<{ ok: true; path: string }> => {
      const p = join(dir, 'docs')
      mkdirSync(join(p, 'inner'), { recursive: true })
      writeFileSync(join(p, 'inner', 'f.txt'), 'x')
      return { ok: true, path: p }
    }
    const d = await temp.ensure(container, 'docs/', folder, 5000)
    if (!d.ok) throw new Error('unpack')
    expect(d.path.startsWith(temp.dir)).toBe(true)
    expect(temp.bytes()).toBe(5000)
    // Asked again for the same state of the zip, it is reused: no new folder.
    const again = await temp.ensure(container, 'docs/', folder, 5000)
    expect(again.ok && again.path).toBe(d.path)
    expect(await temp.evict(() => false, 1000)).toEqual([d.path])
    expect(existsSync(d.path)).toBe(false)
  })

  it('startup removes dead runs only, and the quit removes this one', async () => {
    const root = join(box, 'prism-members')
    mkdirSync(join(root, '111-1'), { recursive: true })
    mkdirSync(join(root, '222-1'), { recursive: true })
    await temp.ensure(container, 'a', writer('x', { n: 0 }))
    const removed = await cleanDeadRuns(root, (pid) => pid === 222, temp.dir)
    expect(removed).toEqual([join(root, '111-1')])
    expect(existsSync(join(root, '222-1'))).toBe(true)
    expect(existsSync(temp.dir)).toBe(true)
    temp.removeRun()
    expect(existsSync(temp.dir)).toBe(false)
  })
})
