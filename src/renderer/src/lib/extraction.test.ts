import { describe, expect, it } from 'vitest'
import {
  IDLE,
  MIN_SHOW_MS,
  failureText,
  fitPath,
  leavesAt,
  reduce,
  type ExtractState
} from './extraction'

const start = (id = 'x1', at = 1000): ExtractState =>
  reduce(IDLE, { type: 'start', id, archive: 'comics.zip', dest: 'X:\\Comics' }, at)

describe('the extraction window, as a state machine', () => {
  it('is idle until main says an extraction started', () => {
    expect(IDLE.phase).toBe('idle')
    const s = start()
    expect(s).toMatchObject({
      phase: 'running',
      id: 'x1',
      archive: 'comics.zip',
      dest: 'X:\\Comics',
      pct: null,
      file: '',
      since: 1000
    })
  })

  it('takes progress for the job on screen, and only for it', () => {
    let s = start()
    s = reduce(s, { type: 'progress', id: 'x1', pct: 42, file: 'a/one.jpg' }, 1100)
    expect(s).toMatchObject({ phase: 'running', pct: 42, file: 'a/one.jpg' })
    const other = reduce(s, { type: 'progress', id: 'someone-else', pct: 99, file: 'z' }, 1200)
    expect(other).toBe(s)
  })

  it('never lets the bar run backwards', () => {
    // 7-Zip's percentage and the file-count fallback are two measures of one
    // job, and a chunk of the second arriving after the first must not pull
    // the fill back.
    let s = start()
    s = reduce(s, { type: 'progress', id: 'x1', pct: 60, file: 'a' }, 1100)
    s = reduce(s, { type: 'progress', id: 'x1', pct: 35, file: 'b' }, 1200)
    expect(s).toMatchObject({ pct: 60, file: 'b' })
  })

  it('keeps the last percentage when a message carries only a name', () => {
    let s = start()
    s = reduce(s, { type: 'progress', id: 'x1', pct: 60, file: 'a' }, 1100)
    s = reduce(s, { type: 'progress', id: 'x1', pct: null, file: 'b' }, 1200)
    expect(s).toMatchObject({ pct: 60, file: 'b' })
  })

  it('closes by itself on success once it has been seen', () => {
    const s = reduce(start(), { type: 'end', id: 'x1', result: 'done' }, 1000 + MIN_SHOW_MS)
    expect(s).toBe(IDLE)
  })

  it('lingers, full, when the work finished before anyone could have seen it', () => {
    // A small zip extracts inside a frame. A window that flashes for 30ms
    // reads as a glitch, and one that never paints reads as nothing having
    // happened, which is what the paste chip's minimum was for.
    const s = reduce(start(), { type: 'end', id: 'x1', result: 'done' }, 1050)
    expect(s).toMatchObject({ phase: 'leaving', pct: 100 })
    expect(leavesAt(s)).toBe(1000 + MIN_SHOW_MS)
    expect(reduce(s, { type: 'tick' }, 1000 + MIN_SHOW_MS - 1)).toBe(s)
    expect(reduce(s, { type: 'tick' }, 1000 + MIN_SHOW_MS)).toBe(IDLE)
  })

  it('Cancel is a request: the window waits for main to have cleaned up', () => {
    let s = start()
    s = reduce(s, { type: 'cancel-asked' }, 1500)
    expect(s.phase).toBe('cancelling')
    // Progress still in flight does not bring the button back.
    s = reduce(s, { type: 'progress', id: 'x1', pct: 70, file: 'late' }, 1600)
    expect(s.phase).toBe('cancelling')
    // No error and no lingering: the user acted, and saw themselves do it.
    expect(reduce(s, { type: 'end', id: 'x1', result: 'cancelled' }, 1700)).toBe(IDLE)
  })

  it('a cancel that lost the race with the finish line is a finish', () => {
    let s = start()
    s = reduce(s, { type: 'cancel-asked' }, 1500)
    expect(reduce(s, { type: 'end', id: 'x1', result: 'done' }, 5000)).toBe(IDLE)
  })

  it('Cancel means nothing when there is nothing running', () => {
    expect(reduce(IDLE, { type: 'cancel-asked' }, 1)).toBe(IDLE)
  })

  it('a failure turns the SAME window into the error, with what 7-Zip said', () => {
    const s = reduce(
      start(),
      { type: 'end', id: 'x1', result: 'failed', reason: 'failed', message: 'ERROR: Data Error' },
      1200
    )
    expect(s).toMatchObject({
      phase: 'failed',
      id: 'x1',
      archive: 'comics.zip',
      reason: 'failed',
      message: 'ERROR: Data Error'
    })
    // And only Close takes it away.
    expect(reduce(s, { type: 'tick' }, 99999)).toBe(s)
    expect(reduce(s, { type: 'cancel-asked' }, 99999)).toBe(s)
    expect(reduce(s, { type: 'dismiss' }, 99999)).toBe(IDLE)
  })

  it('a wrong password closes quietly when the caller is about to ask for one', () => {
    const s = reduce(
      IDLE,
      { type: 'start', id: 'x2', archive: 'a.zip', dest: 'C:\\out', asksPassword: true },
      0
    )
    expect(reduce(s, { type: 'end', id: 'x2', result: 'failed', reason: 'password' }, 10)).toBe(
      IDLE
    )
    // Any other failure on that route is still an error.
    expect(reduce(s, { type: 'end', id: 'x2', result: 'failed', reason: 'failed' }, 10).phase).toBe(
      'failed'
    )
  })

  it('a password failure is the error when nobody is going to ask', () => {
    const s = reduce(start(), { type: 'end', id: 'x1', result: 'failed', reason: 'password' }, 10)
    expect(s.phase).toBe('failed')
  })

  it('ignores the end of a job that is not the one on screen', () => {
    const s = start()
    expect(reduce(s, { type: 'end', id: 'ghost', result: 'done' }, 5000)).toBe(s)
  })

  it('Dismiss does not close a running extraction', () => {
    // Escape and a click outside are not wired to anything, but the reducer
    // is the last line: nothing but the end of the work takes the window down.
    const s = start()
    expect(reduce(s, { type: 'dismiss' }, 1)).toBe(s)
  })

  it('a new start replaces an error left on screen', () => {
    const failed = reduce(start(), { type: 'end', id: 'x1', result: 'failed' }, 10)
    const next = reduce(failed, { type: 'start', id: 'x9', archive: 'b.7z', dest: 'D:\\' }, 20)
    expect(next).toMatchObject({ phase: 'running', id: 'x9', archive: 'b.7z' })
  })
})

