import { describe, expect, it } from 'vitest'
import { DEFAULT_STYLE, paintedAlpha, STYLES, variablesFor } from '../theme'
import { CATALOGUE, glassFor, paintedStep } from './catalogue'

// THE 18 THEMES (#298; owner, 2026-10-06: "perfect, go ahead and build"), in
// the approved wall order, with the approved colours. `catalogue.json` is the
// approved data; this holds the app's model to it.

const ORDER = [
  ['aurora', 'Aurora'],
  ['new-void', 'Void'],
  ['carbon', 'Carbon'],
  ['obsidian', 'Obsidian'],
  ['ember', 'Ember'],
  ['volt', 'Volt'],
  ['midnight-hc', 'Midnight HC'],
  ['glacier', 'Glacier'],
  ['lagoon', 'Lagoon'],
  ['frost', 'Frost'],
  ['paper', 'Paper'],
  ['sand', 'Sand'],
  ['sage', 'Sage'],
  ['blush', 'Blush'],
  ['chalk', 'Chalk'],
  ['daylight-hc', 'Daylight HC'],
  ['orchid', 'Orchid'],
  ['pearl', 'Pearl']
]

describe('the shipped themes', () => {
  it('are exactly the 18, in the approved order and names', () => {
    expect(STYLES.map((s) => [s.id, s.name])).toEqual(ORDER)
    expect(CATALOGUE.map((t) => t.id)).toEqual(ORDER.map(([id]) => id))
  })

  it('keep the saved ids of the kept themes (Void is new-void)', () => {
    for (const id of ['aurora', 'new-void', 'frost', 'paper', 'orchid']) expect(STYLES.some((s) => s.id === id)).toBe(true)
    expect(DEFAULT_STYLE).toBe('aurora')
  })

  it('run nine dark, then nine light', () => {
    expect(STYLES.slice(0, 9).every((s) => s.mode === 'dark')).toBe(true)
    expect(STYLES.slice(9).every((s) => s.mode === 'light')).toBe(true)
  })

  it('put high contrast before see-through in each half', () => {
    for (const half of [STYLES.slice(0, 9), STYLES.slice(9)]) {
      const hc = half.findIndex((s) => s.hc)
      const glass = half.findIndex((s) => paintedAlpha(s) < 1)
      expect(hc).toBeGreaterThanOrEqual(0)
      expect(glass).toBeGreaterThan(hc)
      // and see-through closes the half
      expect(half.slice(glass).every((s) => paintedAlpha(s) < 1)).toBe(true)
    }
  })

  it('all set in the system face at 12.5px (2026-09-20)', () => {
    for (const s of STYLES) {
      expect(s.font, s.name).toBe('system')
      expect(s.size, s.name).toBe('12.5')
    }
  })

  it('show no "Suggested" and no mockup bookkeeping', () => {
    for (const t of CATALOGUE) {
      expect(t).not.toHaveProperty('suggested')
      expect(t).not.toHaveProperty('why')
      expect(t).not.toHaveProperty('keptFromCurrent')
    }
    for (const s of STYLES) expect(s.blurb.toLowerCase()).not.toContain('current set')
  })

  for (const t of CATALOGUE) {
    it(`${t.name} is the approved theme, value for value`, () => {
      const s = STYLES.find((x) => x.id === t.id)!
      expect(s.mode).toBe(t.mode)
      expect(s.bg).toBe(t.ground)
      expect([s.side, s.title, s.tabs]).toEqual([t.panel, t.panel, t.panel])
      expect([s.sideOwn, s.titleOwn, s.tabsOwn]).toEqual([true, true, true])
      expect(s.text).toBe(t.text)
      expect(s.accent).toBe(t.accentSolid)
      expect(s.selection).toBe(t.selection)
      expect(s.folderIcon).toBe(t.folder)
      expect(s.corners).toBe(t.corners)
      expect(s.borders).toBe(t.edges)
      expect(!!s.hc).toBe(t.highContrast)
      expect(s.table).toMatchObject({
        raised: t.raised,
        line: t.line,
        dim: t.textDim,
        faint: t.textFaint,
        accentFill: t.accent,
        onAccent: t.onAccent,
        code: t.code
      })
      // The mockup's own archive kind is not used: in Prism a zip wears the
      // folder colour (2026-09-20 rule), checked below as --p-tree-zip.
      const kinds: Partial<typeof t.kinds> = { ...t.kinds }
      delete kinds.archive
      expect(s.table?.kinds).toEqual(kinds)

      // And what Prism PAINTS is the approved theme.
      const v = variablesFor(s)
      expect(v['--p-side-flat']).toBe(t.panel)
      expect(v['--p-raised']).toBe(t.raised)
      expect(v['--p-line']).toBe(t.line)
      expect(v['--p-dim']).toBe(t.textDim)
      expect(v['--p-dim2']).toBe(t.textFaint)
      expect(v['--p-accent']).toBe(t.accent)
      expect(v['--p-sel-bg']).toBe(t.accent)
      expect(v['--p-accent-solid']).toBe(t.accentSolid)
      // --p-accent-hi stays derived, and is the accent itself on all 18.
      expect(v['--p-accent-hi']).toBe(t.accentSolid)
      expect(v['--p-on-accent']).toBe(t.onAccent)
      expect(v['--p-sel-tint']).toBe(t.selection)
      expect(v['--p-sel-tint-seen']).toBe(t.selectionSeen)
      expect(v['--p-tree-folder']).toBe(t.folder)
      expect(v['--p-tree-zip']).toBe(t.folder)
      for (const k of ['image', 'video', 'audio', 'pdf', 'text'] as const) expect(v[`--p-kind-${k}`]).toBe(t.kinds[k])
      if (t.highContrast) {
        expect(v['--p-divider']).toBe(t.line)
        expect(v['--p-edge']).toBe(t.line)
      }
    })
  }
})

