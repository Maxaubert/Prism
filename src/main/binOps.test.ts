import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteItems, emptyBin, restoreItems, type BinEnv } from './binOps'
import { trashInto } from './binTrash'

// RESTORE, DELETE PERMANENTLY, EMPTY (Recycle Bin feature, D13 to D15). Real
// files in a temp folder shaped like two drives' bins; the env is the seam the
// ipc handlers fill with the wall, the real bin folders and the trash call.
let tmp: string
let binC: string
let binD: string
let orig: string

/** A v2 `$I` record, the format Windows 8 and later write. */
function record(path: string, size = 1): Buffer {
  const text = Buffer.from(`${path}\0`, 'utf16le')
  const head = Buffer.alloc(28)
  head.writeBigInt64LE(2n, 0)
  head.writeBigInt64LE(BigInt(size), 8)
  head.writeBigInt64LE((BigInt(Date.now()) + 11644473600000n) * 10000n, 16)
  head.writeInt32LE(path.length + 1, 24)
  return Buffer.concat([head, text])
}

/** A v1 `$I` (Vista, 7): fixed 260 chars. */
function recordV1(path: string): Buffer {
  const head = Buffer.alloc(24)
  head.writeBigInt64LE(1n, 0)
  head.writeBigInt64LE(3n, 8)
  head.writeBigInt64LE((BigInt(Date.now()) + 11644473600000n) * 10000n, 16)
  const text = Buffer.alloc(520)
  Buffer.from(path, 'utf16le').copy(text)
  return Buffer.concat([head, text])
}

/** Bin one item by hand: `$I<id><ext>` and `$R<id><ext>` (a file, or a folder with a file in it). */
function put(dir: string, id: string, from: string, opts: { folder?: boolean; v1?: boolean; body?: string } = {}): string {
  const ext = opts.folder ? '' : (/\.[^.\\]+$/.exec(from)?.[0] ?? '')
  const r = join(dir, `$R${id}${ext}`)
  if (opts.folder) {
    mkdirSync(join(r, 'inner'), { recursive: true })
    writeFileSync(join(r, 'inner', 'deep.txt'), 'deep')
  } else writeFileSync(r, opts.body ?? id)
  writeFileSync(join(dir, `$I${id}${ext}`), opts.v1 ? recordV1(from) : record(from))
  return r
}

