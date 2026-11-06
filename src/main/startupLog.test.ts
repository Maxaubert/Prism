import { describe, expect, it } from 'vitest'
import { bootFields, createStartupLog, launchReason } from './startupLog'

function harness() {
  let now = 0
  const lines: Array<Record<string, unknown>> = []
  let fire: (() => void) | null = null
  const log = createStartupLog({
    write: (f) => lines.push(f),
    up: () => now,
    after: (fn) => {
      fire = fn
      return { cancel: () => (fire = null) }
    }
  })
  return { log, lines, at: (ms: number) => (now = ms), timeout: () => fire?.() }
}

describe('the startup line (owner, 2026-11-06)', () => {
  it('a launch is written once, when the window has shown its first folder', () => {
    const h = harness()
    const l = h.log.begin('plain', { from: 0 })
    for (const [m, t] of [['ready', 180], ['made', 200], ['shown', 260], ['readyToShow', 250]] as const) {
      h.at(t)
      l.mark(m)
    }
    expect(h.lines).toEqual([])
    h.at(420)
    l.mark('listed')
    h.at(500)
    l.mark('restored')
    l.mark('listed')
    expect(h.lines).toEqual([
      { reason: 'plain', from: 0, ready: 180, made: 200, readyToShow: 250, shown: 260, listed: 420, shownMs: 260, listedMs: 420 }
    ])
    expect(l.done()).toBe(true)
  })

  it('a Win+E launch waits for the helper to be told, and says how long from the wake', () => {
    const h = harness()
    h.at(10_000)
    const l = h.log.begin('standby-wake', { winE: true, extra: { winE: 'abcd1234' } })
    h.at(10_050)
    l.mark('shown')
    h.at(10_300)
    l.mark('listed')
    expect(h.lines).toEqual([])
    h.at(10_420)
    l.mark('winEAck')
    expect(h.lines[0]).toMatchObject({ reason: 'standby-wake', from: 10_000, shownMs: 50, listedMs: 300, winEMs: 420, winE: 'abcd1234' })
  })

  it('gives up after the timeout with what it has, said as partial', () => {
    const h = harness()
    const l = h.log.begin('file', { from: 0 })
    h.at(300)
    l.mark('made')
    h.timeout()
    expect(h.lines).toEqual([{ reason: 'file', from: 0, made: 300, shownMs: undefined, listedMs: undefined, partial: true }])
    l.mark('shown')
    expect(h.lines.length).toBe(1)
  })
})

describe('why a launch happened', () => {
  it('a Win+E request first, then a file, a folder, or nothing', () => {
    expect(launchReason({ winE: true, paths: [{ dir: false }] })).toBe('win-e')
    expect(launchReason({ winE: false, paths: [{ dir: true }, { dir: false }] })).toBe('file')
    expect(launchReason({ winE: false, paths: [{ dir: true }] })).toBe('folder')
    expect(launchReason({ winE: false, paths: [] })).toBe('plain')
  })

  it('the OS start of the process, and the ms before the first line', () => {
    expect(bootFields(1_000.4, 1_380)).toEqual({ created: 1000, bootMs: 380 })
    expect(bootFields(null, 5)).toBeNull()
    expect(bootFields(0, 5)).toBeNull()
  })
})
