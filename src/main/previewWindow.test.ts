import { describe, expect, it } from 'vitest'
import {
  PREVIEW_FADE_MS,
  PREVIEW_MIN,
  createPreviewWindows,
  fadeFrames,
  previewBounds,
  previewToken,
  type PreviewWin
} from './previewWindow'

describe('previewBounds', () => {
  it('is centred over the owner at two thirds of its size', () => {
    const b = previewBounds(
      { x: 100, y: 50, width: 1200, height: 900 },
      { x: 0, y: 0, width: 1920, height: 1040 }
    )
    expect(b).toEqual({ x: 304, y: 203, width: 792, height: 594 })
  })

  it('never goes under its smallest size', () => {
    const b = previewBounds({ x: 0, y: 0, width: 400, height: 300 }, null)
    expect(b.width).toBe(PREVIEW_MIN.width)
    expect(b.height).toBe(PREVIEW_MIN.height)
  })

  it('stays inside the work area', () => {
    const b = previewBounds(
      { x: -300, y: 900, width: 800, height: 600 },
      { x: 0, y: 0, width: 1920, height: 1040 }
    )
    expect(b.x).toBe(0)
    expect(b.y + b.height).toBe(1040)
  })

  it('is placed off the desktop with its owner when there is no work area (--e2e)', () => {
    const b = previewBounds({ x: -4000, y: -4000, width: 1000, height: 700 }, null)
    expect(b.x).toBeLessThan(-3000)
    expect(b.y).toBeLessThan(-3000)
  })
})

describe('fadeFrames', () => {
  it('passes through the frames of the fade, eased out, and ends exactly', () => {
    const f = fadeFrames(0, 1, PREVIEW_FADE_MS)
    expect(f.length).toBe(10)
    expect(f.at(-1)).toBe(1)
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1])
    // Eased out: more than half way by the third frame.
    expect(f[2]).toBeGreaterThan(0.5)
  })

  it('runs down for a close', () => {
    const f = fadeFrames(1, 0, PREVIEW_FADE_MS)
    expect(f.at(-1)).toBe(0)
    expect(f[0]).toBeLessThan(1)
  })

  it('is one step with no length', () => {
    expect(fadeFrames(0, 1, 0)).toEqual([1])
  })
})

describe('previewToken', () => {
  it('reads an armed name only', () => {
    expect(previewToken('prism-preview:0123456789abcdef0123')).toBe('0123456789abcdef0123')
    expect(previewToken('prism-preview')).toBeNull()
    expect(previewToken('prism-preview:short')).toBeNull()
    expect(previewToken('_blank')).toBeNull()
    expect(previewToken('x prism-preview:0123456789abcdef0123')).toBeNull()
  })
})

class FakeWin implements PreviewWin {
  static next = 1
  id = FakeWin.next++
  // As Electron's: a destroyed window's webContents throws.
  get webContents(): { id: number } {
    if (this.destroyed) throw new Error('Object has been destroyed')
    return { id: this.id }
  }
  destroyed = false
  visible = false
  opacity = 1
  closed: Array<() => void> = []
  constructor(private bounds = { x: 0, y: 0, width: 1000, height: 800 }) {}
  isDestroyed(): boolean {
    return this.destroyed
  }
  isVisible(): boolean {
    return this.visible
  }
  getBounds(): { x: number; y: number; width: number; height: number } {
    return this.bounds
  }
  setOpacity(o: number): void {
    this.opacity = o
  }
  showInactive(): void {
    this.visible = true
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.visible = false
    for (const fn of this.closed) fn()
  }
  once(_event: 'closed', fn: () => void): void {
    this.closed.push(fn)
  }
}

function world(e2e = false) {
  let clock = 0
  let tokens = 0
  const timers = new Set<() => void>()
  const told: FakeWin[] = []
  const pw = createPreviewWindows<FakeWin>({
    e2e,
    ground: () => '#111318',
    workArea: () => ({ x: 0, y: 0, width: 1920, height: 1040 }),
    token: () => `token${String(++tokens).padStart(16, '0')}`,
    now: () => clock,
    every: (fn) => {
      timers.add(fn)
      return fn
    },
    stop: (h) => timers.delete(h as () => void),
    closedByItself: (owner) => told.push(owner)
  })
  /** Run the fade timers until none is left. */
  const settle = (): void => {
    for (let i = 0; i < 100 && timers.size; i++) for (const fn of [...timers]) fn()
  }
  return { pw, told, settle, tick: (ms: number) => (clock += ms) }
}

