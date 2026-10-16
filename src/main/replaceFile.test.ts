import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A disk that fills up part way through a write, on demand.
const fault = vi.hoisted(() => ({
  code: '' as string,
  when: (() => false) as (p: string) => boolean
}))
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>()
  return {
    ...real,
    writeFile: async (p: string, data: Uint8Array) => {
      if (fault.code && fault.when(String(p))) {
        // Truncate-then-fail, the way a full disk leaves a file.
        await real.writeFile(p, data.subarray(0, 1))
        throw Object.assign(new Error(fault.code), { code: fault.code })
      }
      return real.writeFile(p, data)
    }
  }
})

const { replaceFile } = await import('./replaceFile')

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prism-replace-'))
  fault.code = ''
  fault.when = () => false
})

describe('replaceFile (2026-10-16)', () => {
  it('writes the bytes and leaves no tmp file behind', async () => {
    const f = join(dir, 'run.bat')
    writeFileSync(f, 'old')
    await replaceFile(f, Buffer.from('new\r\n'))
    expect(readFileSync(f, 'utf8')).toBe('new\r\n')
    expect(readdirSync(dir)).toEqual(['run.bat'])
  })

  it('leaves the original whole when the disk fills mid-write', async () => {
    const f = join(dir, 'notes.txt')
    writeFileSync(f, 'the original document')
    fault.code = 'ENOSPC'
    fault.when = () => true
    await expect(replaceFile(f, Buffer.from('a much longer replacement'))).rejects.toThrow('ENOSPC')
    expect(readFileSync(f, 'utf8')).toBe('the original document')
    expect(readdirSync(dir)).toEqual(['notes.txt'])
  })

  it('writes in place where a file may not be made beside it', async () => {
    const f = join(dir, 'locked.txt')
    writeFileSync(f, 'old')
    fault.code = 'EACCES'
    fault.when = (p) => p !== f
    await replaceFile(f, Buffer.from('new'))
    expect(readFileSync(f, 'utf8')).toBe('new')
    expect(readdirSync(dir)).toEqual(['locked.txt'])
  })
})
