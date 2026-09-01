import { describe, expect, it } from 'vitest'
import { isProse } from './codeLang'
import { ICON_PATHS, LANG_BY_EXT, LANG_BY_NAME, LANG_PATHS } from './iconPaths'

/**
 * The generated icon tables, checked against the app's own idea of a file.
 *
 * `iconPaths.ts` is written by `tools/icons/svg.py` and nothing in the TypeScript
 * build can see that generator, so these are the assertions that would otherwise
 * be a comment asking someone to remember. Two lists of the same thing in two
 * languages is how the installer fell 96 extensions behind once already.
 */
describe('the generated icon tables', () => {
  it('gives every kind a body and a label', () => {
    const kinds = Object.keys(ICON_PATHS)
    expect(kinds.length).toBe(7)
    for (const k of kinds) {
      const g = ICON_PATHS[k as keyof typeof ICON_PATHS]
      expect(g.body.length, k).toBeGreaterThan(20)
      expect(g.label.sizes[3], k).toBeGreaterThan(0)
    }
  })

  it('names a mark that exists, from every table that points at one', () => {
    for (const [ext, mark] of Object.entries(LANG_BY_EXT)) {
      expect(LANG_PATHS[mark], `${ext} -> ${mark}`).toBeDefined()
    }
    for (const [name, mark] of Object.entries(LANG_BY_NAME)) {
      expect(LANG_PATHS[mark], `${name} -> ${mark}`).toBeDefined()
    }
  })

  it('draws every mark, and the ones with holes carry them', () => {
    for (const [name, m] of Object.entries(LANG_PATHS)) {
      expect(m.ko.length, name).toBeGreaterThan(20)
    }
    // The three whose knockout is load-bearing: without it a cog is a flower,
    // a cylinder is a rounded rectangle and a cup is a blob.
    for (const name of ['config', 'sql', 'java'] as const) {
      expect(LANG_PATHS[name].hi.length, name).toBeGreaterThan(10)
    }
  })

  it('agrees with the editor about what counts as prose', () => {
    // `.log` had been getting the CODE mark - an indent guide - and a vertical
    // spine with rungs is not a picture of structure at 14px, it is two
    // letterforms. The list of prose extensions lives in codeLang, is used by
    // the editor to drop the gutter, and must not fork.
    const prose = Object.entries(LANG_BY_EXT)
      .filter(([, mark]) => mark === 'prose')
      .map(([ext]) => ext)
    expect(prose.length).toBeGreaterThan(3)
    for (const ext of prose) expect(isProse(`file.${ext}`), ext).toBe(true)

    // And the reverse, for the ones the editor names outright: a prose
    // extension that quietly drew source would be the same bug again.
    for (const ext of ['txt', 'log', 'csv', 'srt', 'vtt']) {
      expect(LANG_BY_EXT[ext], ext).toBe('prose')
    }
  })

  it('keeps a mark for the files Windows can never label', () => {
    // Bare names and dotfiles have no extension to hang a ProgID on, so these
    // exist for the tree alone. If they ever vanish from the generator this is
    // what says so.
    for (const n of ['dockerfile', '.gitignore']) expect(LANG_BY_NAME[n]).toBeDefined()
  })
})
