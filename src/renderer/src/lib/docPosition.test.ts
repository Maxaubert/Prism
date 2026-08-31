import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearDocPos,
  forgetDocPos,
  MIN_PAGES_WORTH_SAVING,
  MIN_WORTH_SAVING,
  openDocAt,
  rememberDocPos,
  saveDocPos,
  sessionDocPos,
  storedDocPos
} from './docPosition'

beforeEach(() => {
  localStorage.clear()
  forgetDocPos('a')
  forgetDocPos('b')
})

describe('the session position', () => {
  it('is 0 for a document never opened', () => {
    expect(sessionDocPos('a')).toBe(0)
  })

  it('remembers what it was told', () => {
    rememberDocPos('a', 420)
    expect(sessionDocPos('a')).toBe(420)
  })

  it('ignores an empty key, rather than remembering under one', () => {
    rememberDocPos('', 420)
    expect(sessionDocPos('')).toBe(0)
  })

  it('refuses nonsense', () => {
    rememberDocPos('a', Number.NaN)
    rememberDocPos('a', -5)
    expect(sessionDocPos('a')).toBe(0)
  })

  it('keeps documents apart', () => {
    rememberDocPos('a', 100)
    rememberDocPos('b', 200)
    expect(sessionDocPos('a')).toBe(100)
    expect(sessionDocPos('b')).toBe(200)
  })
})

describe('persisting', () => {
  it('saves a position in a document long enough to be worth it', () => {
    saveDocPos('a', 500, MIN_WORTH_SAVING + 1000)
    expect(storedDocPos('a')).toBe(500)
  })

  it('does not save one in a short document', () => {
    // A one-screen README that reopens two lines down reads as a bug.
    saveDocPos('a', 100, MIN_WORTH_SAVING - 1)
    expect(storedDocPos('a')).toBe(0)
  })

  it('clears rather than saves at the end, so a finished document reopens at the top', () => {
    const total = MIN_WORTH_SAVING + 1000
    saveDocPos('a', 500, total)
    saveDocPos('a', total - 1, total)
    expect(storedDocPos('a')).toBe(0)
  })

  it('clears at the very start too', () => {
    saveDocPos('a', 500, MIN_WORTH_SAVING + 1000)
    saveDocPos('a', 0, MIN_WORTH_SAVING + 1000)
    expect(storedDocPos('a')).toBe(0)
  })

  it('counts PAGES for a pdf, on its own threshold', () => {
    saveDocPos('a', 3, MIN_PAGES_WORTH_SAVING - 1, true)
    expect(storedDocPos('a')).toBe(0)
    saveDocPos('a', 3, MIN_PAGES_WORTH_SAVING + 20, true)
    expect(storedDocPos('a')).toBe(3)
  })

  it('never saves against an unknown total', () => {
    saveDocPos('a', 500, 0)
    expect(storedDocPos('a')).toBe(0)
  })

  it('reads garbage as 0', () => {
    localStorage.setItem('prism.docpos.a', 'not a number')
    expect(storedDocPos('a')).toBe(0)
  })

  it('rounds, because a scroll offset is fractional and a key is not', () => {
    saveDocPos('a', 500.6, MIN_WORTH_SAVING + 1000)
    expect(storedDocPos('a')).toBe(501)
  })
})

describe('choosing where to open', () => {
  it('prefers the session, which knows about the tab you just left', () => {
    saveDocPos('a', 900, MIN_WORTH_SAVING + 1000)
    rememberDocPos('a', 120)
    expect(openDocAt('a')).toBe(120)
  })

  it('falls back to what was saved', () => {
    saveDocPos('a', 900, MIN_WORTH_SAVING + 1000)
    expect(openDocAt('a')).toBe(900)
  })

  it('opens at the top when neither knows anything', () => {
    expect(openDocAt('a')).toBe(0)
  })

  it('forgets on request', () => {
    rememberDocPos('a', 120)
    clearDocPos('a')
    forgetDocPos('a')
    expect(openDocAt('a')).toBe(0)
  })
})
