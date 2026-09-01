import { describe, expect, it } from 'vitest'
import { isProse } from './codeLang'
import {
  ICON_COLOURS,
  ICON_PATHS,
  IDENT_BY_EXT,
  LANG_BY_EXT,
  LANG_BY_NAME,
  LANG_PATHS
} from './iconPaths'

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

  it('splits ko into a band and a mark that add back up to it', () => {
    // The coloured scheme needs the two apart, and they must stay the SAME two
    // shapes monochrome draws in one path - with one deliberate difference:
    // `ko`'s band overshoots the page by 0.6 units to keep its antialiasing off
    // the rounded bottom corners, and `band` is the clipped version, because an
    // overshoot that is invisible painted in the row's background reads as a
    // label wider than the icon once it has a colour of its own.
    for (const k of Object.keys(ICON_PATHS) as Array<keyof typeof ICON_PATHS>) {
      const g = ICON_PATHS[k]
      expect(g.band.length, k).toBeGreaterThan(20)
      expect(g.mark.length, k).toBeGreaterThan(20)
      // `bleed` is what COLOURED actually draws, inside a clip of `body`. It
      // must carry no curve and no diagonal of its own: every rounded corner
      // and the fold's hypotenuse come from the clip, which is the whole reason
      // the two cannot disagree about where the icon's edge is.
      expect(g.bleed, k).toMatch(/^[MHVZ0-9 .-]+$/)
      // ko is exactly koBand then mark, which is what lets the app draw the
      // fold and band without the mark - it does that whenever a LANGUAGE mark
      // replaces the kind's own. It used to slice the first two subpaths off
      // the front of ko instead, which is right only while there are exactly
      // two: a third leading subpath would have dropped half a fold silently
      // rather than failing. The emitter states it now, and this is the pin.
      expect(g.ko, k).toBe(`${g.koBand} ${g.mark}`)
      // The coloured band is NOT ko's, because it is clipped to the page where
      // ko's overshoots it by 0.6 units.
      expect(g.band, k).not.toBe(g.koBand)
      expect(g.ko.startsWith(g.band), k).toBe(false)
    }
  })

  it('gives every identity a colour for every layer that takes one', () => {
    for (const k of Object.keys(ICON_COLOURS) as Array<keyof typeof ICON_COLOURS>) {
      const c = ICON_COLOURS[k]
      for (const role of ['page', 'band', 'mark', 'text'] as const) {
        expect(c[role], `${k}.${role}`).toMatch(/^#[0-9a-f]{6}$/)
      }
      // A layer the same colour as what it sits on is an invisible layer. This
      // is the assertion that would have caught the comic splat: the .ico's own
      // pink on its own page measures 1.00:1, and only works there because the
      // sunburst sits between the two.
      expect(c.mark, k).not.toBe(c.page)
      expect(c.text, k).not.toBe(c.band)
    }
  })

  it('can colour anything the tree can draw', () => {
    // Every route into a colour must land on one. A language mark wins first,
    // then a special extension, then the kind - so all three sets have to be
    // identities. A mark added to the emitter without a colour would otherwise
    // fall through to `undefined` and throw on the first row that used it.
    for (const mark of Object.keys(LANG_PATHS)) {
      expect(ICON_COLOURS[mark as keyof typeof ICON_COLOURS], mark).toBeDefined()
    }
    for (const [ext, ident] of Object.entries(IDENT_BY_EXT)) {
      expect(ICON_COLOURS[ident], `${ext} -> ${ident}`).toBeDefined()
    }
    for (const kind of Object.keys(ICON_PATHS)) {
      expect(ICON_COLOURS[kind as keyof typeof ICON_COLOURS], kind).toBeDefined()
    }
  })

  it('keeps the special extensions out of the language marks', () => {
    // The order is mark, then special extension, then kind, so an extension in
    // both tables would silently take its mark's colour and leave the special
    // entry dead. A `.csv` SHOULD take the prose mark, which is why this checks
    // the special table rather than the other way round.
    for (const ext of Object.keys(IDENT_BY_EXT)) {
      expect(LANG_BY_EXT[ext], `${ext} is special AND marked`).toBeUndefined()
    }
  })

  it('keeps every coloured mark and label above the floor it was measured at', () => {
    // Not a WCAG claim - these are marks and a 3-character label, not body text.
    // It is a REGRESSION floor: the numbers were measured when the owner picked
    // the colours, and a later pick that drops below them is the icon quietly
    // becoming unreadable.
    const lum = (hex: string): number => {
      const c = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const ratio = (a: string, b: string): number => {
      const x = lum(a)
      const y = lum(b)
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
    }
    for (const k of Object.keys(ICON_COLOURS) as Array<keyof typeof ICON_COLOURS>) {
      const c = ICON_COLOURS[k]
      // The glyph is PICKED now rather than derived from the page, so nothing
      // guarantees it can be seen and this is the floor that says so. 2 rather
      // than 3 because the lowest pick in the set is `slides` at 2.19:1 - white
      // on the same orange that every scripting language wears BLACK on at
      // 9.59:1.
      expect(ratio(c.mark, c.page), `${k} mark`).toBeGreaterThan(2)
      expect(ratio(c.text, c.band), `${k} text`).toBeGreaterThan(10)
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
