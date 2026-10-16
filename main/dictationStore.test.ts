import { createHash } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { crc32 } from 'zlib'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { CatalogEntry, DownloadProgress } from '../shared/dictationTypes'
import { createDictationStore, PACK_MARKER, STALE_PART_MS } from './dictationStore'

/**
 * The store's rules, checked against a local http server and a temp folder:
 * nothing here reaches the network or the real %LOCALAPPDATA%. The server can
 * serve a good file, a corrupt one, a short one, a 404, one that drops the
 * line half way and one that stalls for ever (for cancel and the shared
 * promise). Unzipping is a fake everywhere but the last test, which runs the
 * real Expand-Archive once, on a zip built by hand, in a folder with a space.
 */

const GOOD = Buffer.alloc(512 * 1024)
for (let i = 0; i < GOOD.length; i++) GOOD[i] = (i * 31 + (i >> 8)) & 0xff
const CORRUPT = Buffer.from(GOOD)
CORRUPT[1000] ^= 0xff
const SHORT = GOOD.subarray(0, GOOD.length / 2)
const PACK = Buffer.from('not really a zip: the fake unzip never opens it')

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

/** One stored (uncompressed) member is all a zip needs to be real. */
function storedZip(name: string, data: Buffer): Buffer {
  const n = Buffer.from(name)
  const crc = crc32(data)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(n.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(n.length, 28)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + n.length, 12)
  end.writeUInt32LE(local.length + n.length + data.length, 16)
  return Buffer.concat([local, n, data, central, n, end])
}
const REAL_ZIP = storedZip('Release/whisper-server.exe', Buffer.from('MZ pretend'))

let server: Server
let base = ''
let hits: Record<string, number> = {}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? ''
    hits[url] = (hits[url] ?? 0) + 1
    const whole = (b: Buffer): void => {
      res.writeHead(200, { 'content-length': b.length })
      // In pieces, so progress has more than one chunk to count.
      for (let at = 0; at < b.length; at += 64 * 1024) res.write(b.subarray(at, at + 64 * 1024))
      res.end()
    }
    if (url === '/good') return whole(GOOD)
    if (url === '/corrupt') return whole(CORRUPT)
    if (url === '/short') return whole(SHORT)
    if (url === '/pack') return whole(PACK)
    if (url === '/realzip') return whole(REAL_ZIP)
    if (url === '/slow') {
      // The head and a first mouthful, then nothing, for as long as it is asked.
      res.writeHead(200, { 'content-length': GOOD.length })
      res.write(GOOD.subarray(0, 4096))
      return
    }
    if (url === '/drop') {
      res.writeHead(200, { 'content-length': GOOD.length })
      res.write(GOOD.subarray(0, 4096), () => res.destroy())
      return
    }
    res.writeHead(404).end('no')
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((done) => server.close(done))
})

const roots: string[] = []
afterEach(() => {
  hits = {}
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 5 })
})

/** A root that does NOT exist yet, inside a temp folder that does. */
function freshRoot(): string {
  const holder = mkdtempSync(join(tmpdir(), 'prism dictation '))
  roots.push(holder)
  return join(holder, 'PrismDictation')
}

function entry(id: string, path: string, body: Uint8Array, over: Partial<CatalogEntry> = {}): CatalogEntry {
  return { id, label: id, note: '', url: base + path, bytes: body.length, sha256: sha(body), kind: 'model', ...over }
}

const PACK_ENTRY = (path = '/pack', body: Uint8Array = PACK): CatalogEntry => entry('gpu', path, body, { kind: 'gpu-pack' })
const packDir = (root: string, e: CatalogEntry): string => join(root, 'engines', `${e.id}-${e.sha256.slice(0, 12)}`)

/** What the official zip looks like once open: the server is under Release/. */
const fakeUnzip = async (_zip: string, outDir: string): Promise<void> => {
  mkdirSync(join(outDir, 'Release'), { recursive: true })
  writeFileSync(join(outDir, 'Release', 'whisper-server.exe'), 'MZ')
  writeFileSync(join(outDir, 'Release', 'ggml-cuda.dll'), 'MZ')
}

async function until(cond: () => boolean): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > 4000) throw new Error('waited too long')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const quiet = (): void => {}

