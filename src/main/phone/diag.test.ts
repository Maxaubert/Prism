import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PhoneLog, diagLines, DIAG_MAX_LINES, DIAG_MAX_CHARS } from './diag'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prism-diag-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('PhoneLog', () => {
  it('appends stamped lines in order, one record each', async () => {
    const log = new PhoneLog(join(dir, 'phone.log'))
    log.line('first')
    log.line('two\nlines')
    await log.flush()
    const lines = readFileSync(join(dir, 'phone.log'), 'utf8').trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT\S+ first$/)
    expect(lines[1]).toMatch(/ two lines$/)
  })

  it('makes the folder it writes into: the first lines land before any job has made it', async () => {
    const log = new PhoneLog(join(dir, 'phone', 'phone.log'))
    log.line('opening')
    await log.flush()
    expect(readFileSync(join(dir, 'phone', 'phone.log'), 'utf8')).toMatch(/ opening\n$/)
  })

  it('rotates a file past the cap into .1 rather than growing', async () => {
    const file = join(dir, 'phone.log')
    writeFileSync(file, 'x'.repeat(2 * 1024 * 1024 + 1))
    const log = new PhoneLog(file)
    log.line('fresh')
    await log.flush()
    expect(existsSync(`${file}.1`)).toBe(true)
    expect(readFileSync(file, 'utf8')).toMatch(/ fresh\n$/)
  })
})

describe('diagLines', () => {
  it('takes a handful of short strings and nothing else', () => {
    expect(diagLines(null)).toEqual([])
    expect(diagLines({ lines: 'no' })).toEqual([])
    expect(diagLines({ lines: ['a', 2, '', 'b\r\nc'] })).toEqual(['a', 'b c'])
    const many = diagLines({ lines: Array.from({ length: 500 }, (_, i) => `l${i}`) })
    expect(many).toHaveLength(DIAG_MAX_LINES)
    expect(diagLines({ lines: ['y'.repeat(5000)] })[0]).toHaveLength(DIAG_MAX_CHARS)
  })
})
