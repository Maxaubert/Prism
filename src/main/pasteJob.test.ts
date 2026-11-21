import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPaste } from './pasteJob'
import { cancelCopies } from './copyJobs'

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

describe('runPaste names, throttle and cancel', () => {
  afterEach(() => vi.restoreAllMocks())

  it('predicts one name per source, apart from each other and from the folder', async () => {
    const { src, dest } = await setup()
    await mkdir(join(src, 'x'))
    await mkdir(join(src, 'y'))
    await writeFile(join(src, 'x', 'r.md'), 'x')
    await writeFile(join(src, 'y', 'r.md'), 'y')
    await writeFile(join(dest, 'r.md'), 'old')
    const sent: Array<{ start?: { items: Array<{ name: string }> } }> = []
    const r = await runPaste(
      { send: (_c, p) => void sent.push(p as never), written: async () => {}, textShape: new Map() },
      dest,
      [join(src, 'x', 'r.md'), join(src, 'y', 'r.md')],
      false,
      'names'
    )
    expect(sent[0].start?.items.map((i) => i.name)).toEqual(['r (2).md', 'r (3).md'])
    expect(r.paths).toEqual([join(dest, 'r (2).md'), join(dest, 'r (3).md')])
    expect(await readFile(join(dest, 'r (3).md'), 'utf8')).toBe('y')
  })

  it('says a landing at most once per tick and flushes the last one', async () => {
    const { src, dest } = await setup()
    const files = ['a', 'b', 'c'].map((n) => join(src, `${n}.txt`))
    for (const f of files) await writeFile(f, 'data')
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const sent: Array<{ item?: number }> = []
    await runPaste(
      { send: (_c, p) => void sent.push(p as never), written: async () => {}, textShape: new Map() },
      dest,
      files,
      false,
      'throttle'
    )
    const landings = sent.filter((m) => m.item !== undefined && !('start' in m))
    // The clock never moves: one landing is due, the rest wait, and the
    // last one is said once at the end.
    expect(landings.length).toBeLessThan(files.length)
    expect(landings[landings.length - 1].item).toBe(2)
  })

  it('stops between items when cancelled and reports it', async () => {
    const { src, dest } = await setup()
    const files = ['a', 'b'].map((n) => join(src, `${n}.txt`))
    for (const f of files) await writeFile(f, 'data')
    const r = await runPaste(
      {
        send: (_c, p) => {
          if ((p as { start?: unknown }).start) cancelCopies('cancel')
        },
        written: async () => {},
        textShape: new Map()
      },
      dest,
      files,
      false,
      'cancel'
    )
    expect(r.cancelled).toBe(true)
    expect(r.pasted).toBe(0)
    expect(await readdir(dest)).toEqual([])
  })
})