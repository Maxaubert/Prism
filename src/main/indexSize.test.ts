import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A ratchet for the god file (audit #7, step 1): src/main/index.ts must not
 * grow. New main-process code goes in its own module (ipc/, or a file of its
 * own). When index.ts shrinks (createWindow, session restore and onLaunch move
 * out in a later step), lower LINES to the new count.
 */
const LINES = 2521
const SLACK = 50

describe('src/main/index.ts size', () => {
  it(`stays within ${SLACK} lines of ${LINES}`, () => {
    const text = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    expect(lines).toBeLessThanOrEqual(LINES + SLACK)
  })
})
