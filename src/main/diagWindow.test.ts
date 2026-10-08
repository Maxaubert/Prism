import { afterEach, beforeEach, expect, it } from 'vitest'
import { NULL_DIAG_LOG, setDiagMain } from 'prism-term-core/main/diagLog'
import { diagWindowEvent } from './diagWindow'

const lines: Array<{ src: string; k: string; fields?: Record<string, unknown> }> = []
beforeEach(() => {
  lines.length = 0
  setDiagMain({ ...NULL_DIAG_LOG, write: (src, k, fields) => void lines.push({ src, k, fields }) })
})
afterEach(() => setDiagMain(null))

it('leaves what the core already writes to the core', () => {
  diagWindowEvent('gone', { reason: 'crashed', action: 'reload' })
  diagWindowEvent('unresponsive', { url: 'x' })
  diagWindowEvent('responsive', {})
  expect(lines).toEqual([])
})

it('writes a hang and the watchdog as a problem the reader lists', () => {
  diagWindowEvent('hang', { ms: 45000, url: 'x' })
  diagWindowEvent('watchdog', { shown: false, gone: true })
  expect(lines).toEqual([
    { src: 'main', k: 'window-slow', fields: { ms: 45000, url: 'x', event: 'hang' } },
    { src: 'main', k: 'window-slow', fields: { shown: false, gone: true, event: 'watchdog' } }
  ])
  expect(lines.every((l) => /-slow$/.test(l.k))).toBe(true)
})

it('writes the rest as crumbs', () => {
  diagWindowEvent('handoff', { window: 'none', action: 'create' })
  diagWindowEvent('restore', { tabs: 'skipped' })
  expect(lines.map((l) => [l.k, l.fields?.a])).toEqual([
    ['crumb', 'window-handoff'],
    ['crumb', 'window-restore']
  ])
})
