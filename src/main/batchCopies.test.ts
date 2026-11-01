import { describe, expect, it, vi } from 'vitest'
import { copyTarget, saveCopies, type CopiesDeps } from './batchCopies'

/** A fake disk: the files there, what was placed, and every call. */
function disk(files: string[], over: Partial<CopiesDeps> = {}): CopiesDeps & {
  there: Set<string>
  placed: string[]
  ticks: Array<[number, number]>
} {
  const there = new Set(files.map((f) => f.toLowerCase()))
  const placed: string[] = []
  const ticks: Array<[number, number]> = []
  const d = {
    there,
    placed,
    ticks,
    allowed: () => true,
    isFile: async (p: string) => !p.endsWith('folder'),
    convert: vi.fn(async () => true),
    exists: async (p: string) => there.has(p.toLowerCase()),
    place: vi.fn(async (_tmp: string, target: string) => {
      if (there.has(target.toLowerCase())) return 'taken' as const
      there.add(target.toLowerCase())
      placed.push(target)
      return 'ok' as const
    }),
    written: vi.fn(async () => {}),
    progress: (done: number, total: number) => void ticks.push([done, total]),
    tmp: 'T:\\job',
    signal: new AbortController().signal,
    ...over
  }
  return d
}

describe('Save copies as (#474)', () => {
  it('the copy goes next to its original, with the format\'s extension', async () => {
    const exists = async (): Promise<boolean> => false
    expect(await copyTarget('C:\\p\\IMG_0412.HEIC', 'jpeg', new Set(), exists)).toBe('C:\\p\\IMG_0412.jpg')
    expect(await copyTarget('C:\\p\\a.b.png', 'jxl', new Set(), exists)).toBe('C:\\p\\a.b.jxl')
  })

  it('a taken name becomes "name (2).ext", never an overwrite, the original included', async () => {
    const taken = new Set(['c:\\p\\a.jpg', 'c:\\p\\a (2).jpg'])
    const exists = async (p: string): Promise<boolean> => taken.has(p.toLowerCase())
    expect(await copyTarget('C:\\p\\a.png', 'jpeg', new Set(), exists)).toBe('C:\\p\\a (3).jpg')
    // A PNG saved as PNG would be the photo itself.
    const self = async (p: string): Promise<boolean> => p.toLowerCase() === 'c:\\p\\b.png'
    expect(await copyTarget('C:\\p\\b.png', 'png', new Set(), self)).toBe('C:\\p\\b (2).png')
    // A name this job already gave out is taken too.
    expect(await copyTarget('C:\\p\\c.gif', 'webp', new Set(['c:\\p\\c.webp']), async () => false)).toBe('C:\\p\\c (2).webp')
  })

  it('copies every picture, skips the rest, and names what it saved in order', async () => {
    const d = disk(['C:\\p\\a.jpg', 'C:\\p\\b.heic', 'C:\\p\\notes.txt', 'C:\\p\\logo.svg'])
    const r = await saveCopies(
      { paths: ['C:\\p\\a.jpg', 'C:\\p\\notes.txt', 'C:\\p\\b.heic', 'C:\\p\\logo.svg', 'C:\\p\\a folder'], format: 'webp' },
      d
    )
    expect(r).toEqual({ saved: ['C:\\p\\a.webp', 'C:\\p\\b.webp'], failed: 0, skipped: 3, canceled: false })
    expect(d.convert).toHaveBeenCalledTimes(2)
    expect(d.written).toHaveBeenCalledWith('C:\\p\\a.webp')
    expect(d.ticks.at(-1)).toEqual([2, 2])
  })

  it('two sources that would make the same name both land', async () => {
    const d = disk(['C:\\p\\x.png', 'C:\\p\\x.gif'])
    const r = await saveCopies({ paths: ['C:\\p\\x.png', 'C:\\p\\x.gif'], format: 'jpeg' }, d)
    expect(r.saved).toEqual(['C:\\p\\x.jpg', 'C:\\p\\x (2).jpg'])
  })

  it('a name taken between the pick and the write moves on to the next', async () => {
    let raced = false
    const d = disk(['C:\\p\\a.png'])
    d.place = vi.fn(async (_tmp: string, target: string) => {
      if (!raced) {
        raced = true
        d.there.add(target.toLowerCase()) // another program wrote it first
        return 'taken' as const
      }
      d.placed.push(target)
      return 'ok' as const
    })
    const r = await saveCopies({ paths: ['C:\\p\\a.png'], format: 'avif' }, d)
    expect(r.saved).toEqual(['C:\\p\\a (2).avif'])
  })

  it('a picture that cannot be read, or written, is counted and the rest go on', async () => {
    const d = disk(['C:\\p\\a.jpg', 'C:\\p\\bad.jpg', 'C:\\p\\c.jpg'])
    d.convert = vi.fn(async (src: string) => !src.includes('bad'))
    const r = await saveCopies({ paths: ['C:\\p\\a.jpg', 'C:\\p\\bad.jpg', 'C:\\p\\c.jpg'], format: 'png' }, d)
    expect(r).toEqual({ saved: ['C:\\p\\a.png', 'C:\\p\\c.png'], failed: 1, skipped: 0, canceled: false })
    const w = disk(['C:\\p\\a.jpg'])
    w.place = vi.fn(async () => 'failed' as const)
    expect(await saveCopies({ paths: ['C:\\p\\a.jpg'], format: 'png' }, w)).toEqual({
      saved: [],
      failed: 1,
      skipped: 0,
      canceled: false
    })
  })

  it('a file outside the wall is skipped, never read', async () => {
    const d = disk(['C:\\p\\a.jpg'], { allowed: () => false })
    const r = await saveCopies({ paths: ['C:\\p\\a.jpg'], format: 'png' }, d)
    expect(r).toEqual({ saved: [], failed: 0, skipped: 1, canceled: false })
    expect(d.convert).not.toHaveBeenCalled()
  })

  it('Cancel stops the job: what was made stays, nothing more starts, the stopped one is not a failure', async () => {
    const stop = new AbortController()
    const paths = ['a', 'b', 'c', 'd', 'e'].map((n) => `C:\\p\\${n}.jpg`)
    const d = disk(paths, { signal: stop.signal, atOnce: 1 })
    d.convert = vi.fn(async (src: string, _tmp: string, _f: unknown, signal: AbortSignal) => {
      if (src.endsWith('b.jpg')) {
        stop.abort()
        return !signal.aborted
      }
      return true
    })
    const r = await saveCopies({ paths, format: 'jxl' }, d)
    expect(r).toEqual({ saved: ['C:\\p\\a.jxl'], failed: 0, skipped: 0, canceled: true })
    expect(d.convert).toHaveBeenCalledTimes(2)
  })

  it('runs at most two at a time', async () => {
    let live = 0
    let most = 0
    const paths = Array.from({ length: 6 }, (_, i) => `C:\\p\\${i}.jpg`)
    const d = disk(paths)
    d.convert = vi.fn(async () => {
      live += 1
      most = Math.max(most, live)
      await new Promise((r) => setTimeout(r, 5))
      live -= 1
      return true
    })
    const r = await saveCopies({ paths, format: 'png' }, d)
    expect(r.saved).toHaveLength(6)
    expect(most).toBe(2)
  })

  it('nothing to copy is an answer, not an error', async () => {
    const d = disk([])
    expect(await saveCopies({ paths: ['C:\\p\\a.txt'], format: 'png' }, d)).toEqual({
      saved: [],
      failed: 0,
      skipped: 1,
      canceled: false
    })
  })
})
