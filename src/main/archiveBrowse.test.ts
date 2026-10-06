import AdmZip from 'adm-zip'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { containerSync, createArchiveBrowse, createNewestFirst } from './archiveBrowse'
import { MemberTemp } from './memberTemp'

let box: string
let temp: MemberTemp
const passwords = new Map<string, string>()
const browse = () =>
  createArchiveBrowse({
    sevenExe: () => null,
    password: (c) => passwords.get(c) ?? '',
    remember: (c, p) => void passwords.set(c, p),
    temp
  })

beforeEach(() => {
  box = mkdtempSync(join(tmpdir(), 'prism-arcbrowse-'))
  temp = new MemberTemp(join(box, 'members'), 1, 1)
  passwords.clear()
})
afterEach(() => temp.removeRun())

function world(): string {
  const inner = new AdmZip()
  inner.addFile('docs/in.txt', Buffer.from('inner'))
  const zip = new AdmZip()
  zip.addFile('Wind/README.md', Buffer.from('# readme'))
  zip.addFile('Wind/src/a.ts', Buffer.from('a'.repeat(200)))
  zip.addFile('issue 10.txt', Buffer.from('10'))
  zip.addFile('issue 2.txt', Buffer.from('2'))
  zip.addFile('Wind/nested.zip', inner.toBuffer())
  const path = join(box, 'w.zip')
  zip.writeZip(path)
  return path
}

