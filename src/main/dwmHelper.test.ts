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

describe('the helper is a program started per change, with no pipe (#189)', () => {
  // A held-open stdin pipe from Electron's main process cost every launch about
  // 900 ms before the first frame (measured). These pin the shape that fixed it.
  // Paths are compared with forward slashes: `path.join` answers with the
  // platform's separator, and the rule is the same either way.
  const fwd = (p: string): string => p.split(String.fromCharCode(92)).join('/')
  const APP = 'C:/app/out'
  const load = async (spawnImpl: (...a: unknown[]) => unknown) => {
    vi.resetModules()
    vi.doMock('child_process', () => ({ spawn: spawnImpl }))
    vi.doMock('fs', () => ({ existsSync: (p: string) => fwd(p).endsWith('/app/vendor/dwm/PrismDwm.exe') }))
    return import('./dwmHelper')
  }
  // Typed to take spawn's arguments, so the calls it records can be read.
  const fakeChild = (...args: unknown[]) => {
    void args
    return { on: vi.fn(), unref: vi.fn() }
  }
  const tick = () => new Promise((r) => setImmediate(r))

  it('finds the helper in a vendor folder above the app, and in resources when installed', async () => {
    const { dwmDirs } = await load(vi.fn())
    expect(dwmDirs(true, 'R', APP).map(fwd)).toContain('R/dwm')
    expect(dwmDirs(false, 'R', APP).map(fwd)).toContain('C:/app/vendor/dwm')
    // Not installed: the resources folder is not looked in.
    expect(dwmDirs(false, 'R', APP).map(fwd)).not.toContain('R/dwm')
  })

  it('starts it with stdio ignored - no pipe at all', async () => {
    const spawn = vi.fn(fakeChild)
    const m = await load(spawn)
    expect(m.initDwmHelper(false, 'R', APP)).toMatch(/PrismDwm\.exe$/)
    m.setBorder('123', 'none')
    await tick()
    expect(spawn).toHaveBeenCalledTimes(1)
    const [, args, opts] = spawn.mock.calls[0] as [string, string[], { stdio: unknown; windowsHide: boolean }]
    expect(opts.stdio).toBe('ignore')
    expect(opts.windowsHide).toBe(true)
    expect(args).toEqual(['123', '34', '-2'])
  })

  it('sends everything asked for in one tick in ONE process', async () => {
    const spawn = vi.fn(fakeChild)
    const m = await load(spawn)
    m.initDwmHelper(false, 'R', APP)
    m.setBorder('7', '#ff0000')
    m.setCornersRounded('7', false)
    m.setBorder('9', 'default')
    await tick()
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0][1]).toEqual(['7', '34', String(0x0000ff), '7', '33', '1', '9', '34', '-1'])
  })

  it('does nothing, and throws nothing, when the helper is not there', async () => {
    vi.resetModules()
    const spawn = vi.fn(fakeChild)
    vi.doMock('child_process', () => ({ spawn }))
    vi.doMock('fs', () => ({ existsSync: () => false }))
    const m = await import('./dwmHelper')
    expect(m.initDwmHelper(false, 'R', APP)).toBeNull()
    m.setBorder('1', 'none')
    await tick()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('survives a helper that cannot start', async () => {
    const m = await load(() => {
      throw new Error('ENOENT')
    })
    m.initDwmHelper(false, 'R', APP)
    m.setBorder('1', 'none')
    await expect(tick()).resolves.toBeUndefined()
  })
})