let trashed: string[]
let granted: Set<string> | null
function env(over: Partial<BinEnv> = {}): BinEnv {
  return {
    dirs: async () => [binC, binD],
    granted: (p) => (granted ? granted.has(p) : true),
    trash: async (p) => {
      trashed.push(p)
      await trashInto([binC], p)
    },
    ...over
  }
}
const left = (dir: string): string[] => readdirSync(dir).sort()

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'prism-binops-')))
  binC = join(tmp, 'C', '$Recycle.Bin', 'S-1-5-21-1-2-3-1001')
  binD = join(tmp, 'D', '$Recycle.Bin', 'S-1-5-21-1-2-3-1001')
  orig = join(tmp, 'orig')
  mkdirSync(binC, { recursive: true })
  mkdirSync(binD, { recursive: true })
  mkdirSync(orig)
  trashed = []
  granted = null
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('restoreItems', () => {
  it('puts a file and a folder back where they came from, and drops their $I', async () => {
    const f = join(orig, 'a.txt')
    const d = join(orig, 'proj')
    const rf = put(binC, 'AAAAAA', f, { body: 'file body' })
    const rd = put(binC, 'BBBBBB', d, { folder: true })
    const r = await restoreItems(env(), [rf, rd], 'ask')
    expect(r).toMatchObject({ ok: true, cancelled: false, clashes: [], left: [], failed: [] })
    expect(r.restored.sort()).toEqual([f, d].sort())
    expect(readFileSync(f, 'utf8')).toBe('file body')
    expect(readFileSync(join(d, 'inner', 'deep.txt'), 'utf8')).toBe('deep')
    expect(left(binC)).toEqual([])
  })

  it('restores a v1 record too', async () => {
    const f = join(orig, 'old.txt')
    const r = put(binC, 'CCCCCC', f, { v1: true })
    expect((await restoreItems(env(), [r], 'ask')).restored).toEqual([f])
    expect(existsSync(f)).toBe(true)
  })

  it('makes a missing original folder', async () => {
    const f = join(orig, 'gone', 'deeper', 'a.txt')
    const r = put(binC, 'DDDDDD', f)
    expect((await restoreItems(env(), [r], 'ask')).ok).toBe(true)
    expect(existsSync(f)).toBe(true)
  })

  it('reports a clash with ask and moves nothing', async () => {
    const f = join(orig, 'a.txt')
    const g = join(orig, 'free.txt')
    writeFileSync(f, 'there')
    const rf = put(binC, 'AAAAAA', f, { body: 'binned' })
    const rg = put(binC, 'GGGGGG', g)
    const r = await restoreItems(env(), [rf, rg], 'ask')
    expect(r.ok).toBe(false)
    expect(r.clashes).toEqual([{ path: rf, name: 'a.txt' }])
    expect(r.restored).toEqual([])
    expect(readFileSync(f, 'utf8')).toBe('there')
    expect(existsSync(g)).toBe(false)
    expect(left(binC)).toHaveLength(4)
  })

  it('keeps both on a clash: the restored one is name (2)', async () => {
    const f = join(orig, 'a.txt')
    writeFileSync(f, 'there')
    const rf = put(binC, 'AAAAAA', f, { body: 'binned' })
    const r = await restoreItems(env(), [rf], 'keep-both')
    expect(r.restored).toEqual([join(orig, 'a (2).txt')])
    expect(readFileSync(f, 'utf8')).toBe('there')
    expect(readFileSync(join(orig, 'a (2).txt'), 'utf8')).toBe('binned')
    expect(left(binC)).toEqual([])
  })

  it('replaces on request: the old one goes to the bin first', async () => {
    const f = join(orig, 'a.txt')
    writeFileSync(f, 'old')
    const rf = put(binC, 'AAAAAA', f, { body: 'binned' })
    const r = await restoreItems(env(), [rf], 'replace')
    expect(r.restored).toEqual([f])
    expect(r.replaced).toEqual([f])
    expect(trashed).toEqual([f])
    expect(readFileSync(f, 'utf8')).toBe('binned')
    // the old copy is in the fake bin now, with its own pair
    const names = left(binC)
    expect(names.filter((n) => n.startsWith('$R'))).toHaveLength(1)
    expect(readFileSync(join(binC, names.find((n) => n.startsWith('$R'))!), 'utf8')).toBe('old')
  })

  it('two binned copies of one path in one batch do not eat each other', async () => {
    const f = join(orig, 'a.txt')
    const r1 = put(binC, 'AAAAAA', f, { body: 'one' })
    const r2 = put(binC, 'BBBBBB', f, { body: 'two' })
    expect((await restoreItems(env(), [r1, r2], 'ask')).clashes).toHaveLength(1)
    const r = await restoreItems(env(), [r1, r2], 'replace')
    expect(r.restored.sort()).toEqual([f, join(orig, 'a (2).txt')].sort())
    expect(trashed).toEqual([])
    expect(readFileSync(f, 'utf8')).toBe('one')
    expect(readFileSync(join(orig, 'a (2).txt'), 'utf8')).toBe('two')
  })

  it('a restore that fails leaves the item in the bin and says so', async () => {
    const blocker = join(orig, 'blocker')
    writeFileSync(blocker, 'a file where a folder is needed')
    const bad = put(binC, 'AAAAAA', join(blocker, 'x.txt'))
    const good = put(binC, 'BBBBBB', join(orig, 'ok.txt'))
    const r = await restoreItems(env(), [bad, good], 'ask')
    expect(r.ok).toBe(false)
    expect(r.failed).toEqual([bad])
    expect(r.left).toEqual([bad])
    expect(r.restored).toEqual([join(orig, 'ok.txt')])
    expect(existsSync(bad)).toBe(true)
    expect(existsSync(join(binC, '$IAAAAAA.txt'))).toBe(true)
  })

  it('refuses a path that is not in the granted set, and one outside the bin folders', async () => {
    const f = join(orig, 'a.txt')
    const inBin = put(binC, 'AAAAAA', f)
    granted = new Set()
    const r = await restoreItems(env(), [inBin], 'ask')
    expect(r).toMatchObject({ ok: false, refused: true, restored: [], left: [inBin] })
    expect(existsSync(f)).toBe(false)
    // granted, but its parent is not one of the bin folders
    const stray = join(tmp, '$RZZZZZZ.txt')
    writeFileSync(stray, 'z')
    writeFileSync(join(tmp, '$IZZZZZZ.txt'), record(join(orig, 'z.txt')))
    granted = null
    const r2 = await restoreItems(env(), [stray], 'ask')
    expect(r2).toMatchObject({ ok: false, refused: true, left: [stray] })
    expect(existsSync(join(orig, 'z.txt'))).toBe(false)
  })

  it('refuses a $R that is not a $R, and a record that points into a bin', async () => {
    const i = join(binC, '$IAAAAAA.txt')
    put(binC, 'AAAAAA', join(orig, 'a.txt'))
    expect((await restoreItems(env(), [i], 'ask')).refused).toBe(true)
    const into = put(binC, 'BBBBBB', join(binD, '$RFAKE.txt'))
    const r = await restoreItems(env(), [into], 'ask')
    expect(r.failed).toEqual([into])
    expect(existsSync(join(binD, '$RFAKE.txt'))).toBe(false)
  })

  it('a record it cannot parse fails that item only', async () => {
    const r = join(binC, '$RAAAAAA.txt')
    writeFileSync(r, 'x')
    writeFileSync(join(binC, '$IAAAAAA.txt'), Buffer.alloc(10))
    const ok = put(binC, 'BBBBBB', join(orig, 'b.txt'))
    const out = await restoreItems(env(), [r, ok], 'ask')
    expect(out.failed).toEqual([r])
    expect(out.restored).toEqual([join(orig, 'b.txt')])
  })

  it('Cancel stops between items and says what was done and what is left', async () => {
    const rs = [1, 2, 3, 4, 5, 6].map((n) => put(binC, `ID000${n}`, join(orig, `f${n}.txt`)))
    const ac = new AbortController()
    const ticks: Array<[number, number]> = []
    const r = await restoreItems(env(), rs, 'ask', ac.signal, (done, total) => {
      ticks.push([done, total])
      if (done === 2) ac.abort()
    })
    expect(r.cancelled).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.restored).toHaveLength(2)
    expect(r.left).toEqual(rs.slice(2))
    expect(ticks).toEqual([
      [1, 6],
      [2, 6]
    ])
    expect(existsSync(join(orig, 'f1.txt'))).toBe(true)
    expect(existsSync(join(orig, 'f3.txt'))).toBe(false)
    expect(existsSync(rs[2]!)).toBe(true)
  })

  it('an already aborted signal restores nothing', async () => {
    const r1 = put(binC, 'AAAAAA', join(orig, 'a.txt'))
    const ac = new AbortController()
    ac.abort()
    const r = await restoreItems(env(), [r1], 'ask', ac.signal)
    expect(r).toMatchObject({ cancelled: true, restored: [], left: [r1] })
  })

  it('does not follow a link in the bin', async () => {
    const target = join(orig, 'secret.txt')
    writeFileSync(target, 'secret')
    const link = join(binC, '$RLINKXX.txt')
    try {
      symlinkSync(target, link)
    } catch {
      return
    }
    writeFileSync(join(binC, '$ILINKXX.txt'), record(join(orig, 'out.txt')))
    const r = await restoreItems(env(), [link], 'ask')
    expect(r.ok).toBe(false)
    expect(existsSync(join(orig, 'out.txt'))).toBe(false)
    expect(readFileSync(target, 'utf8')).toBe('secret')
  })

  it('waits the seam delay per item', async () => {
    const rs = [1, 2, 3].map((n) => put(binC, `SL000${n}`, join(orig, `s${n}.txt`)))
    const t0 = Date.now()
    await restoreItems(env({ slowMs: 40 }), rs, 'ask')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100)
  })
})

