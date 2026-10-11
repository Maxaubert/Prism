import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'events'
import type { DiagLog, DiagSource } from './diagLog'
import { timeIpcMain } from './ipcTiming'

/** Electron's ipcMain, as far as the wrapper sees it: an emitter with a
 *  handler table. */
class FakeIpcMain extends EventEmitter {
  handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>()
  handle(ch: string, fn: (e: unknown, ...a: unknown[]) => unknown): void {
    this.handlers.set(ch, fn)
  }
  invoke(ch: string, ...a: unknown[]): Promise<unknown> {
    return Promise.resolve().then(() => this.handlers.get(ch)!({}, ...a))
  }
}

interface Line {
  src: DiagSource
  k: string
  fields: Record<string, unknown>
}

function fakeLog(verbose = false): DiagLog & { lines: Line[] } {
  const lines: Line[] = []
  return {
    lines,
    dir: '',
    file: '',
    write: (src, k, fields = {}) => lines.push({ src, k, fields }),
    writeAt: (src, k, _at, fields = {}) => lines.push({ src, k, fields }),
    verbose: () => verbose,
    setVerbose: () => {},
    flush: async () => {},
    flushSync: () => {},
    failed: () => false,
    close: () => {}
  }
}

/** A clock the test moves by hand. */
function clock(): { now: () => number; at: (ms: number) => void } {
  let t = 0
  return { now: () => t, at: (ms) => (t = ms) }
}