describe('the see-through themes', () => {
  const glassy = CATALOGUE.filter((t) => t.seeThrough)

  it('are Glacier and Lagoon, Orchid and Pearl', () => {
    expect(glassy.map((t) => t.id)).toEqual(['glacier', 'lagoon', 'orchid', 'pearl'])
  })

  for (const t of glassy) {
    it(`${t.name} paints its ground and panel at exactly the designed alpha`, () => {
      const s = STYLES.find((x) => x.id === t.id)!
      expect(s.material).toBe('acrylic')
      expect(Math.round(paintedAlpha(s) * 255)).toBe(Math.round(t.groundAlpha * 255))
      expect(Math.round(paintedAlpha(s) * 255)).toBe(t.mode === 'dark' ? 184 : 209)
      const v = variablesFor(s)
      const rgba = (hex8: string): string => {
        const n = (i: number): number => parseInt(hex8.slice(i, i + 2), 16)
        return `${n(1)},${n(3)},${n(5)},${Math.round(n(7))}`
      }
      const painted = (css: string): string => {
        const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(css)!
        return `${m[1]},${m[2]},${m[3]},${Math.round(Number(m[4]) * 255)}`
      }
      expect(painted(v['--p-bg'])).toBe(rgba(t.groundPainted!))
      expect(painted(v['--p-side'])).toBe(rgba(t.panelPainted!))
      expect(painted(v['--p-title'])).toBe(rgba(t.panelPainted!))
      expect(painted(v['--p-tabs'])).toBe(rgba(t.panelPainted!))
    })
  }

  it('glassFor inverts paintedAlpha', () => {
    for (const a of [0.6, paintedStep(0.72), paintedStep(0.82), 0.95]) {
      const g = glassFor(a)
      expect(1 - (1 - g * 0.75) ** 3).toBeCloseTo(a, 12)
    }
  })
})
