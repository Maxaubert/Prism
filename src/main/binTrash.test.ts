import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseInfo } from './binRestore'
import { createBinReader } from './binList'
import { trashInto, trashItem } from './binTrash'

// The e2e seam's "move to the Recycle Bin": every delete, replace and undo in a
// seam run lands in the fake bin, in the real `$I`/`$R` format, so nothing a
// scenario does can reach the owner's real bin (D22).
let tmp: string
let bin: string
beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'prism-bintrash-')))
  bin = join(tmp, 'C', '$Recycle.Bin', 'S-1-5-21-1-2-3-1001')
  mkdirSync(bin, { recursive: true })
})
afterEach(() => {
  process.argv = process.argv.filter((a) => a !== '--e2e')
  delete process.env.PRISM_E2E_BIN_DIRS
  rmSync(tmp, { recursive: true, force: true })
})

describe('trashInto', () => {
  it('moves a file into the bin as a $R with a v2 $I that says where it came from', async () => {
    const f = join(tmp, 'docs', 'note.txt')
    mkdirSync(join(tmp, 'docs'))
    writeFileSync(f, 'hello')
    await trashInto([bin], f)
    const names = readdirSync(bin)
    const r = names.find((n) => n.startsWith('$R'))!
    const i = names.find((n) => n.startsWith('$I'))!
    expect(r.slice(2)).toBe(i.slice(2))
    expect(r.endsWith('.txt')).toBe(true)
    expect(readFileSync(join(bin, r), 'utf8')).toBe('hello')
    const info = parseInfo(readFileSync(join(bin, i)))
    expect(info?.path).toBe(f)
    expect(info?.size).toBe(5n)
    expect(Math.abs(Date.now() - Number(info!.deletedAt / 10000n - 11644473600000n))).toBeLessThan(5000)
    // the file is gone from where it was
    expect(readdirSync(join(tmp, 'docs'))).toEqual([])
  })

  it('moves a folder, and the reader lists it as a folder', async () => {
    const d = join(tmp, 'proj')
    mkdirSync(join(d, 'sub'), { recursive: true })
    writeFileSync(join(d, 'sub', 'a.txt'), 'abc')
    await trashInto([bin], d)
    const { rows } = await createBinReader().read([bin])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'proj', from: tmp, folder: true, size: 3 })
  })

  it('two items of one name get two ids', async () => {
    for (let n = 0; n < 2; n++) {
      const f = join(tmp, 'same.txt')
      writeFileSync(f, String(n))
      await trashInto([bin], f)
    }
    expect(readdirSync(bin).filter((n) => n.startsWith('$R'))).toHaveLength(2)
  })

  it('picks the bin on the same drive as the item', async () => {
    const other = join(tmp, 'D', '$Recycle.Bin', 'S-1')
    mkdirSync(other, { recursive: true })
    // both fixtures share a drive here, so the first listed folder is the pick
    const f = join(tmp, 'x.txt')
    writeFileSync(f, 'x')
    await trashInto([bin, other], f)
    expect(readdirSync(bin).length).toBe(2)
    expect(readdirSync(other).length).toBe(0)
  })

  it('throws when there is no bin folder, rather than deleting for good', async () => {
    const f = join(tmp, 'keep.txt')
    writeFileSync(f, 'k')
    await expect(trashInto([], f)).rejects.toThrow()
    expect(readFileSync(f, 'utf8')).toBe('k')
  })
})

describe('trashItem', () => {
  it('uses the real trash without the seam', async () => {
    const real = vi.fn(async () => {})
    await trashItem('C:\\x\\y.txt', real)
    expect(real).toHaveBeenCalledWith('C:\\x\\y.txt')
  })

  it('never calls the real trash under the seam', async () => {
    process.argv = [...process.argv, '--e2e']
    process.env.PRISM_E2E_BIN_DIRS = bin
    const real = vi.fn(async () => {})
    const f = join(tmp, 'seam.txt')
    writeFileSync(f, 's')
    await trashItem(f, real)
    expect(real).not.toHaveBeenCalled()
    expect(readdirSync(bin).some((n) => n.startsWith('$R'))).toBe(true)
  })
})