describe('deleteItems', () => {
  it('removes the $R (a file and a folder tree) and its $I', async () => {
    const rf = put(binC, 'AAAAAA', join(orig, 'a.txt'))
    const rd = put(binD, 'BBBBBB', join(orig, 'proj'), { folder: true })
    const keep = put(binC, 'KEEPKE', join(orig, 'k.txt'))
    const r = await deleteItems(env(), [rf, rd])
    expect(r).toMatchObject({ ok: true, deleted: 2, left: [], cancelled: false })
    expect(left(binC)).toEqual([`$IKEEPKE.txt`, `$RKEEPKE.txt`])
    expect(left(binD)).toEqual([])
    expect(existsSync(keep)).toBe(true)
    // it is gone for good: nothing was restored or trashed
    expect(existsSync(join(orig, 'a.txt'))).toBe(false)
    expect(trashed).toEqual([])
  })

  it('refuses what is not granted or not in a bin folder, and deletes nothing of it', async () => {
    const inBin = put(binC, 'AAAAAA', join(orig, 'a.txt'))
    granted = new Set()
    expect(await deleteItems(env(), [inBin])).toMatchObject({ ok: false, refused: true, deleted: 0, left: [inBin] })
    expect(existsSync(inBin)).toBe(true)
    granted = null
    const outside = join(orig, '$Rsneaky.txt')
    writeFileSync(outside, 'keep me')
    expect(await deleteItems(env(), [outside, join(orig, 'a.txt'), '', 'relative\\$Rx'])).toMatchObject({
      ok: false,
      refused: true,
      deleted: 0
    })
    expect(readFileSync(outside, 'utf8')).toBe('keep me')
  })

  it('Cancel stops between items', async () => {
    const rs = [1, 2, 3, 4].map((n) => put(binC, `DL000${n}`, join(orig, `d${n}.txt`)))
    const ac = new AbortController()
    const r = await deleteItems(env(), rs, ac.signal, (done) => {
      if (done === 1) ac.abort()
    })
    expect(r).toMatchObject({ ok: false, cancelled: true, deleted: 1 })
    expect(r.left).toEqual(rs.slice(1))
    expect(left(binC)).toHaveLength(6)
  })
})

