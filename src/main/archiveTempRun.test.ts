import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { MemberTemp } from './memberTemp'

// Archive members and folders copied out of an archive are unpacked into the
// run's member folder, which quit and the next start remove. A folder of their
// own in %TEMP% was never removed (audit #15, #26).
describe('archive temp copies live in the run folder (audit #15, #26)', () => {
  it('a scratch folder is made inside the run folder, which removeRun removes', async () => {
    const box = mkdtempSync(join(tmpdir(), 'prism-scratch-'))
    const temp = new MemberTemp(join(box, 'prism-members'), 42, 7)
    const a = await temp.scratch('copy-')
    const b = await temp.scratch('copy-')
    expect(a).not.toBe(b)
    expect(a.startsWith(temp.dir)).toBe(true)
    expect(temp.owns(a)).toBe(true)
    expect(existsSync(a)).toBe(true)
    temp.removeRun()
    expect(existsSync(a)).toBe(false)
    expect(readdirSync(box)).toEqual(['prism-members'])
  })

  it('the archive handlers make no folder of their own in temp', () => {
    const src = readFileSync(join(__dirname, 'ipc', 'archive.ts'), 'utf8')
    expect(src).not.toMatch(/tmpdir\(\)/)
    expect(src).not.toMatch(/prism-arcdir-/)
    // extractSeven and the zip unpack are handed the member folder's slot.
    expect(src).toMatch(/extractSeven\(exe, p, entry, pw, dir\)/)
  })
})