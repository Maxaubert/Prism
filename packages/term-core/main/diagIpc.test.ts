import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { DGCH } from '../shared/channels'
import type { DiagLog, DiagSource } from './diagLog'
import { pageLine, registerDiagIpc, withStackPolicy, STACK_POLICY } from './diagIpc'

class FakeIpcMain extends EventEmitter {
  handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>()
  handle(ch: string, fn: (e: unknown, ...a: unknown[]) => unknown): void {
    this.handlers.set(ch, fn)
  }
  invoke(ch: string, ...a: unknown[]): unknown {
    return this.handlers.get(ch)!({}, ...a)
  }
}

interface Line {
  src: DiagSource
  k: string
  at?: number
  fields: Record<string, unknown>
}

function fakeLog(verbose = false): DiagLog & { lines: Line[] } {
  const lines: Line[] = []
  let v = verbose
  return {
    lines,
    dir: 'C:\\Users\\x\\AppData\\Roaming\\PrismTerminal\\logs',
    file: '',
    write: (src, k, fields = {}) => lines.push({ src, k, fields }),
    writeAt: (src, k, at, fields = {}) => lines.push({ src, k, at, fields }),
    verbose: () => v,
    setVerbose: (on) => {
      v = on
    },
    flush: async () => {},
    flushSync: () => {},
    failed: () => false,
    close: () => {}
  }
}

const NOW = 1_800_000_000_000

describe('pageLine', () => {
  it('takes a page kind and its time, and refuses a kind only main may write', () => {
    expect(pageLine({ k: 'page-stall', at: NOW - 300, ms: 2500 }, NOW, false)).toEqual({ k: 'page-stall', at: NOW - 300, fields: { ms: 2500 } })
    expect(pageLine({ k: 'session', at: NOW }, NOW, false)).toBeNull()
    expect(pageLine({ k: 'main-lag', at: NOW }, NOW, false)).toBeNull()
    expect(pageLine(null, NOW, false)).toBeNull()
    expect(pageLine({ k: 'not a kind!' }, NOW, false)).toBeNull()
  })
  it("takes the agent indicator's kinds at the quiet level (#152), and no other agent- kind", () => {
    for (const k of ['agent-hook', 'agent-title', 'agent-mark', 'agent-restore'])
      expect(pageLine({ k, at: NOW, id: 't1' }, NOW, false)?.k).toBe(k)
    expect(pageLine({ k: 'agent-anything', at: NOW }, NOW, false)).toBeNull()
  })
  it("takes an app's own -slow kind (Prism's sort-slow)", () => {
    expect(pageLine({ k: 'sort-slow', at: NOW, ms: 80 }, NOW, false)?.k).toBe('sort-slow')
  })
  it('reads a time that is missing or far off as now', () => {
    expect(pageLine({ k: 'crumb', a: 'x' }, NOW, false)?.at).toBe(NOW)
    expect(pageLine({ k: 'crumb', at: NOW - 3 * 86_400_000 }, NOW, false)?.at).toBe(NOW)
  })
  it('keeps the high-rate lines for verbose only', () => {
    expect(pageLine({ k: 'page-task', at: NOW, ms: 60 }, NOW, false)).toBeNull()
    expect(pageLine({ k: 'page-task', at: NOW, ms: 60 }, NOW, true)).not.toBeNull()
    expect(pageLine({ k: 'crumb', at: NOW, a: 'scroll', often: true }, NOW, false)).toBeNull()
    expect(pageLine({ k: 'crumb', at: NOW, a: 'scroll', often: true }, NOW, true)?.fields).toEqual({ a: 'scroll' })
  })
})

describe('registerDiagIpc', () => {
  const setup = (verbose = false) => {
    const ipcMain = new FakeIpcMain()
    const log = fakeLog(verbose)
    const watch = { beat: vi.fn(), pageStall: vi.fn() }
    const openFolder = vi.fn()
    registerDiagIpc({ ipcMain, log, watch, openFolder, wall: () => NOW })
    return { ipcMain, log, watch, openFolder }
  }

  it("writes the page's batch, and tells the watch about each stall", () => {
    const { ipcMain, log, watch } = setup()
    ipcMain.emit(DGCH.batch, {}, [
      { k: 'crumb', at: NOW - 500, a: 'tab-open' },
      { k: 'page-stall', at: NOW - 400, ms: 2600, scripts: [{ src: 'index.js', fn: 'spin', ms: 2590 }] },
      { k: 'session', at: NOW }
    ])
    expect(log.lines.map((l) => [l.src, l.k])).toEqual([
      ['page', 'crumb'],
      ['page', 'page-stall']
    ])
    expect(watch.pageStall).toHaveBeenCalledWith(NOW - 400, 2600)
  })

  it('ignores a batch that is not a list, and caps a long one', () => {
    const { ipcMain, log } = setup()
    ipcMain.emit(DGCH.batch, {}, 'nope')
    ipcMain.emit(DGCH.batch, {}, Array.from({ length: 500 }, () => ({ k: 'crumb', at: NOW })))
    expect(log.lines.length).toBe(200)
  })

  it('hears the beat', () => {
    const { ipcMain, watch } = setup()
    ipcMain.emit(DGCH.beat, {})
    expect(watch.beat).toHaveBeenCalledTimes(1)
  })

  it('answers info and the verbose switch', async () => {
    const { ipcMain, log } = setup()
    expect(await ipcMain.invoke(DGCH.info)).toEqual({ verbose: false, dir: log.dir })
    expect(await ipcMain.invoke(DGCH.setVerbose, true)).toBe(true)
    expect(log.verbose()).toBe(true)
    expect(await ipcMain.invoke(DGCH.setVerbose, 'yes')).toBe(true)
  })

  it('opens its own folder and never one the page names', () => {
    const { ipcMain, openFolder, log } = setup()
    ipcMain.emit(DGCH.openFolder, {}, 'C:\\Windows')
    expect(openFolder).toHaveBeenCalledWith(log.dir)
  })

  it('writes a mark with its note, capped', () => {
    const { ipcMain, log } = setup()
    ipcMain.emit(DGCH.mark, {}, 'it stalled opening Downloads')
    ipcMain.emit(DGCH.mark, {})
    expect(log.lines.map((l) => [l.src, l.k, l.fields.note])).toEqual([
      ['page', 'mark', 'it stalled opening Downloads'],
      ['page', 'mark', null]
    ])
  })
})

describe('withStackPolicy', () => {
  it('adds the Document-Policy header that lets main read the page stack, keeping the rest', () => {
    const out = withStackPolicy({ 'Content-Type': ['text/html'] })
    expect(out).toEqual({ 'Content-Type': ['text/html'], 'Document-Policy': [STACK_POLICY] })
  })
  it('joins a Document-Policy the response already had', () => {
    const out = withStackPolicy({ 'document-policy': ['force-load-at-top'] })
    expect(out['document-policy']).toEqual([`force-load-at-top, ${STACK_POLICY}`])
  })
  it('leaves one that already opts in alone', () => {
    const out = withStackPolicy({ 'Document-Policy': [STACK_POLICY] })
    expect(out['Document-Policy']).toEqual([STACK_POLICY])
  })
})
