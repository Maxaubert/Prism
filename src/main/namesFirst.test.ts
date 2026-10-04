import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listDir, listNames, statDetails, type FileDetail } from './dirList'
import { createPrefetchQueue } from './listingPrefetch'
import { driveKindOf, driveOf, parseDriveKinds } from './driveKinds'
import { withDetails } from './explorerListing'

vi.mock('./everything', () => ({ searchEverything: vi.fn(async () => null) }))

let box: string
beforeEach(() => {
  box = mkdtempSync(join(tmpdir(), 'prism-names-'))
})
afterEach(() => rmSync(box, { recursive: true, force: true }))

describe('names first (#271)', () => {
  it('lists the same entries as the full read, without sizes or dates', async () => {
    mkdirSync(join(box, 'sub'))
    writeFileSync(join(box, 'b.jpg'), 'xx')
    writeFileSync(join(box, 'a10.png'), '')
    writeFileSync(join(box, 'a9.png'), '')
    writeFileSync(join(box, 'setup.exe'), '')
    writeFileSync(join(box, '.hidden'), '')
    const names = await listNames(box)
    const full = await listDir(box, true)
    expect(names.folders).toEqual(full.folders)
    expect(names.files.map((f) => f.name)).toEqual(full.files.map((f) => f.name))
    expect(names.files.map((f) => f.kind)).toEqual(full.files.map((f) => f.kind))
    expect(names.files.every((f) => f.size === undefined && f.mtimeMs === undefined)).toBe(true)
    expect(names.complete).toBe(false)
  })

  it('is complete at once when there are no files to stat', async () => {
    mkdirSync(join(box, 'only'))
    expect((await listNames(box)).complete).toBeUndefined()
  })

  it('flags an unreadable folder instead of throwing', async () => {
    expect((await listNames(join(box, 'missing'))).unreadable).toBe(true)
  })
})

describe('the details stream', () => {
  const paths = Array.from({ length: 130 }, (_, i) => `C:\\x\\f${i}`)
  const fakeStat = async (p: string): Promise<{ size: number; mtimeMs: number }> => {
    if (p.endsWith('f5')) throw new Error('gone')
    return { size: Number(p.slice(6)), mtimeMs: 1 }
  }

  it('sends the first screen first, then the rest in batches, then done', async () => {
    const calls: Array<{ n: number; done: boolean; first: string }> = []
    const all: FileDetail[] = []
    const ok = await statDetails(
      paths,
      (files, done) => {
        calls.push({ n: files.length, done, first: files[0]?.path ?? '' })
        all.push(...files)
      },
      { first: 60, batch: 50, interval: 10_000, statFile: fakeStat }
    )
    expect(ok).toBe(true)
    expect(calls[0]).toMatchObject({ n: 50, done: false })
    expect(calls.reduce((sum, c) => sum + c.n, 0)).toBe(130)
    expect(calls.at(-1)?.done).toBe(true)
    // The first screen is all in before anything past it is asked.
    const firstScreen = all.slice(0, 60).map((d) => d.path).sort()
    expect(firstScreen).toEqual(paths.slice(0, 60).sort())
    // A file that cannot be stat'ed is unknown, 0 and 0, as before.
    expect(all.find((d) => d.path.endsWith('f5'))).toEqual({ path: 'C:\\x\\f5', size: 0, mtimeMs: 0 })
  })

  it('stops where it is when nobody is waiting any more', async () => {
    let asked = 0
    const ok = await statDetails(paths, () => {}, {
      live: () => asked < 10,
      statFile: async () => {
        asked += 1
        return { size: 1, mtimeMs: 1 }
      }
    })
    expect(ok).toBe(false)
    expect(asked).toBeLessThan(20)
  })

  it('merges into the listing and makes it complete', () => {
    const listing = {
      folders: [],
      files: [{ path: 'C:\\x\\a', name: 'a', ext: '', kind: 'other' as const }],
      complete: false
    }
    const merged = withDetails(listing, new Map([['C:\\x\\a', { path: 'C:\\x\\a', size: 3, mtimeMs: 4 }]]))
    expect(merged.files[0]).toMatchObject({ size: 3, mtimeMs: 4 })
    expect('complete' in merged).toBe(false)
  })
})

describe('the read-ahead queue', () => {
  it('reads at most two at a time and shares a folder already asked for', async () => {
    let running = 0
    let peak = 0
    const releases: Array<() => void> = []
    const queue = createPrefetchQueue({
      run: (path: string) =>
        new Promise<string>((done) => {
          running += 1
          peak = Math.max(peak, running)
          releases.push(() => {
            running -= 1
            done(path)
          })
        })
    })
    const a = queue.add('C:\\a')
    const again = queue.add('c:/a/')
    queue.add('C:\\b')
    queue.add('C:\\c')
    expect(queue.running).toBe(2)
    expect(queue.waiting).toBe(1)
    releases.shift()!()
    expect(await a).toBe('C:\\a')
    expect(await again).toBe('C:\\a')
    await Promise.resolve()
    expect(peak).toBe(2)
  })

  it('a real navigation drops everything still waiting', async () => {
    const queue = createPrefetchQueue({ run: () => new Promise<string>(() => {}) })
    queue.add('C:\\a')
    queue.add('C:\\b')
    const waiting = queue.add('C:\\c')
    queue.cancel()
    expect(await waiting).toBeNull()
    expect(queue.waiting).toBe(0)
  })

  it('keeps the newest asks when the queue is full', async () => {
    const queue = createPrefetchQueue({ run: () => new Promise<string>(() => {}), limit: 1, maxQueued: 2 })
    queue.add('C:\\busy')
    const oldest = queue.add('C:\\1')
    queue.add('C:\\2')
    queue.add('C:\\3')
    expect(await oldest).toBeNull()
  })
})

describe('which drives the cache and the read ahead may touch', () => {
  const kinds = parseDriveKinds('C:=3\r\nD:=2\r\nZ:=4\r\nnoise\r\n')

  it('reads WMI lines', () => {
    expect([...kinds]).toEqual([
      ['C:', 3],
      ['D:', 2],
      ['Z:', 4]
    ])
  })

  it('local fixed only: never a share, a stick or a mapped network drive', () => {
    expect(driveKindOf('C:\\Users', kinds, 'C:')).toBe('fixed')
    expect(driveKindOf('D:\\photos', kinds, 'C:')).toBe('other')
    expect(driveKindOf('Z:\\', kinds, 'C:')).toBe('other')
    expect(driveKindOf('\\\\server\\share', kinds, 'C:')).toBe('other')
  })

  it('before Windows has answered, only the system drive counts', () => {
    const none = new Map<string, number>()
    expect(driveKindOf('c:\\Users\\me', none, 'C:')).toBe('fixed')
    expect(driveKindOf('E:\\x', none, 'C:')).toBe('unknown')
    expect(driveOf('relative\\x')).toBeNull()
  })
})
