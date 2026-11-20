import { describe, expect, it } from 'vitest'
import type { BrowserWindow } from 'electron'
import { createOpenQueue } from './openQueue'

const win = (): BrowserWindow => ({ isDestroyed: () => false }) as unknown as BrowserWindow

function setup(target: () => BrowserWindow | undefined) {
  const sent: Array<{ to: unknown; payload: Record<string, unknown> }> = []
  const queue = createOpenQueue({
    windows: {
      sendTo: ((to: unknown, _c: string, payload: Record<string, unknown>) => {
        sent.push({ to, payload })
        return true
      }) as never,
      target: (() => {
        const w = target()
        return w ? { win: w } : undefined
      }) as never
    },
    exists: async (p) => p !== '/gone'
  })
  return { queue, sent }
}

describe('the open queue', () => {
  it('sends files and folders to the window in arrival order, and empties', async () => {
    const w = win()
    const { queue, sent } = setup(() => w)
    queue.set([{ path: '/a/x.png', dir: false }])
    queue.push({ path: '/b', dir: true })
    expect(queue.waiting()).toBe(2)
    await queue.drainPending(w)
    expect(queue.waiting()).toBe(0)
    expect(sent.map((s) => s.payload.explorerFile ?? s.payload.explorerFolder)).toEqual(['/a/x.png', '/b'])
  })

  it('skips a folder that is gone and sends nothing for it', async () => {
    const w = win()
    const { queue, sent } = setup(() => w)
    queue.push({ path: '/gone', dir: true })
    await queue.drainPending(w)
    expect(sent).toEqual([])
  })

  it('keeps the files while the window is not the target, or not live', async () => {
    const w = win()
    const { queue } = setup(() => undefined)
    queue.push({ path: '/a.png', dir: false })
    await queue.drainPending(w)
    expect(queue.waiting()).toBe(1)
    const t = setup(() => w)
    t.queue.push({ path: '/a.png', dir: false })
    await t.queue.drainPending(w, () => false)
    expect(t.queue.waiting()).toBe(1)
  })
})