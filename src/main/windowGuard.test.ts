import { EventEmitter } from 'events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { crashBudget } from './crashBudget'
import { guardWindow } from './windowGuard'

function fakeWin(visible = false) {
  const win = new EventEmitter() as EventEmitter & Record<string, unknown>
  const wc = new EventEmitter() as EventEmitter & Record<string, unknown>
  wc.isCrashed = () => false
  wc.getURL = () => 'file:///index.html'
  wc.reload = vi.fn()
  win.webContents = wc
  win.isDestroyed = () => false
  win.isVisible = () => visible
  return win as unknown as BrowserWindow
}

afterEach(() => vi.useRealTimers())

describe('the window watchdog (owner, 2026-11-06)', () => {
  const deps = (over: Record<string, unknown> = {}) => ({
    budget: crashBudget(),
    log: vi.fn(),
    show: vi.fn(),
    recreate: vi.fn(),
    giveUp: vi.fn(),
    stateLost: vi.fn(),
    quitting: () => false,
    ...over
  })

  it('shows a window still unshown after 8 s, and says so', () => {
    vi.useFakeTimers()
    const d = deps()
    guardWindow(fakeWin(), d)
    vi.advanceTimersByTime(8000)
    expect(d.log).toHaveBeenCalledWith('watchdog', expect.objectContaining({ shown: false }))
    expect(d.show).toHaveBeenCalledTimes(1)
  })

  it('leaves the hidden spare alone: no window-slow false alarm', () => {
    vi.useFakeTimers()
    const d = deps({ hiddenByDesign: () => true })
    guardWindow(fakeWin(), d)
    vi.advanceTimersByTime(8000)
    expect(d.log).not.toHaveBeenCalled()
    expect(d.show).not.toHaveBeenCalled()
  })
})
