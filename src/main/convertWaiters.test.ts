import { describe, expect, it } from 'vitest'
import { createConvertWaiters } from './convertWaiters'

describe('the conversion waiters', () => {
  it('keeps a cancel that arrives while main is still probing (review, 2026-10-16)', () => {
    const stopped: string[] = []
    const w = createConvertWaiters((out) => stopped.push(out))
    const ask = w.join('C:\\film.wmv')
    // The viewer arrows away before convertVideo has even named the copy.
    w.cancel('C:\\film.wmv')
    expect(ask.cancelled).toBe(true)
    expect(w.started(ask, 'C:\\conv\\abc.mp4')).toBe(false)
    expect(stopped).toEqual(['C:\\conv\\abc.mp4'])
  })

  it('stops a running copy when its only viewer walks away', () => {
    const stopped: string[] = []
    const w = createConvertWaiters((out) => stopped.push(out))
    const ask = w.join('a.wmv')
    expect(w.started(ask, 'a.mp4')).toBe(true)
    w.cancel('a.wmv')
    expect(stopped).toEqual(['a.mp4'])
  })

  it('leaves a shared copy running while another tab still waits', () => {
    const stopped: string[] = []
    const w = createConvertWaiters((out) => stopped.push(out))
    const a = w.join('a.wmv')
    const b = w.join('a.wmv')
    w.started(a, 'a.mp4')
    w.started(b, 'a.mp4')
    w.cancel('a.wmv')
    expect(stopped).toEqual([])
    w.cancel('a.wmv')
    expect(stopped).toEqual(['a.mp4'])
  })

  it('does not stop a copy a NEWER ask wants, after an older ask was cancelled', () => {
    const stopped: string[] = []
    const w = createConvertWaiters((out) => stopped.push(out))
    const old = w.join('a.wmv')
    w.cancel('a.wmv')
    const fresh = w.join('a.wmv') // the user came straight back
    expect(w.started(old, 'a.mp4')).toBe(false)
    expect(stopped).toEqual([])
    expect(w.started(fresh, 'a.mp4')).toBe(true)
  })

  it('treats a cancel after the copy finished as nothing', () => {
    const stopped: string[] = []
    const w = createConvertWaiters((out) => stopped.push(out))
    const ask = w.join('a.wmv')
    w.started(ask, 'a.mp4')
    w.done(ask)
    w.cancel('a.wmv')
    expect(stopped).toEqual([])
  })
})
