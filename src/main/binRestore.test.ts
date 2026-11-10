import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseInfo, restoreFromBin, sidOf } from './binRestore'

/** An `$I` record as Windows 8 and later write it. */
function infoV2(path: string, deletedAt: bigint): Buffer {
  const name = Buffer.from(path + '\0', 'utf16le')
  const head = Buffer.alloc(28)
  head.writeBigInt64LE(2n, 0)
  head.writeBigInt64LE(5n, 8)
  head.writeBigInt64LE(deletedAt, 16)
  head.writeInt32LE(path.length + 1, 24)
  return Buffer.concat([head, name])
}

/** A folder, a bin beside it, and `bin(id, path, at, body)` to bin a file. */
function world(): { dir: string; binDir: string; bin: (id: string, path: string, at: bigint, body: string) => void } {
  const root = mkdtempSync(join(tmpdir(), 'prism-bin-'))
  const dir = join(root, 'folder')
  const binDir = join(root, 'bin')
  mkdirSync(dir)
  mkdirSync(binDir)
  return {
    dir,
    binDir,
    bin: (id, path, at, body) => {
      writeFileSync(join(binDir, `$I${id}`), infoV2(path, at))
      writeFileSync(join(binDir, `$R${id}`), body)
    }
  }
}

describe('parseInfo', () => {
  it('reads the path and the time of a version 2 record', () => {
    expect(parseInfo(infoV2('C:\\a\\b.txt', 7n))).toEqual({ path: 'C:\\a\\b.txt', deletedAt: 7n, size: 5n })
  })

  it('reads a version 1 record (a fixed 260-char path)', () => {
    const b = Buffer.alloc(24 + 520)
    b.writeBigInt64LE(1n, 0)
    b.writeBigInt64LE(42n, 8)
    b.writeBigInt64LE(3n, 16)
    b.write('C:\\old.txt', 24, 'utf16le')
    expect(parseInfo(b)).toEqual({ path: 'C:\\old.txt', deletedAt: 3n, size: 42n })
  })

  it('answers null for anything else', () => {
    expect(parseInfo(Buffer.alloc(0))).toBeNull()
    expect(parseInfo(Buffer.alloc(40))).toBeNull()
    // A cut-off version 2 record, and a version nobody wrote.
    expect(parseInfo(infoV2('C:\\a\\b.txt', 7n).subarray(0, 34))).toBeNull()
    const odd = infoV2('C:\\a\\b.txt', 7n)
    odd.writeBigInt64LE(3n, 0)
    expect(parseInfo(odd)).toBeNull()
  })
})

describe('restoreFromBin', () => {
  it('puts the latest copy binned from that path back and drops its record', async () => {
    const w = world()
    const p = join(w.dir, 'bravo.txt')
    w.bin('AAA.txt', p, 1n, 'older')
    w.bin('BBB.txt', p, 2n, 'newer')
    w.bin('CCC.txt', join(w.dir, 'other.txt'), 9n, 'other')
    expect(await restoreFromBin(p, [w.binDir])).toBe(true)
    expect(readFileSync(p, 'utf8')).toBe('newer')
    expect(existsSync(join(w.binDir, '$IBBB.txt'))).toBe(false)
    expect(existsSync(join(w.binDir, '$IAAA.txt'))).toBe(true)
    expect(existsSync(join(w.binDir, '$RCCC.txt'))).toBe(true)
  })

  it('matches the path whatever its capitalisation', async () => {
    const w = world()
    const p = join(w.dir, 'Bravo.TXT')
    w.bin('AAA.TXT', p.toLowerCase(), 1n, 'x')
    expect(await restoreFromBin(p, [w.binDir])).toBe(true)
  })

  it('brings a folder back', async () => {
    const w = world()
    const p = join(w.dir, 'made')
    writeFileSync(join(w.binDir, '$IDDD'), infoV2(p, 1n))
    mkdirSync(join(w.binDir, '$RDDD'))
    writeFileSync(join(w.binDir, '$RDDD', 'in.txt'), 'in')
    expect(await restoreFromBin(p, [w.binDir])).toBe(true)
    expect(readFileSync(join(p, 'in.txt'), 'utf8')).toBe('in')
  })

  it('leaves it to the shell when the name is taken, the copy is gone or none matches', async () => {
    const w = world()
    const p = join(w.dir, 'bravo.txt')
    w.bin('AAA.txt', p, 1n, 'binned')
    writeFileSync(p, 'new one')
    expect(await restoreFromBin(p, [w.binDir])).toBe(false)
    expect(readFileSync(p, 'utf8')).toBe('new one')
    // A record whose file was already taken back (Explorer leaves these).
    writeFileSync(join(w.binDir, '$IEEE.txt'), infoV2(join(w.dir, 'gone.txt'), 1n))
    expect(await restoreFromBin(join(w.dir, 'gone.txt'), [w.binDir])).toBe(false)
    expect(await restoreFromBin(join(w.dir, 'never.txt'), [w.binDir])).toBe(false)
  })

  it('never moves a link out of the bin', async () => {
    const w = world()
    const p = join(w.dir, 'linked.txt')
    const target = join(w.dir, 'elsewhere.txt')
    writeFileSync(target, 'not binned')
    writeFileSync(join(w.binDir, '$ILLL.txt'), infoV2(p, 1n))
    try {
      symlinkSync(target, join(w.binDir, '$RLLL.txt'), 'file')
    } catch {
      return // no right to make links here
    }
    expect(await restoreFromBin(p, [w.binDir])).toBe(false)
    expect(existsSync(p)).toBe(false)
  })
})

describe('sidOf', () => {
  it("reads the SID out of whoami's csv", () => {
    expect(sidOf('"desktop-1\\admin","S-1-5-21-111-222-333-1001"\r\n')).toBe('S-1-5-21-111-222-333-1001')
    expect(sidOf('')).toBeNull()
  })
})
