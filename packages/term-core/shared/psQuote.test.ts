import { describe, expect, it } from 'vitest'
import { psQuote } from './psQuote'

describe('psQuote', () => {
  it('wraps in single quotes and doubles a plain quote', () => {
    expect(psQuote("it's")).toBe("'it''s'")
  })
  it('doubles the curly quotes PowerShell also reads as quotes', () => {
    expect(psQuote('O’Brien ‘x’ ‚ ‛')).toBe("'O’’Brien ‘‘x’’ ‚‚ ‛‛'")
  })
  it('expands nothing: $ and backticks stay as typed', () => {
    expect(psQuote('$(calc) `n')).toBe("'$(calc) `n'")
  })
})
