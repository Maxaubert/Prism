import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createBinReader, binListing } from './binList'

const EPOCH_DELTA = 11644473600000n
const ft = (ms: number): bigint => (BigInt(ms) + EPOCH_DELTA) * 10000n

function infoV2(path: string, ms: number, size = 5n): Buffer {
  const head = Buffer.alloc(28)
  head.writeBigInt64LE(2n, 0)
  head.writeBigInt64LE(size, 8)
  head.writeBigInt64LE(ft(ms), 16)
  head.writeInt32LE(path.length + 1, 24)
  return Buffer.concat([head, Buffer.from(path + '\0', 'utf16le')])
}

function infoV1(path: string, ms: number): Buffer {
  const b = Buffer.alloc(24 + 520)
  b.writeBigInt64LE(1n, 0)
  b.writeBigInt64LE(9n, 8)
  b.writeBigInt64LE(ft(ms), 16)
  b.write(path, 24, 'utf16le')
  return b
}

function bin(): { root: string; dir: string; put: (id: string, from: string, ms: number, body?: string) => void } {
  const root = mkdtempSync(join(tmpdir(), 'prism-binlist-'))
  const dir = join(root, '$Recycle.Bin', 'S-1-5-21-1-2-3-1001')
  mkdirSync(dir, { recursive: true })
  return {
    root,
    dir,
    put: (id, from, ms, body = 'x') => {
      writeFileSync(join(dir, `$I${id}`), infoV2(from, ms))
      if (body === 'dir') mkdirSync(join(dir, `$R${id}`))
      else writeFileSync(join(dir, `$R${id}`), body)
    }
  }
}

describe('createBinReader', () => {
  it('lists pairs with the original name, folder, date, size, kind and file-or-folder', async () => {
    const b = bin()
    b.put('AAA.jpg', 'C:\\Users\\m\\Pictures\\cat.jpg', 1_700_000_000_000)
    b.put('BBB', 'C:\\Users\\m\\Docs\\notes', 1_700_000_100_000, 'dir')
    const { rows, skipped } = await createBinReader().read([b.dir])
    expect(skipped).toBe(0)
    const cat = rows.find((r) => r.name === 'cat.jpg')!
    expect(cat).toMatchObject({
      from: 'C:\\Users\\m\\Pictures',
      deleted: 1_700_000_000_000,
      size: 5,
      folder: false,
      kind: 'image',
      path: join(b.dir, '$RAAA.jpg')
    })
    const notes = rows.find((r) => r.name === 'notes')!
    expect(notes).toMatchObject({ folder: true, from: 'C:\\Users\\m\\Docs' })
    rmSync(b.root, { recursive: true, force: true })
  })

  it('reads a version 1 record', async () => {
    const b = bin()
    writeFileSync(join(b.dir, '$IOLD.txt'), infoV1('C:\\old\\a.txt', 1_600_000_000_000))
    writeFileSync(join(b.dir, '$ROLD.txt'), 'x')
    const { rows } = await createBinReader().read([b.dir])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'a.txt', from: 'C:\\old', deleted: 1_600_000_000_000 })
    rmSync(b.root, { recursive: true, force: true })
  })

  it('lists only pairs: an orphan $R, an orphan $I and desktop.ini are skipped', async () => {
    const b = bin()
    b.put('PAIR.txt', 'C:\\a\\pair.txt', 1000)
    writeFileSync(join(b.dir, '$RLONE.txt'), 'x')
    writeFileSync(join(b.dir, '$ILONE2.txt'), infoV2('C:\\a\\lone2.txt', 1000))
    writeFileSync(join(b.dir, 'desktop.ini'), '[.ShellClassInfo]')
    const { rows } = await createBinReader().read([b.dir])
    expect(rows.map((r) => r.name)).toEqual(['pair.txt'])
    rmSync(b.root, { recursive: true, force: true })
  })

  it('skips a $R that is a symlink', async () => {
    const b = bin()
    writeFileSync(join(b.dir, '$ILINK.txt'), infoV2('C:\\a\\link.txt', 1000))
    writeFileSync(join(b.root, 'target.txt'), 'x')
    try {
      symlinkSync(join(b.root, 'target.txt'), join(b.dir, '$RLINK.txt'))
    } catch {
      rmSync(b.root, { recursive: true, force: true })
      return // no symlink right on this machine
    }
    const { rows } = await createBinReader().read([b.dir])
    expect(rows).toEqual([])
    rmSync(b.root, { recursive: true, force: true })
  })

  it('counts a record it cannot parse and does not list it', async () => {
    const b = bin()
    b.put('OK.txt', 'C:\\a\\ok.txt', 1000)
    writeFileSync(join(b.dir, '$IBAD.txt'), Buffer.alloc(10))
    writeFileSync(join(b.dir, '$RBAD.txt'), 'x')
    const { rows, skipped } = await createBinReader().read([b.dir])
    expect(rows.map((r) => r.name)).toEqual(['ok.txt'])
    expect(skipped).toBe(1)
    rmSync(b.root, { recursive: true, force: true })
  })

  it('joins two drives and treats a missing bin folder as empty', async () => {
    const a = bin()
    const c = bin()
    a.put('A1.txt', 'C:\\a\\one.txt', 1000)
    c.put('C1.txt', 'D:\\c\\two.txt', 2000)
    const { rows } = await createBinReader().read([a.dir, join(a.root, 'nothing', 'here'), c.dir])
    expect(rows.map((r) => r.name).sort()).toEqual(['one.txt', 'two.txt'])
    rmSync(a.root, { recursive: true, force: true })
    rmSync(c.root, { recursive: true, force: true })
  })

  it('a warm read reads only the new names and forgets what is gone', async () => {
    const b = bin()
    b.put('A.txt', 'C:\\a\\a.txt', 1000)
    b.put('B.txt', 'C:\\a\\b.txt', 2000)
    const reads: string[] = []
    const reader = createBinReader(async (p) => {
      reads.push(p)
      return readFile(p)
    })
    await reader.read([b.dir])
    expect(reads).toHaveLength(2)
    reads.length = 0
    b.put('C.txt', 'C:\\a\\c.txt', 3000)
    rmSync(join(b.dir, '$IA.txt'))
    rmSync(join(b.dir, '$RA.txt'))
    const { rows } = await reader.read([b.dir])
    expect(reads).toEqual([join(b.dir, '$IC.txt')])
    expect(rows.map((r) => r.name).sort()).toEqual(['b.txt', 'c.txt'])
    reader.clear()
    reads.length = 0
    await reader.read([b.dir])
    expect(reads).toHaveLength(2)
    rmSync(b.root, { recursive: true, force: true })
  })

  it('reads 10,000 pairs fast (the number goes in docs/features.md)', async () => {
    const b = bin()
    for (let i = 0; i < 10_000; i++) {
      const id = `X${String(i).padStart(5, '0')}.txt`
      writeFileSync(join(b.dir, `$I${id}`), infoV2(`C:\\big\\file${i}.txt`, 1_700_000_000_000 + i))
      writeFileSync(join(b.dir, `$R${id}`), 'x')
    }
    const reader = createBinReader()
    const t0 = performance.now()
    const cold = await reader.read([b.dir])
    const coldMs = performance.now() - t0
    const t1 = performance.now()
    await reader.read([b.dir])
    const warmMs = performance.now() - t1
    console.log(`bin 10000 pairs: cold ${coldMs.toFixed(0)} ms, warm ${warmMs.toFixed(0)} ms`)
    expect(cold.rows).toHaveLength(10_000)
    expect(coldMs).toBeLessThan(5000)
    rmSync(b.root, { recursive: true, force: true })
  }, 60_000)
})

