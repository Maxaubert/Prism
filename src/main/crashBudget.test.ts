import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { crashBudget } from './crashBudget'
import { appendCrashLog, crashLine } from './crashLog'

const MIN = 60_000

describe('crashBudget', () => {
  it('reloads, then rebuilds the window on the third death in two minutes', () => {
    const b = crashBudget()
    expect(b.record(0)).toBe('reload')
    expect(b.record(10_000)).toBe('reload')
    expect(b.record(20_000)).toBe('recreate')
  })

  it('forgets deaths older than the window', () => {
    const b = crashBudget()
    expect(b.record(0)).toBe('reload')
    expect(b.record(1 * MIN)).toBe('reload')
    // The first is 2 minutes old now, so this is the second in the window.
    expect(b.record(2 * MIN)).toBe('reload')
    expect(b.record(2 * MIN + 1)).toBe('recreate')
  })

  it('the rebuilt window starts its own count, and the same run after it gives up', () => {
    const b = crashBudget()
    for (const t of [0, 1, 2]) b.record(t)
    expect(b.record(3)).toBe('reload')
    expect(b.record(4)).toBe('reload')
    expect(b.record(5)).toBe('give-up')
  })

  it('a rebuild long ago does not count against a new run', () => {
    const b = crashBudget()
    for (const t of [0, 1]) b.record(t)
    expect(b.record(2)).toBe('recreate')
    const later = 11 * MIN
    expect(b.record(later)).toBe('reload')
    expect(b.record(later + 1)).toBe('reload')
    expect(b.record(later + 2)).toBe('recreate')
  })

  it('takes its limits as options', () => {
    const b = crashBudget({ limit: 1, recreates: 0 })
    expect(b.record(0)).toBe('give-up')
  })
})

describe('crash log', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'prism-crashlog-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('writes one line per entry, newlines in a value flattened', () => {
    const file = join(dir, 'window-crashes.log')
    appendCrashLog(file, crashLine(new Date(0), 'gone', { reason: 'crashed', exitCode: 5, url: '' }))
    appendCrashLog(file, crashLine(new Date(1000), 'watchdog', { shown: false, note: 'a\nb' }))
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n')
    expect(lines).toEqual([
      '1970-01-01T00:00:00.000Z gone reason=crashed exitCode=5',
      '1970-01-01T00:00:01.000Z watchdog shown=false note=a b'
    ])
  })

  it('rotates past the cap, keeping one older file', () => {
    const file = join(dir, 'window-crashes.log')
    writeFileSync(file, 'x'.repeat(90) + '\n')
    appendCrashLog(file, 'y'.repeat(20), 100)
    expect(readFileSync(`${file}.old`, 'utf8')).toBe('x'.repeat(90) + '\n')
    expect(readFileSync(file, 'utf8')).toBe('y'.repeat(20) + '\n')
    appendCrashLog(file, 'z', 100)
    expect(readFileSync(file, 'utf8')).toBe('y'.repeat(20) + '\nz\n')
  })

  it('never throws when the folder is not there', () => {
    const file = join(dir, 'missing', 'window-crashes.log')
    expect(() => appendCrashLog(file, 'line')).not.toThrow()
    expect(existsSync(file)).toBe(false)
  })
})