describe('timeIpcMain', () => {
  it('logs a handle that settled after 500 ms, with its channel, time and arguments', async () => {
    const ipc = new FakeIpcMain()
    const log = fakeLog()
    const c = clock()
    timeIpcMain(ipc, log, { now: c.now })
    let release!: (v: string) => void
    ipc.handle('folder:list', () => new Promise<string>((r) => (release = r)))
    const p = ipc.invoke('folder:list', 'C:\\big', [1, 2, 3])
    await Promise.resolve()
    await Promise.resolve()
    c.at(640)
    release('ok')
    await expect(p).resolves.toBe('ok')
    expect(log.lines).toEqual([
      { src: 'main', k: 'ipc-slow', fields: { ch: 'folder:list', ms: 640, args: ['C:\\big', '[3]'], ok: true } }
    ])
  })

  it('says nothing about a fast call in quiet mode, and logs every call in verbose', async () => {
    const quiet = fakeLog(false)
    const ipc = new FakeIpcMain()
    timeIpcMain(ipc, quiet, { now: clock().now })
    ipc.handle('a', () => 1)
    await ipc.invoke('a')
    expect(quiet.lines).toEqual([])

    const loud = fakeLog(true)
    const ipc2 = new FakeIpcMain()
    timeIpcMain(ipc2, loud, { now: clock().now })
    ipc2.handle('a', () => 1)
    ipc2.on('b', () => {})
    await ipc2.invoke('a')
    ipc2.emit('b', {})
    expect(loud.lines.map((l) => [l.k, l.fields.ch])).toEqual([
      ['ipc', 'a'],
      ['ipc', 'b']
    ])
  })

  it('never logs its own channels, which would feed back into the log', async () => {
    const log = fakeLog(true)
    const ipc = new FakeIpcMain()
    timeIpcMain(ipc, log, { now: clock().now })
    ipc.on('diag:beat', () => {})
    ipc.emit('diag:beat', {})
    expect(log.lines).toEqual([])
  })

  it('rethrows an error unchanged, and logs it with its stack', async () => {
    const ipc = new FakeIpcMain()
    const log = fakeLog()
    timeIpcMain(ipc, log, { now: clock().now })
    const boom = new Error('nope')
    ipc.handle('sync-throw', () => {
      throw boom
    })
    ipc.handle('async-throw', async () => {
      throw boom
    })
    await expect(ipc.invoke('sync-throw')).rejects.toBe(boom)
    await expect(ipc.invoke('async-throw')).rejects.toBe(boom)
    expect(log.lines.map((l) => [l.k, l.fields.ch, l.fields.err])).toEqual([
      ['ipc-error', 'sync-throw', 'nope'],
      ['ipc-error', 'async-throw', 'nope']
    ])
    expect(typeof log.lines[0].fields.stack).toBe('string')
  })

  it('times a sync on body, and logs one that ran 100 ms or more', () => {
    const ipc = new FakeIpcMain()
    const log = fakeLog()
    const c = clock()
    timeIpcMain(ipc, log, { now: c.now })
    ipc.on('tabs:changed', () => c.at(c.now() + 150))
    ipc.on('quick', () => c.at(c.now() + 20))
    ipc.emit('tabs:changed', {}, { tabs: [] })
    ipc.emit('quick', {})
    expect(log.lines).toEqual([
      { src: 'main', k: 'ipc-slow', fields: { ch: 'tabs:changed', ms: 150, args: [{ tabs: '[0]' }], ok: true, sync: true } }
    ])
  })

  it('rethrows from an on listener too', () => {
    const ipc = new FakeIpcMain()
    const log = fakeLog()
    timeIpcMain(ipc, log, { now: clock().now })
    ipc.on('x', () => {
      throw new Error('bad')
    })
    expect(() => ipc.emit('x', {})).toThrow('bad')
    expect(log.lines[0]).toMatchObject({ k: 'ipc-error', fields: { ch: 'x', err: 'bad' } })
  })

  it('keeps removeListener working with the original listener (Prism open:listen)', () => {
    const ipc = new FakeIpcMain()
    timeIpcMain(ipc, fakeLog(), { now: clock().now })
    let n = 0
    const fn = (): void => {
      n += 1
    }
    ipc.on('open:listen', fn)
    ipc.on('other', fn)
    ipc.emit('open:listen', {})
    ipc.removeListener('open:listen', fn)
    ipc.emit('open:listen', {})
    expect(n).toBe(1)
    // The same listener on another channel is untouched.
    ipc.emit('other', {})
    expect(n).toBe(2)
    ipc.off('other', fn)
    ipc.emit('other', {})
    expect(n).toBe(2)
    expect(ipc.listenerCount('open:listen') + ipc.listenerCount('other')).toBe(0)
  })

  it('wraps once, and lets it be removed before it fires', () => {
    const ipc = new FakeIpcMain()
    timeIpcMain(ipc, fakeLog(), { now: clock().now })
    let n = 0
    const fn = (): void => {
      n += 1
    }
    ipc.once('a', fn)
    ipc.emit('a', {})
    ipc.emit('a', {})
    expect(n).toBe(1)
    ipc.once('b', fn)
    ipc.removeListener('b', fn)
    ipc.emit('b', {})
    expect(n).toBe(1)
  })

  it('keeps a table of the calls in flight, longest first', async () => {
    const ipc = new FakeIpcMain()
    const c = clock()
    const timing = timeIpcMain(ipc, fakeLog(), { now: c.now })
    const hold: Array<() => void> = []
    ipc.handle('slow-a', () => new Promise<void>((r) => hold.push(r)))
    ipc.handle('slow-b', () => new Promise<void>((r) => hold.push(r)))
    const a = ipc.invoke('slow-a')
    await Promise.resolve()
    c.at(100)
    const b = ipc.invoke('slow-b')
    await Promise.resolve()
    c.at(300)
    expect(timing.inflight()).toEqual([
      { ch: 'slow-a', ms: 300 },
      { ch: 'slow-b', ms: 200 }
    ])
    hold.forEach((r) => r())
    await Promise.all([a, b])
    expect(timing.inflight()).toEqual([])
  })

  it('names a call that ended inside the window, since a lag is only seen once the loop is free', async () => {
    const ipc = new FakeIpcMain()
    const c = clock()
    const timing = timeIpcMain(ipc, fakeLog(), { now: c.now })
    ipc.on('term:spawn', () => c.at(c.now() + 1800))
    c.at(1000)
    ipc.emit('term:spawn', {})
    c.at(2850)
    expect(timing.inflight()).toEqual([])
    expect(timing.inflight(2000)).toEqual([{ ch: 'term:spawn', ms: 1800, done: true }])
    expect(timing.inflight(10)).toEqual([])
  })

  it('never calls a wait on the user or a download slow, and keeps it out of the in-flight table', async () => {
    const ipc = new FakeIpcMain()
    const log = fakeLog()
    const c = clock()
    const timing = timeIpcMain(ipc, log, { now: c.now, longWait: ['dialog:pick-folder'] })
    const hold: Array<() => void> = []
    ipc.handle('dialog:pick-folder', () => new Promise<void>((r) => hold.push(r)))
    ipc.handle('dictation:download', () => new Promise<void>((r) => hold.push(r)))
    ipc.handle('folder:sizes', () => new Promise<void>((r) => hold.push(r)))
    const calls = [ipc.invoke('dialog:pick-folder'), ipc.invoke('dictation:download'), ipc.invoke('folder:sizes')]
    await Promise.resolve()
    c.at(90_000)
    expect(timing.inflight(1000)).toEqual([{ ch: 'folder:sizes', ms: 90_000 }])
    hold.forEach((r) => r())
    await Promise.all(calls)
    expect(log.lines.map((l) => l.fields.ch)).toEqual(['folder:sizes'])
    expect(timing.inflight(1000)).toEqual([{ ch: 'folder:sizes', ms: 90_000, done: true }])
  })

  it('logs only the sizes of an opaque channel', async () => {
    const ipc = new FakeIpcMain()
    const log = fakeLog()
    const c = clock()
    timeIpcMain(ipc, log, { now: c.now, opaque: (ch) => ch === 'term:input' })
    ipc.on('term:input', () => c.at(c.now() + 200))
    ipc.emit('term:input', {}, 't1', 'hunter2')
    expect(log.lines[0].fields.args).toEqual(['string:2', 'string:7'])
  })

  it("never writes down a program's clipboard copy (#176), by default", async () => {
    const ipc = new FakeIpcMain()
    const log = fakeLog()
    const c = clock()
    timeIpcMain(ipc, log, { now: c.now })
    ipc.handle('clipboard:term-write', () => {
      c.at(c.now() + 700)
      return true
    })
    await ipc.invoke('clipboard:term-write', 'secret token')
    await Promise.resolve()
    expect(log.lines.length).toBeGreaterThan(0)
    expect(JSON.stringify(log.lines)).not.toContain('secret token')
  })
})
