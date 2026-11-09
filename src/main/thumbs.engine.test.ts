import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync, statSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Thumbs class with a pretend ffmpeg (Stage 2 of the zoom grid): what it
 * asks of the process and what it does with the answer. The real ffmpeg is
 * thumbs.imageEncode.ffmpeg.test.ts. The pretend one writes the output file
 * the way ffmpeg does and answers with the stderr the test scripted.
 */
interface Call {
  args: string[]
  opts: { timeout?: number; signal?: AbortSignal }
}
const calls: Call[] = []
let script: (call: Call) => { fail?: boolean; stderr?: string; killed?: boolean; wait?: Promise<void> } = () => ({})
let write = (out: string): void => writeFileSync(out, Buffer.from('thumb-bytes'))

vi.mock('./spawnWorker', () => ({
  execFile: (
    _exe: string,
    args: string[],
    opts: Call['opts'],
    cb: (e: (Error & { killed?: boolean }) | null, so: string, se: string) => void
  ) => {
    const call = { args, opts }
    calls.push(call)
    const r = script(call)
    const answer = (): void => {
      if (r.fail) return cb(Object.assign(new Error('ffmpeg failed'), { killed: !!r.killed }), '', r.stderr ?? '')
      write(args[args.length - 1])
      cb(null, '', r.stderr ?? '')
    }
    if (r.wait) void r.wait.then(answer)
    else queueMicrotask(answer)
    return { kill: () => undefined }
  }
}))

const { Thumbs, THUMB_TIMEOUT_MS } = await import('./thumbs')

const dir = mkdtempSync(join(tmpdir(), 'thumbs-engine-'))
const cache = join(dir, 'cache')
afterAll(() => rmSync(dir, { recursive: true, force: true }))
let n = 0
const source = (name: string): string => {
  const p = join(dir, `${++n}-${name}`)
  writeFileSync(p, Buffer.from('source'))
  return p
}
const make = (extra: Partial<ConstructorParameters<typeof Thumbs>[3]> = {}): InstanceType<typeof Thumbs> =>
  new Thumbs('ffmpeg', cache, undefined, extra)

beforeEach(() => {
  calls.length = 0
  script = () => ({})
  write = (out) => writeFileSync(out, Buffer.from('thumb-bytes'))
})

