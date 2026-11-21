import { mkdtemp, mkdir, readdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

// A cut whose rename fails takes the copy fallback; the source is then removed.
// Here the rename always fails and removing the source hits a lock (audit #51).
vi.mock('./userFs', async (orig) => {
  const real = await orig<typeof import('./userFs')>()
  return {
    ...real,
    rename: vi.fn(async () => {
      throw Object.assign(new Error('cross device'), { code: 'EXDEV' })
    }),
    rm: vi.fn(async (p: string, o?: object) => {
      if (String(p).includes('locked')) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      return real.rm(p, o as never)
    })
  }
})

const { runPaste } = await import('./pasteJob')

describe('a cut whose source cannot be fully removed (audit #51)', () => {
  it('counts the copy as pasted and reports the leftover apart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prism-pasteleft-'))
    const src = join(root, 'locked-folder')
    const dest = join(root, 'dest')
    await mkdir(src)
    await mkdir(dest)
    await writeFile(join(src, 'a.txt'), 'one')
    const r = await runPaste(
      { send: () => {}, written: async () => {}, textShape: new Map() },
      dest,
      [src],
      true
    )
    expect(r).toMatchObject({ pasted: 1, failed: 0, paths: [join(dest, 'locked-folder')] })
    expect(r.failures).toBeUndefined()
    expect(r.left).toEqual([{ name: 'locked-folder', reason: 'EBUSY' }])
    expect(await readdir(join(dest, 'locked-folder'))).toEqual(['a.txt'])
  })
})
