import { describe, expect, it, vi } from 'vitest'
import { createDragOut, PIN_AFTER_MS, type DragOutDeps, type ResolvedMember } from './dragOut'
import { clearFakeDrags, fakeDragCalls, recordFakeDrag } from './e2eDragOut'
import type { NativeDragRecord } from '@shared/dragOut'

interface Icon {
  name: string
  isEmpty(): boolean
}
const icon = (name: string, empty = false): Icon => ({ name, isEmpty: () => empty })
type Sender = { id: number }

function setup(over: Partial<DragOutDeps<Sender, Icon>> = {}) {
  const files = new Map<string, 'file' | 'dir'>([
    ['C:\\root\\a.txt', 'file'],
    ['C:\\root\\b.png', 'file'],
    ['C:\\root\\sub', 'dir']
  ])
  const sent: Array<{ channel: string; payload: unknown }> = []
  const pins: Array<{ paths: string[]; until: number }> = []
  const started: Array<{ file: string; files: string[]; icon: Icon }> = []
  let t = 1000
  const deps: DragOutDeps<Sender, Icon> = {
    e2e: false,
    readable: (p) => typeof p === 'string' && (p.startsWith('C:\\root') || p.startsWith('C:\\temp')),
    kindOf: async (p) => files.get(p),
    fileIcon: async (p) => icon(`file:${p}`),
    appIcon: () => icon('app'),
    startDrag: (_s, item) => void started.push(item),
    senderId: (s) => s.id,
    broadcast: (channel, payload) => void sent.push({ channel, payload }),
    pin: (paths, until) => void pins.push({ paths, until }),
    now: () => t,
    ...over
  }
  const d = createDragOut(deps)
  return { d, files, sent, pins, started, tick: (ms: number) => (t += ms) }
}

