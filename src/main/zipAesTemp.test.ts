import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// AES members go through 7-Zip into a temp folder. The decrypted copy must not
// outlive the job (audit #16). 7-Zip is faked: it writes the member where the
// real one would, and the test records the folder it was asked to write to.
const outDirs: string[] = []
vi.mock('./spawnWorker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./spawnWorker')>()),
  execFile: (_exe: string, args: string[], _o: unknown, cb: (e: null, o: string, s: string) => void) => {
    const dir = String(args.find((a) => a.startsWith('-o'))).slice(2)
    outDirs.push(dir)
    const name = String(args[args.length - 1]).split('/').pop() as string
    void mkdir(dir, { recursive: true })
      .then(() => writeFile(join(dir, name), 'top secret'))
      .then(() => cb(null, '', ''))
  }
}))

import { extractTo } from './archive'
import { renameMember } from './zipOps'
import { setSevenExe } from './zipShared'

const aes = join(__dirname, 'fixtures', 'aes.zip')
let copy: string

beforeEach(() => {
  outDirs.length = 0
  setSevenExe('C:\\fake\\7z.exe')
  copy = join(mkdtempSync(join(tmpdir(), 'prism-aesleak-')), 'c.zip')
  writeFileSync(copy, readFileSync(aes))
})
afterEach(() => setSevenExe(null))

describe('a decrypted AES member does not stay in temp (audit #16)', () => {
  it('extracting out removes the 7-Zip folder', async () => {
    const out = mkdtempSync(join(tmpdir(), 'prism-aesout-'))
    const r = await extractTo(copy, ['secret.txt'], out, 'letmein')
    expect(r).toMatchObject({ ok: true, written: 1 })
    expect(readFileSync(join(out, 'secret.txt'), 'utf8')).toBe('top secret')
    expect(outDirs).toHaveLength(1)
    expect(existsSync(outDirs[0])).toBe(false)
  })

  it('renaming removes the 7-Zip folder', async () => {
    expect(await renameMember(copy, 'secret.txt', 'renamed.txt', 'letmein')).toBe('ok')
    expect(outDirs).toHaveLength(1)
    expect(existsSync(outDirs[0])).toBe(false)
  })
})