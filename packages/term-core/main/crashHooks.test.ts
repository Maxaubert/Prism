import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { DiagLog, DiagSource } from './diagLog'
import { hookCrashes, watchWindowHealth } from './crashHooks'

interface Line {
  src: DiagSource
  k: string
  fields: Record<string, unknown>
}

function fakeLog(): DiagLog & { lines: Line[]; syncs: number } {
  const lines: Line[] = []
  const log = {
    lines,
    syncs: 0,
    dir: '',
    file: '',
    write: (src: DiagSource, k: string, fields: Record<string, unknown> = {}) => lines.push({ src, k, fields }),
    writeAt: (src: DiagSource, k: string, _at: number, fields: Record<string, unknown> = {}) => lines.push({ src, k, fields }),
    verbose: () => false,
    setVerbose: () => {},
    flush: async () => {},
    flushSync: () => {
      log.syncs += 1
    },
    failed: () => false,
    close: () => {}
  }
  return log
}

describe('hookCrashes', () => {
  it('logs an uncaught exception by observing only, and writes it to disk at once', () => {
    const proc = new EventEmitter()
    const log = fakeLog()
    hookCrashes({ log, process: proc, app: new EventEmitter() })
    // The MONITOR event: observing it leaves Node's own handling untouched.
    expect(proc.listenerCount('uncaughtExceptionMonitor')).toBe(1)
    expect(proc.listenerCount('uncaughtException')).toBe(0)
    proc.emit('uncaughtExceptionMonitor', new Error('kaput'), 'uncaughtException')
    expect(log.lines[0]).toMatchObject({ src: 'main', k: 'main-error', fields: { msg: 'kaput', origin: 'uncaughtException' } })
    expect(typeof log.lines[0].fields.stack).toBe('string')
    expect(log.syncs).toBe(1)
  })

  it('logs an unhandled rejection', () => {
    const proc = new EventEmitter()
    const log = fakeLog()
    hookCrashes({ log, process: proc, app: new EventEmitter() })
    proc.emit('unhandledRejection', new Error('lost'), Promise.resolve())
    expect(log.lines[0]).toMatchObject({ k: 'main-rejection', fields: { msg: 'lost' } })
  })

  it('writes a rejection in the batch, and the same one over and over once per 10 s with a count', () => {
    vi.useFakeTimers()
    try {
      const proc = new EventEmitter()
      const log = fakeLog()
      let t = 0
      const off = hookCrashes({ log, process: proc, app: new EventEmitter(), now: () => t })
      // A poll that rejects every 250 ms for five seconds.
      for (; t < 5000; t += 250) proc.emit('unhandledRejection', new Error('poll failed'), Promise.resolve())
      expect(log.lines.map((l) => l.k)).toEqual(['main-rejection'])
      expect(log.syncs).toBe(0)
      t = 10_000
      vi.advanceTimersByTime(10_000)
      expect(log.lines.map((l) => l.k)).toEqual(['main-rejection', 'main-rejection'])
      expect(log.lines[1].fields).toMatchObject({ msg: 'poll failed', repeats: 19 })
      off()
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs a renderer or a child process that went', () => {
    const app = new EventEmitter()
    const log = fakeLog()
    hookCrashes({ log, process: new EventEmitter(), app })
    app.emit('render-process-gone', {}, {}, { reason: 'oom', exitCode: -536870904 })
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 1, name: 'gpu' })
    expect(log.lines.map((l) => l.fields)).toEqual([
      { type: 'renderer', reason: 'oom', exitCode: -536870904 },
      { type: 'GPU', reason: 'crashed', exitCode: 1, name: 'gpu' }
    ])
    expect(log.lines.every((l) => l.k === 'gone')).toBe(true)
    expect(log.syncs).toBe(2)
  })

  it('takes its listeners off again', () => {
    const proc = new EventEmitter()
    const app = new EventEmitter()
    const off = hookCrashes({ log: fakeLog(), process: proc, app })
    off()
    expect(proc.listenerCount('uncaughtExceptionMonitor') + proc.listenerCount('unhandledRejection')).toBe(0)
    expect(app.listenerCount('render-process-gone') + app.listenerCount('child-process-gone')).toBe(0)
  })
})

describe('watchWindowHealth', () => {
  it('logs unresponsive, then responsive with how long it was, and hands the hang to the watch', () => {
    const win = new EventEmitter()
    const log = fakeLog()
    let t = 1000
    const unresponsive = vi.fn()
    watchWindowHealth(win, log, { unresponsive }, () => t)
    win.emit('unresponsive')
    t = 4500
    win.emit('responsive')
    expect(log.lines.map((l) => [l.k, l.fields])).toEqual([
      ['unresponsive', {}],
      ['responsive', { ms: 3500 }]
    ])
    expect(unresponsive).toHaveBeenCalledTimes(1)
  })
})
