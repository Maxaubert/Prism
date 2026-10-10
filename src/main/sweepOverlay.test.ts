import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, WebContents } from 'electron'
import { SWEEP_CHANNELS, type SweepBegin } from '@shared/sweepOverlay'
import { WATCHDOG_MS, initSweepOverlay, sweepDirs, type PrismSweep, type SweepLoad } from './sweepOverlay'

class FakeContents extends EventEmitter {
  sent: Array<[string, unknown]> = []
  send(channel: string, v: unknown): void {
    this.sent.push([channel, v])
  }
  states(): boolean[] {
    return this.sent.filter(([c]) => c === SWEEP_CHANNELS.state).map(([, v]) => (v as { native: boolean }).native)
  }
}
class FakeWin extends EventEmitter {
  webContents = new FakeContents()
  destroyed = false
  constructor(public hwnd = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0])) {
    super()
  }
  getNativeWindowHandle(): Buffer {
    return this.hwnd
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
}

type FakeAddon = PrismSweep & { st: string; frames: number; failures: number }
function fakeAddon(over: Partial<PrismSweep> = {}): FakeAddon {
  const a: FakeAddon = {
    st: 'pending',
    frames: 0,
    failures: 0,
    probe: vi.fn(() => ({ build: 26200, clock: true, remote: false })),
    attach: vi.fn(),
    status: vi.fn(() => a.st as 'pending'),
    begin: vi.fn((): boolean => {
      a.frames++
      return true
    }),
    update: vi.fn(),
    end: vi.fn(),
    detach: vi.fn(),
    shutdown: vi.fn(() => true),
    stats: vi.fn(() => ({ frames: a.frames, commits: 0, maxWorkUs: 0, failures: a.failures, sampling: 'late', leadUs: 1000, lateCommits: 0, widenings: 0 })),
    ...over
  }
  return a
}

function setup(opts: { load?: () => SweepLoad; e2e?: boolean; argv?: string[]; addon?: ReturnType<typeof fakeAddon> } = {}) {
  const ipc = new EventEmitter()
  const lines: Record<string, unknown>[] = []
  const wins: FakeWin[] = []
  const addon = opts.addon ?? fakeAddon()
  const load = vi.fn(opts.load ?? ((): SweepLoad => ({ addon })))
  const overlay = initSweepOverlay({
    load,
    e2e: opts.e2e ?? false,
    argv: opts.argv ?? [],
    log: (f) => lines.push(f),
    ipc: { on: (c, l) => ipc.on(c, l) },
    windowOf: (sender) => (wins.find((w) => (w.webContents as unknown) === sender) as unknown as BrowserWindow) ?? null
  })
  const open = (): FakeWin => {
    const w = new FakeWin(Buffer.from([wins.length + 1, 0, 0, 0, 0, 0, 0, 0]))
    wins.push(w)
    overlay.attach(w as unknown as BrowserWindow)
    return w
  }
  const say = (w: FakeWin, kind: 'begin' | 'update' | 'end', msg: unknown): void => {
    ipc.emit(SWEEP_CHANNELS[kind], { sender: w.webContents as unknown as WebContents }, msg)
  }
  return { overlay, addon, load, lines, open, say }
}

const begin = (id = 1): SweepBegin => ({
  id,
  anchor: { x: 100, y: 50 },
  clip: { left: 10, top: 20, right: 400, bottom: 300 },
  dpr: 1.5,
  fill: [1, 2, 3, 41],
  edge: [4, 5, 6, 255]
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as { __e2eSweepOverlay?: unknown }).__e2eSweepOverlay
  delete (globalThis as { __e2eSweepNative?: unknown }).__e2eSweepNative
})

describe('sweepDirs', () => {
  it('reads resources\\sweep packaged and vendor\\sweep in dev', () => {
    expect(sweepDirs(true, 'R', 'A')[0]).toMatch(/^R[\\/]sweep$/)
    expect(sweepDirs(false, 'R', 'A')[0]).toMatch(/^A[\\/]vendor[\\/]sweep$/)
  })
})

