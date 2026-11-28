import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A ratchet for the god file (audit #7, steps 1 and 2): src/main/index.ts must
 * not grow. New main-process code goes in its own module (ipc/, startup/, or a
 * file of its own). Step 2 (2026-11-21) moved createWindow and its session
 * restore (windowFactory.ts), onLaunch (launchRouter.ts) and the whenReady
 * wiring groups (startup/) out; when index.ts shrinks again, lower LINES to
 * the new count.
 */
const LINES = 1171
const SLACK = 50

/** The two big files step 2 made, so they cannot become the next god files. */
const MOVED: Array<[file: string, lines: number]> = [
  ['windowFactory.ts', 649],
  [join('startup', 'tearWiring.ts'), 341]
]

function lineCount(file: string): number {
  const text = readFileSync(join(__dirname, file), 'utf8')
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

describe('src/main/index.ts size', () => {
  it(`stays within ${SLACK} lines of ${LINES}`, () => {
    expect(lineCount('index.ts')).toBeLessThanOrEqual(LINES + SLACK)
  })

  it.each(MOVED)('%s stays within %i lines plus the slack', (file, lines) => {
    expect(lineCount(file)).toBeLessThanOrEqual(lines + SLACK)
  })
})
