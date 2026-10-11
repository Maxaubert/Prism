import { createHash, randomBytes } from 'crypto'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashFile } from './fileHash'

let dir: string
let file: string
let data: Buffer

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prism-hash-'))
  file = join(dir, 'blob.bin')
  // Several stream chunks, so progress is seen more than once.
  data = randomBytes(5 * 1024 * 1024 + 123)
  await writeFile(file, data)
})

afterAll(() => rm(dir, { recursive: true, force: true }))

describe('hashFile', () => {
  it("agrees with Node's own SHA-256 and reports progress up to the size", async () => {
    const seen: Array<[number, number]> = []
    const hex = await hashFile(file, (done, total) => seen.push([done, total]))
    expect(hex).toBe(createHash('sha256').update(data).digest('hex'))
    expect(seen.length).toBeGreaterThan(1)
    expect(seen.at(-1)).toEqual([data.length, data.length])
  })
  it('hashes an empty file', async () => {
    const empty = join(dir, 'empty.txt')
    await writeFile(empty, '')
    expect(await hashFile(empty, () => {})).toBe(createHash('sha256').digest('hex'))
  })
  it('answers null when stopped part way', async () => {
    const stop = new AbortController()
    const hex = await hashFile(file, () => stop.abort(), stop.signal)
    expect(hex).toBeNull()
  })
  it('answers null for a stop before it starts, a folder and a missing file', async () => {
    const stop = new AbortController()
    stop.abort()
    expect(await hashFile(file, () => {}, stop.signal)).toBeNull()
    expect(await hashFile(dir, () => {})).toBeNull()
    expect(await hashFile(join(dir, 'nope'), () => {})).toBeNull()
  })
})