describe('the native box is off, with its reason', () => {
  it.each([
    ['missing', (): SweepLoad => ({ error: 'missing' })],
    ['load-failed', (): SweepLoad => ({ error: 'load-failed', detail: 'bad image' })]
  ] as const)('%s', async (reason, load) => {
    const t = setup({ load })
    const w = t.open()
    await vi.advanceTimersByTimeAsync(100)
    expect(t.overlay.reason()).toBe(reason)
    expect(w.webContents.states()).toEqual([false])
    expect(t.lines.filter((l) => l.reason === reason)).toHaveLength(1)
  })

  it('no-clock and remote, from the probe', () => {
    const noClock = fakeAddon({ probe: vi.fn(() => ({ build: 17763, clock: false, remote: false })) })
    expect(setup({ addon: noClock }).overlay.reason()).toBe('no-clock')
    const remote = fakeAddon({ probe: vi.fn(() => ({ build: 26200, clock: true, remote: true })) })
    const t = setup({ addon: remote })
    expect(t.overlay.reason()).toBe('remote')
    expect(t.lines).toEqual([expect.objectContaining({ native: false, reason: 'remote' })])
  })

  it('flag: --sweep-overlay=off loads nothing', () => {
    const t = setup({ argv: ['prism.exe', '--sweep-overlay=off'] })
    expect(t.overlay.reason()).toBe('flag')
    expect(t.load).not.toHaveBeenCalled()
  })

  it('target-failed when the window has no target', async () => {
    const t = setup()
    const w = t.open()
    t.addon.st = 'failed'
    await vi.advanceTimersByTimeAsync(100)
    expect(t.overlay.reason()).toBe('target-failed')
    expect(w.webContents.states().at(-1)).toBe(false)
    expect(t.lines.filter((l) => l.reason === 'target-failed')).toHaveLength(1)
  })
})

describe('the state the page hears', () => {
  it('is true only once the target is ready, and again on every load', async () => {
    const t = setup()
    const w = t.open()
    expect(t.addon.attach).toHaveBeenCalledWith(w.hwnd)
    await vi.advanceTimersByTimeAsync(200)
    expect(w.webContents.states()).toEqual([false])
    t.addon.st = 'ready'
    await vi.advanceTimersByTimeAsync(50)
    expect(w.webContents.states()).toEqual([false, true])
    w.webContents.emit('did-finish-load')
    expect(w.webContents.states()).toEqual([false, true, true])
    expect(t.lines.some((l) => l.native === true && 'window' in l)).toBe(true)
  })

  it('follows a Remote Desktop session in and out', async () => {
    const t = setup()
    const w = t.open()
    t.addon.st = 'ready'
    await vi.advanceTimersByTimeAsync(50)
    t.addon.probe = vi.fn(() => ({ build: 26200, clock: true, remote: true }))
    t.overlay.recheck()
    expect(t.overlay.reason()).toBe('remote')
    expect(w.webContents.states().at(-1)).toBe(false)
    t.addon.probe = vi.fn(() => ({ build: 26200, clock: true, remote: false }))
    t.overlay.recheck()
    expect(t.overlay.reason()).toBeNull()
    expect(w.webContents.states().at(-1)).toBe(true)
  })
})

async function ready() {
  const t = setup()
  const w = t.open()
  t.addon.st = 'ready'
  await vi.advanceTimersByTimeAsync(50)
  return { ...t, w }
}

describe('forwarding', () => {
  it('maps begin, update and end to physical pixels, the cause carried through', async () => {
    const t = await ready()
    t.say(t.w, 'begin', begin(7))
    expect(t.addon.begin).toHaveBeenCalledWith(
      t.w.hwnd,
      { ax: 150, ay: 75, left: 15, top: 30, right: 600, bottom: 450, edge: 1 },
      [1, 2, 3, 41],
      [4, 5, 6, 255]
    )
    t.say(t.w, 'update', { ...begin(7), cause: 'scroll', anchor: { x: 100, y: 30 } })
    expect(t.addon.update).toHaveBeenCalledWith(t.w.hwnd, expect.objectContaining({ ay: 45, cause: 'scroll' }))
    t.say(t.w, 'end', { id: 7 })
    expect(t.addon.end).toHaveBeenCalledTimes(1)
    t.say(t.w, 'end', { id: 7 })
    expect(t.addon.end).toHaveBeenCalledTimes(1)
  })

  it('drops an update or an end for another sweep, and an invalid message', async () => {
    const t = await ready()
    t.say(t.w, 'begin', begin(2))
    t.say(t.w, 'update', { ...begin(1), cause: 'auto' })
    t.say(t.w, 'update', { ...begin(2), cause: 'wheel' })
    t.say(t.w, 'end', { id: 1 })
    expect(t.addon.update).not.toHaveBeenCalled()
    expect(t.addon.end).not.toHaveBeenCalled()
  })

  it('answers an invalid begin with native false', async () => {
    const t = await ready()
    t.say(t.w, 'begin', { ...begin(), dpr: NaN })
    expect(t.addon.begin).not.toHaveBeenCalled()
    expect(t.w.webContents.states().at(-1)).toBe(false)
  })

  it('tells the page false when the addon refuses a begin', async () => {
    const t = await ready()
    t.addon.begin = vi.fn(() => false)
    t.say(t.w, 'begin', begin())
    expect(t.w.webContents.states().at(-1)).toBe(false)
    expect(t.overlay.reason()).toBeNull()
  })

  it('turns it off for the session when the refusal is a failed target', async () => {
    const t = await ready()
    t.addon.begin = vi.fn(() => false)
    t.addon.st = 'failed'
    t.say(t.w, 'begin', begin())
    expect(t.overlay.reason()).toBe('target-failed')
    // A reload is not told `true` again for a window that cannot draw.
    t.w.webContents.emit('did-finish-load')
    expect(t.w.webContents.states().at(-1)).toBe(false)
  })
})

