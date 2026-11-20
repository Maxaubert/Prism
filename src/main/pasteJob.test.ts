import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { runPaste } from './pasteJob'

async function setup(): Promise<{ src: string; dest: string }> {
  const root = await mkdtemp(join(tmpdir(), 'prism-pastejob-'))
  const src = join(root, 'src')
  const dest = join(root, 'dest')
  await mkdir(src)
  await mkdir(dest)
  return { src, dest }
}

describe('runPaste (#538 item 15)', () => {
  it('copies into the folder, names clashes apart and reports what landed', async () => {
    const { src, dest } = await setup()
    await writeFile(join(src, 'a.txt'), 'one')
    await writeFile(join(dest, 'a.txt'), 'taken')
    const sent: unknown[] = []
    const wrote: string[] = []
    const r = await runPaste(
      {
        send: (_c, p) => void sent.push(p),
        written: async (...p) => void wrote.push(...p),
        textShape: new Map()
      },
      dest,
      [join(src, 'a.txt')],
      false,
      'job1'
    )
    expect(r.pasted).toBe(1)
    expect(r.failed).toBe(0)
    expect(r.moved).toBe(false)
    expect(r.paths).toEqual([join(dest, 'a (2).txt')])
    expect(await readFile(join(dest, 'a.txt'), 'utf8')).toBe('taken')
    expect(await readFile(join(dest, 'a (2).txt'), 'utf8')).toBe('one')
    // The first push names the rows that are about to land.
    expect(sent[0]).toMatchObject({ jobId: 'job1', pct: 0, start: { dir: dest } })
    expect(wrote).toEqual([dest])
  })

  it('a cut moves the file and tells the wall about the source too', async () => {
    const { src, dest } = await setup()
    await writeFile(join(src, 'b.txt'), 'two')
    const wrote: string[] = []
    const r = await runPaste(
      { send: () => {}, written: async (...p) => void wrote.push(...p), textShape: new Map() },
      dest,
      [join(src, 'b.txt')],
      true
    )
    expect(r).toMatchObject({ pasted: 1, failed: 0, moved: true, from: [join(src, 'b.txt')] })
    expect(await readdir(src)).toEqual([])
    expect(wrote).toEqual([dest, join(src, 'b.txt')])
  })

  it('a folder pasted into itself counts as failed and writes nothing', async () => {
    const { src } = await setup()
    const r = await runPaste(
      { send: () => {}, written: async () => {}, textShape: new Map() },
      join(src, 'inner'),
      [src],
      false
    )
    expect(r.pasted).toBe(0)
    expect(r.failed).toBe(1)
    expect(r.failures?.[0].reason).toBe('into itself')
  })
})
