import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Audit #35 (owner, 2026-11-20): mammoth parses .docx XML with @xmldom/xmldom;
// the copy it resolves must be 0.8.15 or newer (parser-cost fixes).

const root = join(__dirname, '..', '..')
const version = (p: string): number[] =>
  (JSON.parse(readFileSync(p, 'utf8')) as { version: string }).version.split('.').map(Number)
const atLeast = (v: number[], min: number[]): boolean =>
  v[0] !== min[0] ? v[0] > min[0] : v[1] !== min[1] ? v[1] > min[1] : v[2] >= min[2]

describe('@xmldom/xmldom', () => {
  it('resolves to 0.8.15 or newer for mammoth', () => {
    const own = join(root, 'node_modules', 'mammoth', 'node_modules', '@xmldom', 'xmldom', 'package.json')
    let path = join(root, 'node_modules', '@xmldom', 'xmldom', 'package.json')
    try {
      readFileSync(own)
      path = own
    } catch {
      /* hoisted: the top copy is the one mammoth gets */
    }
    expect(atLeast(version(path), [0, 8, 15])).toBe(true)
  })

  it('is pinned by an npm override', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { overrides?: Record<string, string> }
    expect(pkg.overrides?.['@xmldom/xmldom']).toBeTruthy()
  })
})