describe('places inside archives, main (#300)', () => {
  it('finds the container by a stat, and a folder named like a zip stays a folder', async () => {
    const zip = world()
    expect(containerSync(join(zip, 'Wind', 'src'))).toBe(zip)
    expect(containerSync(join(box, 'plain'))).toBeNull()
    mkdirSync(join(box, 'folder.zip', 'x'), { recursive: true })
    expect(containerSync(join(box, 'folder.zip', 'x'))).toBeNull()
    expect(await browse().resolve(join(box, 'folder.zip', 'x'))).toBeUndefined()
  })

  it('answers one level with sizes, packed sizes and folder totals, numeric order', async () => {
    const zip = world()
    const a = browse()
    const r = await a.resolve(zip)
    expect(r?.ok).toBe(true)
    if (!r?.ok) return
    const root = a.listing(r.place, 'explorer')
    expect(root.files.map((f) => f.name)).toEqual(['issue 2.txt', 'issue 10.txt'])
    expect(root.files.every((f) => f.member && typeof f.packed === 'number')).toBe(true)
    expect(root.folders.map((f) => f.name)).toEqual(['Wind'])
    expect(root.folders[0].size).toBeGreaterThan(200)
    expect(root.archive?.container).toBe(zip)
    expect(root.archive?.readOnly).toBe(false)
    const inside = await a.resolve(join(zip, 'Wind'))
    expect(inside?.ok && a.listing(inside.place, 'explorer').files.map((f) => f.path)).toEqual([
      join(zip, 'Wind', 'nested.zip'),
      join(zip, 'Wind', 'README.md')
    ])
  })

  it('refuses a folder that is not in the zip, and names the nearest that is', async () => {
    const zip = world()
    const r = await browse().resolve(join(zip, 'Wind', 'gone', 'deeper'))
    expect(r?.ok).toBe(false)
    if (r && !r.ok) {
      expect(r.reason).toBe('missing')
      expect(r.inner).toBe('Wind')
    }
  })

  it('opens a zip inside a zip, read-only, from the member folder', async () => {
    const zip = world()
    const a = browse()
    const r = await a.resolve(join(zip, 'Wind', 'nested.zip', 'docs'))
    expect(r?.ok).toBe(true)
    if (!r?.ok) return
    expect(r.place.nested).toBe(true)
    expect(temp.owns(r.place.real)).toBe(true)
    const meta = a.meta(r.place)
    expect(meta.readOnly).toBe(true)
    expect(meta.chain).toEqual([zip, join(zip, 'Wind', 'nested.zip')])
    expect(a.listing(r.place, 'explorer').files.map((f) => f.name)).toEqual(['in.txt'])
  })

  it('unpacks one member into the run folder, once', async () => {
    const zip = world()
    const a = browse()
    const one = await a.member(join(zip, 'Wind', 'README.md'))
    expect(one.ok).toBe(true)
    if (!one.ok) return
    expect(temp.owns(one.path)).toBe(true)
    expect(readFileSync(one.path, 'utf8')).toBe('# readme')
    const again = await a.member(join(zip, 'Wind', 'README.md'))
    expect(again.ok && again.path).toBe(one.path)
  })

  it('a changed container is read again', async () => {
    const zip = world()
    const a = browse()
    const r1 = await a.resolve(zip)
    expect(r1?.ok && a.listing(r1.place, 'explorer').files.length).toBe(2)
    const z = new AdmZip(zip)
    z.addFile('new.txt', Buffer.from('new'))
    z.writeZip(zip)
    const r2 = await a.resolve(zip)
    expect(r2?.ok && a.listing(r2.place, 'explorer').files.map((f) => f.name)).toContain('new.txt')
  })

  it('a damaged zip is a failure, never a throw', async () => {
    const bad = join(box, 'bad.zip')
    writeFileSync(bad, Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(40, 9)]))
    const r = await browse().resolve(bad)
    expect(r?.ok).toBe(false)
  })

  it('never lists a traversal name', async () => {
    const zip = new AdmZip()
    zip.addFile('ok.txt', Buffer.from('ok'))
    const path = join(box, 'evil.zip')
    zip.writeZip(path)
    // adm-zip normalises names it is handed, so the hostile one is patched in.
    const raw = readFileSync(path)
    const evil = Buffer.from(raw.toString('latin1').split('ok.txt').join('../e.t'), 'latin1')
    writeFileSync(path, evil)
    const a = browse()
    const r = await a.resolve(path)
    if (r?.ok) expect(a.listing(r.place, 'explorer').files.some((f) => f.name.includes('..'))).toBe(false)
  })

  it('searches the whole archive below a folder, from memory', async () => {
    const zip = world()
    const r = await browse().search(zip, 'a.ts')
    expect(r?.listing.files.map((f) => f.path)).toEqual([join(zip, 'Wind', 'src', 'a.ts')])
  })

  it('caps nesting', async () => {
    let buf = new AdmZip()
    buf.addFile('end.txt', Buffer.from('end'))
    for (let i = 0; i < 5; i++) {
      const outer = new AdmZip()
      outer.addFile('n.zip', buf.toBuffer())
      buf = outer
    }
    const path = join(box, 'deep.zip')
    buf.writeZip(path)
    const r = await browse().resolve(join(path, 'n.zip', 'n.zip', 'n.zip', 'n.zip'))
    expect(r?.ok).toBe(false)
    if (r && !r.ok) expect(r.reason).toBe('deep')
  })

  it('refuses to unpack a nested archive the temp drive has no room for', async () => {
    const zip = world()
    // Review of #300: a nested archive is unpacked whole on the way to its
    // listing, so a huge one must refuse rather than fill the drive.
    temp.room = async () => false
    const r = await browse().resolve(join(zip, 'Wind', 'nested.zip', 'docs'))
    expect(r?.ok).toBe(false)
    if (r && !r.ok) expect(r.reason).toBe('nest-big')
  })
})

describe('unpack slots (review of #300)', () => {
  it('runs at most N at once and the newest waiting one first', async () => {
    const run = createNewestFirst(1)
    const order: number[] = []
    let release!: () => void
    const first = run(
      () =>
        new Promise<void>((done) => {
          order.push(0)
          release = done
        })
    )
    const later = [1, 2, 3].map((n) => run(async () => void order.push(n)))
    await Promise.resolve()
    expect(order).toEqual([0])
    release()
    await Promise.all([first, ...later])
    expect(order).toEqual([0, 3, 2, 1])
  })
})
