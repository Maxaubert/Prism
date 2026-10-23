import { describe, expect, it } from 'vitest'
import { CH } from '../shared/channels'
import { OSC52_MAX } from '../shared/termLimits'
import { CLIPBOARD_WRITE_MAX, registerTermIpc, type TermIpcDeps } from './ipc'

// THE ONE WRITE THE PAGE MAY MAKE TO THE CLIPBOARD (#12, the help panel's copy
// buttons). It is text, it is bounded, and an oversized write is REFUSED, not
// trimmed: a trimmed command is a different command.

function wire(extra: Partial<TermIpcDeps> = {}): {
  write: (text: unknown) => unknown
  termWrite: (text: unknown) => unknown
  written: string[]
  stop: () => void
} {
  const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
  const listeners = new Map<string, (e: unknown, ...args: unknown[]) => void>()
  const written: string[] = []
  const stop = registerTermIpc({
    ipcMain: {
      handle: (channel, listener) => handlers.set(channel, listener),
      on: (channel, listener) => listeners.set(channel, listener)
    },
    send: () => undefined,
    clipboard: {
      availableFormats: () => [],
      readBuffer: () => Buffer.alloc(0),
      readText: () => '',
      writeText: (text) => {
        written.push(text)
      }
    },
    openExternal: () => undefined,
    spawnDir: async () => null,
    mayPrewarm: async () => false,
    mayCd: () => false,
    ...extra
  })
  return {
    write: (text) => handlers.get(CH.clipboardWrite)?.({}, text),
    termWrite: (text) => handlers.get(CH.clipboardTerm)?.({}, text),
    written,
    stop
  }
}

describe('clipboard:write', () => {
  it('writes the exact text it was handed', () => {
    const w = wire()
    const command = "Get-ChildItem -Recurse -File | Sort-Object Length -Descending | Select-Object -First 20"
    expect(w.write(command)).toBe(true)
    expect(w.written).toEqual([command])
    w.stop()
  })

  it('refuses what is not text, what is empty and what is too long, and writes none of it', () => {
    const w = wire()
    for (const bad of [undefined, null, 7, {}, ['x'], '', 'x'.repeat(CLIPBOARD_WRITE_MAX + 1)]) expect(w.write(bad)).toBe(false)
    expect(w.written).toEqual([])
    expect(w.write('x'.repeat(CLIPBOARD_WRITE_MAX))).toBe(true)
    w.stop()
  })
})

// A PROGRAM'S COPY, OSC 52 (#176): a channel of its own, because the help
// panel's 4000 cap is right for a command and wrong for what Claude's /copy
// puts there. Up to OSC52_MAX, refused (never trimmed) over it.
describe('clipboard:term-write', () => {
  it('writes a string, up to and including the cap', () => {
    const w = wire()
    expect(w.termWrite('OSC52 æ')).toBe(true)
    const big = 'x'.repeat(OSC52_MAX)
    expect(w.termWrite(big)).toBe(true)
    expect(w.written).toEqual(['OSC52 æ', big])
    w.stop()
  })

  it('refuses a non-string, an empty one and one over the cap', () => {
    const w = wire()
    for (const bad of [undefined, null, 7, {}, ['x'], '', 'x'.repeat(OSC52_MAX + 1)]) expect(w.termWrite(bad)).toBe(false)
    expect(w.written).toEqual([])
    w.stop()
  })
})
