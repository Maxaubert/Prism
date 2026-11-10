import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DirChange } from '@shared/types'
import { BIN_PLACE } from '@shared/binPlace'
import { browseWatch } from './browse'
import { closeBinWatch, setBinWatch } from './binWatch'
import { resetDesktopAccess } from './desktopAccess'

let box = ''
let dirs: string[] = []
beforeEach(() => {
  box = mkdtempSync(join(tmpdir(), 'prism-binwatch-'))
  dirs = ['C', 'D'].map((d) => {
    const dir = join(box, d, '$Recycle.Bin', 'S-1-5-21-1-2-3-1001')
    mkdirSync(dir, { recursive: true })
    return dir
  })
  resetDesktopAccess()
})
afterEach(() => {
  closeBinWatch('t1')
  closeBinWatch('t2')
  resetDesktopAccess()
  rmSync(box, { recursive: true, force: true })
})

describe('binWatch (D9)', () => {
  it('reports { root, dirs } of the bin place when a pair appears in either fake drive', async () => {
    const changes: DirChange[] = []
    expect(await setBinWatch('t1', dirs, (c) => changes.push(c))).toBe(true)
    writeFileSync(join(dirs[1], '$IABC.txt'), 'x')
    await expect.poll(() => changes.length, { timeout: 3000 }).toBeGreaterThan(0)
    expect(changes[0]).toEqual({ root: BIN_PLACE, dirs: [BIN_PLACE] })
  })

  it('debounces a burst into one or two reports', async () => {
    const changes: DirChange[] = []
    await setBinWatch('t1', dirs, (c) => changes.push(c))
    for (let i = 0; i < 20; i++) writeFileSync(join(dirs[0], `$I${i}.txt`), 'x')
    await expect.poll(() => changes.length, { timeout: 3000 }).toBeGreaterThan(0)
    await new Promise((r) => setTimeout(r, 600))
    expect(changes.length).toBeLessThanOrEqual(2)
  })

  it('a bin folder that does not exist yet is skipped, not an error', async () => {
    const changes: DirChange[] = []
    const gone = join(box, 'Z', '$Recycle.Bin', 'S-none')
    expect(await setBinWatch('t1', [gone, dirs[0]], (c) => changes.push(c))).toBe(true)
    writeFileSync(join(dirs[0], '$IQ.txt'), 'x')
    await expect.poll(() => changes.length, { timeout: 3000 }).toBeGreaterThan(0)
  })

  it('stops after closeBinWatch', async () => {
    const changes: DirChange[] = []
    await setBinWatch('t1', dirs, (c) => changes.push(c))
    closeBinWatch('t1')
    writeFileSync(join(dirs[0], '$INO.txt'), 'x')
    await new Promise((r) => setTimeout(r, 700))
    expect(changes).toEqual([])
  })

  it('browseWatch routes the sentinel to it, and stopping the watch closes it', async () => {
    const seam = process.env.PRISM_E2E_BIN_DIRS
    const hadFlag = process.argv.includes('--e2e')
    process.env.PRISM_E2E_BIN_DIRS = dirs.join('|')
    if (!hadFlag) process.argv.push('--e2e')
    try {
      const changes: DirChange[] = []
      expect(await browseWatch('t2', BIN_PLACE, (c) => changes.push(c))).toBe(true)
      writeFileSync(join(dirs[0], '$IR.txt'), 'x')
      await expect.poll(() => changes.length, { timeout: 3000 }).toBeGreaterThan(0)
      expect(await browseWatch('t2', null, (c) => changes.push(c))).toBe(true)
      await new Promise((r) => setTimeout(r, 400))
      const before = changes.length
      writeFileSync(join(dirs[0], '$IS.txt'), 'x')
      await new Promise((r) => setTimeout(r, 700))
      expect(changes.length).toBe(before)
    } finally {
      if (seam === undefined) delete process.env.PRISM_E2E_BIN_DIRS
      else process.env.PRISM_E2E_BIN_DIRS = seam
      if (!hadFlag) process.argv.splice(process.argv.indexOf('--e2e'), 1)
    }
  })
})
