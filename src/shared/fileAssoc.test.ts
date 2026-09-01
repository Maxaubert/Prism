import { existsSync, readFileSync } from 'node:fs'
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

/** ...and the ones its UNINSTALL half takes back again. */
const unregistered = new Map(
  [...nsh.matchAll(/PRISM_UNEXT\s+"([a-z0-9]+)"\s+"([^"]+)"/gi)].map((m) => [
    m[1].toLowerCase(),
    m[2]
  ])
)
const registeredIds = new Map(
  [...nsh.matchAll(/PRISM_EXT\s+"([a-z0-9]+)"\s+"([^"]+)"/gi)].map((m) => [
    m[1].toLowerCase(),
    m[2]
  ])
)

/** Every ProgID the installer defines, and every one an extension points at. */
const definedIds = new Set([...nsh.matchAll(/PRISM_PROGID\s+"([^"]+)"/g)].map((m) => m[1]))
const usedIds = new Set(
  [...nsh.matchAll(/PRISM_EXT\s+"[a-z0-9]+"\s+"([^"]+)"/gi)].map((m) => m[1])
)

/** Every extension fileKind calls viewable, read from the source it lives in. */
const supported = (() => {
  const src = readFileSync('src/shared/fileKind.ts', 'utf8')
  const out = new Set<string>()
  for (const group of ['IMAGE', 'VIDEO', 'AUDIO', 'DOC', 'TEXT', 'ARCHIVE', 'COMIC']) {
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

  it('takes back every extension it registered', () => {
    // The install half was tested and the uninstall half was not, so it fell 96
    // extensions behind (2026-08-28): uninstalling left dead "Open with" entries
    // pointing at a ProgID that no longer existed.
    const left = [...registered].filter((e) => !unregistered.has(e)).sort()
    expect(left, `add these to the uninstall macro: ${left.join(' ')}`).toEqual([])
  })

  it('takes back nothing it never registered', () => {
    const strays = [...unregistered.keys()].filter((e) => !registered.has(e)).sort()
    expect(strays, `these are unregistered but never registered: ${strays.join(' ')}`).toEqual([])
  })

  it('removes each extension under the ProgID it was registered with', () => {
    const wrong = [...registeredIds]
      .filter(([ext, id]) => unregistered.has(ext) && unregistered.get(ext) !== id)
      .map(([ext, id]) => `${ext}: ${id} vs ${unregistered.get(ext)}`)
    expect(wrong, `install and uninstall disagree: ${wrong.join(', ')}`).toEqual([])
  })

  it('points every extension at a ProgID the installer defines', () => {
    const undefinedIds = [...usedIds].filter((id) => !definedIds.has(id))
    expect(undefinedIds, `ProgIDs used but never defined: ${undefinedIds.join(' ')}`).toEqual([])
  })

  it('deletes every ProgID it defines', () => {
    // The uninstall half is the half that rots: it fell 96 extensions behind
    // once and left dead "Open with" entries pointing at classes that no longer
    // existed. The EXTENSION list has been checked since; the CLASS list never
    // was, and it grew by 25 the day the per-extension code icons landed.
    const left = [...definedIds]
      .filter((id) => !nsh.includes(`DeleteRegKey SHELL_CONTEXT "Software\\Classes\\${id}"`))
      .sort()
    expect(left, `add DeleteRegKey lines for: ${left.join(' ')}`).toEqual([])
  })

  it('points every ProgID at an icon that exists', () => {
    // DefaultIcon is a path Windows resolves at PAINT time, so a typo here is
    // not an install error - it is a blank page in Explorer weeks later.
    const icons = [...nsh.matchAll(/PRISM_PROGID\s+"[^"]+"\s+"[^"]*"\s+"([^"]+)"/g)].map(
      (m) => m[1]
    )
    expect(icons.length).toBe(definedIds.size)
    const missing = icons
      .filter((i) => !existsSync(`build/icons/prism-${i}.ico`))
      .sort()
    expect(missing, `run tools/icons/build_icons.py for: ${missing.join(' ')}`).toEqual([])
  })
})
