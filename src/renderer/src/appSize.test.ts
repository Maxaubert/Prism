import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A ratchet for the god component (audit #8 and #12): App.tsx must not grow
 * back. New window logic goes in a hook of its own (hooks/useApp*) or, for the
 * Explorer, components/explorer. When App.tsx shrinks again, lower LINES to
 * the new count.
 */
const LINES = 819
const SLACK = 50

describe('src/renderer/src/App.tsx size', () => {
  it(`stays within ${SLACK} lines of ${LINES}`, () => {
    const text = readFileSync(join(__dirname, 'App.tsx'), 'utf8')
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    expect(lines).toBeLessThanOrEqual(LINES + SLACK)
  })
})
