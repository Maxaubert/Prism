import { describe, expect, it, vi } from 'vitest'
import { CALL } from '@shared/channels'

const handlers = new Map<string, unknown>()
const listeners = new Map<string, unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (c: string, fn: unknown) => handlers.set(c, fn),
    on: (c: string, fn: unknown) => listeners.set(c, fn)
  }
}))

import { handle, on } from './typed'

describe('typed ipc wrappers', () => {
  it('register under the channel name with the handler as given', () => {
    const h = (): string => '1.0.0'
    handle(CALL.appVersion, h)
    expect(handlers.get('app:version')).toBe(h)
    const l = (): void => {}
    on(CALL.thumbsFilm, l)
    expect(listeners.get('thumbs:film')).toBe(l)
  })

  it('check a handler against the shared contract', () => {
    // A handler may validate: `unknown` is wider than what the page sends.
    handle(CALL.thumbsWant, () => ({ ready: {} }))
    // @ts-expect-error the contract answers a string, not a number
    handle(CALL.appVersion, () => 1)
    // @ts-expect-error the page sends a boolean, a handler cannot ask for a string
    on(CALL.thumbsFilm, (_e: unknown, playing: string) => void playing)
  })
})