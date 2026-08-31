import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { readTail, startTail, stopAllTails, type TailEvent } from './fileTail'

const dir = mkdtempSync(join(tmpdir(), 'prism-tail-'))
const file = (name: string, body: string | Buffer): string => {
  const p = join(dir, name)
  writeFileSync(p, body)
  return p
}

afterEach(() => stopAllTails())
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('reading the end of a file', () => {
  it('gives the whole thing when it fits', async () => {
    const p = file('small.log', 'one\ntwo\nthree\n')
    const r = await readTail(p, 1024)
    expect(r).toMatchObject({ from: 0, size: 14 })
    expect(r?.text).toBe('one\ntwo\nthree\n')
  })

  it('drops the first partial LINE, so the tail never starts mid-word', async () => {
    // 'aaaa\nbbbb\ncccc\n' is 15 bytes; the last 8 start inside 'bbbb'.
    const p = file('lines.log', 'aaaa\nbbbb\ncccc\n')
    const r = await readTail(p, 8)
    expect(r?.text).toBe('cccc\n')
    expect(r?.from).toBe(7)
    expect(r?.size).toBe(15)
  })

  it('reports the REAL size, not the size of what it returned', async () => {
    const p = file('big.log', 'x'.repeat(5000))
    const r = await readTail(p, 100)
    expect(r?.size).toBe(5000)
    expect(r?.text.length).toBeLessThanOrEqual(100)
  })

  it('normalises CRLF, because CodeMirror rejoins with LF', async () => {
    const p = file('crlf.log', 'one\r\ntwo\r\n')
    expect((await readTail(p, 1024))?.text).toBe('one\ntwo\n')
  })

  it('reads a UTF-16LE file by its byte-order mark', async () => {
    const p = file('utf16.log', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hei\n', 'utf16le')]))
    expect((await readTail(p, 1024))?.text).toBe('hei\n')
  })

  it('answers null for something that is not a file', async () => {
    expect(await readTail(join(dir, 'nope.log'), 1024)).toBeNull()
    expect(await readTail(dir, 1024)).toBeNull()
  })
})

describe('following a file that grows', () => {
  /** Wait for the tail to say something, or give up. */
  const waitFor = (
    events: TailEvent[],
    test: (e: TailEvent[]) => boolean,
    ms = 4000
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      const started = Date.now()
      const t = setInterval(() => {
        if (test(events)) {
          clearInterval(t)
          resolve()
        } else if (Date.now() - started > ms) {
          clearInterval(t)
          reject(new Error(`timed out; saw ${JSON.stringify(events)}`))
        }
      }, 50)
    })

  it('reports only the bytes that appeared', async () => {
    const p = file('grow.log', 'first\n')
    const seen: TailEvent[] = []
    expect(await startTail(p, 6, (e) => seen.push(e))).toBe(true)
    appendFileSync(p, 'second\n')
    await waitFor(seen, (s) => s.some((e) => e.text.includes('second')))
    // The text already there is NOT re-sent: the offset is where the reader
    // had got to, not the start of the file.
    expect(seen.map((e) => e.text).join('')).toBe('second\n')
  })

  it('catches up on anything written between the read and the follow', async () => {
    const p = file('race.log', 'first\n')
    appendFileSync(p, 'missed\n')
    const seen: TailEvent[] = []
    await startTail(p, 6, (e) => seen.push(e))
    await waitFor(seen, (s) => s.some((e) => e.text.includes('missed')))
    expect(seen.map((e) => e.text).join('')).toBe('missed\n')
  })

  it('says RESET when the file gets shorter, rather than splicing', async () => {
    // A rotated log. Appending the new bytes to the old tail would show a
    // document that never existed.
    const p = file('rotate.log', 'a'.repeat(100))
    const seen: TailEvent[] = []
    await startTail(p, 100, (e) => seen.push(e))
    writeFileSync(p, 'fresh\n')
    await waitFor(seen, (s) => s.some((e) => e.reset))
    expect(seen.some((e) => e.reset)).toBe(true)
  })

  it('refuses to follow something that is not a file', async () => {
    expect(await startTail(join(dir, 'nothing.log'), 0, () => {})).toBe(false)
  })
})
