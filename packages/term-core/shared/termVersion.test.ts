import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { TERM_CORE_VERSION, XTERM_VERSION } from './termVersion'

// THE VERSIONS XTVERSION REPORTS (#171) ARE CONSTANTS, kept honest here: Prism's
// renderer cannot import the core's package.json, so a core release that bumps
// one and not the other fails this suite (core/README.md, "Releasing the core").

const version = (file: string): string => (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version

describe('termVersion', () => {
  it("is the core's own package version", () => {
    expect(TERM_CORE_VERSION).toBe(version(join(__dirname, '..', 'package.json')))
  })

  it('is the xterm.js the app bundles', () => {
    expect(XTERM_VERSION).toBe(version(join(__dirname, '..', '..', 'node_modules', '@xterm', 'xterm', 'package.json')))
  })
})