describe('emptyBin', () => {
  it('removes every pair on both drives and leaves desktop.ini', async () => {
    put(binC, 'AAAAAA', join(orig, 'a.txt'))
    put(binC, 'BBBBBB', join(orig, 'proj'), { folder: true })
    put(binD, 'CCCCCC', join(orig, 'c.png'))
    writeFileSync(join(binC, 'desktop.ini'), '[.ShellClassInfo]')
    writeFileSync(join(binD, 'desktop.ini'), '[.ShellClassInfo]')
    const ticks: Array<[number, number]> = []
    const r = await emptyBin(env(), undefined, (d, t) => ticks.push([d, t]))
    expect(r).toMatchObject({ ok: true, deleted: 3, left: [], cancelled: false })
    expect(left(binC)).toEqual(['desktop.ini'])
    expect(left(binD)).toEqual(['desktop.ini'])
    expect(ticks.at(-1)).toEqual([3, 3])
  })

  it('leaves an orphan half alone, and a drive without a bin folder is empty', async () => {
    writeFileSync(join(binC, '$ROrphan.txt'), 'x')
    writeFileSync(join(binC, '$IOnlyRc.txt'), record('C:\\x.txt'))
    const r = await emptyBin(env({ dirs: async () => [binC, join(tmp, 'E', 'nope')] }))
    expect(r).toMatchObject({ ok: true, deleted: 0 })
    expect(left(binC)).toEqual(['$IOnlyRc.txt', '$ROrphan.txt'])
  })

  it('takes what appears while it runs, in a second pass', async () => {
    put(binC, 'AAAAAA', join(orig, 'a.txt'))
    const r = await emptyBin(env(), undefined, (done) => {
      if (done === 1) put(binC, 'LATELY', join(orig, 'late.txt'))
    })
    expect(r.deleted).toBe(2)
    expect(left(binC)).toEqual([])
  })

  it('Cancel stops it and the rest stays', async () => {
    for (let n = 0; n < 60; n++) put(binC, `EM${String(n).padStart(4, '0')}`, join(orig, `e${n}.txt`))
    const ac = new AbortController()
    const r = await emptyBin(env(), ac.signal, (done) => {
      if (done >= 24) ac.abort()
    })
    expect(r.cancelled).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.deleted).toBeGreaterThanOrEqual(24)
    expect(r.deleted).toBeLessThan(60)
    expect(left(binC).filter((n) => n.startsWith('$R'))).toHaveLength(60 - r.deleted)
  })

  it('a pair it cannot delete is reported once and does not loop forever', async () => {
    put(binC, 'AAAAAA', join(orig, 'a.txt'))
    put(binC, 'BBBBBB', join(orig, 'b.txt'))
    const remove = vi.fn(async (p: string) => {
      if (p.includes('AAAAAA')) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      rmSync(p, { recursive: true, force: true })
    })
    const r = await emptyBin(env({ remove }))
    expect(r.ok).toBe(false)
    expect(r.deleted).toBe(1)
    expect(r.left).toEqual([join(binC, '$RAAAAAA.txt')])
    // tried once, not on every pass
    expect(remove.mock.calls.filter(([p]) => p.includes('AAAAAA'))).toHaveLength(1)
  })

  it('writes nothing outside the bin folders it was given', async () => {
    const f = put(binC, 'AAAAAA', join(orig, 'a.txt'))
    writeFileSync(join(orig, 'precious.txt'), 'p')
    await emptyBin(env())
    expect(existsSync(f)).toBe(false)
    expect(readFileSync(join(orig, 'precious.txt'), 'utf8')).toBe('p')
    expect(dirname(binC)).toContain('$Recycle.Bin')
  })
})