describe('the dictation store: a model', () => {
  it('reports every catalog entry as absent in a root that does not exist yet', async () => {
    const root = freshRoot()
    const store = createDictationStore({ root, catalog: [entry('base', '/good', GOOD), PACK_ENTRY()] })
    expect(await store.status()).toEqual([
      { id: 'base', state: 'absent', received: 0 },
      { id: 'gpu', state: 'absent', received: 0 }
    ])
    expect(store.modelPath('base')).toBeNull()
    expect(store.gpuEngineDir()).toBeNull()
  })

  it('downloads, verifies and renames into models/<id>.bin, creating the folders', async () => {
    const root = freshRoot()
    const store = createDictationStore({ root, catalog: [entry('base', '/good', GOOD)] })
    expect(await store.download('base', quiet)).toEqual({ ok: true })
    const file = join(root, 'models', 'base.bin')
    expect(store.modelPath('base')).toBe(file)
    expect(sha(readFileSync(file))).toBe(sha(GOOD))
    expect(existsSync(file + '.part')).toBe(false)
    expect(await store.status()).toEqual([{ id: 'base', state: 'installed', received: GOOD.length }])
  })

  it('does not fetch again what is already installed', async () => {
    const store = createDictationStore({ root: freshRoot(), catalog: [entry('base', '/good', GOOD)] })
    await store.download('base', quiet)
    expect(await store.download('base', quiet)).toEqual({ ok: true })
    expect(hits['/good']).toBe(1)
  })

  it('reports progress at most every 100 ms, plus a final one that says it all arrived', async () => {
    const seen: DownloadProgress[] = []
    // A clock that never moves: only the first chunk and the final report get out.
    const frozen = createDictationStore({ root: freshRoot(), catalog: [entry('base', '/good', GOOD)], now: () => 5000 })
    await frozen.download('base', (p) => seen.push(p))
    expect(seen.length).toBeGreaterThanOrEqual(1)
    expect(seen.length).toBeLessThanOrEqual(2)
    expect(seen.at(-1)).toEqual({ id: 'base', received: GOOD.length, total: GOOD.length })

    // A clock that jumps a second per look: every chunk is reported, in order.
    const many: DownloadProgress[] = []
    let t = 0
    const moving = createDictationStore({ root: freshRoot(), catalog: [entry('base', '/good', GOOD)], now: () => (t += 1000) })
    await moving.download('base', (p) => many.push(p))
    expect(many.length).toBeGreaterThan(2)
    expect(many.map((p) => p.received)).toEqual([...many.map((p) => p.received)].sort((a, b) => a - b))
    expect(many.at(-1)?.received).toBe(GOOD.length)
    expect(new Set(many.map((p) => p.received)).size).toBe(many.length)
  })

  it('survives a progress listener that throws', async () => {
    const store = createDictationStore({ root: freshRoot(), catalog: [entry('base', '/good', GOOD)] })
    const r = await store.download('base', () => {
      throw new Error('a renderer went away')
    })
    expect(r).toEqual({ ok: true })
  })

  it('deletes a file whose sha256 does not match, and says checksum', async () => {
    const root = freshRoot()
    // The right length, the wrong bytes.
    const store = createDictationStore({ root, catalog: [{ ...entry('base', '/corrupt', GOOD) }] })
    const r = await store.download('base', quiet)
    expect(r).toMatchObject({ ok: false, reason: 'checksum' })
    expect(readdirSync(join(root, 'models'))).toEqual([])
    expect(store.modelPath('base')).toBeNull()
    expect((await store.status())[0].state).toBe('absent')
  })

  it('compares the byte count as well as the hash', async () => {
    const root = freshRoot()
    // The hash of what is served is right; the size the catalog promises is not.
    const tooFew = entry('base', '/short', SHORT, { bytes: GOOD.length })
    const a = createDictationStore({ root, catalog: [tooFew] })
    expect(await a.download('base', quiet)).toMatchObject({ ok: false, reason: 'checksum' })
    expect(readdirSync(join(root, 'models'))).toEqual([])

    // And a body LONGER than promised is cut off rather than written to the end.
    const tooMany = entry('base', '/good', GOOD, { bytes: 100 })
    const b = createDictationStore({ root, catalog: [tooMany] })
    expect(await b.download('base', quiet)).toMatchObject({ ok: false, reason: 'checksum' })
    expect(readdirSync(join(root, 'models'))).toEqual([])
  })

  it('answers network for a 404, a refused connection and a line that drops', async () => {
    const root = freshRoot()
    const dead = createServer()
    await new Promise<void>((done) => dead.listen(0, '127.0.0.1', done))
    const port = (dead.address() as AddressInfo).port
    await new Promise((done) => dead.close(done))
    const store = createDictationStore({
      root,
      catalog: [
        entry('gone', '/nothing-here', GOOD),
        { ...entry('refused', '/good', GOOD), url: `http://127.0.0.1:${port}/good` },
        entry('dropped', '/drop', GOOD)
      ]
    })
    expect(await store.download('gone', quiet)).toMatchObject({ ok: false, reason: 'network', detail: 'HTTP 404' })
    expect(await store.download('refused', quiet)).toMatchObject({ ok: false, reason: 'network' })
    expect(await store.download('dropped', quiet)).toMatchObject({ ok: false, reason: 'network' })
    // One ask each: a failure is reported, never retried behind the user's back.
    expect(hits['/nothing-here']).toBe(1)
    expect(hits['/drop']).toBe(1)
    expect(readdirSync(join(root, 'models'))).toEqual([])
  })

  it('fetches through the fetch it was given, with a signal and nothing else', async () => {
    const asked: Array<{ url: string; init: RequestInit | undefined }> = []
    const store = createDictationStore({
      root: freshRoot(),
      catalog: [{ ...entry('base', '/good', GOOD), url: 'https://models.invalid/base.bin' }],
      fetchImpl: async (url, init) => {
        asked.push({ url: String(url), init })
        return new Response(GOOD)
      }
    })
    expect(await store.download('base', quiet)).toEqual({ ok: true })
    expect(asked.map((a) => a.url)).toEqual(['https://models.invalid/base.bin'])
    expect(asked[0].init?.signal).toBeInstanceOf(AbortSignal)
    // Redirects are left to fetch: no 'manual', no second ask.
    expect(asked[0].init?.redirect).toBeUndefined()
  })

  it('answers network for an id the catalog does not hold', async () => {
    const store = createDictationStore({ root: freshRoot(), catalog: [] })
    expect(await store.download('nope', quiet)).toMatchObject({ ok: false, reason: 'network' })
    expect(store.modelPath('nope')).toBeNull()
    await store.remove('nope')
    store.cancel('nope')
  })

  it('answers disk, with the message, when it cannot write', async () => {
    const root = freshRoot()
    // A FILE where the models folder has to go.
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'models'), 'in the way')
    const store = createDictationStore({ root, catalog: [entry('base', '/good', GOOD)] })
    const r = await store.download('base', quiet)
    expect(r).toMatchObject({ ok: false, reason: 'disk' })
    expect(r.ok === false && r.detail).toBeTruthy()
  })

  it('shares one promise between two asks, shows the bytes in status, and cancels cleanly', async () => {
    const root = freshRoot()
    const store = createDictationStore({ root, catalog: [entry('base', '/slow', GOOD)] })
    const first: DownloadProgress[] = []
    const second: DownloadProgress[] = []
    const p1 = store.download('base', (p) => first.push(p))
    const p2 = store.download('base', (p) => second.push(p))
    expect(p2).toBe(p1)
    await until(() => first.length > 0)
    expect(hits['/slow']).toBe(1)
    expect(existsSync(join(root, 'models', 'base.bin.part'))).toBe(true)
    const [s] = await store.status()
    expect(s.state).toBe('downloading')
    expect(s.received).toBeGreaterThan(0)
    expect(s.received).toBeLessThan(GOOD.length)
    // The part file of a download in flight is not a leftover.
    expect(existsSync(join(root, 'models', 'base.bin.part'))).toBe(true)

    store.cancel('base')
    expect(await p1).toEqual({ ok: false, reason: 'cancelled' })
    expect(readdirSync(join(root, 'models'))).toEqual([])
    expect(await store.status()).toEqual([{ id: 'base', state: 'absent', received: 0 }])
  })

  it('starts afresh when asked again straight after a cancel', async () => {
    const store = createDictationStore({ root: freshRoot(), catalog: [entry('base', '/slow', GOOD)] })
    const seen: DownloadProgress[] = []
    const p1 = store.download('base', (p) => seen.push(p))
    await until(() => seen.length > 0)
    store.cancel('base')
    // The cancelled flight is still tidying up: it is not the one handed back.
    const p2 = store.download('base', quiet)
    expect(p2).not.toBe(p1)
    expect(await p1).toEqual({ ok: false, reason: 'cancelled' })
    await until(() => hits['/slow'] === 2)
    store.cancel('base')
    expect(await p2).toEqual({ ok: false, reason: 'cancelled' })
  })

  it('calls a wrong-size file absent, and will not hand out its path', async () => {
    const root = freshRoot()
    mkdirSync(join(root, 'models'), { recursive: true })
    writeFileSync(join(root, 'models', 'base.bin'), 'far too small')
    const store = createDictationStore({ root, catalog: [entry('base', '/good', GOOD)] })
    expect(await store.status()).toEqual([{ id: 'base', state: 'absent', received: 0 }])
    expect(store.modelPath('base')).toBeNull()
    // And a download puts the real one over it.
    expect(await store.download('base', quiet)).toEqual({ ok: true })
    expect(store.modelPath('base')).toBe(join(root, 'models', 'base.bin'))
  })

  it('removes a leftover part file nobody is writing, but not one still warm', async () => {
    const root = freshRoot()
    const part = join(root, 'models', 'base.bin.part')
    mkdirSync(dirname(part), { recursive: true })
    writeFileSync(part, 'half a model')
    const now = Date.now()
    const store = createDictationStore({ root, catalog: [entry('base', '/good', GOOD)], now: () => now })
    // Written this second: the OTHER app may be the one downloading it.
    expect(await store.status()).toEqual([{ id: 'base', state: 'absent', received: 0 }])
    expect(existsSync(part)).toBe(true)
    const old = new Date(now - STALE_PART_MS - 1000)
    utimesSync(part, old, old)
    expect(await store.status()).toEqual([{ id: 'base', state: 'absent', received: 0 }])
    expect(existsSync(part)).toBe(false)
  })

  it('removes an installed model, and a download in flight', async () => {
    const root = freshRoot()
    const store = createDictationStore({ root, catalog: [entry('base', '/good', GOOD), entry('slow', '/slow', GOOD)] })
    await store.download('base', quiet)
    await store.remove('base')
    expect(store.modelPath('base')).toBeNull()
    expect(existsSync(join(root, 'models', 'base.bin'))).toBe(false)

    const seen: DownloadProgress[] = []
    const p = store.download('slow', (x) => seen.push(x))
    await until(() => seen.length > 0)
    await store.remove('slow')
    expect(await p).toEqual({ ok: false, reason: 'cancelled' })
    expect(readdirSync(join(root, 'models'))).toEqual([])
  })

  // Perf review 2026-10-16: a stat on main's thread for every dictation pass.
  it('believes an installed model for 30 s, a missing one never, and forgets on remove and status', async () => {
    const root = freshRoot()
    let t = 1_000_000
    const store = createDictationStore({ root, catalog: [entry('base', '/good', GOOD)], now: () => t })
    const file = join(root, 'models', 'base.bin')
    expect(store.modelPath('base')).toBeNull()
    // Put there by the other app: seen at once, a "no" is never kept.
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, GOOD)
    expect(store.modelPath('base')).toBe(file)
    // Gone behind the store's back: the disk is not asked again for 30 s.
    rmSync(file)
    t += 10_000
    expect(store.modelPath('base')).toBe(file)
    t += 20_000
    expect(store.modelPath('base')).toBeNull()
    // status() and remove() look again at once.
    writeFileSync(file, GOOD)
    expect(store.modelPath('base')).toBe(file)
    rmSync(file)
    expect(await store.status()).toEqual([{ id: 'base', state: 'absent', received: 0 }])
    expect(store.modelPath('base')).toBeNull()
    writeFileSync(file, GOOD)
    expect(store.modelPath('base')).toBe(file)
    await store.remove('base')
    expect(store.modelPath('base')).toBeNull()
  })

  it('refuses a catalog id that could walk out of the folder', () => {
    expect(() => createDictationStore({ root: freshRoot(), catalog: [entry('..\\evil', '/good', GOOD)] })).toThrow()
  })
})