describe('what the error says', () => {
  it('names the password case in words somebody can act on', () => {
    expect(failureText('password')).toMatch(/password protected/i)
  })

  it('says the bundled 7-Zip is missing for AES', () => {
    expect(failureText('aes')).toMatch(/7-Zip/)
  })

  it("is the reason alone, since the window's heading says it failed (#336)", () => {
    expect(failureText('failed', 'ERROR: There is not enough space on the disk')).toBe(
      'ERROR: There is not enough space on the disk'
    )
    expect(failureText('failed')).toBe('No reason was given.')
    expect(failureText(undefined)).toBe('No reason was given.')
  })
})

describe('the file line, fitted in the MIDDLE so the name is kept', () => {
  // One unit per character: a stand-in for the canvas measure.
  const within = (n: number) => (s: string) => s.length <= n

  it('leaves a path that fits alone', () => {
    expect(fitPath('a\\one.txt', within(20))).toBe('a\\one.txt')
    expect(fitPath('', within(5))).toBe('')
  })

  it('cuts the folders and keeps the whole file name', () => {
    const long = 'mods\\mod_HDReworkedProject\\content\\textures\\cobblestone_path_02_n.dds'
    const out = fitPath(long, within(40))
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.endsWith('\\cobblestone_path_02_n.dds')).toBe(true)
    expect(out.startsWith('mods\\mod_HD')).toBe(true)
    expect(out).toContain('…')
  })

  it('reads forward slashes too, as a zip names its members', () => {
    const out = fitPath('Comics/2019/Some Very Long Series Name/issue 042.cbz', within(24))
    expect(out.endsWith('/issue 042.cbz')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(24)
  })

  it('shortens the name itself only when the name alone is too long', () => {
    const out = fitPath('a\\b\\an extremely long file name of a scan.jpg', within(16))
    expect(out.length).toBeLessThanOrEqual(16)
    expect(out.startsWith('…\\an')).toBe(true)
    expect(out.endsWith('.jpg')).toBe(true)
  })

  it('does not fall over when nothing fits', () => {
    expect(fitPath('abcdef', within(0))).toBe('…')
  })
})
