import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { extractTo } from './archive'
import { listArchive } from './zipOps'

// What stays on main: extracting members OUT, read with fs/promises and
// inflated on the libuv pool (#166). The worker's verbs are in zipOps.test.ts,
// the client in zipClient.test.ts.

let zipPath: string

beforeEach(() => {
  const zip = new AdmZip()
  zip.addFile('readme.txt', Buffer.from('hello'))
  zip.addFile('docs/guide.md', Buffer.from('# guide'))
  zip.addFile('docs/img/logo.png', Buffer.from([0x89, 0x50]))
  zipPath = join(mkdtempSync(join(tmpdir(), 'prism-archive-test-')), 'a.zip')
  zip.writeZip(zipPath)
})

describe('extracting out (#70)', () => {
  it('extracts members out to a real folder, keeping the shape under a folder', async () => {
    const out = mkdtempSync(join(tmpdir(), 'prism-out-'))
    const r = await extractTo(zipPath, ['docs'], out)
    expect(r).toEqual({ ok: true, written: 2, paths: [join(out, 'docs')] })
    expect(readFileSync(join(out, 'docs', 'guide.md'), 'utf8')).toBe('# guide')
    expect(existsSync(join(out, 'docs', 'img', 'logo.png'))).toBe(true)
  })

  it('extracts EVERYTHING when handed the top-level entries', async () => {
    // What "Extract all" does: the roots of the tree cover every member,
    // because extractTo matches by prefix. If this ever stopped being true,
    // the verb would quietly leave files behind.
    const out = mkdtempSync(join(tmpdir(), 'prism-all-'))
    const tops = listArchive(zipPath)
      .filter((e) => !e.path.includes('/'))
      .map((e) => e.path)
    expect(tops.sort()).toEqual(['docs', 'readme.txt'])
    const r = await extractTo(zipPath, tops, out)
    expect(r).toMatchObject({ ok: true, written: 3 })
    expect(r.ok && [...r.paths].sort()).toEqual([join(out, 'docs'), join(out, 'readme.txt')])
    expect(existsSync(join(out, 'readme.txt'))).toBe(true)
    expect(existsSync(join(out, 'docs', 'guide.md'))).toBe(true)
    expect(existsSync(join(out, 'docs', 'img', 'logo.png'))).toBe(true)
  })

  it('needs the password to extract an encrypted member out', async () => {
    const crypto = join(__dirname, 'fixtures', 'crypto.zip')
    const out = mkdtempSync(join(tmpdir(), 'prism-out2-'))
    expect(await extractTo(crypto, ['secret.txt'], out)).toEqual({ ok: false, reason: 'password' })
    expect(await extractTo(crypto, ['secret.txt'], out, 'letmein')).toEqual({
      ok: true,
      written: 1,
      paths: [join(out, 'secret.txt')]
    })
    expect(readFileSync(join(out, 'secret.txt'), 'utf8')).toBe('top secret')
  })

  // #70: what landed is marked (#101), so the answer names each top-level
  // arrival as written, after a taken name became "name (2)".
  it('names what landed, a taken name as its "(2)"', async () => {
    const out = mkdtempSync(join(tmpdir(), 'prism-paths-'))
    writeFileSync(join(out, 'readme.txt'), 'mine')
    mkdirSync(join(out, 'docs'))
    const r = await extractTo(zipPath, ['readme.txt', 'docs'], out)
    expect(r.ok && [...r.paths].sort()).toEqual([join(out, 'docs'), join(out, 'readme (2).txt')])
    expect(readFileSync(join(out, 'readme.txt'), 'utf8')).toBe('mine')
  })
})

describe('zip slip', () => {
  it('drops members whose name would land outside the destination', async () => {
    const evil = new AdmZip()
    evil.addFile('../escape.txt', Buffer.from('nope'))
    evil.addFile('sub/../../escape2.txt', Buffer.from('nope'))
    evil.addFile('good.txt', Buffer.from('fine'))
    const zip = join(mkdtempSync(join(tmpdir(), 'prism-slip-')), 'evil.zip')
    evil.writeZip(zip)
    const home = mkdtempSync(join(tmpdir(), 'prism-slip-out-'))
    const dest = join(home, 'dest')
    mkdirSync(dest)
    const r = await extractTo(zip, ['../escape.txt', 'sub/../../escape2.txt', 'good.txt'], dest)
    expect(r).toMatchObject({ ok: true })
    expect(existsSync(join(home, 'escape.txt'))).toBe(false)
    expect(existsSync(join(home, 'escape2.txt'))).toBe(false)
    expect(readFileSync(join(dest, 'good.txt'), 'utf8')).toBe('fine')
  })
})