describe('the dictation store: the GPU pack', () => {
  it('downloads the zip, verifies it, THEN unzips, deletes the zip and writes the marker last', async () => {
    const root = freshRoot()
    const e = PACK_ENTRY()
    const calls: Array<{ zip: string; outDir: string; zipSha: string; marker: boolean }> = []
    const store = createDictationStore({
      root,
      catalog: [e],
      unzip: async (zip, outDir) => {
        calls.push({ zip, outDir, zipSha: sha(readFileSync(zip)), marker: existsSync(join(outDir, PACK_MARKER)) })
        await fakeUnzip(zip, outDir)
      }
    })
    expect(await store.download('gpu', quiet)).toEqual({ ok: true })
    expect(calls).toEqual([{ zip: join(root, 'engines', 'gpu.zip'), outDir: packDir(root, e), zipSha: e.sha256, marker: false }])
    expect(readdirSync(join(root, 'engines'))).toEqual([`gpu-${e.sha256.slice(0, 12)}`])
    expect(existsSync(join(packDir(root, e), PACK_MARKER))).toBe(true)
    expect(store.gpuEngineDir()).toBe(join(packDir(root, e), 'Release'))
    expect(await store.status()).toEqual([{ id: 'gpu', state: 'installed', received: PACK.length }])
    // A pack is not a model.
    expect(store.modelPath('gpu')).toBeNull()
  })

  it('never unzips a zip that failed its checksum', async () => {
    const root = freshRoot()
    let unzipped = 0
    const store = createDictationStore({
      root,
      catalog: [entry('gpu', '/corrupt', GOOD, { kind: 'gpu-pack' })],
      unzip: async () => void (unzipped += 1)
    })
    expect(await store.download('gpu', quiet)).toMatchObject({ ok: false, reason: 'checksum' })
    expect(unzipped).toBe(0)
    expect(readdirSync(join(root, 'engines'))).toEqual([])
  })

  it('answers unpack and cleans up when the unzip fails, or holds no server', async () => {
    const root = freshRoot()
    const e = PACK_ENTRY()
    const failing = createDictationStore({
      root,
      catalog: [e],
      unzip: async (_zip, outDir) => {
        mkdirSync(join(outDir, 'Release'), { recursive: true })
        writeFileSync(join(outDir, 'Release', 'half.dll'), 'MZ')
        throw new Error('the archive is damaged')
      }
    })
    expect(await failing.download('gpu', quiet)).toEqual({ ok: false, reason: 'unpack', detail: 'the archive is damaged' })
    expect(readdirSync(join(root, 'engines'))).toEqual([])
    expect(failing.gpuEngineDir()).toBeNull()

    const hollow = createDictationStore({
      root,
      catalog: [e],
      unzip: async (_zip, outDir) => {
        mkdirSync(outDir, { recursive: true })
      }
    })
    expect(await hollow.download('gpu', quiet)).toMatchObject({ ok: false, reason: 'unpack' })
    expect(readdirSync(join(root, 'engines'))).toEqual([])
  })

  it('does not call a half-unzipped folder installed', async () => {
    const root = freshRoot()
    const e = PACK_ENTRY()
    // What a crash in the middle of the unzip leaves: the server is there, the marker is not.
    await fakeUnzip('', packDir(root, e))
    const store = createDictationStore({ root, catalog: [e], unzip: fakeUnzip })
    expect(await store.status()).toEqual([{ id: 'gpu', state: 'absent', received: 0 }])
    expect(store.gpuEngineDir()).toBeNull()
    // A marker written for some OTHER size of pack does not count either.
    writeFileSync(join(packDir(root, e), PACK_MARKER), JSON.stringify({ id: 'gpu', bytes: 1, sha256: e.sha256 }))
    expect((await store.status())[0].state).toBe('absent')
    expect(store.gpuEngineDir()).toBeNull()
    // And the next download starts from a clean folder.
    writeFileSync(join(packDir(root, e), 'stale.txt'), 'from the crash')
    expect(await store.download('gpu', quiet)).toEqual({ ok: true })
    expect(existsSync(join(packDir(root, e), 'stale.txt'))).toBe(false)
    expect(store.gpuEngineDir()).toBe(join(packDir(root, e), 'Release'))
  })

  it('finds the server at the top and two levels down, and no deeper', async () => {
    const at = async (rel: string[]): Promise<string | null> => {
      const root = freshRoot()
      const e = PACK_ENTRY()
      const store = createDictationStore({
        root,
        catalog: [e],
        unzip: async (_zip, outDir) => {
          mkdirSync(join(outDir, ...rel), { recursive: true })
          writeFileSync(join(outDir, ...rel, 'whisper-server.exe'), 'MZ')
        }
      })
      const r = await store.download('gpu', quiet)
      const dir = store.gpuEngineDir()
      if (dir) expect(dir).toBe(join(packDir(root, e), ...rel))
      else expect(r).toMatchObject({ ok: false, reason: 'unpack' })
      return dir
    }
    expect(await at([])).not.toBeNull()
    expect(await at(['Release'])).not.toBeNull()
    expect(await at(['build', 'Release'])).not.toBeNull()
    expect(await at(['a', 'b', 'c'])).toBeNull()
  })

  it('cancels during the download, leaving no zip behind', async () => {
    const root = freshRoot()
    const store = createDictationStore({ root, catalog: [PACK_ENTRY('/slow', GOOD)], unzip: fakeUnzip })
    const seen: DownloadProgress[] = []
    const p = store.download('gpu', (x) => seen.push(x))
    await until(() => seen.length > 0)
    expect(existsSync(join(root, 'engines', 'gpu.zip.part'))).toBe(true)
    store.cancel('gpu')
    expect(await p).toEqual({ ok: false, reason: 'cancelled' })
    expect(readdirSync(join(root, 'engines'))).toEqual([])
  })

  it('cancels during the unzip: the signal reaches it, and nothing is left installed', async () => {
    const root = freshRoot()
    let started = false
    const store = createDictationStore({
      root,
      catalog: [PACK_ENTRY()],
      unzip: (_zip, outDir, signal) =>
        new Promise<void>((_resolve, reject) => {
          mkdirSync(outDir, { recursive: true })
          started = true
          signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    })
    const p = store.download('gpu', quiet)
    await until(() => started)
    expect((await store.status())[0]).toEqual({ id: 'gpu', state: 'downloading', received: PACK.length })
    store.cancel('gpu')
    expect(await p).toEqual({ ok: false, reason: 'cancelled' })
    expect(readdirSync(join(root, 'engines'))).toEqual([])
  })

  it('removes the pack, and the folder of a pack the catalog has moved on from', async () => {
    const root = freshRoot()
    const e = PACK_ENTRY()
    const old = join(root, 'engines', 'gpu-0123456789ab')
    await fakeUnzip('', old)
    const keep = join(root, 'engines', 'gpu-notes')
    mkdirSync(keep, { recursive: true })
    const store = createDictationStore({ root, catalog: [e], unzip: fakeUnzip })
    await store.download('gpu', quiet)
    // Installing the new pack is what retires the old one.
    expect(existsSync(old)).toBe(false)
    await store.remove('gpu')
    expect(store.gpuEngineDir()).toBeNull()
    expect((await store.status())[0].state).toBe('absent')
    // Only what the store made is the store's to delete.
    expect(readdirSync(join(root, 'engines'))).toEqual(['gpu-notes'])
  })

  it('unzips for real with Expand-Archive, in a path with a space', async () => {
    const root = freshRoot()
    const e = PACK_ENTRY('/realzip', REAL_ZIP)
    const store = createDictationStore({ root, catalog: [e] })
    expect(await store.download('gpu', quiet)).toEqual({ ok: true })
    expect(store.gpuEngineDir()).toBe(join(packDir(root, e), 'Release'))
    expect(readdirSync(join(root, 'engines'))).toEqual([`gpu-${e.sha256.slice(0, 12)}`])
  }, 30000)
})
