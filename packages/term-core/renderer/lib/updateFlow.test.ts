import { describe, expect, it } from 'vitest'
import type { UpdateInfo } from '../../shared/updateTypes'
import { INSTALL_FAILED, NO_UPDATE, PREVIEW_DONE, updateFlow, type UpdateFlow } from './updateFlow'

const REAL: UpdateInfo = {
  version: '0.5.0',
  url: 'https://github.com/o/r/releases/download/v0.5.0/a.exe',
  notes: '* x'
}
const MOCK: UpdateInfo = { version: '0.5.0', url: '', notes: '* x', mock: true }

const run = (from: UpdateFlow, ...actions: Parameters<typeof updateFlow>[1][]): UpdateFlow =>
  actions.reduce(updateFlow, from)
const offered = (info: UpdateInfo = REAL): UpdateFlow => run(NO_UPDATE, { type: 'available', info })

describe('updateFlow: the offer and its window', () => {
  it('starts with nothing: no chip, no window', () => {
    expect(NO_UPDATE).toEqual({
      info: null,
      phase: 'idle',
      pct: 0,
      open: false,
      notice: null,
      aborting: false
    })
  })

  it('an offer shows the chip and does NOT open the window by itself', () => {
    const s = offered()
    expect(s.info).toEqual(REAL)
    expect(s.open).toBe(false)
  })

  it('a click opens the window; Cancel closes it and changes nothing else', () => {
    const open = run(offered(), { type: 'open' })
    expect(open.open).toBe(true)
    expect(run(open, { type: 'cancel' })).toEqual(offered())
  })

  it('cannot open a window about nothing', () => {
    expect(run(NO_UPDATE, { type: 'open' }).open).toBe(false)
  })

  it('takes a newer offer while idle, the window staying as it was', () => {
    const newer = { ...REAL, version: '0.6.0' }
    const s = run(offered(), { type: 'open' }, { type: 'available', info: newer })
    expect(s.info).toEqual(newer)
    expect(s.open).toBe(true)
  })
})

describe('updateFlow: installing', () => {
  it('Install KEEPS the window up and the bar starts from 0 (#32)', () => {
    const s = run(offered(), { type: 'open' }, { type: 'install' })
    expect(s).toMatchObject({ open: true, phase: 'downloading', pct: 0, notice: null })
  })

  it('brings the window up for an install started with it hidden (the host asked first)', () => {
    const s = run(offered(), { type: 'open' }, { type: 'hide' }, { type: 'install' })
    expect(s).toMatchObject({ open: true, phase: 'downloading' })
  })

  it('cannot be put away by the USER while it runs: Cancel, Escape, a press outside', () => {
    const s = run(offered(), { type: 'open' }, { type: 'install' }, { type: 'progress', pct: 10 })
    expect(run(s, { type: 'cancel' })).toEqual(s)
    const installing = run(s, { type: 'progress', pct: 100 })
    expect(run(installing, { type: 'cancel' })).toEqual(installing)
  })

  it('the HOST can hide it while it runs; the install carries on and it comes back', () => {
    const s = run(offered(), { type: 'install' }, { type: 'progress', pct: 10 }, { type: 'hide' })
    expect(s).toMatchObject({ open: false, phase: 'downloading', pct: 10 })
    const back = run(s, { type: 'progress', pct: 40 }, { type: 'open' })
    expect(back).toMatchObject({ open: true, phase: 'downloading', pct: 40 })
  })

  it('progress fills the bar, and 100 is "installing"', () => {
    const s = run(offered(), { type: 'install' }, { type: 'progress', pct: 42 })
    expect(s).toMatchObject({ phase: 'downloading', pct: 42 })
    expect(run(s, { type: 'progress', pct: 100 })).toMatchObject({ phase: 'installing', pct: 100 })
  })

  it('reads a percentage defensively', () => {
    const s = run(offered(), { type: 'install' })
    expect(run(s, { type: 'progress', pct: 250 }).pct).toBe(100)
    expect(run(s, { type: 'progress', pct: -5 }).pct).toBe(0)
    expect(run(s, { type: 'progress', pct: Number.NaN }).pct).toBe(0)
    expect(run(s, { type: 'progress', pct: 41.6 }).pct).toBe(42)
  })

  it('never runs the bar backwards', () => {
    const s = run(
      offered(),
      { type: 'install' },
      { type: 'progress', pct: 60 },
      { type: 'progress', pct: 30 }
    )
    expect(s.pct).toBe(60)
  })

  it('ignores progress nobody asked for', () => {
    expect(run(offered(), { type: 'progress', pct: 50 })).toEqual(offered())
  })

  it('cannot be started twice, and opening a window that is up changes nothing', () => {
    const s = run(offered(), { type: 'install' }, { type: 'progress', pct: 10 })
    expect(run(s, { type: 'open' })).toEqual(s)
    expect(run(s, { type: 'install' })).toEqual(s)
  })

  it('holds the offer it is installing: a newer one waits for the next launch', () => {
    const s = run(
      offered(),
      { type: 'install' },
      { type: 'available', info: { ...REAL, version: '9.9.9' } }
    )
    expect(s.info).toEqual(REAL)
  })

  it('cannot install nothing', () => {
    expect(run(NO_UPDATE, { type: 'install' })).toEqual(NO_UPDATE)
  })
})

