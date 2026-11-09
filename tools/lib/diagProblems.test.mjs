import { describe, expect, it } from 'vitest'
import { isContext, isProblem, opSummary } from './diagProblems.mjs'

/** The way the clipboard was written, as the log names it (a word, never a process started here). */
const PS = 'powershell'

describe('npm run diag shows failed operations and failure notes as problems (owner, 2026-11-06)', () => {
  it('a failed op is a problem; one that worked, or the user cancelled, is not', () => {
    expect(isProblem({ k: 'op', op: 'paste', ok: false, failed: 1 })).toBe(true)
    expect(isProblem({ k: 'op', op: 'paste', ok: true, landed: 1 })).toBe(false)
    expect(isProblem({ k: 'op', op: 'extract-to', ok: false, canceled: true })).toBe(false)
  })

  it('a note that says something failed is a problem; an info note is not', () => {
    expect(isProblem({ k: 'note', text: 'Nothing could be pasted here.', level: 'error' })).toBe(true)
    expect(isProblem({ k: 'note', text: 'Saved 2 copies, 1 could not be read', level: 'warn' })).toBe(true)
    expect(isProblem({ k: 'note', text: 'Saved 2 copies', level: 'info' })).toBe(false)
  })

  it('the old problems stay problems', () => {
    expect(isProblem({ k: 'ipc-slow' })).toBe(true)
    expect(isProblem({ k: 'sort-slow' })).toBe(true)
    expect(isProblem({ k: 'crumb' })).toBe(false)
  })

  it('every op line is context before a problem, so a note shows the op it came from', () => {
    expect(isContext({ k: 'op', op: 'copy', ok: true })).toBe(true)
    expect(isContext({ k: 'crumb' })).toBe(true)
    expect(isContext({ k: 'note' })).toBe(false)
  })

  it('says an op line briefly', () => {
    expect(
      opSummary({ k: 'op', op: 'paste', ok: false, to: 'C:\\d', n: 1, landed: 0, failed: 1, failures: [{ name: 'a.txt', reason: 'ENOENT' }], source: 'prism', why: 'write-failed', ms: 12 })
    ).toBe('paste FAILED to C:\\d: 1 asked, 0 landed, 1 failed (a.txt: ENOENT), from prism (write-failed), 12ms')
    expect(opSummary({ k: 'op', op: 'copy', ok: true, n: 1, source: 'zip-member', via: PS, ms: 387, attempts: 1 })).toBe(
      'copy ok: 1 asked, zip-member, via powershell, 387ms'
    )
    expect(opSummary({ k: 'op', op: 'copy', ok: false, n: 1, reason: 'timeout', phase: 'loaded', attempts: 2, ms: 20046 })).toBe(
      'copy FAILED: 1 asked, timeout at loaded, 2 attempts, 20046ms'
    )
  })
})

describe('a film that failed is a problem (owner, 2026-11-08)', () => {
  it('a film failure is listed and says what happened', () => {
    const noPicture = { k: 'op', op: 'film', ev: 'no-picture', ok: false, path: 'C:\\f.mov', ms: 4000, route: 'direct' }
    expect(isProblem(noPicture)).toBe(true)
    expect(opSummary(noPicture)).toBe('film FAILED C:\\f.mov: no-picture, direct, 4000ms')
    const err = { k: 'op', op: 'film', ev: 'error', ok: false, path: 'C:\\f.mov', code: 3, message: 'DECODE' }
    expect(isProblem(err)).toBe(true)
    expect(opSummary(err)).toContain('error')
    expect(opSummary(err)).toContain('code 3')
    expect(isProblem({ k: 'op', op: 'film', ev: 'first-frame', ok: true, path: 'C:\\f.mov' })).toBe(false)
    const job = { k: 'op', op: 'live-job', ev: 'exit', ok: false, job: 'a', code: 1, message: 'bad' }
    expect(isProblem(job)).toBe(true)
    expect(opSummary(job)).toContain('exit')
  })
})

describe('a stall nobody could see is no problem (owner, 2026-11-06)', () => {
  it("a hidden window's page-stall or window-slow is not listed; a shown one is", () => {
    expect(isProblem({ k: 'page-stall', ms: 1000, win: 'w2', hidden: true })).toBe(false)
    expect(isProblem({ k: 'window-slow', event: 'watchdog', hidden: true })).toBe(false)
    expect(isProblem({ k: 'page-stall', ms: 1000, win: 'w1', hidden: false })).toBe(true)
    expect(isProblem({ k: 'page-stall', ms: 1000 })).toBe(true)
  })

  it('the launch, hotkey, standby and quit lines are context', () => {
    for (const k of ['session', 'startup', 'win-e', 'second-instance', 'standby', 'quit', 'lock-lost'])
      expect(isContext({ k })).toBe(true)
    expect(isProblem({ k: 'raise-slow', ms: 400 })).toBe(true)
  })
})
