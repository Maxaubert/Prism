import { existsSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { ZipStage } from './zipStage'

// ZIP A TO ZIP B STAGES IN THE RUN'S MEMBER FOLDER (#70 D9, review of
// 2026-11-01): the members go out to a staging folder main names and owns,
// and it goes as soon as the add is over. The old route left a
// `prism-arcdir-*` folder in temp per folder member, for good.
describe('ZipStage', () => {
  const run = (): string => join(mkdtempSync(join(tmpdir(), 'prism-stage-test-')), 'run')

  it('makes a fresh folder inside the run folder each time', async () => {
    const dir = run()
    const stage = new ZipStage(dir)
    const a = await stage.make()
    const b = await stage.make()
    expect(a).not.toBe(b)
    expect(a.startsWith(dir)).toBe(true)
    expect(existsSync(a) && existsSync(b)).toBe(true)
  })

  it('drops a folder it made, with what is in it', async () => {
    const stage = new ZipStage(run())
    const a = await stage.make()
    writeFileSync(join(a, 'one.txt'), 'x')
    expect(await stage.drop(a)).toBe(true)
    expect(existsSync(a)).toBe(false)
    expect(await stage.drop(a)).toBe(false)
  })

  it('never drops a folder it did not make', async () => {
    const other = mkdtempSync(join(tmpdir(), 'prism-stage-other-'))
    const stage = new ZipStage(run())
    expect(await stage.drop(other)).toBe(false)
    expect(await stage.drop(42)).toBe(false)
    expect(existsSync(other)).toBe(true)
  })
})
