import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isViewable } from './fileKind'

/**
 * Every type Prism can open must be a type Windows offers Prism for.
 *
 * These are two lists in two languages - `fileKind.ts` and the installer's
 * `assoc.nsh` - and they drifted the moment the code viewer landed: 96 of 143
 * extensions were openable but never registered, so Prism opened a `.py`
 * happily and never appeared in "Open with" for one. The .nsh even carried a
 * comment claiming parity. A comment cannot check itself; this can.
 *
 * If you add an extension to fileKind, this test tells you to add it to the
 * installer too.
 */

const nsh = readFileSync('build/installer/assoc.nsh', 'utf8')

/** Extensions the installer registers Prism as a candidate handler for. */
const registered = new Set(
  [...nsh.matchAll(/PRISM_EXT\s+"([a-z0-9]+)"/gi)].map((m) => m[1].toLowerCase())
)

/** Every extension fileKind calls viewable, read from the source it lives in. */
const supported = (() => {
  const src = readFileSync('src/shared/fileKind.ts', 'utf8')
  const out = new Set<string>()
  for (const group of ['IMAGE', 'VIDEO', 'AUDIO', 'DOC', 'TEXT', 'ARCHIVE']) {
    const re = new RegExp('const ' + group + ' = new Set\\(\\[([\\s\\S]*?)\\]\\)')
    const body = re.exec(src)?.[1] ?? ''
    for (const m of body.matchAll(/'\.([a-z0-9]+)'/gi)) out.add(m[1].toLowerCase())
  }
  out.add('pdf') // fileKind spells this one as a literal, not a set
  return out
})()

describe('file associations', () => {
  it('reads a plausible number of extensions out of both sources', () => {
    // A broken regex here would make the parity check pass by comparing two
    // empty sets, which is exactly the kind of green that means nothing.
    expect(supported.size).toBeGreaterThan(100)
    expect(registered.size).toBeGreaterThan(100)
  })

  it('registers every extension fileKind can open', () => {
    const missing = [...supported].filter((e) => !registered.has(e)).sort()
    expect(missing, `add these to build/installer/assoc.nsh: ${missing.join(' ')}`).toEqual([])
  })

  it('registers nothing it cannot open', () => {
    const extra = [...registered].filter((e) => !supported.has(e)).sort()
    expect(extra, `these are registered but not viewable: ${extra.join(' ')}`).toEqual([])
  })

  it('agrees with isViewable, not just with the source text', () => {
    for (const ext of registered) expect(isViewable('.' + ext), ext).toBe(true)
  })

  it('points every extension at a ProgID the installer defines', () => {
    const defined = new Set([...nsh.matchAll(/PRISM_PROGID\s+"([^"]+)"/g)].map((m) => m[1]))
    const used = new Set([...nsh.matchAll(/PRISM_EXT\s+"[a-z0-9]+"\s+"([^"]+)"/gi)].map((m) => m[1]))
    const undefinedIds = [...used].filter((id) => !defined.has(id))
    expect(undefinedIds, `ProgIDs used but never defined: ${undefinedIds.join(' ')}`).toEqual([])
  })
})
