import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The film flag of a window that never asked for a tile (audit #50): the page
// is destroyed without unmounting, so main must notice the destroy itself.
const handlers: Record<string, (e: unknown, ...a: unknown[]) => unknown> = {}
vi.mock('./typed', () => ({
  handle: (c: string, fn: (e: unknown, ...a: unknown[]) => unknown) => void (handlers[c] = fn),
  on: (c: string, fn: (e: unknown, ...a: unknown[]) => unknown) => void (handlers[c] = fn)
}))
vi.mock('../appState', () => ({ windows: { isPrismPage: () => true } }))
vi.mock('../desktopAccess', () => ({ ownsDirectly: () => true }))
vi.mock('../dirList', () => ({ warmCanonical: async () => {} }))
vi.mock('os', async (orig) => ({ ...(await orig<typeof import('os')>()), cpus: () => new Array(16).fill({}) }))

import { CALL } from '@shared/channels'
import { registerThumbsIpc } from './thumbs'

class Page extends EventEmitter {
  constructor(public id: number) {
    super()
  }
  isDestroyed = (): boolean => false
  send = (): void => {}
}

const made: string[] = []
const held: (() => void)[] = []
const thumbs = {
  lookup: async () => null,
  makeFor: (file: string) =>
    new Promise<string | null>((resolve) => {
      made.push(file)
      held.push(() => resolve(null))
    })
}

beforeEach(() => {
  made.length = 0
  held.length = 0
  registerThumbsIpc({ readable: () => true } as never, thumbs as never)
})

describe('thumbs ipc', () => {
  it('a window that only played a film is forgotten when it is destroyed', async () => {
    const films = new Page(1)
    handlers[CALL.thumbsFilm]({ sender: films }, true)
    films.emit('destroyed')
    const tiles = new Page(2)
    await handlers[CALL.thumbsWant](
      { sender: tiles },
      'tab',
      1,
      ['a', 'b', 'c'].map((n) => ({ path: `C:\\f\\${n}.jpg`, tier: 320 }))
    )
    await new Promise((r) => setTimeout(r, 20))
    expect(made).toHaveLength(3)
  })
})