describe('main ends the box itself', () => {
  it.each(['blur', 'minimize', 'hide'])('on the window %s', async (event) => {
    const t = await ready()
    t.say(t.w, 'begin', begin())
    t.w.emit(event)
    expect(t.addon.end).toHaveBeenCalledWith(t.w.hwnd)
  })

  it('when the page dies, and on a new document but not an in-page navigation', async () => {
    const t = await ready()
    t.say(t.w, 'begin', begin(1))
    t.w.webContents.emit('did-start-navigation', { isSameDocument: true, isMainFrame: true })
    expect(t.addon.end).not.toHaveBeenCalled()
    t.w.webContents.emit('did-start-navigation', { isSameDocument: false, isMainFrame: true })
    expect(t.addon.end).toHaveBeenCalledTimes(1)
    t.say(t.w, 'begin', begin(2))
    t.w.webContents.emit('render-process-gone')
    expect(t.addon.end).toHaveBeenCalledTimes(2)
  })

  it('on closed, and detaches the target', async () => {
    const t = await ready()
    t.say(t.w, 'begin', begin())
    t.w.emit('closed')
    expect(t.addon.end).toHaveBeenCalledWith(t.w.hwnd)
    expect(t.addon.detach).toHaveBeenCalledWith(t.w.hwnd)
  })
})

describe('a thread that stops answering', () => {
  it('turns the native box off when the thread has not moved after a begin', async () => {
    const t = await ready()
    t.addon.begin = vi.fn(() => true) // frames never move
    t.say(t.w, 'begin', begin())
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS + 10)
    expect(t.overlay.reason()).toBe('runtime-failure')
    expect(t.addon.end).toHaveBeenCalled()
    expect(t.w.webContents.states().at(-1)).toBe(false)
  })

  it('stays on when the thread moved', async () => {
    const t = await ready()
    t.say(t.w, 'begin', begin())
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS + 10)
    expect(t.overlay.reason()).toBeNull()
  })

  it('turns it off on a failure during a sweep', async () => {
    const t = await ready()
    t.say(t.w, 'begin', begin())
    t.addon.failures = 1
    t.say(t.w, 'end', { id: 1 })
    expect(t.overlay.reason()).toBe('runtime-failure')
  })
})

describe('shutdown', () => {
  it('runs once at will-quit and is harmless again at exit', async () => {
    const t = await ready()
    t.say(t.w, 'begin', begin())
    t.overlay.shutdown()
    t.overlay.shutdown()
    expect(t.addon.shutdown).toHaveBeenCalledTimes(1)
    expect(t.addon.end).toHaveBeenCalledTimes(1)
  })
})

describe('under e2e', () => {
  it('loads nothing and records every message', async () => {
    const t = setup({ e2e: true })
    const w = t.open()
    expect(t.load).not.toHaveBeenCalled()
    expect(t.overlay.reason()).toBe('e2e')
    t.say(w, 'begin', begin(4))
    t.say(w, 'update', { ...begin(4), cause: 'auto' })
    t.say(w, 'end', { id: 4 })
    w.webContents.emit('did-finish-load')
    const rec = (globalThis as unknown as { __e2eSweepOverlay: Array<{ kind: string }> }).__e2eSweepOverlay
    expect(rec.map((r) => r.kind)).toEqual(['state', 'begin', 'update', 'end', 'state'])
    expect(rec[1]).toMatchObject({ id: 4, dpr: 1.5, fill: [1, 2, 3, 41] })
    expect(t.addon.begin).not.toHaveBeenCalled()
    expect(w.webContents.states()).toEqual([false, false])
  })

  it('lets the e2e tell the pages a native state, still drawing nothing', () => {
    const t = setup({ e2e: true })
    const w = t.open()
    const g = globalThis as unknown as { __e2eSweepNative: (on: boolean) => void }
    g.__e2eSweepNative(true)
    g.__e2eSweepNative(false)
    expect(w.webContents.states()).toEqual([false, true, false])
    t.say(w, 'begin', begin(5))
    expect(t.addon.begin).not.toHaveBeenCalled()
  })
})
