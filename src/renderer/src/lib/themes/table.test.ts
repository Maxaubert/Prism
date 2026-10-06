import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pruneTable, STYLES, variablesFor, type Style } from '../theme'
import snapshot from './legacy.snapshot.json'
import { RETIRED_STYLES } from './retired'

// THE TABLE HOLDS ONLY WHILE ITS INPUTS DO (#298, spec 1.1), and a style with
// no table derives EXACTLY as it did before the themes existed: every own copy
// saved before #298 is such a style, and its window must not move.

type Snap = Record<string, { style: Style; vars: Record<string, string>; opaque: Record<string, string> }>
const SNAP = snapshot as unknown as Snap

describe('a style without a table derives as before, byte for byte', () => {
  it('the retired definitions are the ones the snapshot was taken from', () => {
    expect(RETIRED_STYLES.map((s) => s.id)).toEqual(Object.keys(SNAP))
    for (const s of RETIRED_STYLES) expect(s).toEqual(SNAP[s.id].style)
  })

  for (const s of RETIRED_STYLES) {
    it(`${s.name}: every token it published on main (7b0d688), unchanged`, () => {
      // The snapshot was taken on the untouched code, before this branch. A
      // token added since (`--p-raised`, the code colours) is checked below.
      const now = variablesFor(s)
      for (const [k, v] of Object.entries(SNAP[s.id].vars)) expect(now[k], k).toBe(v)
      const flat = variablesFor(s, true)
      for (const [k, v] of Object.entries(SNAP[s.id].opaque)) expect(flat[k], `opaque ${k}`).toBe(v)
    })

    it(`${s.name}: the new tokens are what it painted before them`, () => {
      const v = variablesFor(s)
      // Menus painted the panel's flat colour.
      expect(v['--p-raised']).toBe(v['--p-side-flat'])
    })
  }
})

describe('pruneTable', () => {
  const table = STYLES[0].table!

  it('keeps everything when nothing it was designed against moved', () => {
    expect(pruneTable(table, {})).toEqual(table)
    for (const o of [{ acrylic: 40 }, { side: '#111111' }, { selection: '#ff000038' }, { folderIcon: '#ff0000' }, { font: 'mono' as const }, { corners: '2' as const }])
      expect(pruneTable(table, o), JSON.stringify(o)).toEqual(table)
  })

  it('a ground or text edit drops what was drawn for them', () => {
    for (const o of [{ bg: '#222222' }, { text: '#eeeeee' }]) {
      const t = pruneTable(table, o)!
      for (const k of ['raised', 'line', 'dim', 'faint', 'kinds', 'code']) expect(t, k).not.toHaveProperty(k)
      expect(t.accentFill).toBe(table.accentFill)
      expect(t.onAccent).toBe(table.onAccent)
    }
  })

  it('an accent edit drops the fill and its ink, its alpha too', () => {
    for (const o of [{ accent: '#ff0000' }, { accentAlpha: 0.5 }]) {
      const t = pruneTable(table, o)!
      expect(t).not.toHaveProperty('accentFill')
      expect(t).not.toHaveProperty('onAccent')
      expect(t.dim).toBe(table.dim)
    }
  })

  it('an Edges edit gives high contrast its derived edges back', () => {
    const hc = STYLES.find((s) => s.hc)!.table!
    expect(hc.edge).toBeDefined()
    expect(pruneTable(hc, { borders: 'faint' })).not.toHaveProperty('edge')
  })

  it('is undefined once nothing is left, and for no table', () => {
    expect(pruneTable(undefined, { bg: '#000000' })).toBeUndefined()
    expect(pruneTable({ dim: '#888888' }, { bg: '#000000' })).toBeUndefined()
  })
})

describe('an edit never paints a value drawn for colours no longer on screen', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    vi.stubGlobal('window', new EventTarget())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('an own copy saved after a ground edit carries no designed dim', async () => {
    const theme = await import('../theme')
    theme.setStyle('aurora')
    theme.setOverride('bg', '#334455')
    const shown = theme.currentStyle()
    expect(shown.table?.dim).toBeUndefined()
    expect(shown.table?.accentFill).toBe(theme.STYLES[0].table?.accentFill)
    // Prism derives the dim again, against the ground on screen.
    expect(theme.variablesFor(shown)['--p-dim']).not.toBe(theme.STYLES[0].table?.dim)
    theme.savePreset()
    const saved = JSON.parse(localStorage.getItem('prism.style.presets') ?? '[]') as Style[]
    expect(saved).toHaveLength(1)
    expect(saved[0].table?.dim).toBeUndefined()
    expect(saved[0].base).toBe('aurora')
    expect(saved[0].bg).toBe('#334455')
  })

  it('an untouched theme saved as a copy keeps its whole design', async () => {
    const theme = await import('../theme')
    theme.setStyle('carbon')
    theme.setOverride('font', 'mono')
    theme.savePreset()
    const saved = JSON.parse(localStorage.getItem('prism.style.presets') ?? '[]') as Style[]
    expect(saved[0].table).toEqual(theme.STYLES.find((s) => s.id === 'carbon')!.table)
  })
})
