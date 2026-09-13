import { describe, expect, it } from 'vitest'
import { LONG_HIDE_MS, returnAction } from './returning'

const fine = { hiddenMs: LONG_HIDE_MS + 1, error: false, readyState: 4, stuck: null }

describe('returnAction', () => {
  it('leaves a short absence alone whatever the player looks like', () => {
    expect(returnAction({ hiddenMs: 5000, error: true, readyState: 0, stuck: true })).toBe('none')
  })

  it('re-attaches after a long absence when the player is the worse for it', () => {
    expect(returnAction({ ...fine, error: true })).toBe('reattach')
    expect(returnAction({ ...fine, readyState: 1 })).toBe('reattach')
    expect(returnAction({ ...fine, stuck: true })).toBe('reattach')
  })

  it('leaves a working player alone after a long absence', () => {
    expect(returnAction(fine)).toBe('none')
    expect(returnAction({ ...fine, stuck: false })).toBe('none')
  })
})