describe('the preview windows', () => {
  it('opens only the name its own page armed, once', () => {
    const { pw } = world()
    const owner = new FakeWin()
    const other = new FakeWin()
    const name = pw.arm(owner)
    expect(pw.options(owner, 'about:blank', 'prism-preview:token9999999999999999')).toBeNull()
    expect(pw.options(other, 'about:blank', name)).toBeNull()
    expect(pw.options(owner, 'https://example.com', name)).toBeNull()
    // Used up by the refusal above, so arm again.
    const again = pw.arm(owner)
    const opts = pw.options(owner, 'about:blank', again)
    expect(opts).toMatchObject({
      frame: false,
      parent: owner,
      show: false,
      skipTaskbar: true,
      opacity: 0
    })
    expect(pw.options(owner, 'about:blank', again)).toBeNull()
  })

  it('refuses a name armed too long ago', () => {
    const { pw, tick } = world()
    const owner = new FakeWin()
    const name = pw.arm(owner)
    tick(6000)
    expect(pw.options(owner, 'about:blank', name)).toBeNull()
  })

  it('is unfocusable and off the desktop under --e2e', () => {
    const { pw } = world(true)
    const owner = new FakeWin({ x: -4000, y: -4000, width: 1000, height: 700 })
    const opts = pw.options(owner, 'about:blank', pw.arm(owner))
    expect(opts).toMatchObject({ focusable: false })
    expect(opts!.x as number).toBeLessThan(-3000)
  })

  it('shows inactive and fades in; fades out and is gone on close', () => {
    const { pw, settle, told } = world()
    const owner = new FakeWin()
    const child = new FakeWin()
    const name = pw.arm(owner)
    pw.options(owner, 'about:blank', name)
    pw.adopt(owner, child, name)
    expect(child.opacity).toBe(0)
    pw.show(owner, true)
    expect(child.visible).toBe(true)
    settle()
    expect(child.opacity).toBe(1)
    pw.close(owner, true)
    expect(child.destroyed).toBe(false)
    settle()
    expect(child.destroyed).toBe(true)
    expect(pw.of(owner)).toBeUndefined()
    expect(told).toEqual([])
    expect(pw.e2e()).toEqual([])
    expect(pw.e2eFades()).toEqual([
      { to: 1, frames: 10 },
      { to: 0, frames: 10 }
    ])
  })

  it('stays clear under --e2e while the fade still runs', () => {
    const { pw, settle } = world(true)
    const owner = new FakeWin()
    const child = new FakeWin()
    const name = pw.arm(owner)
    pw.options(owner, 'about:blank', name)
    pw.adopt(owner, child, name)
    pw.show(owner, true)
    settle()
    expect(child.opacity).toBe(0)
    const [state] = pw.e2e()
    expect(state.opacity).toBe(1)
    expect(state.fades[0].length).toBeGreaterThan(3)
  })

  it('tells the page when the window closed by itself (Alt+F4), not when the page closed it', () => {
    const { pw, told } = world()
    const owner = new FakeWin()
    const child = new FakeWin()
    const name = pw.arm(owner)
    pw.options(owner, 'about:blank', name)
    pw.adopt(owner, child, name)
    child.destroy()
    expect(told).toEqual([owner])
    expect(pw.of(owner)).toBeUndefined()
  })

  it("goes in its owner's own close, when the owner is already destroyed", () => {
    const { pw, told } = world()
    const owner = new FakeWin()
    const child = new FakeWin()
    const name = pw.arm(owner)
    pw.options(owner, 'about:blank', name)
    pw.adopt(owner, child, name)
    pw.arm(owner)
    owner.destroy()
    expect(() => pw.ownerGone(owner)).not.toThrow()
    expect(child.destroyed).toBe(true)
    expect(told).toEqual([])
  })

  it('goes with its owner and with standby, telling nobody', () => {
    const { pw, told } = world()
    const a = new FakeWin()
    const b = new FakeWin()
    const ca = new FakeWin()
    const cb = new FakeWin()
    for (const [o, c] of [
      [a, ca],
      [b, cb]
    ] as const) {
      const name = pw.arm(o)
      pw.options(o, 'about:blank', name)
      pw.adopt(o, c, name)
    }
    pw.ownerGone(a)
    expect(ca.destroyed).toBe(true)
    expect(cb.destroyed).toBe(false)
    pw.destroyAll()
    expect(cb.destroyed).toBe(true)
    expect(told).toEqual([])
  })

  it('is one per owner: a second open replaces the first', () => {
    const { pw } = world()
    const owner = new FakeWin()
    const first = new FakeWin()
    const n1 = pw.arm(owner)
    pw.options(owner, 'about:blank', n1)
    pw.adopt(owner, first, n1)
    const n2 = pw.arm(owner)
    pw.options(owner, 'about:blank', n2)
    expect(first.destroyed).toBe(true)
  })
})
