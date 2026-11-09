import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { copyCounted, dropPartial, isAborted } from './copyCounted'
import { moveEntries } from './moveOps'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prism-copycounted-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('a stoppable copy (the loading bar, owner 2026-11-09)', () => {
  it('Cancel stops a big file at once; the partial is removed', async () => {
    const src = join(dir, 'big.bin')
    writeFileSync(src, Buffer.alloc(40 * 1024 * 1024, 3))
    const out = join(dir, 'copy.bin')
    const stop = new AbortController()
    let ticks = 0
    const copying = copyCounted(src, out, () => {
      ticks += 1
      if (ticks === 2) stop.abort()
    }, { signal: stop.signal })
    await expect(copying).rejects.toSatisfy((e) => isAborted(e, stop.signal))
    expect(ticks).toBeLessThan(600) // far short of the whole file's chunks
    await dropPartial(out)
    expect(existsSync(out)).toBe(false)
  })

  it('a copy that finishes writes the whole file and keeps the times when asked', async () => {
    const src = join(dir, 'a.txt')
    writeFileSync(src, 'hello')
    utimesSync(src, new Date(1000000), new Date(2000000))
    const out = join(dir, 'b.txt')
    let bytes = 0
    await copyCounted(src, out, (n) => (bytes += n), { keep: true })
    expect(readFileSync(out, 'utf8')).toBe('hello')
    expect(bytes).toBe(5)
    expect(Math.abs(statSync(out).mtimeMs - statSync(src).mtimeMs)).toBeLessThan(2000)
  })

  it('a move across items stops between them and reports what really moved', async () => {
    const from = join(dir, 'from')
    const to = join(dir, 'to')
    mkdirSync(from)
    mkdirSync(to)
    for (const n of ['1.txt', '2.txt', '3.txt']) writeFileSync(join(from, n), n)
    const stop = new AbortController()
    const r = await moveEntries(
      [join(from, '1.txt'), join(from, '2.txt'), join(from, '3.txt')],
      to,
      'keep-both',
      async () => {},
      {
        signal: stop.signal,
        tick: (done) => {
          if (done === 1) stop.abort()
        }
      }
    )
    expect(r.cancelled).toBe(true)
    // The item in flight when Cancel came (a rename) finishes; nothing after it.
    expect(r.moved.length).toBe(2)
    expect(r.failed).toEqual([])
    expect(readdirSync(from).sort()).toEqual(['3.txt'])
    expect(readdirSync(to).sort()).toEqual(['1.txt', '2.txt'])
  })
})
