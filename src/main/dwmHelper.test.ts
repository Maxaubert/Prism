import { describe, expect, it, vi } from 'vitest'
import { borderColourForWindow, colorrefOf, hwndOf } from './dwmHelper'

describe('the DWM helper arithmetic', () => {
  it('turns a hex colour into a COLORREF with red in the low byte', () => {
    expect(colorrefOf('#ff0000')).toBe(0x0000ff)
    expect(colorrefOf('#0000ff')).toBe(0xff0000)
    expect(colorrefOf('#34373d')).toBe(0x3d3734)
    expect(colorrefOf('c9ccd3')).toBe(0xd3ccc9)
  })

  it('reads a 64-bit handle out of the native buffer, and a 32-bit one', () => {
    const b64 = Buffer.alloc(8)
    b64.writeBigUInt64LE(0x123456789n)
    expect(hwndOf(b64)).toBe(String(0x123456789n))
    const b32 = Buffer.alloc(4)
    b32.writeUInt32LE(0x1234)
    expect(hwndOf(b32)).toBe('4660')
  })
})

describe('the native edge through fullscreen transitions', () => {
  it('stays absent while a maximized window passes through restored bounds in either direction', () => {
    const phases = [
      { maximized: true, fullscreen: false, transitioning: false },
      { maximized: true, fullscreen: false, transitioning: true },
      { maximized: false, fullscreen: false, transitioning: true },
      { maximized: false, fullscreen: true, transitioning: true },
      { maximized: false, fullscreen: true, transitioning: false },
      { maximized: false, fullscreen: true, transitioning: true },
      { maximized: false, fullscreen: false, transitioning: true },
      { maximized: true, fullscreen: false, transitioning: true },
      { maximized: true, fullscreen: false, transitioning: false }
    ]
    for (const light of [false, true]) {
      expect(phases.map((state) => borderColourForWindow({ ...state, light }))).toEqual(
        phases.map(() => 'none')
      )
    }
  })

  it('restores a floating window edge only after its exit fade has ended', () => {
    for (const [light, colour] of [[false, '#34373d'], [true, '#c9ccd3']] as const) {
      const restored = { maximized: false, fullscreen: false, light }
      expect(borderColourForWindow({ ...restored, transitioning: true })).toBe('none')
      expect(borderColourForWindow({ ...restored, transitioning: false })).toBe(colour)
    }
  })
})

describe('the helper is a program started per change, from a worker, with no pipe (#189, 2026-10-12)', () => {
  // A held-open stdin pipe from Electron's main process cost every launch about
  // 900 ms before the first frame (measured, #189), and starting a process at
  // all is synchronous on the thread that starts it (405 ms of main, measured
  // by the lag profiler, 2026-10-12). These pin the shape that fixed both.
  // Paths are compared with forward slashes: `path.join` answers with the
  // platform's separator, and the rule is the same either way.
  const fwd = (p: string): string => p.split(String.fromCharCode(92)).join('/')
  const APP = 'C:/app/out'
  const posted: unknown[] = []
  let workers = 0
  let workerThrows = false
  class FakeWorker {
    constructor(src: string, opts: { eval?: boolean }) {
      if (workerThrows) throw new Error('no threads')
      expect(opts.eval).toBe(true)
      expect(src).toContain('spawn(')
      workers += 1
    }
    postMessage(m: unknown): void {
      posted.push(m)
    }
    unref(): void {}
    on(): this {
      return this
    }
  }
  const mainSpawn = vi.fn()
  const load = async (found = true) => {
    vi.resetModules()
    posted.length = 0
    workers = 0
    vi.doMock('worker_threads', () => ({ Worker: FakeWorker }))
    vi.doMock('child_process', () => ({ spawn: mainSpawn }))
    vi.doMock('fs', () => ({ existsSync: (p: string) => found && fwd(p).endsWith('/app/vendor/dwm/PrismDwm.exe') }))
    return import('./dwmHelper')
  }
  const tick = () => new Promise((r) => setImmediate(r))

  it('finds the helper in a vendor folder above the app, and in resources when installed', async () => {
    const { dwmDirs } = await load()
    expect(dwmDirs(true, 'R', APP).map(fwd)).toContain('R/dwm')
    expect(dwmDirs(false, 'R', APP).map(fwd)).toContain('C:/app/vendor/dwm')
    // Not installed: the resources folder is not looked in.
    expect(dwmDirs(false, 'R', APP).map(fwd)).not.toContain('R/dwm')
  })

  it('hands each tick to ONE resident worker, and main never starts a process', async () => {
    const m = await load()
    expect(m.initDwmHelper(false, 'R', APP)).toMatch(/PrismDwm\.exe$/)
    m.setBorder('7', '#ff0000')
    m.setCornersRounded('7', false)
    m.setBorder('9', 'default')
    await tick()
    m.setBorder('7', 'none')
    await tick()
    expect(workers).toBe(1)
    expect(posted).toHaveLength(2)
    const [first, second] = posted as { exe: string; args: string[] }[]
    expect(first.exe).toMatch(/PrismDwm\.exe$/)
    expect(first.args).toEqual(['7', '34', String(0x0000ff), '7', '33', '1', '9', '34', '-1'])
    expect(second.args).toEqual(['7', '34', '-2'])
    expect(mainSpawn).not.toHaveBeenCalled()
  })

  it('does nothing, and throws nothing, when the helper is not there', async () => {
    const m = await load(false)
    expect(m.initDwmHelper(false, 'R', APP)).toBeNull()
    m.setBorder('1', 'none')
    await tick()
    expect(workers).toBe(0)
    expect(posted).toHaveLength(0)
  })

  it('survives a worker that cannot start', async () => {
    workerThrows = true
    try {
      const m = await load()
      m.initDwmHelper(false, 'R', APP)
      m.setBorder('1', 'none')
      await expect(tick()).resolves.toBeUndefined()
      expect(mainSpawn).not.toHaveBeenCalled()
    } finally {
      workerThrows = false
    }
  })
})

describe('the worker program itself', () => {
  it('starts what it is sent with no pipe, on its own thread', async () => {
    vi.resetModules()
    vi.doUnmock('worker_threads')
    vi.doUnmock('child_process')
    vi.doUnmock('fs')
    const { DWM_WORKER } = await import('./dwmHelper')
    expect(DWM_WORKER).toContain("stdio: 'ignore'")
    expect(DWM_WORKER).toContain('windowsHide: true')
    const { Worker } = await import('worker_threads')
    const { mkdtempSync, existsSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const marker = join(mkdtempSync(join(tmpdir(), 'dwmw-')), 'ran')
    const w = new Worker(DWM_WORKER, { eval: true })
    w.postMessage({ exe: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, '1')`] })
    const until = Date.now() + 10000
    while (!existsSync(marker) && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
    await w.terminate()
    expect(existsSync(marker)).toBe(true)
  })
})
