import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exists, isBusyError, sleep } from './fsUtil'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prism-fsutil-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('fsUtil', () => {
  it('exists: a file and a folder are there, a missing path is not', async () => {
    writeFileSync(join(dir, 'a.txt'), 'x')
    expect(await exists(join(dir, 'a.txt'))).toBe(true)
    expect(await exists(dir)).toBe(true)
    expect(await exists(join(dir, 'gone.txt'))).toBe(false)
    expect(await exists(join(dir, 'gone', 'deeper.txt'))).toBe(false)
  })

  it('isBusyError: EBUSY and EPERM, nothing else', () => {
    const err = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })
    expect(isBusyError(err('EBUSY'))).toBe(true)
    expect(isBusyError(err('EPERM'))).toBe(true)
    expect(isBusyError(err('ENOENT'))).toBe(false)
    expect(isBusyError(null)).toBe(false)
    expect(isBusyError('EBUSY')).toBe(false)
  })

  it('sleep resolves after its wait', async () => {
    const start = Date.now()
    await sleep(20)
    expect(Date.now() - start).toBeGreaterThanOrEqual(15)
  })
})
