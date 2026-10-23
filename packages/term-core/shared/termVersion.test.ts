import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { TERM_APP_VERSION, XTERM_VERSION } from './termVersion'

// THE VERSIONS XTVERSION REPORTS (#171): Prism's own version, defined from the
// root package.json by the build, and the xterm.js the app bundles.

const version = (file: string): string => (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version

describe('termVersion', () => {
  it("is Prism's own package version", () => {
    expect(TERM_APP_VERSION).toBe(version(join(__dirname, '..', '..', '..', 'package.json')))
  })

  it('is the xterm.js the app bundles', () => {
    expect(XTERM_VERSION).toBe(version(join(__dirname, '..', '..', '..', 'node_modules', '@xterm', 'xterm', 'package.json')))
  })
})