describe('drag out of Prism, main (#103)', () => {
  it('starts the OS drag with the walled, existing paths and a file icon', async () => {
    const { d, started, sent } = setup()
    const r = await d.out({ id: 7 }, { kind: 'files', paths: ['C:\\root\\a.txt', 'C:\\root\\sub'] })
    expect(r.ok).toBe(true)
    expect(started).toHaveLength(1)
    expect(started[0].file).toBe('C:\\root\\a.txt')
    expect(started[0].files).toEqual(['C:\\root\\a.txt', 'C:\\root\\sub'])
    expect(started[0].icon.name).toBe('file:C:\\root\\a.txt')
    // Every window hears the start, then the end, with the same token.
    expect(sent.map((s) => s.channel)).toEqual(['start', 'end'])
    const rec = sent[0].payload as NativeDragRecord
    expect(rec.source).toBe(7)
    expect(rec.cargo).toEqual({ kind: 'files', paths: ['C:\\root\\a.txt', 'C:\\root\\sub'] })
    expect((sent[1].payload as { token: number }).token).toBe(rec.token)
    expect(d.inFlight()).toBeNull()
  })

  it('refuses a path outside the wall, and one that is gone', async () => {
    const { d, started } = setup()
    expect(await d.out({ id: 1 }, { kind: 'files', paths: ['C:\\Windows\\win.ini'] })).toEqual({ ok: false, reason: 'refused' })
    expect(await d.out({ id: 1 }, { kind: 'files', paths: ['C:\\root\\gone.txt'] })).toEqual({ ok: false, reason: 'missing' })
    expect(await d.out({ id: 1 }, { kind: 'files', paths: [] })).toEqual({ ok: false, reason: 'refused' })
    expect(await d.out({ id: 1 }, 'C:\\root\\a.txt')).toEqual({ ok: false, reason: 'refused' })
    expect(started).toHaveLength(0)
  })

  it('falls back to the app icon, never an empty one', async () => {
    const { d, started } = setup({ fileIcon: async () => icon('none', true) })
    await d.out({ id: 1 }, { kind: 'files', paths: ['C:\\root\\a.txt'] })
    expect(started[0].icon.name).toBe('app')
  })

  it('caches the icon per extension, warmed on the press', async () => {
    const fileIcon = vi.fn(async (p: string) => icon(p))
    const { d, files } = setup({ fileIcon })
    files.set('C:\\root\\c.txt', 'file')
    await d.prepare({ kind: 'files', paths: ['C:\\root\\a.txt'] })
    await d.out({ id: 1 }, { kind: 'files', paths: ['C:\\root\\c.txt'] })
    expect(fileIcon).toHaveBeenCalledTimes(1)
  })

  it('pins the carried paths while in flight and for a minute after', async () => {
    const { d, pins } = setup()
    await d.out({ id: 1 }, { kind: 'files', paths: ['C:\\root\\a.txt'] })
    expect(pins[0].until).toBe(Infinity)
    expect(pins[1].until).toBe(1000 + PIN_AFTER_MS)
  })

  it('a startDrag that throws still ends the record and says so', async () => {
    const { d, sent } = setup({
      startDrag: () => {
        throw new Error('no')
      }
    })
    expect(await d.out({ id: 1 }, { kind: 'files', paths: ['C:\\root\\a.txt'] })).toEqual({ ok: false, reason: 'failed' })
    expect(sent.map((s) => s.channel)).toEqual(['start', 'end'])
    expect(d.inFlight()).toBeNull()
  })

  it('UNDER --e2e NEVER CALLS startDrag: it records, and stays in flight until ended', async () => {
    clearFakeDrags()
    const { d, started, sent } = setup({ e2e: true, record: recordFakeDrag })
    const r = await d.out({ id: 3 }, { kind: 'files', paths: ['C:\\root\\b.png'] })
    expect(r.ok).toBe(true)
    expect(started).toHaveLength(0)
    expect(fakeDragCalls()).toEqual([
      { paths: ['C:\\root\\b.png'], file: 'C:\\root\\b.png', iconEmpty: false, source: 3, cargo: { kind: 'files', paths: ['C:\\root\\b.png'] } }
    ])
    expect(d.inFlight()?.paths).toEqual(['C:\\root\\b.png'])
    // A second drag while one is in flight is refused (re-entry).
    expect(await d.out({ id: 3 }, { kind: 'files', paths: ['C:\\root\\a.txt'] })).toEqual({ ok: false, reason: 'busy' })
    d.endFake()
    expect(d.inFlight()).toBeNull()
    expect(sent.map((s) => s.channel)).toEqual(['start', 'end'])
    expect(started).toHaveLength(0)
  })

  it('a fake record for other paths is only possible under --e2e', () => {
    expect(setup().d.startFake(['C:\\x'])).toBeNull()
    const { d, sent } = setup({ e2e: true })
    expect(d.startFake(['C:\\x'])?.paths).toEqual(['C:\\x'])
    expect(sent[0].channel).toBe('start')
  })

  it('is quiet while a drag runs and a moment after (the lag profiler skips it)', async () => {
    const { d, tick } = setup({ e2e: true })
    expect(d.quiet()).toBe(false)
    await d.out({ id: 1 }, { kind: 'files', paths: ['C:\\root\\a.txt'] })
    expect(d.quiet()).toBe(true)
    d.endFake()
    expect(d.quiet()).toBe(true)
    tick(2000)
    expect(d.quiet()).toBe(false)
  })

  describe('archive members', () => {
    const member = (entry: string, size: number, dir = false): ResolvedMember => ({ real: 'C:\\root\\z.zip', entry, size, dir })
    function members(table: Record<string, ResolvedMember | null>) {
      const extracted: string[] = []
      const m = {
        resolve: async (place: string) => table[place] ?? null,
        signature: async () => 'sig1',
        extractFile: async (place: string) => {
          extracted.push(place)
          return `C:\\temp\\${place.split('\\').pop()}`
        },
        extractDir: async (_real: string, entry: string) => {
          extracted.push(entry)
          return `C:\\temp\\${entry}`
        }
      }
      return { m, extracted }
    }
    const req = (entries: string[]) => ({
      kind: 'members' as const,
      archive: 'C:\\root\\z.zip',
      entries,
      places: entries.map((e) => `C:\\root\\z.zip\\${e}`)
    })

    it('extracts on the press, within budget, and carries the temp copies', async () => {
      const { m, extracted } = members({
        'C:\\root\\z.zip\\a.txt': member('a.txt', 10),
        'C:\\root\\z.zip\\docs': member('docs', 100, true)
      })
      const s = setup({ members: m })
      s.files.set('C:\\temp\\a.txt', 'file')
      s.files.set('C:\\temp\\docs', 'dir')
      expect(await s.d.out({ id: 1 }, req(['a.txt']))).toEqual({ ok: false, reason: 'not-ready' })
      expect(await s.d.prepare(req(['a.txt', 'docs']))).toEqual({ ok: true })
      expect(extracted).toEqual(['C:\\root\\z.zip\\a.txt', 'docs'])
      const r = await s.d.out({ id: 1 }, req(['a.txt', 'docs']))
      expect(r.ok).toBe(true)
      expect(s.started[0].files).toEqual(['C:\\temp\\a.txt', 'C:\\temp\\docs'])
      const rec = s.sent[0].payload as NativeDragRecord
      expect(rec.cargo).toEqual({ kind: 'members', archive: 'C:\\root\\z.zip', entries: ['a.txt', 'docs'] })
      // Pressed again: the copies are reused while the container is unchanged.
      await s.d.prepare(req(['a.txt']))
      expect(extracted).toHaveLength(2)
    })

    it('over 64 MB or 64 members nothing is extracted and nothing hands off', async () => {
      const big = members({ 'C:\\root\\z.zip\\big.bin': member('big.bin', 65 * 1024 * 1024) })
      const s = setup({ members: big.m })
      expect(await s.d.prepare(req(['big.bin']))).toEqual({ ok: false, reason: 'budget' })
      expect(big.extracted).toEqual([])
      expect(await s.d.out({ id: 1 }, req(['big.bin']))).toEqual({ ok: false, reason: 'not-ready' })
      const names = Array.from({ length: 65 }, (_, i) => `f${i}.txt`)
      const many = members(Object.fromEntries(names.map((n) => [`C:\\root\\z.zip\\${n}`, member(n, 1)])))
      const s2 = setup({ members: many.m })
      expect(await s2.d.prepare(req(names))).toEqual({ ok: false, reason: 'budget' })
      expect(many.extracted).toEqual([])
    })

    it('refuses a place that is not the member the cargo names', async () => {
      const { m } = members({ 'C:\\root\\z.zip\\a.txt': member('other.txt', 1) })
      const s = setup({ members: m })
      expect(await s.d.prepare(req(['a.txt']))).toEqual({ ok: false, reason: 'refused' })
      const { m: m2 } = members({})
      expect(await setup({ members: m2 }).d.prepare(req(['a.txt']))).toEqual({ ok: false, reason: 'refused' })
    })

    it('a failed extraction (a locked archive with no password) prepares nothing', async () => {
      const { m } = members({ 'C:\\root\\z.zip\\a.txt': member('a.txt', 1) })
      const s = setup({ members: { ...m, extractFile: async () => null } })
      expect(await s.d.prepare(req(['a.txt']))).toEqual({ ok: false, reason: 'failed' })
      expect(await s.d.out({ id: 1 }, req(['a.txt']))).toEqual({ ok: false, reason: 'not-ready' })
    })
  })
})
