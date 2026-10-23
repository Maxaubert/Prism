import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createDiagLog, diagMain, NULL_DIAG_LOG, setDiagMain, type DiagLog } from './diagLog'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'pt-diag-'))
const lines = (file: string): Array<Record<string, unknown>> =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    : []

let open: DiagLog[] = []
const make = (opts: Parameters<typeof createDiagLog>[0]): DiagLog => {
  const log = createDiagLog(opts)
  open.push(log)
  return log
}
afterEach(() => {
  for (const l of open) l.close()
  open = []
  vi.useRealTimers()
})

describe('createDiagLog', () => {
  it('writes one flat JSON object per line, with the time, the uptime, the source and the kind', async () => {
    const dir = join(scratch(), 'logs')
    const log = make({ dir, now: () => Date.UTC(2026, 9, 7, 9, 12, 3, 412), uptime: () => 12345 })
    log.write('main', 'main-lag', { ms: 140 })
    await log.flush()
    expect(lines(log.file)).toEqual([{ t: '2026-10-07T09:12:03.412Z', up: 12345, src: 'main', k: 'main-lag', ms: 140 }])
  })

  it('batches the appends and keeps their order', async () => {
    vi.useFakeTimers()
    const dir = join(scratch(), 'logs')
    const log = make({ dir })
    log.write('main', 'crumb', { a: 'one' })
    log.write('page', 'crumb', { a: 'two' })
    expect(lines(log.file)).toEqual([])
    await vi.advanceTimersByTimeAsync(300)
    await log.flush()
    expect(lines(log.file).map((l) => l.a)).toEqual(['one', 'two'])
  })

  it('flushes synchronously at quit, so the last line before a crash lands', () => {
    const dir = join(scratch(), 'logs')
    const log = make({ dir })
    log.write('main', 'crumb', { a: 'last' })
    log.flushSync()
    expect(lines(log.file).map((l) => l.a)).toEqual(['last'])
  })

  it('rotates at the cap to .1 through .4, so an app never holds more than five files', async () => {
    const dir = join(scratch(), 'logs')
    const log = make({ dir, maxBytes: 1000 })
    for (let round = 0; round < 7; round += 1) {
      for (let i = 0; i < 12; i += 1) log.write('main', 'crumb', { a: `r${round}-${i}`, pad: 'p'.repeat(40) })
      await log.flush()
    }
    expect(existsSync(log.file)).toBe(true)
    for (const n of [1, 2, 3, 4]) expect(existsSync(`${log.file}.${n}`), `.${n}`).toBe(true)
    expect(existsSync(`${log.file}.5`)).toBe(false)
    // The newest line is in the live file, and no file grew far past the cap.
    expect(lines(log.file).at(-1)?.a).toBe('r6-11')
    for (const f of [log.file, `${log.file}.1`]) expect(readFileSync(f).length).toBeLessThan(2000)
  })

  it('keeps writing when a rotation fails, says so once, and rotates again later', async () => {
    const dir = join(scratch(), 'logs')
    let up = 1000
    const log = make({ dir, maxBytes: 300, uptime: () => up })
    // A folder with a file in it where `.4` goes: `rmSync` without recursive
    // refuses it, as a rename refuses a file held open without share-delete.
    mkdirSync(join(dir, 'diag.jsonl.4'), { recursive: true })
    writeFileSync(join(dir, 'diag.jsonl.4', 'held'), 'x')
    for (let round = 0; round < 5; round += 1) {
      for (let i = 0; i < 4; i += 1) log.write('main', 'crumb', { a: `r${round}-${i}`, pad: 'p'.repeat(40) })
      await log.flush()
    }
    const live = lines(log.file)
    // Nothing was dropped: every line is in the live file, with the reason.
    for (let round = 0; round < 5; round += 1)
      for (let i = 0; i < 4; i += 1) expect(live.some((l) => l.a === `r${round}-${i}`)).toBe(true)
    expect(live.filter((l) => l.k === 'logger-error')).toHaveLength(1)
    expect(log.failed()).toBe(true)
    expect(existsSync(`${log.file}.1`)).toBe(false)
    // The obstacle goes; 30 s later the rotation is tried again and works.
    rmSync(join(dir, 'diag.jsonl.4'), { recursive: true, force: true })
    up += 30_000
    log.write('main', 'crumb', { a: 'after', pad: 'p'.repeat(40) })
    await log.flush()
    expect(existsSync(`${log.file}.1`)).toBe(true)
    expect(lines(log.file).map((l) => l.a)).toEqual(['after'])
  })

  // Perf review 2026-10-16: rotation was rmSync and renameSync on main.
  it('rotates on the threadpool: nothing is renamed before the event loop turns', async () => {
    const dir = join(scratch(), 'logs')
    const log = make({ dir, maxBytes: 300 })
    for (let i = 0; i < 4; i += 1) log.write('main', 'crumb', { a: `one-${i}`, pad: 'p'.repeat(40) })
    await log.flush()
    log.write('main', 'crumb', { a: 'two', pad: 'p'.repeat(40) })
    const done = log.flush()
    // Every microtask the chain could run: a synchronous rotation would be done.
    for (let i = 0; i < 20; i += 1) await Promise.resolve()
    expect(existsSync(`${log.file}.1`)).toBe(false)
    await done
    expect(existsSync(`${log.file}.1`)).toBe(true)
    expect(lines(log.file).map((l) => l.a)).toEqual(['two'])
  })

  // Perf review 2026-10-16: a link per flush behind a stuck write.
  it('keeps one flush waiting behind a stuck one, not one per call', async () => {
    const dir = join(scratch(), 'logs')
    const log = make({ dir })
    log.write('main', 'crumb', { a: 'first' })
    const first = log.flush()
    // The first starts its write, which waits on the threadpool.
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
    log.write('main', 'crumb', { a: 'second' })
    const waiting = log.flush()
    expect(waiting).not.toBe(first)
    for (let i = 0; i < 50; i += 1) {
      log.write('main', 'crumb', { a: `more-${i}` })
      expect(log.flush()).toBe(waiting)
    }
    await first
    await waiting
    expect(lines(log.file)).toHaveLength(52)
  })

  it('writes a batch the async path took ahead of the quit lines, never after them or twice', async () => {
    const dir = join(scratch(), 'logs')
    const log = make({ dir })
    log.write('main', 'crumb', { a: 'before' })
    const pending = log.flush()
    // Let the async path take the batch and start its append.
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
    log.write('main', 'quit', {})
    log.flushSync()
    expect(lines(log.file).map((l) => l.a ?? l.k)).toEqual(['before', 'quit'])
    await pending
    expect(lines(log.file).map((l) => l.a ?? l.k)).toEqual(['before', 'quit'])
  })

  it('drops the newest lines of a flood, not the first, and counts them', async () => {
    const dir = join(scratch(), 'logs')
    const log = make({ dir })
    for (let i = 0; i < 2500; i += 1) log.write('page', 'page-error', { msg: `e${i}` })
    await log.flush()
    const got = lines(log.file)
    expect(got[0].msg).toBe('e0')
    expect(got.filter((l) => l.k === 'page-error')).toHaveLength(2000)
    expect(got.at(-1)).toMatchObject({ k: 'logger-dropped', n: 500 })
  })

  it('picks up an existing file size, so a relaunch rotates on time too', async () => {
    const dir = join(scratch(), 'logs')
    const first = make({ dir, maxBytes: 500 })
    mkdirSync(dir, { recursive: true })
    writeFileSync(first.file, 'x'.repeat(490) + '\n')
    first.close()
    const log = make({ dir, maxBytes: 500 })
    log.write('main', 'crumb', { a: 'after' })
    await log.flush()
    expect(existsSync(`${log.file}.1`)).toBe(true)
    expect(lines(log.file).map((l) => l.a)).toEqual(['after'])
  })

  it('remembers the verbose switch across a relaunch, and logs the change', async () => {
    const root = scratch()
    const dir = join(root, 'logs')
    const log = make({ dir })
    expect(log.verbose()).toBe(false)
    log.setVerbose(true)
    await log.flush()
    expect(lines(log.file).at(-1)).toMatchObject({ k: 'verbose', on: true })
    expect(JSON.parse(readFileSync(join(root, 'diag.json'), 'utf8'))).toEqual({ verbose: true })
    log.close()
    expect(make({ dir }).verbose()).toBe(true)
  })

  it('reads a damaged state file as quiet', () => {
    const root = scratch()
    writeFileSync(join(root, 'diag.json'), '{not json')
    expect(make({ dir: join(root, 'logs') }).verbose()).toBe(false)
  })

  it('never throws, and says once that it could not write', async () => {
    const root = scratch()
    // A FILE where the folder should be: every write fails.
    const dir = join(root, 'logs')
    writeFileSync(dir, 'in the way')
    const log = make({ dir })
    expect(() => log.write('main', 'crumb', { a: 'x' })).not.toThrow()
    await expect(log.flush()).resolves.toBeUndefined()
    expect(() => log.flushSync()).not.toThrow()
    expect(log.failed()).toBe(true)
  })

  it('keeps its own four keys whatever the fields say (MEASURED: a page error named its script src)', async () => {
    const dir = join(scratch(), 'logs')
    const log = make({ dir, uptime: () => 7 })
    log.write('page', 'page-error', { src: null, k: 'session', up: 0, t: 'x', msg: 'm' })
    await log.flush()
    expect(lines(log.file)[0]).toMatchObject({ src: 'page', k: 'page-error', up: 7, msg: 'm' })
  })

  it('caps what a caller hands it', async () => {
    const dir = join(scratch(), 'logs')
    const log = make({ dir })
    log.write('page', 'page-error', { msg: 'm'.repeat(1000) })
    await log.flush()
    expect((lines(log.file)[0].msg as string).length).toBeLessThan(320)
  })
})

describe('diagMain', () => {
  it('is a log that writes nothing until a host starts one', () => {
    expect(diagMain()).toBe(NULL_DIAG_LOG)
    expect(() => diagMain().write('main', 'crumb', {})).not.toThrow()
    const dir = join(scratch(), 'logs')
    const log = make({ dir })
    setDiagMain(log)
    expect(diagMain()).toBe(log)
    setDiagMain(null)
    expect(diagMain()).toBe(NULL_DIAG_LOG)
  })
})