describe('Thumbs for the desktop', () => {
  it('a run the holders killed for a move says nothing about the file: it is tried again', async () => {
    let kill = true
    const t = new Thumbs('ffmpeg', cache, (c) => {
      if (kill) c.kill()
    })
    const f = source('moved.jpg')
    script = () => ({ fail: true, killed: true })
    expect(await t.makeFor(f, 'image', 320)).toBeNull()
    kill = false
    script = () => ({})
    expect(await t.makeFor(f, 'image', 320)).not.toBeNull()
  })

  it('a phone sharing a desktop job that is cancelled still gets its picture', async () => {
    const t = make()
    const f = source('shared.jpg')
    const gate: { open?: () => void } = {}
    const wait = new Promise<void>((r) => (gate.open = r))
    script = (c) => (c.opts.signal ? { fail: true, wait } : {})
    const ac = new AbortController()
    const desktop = t.makeFor(f, 'image', 320, ac.signal)
    while (calls.length === 0) await new Promise((r) => setImmediate(r))
    const phone = t.get(f, 'image')
    await new Promise((r) => setImmediate(r))
    ac.abort()
    gate.open?.()
    expect(await desktop).toBeNull()
    expect(await phone).not.toBeNull()
    expect(calls).toHaveLength(2)
  })

  it('makes a still at the asked tier and answers a second ask from the cache with no new ffmpeg', async () => {
    const t = make()
    const f = source('a.jpg')
    const a = await t.makeFor(f, 'image', 640)
    expect(a).not.toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0].args[calls[0].args.indexOf('-vf') + 1]).toBe('scale=640:-2')
    const b = await t.makeFor(f, 'image', 640)
    expect(b).toBe(a)
    expect(calls).toHaveLength(1)
    // The 320 tier is another file.
    const c = await t.makeFor(f, 'image', 320)
    expect(c).not.toBe(a)
    expect(calls).toHaveLength(2)
  })

  it('the phone path is as it was: no timeout, the old argv, the old key', async () => {
    const t = make()
    const f = source('p.jpg')
    const out = await t.get(f, 'image')
    expect(out).not.toBeNull()
    expect(calls[0].opts.timeout).toBeUndefined()
    expect(calls[0].args).not.toContain('-threads')
    expect(calls[0].args[calls[0].args.indexOf('-vf') + 1]).toBe('scale=320:-2')
  })

  it('a desktop ffmpeg has a timeout, so a hung network file cannot hold a slot', async () => {
    const t = make()
    await t.makeFor(source('t.jpg'), 'image', 320)
    expect(THUMB_TIMEOUT_MS).toBe(15000)
    expect(calls[0].opts.timeout).toBe(THUMB_TIMEOUT_MS)
  })

  it('a film is one pass when it is SDR', async () => {
    const t = make()
    script = () => ({ stderr: 'Stream #0:0[0x1]: Video: hevc (Main), yuv420p(tv, bt709), 1920x1080\nOutput #0, image2' })
    const out = await t.makeFor(source('sdr.mov'), 'video', 320)
    expect(out).not.toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toContain('-noaccurate_seek')
  })

  it('a film is tone-mapped in a second pass when ffmpeg says its input is HLG', async () => {
    const t = make()
    script = (c) =>
      c.args.join(' ').includes('zscale')
        ? {}
        : { stderr: 'Stream #0:0[0x1](und): Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 3840x2160\nOutput #0, image2' }
    const out = await t.makeFor(source('hlg.mov'), 'video', 640)
    expect(out).not.toBeNull()
    expect(calls).toHaveLength(2)
    expect(calls[1].args[calls[1].args.indexOf('-vf') + 1]).toContain('tonemap=hable')
  })

  it('a clip shorter than the seek gives no frame, so the first frame is taken', async () => {
    const t = make()
    script = (c) => (c.args.includes('-ss') ? { fail: true } : {})
    write = (out) => writeFileSync(out, Buffer.from('frame'))
    const out = await t.makeFor(source('short.mp4'), 'video', 320)
    expect(out).not.toBeNull()
    expect(calls).toHaveLength(2)
    expect(calls[1].args).not.toContain('-ss')
  })

  it('remembers a failure in memory, so a broken file is not retried on every scroll', async () => {
    const t = make()
    script = () => ({ fail: true })
    const f = source('broken.jpg')
    expect(await t.makeFor(f, 'image', 320)).toBeNull()
    expect(calls).toHaveLength(1)
    expect(await t.makeFor(f, 'image', 320)).toBeNull()
    expect(calls).toHaveLength(1)
    expect(await t.lookup(f, 'image', 320)).toEqual({ failed: true })
    // A changed file is a new key: tried again.
    const later = new Date(Date.now() + 5000)
    utimesSync(f, later, later)
    script = () => ({})
    expect(await t.makeFor(f, 'image', 320)).not.toBeNull()
    expect(calls).toHaveLength(2)
  })

  it('does not remember a failure that was a cancel', async () => {
    const t = make()
    const ac = new AbortController()
    script = () => {
      ac.abort()
      return { fail: true, killed: true }
    }
    const f = source('cancelled.jpg')
    expect(await t.makeFor(f, 'image', 320, ac.signal)).toBeNull()
    script = () => ({})
    expect(await t.makeFor(f, 'image', 320)).not.toBeNull()
  })

  it('lookup: a hit is the file, a miss is null, a file that is gone is null', async () => {
    const t = make()
    const f = source('look.jpg')
    expect(await t.lookup(f, 'image', 320)).toBeNull()
    const out = await t.makeFor(f, 'image', 320)
    expect(await t.lookup(f, 'image', 320)).toEqual({ file: out })
    expect(await t.lookup(join(dir, 'nope.jpg'), 'image', 320)).toBeNull()
  })

  it('touches a hit only when it was last touched over a day ago', async () => {
    const t = make()
    const f = source('touch.jpg')
    const out = (await t.makeFor(f, 'image', 320)) as string
    const hourAgo = new Date(Date.now() - 3600_000)
    utimesSync(out, hourAgo, hourAgo)
    await t.lookup(f, 'image', 320)
    expect(Math.abs(statSync(out).mtimeMs - hourAgo.getTime())).toBeLessThan(2000)
    const twoDays = new Date(Date.now() - 2 * 86400_000)
    utimesSync(out, twoDays, twoDays)
    await t.lookup(f, 'image', 320)
    expect(Date.now() - statSync(out).mtimeMs).toBeLessThan(5000)
  })

  it('a HEIC ffmpeg joins is one pass; a HEIC it reads as a tile goes to the decoder and is scaled after', async () => {
    const heic = vi.fn(async () => Buffer.from('jpeg-of-the-whole-photo'))
    const t = make({ heic })
    script = () => ({ stderr: "Input #0, mov, from 'a.heic':\n  Stream #0:0: Video: hevc (Main Still Picture), yuvj420p(pc), 640x480" })
    expect(await t.makeFor(source('plain.heic'), 'image', 320)).not.toBeNull()
    expect(heic).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)

    calls.length = 0
    script = (c) =>
      c.args.includes('-loglevel') && c.args[c.args.indexOf('-loglevel') + 1] === 'info'
        ? { stderr: "Input #0, mov, from 'a.heic':\n  Stream group #0:0[0x1]: Tile Grid: hevc, 4032x3024" }
        : {}
    const out = await t.makeFor(source('grid.heic'), 'image', 320)
    expect(out).not.toBeNull()
    expect(heic).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(2)
    // The decoder's JPEG is what ffmpeg scales, under a name that is no thumbnail.
    const second = calls[1].args
    expect(second[second.indexOf('-i') + 1]).toMatch(/\.src\.part$/)
    expect(existsSync(second[second.indexOf('-i') + 1])).toBe(false)
  })

  it('a HEIC ffmpeg cannot read at all goes to the decoder too', async () => {
    const heic = vi.fn(async () => Buffer.from('jpeg'))
    const t = make({ heic })
    let first = true
    script = () => {
      if (first) {
        first = false
        return { fail: true }
      }
      return {}
    }
    expect(await t.makeFor(source('odd.heic'), 'image', 320)).not.toBeNull()
    expect(heic).toHaveBeenCalledTimes(1)
  })

  it('a camera raw is its embedded JPEG scaled; no preview inside falls through to ffmpeg on the raw', async () => {
    const raw = vi.fn(async () => Buffer.from('embedded-jpeg'))
    const t = make({ raw })
    const f = source('shot.cr2')
    expect(await t.makeFor(f, 'image', 320)).not.toBeNull()
    expect(raw).toHaveBeenCalledTimes(1)
    expect(calls[0].args[calls[0].args.indexOf('-i') + 1]).toMatch(/\.src\.part$/)

    calls.length = 0
    const none = make({ raw: vi.fn(async () => Promise.reject(new Error('no preview'))) })
    const g = source('nopreview.nef')
    expect(await none.makeFor(g, 'image', 320)).not.toBeNull()
    expect(calls[0].args[calls[0].args.indexOf('-i') + 1]).toBe(g)
  })

  it('passes the cancel signal to ffmpeg', async () => {
    const t = make()
    const ac = new AbortController()
    await t.makeFor(source('sig.jpg'), 'image', 320, ac.signal)
    expect(calls[0].opts.signal).toBe(ac.signal)
  })

  it('counts its runs and the most it ever ran at once, for the e2e', async () => {
    const t = make()
    await Promise.all([1, 2, 3, 4, 5, 6].map((i) => t.makeFor(source(`c${i}.jpg`), 'image', 320)))
    expect(t.stats().runs).toBe(6)
    expect(t.stats().peak).toBeLessThanOrEqual(4)
    expect(t.stats().running).toBe(0)
  })

  it('reads the cache folder once for a whole folder of tiles, never once per tile', async () => {
    const t = make()
    for (let i = 0; i < 4; i++)
      await Promise.all(Array.from({ length: 10 }, (_, j) => t.makeFor(source(`s${i}-${j}.jpg`), 'image', 320)))
    await new Promise((r) => setTimeout(r, 50))
    expect(t.stats().runs).toBe(40)
    expect(t.stats().scans).toBeLessThanOrEqual(1)
  })

  it('removes half-written files left by a run that died, but not one being written now', async () => {
    const t = make()
    await t.makeFor(source('seed.jpg'), 'image', 320)
    const old = join(cache, 'dead.jpg.part')
    const live = join(cache, 'live.jpg.part')
    writeFileSync(old, 'x')
    writeFileSync(live, 'x')
    const longAgo = new Date(Date.now() - 3600_000)
    utimesSync(old, longAgo, longAgo)
    await t.sweepParts()
    expect(existsSync(old)).toBe(false)
    expect(existsSync(live)).toBe(true)
    expect(readdirSync(cache).some((x) => x.endsWith('.jpg'))).toBe(true)
  })
})