describe('updateFlow: how an install ends', () => {
  it('a success changes nothing: the app is quitting under the installer', () => {
    const s = run(offered(), { type: 'install' }, { type: 'progress', pct: 100 })
    expect(run(s, { type: 'settled', ok: true })).toEqual(s)
  })

  it('a failure goes back to idle and says so IN the window, which is still up', () => {
    const s = run(
      offered(),
      { type: 'install' },
      { type: 'progress', pct: 30 },
      { type: 'settled', ok: false }
    )
    expect(s).toMatchObject({
      phase: 'idle',
      pct: 0,
      open: true,
      notice: INSTALL_FAILED,
      info: REAL
    })
  })

  it('a failure with the window hidden is said under the chip instead', () => {
    const s = run(offered(), { type: 'install' }, { type: 'hide' }, { type: 'settled', ok: false })
    expect(s).toMatchObject({ phase: 'idle', open: false, notice: INSTALL_FAILED })
  })

  it('closing the window that said how it ended clears the line: it was read', () => {
    const s = run(offered(), { type: 'install' }, { type: 'settled', ok: false }, { type: 'cancel' })
    expect(s).toEqual(offered())
  })

  it('a preview goes back to idle and says it was one', () => {
    const s = run(
      offered(MOCK),
      { type: 'install' },
      { type: 'progress', pct: 100 },
      { type: 'settled', ok: false }
    )
    expect(s).toMatchObject({ phase: 'idle', pct: 0, notice: PREVIEW_DONE })
    expect(PREVIEW_DONE).toBe('Preview only: nothing was installed')
  })

  it('the line goes when dismissed, and when the window is opened again', () => {
    const s = run(
      offered(MOCK),
      { type: 'install' },
      { type: 'hide' },
      { type: 'settled', ok: false }
    )
    expect(run(s, { type: 'dismiss' }).notice).toBeNull()
    expect(run(s, { type: 'open' })).toMatchObject({ notice: null, open: true })
  })

  it('can be run again straight from the window that said it ended', () => {
    const s = run(
      offered(MOCK),
      { type: 'install' },
      { type: 'settled', ok: false },
      { type: 'install' }
    )
    expect(s).toMatchObject({ phase: 'downloading', pct: 0, notice: null, open: true })
  })

  it('ignores an ending with nothing running', () => {
    expect(run(offered(), { type: 'settled', ok: false })).toEqual(offered())
  })
})

describe('updateFlow: cancelling a download (#32)', () => {
  it('a cancel is not a failure: the window goes, nothing is said, the offer stands', () => {
    const s = run(
      offered(),
      { type: 'open' },
      { type: 'install' },
      { type: 'progress', pct: 30 },
      { type: 'abort' }
    )
    expect(s).toMatchObject({ aborting: true, phase: 'downloading', open: true })
    expect(run(s, { type: 'settled', ok: false })).toEqual(offered())
  })

  it('only a DOWNLOAD can be cancelled: not idle, not once the installer has the file', () => {
    expect(run(offered(), { type: 'abort' })).toEqual(offered())
    const installing = run(offered(), { type: 'install' }, { type: 'progress', pct: 100 })
    expect(run(installing, { type: 'abort' })).toEqual(installing)
  })

  it('a cancel that lost the race changes nothing: the app is quitting', () => {
    const s = run(offered(), { type: 'install' }, { type: 'abort' })
    expect(run(s, { type: 'settled', ok: true })).toEqual(s)
  })

  it('the next install does not inherit the cancel', () => {
    const s = run(
      offered(),
      { type: 'install' },
      { type: 'abort' },
      { type: 'settled', ok: false },
      { type: 'install' },
      { type: 'settled', ok: false }
    )
    expect(s).toMatchObject({ aborting: false, notice: INSTALL_FAILED })
  })
})
