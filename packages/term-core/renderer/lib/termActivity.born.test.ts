import { describe, expect, it } from 'vitest'
import { forgetSession, markBorn, markTouched, startupOutput } from './termActivity'

describe("an agent's startup paint ends at the first silence (2026-09-04)", () => {
  it('suppresses the stream after birth however long it runs, until a quiet gap', () => {
    markBorn('a', 1000)
    // A startup that streams for eight seconds with no gap over 1.5s.
    for (let t = 1100; t <= 9000; t += 300) expect(startupOutput('a', t)).toBe(true)
    // Silence, then the agent's first answer: counts from its first chunk.
    expect(startupOutput('a', 12000)).toBe(false)
    expect(startupOutput('a', 12100)).toBe(false)
    forgetSession('a')
  })

  it('a session with no agent is never suppressed', () => {
    expect(startupOutput('plain', 1000)).toBe(false)
    expect(startupOutput('plain', 1100)).toBe(false)
  })

  it('detection that lands after the startup already ended costs nothing: the next chunk is real', () => {
    markBorn('b', 5000)
    expect(startupOutput('b', 9000)).toBe(false)
    forgetSession('b')
  })

  it('forgetting the session clears the birth', () => {
    markBorn('c', 1000)
    forgetSession('c')
    expect(startupOutput('c', 1100)).toBe(false)
  })

  it('typing into the agent ends the startup too, so the first answer counts', () => {
    markBorn('d', 1000)
    expect(startupOutput('d', 1200)).toBe(true) // still painting
    markTouched('d') // the user types a prompt straight away
    expect(startupOutput('d', 1400)).toBe(false) // its echo, and the answer after it, are real
    forgetSession('d')
  })
})
