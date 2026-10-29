import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { MEM_EVERY_MS } from './memWatch'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DGCH } from '../shared/channels'
import { diagMain, NULL_DIAG_LOG } from './diagLog'
import { startDiagnostics } from './diagnostics'

class FakeIpcMain extends EventEmitter {
  handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>()
  handle(ch: string, fn: (e: unknown, ...a: unknown[]) => unknown): void {
    this.handlers.set(ch, fn)
  }
}

describe('startDiagnostics', () => {
  it('logs nothing for a host that gave no folder, yet still answers the page', () => {
    const ipcMain = new FakeIpcMain()
    const d = startDiagnostics({
      ipcMain,
      process: new EventEmitter(),
      app: new EventEmitter(),
      appInfo: { name: 'Prism', version: '1.0.0' },
      openFolder: () => {}
    })
    expect(d.log).toBe(NULL_DIAG_LOG)
    expect(diagMain()).toBe(NULL_DIAG_LOG)
    expect(ipcMain.handlers.has(DGCH.info)).toBe(true)
    expect(ipcMain.listenerCount(DGCH.batch)).toBe(1)
  })

  it('opens with a session line and closes with a quit line, written at stop', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'pt-diag-')), 'logs')
    const proc = new EventEmitter()
    const d = startDiagnostics({
      diagLogDir: dir,
      ipcMain: new FakeIpcMain(),
      process: proc,
      app: new EventEmitter(),
      appInfo: { name: 'Prism Terminal', version: '0.34.0' },
      openFolder: () => {}
    })
    expect(diagMain()).toBe(d.log)
    d.stop()
    const lines = readFileSync(join(dir, 'diag.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    expect(lines[0]).toMatchObject({ src: 'main', k: 'session', app: 'Prism Terminal', version: '0.34.0', verbose: false })
    expect(typeof lines[0].cpus).toBe('number')
    expect(lines.at(-1)?.k).toBe('quit')
    // Unhooked: the process carries none of its listeners any more.
    expect(proc.listenerCount('uncaughtExceptionMonitor')).toBe(0)
    expect(diagMain()).toBe(NULL_DIAG_LOG)
    expect(existsSync(dir)).toBe(true)
  })

  it('writes the memory crumb when the host passes its metrics (perf review, 2026-10-28)', () => {
    vi.useFakeTimers()
    try {
      const dir = join(mkdtempSync(join(tmpdir(), 'pt-diag-')), 'logs')
      const d = startDiagnostics({
        diagLogDir: dir,
        ipcMain: new FakeIpcMain(),
        process: new EventEmitter(),
        app: new EventEmitter(),
        appInfo: { name: 'Prism', version: '1.0.0' },
        openFolder: () => {},
        appMetrics: () => [{ type: 'Browser', memory: { workingSetSize: 400 * 1024, privateBytes: 200 * 1024 } }]
      })
      vi.advanceTimersByTime(MEM_EVERY_MS)
      d.stop()
      const lines = readFileSync(join(dir, 'diag.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
      expect(lines).toContainEqual(expect.objectContaining({ k: 'crumb', a: 'memory', mainMb: 200 }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('tells the watch when the window is minimised and when it comes back (perf review, 2026-10-28)', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'pt-diag-')), 'logs')
    const d = startDiagnostics({
      diagLogDir: dir,
      ipcMain: new FakeIpcMain(),
      process: new EventEmitter(),
      app: new EventEmitter(),
      appInfo: { name: 'Prism', version: '1.0.0' },
      openFolder: () => {}
    })
    let minimised = false
    const win = Object.assign(new EventEmitter(), { webContents: {}, isMinimized: () => minimised })
    d.watchWindow(win)
    // The listeners are what pace the watch; each event asks the window.
    expect(win.listenerCount('minimize')).toBe(1)
    expect(win.listenerCount('restore')).toBe(1)
    minimised = true
    expect(() => win.emit('minimize')).not.toThrow()
    minimised = false
    expect(() => win.emit('restore')).not.toThrow()
    d.stop()
  })
})