describe('extracting out, watched (#166)', () => {
  it('counts members written, and names each one, so the window has a real bar', async () => {
    const out = mkdtempSync(join(tmpdir(), 'prism-watch-'))
    const seen: Array<[number, string]> = []
    const r = await extractTo(zipPath, ['docs', 'readme.txt'], out, undefined, {
      onProgress: (pct, file) => seen.push([pct, file])
    })
    expect(r).toMatchObject({ ok: true, written: 3 })
    expect(seen.map(([p]) => p)).toEqual([33, 66, 100])
    expect(seen.map(([, f]) => f).sort()).toEqual(['docs/guide.md', 'docs/img/logo.png', 'readme.txt'])
  })

  it('a Cancel takes back what it wrote and NOTHING that was there before', async () => {
    const out = mkdtempSync(join(tmpdir(), 'prism-cancel-'))
    // The user's own folder and file, sharing names with what is coming.
    mkdirSync(join(out, 'docs'))
    writeFileSync(join(out, 'docs', 'guide.md'), 'MINE')
    writeFileSync(join(out, 'keep.txt'), 'untouched')
    let written = 0
    const r = await extractTo(zipPath, ['docs', 'readme.txt'], out, undefined, {
      onProgress: () => (written += 1),
      // Pressed while the second member is on its way.
      cancelled: () => written >= 2
    })
    expect(r).toEqual({ ok: false, reason: 'cancelled' })
    expect(written).toBe(2)
    expect(readFileSync(join(out, 'docs', 'guide.md'), 'utf8')).toBe('MINE')
    expect(readFileSync(join(out, 'keep.txt'), 'utf8')).toBe('untouched')
    // The member that clashed had landed as "guide (2).md"; it is gone again,
    // and so is the folder the extraction created inside the user's own.
    expect(existsSync(join(out, 'docs', 'guide (2).md'))).toBe(false)
    expect(existsSync(join(out, 'docs', 'img'))).toBe(false)
    expect(existsSync(join(out, 'readme.txt'))).toBe(false)
    expect(existsSync(join(out, 'docs'))).toBe(true)
  })

  it('a Cancel before the first member writes nothing at all', async () => {
    const out = mkdtempSync(join(tmpdir(), 'prism-cancel0-'))
    const r = await extractTo(zipPath, ['docs'], out, undefined, { cancelled: () => true })
    expect(r).toEqual({ ok: false, reason: 'cancelled' })
    expect(existsSync(join(out, 'docs'))).toBe(false)
  })

  it('a corrupt member fails the extraction instead of taking the process down', async () => {
    // Deflated data, so it takes the off-thread inflate. adm-zip's own async
    // inflater has no error listener, which is why Prism does not use it.
    const zip = new AdmZip()
    zip.addFile('big.txt', Buffer.from('compress me '.repeat(500)))
    const bad = join(mkdtempSync(join(tmpdir(), 'prism-bad-')), 'bad.zip')
    zip.writeZip(bad)
    const raw = readFileSync(bad)
    // Stamp on the member's data, which starts after the 30-byte local header
    // and the 7-byte name.
    raw.fill(0xff, 40, 60)
    writeFileSync(bad, raw)
    const out = mkdtempSync(join(tmpdir(), 'prism-bad-out-'))
    expect(await extractTo(bad, ['big.txt'], out)).toEqual({ ok: false, reason: 'failed' })
  })

  it('a member that fails leaves no empty folder behind in the destination', async () => {
    // The folder used to be made just before the write. Moved ahead of the
    // read (so a Cancel could account for it), a member that could not be
    // read, which is what a wrong or missing password is every time, left an
    // empty "sub" in a folder of the user's own choosing, with nothing to say
    // where it came from.
    const zip = new AdmZip()
    zip.addFile('sub/big.txt', Buffer.from('compress me '.repeat(500)))
    const bad = join(mkdtempSync(join(tmpdir(), 'prism-bad-')), 'bad.zip')
    zip.writeZip(bad)
    const raw = readFileSync(bad)
    // The data starts after the 30-byte local header and the 11-byte name.
    raw.fill(0xff, 44, 64)
    writeFileSync(bad, raw)
    const out = mkdtempSync(join(tmpdir(), 'prism-bad-out-'))
    expect(await extractTo(bad, ['sub'], out)).toEqual({ ok: false, reason: 'failed' })
    expect(existsSync(join(out, 'sub'))).toBe(false)
  })

  it('a deflated member comes out byte for byte', async () => {
    const zip = new AdmZip()
    const body = Buffer.from('the same line again and again\n'.repeat(2000))
    zip.addFile('log.txt', body)
    const z = join(mkdtempSync(join(tmpdir(), 'prism-defl-')), 'd.zip')
    zip.writeZip(z)
    const out = mkdtempSync(join(tmpdir(), 'prism-defl-out-'))
    expect(await extractTo(z, ['log.txt'], out)).toMatchObject({ ok: true, written: 1 })
    expect(readFileSync(join(out, 'log.txt')).equals(body)).toBe(true)
  })
})