describe('binListing (stage 2: the bin as a DirListing)', () => {
  it('is a complete listing flagged bin, files and folders split, each carrying where from and when', async () => {
    const b = bin()
    b.put('AAA.jpg', 'C:\\Users\\m\\Pictures\\cat.jpg', 1_700_000_000_000)
    b.put('BBB', 'C:\\Users\\m\\Docs\\notes', 1_700_000_100_000, 'dir')
    b.put('CCC.zzqq', 'C:\\x\\odd.zzqq', 1_700_000_200_000)
    const { listing, skipped } = await binListing([b.dir], createBinReader())
    expect(skipped).toBe(0)
    expect(listing.bin).toBe(true)
    expect(listing.complete).toBeUndefined()
    expect(listing.folders).toHaveLength(1)
    expect(listing.folders[0]).toMatchObject({
      path: join(b.dir, '$RBBB'),
      name: 'notes',
      mtimeMs: 1_700_000_100_000,
      binned: { from: 'C:\\Users\\m\\Docs', at: 1_700_000_100_000 }
    })
    const cat = listing.files.find((f) => f.name === 'cat.jpg')!
    expect(cat).toMatchObject({
      path: join(b.dir, '$RAAA.jpg'),
      ext: '.jpg',
      kind: 'image',
      size: 5,
      mtimeMs: 1_700_000_000_000,
      binned: { from: 'C:\\Users\\m\\Pictures', at: 1_700_000_000_000 }
    })
    // A kind Prism cannot show is still a row: it can be restored or deleted.
    expect(listing.files.map((f) => f.name)).toContain('odd.zzqq')
    expect(listing.hidden).toBeUndefined()
    rmSync(b.root, { recursive: true, force: true })
  })

  it('an empty bin is an empty bin listing', async () => {
    const b = bin()
    const { listing } = await binListing([b.dir], createBinReader())
    expect(listing).toEqual({ folders: [], files: [], bin: true })
    rmSync(b.root, { recursive: true, force: true })
  })

  it('grants the wall exactly the file entries it returned (D12): no folder, no $I', async () => {
    const b = bin()
    b.put('AAA.jpg', 'C:\\Users\\m\\Pictures\\cat.jpg', 1_700_000_000_000)
    b.put('BBB', 'C:\\Users\\m\\Docs\\notes', 1_700_000_100_000, 'dir')
    const granted: string[][] = []
    await binListing([b.dir], createBinReader(), async (paths) => void granted.push([...paths]))
    expect(granted).toEqual([[join(b.dir, '$RAAA.jpg')]])
    rmSync(b.root, { recursive: true, force: true })
  })

  it('an empty bin still replaces the grant, so it shrinks with the bin', async () => {
    const b = bin()
    const granted: string[][] = []
    await binListing([b.dir], createBinReader(), async (paths) => void granted.push([...paths]))
    expect(granted).toEqual([[]])
    rmSync(b.root, { recursive: true, force: true })
  })
})
